import type {WeComAccessTokenProvider} from './p2-g2-wecom-oauth-provider.mjs';
import {readWeComResponse} from './p2-g2-wecom-oauth-provider.mjs';
import {validYxxUserId} from './p2-g2-yixiaoxiu-contract.mjs';

export interface VerifiedApplicationMember {readonly openUserId:string;readonly displayName:string|null;readonly checkedEpochMs:string}
export type ApplicationMemberVerifier=(id:string,signal?:AbortSignal)=>Promise<VerifiedApplicationMember|null>;
export class ApplicationMemberUnavailableError extends Error {
 constructor(){super('APPLICATION_MEMBER_UNAVAILABLE');this.name='ApplicationMemberUnavailableError';}
}
export function applicationMemberId(id:unknown):id is string{return validYxxUserId(id)&&id!=='@all'&&!/[|<>]/u.test(id);}
/** One current application lookup. No directory synchronization or persistent member cache. */
export function createApplicationMemberVerifier({accessTokenProvider,fetchImpl=fetch}:{accessTokenProvider:WeComAccessTokenProvider;fetchImpl?:typeof fetch}):ApplicationMemberVerifier{
 let pending=0,tail:Promise<void>=Promise.resolve();
 return async(id,callerSignal)=>{
  if(!applicationMemberId(id))return null;
  if(pending>=32||callerSignal?.aborted)throw new ApplicationMemberUnavailableError();
  pending++;const controller=new AbortController(),signal=AbortSignal.any([controller.signal,...(callerSignal?[callerSignal]:[])]);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ApplicationMemberUnavailableError());},5000);});
  const operation=tail.then(async():Promise<VerifiedApplicationMember|null>=>{
   try{
    signal.throwIfAborted();const token=await accessTokenProvider({signal});signal.throwIfAborted();
    if(typeof token!=='string'||!token||token.length>4096)throw new ApplicationMemberUnavailableError();
    const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/user/get');url.searchParams.set('access_token',token);url.searchParams.set('userid',id);
    const value=await readWeComResponse(await fetchImpl(url,{method:'GET',redirect:'error',signal}),signal);signal.throwIfAborted();
    if(value===null||typeof value!=='object'||Array.isArray(value))throw new ApplicationMemberUnavailableError();
    const row=value as Record<string,unknown>;
    if(row.errcode!==0){
     if([40014,42001].includes(Number(row.errcode)))accessTokenProvider.invalidate?.(token);
     if([60011,60111].includes(Number(row.errcode)))return null;
     throw new ApplicationMemberUnavailableError();
    }
    if(typeof row.status!=='number'||row.enable!==undefined&&typeof row.enable!=='number')throw new ApplicationMemberUnavailableError();
    if(row.userid!==id||row.status!==1||row.enable!==undefined&&row.enable!==1)return null;
    const name=typeof row.name==='string'&&row.name.trim().length>0&&row.name.length<=80&&!/[\r\n\x00-\x1f<>@]/u.test(row.name)?row.name.trim():null;
    return Object.freeze({openUserId:id,displayName:name,checkedEpochMs:String(Date.now())});
   }catch{throw new ApplicationMemberUnavailableError();}
  });
  // A provider which ignores AbortSignal keeps the one actual in-flight slot.
  tail=operation.then(()=>{},()=>{}).finally(()=>{pending--;});
  try{return await Promise.race([operation,deadline]);}finally{controller.abort();clearTimeout(timer);}
 };
}
