import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile,rmdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withT11Fixture,t11Http} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {object} from './helpers/t42-board-browser-fixture.mjs';

test('T42 board completion and independent staff reopen each require their original explicit form and official successful movement',{timeout:240000},async()=>{
 await withT11Fixture(async f=>{
  await f.runtime.stop();
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,listenPort:Number(new URL(f.origin).port),
   principalIds:[f.principals[0]?.id??'',f.outsider.id,f.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,workbenchBoardActionsEnabled:true});
  if('disabled' in runtime)throw Error('T42_LIFECYCLE_RUNTIME_DISABLED');
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);let browser:Awaited<ReturnType<typeof launchSystemBrowser>>|undefined,error:unknown;
  const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];
  const capture=async()=>{assert.ok(browser);const b=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,b);screenshots.push({file,width:b.readUInt32BE(16),height:b.readUInt32BE(20),sha256:createHash('sha256').update(b).digest('hex')});};
  try{
   const started=await runtime.start();assert.ok(started.cookies);const current={...f,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value),browserCookies:started.cookies};
   const http=await t11Http(current,2),cookie=started.cookies[2],known=f.tickets[0];assert.ok(cookie&&typeof cookie.url==='string'&&known);
   const principal=object(await (await http.get('/api/lifecycle/bootstrap')).json());assert.deepEqual(principal.roles,['HANDLER']);
   const active=await http.start(known.ticket.id);assert.equal(active.status,'IN_PROGRESS');const card='[data-kind="ticket"][data-item-id="'+known.ticket.id+'"]';
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',width:1920,height:1080,cookies:[{...cookie,url:cookie.url}]});assert.ok(browser);
   await browser.waitFor(`Boolean(document.querySelector('.board-column.active '+${JSON.stringify(card)}))`);
   assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('script[type=module][src]')).some(script=>new URL(script.src).pathname.startsWith('/workbench/app/assets/'))"),true);
   await browser.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t42LifecycleWrites=[];globalThis.__t42LifecycleResponses=[];globalThis.fetch=async(path,options)=>{if(options?.method==='POST')globalThis.__t42LifecycleWrites.push({path:String(path),body:JSON.parse(options.body)});const response=await original(path,options);if(options?.method==='POST')globalThis.__t42LifecycleResponses.push({path:String(path),status:response.status});return response;};})()");
   await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=closed]')}).click()`);
   await browser.waitFor("Boolean(document.querySelector('.detail-dialog #completion-process'))");await browser.evaluate("(()=>{const panel=document.querySelector('.detail-workflows');if(panel&&!panel.hasAttribute('data-expanded'))panel.querySelector('.workbench-disclosure-trigger').click();})()");await browser.waitFor("document.querySelector('.detail-dialog #completion-process')?.checkVisibility()===true");
   assert.deepEqual(await browser.evaluate('globalThis.__t42LifecycleWrites'),[]);assert.equal(await browser.evaluate("document.querySelector('[data-action=complete-ticket]')?.disabled"),true);assert.equal((await http.detail(known.ticket.id)).status,'IN_PROGRESS');
   await browser.evaluate("document.querySelector('#completion-process').focus()");await browser.command('Input.insertText',{text:'T42合成内部排查过程，不能作为外发摘要。'});
   await browser.evaluate("document.querySelector('#completion-summary').focus()");await browser.command('Input.insertText',{text:'合成设备服务已恢复。'});await browser.evaluate("document.querySelector('#completion-confirmed').click()");
   await browser.waitFor("document.querySelector('[data-action=complete-ticket]')?.disabled===false");await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");
   await browser.waitFor("globalThis.__t42LifecycleResponses.some(row=>row.path.endsWith('/complete')&&row.status===200)");
   await browser.waitFor(`Boolean(document.querySelector('.board-column.closed '+${JSON.stringify(card)}))&&!document.querySelector('.board-column.active '+${JSON.stringify(card)})`);
   await browser.waitFor("document.querySelector('[data-board-intent-panel] h3')?.textContent==='官方已显示：已关闭'");
   const closed=await http.detail(known.ticket.id);assert.equal(closed.status,'CLOSED');assert.equal(closed.assignee_id,f.principals[1]?.id);
   const completedWrites=await browser.evaluate('globalThis.__t42LifecycleWrites');assert.ok(Array.isArray(completedWrites));assert.equal(completedWrites.length,1);const complete=object(object(completedWrites[0]).body);
   assert.equal(complete.internal_process,'T42合成内部排查过程，不能作为外发摘要。');assert.equal(complete.external_summary,'合成设备服务已恢复。');assert.equal(complete.external_summary_confirmed,true);assert.equal(complete.reason_code,'STAFF_COMPLETED');assert.equal(complete.expected_version,active.version);
   await browser.waitFor("document.querySelector('button[aria-label=关闭详情]')?.disabled===false");await browser.evaluate("document.querySelector('button[aria-label=关闭详情]').click()");
   await browser.waitFor("!document.querySelector('.detail-dialog')");
   await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-action=board-action-menu]')}).click()`);await browser.evaluate(`document.querySelector(${JSON.stringify(card+' [data-board-action-target=pending]')}).click()`);
   await browser.waitFor("Boolean(document.querySelector('.detail-dialog #reopen-reason'))");
   await browser.evaluate("(()=>{const panel=document.querySelector('.detail-workflows');if(panel&&!panel.hasAttribute('data-expanded'))panel.querySelector('.workbench-disclosure-trigger').click();})()");
   assert.equal(await browser.evaluate('globalThis.__t42LifecycleWrites.length'),1);assert.equal(await browser.evaluate("document.querySelector('[data-action=reopen-ticket]')?.disabled"),true);assert.equal((await http.detail(known.ticket.id)).status,'CLOSED');
   await browser.evaluate("document.querySelector('#reopen-reason').focus()");await browser.command('Input.insertText',{text:'工作人员核实同一故障仍需处理。'});
   await browser.waitFor("document.querySelector('[data-action=reopen-ticket]')?.disabled===false");await browser.evaluate("document.querySelector('[data-action=reopen-ticket]').click()");
   await browser.waitFor("globalThis.__t42LifecycleResponses.some(row=>row.path.endsWith('/reopen')&&row.status===200)");
   await browser.waitFor(`Boolean(document.querySelector('.board-column.pending '+${JSON.stringify(card)}))&&!document.querySelector('.board-column.closed '+${JSON.stringify(card)})`);
   await browser.waitFor("document.querySelector('[data-board-intent-panel] h3')?.textContent==='官方已显示：待受理'");
   assert.equal(await browser.evaluate("document.querySelector('[data-board-intent-panel]').textContent.includes('请完成合法表单')"),false);
   const reopened=await http.detail(known.ticket.id);assert.equal(reopened.status,'REOPENED');assert.equal(reopened.assignee_id,null);assert.equal(reopened.resolver_team_id,closed.resolver_team_id);assert.equal(reopened.ticket_no,closed.ticket_no);assert.equal(reopened.handling_cycle?.cycle_no,2);
   const writes=await browser.evaluate('globalThis.__t42LifecycleWrites');assert.ok(Array.isArray(writes));assert.equal(writes.length,2);const last=object(writes[1]),body=object(last.body);
   assert.equal(last.path,'/api/tickets/'+known.ticket.id+'/reopen');assert.equal(body.reason_code,'STAFF_REOPEN');assert.equal(body.note,'工作人员核实同一故障仍需处理。');assert.equal(body.expected_version,closed.version);assert.notEqual(body.client_command_id,complete.client_command_id);
   assert.ok(writes.every(row=>!String(object(row).path).includes('/feedback')),'staff board reopen must never borrow member feedback authority');await capture();
  }catch(failure){error=failure;if(browser)await capture().catch(captureError=>{error=new AggregateError([failure,captureError],'T42_LIFECYCLE_AND_CAPTURE_FAILED');});}
  console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',t42_completion_and_staff_reopen:true,screenshots}));
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);},async()=>{if(!screenshots.length)await rmdir(directory);}],error);
 });
});
