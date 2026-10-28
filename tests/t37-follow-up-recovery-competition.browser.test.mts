// STAGED_RUNTIME / first real competition execution pending; no direct draft-row writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Tab=Awaited<ReturnType<typeof yxxTab>>;
type Surface=Pick<Browser,'evaluate'|'waitFor'>;
type RequestFact={method:string;path:string;status:number|null};
const region='.detail-dialog[role=dialog] [role="region"][aria-label="共享下次跟进时间"]';
const dueX='2030-01-02 09:30:00',dueY='2030-01-02 10:00:00';
const regionNode=`document.querySelector(${JSON.stringify(region)})`;
const inputNode=`document.querySelector(${JSON.stringify(region+' input[name="due_at"]')})`;
function button(label:string){return `[...(${regionNode}?.querySelectorAll('button')??[])].find(button=>button.textContent.trim()===${JSON.stringify(label)})`;}
function readyButton(label:string){return `Boolean(${button(label)})&&!(${button(label)}).disabled`;}
async function click(surface:Surface,label:string){await surface.waitFor(readyButton(label));await surface.evaluate(`(()=>{const button=${button(label)};if(!button||button.disabled)throw Error('T37_NATIVE_CONTROL_UNAVAILABLE');button.click();})()`);}
async function fill(surface:Surface,due:string){await surface.evaluate(`(()=>{const input=${inputNode};if(!(input instanceof HTMLInputElement)||input.type!=='text'||input.disabled)throw Error('T37_NATIVE_INPUT_UNAVAILABLE');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error('T37_NATIVE_INPUT_SETTER_REQUIRED');setter.call(input,${JSON.stringify(due)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function ready(surface:Surface){await surface.waitFor('Boolean(document.querySelector(".detail-workflows"))');await surface.evaluate("(()=>{const panel=document.querySelector('.detail-workflows');if(!panel.hasAttribute('data-expanded'))panel.querySelector('.workbench-disclosure-trigger').click();})()");await surface.waitFor(`Boolean(${inputNode})&&!(${inputNode}).disabled&&${regionNode}?.innerText.includes('草稿仅在当前浏览器')`);}
async function current(http:T37Http,path:string){const response=await http.get(path);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function drain(fixture:T37Fixture){
 const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
 for(let step=0;step<bound;step++){const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});assert.ok(inbound.streams.every(stream=>stream.failures.length===0));if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;}
 assert.fail('actual Core/Session/workbench projection did not settle');
}
function stored(principal:string,ticketId:string){
 const scope=JSON.stringify([principal,'ticket',ticketId,'shared-follow-up-schedule']);
 return `(async()=>{if(!(await indexedDB.databases()).some(database=>database.name==='wecom-workbench-drafts-v1'))return {drafts:0,operations:0,revision:null,commandId:null};return new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onupgradeneeded=()=>request.transaction.abort();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('T37_STORE_OBSERVER_BLOCKED'));request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations'],'readonly'),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();const draft=drafts.result.find(row=>row.scope===${JSON.stringify(scope)}),operation=operations.result.find(row=>row.scope===${JSON.stringify(scope)});resolve({drafts:drafts.result.length,operations:operations.result.length,revision:draft?.revision??null,commandId:operation?.commandId??null});};tx.onabort=()=>{db.close();reject(tx.error??Error('T37_STORE_OBSERVER_ABORTED'));};tx.onerror=()=>{};};});})()`;
}
/** Observe real replies; optional seams lose/delay delivery after the real server has answered. */
function transport(schedulePath:string){return `(()=>{const original=globalThis.fetch;globalThis.__t37Transport={posts:[],acks:[],views:[],dropPost:false,failAfterPost:false,failViews:false,holdAckId:null,held:0,ackState:'NONE',holdNextView:false,heldViews:0,viewState:'NONE'};
 globalThis.__t37ReleaseAck=()=>{};const viewReleases=[];globalThis.__t37ReleaseView=()=>{globalThis.__t37Transport.holdNextView=false;for(const release of viewReleases.splice(0))release();};globalThis.__t37RestoreFetch=()=>{globalThis.fetch=original;};
 globalThis.fetch=async(input,options)=>{const path=new URL(input instanceof Request?input.url:String(input),location.href).pathname,method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase(),state=globalThis.__t37Transport;
  const response=await original(input,options);
  if(method==='POST'&&path===${JSON.stringify(schedulePath)}){const body=await response.clone().json(),command=JSON.parse(options?.body??(input instanceof Request?await input.clone().text():'{}'));state.posts.push({status:response.status,body,command});if(response.status===200&&state.failAfterPost)state.failViews=true;if(response.status===200&&state.dropPost)throw new TypeError('T37_REAL_COMMIT_RESPONSE_LOST');}
  if(method==='GET'&&path===${JSON.stringify(schedulePath)}){state.views.push({status:response.status,body:await response.clone().json()});if(state.holdNextView&&state.acks.length>0){state.heldViews++;state.viewState='HELD';const signal=options?.signal??(input instanceof Request?input.signal:null);await new Promise((resolve,reject)=>{let finished=false;const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',aborted);state.viewState=error?'ABORTED':'RELEASED';error?reject(error):resolve();},aborted=()=>finish(new DOMException('Actual consumer aborted held current view','AbortError')),timer=setTimeout(()=>finish(Error('T37_HELD_REAL_VIEW_TIMEOUT')),60_000);viewReleases.push(()=>finish());signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();});}if(state.failViews)throw new TypeError('T37_REAL_VIEW_RESPONSE_LOST');}
  if(method==='GET'&&path.startsWith(${JSON.stringify(schedulePath+'/commands/')})){state.acks.push({path,status:response.status,body:await response.clone().json()});if(path===${JSON.stringify(schedulePath+'/commands/')}+state.holdAckId){state.held++;state.ackState='HELD';const signal=options?.signal??(input instanceof Request?input.signal:null);
   await new Promise((resolve,reject)=>{let finished=false;const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',aborted);state.ackState=error?'ABORTED':'RELEASED';error?reject(error):resolve();},aborted=()=>finish(new DOMException('Actual consumer aborted held ACK','AbortError')),timer=setTimeout(()=>finish(Error('T37_HELD_REAL_ACK_TIMEOUT')),60_000);globalThis.__t37ReleaseAck=()=>finish();signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();});}
  }
  return response;};})()`;}
async function reload(browser:Browser){const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${before}&&Boolean(${regionNode})`);}
async function tick(surface:Surface){await surface.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');}
function errorFacts(error:unknown):unknown{return error instanceof Error?{name:error.name,message:error.message,stack:error.stack,...(error instanceof AggregateError?{errors:error.errors.map(errorFacts)}:{})}:error===null?null:String(error);}
async function storeModulePath(){
 const manifest=object(JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')));
 const file=text(object(manifest['src/feedback-recovery.ts']).file);assert.match(file,/^assets\/[A-Za-z0-9_-]+\.js$/u);
 const inventory:unknown=JSON.parse(await readFile(new URL('../web/admin-workbench/asset-inventory.json',import.meta.url),'utf8'));
 assert.ok(Array.isArray(inventory)&&inventory.includes(file),'the same compiled public store entry must belong to the production asset inventory');
 return '/workbench/app/'+file;
}
interface Context {fixture:T37Fixture;handler:T37Http;ticketId:string;path:string;schedulePath:string;page:string;browser:Browser;otherTicketIds:string[];requests:RequestFact[];peer():Promise<Tab>}
async function withBrowserCase(label:string,otherCount:number,run:(context:Context)=>Promise<void>){
 await withT37Fixture(async fixture=>{
  const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),otherTicketIds:string[]=[];
  for(let index=0;index<otherCount;index++)otherTicketIds.push(await fixture.createTicket());
  for(const id of [ticketId,...otherTicketIds]){const ticketPath='/api/tickets/'+id,queued=await current(dispatcher,ticketPath),assigned=await dispatcher.post(ticketPath+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));}
  await drain(fixture);
  const path='/api/tickets/'+ticketId,schedulePath=path+'/follow-up-schedule',page=fixture.origin+'/workbench/app/items/ticket/'+ticketId;
  const bootstrap=await current(handler,'/api/lifecycle/bootstrap');assert.equal(bootstrap.follow_up_schedule_draft_recovery_enabled,true);assert.equal(bootstrap.follow_up_schedules_enabled,true);
  assert.equal((await current(handler,path)).assignee_id,fixture.handler);assert.equal((await current(handler,schedulePath)).active,null);
  const cookie=fixture.runtime.authenticate.browserCookies?.()[1];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T37_REAL_HANDLER_COOKIE_REQUIRED');
  const requests:RequestFact[]=[],tabs:Tab[]=[];
  const observe=(request:IncomingMessage,response:ServerResponse)=>{if(!request.headers.cookie?.split(';').some(part=>part.trim()===cookie.name+'='+cookie.value))return;const requestPath=new URL(request.url??'/',fixture.origin).pathname;if(requestPath!==schedulePath&&!requestPath.startsWith(schedulePath+'/commands/'))return;const fact={method:request.method??'',path:requestPath,status:null as number|null};requests.push(fact);response.once('finish',()=>{fact.status=response.statusCode;});};
  fixture.runtime.server.on('request',observe);
  const directory=join(tmpdir(),'t37-recovery-competition-'+label+'-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:page,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:transport(schedulePath)});await reload(browser);await ready(browser);
   const activeBrowser=browser;
   const peer=async()=>{const tab=await yxxTab(activeBrowser,'about:blank');tabs.push(tab);await tab.command('Page.enable');await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:transport(schedulePath)});await tab.command('Page.navigate',{url:page});await tab.waitFor(`Boolean(${regionNode})`);return tab;};
   await run({fixture,handler,ticketId,path,schedulePath,page,browser,otherTicketIds,requests,peer});
   const pixels=Buffer.from(await browser.screenshot(),'base64'),screenshots=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(screenshots);const file=join(screenshots,'new-detail-1920.png');await writeFile(file,pixels);
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T37_RECOVERY_COMPETITION_'+label,evidence_directory:directory,screenshots:[{file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')}]}));
  }catch(error){primary=error;try{await writeFile(join(directory,'primary-error.json'),JSON.stringify(errorFacts(error),null,2));if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate(`({text:${regionNode}?.innerText??'',transport:globalThis.__t37Transport})`)));}}catch(evidenceError){primary=new AggregateError([error,evidenceError],'T37_RECOVERY_COMPETITION_EVIDENCE');}
   console.log('T37_BROWSER_FAILURE '+JSON.stringify({directory}));}
  await closeBrowserTestResources([
   async()=>{if(browser)await browser.evaluate('globalThis.__t37ReleaseAck?.();globalThis.__t37ReleaseView?.();globalThis.__t37ReleaseEncryption?.();globalThis.__t37RestoreFetch?.();');},
   ...tabs.map(tab=>async()=>{try{await tab.evaluate('globalThis.__t37ReleaseAck?.();globalThis.__t37ReleaseView?.();globalThis.__t37RestoreFetch?.();');}finally{await tab.close();}}),
   async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
   async()=>{fixture.runtime.server.off('request',observe);await writeFile(join(directory,'requests.json'),JSON.stringify(requests));},
  ],primary);
 },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,workbenchDraftRecoveryEnabled:true});
}

test('prepare capacity failure leaves zero POST and zero phantom operation while retaining a clearable input',{timeout:240000},async()=>{
 await withBrowserCase('CAPACITY',20,async({fixture,handler,ticketId,path,schedulePath,browser,otherTicketIds,requests})=>{
  const before=await current(handler,path),scheduleBefore=await current(handler,schedulePath),modulePath=await storeModulePath();
  await browser.evaluate(`(async()=>{globalThis.__t37Store=await import(${JSON.stringify(modulePath)});})()`);
  for(const id of otherTicketIds){
   const scope={principal:fixture.handler,kind:'ticket',id,purpose:'shared-follow-up-schedule'};
   const saved=object(await browser.evaluate(`(async()=>{const response=await fetch('/api/tickets/'+${JSON.stringify(id)}+'/follow-up-schedule');if(response.status!==200)throw Error('T37_CAPACITY_SCOPE_READ_REQUIRED');const view=await response.json();if(!view.allowed_actions.includes('SET'))throw Error('T37_CAPACITY_SCOPE_MAINTENANCE_REQUIRED');const module=globalThis.__t37Store,scope=${JSON.stringify(scope)},copy=await module.openDraft(scope);await module.saveDraft(copy.handle,JSON.stringify({schema:1,value:${JSON.stringify(dueX)},pending:null}));const verified=await module.openDraft(scope);return {record:Boolean(verified.handle.record),operation:verified.handle.operation,text:verified.text};})()`));
   assert.equal(saved.record,true);assert.equal(saved.operation,null);assert.equal(saved.text,JSON.stringify({schema:1,value:dueX,pending:null}));
  }
  const full=object(await browser.evaluate(stored(fixture.handler,ticketId)));assert.deepEqual(full,{drafts:20,operations:0,revision:null,commandId:null});
  // Hold real encryption until submit has entered prepare; no capacity, row or success result is replaced.
  await browser.evaluate(`(()=>{const original=crypto.subtle.encrypt.bind(crypto.subtle),held=[];globalThis.__t37EncryptionHeld=0;crypto.subtle.encrypt=(...args)=>new Promise((resolve,reject)=>{globalThis.__t37EncryptionHeld++;held.push(()=>original(...args).then(resolve,reject));});globalThis.__t37ReleaseEncryption=()=>{crypto.subtle.encrypt=original;for(const release of held.splice(0))release();};})()`);
  await fill(browser,dueX);await click(browser,'设置共享时间');await browser.waitFor(`globalThis.__t37EncryptionHeld>0&&document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('正在保存共享时间')`);
  await browser.evaluate('globalThis.__t37ReleaseEncryption()');await browser.waitFor(`document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('操作尚未发送')`);
  assert.equal(requests.filter(request=>request.method==='POST').length,0);assert.deepEqual(await browser.evaluate(stored(fixture.handler,ticketId)),full);
  assert.equal(await browser.evaluate(`Boolean(${button('只读核对原操作')})`),false,'a failed prepare must not create an ACK target which the server never received');
  assert.equal(await browser.evaluate(`${inputNode}.value`),dueX);await click(browser,'清空未提交输入');await browser.waitFor(`${inputNode}?.value===''`);
  assert.deepEqual(await browser.evaluate(stored(fixture.handler,ticketId)),full,'unrelated capacity control drafts remain intact');
  assert.deepEqual(await current(handler,path),before);assert.deepEqual(await current(handler,schedulePath),scheduleBefore);
  assert.equal(requests.some(request=>request.path.startsWith(schedulePath+'/commands/')),false);
 });
});

test('a delayed real ACK for X cannot replace another tab Y operation or send X again',{timeout:240000},async()=>{
 await withBrowserCase('LATE_ACK',0,async({fixture,handler,ticketId,schedulePath,browser,requests,peer})=>{
  await browser.evaluate('globalThis.__t37Transport.dropPost=true');await fill(browser,dueX);await click(browser,'设置共享时间');
  await browser.waitFor(`document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('结果未知')&&globalThis.__t37Transport.posts.length===1`);
  const x=object(await browser.evaluate('globalThis.__t37Transport.posts[0]'));assert.equal(x.status,200);const xId=text(object(x.command).client_command_id);
  assert.equal(object(await browser.evaluate(stored(fixture.handler,ticketId))).commandId,xId);
  await browser.evaluate(`globalThis.__t37Transport.holdAckId=${JSON.stringify(xId)}`);await click(browser,'只读核对原操作');
  await browser.waitFor('globalThis.__t37Transport.held===1&&globalThis.__t37Transport.ackState==="HELD"');
  const originalAck=object(rows(object(await browser.evaluate('globalThis.__t37Transport')).acks)[0]);assert.equal(originalAck.status,200);assert.equal(object(originalAck.body).state,'COMMITTED');
  const other=await peer();await other.command('Page.bringToFront');
  const beforeOtherAckViews=await other.evaluate('globalThis.__t37Transport.views.length');assert.ok(typeof beforeOtherAckViews==='number');
  // Hold delivery of the real current view while the same ACK still owns the request.
  await other.evaluate('globalThis.__t37Transport.holdNextView=true');await click(other,'只读核对原操作');
  await other.waitFor('globalThis.__t37Transport.heldViews===1&&globalThis.__t37Transport.viewState==="HELD"');await tick(other);
  const heldView=object(rows(object(await other.evaluate('globalThis.__t37Transport')).views).at(-1));
  assert.equal(heldView.status,200);assert.equal(object(heldView.body).schedule_version,'1');assert.equal(object(object(heldView.body).active).due_at,dueX);
  assert.equal(await other.evaluate(`${inputNode}.disabled`),true,'the previous ACK current-view read must keep the form busy');
  assert.equal(await other.evaluate(readyButton('设置共享时间')),false,'Y must not be offered while the old ACK still owns the request');
  assert.equal(requests.filter(request=>request.method==='POST').length,1);await other.evaluate('globalThis.__t37ReleaseView()');
  await other.waitFor(`document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('已核对原操作提交成功')&&!Boolean(${button('只读核对原操作')})&&globalThis.__t37Transport.views.length>${beforeOtherAckViews}`);
  await tick(other);await other.waitFor(`Boolean(${inputNode})&&!(${inputNode}).disabled`);
  await other.evaluate('globalThis.__t37Transport.dropPost=true');await fill(other,dueY);await click(other,'设置共享时间');
  await other.waitFor(`document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('结果未知')&&globalThis.__t37Transport.posts.length===1`);
  const y=object(await other.evaluate('globalThis.__t37Transport.posts[0]'));assert.equal(y.status,200);const yId=text(object(y.command).client_command_id);assert.notEqual(yId,xId);
  const retained=object(await other.evaluate(stored(fixture.handler,ticketId)));assert.equal(retained.commandId,yId);assert.ok(retained.revision);
  const arranged=await current(handler,schedulePath);assert.equal(arranged.schedule_version,'2');assert.equal(object(arranged.active).due_at,dueY);
  await browser.command('Page.bringToFront');await browser.evaluate('globalThis.__t37ReleaseAck()');await browser.waitFor('globalThis.__t37Transport.ackState==="RELEASED"||globalThis.__t37Transport.ackState==="ABORTED"');await tick(browser);
  await browser.waitFor(`!document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('正在只读核对')`);
  assert.deepEqual(await browser.evaluate(stored(fixture.handler,ticketId)),retained,'old X cleanup must preserve actual Y recovery and its CAS revision');
  assert.equal(requests.filter(request=>request.method==='POST').length,2,'only the two deliberate SETs reached the server');
  // A settled broadcast may clear A before Y exists. Normal reload may discover Y; no new-save broadcast is required.
  if(!await browser.evaluate(`Boolean(${button('只读核对原操作')})`))await reload(browser);
  await click(browser,'只读核对原操作');
  await browser.waitFor(`document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('已核对原操作提交成功')&&!Boolean(${button('只读核对原操作')})`);
  const ackRequests=requests.filter(request=>request.method==='GET'&&request.path.startsWith(schedulePath+'/commands/'));
  assert.equal(ackRequests.at(-1)?.path,schedulePath+'/commands/'+yId,'A must acknowledge the actual current Y operation, never remain pinned to old X');
  assert.equal(ackRequests.filter(request=>request.path===schedulePath+'/commands/'+xId).length,2,'one original held X GET plus B deliberate X GET, no third X GET');
  assert.deepEqual(await browser.evaluate(stored(fixture.handler,ticketId)),{drafts:0,operations:0,revision:null,commandId:null});
  assert.deepEqual(await current(handler,schedulePath),arranged);assert.equal(requests.filter(request=>request.method==='POST').length,2);
 });
});

test('a confirmed production POST remains submitted when delivery of the subsequent current-view response fails',{timeout:240000},async()=>{
 await withBrowserCase('CONFIRMED_VIEW_FAILURE',0,async({fixture,handler,ticketId,schedulePath,browser,requests})=>{
  await browser.evaluate('globalThis.__t37Transport.failAfterPost=true');await fill(browser,dueX);await click(browser,'设置共享时间');
  await browser.waitFor(`document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('原操作已确认提交')&&document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('最新安排暂未读回')`);
  const transport=object(await browser.evaluate('globalThis.__t37Transport')),post=rows(transport.posts)[0];assert.ok(post);assert.equal(post.status,200);assert.equal(object(post.body).ok,true);
  assert.equal(requests.filter(request=>request.method==='POST').length,1);assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-toast-source=follow-up]')?.textContent.includes('结果未知'))`),false);
  assert.equal(await browser.evaluate(`Boolean(${button('只读核对原操作')})`),false);assert.deepEqual(await browser.evaluate(stored(fixture.handler,ticketId)),{drafts:0,operations:0,revision:null,commandId:null});
  const arranged=await current(handler,schedulePath);assert.equal(arranged.schedule_version,'1');assert.equal(object(arranged.active).due_at,dueX);
  await browser.evaluate('globalThis.__t37Transport.failViews=false;globalThis.__t37Transport.failAfterPost=false');await click(browser,'重新读取共享时间');
  await browser.waitFor(`${regionNode}?.innerText.includes(${JSON.stringify(dueX)})&&!${regionNode}?.innerText.includes('最新安排仍需重新读取')`);
  assert.equal(requests.filter(request=>request.method==='POST').length,1,'recovering current facts never resends the confirmed command');
  assert.equal(requests.some(request=>request.path.startsWith(schedulePath+'/commands/')),false);assert.deepEqual(await current(handler,schedulePath),arranged);
 });
});
