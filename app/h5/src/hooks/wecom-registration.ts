import {api,authLost} from '../api/client';
import type {Bootstrap} from '../api/types';
type Wecom=typeof import('../lib/wecom');
export interface NativeCaptureWork {stop:()=>Promise<string|null>;end:(localId:string)=>void}
/** The device operation, unlike its page waiter, survives navigation and scope changes. */
export const nativeCapture:{current:NativeCaptureWork|null}={current:null};
let activeScope:string|null=null;
let generation=0;
const registrations=new Map<string,Promise<Wecom>>();
const controllers=new Map<string,AbortController>();
let playEndSdk:Wecom|null=null;
let nativePreview:{sdk:Wecom;localId:string}|null=null;
const nativeStops=new Map<string,{sdk:Wecom;pending:Promise<unknown>;failed:boolean}>();
const jsApiList=['startRecord','stopRecord','onVoiceRecordEnd','playVoice','stopVoice','onVoicePlayEnd','uploadVoice','translateVoice','chooseImage','uploadImage','getLocalImgData'];
// Device work already dispatched survives controller/member lifetimes until its actual ACK settles.
const clear=()=>{for(const controller of controllers.values())controller.abort();controllers.clear();activeScope=null;generation+=1;registrations.clear();};
authLost.addEventListener('lost',clear);authLost.addEventListener('scope-change',clear);
export function markNativePreview(sdk:Wecom,localId:string){nativePreview={sdk,localId};}
export function hasNativePreviewWork(){return nativePreview!==null||nativeStops.size>0;}
export function stopNativePreview(localId:string){
 const old=nativeStops.get(localId),preview=nativePreview?.localId===localId?nativePreview:null,sdk=old?.sdk??preview?.sdk;if(!sdk||old&&!old.failed)return;
 const task={sdk,pending:Promise.resolve().then(()=>sdk.stopVoice({localId})),failed:false};nativeStops.set(localId,task);
 void task.pending.then(()=>{if(nativeStops.get(localId)===task)nativeStops.delete(localId);if(nativePreview===preview)nativePreview=null;},()=>{task.failed=true;});
}
export function waitNativePreviewStops(signal:AbortSignal):Promise<void>{
 if(nativePreview)stopNativePreview(nativePreview.localId);for(const [id,task]of nativeStops)if(task.failed)stopNativePreview(id);
 const tasks=[...nativeStops.values()].map(task=>task.pending);if(!tasks.length)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let done=false;const finish=(ok:boolean,reason?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);if(ok)resolve();else reject(reason);};
  const cancel=()=>finish(false,new DOMException('Aborted','AbortError')),timer=setTimeout(()=>finish(false,new Error('previewStopTimeout')),5000);
  signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();void Promise.all(tasks).then(()=>finish(true),reason=>finish(false,reason));
 });
}

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
  await ww.ensureConfigReady();
  if(activeScope!==scope||generation!==turn)throw new DOMException('Member scope changed','AbortError');
  if(playEndSdk!==ww){playEndSdk=ww;ww.onVoicePlayEnd(event=>{if(nativePreview?.localId===event.localId)nativePreview=null;});}
  return ww;
 });
 registrations.set(key,pending);
 void pending.catch(()=>{if(registrations.get(key)===pending){registrations.delete(key);controllers.delete(key);controller.abort();}});
 return pending;
}
