import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createP2016ManualReviewFacade} from './p2-016-manual-review-facade.mjs';
import type {WorkbenchCard} from '../contracts/web01_workbench_contracts.js';
import type {FollowItem,WorkbenchFollowCommand,WorkbenchFollowAttention,WorkbenchFollowResult,WorkbenchFollowReceipt} from '../contracts/workbench_item_follow_contracts.js';
import {createWeb01WorkbenchQuery} from './web01-workbench-query.mjs';
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
interface Anchor {id:string;following:boolean;row_version:string}
export interface FollowProjectionPort {ready():Promise<boolean>;attention(input:Input,item:WorkbenchCard,reasons:readonly ('HANDLING'|'COMMUNICATION')[]):Promise<WorkbenchFollowAttention>}
export function createWorkbenchFollow({pool,query,reviews,manualReviewEnabled=false,manualReportsEnabled=false,enabled=false}:{pool:PostgresPool;query:P2016TicketQuery;reviews:Pick<ReturnType<typeof createP2016ManualReviewFacade>,'canonicalItem'>;manualReviewEnabled?:boolean;manualReportsEnabled?:boolean;enabled?:boolean}){
 if(typeof enabled!=='boolean')failP2016('FLAG_INVALID',503);
 const ledger=createP2016CommandLedger({pool});
 async function ready(){return enabled&&await followSchemaReady(pool);}
 async function authorize(tx:PostgresTransaction,input:Input){
  guardP2016(enabled);if(!await followSchemaReady(tx))failP2016('DISABLED',503);
  const requested=followItem({kind:input.kind,id:input.id}),principal=await query.principal(input.authContext,tx);
  const scoped={...query,principal:(auth:unknown,transaction:PostgresTransaction=tx)=>query.principal(auth,transaction)};
  const canonicalReviews={canonicalItem:(v:Parameters<typeof reviews.canonicalItem>[0])=>reviews.canonicalItem({...v,transaction:tx})};
  const base=createWeb01WorkbenchQuery({pool:tx,query:scoped,manualReviewEnabled,manualReportsEnabled,reviews:canonicalReviews});
  if(requested.kind==='review')await canonicalReviews.canonicalItem({authContext:input.authContext,reviewId:requested.id});
  const item=await base.authorizedItem(input.authContext,requested.kind,requested.id),canonical=followItem({kind:item.kind,id:item.id});
  const source=(await tx.query<{id:string}>(requested.kind==='ticket'
   ?'SELECT source_intake_id::text AS id FROM pilot_ticket.ticket WHERE id=$1::uuid'
   :requested.kind==='review'?'SELECT service_intake_id::text AS id FROM intake.manual_review_item WHERE id=$1::uuid'
   :'SELECT id::text FROM intake.service_intake WHERE id=$1::uuid',[requested.id])).rows[0];
  if(!source)failP2016('NOT_FOUND',404);
  const anchors=(await tx.query<Anchor>(`SELECT i.id::text,COALESCE(f.following,false) AS following,COALESCE(f.row_version,0)::text AS row_version
    FROM intake.service_intake i LEFT JOIN pilot_ticket.workbench_item_follow f ON f.source_intake_id=i.id AND f.principal_id=$1::uuid
    WHERE i.id=$2::uuid OR ($3='ticket' AND i.retention_until>platform.local_now() AND (
      EXISTS(SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE l.source_intake_id=i.id AND j.linked_ticket_id=$4::uuid AND j.retention_until_epoch_ms>platform.physical_epoch_ms())
      OR EXISTS(SELECT 1 FROM intake.manual_review_item r JOIN intake.contact_journey j ON j.id=r.journey_id WHERE r.service_intake_id=i.id AND r.linked_ticket_id=$4::uuid AND j.retention_until_epoch_ms>platform.physical_epoch_ms())))
    ORDER BY i.id LIMIT 101`,[principal.principal_id,item.intake_id,canonical.kind,canonical.id])).rows;
  if(!anchors.length||anchors.length>100)failP2016('ACTION_FAILED',503);
  return {principal,requested,canonical,item,requestedAnchor:source.id,anchors};
 }
 type Context=Awaited<ReturnType<typeof authorize>>;
 const token=(c:Context)=>hashP2016([1,c.principal.principal_id,c.canonical,c.anchors.map(a=>[a.id,a.following,a.row_version])]);
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
  async attention(input:Input,item:WorkbenchCard,reasons:readonly ('HANDLING'|'COMMUNICATION')[]):Promise<WorkbenchFollowAttention>{
   const c=await authorize(pool,input);if(c.canonical.kind!==item.kind||c.canonical.id!==item.id)failP2016('VERSION_CONFLICT',409);
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
