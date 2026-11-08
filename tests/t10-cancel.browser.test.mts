import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {IncomingMessage} from 'node:http';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT10Browser,fillWaiting} from './helpers/t10-browser-fixture.mjs';
import {clickWorkbenchControl} from './helpers/heroui-workbench-controls.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';

async function recoveryModule(){const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')) as Record<string,{file:string}>;return '/workbench/app/'+manifest['src/feedback-recovery.ts']?.file;}

test('Card 27C-B closure recovery uses its own capability when internal notes are disabled',{timeout:120000},async()=>{
 await withT10Fixture(async context=>{
  const target=context.tickets[0];assert.ok(target);const http=await t11Http(context,2,{closeConnections:true});
  const bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {draft_recovery_enabled:boolean;ticket_waiting_action_draft_recovery_enabled:boolean;closure_draft_recovery_enabled:boolean};
  assert.deepEqual([bootstrap.draft_recovery_enabled,bootstrap.ticket_waiting_action_draft_recovery_enabled,bootstrap.closure_draft_recovery_enabled],[false,true,true]);
  await withT10Browser(context,target.ticket.id,2,'CARD27CB_RECOVERY_WITHOUT_NOTES',async browser=>{
   await browser.waitFor("document.querySelector('[data-action=cancel]')?.disabled===false");await clickWorkbenchControl(browser,'[data-action=cancel]');await clickWorkbenchControl(browser,'.detail-cancel-dialog input[value=OTHER]');
   await browser.evaluate(fillWaiting('.detail-cancel-dialog textarea','独立关闭草稿（合成）'));await browser.waitFor("document.querySelector('[data-waiting-draft-status]')?.textContent.includes('已保存恢复副本')");
   await clickWorkbenchControl(browser,'.detail-cancel-dialog button[type=submit]');await browser.waitFor("document.querySelector('[data-toast-source=ticket-waiting-cancel]')?.textContent.includes('已处理 · 已关闭')");
   assert.equal((await http.detail(target.ticket.id)).status,'DISMISSED');
  });
 },{closureUi:true,internalNotesEnabled:false});
});

test('Card 27C-B disabled recovery permits closing without browser draft storage',{timeout:120000},async()=>{
 await withT10Fixture(async context=>{
  const target=context.tickets[0];assert.ok(target);const http=await t11Http(context,2,{closeConnections:true});let posts=0;
  const observe=(request:IncomingMessage)=>{if(request.method==='POST'&&request.url==='/api/tickets/'+target.ticket.id+'/dismiss')posts++;};context.runtime.server.on('request',observe);
  try{await withT10Browser(context,target.ticket.id,2,'CARD27CB_NO_RECOVERY_STORAGE',async browser=>{
   await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'indexedDB',{value:undefined})"});const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.querySelector('[data-action=cancel]')?.disabled===false`);
   await clickWorkbenchControl(browser,'[data-action=cancel]');await clickWorkbenchControl(browser,'.detail-cancel-dialog input[value=OTHER]');await browser.evaluate(fillWaiting('.detail-cancel-dialog textarea','无本地恢复存储（合成）'));
   await browser.waitFor("document.querySelector('.detail-cancel-dialog button[type=submit]')?.disabled===false");await clickWorkbenchControl(browser,'.detail-cancel-dialog button[type=submit]');await browser.waitFor("document.querySelector('[data-toast-source=ticket-waiting-cancel]')?.textContent.includes('已处理 · 已关闭')");
   assert.equal(posts,1);assert.equal((await http.detail(target.ticket.id)).status,'DISMISSED');
  });}finally{context.runtime.server.removeListener('request',observe);}
 },{closureUi:true,recoveryEnabled:false});
});

test('Card 27C-B restores prior waiting-cancel notes and retains an old operation UUID for safe reconciliation',{timeout:120000},async()=>{
 await withT10Fixture(async context=>{
  const target=context.tickets[0],principal=context.principals[1];assert.ok(target);assert.ok(principal);const module=await recoveryModule();assert.ok(module);const scope={principal:principal.id,kind:'ticket',id:target.ticket.id,purpose:'waiting-cancel'},oldId=randomUUID();let posts=0,gets=0;
  const observe=(request:IncomingMessage)=>{if(request.url==='/api/tickets/'+target.ticket.id+'/dismiss'&&request.method==='POST')posts++;if(request.url==='/api/tickets/'+target.ticket.id+'/dismiss/commands/'+oldId&&request.method==='GET')gets++;};context.runtime.server.on('request',observe);
  try{await withT10Browser(context,target.ticket.id,2,'CARD27CB_LEGACY_CANCEL_DRAFT',async browser=>{
   await browser.evaluate(`(async()=>{const store=await import(${JSON.stringify(module)}),copy=await store.openDraft(${JSON.stringify(scope)});await store.saveDraft(copy.handle,JSON.stringify({schema:1,note:'旧版取消说明（合成）',pending:null}));})()`);
   let previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.querySelector('[data-action=cancel]')?.disabled===false`);
   await clickWorkbenchControl(browser,'[data-action=cancel]');await browser.waitFor("document.querySelector('.detail-cancel-dialog textarea')?.value==='旧版取消说明（合成）'");assert.equal(await browser.evaluate("document.querySelector('.detail-cancel-dialog input[value=OTHER]')?.checked"),true);
   await clickWorkbenchControl(browser,'[data-action=discard-cancel-draft]');await browser.waitFor("document.querySelector('.detail-cancel-dialog textarea')?.value==='' ");await clickWorkbenchControl(browser,'[aria-label="关闭取消窗口"]');
   await browser.evaluate(`(async()=>{const store=await import(${JSON.stringify(module)}),copy=await store.openDraft(${JSON.stringify(scope)});await store.saveDraft(copy.handle,JSON.stringify({schema:1,note:'旧版待核对说明（合成）',pending:{client_command_id:${JSON.stringify(oldId)},expected_version:1,reason_code:'CANCELLED_BY_REQUESTER',note:'旧版待核对说明（合成）',external_visible:false}}),{commandId:${JSON.stringify(oldId)}});})()`);
   previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.querySelector('[data-action=cancel]')?.disabled===false`);
   await clickWorkbenchControl(browser,'[data-action=cancel]');await browser.waitFor("Boolean(document.querySelector('[data-action=check-cancel-command]'))");assert.equal(await browser.evaluate('document.body.innerText.includes('+JSON.stringify(oldId)+')'),false);
   await clickWorkbenchControl(browser,'[data-action=check-cancel-command]');await browser.waitFor("document.querySelector('.ticket-waiting-state')?.textContent.includes('提交结果仍待核对')||document.querySelector('.ticket-waiting-state')?.textContent.includes('核对暂未完成')");assert.equal(gets,1);assert.equal(posts,0);
  });}finally{context.runtime.server.removeListener('request',observe);}
 },{closureUi:true});
});

test('production cancellation requires an independent human confirmation and preserves a closed form reason without sending or creating a round',async()=>{
  await withT10Fixture(async context=>{
    const http=await t11Http(context),target=context.tickets[0];assert.ok(target);const before=await http.detail(target.ticket.id);assert.equal(before.status,'QUEUED');assert.equal(before.handling_cycle,null);
    const path='/api/tickets/'+target.ticket.id+'/dismiss';let posts=0;const observe=(request:IncomingMessage)=>{if(request.method==='POST'&&request.url===path)posts++;};context.runtime.server.on('request',observe);
    try{await withT10Browser(context,target.ticket.id,0,'T10_SEPARATE_LEGAL_CANCEL_CONFIRMATION',async(browser,capture)=>{
      const form='form[aria-label="取消工单"]',input=form+' textarea[aria-label="取消原因"]',submit=form+' button[type="submit"]',note='INTERNAL_T10_CANCEL_UI：报修人撤销合成请求。';
      await browser.waitFor("Boolean(document.querySelector('[data-action=cancel]'))&&!document.querySelector('[data-action=cancel]').disabled");await browser.evaluate("document.querySelector('[data-action=cancel]').click()");await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify(input)}))`);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).disabled`),true);await browser.evaluate(fillWaiting(input,note));assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).disabled`),true);
      await browser.evaluate(`Array.from(document.querySelector(${JSON.stringify(form)}).querySelectorAll('button')).find(row=>['暂不取消','取消'].includes(row.textContent??'')).click()`);assert.equal(posts,0);assert.equal((await http.detail(target.ticket.id)).status,'QUEUED');
      await browser.evaluate("document.querySelector('[data-action=cancel]').click()");await browser.waitFor(`document.querySelector(${JSON.stringify(input)})?.value===${JSON.stringify(note)}`);await browser.evaluate(`document.querySelector(${JSON.stringify(form+' input[value=OTHER]')}).click()`);assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(form+' input[type="checkbox"]')}).checked`),false);
      assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(form+' input[value=OTHER]')}).checked`),true);await browser.waitFor(`!document.querySelector(${JSON.stringify(submit)}).disabled`);await browser.evaluate(`document.querySelector(${JSON.stringify(submit)}).click()`);
      await browser.waitFor("document.querySelector('[data-toast-source=ticket-waiting-cancel]')?.innerText.includes('已处理 · 已关闭')");const after=await http.detail(target.ticket.id);assert.equal(posts,1);assert.equal(after.status,'DISMISSED');assert.equal(after.version,before.version+1);assert.equal(after.handling_cycle,null);assert.equal(after.assignee_id,before.assignee_id);assert.equal(after.resolver_team_id,before.resolver_team_id);
      await capture('new-detail-1920.png');
    });}finally{context.runtime.server.removeListener('request',observe);}
  });
});

test('Card 27C-B six closure reasons, original links, history and board/list restoration use real HTTP facts',{timeout:240000},async()=>{
 await withT10Fixture(async context=>{
  const target=context.tickets[0],original=context.tickets[3];assert.ok(target);assert.ok(original);
  const http=await t11Http(context,2,{closeConnections:true});await http.start(target.ticket.id);const originalTicket=await http.detail(original.ticket.id);
  await withT10Browser(context,target.ticket.id,2,'CARD27CB_CLOSE_RESTORE',async(browser,capture)=>{
   await browser.command('Page.bringToFront');await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1400,deviceScaleFactor:1,mobile:false});
   const evidence=process.env.CARD29_EVIDENCE_DIR??join(tmpdir(),'card27cb-ui-'+randomUUID()),shots:{file:string;sha256:string;width:number;height:number}[]=[];
   // Card 32 B5: capture only after running enter/exit animations settle, so dialogs are not shot half transparent.
   const shot=async(name:string)=>{if(evidence){await mkdir(evidence,{recursive:true});await browser.evaluate('Promise.all(document.getAnimations().filter(a=>a.playState==="running"&&a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>null))).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');const bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(join(evidence,name),bytes);shots.push({file:name,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});}};
   const open=async()=>{await browser.waitFor("document.querySelector('[data-action=cancel]')?.disabled===false");await clickWorkbenchControl(browser,'[data-action=cancel]');await browser.waitFor("document.querySelector('.detail-cancel-dialog')?.checkVisibility()===true");};
   const choose=async(reason:string)=>{await clickWorkbenchControl(browser,'.detail-cancel-dialog input[value='+reason+']');await browser.waitFor(`document.querySelector('.detail-cancel-dialog input[value=${reason}]')?.checked===true`);};
   await open();assert.equal(await browser.evaluate("document.querySelectorAll('.detail-cancel-dialog fieldset[aria-label=关闭原因] input[type=radio]').length"),6);
   await browser.waitFor("(()=>{const d=document.querySelector('.detail-cancel-dialog'),r=d?.querySelector('.ds-closure-reason-option');return d?.getBoundingClientRect().width===440&&r?.getBoundingClientRect().height===36;})()");
   const metrics=await browser.evaluate("(()=>{const d=document.querySelector('.detail-cancel-dialog'),s=getComputedStyle(d),r=d.querySelector('.ds-closure-reason-option').getBoundingClientRect();return {width:d.getBoundingClientRect().width,radius:s.borderRadius,padding:s.padding,row:r.height,dpr:devicePixelRatio,zoom:visualViewport.scale};})()");
   assert.deepEqual(metrics,{width:440,radius:'14px',padding:'20px',row:36,dpr:1,zoom:1});
   // Card 29 K2: every reason option uses the same primary text color.
   assert.equal(await browser.evaluate("new Set([...document.querySelectorAll('.detail-cancel-dialog .ds-closure-reason-text')].map(n=>getComputedStyle(n).color)).size"),1);
   for(const [reason,notify,text] of [['FALSE_REPORT_OR_TEST',false,''],['DUPLICATE',true,'与已有报修重复'],['NOT_IT_SCOPE',true,'不属于信息科受理范围'],['REPORTER_WITHDREW',true,'已按您的要求撤销'],['REPORTER_UNREACHABLE',true,'多次联系未果'],['OTHER',false,'']] as const){
    await choose(reason);assert.equal(await browser.evaluate("document.querySelector('.ds-closure-notice').textContent.includes('将通知报修人')"),notify);assert.equal(await browser.evaluate("document.querySelector('.ds-closure-notice').textContent.includes('不会通知报修人')"),!notify);if(text)assert.equal(await browser.evaluate('document.querySelector(".ds-closure-notice").textContent.includes('+JSON.stringify(text)+')'),true);
    // Card 29 K4: termination is a separate line outside the notice, shown for an in-progress item.
    assert.equal(await browser.evaluate("document.querySelector('[data-closure-termination]')?.textContent"),'进行中的跟进与提醒将一并终止');assert.equal(await browser.evaluate("document.querySelector('.ds-closure-notice').textContent.includes('一并终止')"),false);
   }
   assert.equal(await browser.evaluate("document.querySelector('.detail-cancel-dialog').textContent.includes('关闭后不计入完成数')"),false);
   assert.equal(await browser.evaluate("document.querySelector('.detail-cancel-dialog button[type=submit]').disabled"),true);
   assert.equal(await browser.evaluate("document.querySelector('input[aria-label=通知报修人]').checked"),false);
   await browser.evaluate(fillWaiting('.detail-cancel-dialog textarea','内部说明不可外发（合成）'));await clickWorkbenchControl(browser,'input[aria-label=通知报修人]');
   await browser.waitFor("document.querySelector('[data-closure-notification-text]')?.textContent.includes('您的报修已关闭')");assert.equal(await browser.evaluate("document.querySelector('input[aria-label=通知报修人]').checked"),true);assert.equal(await browser.evaluate("document.querySelector('.ds-closure-notice').textContent.includes('不会通知报修人')"),false);assert.equal(await browser.evaluate("document.querySelector('.ds-closure-notice').textContent.includes('内部说明不可外发')"),false);await shot('03-other.png');
   await choose('NOT_IT_SCOPE');assert.equal(await browser.evaluate("document.querySelector('.detail-cancel-dialog button[type=submit]').disabled"),true);
   // Card 29 K1: 「非 IT 范围」 offers exactly three sub-options, nested under it.
   assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.detail-cancel-dialog fieldset[aria-label=具体情况] input[type=radio]')].map(n=>n.value)"),['BUSINESS_CONSULTATION_CONFIRMED','OUT_OF_SCOPE_CONFIRMED','SERVICE_REQUEST_CONFIRMED']);
   assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('.detail-cancel-dialog fieldset[aria-label=具体情况] .ds-closure-reason-text')].map(n=>n.textContent)"),['业务咨询','其他部门职责','服务请求']);
   assert.equal(await browser.evaluate("Boolean(document.querySelector('.detail-cancel-dialog fieldset[aria-label=关闭原因] input[value=NOT_IT_SCOPE]')?.closest('label')?.nextElementSibling?.matches('.ds-closure-secondary'))"),true);
   await clickWorkbenchControl(browser,'.detail-cancel-dialog input[value=OUT_OF_SCOPE_CONFIRMED]');await shot('02-not-it.png');
   // Card 29 K3: one combobox, search while typing, keyboard choice, the external number only.
   await choose('DUPLICATE');await clickWorkbenchControl(browser,'input[aria-label="关联原单（选填）"]');await browser.command('Input.insertText',{text:originalTicket.ticket_no});
   await browser.waitFor("document.querySelectorAll('.ds-closure-search-option').length>0");assert.equal(await browser.evaluate("document.querySelector('.ds-closure-search').textContent.includes('按编号搜索')"),false);
   assert.equal(await browser.evaluate("[...document.querySelectorAll('.ds-closure-search-option .ds-closure-number')].every(n=>n.textContent.startsWith('IT-'))"),true);await shot('01-duplicate-dropdown.png');
   for(const key of ['ArrowDown','Enter'] as const){await browser.command('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,...(key==='Enter'?{text:'\r'}:{})});await browser.command('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});}
   await browser.waitFor('document.querySelector(".ds-closure-search [data-closure-selected]")?.getAttribute("data-closure-selected")==='+JSON.stringify(originalTicket.ticket_no));await shot('01-duplicate.png');
   await clickWorkbenchControl(browser,'.detail-cancel-dialog button[type=submit]');await browser.waitFor("!document.querySelector('.detail-cancel-dialog')&&document.querySelector('[data-closure-history]')?.textContent.includes('重复报修')");
   assert.equal((await http.detail(target.ticket.id)).status,'DISMISSED');assert.equal(await browser.evaluate("document.querySelector('[data-closure-record]').textContent.includes('内部说明不可外发（合成）')"),true);
   await clickWorkbenchControl(browser,'[data-closure-record] [data-action=open-closure-original]');await browser.waitFor('location.pathname.endsWith('+JSON.stringify('/ticket/'+original.ticket.id)+')&&document.querySelector(".detail-breadcrumb")?.textContent.includes('+JSON.stringify(originalTicket.ticket_no)+')');await clickWorkbenchControl(browser,'[aria-label="关闭详情"]');await browser.waitFor('location.pathname.endsWith('+JSON.stringify('/ticket/'+target.ticket.id)+')&&Boolean(document.querySelector("[data-closure-record]"))');
   await clickWorkbenchControl(browser,'[aria-label="关闭详情"]');await browser.waitFor("!document.querySelector('#detail-title')");
   await browser.evaluate("(()=>{const group=[...document.querySelectorAll('[data-board-group]')].find(n=>n.getAttribute('data-board-group')==='已关闭'),b=group?.querySelector('button[aria-expanded]');if(b?.getAttribute('aria-expanded')==='false')b.click();})()");
   const card='[data-item-id="'+target.ticket.id+'"]';await browser.waitFor(`document.querySelector(${JSON.stringify(card+' [data-action=restore-closed]')})?.checkVisibility()===true`);
   assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-closure-reason]')}).textContent.includes(${JSON.stringify('重复 · '+originalTicket.ticket_no)})`),true);
   await browser.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(card)}),r=n.getBoundingClientRect();n.scrollIntoView({block:'center'});})()`);
   await clickWorkbenchControl(browser,card+' [data-action=restore-closed]');await browser.waitFor("document.querySelector('[data-restore-confirmation]')?.textContent.includes('处理中')");await shot('04-restore-confirm.png');
   // Card 29 R1: the follow-up footnote never overlaps the restore facts.
   assert.equal(await browser.evaluate("(()=>{const a=document.querySelector('[data-restore-confirmation]').getBoundingClientRect(),b=document.querySelector('.ds-restore-followups').getBoundingClientRect();return b.top>=a.bottom;})()"),true);
   await clickWorkbenchControl(browser,'[data-action=confirm-restore-closed]');await browser.waitFor(`document.querySelector(${JSON.stringify(card)})?.getAttribute('data-closure-highlight')==='true'`);await shot('05-restored-highlight.png');assert.equal((await http.detail(target.ticket.id)).status,'IN_PROGRESS');
   await clickWorkbenchControl(browser,card+' .card-open');await browser.waitFor("Boolean(document.querySelector('#detail-title'))");await open();await choose('NOT_IT_SCOPE');await clickWorkbenchControl(browser,'.detail-cancel-dialog input[value=OUT_OF_SCOPE_CONFIRMED]');await clickWorkbenchControl(browser,'.detail-cancel-dialog button[type=submit]');
   await browser.waitFor("!document.querySelector('.detail-cancel-dialog')&&document.querySelectorAll('[data-closure-history] [data-closure-record]').length===2");assert.equal(await browser.evaluate("document.querySelectorAll('[data-closure-restored-event]').length"),1);await shot('06-history.png');
   await clickWorkbenchControl(browser,'[aria-label="关闭详情"]');await browser.command('Page.navigate',{url:context.origin+'/workbench/app/?view=list&range=all'});await browser.waitFor("Boolean(document.querySelector('.ds-work-table'))");
   await browser.evaluate("(()=>{const group=[...document.querySelectorAll('[data-board-group]')].find(n=>n.getAttribute('data-board-group')==='已关闭'),b=group?.querySelector('button[aria-expanded]');if(b?.getAttribute('aria-expanded')==='false')b.click();})()");
   await browser.waitFor(`Boolean(document.querySelector(${JSON.stringify('.ds-work-row'+card+' [data-action=restore-closed]')}))`);assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify('.ds-work-row'+card+' [data-closure-reason]')}).title`),'非 IT 范围 · 其他部门职责');await clickWorkbenchControl(browser,'.ds-work-row'+card+' [data-action=restore-closed]');await browser.waitFor("Boolean(document.querySelector('[data-restore-confirmation]'))");await clickWorkbenchControl(browser,'[data-action=confirm-restore-closed]');await browser.waitFor(`document.querySelector(${JSON.stringify('.ds-work-row'+card)})?.getAttribute('data-column')==='active'`);
   assert.equal((await http.detail(target.ticket.id)).status,'IN_PROGRESS');
   const receipt={directory:evidence,environment:{platform:process.platform,dpr:1,zoom:1},metrics,shots,real_sends:0};await writeFile(join(evidence,'receipt.json'),JSON.stringify(receipt,null,2));console.log('CARD27CB_BROWSER '+JSON.stringify(receipt));
  });
 },{closureUi:true});
});

test('Card 27C-B lost restore response keeps its original UUID across reload and uses only the safe receipt GET',{timeout:120000},async()=>{
 await withT10Fixture(async context=>{
  const target=context.tickets[0];assert.ok(target);const http=await t11Http(context,2,{closeConnections:true}),before=await http.start(target.ticket.id);
  const closed=await http.post(target.ticket.id,'dismiss',{client_command_id:randomUUID(),expected_version:before.version,reason_code:'OTHER',note:'恢复核对（合成）'});assert.equal(closed.status,200);
  const path='/api/tickets/'+target.ticket.id+'/restore',requests:{method:string;path:string}[]=[];const observe=(request:IncomingMessage)=>{if(request.url?.startsWith(path))requests.push({method:request.method??'',path:request.url});};context.runtime.server.on('request',observe);
  try{await withT10Browser(context,target.ticket.id,2,'CARD27CB_RESTORE_UNKNOWN',async(browser,capture)=>{
   await browser.command('Page.bringToFront');await browser.waitFor("document.querySelector('.ds-next-step [data-action=restore-closed]')?.disabled===false");await clickWorkbenchControl(browser,'.ds-next-step [data-action=restore-closed]');await browser.waitFor("Boolean(document.querySelector('[data-restore-confirmation]'))");
   // 「其他」 closed without notifying: the restore confirmation says nothing will be sent.
   await browser.waitFor("document.querySelector('[data-restore-confirmation]').textContent.includes('关闭时未通知报修人，本次不发送')");
   await browser.evaluate(`(()=>{const original=fetch;globalThis.fetch=async(url,options)=>{const response=await original(url,options);if(String(url)===${JSON.stringify(path)}&&options?.method==='POST'&&response.status===200){globalThis.__restoreOriginal=JSON.parse(options.body);throw new TypeError('SYNTHETIC_RESTORE_RESPONSE_LOST');}return response;};})()`);
   await clickWorkbenchControl(browser,'[data-action=confirm-restore-closed]');await browser.waitFor("document.querySelector('[data-toast-source=closure-restore]')?.textContent.includes('结果未知')");
   const original=await browser.evaluate('globalThis.__restoreOriginal') as {client_command_id:string;expected_version:number};assert.equal(original.expected_version,before.version+1);assert.equal((await http.detail(target.ticket.id)).status,'IN_PROGRESS');assert.equal(requests.filter(row=>row.method==='POST').length,1);
   const unloading=browser.waitForEvent('Page.javascriptDialogOpening'),reloading=browser.command('Page.reload');void reloading.catch(()=>{});const dialog:unknown=await unloading;assert.ok(dialog&&typeof dialog==='object'&&'type' in dialog&&dialog.type==='beforeunload');await browser.command('Page.handleJavaScriptDialog',{accept:true});await reloading;await browser.waitFor("document.querySelector('[data-closure-history] [data-action=restore-closed]')?.textContent.includes('核对恢复')");await clickWorkbenchControl(browser,'[data-closure-history] [data-action=restore-closed]');await browser.waitFor("Boolean(document.querySelector('[data-action=check-restore-command]'))");
   assert.equal(await browser.evaluate('document.body.innerText.includes('+JSON.stringify(original.client_command_id)+')'),false);await clickWorkbenchControl(browser,'[data-action=check-restore-command]');await browser.waitFor("document.querySelector('[data-toast-source=closure-restore]')?.textContent.includes('已恢复')");
   // Recovery has no in-memory restore target; the confirmed item says where it went.
   assert.equal(await browser.evaluate("document.querySelector('[data-toast-source=closure-restore]').textContent.includes('已回到处理中')"),true);
   assert.deepEqual(requests,[{method:'POST',path},{method:'GET',path:path+'/commands/'+original.client_command_id}]);const after=await http.detail(target.ticket.id);assert.equal(after.version,before.version+2);assert.equal(after.assignee_id,before.assignee_id);await capture('new-detail-1920.png');
  });}finally{context.runtime.server.removeListener('request',observe);}
 },{closureUi:true});
});

test('Card 27C-B closing the dialog preserves the unsaved draft navigation fence and permits reopening its owner',{timeout:120000},async()=>{
 await withT10Fixture(async context=>{
  const target=context.tickets[0];assert.ok(target);const http=await t11Http(context,0),before=await http.detail(target.ticket.id);let posts=0;
  const observe=(request:IncomingMessage)=>{if(request.method==='POST'&&request.url==='/api/tickets/'+target.ticket.id+'/dismiss')posts++;};context.runtime.server.on('request',observe);
  try{await withT10Browser(context,target.ticket.id,0,'CARD27CB_UNSAVED_CLOSURE_FENCE',async(browser,capture)=>{
   await browser.command('Page.bringToFront');await browser.waitFor("document.querySelector('[data-action=cancel]')?.disabled===false");await clickWorkbenchControl(browser,'[data-action=cancel]');await browser.waitFor("document.querySelector('[data-waiting-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
   await browser.evaluate("(()=>{const original=crypto.subtle.encrypt.bind(crypto.subtle);const gate=new Promise(resolve=>globalThis.__releaseClosureEncryption=resolve);crypto.subtle.encrypt=async(...args)=>{globalThis.__closureEncryptionWaiting=true;await gate;return original(...args);};})()");
   await clickWorkbenchControl(browser,'.detail-cancel-dialog input[value=OTHER]');await browser.evaluate(fillWaiting('.detail-cancel-dialog textarea','尚未保存的关闭说明（合成）'));await browser.waitFor('globalThis.__closureEncryptionWaiting===true');
   await clickWorkbenchControl(browser,'[aria-label="关闭取消窗口"]');await browser.waitFor("!document.querySelector('.detail-cancel-dialog')");assert.equal(await browser.evaluate("document.querySelector('.nav-item.current').getAttribute('aria-disabled')"),'true');
   await browser.waitFor("document.querySelector('[data-action=cancel]')?.disabled===false");await clickWorkbenchControl(browser,'[data-action=cancel]');await browser.waitFor("document.querySelector('.detail-cancel-dialog textarea')?.value==='尚未保存的关闭说明（合成）'");
   await browser.evaluate('globalThis.__releaseClosureEncryption()');await browser.waitFor("document.querySelector('[data-waiting-draft-status]')?.textContent.includes('已保存恢复副本')");
   await clickWorkbenchControl(browser,'[aria-label="关闭取消窗口"]');await browser.waitFor("!document.querySelector('.detail-cancel-dialog')&&document.querySelector('.nav-item.current').getAttribute('aria-disabled')==='false'");assert.equal(posts,0);assert.equal((await http.detail(target.ticket.id)).version,before.version);await capture('new-detail-1920.png');
  });}finally{context.runtime.server.removeListener('request',observe);}
 },{closureUi:true});
});
