import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {WorkbenchAuthorizationAdapter,WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {CommunicationDeliveryStatus,ProviderSideEffectState} from '../contracts/communication_contracts.js';
import type {DeliveryResolution} from './p2-006-workbench-delivery-control.mjs';
import {createCommunicationDeliveryOperatorPort,createCommunicationReconciliationPort} from './p2-004-communication-delivery-worker.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {failP2016} from './p2-016-domain-contracts.mjs';
import {conversationDeliveryReceiptSchemaReady} from './p2-006-delivery-command-schema.mjs';
import {WorkbenchError,WORKBENCH_ERROR_CODES} from './p2-006-workbench-query.mjs';
import type {ConversationDeliveryAcknowledgement} from '../contracts/workbench_conversation_delivery_control_contracts.js';

interface Input {authContext:unknown;deliveryId:string;clientCommandId:string;action:'retry'|'reconcile';reasonCode:string;resolution:DeliveryResolution|null}
interface Binding {delivery_id:string;session_id:string;status:CommunicationDeliveryStatus;side_effect_state:ProviderSideEffectState;attempt_count:number}
interface Context {principal:WorkbenchPrincipal;binding:Binding}
type Authorizer=Pick<WorkbenchAuthorizationAdapter,'resolvePrincipal'|'authorizeSession'|'isAdmin'>;
const statuses=['PENDING','LEASED','SENDING','SENT','RECONCILIATION_REQUIRED','DEAD_LETTER','CANCELLED'],sides=['NOT_ATTEMPTED','ACKNOWLEDGED','UNKNOWN'];
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function exact(value:unknown,keys:string[]):Record<string,unknown>{if(!record(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new WorkbenchError(WORKBENCH_ERROR_CODES.storageFailed,503);return value;}
function integer(value:unknown):value is number{return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647;}
function acknowledgement(value:unknown,input:Input,sessionId:string):ConversationDeliveryAcknowledgement{
 const v=exact(value,['ok','session_id','delivery_id','client_command_id','status','side_effect_state','attempt_count','replayed']);
 if(v.ok!==true||v.replayed!==false||v.session_id!==sessionId||v.delivery_id!==input.deliveryId||v.client_command_id!==input.clientCommandId||!statuses.includes(v.status as string)||!sides.includes(v.side_effect_state as string)||!integer(v.attempt_count))throw new WorkbenchError(WORKBENCH_ERROR_CODES.storageFailed,503);
 return {ok:true,session_id:sessionId,delivery_id:input.deliveryId,client_command_id:input.clientCommandId,status:v.status as CommunicationDeliveryStatus,side_effect_state:v.side_effect_state as ProviderSideEffectState,attempt_count:v.attempt_count,replayed:false};
}
export function createConversationDeliveryCommandPort({pool,authorize,enabled=false}:{pool:PostgresPool;authorize:Authorizer;enabled?:boolean}){
 if(typeof enabled!=='boolean')throw TypeError('Conversation delivery command configuration is invalid.');
 const ledger=createP2016CommandLedger({pool}),operator=createCommunicationDeliveryOperatorPort({pool}),reconciler=createCommunicationReconciliationPort({pool});
 async function current(tx:PostgresTransaction,input:Input,sessionId:string|null=null,lock=false):Promise<Context>{
  const principal=await authorize.resolvePrincipal(input.authContext,{queryable:tx});if(!principal)throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden,403);
  const binding=(await tx.query<Binding>("SELECT d.id::text AS delivery_id,m.session_id::text,d.status,d.side_effect_state,d.attempt_count FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id JOIN conversation.session s ON s.id=m.session_id WHERE d.id=$1::uuid AND m.visibility='EXTERNAL'"+(lock?' FOR UPDATE OF d FOR SHARE OF m,o':''),[input.deliveryId])).rows[0];
  if(!binding||sessionId!==null&&binding.session_id!==sessionId||!await authorize.authorizeSession({principal,sessionId:binding.session_id,action:'VIEW',queryable:tx}))throw new WorkbenchError(WORKBENCH_ERROR_CODES.notFound,404);
  if(input.action==='reconcile'?!authorize.isAdmin(principal):!await authorize.authorizeSession({principal,sessionId:binding.session_id,action:'DELIVERY_RETRY',queryable:tx}))throw new WorkbenchError(WORKBENCH_ERROR_CODES.forbidden,403);
  return {principal,binding};
 }
 async function stable(tx:PostgresTransaction,input:Input,sessionId:string):Promise<Context>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH',0))");
  const first=await current(tx,input,sessionId);
  await tx.query('SELECT id FROM pilot_ticket.pilot_principal WHERE id=$1::uuid FOR SHARE',[first.principal.principal_id]);
  await tx.query('SELECT role FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid FOR SHARE',[first.principal.principal_id]);
  await tx.query('SELECT team_id FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid FOR SHARE',[first.principal.principal_id]);
  await tx.query('SELECT id FROM conversation.session WHERE id=$1::uuid FOR SHARE',[sessionId]);
  await tx.query('SELECT session_id FROM conversation.assignment WHERE session_id=$1::uuid FOR SHARE',[sessionId]);
  await tx.query('SELECT t.id FROM pilot_ticket.ticket t JOIN conversation.session s ON s.service_intake_id=t.source_intake_id WHERE s.id=$1::uuid FOR SHARE OF t',[sessionId]);
  return current(tx,input,sessionId,true);
 }
 async function execute(input:Input):Promise<ConversationDeliveryAcknowledgement>{
  if(!enabled)throw new WorkbenchError(WORKBENCH_ERROR_CODES.disabled,503);
  const initial=await current(pool,input),sessionId=initial.binding.session_id;
  const command={client_command_id:input.clientCommandId,action:input.action,session_id:sessionId,delivery_id:input.deliveryId,reason_code:input.reasonCode,resolution:input.resolution};
  try{
   const result=await ledger.execute({
    command,receiptType:input.action==='retry'?'CONVERSATION_DELIVERY_RETRY':'CONVERSATION_DELIVERY_RECONCILE',
    authorize:async tx=>{const ctx=await stable(tx,input,sessionId);if(!await conversationDeliveryReceiptSchemaReady(tx))throw new WorkbenchError(WORKBENCH_ERROR_CODES.disabled,503);return ctx;},
    afterReceiptLock:tx=>current(tx,input,sessionId,true),
    run:async(tx,ctx)=>{
     if(!integer(ctx.binding.attempt_count)||ctx.binding.attempt_count===2147483647&&!(input.action==='retry'&&ctx.binding.status==='PENDING'))failP2016('DELIVERY_STATE_CONFLICT',409);
     const value=input.action==='retry'?await operator.scheduleRetry({deliveryId:input.deliveryId,authorized:true,reasonCode:input.reasonCode,transaction:tx}):await reconciler.reconcileUnknownDelivery({deliveryId:input.deliveryId,authorized:true,reasonCode:input.reasonCode,resolution:input.resolution as DeliveryResolution,expectedStatus:'RECONCILIATION_REQUIRED',transaction:tx});
     if('ok'in value)failP2016('DELIVERY_STATE_CONFLICT',409);
     const safe=acknowledgement({ok:true,session_id:sessionId,delivery_id:input.deliveryId,client_command_id:input.clientCommandId,status:value.status,side_effect_state:value.side_effect_state,attempt_count:value.attempt_count,replayed:false},input,sessionId);
     return {ok:true as const,reason_code:input.reasonCode,resolution:input.resolution,expected_delivery_attempt_count:ctx.binding.attempt_count,result:safe};
    },
   });
   if(!result.ok)throw new WorkbenchError(WORKBENCH_ERROR_CODES.versionConflict,409);
   const envelope=exact(result,['ok','reason_code','resolution','expected_delivery_attempt_count','result','replayed']);
   if(envelope.reason_code!==input.reasonCode||envelope.resolution!==input.resolution||!integer(envelope.expected_delivery_attempt_count)||typeof envelope.replayed!=='boolean')throw new WorkbenchError(WORKBENCH_ERROR_CODES.storageFailed,503);
   return Object.freeze({...acknowledgement(envelope.result,input,sessionId),replayed:envelope.replayed});
  }catch(error){if(error instanceof WorkbenchError&&error.code==='P2_016_COMMAND_CONFLICT')throw new WorkbenchError(WORKBENCH_ERROR_CODES.idempotencyMismatch,409);throw error;}
 }
 return Object.freeze({execute});
}
export type ConversationDeliveryCommandPort=ReturnType<typeof createConversationDeliveryCommandPort>;
