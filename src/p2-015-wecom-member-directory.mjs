import {createReporterDirectoryPort} from './p2-015-contact-journey.mjs';
import {safeHash} from './p2-015-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';

const text=value=>typeof value==='string'&&value.length>0&&value.length<=256?value:null;
const departmentId=value=>Number.isSafeInteger(value)&&value>0;
const deferred=()=>({status:'DEFERRED'});

// Only deployments that have verified smart-bot sender IDs as this application's
// internal member IDs may enable this adapter. External customer IDs are not mapped.
export function createWeComMemberDirectory({enabled=false,botId=null,memberIdsConfirmed=false,
  accessTokenProvider,fetchImpl=fetch,beforeRequest=async()=>{},timeoutMs=500,
  now=()=>formatEpochMsToShanghaiLocal(String(Date.now()))}={}) {
  return createReporterDirectoryPort({timeoutMs,resolveProfile:async(input,{signal})=>{
    if(!enabled||!memberIdsConfirmed||input.source!=='WECOM_DIRECTORY'||!botId||input.bot_id!==botId
      ||typeof accessTokenProvider!=='function'||typeof input.reporter_external_id!=='string'
      ||!input.reporter_external_id||Buffer.byteLength(input.reporter_external_id)>64)return deferred();
    const token=await accessTokenProvider({signal});
    signal.throwIfAborted();
    if(typeof token!=='string'||!token||token.length>4096)return deferred();
    async function get(path,key,value){
      signal.throwIfAborted();
      await beforeRequest({bot_id:botId,path,signal});signal.throwIfAborted();
      const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/'+path);
      url.searchParams.set('access_token',token);url.searchParams.set(key,String(value));
      const response=await fetchImpl(url,{method:'GET',redirect:'error',signal});
      if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw new Error('DIRECTORY_UNAVAILABLE');}
      const reader=response.body.getReader();let length=0;const chunks=[];
      try{for(;;){signal.throwIfAborted();const {done,value:chunk}=await reader.read();if(done)break;
        length+=chunk.byteLength;if(length>65536)throw new Error('DIRECTORY_UNAVAILABLE');chunks.push(Buffer.from(chunk));}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(body.errcode!==0)throw new Error('DIRECTORY_UNAVAILABLE');return body;
    }
    const user=await get('user/get','userid',input.reporter_external_id);
    if(typeof user.userid!=='string'||user.userid.toLowerCase()!==input.reporter_external_id.toLowerCase()
      ||!text(user.userid)||!Array.isArray(user.department)||user.department.length>20
      ||user.department.some(id=>!departmentId(id))||new Set(user.department).size!==user.department.length)return deferred();
    const memberships=[];
    for(const id of user.department){
      let name=null;
      try{const response=await get('department/get','id',id);if(response.department?.id===id)name=text(response.department.name);}
      catch{signal.throwIfAborted();}
      memberships.push({department_ref:String(id),name,role:id===user.main_department?'PRIMARY':'SECONDARY'});
    }
    const at=now(),snapshot={source:'WECOM_DIRECTORY',valid_at:at,fetched_at:at,
      account_status:user.status===1?'ACTIVE':[2,4,5].includes(user.status)?'INACTIVE':'UNKNOWN',
      contact:{name:text(user.name),userid:user.userid,mobile:text(user.mobile),telephone:text(user.telephone)},memberships};
    snapshot.version='wecom-member-'+safeHash(snapshot);
    return {status:'RESOLVED',snapshot};
  }});
}
