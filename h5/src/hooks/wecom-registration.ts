import {api,authLost} from '../api/client';
import type {Bootstrap} from '../api/types';
type Wecom=typeof import('../lib/wecom');
let activeScope:string|null=null;
let generation=0;
const registrations=new Map<string,Promise<Wecom>>();
const controllers=new Map<string,AbortController>();
const jsApiList=['startRecord','stopRecord','onVoiceRecordEnd','playVoice','stopVoice','uploadVoice','translateVoice','chooseImage','uploadImage','getLocalImgData'];
const clear=()=>{for(const controller of controllers.values())controller.abort();controllers.clear();activeScope=null;generation+=1;registrations.clear();};
authLost.addEventListener('lost',clear);authLost.addEventListener('scope-change',clear);

/** Only an in-memory, current-member registration is shared; provider eligibility is never cached. */
export function registeredWecom(bootstrap:Bootstrap):Promise<Wecom>{
 const {sdk}=bootstrap.h5;
 if(!sdk.enabled||!sdk.corp_id||!/wxwork/i.test(navigator.userAgent))return Promise.reject(new Error('voiceUnavailable'));
 const scope=bootstrap.recovery_scope;
 if(activeScope!==scope){clear();activeScope=scope;}
 const turn=generation;
 const signatureURL=location.href.split('#')[0]??location.href;
 const key=JSON.stringify([scope,sdk.corp_id,sdk.agent_id,signatureURL]);
 const existing=registrations.get(key);if(existing)return existing;
 const corpId=sdk.corp_id,agentId=sdk.agent_id,csrf=bootstrap.csrf_token,controller=new AbortController();controllers.set(key,controller);
 let signatureQueue:Promise<void>=Promise.resolve();
 const signature=(url:string,kind:'CORP'|'AGENT')=>{
  const work=signatureQueue.then(()=>{
   if(controller.signal.aborted||activeScope!==scope||generation!==turn)throw new DOMException('Member scope changed','AbortError');
   return api.signature(url,kind,csrf,controller.signal);
  });
  signatureQueue=work.then(()=>undefined,()=>undefined);return work;
 };
 const pending=import('../lib/wecom').then(async ww=>{
  if(activeScope!==scope||generation!==turn)throw new DOMException('Member scope changed','AbortError');
  ww.register({corpId,...(agentId?{agentId}:{}),jsApiList,
   // register() can start AGENT configuration itself. Serialize its signature callbacks too.
   getConfigSignature:url=>signature(url,'CORP'),
   getAgentConfigSignature:url=>signature(url,'AGENT'),
  });
  await ww.ensureCorpConfigReady();
  if(agentId)await ww.ensureAgentConfigReady();
  if(activeScope!==scope||generation!==turn)throw new DOMException('Member scope changed','AbortError');
  return ww;
 });
 registrations.set(key,pending);
 void pending.catch(()=>{if(registrations.get(key)===pending){registrations.delete(key);controllers.delete(key);controller.abort();}});
 return pending;
}
