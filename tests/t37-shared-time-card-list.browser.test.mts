// STAGED_RUNTIME / first actual contract or shared card/list execution pending.
// Existing card, row-link, drawer and controls are read from the production bundle.
// The first intended RED follows an actual SET and confirmed detail: card omits the shared time.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type ImageReceipt={file:string;width:number;height:number;sha256:string;phase:string};
const dueAt='2020-01-02 09:30:00',dueEpoch='1577928600000';
const drawer='dialog.detail-dialog[open]',region=drawer+' [role="region"][aria-label="共享下次跟进时间"]';
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const response=await http.get(path);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
async function drain(fixture:T37Fixture){
  const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;
  }
  assert.fail('actual Core/Session/workbench projection did not settle');
}
function cardNode(ticketId:string){return `document.querySelector(${JSON.stringify('article.ticket-card[data-kind="ticket"][data-item-id="'+ticketId+'"]')})`;}
function rowNode(ticketId:string){return `[...document.querySelectorAll('.work-table tbody tr')].find(row=>[...row.querySelectorAll('a.row-link')].some(link=>new URL(link.href).pathname===${JSON.stringify('/workbench/app/items/ticket/'+ticketId)}))`;}
function surface(node:string){return `(()=>{const node=${node};return node?{found:true,text:node.innerText}:{found:false,text:''};})()`;}
async function activeSurface(browser:Browser,node:string,label:string){
  const shown=object(await browser.evaluate(surface(node)));assert.equal(shown.found,true,label+' target must exist');
  const content=text(shown.text);
  assert.ok(content.includes(dueAt),label==='card'?'T37_PRODUCTION_CARD_SHARED_TIME_REQUIRED':label+': same Shanghai shared time required');
  assert.ok(content.includes('已到期'),label+': overdue remains an active arrangement');
  assert.equal(content.includes('2020-01-01 17:30:00'),false,label+': never convert the Shanghai contract to browser Pacific time');
}
async function inactiveSurface(browser:Browser,node:string,label:string){
  const shown=object(await browser.evaluate(surface(node)));assert.equal(shown.found,true,label+' target survives cancellation');
  assert.equal(text(shown.text).includes(dueAt),false,label+': cancelled time must leave the active surface');
  assert.equal(text(shown.text).includes('已到期'),false,label+': cancelled arrangement has no active due hint');
}
function observe(){return `(()=>{const original=globalThis.fetch;globalThis.__t37CardHttp=[];
  globalThis.fetch=async(input,options)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href),method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(!url.pathname.startsWith('/api/'))return original(input,options);
    if(globalThis.__t37CardHttp.length>=400)throw Error('T37_HTTP_OBSERVATION_BOUND');
    const fact={path:url.pathname,search:url.search,method,status:null,body:null,request:null,error:false,done:false};globalThis.__t37CardHttp.push(fact);
    if(method==='POST'&&/\\/follow-up-schedule$/.test(url.pathname))fact.request=JSON.parse(options?.body??(input instanceof Request?await input.clone().text():'{}'));
    try{const response=await original(input,options);fact.status=response.status;
      if(url.pathname==='/api/workbench/board'||/\\/follow-up-schedule$/.test(url.pathname)){try{fact.body=await response.clone().json();}catch{fact.error=true;}}
      return response;
    }catch(error){fact.error=true;throw error;}finally{fact.done=true;}};})()`;}
async function settle(browser:Browser){
  await browser.waitFor('globalThis.__t37CardHttp.every(fact=>fact.done===true)');
  await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  await browser.waitFor('globalThis.__t37CardHttp.every(fact=>fact.done===true)');
}
async function assertNoFanout(browser:Browser,mark:number){
  await settle(browser);
  const reads=rows(await browser.evaluate(`globalThis.__t37CardHttp.slice(${mark})`));
  assert.equal(reads.some(read=>/^\/api\/tickets\//u.test(text(read.path))||/^\/api\/workbench\/items\//u.test(text(read.path))),false,
    'board/list must use the existing batched page DTO, without per-Ticket GET fanout');
  assert.equal(reads.some(read=>read.method!=='GET'),false,'board/list display and refresh are fact reads');
}
async function refreshWithoutFanout(browser:Browser,node:string){
  await settle(browser);const mark=await browser.evaluate('globalThis.__t37CardHttp.length');assert.ok(typeof mark==='number');
  await browser.evaluate(`(()=>{const button=[...document.querySelectorAll('.toolbar .tools button')].find(node=>node.textContent.trim()==='刷新');if(!button||button.disabled)throw Error('T37_NATIVE_REFRESH_REQUIRED');button.click();})()`);
  await browser.waitFor(`globalThis.__t37CardHttp.slice(${mark}).filter(fact=>fact.method==='GET'&&fact.path==='/api/workbench/board'&&fact.status===200).length===3&&Boolean(${node})`);
  await assertNoFanout(browser,mark);
}
async function view(browser:Browser,label:'看板'|'列表',node:string){
  const mark=await browser.evaluate('globalThis.__t37CardHttp.length');assert.ok(typeof mark==='number');
  await browser.evaluate(`(()=>{const button=[...document.querySelectorAll('.view-tabs button')].find(node=>node.textContent.trim()===${JSON.stringify(label)});if(!button)throw Error('T37_NATIVE_VIEW_CONTROL_REQUIRED');button.click();})()`);
  await browser.waitFor(`Boolean(${node})`);await refreshWithoutFanout(browser,node);await assertNoFanout(browser,mark);
}
async function closeDetail(browser:Browser){
  await browser.evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(drawer+' [aria-label="关闭详情"]')});if(!button||button.disabled)throw Error('T37_NATIVE_DETAIL_CLOSE_REQUIRED');button.click();})()`);
  await browser.waitFor('!document.querySelector("dialog.detail-dialog")');
}
async function openDetail(browser:Browser,node:string,linkSelector:string){
  await browser.evaluate(`(()=>{const root=${node},link=root?.querySelector(${JSON.stringify(linkSelector)});if(!link)throw Error('T37_NATIVE_ITEM_LINK_REQUIRED');link.click();})()`);
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(region)}))`);
}
async function clickSchedule(browser:Browser,label:string){
  await browser.evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(region)}),button=[...(root?.querySelectorAll('button')??[])].find(node=>node.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw Error('T37_NATIVE_SHARED_TIME_CONTROL_REQUIRED');button.click();})()`);
}
async function capture(browser:Browser,phase:string,name:'new-board-1920.png'|'new-list-1920.png'|'new-detail-1920.png'):Promise<ImageReceipt>{
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);await writeFile(file,pixels);
  assert.deepEqual(await readdir(directory),[name],'each successful PNG has its own UUID directory and only one allowlisted file');
  assert.equal(pixels.readUInt32BE(16),1920);assert.equal(pixels.readUInt32BE(20),1080);
  return {file,width:1920,height:1080,sha256:createHash('sha256').update(pixels).digest('hex'),phase};
}
async function writeFact(browser:Browser,path:string,action:'SET'|'CANCEL'){
  await browser.waitFor(`globalThis.__t37CardHttp.some(fact=>fact.path===${JSON.stringify(path)}&&fact.method==='POST'&&fact.request?.action===${JSON.stringify(action)}&&fact.status===200&&fact.body!==null)`);
  const writes=rows(await browser.evaluate('globalThis.__t37CardHttp.filter(fact=>fact.method!=="GET")'));
  assert.deepEqual(writes.map(fact=>object(fact.request).action),action==='SET'?['SET']:['SET','CANCEL']);
  const fact=writes.at(-1);assert.ok(fact);assert.equal(fact.path,path);assert.equal(fact.status,200);return fact;
}

test('actual card, list and detail share one Shanghai overdue time until explicit cancellation; a due-worker signal does not clear the arrangement',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),otherId=await fixture.createTicket();
    const path='/api/tickets/'+ticketId,schedulePath=path+'/follow-up-schedule',queued=await current(dispatcher,path);
    const assigned=await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',
      target_principal_id:fixture.handler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(assigned.status,200,JSON.stringify(assigned.value));await drain(fixture);
    const before=await current(handler,path),beforeSchedule=await current(handler,schedulePath);assert.equal(before.assignee_id,fixture.handler);
    assert.ok(object(before.handling_cycle).id);assert.equal(beforeSchedule.active,null);assert.equal(beforeSchedule.schedule_version,'0');
    const cookie=fixture.runtime.authenticate.browserCookies?.()[1];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T37_NATIVE_HANDLER_COOKIE_REQUIRED');
    const diagnostics=join(tmpdir(),'t37-card-list-diagnostic-'+randomUUID()),screenshots:ImageReceipt[]=[];
    let browser:Browser|undefined,primary:unknown;
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/',width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
      await browser.command('Page.enable');await browser.command('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observe()});
      const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
      await browser.waitFor(`performance.timeOrigin!==${previous}&&Boolean(${cardNode(ticketId)})&&Boolean(${cardNode(otherId)})`);
      assert.equal(await browser.evaluate('Intl.DateTimeFormat().resolvedOptions().timeZone'),'America/Los_Angeles');
      await assertNoFanout(browser,0);
      await refreshWithoutFanout(browser,cardNode(ticketId));
      await openDetail(browser,cardNode(ticketId),'.card-open');
      await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('尚无活动的共享时间')`);
      await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(region+' input[name="due_at"]')});if(!input||input.disabled||input.type!=='text')throw Error('T37_NATIVE_SHARED_TIME_INPUT_REQUIRED');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error('T37_NATIVE_INPUT_SETTER_REQUIRED');setter.call(input,${JSON.stringify(dueAt)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await browser.waitFor(`(()=>{const root=document.querySelector(${JSON.stringify(region)});return [...(root?.querySelectorAll('button')??[])].some(button=>button.textContent.trim()==='设置共享时间'&&!button.disabled);})()`);
      await clickSchedule(browser,'设置共享时间');const set=await writeFact(browser,schedulePath,'SET'),setCommand=object(set.request);
      assert.equal(setCommand.expected_version,before.version);assert.equal(setCommand.expected_schedule_version,'0');assert.equal(setCommand.due_at,dueAt);
      const arranged=await current(handler,schedulePath),active=object(arranged.active);
      assert.equal(arranged.schedule_version,'1');assert.deepEqual(active,{schedule_version:'1',due_at:dueAt,due_epoch_ms:dueEpoch,is_due:true});
      await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('已到期')`);await activeSurface(browser,`document.querySelector(${JSON.stringify(region)})`,'detail');
      assert.match(text(object(await browser.evaluate(surface(`document.querySelector(${JSON.stringify(region)})`))).text),/北京时间|Asia\/Shanghai/u);
      await closeDetail(browser);await refreshWithoutFanout(browser,cardNode(ticketId));
      // Intentional first production RED: current Card has no shared-time field or display.
      await activeSurface(browser,cardNode(ticketId),'card');await inactiveSurface(browser,cardNode(otherId),'unscheduled card');
      screenshots.push(await capture(browser,'set-overdue-card','new-board-1920.png'));
      await view(browser,'列表',rowNode(ticketId));await activeSurface(browser,rowNode(ticketId),'list');await inactiveSurface(browser,rowNode(otherId),'unscheduled list row');
      screenshots.push(await capture(browser,'set-overdue-list','new-list-1920.png'));
      await openDetail(browser,rowNode(ticketId),'.row-link');await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('已到期')`);
      await activeSurface(browser,`document.querySelector(${JSON.stringify(region)})`,'detail reopened from list');
      screenshots.push(await capture(browser,'set-overdue-detail','new-detail-1920.png'));await closeDetail(browser);

      // Use the actual production Worker Port; no fabricated SSE frame, time, row or schedule state.
      assert.deepEqual(await fixture.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
      assert.deepEqual(await fixture.runtime.runFollowUpDueBatch({limit:20}),{scanned:0,emitted:0,skipped:0});
      assert.deepEqual(await current(handler,schedulePath),arranged,'publishing the one-shot hint does not consume the shared arrangement');
      await refreshWithoutFanout(browser,rowNode(ticketId));await activeSurface(browser,rowNode(ticketId),'list after due publication');
      screenshots.push(await capture(browser,'published-overdue-list','new-list-1920.png'));
      await view(browser,'看板',cardNode(ticketId));await activeSurface(browser,cardNode(ticketId),'card after due publication');
      screenshots.push(await capture(browser,'published-overdue-card','new-board-1920.png'));
      await openDetail(browser,cardNode(ticketId),'.card-open');await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('已到期')`);
      await activeSurface(browser,`document.querySelector(${JSON.stringify(region)})`,'detail after due publication');
      await clickSchedule(browser,'取消共享时间');const cancel=await writeFact(browser,schedulePath,'CANCEL'),cancelCommand=object(cancel.request);
      assert.equal(cancelCommand.expected_schedule_version,'1');assert.equal(cancelCommand.due_at,null);assert.notEqual(cancelCommand.client_command_id,setCommand.client_command_id);
      const cancelled=await current(handler,schedulePath);assert.equal(cancelled.active,null);assert.equal(cancelled.schedule_version,'2');
      assert.deepEqual(rows(cancelled.history).map(item=>({action:item.action,due_at:item.due_at})),[{action:'CANCEL',due_at:dueAt},{action:'SET',due_at:dueAt}]);
      await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.innerText.includes('尚无活动的共享时间')`);
      const history=text(await browser.evaluate(`document.querySelector(${JSON.stringify(region+' .shared-follow-up-history')})?.innerText`));
      assert.ok(history.includes('已设置')&&history.includes('已取消')&&history.includes(dueAt));
      assert.equal(text(object(await browser.evaluate(surface(`document.querySelector(${JSON.stringify(region)})`))).text).includes('已到期'),false);
      screenshots.push(await capture(browser,'cancelled-detail-history','new-detail-1920.png'));
      await closeDetail(browser);await refreshWithoutFanout(browser,cardNode(ticketId));await inactiveSurface(browser,cardNode(ticketId),'cancelled card');
      screenshots.push(await capture(browser,'cancelled-card','new-board-1920.png'));
      await view(browser,'列表',rowNode(ticketId));await inactiveSurface(browser,rowNode(ticketId),'cancelled list row');
      screenshots.push(await capture(browser,'cancelled-list','new-list-1920.png'));
      await openDetail(browser,rowNode(ticketId),'.row-link');await browser.waitFor(`document.querySelector(${JSON.stringify(region+' .shared-follow-up-history')})?.innerText.includes('已取消')`);
      assert.deepEqual(await current(handler,schedulePath),cancelled);assert.equal((await current(handler,path)).status,before.status);
      assert.deepEqual(await fixture.runtime.runFollowUpDueBatch({limit:20}),{scanned:0,emitted:0,skipped:0});
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T37_SHARED_TIME_CARD_LIST_DETAIL_PERSISTENT_DUE_CANCEL',screenshots}));
    }catch(failure){
      primary=failure;
      try{await mkdir(diagnostics);if(browser){await writeFile(join(diagnostics,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));
        await writeFile(join(diagnostics,'failure.json'),JSON.stringify(await browser.evaluate(`({card:${surface(cardNode(ticketId))},row:${surface(rowNode(ticketId))},detail:${surface(`document.querySelector(${JSON.stringify(region)})`)},requests:globalThis.__t37CardHttp?.map(({path,search,method,status,error})=>({path,search,method,status,error}))})`)));}}
      catch(evidenceFailure){primary=new AggregateError([failure,evidenceFailure],'T37_CARD_LIST_FAILURE_EVIDENCE');}
      console.log('T37_BROWSER_FAILURE '+JSON.stringify({directory:diagnostics}));
    }
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true});
});
