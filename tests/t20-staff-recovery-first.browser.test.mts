import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

test('production PC HANDLER raw recovery retains the original STAFF_REOPEN across reload and only GETs its purpose result',async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
   listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,
   ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,workbenchDraftRecoveryEnabled:true});
  if('disabled' in runtime)throw Error('T20_PC_DISABLED');let tab:Browser|undefined,error:unknown;
  const directory=join(tmpdir(),'t20-staff-browser-'+randomUUID());await mkdir(directory);
  try{
   const started=await runtime.start();assert.ok(started.cookies);const current={...context,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value)};
   const http=await t11Http(current,2),bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {roles:string[]};assert.deepEqual(bootstrap.roles,['HANDLER']);
   const ticketId=await t11NewTicket(current),active=await http.start(ticketId);assert.equal((await http.post(ticketId,'complete',http.command(active))).status,200);const closed=await http.detail(ticketId);
   const cookie=started.cookies[2];assert.ok(cookie);assert.equal(typeof cookie.url,'string');
   tab=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url as string}]});assert.ok(tab);
   await tab.waitFor("document.querySelector('#detail-title')&&document.querySelector('.properties')?.textContent.includes('已关闭')");
   await tab.waitFor("document.querySelector('.ticket-reopen')?.textContent.includes('工单版本')&&!document.querySelector('.ticket-reopen')?.textContent.includes('正在读取重开权限')");
   assert.equal(await tab.evaluate("Boolean(document.querySelector('[data-action=reopen-ticket]'))"),true,'production PC must expose independent authorized staff reopen');
   await tab.evaluate("(()=>{const original=globalThis.fetch;globalThis.__t20Posts=[];globalThis.__t20Reads=[];globalThis.__t20Statuses=[];globalThis.__t20Responses=[];globalThis.fetch=async(path,options)=>{if(options?.method==='POST'){globalThis.__t20Posts.push({path:String(path),body:JSON.parse(options.body)});const response=await original(path,options);const text=await response.clone().text();globalThis.__t20Statuses.push({path:String(path),status:response.status});globalThis.__t20Responses.push({path:String(path),status:response.status,body:JSON.parse(text)});if(String(path).endsWith('/feedback')||String(path).endsWith('/reopen'))throw new TypeError('SIMULATED_COMMITTED_RESPONSE_LOSS');return response;}globalThis.__t20Reads.push(String(path));return original(path,options);};})()");
   await tab.evaluate("(()=>{const input=document.querySelector('#reopen-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'工作人员核实同一故障仍需处置');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
   const before=Buffer.from(await tab.screenshot(),'base64');await writeFile(join(directory,'staff-explicit-reopen-1920.png'),before);
   await tab.evaluate("document.querySelector('[data-action=reopen-ticket]').click()");
   await tab.waitFor("document.querySelector('[data-reopen-state]')?.textContent.includes('结果未知')");
   assert.equal(await tab.evaluate('globalThis.__t20Posts.length'),1);
   assert.deepEqual(await tab.evaluate('globalThis.__t20Statuses'),[{path:'/api/tickets/'+ticketId+'/reopen',status:200}]);
   await writeFile(join(directory,'original-post-observation.json'),JSON.stringify(await tab.evaluate('globalThis.__t20Responses')));
   const original=await tab.evaluate('globalThis.__t20Posts[0]') as {path:string;body:{client_command_id:string;expected_ticket_version?:number;expected_version?:number}};
   assert.equal(original.path,'/api/tickets/'+ticketId+'/reopen');
   assert.equal(original.body.expected_version,closed.version);
   await tab.command('Page.enable');await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:"(()=>{const original=globalThis.fetch;globalThis.__t20Posts=[];globalThis.__t20Reads=[];globalThis.__t20Statuses=[];globalThis.__t20Responses=[];globalThis.fetch=async(path,options)=>{if(options?.method==='POST'){globalThis.__t20Posts.push({path:String(path),body:JSON.parse(options.body)});const response=await original(path,options);const text=await response.clone().text();globalThis.__t20Statuses.push({path:String(path),status:response.status});globalThis.__t20Responses.push({path:String(path),status:response.status,body:JSON.parse(text)});if(String(path).endsWith('/feedback')||String(path).endsWith('/reopen'))throw new TypeError('SIMULATED_COMMITTED_RESPONSE_LOSS');return response;}globalThis.__t20Reads.push(String(path));return original(path,options);};})()"});
   const previous=await tab.evaluate('performance.timeOrigin');await tab.command('Page.reload');await tab.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
   await tab.waitFor("document.querySelector('.properties')?.textContent.includes('重新')&&document.querySelector('.ticket-reopen')?.textContent.includes('工单版本')&&!document.querySelector('.ticket-reopen')?.textContent.includes('正在读取重开权限')");
   await tab.waitFor("Boolean(document.querySelector('[data-action=check-reopen-command]'))||document.querySelector('[data-reopen-state]')?.textContent.includes('已核对')");
   assert.equal(await tab.evaluate("Boolean(document.querySelector('[data-action=check-reopen-command]'))||document.querySelector('[data-reopen-state]')?.textContent.includes('已核对')"),true,'same-browser raw recovery must preserve the original operation or an actually verified purpose result');
   if(await tab.evaluate("Boolean(document.querySelector('[data-action=check-reopen-command]'))"))await tab.evaluate("document.querySelector('[data-action=check-reopen-command]').click()");
   await tab.waitFor("document.querySelector('[data-reopen-state]')?.textContent.includes('已核对')");
   assert.equal(await tab.evaluate('globalThis.__t20Posts.length'),0,'reload and receipt recovery must not POST');
   assert.equal(await tab.evaluate(`globalThis.__t20Reads.includes(${JSON.stringify('/api/tickets/'+ticketId+'/reopen/commands/'+original.body.client_command_id)})`),true,'only the original actor/object/purpose/UUID is checked');
   assert.equal(await tab.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
   const fresh=await http.detail(ticketId);assert.equal(fresh.ticket_no,closed.ticket_no);assert.equal(fresh.assignee_id,null);assert.equal(fresh.status,'REOPENED');assert.equal(fresh.handling_cycle?.cycle_no,2);
   const after=Buffer.from(await tab.screenshot(),'base64');await writeFile(join(directory,'staff-new-round-1920.png'),after);
   console.log('T20_PC_RAW_FIRST '+JSON.stringify({directory,role:'HANDLER',production_asset:true,real_http_pg:true,external_calls:0,png:[{file:join(directory,'staff-explicit-reopen-1920.png'),sha256:createHash('sha256').update(before).digest('hex')},{file:join(directory,'staff-new-round-1920.png'),sha256:createHash('sha256').update(after).digest('hex')}]}));
  }catch(failure){error=failure;try{if(tab){await writeFile(join(directory,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await tab.evaluate('({text:document.body.innerText,path:location.pathname})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);
 });
});
