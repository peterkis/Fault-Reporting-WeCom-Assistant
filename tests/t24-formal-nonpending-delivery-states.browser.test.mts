// SOURCE_REGISTERED_NOT_RUN. Mechanical copy of preserved external first; original body, Sender contracts, roles, flags[] and 240000ms budget retained.
// One 240000ms case, stock concurrency 1; three sequential existing fixtures/browser lifetimes.
// Reuses the already covered PENDING/auth/capability cases rather than duplicating them here.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import type {CommunicationSenderResult} from '../src/p2-004-communication-sender-port.mjs';
import type {CommunicationSenderRequest} from '../contracts/communication_contracts.js';
import type {P2016TicketNotification} from '../contracts/p2_016_contracts.js';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Reply={items:readonly P2016TicketNotification[]};
type Read={path:string;status:number;body:Reply};
type DomRow={node:string;lines:string[]};
type Scenario={name:string;senderResult:CommunicationSenderResult;status:'SENT'|'DEAD_LETTER'|'RECONCILIATION_REQUIRED';label:string;effect:'ACKNOWLEDGED'|'NOT_ATTEMPTED'|'UNKNOWN';effectLabel:string};
const scenarios:readonly Scenario[]=[
  {name:'sent',senderResult:{outcome:'ACKNOWLEDGED',provider_message_id:'T24_SYNTHETIC_ACK',error_code:null,retryable:false},status:'SENT',label:'已发送',effect:'ACKNOWLEDGED',effectLabel:'已确认'},
  {name:'failed',senderResult:{outcome:'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'T24_SYNTHETIC_NOT_APPLIED',retryable:false},status:'DEAD_LETTER',label:'发送失败',effect:'NOT_ATTEMPTED',effectLabel:'尚未尝试'},
  {name:'unknown',senderResult:{outcome:'UNKNOWN',provider_message_id:null,error_code:'T24_SYNTHETIC_UNKNOWN',retryable:false},status:'RECONCILIATION_REQUIRED',label:'待核对',effect:'UNKNOWN',effectLabel:'结果未知'},
];
const region='[role="region"][aria-label="报修人通知送达"]';
const internalCanary='INTERNAL_T24_PC_NONPENDING_CANARY';
// Pass through the original fetch. Observe actual HTTP replies, never replace a request or response.
const instrument=`(()=>{const original=globalThis.fetch;globalThis.__t24PCReads=[];globalThis.__t24PCWrites=[];globalThis.__t24PCBootstrap=[];
  globalThis.fetch=async(input,options)=>{const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
    const method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    if(method!=='GET')globalThis.__t24PCWrites.push({path,method});
    const response=await original(input,options);
    if(method==='GET'&&path.endsWith('/deliveries'))globalThis.__t24PCReads.push({path,status:response.status,body:await response.clone().json()});
    if(method==='GET'&&path==='/api/lifecycle/bootstrap')globalThis.__t24PCBootstrap.push({status:response.status,body:await response.clone().json()});
    return response;};})()`;
const domRows=()=>`(()=>{const r=document.querySelector(${JSON.stringify(region)});return [...(r?.querySelectorAll('li')??[])].map(li=>({node:li.querySelector('strong')?.textContent.trim()??'',lines:[...li.querySelectorAll('small')].map(x=>x.textContent.trim().replace(/\\s+/g,' '))})).sort((a,b)=>a.node<b.node?-1:a.node>b.node?1:0);})()`;
const click=()=>`(()=>{const r=document.querySelector(${JSON.stringify(region)}),b=[...(r?.querySelectorAll('button')??[])].find(x=>x.textContent.trim()==='重新读取通知');if(!b||b.disabled)throw Error('T24_REAL_REQUERY_BUTTON_REQUIRED');b.click();})()`;
async function load(browser:Browser){
  await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument});
  const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
  await browser.waitFor(`performance.timeOrigin!==${before}&&document.readyState==='complete'&&Boolean(document.querySelector('#detail-title'))`);
}
async function receiptScreenshot(browser:Browser){
  const imageDirectory=join(tmpdir(),'web01-ui-'+randomUUID());
  await mkdir(imageDirectory);
  return screenshot(browser,imageDirectory,'new-detail-1920');
}
async function screenshot(browser:Browser,directory:string,name:string){
  const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name+'.png');await writeFile(file,pixels);
  return {file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')};
}
function assertSafeReply(reply:Reply){
  assert.deepEqual(Object.keys(reply),['items']);
  const allowed=['node','cycle_no','notification_type','destination_type','delivery_id','status','side_effect_state','attempt_count','sent_at','created_at'].sort();
  for(const item of reply.items)assert.deepEqual(Object.keys(item).sort(),allowed);
  for(const marker of [internalCanary,'user-test','bot-test'])assert.equal(JSON.stringify(reply).includes(marker),false);
}

test('formal compiled PC reads and refreshes actual SENT, failed and UNKNOWN staff Delivery facts produced by the production worker',{timeout:240000},async()=>{
  const directory=join(tmpdir(),'t24-formal-nonpending-pc-'+randomUUID());await mkdir(directory);
  // No overlapping App, PG fixture, browser, sender, or worker; no additional pool or scheduler.
  for(const scenario of scenarios){
    await withT24Fixture(async context=>{
      const id=context.ticketId,producer=await t11Http(context),reader=await t11Http(context,2),started=await producer.start(id);
      await context.runtime.roundNotifications.runOnce();
      const response=await producer.post(id,'complete',{...producer.command(started),internal_process:internalCanary+'：仅内部合成排查过程',external_summary:'合成服务已恢复。'});
      assert.equal(response.status,200);await context.runtime.roundNotifications.runOnce();
      const completed=await producer.detail(id);assert.equal(completed.status,'CLOSED');
      const path='/api/tickets/'+id+'/deliveries';
      const readActual=async()=>{const response=await reader.get(path);assert.equal(response.status,200);const reply=await response.json() as Reply;assertSafeReply(reply);return reply;};
      const pending=await readActual();assert.equal(pending.items.length,2);
      assert.deepEqual(pending.items.map(x=>({node:x.node,cycle:x.cycle_no,route:x.destination_type,status:x.status,attempts:x.attempt_count,effect:x.side_effect_state,sent:x.sent_at})).sort((a,b)=>String(a.node).localeCompare(String(b.node))),[
        {node:'FIRST_RESPONSIBILITY',cycle:1,route:'PERSON',status:'PENDING',attempts:0,effect:'NOT_ATTEMPTED',sent:null},
        {node:'STAFF_COMPLETED',cycle:1,route:'PERSON',status:'PENDING',attempts:0,effect:'NOT_ATTEMPTED',sent:null},
      ]);
      const pendingStaff=pending.items.find(x=>x.node==='STAFF_COMPLETED');assert.ok(pendingStaff);
      let senderCalls=0;const senderRequests:CommunicationSenderRequest[]=[];
      // The only synthetic boundary is Sender outcome, identical to the existing SUCCESS/FAIL/UNKNOWN cases.
      // No SDK is installed/called here, and externalSendEnabled remains false in the existing fixture.
      const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:{send:async request=>{
        senderCalls++;senderRequests.push(request);return scenario.senderResult;
      }}});
      const deliveryResult=await worker.deliver({deliveryId:pendingStaff.delivery_id});
      assert.ok(deliveryResult&&'status' in deliveryResult);assert.equal(deliveryResult.status,scenario.status);
      assert.equal(senderCalls,1);const sentRequest=senderRequests[0];assert.ok(sentRequest);
      // Assert outside the callback: the production worker converts Sender exceptions to UNKNOWN.
      assert.equal(sentRequest.delivery_id,pendingStaff.delivery_id);assert.equal(sentRequest.target_type,'PERSON');
      assert.equal(sentRequest.provider,'WECOM_AIBOT');assert.equal(JSON.stringify(sentRequest.message).includes(internalCanary),false);
      const actual=await readActual(),staff=actual.items.find(x=>x.delivery_id===pendingStaff.delivery_id);assert.ok(staff);
      assert.equal(staff.status,scenario.status);assert.equal(staff.attempt_count,1);assert.equal(staff.side_effect_state,scenario.effect);
      if(scenario.status==='SENT'){assert.equal(typeof staff.sent_at,'string');assert.ok(staff.sent_at);}
      else assert.equal(staff.sent_at,null);
      assert.deepEqual(actual.items.find(x=>x.node==='FIRST_RESPONSIBILITY'),pending.items.find(x=>x.node==='FIRST_RESPONSIBILITY'));
      assert.deepEqual(await producer.detail(id),completed);
      // SELECT-only identity snapshot after the real worker result; never manufacture a Delivery/cycle/status.
      const physical=async()=>(await context.pool.query<{messages:string[];outboxes:string[];deliveries:string[];bindings:string[];rounds:string[];attempts:string[];public_refs:string[];grants:number}>(`SELECT
        ARRAY(SELECT id::text FROM communication.message ORDER BY id::text) AS messages,
        ARRAY(SELECT id::text FROM communication.outbox ORDER BY id::text) AS outboxes,
        ARRAY(SELECT id::text FROM communication.delivery ORDER BY id::text) AS deliveries,
        ARRAY(SELECT id::text FROM communication.ticket_notification_binding ORDER BY id::text) AS bindings,
        ARRAY(SELECT cycle_id::text||':'||node||':'||recipient_binding_hash||':'||destination_type FROM communication.ticket_round_notification_binding ORDER BY 1) AS rounds,
        ARRAY(SELECT id::text FROM communication.delivery_attempt ORDER BY id::text) AS attempts,
        ARRAY(SELECT id::text FROM pilot_ticket.reporter_public_ref ORDER BY id::text) AS public_refs,
        (SELECT count(*)::int FROM pilot_ticket.reporter_access_grant) AS grants`)).rows[0];
      const baseline=await physical();assert.ok(baseline);assert.equal(baseline.grants,0);
      for(const item of actual.items)assert.ok(baseline.deliveries.includes(item.delivery_id));
      const expected:DomRow[]=[
        {node:'首次责任',lines:['处理轮次 1 · 原报修人单聊 · 待发送','尝试次数 0 · 尚未尝试']},
        {node:'工作人员完工',lines:['处理轮次 1 · 原报修人单聊 · '+scenario.label,'尝试次数 1 · '+scenario.effectLabel,...(staff.sent_at?['发送时间 '+staff.sent_at+'（北京时间）']:[])]},
      ].sort((a,b)=>a.node<b.node?-1:a.node>b.node?1:0);
      const rendered=()=>`JSON.stringify(${domRows()})===JSON.stringify(${JSON.stringify(expected)})`;
      const cookie=context.browserCookies[2];assert.ok(cookie);if(typeof cookie.url!=='string')throw Error('T24_REAL_READER_COOKIE_REQUIRED');
      let browser:Browser|undefined,error:unknown;
      try{
        browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+id,width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
        await load(browser);await browser.waitFor(rendered());
        assert.deepEqual(await browser.evaluate(domRows()),expected);
        assert.equal(await browser.evaluate('globalThis.__t24PCBootstrap.at(-1).body.ticket_round_notifications_enabled'),true);
        const reads=await browser.evaluate('globalThis.__t24PCReads') as Read[];assert.ok(reads.length);
        const firstRead=reads.at(-1);assert.ok(firstRead);assert.equal(firstRead.path,path);assert.equal(firstRead.status,200);
        assertSafeReply(firstRead.body);assert.deepEqual(firstRead.body.items,actual.items);
        await browser.evaluate(click());await browser.waitFor(`globalThis.__t24PCReads.length>${reads.length}`);await browser.waitFor(rendered());
        const refreshed=await browser.evaluate('globalThis.__t24PCReads.at(-1)') as Read;
        assert.equal(refreshed.path,path);assert.equal(refreshed.status,200);assertSafeReply(refreshed.body);assert.deepEqual(refreshed.body.items,actual.items);
        assert.deepEqual(await browser.evaluate(domRows()),expected);
        const visible=await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).innerText`) as string;
        for(const marker of [internalCanary,'user-test','bot-test'])assert.equal(visible.includes(marker),false);
        assert.deepEqual(await browser.evaluate('globalThis.__t24PCWrites'),[]);
        assert.deepEqual(await physical(),baseline);assert.deepEqual(await producer.detail(id),completed);assert.equal(senderCalls,1);
        await browser.evaluate(`document.querySelector(${JSON.stringify(region)}).scrollIntoView({block:'center'})`);
        console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',scope:'T24_FORMAL_NON_PENDING_STATES',delivery_status:scenario.status,side_effect_state:scenario.effect,sender:'SYNTHETIC_ONLY',screenshots:[await receiptScreenshot(browser)]}));
      }catch(failure){
        error=failure;
        try{if(browser){
          await screenshot(browser,directory,scenario.name+'-failure');
          // Notification region and the existing safe DTO only; do not dump internal Ticket content or raw identity.
          await writeFile(join(directory,scenario.name+'-failure.json'),JSON.stringify(await browser.evaluate(`({notificationText:document.querySelector(${JSON.stringify(region)})?.innerText??'',reads:globalThis.__t24PCReads,writes:globalThis.__t24PCWrites})`)));
        }}catch(evidenceFailure){error=new AggregateError([failure,evidenceFailure],'T24_PC_NONPENDING_FAILURE_EVIDENCE');}
        console.log('T24_BROWSER_FAILURE '+JSON.stringify({directory,scenario:scenario.name}));
      }
      await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
    },{manualRoundConsumption:true,roundNotificationsOff:false});
  }
});
