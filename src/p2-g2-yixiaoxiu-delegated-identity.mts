import type { InternalMemberId, OAuthMemberId } from './p2-g2-wecom-web-oauth.mjs';
import type { WeComAccessTokenProvider } from './p2-g2-wecom-oauth-provider.mjs';
export interface YxxIdentityMapping { readonly configHash: string; resolve(userid: OAuthMemberId): InternalMemberId | null }
export interface DelegatedIdentityOptions { config: unknown; accessTokenProvider: WeComAccessTokenProvider; fetchImpl?: typeof fetch }
import {createHash} from 'node:crypto';
import {readWeComResponse} from './p2-g2-wecom-oauth-provider.mjs';
import {validateYxxEntryConfig,validYxxUserId,failYxx} from './p2-g2-yixiaoxiu-contract.mjs';

export const yxxIdentityConfigHash=(config: unknown)=>createHash('sha256').update(JSON.stringify(validateYxxEntryConfig(config))).digest('hex');

// One bounded startup conversion; never called from an ownership transaction.
export async function createYxxDelegatedIdentityMapping({config,accessTokenProvider,fetchImpl=fetch}: DelegatedIdentityOptions){
  const c=validateYxxEntryConfig(config);
  if(!c.enabled||c.identityMode!=='VERIFIED_DELEGATED_MAPPING'||typeof accessTokenProvider!=='function')failYxx('CONFIG_INVALID');
  const controller=new AbortController(),signal=controller.signal;let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('deadline'));},5000);});
  const operation=(async()=>{
    const token=await accessTokenProvider({signal});signal.throwIfAborted();
    if(typeof token!=='string'||!token||token.length>4096)throw Error('token');
    const url=new URL('https://qyapi.weixin.qq.com/cgi-bin/batch/userid_to_openuserid');url.searchParams.set('access_token',token);
    const body=(await readWeComResponse(await fetchImpl(url,{method:'POST',redirect:'error',signal,
      headers:{'content-type':'application/json'},body:JSON.stringify({userid_list:c.reporterUserIds})}),signal)) as {errcode?:unknown;open_userid_list?:unknown;invalid_userid_list?:unknown} | null;
    signal.throwIfAborted();
    if(body?.errcode!==0||!Array.isArray(body.open_userid_list)||body.open_userid_list.length!==(c.reporterUserIds as string[]).length
      ||body.invalid_userid_list!==undefined&&(!Array.isArray(body.invalid_userid_list)||body.invalid_userid_list.length))throw Error('incomplete');
    const originals=new Map((c.reporterUserIds as string[]).map(id=>[id.toLowerCase(),id])),seen=new Set<string>(),reverse=new Map<string, InternalMemberId>();
    for(const row of body.open_userid_list as ({userid?:unknown;open_userid?:unknown}|null)[]){
      if(!validYxxUserId(row?.userid)||!validYxxUserId(row?.open_userid))throw Error('identity');
      const key=(row as {userid:string}).userid.toLowerCase(),original=originals.get(key);
      if(!original||seen.has(key)||reverse.has((row as { userid?: unknown; open_userid?: unknown; }).open_userid as string))throw Error('ambiguous');
      seen.add(key);reverse.set((row as { userid?: unknown; open_userid?: unknown; }).open_userid as string,original as InternalMemberId);
    }
    return Object.freeze({configHash:yxxIdentityConfigHash(c),resolve:(userid: OAuthMemberId)=>reverse.get(userid)??null});
  })();
  try{return await Promise.race([operation,deadline]);}catch{failYxx('UNAVAILABLE');}
  finally{controller.abort();clearTimeout(timer);}
}
