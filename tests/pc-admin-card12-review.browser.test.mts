import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';

for(const change of ['board-flag','revision'] as const)test('Card 12 UNKNOWN survives '+change+' for the same authorized principal',{timeout:120000},()=>withT42BoardBrowser(async(f,browser,card,get)=>{
  const first=f.tickets[0],actor=f.principals[0];assert.ok(first&&actor);
  await browser.command('Page.bringToFront');
  await browser.waitFor("document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
  await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__card12BoardOff=false;globalThis.__card12Seen=null;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path)==='/api/lifecycle/bootstrap'&&response.status===200){const body=await response.clone().json();globalThis.__card12Seen={principal:body.principal_id,revision:body.authorization_revision,board:body.board_actions_enabled,self:body.ticket_self_handling_enabled};if(globalThis.__card12BoardOff){const headers=new Headers(response.headers);headers.delete('content-length');return new Response(JSON.stringify({...body,board_actions_enabled:false}),{status:response.status,statusText:response.statusText,headers});}}return response;};})()`);
  const beforeBootstrap=await get('/api/lifecycle/bootstrap');
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .card-open')}).focus()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  await browser.waitFor("document.querySelector('.board-claim-controller [data-board-claim-state]')?.dataset.boardClaimState==='unknown'");
  const writes=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(writes));assert.equal(writes.length,1);
  const committed=await get('/api/tickets/'+first.ticket.id);assert.equal(committed.status,'IN_PROGRESS');
  await browser.evaluate("(()=>{globalThis.__card12Controller=document.querySelector('.board-claim-controller .ticket-self-handling');return true;})()");
  if(change==='board-flag'){
    await browser.evaluate('globalThis.__card12BoardOff=true');
    await browser.waitFor("globalThis.__card12Seen?.board===true&&!document.querySelector('[data-action=board-drag-handle]')");
  }else{
    await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES ($1::uuid,'HANDLER') ON CONFLICT DO NOTHING",[actor.id]);
    const fresh=await get('/api/lifecycle/bootstrap');assert.equal(fresh.principal_id,beforeBootstrap.principal_id);assert.notEqual(fresh.authorization_revision,beforeBootstrap.authorization_revision);
    await browser.waitFor(`globalThis.__card12Seen?.revision===${JSON.stringify(fresh.authorization_revision)}`);
  }
  assert.equal(await browser.evaluate("globalThis.__card12Controller.isConnected&&document.querySelector('.board-claim-controller .ticket-self-handling')===globalThis.__card12Controller"),true,'the original pending controller must remain mounted');
  assert.equal(await browser.evaluate("document.querySelector('.board-claim-controller [data-action=check-self-handling]')?.checkVisibility()"),true);
  assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-board-claim-action]'))"),false,'new entrances are removed while the old operation is unresolved');
  assert.deepEqual(await browser.evaluate('globalThis.__t42Writes'),writes,'a capability/revision change cannot automatically replay');
  const location=await browser.evaluate('location.href');
  await browser.waitFor("document.querySelector('.board .card-open')?.checkVisibility()===true");
  await browser.evaluate("document.querySelector('.board .card-open').click()");
  assert.equal(await browser.evaluate('location.href'),location,'pending claim keeps the navigation fence even after the optional board capability closes');
  f.restoreSelfHandlingResponses();
  await clickWorkbenchControl(browser,'.board-claim-controller [data-action=check-self-handling]');
  await browser.waitFor("document.querySelector('.board-claim-controller [data-board-claim-state]')?.dataset.boardClaimState==='succeeded'");
  const after=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(after));assert.equal(after.length,2);assert.deepEqual(after[1],writes[0]);
  assert.equal((await get('/api/tickets/'+first.ticket.id)).version,committed.version,'explicit original replay does not create a new responsibility cycle');
},{dropSelfHandlingResponses:true,realtime:true}));

test('Card 12 absent or null active-state start never borrows old creation time',{timeout:120000},()=>withT42BoardBrowser(async(f,browser,_card,get)=>{
  const target=f.tickets[5],pending=f.tickets[0];assert.ok(target&&pending);
  const original=await get('/api/tickets/'+target.ticket.id);assert.equal(original.status,'IN_PROGRESS');
  await browser.command('Page.bringToFront');
  await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__card12MissingStage='missing';globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path).startsWith('/api/workbench/board?column=active')&&response.status===200){const body=await response.json();for(const item of body.items)if(item.id===${JSON.stringify(target.ticket.id)}){if(globalThis.__card12MissingStage==='missing')delete item.stage_entered_at;else item.stage_entered_at=null;}const headers=new Headers(response.headers);headers.delete('content-length');return new Response(JSON.stringify(body),{status:response.status,statusText:response.statusText,headers});}return response;};})()`);
  for(const variant of ['missing','null']){
    const title='合成状态起点缺失 '+variant;
    await f.pool.query('UPDATE pilot_ticket.ticket SET title=$2 WHERE id=$1::uuid',[target.ticket.id,title]);
    await browser.evaluate('globalThis.__card12MissingStage='+JSON.stringify(variant));
    await clickWorkbenchControl(browser,'.ds-page-header button[aria-label=刷新]');
    await browser.waitFor(`document.querySelector('[data-item-id="${target.ticket.id}"] h3')?.textContent===${JSON.stringify(title)}`);
    assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-item-id="${target.ticket.id}"] .ds-ticket-heat'))`),false);
    assert.equal(await browser.evaluate(`document.querySelector('[data-item-id="${target.ticket.id}"]').hasAttribute('data-ring')`),false);
  }
  const pendingPage=await get('/api/workbench/board?column=pending');assert.ok(Array.isArray(pendingPage.items));
  assert.ok(pendingPage.items.map(object).some(item=>item.id===pending.ticket.id));
  assert.ok(Number(await browser.evaluate("document.querySelectorAll('.board-column.pending .ds-ticket-heat[data-heat-tone=danger]').length"))>0,'pending work still uses its real creation time');
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
}));
