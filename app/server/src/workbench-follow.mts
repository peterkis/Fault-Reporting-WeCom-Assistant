import {FINAL_EPOCH_SQL,FINAL_LOCAL_SQL,finalCardReadSql,withFinalStatementClock} from './workbench-card-projections.mjs';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createP2016ManualReviewFacade} from './p2-016-manual-review-facade.mjs';
import type {WorkbenchCard} from '../../../contracts/web01_workbench_contracts.js';
import type {FollowItem,WorkbenchFollowCommand,WorkbenchFollowAttention,WorkbenchFollowResult,WorkbenchFollowReceipt} from '../../../contracts/workbench_item_follow_contracts.js';
import {createWeb01WorkbenchQuery,HANDLING_CARD_SQL,COMMUNICATION_CARD_SQL,targetedProjectionSql} from './web01-workbench-query.mjs';
import {ticketPredicateP2016,withCurrentCardReader,readableReviewJourneysSql,REVIEW_JOURNEY_SCOPE_LIMIT} from './p2-016-ticket-query.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {exactP2016,uuidP2016,hashP2016,failP2016,guardP2016,publicP2016,transactionP2016} from './p2-016-domain-contracts.mjs';
import {followSchemaReady} from '../scripts/workbench-follow-migrate.mjs';

const PURPOSE='WORKBENCH_ITEM_FOLLOW';
export function followItem(value:unknown):FollowItem{
 const v=exactP2016(value,['kind','id']);if(v.kind!=='ticket'&&v.kind!=='review'&&v.kind!=='intake')failP2016();return {kind:v.kind,id:uuidP2016(v.id)};
}
export function followCommand(value:unknown):WorkbenchFollowCommand{
 const v=exactP2016(value,['client_command_id','canonical_item','expected_follow_version','following']);
 if(typeof v.expected_follow_version!=='string'||!/^[a-f0-9]{64}$/u.test(v.expected_follow_version)||typeof v.following!=='boolean')failP2016();
 return {client_command_id:uuidP2016(v.client_command_id),canonical_item:followItem(v.canonical_item),expected_follow_version:v.expected_follow_version,following:v.following};
}
function result(value:unknown):WorkbenchFollowResult{
 const v=exactP2016(value,['ok','client_command_id','requested_item','canonical_item','following','follow_version','replayed']);
 if(v.ok!==true||typeof v.following!=='boolean'||typeof v.replayed!=='boolean'||typeof v.follow_version!=='string'||!/^[a-f0-9]{64}$/u.test(v.follow_version))failP2016('ACTION_FAILED',503);
 return {ok:true,client_command_id:uuidP2016(v.client_command_id),requested_item:followItem(v.requested_item),canonical_item:followItem(v.canonical_item),following:v.following,follow_version:v.follow_version,replayed:v.replayed};
}
interface Input {authContext:unknown;kind:string;id:unknown}
export interface FollowAnchor {id:string;following:boolean;row_version:string}
function followVersion(principalId:string,canonical:FollowItem,anchors:readonly FollowAnchor[]){
 return hashP2016([1,principalId,canonical,anchors.map(a=>[a.id,a.following,a.row_version])]);
}
export interface FollowBatchRow {kind:string;id:string;intake_id:string;readable:boolean;missing_review:boolean;review_scope_overflow:boolean;canonical_changed:boolean;handling:boolean;communication:boolean;anchors:FollowAnchor[];review_legs:number}
export interface FollowProjectionPort {
 ready():Promise<boolean>;
 checkRead(input:Input,item:Pick<WorkbenchCard,'kind'|'id'|'intake_id'>):Promise<void>;
 attention(input:Input,item:WorkbenchCard,reasons:readonly ('HANDLING'|'COMMUNICATION')[]):Promise<WorkbenchFollowAttention>;
 attentionMany(authContext:unknown,items:readonly WorkbenchCard[],surface?:'board'|'search'):Promise<readonly WorkbenchFollowAttention[]>;
}
export function createWorkbenchFollow({pool,query,reviews,manualReviewEnabled=false,manualReportsEnabled=false,enabled=false}:{pool:PostgresPool;query:P2016TicketQuery;reviews:Pick<ReturnType<typeof createP2016ManualReviewFacade>,'canonicalItem'>;manualReviewEnabled?:boolean;manualReportsEnabled?:boolean;enabled?:boolean}){
 if(typeof enabled!=='boolean')failP2016('FLAG_INVALID',503);
 const ledger=createP2016CommandLedger({pool});
 async function ready(){return enabled&&await followSchemaReady(pool);}
 async function authorize(tx:PostgresTransaction,input:Input,schemaChecked=false){
  guardP2016(enabled);if(!schemaChecked&&!await followSchemaReady(tx))failP2016('DISABLED',503);
  const requested=followItem({kind:input.kind,id:input.id}),principal=await query.principal(input.authContext,tx);
  const scoped={...query,principal:(auth:unknown,transaction:PostgresTransaction=tx)=>query.principal(auth,transaction)};
  const canonicalReviews={canonicalItem:(v:Parameters<typeof reviews.canonicalItem>[0])=>reviews.canonicalItem({...v,transaction:tx})};
  const base=createWeb01WorkbenchQuery({pool:tx,query:scoped,manualReviewEnabled,manualReportsEnabled,reviews:canonicalReviews});
  if(requested.kind==='review')await canonicalReviews.canonicalItem({authContext:input.authContext,reviewId:requested.id});
  const item=await base.authorizedIdentity(input.authContext,requested.kind,requested.id),canonical=followItem({kind:item.kind,id:item.id});
  const source=(await tx.query<{id:string}>(requested.kind==='ticket'
   ?'SELECT source_intake_id::text AS id FROM pilot_ticket.ticket WHERE id=$1::uuid'
   :requested.kind==='review'?'SELECT service_intake_id::text AS id FROM intake.manual_review_item WHERE id=$1::uuid'
   :'SELECT id::text FROM intake.service_intake WHERE id=$1::uuid',[requested.id])).rows[0];
  if(!source)failP2016('NOT_FOUND',404);
  const anchors=(await tx.query<FollowAnchor>(withFinalStatementClock(`SELECT i.id::text,COALESCE(f.following,false) AS following,COALESCE(f.row_version,0)::text AS row_version
    FROM intake.service_intake i LEFT JOIN pilot_ticket.workbench_item_follow f ON f.source_intake_id=i.id AND f.principal_id=$1::uuid
    WHERE i.id=$2::uuid OR ($3='ticket' AND i.retention_until>${FINAL_LOCAL_SQL} AND (
      EXISTS(SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE l.source_intake_id=i.id AND j.linked_ticket_id=$4::uuid AND j.retention_until_epoch_ms>${FINAL_EPOCH_SQL})
      OR EXISTS(SELECT 1 FROM intake.manual_review_item r JOIN intake.contact_journey j ON j.id=r.journey_id WHERE r.service_intake_id=i.id AND r.linked_ticket_id=$4::uuid AND j.retention_until_epoch_ms>${FINAL_EPOCH_SQL})))
    ORDER BY i.id LIMIT 101`),[principal.principal_id,item.intake_id,canonical.kind,canonical.id])).rows;
  if(!anchors.length||anchors.length>100)failP2016('ACTION_FAILED',503);
  return {principal,requested,canonical,item,requestedAnchor:source.id,anchors};
 }
 async function currentRead(input:Input,item:Pick<WorkbenchCard,'kind'|'id'|'intake_id'>){
  const context=await authorize(pool,input);
  if(context.canonical.kind!==item.kind||context.canonical.id!==item.id||context.item.intake_id!==item.intake_id)failP2016('VERSION_CONFLICT',409);
  return context;
 }
 type Context=Awaited<ReturnType<typeof authorize>>;
 const token=(c:Context)=>followVersion(c.principal.principal_id,c.canonical,c.anchors);
 async function lockAuthority(tx:PostgresTransaction,c:Context){
  const ids=c.anchors.map(a=>a.id);
  await tx.query('SELECT id FROM intake.service_intake WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
  await tx.query('SELECT j.id FROM intake.contact_journey j WHERE EXISTS(SELECT 1 FROM intake.channel_leg l WHERE l.journey_id=j.id AND l.source_intake_id=ANY($1::uuid[])) ORDER BY j.id FOR UPDATE',[ids]);
  await tx.query('SELECT id FROM intake.manual_review_item WHERE service_intake_id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
  if(c.canonical.kind==='ticket')await tx.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR UPDATE',[c.canonical.id]);
  await tx.query('SELECT id FROM pilot_ticket.pilot_principal WHERE id=$1::uuid FOR SHARE',[c.principal.principal_id]);
  await tx.query('SELECT principal_id,role FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid ORDER BY role FOR SHARE',[c.principal.principal_id]);
  await tx.query('SELECT m.principal_id,m.team_id FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team t ON t.team_id=m.team_id WHERE m.principal_id=$1::uuid ORDER BY m.team_id FOR SHARE OF m,t',[c.principal.principal_id]);
 }
 return Object.freeze({
  ready,
  async checkRead(input:Input,item:Pick<WorkbenchCard,'kind'|'id'|'intake_id'>){await currentRead(input,item);},
  async attentionMany(authContext:unknown,items:readonly WorkbenchCard[],surface:'board'|'search'='board'):Promise<readonly WorkbenchFollowAttention[]>{
   if(items.length>100)failP2016();
   if(!await ready())failP2016('DISABLED',503);
   // Follow can be installed without the optional WEB/MANUAL predecessors.
   // A mixed page checks WEB availability once, never once per Review.
   const hasReview=items.some(item=>item.kind==='review');
   const reviewWebSource=hasReview&&(await pool.query<{present:boolean}>("SELECT to_regclass('intake.web_request_binding') IS NOT NULL AS present")).rows[0]?.present===true;
   // Run after all page decorators. Resolve current authority once, then apply
   // the canonical READ relation to the whole page in the same anchor query.
   const principal=await query.principal(authContext),p=ticketPredicateP2016(principal);
   if(!items.length)return [];
   const reviewScopeOverflow=surface==='search'&&hasReview
     ?`EXISTS(SELECT 1 FROM (${readableReviewJourneysSql(p.sql)}) readable_journeys OFFSET ${REVIEW_JOURNEY_SCOPE_LIMIT})`:'FALSE';
   const rows=(await pool.query<FollowBatchRow>(withCurrentCardReader(finalCardReadSql(targetedProjectionSql()+`, requested AS (
     SELECT * FROM jsonb_to_recordset($6::jsonb) AS page(kind text,id text,intake_id text)
    ) SELECT requested.*,${reviewScopeOverflow} AS review_scope_overflow,cards.id IS NOT NULL AND (requested.kind<>'review' OR (
       decision.id IS NOT NULL
       AND (COALESCE(to_jsonb(decision)->>'source_kind','BOT')<>'MANUAL' OR $7::boolean)
       AND (COALESCE(to_jsonb(decision)->>'source_kind','BOT')<>'WEB' OR ${reviewWebSource?"EXISTS(SELECT 1 FROM intake.web_request_binding b WHERE b.intake_id=cards.intake_id::uuid AND b.revoked_at IS NULL AND b.retention_until>$5::timestamp without time zone)":'FALSE'})
      )) AS readable, requested.kind='review' AND cards.id IS NULL AS missing_review,
      (requested.kind='review' AND cards.id IS NULL AND decision.id IS NOT NULL
       AND (COALESCE(to_jsonb(decision)->>'source_kind','BOT')<>'MANUAL' OR $7::boolean)
       AND (COALESCE(to_jsonb(decision)->>'source_kind','BOT')<>'WEB' OR ${reviewWebSource?"EXISTS(SELECT 1 FROM intake.web_request_binding b WHERE b.intake_id=review.service_intake_id AND b.revoked_at IS NULL AND b.retention_until>$5::timestamp without time zone)":'FALSE'})
       AND EXISTS(SELECT 1 FROM pilot_ticket.ticket t JOIN intake.contact_journey j ON j.id=review.journey_id
        JOIN intake.service_intake i ON i.id=review.service_intake_id
        WHERE (t.source_intake_id=i.id OR t.id=review.linked_ticket_id OR t.id=j.linked_ticket_id)
         AND ${p.sql} AND i.retention_until>$5::timestamp without time zone AND j.retention_until_epoch_ms>$4::bigint)) AS canonical_changed,
      (${HANDLING_CARD_SQL}) AS handling,(${COMMUNICATION_CARD_SQL}) AS communication,
      COALESCE(anchors.items,'[]'::jsonb) AS anchors,
      (SELECT count(*)::integer FROM (SELECT later.id FROM intake.channel_leg later JOIN intake.channel_leg basis ON basis.id=decision.channel_leg_id
       WHERE requested.kind='review' AND COALESCE(to_jsonb(decision)->>'source_kind','BOT')<>'WEB' AND later.journey_id=review.journey_id AND later.leg_ordinal>basis.leg_ordinal LIMIT 101) bounded) AS review_legs
    FROM requested CROSS JOIN card_reader LEFT JOIN cards ON cards.kind=requested.kind AND cards.id=requested.id AND cards.intake_id=requested.intake_id
    LEFT JOIN intake.manual_review_item review ON requested.kind='review' AND review.id=requested.id::uuid
    LEFT JOIN intake.deterministic_decision decision ON decision.id=review.decision_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id',a.id::text,'following',a.following,'row_version',a.row_version) ORDER BY a.id) AS items FROM (
       SELECT i.id,COALESCE(f.following,false) AS following,COALESCE(f.row_version,0)::text AS row_version
       FROM (
        SELECT cards.intake_id::uuid AS id
        UNION SELECT l.source_intake_id FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
          WHERE cards.kind='ticket' AND j.linked_ticket_id=cards.id::uuid AND j.retention_until_epoch_ms>$4::bigint
        UNION SELECT r.service_intake_id FROM intake.manual_review_item r JOIN intake.contact_journey j ON j.id=r.journey_id
          WHERE cards.kind='ticket' AND r.linked_ticket_id=cards.id::uuid AND j.retention_until_epoch_ms>$4::bigint
       ) candidate JOIN intake.service_intake i ON i.id=candidate.id
       LEFT JOIN pilot_ticket.workbench_item_follow f ON f.source_intake_id=i.id AND f.principal_id=$2::uuid
       WHERE i.id=cards.intake_id::uuid OR i.retention_until>$5::timestamp without time zone
       ORDER BY i.id LIMIT 101
      ) a
    ) anchors ON cards.id IS NOT NULL`)),[principal.principal_id,JSON.stringify(items.map(({kind,id,intake_id})=>({kind,id,intake_id}))),manualReportsEnabled])).rows;
   // A current reader gets one row per requested item, including unreadable targets.
   if(!rows.length)failP2016('FORBIDDEN',403);
   const byItem=new Map(rows.map(row=>[row.kind+':'+row.id,row]));
   const attention:WorkbenchFollowAttention[]=[];
   for(const item of items){
    const row=byItem.get(item.kind+':'+item.id);
    if(item.kind==='review'&&row?.review_scope_overflow)failP2016('REVIEW_SCOPE_TOO_LARGE',503);
    if(!row?.readable){
      if(surface==='board'&&row?.canonical_changed)failP2016('VERSION_CONFLICT',409);
      if(surface==='search'&&row?.missing_review&&manualReviewEnabled){
        const reader=createWeb01WorkbenchQuery({pool,query,reviews,manualReviewEnabled,manualReportsEnabled});
        const current=await reader.authorizedIdentity(authContext,'review',item.id);
        if(current.kind!==item.kind||current.id!==item.id)failP2016('CURSOR_INVALID');
      }
      failP2016('NOT_FOUND',404);
    }
    if(row.review_legs>100)failP2016('ACTION_FAILED',503);
    if(!row.anchors.length||row.anchors.length>100)failP2016('ACTION_FAILED',503);
    const following=row.anchors.some(a=>a.following),canonical=followItem({kind:item.kind,id:item.id});
    attention.push(publicP2016({following,follow_version:followVersion(principal.principal_id,canonical,row.anchors),
     related_reasons:[...(row.handling?['HANDLING' as const]:[]),...(row.communication?['COMMUNICATION' as const]:[]),...(following?['FOLLOW' as const]:[])]}));
   }
   return attention;
  },
  async attention(input:Input,item:WorkbenchCard,reasons:readonly ('HANDLING'|'COMMUNICATION')[]):Promise<WorkbenchFollowAttention>{
   const c=await currentRead(input,item);
   const following=c.anchors.some(a=>a.following);return publicP2016({following,follow_version:token(c),related_reasons:[...reasons,...(following?['FOLLOW' as const]:[])]});
  },
  async save(input:Input&{body:unknown}):Promise<WorkbenchFollowResult>{
   const body=followCommand(input.body),requested=followItem({kind:input.kind,id:input.id});
   const initial=await authorize(pool,input);
   const command={...body,requested_item:requested,action:PURPOSE,source_intake_id:initial.requestedAnchor,
    ticket_id:requested.kind==='ticket'?requested.id:null,review_id:requested.kind==='review'?requested.id:null};
   const outcome=await ledger.execute({command,receiptType:PURPOSE,authorize:tx=>authorize(tx,input),afterReceiptLock:tx=>authorize(tx,input),run:async(tx,context)=>{
    await lockAuthority(tx,context);const c=await authorize(tx,input);
    if(JSON.stringify(c.canonical)!==JSON.stringify(body.canonical_item)||body.expected_follow_version!==token(c))failP2016('VERSION_CONFLICT',409);
    const targets=body.following?c.anchors.filter(a=>a.id===c.item.intake_id):c.anchors;
    for(const a of targets)if(a.following!==body.following){
     const changed=await tx.query(`INSERT INTO pilot_ticket.workbench_item_follow(principal_id,source_intake_id,following) VALUES($1::uuid,$2::uuid,$3)
       ON CONFLICT(principal_id,source_intake_id) DO UPDATE SET following=EXCLUDED.following,row_version=pilot_ticket.workbench_item_follow.row_version+1,updated_at=platform.local_now()`,[c.principal.principal_id,a.id,body.following]);
     if(changed.rowCount!==1)failP2016('ACTION_FAILED',503);
    }
    const after=await authorize(tx,input),following=after.anchors.some(a=>a.following);
    if(following!==body.following)failP2016('ACTION_FAILED',503);
    return {ok:true as const,client_command_id:body.client_command_id,requested_item:requested,canonical_item:after.canonical,following,follow_version:token(after)};
   }});
   if(outcome.ok!==true){const code=outcome.error.code.replace(/^P2_016_/,'');failP2016(code,code==='NOT_FOUND'?404:code==='FORBIDDEN'?403:code==='DISABLED'||code==='ACTION_FAILED'?503:409);}return publicP2016(result(outcome));
  },
  async receipt(input:Input&{commandId:unknown}):Promise<WorkbenchFollowReceipt>{
   return transactionP2016(pool,async tx=>{
    const c=await authorize(tx,input),id=uuidP2016(input.commandId),base={client_command_id:id,requested_item:c.requested};
    const row=(await tx.query<{state:string;result_snapshot:unknown;error_code:string;retryable:boolean}>(`SELECT state,result_snapshot,error_code,retryable FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND command_type=$3 AND actor_principal_id=$4::uuid AND source_intake_id=$5::uuid
      AND ticket_id IS NOT DISTINCT FROM $6::uuid AND review_id IS NOT DISTINCT FROM $7::uuid`,['P2_016:'+c.principal.principal_id,id,PURPOSE,c.principal.principal_id,c.requestedAnchor,c.requested.kind==='ticket'?c.requested.id:null,c.requested.kind==='review'?c.requested.id:null])).rows[0];
    if(!row)return publicP2016({...base,state:'UNKNOWN' as const});
    if(row.state==='FAILED')return publicP2016({...base,state:'FAILED' as const,error:{code:row.error_code,retryable:false as const}});
    if(row.state!=='COMMITTED')return publicP2016({...base,state:'UNKNOWN' as const});
    const value=result({...exactP2016(row.result_snapshot,['ok','client_command_id','requested_item','canonical_item','following','follow_version']),replayed:true});
    if(value.requested_item.kind!==c.requested.kind||value.requested_item.id!==c.requested.id)failP2016('NOT_FOUND',404);
    return publicP2016({...base,state:'COMMITTED' as const,result:value});
   });
  }
 });
}
