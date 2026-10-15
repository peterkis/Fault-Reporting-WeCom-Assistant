import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import type {IncomingMessage,ServerResponse} from 'node:http';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {pool:PostgresPool;runtime:P2016EnabledRuntime;origin:string;certificateSpki:string;
 browserCookies:NonNullable<Parameters<typeof launchSystemBrowser>[0]['cookies']>}
async function settle(runtime:P2016EnabledRuntime){
 const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;
 for(let step=0;step<bound;step++){
  const inbound=await runtime.coordinator.runOnce(),material=await runtime.realtimeProjector.runOnce({limit:100});
  assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
  if(!inbound.processed&&!material.processed&&(await runtime.coordinator.backlog()).total===0)return;
 }assert.fail('bounded synthetic search fixture projection did not settle');
}
for(const scenario of ['short-with-T38','unicode128'] as const)test('T41 real production pages: '+scenario,{timeout:240000},async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  const q=scenario==='unicode128'?'😀'.repeat(128):'T41_TWO_PAGE_SYNTHETIC',core=createPilotTicketCore({pool:f.pool});
  for(let index=0;index<51;index++){
   const intake=await seedPersistedIntake({pool:f.pool,text:q,requestType:'INCIDENT',status:'RECEIVED'});
   await core.createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'t41-two-pages-'+index});
  }await settle(f.runtime);
  const seen:{method:string;bytes:number;status:number}[]=[];
  const observe=(request:IncomingMessage,response:ServerResponse)=>{
   if(new URL(request.url??'/',f.origin).pathname==='/api/workbench/search')response.once('finish',()=>seen.push({method:request.method??'',bytes:Buffer.byteLength(request.url??'','utf8'),status:response.statusCode}));
  };f.runtime.server.on('request',observe);
  let browser:Browser|undefined,primary:unknown;
  try{
   browser=await launchSystemBrowser({url:f.origin+'/workbench/app/',
    width:1920,height:1080,cookies:f.browserCookies,certificateSpki:f.certificateSpki});assert.ok(browser);
   await browser.waitFor('Boolean(document.querySelector("[data-realtime-status=live],[data-realtime-status=polling]"))');
   await browser.evaluate('document.querySelector("a.sidebar-search").click()');
   await browser.waitFor('Boolean(document.querySelector("form[aria-label=\\"搜索全部获权事项\\"] input[name=q]"))&&document.querySelector(".range-bar")?.textContent.includes("已加载 50 项")');
   seen.length=0;
   await browser.evaluate('(()=>{const input=document.querySelector("form[aria-label=\\"搜索全部获权事项\\"] input[name=q]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(q)+');input.dispatchEvent(new Event("input",{bubbles:true}));})()');
   await browser.evaluate('document.querySelector("form[aria-label=\\"搜索全部获权事项\\"]").requestSubmit()');
   await browser.waitFor('new URL(location.href).searchParams.get("q")==='+JSON.stringify(q)+'&&document.querySelector(".board-column.pending .column-heading")?.textContent.includes("50 已加载")');
   await browser.evaluate('document.querySelector("button[data-action=expand-column][aria-controls=cards-pending]").click()');
   await browser.waitFor('document.querySelectorAll("article[data-kind=ticket]").length===50');
   await browser.evaluate('document.querySelector("button.load-more:not(:disabled)").click()');
   await browser.waitFor('document.querySelectorAll("article[data-kind=ticket]").length===51');
   assert.equal(seen.filter(value=>value.status===200).length,2);assert.ok(seen.every(value=>value.bytes<=2048));
   if(scenario==='unicode128')assert.deepEqual(seen.map(value=>value.method),['GET','POST']);
   else{
    const start=await browser.evaluate('performance.now()');assert.ok(typeof start==='number');
    await browser.waitFor('performance.now()-'+start+'>55000',{timeoutMs:60000,intervalMs:100});
    assert.equal(seen.length,2,'unchanged T38 refresh cycles must not re-run either search page');
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-search-state=error]"))'),false);
    assert.equal(await browser.evaluate('document.querySelectorAll("article[data-kind=ticket]").length'),51);
    await browser.evaluate('document.querySelector("article[data-kind=ticket] a").click()');
    await browser.waitFor('Boolean(document.querySelector("button[data-action=take-and-start]:not(:disabled)"))');
    await browser.evaluate('document.querySelector("button[data-action=take-and-start]").click()');
    await browser.waitFor('document.querySelector(".detail-dialog")?.textContent.includes("处理中")');
   }
   assert.match(tmpdir(),/^D:[\\/]/iu);const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
   const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-board-1920.png');await writeFile(file,bytes);
   console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));
  }catch(error){primary=error;}
  finally{f.runtime.server.off('request',observe);await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],primary);}
 },{realWorkbenchAuthentication:true,workbenchSearchEnabled:true,workbenchRealtimeEnabled:true,
  ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false});
});
