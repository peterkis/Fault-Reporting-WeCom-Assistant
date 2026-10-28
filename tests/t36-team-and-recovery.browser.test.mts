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

test('MVP keeps an unknown bound reply mounted when retention makes the supplement page empty, then retains its opaque check after current material denial',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 assert.equal((await f.read<{conversation_draft_recovery_enabled:boolean}>('/api/lifecycle/bootstrap')).conversation_draft_recovery_enabled,false);
 await withT36Browser(f,async(browser,capture)=>{
  const messagePath='/api/workbench/conversations/'+f.sessionId+'/messages';
  await browser.evaluate('(()=>{const original=fetch;globalThis.__emptyReplyPosts=[];globalThis.__emptyReplyAcks=[];globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(options?.method==="POST"&&String(path)==='+JSON.stringify(messagePath)+'){globalThis.__emptyReplyPosts.push({body:JSON.parse(options.body),status:response.status});if(response.status===202){await response.clone().json();throw new TypeError("SYNTHETIC_BOUND_REPLY_LOST_ACK");}}if(String(path).startsWith('+JSON.stringify(messagePath+'/commands/')+'))globalThis.__emptyReplyAcks.push({path:String(path),status:response.status});return response;};})()');
  await openReply(browser,f.r2);const body='合成未确认回复：请补充原设备的错误提示。';await input(browser,'[data-supplement-bound-reply] textarea',body);
  await browser.waitFor("document.querySelector('[data-supplement-bound-reply] [data-action=send-conversation-reply]')?.disabled===false");
  await browser.evaluate("document.querySelector('[data-supplement-bound-reply] [data-action=send-conversation-reply]').click()");
  await browser.waitFor("document.querySelector('[data-supplement-bound-reply] [data-reply-outcome]')?.textContent.includes('结果未知')");
  const posts=await browser.evaluate('globalThis.__emptyReplyPosts') as {body:{client_command_id:string;follow_up_target:unknown;text:string};status:number}[];
  assert.equal(posts.length,1);const original=posts[0];assert.ok(original);assert.equal(original.status,202);assert.deepEqual(original.body.follow_up_target,{ticket_id:f.ticketId,...f.r2});
  const materials=(await f.page()).items;assert.ok(materials.length);
  for(const material of materials)await f.expire(material);
  assert.deepEqual((await f.page()).items,[],'the original service really returns an empty successful retention-filtered page');
  await browser.evaluate("document.querySelector('[data-action=refresh-supplement-follow-up]').click()");
  await browser.waitFor("document.querySelector('[data-toast-source=supplement-follow-up]')?.innerText.includes('没有补充材料')");
  assert.equal(await browser.evaluate("document.querySelector('[data-supplement-bound-reply] textarea')?.value"),body,'the empty list cannot unmount the independent unknown reply');
  assert.equal(await browser.evaluate("document.querySelector('[data-supplement-bound-reply] [data-action=check-messages]')?.checkVisibility()"),true);
  assert.deepEqual(await browser.evaluate('globalThis.__emptyReplyPosts'),posts,'no automatic resend or new command replaces the original target');
  await capture('new-detail-1920.png');
  await browser.evaluate("document.querySelector('[data-supplement-bound-reply] [data-action=check-messages]').click()");
  await browser.waitFor('globalThis.__emptyReplyAcks.some(row=>row.path==='+JSON.stringify(messagePath+'/commands/'+original.body.client_command_id)+'&&row.status===404)');
  await browser.waitFor("document.querySelector('[data-supplement-bound-reply] textarea')?.value===''");
  assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-supplement-bound-reply] [data-action=check-messages]'))"),true,'current material denial clears sensitive text but preserves the original opaque check');
  assert.deepEqual(await browser.evaluate('globalThis.__emptyReplyPosts'),posts);
  const stored=await f.pool.query<{n:number;id:string}>('SELECT count(*)::int AS n,min(m.client_command_id::text) AS id FROM pilot_ticket.workbench_supplement_reply_binding b JOIN communication.message m ON m.id=b.message_id WHERE b.ticket_id=$1::uuid',[f.ticketId]);
  assert.equal(stored.rows[0]?.n,1);assert.equal(stored.rows[0]?.id,original.body.client_command_id);
  assert.equal((await f.pool.query<{n:number}>('SELECT count(*)::int AS n FROM communication.delivery_attempt')).rows[0]?.n,0);
  await capture();
 });
}));
