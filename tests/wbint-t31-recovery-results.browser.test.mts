import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t31Browser,inspectT31Drafts} from './helpers/t31-public-progress-browser-fixture.mjs';
import {record,text} from './helpers/t31-public-progress-fixture.mjs';
import type {Browser} from './helpers/wbint-t27-browser-fixture.mjs';
import {createP2012Runtime} from '../src/p2-012-workbench-assembly.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

async function publish(browser:Browser){
  await browser.evaluate('document.querySelector("[data-action=preview-public-progress]").click()');
  await browser.waitFor('Boolean(document.querySelector("[data-public-progress-preview]"))');
  await browser.evaluate('document.querySelector("input[aria-label=确认安全公开摘要]").click()');
  await browser.waitFor('document.querySelector("[data-action=submit-public-progress]")?.disabled===false');
  await browser.evaluate('document.querySelector("[data-action=submit-public-progress]").click()');
}
const lostAck="(()=>{const send=fetch;globalThis.__t31Original=null;globalThis.__t31Writes=0;globalThis.__t31ReceiptReads=[];globalThis.fetch=async(path,options)=>{const url=String(path);if(options?.method==='POST'&&url.endsWith('/publish-update')){globalThis.__t31Writes++;globalThis.__t31Original=JSON.parse(options.body);const response=await send(path,options);await response.arrayBuffer();throw new TypeError('SYNTHETIC_ACK_LOSS_AFTER_REAL_COMMIT');}if(url.includes('/commands/'))globalThis.__t31ReceiptReads.push(url);return send(path,options);};})()";

test('T31 recovery disabled retains the original lost-ACK UUID and version after lawful CLOSED without replay',async()=>{
  await t31Browser('t31norecov',async({browser,incidentId,get,post,put})=>{
    const bootstrap=(await get('/api/lifecycle/bootstrap')).body;assert.equal(bootstrap.incident_public_progress_enabled,true);assert.equal(bootstrap.incident_public_progress_draft_recovery_enabled,false);assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-public-progress-draft]"))'),false);
    await browser.evaluate(lostAck);await put('合成安全摘要：真实提交后仅丢 ACK。');await publish(browser);await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("结果未知")');
    const original=record(await browser.evaluate('globalThis.__t31Original')),id=text(original.client_command_id),path='/api/incidents/'+incidentId;assert.equal(original.expected_row_version,'1');assert.equal((await get(path+'/commands/'+id)).body.state,'COMMITTED');
    for(const [action,version,reason] of [['start-investigating','2','OPERATOR_REVIEWED'],['resolve','3','RECOVERY_CONFIRMED'],['close','4','RECOVERY_CONFIRMED']])assert.equal((await post(path+'/'+action,{client_command_id:randomUUID(),expected_row_version:version,reason_code:reason})).status,200);
    await browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');await browser.waitFor(`document.querySelector('[data-incident-id="${incidentId}"]')?.textContent.includes('CLOSED')`);await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("公共故障已关闭")');
    assert.equal(await browser.evaluate('Boolean(document.querySelector("textarea[aria-label=公开进展摘要]"))'),false);assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=check-public-progress-operation]"))'),true);
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="公开进展摘要"]')?.textContent.includes(${JSON.stringify('原操作 UUID：'+id+'；原提交版本：1')})`),true);
    await browser.evaluate('document.querySelector("[data-action=check-public-progress-operation]").click()');await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("已发布")');
    assert.equal(await browser.evaluate('globalThis.__t31Writes'),1);assert.deepEqual(await browser.evaluate('globalThis.__t31ReceiptReads'),[path+'/commands/'+id]);
    const page=(await get(path+'/public-progress')).body;assert.ok(Array.isArray(page.items));assert.equal(page.items.length,1);assert.equal(record(page.items[0]).summary,original.summary);assert.equal(record(page.items[0]).incident_row_version,'2');assert.equal((await get(path)).body.row_version,'5');
  },{recovery:false});
});

test('T31 encrypted lost-ACK recovery uses only the original operation and displays actual UNKNOWN and failed Delivery rows',async()=>{
  await t31Browser('t31restore',async({browser,incidentId,get,put,pool,f,origin,capture})=>{
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:"globalThis.__t31Posts=[];(()=>{const send=fetch;globalThis.fetch=async(path,options)=>{if(options?.method==='POST')globalThis.__t31Posts.push({path:String(path),body:options.body});return send(path,options);};})()"});
    await browser.evaluate(lostAck);await put('合成人工安全摘要：与内部记录独立。');await capture('preview-input');await publish(browser);await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("结果未知")');
    const original=record(await browser.evaluate('globalThis.__t31Original')),copy=record(await browser.evaluate(inspectT31Drafts));assert.ok(Array.isArray(copy.operations));assert.equal(copy.operations.length,1);assert.equal(record(copy.operations[0]).commandId,original.client_command_id);assert.ok(Array.isArray(copy.drafts));const draft=record(copy.drafts[0]);assert.equal(draft.purpose,'incident-public-progress');assert.equal(draft.extractable,false);assert.equal(draft.algorithm,'AES-GCM');assert.equal(Number(draft.expiresAt)-Number(draft.firstSavedAt),86400000);assert.ok(Array.isArray(draft.keys));assert.equal(draft.keys.some(k=>['value','body','summary','text'].includes(String(k))),false);
    await browser.command('Page.reload');await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("已恢复原 UUID")');assert.equal(await browser.evaluate('document.querySelector("textarea[aria-label=公开进展摘要]")?.value'),original.summary);assert.equal(await browser.evaluate('document.querySelector("[data-action=submit-public-progress]")?.disabled'),true);assert.deepEqual(await browser.evaluate('globalThis.__t31Posts'),[]);
    await browser.evaluate('document.querySelector("[data-action=check-public-progress-operation]").click()');await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("已发布")');assert.deepEqual(await browser.evaluate('globalThis.__t31Posts'),[]);const after=record(await browser.evaluate(inspectT31Drafts));assert.deepEqual(after.drafts,[]);assert.deepEqual(after.operations,[]);
    const path='/api/incidents/'+incidentId,page=(await get(path+'/public-progress')).body;assert.ok(Array.isArray(page.items));assert.equal(page.items.length,1);const publication=text(record(page.items[0]).id),routes=(await get(path+'/public-progress/'+publication+'/deliveries')).body;assert.ok(Array.isArray(routes.items));const ids=routes.items.map(row=>text(record(row).id));assert.equal(ids.length,2);
    for(const id of ids)await browser.waitFor(`document.querySelector('[data-publication-id="${publication}"] [data-delivery-id="${id}"]')?.dataset.deliveryStatus==='PENDING'`);
    let calls=0;const senderRuntime=createP2012Runtime({pool,principalIds:[text(record(f.admin).id)],publicOrigin:origin,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentPublicProgressEnabled:true,externalSendEnabled:false,senderAdapter:{send:async()=>{calls++;return {outcome:calls===1?'UNKNOWN':'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:calls===1?'SYNTHETIC_UNKNOWN':'SYNTHETIC_REJECTED',retryable:false};}}});let error:unknown;
    try{for(const id of ids)await senderRuntime.communicationWorker.deliver({deliveryId:id});assert.equal(calls,2);await browser.evaluate("[...document.querySelectorAll('[data-public-progress-routes] button')].find(button=>button.textContent==='刷新本次结果').click()");
      for(const [index,status] of ['RECONCILIATION_REQUIRED','DEAD_LETTER'].entries())await browser.waitFor(`document.querySelector('[data-publication-id="${publication}"] [data-delivery-id="${ids[index]}"]')?.dataset.deliveryStatus==='${status}'`);
      assert.equal(await browser.evaluate(`document.querySelector('[data-delivery-id="${ids[0]}"]')?.textContent.includes('结果未知待核对')`),true);assert.equal(await browser.evaluate(`document.querySelector('[data-delivery-id="${ids[1]}"]')?.textContent.includes('发送失败')`),true);await capture('actual-route-results');assert.equal((await get(path+'/commands/'+text(original.client_command_id))).body.state,'COMMITTED');assert.deepEqual(await browser.evaluate('globalThis.__t31Posts'),[]);
    }catch(e){error=e;}await closeBrowserTestResources([()=>senderRuntime.stop()],error);
  });
});

test('T31 a held real public page cannot repopulate the projection or draft after current purpose loss',async()=>{
  await t31Browser('t31late',async({browser,incidentId,pool,f,post,put})=>{
    const path='/api/incidents/'+incidentId,summary='合成晚到公开记录：失权后停止展示';assert.equal((await post(path+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary,preview_confirmed:true})).status,200);
    await put('合成尚未提交的独立摘要');await browser.waitFor('document.querySelector("[data-public-progress-draft]")?.textContent.includes("已保存恢复副本")');
    await browser.evaluate("(()=>{const send=fetch;globalThis.__t31Held=[];globalThis.__t31Hold=true;globalThis.fetch=async(path,options)=>{if(globalThis.__t31Hold&&(!options?.method||options.method==='GET')&&String(path).includes('/public-progress')){const response=await send(path,options),bytes=await response.arrayBuffer(),headers=[...response.headers];return new Promise(resolve=>globalThis.__t31Held.push(()=>resolve(new Response(bytes,{status:response.status,headers}))));}return send(path,options);};})()");
    await browser.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='回到公开进展起点').click()");await browser.waitFor('globalThis.__t31Held.length>0');
    const admin=text(record(f.admin).id);await pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$1::uuid WHERE id=$2::uuid',[admin,text(record(f.reports[0]).ticketId)]);await pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[admin]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[admin]);
    await browser.evaluate('document.querySelector("[data-action=refresh-incident]").click()');await browser.waitFor('document.querySelector("[data-public-progress-outcome]")?.textContent.includes("已失权")');await browser.evaluate('globalThis.__t31Hold=false;for(const release of globalThis.__t31Held)release();globalThis.__t31Held=[];');
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="已发布公开进展"]')?.textContent.includes(${JSON.stringify(summary)})`),false);assert.equal(await browser.evaluate('Boolean(document.querySelector("textarea[aria-label=公开进展摘要]"))'),false);await browser.waitFor(inspectT31Drafts+'.then(copy=>copy.drafts.length===0)');
  });
});
