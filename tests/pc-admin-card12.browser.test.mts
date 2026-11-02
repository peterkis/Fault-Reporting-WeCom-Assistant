import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';
import {clickWorkbenchControl,chooseWorkbenchSelect} from './helpers/heroui-workbench-controls.mjs';
import {loadServiceCatalog} from '../app/server/src/p2-007-service-catalog.mjs';

test('Card 12 category, state heat, missing fields and loaded filters use the real read projections',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,card,get)=>{
  const first=f.tickets[0];assert.ok(first);
  const service=loadServiceCatalog().listServices().find(s=>s.service_code==='PRINT.PRINTER_DEVICE');assert.ok(service);
  await f.pool.query("UPDATE intake.web_submission SET safe_content=jsonb_set(safe_content,'{service_code}',to_jsonb($2::text)) WHERE intake_id=(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$1::uuid) AND kind='SUBMIT'",[first.ticket.id,service.service_code]);
  await clickWorkbenchControl(browser,'.ds-page-header button[aria-label=刷新]');
  await browser.waitFor("document.querySelector('[data-field-label=类别] button')?.disabled===false");
  await clickWorkbenchControl(browser,'.board-column.pending [data-action=expand-column]');
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(card+' [data-category=ENDPOINT_PRINT]')}))`);
  const dto=object((await get('/api/workbench/items/ticket/'+first.ticket.id)).item),projected=object(dto.service);
  assert.equal(projected.code,service.service_code);assert.equal(projected.category,'ENDPOINT_PRINT');
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .ds-ticket-category')}).title`),service.category_name_zh+' · '+service.name_zh);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card)}).dataset.ring`),'danger');
  assert.match(String(await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .ds-ticket-heat')}).textContent`)),/^超时 \d+ 小时$/u);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent.includes('资料不全')`),true);
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.ticket-card')].some(n=>/未提供|未登记/.test(n.innerText))"),false);
  assert.equal(await browser.evaluate("document.querySelectorAll('.board-column.closed .ds-ticket-heat').length"),0);
  assert.ok(Number(await browser.evaluate("document.querySelectorAll('.board-column.closed .ds-ticket-completed').length"))>0);
  const active=await get('/api/workbench/board?column=active');assert.ok(Array.isArray(active.items));
  const known=active.items.map(object).find(item=>item.stage_entered_at);assert.ok(known);
  const expected=String(known.stage_entered_at).replace(' ','T')+'+08:00';
  const activeCard='[data-item-id="'+String(known.id)+'"]';
  // The fixture's creation is 30 days ago; current state is recent. Activity updates must not create a false red timeout.
  assert.ok(Date.now()-Date.parse(expected)<4*3_600_000);
  assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(activeCard+' .ds-ticket-heat[data-heat-tone=danger]')}))`),false);
  await chooseWorkbenchSelect(browser,'[data-field-label=类别]',service.category);
  await browser.waitFor("document.querySelectorAll('.ticket-card').length===1");
  assert.equal(await browser.evaluate("document.querySelector('.ticket-card').dataset.itemId"),first.ticket.id);
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0,'filtering is read-only and never a command');
  await chooseWorkbenchSelect(browser,'[data-field-label=处理人]','unassigned');
  assert.equal(await browser.evaluate("document.querySelector('.ticket-card').dataset.itemId"),first.ticket.id);
  await clickWorkbenchControl(browser,card+' .card-open');await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title'))");
  assert.equal(await browser.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(card)})).outlineWidth`),'2px');
}));

for(const trigger of ['pointer','keyboard'] as const)test('Card 12 '+trigger+' claim reuses one original command and animates the official column change',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,card,get)=>{
  const first=f.tickets[0],actor=f.principals[0];assert.ok(first&&actor);
  const original=await get('/api/tickets/'+first.ticket.id);
  await browser.command('Page.bringToFront');
  if(trigger==='pointer')await browser.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__card12ActiveHeld=false;globalThis.fetch=async(path,options)=>{const response=await original(path,options);if(String(path).startsWith('/api/workbench/board?column=active')&&globalThis.__t42Writes.length){globalThis.__card12ActiveHeld=true;await new Promise(resolve=>{globalThis.__card12ReleaseActive=resolve;});}return response;};})()`);
  await browser.evaluate(`(()=>{globalThis.__card12Motions=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.matches('.ticket-card'))globalThis.__card12Motions.push({id:this.dataset.itemId,duration:options.duration,frames});return animate.call(this,frames,options);};const link=document.querySelector(${JSON.stringify(card+' .card-open')});link.focus();})()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')}).dataset.tone`),'secondary');
  if(trigger==='keyboard'){await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key:'e',code:'KeyE',windowsVirtualKeyCode:69});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key:'e',code:'KeyE',windowsVirtualKeyCode:69});}
  else await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  if(trigger==='pointer'){
    await browser.waitFor(`globalThis.__card12ActiveHeld===true&&!document.querySelector(${JSON.stringify('.board-column.pending '+card)})`);
    await browser.evaluate('globalThis.__card12ReleaseActive()');
  }
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify('.board-column.active '+card)}))`);
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),1);
  const sent=object((await browser.evaluate('globalThis.__t42Writes'))[0]),body=object(sent.body);
  assert.match(String(body.client_command_id),/^[0-9a-f-]{36}$/u);
  assert.equal(sent.path,'/api/tickets/'+first.ticket.id+'/take-and-start');
  assert.deepEqual(body,{client_command_id:body.client_command_id,expected_version:original.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:original.resolver_team_id});
  const result=await get('/api/tickets/'+first.ticket.id);assert.equal(result.status,'IN_PROGRESS');assert.equal(result.assignee_id,actor.id);
  const motions:unknown=await browser.evaluate('globalThis.__card12Motions');assert.ok(Array.isArray(motions));
  assert.ok(motions.some(motion=>object(motion).id===first.ticket.id&&object(motion).duration===180));
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-dialog'))"),false,'the plain action needs no detail detour');
},{realtime:false}));

test('Card 12 UNKNOWN keeps the original controller and UUID when a current board read moves its card',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,card,get)=>{
  const first=f.tickets[0];assert.ok(first);
  await browser.command('Page.bringToFront');
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .card-open')}).focus()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  await browser.waitFor("Boolean(document.querySelector('.board-claim-controller [data-action=check-self-handling]'))");
  const original=object((await browser.evaluate('globalThis.__t42Writes'))[0]);
  assert.equal((await get('/api/tickets/'+first.ticket.id)).status,'IN_PROGRESS','the response was dropped after the real commit');
  await clickWorkbenchControl(browser,'[data-workbench-toasts] button[aria-label=关闭提示]');
  await clickWorkbenchControl(browser,'.ds-page-header button[aria-label=刷新]');
  await browser.waitFor(`!document.querySelector(${JSON.stringify('.board-column.pending '+card)})`);
  assert.equal(await browser.evaluate("document.querySelector('.board-claim-controller [data-action=check-self-handling]').checkVisibility()"),true);
  f.restoreSelfHandlingResponses();
  await clickWorkbenchControl(browser,'.board-claim-controller [data-action=check-self-handling]');
  await browser.waitFor("document.querySelector('.board-claim-controller [data-board-claim-state]')?.dataset.boardClaimState==='succeeded'");
  const writes:unknown=await browser.evaluate('globalThis.__t42Writes');assert.ok(Array.isArray(writes));assert.equal(writes.length,2);assert.deepEqual(writes[1],original);
},{dropSelfHandlingResponses:true}));

test('Card 12 combined responsibility claim opens the original choice form without posting',{timeout:240000},()=>withT42BoardBrowser(async(_f,browser,card)=>{
  await browser.command('Page.bringToFront');
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .card-open')}).focus()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  await browser.waitFor("Boolean(document.querySelector('.detail-dialog .ticket-conversation-handling'))");
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
},{conversationHandling:true}));

test('Card 12 stale claim permission is rejected by the original command without a state or event change',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,card)=>{
  const first=f.tickets[0],actor=f.principals[0];assert.ok(first&&actor);
  await browser.command('Page.bringToFront');
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .card-open')}).focus()`);
  await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-board-claim-action]')})?.disabled===false`);
  const before=(await f.pool.query('SELECT status,assignee_id,version,(SELECT count(*) FROM pilot_ticket.ticket_event e WHERE e.ticket_id=t.id) AS events FROM pilot_ticket.ticket t WHERE id=$1::uuid',[first.ticket.id])).rows[0];
  await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[actor.id]);
  await clickWorkbenchControl(browser,card+' [data-board-claim-action]');
  await browser.waitFor('globalThis.__t42Responses.some(response=>response.status===401)');
  const after=(await f.pool.query('SELECT status,assignee_id,version,(SELECT count(*) FROM pilot_ticket.ticket_event e WHERE e.ticket_id=t.id) AS events FROM pilot_ticket.ticket t WHERE id=$1::uuid',[first.ticket.id])).rows[0];
  assert.deepEqual(after,before);assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),1);
}));
