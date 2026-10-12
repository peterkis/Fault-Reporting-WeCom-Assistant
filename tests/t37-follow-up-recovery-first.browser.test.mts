// STAGED_RUNTIME / first real browser execution pending. Prepared body and assertions retained.
// Intended location: tests/t37-follow-up-recovery-first.browser.test.mts.
// Requires only a fixture pass-through for the existing workbenchDraftRecoveryEnabled runtime option.
// First intended product RED: after real SET commits and its response is lost, reload loses the original UUID acknowledgement entry.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Read={path:string;status:number;body:Record<string,unknown>};
type Write=Read&{method:string;request:Record<string,unknown>;ifMatch:string|null;idempotencyKey:string|null;csrfPresent:boolean};
interface StorageFacts {databaseExists:boolean;drafts:number;operations:number;commandId:string|null;operationKeys:string[];firstSavedAt:number|null;expiresAt:number|null;extractable:boolean|null;plainDuePresent:boolean}
const drawer='dialog.detail-dialog[open]',region=drawer+' [role="region"][aria-label="共享下次跟进时间"]';
const dueAt='2030-01-02 09:30:00';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
async function drainActualProjection(fixture:T37Fixture){
  const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;
  }
  assert.fail('STAGED_PREREQUISITE: actual Core/Session/workbench projection did not settle');
}
function observeActualResponseLoss(schedulePath:string){return `(()=>{const original=globalThis.fetch;globalThis.__t37RecoveryWrites=[];globalThis.__t37RecoveryReads=[];globalThis.__t37RecoveryBootstrap=[];
  globalThis.fetch=async(input,options)=>{const target=new URL(input instanceof Request?input.url:String(input),location.href).pathname;
    const method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(options?.headers).forEach((value,key)=>headers.set(key,value));
    const request=method==='POST'&&target===${JSON.stringify(schedulePath)}?JSON.parse(options?.body??(input instanceof Request?await input.clone().text():'{}')):null;
    const response=await original(input,options);
    if(method==='GET'&&(target===${JSON.stringify(schedulePath)}||target.startsWith(${JSON.stringify(schedulePath+'/commands/')})))globalThis.__t37RecoveryReads.push({path:target,status:response.status,body:await response.clone().json()});
    if(method==='GET'&&target==='/api/lifecycle/bootstrap'){const value=await response.clone().json();globalThis.__t37RecoveryBootstrap.push({path:target,status:response.status,body:{principal_id:value.principal_id,follow_up_schedules_enabled:value.follow_up_schedules_enabled,follow_up_schedule_receipt_enabled:value.follow_up_schedule_receipt_enabled}});}
    if(method!=='GET')globalThis.__t37RecoveryWrites.push({path:target,method,status:response.status,body:target===${JSON.stringify(schedulePath)}?await response.clone().json():{},request,ifMatch:headers.get('if-match'),idempotencyKey:headers.get('idempotency-key'),csrfPresent:Boolean(headers.get('x-csrf-token'))});
    // The server and its ledger have really answered 200; only delivery of that response to the UI is lost.
    if(method==='POST'&&target===${JSON.stringify(schedulePath)}&&response.status===200)throw new TypeError('SIMULATED_T37_COMMITTED_RESPONSE_LOSS');
    return response;};})()`;}
function hasButton(label:string){return `(()=>{const element=document.querySelector(${JSON.stringify(region)});return Boolean([...(element?.querySelectorAll('button')??[])].find(button=>button.textContent.trim()===${JSON.stringify(label)}));})()`;}
function readyButton(label:string){return `(()=>{const element=document.querySelector(${JSON.stringify(region)}),button=[...(element?.querySelectorAll('button')??[])].find(value=>value.textContent.trim()===${JSON.stringify(label)});return Boolean(button&&!button.disabled);})()`;}
function clickButton(label:string){return `(()=>{const element=document.querySelector(${JSON.stringify(region)}),button=[...(element?.querySelectorAll('button')??[])].find(value=>value.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw Error('T37_REAL_RECOVERY_BUTTON_UNAVAILABLE');button.click();})()`;}
function storageFacts(scope:string){return `(async()=>{
  const absent={databaseExists:false,drafts:0,operations:0,commandId:null,operationKeys:[],firstSavedAt:null,expiresAt:null,extractable:null,plainDuePresent:false};
  if(!(await indexedDB.databases()).some(value=>value.name==='wecom-workbench-drafts-v1'))return absent;
  return new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onupgradeneeded=()=>request.transaction.abort();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('T37_RECOVERY_OBSERVER_BLOCKED'));
    request.onsuccess=()=>{const database=request.result;if(!database.objectStoreNames.contains('drafts')||!database.objectStoreNames.contains('operations')){database.close();reject(Error('T37_RECOVERY_STORES_MISSING'));return;}
      const transaction=database.transaction(['drafts','operations'],'readonly'),draft=transaction.objectStore('drafts').get(${JSON.stringify(scope)}),operation=transaction.objectStore('operations').get(${JSON.stringify(scope)});
      transaction.oncomplete=()=>{database.close();const row=draft.result,pending=operation.result;resolve({databaseExists:true,drafts:row?1:0,operations:pending?1:0,commandId:pending?.commandId??null,operationKeys:pending?Object.keys(pending).sort():[],firstSavedAt:row?.firstSavedAt??null,expiresAt:row?.expiresAt??null,extractable:row?.key?.extractable??null,plainDuePresent:JSON.stringify({row,pending}).includes(${JSON.stringify(dueAt)})});};
      transaction.onabort=()=>{database.close();reject(transaction.error??Error('T37_RECOVERY_OBSERVER_ABORTED'));};transaction.onerror=()=>{};};});})()`;}
async function reload(browser:Browser,schedulePath:string){
  const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
  await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'&&Boolean(document.querySelector(${JSON.stringify(drawer+' #detail-title')}))&&Boolean(document.querySelector(${JSON.stringify(region)}))&&globalThis.__t37RecoveryReads?.some(value=>value.path===${JSON.stringify(schedulePath)}&&value.status===200)`);
}
function errorFacts(error:unknown):unknown{return error instanceof Error?{name:error.name,message:error.message,stack:error.stack,...(error instanceof AggregateError?{errors:error.errors.map(errorFacts)}:{})}:error===null?null:String(error);}

test('production T37 raw recovery retains the original shared follow-up UUID across reload and explicitly GETs its committed result once',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),ticketPath='/api/tickets/'+ticketId,schedulePath=ticketPath+'/follow-up-schedule';
    const queued=await current(dispatcher,ticketPath);
    const assignment=await dispatcher.post(ticketPath+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(assignment.status,200,JSON.stringify(assignment.value));await drainActualProjection(fixture);
    const beforeTicket=await current(handler,ticketPath),beforeSchedule=await current(handler,schedulePath),bootstrap=await current(handler,'/api/lifecycle/bootstrap');
    assert.equal(beforeTicket.assignee_id,fixture.handler);assert.ok(object(beforeTicket.handling_cycle).id);assert.equal(beforeSchedule.active,null);assert.equal(beforeSchedule.schedule_version,'0');assert.deepEqual(beforeSchedule.allowed_actions,['SET']);
    assert.equal(bootstrap.follow_up_schedules_enabled,true);assert.equal(bootstrap.follow_up_schedule_receipt_enabled,true);assert.equal(bootstrap.principal_id,fixture.handler);
    const scope=JSON.stringify([text(bootstrap.principal_id),'ticket',ticketId,'shared-follow-up-schedule']),stored=storageFacts(scope);
    const cookie=fixture.runtime.authenticate.browserCookies?.()[1];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T37_NATIVE_HANDLER_COOKIE_REQUIRED');
    const directory=join(tmpdir(),'t37-follow-up-recovery-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observeActualResponseLoss(schedulePath)});await reload(browser,schedulePath);
      await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(region+' input[name="due_at"]')}))`);
      await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(region+' input[name="due_at"]')});if(!(input instanceof HTMLInputElement)||input.type!=='text')throw Error('T37_REAL_DUE_INPUT_REQUIRED');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error('T37_NATIVE_INPUT_REQUIRED');setter.call(input,${JSON.stringify(dueAt)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await browser.waitFor(readyButton('设置共享时间'));await browser.evaluate(clickButton('设置共享时间'));
      await browser.waitFor(`globalThis.__t37RecoveryWrites.length===1&&document.querySelector(${JSON.stringify(region)})?.textContent.includes('结果未知')`);
      const writes=await browser.evaluate('globalThis.__t37RecoveryWrites') as Write[],original=writes[0];assert.ok(original);
      assert.equal(original.path,schedulePath);assert.equal(original.method,'POST');assert.equal(original.status,200);assert.match(text(original.request.client_command_id),uuid);
      assert.deepEqual(original.request,{client_command_id:original.request.client_command_id,expected_version:version(beforeTicket.version),expected_schedule_version:'0',reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:dueAt});
      assert.equal(original.ifMatch,'"'+version(beforeTicket.version)+'"');assert.equal(original.idempotencyKey,original.request.client_command_id);assert.equal(original.csrfPresent,true);
      assert.equal(original.body.ok,true);assert.equal(original.body.ticket_id,ticketId);assert.equal(original.body.ticket_version,version(beforeTicket.version)+1);assert.equal(original.body.schedule_version,'1');assert.equal(original.body.control_event_id,null);assert.equal(original.body.replayed,false);
      await writeFile(join(directory,'original-post-observation.json'),JSON.stringify(writes,null,2));
      const originalId=text(original.request.client_command_id),ackPath=schedulePath+'/commands/'+originalId;
      assert.equal(await browser.evaluate(`globalThis.__t37RecoveryReads.some(value=>value.path.startsWith(${JSON.stringify(schedulePath+'/commands/')}))`),false,'UNKNOWN does not automatically ACK');
      const prepared=await browser.evaluate(stored) as StorageFacts;await writeFile(join(directory,'prepared-storage-observation.json'),JSON.stringify(prepared,null,2));
      await writeFile(join(directory,'pending-unknown.png'),Buffer.from(await browser.screenshot(),'base64'));
      const committedTicket=await current(handler,ticketPath),committedSchedule=await current(handler,schedulePath);
      assert.equal(committedTicket.version,original.body.ticket_version);assert.equal(committedSchedule.schedule_version,'1');assert.equal(object(committedSchedule.active).due_at,dueAt);assert.equal(rows(committedSchedule.history).length,1);assert.equal(rows(committedSchedule.history)[0]?.ticket_event_id,original.body.ticket_event_id);
      await reload(browser,schedulePath);
      const restored=await browser.evaluate(stored) as StorageFacts;
      // Wait for asynchronous restoration only when an existing operation was actually observed.
      // With current disabled recovery there is no stored operation, so the next assertion is the first product RED.
      if(restored.operations===1)await browser.waitFor(readyButton('只读核对原操作'));
      assert.equal(await browser.evaluate(hasButton('只读核对原操作')),true,'T37_RELOAD_MUST_RETAIN_ORIGINAL_UUID_ACK_ENTRY');
      assert.equal(restored.operations,1);assert.equal(restored.commandId,originalId);assert.deepEqual(restored.operationKeys,['commandId','createdAt','id','kind','principal','purpose','scope']);
      assert.equal(restored.drafts,1);assert.equal(restored.extractable,false);assert.equal(restored.plainDuePresent,false);assert.equal(typeof restored.firstSavedAt,'number');assert.equal(typeof restored.expiresAt,'number');assert.equal((restored.expiresAt??0)-(restored.firstSavedAt??0),86400000);
      assert.equal(restored.firstSavedAt,prepared.firstSavedAt);assert.equal(restored.expiresAt,prepared.expiresAt);
      assert.deepEqual(await browser.evaluate('globalThis.__t37RecoveryWrites'),[],'reload must not resend the original command or generate a fresh command');
      assert.equal(await browser.evaluate(`globalThis.__t37RecoveryReads.some(value=>value.path.startsWith(${JSON.stringify(schedulePath+'/commands/')}))`),false,'reload preserves UNKNOWN until an explicit read-only acknowledgement');
      await writeFile(join(directory,'restored-storage-observation.json'),JSON.stringify(restored,null,2));
      await browser.evaluate(clickButton('只读核对原操作'));
      await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.textContent.includes('已核对原操作提交成功')&&!(${hasButton('只读核对原操作')})`);
      const reads=await browser.evaluate(`globalThis.__t37RecoveryReads.filter(value=>value.path.startsWith(${JSON.stringify(schedulePath+'/commands/')}))`) as Read[];
      assert.equal(reads.length,1,'exactly one explicit purpose GET is sufficient');const acknowledgement=reads[0];assert.ok(acknowledgement);assert.equal(acknowledgement.path,ackPath);assert.equal(acknowledgement.status,200);
      assert.deepEqual(acknowledgement.body,{ticket_id:ticketId,client_command_id:originalId,state:'COMMITTED',result:{...original.body,replayed:true}});
      assert.deepEqual(await browser.evaluate('globalThis.__t37RecoveryWrites'),[],'explicit acknowledgement cannot create a second business write');
      await browser.waitFor(`(async()=>{const value=await (${stored});return value.drafts===0&&value.operations===0;})()`);
      const settled=await browser.evaluate(stored) as StorageFacts;assert.equal(settled.drafts,0);assert.equal(settled.operations,0);assert.equal(settled.commandId,null);
      assert.deepEqual(await current(handler,ticketPath),committedTicket);assert.deepEqual(await current(handler,schedulePath),committedSchedule);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
      await writeFile(join(directory,'terminal-recovery-facts.json'),JSON.stringify({original_uuid:originalId,prepared,restored,settled,acknowledgement,post_count_before_reload:1,post_count_after_reload:0,automatic_ack_count:0},null,2));
      const pixels=Buffer.from(await browser.screenshot(),'base64'),screenshotDirectory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(screenshotDirectory);const file=join(screenshotDirectory,'new-detail-1920.png');await writeFile(file,pixels);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T37_SHARED_TIME_RECOVERY_ORIGINAL_UUID_EXPLICIT_ACK',evidence_directory:directory,screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));
    }catch(failure){
      error=failure;try{await writeFile(join(directory,'primary-error.json'),JSON.stringify(errorFacts(failure),null,2));if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate(`({sharedTimeText:document.querySelector(${JSON.stringify(region)})?.innerText??'',reads:globalThis.__t37RecoveryReads,writes:globalThis.__t37RecoveryWrites,bootstrap:globalThis.__t37RecoveryBootstrap})`),null,2));}}
      catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure],'T37_RECOVERY_FAILURE_EVIDENCE');}
      console.log('T37_BROWSER_FAILURE '+JSON.stringify({directory}));
    }
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,workbenchDraftRecoveryEnabled:true});
});
