import {createHmac} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {YxxMemberScope,YxxMemberFlags} from './yxx-self-service-authorization.mjs';
import type {YxxFeedbackInput,YxxFeedbackContext,YxxFeedbackResult,YxxFeedbackReceipt} from '../contracts/yxx_self_service_feedback_contracts.js';
import {hashP2016,snapshotP2016,transactionP2016,uuidP2016} from './p2-016-domain-contracts.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {completedTicketRound,reopenCompletedRound,reopenRoundsSchemaReady} from './ticket-reopen-rounds.mjs';
import type {CompletedTicketRound} from './ticket-reopen-rounds.mjs';
const REF=/^[A-Za-z0-9_-]{32}$/u;
function fail(code:string,status=409):never{throw Object.assign(new Error(code),{code,status});}
function ref(value:unknown):string{if(typeof value!=='string'||!REF.test(value))fail('YXX_INPUT_INVALID',400);return value;}
export function parseYxxFeedbackInput(input:unknown):YxxFeedbackInput{
 const v=snapshotP2016(input);
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='client_command_id,completed_round_ref,expected_ticket_version,feedback,schema_version')fail('YXX_INPUT_INVALID',400);
 const value=v as Record<string,unknown>;
 if(value.schema_version!==1||value.feedback!=='STILL_UNRESOLVED'||!Number.isSafeInteger(value.expected_ticket_version)||Number(value.expected_ticket_version)<1||Number(value.expected_ticket_version)>2147483647)fail('YXX_INPUT_INVALID',400);
 let id:string;try{id=uuidP2016(value.client_command_id);}catch{fail('YXX_INPUT_INVALID',400);}
 return {schema_version:1,client_command_id:id,feedback:'STILL_UNRESOLVED',completed_round_ref:ref(value.completed_round_ref),expected_ticket_version:value.expected_ticket_version as number};
}
export interface FeedbackMemberContext{scope:YxxMemberScope;write_flag:boolean;flags:YxxMemberFlags}
interface WebSource{intake_id:string;ticket_id:string|null;input_revision:string}
export interface FeedbackHooks{onNewCommand?:(input:{value:YxxFeedbackInput;transaction:PostgresTransaction})=>Promise<boolean>;onBeforeCommit?:(input:{transaction:PostgresTransaction})=>Promise<boolean>}
export interface FeedbackStoreInput extends FeedbackHooks{scope:YxxMemberScope;requestRef:string;input:unknown;transaction?:PostgresTransaction}
export type YxxFeedbackStore=ReturnType<typeof createYxxSelfServiceFeedback>;
export function createYxxSelfServiceFeedback({pool,scopeSecret}:{pool:PostgresPool;scopeSecret:string}){
 if(typeof scopeSecret!=='string'||Buffer.byteLength(scopeSecret)<32)fail('YXX_CONFIG_INVALID',503);
 async function ready(tx:PostgresTransaction){if(!await reopenRoundsSchemaReady(tx))fail('YXX_UNAVAILABLE',503);}
 async function source(tx:PostgresTransaction,scope:YxxMemberScope,requestRef:string,lock=false):Promise<WebSource>{
  ref(requestRef);
  const result=await tx.query<WebSource>(`SELECT b.intake_id::text,i.pilot_ticket_id::text AS ticket_id,b.input_revision::text
   FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
   WHERE b.request_ref=$1 AND b.canonical_reporter_binding=$2 AND b.source_corp_scope=$3 AND b.source_app_scope=$4 AND b.proof_ref=$5
    AND i.source_provider='YIXIAOXIU_WEB' AND i.source_app_scope=b.source_app_scope AND i.canonical_reporter_binding=b.canonical_reporter_binding
    AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
   ${lock?'FOR UPDATE OF b,i':''}`,[requestRef,scope.scopeHash,scope.sourceCorpScope,scope.sourceAppScope,scope.proofRef]);
  if(!result.rows[0])fail('YXX_NOT_FOUND',404);return result.rows[0];
 }
 function roundRef(scope:YxxMemberScope,requestRef:string,round:CompletedTicketRound){return createHmac('sha256',scopeSecret).update(JSON.stringify(['WEB_FEEDBACK',scope.scopeHash,scope.sourceCorpScope,scope.sourceAppScope,requestRef,round.id,round.staff_completion_event_id])).digest().subarray(0,24).toString('base64url');}
 const denied=(rejection:Extract<YxxFeedbackContext,{can_feedback:false}>['rejection']):YxxFeedbackContext=>({schema_version:1,can_feedback:false,completed_round_ref:null,completed_round_no:null,ticket_version:null,rejection});
 async function context(tx:PostgresTransaction,member:FeedbackMemberContext,requestRef:string):Promise<YxxFeedbackContext>{
  await ready(tx);const original=await source(tx,member.scope,requestRef);
  if(!member.write_flag||!member.flags.YIXIAOXIU_SELF_SERVICE_ENABLED||!member.flags.YIXIAOXIU_MY_REPORTS_ENABLED)return denied('WRITE_DISABLED');
  if(!original.ticket_id)return denied('TICKET_NOT_CREATED');
  const round=await completedTicketRound(tx,original.ticket_id);
  if(!round||round.source_intake_id!==original.intake_id){
   const current=await tx.query("SELECT 1 FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_cycle_reopen r ON r.new_cycle_id=t.current_handling_cycle_id AND r.ticket_id=t.id WHERE t.id=$1::uuid AND t.status='REOPENED'",[original.ticket_id]);
   return denied(current.rowCount?'ROUND_ALREADY_REOPENED':'ROUND_NOT_COMPLETED');
  }
  return {schema_version:1,can_feedback:true,completed_round_ref:roundRef(member.scope,requestRef,round),completed_round_no:round.cycle_no,ticket_version:round.version,rejection:null};
 }
 async function acceptInTransaction({scope,requestRef,input,transaction:tx,onNewCommand,onBeforeCommit}:FeedbackStoreInput & {transaction:PostgresTransaction}):Promise<YxxFeedbackResult>{
  const value=parseYxxFeedbackInput(input);await ready(tx);
  // Same mutex as W/T11 before any source row, command receipt FK or Ticket lock.
  await lockP2016Realtime(tx);await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[scope.scopeHash+':'+value.client_command_id]);
  const original=await source(tx,scope,requestRef,true);
  const commandHash=hashP2016({kind:'FEEDBACK',request_ref:requestRef,...value});
  const receipt=await tx.query<{command_kind:string;command_hash:string;result_request_ref:string|null;feedback_result:YxxFeedbackResult|null}>(`SELECT command_kind,command_hash,result_request_ref,feedback_result FROM intake.web_command_receipt WHERE scope_hash=$1 AND client_command_id=$2::uuid`,[scope.scopeHash,value.client_command_id]);
  const previous=receipt.rows[0];
  const beforeCommit=async()=>{await source(tx,scope,requestRef);if(onBeforeCommit&&await onBeforeCommit({transaction:tx})!==true)fail('YXX_AUTH_RECHECK_FAILED',403);};
  if(previous){
   if(previous.command_kind!=='FEEDBACK'||previous.command_hash!==commandHash||previous.result_request_ref!==requestRef||!previous.feedback_result)fail('YXX_COMMAND_CONFLICT');
   await beforeCommit();return {...previous.feedback_result,replayed:true};
  }
  if(!original.ticket_id)fail('YXX_ROUND_NOT_COMPLETED');
  await tx.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR UPDATE',[original.ticket_id]);
  const round=await completedTicketRound(tx,original.ticket_id);
  if(!round||round.source_intake_id!==original.intake_id||roundRef(scope,requestRef,round)!==value.completed_round_ref)fail('YXX_ROUND_CONFLICT');
  if(round.version!==value.expected_ticket_version)fail('YXX_VERSION_CONFLICT');
  if(onNewCommand&&await onNewCommand({value,transaction:tx})!==true)fail('YXX_MEMBER_QUOTA_EXCEEDED',429);
  const reopened=await reopenCompletedRound({transaction:tx,round,actor:{type:'REPORTER',id:scope.scopeHash},commandId:value.client_command_id,origin:'WEB_REPORTER',reasonCode:'REPORTER_STILL_UNRESOLVED'});
  const result:YxxFeedbackResult={ok:true,replayed:false,request_ref:requestRef,completed_round_ref:value.completed_round_ref,reopened_round_no:reopened.handling_cycle.cycle_no,ticket:{ticket_no:reopened.ticket.ticket_no,status:'REOPENED',version:reopened.ticket.version}};
  await tx.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch)
   INSERT INTO intake.web_command_receipt(scope_hash,client_command_id,command_kind,command_hash,schema_version,result_intake_id,result_request_ref,accepted_revision,accepted_at,accepted_epoch_ms,created_at,feedback_result)
   SELECT $1,$2::uuid,'FEEDBACK',$3,1,$4::uuid,$5,$6::bigint,platform.local_from_epoch_ms(epoch),epoch,platform.local_from_epoch_ms(epoch),$7::jsonb FROM stamp`,[scope.scopeHash,value.client_command_id,commandHash,original.intake_id,requestRef,original.input_revision,JSON.stringify(result)]);
  await beforeCommit();return result;
 }
 async function accept(input:FeedbackStoreInput){return transactionP2016(pool,tx=>acceptInTransaction({...input,transaction:tx}));}
 async function receipt(tx:PostgresTransaction,scope:YxxMemberScope,requestRef:string,clientCommandId:unknown):Promise<YxxFeedbackReceipt>{
  await ready(tx);const id=uuidP2016(clientCommandId);await source(tx,scope,requestRef);
  const row=(await tx.query<{feedback_result:YxxFeedbackResult}>(`SELECT feedback_result FROM intake.web_command_receipt WHERE scope_hash=$1 AND client_command_id=$2::uuid AND result_request_ref=$3 AND command_kind='FEEDBACK'`,[scope.scopeHash,id,requestRef])).rows[0];
  return row?{client_command_id:id,request_ref:requestRef,state:'COMMITTED',result:{...row.feedback_result,replayed:true}}:{client_command_id:id,request_ref:requestRef,state:'UNKNOWN'};
 }
 return Object.freeze({context,receipt,accept,acceptInTransaction});
}
