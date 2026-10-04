export interface WeComMemberDirectoryOptions { enabled?: boolean; botId?: string | null; memberIdsConfirmed?: boolean; accessTokenProvider?: (input: { signal: AbortSignal }) => Promise<unknown>; fetchImpl?: typeof fetch; beforeRequest?: (input: { bot_id: string; path: string; signal: AbortSignal }) => Promise<unknown>; timeoutMs?: number; now?: () => string }
import {createReporterDirectoryPort} from './p2-015-contact-journey.mjs';
import {safeHash} from './p2-015-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';

const text=(value: unknown)=>typeof value==='string'&&value.length>0&&value.length<=256?value:null;
const departmentId=(value: unknown)=>Number.isSafeInteger(value)&&(value as number)>0;
const deferred=()=>({status:'DEFERRED'});

// Only deployments that have verified smart-bot sender IDs as this application's
// internal member IDs may enable this adapter. External customer IDs are not mapped.
export function createWeComMemberDirectory({enabled=false,botId=null,memberIdsConfirmed=false,
  accessTokenProvider,fetchImpl=fetch,beforeRequest=async()=>{},timeoutMs=500,
  now=()=>formatEpochMsToShanghaiLocal(String(Date.now()))}: WeComMemberDirectoryOptions={}) {
  return createReporterDirectoryPort({timeoutMs,resolveProfile:async(input,{signal})=>{
    if(!enabled||!memberIdsConfirmed||input.source!=='WECOM_DIRECTORY'||!botId||input.bot_id!==botId
      ||typeof accessTokenProvider!=='function'||typeof input.reporter_external_id!=='string'
      ||!input.reporter_external_id||Buffer.byteLength(input.reporter_external_id)>64)return deferred();
    const token=await accessTokenProvider({signal});
    signal.throwIfAborted();
    if(typeof token!=='string'||!token||token.length>4096)return deferred();
    async function get(path: string,key: string,value: unknown){
      signal.throwIfAborted();
      await beforeRequest({bot_id:botId as string,path,signal});signal.throwIfAborted();
      const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/'+path);
      url.searchParams.set('access_token',token as string);url.searchParams.set(key,String(value));
      const response=await fetchImpl(url,{method:'GET',redirect:'error',signal});
      if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw new Error('DIRECTORY_UNAVAILABLE');}
      const reader=response.body.getReader();let length=0;const chunks: Buffer[]=[];
      try{for(;;){signal.throwIfAborted();const {done,value:chunk}=await reader.read();if(done)break;
        length+=chunk.byteLength;if(length>65536)throw new Error('DIRECTORY_UNAVAILABLE');chunks.push(Buffer.from(chunk));}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const body: unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if((body as Record<string, unknown>).errcode!==0)throw new Error('DIRECTORY_UNAVAILABLE');return body as Record<string, unknown>;
    }
    const user=await get('user/get','userid',input.reporter_external_id);
    if(typeof user.userid!=='string'||user.userid.toLowerCase()!==input.reporter_external_id.toLowerCase()
      ||!text(user.userid)||!Array.isArray(user.department)||user.department.length>20
      ||user.department.some(id=>!departmentId(id))||new Set(user.department).size!==user.department.length)return deferred();
    const memberships=[];
    for(const id of user.department){
      let name: string | null=null;
      try{const response=await get('department/get','id',id);if((response.department as { id?: unknown } | null)?.id===id)name=text((response.department as { name?: unknown }).name);}
      catch{signal.throwIfAborted();}
      memberships.push({department_ref:String(id),name,role:id===user.main_department?'PRIMARY':'SECONDARY'});
    }
    const at=now(),snapshot={source:'WECOM_DIRECTORY',valid_at:at,fetched_at:at,
      account_status:user.status===1?'ACTIVE':[2,4,5].includes(user.status as number)?'INACTIVE':'UNKNOWN',
      contact:{name:text(user.name),userid:user.userid,mobile:text(user.mobile),telephone:text(user.telephone)},memberships};
    (snapshot as typeof snapshot & { version: string }).version='wecom-member-'+safeHash(snapshot);
    return {status:'RESOLVED',snapshot};
  }});
}
