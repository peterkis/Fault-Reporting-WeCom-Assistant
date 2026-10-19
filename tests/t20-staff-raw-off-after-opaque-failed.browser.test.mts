// SOURCE_ONLY_DRAFT / NOT_REGISTERED / NOT_BUILT / NOT_RUN.
// Intended tests/ placement; same profile, real FAILED receipt and original 240s host.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {browser} from './helpers/yxx-ss-009-http-fixture.mjs';
import type {P2016TicketDetail} from '../contracts/p2_016_contracts.js';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;

test('production HANDLER raw OFF settles an old opaque FAILED UUID then never writes a new sensitive recovery copy',{timeout:240_000},async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();
  const runtimeFor=(raw:boolean)=>{
   const value=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
    listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,
    ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:raw});
   if('disabled' in value)throw Error('T20_LIFECYCLE_RUNTIME_DISABLED');return value;
  };
  let runtime=runtimeFor(true),tab:Browser|undefined,error:unknown;
  const directory=join(tmpdir(),'t20-raw-off-opaque-failed-'+randomUUID());await mkdir(directory);
  try{
   const started=await runtime.start();assert.ok(started.cookies);const current={...context,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value)};
   const http=await t11Http(current,2),bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {roles:string[];principal_id:string;ticket_reopen_draft_recovery_enabled:boolean};
   assert.deepEqual(bootstrap.roles,['HANDLER']);assert.equal(bootstrap.ticket_reopen_draft_recovery_enabled,true);
   const ticketId=await t11NewTicket(current),active=await http.start(ticketId);assert.equal((await http.post(ticketId,'complete',http.command(active))).status,200);
   const closed=await http.detail(ticketId),cookie=started.cookies[2];assert.ok(cookie);assert.equal(closed.status,'CLOSED');assert.equal(typeof cookie.url,'string');
   const ticketPath='/api/tickets/'+ticketId,scope=JSON.stringify([bootstrap.principal_id,'ticket',ticketId,'staff-reopen']);
   tab=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+ticketId,width:1920,height:1080,cookies:[{...cookie,url:cookie.url as string}]});assert.ok(tab);
   await tab.waitFor("document.querySelector('.ticket-reopen')?.textContent.includes('工单版本')&&document.querySelector('#reopen-reason')?.matches(':disabled')===false");
   const observe=String.raw`(()=>{const original=globalThis.fetch;globalThis.__t20Posts=[];globalThis.__t20Reads=[];globalThis.fetch=async(path,options)=>{const target=String(path);if(options?.method==='POST'){const response=await original(path,options);const body=await response.clone().json();globalThis.__t20Posts.push({path:target,input:JSON.parse(options.body),status:response.status,response:body});if(target.endsWith('/reopen'))throw new TypeError('SIMULATED_KNOWN_REFUSAL_RESPONSE_LOSS');return response;}globalThis.__t20Reads.push(target);return original(path,options);};})()`;
   await tab.evaluate(observe);
   // Real public concurrent note increments version while keeping CLOSED; no receipt/SQL seeding.
   const note=await http.post(ticketId,'internal-notes',{client_command_id:randomUUID(),expected_version:closed.version,reason_code:'LIFECYCLE_RACE',note:'合成同时协作备注，仅推进工单版本',external_visible:false});
   assert.equal(note.status,200,await note.clone().text());const changed=await http.detail(ticketId);assert.equal(changed.status,'CLOSED');assert.equal(changed.version,closed.version+1);
   await tab.evaluate("(()=>{const input=document.querySelector('#reopen-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'原工作人员重开原因');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
   await tab.evaluate("document.querySelector('[data-action=reopen-ticket]').click()");
   await tab.waitFor("globalThis.__t20Posts.length===1&&document.querySelector('[data-reopen-state]')?.textContent.includes('结果未知')");
   const observations=await tab.evaluate('globalThis.__t20Posts') as {path:string;input:{client_command_id:string;expected_version:number};status:number;response:{ok:boolean;error:{code:string;retryable:boolean}}}[];
   const original=observations[0];assert.ok(original);assert.equal(original.path,ticketPath+'/reopen');assert.equal(original.input.expected_version,closed.version);assert.equal(original.status,409);assert.equal(original.response.ok,false);assert.equal(original.response.error.retryable,false);
   await writeFile(join(directory,'original-failed-post-observation.json'),JSON.stringify(observations,null,2));
   const failed=await http.get(ticketPath+'/reopen/commands/'+original.input.client_command_id);assert.equal(failed.status,200);const receipt=await failed.json() as {state:string;client_command_id:string};assert.equal(receipt.state,'FAILED');assert.equal(receipt.client_command_id,original.input.client_command_id);
   await writeFile(join(directory,'real-failed-purpose-receipt.json'),JSON.stringify(receipt,null,2));
   // Reuse one browser profile/origin; single App is stopped before the raw-OFF App starts.
   await runtime.stop();assert.equal(runtime.server.listening,false);runtime=runtimeFor(false);
   const offStarted=await runtime.start();assert.ok(offStarted.cookies);assert.equal(runtime.server.listening,true);const address=runtime.server.address();assert.ok(address&&typeof address==='object');assert.equal(address.port,Number(new URL(context.origin).port));
   const native=browser(runtime.server),nativeCookie=offStarted.cookies[2];assert.ok(nativeCookie);native.cookies.set(nativeCookie.name,nativeCookie.value);
   const bootstrapResponse=await native.request('/api/lifecycle/bootstrap');assert.equal(bootstrapResponse.status,200);const offBootstrap=bootstrapResponse.json() as {roles:string[];principal_id:string;ticket_reopen_rounds_enabled:boolean;ticket_reopen_draft_recovery_enabled:boolean};
   assert.deepEqual(offBootstrap.roles,['HANDLER']);assert.equal(offBootstrap.principal_id,bootstrap.principal_id);assert.equal(offBootstrap.ticket_reopen_rounds_enabled,true);assert.equal(offBootstrap.ticket_reopen_draft_recovery_enabled,false);
   const offCookie=offStarted.cookies[2];assert.ok(offCookie);assert.equal(typeof offCookie.url,'string');
   await tab.command('Network.setCookies',{cookies:[{...offCookie,url:offCookie.url as string}]});
   await tab.command('Page.enable');await tab.command('Page.addScriptToEvaluateOnNewDocument',{source:observe});
   const previous=await tab.evaluate('performance.timeOrigin');await tab.command('Page.reload');await tab.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);
   await tab.waitFor("Boolean(document.querySelector('[data-action=check-reopen-command]'))&&document.querySelector('[data-action=check-reopen-command]')?.disabled===false");
   assert.equal(await tab.evaluate('globalThis.__t20Posts.length'),0,'raw-OFF restoration cannot POST');
   assert.equal(await tab.evaluate(`globalThis.__t20Reads.some(path=>path.startsWith(${JSON.stringify(ticketPath+'/reopen/commands/')}))`),false,'restoration does not automatically acknowledge the original UUID');
   const countsExpression=`new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onupgradeneeded=()=>request.transaction.abort();request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations'],'readonly'),draft=tx.objectStore('drafts').getKey(${JSON.stringify(scope)}),operation=tx.objectStore('operations').getKey(${JSON.stringify(scope)});tx.oncomplete=()=>{db.close();resolve({sensitive:draft.result===undefined?0:1,opaque:operation.result===undefined?0:1});};tx.onabort=()=>{db.close();reject(tx.error);};};})`;
   assert.deepEqual(await tab.evaluate(countsExpression),{sensitive:0,opaque:1});
   await tab.evaluate("document.querySelector('[data-action=check-reopen-command]').click()");
   await tab.waitFor("document.querySelector('[data-reopen-state]')?.textContent.includes('已核对原操作被拒绝')&&!document.querySelector('[data-action=check-reopen-command]')");
   assert.equal(await tab.evaluate(`globalThis.__t20Reads.includes(${JSON.stringify(ticketPath+'/reopen/commands/'+original.input.client_command_id)})`),true);
   assert.deepEqual(await tab.evaluate(countsExpression),{sensitive:0,opaque:0},'only explicit terminal FAILED acknowledgement settles the old operation');
   await tab.evaluate("(()=>{const input=document.querySelector('#reopen-reason');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'RAW_OFF_NEW_REASON_CANARY');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
   await tab.evaluate('new Promise(resolve=>setTimeout(resolve,650))'); // Existing 500ms autosave boundary, inside original 240s cap.
   // First product RED on15306: existing=true keeps new raw writes enabled after old settlement.
   const counts=await tab.evaluate(countsExpression);await writeFile(join(directory,'raw-off-new-input-store-counts.json'),JSON.stringify(counts));
   assert.deepEqual(counts,{sensitive:0,opaque:0},'raw-write OFF must stay OFF after an old opaque operation is settled');
   assert.equal(await tab.evaluate('globalThis.__t20Posts.length'),0,'new text alone is not a business command');
   const finalResponse=await native.request(ticketPath);assert.equal(finalResponse.status,200);const final=finalResponse.json() as P2016TicketDetail;assert.equal(final.status,'CLOSED');assert.equal(final.version,changed.version);assert.equal(final.handling_cycle?.id,changed.handling_cycle?.id);
   await writeFile(join(directory,'terminal.png'),Buffer.from(await tab.screenshot(),'base64'));
  }catch(failure){error=failure;try{if(tab){await writeFile(join(directory,'failure.png'),Buffer.from(await tab.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await tab.evaluate('({text:document.body.innerText,posts:globalThis.__t20Posts,reads:globalThis.__t20Reads})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await tab?.close();if(tab)assert.deepEqual(tab.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{await runtime.stop();assert.equal(runtime.server.listening,false);}],error);
 });
});
