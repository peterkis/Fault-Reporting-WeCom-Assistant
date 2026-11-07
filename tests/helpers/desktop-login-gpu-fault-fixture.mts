import assert from 'node:assert/strict';

export const loginGpuFaultModes=['no-khr','abort','context-loss','shader-link','timeout'] as const;
export type LoginGpuFaultMode=typeof loginGpuFaultModes[number];
type LoginGpuProbeMode=LoginGpuFaultMode|'normal';
const numberFields=['elapsedMs','khrRequests','completionQueries','draws','programsCreated','programsDeleted','programsLive','shadersCreated','shadersDeleted','shadersLive','nativeShadersChecked','nativeShadersLive','framebuffersCreated','framebuffersDeleted','framebuffersLive','targetFramebuffersCreated','targetFramebuffersDeleted','targetFramebuffersLive','contextOwnedFramebuffersLive','scratchFramebuffersCreated','scratchFramebuffersLive','nativeTargetFramebuffersChecked','nativeTargetFramebuffersLive','iframeCreates','maxIframes','presentedCalls','contextLostEvents','pendingPollTimers','iframeCount','dataTextureFlagAssignments','environmentCpuHalfWords','environmentFetches','environmentDigests','environmentDigestSettled','environmentObjectsCreated','environmentObjectsDisposed','environmentCpuBytes','managedTexturesCreated','managedTexturesDeleted','managedTexturesLive','nativeManagedTexturesChecked','nativeManagedTexturesLive','environmentTexturesCreated','environmentTexturesDeleted','environmentTexturesLive','environmentUploads','nativeEnvironmentTexturesChecked','nativeEnvironmentTexturesLive','applicationTexturesCreated','applicationTexturesDeleted','applicationTexturesLive','nativeApplicationTexturesChecked','nativeApplicationTexturesLive','dfgTexturesCreated','dfgTexturesDeleted','dfgTexturesLive','dfgTextureBytes','dfgCpuObjects','dfgCpuBytes','nativeDfgTexturesChecked','nativeDfgTexturesLive','contextDefaultTexturesCreated','contextDefaultTexturesDeleted','contextDefaultTexturesLive','nativeContextDefaultTexturesChecked','nativeContextDefaultTexturesLive'] as const;
export type LoginGpuFaultSnapshot=Record<typeof numberFields[number],number>&{
  mode:LoginGpuProbeMode;khrAvailable:boolean|null;preparedCalls:unknown[];
  lossRequested:boolean;badShaderInjected:boolean;view:string|null;fallback:string|null;
  scene:string|null;preparationFailure:string|null;
  trustedPagehide?:boolean;prototypeRestored?:boolean;sameIframe?:boolean;retryEnabled?:boolean;
};
function isSnapshot(value:unknown):value is LoginGpuFaultSnapshot{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const object:Record<string,unknown>={...value};
  return (object.mode==='normal'||loginGpuFaultModes.some(mode=>mode===object.mode))
    &&numberFields.every(key=>typeof object[key]==='number'&&Number.isFinite(object[key])&&object[key]>=0)
    &&(object.khrAvailable===null||typeof object.khrAvailable==='boolean')&&Array.isArray(object.preparedCalls)
    &&['lossRequested','badShaderInjected'].every(key=>typeof object[key]==='boolean')
    &&['view','fallback','scene','preparationFailure'].every(key=>object[key]===null||typeof object[key]==='string')
    &&['trustedPagehide','prototypeRestored','sameIframe','retryEnabled'].every(key=>!(key in object)||typeof object[key]==='boolean');
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
  assert.equal(value.environmentFetches,1,'preparation reads the one versioned environment asset');
  assert.equal(value.environmentDigests,2,'compressed and uncompressed environment payloads pass the actual integrity seam');
  assert.equal(value.environmentDigestSettled,2);
  assert.equal(value.environmentObjectsCreated,1,'the exact HalfFloat DataTexture was constructed before shader preparation');
  assert.equal(value.environmentObjectsDisposed,1,'the real texture emits disposal on cancellation or teardown');
  assert.equal(value.environmentCpuBytes,0,'disposed environment releases its actual CPU image.data');
  // Three r186 owns one module-global DFG_LUT after real first use. Identify
  // that native ID only through the exact CPU object/data/upload contract below;
  // it is not an application-owned texture and is not reported as released.
  const firstUsed=value.environmentUploads>0,dfgCount=firstUsed?1:0;
  if(firstUsed)assert.equal(value.applicationTexturesCreated,6,'five card textures and the exact environment are all accounted for');
  assert.equal(value.applicationTexturesDeleted,value.applicationTexturesCreated);assert.equal(value.applicationTexturesLive,0);
  assert.equal(value.nativeApplicationTexturesChecked,value.applicationTexturesCreated);assert.equal(value.nativeApplicationTexturesLive,0,'native GL confirms deletion of every application-owned texture');
  assert.equal(value.dfgTexturesCreated,dfgCount);assert.equal(value.dfgTexturesDeleted,0);assert.equal(value.dfgTexturesLive,dfgCount);
  assert.equal(value.dfgTextureBytes,dfgCount*1024);assert.equal(value.dfgCpuObjects,dfgCount);assert.equal(value.dfgCpuBytes,dfgCount*1024);
  assert.equal(value.nativeDfgTexturesChecked,dfgCount);assert.equal(value.nativeDfgTexturesLive,value.contextLostEvents>0?0:dfgCount,'the fixed library LUT remains context-owned until that context is lost or destroyed');
  assert.equal(value.managedTexturesCreated,value.applicationTexturesCreated+value.dfgTexturesCreated,'the old canvas-class total permits no unclassified extra texture');
  assert.equal(value.managedTexturesDeleted,value.applicationTexturesDeleted+value.dfgTexturesDeleted);assert.equal(value.managedTexturesLive,value.dfgTexturesLive);
  assert.equal(value.nativeManagedTexturesChecked,value.managedTexturesCreated);assert.equal(value.nativeManagedTexturesLive,value.nativeDfgTexturesLive);
  assert.equal(value.contextDefaultTexturesCreated,4);assert.equal(value.contextDefaultTexturesDeleted,0);assert.equal(value.contextDefaultTexturesLive,4);
  assert.equal(value.nativeContextDefaultTexturesChecked,4);assert.equal(value.nativeContextDefaultTexturesLive,value.contextLostEvents>0?0:4,'the four initial WebGLState textures keep their original context boundary');
  assert.equal(value.environmentTexturesDeleted,value.environmentTexturesCreated);assert.equal(value.environmentTexturesLive,0);
  assert.equal(value.nativeEnvironmentTexturesChecked,value.environmentTexturesCreated);assert.equal(value.nativeEnvironmentTexturesLive,0);
  assert.equal(value.targetFramebuffersCreated,0,'a restored CubeUV DataTexture never regenerates PMREM render targets');
  assert.equal(value.targetFramebuffersLive,0,'there are no unexpected private render targets');
  assert.equal(value.targetFramebuffersDeleted,value.targetFramebuffersCreated);
  assert.equal(value.nativeTargetFramebuffersChecked,value.targetFramebuffersCreated);
  assert.equal(value.nativeTargetFramebuffersLive,0,'native GL confirms no unexpected target handles');
  // Three r186 creates three scratch FBOs in initGLContext, before assigning the
  // lanyard canvas class. They remain owned by the context until it is destroyed.
  assert.equal(value.scratchFramebuffersCreated,3);assert.equal(value.scratchFramebuffersLive,3);
  assert.equal(value.contextOwnedFramebuffersLive,3,'an unexplained extra framebuffer must still fail');
}

// Browser-only instrumentation is installed before the production module. It
// delegates actual GL calls, except the named negative capability/pending faults.
// No shader source, provider URL, credential or private startup lease is logged.
export function loginGpuFaultScript(mode:LoginGpuProbeMode):string{
  return GPU_FAULT_SCRIPT+'('+JSON.stringify(mode)+');';
}
const GPU_FAULT_SCRIPT=String.raw`(function installGpuPreparationFault(mode){
  Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined}); // existing login fixture: isolate Lanyard GL
  const p={mode,started:performance.now(),khrAvailable:null,khrRequests:0,completionQueries:0,draws:0,programsCreated:0,programsDeleted:0,programsLive:0,shadersCreated:0,shadersDeleted:0,shadersLive:0,framebuffersCreated:0,framebuffersDeleted:0,framebuffersLive:0,targetFramebuffersCreated:0,targetFramebuffersDeleted:0,targetFramebuffersLive:0,scratchFramebuffersCreated:0,scratchFramebuffersLive:0,iframeCreates:0,maxIframes:0,presentedCalls:0,preparedCalls:[],lossRequested:false,contextLostEvents:0,badShaderInjected:false,pendingPollTimers:0,present:null};
  window.__loginGpuFault=p;
  p.dataTextureFlagAssignments=0;p.prototypeRestored=false;p.environmentFetches=0;p.environmentDigests=0;p.environmentDigestSettled=0;p.environmentUploads=0;
  p.managedTexturesCreated=0;p.managedTexturesDeleted=0;p.managedTexturesLive=0;
  p.environmentTexturesCreated=0;p.environmentTexturesDeleted=0;p.environmentTexturesLive=0;
  const environmentObjects=[],managedTextureHandles=[],environmentTextureHandles=[],textureOwners=new WeakMap(),textureContexts=new WeakMap(),contextDefaultTextureHandles=[];
  const applicationHandles=()=>managedTextureHandles.filter(item=>!item.owner.dfg);
  const dfgHandles=()=>managedTextureHandles.filter(item=>item.owner.dfg);
  const isDfgCpuTexture=(texture,data=texture?.image?.data)=>texture?.isDataTexture===true&&texture.name==='DFG_LUT'&&texture.type===1016&&texture.format===1030&&texture.image?.width===16&&texture.image?.height===16&&texture.image.data===data&&data instanceof Uint16Array&&data.length===512&&data.byteLength===1024;
  const storage=(context,target,width,height,internalFormat)=>{const state=textureContexts.get(context),handle=state?.units.get(state.unit)?.get(target),item=handle&&textureOwners.get(handle);if(item)item.storage={width,height,internalFormat};};
  const observeDfgTexture=(context,target,width,height,format,type,data)=>{
    if(target!==context.TEXTURE_2D||width!==16||height!==16||format!==context.RG||type!==context.HALF_FLOAT||!(data instanceof Uint16Array)||data.byteLength!==1024)return;
    const state=textureContexts.get(context),handle=state?.units.get(state.unit)?.get(target),item=handle&&textureOwners.get(handle);
    if(!item?.managed||item.storage?.width!==16||item.storage?.height!==16||item.storage?.internalFormat!==context.RG16F)return;
    if(!environmentObjects.some(value=>isDfgCpuTexture(value.reference.deref(),data)))return;
    item.dfg=true;item.dfgBytes=data.byteLength;
  };
  const isEnvironment=texture=>texture?.isDataTexture===true&&texture.type===1016&&texture.image?.width===768&&texture.image?.height===1024;
  // Observe the real public Three flag without retaining the object or changing
  // its resulting own property. No production/testing bridge is added.
  const dataTextureDescriptor=Object.getOwnPropertyDescriptor(Object.prototype,'isDataTexture');
  Object.defineProperty(Object.prototype,'isDataTexture',{configurable:true,get(){return undefined;},set(value){
    p.dataTextureFlagAssignments++;Object.defineProperty(this,'isDataTexture',{value,writable:true,enumerable:true,configurable:true});
    if(value!==true||typeof this.addEventListener!=='function')return;
    const item={reference:new WeakRef(this),environment:false,disposed:false};environmentObjects.push(item);
    this.addEventListener('dispose',function(){item.environment ||= isEnvironment(this);item.disposed=true;});
  }});
  window.addEventListener('pagehide',()=>{queueMicrotask(()=>{if(dataTextureDescriptor)Object.defineProperty(Object.prototype,'isDataTexture',dataTextureDescriptor);else delete Object.prototype.isDataTexture;p.prototypeRestored=true;});},{once:true});
  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(/\/login-environment-v1-[A-Za-z0-9_-]+\.pmrem(?:$|[?#])/.test(url))p.environmentFetches++;return nativeFetch(input,init);};
  const nativeDigest=crypto.subtle.digest.bind(crypto.subtle);
  crypto.subtle.digest=function(algorithm,data){const tracked=data?.byteLength===880178||data?.byteLength===6291456;if(tracked)p.environmentDigests++;return nativeDigest(algorithm,data).then(value=>{if(tracked)p.environmentDigestSettled++;return value;});};
  const observeEnvironmentTexture=(context,target,width,height,type,data)=>{
    if(target!==context.TEXTURE_2D||width!==768||height!==1024||type!==context.HALF_FLOAT)return;
    const state=textureContexts.get(context),handle=state?.units.get(state.unit)?.get(target),item=handle&&textureOwners.get(handle);
    if(!item||!item.managed)throw Error('SYNTHETIC_ENVIRONMENT_TEXTURE_BINDING_MISSING');
    if(!item.environment){item.environment=true;p.environmentTexturesCreated++;p.environmentTexturesLive++;environmentTextureHandles.push({context:new WeakRef(context),texture:handle});}
    if(data&&data.byteLength===6291456)p.environmentUploads++;
  };
  const shaderOwners=new WeakMap(),shaderHandles=[],programOwners=new WeakMap(),framebufferOwners=new WeakMap(),framebufferBindings=new WeakMap(),framebufferContexts=new WeakMap(),targetHandles=[];
  let lossQueued=false;
  const timeout=window.setTimeout.bind(window),clearTimeoutNative=window.clearTimeout.bind(window),pollTimers=new Set();
  window.setTimeout=function(callback,ms,...args){let id;const wrapped=typeof callback==='function'?function(...values){pollTimers.delete(id);return Reflect.apply(callback,this,values);}:callback;id=timeout(wrapped,ms,...args);if(Number(ms)===10)pollTimers.add(id);return id;};
  window.clearTimeout=function(id){pollTimers.delete(id);return clearTimeoutNative(id);};
  p.snapshot=()=>({mode:p.mode,elapsedMs:performance.now()-p.started,khrAvailable:p.khrAvailable,khrRequests:p.khrRequests,completionQueries:p.completionQueries,draws:p.draws,programsCreated:p.programsCreated,programsDeleted:p.programsDeleted,programsLive:p.programsLive,shadersCreated:p.shadersCreated,shadersDeleted:p.shadersDeleted,shadersLive:p.shadersLive,nativeShadersChecked:shaderHandles.filter(value=>value.context.deref()).length,nativeShadersLive:shaderHandles.filter(value=>value.context.deref()?.isShader(value.shader)).length,framebuffersCreated:p.framebuffersCreated,framebuffersDeleted:p.framebuffersDeleted,framebuffersLive:p.framebuffersLive,targetFramebuffersCreated:p.targetFramebuffersCreated,targetFramebuffersDeleted:p.targetFramebuffersDeleted,targetFramebuffersLive:p.targetFramebuffersLive,contextOwnedFramebuffersLive:p.framebuffersLive-p.targetFramebuffersLive,scratchFramebuffersCreated:p.scratchFramebuffersCreated,scratchFramebuffersLive:p.scratchFramebuffersLive,nativeTargetFramebuffersChecked:targetHandles.filter(value=>value.context.deref()).length,nativeTargetFramebuffersLive:targetHandles.filter(value=>value.context.deref()?.isFramebuffer(value.framebuffer)).length,iframeCreates:p.iframeCreates,maxIframes:p.maxIframes,preparedCalls:p.preparedCalls,presentedCalls:p.presentedCalls,lossRequested:p.lossRequested,contextLostEvents:p.contextLostEvents,badShaderInjected:p.badShaderInjected,pendingPollTimers:pollTimers.size,view:document.getElementById('desktop-login')?.dataset.view??null,fallback:document.getElementById('desktop-login')?.dataset.fallbackReason??null,scene:document.body?.dataset.loginScene??null,preparationFailure:document.querySelector('.lanyard')?.dataset.gpuPreparationFailure??null,iframeCount:document.querySelectorAll('#wecom-panel iframe').length,
    dataTextureFlagAssignments:p.dataTextureFlagAssignments,prototypeRestored:p.prototypeRestored,environmentCpuHalfWords:environmentObjects.reduce((sum,item)=>sum+((item.environment ||= isEnvironment(item.reference.deref()))&&item.reference.deref()?.image?.data instanceof Uint16Array?item.reference.deref().image.data.length:0),0),environmentFetches:p.environmentFetches,environmentDigests:p.environmentDigests,environmentDigestSettled:p.environmentDigestSettled,
    environmentObjectsCreated:environmentObjects.filter(item=>{item.environment ||= isEnvironment(item.reference.deref());return item.environment;}).length,
    environmentObjectsDisposed:environmentObjects.filter(item=>item.environment&&item.disposed).length,
    environmentCpuBytes:environmentObjects.reduce((sum,item)=>sum+(item.environment?(item.reference.deref()?.image?.data?.byteLength??0):0),0),
    managedTexturesCreated:p.managedTexturesCreated,managedTexturesDeleted:p.managedTexturesDeleted,managedTexturesLive:p.managedTexturesLive,
    nativeManagedTexturesChecked:managedTextureHandles.filter(item=>item.context.deref()).length,nativeManagedTexturesLive:managedTextureHandles.filter(item=>item.context.deref()?.isTexture(item.texture)).length,
    environmentTexturesCreated:p.environmentTexturesCreated,environmentTexturesDeleted:p.environmentTexturesDeleted,environmentTexturesLive:p.environmentTexturesLive,environmentUploads:p.environmentUploads,
    nativeEnvironmentTexturesChecked:environmentTextureHandles.filter(item=>item.context.deref()).length,nativeEnvironmentTexturesLive:environmentTextureHandles.filter(item=>item.context.deref()?.isTexture(item.texture)).length,
    applicationTexturesCreated:applicationHandles().length,applicationTexturesDeleted:applicationHandles().filter(item=>item.owner.deleted).length,applicationTexturesLive:applicationHandles().filter(item=>!item.owner.deleted).length,
    nativeApplicationTexturesChecked:applicationHandles().filter(item=>item.context.deref()).length,nativeApplicationTexturesLive:applicationHandles().filter(item=>item.context.deref()?.isTexture(item.texture)).length,
    dfgTexturesCreated:dfgHandles().length,dfgTexturesDeleted:dfgHandles().filter(item=>item.owner.deleted).length,dfgTexturesLive:dfgHandles().filter(item=>!item.owner.deleted).length,dfgTextureBytes:dfgHandles().reduce((sum,item)=>sum+item.owner.dfgBytes,0),
    dfgCpuObjects:environmentObjects.filter(item=>isDfgCpuTexture(item.reference.deref())).length,dfgCpuBytes:environmentObjects.reduce((sum,item)=>sum+(isDfgCpuTexture(item.reference.deref())?item.reference.deref().image.data.byteLength:0),0),
    nativeDfgTexturesChecked:dfgHandles().filter(item=>item.context.deref()).length,nativeDfgTexturesLive:dfgHandles().filter(item=>item.context.deref()?.isTexture(item.texture)).length,
    contextDefaultTexturesCreated:contextDefaultTextureHandles.length,contextDefaultTexturesDeleted:contextDefaultTextureHandles.filter(item=>item.owner.deleted).length,contextDefaultTexturesLive:contextDefaultTextureHandles.filter(item=>!item.owner.deleted).length,
    nativeContextDefaultTexturesChecked:contextDefaultTextureHandles.filter(item=>item.context.deref()).length,nativeContextDefaultTexturesLive:contextDefaultTextureHandles.filter(item=>item.context.deref()?.isTexture(item.texture)).length});
  const wrap=(prototype,name,fn)=>{const original=prototype?.[name];if(typeof original==='function')prototype[name]=function(...args){return fn.call(this,original,args);};};
  for(const prototype of [globalThis.WebGLRenderingContext?.prototype,globalThis.WebGL2RenderingContext?.prototype]){
    wrap(prototype,'createTexture',function(original,args){const handle=Reflect.apply(original,this,args);if(handle){const managed=String(this.canvas?.className??'').includes('lanyard-canvas'),owner={managed,environment:false,dfg:false,dfgBytes:0,deleted:false,storage:null},receipt={context:new WeakRef(this),texture:handle,owner};textureOwners.set(handle,owner);if(managed){p.managedTexturesCreated++;p.managedTexturesLive++;managedTextureHandles.push(receipt);}else contextDefaultTextureHandles.push(receipt);}return handle;});
    wrap(prototype,'deleteTexture',function(original,args){const item=args[0]&&textureOwners.get(args[0]);if(item){item.deleted=true;if(item.managed){p.managedTexturesDeleted++;p.managedTexturesLive--;}if(item.environment){p.environmentTexturesDeleted++;p.environmentTexturesLive--;}textureOwners.delete(args[0]);}return Reflect.apply(original,this,args);});
    wrap(prototype,'activeTexture',function(original,args){let state=textureContexts.get(this);if(!state){state={unit:this.TEXTURE0,units:new Map()};textureContexts.set(this,state);}state.unit=args[0];return Reflect.apply(original,this,args);});
    wrap(prototype,'bindTexture',function(original,args){let state=textureContexts.get(this);if(!state){state={unit:this.TEXTURE0,units:new Map()};textureContexts.set(this,state);}let unit=state.units.get(state.unit);if(!unit){unit=new Map();state.units.set(state.unit,unit);}unit.set(args[0],args[1]);return Reflect.apply(original,this,args);});
    wrap(prototype,'texStorage2D',function(original,args){const result=Reflect.apply(original,this,args);storage(this,args[0],args[3],args[4],args[2]);if(args[2]===this.RGBA16F)observeEnvironmentTexture(this,args[0],args[3],args[4],this.HALF_FLOAT,null);return result;});
    wrap(prototype,'texImage2D',function(original,args){const result=Reflect.apply(original,this,args);if(args.length>=9){storage(this,args[0],args[3],args[4],args[2]);observeEnvironmentTexture(this,args[0],args[3],args[4],args[7],args[8]);observeDfgTexture(this,args[0],args[3],args[4],args[6],args[7],args[8]);}return result;});
    wrap(prototype,'texSubImage2D',function(original,args){const result=Reflect.apply(original,this,args);if(args.length>=9){observeEnvironmentTexture(this,args[0],args[4],args[5],args[7],args[8]);observeDfgTexture(this,args[0],args[4],args[5],args[6],args[7],args[8]);}return result;});
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



export const loginEnvironmentFaultModes=['missing','mime','encoding','corrupt','truncated','compressed-overflow','decompression-failed','raw-overflow','raw-integrity','no-decompression','no-hash','abort-read','abort-hash'] as const;
export type LoginEnvironmentFaultMode=typeof loginEnvironmentFaultModes[number];
const environmentNumberFields=['fetches','fetchAbortSignals','readerCancelCalls','compressedReadBytes','rawReadBytes','activeReads','decompressors','rawHashStarted','rawHashNativeFinished'] as const;
export type LoginEnvironmentFaultSnapshot=Record<typeof environmentNumberFields[number],number>&{mode:LoginEnvironmentFaultMode;failure:string|null;hasReleaseHash:boolean};
function isLoginEnvironmentFaultSnapshot(value:unknown):value is LoginEnvironmentFaultSnapshot{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const object:Record<string,unknown>={...value};
 return loginEnvironmentFaultModes.some(mode=>mode===object.mode)&&environmentNumberFields.every(key=>typeof object[key]==='number'&&Number.isSafeInteger(object[key])&&object[key]>=0)&&(object.failure===null||typeof object.failure==='string')&&typeof object.hasReleaseHash==='boolean';
}
export function readLoginEnvironmentFaultSnapshot(value:unknown):LoginEnvironmentFaultSnapshot{assert.ok(isLoginEnvironmentFaultSnapshot(value));return value;}
export function loginEnvironmentFaultScript(mode:LoginEnvironmentFaultMode):string{return loginGpuFaultScript('normal')+ENVIRONMENT_FAULT_SCRIPT+'('+JSON.stringify(mode)+');';}
// These named faults keep the original compressed bytes/hash and native gzip
// decoder for raw-output faults. The extra/corrupt decoded byte is injected only
// after native decompression, so the deeper fixed-size/hash guards are reached.
const ENVIRONMENT_FAULT_SCRIPT=String.raw`(function installEnvironmentFault(mode){
 const p={mode,fetches:0,fetchAbortSignals:0,readerCancelCalls:0,compressedReadBytes:0,rawReadBytes:0,activeReads:0,decompressors:0,rawHashStarted:0,rawHashNativeFinished:0,failure:null,releaseHash:null};window.__loginEnvironmentFault=p;
 const streams=new WeakMap(),readers=new WeakMap();
 const fetchNative=window.fetch.bind(window);window.fetch=function(input,init){const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;const tracked=/\/login-environment-v1-[A-Za-z0-9_-]+\.pmrem$/.test(url);if(tracked){p.fetches++;init?.signal?.addEventListener('abort',()=>p.fetchAbortSignals++,{once:true});}return fetchNative(input,init).then(response=>{if(tracked&&response.body)streams.set(response.body,'compressed');return response;});};
 const getReaderNative=ReadableStream.prototype.getReader;ReadableStream.prototype.getReader=function(...args){const reader=Reflect.apply(getReaderNative,this,args),phase=streams.get(this);if(phase)readers.set(reader,phase);return reader;};
 const readNative=ReadableStreamDefaultReader.prototype.read;ReadableStreamDefaultReader.prototype.read=function(...args){const phase=readers.get(this);if(phase)p.activeReads++;return Reflect.apply(readNative,this,args).then(part=>{if(phase){p.activeReads--;if(!part.done){if(phase==='compressed')p.compressedReadBytes+=part.value.byteLength;else p.rawReadBytes+=part.value.byteLength;}}return part;},error=>{if(phase)p.activeReads--;throw error;});};
 const cancelNative=ReadableStreamDefaultReader.prototype.cancel;ReadableStreamDefaultReader.prototype.cancel=function(...args){if(readers.has(this))p.readerCancelCalls++;return Reflect.apply(cancelNative,this,args);};
 if(mode==='no-decompression')Object.defineProperty(window,'DecompressionStream',{configurable:true,value:undefined});
 else{const NativeDecompressor=window.DecompressionStream;window.DecompressionStream=function(...args){const native=Reflect.construct(NativeDecompressor,args);p.decompressors++;let readable=native.readable;if(['decompression-failed','raw-overflow','raw-integrity'].includes(mode)){let mutated=false;readable=readable.pipeThrough(new TransformStream({transform(chunk,controller){if(mode==='decompression-failed')throw Error('SYNTHETIC_DECOMPRESSION_FAILURE');let value=chunk;if(mode==='raw-integrity'&&!mutated&&chunk.byteLength){value=chunk.slice();value[0]^=1;mutated=true;}controller.enqueue(value);},flush(controller){if(mode==='raw-overflow')controller.enqueue(new Uint8Array([1]));}}));Object.defineProperty(native,'readable',{value:readable});}streams.set(readable,'raw');return native;};}
 if(mode==='no-hash')Object.defineProperty(crypto,'subtle',{configurable:true,value:undefined});
 else{const digestNative=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=function(algorithm,data){const raw=data?.byteLength===6291456;if(raw)p.rawHashStarted++;return digestNative(algorithm,data).then(value=>{if(raw){p.rawHashNativeFinished++;if(mode==='abort-hash')return new Promise(resolve=>{p.releaseHash=()=>{p.releaseHash=null;resolve(value);};});}return value;});};}
 const failureObserver=new MutationObserver(records=>{for(const record of records)if(record.type==='attributes'&&record.attributeName==='data-gpu-preparation-failure')p.failure=record.target.getAttribute('data-gpu-preparation-failure');});failureObserver.observe(document,{subtree:true,attributes:true,attributeFilter:['data-gpu-preparation-failure']});
 p.snapshot=()=>({mode:p.mode,fetches:p.fetches,fetchAbortSignals:p.fetchAbortSignals,readerCancelCalls:p.readerCancelCalls,compressedReadBytes:p.compressedReadBytes,rawReadBytes:p.rawReadBytes,activeReads:p.activeReads,decompressors:p.decompressors,rawHashStarted:p.rawHashStarted,rawHashNativeFinished:p.rawHashNativeFinished,failure:p.failure,hasReleaseHash:typeof p.releaseHash==='function'});
 window.addEventListener('pagehide',event=>{queueMicrotask(()=>{failureObserver.disconnect();try{navigator.sendBeacon('/environment-proof',new Blob([JSON.stringify({...p.snapshot(),trustedPagehide:event.isTrusted})],{type:'application/json'}));}catch{}});});
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
