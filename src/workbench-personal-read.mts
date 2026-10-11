import type {IncomingMessage} from 'node:http';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createP2016ManualReviewFacade} from './p2-016-manual-review-facade.mjs';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {CanonicalItem} from '../contracts/workbench_review_contracts.js';
import type {PersonalReadCommand,PersonalReadPage,PersonalReadPosition,PersonalReadAcknowledgement,PersonalReadReceipt,PersonalReadSourceKind} from '../contracts/workbench_personal_read_contracts.js';
import {createWeb01WorkbenchQuery} from './web01-workbench-query.mjs';
import {failP2016,guardP2016,uuidP2016,exactP2016,hashP2016,transactionP2016,cursorP2016,decodeCursorP2016,limitP2016} from './p2-016-domain-contracts.mjs';
import {personalReadSchemaReady} from '../scripts/workbench-personal-read-migrate.mjs';
import {readManualReportSource} from './workbench-manual-report-source.mjs';

interface Options {pool:PostgresPool;query:P2016TicketQuery;reviews:Pick<ReturnType<typeof createP2016ManualReviewFacade>,'canonicalItem'>;manualReviewEnabled:boolean;manualSourceEnabled?:boolean;enabled?:boolean}
interface ItemInput {authContext:unknown;kind:unknown;id:unknown}
interface SourceRow {intake_id:string;source_kind:PersonalReadSourceKind;latest_position:string;last_read_position:string;row_version:string}
const PURPOSE='WORKBENCH_PERSONAL_READ';
export function personalReadRevision(value:unknown,zero=false):string{
  if(typeof value!=='string'||!(zero?/^(?:0|[1-9][0-9]{0,18})$/u:/^[1-9][0-9]{0,18}$/u).test(value)||BigInt(value)>9223372036854775807n)failP2016();return value;
}
export function personalReadCommand(value:unknown):PersonalReadCommand{
  const v=exactP2016(value,['client_command_id','source_ref','revision']);
  if(typeof v.source_ref!=='string'||!/^(?:channel:[1-9][0-9]{0,18}|(?:web|manual):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.test(v.source_ref))failP2016();
  if(v.source_ref.startsWith('channel:'))personalReadRevision(v.source_ref.slice(8));
  return {client_command_id:uuidP2016(v.client_command_id),source_ref:v.source_ref,revision:personalReadRevision(v.revision)};
}
function acknowledgement(value:unknown):PersonalReadAcknowledgement{
  const v=exactP2016(value,['ok','client_command_id','source_key','source_kind','last_read_position','row_version','replayed']);
  if(v.ok!==true||(v.source_kind!=='WEB'&&v.source_kind!=='MANUAL'&&v.source_kind!=='BOT')||typeof v.source_key!=='string'||!/^[a-f0-9]{64}$/u.test(v.source_key)||typeof v.replayed!=='boolean')failP2016('ACTION_FAILED',503);
  return {ok:true,client_command_id:uuidP2016(v.client_command_id),source_key:v.source_key,source_kind:v.source_kind,last_read_position:personalReadRevision(v.last_read_position),row_version:personalReadRevision(v.row_version),replayed:v.replayed};
}
const sourceKey=(kind:PersonalReadSourceKind,intakeId:string)=>hashP2016([PURPOSE,kind,intakeId]);
export function createWorkbenchPersonalRead({pool,query,reviews,manualReviewEnabled,manualSourceEnabled=false,enabled=false}:Options){
  if(typeof enabled!=='boolean')failP2016('FLAG_INVALID',503);
  async function authorize(tx:PostgresTransaction,input:ItemInput){
    if(!['ticket','review','intake'].includes(String(input.kind)))failP2016();
    const kind=input.kind as CanonicalItem['kind'],id=uuidP2016(input.id),principal=await query.principal(input.authContext,tx);
    const scopedQuery={...query,principal:(authContext:unknown,transaction:PostgresTransaction=tx)=>query.principal(authContext,transaction)};
    const scopedReviews={canonicalItem:(value:Parameters<typeof reviews.canonicalItem>[0])=>reviews.canonicalItem({...value,transaction:tx})};
    const workbench=createWeb01WorkbenchQuery({pool:tx,query:scopedQuery,manualReviewEnabled,reviews:manualReviewEnabled?scopedReviews:null});
    const item=await workbench.authorizedItem(input.authContext,kind,id);
    let intakeId=item.intake_id;
    if(kind==='review'){
      // The original Review must still be authorized before following its canonical navigation.
      await reviews.canonicalItem({authContext:input.authContext,reviewId:id,transaction:tx});
      intakeId=(await tx.query<{id:string}>('SELECT service_intake_id::text AS id FROM intake.manual_review_item WHERE id=$1::uuid',[id])).rows[0]?.id??failP2016('NOT_FOUND',404);
    }
    const scope=hashP2016([principal.principal_id,[...principal.roles].sort(),[...principal.team_ids].sort(),kind,id]);
    return {principal,kind,id,intakeId,canonical:{kind:item.kind,id:item.id} as CanonicalItem,scope};
  }
  type Authorized=Awaited<ReturnType<typeof authorize>>;
  function readable(c:Authorized){return {sql:`WITH readable AS (
    SELECT i.id FROM intake.service_intake i WHERE i.retention_until>platform.local_now() AND (
      i.id=$1::uuid OR ($2='ticket' AND EXISTS(SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id
        JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id WHERE l.source_intake_id=i.id AND j.linked_ticket_id=$3::uuid
        AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AND ($4::boolean OR t.assignee_id=$5::uuid OR t.resolver_team_id=ANY($6::text[]))))
    )
  )`,values:[c.intakeId,c.kind,c.canonical.id,c.principal.roles.some(role=>role==='ADMIN'||role==='DISPATCHER'),c.principal.principal_id,c.principal.roles.includes('HANDLER')?c.principal.team_ids:[]]};}
  async function sources(tx:PostgresTransaction,c:Authorized,after:{kind:PersonalReadSourceKind;id:string}|null=null,n=100):Promise<SourceRow[]>{
    const r=readable(c);
    const rows=(await tx.query<SourceRow>(r.sql+`, coordinates AS (
      SELECT i.id AS intake_id,'WEB'::text AS source_kind,max(s.input_revision) AS latest_position
      FROM readable r JOIN intake.service_intake i ON i.id=r.id JOIN intake.web_request_binding b ON b.intake_id=i.id
      JOIN intake.web_submission s ON s.intake_id=i.id AND s.retention_until>platform.local_now()
      WHERE i.source_provider='YIXIAOXIU_WEB' AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
      GROUP BY i.id
      UNION ALL SELECT i.id,'MANUAL',1::bigint FROM readable r JOIN intake.service_intake i ON i.id=r.id
        WHERE $7::boolean AND i.source_provider='STAFF_MANUAL_REPORT' AND i.manual_report_snapshot IS NOT NULL
      UNION ALL SELECT i.id,'BOT',max(rel.sequence_no)::bigint FROM readable r JOIN intake.service_intake i ON i.id=r.id
        JOIN intake.service_intake_message rel ON rel.intake_id=i.id JOIN channel.message_inbox m ON m.id=rel.channel_message_id
        WHERE i.source_provider='WECOM_AIBOT' AND m.retention_until>platform.local_now() GROUP BY i.id
    ) SELECT c.intake_id::text,c.source_kind,c.latest_position::text,
      COALESCE(p.last_read_position,0)::text AS last_read_position,COALESCE(p.row_version,0)::text AS row_version
      FROM coordinates c LEFT JOIN pilot_ticket.personal_material_read_position p ON p.principal_id=$5::uuid AND p.source_kind=c.source_kind AND p.source_intake_id=c.intake_id
      WHERE ($8::text IS NULL OR (c.source_kind,c.intake_id)>($8::text,$9::uuid)) ORDER BY c.source_kind,c.intake_id LIMIT $10`,[...r.values,manualSourceEnabled,after?.kind??null,after?.id??null,n+1])).rows;
    for(const row of rows)if(row.source_kind==='MANUAL'&&!await readManualReportSource(tx,row.intake_id))failP2016('NOT_FOUND',404);
    return rows;
  }
  async function material(tx:PostgresTransaction,c:Authorized,command:PersonalReadCommand){
    const r=readable(c);
    if(command.source_ref.startsWith('channel:')){
      const row=(await tx.query<{intake_id:string}>(r.sql+`SELECT i.id::text AS intake_id FROM readable r JOIN intake.service_intake i ON i.id=r.id
        JOIN intake.service_intake_message rel ON rel.intake_id=i.id JOIN channel.message_inbox m ON m.id=rel.channel_message_id
        WHERE i.source_provider='WECOM_AIBOT' AND m.retention_until>platform.local_now() AND m.id=$7::bigint AND rel.sequence_no=$8::bigint
        FOR SHARE OF i,rel,m`,[...r.values,command.source_ref.slice(8),command.revision])).rows[0];
      if(!row)failP2016('NOT_FOUND',404);return {intakeId:row.intake_id,kind:'BOT' as const};
    }
    if(command.source_ref.startsWith('manual:')){
      if(!manualSourceEnabled||command.revision!=='1')failP2016('NOT_FOUND',404);
      const row=(await tx.query<{intake_id:string}>(r.sql+`SELECT i.id::text AS intake_id FROM readable r JOIN intake.service_intake i ON i.id=r.id
        WHERE i.id=$7::uuid AND i.source_provider='STAFF_MANUAL_REPORT' AND i.manual_report_snapshot IS NOT NULL FOR SHARE OF i`,[...r.values,command.source_ref.slice(7)])).rows[0];
      if(!row||!await readManualReportSource(tx,row.intake_id))failP2016('NOT_FOUND',404);return {intakeId:row.intake_id,kind:'MANUAL' as const};
    }
    const row=(await tx.query<{intake_id:string}>(r.sql+`SELECT i.id::text AS intake_id FROM readable r JOIN intake.service_intake i ON i.id=r.id
      JOIN intake.web_request_binding b ON b.intake_id=i.id JOIN intake.web_submission s ON s.intake_id=i.id
      WHERE i.source_provider='YIXIAOXIU_WEB' AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
        AND s.retention_until>platform.local_now() AND s.id=$7::uuid AND s.input_revision=$8::bigint
      FOR SHARE OF i,b,s`,[...r.values,command.source_ref.slice(4),command.revision])).rows[0];
    if(!row)failP2016('NOT_FOUND',404);return {intakeId:row.intake_id,kind:'WEB' as const};
  }
  async function ready(tx:PostgresTransaction){if(!await personalReadSchemaReady(tx))failP2016('ACTION_FAILED',503);}
  return Object.freeze({
    async page(input:ItemInput&{cursor?:unknown;limit?:unknown}):Promise<PersonalReadPage>{
      guardP2016(enabled);return transactionP2016(pool,async tx=>{
        await tx.query('SET TRANSACTION READ ONLY');await ready(tx);const c=await authorize(tx,input),n=limitP2016(input.limit??'50');
        const cursor=input.cursor?decodeCursorP2016(input.cursor,['scope','after_kind','after_id']):null;
        if(cursor&&cursor.scope!==c.scope)failP2016('CURSOR_INVALID');
        if(cursor&&cursor.after_kind!=='WEB'&&cursor.after_kind!=='MANUAL'&&cursor.after_kind!=='BOT')failP2016('CURSOR_INVALID');
        const rows=await sources(tx,c,cursor?{kind:cursor.after_kind as PersonalReadSourceKind,id:uuidP2016(cursor.after_id)}:null,n),visible=rows.slice(0,n),last=visible.at(-1);
        const positions:PersonalReadPosition[]=visible.map(row=>({source_key:sourceKey(row.source_kind,row.intake_id),source_kind:row.source_kind,last_read_position:personalReadRevision(row.last_read_position,true),latest_position:personalReadRevision(row.latest_position),row_version:personalReadRevision(row.row_version,true),has_unread_material:BigInt(row.latest_position)>BigInt(row.last_read_position)}));
        return {canonical_item:c.canonical,sources:positions,next_cursor:rows.length>n&&last?cursorP2016({scope:c.scope,after_kind:last.source_kind,after_id:last.intake_id}):null};
      });
    },
    async perform(input:ItemInput&{command:unknown}):Promise<PersonalReadAcknowledgement>{
      guardP2016(enabled);const command=personalReadCommand(input.command);
      return transactionP2016(pool,async tx=>{
        await ready(tx);const c=await authorize(tx,input),{intakeId,kind}=await material(tx,c,command),scope=PURPOSE+':'+c.principal.principal_id;
        const hash=hashP2016({purpose:PURPOSE,principal:c.principal.principal_id,intake_id:intakeId,...command});
        await tx.query(`INSERT INTO pilot_ticket.ticket_command_receipt(command_scope,client_command_id,command_hash,command_type,source_intake_id,actor_principal_id)
          VALUES($1,$2::uuid,$3,$4,$5::uuid,$6::uuid) ON CONFLICT(command_scope,client_command_id) DO NOTHING`,[scope,command.client_command_id,hash,PURPOSE,intakeId,c.principal.principal_id]);
        const receipt=(await tx.query<{id:string;command_hash:string;state:string;result_snapshot:unknown}>(`SELECT id::text,command_hash,state,result_snapshot FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid FOR UPDATE`,[scope,command.client_command_id])).rows[0];
        if(!receipt)failP2016('ACTION_FAILED',503);if(receipt.command_hash!==hash)failP2016('COMMAND_CONFLICT',409);
        if(receipt.state==='COMMITTED')return {...acknowledgement(receipt.result_snapshot),replayed:true};
        const row=(await tx.query<{position:string;version:string}>(`INSERT INTO pilot_ticket.personal_material_read_position(principal_id,source_kind,source_intake_id,last_read_position)
          VALUES($1::uuid,$4,$2::uuid,$3::bigint) ON CONFLICT(principal_id,source_kind,source_intake_id) DO UPDATE SET
          last_read_position=GREATEST(personal_material_read_position.last_read_position,EXCLUDED.last_read_position),
          row_version=personal_material_read_position.row_version+CASE WHEN EXCLUDED.last_read_position>personal_material_read_position.last_read_position THEN 1 ELSE 0 END,
          updated_at=CASE WHEN EXCLUDED.last_read_position>personal_material_read_position.last_read_position THEN platform.local_now() ELSE personal_material_read_position.updated_at END
          RETURNING last_read_position::text AS position,row_version::text AS version`,[c.principal.principal_id,intakeId,command.revision,kind])).rows[0];
        if(!row)failP2016('ACTION_FAILED',503);
        const result:PersonalReadAcknowledgement={ok:true,client_command_id:command.client_command_id,source_key:sourceKey(kind,intakeId),source_kind:kind,last_read_position:row.position,row_version:row.version,replayed:false};
        await tx.query(`UPDATE pilot_ticket.ticket_command_receipt SET state='COMMITTED',result_snapshot=$2::jsonb,updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid`,[receipt.id,JSON.stringify(result)]);
        return result;
      });
    },
    async receipt(input:ItemInput&{commandId:unknown}):Promise<PersonalReadReceipt>{
      guardP2016(enabled);return transactionP2016(pool,async tx=>{
        await tx.query('SET TRANSACTION READ ONLY');await ready(tx);const c=await authorize(tx,input),commandId=uuidP2016(input.commandId),r=readable(c);
        const receipt=(await tx.query<{result_snapshot:unknown}>(r.sql+`SELECT l.result_snapshot FROM pilot_ticket.ticket_command_receipt l JOIN readable r ON r.id=l.source_intake_id
          JOIN intake.service_intake i ON i.id=r.id LEFT JOIN intake.web_request_binding b ON b.intake_id=r.id
          WHERE l.command_scope=$7 AND l.client_command_id=$8::uuid AND l.actor_principal_id=$5::uuid AND l.command_type=$9 AND l.state='COMMITTED'
            AND ((i.source_provider='YIXIAOXIU_WEB' AND b.revoked_at IS NULL AND b.retention_until>platform.local_now())
              OR ($10::boolean AND i.source_provider='STAFF_MANUAL_REPORT' AND i.manual_report_snapshot IS NOT NULL)
              OR (i.source_provider='WECOM_AIBOT' AND EXISTS(SELECT 1 FROM intake.service_intake_message rel JOIN channel.message_inbox m ON m.id=rel.channel_message_id WHERE rel.intake_id=i.id AND m.retention_until>platform.local_now())))`,[...r.values,PURPOSE+':'+c.principal.principal_id,commandId,PURPOSE,manualSourceEnabled])).rows[0];
        return receipt?{client_command_id:commandId,state:'COMMITTED',result:{...acknowledgement(receipt.result_snapshot),replayed:true}}:{client_command_id:commandId,state:'UNKNOWN'};
      });
    },
  });
}
type HttpContext=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
async function readBody(request:IncomingMessage):Promise<Record<string,unknown>>{
  if(typeof request.headers['content-type']!=='string'||request.headers['content-type'].split(';',1)[0]?.trim().toLowerCase()!=='application/json')failP2016('CONTENT_TYPE_INVALID',415);
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of request){const current=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=current.length;if(bytes>8192)failP2016('BODY_TOO_LARGE',413);chunks.push(current);}
  try{return exactP2016(JSON.parse(Buffer.concat(chunks).toString('utf8')),['client_command_id','source_ref','revision']);}catch{failP2016();}
}
export function createWorkbenchPersonalReadHttp(service:ReturnType<typeof createWorkbenchPersonalRead>,enabled=false){
  return async({request,response,url,authContext,json,validateWriteRequest}:HttpContext)=>{
    const path=/^\/api\/workbench\/items\/(ticket|review|intake)\/([0-9a-f-]{36})\/read-position(?:\/commands\/([0-9a-f-]{36}))?$/iu.exec(url.pathname);
    if(!path)return false;guardP2016(enabled);const input={authContext,kind:path[1],id:path[2]};
    const allowed=request.method==='GET'&&!path[3]?['limit','cursor']:[];
    if([...url.searchParams.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>url.searchParams.getAll(key).length>1))failP2016();
    if(request.method==='GET'){json(response,200,path[3]?await service.receipt({...input,commandId:path[3]}):await service.page({...input,limit:url.searchParams.get('limit'),cursor:url.searchParams.get('cursor')}));return true;}
    if(request.method==='POST'&&!path[3]){const body=await readBody(request);validateWriteRequest(request,authContext,body,{sessionMutation:false});json(response,200,await service.perform({...input,command:body}));return true;}
    failP2016('NOT_FOUND',404);
  };
}
