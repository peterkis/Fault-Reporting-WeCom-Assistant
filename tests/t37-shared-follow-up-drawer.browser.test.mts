// REGISTERED_SOURCE / NOT_RUN. Frozen external draft, one case240s, stock1.
// Source reference a9daee9d26a618a8c92afe5e76a6e2fe5059157e. No repository/registry/fixture edits here.
// The accessible controls below are TARGET DOM bindings, absent at the reference head.
// First assert the actual compiled drawer region before any driver action; never inject missing DOM.
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
const drawer='.detail-dialog[role=dialog]';
const region=drawer+' [role="region"][aria-label="共享下次跟进时间"]';
const dueAt='2030-01-02 09:30:00';
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
async function snapshot(http:T37Http,path:string){return {ticket:await current(http,path),schedule:await current(http,path+'/follow-up-schedule'),
  responsibility:await current(http,path+'/responsibility'),events:await current(http,path+'/events?limit=200'),deliveries:await current(http,path+'/deliveries')};}
async function drainActualProjection(fixture:T37Fixture){
  const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;
  }
  assert.fail('STAGED_PREREQUISITE: actual Core/Session/workbench projection did not settle');
}
function observeActualHttp(path:string){return `(()=>{const original=globalThis.fetch;globalThis.__t37PCReads=[];globalThis.__t37PCWrites=[];globalThis.__t37PCBootstrap=[];
  globalThis.fetch=async(input,options)=>{const target=new URL(input instanceof Request?input.url:String(input),location.href).pathname;
    const method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(options?.headers).forEach((v,k)=>headers.set(k,v));
    const request=method==='POST'&&target===${JSON.stringify(path)}?JSON.parse(options?.body??(input instanceof Request?await input.clone().text():'{}')):null;
    const response=await original(input,options);
    if(target===${JSON.stringify(path)}&&method==='GET')globalThis.__t37PCReads.push({path:target,status:response.status,body:await response.clone().json()});
    if(method!=='GET')globalThis.__t37PCWrites.push({path:target,method,status:response.status,body:target===${JSON.stringify(path)}?await response.clone().json():{},request,
      ifMatch:headers.get('if-match'),idempotencyKey:headers.get('idempotency-key'),csrfPresent:Boolean(headers.get('x-csrf-token'))});
    if(method==='GET'&&target==='/api/lifecycle/bootstrap')globalThis.__t37PCBootstrap.push({status:response.status,body:await response.clone().json()});
    return response;};})()`;}
async function reload(browser:Browser){
  const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
  await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'&&Boolean(document.querySelector(${JSON.stringify(drawer+' #detail-title')}))`);
  // The current detail deliberately keeps secondary workflows collapsed after navigation.
  await browser.evaluate("(()=>{const group=document.querySelector('.detail-workflows');if(group&&!group.hasAttribute('data-expanded'))group.querySelector('[data-slot=disclosure-heading] button').click();})()");
  await browser.waitFor(`document.querySelector(${JSON.stringify(region)})?.checkVisibility()===true`);
}
async function capture(browser:Browser,directory:string,name:string){
  const folder=['actual-refresh-preserved-drawer','actual-cancel-history-drawer'].includes(name)?join(tmpdir(),'web01-ui-'+randomUUID()):directory;
  if(folder!==directory)await mkdir(folder);
  const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(folder,name==='failure'?'failure.png':'new-detail-1920.png');await writeFile(file,pixels);
  return {file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')};
}
function assertSafeView(view:Record<string,unknown>){
  assert.deepEqual(Object.keys(view).sort(),['ticket_id','ticket_version','schedule_version','active','allowed_actions','history','history_has_more'].sort());
  if(view.active!==null)assert.deepEqual(Object.keys(object(view.active)).sort(),['schedule_version','due_at','due_epoch_ms','is_due'].sort());
  for(const item of rows(view.history))assert.deepEqual(Object.keys(item).sort(),['schedule_version','action','due_at','occurred_at','ticket_event_id','end_reason'].sort());
  // No raw actor/provider identity, new owner, free text or credentials in the schedule DTO.
  assert.equal(JSON.stringify(view).includes('t37-handler-'),false);assert.equal(JSON.stringify(view).includes('t37-dispatcher-'),false);
}
function assertCommand(write:Write,action:'SET'|'CANCEL',ticketVersion:number,scheduleVersion:string,path:string){
  assert.equal(write.path,path);assert.equal(write.method,'POST');assert.equal(write.status,200);
  assert.deepEqual(Object.keys(write.request).sort(),['client_command_id','expected_version','expected_schedule_version','reason_code','action','due_at'].sort());
  assert.match(text(write.request.client_command_id),/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu);
  assert.equal(write.request.expected_version,ticketVersion);assert.equal(write.request.expected_schedule_version,scheduleVersion);
  assert.equal(write.request.reason_code,'WORKBENCH_FOLLOW_UP_SCHEDULE');assert.equal(write.request.action,action);assert.equal(write.request.due_at,action==='SET'?dueAt:null);
  assert.equal(write.ifMatch,'"'+ticketVersion+'"');assert.equal(write.idempotencyKey,write.request.client_command_id);assert.equal(write.csrfPresent,true);
  assert.deepEqual(Object.keys(write.body).sort(),['ok','ticket_id','ticket_version','ticket_event_id','control_event_id','schedule_version','replayed'].sort());
  assert.equal(write.body.ok,true);assert.equal(write.body.control_event_id,null);assert.equal(write.body.replayed,false);
}
const setVisible=()=>`(()=>{const r=document.querySelector(${JSON.stringify(region)});return Boolean(r?.innerText.includes(${JSON.stringify(dueAt)})&&/北京时间|Asia\\/Shanghai/.test(r.innerText));})()`;
const cancelVisible=()=>`(()=>{const r=document.querySelector(${JSON.stringify(region)});return Boolean(r?.innerText.includes('已取消')&&r.innerText.includes(${JSON.stringify(dueAt)}));})()`;
function button(label:string){return `(()=>{const r=document.querySelector(${JSON.stringify(region)}),b=[...(r?.querySelectorAll('button')??[])].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('STAGED_PREREQUISITE: real shared-time button missing/disabled');b.click();})()`;}

test('current authorized handler sets, rereads and explicitly cancels one shared action time through the actual compiled workbench drawer',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,schedulePath=path+'/follow-up-schedule';
    const queued=await current(dispatcher,path);
    // Existing039/T06 public command establishes the actual current handler; no SQL ownership/cycle writes.
    const assigned=await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',
      target_principal_id:fixture.handler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(assigned.status,200,JSON.stringify(assigned.value));await drainActualProjection(fixture);
    const before=await snapshot(handler,path);assert.equal(before.ticket.assignee_id,fixture.handler);
    assert.ok(object(before.ticket.handling_cycle).id,'actual039 current cycle, not a synthetic SQL marker');
    assert.equal(before.schedule.active,null);assert.equal(before.schedule.schedule_version,'0');assert.deepEqual(before.schedule.allowed_actions,['SET']);assertSafeView(before.schedule);
    const bootstrap=await current(handler,'/api/lifecycle/bootstrap');assert.equal(bootstrap.follow_up_schedules_enabled,true);
    assert.equal(bootstrap.follow_up_schedule_receipt_enabled,true);
    const cookie=fixture.runtime.authenticate.browserCookies?.()[1];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T37_NATIVE_HANDLER_COOKIE_REQUIRED');
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observeActualHttp(schedulePath)});await reload(browser);
      // Intended first actual DOM RED at a9da: existing production drawer has no shared-time component.
      assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(region)}))`),true,'T37_FORMAL_SHARED_TIME_ENTRY_REQUIRED');
      await browser.waitFor('globalThis.__t37PCReads.length>0');
      const initialRead=await browser.evaluate('globalThis.__t37PCReads.at(-1)') as Read;
      assert.equal(initialRead.path,schedulePath);assert.equal(initialRead.status,200);assertSafeView(initialRead.body);assert.deepEqual(initialRead.body,before.schedule);
      assert.equal(await browser.evaluate('globalThis.__t37PCBootstrap.at(-1).body.follow_up_schedules_enabled'),true);
      // TARGET binding: one real input named due_at. Adapt only after the actual accessible form is frozen.
      // Native input events edit its genuine value; they neither fabricate a node nor invoke fetch/handler directly.
      await browser.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(region)}),inputs=r.querySelectorAll('input[name="due_at"]');if(inputs.length!==1)throw Error('STAGED_PREREQUISITE: freeze real due_at input');const input=inputs[0];if(!['text','datetime-local'].includes(input.type))throw Error('STAGED_PREREQUISITE: bind actual time control');input.focus();const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)throw Error('T37_NATIVE_INPUT_REQUIRED');setter.call(input,input.type==='datetime-local'?${JSON.stringify(dueAt.replace(' ','T'))}:${JSON.stringify(dueAt)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await browser.evaluate(button('设置共享时间'));await browser.waitFor('globalThis.__t37PCWrites.length===1');
      const set=await browser.evaluate('globalThis.__t37PCWrites[0]') as Write;assertCommand(set,'SET',version(before.ticket.version),'0',schedulePath);
      const arranged=await snapshot(handler,path);assertSafeView(arranged.schedule);
      assert.equal(arranged.schedule.schedule_version,'1');assert.equal(arranged.ticket.version,version(before.ticket.version)+1);
      assert.equal(set.body.ticket_id,ticketId);assert.equal(set.body.ticket_version,arranged.ticket.version);assert.equal(set.body.schedule_version,'1');
      const active=object(arranged.schedule.active);assert.equal(active.due_at,dueAt);assert.equal(active.due_epoch_ms,'1893547800000');assert.equal(active.is_due,false);
      assert.equal(rows(arranged.schedule.history).length,1);assert.equal(rows(arranged.schedule.history)[0]?.ticket_event_id,set.body.ticket_event_id);
      assert.deepEqual(arranged.responsibility,before.responsibility);assert.deepEqual(arranged.ticket.handling_cycle,before.ticket.handling_cycle);
      assert.equal(arranged.ticket.status,before.ticket.status);assert.equal(arranged.ticket.assignee_id,before.ticket.assignee_id);assert.equal(arranged.ticket.resolver_team_id,before.ticket.resolver_team_id);
      assert.deepEqual(arranged.deliveries,before.deliveries);await browser.waitFor(setVisible());
      screenshots.push(await capture(browser,directory,'actual-set-shanghai-drawer'));
      await reload(browser);await browser.waitFor('globalThis.__t37PCReads.length>0');await browser.waitFor(setVisible());
      const reread=await browser.evaluate('globalThis.__t37PCReads.at(-1)') as Read;assert.equal(reread.path,schedulePath);assert.equal(reread.status,200);assert.deepEqual(reread.body,arranged.schedule);
      assert.deepEqual(await browser.evaluate('globalThis.__t37PCWrites'),[]);assert.deepEqual(await snapshot(handler,path),arranged);
      screenshots.push(await capture(browser,directory,'actual-refresh-preserved-drawer'));
      await browser.evaluate(button('取消共享时间'));await browser.waitFor('globalThis.__t37PCWrites.length===1');
      const cancel=await browser.evaluate('globalThis.__t37PCWrites[0]') as Write;assertCommand(cancel,'CANCEL',version(arranged.ticket.version),'1',schedulePath);
      assert.notEqual(cancel.request.client_command_id,set.request.client_command_id);
      const cancelled=await snapshot(handler,path);assertSafeView(cancelled.schedule);
      assert.equal(cancelled.schedule.active,null);assert.equal(cancelled.schedule.schedule_version,'2');assert.deepEqual(cancelled.schedule.allowed_actions,['SET']);
      assert.equal(cancelled.ticket.version,version(arranged.ticket.version)+1);assert.equal(cancel.body.ticket_version,cancelled.ticket.version);assert.equal(cancel.body.schedule_version,'2');
      const history=rows(cancelled.schedule.history);assert.equal(history.length,2);assert.equal(history[0]?.action,'CANCEL');assert.equal(history[0]?.due_at,dueAt);
      assert.equal(history[0]?.ticket_event_id,cancel.body.ticket_event_id);assert.deepEqual(history[1],rows(arranged.schedule.history)[0]);
      assert.equal(cancelled.ticket.status,before.ticket.status,'cancel shared time is not cancel Ticket');
      assert.equal(cancelled.ticket.assignee_id,before.ticket.assignee_id);assert.equal(cancelled.ticket.resolver_team_id,before.ticket.resolver_team_id);
      assert.deepEqual(cancelled.ticket.handling_cycle,before.ticket.handling_cycle);assert.deepEqual(cancelled.responsibility,before.responsibility);assert.deepEqual(cancelled.deliveries,before.deliveries);
      const oldEvents=rows(before.events.items),events=rows(cancelled.events.items);assert.equal(events.length,oldEvents.length+2);assert.deepEqual(events.slice(0,oldEvents.length),oldEvents);
      assert.deepEqual(events.slice(-2).map(x=>x.event_type),['ticket.follow_up_scheduled','ticket.follow_up_cancelled']);
      await browser.waitFor(cancelVisible());screenshots.push(await capture(browser,directory,'actual-cancel-history-drawer'));
      await reload(browser);await browser.waitFor('globalThis.__t37PCReads.length>0');await browser.waitFor(cancelVisible());
      const finalRead=await browser.evaluate('globalThis.__t37PCReads.at(-1)') as Read;assert.equal(finalRead.status,200);assert.deepEqual(finalRead.body,cancelled.schedule);
      assert.deepEqual(await browser.evaluate('globalThis.__t37PCWrites'),[]);assert.deepEqual(await snapshot(handler,path),cancelled);
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T37_SHARED_TIME_DRAWER_HANDLER_SET_REFRESH_CANCEL',screenshots}));
    }catch(failure){
      error=failure;try{if(browser){await capture(browser,directory,'failure');await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate(`({sharedTimeText:document.querySelector(${JSON.stringify(region)})?.innerText??'',reads:globalThis.__t37PCReads,writes:globalThis.__t37PCWrites})`)));}}
      catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure],'T37_PC_FAILURE_EVIDENCE');}
      console.log('T37_BROWSER_FAILURE '+JSON.stringify({directory}));
    }
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true});
});
