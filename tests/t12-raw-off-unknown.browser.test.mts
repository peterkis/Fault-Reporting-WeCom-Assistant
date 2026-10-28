import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withT12Profile} from './helpers/t12-profile-fixture.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function input(browser:Browser,selector:string,value:string){await browser.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));})()`);}

test('raw-off UNKNOWN retains the original capture and mounted controller but its check control never forwards another POST after a genuinely committed lost ACK',async()=>{
 await withT12Profile(async f=>{
  const s=await acceptedSetup(f);assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_RAW_OFF_START'})).status,200);
  const initial=(await s.b.get(s.path)).value,cookie=f.browserCookies[2];assert.ok(cookie);assert.equal((await s.b.get('/api/lifecycle/bootstrap')).value.ticket_takeover_completion_draft_recovery_enabled,false);
  const network:{method:string;path:string;idempotency:string|null}[]= [];let drop=true;
  const intercept=(request:IncomingMessage,response:ServerResponse)=>{if(!request.headers.cookie?.includes(cookie.name+'='+cookie.value))return;const path=new URL(request.url??'/',f.origin).pathname;network.push({method:request.method??'',path,idempotency:typeof request.headers['idempotency-key']==='string'?request.headers['idempotency-key']:null});if(drop&&request.method==='POST'&&path===s.path+'/takeover-and-complete'){const end=response.end.bind(response);response.end=((...args:Parameters<ServerResponse['end']>)=>response.statusCode===200?end('{"ok":true}'):end(...args)) as ServerResponse['end'];}};
  const directory=join(tmpdir(),'t12-raw-off-'+randomUUID());await mkdir(directory);let browser:Browser|undefined,primary:unknown;const screenshots:{file:string;sha256:string}[]=[];
  f.runtime.server.on('request',intercept);
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+s.first.ticket.id,width:1280,height:900,cookies:[{...cookie,url:text(cookie.url)}]});assert.ok(browser);
   await browser.waitFor("document.querySelector('.ticket-takeover-completion select')?.options.length>2&&document.querySelector('.ticket-takeover-completion select').disabled===false");
   await browser.evaluate("(()=>{globalThis.__t12Posts=[];const original=fetch;globalThis.fetch=(path,options)=>{if(options?.method==='POST')globalThis.__t12Posts.push({path:String(path),body:JSON.parse(options.body)});return original(path,options);};const element=document.querySelector('.ticket-takeover-completion select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,'T07_NETWORK');element.dispatchEvent(new Event('change',{bubbles:true}));})()");
   await browser.waitFor("document.querySelector('.ticket-takeover-completion input[value=RETAIN_CURRENT]')?.disabled===false");await browser.evaluate("document.querySelector('.ticket-takeover-completion input[value=RETAIN_CURRENT]').click()");
   await input(browser,'#takeover-completion-process','T12_RAW_OFF_CAPTURE_CANARY');await input(browser,'#takeover-completion-summary','服务恢复，合成结果。');await browser.waitFor("document.querySelector('#takeover-completion-confirmed').disabled===false");await browser.evaluate("document.querySelector('#takeover-completion-confirmed').click()");
   await browser.waitFor("document.querySelector('[data-action=takeover-and-complete]').disabled===false");await browser.evaluate("document.querySelector('[data-action=takeover-and-complete]').click()");
   await browser.waitFor("document.querySelector('[data-toast-source=ticket-takeover-completion]')?.innerText.includes('结果未知')&&Boolean(document.querySelector('[data-action=check-takeover-completion]'))");
   const posts=rows(await browser.evaluate('globalThis.__t12Posts'));assert.equal(posts.length,1);const original=object(posts[0]?.body);assert.equal(original.expected_version,initial.version);assert.equal(original.handling_cycle_id,object(initial.handling_cycle).id);
   const closed=await s.b.get(s.path);assert.equal(closed.status,200);assert.equal(closed.value.status,'CLOSED');assert.equal(closed.value.version,version(initial.version)+2);
   assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid',[s.first.ticket.id])).rows[0]?.n,1);
   drop=false;
   // This profile disables notes and keeps workflow refresh controls hidden in
   // UNKNOWN. Use the current public board READ and the original browser's Ticket
   // READ; neither is allowed to replace its mounted private command capture.
   await browser.evaluate("(()=>{globalThis.__t12Mounted=document.querySelector('.ticket-takeover-completion');const button=[...document.querySelectorAll('.tools button')].find(button=>button.textContent.includes('刷新'));if(!button)throw Error('T12_PUBLIC_BOARD_REFRESH_REQUIRED');button.click();})()");
   const browserCurrent=object(await browser.evaluate(`(async()=>{const response=await fetch(${JSON.stringify(s.path)});const value=await response.json();return {status:response.status,ticket_status:value.status,version:value.version};})()`));
   assert.deepEqual(browserCurrent,{status:200,ticket_status:'CLOSED',version:version(initial.version)+2});
   assert.equal(await browser.evaluate("document.querySelector('.ticket-takeover-completion')===globalThis.__t12Mounted"),true);
   assert.deepEqual(object(rows(await browser.evaluate('globalThis.__t12Posts'))[0]?.body),original,'a current CLOSED fact must not replace the original UUID, version, round or private capture');
   assert.equal(await browser.evaluate("document.querySelector('#takeover-completion-process').value"),'T12_RAW_OFF_CAPTURE_CANARY');assert.equal(await browser.evaluate("document.querySelector('[data-action=takeover-and-complete]').disabled"),true);
   assert.equal(await browser.evaluate("document.querySelector('[data-action=check-takeover-completion]').disabled"),true);
   await browser.evaluate("document.querySelector('[data-action=check-takeover-completion]').click()");
   await browser.waitFor("globalThis.__t12Posts.length>1||document.querySelector('[data-action=check-takeover-completion]')?.disabled===true");
   assert.equal(rows(await browser.evaluate('globalThis.__t12Posts')).length,1,'checking an UNKNOWN is never a business POST, even with the same original UUID');
   assert.equal(network.filter(row=>row.method==='POST'&&row.path===s.path+'/takeover-and-complete').length,1);
   assert.equal(await browser.evaluate("document.querySelector('#takeover-completion-process').value"),'T12_RAW_OFF_CAPTURE_CANARY');assert.ok(await browser.evaluate("document.querySelector('[data-toast-source=ticket-takeover-completion]')?.innerText.includes('核对')&&document.querySelector('[data-toast-source=ticket-takeover-completion]')?.innerText.includes('关闭')"));
   assert.deepEqual((await s.b.get(s.path)).value,closed.value);
  }catch(error){primary=error;}
  await closeBrowserTestResources([async()=>{if(browser){await browser.evaluate("document.querySelector('.ticket-takeover-completion')?.scrollIntoView({block:'center'})");const bytes=Buffer.from(text(await browser.screenshot()),'base64'),file=join(directory,primary?'failure.png':'raw-off-unknown.png');await writeFile(file,bytes);screenshots.push({file:file.replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex')});await writeFile(join(directory,'page.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,posts:globalThis.__t12Posts})')));}},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{f.runtime.server.removeListener('request',intercept);assert.equal((await f.runtime.observability.metrics()).sse_clients,0);const file=join(directory,'receipt.json');await writeFile(file,JSON.stringify({network,screenshots,primary_failure:primary instanceof Error?primary.message:null}));console.log('T12_RAW_OFF_DIAGNOSTIC '+JSON.stringify({file:file.replaceAll('\\','/'),screenshots}));}],primary);
 },{recoveryEnabled:false});
});
