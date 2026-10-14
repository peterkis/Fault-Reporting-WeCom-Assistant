import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Cookie=NonNullable<Parameters<typeof launchSystemBrowser>[0]['cookies']>[number];
interface Fixture {runtime:P2016EnabledRuntime;principals:{id:string}[];pool:PostgresPool;origin:string;cookies:string[];browserCookies:Cookie[];tickets:{ticket:{id:string}}[];restoreFollowBootstrapResponses:()=>void;followBootstrapFaultState:()=>{committed_responses:number;failed_bootstrap_reads:number}}
async function screenshot(browser:Browser,directory:string,name:string){const file=join(directory,name),bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(file,bytes);console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));}

test('T34 a real committed POST followed by HTTP bootstrap503 preserves its UUID for read-only acknowledgement',{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const target=f.tickets[1],cookie=f.browserCookies[2];assert.ok(target&&cookie);const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+target.ticket.id,width:1920,height:1080,cookies:[cookie]});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector("[data-action=toggle-item-follow]")&&!document.querySelector("[data-action=toggle-item-follow]").disabled)');
   await browser.evaluate(`window.__t34Posts=[];const actual=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;if(init?.method==='POST'&&url.endsWith('/follow'))window.__t34Posts.push(JSON.parse(init.body));return actual(input,init);};document.querySelector('[data-action=toggle-item-follow]').click();`);
   await browser.waitFor('Boolean(document.querySelector("[data-follow-state=unknown], [data-follow-state=conflict], [data-follow-state=succeeded]"))');
   await screenshot(browser,directory,'new-detail-1920.png');
   const fault=f.followBootstrapFaultState();assert.equal(fault.committed_responses,1);assert.ok(fault.failed_bootstrap_reads>=1);
   const rows=(await f.pool.query<{client_command_id:string;state:string}>("SELECT client_command_id::text,state FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_ITEM_FOLLOW'")).rows;
   assert.equal(rows.length,1);assert.equal(rows[0]?.state,'COMMITTED');
   assert.equal((await f.pool.query('SELECT following FROM pilot_ticket.workbench_item_follow')).rows[0]?.following,true);
   assert.equal(await browser.evaluate('document.querySelector("[data-follow-state]")?.getAttribute("data-follow-state")'),'unknown','a failed read after successful POST does not prove business rejection');
   assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=follow-ack]"))'),true);
   const posts:unknown=await browser.evaluate('window.__t34Posts');assert.ok(Array.isArray(posts));assert.equal(posts.length,1);
   assert.ok(posts[0]&&typeof posts[0]==='object'&&!Array.isArray(posts[0]));assert.equal((posts[0] as Record<string,unknown>).client_command_id,rows[0]?.client_command_id);
   f.restoreFollowBootstrapResponses();await browser.evaluate('document.querySelector("[data-action=follow-ack]").click()');
   await browser.waitFor('document.querySelector("[data-action=toggle-item-follow]")?.getAttribute("aria-pressed")==="true"&&!document.querySelector("[data-action=follow-ack]")');
   assert.equal(await browser.evaluate('window.__t34Posts.length'),1,'read-only recovery cannot issue another POST');
   assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_ITEM_FOLLOW'")).rows[0]?.n,1);
   await screenshot(browser,directory,'new-detail-page-1920.png');
  }catch(error){primary=error;}
  finally{f.restoreFollowBootstrapResponses();await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 },{workbenchFollowEnabled:true,failFollowBootstrapAfterCommit:true,manualProjection:true,chronologicalTicketEvents:true});
});

for(const recovery of [false,true])test(`T34 lost acknowledgement retains the original intent with recovery ${recovery?'ON across reload and explicit replay':'OFF for read-only acknowledgement'}`,{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const target=f.tickets[1],cookie=f.browserCookies[2];assert.ok(target&&cookie);const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  const path='/api/workbench/items/ticket/'+target.ticket.id;let postCount=0;const ackPaths:string[]=[];
  f.runtime.server.on('request',request=>{if(request.method==='POST'&&request.url===path+'/follow')postCount++;if(request.method==='GET'&&request.url?.startsWith(path+'/follow/commands/'))ackPaths.push(request.url);});
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+target.ticket.id,width:1920,height:1080,cookies:[cookie]});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector("[data-action=toggle-item-follow]")&&!document.querySelector("[data-action=toggle-item-follow]").disabled)');
   await browser.evaluate(`window.__t34Original=null;window.__t34OriginalWire=null;const actual=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;const response=await actual(input,init);if(init?.method==='POST'&&url.endsWith('/follow')){window.__t34Original=JSON.parse(init.body);window.__t34OriginalWire=init.body;if(response.status===200)throw new TypeError('OWNED_ACK_LOSS_AFTER_REAL_RESPONSE');}return response;};document.querySelector('[data-action=toggle-item-follow]').click();`);
   await browser.waitFor('Boolean(document.querySelector("[data-follow-state=unknown]")&&document.querySelector("[data-action=follow-ack]"))');
   const original:unknown=await browser.evaluate('window.__t34Original');assert.ok(original&&typeof original==='object'&&!Array.isArray(original));
   const command=original as Record<string,unknown>,originalWire:unknown=await browser.evaluate('window.__t34OriginalWire');assert.ok(typeof command.client_command_id==='string');assert.equal(typeof originalWire,'string');assert.equal(postCount,1);
   assert.equal((await f.pool.query('SELECT state FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[command.client_command_id])).rows[0]?.state,'COMMITTED');
   await screenshot(browser,directory,'new-detail-1920.png');
   if(recovery){
    await browser.command('Page.reload');await browser.waitFor('Boolean(document.querySelector("[data-follow-state=unknown]")&&document.querySelector("[data-action=follow-replay]")&&!document.querySelector("[data-action=follow-replay]").disabled)');
    assert.equal(postCount,1,'restoration reads authority and never posts automatically');
    await browser.evaluate(`window.__t34Replay=null;window.__t34ReplayWire=null;const actual=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;if(init?.method==='POST'&&url.endsWith('/follow')){window.__t34Replay=JSON.parse(init.body);window.__t34ReplayWire=init.body;}return actual(input,init);};document.querySelector('[data-action=follow-replay]').click();`);
    await browser.waitFor('document.querySelector("[data-action=toggle-item-follow]")?.getAttribute("aria-pressed")==="true"&&!document.querySelector("[data-action=follow-ack]")');
    assert.deepEqual(await browser.evaluate('window.__t34Replay'),original);assert.equal(await browser.evaluate('window.__t34ReplayWire'),originalWire,'explicit replay keeps the original wire body, UUID and basis');assert.equal(postCount,2);
   }else{
    assert.equal(await browser.evaluate('indexedDB.databases().then(values=>values.some(value=>value.name==="wecom-workbench-drafts-v1"))'),false,'disabled recovery creates no persistent draft or opaque operation ledger');
    await browser.evaluate('document.querySelector("[data-action=follow-ack]").click()');
    await browser.waitFor('document.querySelector("[data-action=toggle-item-follow]")?.getAttribute("aria-pressed")==="true"&&!document.querySelector("[data-action=follow-ack]")');
    assert.ok(ackPaths.some(path=>path.endsWith('/'+command.client_command_id)));assert.equal(postCount,1);
   }
   assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_command_receipt WHERE command_type='WORKBENCH_ITEM_FOLLOW'")).rows[0]?.n,1);
   assert.equal((await f.pool.query('SELECT row_version::text AS revision,following FROM pilot_ticket.workbench_item_follow')).rows[0]?.revision,'1');
   await screenshot(browser,directory,'new-detail-page-1920.png');
  }catch(error){primary=error;}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 },{workbenchFollowEnabled:true,workbenchDraftRecoveryEnabled:recovery,manualProjection:true,chronologicalTicketEvents:true});
});

test('T34 current object READ loss clears the personal projection while its session remains valid, and late receipt cannot resurrect it',{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const target=f.tickets[1],cookie=f.browserCookies[2];assert.ok(target&&cookie);const path='/api/workbench/items/ticket/'+target.ticket.id,directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+target.ticket.id,width:1920,height:1080,cookies:[cookie]});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector("[data-action=toggle-item-follow]")&&!document.querySelector("[data-action=toggle-item-follow]").disabled&&document.querySelector("[data-realtime-status=live]"))');
   assert.equal((await f.runtime.observability.metrics()).sse_clients,1);
   await browser.evaluate(`(()=>{const actual=window.fetch.bind(window);window.__t34Posts=0;window.__t34Held=0;window.__t34Returned=0;window.__t34Release=[];window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input.url;const response=await actual(input,init);if(init?.method==='POST'&&url.endsWith('/follow')){window.__t34Posts++;if(response.status===200)throw new TypeError('OWNED_ACK_LOSS');}if(url.includes('/follow/commands/')){window.__t34Held++;await new Promise(resolve=>window.__t34Release.push(resolve));window.__t34Returned++;}return response;};document.querySelector('[data-action=toggle-item-follow]').click();})()`);
   await browser.waitFor('Boolean(document.querySelector("[data-follow-state=unknown]"))');
   await browser.evaluate('document.querySelector("[data-action=follow-ack]").click()');await browser.waitFor('window.__t34Held===1');
   await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['HANDLER'],resolverTeamIds:[]});
   await browser.evaluate('document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("focus"));');
   await browser.waitFor('!document.querySelector("[data-action=toggle-item-follow]")&&!document.querySelector("[data-action=follow-ack]")');
   const read=await fetch(f.origin+path,{headers:{cookie:f.cookies[2]}});assert.equal(read.status,404);
   assert.equal((await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie:f.cookies[2]}})).status,200);
   await browser.evaluate('for(const release of window.__t34Release.splice(0))release()');await browser.waitFor('window.__t34Returned===1');
   await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=toggle-item-follow], [data-action=follow-ack]"))'),false);
   assert.equal(await browser.evaluate('document.body.textContent.includes("当前身份没有查看权限。")'),false,'an object denial cannot become a global session denial');
   assert.equal(await browser.evaluate('window.__t34Posts'),1);
   assert.equal((await f.pool.query('SELECT following FROM pilot_ticket.workbench_item_follow')).rows[0]?.following,true,'loss of READ hides the personal fact without silently cancelling it');
   await screenshot(browser,directory,'new-detail-page-1920.png');
  }catch(error){primary=error;}
  finally{if(browser)await browser.evaluate('for(const release of window.__t34Release??[])release()').catch(()=>{});await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 },{workbenchFollowEnabled:true,workbenchRealtimeEnabled:true,manualProjection:true,chronologicalTicketEvents:true});
});

test('T34 an actual bootstrap401 from an inactive staff principal closes the session before a new Follow POST',{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const target=f.tickets[1],cookie=f.browserCookies[2],actor=f.principals[1];assert.ok(target&&cookie&&actor);let posts=0;const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  f.runtime.server.on('request',request=>{if(request.method==='POST'&&request.url?.endsWith('/follow'))posts++;});
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/items/ticket/'+target.ticket.id,width:1920,height:1080,cookies:[cookie]});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector("[data-action=toggle-item-follow]")&&!document.querySelector("[data-action=toggle-item-follow]").disabled)');
   // Settle the three authorized initial columns before changing the caller;
   // an unrelated pending initial board read must not supply this case's denial.
   await browser.waitFor('document.querySelectorAll(".board-column").length===3&&[...document.querySelectorAll(".board-column")].every(column=>column.querySelector(".column-cards"))');
   await browser.evaluate(`window.__t34BootstrapReads=[];const actual=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof Request?input.url:String(input),location.origin),method=init?.method??(input instanceof Request?input.method:'GET');const response=await actual(input,init);if(url.origin===location.origin&&url.pathname==='/api/lifecycle/bootstrap'&&method==='GET')window.__t34BootstrapReads.push({url:url.pathname,method,status:response.status});return response;};`);
   await f.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[actor.id]);
   assert.equal((await fetch(f.origin+'/api/lifecycle/bootstrap',{headers:{cookie:f.cookies[2]}})).status,401);
   await browser.evaluate('const control=document.querySelector("[data-action=toggle-item-follow]");window.__t34ControlRemained=Boolean(control);if(!control&&!window.__t34BootstrapReads.some(read=>read.status===401))throw new Error("OWNED_BROWSER_BOOTSTRAP_DENIAL_NOT_OBSERVED_BEFORE_CONTROL_REMOVAL");control?.click();');
   await browser.waitFor('window.__t34BootstrapReads.some(read=>read.status===401)&&Boolean(document.querySelector(".entry-state"))&&(document.body.textContent.includes("会话已失效")||document.body.textContent.includes("会话需要重新核验"))');
   console.log('T34_BROWSER_SESSION_DENIED '+JSON.stringify(await browser.evaluate('({bootstrap_reads:window.__t34BootstrapReads,old_control_remained:window.__t34ControlRemained,closed_entry:Boolean(document.querySelector(".entry-state")),protected_detail:Boolean(document.querySelector("#detail-title, [data-action=toggle-item-follow]"))})')));
   await screenshot(browser,directory,'new-detail-1920.png');
   assert.equal(await browser.evaluate('Boolean(document.querySelector("#detail-title, [data-action=toggle-item-follow]"))'),false);assert.equal(posts,0);
  }catch(error){primary=error;if(browser){try{console.log('T34_BROWSER_SESSION_DENIED_DIAGNOSTIC '+JSON.stringify(await browser.evaluate('({bootstrap_reads:window.__t34BootstrapReads,old_control_remained:window.__t34ControlRemained,entry:document.querySelector(".entry-state")?.textContent??null,protected_detail:Boolean(document.querySelector("#detail-title, [data-action=toggle-item-follow]"))})')));await screenshot(browser,directory,'new-detail-1920.png');}catch{console.log('T34_SESSION_DIAGNOSTIC_NOT_CAPTURED_PRIMARY_ERROR_RETAINED');}}}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 },{workbenchFollowEnabled:true,manualProjection:true,chronologicalTicketEvents:true});
});
