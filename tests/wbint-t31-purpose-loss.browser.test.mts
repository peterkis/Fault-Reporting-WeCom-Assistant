import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t31Browser} from './helpers/t31-public-progress-browser-fixture.mjs';
import {record,text} from './helpers/t31-public-progress-fixture.mjs';

test('T31 recovery-off route purpose403 clears only public progress while the same staff session and general Incident READ remain valid',async()=>{
  await t31Browser('t31route403',async({browser,incidentId,pool,f,post,get})=>{
    const path='/api/incidents/'+incidentId,summary='合成用途失权后停止展示的安全摘要';
    assert.equal((await post(path+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary,preview_confirmed:true})).status,200);
    assert.equal((await post(path+'/correct-scope',{client_command_id:randomUUID(),expected_row_version:'2',reason_code:'SCOPE_CORRECTION',confirmed_scope:'CAMPUS'})).status,200);
    // Hold an actual authorized page before changing current roles. Its late
    // release selects the publication and triggers a fresh real route403.
    await browser.evaluate("(()=>{const send=fetch;globalThis.__t31PageReady=false;globalThis.__t31ReleasePage=null;globalThis.__t31RouteStatus=null;globalThis.fetch=async(path,options)=>{const url=String(path);if(url.includes('/public-progress?')){const response=await send(path,options),bytes=await response.arrayBuffer(),headers=[...response.headers];return new Promise(resolve=>{globalThis.__t31PageReady=true;globalThis.__t31ReleasePage=()=>resolve(new Response(bytes,{status:response.status,headers}));});}const response=await send(path,options);if(url.includes('/deliveries?'))globalThis.__t31RouteStatus=response.status;return response;};})()");
    await browser.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='回到公开进展起点').click()");await browser.waitFor('globalThis.__t31PageReady');
    const principal=text(record(f.admin).id);await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[principal]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'DISPATCHER')",[principal]);
    assert.equal((await get('/api/lifecycle/bootstrap')).status,200);const general=await get(path);assert.equal(general.status,200);assert.equal(general.body.confirmed_scope,'CAMPUS');assert.equal((await get(path+'/public-progress')).status,403);
    await browser.evaluate('globalThis.__t31ReleasePage()');await browser.waitFor('globalThis.__t31RouteStatus===403');await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("已失权")||document.body.innerText.includes("会话已失效")');
    console.log('T31_ROUTE_PURPOSE_LOSS '+JSON.stringify({bootstrap:200,generalIncident:200,currentPublicPurpose:403,actualRoute:await browser.evaluate('globalThis.__t31RouteStatus'),generalViewRetained:await browser.evaluate(`Boolean(document.querySelector('[data-incident-id="${incidentId}"]'))`)}));
    assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-incident-id="${incidentId}"]'))`),true,'a public-purpose403 must not close the valid staff session or clear unrelated query scopes');
    assert.equal(await browser.evaluate('Boolean(document.querySelector("textarea[aria-label=公开进展摘要]"))'),false);assert.equal(await browser.evaluate(`document.querySelector('[aria-label="已发布公开进展"]')?.textContent.includes(${JSON.stringify(summary)})`),false);assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-public-progress-routes]"))'),false);
  },{recovery:false});
});

test('T31 a real route401 still closes the invalid browser session rather than preserving its old data',async()=>{
  await t31Browser('t31route401',async({browser,incidentId,post,cookies,origin})=>{
    const path='/api/incidents/'+incidentId;
    assert.equal((await post(path+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'合成真实会话失效边界摘要',preview_confirmed:true})).status,200);
    await browser.evaluate("(()=>{const send=fetch;globalThis.__t31PageReady=false;globalThis.__t31ReleasePage=null;globalThis.__t31RouteStatus=null;globalThis.fetch=async(path,options)=>{const url=String(path);if(url.includes('/public-progress?')){const response=await send(path,options),bytes=await response.arrayBuffer(),headers=[...response.headers];return new Promise(resolve=>{globalThis.__t31PageReady=true;globalThis.__t31ReleasePage=()=>resolve(new Response(bytes,{status:response.status,headers}));});}const response=await send(path,options);if(url.includes('/deliveries?'))globalThis.__t31RouteStatus=response.status;return response;};})()");
    await browser.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='回到公开进展起点').click()");await browser.waitFor('globalThis.__t31PageReady');const cookie=cookies[0];assert.ok(cookie);await browser.command('Network.deleteCookies',{name:text(cookie.name),url:origin});
    assert.equal(await browser.evaluate('fetch("/api/lifecycle/bootstrap").then(response=>response.status)'),401);await browser.evaluate('globalThis.__t31ReleasePage()');await browser.waitFor('globalThis.__t31RouteStatus===401');await browser.waitFor('document.body.innerText.includes("会话已失效")');assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-incident-id="${incidentId}"]'))`),false);
  },{recovery:false});
});
