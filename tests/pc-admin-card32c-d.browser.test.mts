import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT10Browser} from './helpers/t10-browser-fixture.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';
import {createTicketActionService} from '../app/server/src/p1-006-ticket-state-actions.mjs';

// ADR-0058 / card 32C-D: 「完成」 COMPLETED and 「关闭」 DISMISSED are two statuses with two labels and two timeline dots.
test('Card 32C-D completed and dismissed Tickets read 已完成 / 已关闭 with distinct timeline dots, list groups and search labels',{timeout:240000},async()=>{
 await withT10Fixture(async context=>{
  const completedTarget=context.tickets[0],dismissedTarget=context.tickets[1];assert.ok(completedTarget&&dismissedTarget);
  const http=await t11Http(context,2,{closeConnections:true});
  // Staff completion stays behind its own flag in this fixture, so the Ticket completes through resolve + the SYSTEM auto-complete action.
  const started=await http.start(completedTarget.ticket.id);
  const resolved=await http.post(completedTarget.ticket.id,'resolve',{client_command_id:randomUUID(),expected_version:started.version,reason_code:'C32CD_RESOLVED',note:'卡32C-D 合成处理结果',external_visible:true});
  assert.equal(resolved.status,200,await resolved.clone().text());
  const automatic=await createTicketActionService({pool:context.pool}).perform({ticketId:completedTarget.ticket.id,action:'auto-complete',actor:{type:'SYSTEM',id:null},expectedVersion:(await http.detail(completedTarget.ticket.id)).version,traceId:'c32cd-auto-complete'});
  assert.equal(automatic.ok,true,JSON.stringify(automatic));
  const open=await http.detail(dismissedTarget.ticket.id);
  const dismissal=await http.post(dismissedTarget.ticket.id,'dismiss',{client_command_id:randomUUID(),expected_version:open.version,reason_code:'FALSE_REPORT_OR_TEST',note:'卡32C-D 合成关闭说明'});
  assert.equal(dismissal.status,200,await dismissal.clone().text());
  assert.equal((await http.detail(completedTarget.ticket.id)).status,'COMPLETED');assert.equal((await http.detail(dismissedTarget.ticket.id)).status,'DISMISSED');
  // The removed route is gone, not aliased.
  assert.equal((await http.post(dismissedTarget.ticket.id,'cancel',{client_command_id:randomUUID(),expected_version:open.version+1,reason_code:'OTHER',note:'合成'})).status,404);
  await withT10Browser(context,completedTarget.ticket.id,2,'CARD32CD',async browser=>{
   await browser.command('Page.bringToFront');await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   const directory=process.env.CARD32CD_EVIDENCE_DIR??join(tmpdir(),'card32cd-'+randomUUID()),screenshots:{file:string;sha256:string;width:number;height:number}[]=[],metrics:Record<string,unknown>={};
   await mkdir(directory,{recursive:true});
   const settle='Promise.all(document.getAnimations().filter(a=>a.playState==="running"&&a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>null))).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))';
   const shot=async(name:string)=>{await browser.evaluate(settle);const bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(join(directory,name+'.png'),bytes);screenshots.push({file:name+'.png',sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});};
   const go=async(path:string,ready:string)=>{await browser.command('Page.navigate',{url:context.origin+path});await browser.waitFor(ready);await browser.evaluate(settle);};
   // A token resolves to the computed colour the page actually paints.
   const color=(token:string)=>`(()=>{const p=document.createElement('span');p.style.backgroundColor='var(${token})';document.body.append(p);const c=getComputedStyle(p).backgroundColor;p.remove();return c;})()`;
   const done=String(await browser.evaluate(color('--stage-done-accent'))),dismissed=String(await browser.evaluate(color('--stage-dismissed-accent'))),gray=String(await browser.evaluate(color('--gray-400')));
   assert.notEqual(done,dismissed,'「已关闭」 never borrows the completion colour');assert.equal(dismissed,gray);
   const timeline=(status:string)=>`(()=>{const node=[...document.querySelectorAll('.ds-timeline .record-status-change [data-status=${status}]')].at(-1);if(!node)return null;const dot=node.querySelector(':scope>.ds-status-dot'),badge=node.closest('.ds-status-badge')??node;node.scrollIntoView({block:'center'});return {label:badge.textContent.trim(),dot:dot?getComputedStyle(dot).backgroundColor:null,legacy:['已撤销','已关联公共故障','已关闭（已完成）'].filter(text=>document.body.innerText.includes(text))};})()`;
   for(const [status,id,label,expected,file] of [['COMPLETED',completedTarget.ticket.id,'已完成',done,'drawer-timeline-completed'],['DISMISSED',dismissedTarget.ticket.id,'已关闭',dismissed,'drawer-timeline-dismissed']] as const){
    await go('/workbench/app/items/ticket/'+id,`Boolean(document.querySelector('.ds-timeline .record-status-change [data-status=${status}]'))`);
    const measured=object(await browser.evaluate(timeline(status)));metrics[file]=measured;
    assert.deepEqual(measured,{label,dot:expected,legacy:[]},file);
    await shot(file);
   }
   // List at 1440: the closed stage keeps two groups, 已完成 (counts toward completion) and 已关闭 (does not).
   await go('/workbench/app/?view=list&range=all',"document.querySelectorAll('.ds-list-subgroup').length>0");
   for(const group of ['已完成','已关闭']){const trigger=`.ds-list-subgroup[data-board-group="${group}"] button`;if(await browser.evaluate(`document.querySelector(${JSON.stringify(trigger)})?.getAttribute('aria-expanded')==='false'`)){await clickWorkbenchControl(browser,trigger);await browser.waitFor(`document.querySelector(${JSON.stringify(trigger)})?.getAttribute('aria-expanded')==='true'`);}}
   const rowStatus=(id:string)=>`document.querySelector('.ds-work-row[data-item-id="${id}"]')?.closest('tbody,table')?document.querySelector('.ds-work-row[data-item-id="${id}"]').textContent:null`;
   await browser.waitFor(`Boolean(${rowStatus(completedTarget.ticket.id)})&&Boolean(${rowStatus(dismissedTarget.ticket.id)})`);
   // Each row belongs to the nearest preceding subgroup header; a completed row carries the 「已完成」 chip, a dismissed row its reason and 「… 关闭」 time (card 29).
   metrics.list=object(await browser.evaluate(`(()=>{const groups=[...document.querySelectorAll('.ds-list-subgroup')].map(n=>n.dataset.boardGroup),closedTrigger=document.querySelector('.ds-list-subgroup[data-board-group="已关闭"]');
    const groupOf=id=>{let group=null;for(const n of document.querySelectorAll('.ds-list-subgroup,.ds-work-row')){if(n.classList.contains('ds-list-subgroup'))group=n.dataset.boardGroup;else if(n.dataset.itemId===id)return group;}return null;};
    const row=id=>document.querySelector('.ds-work-row[data-item-id="'+id+'"]');const c=row(${JSON.stringify(completedTarget.ticket.id)}),d=row(${JSON.stringify(dismissedTarget.ticket.id)});
    return {groups,closedNote:/不计入完成数/u.test(closedTrigger?.textContent??''),completedGroup:groupOf(${JSON.stringify(completedTarget.ticket.id)}),dismissedGroup:groupOf(${JSON.stringify(dismissedTarget.ticket.id)}),
     completedChip:c.querySelector('.ds-list-status .status-chip')?.textContent.trim()??null,dismissedReason:d.querySelector('.ds-list-status')?.textContent.trim()??null,dismissedTime:/关闭$/u.test(d.querySelector('.ds-list-time.is-dismissed')?.textContent.trim()??''),dismissedChip:d.querySelector('.ds-list-status .status-chip')?.textContent.trim()??null};})()`));
   assert.deepEqual(metrics.list,{groups:['待判断','待接单','已完成','已关闭'],closedNote:true,completedGroup:'已完成',dismissedGroup:'已关闭',completedChip:'已完成',dismissedReason:'误报或测试',dismissedTime:true,dismissedChip:null});
   await browser.evaluate(`document.querySelector('.ds-list-subgroup[data-board-group="已完成"]').scrollIntoView({block:'start'})`);
   await shot('list-1440-closed-groups');
   // Search: the 细分状态 options come from the one status table; no special 「已关闭（已完成）」 and no removed statuses.
   await go('/workbench/app/?view=list&range=all&search=1',"Boolean(document.querySelector('.workbench-search'))");
   const statusSelect="[...document.querySelectorAll('.workbench-search .workbench-select')].find(n=>n.textContent.trim().startsWith('细分状态'))";
   if(!await browser.evaluate(`Boolean(${statusSelect}?.checkVisibility())`)){
    await browser.evaluate("document.querySelector('.workbench-search .ds-search-options').closest('button').setAttribute('data-c32cd-search-options','')");
    await clickWorkbenchControl(browser,'[data-c32cd-search-options]');await browser.waitFor(`Boolean(${statusSelect}?.checkVisibility())`);
   }
   await browser.evaluate(`${statusSelect}.querySelector('button').setAttribute('data-c32cd-status-trigger','')`);
   await clickWorkbenchControl(browser,'[data-c32cd-status-trigger]');await browser.waitFor("document.querySelectorAll('.workbench-select-popover [role=option]').length>0");
   metrics.search=await browser.evaluate("[...document.querySelectorAll('.workbench-select-popover [role=option]')].map(n=>n.textContent.trim())");
   const labels=metrics.search as string[];
   assert.ok(labels.includes('已完成')&&labels.includes('已关闭'),JSON.stringify(labels));for(const label of ['已完成','已关闭'])assert.equal(labels.filter(item=>item===label).length,1,label+' names exactly one status');
   for(const legacy of ['已关闭（已完成）','已撤销','已关联公共故障','已忽略'])assert.equal(labels.includes(legacy),false,legacy);
   await shot('search-status-labels');
   await writeFile(join(directory,'receipt-32c-d.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,tokens:{done,dismissed},metrics,screenshots,real_sends:0},null,2));
  });
 },{closureUi:true});
});
