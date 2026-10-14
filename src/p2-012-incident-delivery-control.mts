import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {Incident} from '../contracts/p2_012_contracts.js';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {P2012IncidentQuery} from './p2-012-incident-query.mjs';
import type {IncidentDeliveryControlPermissionPort,IncidentDeliveryControlResult,IncidentDeliveryReceipt,IncidentDeliveryPermission,IncidentDeliveryStatus,IncidentDeliverySideEffect} from '../contracts/workbench_incident_delivery_control_contracts.js';
import type {IncidentDeliveryCapabilityV2} from '../contracts/workbench_incident_delivery_control_v2_contracts.js';
import {createCommunicationDeliveryOperatorPort,createCommunicationReconciliationPort} from './p2-004-communication-delivery-worker.mjs';
import {createIncidentPublicProgressAdmission} from './p2-012-public-progress-admission.mjs';
import {incidentDeliveryControlSchemaReady} from './p2-012-incident-delivery-schema.mjs';
import {allowedIncidentScopes,transaction,exact,uuid,version,hash,frozen,fail,ERROR_CODES,p2012HttpStatusForErrorCode} from './p2-012-domain-contracts.mjs';
import {WorkbenchError} from './p2-006-workbench-query.mjs';
type Action='retry'|'reconcile';
type Resolution='CONFIRMED_SENT'|'CONFIRMED_NOT_SENT_REQUEUE'|'CANCEL';
interface CommandV1 {client_command_id:string;expected_row_version:string;expected_status:string;expected_side_effect_state:string;reason_code:string;resolution:Resolution|null;incident_id:string;delivery_id:string;action:Action}
interface CommandV2 extends CommandV1 {expected_delivery_attempt_count:number}
type Command=CommandV1|CommandV2;
interface Binding {delivery_id:string;status:IncidentDeliveryStatus;side_effect_state:IncidentDeliverySideEffect;attempt_count:number;template_code:string;audience_type:string;sender_system_code:string;session_id:string|null}
interface Authority {principal:WorkbenchPrincipal;incident:Incident;binding:Binding}
interface ReceiptRow {id:string;command_hash:string;command_type:string;delivery_id:string;state:string;delivery_control_result:unknown;error_code:string|null;retryable:boolean|null}
interface Options {pool:PostgresPool;query:P2012IncidentQuery;enabled?:boolean;permissions?:IncidentDeliveryControlPermissionPort|null;externalSendEnabled?:boolean;publicProgressEnabled?:boolean;publicNoticeEnabled?:boolean;privateNoticeEnabled?:boolean;allowDispatcherCampus?:boolean}
const statuses=['PENDING','LEASED','SENDING','SENT','RECONCILIATION_REQUIRED','DEAD_LETTER','CANCELLED'],sides=['NOT_ATTEMPTED','ACKNOWLEDGED','UNKNOWN'];
const templates=['INCIDENT_CONFIRMED_GROUP','INCIDENT_CONFIRMED_DIRECT','INCIDENT_INVESTIGATING_DIRECT','INCIDENT_RESOLVED_GROUP','INCIDENT_RESOLVED_DIRECT','INCIDENT_CLOSED_DIRECT'];
const resolutions=['CONFIRMED_SENT','CONFIRMED_NOT_SENT_REQUEUE','CANCEL'];
function reason(input:unknown):string{if(typeof input!=='string'||!/^[A-Z0-9_]{1,128}$/u.test(input))fail();return input;}
export function normalizeIncidentDeliveryCommand(incidentId:unknown,deliveryId:unknown,action:unknown,body:unknown):Command{
 if(action!=='retry'&&action!=='reconcile')fail();
 const keys=['client_command_id','expected_row_version','expected_status','expected_side_effect_state','reason_code',...(action==='reconcile'?['resolution']:[])],v=exact(body,[...keys,'expected_delivery_attempt_count'],keys);
 if(action==='retry'&&(!['PENDING','DEAD_LETTER'].includes(v.expected_status as string)||v.expected_side_effect_state!=='NOT_ATTEMPTED')||action==='reconcile'&&(v.expected_status!=='RECONCILIATION_REQUIRED'||v.expected_side_effect_state!=='UNKNOWN'||!resolutions.includes(v.resolution as string)))fail();
 const base:CommandV1={client_command_id:uuid(v.client_command_id),expected_row_version:version(v.expected_row_version),expected_status:v.expected_status as string,expected_side_effect_state:v.expected_side_effect_state as string,reason_code:reason(v.reason_code),resolution:action==='reconcile'?v.resolution as Resolution:null,incident_id:uuid(incidentId),delivery_id:uuid(deliveryId),action};
 if(!Object.hasOwn(v,'expected_delivery_attempt_count'))return base;
 const attempt=v.expected_delivery_attempt_count;if(typeof attempt!=='number'||!Number.isInteger(attempt)||attempt<0||attempt>2147483647)fail();
 return {...base,expected_delivery_attempt_count:attempt};
}
function resultSnapshot(input:unknown,incidentId:string,deliveryId:string,commandId:string):IncidentDeliveryControlResult{
 const v=exact(input,['ok','incident_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']);
 if(v.ok!==true||v.replayed!==false||uuid(v.incident_id)!==incidentId||uuid(v.delivery_id)!==deliveryId||uuid(v.client_command_id)!==commandId||!statuses.includes(v.status as string)||!sides.includes(v.side_effect_state as string)||!Number.isInteger(v.attempt_count)||Number(v.attempt_count)<0||Number(v.attempt_count)>2147483647)fail('COMMAND_FAILED',503);
 return frozen({ok:true,incident_id:incidentId,delivery_id:deliveryId,client_command_id:commandId,status:v.status as IncidentDeliveryStatus,side_effect_state:v.side_effect_state as IncidentDeliverySideEffect,attempt_count:v.attempt_count as number,replayed:false});
}
export function createIncidentDeliveryControl({pool,query,enabled=false,permissions=null,externalSendEnabled=true,publicProgressEnabled=false,publicNoticeEnabled=false,privateNoticeEnabled=false,allowDispatcherCampus=false}:Options){
 async function lock(tx:PostgresTransaction){await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_012_COMMAND',0))");}
 const operator=createCommunicationDeliveryOperatorPort({pool}),reconciler=createCommunicationReconciliationPort({pool}),publicAdmission=createIncidentPublicProgressAdmission({enabled:publicProgressEnabled});
 const permission=(p:WorkbenchPrincipal,id:string,name:IncidentDeliveryPermission,tx:PostgresTransaction)=>permissions?.hasPermission({principal_id:p.principal_id,incident_id:id,permission:name,transaction:tx})??Promise.resolve(false);
 const role=(p:WorkbenchPrincipal,action:Action)=>action==='reconcile'?p.roles.includes('ADMIN'):p.roles.some(r=>r==='ADMIN'||r==='DISPATCHER');
 const scope=(p:WorkbenchPrincipal,incident:Incident)=>allowedIncidentScopes(p.roles,allowDispatcherCampus).includes(incident.confirmed_scope);
 async function bind(tx:PostgresTransaction,id:string,deliveryId:string,lock=false):Promise<Binding>{
  const row=(await tx.query<Binding>("SELECT d.id::text AS delivery_id,d.status,d.side_effect_state,d.attempt_count,b.template_code,b.audience_type,m.sender_system_code,m.session_id::text FROM communication.incident_notification_binding b JOIN incident.incident_event e ON e.id=b.incident_event_id AND e.incident_id=b.incident_id JOIN communication.message m ON m.id=b.communication_message_id JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_id=$1::uuid AND d.id=$2::uuid AND m.purpose='SYSTEM_NOTIFICATION' AND m.visibility='EXTERNAL'"+(lock?' FOR UPDATE OF d FOR SHARE OF b,e,m,o':''),[id,deliveryId])).rows[0];
  if(!row||row.session_id!==null||!statuses.includes(row.status)||!sides.includes(row.side_effect_state)||!Number.isInteger(row.attempt_count)||row.attempt_count<0||row.attempt_count>2147483647)fail('NOT_FOUND',404);
  if(row.template_code==='INCIDENT_PUBLIC_PROGRESS_DIRECT'?row.sender_system_code!=='INCIDENT_PUBLIC_PROGRESS'||row.audience_type!=='REPORTER_DIRECT':row.sender_system_code!=='HUMAN_CONFIRMED_INCIDENT'||!templates.includes(row.template_code)||row.audience_type!==(row.template_code.endsWith('_GROUP')?'GROUP':'REPORTER_DIRECT'))fail('NOT_FOUND',404);
  return row;
 }
 async function current(tx:PostgresTransaction,authContext:unknown,id:string,deliveryId:string,action:Action|null,lock=false):Promise<Authority>{
  const ctx=await query.resource({authContext,id,kind:'incident',tx,lock}),p=ctx.principal,incident=ctx.row as Incident;
  if(action&&(!role(p,action)||!scope(p,incident)||!await permission(p,id,action==='retry'?'INCIDENT_DELIVERY_RETRY':'INCIDENT_DELIVERY_RECONCILE',tx)))fail('FORBIDDEN',403);
  const binding=await bind(tx,id,deliveryId,lock);return {principal:p,incident,binding};
 }
 async function stable(tx:PostgresTransaction,authContext:unknown,id:string,deliveryId:string,action:Action|null):Promise<Authority>{
  const initial=await current(tx,authContext,id,deliveryId,action);
  await tx.query('SELECT id FROM pilot_ticket.pilot_principal WHERE id=$1::uuid FOR SHARE',[initial.principal.principal_id]);
  await tx.query('SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid FOR SHARE',[initial.principal.principal_id]);
  await tx.query('SELECT team_id FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid FOR SHARE',[initial.principal.principal_id]);
  return current(tx,authContext,id,deliveryId,action,true);
 }
 async function sendAdmission(tx:PostgresTransaction,ctx:Authority):Promise<boolean>{
  if(!externalSendEnabled)return false;
  const id=ctx.binding.delivery_id;
  if((await tx.query("SELECT 1 FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id JOIN communication.incident_notification_binding b ON b.communication_message_id=m.id JOIN incident.incident i ON i.id=b.incident_id WHERE d.id=$1::uuid AND i.retention_until_epoch_ms>platform.physical_epoch_ms() AND m.retention_until_epoch_ms>platform.physical_epoch_ms()",[id])).rowCount!==1)return false;
  if(ctx.binding.template_code==='INCIDENT_PUBLIC_PROGRESS_DIRECT')return publicProgressEnabled&&await publicAdmission({transaction:tx,deliveryId:id});
  if(ctx.binding.audience_type==='GROUP'){
   if(!publicNoticeEnabled)return false;
   return (await tx.query("SELECT 1 FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.incident_notification_binding b ON b.communication_message_id=o.message_id JOIN incident.incident_report r ON r.incident_id=b.incident_id AND r.origin_channel_leg_id=b.origin_channel_leg_id AND r.link_state='LINKED' JOIN intake.channel_leg l ON l.id=b.origin_channel_leg_id AND l.channel_identity_hash=b.audience_binding_hash JOIN intake.service_intake i ON i.id=l.source_intake_id WHERE d.id=$1::uuid AND b.audience_type='GROUP' AND l.leg_type IN ('GROUP_ORIGIN','GROUP_CONTINUATION') AND i.source_chat_type='group' AND d.provider='WECOM_AIBOT' AND d.target_type='GROUP' AND d.channel_account_id=i.source_bot_id AND d.target_id=i.source_chat_id FOR SHARE OF b,r,l,i",[id])).rows.length>=1;
  }
  if(!privateNoticeEnabled)return false;
  return (await tx.query("SELECT 1 FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.incident_notification_binding b ON b.communication_message_id=o.message_id JOIN incident.reporter_subscription s ON s.id=b.reporter_subscription_id AND s.incident_id=b.incident_id AND s.reporter_identity_hash=b.audience_binding_hash JOIN intake.channel_leg l ON l.id=s.direct_channel_leg_id AND l.reporter_identity_hash=s.reporter_identity_hash JOIN intake.contact_journey j ON j.id=l.journey_id AND j.reporter_identity_hash=l.reporter_identity_hash JOIN intake.service_intake i ON i.id=l.source_intake_id WHERE d.id=$1::uuid AND b.audience_type='REPORTER_DIRECT' AND s.status='ACTIVE' AND l.leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC') AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.source_chat_type='single' AND d.provider='WECOM_AIBOT' AND d.target_type='PERSON' AND d.channel_account_id=i.source_bot_id AND d.target_id=i.reporter_wecom_userid FOR SHARE OF b,s,l,j,i",[id])).rowCount===1;
 }
 async function capability({authContext,incidentId,deliveryId}:{authContext:unknown;incidentId:string;deliveryId:string}):Promise<IncidentDeliveryCapabilityV2>{
  const id=uuid(incidentId),delivery=uuid(deliveryId);
  return transaction(pool,async tx=>{await lock(tx);
   const ctx=await stable(tx,authContext,id,delivery,null),hasRetry=scope(ctx.principal,ctx.incident)&&role(ctx.principal,'retry')&&await permission(ctx.principal,id,'INCIDENT_DELIVERY_RETRY',tx),hasReconcile=scope(ctx.principal,ctx.incident)&&role(ctx.principal,'reconcile')&&await permission(ctx.principal,id,'INCIDENT_DELIVERY_RECONCILE',tx),disabled=!enabled||permissions===null||!await incidentDeliveryControlSchemaReady(tx);
   const retry=hasRetry&&!disabled&&['PENDING','DEAD_LETTER'].includes(ctx.binding.status)&&ctx.binding.side_effect_state==='NOT_ATTEMPTED'&&await sendAdmission(tx,ctx);
   return frozen({incident_id:id,delivery_id:delivery,attempt_count:ctx.binding.attempt_count,purpose:ctx.binding.template_code==='INCIDENT_PUBLIC_PROGRESS_DIRECT'?'INCIDENT_PUBLIC_PROGRESS':'INCIDENT_LIFECYCLE',retry,reconcile:hasReconcile&&!disabled&&ctx.binding.status==='RECONCILIATION_REQUIRED'&&ctx.binding.side_effect_state==='UNKNOWN',receipt_read:hasRetry||hasReconcile,disabled});
  });
 }
 async function receipt({authContext,incidentId,commandId}:{authContext:unknown;incidentId:string;commandId:string}):Promise<IncidentDeliveryReceipt>{
  const id=uuid(incidentId),command=uuid(commandId),base={incident_id:id,client_command_id:command};
  return transaction(pool,async tx=>{await lock(tx);
   const first=await query.resource({authContext,id,kind:'incident',tx}),p=first.principal,incident=first.row as Incident;
   if(!scope(p,incident)||!((role(p,'retry')&&await permission(p,id,'INCIDENT_DELIVERY_RETRY',tx))||(role(p,'reconcile')&&await permission(p,id,'INCIDENT_DELIVERY_RECONCILE',tx))))fail('FORBIDDEN',403);
   if(!await incidentDeliveryControlSchemaReady(tx))fail('DISABLED',503);
   const row=(await tx.query<ReceiptRow>("SELECT id::text,command_hash,command_type,delivery_id::text,state,delivery_control_result,error_code,retryable FROM incident.command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND actor_principal_id=$3::uuid AND incident_id=$4::uuid AND command_type IN ('DELIVERY_RETRY','DELIVERY_RECONCILE') FOR SHARE",['P2_012:'+p.principal_id,command,p.principal_id,id])).rows[0];
   if(!row){const again=await query.resource({authContext,id,kind:'incident',tx});if(!scope(again.principal,again.row as Incident)||!((role(again.principal,'retry')&&await permission(again.principal,id,'INCIDENT_DELIVERY_RETRY',tx))||(role(again.principal,'reconcile')&&await permission(again.principal,id,'INCIDENT_DELIVERY_RECONCILE',tx))))fail('FORBIDDEN',403);return frozen({...base,state:'UNKNOWN'});}
   await stable(tx,authContext,id,uuid(row.delivery_id),row.command_type==='DELIVERY_RETRY'?'retry':'reconcile');
   if(row.state==='COMMITTED')return frozen({...base,state:'COMMITTED',result:resultSnapshot(row.delivery_control_result,id,row.delivery_id,command)});
   if(row.state==='FAILED'&&row.error_code&&ERROR_CODES.includes(row.error_code)&&row.retryable===false)return frozen({...base,state:'FAILED',error:{code:row.error_code,retryable:false}});
   if(row.state!=='STARTED')fail('COMMAND_FAILED',503);return frozen({...base,state:'UNKNOWN'});
  });
 }
 async function perform({authContext,incidentId,deliveryId,action,body}:{authContext:unknown;incidentId:string;deliveryId:string;action:Action;body:unknown}):Promise<IncidentDeliveryControlResult>{
  if(!enabled)fail('DISABLED',503);const c=normalizeIncidentDeliveryCommand(incidentId,deliveryId,action,body);
  const outcome=await transaction(pool,async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_012_COMMAND',0))");
   let ctx=await stable(tx,authContext,c.incident_id,c.delivery_id,c.action);if(!await incidentDeliveryControlSchemaReady(tx))fail('DISABLED',503);
   const scopeKey='P2_012:'+ctx.principal.principal_id,digest=hash(c),type=c.action==='retry'?'DELIVERY_RETRY':'DELIVERY_RECONCILE';
   await tx.query("INSERT INTO incident.command_receipt(command_scope,client_command_id,command_hash,command_type,incident_id,actor_principal_id,expected_row_version,delivery_id,delivery_control_reason,delivery_control_resolution,expected_delivery_status,expected_delivery_side_effect_state) VALUES($1,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::bigint,$8::uuid,$9,$10,$11,$12) ON CONFLICT(command_scope,client_command_id) DO NOTHING",[scopeKey,c.client_command_id,digest,type,c.incident_id,ctx.principal.principal_id,c.expected_row_version,c.delivery_id,c.reason_code,c.resolution,c.expected_status,c.expected_side_effect_state]);
   const r=(await tx.query<ReceiptRow>('SELECT id::text,command_hash,command_type,delivery_id::text,state,delivery_control_result,error_code,retryable FROM incident.command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid FOR UPDATE',[scopeKey,c.client_command_id])).rows[0];if(!r)fail('COMMAND_FAILED',503);
   ctx=await current(tx,authContext,c.incident_id,c.delivery_id,c.action,true);
   if(r.command_hash!==digest||r.command_type!==type||r.delivery_id!==c.delivery_id)fail('COMMAND_CONFLICT',409);
   if(r.state==='COMMITTED')return {result:{...resultSnapshot(r.delivery_control_result,c.incident_id,c.delivery_id,c.client_command_id),replayed:true},error:null};
   if(r.state==='FAILED')return {result:null,error:r.error_code??'P2_012_COMMAND_FAILED'};
   if(r.state!=='STARTED')fail('COMMAND_FAILED',503);
   await tx.query('SAVEPOINT p2012_delivery_business');
   try{
    if(String(ctx.incident.row_version)!==c.expected_row_version)fail('VERSION_CONFLICT',409);
    // The legacy normalized command remains byte-identical for historical UUID receipts.
    // A new legacy UUID can prove only the initial delivery attempt; v2 binds its exact attempt in command_hash.
    const expectedAttempt='expected_delivery_attempt_count'in c?c.expected_delivery_attempt_count:c.expected_status==='PENDING'?0:1;
    if(ctx.binding.status!==c.expected_status||ctx.binding.side_effect_state!==c.expected_side_effect_state||ctx.binding.attempt_count!==expectedAttempt)fail('STATE_CONFLICT',409);
    if(c.action==='retry'||c.resolution==='CONFIRMED_NOT_SENT_REQUEUE'){if(!await sendAdmission(tx,ctx))fail('FORBIDDEN',403);}
    if(ctx.binding.attempt_count>=2147483647&&!(c.action==='retry'&&ctx.binding.status==='PENDING'))fail('STATE_CONFLICT',409);
    // Authorization after all permission, binding, catalog and destination waits.
    ctx=await current(tx,authContext,c.incident_id,c.delivery_id,c.action,true);
    const input={transaction:tx,deliveryId:c.delivery_id,authorized:true,reasonCode:c.reason_code};
    const controlled=c.action==='retry'?await operator.scheduleRetry(input):await reconciler.reconcileUnknownDelivery({...input,expectedStatus:'RECONCILIATION_REQUIRED',resolution:c.resolution as Resolution});
    if('ok'in controlled&&controlled.ok===false)fail('STATE_CONFLICT',409);
    const after=await bind(tx,c.incident_id,c.delivery_id),snapshot:IncidentDeliveryControlResult={ok:true,incident_id:c.incident_id,delivery_id:c.delivery_id,client_command_id:c.client_command_id,status:after.status,side_effect_state:after.side_effect_state,attempt_count:after.attempt_count,replayed:false};
    await tx.query("UPDATE incident.command_receipt SET state='COMMITTED',result_ref_type='INCIDENT',result_ref_id=incident_id,result_row_version=expected_row_version,delivery_control_result=$2::jsonb,updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid AND state='STARTED'",[r.id,snapshot]);
    await tx.query('RELEASE SAVEPOINT p2012_delivery_business');return {result:snapshot,error:null};
   }catch(error){
    await tx.query('ROLLBACK TO SAVEPOINT p2012_delivery_business');const candidate=error instanceof WorkbenchError?error.code:null,code=candidate&&ERROR_CODES.includes(candidate)?candidate:'P2_012_COMMAND_FAILED';
    await tx.query("UPDATE incident.command_receipt SET state='FAILED',error_code=$2,retryable=false,updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid",[r.id,code]);return {result:null,error:code};
   }
  });
  if(outcome.error||!outcome.result)throw new WorkbenchError(outcome.error??'P2_012_COMMAND_FAILED',p2012HttpStatusForErrorCode(outcome.error));
  return frozen(outcome.result);
 }
 return Object.freeze({capability,receipt,perform,ready:()=>enabled&&permissions!==null?incidentDeliveryControlSchemaReady(pool):Promise.resolve(!enabled)});
}
