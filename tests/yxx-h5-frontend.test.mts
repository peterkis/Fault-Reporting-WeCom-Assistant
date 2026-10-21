import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {h5ModuleUrl as moduleUrl} from './helpers/h5-pure-module-loader.mjs';
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
 const dataset:{h5Draft?:string;h5CommandPending?:string}={};let calls=0;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{dataset}}});Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>{calls++;}}});
 try{
  assert.equal(calls,0);assert.equal(reload.hasProtectedInput(),false);
  dataset.h5Draft='true';reload.reloadIfSafe();assert.equal(calls,0,'a draft created after rendering still blocks reload');
  delete dataset.h5Draft;dataset.h5CommandPending='true';reload.reloadIfSafe();assert.equal(calls,0,'a pending or UNKNOWN UUID remains protected');
  delete dataset.h5CommandPending;reload.reloadIfSafe();assert.equal(calls,1);
 }finally{if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else Reflect.deleteProperty(globalThis,'location');}
});
