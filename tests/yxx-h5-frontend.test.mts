import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {h5ModuleUrl as moduleUrl,createH5PureModuleLoader} from './helpers/h5-pure-module-loader.mjs';
import type {H5EntryBootstrap} from '../contracts/yxx_h5_entry_contracts.js';
const sourceRoot=process.env.TS_MIGRATION_TEST_SOURCE_ROOT??process.cwd();

test('H5 optional display query decodes only the current scope and has its own bounded cache',async t=>{
 const loader=createH5PureModuleLoader(),{displayProfileOptions}=await import(await loader.moduleUrl('api/display-profile.ts'));
 const calls:{url:string;options:RequestInit}[]=[];
 t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0],options:RequestInit={})=>{calls.push({url:String(input),options});return Response.json({schema_version:1,recovery_scope:'scope-a',profile:{name:'合成成员',department:'合成科室'}});});
 const options=displayProfileOptions('scope-a','revision-a'),controller=new AbortController();
 assert.deepEqual(options.queryKey,['display-profile','scope-a','revision-a']);assert.equal(options.staleTime,30000);assert.equal(options.gcTime,120000);assert.equal(options.retry,false);
 assert.equal(options.refetchOnWindowFocus,false);assert.equal(options.refetchOnReconnect,false);assert.equal(options.refetchOnMount,true);
 assert.deepEqual(await options.queryFn({signal:controller.signal}),{name:'合成成员',department:'合成科室'});
 assert.equal(calls.length,1);assert.equal(calls[0]?.url,'/api/yixiaoxiu/h5/profile');assert.equal(calls[0]?.options.signal,controller.signal);assert.equal(calls[0]?.options.credentials,'same-origin');assert.equal(calls[0]?.options.cache,'no-store');
 assert.notDeepEqual(options.queryKey,displayProfileOptions('scope-b','revision-a').queryKey);assert.notDeepEqual(options.queryKey,displayProfileOptions('scope-a','revision-b').queryKey);
});

test('H5 optional display query rejects a foreign scope and malformed profile without returning personal data',async t=>{
 const loader=createH5PureModuleLoader(),{displayProfileOptions}=await import(await loader.moduleUrl('api/display-profile.ts')),transport=await import(await loader.moduleUrl('api/client.ts'));
 let rechecks=0;const cleanup=transport.registerSessionRecheck(async()=>{rechecks++;});
 let body:unknown={schema_version:1,recovery_scope:'scope-b',profile:{name:'FOREIGN_SYNTHETIC',department:'FOREIGN_DEPARTMENT'}};
 t.mock.method(globalThis,'fetch',async()=>Response.json(body));
 try{
  await assert.rejects(displayProfileOptions('scope-a','r').queryFn({signal:new AbortController().signal}),{code:'MEMBER_SCOPE_CHANGED'});assert.equal(rechecks,1);
  for(const profile of [{name:'Synthetic'},{name:8,department:null},{name:null,department:8},{name:'x'.repeat(81),department:null}]){body={schema_version:1,recovery_scope:'scope-a',profile};await assert.rejects(displayProfileOptions('scope-a','r').queryFn({signal:new AbortController().signal}),{code:'INVALID_RESPONSE'});}
 }finally{cleanup();}
});

test('H5 optional display query discards a late response after cancellation or an auth-generation change',async t=>{
 const loader=createH5PureModuleLoader(),{displayProfileOptions}=await import(await loader.moduleUrl('api/display-profile.ts')),transport=await import(await loader.moduleUrl('api/client.ts'));
 let release:(value:Response)=>void=()=>{throw Error('PROFILE_NOT_PENDING');};
 t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>{release=resolve;}));
 for(const reason of ['cancel','generation']){
  const controller=new AbortController(),pending=displayProfileOptions('scope-a','r').queryFn({signal:controller.signal});
  if(reason==='cancel')controller.abort();else transport.advanceAuthGeneration();
  release(Response.json({schema_version:1,recovery_scope:'scope-a',profile:{name:'OLD_SYNTHETIC',department:'OLD_DEPARTMENT'}}));await assert.rejects(pending,{name:'AbortError'});
 }
});

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

interface NativeVoiceItem {id:string;status:string;localId:string|null}
interface NativeVoiceController {start:()=>Promise<void>;release:(cancel?:boolean)=>void;dispose:()=>void;mount:()=>void;clear:()=>void;getBusy:()=>boolean;getNative:()=>boolean;getError:()=>string|null;getItems:()=>NativeVoiceItem[];remove:(id:string)=>void;playNative:(item:NativeVoiceItem)=>Promise<void>;getRecording:()=>{recording:boolean};choosePhotos:(fallback:()=>void)=>Promise<void>}
let nativeVoiceFixtureId=0;
async function nativeVoiceFixture(t:TestContext,corporateAvailable:boolean,clientVersion='5.0.4',holdTransfers=false,holdVoiceStop=false,clearCapability=false,holdRecordStop=false,holdRecordStart=false){
 const descriptors=new Map(['window','document','navigator','location','performance','MediaRecorder'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),calls:string[]=[],subscriptions:string[]=[],listeners=new Map<string,(value:unknown)=>void>(),pendingBridge=new Map<string,(value:unknown)=>void>(),capture={permissions:0,constructions:0,activeTracks:0};let clock=1000.25,recordIndex=0;
 const bridge={invoke(name:string,_params:unknown,complete:(value:unknown)=>void){calls.push(name);if(name==='startRecord')recordIndex+=1;if(holdVoiceStop&&name==='stopVoice'||holdRecordStop&&name==='stopRecord'||holdRecordStart&&name==='startRecord'||holdTransfers&&(name==='uploadVoice'||name==='translateVoice')){pendingBridge.set(name,complete);return;}complete({err_msg:name+':ok',localId:'synthetic-voice-'+String(recordIndex),serverId:'synthetic-server-voice',translateResult:'synthetic transcript'});},on(name:string,callback:(value:unknown)=>void){subscriptions.push(name);listeners.set(name,callback);}};
 const window=Object.assign(new EventTarget(),{WeixinJSBridge:bridge,setInterval,clearInterval,setTimeout,clearTimeout});
 const document=Object.assign(new EventTarget(),{visibilityState:'visible',title:'Synthetic voice diagnostic'});
 Object.defineProperties(globalThis,{window:{configurable:true,value:window},document:{configurable:true,value:document},navigator:{configurable:true,value:{userAgent:'Mozilla/5.0 (Linux; Android 16) MicroMessenger/8.0.65 wxwork/'+clientVersion+' Language/zh_CN',platform:'Linux armv8l',...(clearCapability?{mediaDevices:{getUserMedia:async()=>{capture.permissions+=1;capture.activeTracks=1;return{getTracks:()=>[{stop:()=>{capture.activeTracks=0;}}]};}}}:{})}},location:{configurable:true,value:{href:'https://synthetic.invalid/wecom/yixiaoxiu/#/report'}},performance:{configurable:true,value:{now:()=>clock}}});
 const installCapture=(available:boolean)=>{
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:available?{getUserMedia:async()=>{capture.permissions+=1;capture.activeTracks=1;return{getTracks:()=>[{stop:()=>{capture.activeTracks=0;}}]};}}:undefined});
  if(available)Object.defineProperty(globalThis,'MediaRecorder',{configurable:true,value:class {static isTypeSupported(){return true;}state='inactive';onstop:(()=>void)|null=null;ondataavailable:((event:{data:Blob})=>void)|null=null;mimeType='audio/webm';constructor(){capture.constructions+=1;}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['synthetic clear audio'],{type:this.mimeType})});this.onstop?.();}}});else Reflect.deleteProperty(globalThis,'MediaRecorder');
 };installCapture(clearCapability);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network is authorized by this synthetic SDK test');});
 const installed=await readFile(resolve(sourceRoot,'node_modules/@wecom/jssdk/dist/wecom.prod.js'),'utf8'),sdkURL='data:text/javascript;base64,'+Buffer.from(installed+'\n// native voice fixture '+String(corporateAvailable)+' '+clientVersion+' '+String(++nativeVoiceFixtureId)).toString('base64');
 const client="export const authLost=new EventTarget();export const stats={kinds:[],reserves:0,imports:0,binaries:0};export const api={reserve:async()=>{stats.reserves+=1;return{media_ref:'11111111-1111-4111-8111-111111111111'};},upload:async()=>{stats.binaries+=1;},importWecom:async()=>{stats.imports+=1;},cancelUpload:async()=>{},signature:async(url,kind)=>{stats.kinds.push(kind);if(kind==='CORP'&&!"+String(corporateAvailable)+")throw new Error('SYNTHETIC_CORPORATE_SIGNING_UNAVAILABLE');return{timestamp:1,nonceStr:'synthetic',signature:'synthetic'};}};";
 const loader=createH5PureModuleLoader({overrides:{'lib/wecom.ts':'export * from '+JSON.stringify(sdkURL)+';','api/client.ts':client}}),module:{createMediaController:(get:()=>H5EntryBootstrap,transcript:(value:string)=>void,message:(key:string)=>string)=>NativeVoiceController}=await import(await loader.moduleUrl('hooks/useMedia.ts'));
 const bootstrap:H5EntryBootstrap={authenticated:true,identity_mode:'MEMBER_SELF_SERVICE',read_only:false,can_submit:true,can_supplement:true,csrf_token:'synthetic',recovery_scope:'synthetic-member',h5:{profile:{name:null,department:null,phone:null,avatar_url:null},can_upload:true,can_urge:true,can_evaluate:true,can_view_department:false,sdk:{enabled:true,corp_id:'synthetic-corp',agent_id:'synthetic-agent'},support:{emergency_phone:'18117887318',service_phone:'61318500'},limits:{voice_count:1,voice_duration_seconds:60,voice_bytes:5*1024*1024,image_count:6,image_bytes:10*1024*1024,video_count:1,video_duration_seconds:60,video_bytes:20*1024*1024,total_bytes:40*1024*1024}}};
 const controller=module.createMediaController(()=>bootstrap,()=>{},key=>key),sdk:{startRecord:()=>Promise<unknown>;stopRecord:()=>Promise<unknown>;ensureAgentConfigReady:()=>Promise<unknown>}=await import(sdkURL),transport:{authLost:EventTarget;stats:{kinds:string[];reserves:number;imports:number}}=await import(await loader.moduleUrl('api/client.ts'));controller.mount();
 const otherControllers:NativeVoiceController[]=[];
 t.after(()=>{controller.dispose();for(const next of otherControllers)next.dispose();for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 return{controller,sdk,calls,subscriptions,listeners,pendingBridge,document,capture,authLost:transport.authLost,setClock:(value:number)=>{clock=value;},makeController:(scope=bootstrap.recovery_scope,clear=clearCapability)=>{installCapture(clear);const next=module.createMediaController(()=>({...bootstrap,recovery_scope:scope}),()=>{},key=>key);next.mount();otherControllers.push(next);return next;},stats:transport.stats,sdkSHA256:createHash('sha256').update(installed).digest('hex')};
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

test('H5 installed SDK local preview is independent of unfinished upload and ASR, and removal stops it',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',true);await value.controller.start();value.setClock(5000.65);value.controller.release();
 for(let attempt=0;attempt<20&&(!value.pendingBridge.has('uploadVoice')||!value.pendingBridge.has('translateVoice'));attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));
 assert.ok(value.pendingBridge.has('uploadVoice'));assert.ok(value.pendingBridge.has('translateVoice'));const item=value.controller.getItems()[0];assert.ok(item);assert.equal(item.status,'UPLOADING');assert.equal(value.stats.imports,0);
 await Promise.all([value.controller.playNative(item),value.controller.playNative(item)]);assert.equal(value.calls.filter(name=>name==='playVoice').length,1,'Repeated pending preview dispatches one actual installed-SDK bridge command');assert.equal(value.stats.imports,0,'Preview has not passed through server import or transcoding');
 value.controller.remove(item.id);for(let attempt=0;attempt<20&&!value.calls.includes('stopVoice');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.calls.includes('stopVoice'));assert.equal(value.controller.getItems().length,0);
 value.pendingBridge.get('uploadVoice')?.({err_msg:'uploadVoice:ok',serverId:'synthetic-server-voice'});value.pendingBridge.get('translateVoice')?.({err_msg:'translateVoice:ok',translateResult:'late synthetic transcript'});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.stats.imports,0);assert.equal(value.controller.getError(),null);
 t.diagnostic(JSON.stringify({kind:'INSTALLED_SDK_SYNTHETIC_LOCAL_PREVIEW_WITH_PENDING_TRANSFERS',sdkSHA256:value.sdkSHA256,bridge_calls:value.calls,server_imports:value.stats.imports,real_audio_quality:'NOT_RUN',real_device:false}));
});

test('H5 installed SDK completes old preview stop before a new native recording starts',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,true);await value.controller.start();value.setClock(5000.65);value.controller.release();for(let attempt=0;attempt<20&&value.controller.getItems()[0]?.status!=='READY';attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));const item=value.controller.getItems()[0];assert.ok(item);await value.controller.playNative(item);value.controller.remove(item.id);const next=value.controller.start();
 try{for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopVoice');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.pendingBridge.has('stopVoice'));await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='startRecord').length,1,'An old native preview must finish its stop ACK before the next startRecord bridge command');}
 finally{value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await next;value.controller.release(true);for(let attempt=0;attempt<20&&value.controller.getBusy();attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));}
 assert.equal(value.calls.filter(name=>name==='startRecord').length,2);t.diagnostic(JSON.stringify({kind:'INSTALLED_SDK_PREVIEW_STOP_TO_NEW_RECORD_BARRIER',bridge_calls:value.calls,real_audio_quality:'NOT_RUN',real_device:false}));
});

async function pendingPreviewStop(t:TestContext){
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,true);await value.controller.start();value.setClock(5000.65);value.controller.release();for(let attempt=0;attempt<20&&value.controller.getItems()[0]?.status!=='READY';attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));const item=value.controller.getItems()[0];assert.ok(item);await value.controller.playNative(item);value.controller.remove(item.id);return value;
}

async function disposedPreviewStop(t:TestContext){
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,true);await value.controller.start();value.setClock(5000.65);value.controller.release();for(let attempt=0;attempt<20&&value.controller.getItems()[0]?.status!=='READY';attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));const item=value.controller.getItems()[0];assert.ok(item);await value.controller.playNative(item);value.controller.dispose();for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopVoice');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.pendingBridge.has('stopVoice'));return value;
}
for(const mode of ['WECOM','CLEAR']as const)test('H5 installed SDK carries pending preview stop across controller disposal before '+mode+' capture',async t=>{
 const value=await disposedPreviewStop(t),next=value.makeController(undefined,mode==='CLEAR');const starting=next.start();
 try{await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='startRecord').length,1,'A different controller must retain the real prior native cleanup');assert.equal(value.capture.permissions,0);assert.equal(value.capture.constructions,0);assert.equal(next.getRecording().recording,false);assert.equal(next.getBusy(),true);}
 finally{value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await starting;await new Promise<void>(resolve=>setImmediate(resolve));next.release(true);}
 assert.equal(value.calls.filter(name=>name==='stopVoice').length,1);assert.equal(value.calls.filter(name=>name==='startRecord').length,2);assert.equal(value.capture.permissions,mode==='CLEAR'?1:0);assert.equal(value.capture.activeTracks,0);
});

test('H5 repeated controller navigation cancels only the waiter and keeps one real pending native stop',async t=>{
 const value=await disposedPreviewStop(t);
 for(let index=0;index<4;index++){
  const next=value.makeController(undefined,Boolean(index%2));const starting=next.start();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(next.getBusy(),true);assert.equal(value.calls.filter(name=>name==='stopVoice').length,1);assert.equal(value.calls.filter(name=>name==='startRecord').length,1);assert.equal(value.capture.permissions,0);next.release(true);await starting;next.dispose();assert.equal(next.getBusy(),false);
 }
 const last=value.makeController(undefined,true);const starting=last.start();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='stopVoice').length,1);assert.equal(value.capture.permissions,0);value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await starting;assert.equal(value.capture.permissions,1);last.release(true);assert.equal(value.capture.activeTracks,0);assert.equal(value.subscriptions.filter(name=>name==='onVoicePlayEnd').length,1);
});

for(const mode of ['WECOM','CLEAR']as const)test('H5 member-scope change retains the dispatched native stop before a new '+mode+' controller captures',async t=>{
 const value=await disposedPreviewStop(t);value.authLost.dispatchEvent(new Event('scope-change'));const next=value.makeController('synthetic-new-member',mode==='CLEAR');const starting=next.start();
 await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='startRecord').length,1);assert.equal(value.capture.permissions,0);assert.equal(value.calls.filter(name=>name==='stopVoice').length,1);
 value.listeners.get('onVoicePlayEnd')?.({localId:'synthetic-voice-1'});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(next.getRecording().recording,false,'Natural completion must not discard a native stop command whose ACK is still unknown');
 value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await starting;await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='startRecord').length,2);assert.equal(value.capture.permissions,mode==='CLEAR'?1:0);next.release(true);assert.equal(value.subscriptions.filter(name=>name==='onVoicePlayEnd').length,1);
});

test('H5 a timed-out old controller does not discard native work for its successor',async t=>{
 const value=await disposedPreviewStop(t),next=value.makeController();t.mock.timers.enable({apis:['setTimeout']});const first=next.start();for(let index=0;index<8;index++)await new Promise<void>(resolve=>setImmediate(resolve));t.mock.timers.tick(5000);await first;assert.equal(next.getError(),'voice:previewStopFailed');assert.equal(next.getBusy(),false);next.dispose();t.mock.timers.reset();
 const last=value.makeController(),starting=last.start();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(last.getRecording().recording,false);assert.equal(value.calls.filter(name=>name==='stopVoice').length,1,'A consumer deadline cannot resend or erase a still-pending device operation');assert.equal(value.calls.filter(name=>name==='startRecord').length,1);value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await starting;assert.equal(value.calls.filter(name=>name==='startRecord').length,2);last.release(true);
});

test('H5 a native stop refusal survives controller disposal and only a new user attempt retries the same cleanup',async t=>{
 const value=await disposedPreviewStop(t),next=value.makeController(),first=next.start();for(let index=0;index<8;index++)await new Promise<void>(resolve=>setImmediate(resolve));value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:fail unsafe private response'});await first;assert.equal(next.getError(),'voice:previewStopFailed');next.dispose();assert.equal(value.calls.filter(name=>name==='stopVoice').length,1);
 const last=value.makeController(),starting=last.start();for(let attempt=0;attempt<20&&value.calls.filter(name=>name==='stopVoice').length<2;attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='stopVoice').length,2);assert.equal(value.calls.filter(name=>name==='startRecord').length,1);value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await starting;assert.equal(value.calls.filter(name=>name==='startRecord').length,2);last.release(true);
});

test('H5 natural preview completion leaves no device stop requirement for a successor controller',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,true);await value.controller.start();value.setClock(5000.65);value.controller.release();for(let attempt=0;attempt<20&&value.controller.getItems()[0]?.status!=='READY';attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));const item=value.controller.getItems()[0];assert.ok(item);await value.controller.playNative(item);value.listeners.get('onVoicePlayEnd')?.({localId:item.localId});value.controller.dispose();
 const next=value.makeController();await next.start();assert.equal(value.calls.includes('stopVoice'),false);assert.equal(value.calls.filter(name=>name==='startRecord').length,2);assert.equal(next.getRecording().recording,true);next.release(true);
});

test('H5 old native preview stop also fences a successor clear canonical recorder',async t=>{
 const value=await pendingPreviewStop(t),successor=value.makeController(undefined,true),next=successor.start();
 try{for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopVoice');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.pendingBridge.has('stopVoice'));await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.permissions,0,'An old native preview must stop before a browser microphone is requested');assert.equal(value.capture.constructions,0);}
 finally{value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await next;await new Promise<void>(resolve=>setImmediate(resolve));successor.release(true);}
 assert.equal(value.capture.permissions,1);assert.equal(value.capture.constructions,1);assert.equal(value.capture.activeTracks,0);assert.equal(value.calls.filter(name=>name==='startRecord').length,2);
});

test('H5 removing an unplayed native recording does not issue stopVoice or block the next recording',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,true);await value.controller.start();value.setClock(5000.65);value.controller.release();for(let attempt=0;attempt<20&&value.controller.getItems()[0]?.status!=='READY';attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));const item=value.controller.getItems()[0];assert.ok(item);value.controller.remove(item.id);const next=value.controller.start();await new Promise<void>(resolve=>setImmediate(resolve));
 try{assert.equal(value.calls.includes('stopVoice'),false,'No preview command was dispatched, so there is no native playback to stop');await next;assert.equal(value.calls.filter(name=>name==='startRecord').length,2);}
 finally{value.controller.release(true);value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await next;}
});

test('H5 installed SDK natural play completion clears only its matching preview and native subscriptions do not accumulate',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,true);const record=async(controller:NativeVoiceController,end:number)=>{await controller.start();value.setClock(end);controller.release();for(let attempt=0;attempt<20&&controller.getItems()[0]?.status!=='READY';attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));const item=controller.getItems()[0];assert.ok(item);return item;};
 const one=await record(value.controller,5000.65);await value.controller.playNative(one);assert.equal(value.subscriptions.filter(name=>name==='onVoicePlayEnd').length,1);const ended=value.listeners.get('onVoicePlayEnd');assert.ok(ended);ended({localId:one.localId});value.controller.remove(one.id);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.includes('stopVoice'),false,'A confirmed natural end needs no stop ACK');
 value.controller.dispose();const next=value.makeController(),two=await record(next,10000.75);await next.playNative(two);assert.notEqual(one.localId,two.localId);assert.equal(value.subscriptions.filter(name=>name==='onVoicePlayEnd').length,1,'SDK has no off API: controller lifetimes share one native event subscription');ended({localId:one.localId});next.remove(two.id);for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopVoice');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.pendingBridge.has('stopVoice'),'An old localId end must not clear a new preview');value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(next.getBusy(),false);
 next.dispose();const count=value.calls.length;ended({localId:two.localId});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.length,count,'Disposed controller subscriptions cannot issue new native work');
});
for(const action of ['release','cancel','hide','dispose','lost','clear']as const)test('H5 '+action+' cancels a native preview-stop wait and a late ACK cannot start recording',async t=>{
 const value=await pendingPreviewStop(t),next=value.controller.start();for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopVoice');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.pendingBridge.has('stopVoice'));
 if(action==='release')value.controller.release();else if(action==='cancel')value.controller.release(true);else if(action==='hide'){value.document.visibilityState='hidden';value.document.dispatchEvent(new Event('visibilitychange'));}else if(action==='dispose')value.controller.dispose();else if(action==='lost')value.authLost.dispatchEvent(new Event('lost'));else value.controller.clear();
 await next;assert.equal(value.calls.filter(name=>name==='startRecord').length,1);assert.equal(value.controller.getBusy(),false);assert.equal(value.controller.getRecording().recording,false);assert.equal(value.controller.getError(),action==='release'?'voice:tooShort':null);
 value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='startRecord').length,1,'Late native cleanup ACK cannot revive a canceled capture');
});

test('H5 a failed preview-stop ACK is safely classified and only an explicit new attempt retries cleanup',async t=>{
 const value=await pendingPreviewStop(t),next=value.controller.start();for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopVoice');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:fail unsafe private device detail'});await next;
 assert.equal(value.controller.getError(),'voice:previewStopFailed');assert.equal(value.controller.getBusy(),false);assert.equal(value.calls.filter(name=>name==='startRecord').length,1);assert.equal(value.calls.filter(name=>name==='stopVoice').length,1);
 const retry=value.controller.start();for(let attempt=0;attempt<20&&value.calls.filter(name=>name==='stopVoice').length<2;attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='stopVoice').length,2);assert.equal(value.calls.filter(name=>name==='startRecord').length,1);value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await retry;assert.equal(value.calls.filter(name=>name==='startRecord').length,2);value.controller.release(true);
});

test('H5 a missing preview-stop ACK reaches its local five-second deadline without leaking busy state',async t=>{
 const value=await pendingPreviewStop(t);t.mock.timers.enable({apis:['setTimeout']});const next=value.controller.start();assert.equal(value.controller.getBusy(),true);for(let index=0;index<8;index++)await new Promise<void>(resolve=>setImmediate(resolve));t.mock.timers.tick(5000);await next;
 assert.equal(value.controller.getError(),'voice:previewStopFailed');assert.equal(value.controller.getBusy(),false);assert.equal(value.calls.filter(name=>name==='startRecord').length,1);value.pendingBridge.get('stopVoice')?.({err_msg:'stopVoice:ok'});await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.calls.filter(name=>name==='startRecord').length,1);
});

test('H5 unified natural record end cannot discard a dispatched pending stopRecord ACK across controllers',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,false,false,true);await value.controller.start();value.setClock(5000.65);value.controller.release();
 for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopRecord');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.pendingBridge.has('stopRecord'));
 value.listeners.get('onVoiceRecordEnd')?.({localId:'synthetic-voice-1'});value.controller.dispose();const next=value.makeController(undefined,true),starting=next.start();
 try{await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.permissions,0,'A natural end is not the ACK of an already dispatched stopRecord');assert.equal(value.capture.constructions,0);assert.equal(next.getRecording().recording,false);}
 finally{value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:ok',localId:'synthetic-voice-1'});await starting;next.release(true);await new Promise<void>(resolve=>setImmediate(resolve));value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:ok',localId:'synthetic-voice-2'});}
});

test('H5 unified a disposed pending native start must ACK and stop before a successor gets its microphone',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,false,false,true,true),first=value.controller.start();for(let attempt=0;attempt<20&&!value.pendingBridge.has('startRecord');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.pendingBridge.has('startRecord'));value.controller.dispose();await first;
 const next=value.makeController(undefined,true),starting=next.start();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.permissions,0);value.pendingBridge.get('startRecord')?.({err_msg:'startRecord:ok'});for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopRecord');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(value.pendingBridge.has('stopRecord'));assert.equal(value.capture.permissions,0);assert.equal(value.calls.filter(name=>name==='startRecord').length,1);
 value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:ok',localId:'synthetic-voice-1'});await starting;assert.equal(value.capture.permissions,1);next.release(true);await new Promise<void>(resolve=>setImmediate(resolve));value.pendingBridge.get('startRecord')?.({err_msg:'startRecord:ok'});await new Promise<void>(resolve=>setImmediate(resolve));value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:ok',localId:'synthetic-voice-2'});assert.equal(value.capture.activeTracks,0);
});

test('H5 unified canceled successor waiters and scope changes retain one real pending native stop',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,false,false,true);await value.controller.start();value.setClock(5000.65);value.controller.release();for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopRecord');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));value.controller.dispose();value.authLost.dispatchEvent(new Event('scope-change'));
 for(let index=0;index<3;index++){const next=value.makeController('next-scope',true),starting=next.start();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.permissions,0);assert.equal(value.calls.filter(name=>name==='stopRecord').length,1);next.release(true);await starting;next.dispose();assert.equal(next.getBusy(),false);}
 const last=value.makeController('next-scope',true),starting=last.start();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.permissions,0);value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:ok',localId:'synthetic-voice-1'});await starting;assert.equal(value.capture.permissions,1);last.release(true);await new Promise<void>(resolve=>setImmediate(resolve));value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:ok',localId:'synthetic-voice-2'});assert.equal(value.capture.activeTracks,0);
});

test('H5 unified a confirmed native natural end needs no redundant stop and old localId cannot end the next session',async t=>{
 const value=await nativeVoiceFixture(t,true);await value.controller.start();value.setClock(61000.25);const end=value.listeners.get('onVoiceRecordEnd');assert.ok(end);end({localId:'synthetic-voice-1'});for(let attempt=0;attempt<20&&value.controller.getItems()[0]?.status!=='READY';attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));const item=value.controller.getItems()[0];assert.ok(item);value.controller.remove(item.id);await value.controller.start();end({localId:'synthetic-voice-1'});assert.equal(value.controller.getRecording().recording,true);assert.equal(value.calls.includes('stopRecord'),false);assert.equal(value.subscriptions.filter(name=>name==='onVoiceRecordEnd').length,1);value.controller.release(true);
});

for(const order of ['reject-then-end','end-then-reject']as const)test('H5 unified natural end plus a settled rejected stop releases the device in '+order+' order',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,false,false,true);await value.controller.start();value.setClock(61000.25);value.controller.release();for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopRecord');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));const end=value.listeners.get('onVoiceRecordEnd'),stop=value.pendingBridge.get('stopRecord');assert.ok(end);assert.ok(stop);
 if(order==='end-then-reject')end({localId:'synthetic-voice-1'});stop({err_msg:'stopRecord:fail not recording'});for(let attempt=0;attempt<8;attempt++)await new Promise<void>(resolve=>setImmediate(resolve));if(order==='reject-then-end')end({localId:'synthetic-voice-1'});value.controller.dispose();
 const next=value.makeController(undefined,true),starting=next.start();for(let attempt=0;attempt<8;attempt++)await new Promise<void>(resolve=>setImmediate(resolve));if(value.calls.filter(name=>name==='stopRecord').length>1)value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:fail not recording'});await starting;
 try{assert.equal(value.capture.permissions,1,'A settled device operation and a confirmed natural end must not require another successful stop ACK');assert.equal(value.calls.filter(name=>name==='stopRecord').length,1);assert.equal(next.getRecording().recording,true);}
 finally{next.release(true);await new Promise<void>(resolve=>setImmediate(resolve));value.listeners.get('onVoiceRecordEnd')?.({localId:'synthetic-voice-2'});value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:fail not recording'});}
});

test('H5 unified a rejected native stop without a natural end still requires explicit acknowledged cleanup',async t=>{
 const value=await nativeVoiceFixture(t,true,'5.0.4',false,false,false,true);await value.controller.start();value.setClock(5000.5);value.controller.release();for(let attempt=0;attempt<20&&!value.pendingBridge.has('stopRecord');attempt+=1)await new Promise<void>(resolve=>setImmediate(resolve));value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:fail private device issue'});for(let attempt=0;attempt<8;attempt++)await new Promise<void>(resolve=>setImmediate(resolve));value.controller.dispose();
 const next=value.makeController(undefined,true),starting=next.start();for(let attempt=0;attempt<8;attempt++)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(value.capture.permissions,0);assert.equal(value.calls.filter(name=>name==='stopRecord').length,2);value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:ok',localId:'synthetic-voice-1'});await starting;assert.equal(value.capture.permissions,1);next.release(true);await new Promise<void>(resolve=>setImmediate(resolve));value.pendingBridge.get('stopRecord')?.({err_msg:'stopRecord:ok',localId:'synthetic-voice-2'});
});

test('H5 voice failures have feature-localized safe messages for both supported languages',async()=>{
 const loader=createH5PureModuleLoader();await import(await loader.moduleUrl('components/voice-messages.ts'));const {default:i18n}=await import(await loader.moduleUrl('i18n.ts'));
 for(const lng of ['zh-CN','en'])for(const key of ['captureHint','transcriptUnavailable','interrupted','preparing','previewStopFailed','tooShort','setupFailed','nativeStartFailed','browserUnavailable','browserDenied','browserFailed','finishFailed','uploadInvalid','uploadSignIn','uploadForbidden','uploadExpired','uploadBusy','uploadUnavailable','uploadNetwork','nativeUploadFailed','uploadFailed']){const value=i18n.t('voice:'+key,{lng});assert.notEqual(value,key);assert.notEqual(value,'voice:'+key);assert.doesNotMatch(value,/audio file|音频文件/u);if(lng==='zh-CN')assert.match(value,/\p{Script=Han}/u);}
});
