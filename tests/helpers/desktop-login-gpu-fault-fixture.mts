import assert from 'node:assert/strict';

export const loginGpuFaultModes=['no-khr','abort','context-loss','shader-link','timeout'] as const;
export type LoginGpuFaultMode=typeof loginGpuFaultModes[number];
const numberFields=['elapsedMs','khrRequests','completionQueries','draws','programsCreated','programsDeleted','programsLive','shadersCreated','shadersDeleted','shadersLive','nativeShadersChecked','nativeShadersLive','framebuffersCreated','framebuffersDeleted','framebuffersLive','targetFramebuffersCreated','targetFramebuffersDeleted','targetFramebuffersLive','contextOwnedFramebuffersLive','scratchFramebuffersCreated','scratchFramebuffersLive','nativeTargetFramebuffersChecked','nativeTargetFramebuffersLive','iframeCreates','maxIframes','presentedCalls','contextLostEvents','pendingPollTimers','iframeCount'] as const;
export type LoginGpuFaultSnapshot=Record<typeof numberFields[number],number>&{
  mode:LoginGpuFaultMode;khrAvailable:boolean|null;preparedCalls:unknown[];
  lossRequested:boolean;badShaderInjected:boolean;view:string|null;fallback:string|null;
  scene:string|null;preparationFailure:string|null;
  trustedPagehide?:boolean;sameIframe?:boolean;retryEnabled?:boolean;
};
function isSnapshot(value:unknown):value is LoginGpuFaultSnapshot{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const object:Record<string,unknown>={...value};
  return loginGpuFaultModes.some(mode=>mode===object.mode)
    &&numberFields.every(key=>typeof object[key]==='number'&&Number.isFinite(object[key])&&object[key]>=0)
    &&(object.khrAvailable===null||typeof object.khrAvailable==='boolean')&&Array.isArray(object.preparedCalls)
    &&['lossRequested','badShaderInjected'].every(key=>typeof object[key]==='boolean')
    &&['view','fallback','scene','preparationFailure'].every(key=>object[key]===null||typeof object[key]==='string')
    &&['trustedPagehide','sameIframe','retryEnabled'].every(key=>!(key in object)||typeof object[key]==='boolean');
}
export function readLoginGpuFaultSnapshot(value:unknown):LoginGpuFaultSnapshot{
  assert.ok(isSnapshot(value),'the browser must supply the bounded GPU preparation snapshot');return value;
}
export function assertLoginGpuFaultReleased(value:LoginGpuFaultSnapshot):void{
  assert.equal(value.pendingPollTimers,0,'cancelled preparation removes its polling timer');
  assert.equal(value.programsLive,0);assert.equal(value.programsDeleted,value.programsCreated);
  assert.ok(value.shadersCreated>0);assert.equal(value.shadersDeleted,value.shadersCreated,'each unique shader is marked for deletion before program disposal');
  assert.equal(value.shadersLive,0);assert.equal(value.nativeShadersChecked,value.shadersCreated);
  assert.equal(value.nativeShadersLive,0,'native GL confirms shader deletion after programs release');
  assert.ok(value.targetFramebuffersCreated>=2,'the fault reached actual PMREM output and internal targets');
  assert.equal(value.targetFramebuffersLive,0,'PMREM output and internal render targets are released');
  assert.equal(value.targetFramebuffersDeleted,value.targetFramebuffersCreated);
  assert.equal(value.nativeTargetFramebuffersChecked,value.targetFramebuffersCreated);
  assert.equal(value.nativeTargetFramebuffersLive,0,'native GL agrees that all observed target handles were deleted');
  // Three r186 creates three scratch FBOs in initGLContext, before assigning the
  // lanyard canvas class. They remain owned by the context until it is destroyed.
  assert.equal(value.scratchFramebuffersCreated,3);assert.equal(value.scratchFramebuffersLive,3);
  assert.equal(value.contextOwnedFramebuffersLive,3,'an unexplained extra framebuffer must still fail');
}

// Browser-only instrumentation is installed before the production module. It
// delegates actual GL calls, except the named negative capability/pending faults.
// No shader source, provider URL, credential or private startup lease is logged.
export function loginGpuFaultScript(mode:LoginGpuFaultMode):string{
  return GPU_FAULT_SCRIPT+'('+JSON.stringify(mode)+');';
}
const GPU_FAULT_SCRIPT=String.raw`(function installGpuPreparationFault(mode){
  Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined}); // existing login fixture: isolate Lanyard GL
  const p={mode,started:performance.now(),khrAvailable:null,khrRequests:0,completionQueries:0,draws:0,programsCreated:0,programsDeleted:0,programsLive:0,shadersCreated:0,shadersDeleted:0,shadersLive:0,framebuffersCreated:0,framebuffersDeleted:0,framebuffersLive:0,targetFramebuffersCreated:0,targetFramebuffersDeleted:0,targetFramebuffersLive:0,scratchFramebuffersCreated:0,scratchFramebuffersLive:0,iframeCreates:0,maxIframes:0,presentedCalls:0,preparedCalls:[],lossRequested:false,contextLostEvents:0,badShaderInjected:false,pendingPollTimers:0,present:null};
  window.__loginGpuFault=p;
  const shaderOwners=new WeakMap(),shaderHandles=[],programOwners=new WeakMap(),framebufferOwners=new WeakMap(),framebufferBindings=new WeakMap(),framebufferContexts=new WeakMap(),targetHandles=[];
  let lossQueued=false;
  const timeout=window.setTimeout.bind(window),clearTimeoutNative=window.clearTimeout.bind(window),pollTimers=new Set();
  window.setTimeout=function(callback,ms,...args){let id;const wrapped=typeof callback==='function'?function(...values){pollTimers.delete(id);return Reflect.apply(callback,this,values);}:callback;id=timeout(wrapped,ms,...args);if(Number(ms)===10)pollTimers.add(id);return id;};
  window.clearTimeout=function(id){pollTimers.delete(id);return clearTimeoutNative(id);};
  p.snapshot=()=>({mode:p.mode,elapsedMs:performance.now()-p.started,khrAvailable:p.khrAvailable,khrRequests:p.khrRequests,completionQueries:p.completionQueries,draws:p.draws,programsCreated:p.programsCreated,programsDeleted:p.programsDeleted,programsLive:p.programsLive,shadersCreated:p.shadersCreated,shadersDeleted:p.shadersDeleted,shadersLive:p.shadersLive,nativeShadersChecked:shaderHandles.filter(value=>value.context.deref()).length,nativeShadersLive:shaderHandles.filter(value=>value.context.deref()?.isShader(value.shader)).length,framebuffersCreated:p.framebuffersCreated,framebuffersDeleted:p.framebuffersDeleted,framebuffersLive:p.framebuffersLive,targetFramebuffersCreated:p.targetFramebuffersCreated,targetFramebuffersDeleted:p.targetFramebuffersDeleted,targetFramebuffersLive:p.targetFramebuffersLive,contextOwnedFramebuffersLive:p.framebuffersLive-p.targetFramebuffersLive,scratchFramebuffersCreated:p.scratchFramebuffersCreated,scratchFramebuffersLive:p.scratchFramebuffersLive,nativeTargetFramebuffersChecked:targetHandles.filter(value=>value.context.deref()).length,nativeTargetFramebuffersLive:targetHandles.filter(value=>value.context.deref()?.isFramebuffer(value.framebuffer)).length,iframeCreates:p.iframeCreates,maxIframes:p.maxIframes,preparedCalls:p.preparedCalls,presentedCalls:p.presentedCalls,lossRequested:p.lossRequested,contextLostEvents:p.contextLostEvents,badShaderInjected:p.badShaderInjected,pendingPollTimers:pollTimers.size,view:document.getElementById('desktop-login')?.dataset.view??null,fallback:document.getElementById('desktop-login')?.dataset.fallbackReason??null,scene:document.body?.dataset.loginScene??null,preparationFailure:document.querySelector('.lanyard')?.dataset.gpuPreparationFailure??null,iframeCount:document.querySelectorAll('#wecom-panel iframe').length});
  const wrap=(prototype,name,fn)=>{const original=prototype?.[name];if(typeof original==='function')prototype[name]=function(...args){return fn.call(this,original,args);};};
  for(const prototype of [globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype]){
    wrap(prototype,'getExtension',function(original,args){const value=Reflect.apply(original,this,args);if(args[0]==='KHR_parallel_shader_compile'){p.khrRequests++;p.khrAvailable=!!value;if(mode==='no-khr')return null;}return value;});
    wrap(prototype,'createShader',function(original,args){const value=Reflect.apply(original,this,args);if(value&&!shaderOwners.has(value)){shaderOwners.set(value,true);shaderHandles.push({context:new WeakRef(this),shader:value});p.shadersCreated++;p.shadersLive++;}return value;});
    wrap(prototype,'deleteShader',function(original,args){const result=Reflect.apply(original,this,args);if(args[0]&&shaderOwners.has(args[0])){shaderOwners.delete(args[0]);p.shadersDeleted++;p.shadersLive--;}return result;});
    wrap(prototype,'createProgram',function(original,args){const value=Reflect.apply(original,this,args);if(value){programOwners.set(value,true);p.programsCreated++;p.programsLive++;}return value;});
    wrap(prototype,'deleteProgram',function(original,args){if(args[0]&&programOwners.has(args[0])){programOwners.delete(args[0]);p.programsDeleted++;p.programsLive--;}return Reflect.apply(original,this,args);});
    wrap(prototype,'createFramebuffer',function(original,args){const value=Reflect.apply(original,this,args);if(value){let context=framebufferContexts.get(this);if(!context){context={created:0};framebufferContexts.set(this,context);}const scratch=context.created<3&&!String(this.canvas?.className??'').includes('lanyard-canvas');context.created++;framebufferOwners.set(value,{attached:false,scratch});p.framebuffersCreated++;p.framebuffersLive++;if(scratch){p.scratchFramebuffersCreated++;p.scratchFramebuffersLive++;}}return value;});
    wrap(prototype,'deleteFramebuffer',function(original,args){const item=args[0]&&framebufferOwners.get(args[0]);if(item){if(item.scratch)p.scratchFramebuffersLive--;if(item.attached){p.targetFramebuffersDeleted++;p.targetFramebuffersLive--;}framebufferOwners.delete(args[0]);p.framebuffersDeleted++;p.framebuffersLive--;}return Reflect.apply(original,this,args);});
    wrap(prototype,'bindFramebuffer',function(original,args){const value=Reflect.apply(original,this,args);let bound=framebufferBindings.get(this);if(!bound){bound={read:null,draw:null};framebufferBindings.set(this,bound);}if(args[0]===this.FRAMEBUFFER)bound.read=bound.draw=args[1];else if(args[0]===this.READ_FRAMEBUFFER)bound.read=args[1];else if(args[0]===this.DRAW_FRAMEBUFFER)bound.draw=args[1];return value;});
    for(const [name,resourceIndex]of [['framebufferTexture2D',3],['framebufferTextureLayer',2],['framebufferRenderbuffer',3]])wrap(prototype,name,function(original,args){const value=Reflect.apply(original,this,args);if(args[resourceIndex]){const bound=framebufferBindings.get(this),framebuffer=args[0]===this.READ_FRAMEBUFFER?bound?.read:bound?.draw,item=framebuffer&&framebufferOwners.get(framebuffer);if(item&&!item.scratch&&!item.attached){item.attached=true;p.targetFramebuffersCreated++;p.targetFramebuffersLive++;targetHandles.push({context:new WeakRef(this),framebuffer});}}return value;});
    wrap(prototype,'getProgramParameter',function(original,args){
      // This enum is the real KHR completion flag. Pending is injected only in
      // explicit abort/deadline faults; successful normal compilation is never faked.
      if(args[1]===0x91b1){p.completionQueries++;
        if(mode==='abort'||mode==='timeout')return false;
        if(mode==='context-loss'&&!lossQueued){lossQueued=true;const context=this;queueMicrotask(()=>{const ext=context.getExtension('WEBGL_lose_context');if(!ext)throw Error('SYNTHETIC_WEBGL_LOSE_CONTEXT_REQUIRED');p.lossRequested=true;ext.loseContext();});}
      }
      return Reflect.apply(original,this,args);
    });
    wrap(prototype,'shaderSource',function(original,args){if(mode==='shader-link'&&!p.badShaderInjected){p.badShaderInjected=true;return Reflect.apply(original,this,[args[0],args[1]+'\n#error SYNTHETIC_SHADER_COMPILE_FAILURE\n']);}return Reflect.apply(original,this,args);});
    for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(prototype,name,function(original,args){p.draws++;return Reflect.apply(original,this,args);});
  }
  document.addEventListener('webglcontextlost',()=>{p.contextLostEvents++;},true);
  const create=document.createElement.bind(document);
  document.createElement=function(name,...args){const value=create(name,...args);if(String(name).toLowerCase()==='iframe')p.iframeCreates++;return value;};
  new MutationObserver(()=>{p.maxIframes=Math.max(p.maxIframes,document.querySelectorAll('#wecom-panel iframe').length);}).observe(document,{subtree:true,childList:true});
  window.workbenchLogin={version:1,getAppVersion:async()=>'0.1.18-synthetic',quit:async()=>{},startup:{version:1,connect:async()=>{},prepared:async value=>{p.preparedCalls.push(value);return{presented:false};},onPresented:callback=>{p.present=()=>{p.presentedCalls++;callback();};return()=>{p.present=null;};}}};
  window.addEventListener('pagehide',event=>{queueMicrotask(()=>{const proof={...p.snapshot(),trustedPagehide:event.isTrusted};try{navigator.sendBeacon('/gpu-proof',new Blob([JSON.stringify(proof)],{type:'application/json'}));}catch{}});});
})`;


const reducedManualNumbers=['draws','physicsFrames','textureUploads','lateVersionUploads','latePaints','iframeCreates','iframeCount'] as const;
interface ReducedManualCard{x:number;y:number;onScreen:boolean;}
export type ReducedManualSnapshot=Record<typeof reducedManualNumbers[number],number>&{
  card:ReducedManualCard;backFacing:boolean;hidden:boolean;sameIframe:boolean;
  scene:string;fonts:string;view:string;
};
function isReducedManualCard(value:unknown):value is ReducedManualCard{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const object:Record<string,unknown>={...value};
  return typeof object.x==='number'&&Number.isFinite(object.x)&&typeof object.y==='number'&&Number.isFinite(object.y)&&typeof object.onScreen==='boolean';
}
function isReducedManualSnapshot(value:unknown):value is ReducedManualSnapshot{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const object:Record<string,unknown>={...value};
  return isReducedManualCard(object.card)
    &&reducedManualNumbers.every(key=>typeof object[key]==='number'&&Number.isSafeInteger(object[key])&&object[key]>=0)
    &&['backFacing','hidden','sameIframe'].every(key=>typeof object[key]==='boolean')
    &&['scene','fonts','view'].every(key=>typeof object[key]==='string');
}
export function readReducedManualSnapshot(value:unknown):ReducedManualSnapshot{
  assert.ok(isReducedManualSnapshot(value),'the prepared manual fallback must supply bounded native draw and public card observations');return value;
}
// This new browser owns its explicit media emulation. It does not change the
// default desktop preference, startup playback, or any other test's document.
// Native calls are delegated, and dragging positively validates the RAF probe.
export function loginReducedManualScript():string{return REDUCED_MANUAL_SCRIPT;}
const REDUCED_MANUAL_SCRIPT=String.raw`(function installDemandProbe(){
 Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});
 const p={pointerId:null,draws:0,physicsFrames:0,textureUploads:0,lateVersionUploads:0,latePaints:0,iframeCreates:0,lateCanvas:null,hidden:false,resolveVersion:null};
 window.__demand=p;
 Object.defineProperty(document,'hidden',{configurable:true,get:()=>p.hidden});
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>p.hidden?'hidden':'visible'});
 const nativeRAF=window.requestAnimationFrame.bind(window);
 window.requestAnimationFrame=function(callback){const physical=String(callback).includes('1/240')&&String(callback).includes('2600');return nativeRAF(now=>{if(physical)p.physicsFrames++;return callback(now);});};
 const wrapped=new WeakSet();
 const wrap=(owner,name,observe)=>{const original=owner?.[name];if(typeof original!=='function'||wrapped.has(original))return;const value=function(...args){return observe.call(this,original,args);};wrapped.add(value);owner[name]=value;};
 for(const prototype of [globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype]){
  for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])wrap(prototype,name,function(original,args){if(String(this.canvas?.className??'').includes('lanyard-canvas'))p.draws++;return Reflect.apply(original,this,args);});
  for(const name of ['texImage2D','texSubImage2D'])wrap(prototype,name,function(original,args){if(String(this.canvas?.className??'').includes('lanyard-canvas')){p.textureUploads++;if(p.lateCanvas&&args.some(value=>value===p.lateCanvas))p.lateVersionUploads++;}return Reflect.apply(original,this,args);});
 }
 wrap(CanvasRenderingContext2D.prototype,'fillText',function(original,args){if(args[0]==='v0.1.18-demand'){p.latePaints++;p.lateCanvas=this.canvas;}return Reflect.apply(original,this,args);});
 const create=document.createElement.bind(document);document.createElement=function(name,...args){if(String(name).toLowerCase()==='iframe')p.iframeCreates++;return create(name,...args);};
 window.workbenchLogin={version:1,getAppVersion:()=>new Promise(resolve=>{p.resolveVersion=resolve;}),quit:async()=>{}};
 p.card=()=>{const layer=document.querySelector('.lanyard-interaction');if(!layer)return null;const points=[...layer.style.clipPath.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(value=>({x:Number(value[1]),y:Number(value[2])}));if(points.length!==4)return null;const x=points.reduce((sum,p)=>sum+p.x,0)/4,y=points.reduce((sum,p)=>sum+p.y,0)/4;return{x,y,onScreen:x>0&&x<innerWidth&&y>0&&y<innerHeight&&document.elementFromPoint(x,y)===layer};};
 document.addEventListener('pointerdown',event=>{p.pointerId=event.pointerId;},true);
 p.snapshot=()=>({card:p.card(),backFacing:document.querySelector('.lanyard-front')?.getAttribute('aria-hidden')==='true',draws:p.draws,physicsFrames:p.physicsFrames,textureUploads:p.textureUploads,lateVersionUploads:p.lateVersionUploads,latePaints:p.latePaints,iframeCreates:p.iframeCreates,iframeCount:document.querySelectorAll('#wecom-panel iframe').length,hidden:document.hidden,scene:document.body?.dataset.loginScene,fonts:document.fonts.status,view:document.getElementById('desktop-login')?.dataset.view,sameIframe:window.__demandIframe===document.querySelector('#wecom-panel iframe')});
})();`;
