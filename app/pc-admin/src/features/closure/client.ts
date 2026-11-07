import {ApiError,UnknownCommandOutcome,captureWorkbenchRead,readWorkbench} from '../../api/client';
import type {ClosureCommand,IntakeClosureCommand,RestoreCommand,ClosureResult,ClosureReceipt,IntakeClosureContext} from '../../../../../contracts/unified_closure_contracts';
export type {ClosureCommand,IntakeClosureCommand,RestoreCommand,ClosureResult,ClosureReceipt,IntakeClosureContext};
function invalid():never{throw new ApiError(502,'INVALID_RESPONSE');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Record<string,unknown>;}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))invalid();return value;}
function version(value:unknown):number{if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>2147483647)invalid();return value;}
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
