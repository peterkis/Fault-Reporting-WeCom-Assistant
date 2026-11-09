import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT10Browser,fillWaiting} from './helpers/t10-browser-fixture.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {waitForAnimationsSettled} from './helpers/browser-animations.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';

test('Card 32B draft copy, single combobox frame, menu closes before the dialog, no orphan info icons, opaque restore confirm and closing labels',{timeout:240000},async()=>{
 await withT10Fixture(async context=>{
  const target=context.tickets[0],original=context.tickets[3];assert.ok(target&&original);
  const http=await t11Http(context,2,{closeConnections:true});await http.start(target.ticket.id);const originalTicket=await http.detail(original.ticket.id);
  await withT10Browser(context,target.ticket.id,2,'CARD32B',async browser=>{
   await browser.command('Page.bringToFront');await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
   const directory=process.env.CARD32B_EVIDENCE_DIR??join(tmpdir(),'card32b-'+randomUUID()),screenshots:{file:string;sha256:string;width:number;height:number}[]=[],metrics:Record<string,unknown>={};
   await mkdir(directory,{recursive:true});
   // B5: shots wait until running enter/exit animations settle.
   const shot=async(name:string)=>{await waitForAnimationsSettled(browser);const bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(join(directory,name+'.png'),bytes);screenshots.push({file:name+'.png',sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});};
   const dialog='.detail-cancel-dialog',menu='details.ds-drawer-more:has(>summary[aria-label="更多工单操作"])',summary=menu+'>summary';
   await browser.waitFor("document.querySelector('.ds-next-step [data-action=request-information],.ds-next-step [data-action=wait-vendor],.ds-next-step button')!==null&&document.querySelector('[data-waiting-purpose][data-routine-draft=true]')!==null");
   // B4: the routine draft notices of the waiting controllers are present but draw nothing above 「处理人」.
   metrics.assignee=object(await browser.evaluate("(()=>{const label=[...document.querySelectorAll('.ds-detail dt')].find(n=>n.textContent.trim()==='处理人');const top=label?label.getBoundingClientRect().top:0;const visible=[...document.querySelectorAll('.ds-detail .workbench-draft-status')].filter(n=>{const r=n.getBoundingClientRect();return r.width>1&&r.height>1&&n.checkVisibility()&&r.bottom<=top;});return {routine:document.querySelectorAll('[data-waiting-purpose][data-routine-draft=true]').length,routineText:[...document.querySelectorAll('[data-waiting-purpose][data-routine-draft=true] [data-waiting-draft-status]')].map(n=>n.getAttribute('aria-label')),visibleIcons:visible.length,labelTop:Math.round(top)};})()"));
   const assignee=object(metrics.assignee);
   assert.ok(Number(assignee.routine)>=1,JSON.stringify(assignee));assert.ok((assignee.routineText as string[]).every(text=>text.includes('草稿仅在当前浏览器')),'routine notices stay readable to assistive technology');assert.equal(assignee.visibleIcons,0);assert.ok(Number(assignee.labelTop)>0);
   await shot('drawer-1440-assignee');
   // B3: choosing 「关闭事项…」 in 「⋯」 closes the menu before the dialog opens; closing the dialog returns focus to 「⋯」.
   await clickWorkbenchControl(browser,summary);await browser.waitFor(`document.querySelector(${JSON.stringify(menu)})?.open===true`);
   await clickWorkbenchControl(browser,menu+' [data-action=cancel]');
   await browser.waitFor(`document.querySelector(${JSON.stringify(dialog)})?.checkVisibility()===true`);
   metrics.menuOnOpen={open:await browser.evaluate(`document.querySelector(${JSON.stringify(menu)}).open`),panelVisible:await browser.evaluate(`document.querySelector(${JSON.stringify(menu+' .ds-drawer-more-panel')}).checkVisibility()`)};
   assert.deepEqual(metrics.menuOnOpen,{open:false,panelVisible:false});
   // B1: autosave reads 「正在保存草稿…」 while saving and 「草稿已保存」 once saved; the technical wording is gone.
   await browser.evaluate("(()=>{window.__draftTexts=[];const seen=()=>{for(const n of document.querySelectorAll('[data-waiting-draft-status]')){const t=n.getAttribute('aria-label')+'|'+n.textContent;if(window.__draftTexts.at(-1)!==t)window.__draftTexts.push(t);}};new MutationObserver(seen).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label']});seen();})()");
   await clickWorkbenchControl(browser,dialog+' input[value=OTHER]');await browser.evaluate(fillWaiting(dialog+' textarea','卡32 草稿文案（合成）'));
   await browser.waitFor("document.querySelector('.detail-cancel-dialog [data-waiting-draft-status]')?.textContent.includes('草稿已保存')");
   metrics.draft=await browser.evaluate('window.__draftTexts');
   const draft=metrics.draft as string[];
   assert.ok(draft.some(text=>text.startsWith('正在保存草稿…|')),JSON.stringify(draft));assert.ok(!draft.some(text=>text.includes('正在保存恢复副本')),JSON.stringify(draft));
   // B2: the original-ticket combobox has one frame: 1px border at rest, a 2px --brand ring on focus, nothing drawn by the input itself.
   await clickWorkbenchControl(browser,dialog+' input[value=DUPLICATE]');await browser.waitFor(`document.querySelector('input[aria-label="关联原单（选填）"]')!==null`);
   const frame="(()=>{const box=document.querySelector('.ds-closure-combobox'),input=box.querySelector('input'),b=getComputedStyle(box),i=getComputedStyle(input),p=document.createElement('span');p.style.color='var(--brand)';document.body.append(p);const brand=getComputedStyle(p).color;p.remove();return {border:b.borderTopWidth+' '+b.borderTopStyle,borderColor:b.borderTopColor===brand?'brand':b.borderTopColor,outline:b.outlineStyle==='none'?'none':b.outlineWidth+' '+(b.outlineColor===brand?'brand':b.outlineColor)+' '+b.outlineOffset,shadow:b.boxShadow,input:{outline:i.outlineStyle==='none'||i.outlineWidth==='0px'?'none':i.outlineWidth+' '+i.outlineStyle,border:i.borderTopWidth,shadow:i.boxShadow},focused:document.activeElement===input};})()";
   metrics.comboboxRest=object(await browser.evaluate(frame));
   assert.deepEqual(metrics.comboboxRest,{border:'1px solid',borderColor:object(metrics.comboboxRest).borderColor,outline:'none',shadow:'none',input:{outline:'none',border:'0px',shadow:'none'},focused:false});assert.notEqual(object(metrics.comboboxRest).borderColor,'brand');
   await clickWorkbenchControl(browser,'input[aria-label="关联原单（选填）"]');await browser.command('Input.insertText',{text:originalTicket.ticket_no});
   await browser.waitFor("document.querySelectorAll('.ds-closure-search-option').length>0");
   metrics.comboboxFocus=object(await browser.evaluate(frame));
   assert.deepEqual(metrics.comboboxFocus,{border:'1px solid',borderColor:'brand',outline:'2px brand -1px',shadow:'none',input:{outline:'none',border:'0px',shadow:'none'},focused:true});
   await shot('close-dialog-reason');
   for(const key of ['ArrowDown','Enter'] as const){await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r'}:{})});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
   await browser.waitFor('document.querySelector(".ds-closure-search [data-closure-selected]")?.getAttribute("data-closure-selected")==='+JSON.stringify(originalTicket.ticket_no));
   // B3: closing the dialog without submitting returns focus to 「⋯」.
   await clickWorkbenchControl(browser,dialog+' .ds-closure-actions button[type=button]');
   await browser.waitFor(`!document.querySelector(${JSON.stringify(dialog)})?.checkVisibility()&&document.activeElement===document.querySelector(${JSON.stringify(summary)})`);
   metrics.focusReturn={activeIsMenuTrigger:true,menuOpen:await browser.evaluate(`document.querySelector(${JSON.stringify(menu)}).open`)};assert.equal(object(metrics.focusReturn).menuOpen,false);
   // Submit the duplicate closure through the same menu path.
   await clickWorkbenchControl(browser,summary);await browser.waitFor(`document.querySelector(${JSON.stringify(menu)})?.open===true`);await clickWorkbenchControl(browser,menu+' [data-action=cancel]');
   await browser.waitFor(`document.querySelector(${JSON.stringify(dialog)})?.checkVisibility()===true&&document.querySelector(${JSON.stringify(menu)}).open===false`);
   // The draft may restore the earlier choice; otherwise choose the original again.
   if(!await browser.evaluate(`document.querySelector('.ds-closure-search [data-closure-selected]')?.getAttribute('data-closure-selected')===${JSON.stringify(originalTicket.ticket_no)}`)){
    await clickWorkbenchControl(browser,dialog+' input[value=DUPLICATE]');await clickWorkbenchControl(browser,'input[aria-label="关联原单（选填）"]');await browser.command('Input.insertText',{text:originalTicket.ticket_no});await browser.waitFor("document.querySelectorAll('.ds-closure-search-option').length>0");
    for(const key of ['ArrowDown','Enter'] as const){await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r'}:{})});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
   }
   await browser.waitFor(`document.querySelector('.ds-closure-search [data-closure-selected]')?.getAttribute('data-closure-selected')===${JSON.stringify(originalTicket.ticket_no)}&&document.querySelector('${dialog} button[type=submit]')?.disabled===false`);
   await clickWorkbenchControl(browser,dialog+' button[type=submit]');
   await browser.waitFor(`!document.querySelector(${JSON.stringify(dialog)})&&document.querySelector('[data-closure-history]')?.textContent.includes('重复报修')&&document.querySelector('[data-record-closure-reason]')!==null`);
   // B6: closing statuses read 「已关闭」; the latest closing record carries reason and original number as secondary text.
   // The status badges are never truncated (every node in the status change fits its box), and reason + original sit on a second line, as in 关闭记录.
   metrics.timeline=object(await browser.evaluate("(()=>{const facts=document.querySelector('[data-record-closure-reason]'),record=facts.closest('.detail-record'),change=record.querySelector('.record-status-change'),badges=[...change.querySelectorAll('.ds-status-badge')],nodes=[change,...change.querySelectorAll('*')],f=facts.getBoundingClientRect(),c=change.getBoundingClientRect(),link=facts.querySelector('.ds-closure-original');return {badge:badges[1].textContent,truncated:nodes.filter(n=>n.scrollWidth>n.clientWidth).map(n=>n.className||n.tagName),badgeVisible:badges.every(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.right<=record.getBoundingClientRect().right;}),secondLine:f.top>=c.bottom,reason:facts.querySelector('.ds-closure-entry-reason').textContent,original:link?.textContent??null,linkOutsideRowButton:Boolean(link)&&!link.closest('.record-content'),reasons:document.querySelectorAll('[data-record-closure-reason]').length,legacy:document.body.innerText.includes('已关联重复单')};})()"));
   assert.deepEqual(metrics.timeline,{badge:'已关闭',truncated:[],badgeVisible:true,secondLine:true,reason:'重复报修',original:originalTicket.ticket_no,linkOutsideRowButton:true,reasons:1,legacy:false});
   await browser.evaluate("document.querySelector('[data-record-closure-reason]').scrollIntoView({block:'center'})");
   await shot('drawer-1440-closed-timeline');
   // B5: the restore confirm is opaque, above the board and presence tags, once its entrance settles.
   await browser.evaluate("document.querySelector('.ds-next-step [data-action=restore-closed]').scrollIntoView({block:'center'})");
   await clickWorkbenchControl(browser,'.ds-next-step [data-action=restore-closed]');await browser.waitFor("document.querySelector('[data-restore-confirmation]')?.textContent.includes('处理中')");
   await waitForAnimationsSettled(browser);
   metrics.restore=object(await browser.evaluate("(()=>{const d=document.querySelector('[data-restore-confirmation]').closest('[role=dialog]'),c=d.closest('.ds-modal-container'),bd=c.parentElement,s=getComputedStyle(d),r=d.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),opacity=n=>{let o=1;for(let x=n;x;x=x.parentElement)o*=Number(getComputedStyle(x).opacity);return o;},p=document.createElement('span');p.style.backgroundColor='var(--bg-canvas)';document.body.append(p);const canvas=getComputedStyle(p).backgroundColor;p.remove();return {panel:s.backgroundColor===canvas,panelOpacity:opacity(d),backdropOpacity:opacity(bd),onTop:Boolean(hit&&d.contains(hit)),running:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getComputedTiming().iterations!==Infinity).length};})()"));
   assert.deepEqual(metrics.restore,{panel:true,panelOpacity:1,backdropOpacity:1,onTop:true,running:0});
   await shot('restore-confirm');
   await writeFile(join(directory,'receipt-32b.json'),JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',platform:process.platform,metrics,screenshots,real_sends:0},null,2));
  });
 },{closureUi:true});
});
