import type {CommunicationAuthorizationContext,SupplementReplyBindingPort,CommunicationSuccess} from './p2-004-communication-core.mjs';
import {CommunicationError,COMMUNICATION_ERROR_CODES} from './p2-004-communication-core.mjs';
import type {WorkbenchAuthorizationAdapter} from './p2-006-workbench-authorization.mjs';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {SupplementFollowUpCommand,SupplementFollowUpPage,SupplementFollowUpResult,SupplementFollowUpReceipt} from '../contracts/workbench_supplement_follow_up_contracts.js';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {exactP2016,uuidP2016,failP2016,hashP2016,transactionP2016,localP2016,limitP2016,cursorP2016,decodeCursorP2016} from './p2-016-domain-contracts.mjs';
import {supplementFollowUpSchemaReady} from '../scripts/workbench-supplement-follow-up-migrate.mjs';
const PURPOSE='WORKBENCH_SUPPLEMENT_FOLLOW_UP';
interface Material {source_intake_id:string;source_kind:'WEB'|'BOT';source_ref:string;revision:string;at:string;ordinal:string;source_id:string}
export function supplementRevision(value:unknown):string{if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/u.test(value)||BigInt(value)>9223372036854775807n)failP2016();return value;}
export function supplementTarget(value:unknown){const v=exactP2016(value,['source_ref','revision']);if(typeof v.source_ref!=='string'||!/^(?:channel:[1-9][0-9]{0,18}|web:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.test(v.source_ref))failP2016();if(v.source_ref.startsWith('channel:'))supplementRevision(v.source_ref.slice(8));return {source_ref:v.source_ref,revision:supplementRevision(v.revision)};}
export function supplementDispositionCommand(value:unknown):SupplementFollowUpCommand{const v=exactP2016(value,['client_command_id','action','source_ref','revision','disposition_note','mark_followed_up']);if(v.action!=='RECORD_DISPOSITION'||v.mark_followed_up!==true||typeof v.disposition_note!=='string'||!v.disposition_note.trim()||[...v.disposition_note].length>2000)failP2016();return {client_command_id:uuidP2016(v.client_command_id),action:'RECORD_DISPOSITION',...supplementTarget({source_ref:v.source_ref,revision:v.revision}),disposition_note:v.disposition_note,mark_followed_up:true};}
export function supplementDispositionAllowed(principal:{is_active:boolean;roles:readonly string[]}){return principal.is_active&&principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role));}
function dispositionResult(value:unknown):SupplementFollowUpResult{const v=exactP2016(value,['ok','client_command_id','ticket_id','source_ref','revision','follow_up_state','resolution_id','basis','replayed']);if(v.ok!==true||v.follow_up_state!=='FOLLOWED_UP'||v.basis!=='RECORDED_DISPOSITION'||typeof v.replayed!=='boolean')failP2016('ACTION_FAILED',503);return {ok:true,client_command_id:uuidP2016(v.client_command_id),ticket_id:uuidP2016(v.ticket_id),...supplementTarget({source_ref:v.source_ref,revision:v.revision}),follow_up_state:'FOLLOWED_UP',resolution_id:uuidP2016(v.resolution_id),basis:'RECORDED_DISPOSITION',replayed:v.replayed};}
interface Input {authContext:unknown;ticketId:unknown}
export function createWorkbenchSupplementFollowUp({pool,query,enabled=false}:{pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean}){
 if(typeof enabled!=='boolean')failP2016('FLAG_INVALID',503);const ledger=createP2016CommandLedger({pool});
 async function authorize(tx:PostgresTransaction,input:Input){if(!enabled)failP2016('NOT_FOUND',404);const c=await query.authorizedTicket({authContext:input.authContext,ticketId:input.ticketId,transaction:tx});if(!await supplementFollowUpSchemaReady(tx))failP2016('DISABLED',503);return {...c,scope:hashP2016([PURPOSE,c.principal.principal_id,[...c.principal.roles].sort(),[...c.principal.team_ids].sort(),c.ticket.id,c.ticket.resolver_team_id,c.ticket.assignee_id])};}
 type Context=Awaited<ReturnType<typeof authorize>>;
 function materials(c:Context){return {sql:`WITH readable AS (
  SELECT i.id FROM intake.service_intake i WHERE i.retention_until_epoch_ms>platform.physical_epoch_ms() AND (i.id=$1::uuid OR EXISTS(
   SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE l.source_intake_id=i.id AND j.linked_ticket_id=$2::uuid
    AND j.retention_until_epoch_ms>platform.physical_epoch_ms()))
 ), materials AS (
  SELECT i.id AS source_intake_id,'WEB'::text AS source_kind,'web:'||s.id::text AS source_ref,s.input_revision AS revision,s.received_at AS at,s.input_revision AS ordinal,s.id::text AS source_id
   FROM readable r JOIN intake.service_intake i ON i.id=r.id JOIN intake.web_request_binding b ON b.intake_id=i.id JOIN intake.web_submission s ON s.intake_id=i.id
   WHERE i.source_provider='YIXIAOXIU_WEB' AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms() AND s.kind='SUPPLEMENT' AND s.retention_until_epoch_ms>platform.physical_epoch_ms()
  UNION ALL
  SELECT i.id,'BOT','channel:'||m.id::text,rel.sequence_no,rel.linked_at,rel.sequence_no,m.id::text
   FROM readable r JOIN intake.service_intake i ON i.id=r.id JOIN intake.service_intake_message rel ON rel.intake_id=i.id JOIN channel.message_inbox m ON m.id=rel.channel_message_id
   WHERE i.source_provider='WECOM_AIBOT' AND m.retention_until_epoch_ms>platform.physical_epoch_ms() AND (rel.relation_type='SUPPLEMENT' OR (rel.relation_type='PRIMARY' AND EXISTS(
    SELECT 1 FROM intake.channel_leg later JOIN intake.channel_leg basis ON basis.journey_id=later.journey_id JOIN intake.contact_journey j ON j.id=later.journey_id
     WHERE later.source_intake_id=i.id AND basis.source_intake_id=$1::uuid AND later.leg_ordinal>basis.leg_ordinal AND j.linked_ticket_id=$2::uuid AND j.retention_until_epoch_ms>platform.physical_epoch_ms())))
 )`,values:[c.ticket.intake_id,c.ticket.id]};}
 async function material(tx:PostgresTransaction,c:Context,target:{source_ref:string;revision:string}):Promise<Material>{const m=materials(c);const row=(await tx.query<Material>(m.sql+` SELECT source_intake_id::text,source_kind,source_ref,revision::text,to_char(at,'YYYY-MM-DD HH24:MI:SS') AS at,ordinal::text,source_id
  FROM materials WHERE source_ref=$3 AND revision=$4::bigint`,[...m.values,target.source_ref,target.revision])).rows[0];if(!row)failP2016('NOT_FOUND',404);return row;}
 async function lockAuthority(tx:PostgresTransaction,c:Context,target:{source_ref:string;revision:string},actor=true){
  const found=await material(tx,c,target);await tx.query('SELECT id FROM intake.service_intake WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[[c.ticket.intake_id,found.source_intake_id]]);
  await tx.query(`SELECT j.id,l.id FROM intake.contact_journey j JOIN intake.channel_leg l ON l.journey_id=j.id WHERE l.source_intake_id=ANY($1::uuid[]) ORDER BY j.id,l.id FOR SHARE OF j,l`,[[c.ticket.intake_id,found.source_intake_id]]);
  await tx.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR SHARE',[c.ticket.id]);
  if(actor){await tx.query('SELECT id FROM pilot_ticket.pilot_principal WHERE id=$1::uuid FOR SHARE',[c.principal.principal_id]);
  await tx.query('SELECT principal_id,role FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid ORDER BY role FOR SHARE',[c.principal.principal_id]);
  await tx.query('SELECT m.principal_id,m.team_id FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team t ON t.team_id=m.team_id WHERE m.principal_id=$1::uuid ORDER BY m.team_id FOR SHARE OF m,t',[c.principal.principal_id]);}
  if(found.source_kind==='WEB')await tx.query(`SELECT s.id,b.intake_id FROM intake.web_submission s JOIN intake.web_request_binding b ON b.intake_id=s.intake_id WHERE s.id=$1::uuid FOR SHARE OF s,b`,[target.source_ref.slice(4)]);
  else await tx.query(`SELECT m.id,rel.channel_message_id FROM channel.message_inbox m JOIN intake.service_intake_message rel ON rel.channel_message_id=m.id WHERE m.id=$1::bigint AND rel.intake_id=$2::uuid FOR SHARE OF m,rel`,[target.source_ref.slice(8),found.source_intake_id]);
 }
 async function writable(tx:PostgresTransaction,input:Input,target:{source_ref:string;revision:string},lock=false){let c=await authorize(tx,input);await material(tx,c,target);if(lock){await lockAuthority(tx,c,target);c=await authorize(tx,input);await material(tx,c,target);}if(!supplementDispositionAllowed(c.principal))failP2016('FORBIDDEN',403);return c;}
 const evidence=`SELECT proof.id,proof.occurred_at,proof.basis FROM (
  SELECT d.id,d.occurred_at,'RECORDED_DISPOSITION'::text AS basis FROM pilot_ticket.workbench_supplement_disposition d JOIN pilot_ticket.ticket_command_receipt l ON l.id=d.command_receipt_id
   WHERE d.ticket_id=$2::uuid AND d.source_intake_id=m.source_intake_id AND d.source_kind=m.source_kind AND d.source_ref=m.source_ref AND d.revision=m.revision
    AND l.ticket_id=d.ticket_id AND l.actor_principal_id=d.actor_principal_id AND l.command_type='WORKBENCH_SUPPLEMENT_FOLLOW_UP' AND l.state='COMMITTED'
    AND l.command_scope='P2_016:'||d.actor_principal_id::text
  UNION ALL
  SELECT b.message_id,platform.local_from_epoch_ms(completed.epoch),'VERIFIED_REPLY' FROM pilot_ticket.workbench_supplement_reply_binding b
   JOIN communication.message msg ON msg.id=b.message_id JOIN communication.outbox outbox ON outbox.message_id=msg.id
   JOIN LATERAL (SELECT max(d.sent_epoch_ms) AS epoch FROM communication.delivery d WHERE d.outbox_id=outbox.id) completed ON completed.epoch IS NOT NULL
   WHERE b.ticket_id=$2::uuid AND b.source_intake_id=m.source_intake_id AND b.source_kind=m.source_kind AND b.source_ref=m.source_ref AND b.revision=m.revision
    AND msg.sender_kind='AGENT' AND msg.purpose='HUMAN_REPLY' AND msg.visibility='EXTERNAL' AND msg.idempotency_scope='AGENT'
    AND EXISTS(SELECT 1 FROM communication.delivery d WHERE d.outbox_id=outbox.id)
    AND NOT EXISTS(SELECT 1 FROM communication.delivery d WHERE d.outbox_id=outbox.id AND NOT (
     d.status='SENT' AND d.side_effect_state='ACKNOWLEDGED' AND d.sent_epoch_ms IS NOT NULL AND d.sent_epoch_ms>0 AND d.attempt_count>0
     AND EXISTS(SELECT 1 FROM communication.delivery_attempt a WHERE a.delivery_id=d.id AND a.attempt_no=d.attempt_count AND a.outcome='SENT' AND a.side_effect_state='ACKNOWLEDGED' AND a.completed_epoch_ms IS NOT NULL)))
 ) proof ORDER BY proof.occurred_at,proof.id LIMIT 1`;
 function replyBinding(authorization:WorkbenchAuthorizationAdapter):SupplementReplyBindingPort{
  function inputFor(context:Pick<CommunicationAuthorizationContext,'command'|'actor'>){const target=context.command.follow_up_target;if(!target||!context.actor?.principal_id)throw new CommunicationError(COMMUNICATION_ERROR_CODES.senderUnauthorized);return {input:{authContext:{principal_id:context.actor.principal_id},ticketId:target.ticket_id},target};}
  async function guarded<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(error){if(error instanceof CommunicationError)throw error;throw new CommunicationError(COMMUNICATION_ERROR_CODES.senderUnauthorized);}}
  return {
   prepare:context=>guarded(async()=>{const {input,target}=inputFor(context);const c=await writable(context.transaction,input,target);await lockAuthority(context.transaction,c,target,false);}),
   authorize:context=>guarded(async()=>{const {input,target}=inputFor(context);const c=await writable(context.transaction,input,target,true);
    const related=await context.transaction.query(`SELECT s.id FROM conversation.session s JOIN intake.service_intake i ON i.id=s.service_intake_id
     WHERE s.id=$1::uuid AND i.retention_until_epoch_ms>platform.physical_epoch_ms() AND (i.id=$2::uuid OR EXISTS(
      SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id WHERE j.linked_ticket_id=$3::uuid
       AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AND l.reporter_identity_hash=j.reporter_identity_hash AND i.reporter_wecom_userid=s.participant_key
       AND (l.conversation_session_id=s.id OR l.source_intake_id=s.service_intake_id) AND (l.conversation_thread_id=s.thread_id OR l.conversation_thread_id IS NULL)))`,[context.session.id,c.ticket.intake_id,c.ticket.id]);
    return related.rowCount===1&&await authorization.authorizeSession({principal:c.principal,sessionId:context.session.id,action:'REPLY',queryable:context.transaction});}),
   record:(context,result:CommunicationSuccess)=>guarded(async()=>{const {input,target}=inputFor(context);const c=await writable(context.transaction,input,target),source=await material(context.transaction,c,target);
    const old=(await context.transaction.query<{ticket_id:string;source_intake_id:string;source_kind:string;source_ref:string;revision:string}>('SELECT ticket_id::text,source_intake_id::text,source_kind,source_ref,revision::text FROM pilot_ticket.workbench_supplement_reply_binding WHERE message_id=$1::uuid',[result.message_id])).rows[0];
    if(result.replayed){if(!old||old.ticket_id!==target.ticket_id||old.source_intake_id!==source.source_intake_id||old.source_kind!==source.source_kind||old.source_ref!==target.source_ref||old.revision!==target.revision)throw new CommunicationError(COMMUNICATION_ERROR_CODES.commandConflict);return;}
    if(old)throw new CommunicationError(COMMUNICATION_ERROR_CODES.commandConflict);
    const row=await context.transaction.query(`INSERT INTO pilot_ticket.workbench_supplement_reply_binding(message_id,ticket_id,source_intake_id,source_kind,source_ref,revision)
     VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::bigint) RETURNING message_id`,[result.message_id,c.ticket.id,source.source_intake_id,source.source_kind,target.source_ref,target.revision]);if(row.rowCount!==1)throw new CommunicationError(COMMUNICATION_ERROR_CODES.storageFailed);
   })
  };
 }
 return Object.freeze({
  replyBinding,
  async authorizeReplyReceipt(input:{authContext:unknown;messageId:string}){return transactionP2016(pool,async tx=>{
   await tx.query('SET TRANSACTION READ ONLY');
   // An old host without 062 keeps its original unbound HUMAN_REPLY receipt path.
   // A real binding retains its exact purpose even when the new entry is OFF.
   if((await tx.query<{present:boolean}>("SELECT to_regclass('pilot_ticket.workbench_supplement_reply_binding') IS NOT NULL AS present")).rows[0]?.present!==true)return;
   const target=(await tx.query<{ticket_id:string;source_ref:string;revision:string}>('SELECT ticket_id::text,source_ref,revision::text FROM pilot_ticket.workbench_supplement_reply_binding WHERE message_id=$1::uuid',[uuidP2016(input.messageId)])).rows[0];
   if(target)await writable(tx,{authContext:input.authContext,ticketId:target.ticket_id},target);
  });},
  async summary(input:Input):Promise<{has_pending_supplements:boolean}>{return transactionP2016(pool,async tx=>{
   await tx.query('SET TRANSACTION READ ONLY');const c=await authorize(tx,input),m=materials(c);
   return {has_pending_supplements:(await tx.query<{pending:boolean}>(m.sql+` SELECT EXISTS(SELECT 1 FROM materials m WHERE NOT EXISTS(${evidence})) AS pending`,m.values)).rows[0]?.pending===true};
  });},
  ready:async()=>enabled&&await supplementFollowUpSchemaReady(pool),
  async page(input:Input&{limit?:unknown;cursor?:unknown}):Promise<SupplementFollowUpPage>{return transactionP2016(pool,async tx=>{
   await tx.query('SET TRANSACTION READ ONLY');const c=await authorize(tx,input),m=materials(c),n=limitP2016(input.limit??'50');
   const after=input.cursor?decodeCursorP2016(input.cursor,['scope','at','kind','intake','ordinal','source']):null;
   if(after&&(after.scope!==c.scope||(after.kind!=='WEB'&&after.kind!=='BOT')))failP2016('CURSOR_INVALID');
   const rows=(await tx.query<Material&{resolution_id:string|null;occurred_at:string|null;basis:'RECORDED_DISPOSITION'|'VERIFIED_REPLY'}>(m.sql+` SELECT m.source_intake_id::text,m.source_kind,m.source_ref,m.revision::text,to_char(m.at,'YYYY-MM-DD HH24:MI:SS') AS at,m.ordinal::text,m.source_id,
    e.id::text AS resolution_id,to_char(e.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at,e.basis FROM materials m LEFT JOIN LATERAL (${evidence}) e ON TRUE
    WHERE ($3::timestamp IS NULL OR (m.at,m.source_kind,m.source_intake_id,m.ordinal,m.source_id)>($3::timestamp,$4::text,$5::uuid,$6::bigint,$7::text))
    ORDER BY m.at,m.source_kind,m.source_intake_id,m.ordinal,m.source_id LIMIT $8`,[...m.values,after?localP2016(after.at):null,after?.kind??null,after?uuidP2016(after.intake):null,after?supplementRevision(after.ordinal):null,after?.source??null,n+1])).rows;
   const pending=(await tx.query<{pending:boolean}>(m.sql+` SELECT EXISTS(SELECT 1 FROM materials m WHERE NOT EXISTS(${evidence})) AS pending`,m.values)).rows[0]?.pending===true;
   const page=rows.slice(0,n),last=page.at(-1);return {ticket_id:c.ticket.id,items:page.map(row=>({source_ref:row.source_ref,source_kind:row.source_kind,revision:row.revision,...(row.resolution_id&&row.occurred_at?{follow_up_state:'FOLLOWED_UP' as const,resolution:{resolution_id:row.resolution_id,basis:row.basis,occurred_at:localP2016(row.occurred_at)}}:{follow_up_state:'PENDING' as const,resolution:null})})),has_pending_supplements:pending,next_cursor:rows.length>n&&last?cursorP2016({scope:c.scope,at:last.at,kind:last.source_kind,intake:last.source_intake_id,ordinal:last.ordinal,source:last.source_id}):null};
  });},
  async perform(input:Input&{command:unknown}):Promise<SupplementFollowUpResult>{const body=supplementDispositionCommand(input.command),ticketId=uuidP2016(input.ticketId),command={...body,action:PURPOSE,ticket_id:ticketId};
   const outcome=await ledger.execute({command,receiptType:PURPOSE,authorize:tx=>writable(tx,input,body),afterReceiptLock:tx=>writable(tx,input,body,true),run:async(tx)=>{
    const c=await writable(tx,input,body,true),source=await material(tx,c,body);
    const receipt=(await tx.query<{id:string}>(`SELECT id::text FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND command_type=$3 AND ticket_id=$4::uuid AND actor_principal_id=$5::uuid`,['P2_016:'+c.principal.principal_id,body.client_command_id,PURPOSE,ticketId,c.principal.principal_id])).rows[0];if(!receipt)failP2016('ACTION_FAILED',503);
    const row=(await tx.query<{id:string}>(`INSERT INTO pilot_ticket.workbench_supplement_disposition(command_receipt_id,ticket_id,source_intake_id,source_kind,source_ref,revision,actor_principal_id,disposition_note)
     VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::bigint,$7::uuid,$8) RETURNING id::text`,[receipt.id,ticketId,source.source_intake_id,source.source_kind,body.source_ref,body.revision,c.principal.principal_id,body.disposition_note])).rows[0];if(!row)failP2016('ACTION_FAILED',503);
    await writable(tx,input,body);return {ok:true as const,client_command_id:body.client_command_id,ticket_id:ticketId,source_ref:body.source_ref,revision:body.revision,follow_up_state:'FOLLOWED_UP' as const,resolution_id:row.id,basis:'RECORDED_DISPOSITION' as const};
   }});
   if(outcome.ok!==true){const code=outcome.error.code.replace(/^P2_016_/,'');failP2016(code,code==='NOT_FOUND'?404:code==='FORBIDDEN'?403:code==='DISABLED'||code==='ACTION_FAILED'?503:409);}return dispositionResult(outcome);
  },
  async receipt(input:Input&{commandId:unknown}):Promise<SupplementFollowUpReceipt>{return transactionP2016(pool,async tx=>{
   await tx.query('SET TRANSACTION READ ONLY');const c=await authorize(tx,input),id=uuidP2016(input.commandId),base={client_command_id:id,ticket_id:c.ticket.id};
   const row=(await tx.query<{state:string;result_snapshot:unknown;source_ref:string|null;revision:string|null;error_code:string;retryable:boolean}>(`SELECT l.state,l.result_snapshot,d.source_ref,d.revision::text,l.error_code,l.retryable
    FROM pilot_ticket.ticket_command_receipt l LEFT JOIN pilot_ticket.workbench_supplement_disposition d ON d.command_receipt_id=l.id WHERE l.command_scope=$1 AND l.client_command_id=$2::uuid AND l.command_type=$3 AND l.ticket_id=$4::uuid AND l.actor_principal_id=$5::uuid`,['P2_016:'+c.principal.principal_id,id,PURPOSE,c.ticket.id,c.principal.principal_id])).rows[0];
   if(!row)return {...base,state:'UNKNOWN'};if(row.source_ref&&row.revision)await material(tx,c,{source_ref:row.source_ref,revision:row.revision});
   if(row.state==='COMMITTED'){if(!row.source_ref||!row.revision)failP2016('ACTION_FAILED',503);return {...base,state:'COMMITTED',result:{...dispositionResult({...exactP2016(row.result_snapshot,['ok','client_command_id','ticket_id','source_ref','revision','follow_up_state','resolution_id','basis']),replayed:true}),replayed:true as const}};}
   if(row.state==='FAILED'&&row.retryable===false&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(row.error_code))return {...base,state:'FAILED',error:{code:row.error_code,retryable:false}};return {...base,state:'UNKNOWN'};
  });}
 });
}
type HttpContext=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
export function createWorkbenchSupplementFollowUpHttp(port:ReturnType<typeof createWorkbenchSupplementFollowUp>,enabled=false){return {async handler({request,response,url,authContext,json,readJson,validateWriteRequest}:HttpContext){
 const route=/^\/api\/tickets\/([a-f0-9-]{36})\/supplement-follow-up(?:\/commands\/([a-f0-9-]{36}))?$/iu.exec(url.pathname);if(!route)return false;if(!enabled)failP2016('NOT_FOUND',404);
 const names=[...url.searchParams.keys()];if(new Set(names).size!==names.length||names.some(key=>!['limit','cursor'].includes(key))||(route[2]&&names.length))failP2016();
 if(request.method==='GET'){json(response,200,route[2]?await port.receipt({authContext,ticketId:route[1],commandId:route[2]}):await port.page({authContext,ticketId:route[1],limit:url.searchParams.get('limit'),cursor:url.searchParams.get('cursor')}));return true;}
 if(request.method!=='POST'||route[2])failP2016('NOT_FOUND',404);if(names.length)failP2016();const body=await readJson(request);validateWriteRequest(request,authContext,body,{sessionMutation:false});json(response,200,await port.perform({authContext,ticketId:route[1],command:body}));return true;
 }};}
