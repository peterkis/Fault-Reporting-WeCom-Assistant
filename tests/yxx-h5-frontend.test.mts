import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {h5ModuleUrl as moduleUrl,createH5PureModuleLoader} from './helpers/h5-pure-module-loader.mjs';
import type {H5EntryBootstrap} from '../contracts/yxx_h5_entry_contracts.js';
const sourceRoot=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();

test('H5 frozen Stitch HTML and PNG remain byte identical to their recorded source hashes',async()=>{
 const baseline=resolve(sourceRoot,'h5/design-baseline');
 const manifest=JSON.parse(await readFile(resolve(baseline,'sha256.json'),'utf8'));
 assert.equal(manifest.project_id,'1016264531564507497');assert.equal(manifest.files.length,16);
 for(const entry of manifest.files){assert.match(entry.file,/^[a-z0-9]+\.(html|png)$/);assert.equal(createHash('sha256').update(await readFile(resolve(baseline,entry.file))).digest('hex'),entry.sha256,entry.file);}
});
test('H5 maps WeCom Chinese variants to Simplified Chinese and honors explicit client theme',async()=>{
 const preferences=await import(await moduleUrl('lib/preferences.ts'));
 assert.equal(preferences.clientLanguage('wxwork Language/zh_TW','en-US'),'zh-CN');
 assert.equal(preferences.clientLanguage('wxwork Language/zh-Hant','en-US'),'zh-CN');
 assert.equal(preferences.clientLanguage('wxwork Language/en','zh-CN'),'en');
 assert.equal(preferences.clientLanguage('wxwork Language/ja','zh-CN'),'en');
 assert.equal(preferences.clientLanguage('Mozilla/5.0','zh-HK'),'zh-CN');
 assert.equal(preferences.clientLanguage('Mozilla/5.0','fr-FR'),'en');
 assert.equal(preferences.clientTheme('wxwork ColorScheme/Dark',false),'dark');
 assert.equal(preferences.clientTheme('wxwork ColorScheme/Light',true),'light');
 assert.equal(preferences.clientTheme('wxwork',true),'dark');
 assert.equal(preferences.clientTheme('wxwork',false),'light');
});
test('H5 media admission applies per-kind counts, bounded duration, MIME and aggregate size',async()=>{
 const media=await import(await moduleUrl('lib/media.ts'));
 const image={kind:'IMAGE',byteSize:10*1024*1024,mimeType:'image/jpeg',durationMs:null};
 const voice={kind:'VOICE',byteSize:null,mimeType:'audio/amr',durationMs:60_000};
 assert.equal(media.validateMedia(image,[]),null);
 assert.equal(media.validateMedia(voice,[]),null);
 assert.equal(media.validateMedia(voice,[voice]),'mediaLimit');
 assert.equal(media.validateMedia({...voice,durationMs:60_001},[]),'mediaLimit');
 assert.equal(media.validateMedia({...voice,durationMs:null},[]),'mediaLimit');
 assert.equal(media.validateMedia({...image,mimeType:'image/svg+xml'},[]),'mediaInvalid');
 assert.equal(media.validateMedia({...image,mimeType:'image/heic'},[]),'mediaInvalid');
 assert.equal(media.validateMedia({...image,byteSize:10*1024*1024+1},[]),'mediaLimit');
 assert.equal(media.validateMedia({...image,byteSize:1},[image,image,image,image]),'mediaLimit');
 assert.equal(media.validateMedia({...image,byteSize:0},[]),'mediaLimit');
 assert.equal(media.hasFaultMaterial('  ',[]),false);
 assert.equal(media.hasFaultMaterial('', ['uploaded-ref']),true);
 assert.equal(media.hasFaultMaterial('显示错误代码',[]),true);
});
test('H5 timeline keeps external safe summaries and orders loaded facts by their actual epoch',async()=>{
 const timeline=await import(await moduleUrl('lib/timeline.ts'));
 const accepted={event_type:'REQUEST_ACCEPTED',summary:'报修已收到',occurred_epoch_ms:'100',occurred_at:'2026-10-20 14:32:00',ticket:null};
 const updated={...accepted,event_type:'TICKET_UPDATED',summary:'工作人员已完成本轮处理：已测试打印',occurred_epoch_ms:'200'};
 const input=[accepted,updated];const rows=timeline.latestFirst(input);
 assert.equal(rows[0],updated);assert.equal(input[0],accepted,'presentation must not mutate the cached API page');
 assert.deepEqual(timeline.timelinePresentation(updated),{titleKey:'eventUpdated',summary:updated.summary});
 assert.deepEqual(timeline.timelinePresentation({...updated,event_type:'FUTURE_SAFE_EVENT'}),{titleKey:null,summary:updated.summary});
});
test('H5 recovery requires the same original UUID and never treats UNKNOWN or an unrelated result as committed',async()=>{
 const receipts=await import(await moduleUrl('lib/command.ts'));
 const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 const receipt={status:'ACCEPTED',client_command_id:id,request_ref:'x'.repeat(32)};
 assert.equal(receipts.acceptedReceipt(receipt,id),true);
 assert.equal(receipts.acceptedReceipt({ok:true,receipt},id),true);
 assert.equal(receipts.acceptedReceipt(receipt,other),false);
 assert.equal(receipts.confirmedReceipt({state:'UNKNOWN',client_command_id:id},id),false);
 assert.equal(receipts.confirmedReceipt({state:'COMMITTED',client_command_id:id,result:{ok:true}},id),true);
 assert.equal(receipts.confirmedReceipt({state:'COMMITTED',client_command_id:other,result:{ok:true}},id),false);
 assert.equal(receipts.confirmedReceipt({state:'COMMITTED',client_command_id:id,result:{ok:true,client_command_id:other}},id),false);
 assert.equal(receipts.confirmedReceipt({state:'COMMITTED',result:{ok:true}},id),false);
 assert.equal(receipts.confirmedReceipt({ok:true,receipt},id),true);
});
test('H5 V2 transport uses current routes, source filters, CSRF and the original command UUID',async()=>{
 const client=await import(await moduleUrl('api/client.ts'));
 const originalFetch=globalThis.fetch;
 const calls:{url:string;options:RequestInit}[]=[];
 const id='11111111-1111-4111-8111-111111111111';
 Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(url:string,options:RequestInit={})=>{
  calls.push({url:String(url),options});
  if(String(url).endsWith('/requests'))return new Response(JSON.stringify({ok:true,replayed:false,receipt:{client_command_id:id,status:'ACCEPTED',request_ref:'r'.repeat(32),intake_no:'SYNTHETIC-1',accepted_revision:'1',accepted_at:'2026-10-20 12:00:00',accepted_epoch_ms:'1792468800000'}}),{status:202});
  return new Response(JSON.stringify({items:[],next_cursor:null}),{status:200});
 }});
 try{
  await client.api.reports({q:'打印',status:'ACTIVE',source:'WEB'},null);
  const first=calls[0];assert.ok(first);
  const url=new URL(first.url,'http://localhost');
  assert.equal(url.searchParams.get('search'),'打印');
  assert.equal(url.searchParams.has('q'),false);
  assert.equal(url.searchParams.get('source'),'WEB');
  assert.equal(new Headers(first.options.headers).get('accept'),'application/vnd.yixiaoxiu.v2+json');
  assert.equal(first.options.credentials,'same-origin');
  await client.api.submit({schema_version:2,client_command_id:id,intent:'CONTACT_REQUEST',description:null,location:{text:null,unknown:true},media_refs:[]},'csrf');
  const second=calls[1];assert.ok(second);
  assert.equal(second.options.method,'POST');
  const headers=new Headers(second.options.headers);
  assert.equal(headers.get('x-csrf-token'),'csrf');
  assert.equal(headers.get('idempotency-key'),id);
  assert.deepEqual(JSON.parse(String(second.options.body)),{schema_version:2,client_command_id:id,intent:'CONTACT_REQUEST',description:null,location:{text:null,unknown:true},media_refs:[]});
 }finally{globalThis.fetch=originalFetch;}
});
test('H5 invalidates protected state for 401/403 and preserves recoverability for 503/network failures',async()=>{
 const client=await import(await moduleUrl('api/client.ts'));
 const originalFetch=globalThis.fetch;let lost=0;
 const listener=()=>{lost+=1;};client.authLost.addEventListener('lost',listener);
 try{
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>new Response(JSON.stringify({error:{code:'YXX_ENTRY_UNAVAILABLE',retryable:true}}),{status:503})});
  await assert.rejects(()=>client.api.bootstrap(),error=>{assert.ok(error!==null&&typeof error==='object'&&'status'in error&&'code'in error);assert.equal(error.status,503);assert.equal(error.code,'YXX_ENTRY_UNAVAILABLE');return true;});
  assert.equal(lost,0);assert.equal(client.isUnknownResult(new client.ApiError(503,'YXX_ENTRY_UNAVAILABLE')),true);
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>new Response(JSON.stringify({error:{code:'YXX_MEMBER_FORBIDDEN'}}),{status:403})});
  await assert.rejects(()=>client.api.bootstrap());assert.equal(lost,1);
  assert.equal(client.isUnknownResult(new TypeError('network unavailable')),true);
  assert.equal(client.isUnknownResult(new client.ApiError(409,'CONFLICT')),false);
  assert.equal(client.isConflict(new client.ApiError(409,'CONFLICT')),true);
 }finally{client.authLost.removeEventListener('lost',listener);globalThis.fetch=originalFetch;}
});

test('H5 decodes actual command receipts and never fabricates media success from an empty response',async()=>{
 const {decoders,InvalidResponse}=await import(await moduleUrl('api/decode.ts'));
 const client=await import(await moduleUrl('api/client.ts')),originalFetch=globalThis.fetch;
 const id='11111111-1111-4111-8111-111111111111';
 const receipt={client_command_id:id,status:'ACCEPTED',request_ref:'r'.repeat(32),intake_no:'SYNTHETIC-1',accepted_revision:'1',accepted_at:'2026-10-20 12:00:00',accepted_epoch_ms:'1792468800000'};
 assert.equal(decoders.receipt({ok:true,replayed:false,receipt}),receipt);
 assert.throws(()=>decoders.receipt({client_command_id:id,status:'ACCEPTED',request_ref:'r'.repeat(32)}),InvalidResponse);
 assert.throws(()=>decoders.command({state:'COMMITTED',client_command_id:id,result:{ok:true}}),InvalidResponse);
 assert.throws(()=>decoders.upload(undefined),InvalidResponse);
 assert.throws(()=>decoders.upload({media_ref:'synthetic',kind:'FUTURE'}),InvalidResponse);
 const input={schema_version:1,client_command_id:id,kind:'IMAGE',mime_type:'image/png',byte_size:1,duration_ms:null};
 try{
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>new Response(null,{status:204})});
  await assert.rejects(()=>client.api.reserve(input,'csrf'),{code:'INVALID_RESPONSE'});
  assert.equal(await client.api.cancelUpload('synthetic','csrf',id),undefined,'a documented no-content cancellation is successful');
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>Response.json({ok:true})});
  assert.equal(await client.api.cancelUpload('synthetic','csrf',id),undefined);
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>Response.json({ok:true,replayed:false,receipt:{...receipt,client_command_id:'22222222-2222-4222-8222-222222222222'}})});
  await assert.rejects(()=>client.api.submit({schema_version:2,client_command_id:id,intent:'CONTACT_REQUEST',description:null,location:{text:null,unknown:true},media_refs:[]},'csrf'),{code:'INVALID_RECEIPT'});
 }finally{globalThis.fetch=originalFetch;}
});

test('H5 304 reuses only the current member generation and the same request body',async()=>{
 const client=await import(await moduleUrl('api/client.ts')),originalFetch=globalThis.fetch,ref='r'.repeat(32),headers:Headers[]=[];
 const body={request_ref:ref,intake_no:'SYNTHETIC',source_kind:'WEB_REQUEST',input_revision:'1',processed_revision:'1',display_status:'TICKET_CREATED',needs_action:null,safe_description:'Synthetic',supplements:[],safe_location:null,created_at:'2026-10-20 12:00:00',created_epoch_ms:'1792468800000',updated_at:'2026-10-20 12:00:00',updated_epoch_ms:'1792468800000',ticket:{ticket_no:'SYNTHETIC-1',status:'IN_PROGRESS'},safe_clarification:null,can_supplement:true,h5:{ticket_version:1,media:[],handler:null,public_progress:null,urge:{active:false,count:0,last_urged_at:null,last_urged_epoch_ms:null,next_allowed_at:null,next_allowed_epoch_ms:null,can_urge:true},evaluation:{can_evaluate:false,completed_round_ref:null,completed_round_no:null,ticket_version:1,rating:null,comment:null,evaluated_at:null,evaluated_epoch_ms:null},intent:'FAULT'}};
 let status=200;
 Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(_url:string,options:RequestInit)=>{headers.push(new Headers(options.headers));return status===304?new Response(null,{status:304}):Response.json(body,{headers:{etag:'"synthetic-v1"'}});}});
 try{
  const current=await client.api.detail(ref);status=304;
  assert.equal(await client.api.detail(ref,undefined,current),current);assert.equal(headers.at(-1)?.get('if-none-match'),'"synthetic-v1"');
  client.advanceAuthGeneration();
  await assert.rejects(()=>client.api.detail(ref,undefined,current),{code:'INVALID_NOT_MODIFIED'});assert.equal(headers.at(-1)?.get('if-none-match'),null);
  await assert.rejects(()=>client.api.detail(ref),{code:'INVALID_NOT_MODIFIED'});
 }finally{globalThis.fetch=originalFetch;}
});

test('H5 manual chunk recovery rechecks newly created drafts and UNKNOWN fences at the click',async()=>{
 const reload=await import(await moduleUrl('lib/reload.ts')),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
 const dataset:{h5Draft?:string;h5DetailDraft?:string;h5CommandPending?:string}={};let calls=0;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset}}});Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>{calls++;}}});
 try{
  assert.equal(calls,0);assert.equal(reload.hasProtectedInput(),false);
  dataset.h5Draft='true';reload.reloadIfSafe();assert.equal(calls,0,'a draft created after rendering still blocks reload');
  delete dataset.h5Draft;dataset.h5CommandPending='true';reload.reloadIfSafe();assert.equal(calls,0,'a pending or UNKNOWN UUID remains protected');
  delete dataset.h5CommandPending;dataset.h5DetailDraft='true';reload.reloadIfSafe();assert.equal(calls,0,'a detail dialog draft blocks reload independently of a report draft');
  delete dataset.h5DetailDraft;reload.reloadIfSafe();assert.equal(calls,1);
 }finally{if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else Reflect.deleteProperty(globalThis,'location');}
});


test('H5 silent OAuth reconnect is one-shot, same-origin and respects draft/UNKNOWN and return-loop guards',async()=>{
 const descriptors=new Map(['document','location','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const redirects:string[]=[],dataset:Record<string,string>={};
 const current={search:'',replace:(url:string)=>redirects.push(url)};
 Object.defineProperties(globalThis,{document:{configurable:true,value:{documentElement:{dataset}}},location:{configurable:true,value:current},navigator:{configurable:true,value:{userAgent:'Android MicroMessenger wxwork Language/zh_CN'}}});
 try{
  const loader=createH5PureModuleLoader(),auth=await import(await loader.moduleUrl('lib/reauth.ts'));
  dataset.h5Draft='true';assert.equal(auth.reconnect('/report',{automatic:true}),false);delete dataset.h5Draft;
  dataset.h5CommandPending='true';assert.equal(auth.reconnect('/reports',{automatic:true}),false);delete dataset.h5CommandPending;
  dataset.h5DetailDraft='true';assert.equal(auth.reconnect('/requests/'+'r'.repeat(32),{automatic:true}),false);delete dataset.h5DetailDraft;
  assert.equal(auth.reconnect('/reports',{automatic:true,blocked:true}),false,'captured guard must survive component cleanup');
  current.search='?auth_return=1';assert.equal(auth.reconnect('/reports',{automatic:true}),false,'failed fresh OAuth must not loop');current.search='';
  for(const path of ['https://attacker.invalid/','//attacker.invalid','/requests/short','/reports#foreign'])assert.equal(auth.reconnect(path),false,path);
  assert.equal(redirects.length,0);
  const route='/reports?status=ACTIVE&search='+encodeURIComponent('打印');
  assert.equal(auth.reconnect(route,{automatic:true}),true);
  assert.equal(redirects.length,1);const target=new URL(redirects[0]??'', 'https://hospital.example');
  assert.equal(target.origin,'https://hospital.example');assert.equal(target.pathname,'/wecom/yixiaoxiu/login');assert.equal(target.searchParams.get('return_to'),route);
  assert.equal(auth.reconnect('/report',{automatic:true}),false);assert.equal(redirects.length,1);
 }finally{for(const [key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});

test('H5 detail draft guard layout-effect closure protects dirty input and cleans only its own marker and listener',async t=>{
 const descriptors=new Map(['document','window'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),dataset:Record<string,string>={},events=new EventTarget();
 Object.defineProperties(globalThis,{document:{configurable:true,value:{documentElement:{dataset,removeAttribute(name:string){assert.equal(name,'data-h5-detail-draft');delete dataset.h5DetailDraft;}}}},window:{configurable:true,value:events}});
 const effectURL='data:text/javascript;base64,'+Buffer.from("let pending;export function useLayoutEffect(effect){pending=effect;}export function take(){const effect=pending;pending=undefined;if(!effect)throw new Error('Layout effect was not registered');return effect;}").toString('base64');
 const actual=await readFile(resolve(sourceRoot,'h5/src/hooks/useDetailDraftGuard.ts'),'utf8'),loader=createH5PureModuleLoader({overrides:{'hooks/useDetailDraftGuard.ts':actual.replace("'react'",JSON.stringify(effectURL))}});
 type LayoutEffect=()=>void|(()=>void);
 const effects:{take:()=>LayoutEffect}=await import(effectURL),guard=await import(await loader.moduleUrl('hooks/useDetailDraftGuard.ts')),reload=await import(await loader.moduleUrl('lib/reload.ts'));
 let cleanup:(()=>void)|undefined;
 try{
  guard.useDetailDraftGuard(false);assert.equal(effects.take()(),undefined);assert.equal(reload.hasProtectedInput(),false);
  guard.useDetailDraftGuard(true);assert.equal(dataset.h5DetailDraft,undefined,'the marker is a layout-effect side effect, not a render mutation');const mounted=effects.take()();assert.equal(typeof mounted,'function');if(!mounted)assert.fail('dirty effect must provide cleanup');cleanup=mounted;
  assert.equal(dataset.h5DetailDraft,'true');assert.equal(reload.hasProtectedInput(),true);
  const before=new Event('beforeunload',{cancelable:true});Object.defineProperty(before,'returnValue',{configurable:true,writable:true,value:'unchanged'});assert.equal(events.dispatchEvent(before),false);assert.equal(before.defaultPrevented,true);assert.equal(Object.getOwnPropertyDescriptor(before,'returnValue')?.value,'');
  dataset.h5Draft='true';dataset.h5CommandPending='true';cleanup();cleanup=undefined;assert.equal(dataset.h5DetailDraft,undefined);assert.equal(dataset.h5Draft,'true');assert.equal(dataset.h5CommandPending,'true');assert.equal(reload.hasProtectedInput(),true);
  const after=new Event('beforeunload',{cancelable:true});assert.equal(events.dispatchEvent(after),true,'unmount removes this dialog listener');assert.equal(after.defaultPrevented,false);
  delete dataset.h5Draft;delete dataset.h5CommandPending;guard.useDetailDraftGuard(false);assert.equal(effects.take()(),undefined);assert.equal(reload.hasProtectedInput(),false);
  t.diagnostic('ACTUAL_LAYOUT_EFFECT_CLOSURE_CONTRACT_ONLY: closure execution/cleanup is real; React commit and browser lifecycle are not measured here.');
 }finally{cleanup?.();for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});

test('H5 transport preserves expired/forbidden distinction without retrying a write',async()=>{
 const loader=createH5PureModuleLoader(),client=await import(await loader.moduleUrl('api/client.ts'));
 const originalFetch=globalThis.fetch,events:number[]=[],calls:{method:string;status:number}[]=[];
 let status=401;
 client.authLost.addEventListener('lost',(event:Event)=>{assert.ok(event instanceof client.AuthFailureEvent);events.push((event as Event&{status:number}).status);});
 globalThis.fetch=async(_input,options)=>{calls.push({method:options?.method??'GET',status});return new Response(JSON.stringify({error:{code:status===401?'YXX_AUTH_REQUIRED':'YXX_FORBIDDEN'}}),{status});};
 try{
  await assert.rejects(client.api.submit({schema_version:2,client_command_id:'11111111-1111-4111-8111-111111111111',intent:'CONTACT_REQUEST',description:null,location:{text:null,unknown:true},media_refs:[]},'csrf'),{status:401});
  status=403;await assert.rejects(client.api.bootstrap(),{status:403});
  status=503;await assert.rejects(client.api.bootstrap(),{status:503});
  assert.deepEqual(events,[401,403]);assert.equal(calls.filter(item=>item.method==='POST').length,1);assert.equal(calls.length,3);
 }finally{globalThis.fetch=originalFetch;}
});

interface NativeVoiceController {start:()=>Promise<void>;release:(cancel?:boolean)=>void;dispose:()=>void;getBusy:()=>boolean;getNative:()=>boolean;getError:()=>string|null;getRecording:()=>{recording:boolean};choosePhotos:(fallback:()=>void)=>Promise<void>}
async function nativeVoiceFixture(t:TestContext,corporateAvailable:boolean,clientVersion='5.0.4'){
 const descriptors=new Map(['window','document','navigator','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),calls:string[]=[],listeners=new Map<string,(value:unknown)=>void>();
 const bridge={invoke(name:string,_params:unknown,complete:(value:unknown)=>void){calls.push(name);complete({err_msg:name+':ok',localId:'synthetic-voice'});},on(name:string,callback:(value:unknown)=>void){listeners.set(name,callback);}};
 const window=Object.assign(new EventTarget(),{WeixinJSBridge:bridge,setInterval,clearInterval,setTimeout,clearTimeout});
 Object.defineProperties(globalThis,{window:{configurable:true,value:window},document:{configurable:true,value:Object.assign(new EventTarget(),{visibilityState:'visible',title:'Synthetic voice diagnostic'})},navigator:{configurable:true,value:{userAgent:'Mozilla/5.0 (Linux; Android 16) MicroMessenger/8.0.65 wxwork/'+clientVersion+' Language/zh_CN',platform:'Linux armv8l'}},location:{configurable:true,value:{href:'https://synthetic.invalid/wecom/yixiaoxiu/#/report'}}});
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network is authorized by this synthetic SDK test');});
 const installed=await readFile(resolve(sourceRoot,'node_modules/@wecom/jssdk/dist/wecom.prod.js'),'utf8'),sdkURL='data:text/javascript;base64,'+Buffer.from(installed+'\n// native voice fixture '+String(corporateAvailable)+' '+clientVersion).toString('base64');
 const client="export const authLost=new EventTarget();export const stats={kinds:[]};export const api={signature:async(url,kind)=>{stats.kinds.push(kind);if(kind==='CORP'&&!"+String(corporateAvailable)+")throw new Error('SYNTHETIC_CORPORATE_SIGNING_UNAVAILABLE');return{timestamp:1,nonceStr:'synthetic',signature:'synthetic'};}};";
 const loader=createH5PureModuleLoader({overrides:{'lib/wecom.ts':'export * from '+JSON.stringify(sdkURL)+';','api/client.ts':client}}),module:{createMediaController:(get:()=>H5EntryBootstrap,transcript:(value:string)=>void,message:(key:string)=>string)=>NativeVoiceController}=await import(await loader.moduleUrl('hooks/useMedia.ts'));
 const bootstrap:H5EntryBootstrap={authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only:false,can_submit:true,can_supplement:true,csrf_token:'synthetic',recovery_scope:'synthetic-member',h5:{profile:{name:null,department:null,phone:null,avatar_url:null},can_upload:true,can_urge:true,can_evaluate:true,can_view_department:false,sdk:{enabled:true,corp_id:'synthetic-corp',agent_id:'synthetic-agent'},support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:{voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024}}};
 const controller=module.createMediaController(()=>bootstrap,()=>{},key=>key),sdk:{startRecord:()=>Promise<unknown>;stopRecord:()=>Promise<unknown>;ensureAgentConfigReady:()=>Promise<unknown>}=await import(sdkURL),transport:{stats:{kinds:string[]}}=await import(await loader.moduleUrl('api/client.ts'));
 t.after(()=>{controller.dispose();for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 return{controller,sdk,calls,listeners,stats:transport.stats,sdkSHA256:createHash('sha256').update(installed).digest('hex')};
}

test('H5 native Android voice reaches the installed SDK bridge when its registration is ready',async t=>{
 const value=await nativeVoiceFixture(t,true);await value.controller.start();
 t.diagnostic(JSON.stringify({kind:'INSTALLED_SDK_SYNTHETIC_BRIDGE_CONTROL',sdkSHA256:value.sdkSHA256,native:value.controller.getNative(),signatures:value.stats.kinds,bridge_calls:value.calls,error:value.controller.getError()}));
 assert.equal(value.controller.getNative(),true);assert.equal(value.controller.getError(),null);assert.equal(value.controller.getRecording().recording,true);assert.equal(value.calls.filter(name=>name==='startRecord').length,1);assert.ok(value.listeners.has('onVoiceRecordEnd'),'installed SDK accepts the actual callback API used by the controller');value.controller.release(true);
 for(let attempt=0;attempt<20&&value.controller.getBusy();attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.controller.getBusy(),false);
});

test('H5 modern WeCom voice must not require corporate configuration after its installed SDK agent configuration succeeds',async t=>{
 const value=await nativeVoiceFixture(t,false);await value.controller.start();await value.sdk.ensureAgentConfigReady();
 t.diagnostic(JSON.stringify({kind:'CURRENT_AGENT_REGISTRATION_WITH_CORPORATE_SIGNER_UNAVAILABLE',sdkSHA256:value.sdkSHA256,native:value.controller.getNative(),signatures:value.stats.kinds,controller_recording:value.controller.getRecording().recording,controller_error:value.controller.getError(),bridge_calls:value.calls,real_device:false}));
 assert.equal(value.controller.getRecording().recording,true,'the existing AGENT registration delegates readiness to the installed SDK');assert.equal(value.controller.getError(),null);assert.equal(value.calls.filter(name=>name==='startRecord').length,1);assert.deepEqual(value.stats.kinds,['AGENT'],'current clients must not require the unused corporate signing path');assert.equal(value.calls.includes('preVerifyJSAPI'),false);
 value.controller.release(true);for(let attempt=0;attempt<20&&value.controller.getBusy();attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.controller.getBusy(),false);
});

test('H5 existing AGENT registration lets the installed SDK request corporate readiness first on an old WeCom client',async t=>{
 const value=await nativeVoiceFixture(t,true,'3.0.23');await value.controller.start();
 assert.equal(value.controller.getError(),null);assert.equal(value.controller.getRecording().recording,true);assert.deepEqual(value.stats.kinds,['CORP','AGENT']);assert.deepEqual(value.calls.slice(0,3),['preVerifyJSAPI','agentConfig','startRecord']);
 value.controller.release(true);for(let attempt=0;attempt<20&&value.controller.getBusy();attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.controller.getBusy(),false);
});

test('H5 voice failures have feature-localized safe messages for both supported languages',async()=>{
 const loader=createH5PureModuleLoader();await import(await loader.moduleUrl('components/voice-messages.ts'));const {default:i18n}=await import(await loader.moduleUrl('i18n.ts'));
 for(const lng of ['zh-CN','en'])for(const key of ['setupFailed','nativeStartFailed','browserUnavailable','browserDenied','browserFailed','finishFailed']){const value=i18n.t('voice:'+key,{lng});assert.notEqual(value,key);assert.notEqual(value,'voice:'+key);if(lng==='zh-CN')assert.match(value,/\p{Script=Han}/u);}
});
