import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

async function browserScenario(run,options={}){
  await withWeb01Fixture(async fixture=>{
    await fixture.runtime.coordinator.runOnce();
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());
    let browser,error;const screenshots=[];
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+fixture.tickets[0].ticket.id,width:1920,height:1080,cookies:[fixture.browserCookies[0]]});
      const capture=async name=>{await mkdir(directory,{recursive:true});const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,name);await writeFile(file,bytes);screenshots.push({file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')});};
      await browser.waitFor('Boolean(document.querySelector("#detail-title"))');
      await run({...fixture,browser,capture});
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',ticket_conversation_self_handling:true,screenshots}));
    }catch(failure){error=failure;if(browser){await mkdir(directory,{recursive:true});const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,bytes);console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true,...options});
}

test('the production detail presents explicit real Session selection and retains the 600px shell',async()=>{
  await browserScenario(async({browser,capture})=>{
    assert.equal(await browser.evaluate('Boolean(document.querySelector(".ticket-conversation-handling"))'),true);
    await browser.waitFor('document.querySelectorAll("[data-session-choice]").length===1');
    assert.equal(await browser.evaluate('Math.round(document.querySelector(".detail-dialog").getBoundingClientRect().width)'),600);
    await capture('new-detail-1920.png');
  });
});

test('refresh restores the explicit selection with its original Session version from the encrypted purpose copy',async()=>{
  await browserScenario(async({browser})=>{
    await browser.waitFor('document.querySelectorAll("[data-session-choice]").length===1&&document.querySelector("[data-session-choice]").disabled===false');
    await browser.evaluate('document.querySelector("[data-session-choice]").click()');
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-conversation-draft-status]"))'),true);
    await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("已保存恢复副本")');
    const original=await browser.evaluate('({id:document.querySelector("[data-session-choice]").dataset.sessionChoice,version:document.querySelector(".conversation-choices").innerText})');
    const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
    await browser.waitFor(`performance.timeOrigin!==${previous}&&document.querySelector('[data-session-choice]')?.checked===true`);
    assert.deepEqual(await browser.evaluate('({id:document.querySelector("[data-session-choice]").dataset.sessionChoice,version:document.querySelector(".conversation-choices").innerText})'),original);
    await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("已恢复")');
  },{workbenchDraftRecoveryEnabled:true});
});

const instrument="(()=>{const original=globalThis.fetch;globalThis.__t05Posts=[];globalThis.__t05Acks=[];globalThis.fetch=(path,options)=>{if(options?.method==='POST')globalThis.__t05Posts.push({path:String(path),body:JSON.parse(options.body)});if(String(path).includes('/conversation-handling-commands/'))globalThis.__t05Acks.push(String(path));return original(path,options);};})()";
async function reload(browser){const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}
async function choose(browser){await browser.waitFor('document.querySelector("[data-session-choice]")?.disabled===false');await browser.evaluate('document.querySelector("[data-session-choice]").click()');await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.disabled===false');}

test('the real production selection submits one POST and refreshes both authoritative responsibilities at narrow width',async()=>{
  await browserScenario(async({browser,tickets,principals,capture})=>{
    await browser.evaluate(instrument);await choose(browser);await browser.evaluate('document.querySelector("[data-action=take-and-start-with-conversations]").click()');
    await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已开始处理")&&document.querySelector(".properties")?.innerText.includes("处理中")');
    const posts=await browser.evaluate('globalThis.__t05Posts');assert.equal(posts.length,1);assert.equal(posts[0].body.sessions.length,1);assert.equal(posts[0].body.communication_choice,'TAKE_SELECTED');
    const current=await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}').then(r=>r.json())`);assert.equal(current.assignee_id,principals[0].id);assert.equal(current.handling_cycle.cycle_no,1);
    const assignment=await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}/responsibility').then(r=>r.json())`);assert.equal(assignment.conversations[0].conversation_principal_id,principals[0].id);
    await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});
    assert.equal(await browser.evaluate('Math.round(document.querySelector(".detail-dialog").getBoundingClientRect().width)'),600);
    assert.equal(await browser.evaluate('document.querySelector(".detail-dialog").scrollWidth<=document.querySelector(".detail-dialog").clientWidth'),true);await capture('new-detail-900.png');
  });
});

test('a true Web Ticket explicitly retains communication without inventing a Session and disabled recovery does not open storage',async()=>{
  await browserScenario(async({browser,tickets})=>{
    await browser.waitFor('document.querySelector("[data-action=retain-current-communicator]")?.disabled===false');await browser.evaluate(instrument);
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-session-choice]").length'),0);
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-conversation-draft-status]"))'),false);
    assert.deepEqual(await browser.evaluate('indexedDB.databases().then(rows=>rows.map(row=>row.name))'),[]);
    await browser.evaluate('document.querySelector("[data-action=retain-current-communicator]").click()');await browser.waitFor('document.querySelector("[data-action=accept-for-later-with-conversations]")?.disabled===false');await browser.evaluate('document.querySelector("[data-action=accept-for-later-with-conversations]").click()');
    await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已接单")');
    const posts=await browser.evaluate('globalThis.__t05Posts');assert.equal(posts.length,1);assert.equal(posts[0].body.communication_choice,'RETAIN_CURRENT');assert.deepEqual(posts[0].body.sessions,[]);
    const current=await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}/responsibility').then(r=>r.json())`);assert.deepEqual(current.conversations,[]);
    assert.deepEqual(await browser.evaluate('indexedDB.databases().then(rows=>rows.map(row=>row.name))'),[]);
  },{ticketSelfHandlingWebSource:true});
});

for(const expires of [false,true])test('an UNKNOWN composite keeps its original identified selection through reload and '+(expires?'expires into safe read-only Ack':'replays only on explicit checking'),async()=>{
  await browserScenario(async({browser,runtime,tickets})=>{
    let malformed=true;runtime.server.on('request',(request,response)=>{if(!request.url?.endsWith('/take-and-start-with-conversations'))return;const end=response.end.bind(response);response.end=(...args)=>response.statusCode===200&&malformed?end('{"ok":true}'):end(...args);});
    await browser.evaluate(instrument);await choose(browser);await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("已保存恢复副本")');await browser.evaluate('document.querySelector("[data-action=take-and-start-with-conversations]").click()');
    await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("结果未知")');const original=(await browser.evaluate('globalThis.__t05Posts'))[0];
    // The harness enables Runtime and Network; future-document scripts also require the Page domain.
    await browser.command('Page.enable');
    const beforeReload=await browser.evaluate('Date.now()');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:(expires?"(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()":"")+';'+instrument});await reload(browser);
    assert.equal(await browser.evaluate('Array.isArray(globalThis.__t05Posts)&&Array.isArray(globalThis.__t05Acks)'),true);
    if(expires)assert.ok(await browser.evaluate('Date.now()')>beforeReload+86400000);
    if(expires){
      await browser.waitFor('Boolean(document.querySelector("[data-action=check-expired-conversation-handling]"))&&document.body.innerText.includes("草稿已过期")');
      assert.equal(await browser.evaluate('document.querySelectorAll("[data-session-choice]:checked").length'),0);
      const metadata=await browser.evaluate("new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.length,operations:operations.result});};};})");assert.equal(metadata.drafts,0);assert.equal(metadata.operations.length,1);assert.equal(metadata.operations[0].commandId,original.body.client_command_id);assert.equal(JSON.stringify(metadata).includes(original.body.sessions[0].session_id),false);
      await browser.evaluate('document.querySelector("[data-action=check-expired-conversation-handling]").click()');await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已核对原操作结果")');assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[]);assert.equal(await browser.evaluate('globalThis.__t05Acks.length'),1);
    }else{
      await browser.waitFor('Boolean(document.querySelector("[data-action=check-conversation-handling]"))&&document.querySelector("[data-session-choice]")?.checked===true');assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[]);malformed=false;
      await browser.evaluate('document.querySelector("[data-action=check-conversation-handling]").click()');await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已开始处理")');assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[original]);
    }
    const current=await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}').then(r=>r.json())`);assert.equal(current.version,4);assert.equal(current.handling_cycle.cycle_no,1);
  },{workbenchDraftRecoveryEnabled:true});
});

const storedCounts="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').count(),operations=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result,operations:operations.result});};};})";
test('a real version conflict preserves the identified selection and its old version until explicit discard',async()=>{
  await browserScenario(async({browser,pool})=>{
    await browser.evaluate(instrument);await choose(browser);await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("已保存恢复副本")');
    const id=await browser.evaluate('document.querySelector("[data-session-choice]").dataset.sessionChoice');
    await pool.query('UPDATE conversation.session SET row_version=row_version+1 WHERE id=$1::uuid',[id]);
    await browser.evaluate('document.querySelector("[data-action=take-and-start-with-conversations]").click()');
    await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("操作冲突")&&document.querySelector(".conversation-choices")?.innerText.includes("已变更")');
    assert.equal(await browser.evaluate('document.querySelector("[data-session-choice]").checked'),true);const posts=await browser.evaluate('globalThis.__t05Posts');assert.equal(posts.length,1);assert.equal(posts[0].body.sessions[0].session_id,id);assert.equal(posts[0].body.sessions[0].expected_row_version,1);
    await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("已保存恢复副本")');await reload(browser);await browser.waitFor('document.querySelector("[data-session-choice]")?.checked===true');
    assert.ok(await browser.evaluate('document.querySelector(".conversation-choices").innerText.includes("已变更")'));
    await browser.evaluate('document.querySelector("[data-action=discard-conversation-handling-draft]").click()');await browser.waitFor('document.querySelector("[data-session-choice]")?.checked===false');await browser.waitFor(`(async()=>{const counts=await (${storedCounts});return counts.drafts===0&&counts.operations===0;})()`);
  },{workbenchDraftRecoveryEnabled:true});
});

test('restore rejects an ended canonical choice and a fresh Ticket rejection clears its encrypted copy and private view',async()=>{
  await browserScenario(async({browser,pool,principals,tickets})=>{
    await choose(browser);await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("已保存恢复副本")');const id=await browser.evaluate('document.querySelector("[data-session-choice]").dataset.sessionChoice');
    await pool.query("UPDATE conversation.session SET status='ENDED',ended_at=platform.local_now(),close_reason='T05_SYNTHETIC_ENDED' WHERE id=$1::uuid",[id]);await reload(browser);
    await browser.waitFor('document.querySelector(".ticket-conversation-handling")?.innerText.includes("已选择 0 个会话")');await browser.waitFor(`(async()=>{const counts=await (${storedCounts});return counts.drafts===0&&counts.operations===0;})()`);
    assert.equal(await browser.evaluate('document.querySelectorAll("[data-session-choice]").length'),0);assert.equal(await browser.evaluate(`document.querySelector('.ticket-conversation-handling').innerText.includes(${JSON.stringify(id)})`),false);
    await browser.waitFor('document.querySelector("[data-action=retain-current-communicator]")?.disabled===false');await browser.evaluate('document.querySelector("[data-action=retain-current-communicator]").click()');await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("已保存恢复副本")');
    await pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[principals[0].id]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[principals[0].id]);await pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principals[0].id]);
    await browser.evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent==="重新读取工单与会话").click()');await browser.waitFor('!document.querySelector(".ticket-conversation-handling")');await browser.waitFor(`(async()=>{const counts=await (${storedCounts});return counts.drafts===0&&counts.operations===0;})()`);
    assert.equal(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(tickets[0].ticket.id)})`),false);
  },{workbenchDraftRecoveryEnabled:true});
});
