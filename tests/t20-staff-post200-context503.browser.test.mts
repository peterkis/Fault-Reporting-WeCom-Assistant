// SOURCE_ONLY_DRAFT / NOT_REGISTERED / NOT_BUILT / NOT_RUN.
// Intended tests/ placement; existing relative .mjs imports and original 240s host retained.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

test('production HANDLER retains original reopen UUID when a delivered POST200 is followed by a context GET503', {timeout:240_000},async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
   listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,
   ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,workbenchDraftRecoveryEnabled:false});
  if('disabled' in runtime)throw Error('T20_LIFECYCLE_RUNTIME_DISABLED');let tab:Browser|undefined,error:unknown;
  const directory=join(tmpdir(),'t20-post200-context503-'+randomUUID());await mkdir(directory);
  try{
   const started=await runtime.start();assert.ok(started.cookies);const current={...context,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value)};
   const http=await t11Http(current,2),bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {roles:string[];ticket_reopen_draft_recovery_enabled:boolean};
   assert.deepEqual(bootstrap.roles,['HANDLER']);assert.equal(bootstrap.ticket_reopen_draft_recovery_enabled,false);
   const ticketId=await t11NewTicket(current),active=await http.start(ticketId);assert.equal((await http.post(ticketId,'complete',http.command(active))).status,200);
   const closed=await http.detail(ticketId),cookie=started.cookies[2];assert.ok(cookie);assert.equal(closed.status,'CLOSED');assert.equal(typeof cookie.url,'string');
   tab=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url as string}]});assert.ok(tab);
   await tab.waitFor("document.querySelector('.ticket-reopen')?.textContent.includes('工单版本')&&!document.querySelector('.ticket-reopen')?.textContent.includes('正在读取重开权限')");
   const ticketPath='/api/tickets/'+ticketId;
   // Existing native-CDP/fetch tracer: real POST is never mocked/lost; one later read fault is controlled.
   await tab.evaluate(`(()=>{const original=globalThis.fetch;globalThis.__t20Posts=[];globalThis.__t20Reads=[];globalThis.__t20Faults=[];let afterPost=false,injected=false;
    globalThis.fetch=async(path,options)=>{const target=String(path);if(options?.method==='POST'){const response=await original(path,options);const body=await response.clone().json();globalThis.__t20Posts.push({path:target,input:JSON.parse(options.body),status:response.status,response:body});if(target===${JSON.stringify(ticketPath+'/reopen')}&&response.status===200)afterPost=true;return response;}
     const response=await original(path,options);globalThis.__t20Reads.push({path:target,status:response.status,...(target.includes('/reopen/commands/')?{state:(await response.clone().json()).state}:{})});
     if(afterPost&&!injected&&target===${JSON.stringify(ticketPath)}){injected=true;const body={error:{code:'P2_016_ACTION_FAILED',retryable:true}};globalThis.__t20Faults.push({path:target,actual_http_status:response.status,injected_client_status:503,body});return new Response(JSON.stringify(body),{status:503,headers:{'content-type':'application/json'}});}return response;};})()`);
   await tab.evaluate("(()=>{const input=document.querySelector('#reopen-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'已核实同一故障仍需要工作人员处理');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
   await tab.evaluate("document.querySelector('[data-action=reopen-ticket]').click()");
   await tab.waitFor('globalThis.__t20Posts.length===1&&globalThis.__t20Faults.length===1');
   const posts=await tab.evaluate('globalThis.__t20Posts') as {path:string;input:{client_command_id:string;expected_version:number};status:number;response:{ticket_version:number}}[];
   const original=posts[0];assert.ok(original);assert.equal(original.path,ticketPath+'/reopen');assert.equal(original.status,200);assert.equal(original.input.expected_version,closed.version);assert.equal(original.response.ticket_version,closed.version+1);
   await writeFile(join(directory,'original-post-observation.json'),JSON.stringify(posts,null,2));
   await writeFile(join(directory,'controlled-context-read-fault.json'),JSON.stringify(await tab.evaluate('globalThis.__t20Faults'),null,2));
   const reopened=await http.detail(ticketId);assert.equal(reopened.status,'REOPENED');assert.equal(reopened.handling_cycle?.cycle_no,2);assert.equal(reopened.ticket_no,closed.ticket_no);
   // First product RED: source15306 instead reports denied and discards its sole in-memory UUID.
   await tab.waitFor("Boolean(document.querySelector('[data-reopen-state]'))&&!document.querySelector('[data-reopen-state]')?.textContent.includes('正在提交')");
   assert.equal(await tab.evaluate("document.querySelector('[data-reopen-state]')?.textContent.includes('结果未知')"),true,'a later GET503 cannot turn a delivered POST200 into a known refusal');
   assert.equal(await tab.evaluate("Boolean(document.querySelector('[data-action=check-reopen-command]'))"),true,'post-success read failure must retain the original read-only UUID control');
   assert.equal(await tab.evaluate("(()=>{const button=document.querySelector('[data-action=reopen-ticket]');return !button||button.disabled;})()"),true,'a read failure cannot allow a fresh command');
   assert.equal(await tab.evaluate('globalThis.__t20Posts.length'),1);
   await tab.evaluate("document.querySelector('[data-action=check-reopen-command]').click()");
   await tab.waitFor(`globalThis.__t20Reads.some(row=>row.path===${JSON.stringify(ticketPath+'/reopen/commands/'+original.input.client_command_id)}&&row.status===200&&row.state==='COMMITTED')&&document.querySelector('[data-reopen-follow-up]')?.checkVisibility()===true&&document.querySelector('.ticket-handling-cycle')?.textContent.includes('处理轮次 2')&&!document.querySelector('[data-action=check-reopen-command]')`);
   assert.equal(await tab.evaluate(`globalThis.__t20Reads.some(value=>value.path===${JSON.stringify(ticketPath+'/reopen/commands/'+original.input.client_command_id)})`),true);
   assert.equal(await tab.evaluate('globalThis.__t20Posts.length'),1,'explicit acknowledgement is GET-only; never a resend or fresh POST');
   const final=await http.detail(ticketId);assert.equal(final.handling_cycle?.id,reopened.handling_cycle?.id);assert.equal(final.version,reopened.version);assert.equal(final.assignee_id,null);
   await writeFile(join(directory,'terminal.png'),Buffer.from(await tab.screenshot(),'base64'));
  }catch(failure){error=failure;try{if(tab){await writeFile(join(directory,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await tab.evaluate('({text:document.body.innerText,posts:globalThis.__t20Posts,reads:globalThis.__t20Reads,faults:globalThis.__t20Faults})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);
 });
});
