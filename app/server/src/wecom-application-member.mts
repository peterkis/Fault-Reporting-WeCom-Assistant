import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {WeComAccessTokenProvider} from './p2-g2-wecom-oauth-provider.mjs';
import {readWeComResponse} from './p2-g2-wecom-oauth-provider.mjs';
import {validYxxUserId} from './p2-g2-yixiaoxiu-contract.mjs';

export interface VerifiedApplicationMember {readonly openUserId:string;readonly displayName:string|null;readonly checkedEpochMs:string;readonly departmentName?:string|null}
export type ApplicationMemberVerifier=((id:string,signal?:AbortSignal)=>Promise<VerifiedApplicationMember|null>)&{readonly profileRead?:ApplicationMemberVerifier};
export type ApplicationMemberVerificationPurpose='BASE'|'H5_ENTRY';
interface ApplicationMemberVerificationCommon {
 readonly operation_id:string;readonly purpose:ApplicationMemberVerificationPurpose;readonly at_ms:number;readonly queued_at_ms:number;
 readonly active:number;readonly base_active:number;readonly pending:number;
}
export type ApplicationMemberVerificationEvent=ApplicationMemberVerificationCommon&(
 {readonly phase:'QUEUED'}|
 {readonly phase:'STARTED';readonly started_at_ms:number}|
 {readonly phase:'SETTLED';readonly started_at_ms:number|null;readonly outcome:'FULFILLED'|'REJECTED'}
);
export type ApplicationMemberVerifierWithH5Entry=ApplicationMemberVerifier&{readonly h5EntryRead:ApplicationMemberVerifier};
export interface ApplicationMemberVerifierOptions {
 readonly accessTokenProvider:WeComAccessTokenProvider;readonly fetchImpl?:typeof fetch;readonly h5EntryReadEnabled?:boolean;
 readonly observe?:(event:ApplicationMemberVerificationEvent)=>void;
}
export class ApplicationMemberUnavailableError extends Error {
 constructor(){super('APPLICATION_MEMBER_UNAVAILABLE');this.name='ApplicationMemberUnavailableError';}
}
export function applicationMemberId(id:unknown):id is string{return validYxxUserId(id)&&id!=='@all'&&!/[|<>]/u.test(id);}
interface VerificationJob {
 readonly operationId:string;readonly purpose:ApplicationMemberVerificationPurpose;readonly queuedAt:number;readonly deadline:number;readonly controller:AbortController;
 readonly profileRead:boolean;
 id:string|null;callerSignal:AbortSignal|undefined;context:ReturnType<typeof AsyncLocalStorage.snapshot>|null;
 phase:'queued'|'active'|'settled';startedAt:number|null;delivery:'pending'|'fulfilled'|'rejected';
 timer:ReturnType<typeof setTimeout>|undefined;cancel:(()=>void)|null;
 resolve:((value:VerifiedApplicationMember|null)=>void)|null;reject:((error:ApplicationMemberUnavailableError)=>void)|null;
}
function isRecord(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
/** Current application lookups share one bounded runtime scheduler; member qualification is never cached. */
export function createApplicationMemberVerifier({accessTokenProvider,fetchImpl=fetch,h5EntryReadEnabled=false,observe}:ApplicationMemberVerifierOptions):ApplicationMemberVerifierWithH5Entry{
 const maximumActive=h5EntryReadEnabled?2:1,queue:VerificationJob[]=[];let pending=0,active=0,baseActive=0,pumping=false;
 function event(job:VerificationJob,detail:{phase:'QUEUED'}|{phase:'STARTED';started_at_ms:number}|{phase:'SETTLED';started_at_ms:number|null;outcome:'FULFILLED'|'REJECTED'}){
  if(!observe)return;
  const value:ApplicationMemberVerificationEvent=Object.freeze({operation_id:job.operationId,purpose:job.purpose,at_ms:performance.now(),queued_at_ms:job.queuedAt,active,base_active:baseActive,pending,...detail});
  // Observer failures cannot affect qualification. Restore the admitting HTTP context, never the dispatcher context.
  try{if(job.context)job.context(()=>observe(value));else observe(value);}catch{}
 }
 function detachDelivery(job:VerificationJob){clearTimeout(job.timer);job.timer=undefined;if(job.cancel)job.callerSignal?.removeEventListener('abort',job.cancel);job.cancel=null;job.callerSignal=undefined;}
 function deliver(job:VerificationJob,outcome:'FULFILLED'|'REJECTED',value:VerifiedApplicationMember|null=null){
  if(job.delivery!=='pending')return;job.delivery=outcome==='FULFILLED'?'fulfilled':'rejected';detachDelivery(job);
  const resolve=job.resolve,reject=job.reject;job.resolve=null;job.reject=null;
  if(outcome==='FULFILLED')resolve?.(value);else reject?.(new ApplicationMemberUnavailableError());
 }
 function retire(job:VerificationJob){job.id=null;job.context=null;job.resolve=null;job.reject=null;detachDelivery(job);}
 function cancel(job:VerificationJob){
  if(job.phase==='settled'||job.delivery!=='pending')return;
  deliver(job,'REJECTED');job.controller.abort(new ApplicationMemberUnavailableError());
  if(job.phase==='queued'){
   const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);job.phase='settled';pending--;
   event(job,{phase:'SETTLED',started_at_ms:null,outcome:'REJECTED'});retire(job);pump();
  }
  // A timed-out or cancelled active lookup still owns its actual and pending slots until its underlying work settles.
 }
 function check(job:VerificationJob){job.controller.signal.throwIfAborted();if(performance.now()>=job.deadline)throw new ApplicationMemberUnavailableError();}
 async function lookup(job:VerificationJob):Promise<VerifiedApplicationMember|null>{
   try{
    const id=job.id;if(id===null)throw new ApplicationMemberUnavailableError();const signal=job.controller.signal;
    check(job);const token=await accessTokenProvider({signal});check(job);
    if(typeof token!=='string'||!token||token.length>4096)throw new ApplicationMemberUnavailableError();
    const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/user/get');url.searchParams.set('access_token',token);url.searchParams.set('userid',id);
    const value=await readWeComResponse(await fetchImpl(url,{method:'GET',redirect:'error',signal}),signal);check(job);
    if(!isRecord(value))throw new ApplicationMemberUnavailableError();const row=value;
    if(row.errcode!==0){
     if([40014,42001].includes(Number(row.errcode)))accessTokenProvider.invalidate?.(token);
     if([60011,60111].includes(Number(row.errcode)))return null;
     throw new ApplicationMemberUnavailableError();
    }
    if(typeof row.status!=='number'||row.enable!==undefined&&typeof row.enable!=='number')throw new ApplicationMemberUnavailableError();
    if(row.userid!==id||row.status!==1||row.enable!==undefined&&row.enable!==1)return null;
    const name=typeof row.name==='string'&&row.name.trim().length>0&&row.name.length<=80&&!/[\r\n\x00-\x1f<>@]/u.test(row.name)?row.name.trim():null;
    let departmentName:string|null=null;
    if(job.profileRead&&Array.isArray(row.department)&&row.department.length<=20&&row.department.every(value=>Number.isSafeInteger(value)&&Number(value)>0)&&new Set(row.department).size===row.department.length){
     const departmentId=row.department.includes(row.main_department)?row.main_department:row.department[0];
     if(departmentId!==undefined){
      const departmentUrl=new URL('https://qyapi.weixin.qq.com/cgi-bin/department/get');departmentUrl.searchParams.set('access_token',token);departmentUrl.searchParams.set('id',String(departmentId));
      try{
       check(job);const value=await readWeComResponse(await fetchImpl(departmentUrl,{method:'GET',redirect:'error',signal}),signal);check(job);
       if(isRecord(value)){
        if([40014,42001].includes(Number(value.errcode)))accessTokenProvider.invalidate?.(token);
        const department=value.department;
        if(value.errcode===0&&isRecord(department)&&department.id===departmentId&&typeof department.name==='string'&&department.name.trim()&&department.name.length<=128&&!/[\x00-\x1f\x7f<>]/u.test(department.name))departmentName=department.name.trim();
       }
      }catch{check(job);/* Display metadata failure does not revoke an otherwise qualified member. */}
     }
    }
    return Object.freeze({openUserId:id,displayName:name,checkedEpochMs:String(Date.now()),...(job.profileRead?{departmentName}:{})});
   }catch{throw new ApplicationMemberUnavailableError();}
 }
 function settled(job:VerificationJob,fulfilled:boolean,value:VerifiedApplicationMember|null=null){
  // Only this underlying completion returns an actual slot. Delivery cancellation never calls this path.
  job.phase='settled';active--;if(job.purpose==='BASE')baseActive--;pending--;
  const accepted=fulfilled&&!job.controller.signal.aborted&&performance.now()<job.deadline&&job.delivery!=='rejected';
  deliver(job,accepted?'FULFILLED':'REJECTED',value);
  event(job,{phase:'SETTLED',started_at_ms:job.startedAt,outcome:accepted?'FULFILLED':'REJECTED'});
  job.controller.abort();retire(job);pump();
 }
 function pump(){
  if(pumping)return;pumping=true;
  try{while(active<maximumActive){
   // The earliest BASE may be waiting for its single-purpose slot while an H5 slot can still run.
   const index=queue.findIndex(job=>job.purpose!=='BASE'||baseActive<1);if(index<0)return;const job=queue.splice(index,1)[0];if(!job)continue;
   if(job.controller.signal.aborted||performance.now()>=job.deadline){cancel(job);continue;}
   job.phase='active';job.startedAt=performance.now();active++;if(job.purpose==='BASE')baseActive++;
   event(job,{phase:'STARTED',started_at_ms:job.startedAt});
   const operation=job.context?job.context(()=>lookup(job)):lookup(job);
   void operation.then(value=>settled(job,true,value),()=>settled(job,false));
  }}finally{pumping=false;}
 }
 function admit(purpose:ApplicationMemberVerificationPurpose,id:string,callerSignal?:AbortSignal,profileRead=false):Promise<VerifiedApplicationMember|null>{
  if(!applicationMemberId(id))return Promise.resolve(null);
  if(pending>=32||callerSignal?.aborted)return Promise.reject(new ApplicationMemberUnavailableError());
  return new Promise((resolve,reject)=>{
   const queuedAt=performance.now(),job:VerificationJob={operationId:randomUUID(),purpose,profileRead,queuedAt,deadline:queuedAt+5000,controller:new AbortController(),id,callerSignal,
    context:AsyncLocalStorage.snapshot(),phase:'queued',startedAt:null,delivery:'pending',timer:undefined,cancel:null,resolve,reject};
   pending++;queue.push(job);job.cancel=()=>cancel(job);job.timer=setTimeout(job.cancel,5000);callerSignal?.addEventListener('abort',job.cancel,{once:true});
   event(job,{phase:'QUEUED'});if(callerSignal?.aborted)cancel(job);pump();
  });
 }
 const base:ApplicationMemberVerifier=(id,signal)=>admit('BASE',id,signal);
 const h5EntryRead:ApplicationMemberVerifier=h5EntryReadEnabled?(id,signal)=>admit('H5_ENTRY',id,signal):base;
 // Display reads use the original BASE slot, never the entry-only concurrency exception.
 const profileRead:ApplicationMemberVerifier=(id,signal)=>admit('BASE',id,signal,true);
 const verifier=Object.assign(base,{h5EntryRead,profileRead});
 for(const key of ['h5EntryRead','profileRead'])Object.defineProperty(verifier,key,{writable:false,configurable:false});return verifier;
}
