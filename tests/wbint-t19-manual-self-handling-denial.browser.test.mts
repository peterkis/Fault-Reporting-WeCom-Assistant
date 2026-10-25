import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Server} from 'node:http';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;pool:PostgresPool;principals:{id:string}[];runtime:{server:Server};certificateSpki:string;browserCookies:{name:string;value:string;url:string}[]}
const copies="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),d=tx.objectStore('drafts').getAll(),o=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:d.result.filter(r=>r.purpose==='manual-report-self-handling').length,operations:o.result.filter(r=>r.purpose==='manual-report-self-handling').map(r=>r.commandId)});};};})";
async function fill(browser:Browser){
  await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('草稿仅在当前浏览器')&&!document.querySelector('[aria-label=\"本人处理组\"]').matches(':disabled')");
  await browser.evaluate("(()=>{const e=document.querySelector('[aria-label=\"本人处理组\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'PILOT_IT');e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  for(const [label,value] of [['报修人姓名','T19 私密合成报修人'],['联系方式','合成内线9919'],['故障描述','T19 private original：打印机无法打印']])await browser.evaluate(`(()=>{const e=document.querySelector('[aria-label="${label}"]'),p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(p.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await browser.evaluate("document.querySelector('[aria-label=\"位置暂不清楚\"]').click()");await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('已保存恢复副本')");
}
async function revoke(f:Fixture){const actor=f.principals[0];assert.ok(actor);await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[actor.id]);await f.pool.query("UPDATE pilot_ticket.pilot_principal_role SET role='HANDLER' WHERE principal_id=$1::uuid AND role='ADMIN'",[actor.id]);}
test('T19 a real receipt 403 clears sensitive restored input and ciphertext while retaining only its original opaque unresolved operation',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    let browser:Browser|undefined,error:unknown,posts=0;const statuses:number[]=[];
    f.runtime.server.prependListener('request',(request,response)=>{
      if(request.method==='POST'&&request.url==='/api/workbench/reports/take-and-start'){posts++;const end=response.end.bind(response);response.end=(chunk?:string|Uint8Array|(()=>void))=>response.statusCode===202?end('{'):typeof chunk==='function'?end(chunk):end(chunk);}
      if(request.method==='GET'&&request.url?.startsWith('/api/workbench/reports/commands/'))response.once('finish',()=>statuses.push(response.statusCode));
    });
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/reports/new?handling=self',width:900,height:900,cookies:f.browserCookies,certificateSpki:f.certificateSpki});assert.ok(browser);await fill(browser);await browser.evaluate("document.querySelector('[data-action=submit-manual-self-handling]').click()");await browser.waitFor("document.querySelector('[data-manual-report-result]')?.textContent.includes('结果未知')");
      const before=await browser.evaluate(copies);assert.ok(before&&typeof before==='object'&&'operations' in before);const operations=before.operations;assert.ok(Array.isArray(operations));assert.equal(operations.length,1);await revoke(f);
      await browser.evaluate("document.querySelector('[data-action=check-manual-report-receipt]').click()");
      for(let n=0;n<100&&!statuses.length;n++)await new Promise(resolve=>setTimeout(resolve,10));assert.deepEqual(statuses,[403]);
      await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.deepEqual(await browser.evaluate(copies),{drafts:0,operations});assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"故障描述\"]')?.value??''"),'');assert.equal(posts,1);
    }catch(failure){error=failure;try{console.log('T19_RECEIPT_DENIAL '+JSON.stringify({posts,statuses,view:browser?await browser.evaluate('document.body.innerText'):null,copies:browser?await browser.evaluate(copies):null}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,workbenchDraftRecoveryEnabled:true,realWorkbenchAuthentication:true});
});
test('T19 a completed native IDB settlement whose notification is delayed cannot overwrite a later real current-authority revocation from another production tab',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    let browser:Browser|undefined,tab:Awaited<ReturnType<typeof yxxTab>>|undefined,error:unknown;
    try{
      browser=await launchSystemBrowser({url:f.origin+'/workbench/app/reports/new?handling=self',width:900,height:900,cookies:f.browserCookies,certificateSpki:f.certificateSpki});assert.ok(browser);await fill(browser);
      await browser.evaluate(`(()=>{const original=fetch,descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');let hold=false,held=false;globalThis.__t19Revoked=false;const notices=new BroadcastChannel('wecom-workbench-drafts-v1');notices.onmessage=e=>{if(e.data?.purpose==='manual-report-self-handling'&&e.data.reason==='revoked')globalThis.__t19Revoked=true;};Object.defineProperty(IDBTransaction.prototype,'oncomplete',{configurable:true,get:descriptor.get,set(callback){descriptor.set.call(this,event=>{if(hold&&!held&&this.mode==='readwrite'&&this.objectStoreNames.contains('drafts')){held=true;globalThis.__t19ReleaseCleanup=()=>callback.call(this,event);return;}callback.call(this,event);});}});globalThis.fetch=async(path,init)=>{const response=await original(path,init);if(init?.method==='POST'&&String(path)==='/api/workbench/reports/take-and-start'&&response.status===202)hold=true;return response;};})()`);
      await browser.evaluate("document.querySelector('[data-action=submit-manual-self-handling]').click()");await browser.waitFor("typeof globalThis.__t19ReleaseCleanup==='function'");await revoke(f);
      tab=await yxxTab(browser,f.origin+'/workbench/app/reports/new?handling=self');await browser.waitFor('globalThis.__t19Revoked===true');
      await browser.evaluate('globalThis.__t19ReleaseCleanup()');await browser.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
      assert.equal(await browser.evaluate("document.querySelector('[data-manual-report-result]')?.textContent.includes('已受理并开始处理')??false"),false,'a late original cleanup result cannot restore the old success after current-authority clearing');
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=open-admitted-report]'))"),false,'current-authority revocation removes the admitted-item link as well');
    }catch(failure){error=failure;try{console.log('T19_LATE_SETTLEMENT '+JSON.stringify(browser?await browser.evaluate('({view:document.body.innerText,revoked:globalThis.__t19Revoked,held:typeof globalThis.__t19ReleaseCleanup})'):{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,ticketSelfHandlingEnabled:true,workbenchDraftRecoveryEnabled:true,realWorkbenchAuthentication:true});
});
