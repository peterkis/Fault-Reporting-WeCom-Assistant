import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import type {PilotPrincipal} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
interface Fixture {origin:string;backendOrigin:string;pool:PostgresPool;principals:PilotPrincipal[];tickets:{ticket:{id:string}}[];certificateSpki:string;browserCookies:{name:string;value:string;url:string}[];cookies:string[]}
function object(value:unknown):Record<string,unknown>{assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
const copies="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.map(row=>({id:row.id,purpose:row.purpose})),operations:operations.result.map(row=>({commandId:row.commandId,purpose:row.purpose}))});};};})";
const trace="(()=>{globalThis.__t17Authority=[];const original=fetch;globalThis.fetch=async(path,init)=>{const response=await original(path,init);globalThis.__t17Authority.push({path:String(path),method:init?.method??'GET',status:response.status});return response;};})()";
async function type(browser:Browser,label:string,value:string){await browser.evaluate(`(()=>{const input=document.querySelector('[aria-label="${label}"]'),type=input instanceof HTMLTextAreaElement?HTMLTextAreaElement:HTMLInputElement;Object.getOwnPropertyDescriptor(type.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
test('leaving the manual form does not leave its private draft behind after current create permission is revoked, while another authorized purpose survives',async()=>{
  await withWeb01Fixture(async({origin,backendOrigin,pool,principals,tickets,certificateSpki,browserCookies,cookies}:Fixture)=>{
    const principal=principals[0],other=tickets[8];assert.ok(principal);assert.ok(other);let browser:Browser|undefined,error:unknown;
    const access=createPilotAccessService({pool}),read=(path:string)=>fetch(backendOrigin+path,{headers:{cookie:cookies[0]}});
    try{
      browser=await launchSystemBrowser({url:origin+'/workbench/app/items/ticket/'+other.ticket.id+'?detail=page',width:900,height:900,certificateSpki,cookies:browserCookies});assert.ok(browser);
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await type(browser,'内部备注','T17 separate authorized note');
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.command('Page.navigate',{url:origin+'/workbench/app/reports/new'});
      await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await type(browser,'报修人姓名','T17 revoked private reporter');await type(browser,'联系方式','合成人工联系8899');await type(browser,'故障描述','T17 revoked private input：打印机无法打印');
      await browser.evaluate("document.querySelector('[aria-label=\"位置暂不清楚\"]').click()");await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('已保存恢复副本')");
      await browser.evaluate("document.querySelector('[data-action=return-workbench]').click()");await browser.waitFor("Boolean(document.querySelector('.ticket-card'))&&!document.querySelector('[data-manual-report-form]')");
      const before=object(await browser.evaluate(copies));assert.ok(Array.isArray(before.drafts));assert.equal(before.drafts.length,2);
      const changed=await access.upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:['HANDLER'],resolverTeamIds:[]});assert.equal(changed.id,principal.id);
      const bootstrap=await read('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);assert.deepEqual(object(await bootstrap.json()).roles,['HANDLER']);
      assert.equal((await read('/api/workbench/reports/capabilities')).status,403);assert.equal((await read('/api/workbench/items/ticket/'+other.ticket.id)).status,200);
      await browser.command('Page.enable');await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:trace});await browser.command('Page.reload');
      await browser.waitFor("globalThis.__t17Authority?.some(row=>row.path==='/api/workbench/reports/capabilities'&&row.status===403)");
      await browser.waitFor(`(async()=>{const value=await (${copies});return !value.drafts.some(row=>row.purpose==='manual-report');})()`);
      assert.deepEqual(await browser.evaluate(copies),{drafts:[{id:other.ticket.id,purpose:'internal-note'}],operations:[]});
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=new-report]'))"),false);
      await access.upsertPrincipal({wecomUserId:principal.wecom_user_id,displayName:principal.display_name,roles:principal.roles,resolverTeamIds:principal.resolver_team_ids});
      await browser.command('Page.navigate',{url:origin+'/workbench/app/reports/new'});await browser.waitFor("document.querySelector('[data-manual-report-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"故障描述\"]').value"),'');assert.equal(await browser.evaluate("document.querySelector('[aria-label=\"报修人姓名\"]').value"),'');
      await browser.command('Page.navigate',{url:origin+'/workbench/app/items/ticket/'+other.ticket.id+'?detail=page'});await browser.waitFor("document.querySelector('[aria-label=\"内部备注\"]')?.value==='T17 separate authorized note'");
      assert.equal(await browser.evaluate("globalThis.__t17Authority.filter(row=>row.method==='POST').length"),0);
    }catch(failure){error=failure;try{console.log('T17_AUTHORITY_DIAGNOSTIC '+JSON.stringify(browser?{view:await browser.evaluate('({text:document.body.innerText,requests:globalThis.__t17Authority})'),copies:await browser.evaluate(copies)}:{}));}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchManualReportsEnabled:true,workbenchDraftRecoveryEnabled:true,workbenchInternalNotesEnabled:true,workbenchRealtimeEnabled:true,realWorkbenchAuthentication:true});
});
