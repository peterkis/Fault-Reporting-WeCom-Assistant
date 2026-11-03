import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';

type Browser=Parameters<Parameters<typeof withT42BoardBrowser>[0]>[1];
async function key(browser:Browser,key:string,code:string,virtual:number,modifiers=0){
  await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtual,modifiers});
  await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtual,modifiers});
}
async function input(browser:Browser,value:string){
  await browser.evaluate(`(()=>{const input=document.querySelector('.efficiency-panel input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}

test('Card 16 board keys follow visible cards and pause in inputs, IME and detail overlays',{timeout:240000},()=>withT42BoardBrowser(async(_f,browser,card)=>{
  await browser.command('Page.bringToFront');
  await browser.evaluate("[...document.querySelectorAll('.board-column.pending .card-open')].find(n=>n.checkVisibility()).focus()");
  const positions=await browser.evaluate("[...document.querySelectorAll('.board-column.pending .card-open')].filter(n=>n.checkVisibility()).map(n=>n.closest('.ticket-card').dataset.itemId)");assert.ok(Array.isArray(positions));
  const before=String(await browser.evaluate("document.activeElement.closest('.ticket-card').dataset.itemId")),index=positions.indexOf(before);
  await key(browser,'j','KeyJ',74);
  assert.equal(await browser.evaluate("document.activeElement.closest('.ticket-card').dataset.itemId"),positions[Math.min(index+1,positions.length-1)]);
  await key(browser,'k','KeyK',75);assert.equal(await browser.evaluate("document.activeElement.closest('.ticket-card').dataset.itemId"),before);
  await key(browser,'l','KeyL',76);assert.equal(await browser.evaluate("document.activeElement.closest('.board-column').classList.contains('active')"),true);
  await key(browser,'h','KeyH',72);assert.equal(await browser.evaluate("document.activeElement.closest('.board-column').classList.contains('pending')"),true);
  const focus=await browser.evaluate('document.activeElement.href');
  await key(browser,'J','KeyJ',74,8);assert.equal(await browser.evaluate('document.activeElement.href'),focus);
  await browser.evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'j',bubbles:true,isComposing:true}))");assert.equal(await browser.evaluate('document.activeElement.href'),focus);
  await key(browser,'/','Slash',191);assert.equal(await browser.evaluate("document.activeElement.matches('.workbench-search input[name=q]')"),true);
  await key(browser,'n','KeyN',78);await key(browser,'?','Slash',191,8);
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.efficiency-help,.efficiency-panel'))"),false);
  assert.equal(await browser.evaluate('location.pathname'),'/workbench/app/');
  await browser.evaluate('document.activeElement.blur()');await key(browser,'?','Slash',191,8);
  await browser.waitFor("Boolean(document.querySelector('.efficiency-help'))");await key(browser,'Escape','Escape',27);
  await browser.waitFor("!document.querySelector('.efficiency-help')");
  await browser.evaluate(`document.querySelector(${JSON.stringify(card+' .card-open')}).focus()`);await key(browser,'Enter','Enter',13);
  await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title'))");
  await key(browser,'j','KeyJ',74);await key(browser,'n','KeyN',78);await key(browser,'k','KeyK',75,2);
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.efficiency-panel'))"),false);
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
},{search:true,manualReports:true}));

test('Card 16 commands reuse current search, discard stale results and navigate without a business write',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,_card,get)=>{
  const first=f.tickets[0];assert.ok(first);const original=await get('/api/tickets/'+first.ticket.id),dto=object((await get('/api/workbench/items/ticket/'+first.ticket.id)).item);
  await browser.command('Page.bringToFront');await browser.evaluate('document.activeElement.blur()');
  await clickWorkbenchControl(browser,'button[aria-label=收起侧栏]');
  await browser.waitFor("Boolean(document.querySelector('.sidebar-collapsed'))");
  assert.equal(await browser.evaluate("document.querySelector('.efficiency-entry').checkVisibility()"),false,'collapsed sidebar keeps its original hidden search entry');
  await key(browser,'k','KeyK',75,2);await browser.waitFor("Boolean(document.querySelector('.efficiency-panel input'))");
  await input(browser,String(dto.number));await browser.waitFor(`Boolean([...document.querySelectorAll('.efficiency-result')].find(n=>n.textContent.includes(${JSON.stringify(String(dto.number))})))`);
  await input(browser,'Card16-no-current-result');await browser.waitFor("document.querySelector('.efficiency-status')?.textContent.includes('没有找到')");
  assert.equal(await browser.evaluate("document.querySelectorAll('.efficiency-result').length"),0);
  await input(browser,'错误\u0001文本');await browser.waitFor("document.querySelector('.efficiency-status')?.textContent.includes('不支持的字符')");
  assert.equal(await browser.evaluate("Boolean(document.querySelector('.efficiency-panel'))"),true,'invalid pasted input never crashes the authenticated view');
  await input(browser,String(dto.number));await browser.waitFor("document.querySelectorAll('.efficiency-result').length===1");
  await key(browser,'Enter','Enter',13);await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title'))");
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
  const after=await get('/api/tickets/'+first.ticket.id);for(const field of ['status','version','assignee_id','resolver_team_id'])assert.equal(after[field],original[field]);
},{search:true,manualReports:true}));

test('Card 16 command entries and N use the original manual-report capability and route',{timeout:240000},()=>withT42BoardBrowser(async(_f,browser)=>{
  await browser.command('Page.bringToFront');await browser.waitFor("Boolean(document.querySelector('[data-action=new-report]'))");await browser.evaluate('document.activeElement.blur()');
  await key(browser,'n','KeyN',78);await browser.waitFor("location.pathname.endsWith('/reports/new')");await browser.evaluate('document.activeElement.blur()');
  await key(browser,'k','KeyK',75,2);await browser.waitFor("Boolean(document.querySelector('.efficiency-panel'))");
  await browser.evaluate("[...document.querySelectorAll('.efficiency-result')].find(n=>n.textContent.includes('切到列表')).click()");
  await browser.waitFor("new URL(location.href).searchParams.get('view')==='list'");
  await key(browser,'k','KeyK',75,2);await browser.waitFor("Boolean(document.querySelector('.efficiency-panel'))");
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.efficiency-result')].filter(n=>n.textContent.includes('新报修')).length"),1);
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.efficiency-result')].some(n=>n.textContent.includes('通知异常'))"),false,'disabled feature does not acquire a command entry');
  await browser.evaluate("[...document.querySelectorAll('.efficiency-result')].find(n=>n.textContent.includes('新报修')).click()");
  await browser.waitFor("location.pathname.endsWith('/reports/new')");
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
},{search:true,manualReports:true}));
