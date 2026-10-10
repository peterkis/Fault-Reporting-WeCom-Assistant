import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {t20Object} from './helpers/t20-feedback-fixture.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
function errorFacts(value:unknown):unknown{return value instanceof Error?{name:value.name,message:value.message,stack:value.stack,...(value instanceof AggregateError?{errors:value.errors.map(errorFacts)}:{})}:value===null?null:String(value);}

test('production PC reminds its currently authorized previous HANDLER after a genuine shared round while retaining the group and no owner',async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true});
  if('disabled' in runtime)throw Error('T20_HINT_RUNTIME_DISABLED');let tab:Browser|undefined,error:unknown;const directory=join(tmpdir(),'t20-staff-hint-browser-'+randomUUID());await mkdir(directory);
  try{
   const started=await runtime.start();assert.ok(started.cookies);const current={...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)},http=await t11Http(current,2);
   assert.deepEqual(t20Object(await (await http.get('/api/lifecycle/bootstrap')).json()).roles,['HANDLER']);
   const ticketId=await t11NewTicket(current),active=await http.start(ticketId);assert.equal((await http.post(ticketId,'complete',http.command(active))).status,200);const closed=await http.detail(ticketId);
   const cookie=started.cookies[2];assert.ok(cookie);assert.equal(typeof cookie.url,'string');tab=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url as string}]});assert.ok(tab);
   await tab.waitFor("document.querySelector('#detail-title')&&document.querySelector('.properties')?.textContent.includes('已关闭')");
   const posted=await http.post(ticketId,'reopen',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'STAFF_REOPEN',note:'上轮人员核实仍需重新承接'});assert.equal(posted.status,200);
   const fresh=t20Object(await (await http.get('/api/tickets/'+ticketId)).json());assert.deepEqual(fresh.reopen_follow_up,{origin:'STAFF',is_previous_handler:true,awaiting_acceptance:true});assert.equal(fresh.assignee_id,null);assert.equal(fresh.resolver_team_id,closed.resolver_team_id);
   // Realtime is intentionally off: a public reload rereads current detail rather than waiting for an unsolicited refresh.
   const previous=await tab.evaluate('performance.timeOrigin');await tab.command('Page.enable');await tab.command('Page.reload');await tab.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
   await tab.waitFor("document.querySelector('#detail-title')&&document.querySelector('.properties')?.textContent.includes('重新')");
   assert.equal(await tab.evaluate("Boolean(document.querySelector('[data-reopen-follow-up]'))"),true,'current authorized previous-handler fact must be consumed by the production PC');
   assert.equal(await tab.evaluate("document.querySelector('[data-reopen-follow-up]')?.textContent.includes('上轮由您处理')&&document.querySelector('[data-reopen-follow-up]')?.textContent.includes('等待重新承接')"),true);
   const after=await http.detail(ticketId);assert.equal(after.version,closed.version+1);assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,closed.resolver_team_id);
   const png=Buffer.from(await tab.screenshot(),'base64');await writeFile(join(directory,'authorized-previous-handler-1920.png'),png);console.log('T20_PC_HINT_FIRST '+JSON.stringify({directory,role:'HANDLER',production_asset:true,real_http_pg:true,external_calls:0,png:[{file:join(directory,'authorized-previous-handler-1920.png'),sha256:createHash('sha256').update(png).digest('hex')}]}));
  }catch(failure){error=failure;await writeFile(join(directory,'primary-error.json'),JSON.stringify(errorFacts(failure)));if(tab){try{await writeFile(join(directory,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await tab.evaluate('({text:document.body.innerText,path:location.pathname})')));}catch(observation){await writeFile(join(directory,'observer-error.json'),JSON.stringify(errorFacts(observation)));error=new AggregateError([failure,observation],'T20_HINT_FAILURE_OBSERVATION_FAILED');}}}
  try{await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);}catch(failure){await writeFile(join(directory,'terminal-error-and-cleanup.json'),JSON.stringify({primary:errorFacts(error??null),terminal:errorFacts(failure),browser:tab?.ownedResourceState()??null}));console.error('T20_HINT_FAILURE_POINTER '+directory);throw failure;}
 });
});
