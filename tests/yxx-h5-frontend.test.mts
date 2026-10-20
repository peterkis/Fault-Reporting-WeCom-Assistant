import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';

async function moduleUrl(path:string):Promise<string>{
  const source=await readFile(resolve(process.cwd(),'h5/src',path),'utf8');
  let output=transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,target:ScriptTarget.ES2022,verbatimModuleSyntax:true}}).outputText;
  if(path==='api/client.ts')output=output.replace("'../lib/command'",JSON.stringify(await moduleUrl('lib/command.ts')));
  return 'data:text/javascript;base64,'+Buffer.from(output).toString('base64');
}
test('H5 frozen Stitch HTML and PNG remain byte identical to their recorded source hashes',async()=>{
 const baseline=resolve(process.cwd(),'h5/design-baseline');
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
  if(String(url).endsWith('/requests'))return new Response(JSON.stringify({ok:true,receipt:{client_command_id:id,status:'ACCEPTED',request_ref:'r'.repeat(32)}}),{status:202});
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
