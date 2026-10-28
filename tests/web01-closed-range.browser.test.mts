import {clickWorkbenchControl,typeWorkbenchDates} from './helpers/heroui-workbench-controls.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {BoardPage} from '../contracts/web01_workbench_contracts.js';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

interface Fixture {pool:PostgresPool;origin:string;tickets:{ticket:{id:string}}[];cookies:string[];runtime:P2016EnabledRuntime}
const selection='range=custom&closed_from=2024-02-29&closed_to=2024-02-29';
async function seedClosingTimes(f:Fixture){
  const first=f.tickets[9],last=f.tickets[10],outside=f.tickets[11],resolved=f.tickets[12];assert.ok(first&&last&&outside&&resolved);
  // Only the isolated synthetic fixture changes; the filter must use completion events, not updated_at.
  for(const [id,at] of [[first.ticket.id,'2024-02-29 00:00:00'],[last.ticket.id,'2024-02-29 23:59:59'],[outside.ticket.id,'2024-03-01 00:00:00']]){
    await f.pool.query("UPDATE pilot_ticket.ticket_event SET created_at=$2::timestamp WHERE ticket_id=$1::uuid AND event_type='ticket.closed'",[id,at]);
  }
  return {first:first.ticket.id,last:last.ticket.id,outside:outside.ticket.id,resolved:resolved.ticket.id};
}
async function get(f:Fixture,query:string,reader=0){const cookie=f.cookies[reader];assert.ok(cookie);return fetch(f.origin+'/api/workbench/board?'+query,{headers:{cookie}});}
async function page(f:Fixture,query:string,reader=0):Promise<BoardPage>{
  const response=await get(f,query,reader);assert.equal(response.status,200,await response.clone().text());
  const value:unknown=await response.json();assert.ok(value&&typeof value==='object'&&'items' in value&&Array.isArray(value.items));return value as BoardPage;
}
test('custom completion dates include both Beijing days, bind both cursor edges and retain current READ and unfinished work',()=>withWeb01Fixture(async(f:Fixture)=>{
  const ids=await seedClosingTimes(f),selected=await page(f,'column=closed&'+selection);
  assert.deepEqual(selected.range,{mode:'custom',from:'2024-02-29 00:00:00',until:'2024-03-01 00:00:00',timezone:'Asia/Shanghai'});
  assert.deepEqual(selected.items.map(item=>item.id),[ids.last,ids.first,ids.resolved]);
  assert.deepEqual((await page(f,'column=closed&range=custom&closed_from=2024-03-01&closed_to=2024-03-01')).items.map(item=>item.id),[ids.outside,ids.resolved]);
  assert.equal((await page(f,'column=closed&range=all')).items.length,4);
  for(const column of ['pending','active'])assert.deepEqual((await page(f,'column='+column+'&'+selection)).items.map(item=>item.id),(await page(f,'column='+column+'&range=all')).items.map(item=>item.id));
  assert.deepEqual((await page(f,'column=closed&'+selection,1)).items,[]);
  const first=await page(f,'column=closed&limit=1&'+selection);assert.ok(first.next_cursor);
  const next=await page(f,'column=closed&limit=1&'+selection+'&cursor='+encodeURIComponent(first.next_cursor));assert.equal(next.items[0]?.id,ids.first);
  for(const query of [
    'range=custom','range=custom&closed_from=2024-02-29','range=custom&closed_from=2026-02-29&closed_to=2026-03-01',
    'range=custom&closed_from=2024-03-01&closed_to=2024-02-29','range=custom&closed_from=0000-01-01&closed_to=2024-03-01',
    'range=custom&closed_from=2024-03-01&closed_to=9999-12-31','range=all&closed_from=2024-02-29&closed_to=2024-03-01',
    selection+'&closed_to=2024-03-01',selection.replace('closed_to=2024-02-29','closed_to=2024-03-01')+'&cursor='+encodeURIComponent(first.next_cursor),
    selection.replace('closed_from=2024-02-29','closed_from=2024-02-28')+'&cursor='+encodeURIComponent(first.next_cursor),
  ]){const response=await get(f,'column=closed&'+query);assert.equal(response.status,400,await response.text());}
}));

test('formal board applies a selected date range, preserves it across view, scope and reload, and omits removed guidance',{timeout:120_000},()=>withWeb01Fixture(async(f:Fixture)=>{
  const ids=await seedClosingTimes(f),directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  const cookieHeader=f.cookies[0];assert.ok(cookieHeader);const separator=cookieHeader.indexOf('=');assert.ok(separator>0);
  let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,failure:unknown,writes=0;
  const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
  f.runtime.server.on('request',(request:IncomingMessage)=>{if(request.method!=='GET')writes++;});
  try{
    browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?scope=team',width:1920,height:1080,cookies:[{name:cookieHeader.slice(0,separator),value:cookieHeader.slice(separator+1),url:f.origin+'/',httpOnly:true,secure:f.origin.startsWith('https:'),sameSite:'Lax'}]});assert.ok(browser);
    await browser.waitFor('Boolean(document.querySelector(".processed-date-picker"))&&document.querySelectorAll(".board-column.closed .ticket-card").length===1');
    const capture=async(name:string)=>{assert.ok(browser);assert.equal(await browser.evaluate("(()=>{const card=document.querySelector('.board-column.pending .ticket-card'),link=card?.querySelector('.card-open'),time=card?.querySelector('.activity-time');if(!card||!link||!time)return false;const c=card.getBoundingClientRect(),l=link.getBoundingClientRect(),t=time.getBoundingClientRect();return Math.abs(c.width-l.width)<1&&Math.abs(l.right-parseFloat(getComputedStyle(link).paddingRight)-t.right)<1&&document.elementFromPoint(l.right-3,l.top+40)?.closest('.card-open')===link;})()"),true,'the complete card stays clickable and its timestamp stays right aligned at each viewport');const pixels=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name+'.png');await writeFile(file,pixels);screenshots.push({file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')});};
    assert.equal(await browser.evaluate('Boolean(document.querySelector("select[aria-label=已关闭范围]"))'),false);
    await typeWorkbenchDates(browser,'2024-02-29','2024-02-29');
    await clickWorkbenchControl(browser,'[aria-label="选择已处理日期"]');
    await browser.waitFor('document.querySelectorAll(".processed-date-popover [data-slot=range-calendar-cell]").length>=28');
    for(let click=0;click<2;click++){
      const label=await browser.evaluate("[...document.querySelectorAll('.processed-date-popover [data-slot=range-calendar-cell]:not([data-outside-month])')].find(cell=>cell.textContent.trim()==='29')?.getAttribute('aria-label')");assert.equal(typeof label,'string');
      await clickWorkbenchControl(browser,'.processed-date-popover [aria-label='+JSON.stringify(label)+']');
    }
    await browser.waitFor("!document.querySelector('.processed-date-popover')");
    await clickWorkbenchControl(browser,'[aria-label="应用已处理日期"]');
    await browser.waitFor('new URLSearchParams(location.search).get("range")==="custom"&&document.querySelectorAll(".board-column.closed .ticket-card").length===3');
    assert.deepEqual(await browser.evaluate('[...document.querySelectorAll(".board-column.closed .ticket-card")].map(node=>node.dataset.itemId)'),[ids.last,ids.first,ids.resolved]);
    assert.equal(await browser.evaluate('Boolean(document.querySelector(".workspace .workspace-footnote,.range-caption"))'),false);
    await capture('new-board-1920');
    await browser.evaluate('[...document.querySelectorAll(".view-tabs button")].find(button=>button.textContent.includes("列表")).click()');
    await browser.waitFor('new URLSearchParams(location.search).get("view")==="list"&&document.querySelectorAll(".list-group[aria-label=已处理] tbody tr").length===3');
    const priorDocument=await browser.evaluate('performance.timeOrigin');assert.equal(typeof priorDocument,'number');await browser.command('Page.reload');
    await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(priorDocument)}&&document.querySelector('.processed-date-picker')?.innerText.includes('2024')&&new URLSearchParams(location.search).get('closed_from')==='2024-02-29'&&document.querySelectorAll('.list-group[aria-label="已处理"] tbody tr').length===3`);
    await browser.evaluate('document.querySelector("[data-action=related-scope]").click()');
    await browser.waitFor('new URLSearchParams(location.search).get("scope")==="related"&&document.querySelector(".scope-tabs [data-action=related-scope]").getAttribute("aria-pressed")==="true"');
    assert.equal(await browser.evaluate('new URLSearchParams(location.search).get("closed_to")'),'2024-02-29');
    await browser.evaluate('[...document.querySelectorAll(".scope-tabs button")].find(button=>button.textContent==="团队工作").click()');
    await browser.waitFor('new URLSearchParams(location.search).get("scope")==="team"&&document.querySelectorAll(".list-group[aria-label=已处理] tbody tr").length===3');
    await browser.evaluate('[...document.querySelectorAll(".view-tabs button")].find(button=>button.textContent.includes("看板")).click()');
    await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:960,deviceScaleFactor:1,mobile:false});
    await browser.waitFor('document.querySelectorAll(".board-column.closed .ticket-card").length===3');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await capture('new-board-900');
    await typeWorkbenchDates(browser,'2024-03-02','2024-03-01');
    assert.equal(await browser.evaluate('document.querySelector("[aria-label=应用已处理日期]").disabled'),true);
    assert.equal(await browser.evaluate('new URLSearchParams(location.search).get("closed_from")'),'2024-02-29');
    await clickWorkbenchControl(browser,'[aria-label="清除已处理日期和取消筛选"]');await browser.waitFor('new URLSearchParams(location.search).get("range")==="all"&&document.querySelector(".board-column.closed .column-heading").textContent.includes("4 已加载")');
    assert.equal(await browser.evaluate('new URLSearchParams(location.search).has("closed_from")||Boolean(document.querySelector("input[type=date]"))'),false);
    assert.equal(writes,0);console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',custom_range:true,read_only:true,dates_survive_scope_view_reload:true,screenshots}));
  }catch(error){failure=error;try{if(browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));}catch(diagnostic){failure=new AggregateError([error,diagnostic],'CLOSED_RANGE_DIAGNOSTICS_FAILED');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);
},{workbenchFollowEnabled:true}));
