import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT42BoardBrowser,object} from './helpers/t42-board-browser-fixture.mjs';
import {seedWeb01NoConversationIntake} from './helpers/web01-workbench-fixture.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../app/server/src/platform/time-contract.mjs';
import {chooseWorkbenchSelect,clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';

for(const mode of ['arrival','collapsed','scrolling','reduced','filtered'] as const)test('Card 16 '+mode+' keeps official new-card reads, bounded motion and reading position',{timeout:240000},()=>withT42BoardBrowser(async(f,browser,_card,get)=>{
  await browser.command('Page.bringToFront');await browser.waitFor("document.querySelector('[data-realtime-status]')?.dataset.realtimeStatus==='live'");
  await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:mode==='reduced'?'reduce':'no-preference'}]});
  // Wait for the initial confirmed three-column batch before creating a new source fact.
  await browser.waitFor("[...document.querySelectorAll('.ds-stage-count')].every(n=>n.textContent!=='—')&&document.querySelectorAll('.ticket-card').length>3");
  if(mode==='arrival'||mode==='collapsed'){
    const expanded=mode==='arrival';
    await browser.evaluate(`(()=>{const button=document.querySelector('.board-column.pending [data-action=expand-column]');if(button?.getAttribute('aria-expanded')!==${JSON.stringify(String(expanded))})button.click();})()`);
    await browser.waitFor("document.querySelector('.board-column.pending [data-action=expand-column]')?.getAttribute('aria-expanded')==="+JSON.stringify(String(expanded)));
  }
  const priorTicket=await browser.evaluate("document.querySelector('.board-column.pending [data-board-group=待接单] .ticket-card')?.dataset.itemId");
  await browser.evaluate("(()=>{globalThis.__card16Motion=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.matches('.ticket-card'))globalThis.__card16Motion.push({id:this.dataset.itemId,frames,duration:options.duration});return animate.call(this,frames,options);};})()");
  if(mode==='filtered'){
    const active=await get('/api/workbench/board?column=active');assert.ok(Array.isArray(active.items));const owner=active.items.map(object).find(item=>item.assignee_name);assert.ok(owner);
    await chooseWorkbenchSelect(browser,'[data-field-label=处理人]','name:'+String(owner.assignee_name));
  }
  if(mode==='scrolling'){
    await browser.evaluate("(()=>{const button=document.querySelector('.board-column.pending [data-action=expand-column]');if(button?.getAttribute('aria-expanded')==='false')button.click();})()");
    await browser.evaluate('window.scrollTo(0,200)');
    await browser.waitFor('scrollY>0');
  }
  const scroll=await browser.evaluate('scrollY'),visible=await browser.evaluate("[...document.querySelectorAll('.board-column.pending .ticket-card')].map(n=>({id:n.dataset.itemId,top:n.getBoundingClientRect().top}))");
  await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__card16IncomingRead=false;globalThis.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).startsWith('/api/workbench/board?column=pending')&&JSON.stringify(await response.clone().json()).includes(globalThis.__card16IncomingId))globalThis.__card16IncomingRead=true;return response;};})()");
  const intake=await seedWeb01NoConversationIntake({pool:f.pool,text:'卡十六实时到达的新合成报修',location:'合成门诊'});
  const ticket=(await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:assertLocalDateTime(intake.receivedAt),traceId:'card16-arrival'})).ticket;assert.ok(ticket);
  await browser.evaluate('globalThis.__card16IncomingId='+JSON.stringify(ticket.id));
  const fresh=object((await get('/api/workbench/items/ticket/'+ticket.id)).item);assert.equal(fresh.column,'pending');
  await browser.evaluate("document.querySelector('.ds-page-header button[aria-label=刷新]').click()");
  const selector='[data-item-id="'+ticket.id+'"]';
  if(mode==='filtered'){
    await browser.waitFor('globalThis.__card16IncomingRead===true');await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),false);
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.ds-column-arrivals'))"),false,'new-card counts follow the active loaded-item filter');
    assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);return;
  }
  if(mode==='scrolling'){
    await browser.waitFor("document.querySelector('.ds-column-arrivals')?.textContent.includes('1 条新报修')");
    assert.equal(await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),false);
    assert.equal(await browser.evaluate('scrollY'),scroll);
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.board-column.pending .ticket-card')].map(n=>({id:n.dataset.itemId,top:n.getBoundingClientRect().top}))"),visible);
    await browser.evaluate("document.querySelector('.ds-column-arrivals').click()");
  }
  await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  assert.equal(await browser.evaluate("[...document.querySelectorAll('.board-column.pending [data-board-group=待接单] .ticket-card')][0]?.dataset.itemId"),ticket.id);
  const motions:unknown=await browser.evaluate('globalThis.__card16Motion');assert.ok(Array.isArray(motions));
  assert.equal(motions.some(value=>object(value).id===ticket.id&&object(value).duration===2000),mode!=='reduced');
  if(mode==='arrival'||mode==='collapsed'){
    await browser.command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await browser.waitFor(`document.querySelector(${JSON.stringify(selector)}).getAnimations().length===0`);
    const presented=await browser.evaluate("[...document.querySelectorAll('.board-column.pending .ticket-card')].map(n=>n.dataset.itemId)");assert.ok(Array.isArray(presented));
    const next=priorTicket;assert.ok(typeof next==='string','the preceding read exposes the original next Ticket even when folded');
    await clickWorkbenchControl(browser,selector+' .card-open');await browser.waitFor("Boolean(document.querySelector('.detail-dialog #detail-title'))");
    assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.board-column.pending .ticket-card')].map(n=>n.dataset.itemId)"),presented,'detail freeze inherits the displayed promotion, not the old sort');
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=下一项]');await browser.waitFor('location.pathname.split("/").at(-1)==='+JSON.stringify(next));
    await clickWorkbenchControl(browser,'.detail-dialog button[aria-label=上一项]');await browser.waitFor('location.pathname.split("/").at(-1)==='+JSON.stringify(ticket.id));
  }
  assert.equal(await browser.evaluate('globalThis.__t42Writes.length'),0);
},{realtime:true,reduceMotion:mode==='reduced'}));
