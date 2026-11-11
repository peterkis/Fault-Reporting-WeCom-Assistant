import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture,seedCard28Board} from './helpers/web01-workbench-fixture.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {loadServiceCatalog} from '../app/server/src/p2-007-service-catalog.mjs';

// Card 29: list display fixes, search projection parity, external original numbers, the dismissed drawer and the ⋯ menu.
test('Card 29 list, search, board and drawer closure presentation use real HTTP/PG reads without writes',{timeout:240000},()=>withWeb01Fixture(async(f:T11Fixture)=>{
 const ids=await seedCard28Board(f),directory=process.env.CARD29_EVIDENCE_DIR??await mkdtemp(join(tmpdir(),'card29-'));await mkdir(directory,{recursive:true});
 const metrics:Record<string,unknown>={},screenshots:unknown[]=[],writes:string[]=[];
 const observe=(request:import('node:http').IncomingMessage)=>{if(request.method==='POST'&&!request.url?.startsWith('/api/workbench/search')&&!request.url?.startsWith('/api/workbench/activity'))writes.push(request.url??'');};f.runtime.server.on('request',observe);
 let browser:NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>|undefined,failure:unknown;
 try{
  const cookie=f.browserCookies[0];assert.ok(cookie);browser=await launchSystemBrowser({url:f.origin+'/workbench/app/?view=list&range=all',width:1440,height:1000,cookies:[{...cookie,url:f.origin+'/'}]});assert.ok(browser);const b=browser;
  await b.command('Page.bringToFront');
  const go=async(path:string,ready:string)=>{await b.command('Page.navigate',{url:f.origin+path});await b.waitFor(ready);await b.evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');};
  const capture=async(name:string)=>{await b.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const bytes=Buffer.from(await b.screenshot(),'base64');const viewport=object(await b.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,zoom:visualViewport.scale})'));assert.equal(viewport.dpr,1);assert.equal(viewport.zoom,1);await writeFile(join(directory,name+'.png'),bytes);screenshots.push({file:name+'.png',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex'),viewport});};
  const row=(id:string)=>'.ds-work-row[data-item-id="'+id+'"]';
  const listReady="document.querySelectorAll('.ds-list-stage').length===3&&document.querySelectorAll('.ds-work-row').length>=8";
  await b.waitFor(listReady);
  // L1: a missing reporter or location never renders as 「— · 位置」; both missing renders a single dash.
  assert.equal(await b.evaluate("[...document.querySelectorAll('.ds-list-reporter')].some(n=>/—\\s·|·\\s—/u.test(n.textContent))"),false);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.pending[2]??'')+' .ds-list-reporter')})?.textContent`),'—');
  // L2: one-line owner with the full name in title.
  metrics.longOwner=object(await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(row(ids.longOwner)+' .ds-list-owner-name')}),s=getComputedStyle(n);return {whiteSpace:s.whiteSpace,overflow:s.textOverflow,height:n.clientHeight,title:n.parentElement.title,row:n.closest('tr').getBoundingClientRect().height};})()`));
  assert.deepEqual(metrics.longOwner,{whiteSpace:'nowrap',overflow:'ellipsis',height:20,title:ids.longOwnerName,row:44});
  // L3: stage rows stay white; only subgroup rows are gray, also while hovered.
  const canvas=await b.evaluate("getComputedStyle(document.querySelector('.ds-work-table thead th')).backgroundColor");
  await b.evaluate("document.querySelectorAll('.ds-list-stage').forEach(n=>n.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})))");
  assert.equal(await b.evaluate(`[...document.querySelectorAll('.ds-list-stage')].every(n=>getComputedStyle(n).backgroundColor===${JSON.stringify(canvas)}||getComputedStyle(n).backgroundColor==='rgba(0, 0, 0, 0)')`),true);
  // L4: 「收起」 shares the 「显示剩余」 style and carries a 14px ChevronUp.
  const more=await b.evaluate("[...document.querySelectorAll('.ds-list-more [data-action=expand-column][aria-expanded=false]')].map(n=>'#'+n.closest('tr').id+' button')") as string[];
  if(more[0]){await clickWorkbenchControl(b,more[0]);await b.waitFor(`document.querySelector(${JSON.stringify(more[0])})?.getAttribute('aria-expanded')==='true'`);
   metrics.collapse=object(await b.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(more[0])}),i=n.querySelector('svg');return {text:n.textContent,icon:i?.getBoundingClientRect().width??0,size:getComputedStyle(n).fontSize};})()`));
   assert.deepEqual(metrics.collapse,{text:'收起',icon:14,size:'12px'});}
  await clickWorkbenchControl(b,'.ds-list-subgroup[data-board-group="已关闭"] button');await b.waitFor("document.querySelector('.ds-list-subgroup[data-board-group=已关闭] button').getAttribute('aria-expanded')==='true'");
  for(const selector of await b.evaluate("[...document.querySelectorAll('.ds-list-more [data-action=expand-column][aria-expanded=false]')].map(n=>'#'+n.closest('tr').id+' button')") as string[])await clickWorkbenchControl(b,selector);
  // L5/B1: the original is the external IT- number, inside the single reason tag.
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(row(ids.duplicateWith)+' [data-closure-reason]')}).textContent`),'重复 · '+ids.duplicateOfRef);assert.match(ids.duplicateOfRef,/^IT-/u);
  await capture('list-1440-closed');
  // L6: search results show the same category tile and timing as the ordinary list.
  const pendingId=ids.pending[1]??'',plain=object(await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row(pendingId))});return {category:r.querySelector('.ds-ticket-category').dataset.category,time:r.querySelector('td:nth-child(4)').textContent};})()`));
  // A realtime hint that arrives before the connection is live invalidates an in-flight search; wait for live, then re-read once if needed.
  await go('/workbench/app/?view=list&range=all&search=1&q='+encodeURIComponent('护理工作站连接超时'),"document.querySelector('[data-realtime-status=live]')!==null");
  await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(row(pendingId))}))||[...document.querySelectorAll('.ds-list-feedback button')].some(n=>n.textContent==='重新读取')`);
  if(!await b.evaluate(`Boolean(document.querySelector(${JSON.stringify(row(pendingId))}))`)){await b.evaluate("[...document.querySelectorAll('.ds-list-feedback button')].find(n=>n.textContent==='重新读取').click()");await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(row(pendingId))}))`);}
  const searched=object(await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(row(pendingId))});return {category:r.querySelector('.ds-ticket-category').dataset.category,time:r.querySelector('td:nth-child(4)').textContent};})()`));
  assert.notEqual(plain.category,'unclassified');assert.notEqual(plain.time,'—');assert.deepEqual(searched,plain);metrics.search={plain,searched};
  await capture('list-1440-search');
  // Board: the dismissed duplicate card shows one 「重复 · IT-…」 tag.
  await go('/workbench/app/?range=all','document.querySelectorAll(".ds-ticket-card").length>=6');
  await b.evaluate("(()=>{const group=[...document.querySelectorAll('[data-board-group]')].find(n=>n.getAttribute('data-board-group')==='已关闭'),button=group?.querySelector('button[aria-expanded]');if(button?.getAttribute('aria-expanded')==='false')button.click();})()");
  const card='.ds-ticket-card[data-item-id="'+ids.duplicateWith+'"]';await b.waitFor(`Boolean(document.querySelector(${JSON.stringify(card+' [data-closure-reason]')}))`);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(card+' [data-closure-reason]')}).textContent`),'重复 · '+ids.duplicateOfRef);
  assert.equal(await b.evaluate(`document.querySelector(${JSON.stringify(card+' [data-closure-reason] .ds-closure-original')})?.textContent`),ids.duplicateOfRef);
  await b.evaluate(`document.querySelector(${JSON.stringify(card)}).scrollIntoView({block:'center'})`);await capture('board-1440-duplicate-tag');
  // D1/D2: the dismissed drawer is a gray 「已关闭」 with a neutral next step, its reason and one restore entry.
  await go('/workbench/app/items/ticket/'+ids.duplicateWith,"Boolean(document.querySelector('.ds-next-step[data-dismissed=true]'))");
  metrics.drawer=object(await b.evaluate("(()=>({badge:document.querySelector('[data-closure-state=dismissed]')?.textContent,completedStage:Boolean(document.querySelector('.ds-detail-state .ds-stage-pill:not(.ds-dismissed-pill)')),substatusHidden:document.querySelector('.ds-detail-state .ds-drawer-status')?.hidden??true,kicker:document.querySelector('.ds-next-step-kicker')?.textContent,summary:document.querySelector('[data-closure-summary]')?.textContent,historyRestore:document.querySelectorAll('[data-closure-history] [data-action=restore-dismissed]').length,placeholders:/未关联|未记录|未通知/u.test(document.querySelector('[data-closure-history]')?.textContent??'')}))()"));
  assert.deepEqual(metrics.drawer,{badge:'已关闭',completedStage:false,substatusHidden:true,kicker:'已关闭 · 不计入完成数',summary:'重复报修 · '+ids.duplicateOfRef,historyRestore:0,placeholders:false});
  await capture('drawer-1440-dismissed');
  // K6: the ⋯ menu is a 220px menu with a separated danger 「关闭事项…」.
  await go('/workbench/app/items/ticket/'+ids.longOwner,"document.querySelector('[data-action=cancel]')!==null");
  await clickWorkbenchControl(b,'[data-action=open-detail-actions]');await b.waitFor("document.querySelector('.ds-drawer-more[open]')!==null");
  metrics.menu=object(await b.evaluate("(()=>{const p=document.querySelector('.ds-drawer-more[open]>.ds-drawer-more-panel'),c=p.querySelector('.cancel-ticket-trigger'),s=getComputedStyle(p);return {width:p.getBoundingClientRect().width,radius:s.borderRadius,padding:s.paddingTop,item:c.getBoundingClientRect().height,label:c.textContent,icon:c.querySelector('svg')?.getBoundingClientRect().width??0,danger:getComputedStyle(c).color===getComputedStyle(document.documentElement).getPropertyValue('--tone-danger-fg').trim()||getComputedStyle(c).color!==getComputedStyle(p).color};})()"));
  assert.deepEqual(metrics.menu,{width:220,radius:'10px',padding:'4px',item:32,label:'关闭事项…',icon:14,danger:true});
  await capture('drawer-1440-menu');
  assert.deepEqual(writes,[],'Card 29 presentation reads submit no business writes');
 }catch(error){failure=error;}
 finally{await closeBrowserTestResources([async()=>{if(failure&&browser)await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));},()=>writeFile(join(directory,'receipt.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG_WITH_EXPLICIT_CARD28_SYNTHETIC_READ_FIELDS',platform:process.platform,metrics,screenshots},null,2)),()=>{ids.restore();f.runtime.server.off('request',observe);},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],failure);}
},{precisionV212:true,serviceCatalog:loadServiceCatalog(),ticketSelfHandlingEnabled:true,workbenchBoardActionsEnabled:true,workbenchSearchEnabled:true,workbenchRealtimeEnabled:true}));
