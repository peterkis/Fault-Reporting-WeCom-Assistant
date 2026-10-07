import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
const counts="new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').count(),operations=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result,operations:operations.result});};};})";
async function type(browser,text){await browser.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");}

test('real mounted workbench logout revokes the persisted session and clears same-profile draft and private views in every tab',async()=>{
  await withWeb01Fixture(async({origin,backendOrigin,certificateSpki,browserCookies,cookies,sessionId,pool,tickets})=>{
    const ticketId=tickets[5].ticket.id,path='/workbench/app/items/ticket/'+ticketId+'?detail=page';let browser,tab,error;
    try{
      const headers={cookie:cookies[0]},bootstrap=await fetch(backendOrigin+'/api/lifecycle/bootstrap',{headers});assert.equal(bootstrap.status,200);
      const authority=await bootstrap.json();assert.ok(authority.csrf_token===browserCookies[1].value,'CURRENT_CSRF_BOUND');
      for(const extra of [{origin:'https://not-the-fixture.invalid','x-csrf-token':authority.csrf_token},{origin,'x-csrf-token':'invalid-synthetic'}]){assert.equal((await fetch(backendOrigin+'/workbench/logout',{method:'POST',headers:{...headers,...extra}})).status,403);}
      assert.equal((await pool.query('SELECT state FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid',[sessionId])).rows[0].state,'ACTIVE');
      browser=await launchSystemBrowser({url:origin+'/synthetic-start',width:900,height:900,certificateSpki,cookies:browserCookies});await browser.command('Page.navigate',{url:origin+path});
      await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await type(browser,'T03 real logout synthetic private draft');
      tab=await yxxTab(browser,origin+path);await tab.waitFor("document.querySelector('textarea')?.value==='T03 real logout synthetic private draft'");
      await browser.waitFor("Boolean(document.querySelector('[data-action=logout-workbench]'))");
      await browser.evaluate("(()=>{const original=fetch;globalThis.__logoutResults=[];globalThis.fetch=async(path,init)=>{const result=await original(path,init);if(String(path)==='/workbench/logout')globalThis.__logoutResults.push({status:result.status,body:await result.clone().json()});return result;};document.querySelector('[data-action=logout-workbench]').click();})()");
      await browser.waitFor("document.body.innerText.includes('已退出，当前浏览器的恢复副本已清理')&&!document.querySelector('textarea')");await tab.waitFor("!document.querySelector('textarea')&&!document.body.innerText.includes('住院部西区无线网络频繁断开')");
      assert.deepEqual(await browser.evaluate('globalThis.__logoutResults'),[{status:200,body:{logged_out:true}}]);assert.deepEqual(await browser.evaluate(counts),{drafts:0,operations:0});
      for(const path of ['/api/lifecycle/bootstrap','/api/tickets/'+ticketId])assert.equal((await fetch(backendOrigin+path,{headers})).status,401);
      const state=(await pool.query("SELECT state,revoked_epoch_ms IS NOT NULL AS revoked FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid",[sessionId])).rows[0];assert.deepEqual(state,{state:'REVOKED',revoked:true});
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM pilot_ticket.workbench_auth_event WHERE session_id=$1::uuid AND event_type='LOGOUT' AND reason_code='USER_LOGOUT'",[sessionId])).rows[0].n,1);
      await tab.close();tab=null;
    }catch(failure){error=failure;console.log('T03_LOGOUT_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}
    await closeBrowserTestResources([async()=>{await tab?.close();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true,realWorkbenchAuthentication:true});
});

test('trusted object rejection clears that encrypted copy and leaves a different authorized Ticket draft intact',async()=>{
  await withWeb01Fixture(async({origin,browserCookies,pool,principals,tickets})=>{
    let browser,error;const path=id=>origin+'/workbench/app/items/ticket/'+id+'?detail=page';
    try{
      browser=await launchSystemBrowser({url:path(tickets[4].ticket.id),width:900,height:900,cookies:[browserCookies[0]]});await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await type(browser,'T03 other authorized item draft');
      await browser.command('Page.navigate',{url:path(tickets[5].ticket.id)});await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");await type(browser,'T03 revoked item draft');
      await pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[principals[0].id]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[principals[0].id]);
      await pool.query("DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid",[principals[0].id]);await pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$2::uuid WHERE id=$1::uuid',[tickets[4].ticket.id,principals[0].id]);
      await browser.evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='重新读取工单动作').click()");await browser.waitFor("!document.querySelector('textarea')");
      const readKeys="new Promise(resolve=>{const request=indexedDB.open('wecom-workbench-drafts-v1');request.onsuccess=()=>{const db=request.result,read=db.transaction('drafts').objectStore('drafts').getAll();read.onsuccess=()=>{db.close();resolve(read.result.map(row=>row.id));};};})";
      await browser.waitFor(`(async()=>!(await (${readKeys})).includes(${JSON.stringify(tickets[5].ticket.id)}))()`);
      const keys=await browser.evaluate(readKeys);
      assert.deepEqual(keys,[tickets[4].ticket.id]);assert.equal(await browser.evaluate("document.body.innerText.includes('T03 revoked item draft')"),false);
    }catch(failure){error=failure;console.log('T03_REVOKED_DIAGNOSTIC '+JSON.stringify(browser?await browser.evaluate('({text:document.body.innerText})'):{}));}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:true});
});
