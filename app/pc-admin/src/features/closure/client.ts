import {ApiError,UnknownCommandOutcome,captureWorkbenchRead,readWorkbench,decodeWorkbenchDateTime} from '../../api/client';
import type {QueryClient} from '@tanstack/react-query';
import type {ClosureCommand,IntakeClosureCommand,RestoreCommand,ClosureResult,ClosureReceipt,IntakeClosureContext} from '../../../../../contracts/unified_closure_contracts';
import type {ClosureHistoryPage,ClosureHistoryEntry,ClosureReasonCode,ClosureSecondaryReasonCode} from '../../../../../contracts/unified_closure_contracts';
export type {ClosureHistoryPage,ClosureHistoryEntry};
export async function clearClosureRead(client:QueryClient,principal:string,kind:'ticket'|'intake',id:string,error:ApiError){
 const matches=(key:readonly unknown[])=>['closure-history','closure-context'].includes(String(key[0]))&&key[1]===principal&&key[2]===kind&&key[3]===id;
 await client.cancelQueries({predicate:query=>matches(query.queryKey)},{revert:false});
 for(const query of client.getQueryCache().findAll({predicate:query=>matches(query.queryKey)}))query.setState({data:undefined,dataUpdatedAt:0,error,status:'error',fetchStatus:'idle'});
}
export type {ClosureCommand,IntakeClosureCommand,RestoreCommand,ClosureResult,ClosureReceipt,IntakeClosureContext};
function invalid():never{throw new ApiError(502,'INVALID_RESPONSE');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Record<string,unknown>;}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))invalid();return value;}
function version(value:unknown):number{if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>2147483647)invalid();return value;}
function exact(value:unknown,keys:string[]){const v=object(value);if(Object.keys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key)))invalid();return v;}
function text(value:unknown,max:number):string{if(typeof value!=='string'||value.length>max||!value.trim())invalid();return value;}
function nullableText(value:unknown,max:number){return value===null?null:text(value,max);}
const time=decodeWorkbenchDateTime;
function notification(value:unknown):ClosureHistoryEntry['notification_state']{if(value!=='SENT'&&value!=='UNKNOWN'&&value!=='NOT_SENT')invalid();return value;}
const reasonCodes=['FALSE_REPORT_OR_TEST','DUPLICATE','NOT_IT_SCOPE','REPORTER_WITHDREW','REPORTER_UNREACHABLE','OTHER'];
const secondaryCodes=['HUMAN_CONFIRMED','INFORMATION_INSUFFICIENT','BUSINESS_CONSULTATION_CONFIRMED','ACKNOWLEDGED','OUT_OF_SCOPE_CONFIRMED','SERVICE_REQUEST_CONFIRMED','INCIDENT_REVIEW_PENDING','STALE_REVIEW_CANCELLED'];
export function decodeClosureHistory(value:unknown,subjectId:string):ClosureHistoryPage{
 const v=exact(value,['subject_id','version','items','next_before_version','restore_target']);if(uuid(v.subject_id)!==subjectId||!Array.isArray(v.items)||v.items.length>20)invalid();
 const items:ClosureHistoryEntry[]=v.items.map(value=>{const r=exact(value,['id','before_version','reason_code','reason_label','secondary_reason','note','duplicate_of','source','ended_at','ended_by_display_name','notification_state','restored_at','restored_by_display_name','restore_source']);
  if(!reasonCodes.includes(String(r.reason_code))||(r.source!=='MANUAL'&&r.source!=='SYSTEM'))invalid();
  if(r.restored_at===null?r.restore_source!==null:r.restore_source!=='MANUAL'&&r.restore_source!=='SYSTEM')invalid();
  let secondary:ClosureHistoryEntry['secondary_reason']=null,duplicate:ClosureHistoryEntry['duplicate_of']=null;
  if(r.secondary_reason!==null){const s=exact(r.secondary_reason,['code','label']);if(r.reason_code!=='NOT_IT_SCOPE'||!secondaryCodes.includes(String(s.code)))invalid();secondary={code:s.code as ClosureSecondaryReasonCode,label:text(s.label,128)};}
  if(r.duplicate_of!==null){const d=exact(r.duplicate_of,['display_no']);if(r.reason_code!=='DUPLICATE')invalid();duplicate={display_no:text(d.display_no,128)};}
  return {id:uuid(r.id),before_version:version(r.before_version),reason_code:r.reason_code as ClosureReasonCode,reason_label:text(r.reason_label,128),secondary_reason:secondary,note:nullableText(r.note,2000),duplicate_of:duplicate,source:r.source,
   ended_at:time(r.ended_at),ended_by_display_name:nullableText(r.ended_by_display_name,128),notification_state:notification(r.notification_state),restored_at:r.restored_at===null?null:time(r.restored_at),restored_by_display_name:nullableText(r.restored_by_display_name,128),restore_source:r.restore_source as ClosureHistoryEntry['restore_source']};
 });
 if(new Set(items.map(item=>item.id)).size!==items.length||items.some((item,index)=>index>0&&item.before_version>=(items[index-1]?.before_version??0)))invalid();
 let target:ClosureHistoryPage['restore_target']=null;
 if(v.restore_target!==null){const r=exact(v.restore_target,['status','column','assignee_name','notify_reporter','notification_state']);if(typeof r.notify_reporter!=='boolean')invalid();if(r.column!=='pending'&&r.column!=='active'||!['NEW','QUEUED','ACCEPTED','REOPENED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'].includes(String(r.status)))invalid();target={status:text(r.status,64),column:r.column,assignee_name:nullableText(r.assignee_name,128),notify_reporter:r.notify_reporter,notification_state:notification(r.notification_state)};}
 const next=v.next_before_version===null?null:version(v.next_before_version);if(next!==null&&(items.length!==20||next!==items.at(-1)?.before_version))invalid();
 return {subject_id:subjectId,version:version(v.version),items,next_before_version:next,restore_target:target};
}
function result(value:unknown,intakeId:string):ClosureResult{const v=object(value);if(Object.keys(v).length!==7||v.ok!==true||v.subject_type!=='INTAKE'||uuid(v.subject_id)!==intakeId||typeof v.replayed!=='boolean')invalid();return {ok:true,subject_type:'INTAKE',subject_id:intakeId,version:version(v.version),closure_id:uuid(v.closure_id),event_id:uuid(v.event_id),replayed:v.replayed};}
function errorCode(value:unknown):string{if(typeof value!=='string'||!/^[A-Z][A-Z0-9_]{0,100}$/u.test(value))invalid();return value;}
async function command(intakeId:string,action:'close'|'restore',input:IntakeClosureCommand|RestoreCommand,csrfToken:string|null,signal:AbortSignal):Promise<ClosureResult>{
 const current=captureWorkbenchRead(signal);current();
 try{
  const response=await fetch('/api/intakes/'+encodeURIComponent(intakeId)+'/'+action,{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':input.client_command_id,'if-match':'"'+input.expected_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(input)});current();
  if(!response.headers.get('content-type')?.startsWith('application/json')){if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');throw new UnknownCommandOutcome();}
  const value:unknown=await response.json();current();
  if(!response.ok){const v=object(value),e=object(v.error),code=errorCode(e.code);if(response.status<500||v.ok===false&&typeof v.replayed==='boolean'&&e.retryable===false)throw new ApiError(response.status,code);throw new UnknownCommandOutcome();}
  return result(value,intakeId);
 }catch(error){current();if(error instanceof ApiError&&error.code!=='INVALID_RESPONSE')throw error;throw new UnknownCommandOutcome();}
}
export const closureApi={
 history:(kind:'ticket'|'intake',id:string,beforeVersion:number|null,signal:AbortSignal):Promise<ClosureHistoryPage>=>readWorkbench('/api/'+(kind==='ticket'?'tickets':'intakes')+'/'+encodeURIComponent(id)+'/closure-history'+(beforeVersion===null?'':'?before_version='+beforeVersion),signal,value=>decodeClosureHistory(value,id)),
 ticketRestoreReceipt:(id:string,commandId:string,signal:AbortSignal)=>readWorkbench('/api/tickets/'+encodeURIComponent(id)+'/restore/commands/'+encodeURIComponent(commandId),signal,value=>{
  const v=object(value);if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN' as const};
  if(v.state==='COMMITTED'&&Object.keys(v).length===4&&v.ticket_id===id){version(v.ticket_version);uuid(v.ticket_event_id);return {state:'COMMITTED' as const};}
  if(v.state==='FAILED'&&Object.keys(v).length===2){const e=exact(v.error,['code','retryable']);errorCode(e.code);if(e.retryable!==false)invalid();return {state:'FAILED' as const};}invalid();
 }),
 intakeContext:(id:string,signal:AbortSignal):Promise<IntakeClosureContext>=>readWorkbench('/api/intakes/'+encodeURIComponent(id)+'/closure-context',signal,value=>{
  const v=object(value);if(Object.keys(v).length!==7||uuid(v.subject_id)!==id||typeof v.status!=='string'||typeof v.can_close!=='boolean'||typeof v.can_restore!=='boolean')invalid();
  let review:IntakeClosureContext['pending_review']=null;if(v.pending_review!==null){const r=object(v.pending_review);if(Object.keys(r).length!==2||typeof r.row_version!=='string'||!/^[1-9][0-9]{0,18}$/u.test(r.row_version))invalid();review={id:uuid(r.id),row_version:r.row_version};}
  return {subject_id:id,version:version(v.version),status:v.status,can_close:v.can_close,can_restore:v.can_restore,closure_id:v.closure_id===null?null:uuid(v.closure_id),pending_review:review};
 }),
 closeIntake:(id:string,input:IntakeClosureCommand,csrfToken:string|null,signal:AbortSignal)=>command(id,'close',input,csrfToken,signal),
 restoreIntake:(id:string,input:RestoreCommand,csrfToken:string|null,signal:AbortSignal)=>command(id,'restore',input,csrfToken,signal),
 intakeReceipt:(id:string,action:'close'|'restore',commandId:string,signal:AbortSignal):Promise<ClosureReceipt>=>readWorkbench('/api/intakes/'+encodeURIComponent(id)+'/'+action+'/commands/'+encodeURIComponent(commandId),signal,value=>{
  const v=object(value);if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN'};
  if(v.state==='FAILED'&&Object.keys(v).length===2){const e=object(v.error);if(Object.keys(e).length!==2||e.retryable!==false)invalid();return {state:'FAILED',error:{code:errorCode(e.code),retryable:false}};}
  if(v.state==='COMMITTED'&&Object.keys(v).length===2)return {state:'COMMITTED',result:result(v.result,id)};invalid();
 }),
};
