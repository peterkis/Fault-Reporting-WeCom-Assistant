// STAGED_RUNTIME / first real browser boundary execution pending.
// Intended location: tests/t37-follow-up-recovery-boundaries.browser.test.mts.
// Four bounded native-browser cases. No direct draft/operation row writes, capacity or CAS races.
// Frontend Date.now is controlled only for TTL; backend clock, authentication and commands stay real.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createP2016Runtime,type P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../app/server/src/p2-006-workbench-http.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Read {path:string;status:number;body:Record<string,unknown>}
interface Write extends Read {method:string;request:Record<string,unknown>|null;ifMatch:string|null;idempotencyKey:string|null;csrfPresent:boolean}
interface DraftMeta {purpose:string;firstSavedAt:number;expiresAt:number;revision:string;extractable:boolean;plainCanary:boolean}
interface OperationMeta {purpose:string;commandId:string;keys:string[]}
interface Storage {drafts:DraftMeta[];operations:OperationMeta[]}
interface CaseContext {fixture:T37Fixture;browser:Browser;directory:string;ticketId:string;ticketPath:string;schedulePath:string;stored:string;
  http:(index:number)=>Promise<T37Http>;recompose:(flags:{raw:boolean;view:boolean;notes?:boolean})=>Promise<void>}
const drawer='dialog.detail-dialog[open]',region=drawer+' [role="region"][aria-label="共享下次跟进时间"]',purpose='shared-follow-up-schedule';
const firstDue='2030-01-02 09:30:00',updatedDue='2030-01-02 10:00:00',noteCanary='T37_OTHER_PURPOSE_LOCAL_ONLY_CANARY';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
function errorFacts(error:unknown):unknown{return error instanceof Error?{name:error.name,message:error.message,stack:error.stack,...(error instanceof AggregateError?{errors:error.errors.map(errorFacts)}:{})}:error===null?null:String(error);}
function draftFor(storage:Storage,kind=purpose){return storage.drafts.find(value=>value.purpose===kind);}
function operationFor(storage:Storage,kind=purpose){return storage.operations.find(value=>value.purpose===kind);}
function button(label:string,mode:'exists'|'ready'|'click'='exists'){
 return `(()=>{const element=document.querySelector(${JSON.stringify(region)}),button=[...(element?.querySelectorAll('button')??[])].find(value=>value.textContent.trim()===${JSON.stringify(label)});${mode==='click'?"if(!button||button.disabled)throw Error('T37_REAL_BOUNDARY_BUTTON_UNAVAILABLE');button.click();":mode==='ready'?'return Boolean(button&&!button.disabled);':'return Boolean(button);'}})()`;
}
function typeDue(value:string){return `(()=>{const input=document.querySelector(${JSON.stringify(region+' input[name="due_at"]')});if(!(input instanceof HTMLInputElement)||input.disabled)throw Error('T37_REAL_BOUNDARY_DUE_INPUT_UNAVAILABLE');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error('T37_NATIVE_INPUT_REQUIRED');setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`;}
function storedTicket(principalId:string,ticketId:string){return `(async()=>{
 if(!(await indexedDB.databases()).some(value=>value.name==='wecom-workbench-drafts-v1'))return {drafts:[],operations:[]};
 return new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onupgradeneeded=()=>request.transaction.abort();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('T37_BOUNDARY_OBSERVER_BLOCKED'));
  request.onsuccess=()=>{const database=request.result;if(!database.objectStoreNames.contains('drafts')||!database.objectStoreNames.contains('operations')){database.close();reject(Error('T37_BOUNDARY_STORES_MISSING'));return;}
   const transaction=database.transaction(['drafts','operations'],'readonly'),drafts=transaction.objectStore('drafts').getAll(),operations=transaction.objectStore('operations').getAll();
   transaction.oncomplete=()=>{database.close();const own=value=>value.principal===${JSON.stringify(principalId)}&&value.kind==='ticket'&&value.id===${JSON.stringify(ticketId)};
    resolve({drafts:drafts.result.filter(own).map(value=>({purpose:value.purpose,firstSavedAt:value.firstSavedAt,expiresAt:value.expiresAt,revision:value.revision,extractable:value.key.extractable,plainCanary:JSON.stringify(value).includes(${JSON.stringify(noteCanary)})||JSON.stringify(value).includes(${JSON.stringify(firstDue)})||JSON.stringify(value).includes(${JSON.stringify(updatedDue)})})),operations:operations.result.filter(own).map(value=>({purpose:value.purpose,commandId:value.commandId,keys:Object.keys(value).sort()}))});};
   transaction.onabort=()=>{database.close();reject(transaction.error??Error('T37_BOUNDARY_OBSERVER_ABORTED'));};transaction.onerror=()=>{};};});})()`;}
function observeWireLoss(ticketPath:string,schedulePath:string){return `(()=>{const original=globalThis.fetch;globalThis.__t37BoundaryWrites=[];globalThis.__t37BoundaryReads=[];globalThis.__t37BoundaryBootstrap=[];
 globalThis.fetch=async(input,options)=>{const path=new URL(input instanceof Request?input.url:String(input),location.href).pathname,method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
  const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(options?.headers).forEach((value,key)=>headers.set(key,value));
  const request=method==='POST'&&path===${JSON.stringify(schedulePath)}?JSON.parse(options?.body??(input instanceof Request?await input.clone().text():'{}')):null;
  const response=await original(input,options);
  if(method==='GET'&&(path===${JSON.stringify(ticketPath)}||path===${JSON.stringify(schedulePath)}||path.startsWith(${JSON.stringify(schedulePath+'/commands/')} )||path.startsWith(${JSON.stringify(ticketPath+'/internal-notes/commands/')}))){const value=await response.clone().json();globalThis.__t37BoundaryReads.push({path,status:response.status,body:path===${JSON.stringify(ticketPath)}?{id:value.id,version:value.version,allowed_actions:value.allowed_actions,error:value.error}:value});}
  if(method==='GET'&&path==='/api/lifecycle/bootstrap'){const value=await response.clone().json();globalThis.__t37BoundaryBootstrap.push({path,status:response.status,body:{principal_id:value.principal_id,roles:value.roles,follow_up_schedules_enabled:value.follow_up_schedules_enabled,follow_up_schedule_draft_recovery_enabled:value.follow_up_schedule_draft_recovery_enabled,follow_up_schedule_receipt_enabled:value.follow_up_schedule_receipt_enabled,draft_recovery_enabled:value.draft_recovery_enabled}});}
  if(method!=='GET')globalThis.__t37BoundaryWrites.push({path,method,status:response.status,body:path===${JSON.stringify(schedulePath)}?await response.clone().json():{},request,ifMatch:headers.get('if-match'),idempotencyKey:headers.get('idempotency-key'),csrfPresent:Boolean(headers.get('x-csrf-token'))});
  if(method==='POST'&&path===${JSON.stringify(schedulePath)}&&response.status===200)throw new TypeError('SIMULATED_T37_BOUNDARY_COMMITTED_RESPONSE_LOSS');return response;};})()`;}
async function reload(browser:Browser){const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'&&globalThis.__t37BoundaryBootstrap?.some(value=>value.status===200)`);}
async function drain(runtime:P2016EnabledRuntime){
 const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;
 for(let index=0;index<bound;index++){const inbound=await runtime.coordinator.runOnce(),realtime=await runtime.realtimeProjector.runOnce({limit:100});assert.ok(inbound.streams.every(stream=>stream.failures.length===0));if(inbound.processed===0&&realtime.processed===0&&(await runtime.coordinator.backlog()).total===0)return;}
 assert.fail('T37_BOUNDARY_NATIVE_PROJECTION_DID_NOT_SETTLE');
}
async function runtimeHttp(fixture:T37Fixture,runtime:P2016EnabledRuntime,index:number):Promise<T37Http>{
 const entry=runtime.authenticate.browserCookies?.()[index];assert.ok(entry);const cookie=entry.name+'='+entry.value;
 const get=async(path:string)=>{const response=await fetch(fixture.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
 const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
 return {get,post:async(path,body)=>{const expected=body.expected_row_version??body.expected_version,response=await fetch(fixture.origin+path,{method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':text(body.client_command_id),'if-match':'"'+String(expected)+'"'},body:JSON.stringify(body)});return {status:response.status,value:object(await response.json())};}};
}
async function withBrowserCase(name:string,run:(context:CaseContext)=>Promise<void>,notes=false){
 await withT37Fixture(async fixture=>{
  const directory=join(tmpdir(),'t37-recovery-boundary-'+name+'-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,error:unknown,runtime=fixture.runtime;
  const http=(index:number)=>runtimeHttp(fixture,runtime,index);
  const recompose=async(flags:{raw:boolean;view:boolean;notes?:boolean})=>{
   await runtime.stop();assert.equal(runtime.server.listening,false);
   runtime=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:fixture.origin,listenPort:Number(new URL(fixture.origin).port),principalIds:[fixture.dispatcher,fixture.handler,fixture.otherHandler],
    gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,ticketAssignmentEnabled:true,workbenchFollowUpSchedulesEnabled:flags.view,workbenchDraftRecoveryEnabled:flags.raw,workbenchInternalNotesEnabled:flags.notes??notes});
   const address=await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(fixture.origin).port)});assert.equal(address.port,Number(new URL(fixture.origin).port));assert.equal(runtime.orchestrationWorker,null);
   const cookie=runtime.authenticate.browserCookies?.()[1];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T37_BOUNDARY_COOKIE_REQUIRED');if(browser)await browser.command('Network.setCookies',{cookies:[{...cookie,url:cookie.url}]});
  };
  try{
   if(notes)await recompose({raw:true,view:true,notes:true});
   const dispatcher=await http(0),handler=await http(1),ticketId=await fixture.createTicket(),ticketPath='/api/tickets/'+ticketId,schedulePath=ticketPath+'/follow-up-schedule',queued=await current(dispatcher,ticketPath);
   const assigned=await dispatcher.post(ticketPath+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));await drain(runtime);
   const bootstrap=await current(handler,'/api/lifecycle/bootstrap');assert.equal(bootstrap.follow_up_schedule_draft_recovery_enabled,true);assert.equal(bootstrap.principal_id,fixture.handler);if(notes)assert.equal(bootstrap.draft_recovery_enabled,true);
   const cookie=runtime.authenticate.browserCookies?.()[1];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T37_BOUNDARY_COOKIE_REQUIRED');
   browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observeWireLoss(ticketPath,schedulePath)});await reload(browser);
   await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(region+' input[name="due_at"]')}))&&document.querySelector(${JSON.stringify(region)})?.textContent.includes('草稿仅在当前浏览器')`);
   await run({fixture,browser,directory,ticketId,ticketPath,schedulePath,stored:storedTicket(fixture.handler,ticketId),http,recompose});
   const pixels=Buffer.from(await browser.screenshot(),'base64'),screenshotDirectory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(screenshotDirectory);const file=join(screenshotDirectory,'new-detail-1920.png');await writeFile(file,pixels);
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T37_RECOVERY_BOUNDARY_'+name.toUpperCase(),evidence_directory:directory,screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));
  }catch(failure){
   error=failure;try{await writeFile(join(directory,'primary-error.json'),JSON.stringify(errorFacts(failure),null,2));if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate(`({shared:document.querySelector(${JSON.stringify(region)})?.innerText??'',notes:document.querySelector('#internal-note')?.value??'',reads:globalThis.__t37BoundaryReads,writes:globalThis.__t37BoundaryWrites,bootstrap:globalThis.__t37BoundaryBootstrap})`),null,2));}}
   catch(observation){error=new AggregateError([failure,observation],'T37_BOUNDARY_FAILURE_OBSERVATION');}console.log('T37_BROWSER_FAILURE '+JSON.stringify({directory}));
  }
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);assert.equal((await runtime.observability.metrics()).sse_clients,0);assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((failure,count)=>failure?reject(failure):resolve(count))),0);}],error);
 },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,workbenchDraftRecoveryEnabled:true});
}
async function commitUnknown(context:CaseContext,due=firstDue,alreadyTyped=false):Promise<Write>{
 const {browser,schedulePath,ticketPath,directory}=context,handler=await context.http(1),before=await current(handler,ticketPath),schedule=await current(handler,schedulePath);
 if(!alreadyTyped)await browser.evaluate(typeDue(due));await browser.waitFor(button('设置共享时间','ready'));await browser.evaluate(button('设置共享时间','click'));
 await browser.waitFor(`globalThis.__t37BoundaryWrites.length===1&&document.querySelector(${JSON.stringify(region)})?.textContent.includes('结果未知')`);
 const writes=await browser.evaluate('globalThis.__t37BoundaryWrites') as Write[],original=writes[0];assert.ok(original&&original.request);assert.equal(original.path,schedulePath);assert.equal(original.method,'POST');assert.equal(original.status,200);assert.match(text(original.request.client_command_id),uuid);
 assert.deepEqual(original.request,{client_command_id:original.request.client_command_id,expected_version:version(before.version),expected_schedule_version:text(schedule.schedule_version),reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:due});
 assert.equal(original.ifMatch,'"'+version(before.version)+'"');assert.equal(original.idempotencyKey,original.request.client_command_id);assert.equal(original.csrfPresent,true);assert.equal(original.body.ok,true);assert.equal(original.body.replayed,false);assert.equal(original.body.ticket_version,version(before.version)+1);
 const actual=await current(handler,schedulePath);assert.equal(object(actual.active).due_at,due);assert.equal(actual.schedule_version,original.body.schedule_version);assert.equal(rows(actual.history)[0]?.ticket_event_id,original.body.ticket_event_id);
 const storage=await browser.evaluate(context.stored) as Storage;assert.equal(operationFor(storage)?.commandId,original.request.client_command_id);assert.ok(draftFor(storage));
 await writeFile(join(directory,'original-post-and-storage.json'),JSON.stringify({writes,storage},null,2));return original;
}
async function retainedOpaque(context:CaseContext,original:Write):Promise<Storage>{
 assert.ok(original.request);await context.browser.waitFor(button('只读核对原操作','ready'));
 const storage=await context.browser.evaluate(context.stored) as Storage;assert.equal(draftFor(storage),undefined,'T37_BOUNDARY_SENSITIVE_COPY_MUST_BE_REMOVED');assert.equal(operationFor(storage)?.commandId,original.request.client_command_id,'T37_BOUNDARY_ORIGINAL_OPAQUE_UUID_MUST_REMAIN');
 assert.deepEqual(operationFor(storage)?.keys,['commandId','createdAt','id','kind','principal','purpose','scope']);assert.equal(await context.browser.evaluate(`document.querySelector(${JSON.stringify(region+' input[name="due_at"]')})?.value??''`),'');
 assert.deepEqual(await context.browser.evaluate('globalThis.__t37BoundaryWrites'),[],'boundary reload must not POST');assert.equal(await context.browser.evaluate(`globalThis.__t37BoundaryReads.some(value=>value.path.startsWith(${JSON.stringify(context.schedulePath+'/commands/')}))`),false,'boundary reload must not automatically ACK');
 assert.equal(await context.browser.evaluate(`globalThis.__t37BoundaryReads.some(value=>value.path===${JSON.stringify(context.ticketPath)}&&value.status===200)`),true,'T37_OPAQUE_DISCOVERY_REQUIRES_CURRENT_INDEPENDENT_TICKET_READ');return storage;
}
async function acknowledge(context:CaseContext,original:Write){
 assert.ok(original.request);const expected=context.schedulePath+'/commands/'+text(original.request.client_command_id);
 await context.browser.evaluate(button('只读核对原操作','click'));await context.browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.textContent.includes('已核对原操作提交成功')&&!(${button('只读核对原操作')})`);
 const receipts=await context.browser.evaluate(`globalThis.__t37BoundaryReads.filter(value=>value.path.startsWith(${JSON.stringify(context.schedulePath+'/commands/')}))`) as Read[];assert.equal(receipts.length,1);const receipt=receipts[0];assert.ok(receipt);assert.equal(receipt.path,expected);assert.equal(receipt.status,200);assert.deepEqual(receipt.body,{ticket_id:context.ticketId,client_command_id:original.request.client_command_id,state:'COMMITTED',result:{...original.body,replayed:true}});
 await context.browser.waitFor(`(async()=>{const value=await (${context.stored});return !value.drafts.some(row=>row.purpose===${JSON.stringify(purpose)})&&!value.operations.some(row=>row.purpose===${JSON.stringify(purpose)});})()`);
 assert.deepEqual(await context.browser.evaluate('globalThis.__t37BoundaryWrites'),[]);return receipt;
}

test('T37 first-save TTL does not renew and genuine 24-hour expiry keeps only the original opaque UUID until explicit ACK',{timeout:240000},async()=>{
 await withBrowserCase('expiry',async context=>{
  const {browser,stored,directory}=context;await browser.evaluate(typeDue(firstDue));
  await browser.waitFor(`(async()=>{const value=await (${stored});return value.drafts.some(row=>row.purpose===${JSON.stringify(purpose)})&&document.querySelector(${JSON.stringify(region)})?.textContent.includes('已保存恢复副本');})()`);
  const first=draftFor(await browser.evaluate(stored) as Storage);assert.ok(first);assert.equal(first.expiresAt-first.firstSavedAt,86400000);assert.equal(first.extractable,false);assert.equal(first.plainCanary,false);
  await browser.evaluate('(()=>{const now=Date.now;Date.now=()=>now()+3600000;})()');await browser.evaluate(typeDue(updatedDue));
  await browser.waitFor(`(async()=>{const value=await (${stored}),draft=value.drafts.find(row=>row.purpose===${JSON.stringify(purpose)});return draft&&draft.revision!==${JSON.stringify(first.revision)}&&document.querySelector(${JSON.stringify(region)})?.textContent.includes('已保存恢复副本');})()`);
  const updated=draftFor(await browser.evaluate(stored) as Storage);assert.ok(updated);assert.notEqual(updated.revision,first.revision);assert.equal(updated.firstSavedAt,first.firstSavedAt,'T37_FIRST_SAVE_ORIGIN_MUST_NOT_RENEW');assert.equal(updated.expiresAt,first.expiresAt,'T37_FIRST_SAVE_EXPIRY_MUST_NOT_RENEW');
  const original=await commitUnknown(context,updatedDue,true),prepared=draftFor(await browser.evaluate(stored) as Storage);assert.ok(prepared);assert.equal(prepared.firstSavedAt,first.firstSavedAt);assert.equal(prepared.expiresAt,first.expiresAt);
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:'(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()'});await reload(browser);
  const retained=await retainedOpaque(context,original),receipt=await acknowledge(context,original),settled=await browser.evaluate(stored) as Storage;
  assert.equal((await current(await context.http(1),context.ticketPath)).version,original.body.ticket_version);
  await writeFile(join(directory,'expiry-facts.json'),JSON.stringify({first,updated,prepared,retained,receipt,settled,frontend_clock_only:true},null,2));
 });
});

for(const mode of [{name:'raw-off',raw:false,view:true},{name:'view-off',raw:true,view:false}] as const){
 test('T37 '+mode.name+' keeps opaque ACK independent after same-origin native runtime recomposition',{timeout:240000},async()=>{
  await withBrowserCase(mode.name,async context=>{
   const original=await commitUnknown(context);await context.recompose({raw:mode.raw,view:mode.view});
   const handler=await context.http(1),bootstrap=await current(handler,'/api/lifecycle/bootstrap');assert.equal(bootstrap.principal_id,context.fixture.handler);assert.equal(bootstrap.follow_up_schedules_enabled,mode.view);assert.equal(bootstrap.follow_up_schedule_draft_recovery_enabled,false);assert.equal(bootstrap.follow_up_schedule_receipt_enabled,true);
   await reload(context.browser);const retained=await retainedOpaque(context,original);
   if(!mode.view)assert.equal(await context.browser.evaluate(`globalThis.__t37BoundaryReads.some(value=>value.path===${JSON.stringify(context.schedulePath)})`),false,'T37_VIEW_OFF_RECOVERY_MUST_NOT_READ_DISABLED_VIEW');
   const receipt=await acknowledge(context,original);const settled=await context.browser.evaluate(context.stored) as Storage;assert.equal(draftFor(settled),undefined);assert.equal(operationFor(settled),undefined);
   if(!mode.view){assert.equal(await context.browser.evaluate(`globalThis.__t37BoundaryReads.some(value=>value.path===${JSON.stringify(context.schedulePath)})`),false);assert.equal(await context.browser.evaluate(button('设置共享时间')),false);}
   else{
    await context.browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(region+' input[name="due_at"]')}))&&!document.querySelector(${JSON.stringify(region+' input[name="due_at"]')}).disabled`);
    await context.browser.evaluate(typeDue(updatedDue));await context.browser.evaluate('new Promise(resolve=>setTimeout(resolve,650))');
    const afterInput=await context.browser.evaluate(context.stored) as Storage;assert.equal(draftFor(afterInput),undefined,'T37_RAW_OFF_MUST_NOT_REENABLE_AUTOSAVE_AFTER_OPAQUE_ACK');assert.equal(operationFor(afterInput),undefined);assert.deepEqual(await context.browser.evaluate('globalThis.__t37BoundaryWrites'),[]);
   }
   assert.equal((await current(handler,context.ticketPath)).version,original.body.ticket_version);
   await writeFile(join(context.directory,'flag-boundary-facts.json'),JSON.stringify({mode,bootstrap:{view:bootstrap.follow_up_schedules_enabled,raw:bootstrap.follow_up_schedule_draft_recovery_enabled,receipt:bootstrap.follow_up_schedule_receipt_enabled},retained,receipt,settled},null,2));
  });
 });
}

test('T37 maintenance loss removes sensitive content but keeps both real opaque commands; Ticket READ loss purges every purpose',{timeout:240000},async()=>{
 await withBrowserCase('authority',async context=>{
  const {browser,fixture,stored,ticketPath,schedulePath}=context,notePath=ticketPath+'/internal-notes';
  await browser.waitFor("Boolean(document.querySelector('#internal-note'))&&!document.querySelector('#internal-note').disabled");
  await browser.evaluate(`(()=>{const input=document.querySelector('#internal-note');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(noteCanary)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await browser.waitFor(`(async()=>{const value=await (${stored});return value.drafts.some(row=>row.purpose==='internal-note')&&document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本');})()`);
  // add-note also disappears after transfer. Create its real pending command while still authorized,
  // then lose only delivery of its actual 200 response, so the second purpose has a real opaque UUID.
  const beforeNote=await current(await context.http(1),ticketPath);
  await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t37NotePosts=[];globalThis.fetch=async(input,options)=>{const path=new URL(input instanceof Request?input.url:String(input),location.href).pathname,method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();const response=await original(input,options);if(method==='POST'&&path===${JSON.stringify(notePath)}){globalThis.__t37NotePosts.push({path,status:response.status,request:JSON.parse(options?.body??(input instanceof Request?await input.clone().text():'{}')),body:await response.clone().json()});if(response.status===200)throw new TypeError('SIMULATED_T37_REAL_NOTE_RESPONSE_LOSS');}return response;};})()`);
  await browser.waitFor("Boolean(document.querySelector('[data-action=save-internal-note]'))&&!document.querySelector('[data-action=save-internal-note]').disabled");
  await browser.evaluate("document.querySelector('[data-action=save-internal-note]').click()");
  await browser.waitFor("globalThis.__t37NotePosts.length===1&&document.querySelector('.ticket-note-state')?.textContent.includes('结果未知')");
  const notePosts=await browser.evaluate('globalThis.__t37NotePosts') as {path:string;status:number;request:Record<string,unknown>;body:Record<string,unknown>}[],noteOriginal=notePosts[0];assert.ok(noteOriginal);
  assert.equal(noteOriginal.path,notePath);assert.equal(noteOriginal.status,200);const noteId=text(noteOriginal.request.client_command_id);assert.match(noteId,uuid);
  assert.deepEqual(noteOriginal.request,{client_command_id:noteId,expected_version:version(beforeNote.version),reason_code:'WORKBENCH_INTERNAL_NOTE',note:noteCanary,external_visible:false});
  assert.equal(noteOriginal.body.ok,true);assert.equal(noteOriginal.body.replayed,false);assert.equal(noteOriginal.body.ticket_version,version(beforeNote.version)+1);assert.equal(operationFor(await browser.evaluate(stored) as Storage,'internal-note')?.commandId,noteId);
  await writeFile(join(context.directory,'original-note-post-and-storage.json'),JSON.stringify({notePosts,storage:await browser.evaluate(stored)},null,2));
  // Reload reads the real post-note Ticket version before preparing the separate follow-up command.
  // The note remains UNKNOWN; no note replay or receipt click is performed.
  await reload(browser);await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(region+' input[name="due_at"]')}))&&!document.querySelector(${JSON.stringify(region+' input[name="due_at"]')}).disabled&&globalThis.__t37BoundaryReads.some(value=>value.path===${JSON.stringify(schedulePath)}&&value.status===200)`);
  assert.equal(operationFor(await browser.evaluate(stored) as Storage,'internal-note')?.commandId,noteId);assert.deepEqual(await browser.evaluate('globalThis.__t37BoundaryWrites'),[]);
  const original=await commitUnknown(context);assert.ok(original.request);const before=await browser.evaluate(stored) as Storage;assert.deepEqual(before.operations.map(row=>row.purpose).sort(),['internal-note',purpose].sort());assert.ok(before.drafts.every(row=>!row.plainCanary));
  const dispatcher=await context.http(0),handler=await context.http(1),arranged=await current(dispatcher,ticketPath);
  const transferred=await dispatcher.post(ticketPath+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:version(arranged.version),reason_code:'WORKBENCH_TRANSFER',target_principal_id:fixture.otherHandler,resolver_team_id:text(arranged.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(transferred.status,200,JSON.stringify(transferred.value));
  const readable=await current(handler,ticketPath);assert.equal(readable.assignee_id,fixture.otherHandler);assert.ok(Array.isArray(readable.allowed_actions));assert.equal(readable.allowed_actions.includes('add-note'),false);assert.deepEqual((await current(handler,schedulePath)).allowed_actions,[]);
  await reload(browser);await retainedOpaque(context,original);
  await browser.waitFor(`(async()=>{const value=await (${stored});return value.drafts.length===0&&value.operations.some(row=>row.purpose==='internal-note'&&row.commandId===${JSON.stringify(noteId)})&&Boolean(document.querySelector('[data-action=check-expired-note]'));})()`);
  const retained=await browser.evaluate(stored) as Storage;assert.deepEqual(retained.drafts,[],'T37_MAINTENANCE_LOSS_MUST_CLEAR_SENSITIVE_CONTENT_FOR_BOTH_REVOKED_WRITE_PURPOSES');
  assert.equal(operationFor(retained,'internal-note')?.commandId,noteId);assert.equal(operationFor(retained)?.commandId,original.request.client_command_id);assert.deepEqual(retained.operations.map(row=>row.purpose).sort(),['internal-note',purpose].sort());
  const ackPath=schedulePath+'/commands/'+text(original.request.client_command_id),noteAckPath=notePath+'/commands/'+noteId,readableReceipt=await current(handler,ackPath),readableNoteReceipt=await current(handler,noteAckPath);
  assert.deepEqual(readableReceipt,{ticket_id:context.ticketId,client_command_id:original.request.client_command_id,state:'COMMITTED',result:{...original.body,replayed:true}});
  assert.deepEqual(readableNoteReceipt,{ticket_id:context.ticketId,client_command_id:noteId,state:'COMMITTED',result:{...noteOriginal.body,replayed:true}});
  // Independent native GETs prove both purpose receipts remain readable without settling either browser row.
  assert.deepEqual(await browser.evaluate(stored),retained);assert.equal(await browser.evaluate(`globalThis.__t37BoundaryReads.some(value=>value.path.includes('/commands/'))`),false);
  await fixture.setHandlerTeams([]);assert.equal((await handler.get(ticketPath)).status,404);assert.equal((await handler.get(schedulePath)).status,404);assert.equal((await handler.get(ackPath)).status,404);assert.equal((await handler.get(noteAckPath)).status,404);
  const authoritative=await current(dispatcher,ticketPath),scheduleBefore=await current(dispatcher,schedulePath);await reload(browser);
  await browser.waitFor(`(async()=>{const value=await (${stored});return value.drafts.length===0&&value.operations.length===0;})()`);
  const purged=await browser.evaluate(stored) as Storage;assert.deepEqual(purged,{drafts:[],operations:[]},'T37_TICKET_READ_LOSS_MUST_PURGE_ALL_PURPOSES');
  assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(region)}))`),false);assert.equal(await browser.evaluate("Boolean(document.querySelector('#internal-note'))"),false);assert.equal(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(noteCanary)})`),false);
  assert.deepEqual(await browser.evaluate('globalThis.__t37BoundaryWrites'),[]);assert.equal(await browser.evaluate("globalThis.__t37BoundaryReads.some(value=>value.path.includes('/commands/'))"),false,'READ loss cannot auto-ACK either purged operation');
  assert.deepEqual(await current(dispatcher,ticketPath),authoritative);assert.deepEqual(await current(dispatcher,schedulePath),scheduleBefore);
  await writeFile(join(context.directory,'authority-boundary-facts.json'),JSON.stringify({noteOriginal,before,retained,readableReceipt,readableNoteReceipt,purged,maintenance_read_status:200,revoked_read_status:404,real_purposes:['internal-note',purpose]},null,2));
 },true);
});
