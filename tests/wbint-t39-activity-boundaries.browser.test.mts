import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {WorkbenchActivityView} from '../contracts/workbench_activity_contracts.js';
type Browser=Awaited<ReturnType<typeof launchSystemBrowser>>;
interface Fixture {origin:string;cookies:string[];browserCookies:{name:string;value:string;url:string}[];tickets:{ticket:{id:string}}[];runtime:{disconnectRealtimePrincipal:(index?:number)=>unknown;observability:{metrics:()=>Promise<{sse_clients:number}>}}}
async function currentPeople(origin:string,cookie:string,ticketId:string){const response=await fetch(origin+'/api/workbench/items/ticket/'+ticketId+'/activity',{headers:{cookie}});assert.equal(response.status,200);return (await response.json() as WorkbenchActivityView).people;}
async function waitViewing(origin:string,cookie:string,ticketId:string){
  const until=Date.now()+12000;
  do{const people=await currentPeople(origin,cookie,ticketId);if(people.some(person=>person.display_name==='林舟'&&person.mode==='VIEWING'))return;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<until);
  assert.fail('visible current detail must register VIEWING without a new input event');
}
// Delay delivery of an actual native open event until the real detail is visible.
// The native EventSource, real server, authorized GETs and all event data remain unchanged.
const holdOpen=`(()=>{globalThis.__t39HoldOpen=true;globalThis.__t39OpenQueue=[];globalThis.__t39Errors=0;const add=EventSource.prototype.addEventListener;EventSource.prototype.addEventListener=function(name,listener,options){if(name==='open'&&typeof listener==='function')return add.call(this,name,event=>{if(globalThis.__t39HoldOpen)globalThis.__t39OpenQueue.push(()=>listener.call(this,event));else listener.call(this,event);},options);if(name==='error')add.call(this,name,()=>globalThis.__t39Errors++);return add.call(this,name,listener,options);};globalThis.__t39ReleaseOpen=()=>{globalThis.__t39HoldOpen=false;const queue=globalThis.__t39OpenQueue.splice(0);for(const deliver of queue)deliver();};})()`;

test('production detail visible before live and after a real reconnect registers viewing without extra interaction',async()=>{
  await withWeb01Fixture(async({origin,cookies,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5]?.ticket,cookie=browserCookies[0],viewer=cookies[2];assert.ok(ticket&&cookie&&viewer);let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1280,height:900,cookies:[cookie]});assert.ok(browser);
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:holdOpen});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+ticket.id+'?detail=page'});
      await browser.waitFor('Boolean(document.querySelector(".detail-body"))&&globalThis.__t39OpenQueue?.length>0');
      await browser.evaluate('globalThis.__t39ReleaseOpen()');
      await waitViewing(origin,viewer,ticket.id);
      assert.equal((await runtime.observability.metrics()).sse_clients,1,'activity reuses the one original real SSE stream');
      await browser.evaluate('globalThis.__t39HoldOpen=true');runtime.disconnectRealtimePrincipal(0);
      await browser.waitFor('globalThis.__t39Errors>0&&globalThis.__t39OpenQueue.length>0');
      await browser.evaluate('globalThis.__t39ReleaseOpen()');
      await waitViewing(origin,viewer,ticket.id);
      assert.equal((await runtime.observability.metrics()).sse_clients,1);
    }catch(failure){error=failure;console.log('T39_VISIBLE_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,errors:globalThis.__t39Errors,queued:globalThis.__t39OpenQueue?.length})'):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,manualProjection:true});
});

test('slow activity alone leaves production realtime and an authorized human note usable',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,tickets,runtime}:Fixture)=>{
    const ticket=tickets[5]?.ticket,cookie=browserCookies[0];assert.ok(ticket&&cookie);let browser:Browser|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/',width:1280,height:900,cookies:[cookie]});assert.ok(browser);
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{globalThis.__t39Held=0;const original=globalThis.fetch;globalThis.fetch=async function(input,options){const response=await original.call(this,input,options);if(String(input)==='/api/workbench/activity'&&options?.method==='POST'&&JSON.parse(options.body).action==='RENEW'){globalThis.__t39Held++;return new Promise((_resolve,reject)=>{const abort=()=>reject(new DOMException('activity delayed','AbortError'));if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});});}return response;};})()`});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+ticket.id+'?detail=page'});
      await browser.waitFor('globalThis.__t39Held>0&&Boolean(document.querySelector("textarea[aria-label=内部备注]"))');
      await new Promise(resolve=>setTimeout(resolve,6500));
      assert.equal(await browser.evaluate('document.querySelector("[data-realtime-status]")?.dataset.realtimeStatus'),'live','only activity is delayed; healthy REST and native SSE remain usable');
      await browser.evaluate(`(()=>{const input=document.querySelector('textarea[aria-label="内部备注"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'T39 healthy human note while activity is delayed');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.waitFor('document.querySelector("[data-action=save-internal-note]")?.disabled===false');
      await browser.evaluate('document.querySelector("[data-action=save-internal-note]").click()');
      await browser.waitFor('document.querySelector(".activity-list")?.textContent.includes("T39 healthy human note while activity is delayed")');
      assert.equal((await runtime.observability.metrics()).sse_clients,1);
    }catch(failure){error=failure;console.log('T39_DELAY_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText,held:globalThis.__t39Held})'):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,workbenchInternalNotesEnabled:true,manualProjection:true});
});
