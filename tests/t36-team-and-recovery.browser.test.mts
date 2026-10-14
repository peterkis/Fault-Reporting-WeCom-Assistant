import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
import {withT36Browser,input,openReply} from './helpers/t36-browser-risk-journey.mjs';

test('T36 unassigned team board and list both show pending supplements without changing personal read or responsibility',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 const before=await f.independentFacts();const ticket=await f.read<{assignee_id:string|null}>("/api/tickets/"+f.ticketId);assert.equal(ticket.assignee_id,null);
 await withT36Browser(f,async(browser,capture)=>{
  await browser.command('Page.navigate',{url:f.origin+'/workbench/app/?view=board'});
  const card=`article[data-kind="ticket"][data-item-id="${f.ticketId}"]`;
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(card)})?.querySelector('[data-supplement-follow-up-pending="true"]'))`);
  assert.match(await browser.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent`),/补充待跟进/u);await capture('new-board-1920.png');
  await browser.evaluate(`Array.from(document.querySelectorAll('[aria-label="展示方式"] button')).find(b=>b.textContent.includes('列表')).click()`);
  await browser.waitFor(`new URL(location.href).searchParams.get('view')==='list'&&Array.from(document.querySelectorAll('tr')).some(row=>Array.from(row.querySelectorAll('a')).some(a=>a.getAttribute('href')?.includes(${JSON.stringify('/items/ticket/'+f.ticketId)}))&&row.querySelector('[data-supplement-follow-up-pending="true"]'))`);
  assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('tr')).filter(row=>Array.from(row.querySelectorAll('a')).some(a=>a.getAttribute('href')?.includes(${JSON.stringify('/items/ticket/'+f.ticketId)}))).length`),1);
  await capture('new-list-1920.png');assert.deepEqual(await f.independentFacts(),before,'background summary is neither personal READ nor a new assignment/status');
 });
}));

test('T36 a real bound Message committed before lost ACK recovers the same encrypted target/UUID after reload using only receipt GET',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 await withT36Browser(f,async(browser,capture)=>{
  const messagePath='/api/workbench/conversations/'+f.sessionId+'/messages';
  const observe=`(()=>{globalThis.__t36Recovery=[];const original=fetch;globalThis.fetch=(input,options)=>{const url=new URL(input instanceof Request?input.url:String(input),location.href),method=options?.method??(input instanceof Request?input.method:'GET');return original(input,options).then(async response=>{if(url.origin===location.origin&&url.pathname===${JSON.stringify(messagePath)}&&method==='POST'){const command=JSON.parse(options.body);globalThis.__t36Recovery.push({method,status:response.status,id:command.client_command_id,version:command.expected_row_version,target:command.follow_up_target});if(response.status===202){await response.clone().json();throw new TypeError('T36_TEST_LOST_ACK_AFTER_ACTUAL_202');}}if(url.origin===location.origin&&url.pathname.startsWith(${JSON.stringify(messagePath+'/commands/')})&&method==='GET')globalThis.__t36Recovery.push({method,status:response.status,path:url.pathname});return response;});};})()`;
  await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:observe});await browser.evaluate(observe);
  await openReply(browser,f.r2);const text='T36原精确补充回复丢响应后的敏感正文';await input(browser,'[data-supplement-bound-reply] textarea',text);
  await browser.waitFor('Boolean(document.querySelector("[data-supplement-bound-reply] [data-action=send-conversation-reply]:not(:disabled)"))');
  await browser.evaluate('document.querySelector("[data-supplement-bound-reply] [data-action=send-conversation-reply]").click()');
  await browser.waitFor('document.querySelector("[data-supplement-bound-reply] [data-reply-outcome]")?.textContent.includes("结果未知")&&Boolean(document.querySelector("[data-supplement-bound-reply] [data-action=check-messages]:not(:disabled)"))');
  const observed=await browser.evaluate('globalThis.__t36Recovery') as {method:string;status:number;id:string;version:number;target:unknown}[];
  assert.equal(observed.length,1);const accepted=observed[0];assert.ok(accepted);assert.equal(accepted.status,202);assert.deepEqual(accepted.target,{ticket_id:f.ticketId,...f.r2});
  console.log('T36_COMMITTED_LOST_ACK '+JSON.stringify({status:accepted.status,uuid:accepted.id,version:accepted.version,exact_target:accepted.target,restore:'EXPLICIT_RELOAD_NOT_PANEL_LEAVE'}));await capture('new-detail-1920.png');
  await browser.command('Page.reload');await browser.waitFor('Boolean(document.querySelector("[data-supplement-follow-up-state] li"))');await openReply(browser,f.r2);
  await browser.waitFor('Boolean(document.querySelector("[data-supplement-bound-reply] [data-action=check-messages]:not(:disabled)"))');
  assert.equal(await browser.evaluate('document.querySelector("[data-supplement-bound-reply] textarea").value'),text);
  assert.equal(await browser.evaluate('globalThis.__t36Recovery.filter(row=>row.method==="POST").length'),0,'restoring pending state never resends a POST');
  await browser.evaluate('document.querySelector("[data-supplement-bound-reply] [data-action=check-messages]").click()');
  await browser.waitFor('document.querySelector("[data-supplement-bound-reply] [data-reply-outcome]")?.textContent.includes("已受理发送")');
  const reads=await browser.evaluate('globalThis.__t36Recovery') as {method:string;status:number;path:string}[];
  assert.deepEqual(reads,[{method:'GET',status:200,path:messagePath+'/commands/'+accepted.id}]);
  const fact=await f.pool.query<{n:number;client_command_id:string}>('SELECT count(*)::integer AS n,min(m.client_command_id::text) AS client_command_id FROM pilot_ticket.workbench_supplement_reply_binding b JOIN communication.message m ON m.id=b.message_id WHERE b.ticket_id=$1::uuid',[f.ticketId]);
  assert.equal(fact.rows[0]?.n,1);assert.equal(fact.rows[0]?.client_command_id,accepted.id);
  assert.equal((await f.page()).items.find(item=>item.source_ref===f.r2.source_ref)?.follow_up_state,'PENDING','only ACK recovered; no required Delivery is SENT');await capture();
 });
},{recovery:true}));
