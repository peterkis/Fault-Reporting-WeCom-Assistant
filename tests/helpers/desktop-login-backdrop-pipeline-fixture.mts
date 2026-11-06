import assert from 'node:assert/strict';
import WebSocket from 'ws';


type ProviderCommand=(method:string,params?:Record<string,unknown>,sessionId?:string|null)=>Promise<unknown>;
const neutralProviderHtml='<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic provider container</title><body data-synthetic-provider="neutral"></body></html>';
/** A single endpoint fixture, not a replacement SDK or an authentication source. */
export function createNeutralProviderFixture(){
 let socket:WebSocket|null=null,command:ProviderCommand|null=null,closed=false,failure:Error|null=null,fulfilledDocuments=0,blockedRequests=0;
 const liveSessions=new Set<string>(),ownedIframeSessions=new Set<string>(),detachedSessions=new Set<string>(),retiredSessions=new Set<string>(),retiredOperations:{operation:string;source:string}[]=[],tasks=new Set<Promise<void>>();
 const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?{...value}:null;
 const patterns=[{urlPattern:'https://login.work.weixin.qq.com/wwlogin/sso/login*',resourceType:'Document',requestStage:'Request'},{urlPattern:'https://login.work.weixin.qq.com/*',requestStage:'Request'}];
 const call=async(method:string,params:Record<string,unknown>,sessionId:string|null)=>{if(!command||closed)throw Error('NEUTRAL_PROVIDER_NOT_ACTIVE');return command(method,params,sessionId);};
 const iframeOperation=async(method:string,params:Record<string,unknown>,sessionId:string):Promise<boolean>=>{
  try{await call(method,params,sessionId);return true;}catch(error){
   if(!ownedIframeSessions.has(sessionId)||!(error instanceof Error)||error.message!=='Session with given id not found.')throw error;
   let source='detached-event';
   if(!detachedSessions.has(sessionId)){
    // Confirm retirement through a read-only session command; a still-usable
    // session or an unrelated root/transport error remains a real fixture failure.
    try{await call('Runtime.getIsolateId',{},sessionId);}catch(confirm){
     if(!(confirm instanceof Error)||confirm.message!=='Session with given id not found.')throw confirm;
     source=detachedSessions.has(sessionId)?'detached-event':'authoritative-session-not-found';
     liveSessions.delete(sessionId);retiredSessions.add(sessionId);if(retiredOperations.length<16)retiredOperations.push({operation:method,source});return false;
    }
    throw error;
   }
   liveSessions.delete(sessionId);retiredSessions.add(sessionId);if(retiredOperations.length<16)retiredOperations.push({operation:method,source});return false;
  }
 };
 const handle=async(value:unknown)=>{
  const event=record(value);if(!event||typeof event.method!=='string')return;const params=record(event.params);if(!params)return;
  if(event.method==='Target.attachedToTarget'){
   const id=params.sessionId,info=record(params.targetInfo);if(typeof id!=='string'||!info)return;liveSessions.add(id);
   if(info.type==='iframe'){ownedIframeSessions.add(id);if(await iframeOperation('Fetch.enable',{patterns},id)&&liveSessions.has(id))await iframeOperation('Runtime.runIfWaitingForDebugger',{},id);}
   else if(liveSessions.has(id))await call('Runtime.runIfWaitingForDebugger',{},id);
   return;
  }
  if(event.method==='Target.detachedFromTarget'){if(typeof params.sessionId==='string'){liveSessions.delete(params.sessionId);detachedSessions.add(params.sessionId);}return;}
  if(event.method!=='Fetch.requestPaused')return;
  const request=record(params.request),id=params.requestId,sessionId=typeof event.sessionId==='string'?event.sessionId:null;
  if(!request||typeof id!=='string'||typeof request.url!=='string')throw Error('NEUTRAL_PROVIDER_REQUEST_INVALID');
  let allowed=false;try{const url=new URL(request.url);allowed=params.resourceType==='Document'&&request.method==='GET'&&url.origin==='https://login.work.weixin.qq.com'&&url.pathname==='/wwlogin/sso/login'&&!url.username&&!url.password;}catch{}
  const operation=async(method:string,body:Record<string,unknown>)=>{if(sessionId===null){await call(method,body,null);return true;}return iframeOperation(method,body,sessionId);};
  if(allowed){const completed=await operation('Fetch.fulfillRequest',{requestId:id,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'},{name:'Cache-Control',value:'no-store'},{name:'Content-Security-Policy',value:"default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"},{name:'X-Content-Type-Options',value:'nosniff'}],body:Buffer.from(neutralProviderHtml,'utf8').toString('base64')});if(completed)fulfilledDocuments++;}
  else{const completed=await operation('Fetch.failRequest',{requestId:id,errorReason:'BlockedByClient'});if(completed)blockedRequests++;}
 };
 const onMessage=(event:WebSocket.MessageEvent)=>{
  let value:unknown;try{value=JSON.parse(String(event.data)) as unknown;}catch{return;}
  const task=handle(value).catch(error=>{if(!closed)failure=error instanceof Error?error:Error('NEUTRAL_PROVIDER_EVENT_FAILED');});tasks.add(task);void task.finally(()=>tasks.delete(task));
 };
 return {
  socketFactory(address:string){assert.equal(socket,null);socket=new WebSocket(address);socket.addEventListener('message',onMessage);return socket;},
  async install(execute:ProviderCommand){assert.equal(command,null);command=execute;await call('Fetch.enable',{patterns},null);await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},null);},
  assertHealthy(){if(failure)throw failure;assert.ok(fulfilledDocuments>0,'the actual SDK iframe document must be fulfilled by the neutral endpoint fixture');},
  receipt(){return {kind:'NEUTRAL_PROVIDER_DOCUMENT_ONLY',fulfilledDocuments,blockedRequests,pendingHandlers:tasks.size,retiredIframeSessions:retiredSessions.size,retiredOperations,callbackScript:false,qrContent:false,realProvider:false};},
  dispose(){closed=true;socket?.removeEventListener('message',onMessage);socket=null;command=null;liveSessions.clear();}
 };
}


export const backdropPipelineModes=['normal','reject','held','lifecycle','destroy'] as const;
export type BackdropPipelineMode=typeof backdropPipelineModes[number];
const numbers=['elapsedMs','adapterRequests','devices','asyncRequests','nativeFulfilled','returnedFulfilled','asyncRejected','pendingReturned','syncRequests','submits','submitsWhilePending','submitsAfterPagehide','shaderTransitions','fallbackTransitions','iframeCreates','iframeCount','rafRequested','rafCancelled','rafPending','rafAfterPagehide','canvasWidth','canvasHeight','maxSubmittedPixels','firstSubmitSequence','lastAsyncReturnSequence','deviceRequests','nativeDeviceFulfilled','pendingDeviceReturns','deviceReturns','deviceReleaseSequence','nativeCanvasConfigurations','syncRejected'] as const;
export type BackdropPipelineSnapshot=Record<typeof numbers[number],number>&{
 mode:BackdropPipelineMode;deviceHeld:boolean;available:boolean;pageHidden:boolean;hidden:boolean;online:boolean;
 backdrop:string|null;reason:string|null;scene:string|null;blob:string|null;
 prepared:unknown[];events:unknown[];sameIframe:boolean;
};
function isSnapshot(value:unknown):value is BackdropPipelineSnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const object:Record<string,unknown>={...value};
 return backdropPipelineModes.some(mode=>object.mode===mode)&&numbers.every(key=>typeof object[key]==='number'&&Number.isFinite(object[key])&&object[key]>=0)
  &&['deviceHeld','available','pageHidden','hidden','online','sameIframe'].every(key=>typeof object[key]==='boolean')
  &&['backdrop','reason','scene','blob'].every(key=>object[key]===null||typeof object[key]==='string')
  &&Array.isArray(object.prepared)&&object.prepared.length<=4&&Array.isArray(object.events)&&object.events.length<=96;
}
export function readBackdropPipelineSnapshot(value:unknown):BackdropPipelineSnapshot{assert.ok(isSnapshot(value),'the native background observer supplies a bounded public snapshot');return value;}

/** Observes public GPU APIs; only the named sync fault throws after real native creation. */
export function backdropPipelineScript(mode:BackdropPipelineMode):string{return PIPELINE_SCRIPT+'('+JSON.stringify(mode)+');';}
const PIPELINE_SCRIPT=String.raw`(function installBackdropPipelineObserver(initialMode){
 const selected=sessionStorage.getItem('backdrop-pipeline-test-mode'),mode=['normal','reject','held','lifecycle','destroy'].includes(selected)?selected:initialMode;
 const p={mode,started:performance.now(),available:!!navigator.gpu&&typeof GPUDevice==='function'&&typeof GPUQueue==='function',adapterRequests:0,devices:[],asyncRequests:0,nativeFulfilled:0,returnedFulfilled:0,asyncRejected:0,pendingReturned:0,syncRequests:0,submits:0,submitsWhilePending:0,submitsAfterPagehide:0,shaderTransitions:0,fallbackTransitions:0,iframeCreates:0,prepared:[],events:[],sequence:0,deviceHeld:true,deviceReleases:[],deviceRequests:0,nativeDeviceFulfilled:0,pendingDeviceReturns:0,deviceReturns:0,deviceReleaseSequence:0,nativeCanvasConfigurations:0,syncRejected:0,pageHidden:false,rafRequested:0,rafCancelled:0,rafAfterPagehide:0,maxSubmittedPixels:0,firstSubmitSequence:0,lastAsyncReturnSequence:0,present:null,savedIframe:null};window.__backdropPipeline=p;
 const record=kind=>{const value={sequence:++p.sequence,kind,at:performance.now()-p.started};if(p.events.length<96)p.events.push(value);return value.sequence;};
 const nativeRaf=window.requestAnimationFrame.bind(window),nativeCancel=window.cancelAnimationFrame.bind(window),frames=new Set();
 window.requestAnimationFrame=function(callback){p.rafRequested++;let id=0;id=nativeRaf(function(now){frames.delete(id);if(p.pageHidden)p.rafAfterPagehide++;return Reflect.apply(callback,this,[now]);});frames.add(id);return id;};
 window.cancelAnimationFrame=function(id){if(frames.delete(id))p.rafCancelled++;return nativeCancel(id);};
 p.twoFrames=()=>new Promise(resolve=>nativeRaf(()=>nativeRaf(resolve)));
 p.releaseDevice=()=>{p.deviceHeld=false;for(const release of p.deviceReleases.splice(0))release();};
 p.afterDelivery=()=>new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);}).then(()=>p.twoFrames());
 p.setHidden=value=>{if(value){Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});}else{delete document.hidden;delete document.visibilityState;}document.dispatchEvent(new Event('visibilitychange'));};
 p.setOnline=value=>{if(value)delete navigator.onLine;else Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event(value?'online':'offline'));};
 const adapter=navigator.gpu?.requestAdapter?.bind(navigator.gpu);if(adapter)navigator.gpu.requestAdapter=function(...args){p.adapterRequests++;return adapter(...args);};
 const requestDevice=globalThis.GPUAdapter?.prototype.requestDevice;if(requestDevice)GPUAdapter.prototype.requestDevice=function(...args){p.deviceRequests++;record('device-request');return Reflect.apply(requestDevice,this,args).then(device=>{p.devices.push(device);p.nativeDeviceFulfilled++;p.pendingDeviceReturns++;record('native-device-fulfilled');return new Promise(resolve=>{const release=()=>{p.pendingDeviceReturns--;p.deviceReturns++;p.deviceReleaseSequence=record('device-returned');resolve(device);};if(p.deviceHeld)p.deviceReleases.push(release);else release();});});};
 const configure=globalThis.GPUCanvasContext?.prototype.configure;if(configure)GPUCanvasContext.prototype.configure=function(...args){const result=Reflect.apply(configure,this,args);if(String(this.canvas?.className??'').includes('login-blob')){p.nativeCanvasConfigurations++;record('canvas-configured');}return result;};
 const asyncFactory=globalThis.GPUDevice?.prototype.createRenderPipelineAsync;if(asyncFactory)GPUDevice.prototype.createRenderPipelineAsync=function(...args){
  p.asyncRequests++;p.pendingReturned++;record('async-request');let native;
  try{native=Reflect.apply(asyncFactory,this,args);}catch(error){p.pendingReturned--;p.asyncRejected++;record('async-rejected');throw error;}
  return native.then(pipeline=>{p.nativeFulfilled++;p.pendingReturned--;p.returnedFulfilled++;p.lastAsyncReturnSequence=record('async-returned');return pipeline;},error=>{p.pendingReturned--;p.asyncRejected++;record('async-rejected');throw error;});
 };
 const syncFactory=globalThis.GPUDevice?.prototype.createRenderPipeline;if(syncFactory)GPUDevice.prototype.createRenderPipeline=function(...args){p.syncRequests++;record('sync-request');const pipeline=Reflect.apply(syncFactory,this,args);if(mode==='reject'){p.syncRejected++;record('sync-rejected');throw Error('SYNTHETIC_NATIVE_RENDER_PIPELINE_FAILURE');}return pipeline;};
 const submit=globalThis.GPUQueue?.prototype.submit;if(submit)GPUQueue.prototype.submit=function(...args){
  p.submits++;if(p.deviceHeld||p.pendingDeviceReturns>0)p.submitsWhilePending++;if(p.pageHidden)p.submitsAfterPagehide++;
  const canvas=document.querySelector('.login-blob');if(canvas)p.maxSubmittedPixels=Math.max(p.maxSubmittedPixels,canvas.width*canvas.height);
  const sequence=record('submit');if(!p.firstSubmitSequence)p.firstSubmitSequence=sequence;return Reflect.apply(submit,this,args);
 };
 const create=document.createElement.bind(document);document.createElement=function(name,...args){if(String(name).toLowerCase()==='iframe')p.iframeCreates++;return create(name,...args);};
 let lastBackdrop=null;const observer=new MutationObserver(()=>{const next=document.body?.dataset.backdrop??null;if(next===lastBackdrop)return;lastBackdrop=next;if(next==='shader'){p.shaderTransitions++;record('shader');}else if(next==='fallback'){p.fallbackTransitions++;record('fallback');}});observer.observe(document,{subtree:true,attributes:true,childList:true,attributeFilter:['data-backdrop']});
 window.workbenchLogin={version:1,getAppVersion:async()=>'0.1.18-backdrop-synthetic',quit:async()=>{},startup:{version:1,connect:async()=>{},prepared:async value=>{if(p.prepared.length<4)p.prepared.push(value);record('prepared');return{presented:false};},onPresented:callback=>{p.present=()=>{record('presented');callback();};return()=>{p.present=null;};}}};
 p.snapshot=()=>({mode:p.mode,deviceHeld:p.deviceHeld,deviceRequests:p.deviceRequests,nativeDeviceFulfilled:p.nativeDeviceFulfilled,pendingDeviceReturns:p.pendingDeviceReturns,deviceReturns:p.deviceReturns,deviceReleaseSequence:p.deviceReleaseSequence,nativeCanvasConfigurations:p.nativeCanvasConfigurations,syncRejected:p.syncRejected,available:p.available,elapsedMs:performance.now()-p.started,adapterRequests:p.adapterRequests,devices:p.devices.length,asyncRequests:p.asyncRequests,nativeFulfilled:p.nativeFulfilled,returnedFulfilled:p.returnedFulfilled,asyncRejected:p.asyncRejected,pendingReturned:p.pendingReturned,syncRequests:p.syncRequests,submits:p.submits,submitsWhilePending:p.submitsWhilePending,submitsAfterPagehide:p.submitsAfterPagehide,shaderTransitions:p.shaderTransitions,fallbackTransitions:p.fallbackTransitions,iframeCreates:p.iframeCreates,iframeCount:document.querySelectorAll('#wecom-panel iframe').length,prepared:p.prepared,events:p.events,pageHidden:p.pageHidden,hidden:document.hidden,online:navigator.onLine,rafRequested:p.rafRequested,rafCancelled:p.rafCancelled,rafPending:frames.size,rafAfterPagehide:p.rafAfterPagehide,canvasWidth:document.querySelector('.login-blob')?.width??0,canvasHeight:document.querySelector('.login-blob')?.height??0,maxSubmittedPixels:p.maxSubmittedPixels,firstSubmitSequence:p.firstSubmitSequence,lastAsyncReturnSequence:p.lastAsyncReturnSequence,backdrop:document.body?.dataset.backdrop??null,reason:document.body?.dataset.backdropReason??null,scene:document.body?.dataset.loginScene??null,blob:document.querySelector('[data-blob-state]')?.dataset.blobState??null,sameIframe:p.savedIframe!==null&&p.savedIframe===document.querySelector('#wecom-panel iframe')});
 window.addEventListener('pagehide',event=>{p.pageHidden=true;record('pagehide');queueMicrotask(()=>{try{navigator.sendBeacon('/backdrop-pipeline-proof',new Blob([JSON.stringify({...p.snapshot(),trustedPagehide:event.isTrusted})],{type:'application/json'}));}catch{}});});
})`;
