import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';

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
    }catch(failure){error=failure;try{if(browser){await mkdir(directory,{recursive:true});const bytes=Buffer.from(await browser.screenshot(),'base64'),file=join(directory,'new-detail-1920.png');await writeFile(file,bytes);console.log('WEB01_BROWSER '+JSON.stringify({screenshots:[{file,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:createHash('sha256').update(bytes).digest('hex')}]}));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
    await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
  },{ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true,...options});
}

test('the production detail names the sole conversation action without an extra selection and retains the 720px shell',async()=>{
  await browserScenario(async({browser,capture})=>{
    await browser.waitFor('Boolean(document.querySelector(".ds-detail-view #detail-title"))');
    assert.equal(await browser.evaluate('Boolean(document.querySelector(".ticket-conversation-handling"))'),true);
    await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.textContent==="领取并开始"');
    assert.equal(await browser.evaluate('[...document.querySelectorAll("[data-session-choice] input[type=checkbox]")].filter(e=>e.checkVisibility()).length'),0);
    await browser.evaluate('document.querySelector("[aria-label=接单选项]").click()');await browser.waitFor('Boolean(document.querySelector(".detail-accept-dialog"))');
    await browser.waitFor('[...document.querySelectorAll("[data-session-choice] input[type=checkbox]")].filter(e=>e.checkVisibility()).length===1');
    assert.equal(await browser.evaluate('Math.round(document.querySelector(".detail-dialog").getBoundingClientRect().width)'),720);
    await capture('new-detail-1920.png');
  });
});

test('a temporary draft authorization failure does not trap a read-only detail without input',async()=>{
  await browserScenario(async({browser,principals,tickets})=>{
    const ticketId=tickets[0].ticket.id,scope={principal:principals[0].id,kind:'ticket',id:ticketId,purpose:'internal-note'};
    await openOptions(browser);
    await browser.evaluate(`(()=>{const read=fetch;globalThis.__t05BlockDraftBootstrap=false;globalThis.__t05DraftBootstrapFailed=false;fetch=async(path,options)=>{const url=String(path);if(url==='/api/lifecycle/bootstrap'&&globalThis.__t05BlockDraftBootstrap){globalThis.__t05DraftBootstrapFailed=true;return new Response('{}',{status:503,headers:{'content-type':'application/json'}});}const response=await read(path,options);if(url===${JSON.stringify('/api/tickets/'+ticketId)}&&response.ok){const body=await response.clone().json();body.allowed_actions=body.allowed_actions.filter(action=>!['take-and-start-with-conversations','accept-for-later-with-conversations'].includes(action));return Response.json(body);}return response;};})()`);
    await browser.evaluate('document.querySelector("[data-action=refresh-conversation-handling]").click()');
    await browser.waitFor('!document.querySelector("[data-action=take-and-start-with-conversations]")');
    await browser.evaluate('globalThis.__t05BlockDraftBootstrap=true');
    const tab=await yxxTab(browser,new URL('/workbench/app/',await browser.evaluate('location.origin')).href);
    try{
      await tab.evaluate(`(()=>{const channel=new BroadcastChannel('wecom-workbench-drafts-v1');channel.postMessage({...${JSON.stringify(scope)},reason:'settled'});channel.close();})()`);
      await browser.waitFor('globalThis.__t05DraftBootstrapFailed===true');await browser.evaluate('new Promise(resolve=>setTimeout(resolve,100))');
      // The peer stays open. Return to the detail to exercise the user's Close action and drawer exit.
      await browser.command('Page.bringToFront');
      assert.equal(await browser.evaluate('document.querySelector("[aria-label=关闭详情]")?.disabled'),false);
      await browser.evaluate('document.querySelector("[aria-label=关闭详情]").click()');await browser.waitFor('!document.querySelector("#detail-title")');
      assert.match(await browser.evaluate('location.pathname'),/^\/workbench\/app\/?$/u);
    }finally{await tab.close();}
  },{workbenchDraftRecoveryEnabled:true});
});

test('refresh restores the explicit selection with its original Session version from the encrypted purpose copy',async()=>{
  await browserScenario(async({browser})=>{
    await openOptions(browser);
    await browser.waitFor('[...document.querySelectorAll("[data-session-choice] input[type=checkbox]")].filter(e=>e.checkVisibility()).length===1&&document.querySelector("[data-session-choice] input[type=checkbox]").disabled===false');
    await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").click()');
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-conversation-draft-status]"))'),true);
    await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');
    const original=await browser.evaluate('({id:document.querySelector("[data-session-choice]").dataset.sessionChoice,version:document.querySelector(".conversation-choices").innerText})');
    const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');
    await browser.waitFor(`performance.timeOrigin!==${previous}&&document.querySelector('[data-session-choice] input[type=checkbox]')?.checked===true`);
    assert.deepEqual(await browser.evaluate('({id:document.querySelector("[data-session-choice]").dataset.sessionChoice,version:document.querySelector(".conversation-choices").innerText})'),original);
    await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("已恢复")');
  },{workbenchDraftRecoveryEnabled:true});
});

const instrument="(()=>{const original=globalThis.fetch;globalThis.__t05Posts=[];globalThis.__t05Acks=[];globalThis.fetch=(path,options)=>{if(options?.method==='POST')globalThis.__t05Posts.push({path:String(path),body:JSON.parse(options.body)});if(String(path).includes('/conversation-handling-commands/'))globalThis.__t05Acks.push(String(path));return original(path,options);};})()";
async function reload(browser){const previous=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${previous}&&document.readyState==='complete'`);}
async function openOptions(browser){await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.disabled===false');await browser.evaluate('(()=>{if(document.querySelector(".detail-accept-dialog"))return;const options=document.querySelector("button[aria-label=接单选项]");(options??document.querySelector("[data-action=take-and-start-with-conversations]")).click();})()');await browser.waitFor('Boolean(document.querySelector(".detail-accept-dialog"))');}
async function choose(browser){await openOptions(browser);await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.disabled===false');await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").click()');await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.disabled===false');}

test('the real production selection submits one POST and refreshes both authoritative responsibilities at narrow width',async()=>{
  await browserScenario(async({browser,tickets,principals,capture})=>{
    await browser.evaluate(instrument);await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.textContent==="领取并开始"&&document.querySelector("[data-action=take-and-start-with-conversations]").disabled===false');
    assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[]);
    await browser.evaluate('document.querySelector("[data-action=take-and-start-with-conversations]").click()');
    await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已开始处理")&&document.querySelector(".properties")?.innerText.includes("处理中")');
    const posts=await browser.evaluate('globalThis.__t05Posts');assert.equal(posts.length,1);assert.equal(posts[0].body.sessions.length,1);assert.equal(posts[0].body.communication_choice,'TAKE_SELECTED');
    const current=await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}').then(r=>r.json())`);assert.equal(current.assignee_id,principals[0].id);assert.equal(current.handling_cycle.cycle_no,1);
    const assignment=await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}/responsibility').then(r=>r.json())`);assert.equal(assignment.conversations[0].conversation_principal_id,principals[0].id);
    await browser.command('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});
    assert.equal(await browser.evaluate('Math.round(document.querySelector(".detail-dialog").getBoundingClientRect().width)'),720);
    assert.equal(await browser.evaluate('document.querySelector(".detail-dialog").scrollWidth<=document.querySelector(".detail-dialog").clientWidth'),true);await capture('new-detail-900.png');
  });
});

test('a true Web Ticket explicitly retains communication without inventing a Session and disabled recovery does not open storage',async()=>{
  await browserScenario(async({browser,tickets})=>{
    await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.disabled===false');await browser.evaluate(instrument);
    assert.equal(await browser.evaluate('[...document.querySelectorAll("[data-session-choice] input[type=checkbox]")].filter(e=>e.checkVisibility()).length'),0);
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-conversation-draft-status]"))'),false);
    assert.deepEqual(await browser.evaluate('indexedDB.databases().then(rows=>rows.map(row=>row.name))'),[]);
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=retain-current-communicator]"))'),false);await browser.evaluate('document.querySelector("[data-action=take-and-start-with-conversations]").click()');
    await browser.waitFor('document.querySelector(".properties")?.innerText.includes("处理中")&&document.querySelector(".conversation-handling-state")?.textContent.includes("已开始处理")');
    const posts=await browser.evaluate('globalThis.__t05Posts');assert.equal(posts.length,1);assert.equal(posts[0].body.communication_choice,'RETAIN_CURRENT');assert.deepEqual(posts[0].body.sessions,[]);
    const current=await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}/responsibility').then(r=>r.json())`);assert.deepEqual(current.conversations,[]);
    assert.equal(await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}').then(r=>r.json()).then(value=>value.status)`),'IN_PROGRESS');
    assert.deepEqual(await browser.evaluate('indexedDB.databases().then(rows=>rows.map(row=>row.name))'),[]);
  },{ticketSelfHandlingWebSource:true});
});

test('the sole-session shortcut preserves its exact selection and UUID when the response is unknown',async()=>{
  await browserScenario(async({browser,runtime})=>{
    let malformed=true;runtime.server.on('request',(request,response)=>{if(!request.url?.endsWith('/take-and-start-with-conversations'))return;const end=response.end.bind(response);response.end=(...args)=>response.statusCode===200&&malformed?end('{"ok":true}'):end(...args);});
    await browser.evaluate(instrument);
    await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.textContent==="领取并开始"&&document.querySelector("[data-action=take-and-start-with-conversations]").disabled===false');
    await browser.evaluate('document.querySelector("[data-action=take-and-start-with-conversations]").click()');
    await browser.waitFor('/结果未知|结果未确认/u.test(document.querySelector(".conversation-handling-state")?.textContent??"")&&document.querySelector("[data-session-choice] input[type=checkbox]")?.checked===true');
    const posts=await browser.evaluate('globalThis.__t05Posts');assert.equal(posts.length,1);assert.equal(posts[0].body.sessions.length,1);
    malformed=false;await browser.evaluate('document.querySelector("[data-action=check-conversation-handling]").click()');
    await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已开始处理")');
    assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[posts[0],posts[0]],'only the explicit check may replay the identical original operation');
  });
});

test('a conversation assigned to another colleague still requires explicit selection',async()=>{
  await browserScenario(async({browser,pool,tickets,principals})=>{
    await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.textContent==="领取并开始"');
    const sessions=await pool.query('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[tickets[0].intake.intakeId]);assert.equal(sessions.rows.length,1);
    await pool.query("INSERT INTO conversation.assignment(session_id,assignment_status,assigned_principal_id,assigned_by_principal_id,assigned_at) VALUES($1::uuid,'ASSIGNED',$2::uuid,$3::uuid,platform.local_now()) ON CONFLICT(session_id) DO UPDATE SET assignment_status='ASSIGNED',assigned_principal_id=EXCLUDED.assigned_principal_id",[sessions.rows[0].id,principals[1].id,principals[0].id]);
    await reload(browser);await openOptions(browser);await browser.waitFor('[...document.querySelectorAll("[data-session-choice] input[type=checkbox]")].filter(e=>e.checkVisibility()).length===1');
    assert.equal(await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").checked'),false);
    assert.equal(await browser.evaluate('document.querySelector("[data-action=confirm-conversation-handling]").disabled'),true);
    assert.equal(await browser.evaluate('document.querySelector(".detail-action-hint")?.checkVisibility()??false'),false);
  });
});

for(const expires of [false,true])test('an UNKNOWN composite keeps its original identified selection through reload and '+(expires?'expires into safe read-only Ack':'replays only on explicit checking'),async()=>{
  await browserScenario(async({browser,runtime,tickets})=>{
    let malformed=true;runtime.server.on('request',(request,response)=>{if(!request.url?.endsWith('/take-and-start-with-conversations'))return;const end=response.end.bind(response);response.end=(...args)=>response.statusCode===200&&malformed?end('{"ok":true}'):end(...args);});
    await browser.evaluate(instrument);await choose(browser);await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');await browser.evaluate('document.querySelector("[data-action=confirm-conversation-handling]").click()');
    await browser.waitFor('/结果未知|结果未确认/u.test(document.querySelector(".conversation-handling-state")?.textContent??"")');const original=(await browser.evaluate('globalThis.__t05Posts'))[0];
    // The harness enables Runtime and Network; future-document scripts also require the Page domain.
    await browser.command('Page.enable');
    const beforeReload=await browser.evaluate('Date.now()');
    await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:(expires?"(()=>{const now=Date.now;Date.now=()=>now()+86400001;})()":"")+';'+instrument});await reload(browser);
    assert.equal(await browser.evaluate('Array.isArray(globalThis.__t05Posts)&&Array.isArray(globalThis.__t05Acks)'),true);
    if(expires)assert.ok(await browser.evaluate('Date.now()')>beforeReload+86400000);
    if(expires){
      await browser.waitFor('Boolean(document.querySelector("[data-action=check-expired-conversation-handling]"))&&document.body.innerText.includes("草稿已过期")');
      assert.equal(await browser.evaluate('document.querySelectorAll("[data-session-choice] input[type=checkbox]:checked").length'),0);
      const metadata=await browser.evaluate("new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.length,operations:operations.result});};};})");assert.equal(metadata.drafts,0);assert.equal(metadata.operations.length,1);assert.equal(metadata.operations[0].commandId,original.body.client_command_id);assert.equal(JSON.stringify(metadata).includes(original.body.sessions[0].session_id),false);
      await browser.evaluate('document.querySelector("[data-action=check-expired-conversation-handling]").click()');await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已核对原操作结果")');assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[]);assert.equal(await browser.evaluate('globalThis.__t05Acks.length'),1);
    }else{
      await browser.waitFor('Boolean(document.querySelector("[data-action=check-conversation-handling]"))&&document.querySelector("[data-session-choice] input[type=checkbox]")?.checked===true');assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[]);malformed=false;
      await browser.evaluate('document.querySelector("[data-action=check-conversation-handling]").click()');await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已开始处理")');assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[original]);
    }
    const current=await browser.evaluate(`fetch('/api/tickets/${tickets[0].ticket.id}').then(r=>r.json())`);assert.equal(current.version,4);assert.equal(current.handling_cycle.cycle_no,1);
  },{workbenchDraftRecoveryEnabled:true});
});

const storedCounts="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').count(),operations=tx.objectStore('operations').count();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result,operations:operations.result});};};})";
test('a real version conflict preserves the identified selection and its old version until explicit discard',async()=>{
  await browserScenario(async({browser,pool})=>{
    await browser.evaluate(instrument);await choose(browser);await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');
    const id=await browser.evaluate('document.querySelector("[data-session-choice]").dataset.sessionChoice');
    await pool.query('UPDATE conversation.session SET row_version=row_version+1 WHERE id=$1::uuid',[id]);
    await browser.evaluate('document.querySelector("[data-action=confirm-conversation-handling]").click()');
    await browser.waitFor(`[...document.querySelectorAll('.conversation-handling-state, [data-toast-source="ticket-conversation-handling"][data-toast-state="conflict"]')].some(message=>message.textContent.includes("已被他人更新"))&&document.querySelector(".conversation-choices")?.innerText.includes("内容已变化")`);
    assert.equal(await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").checked'),true);const posts=await browser.evaluate('globalThis.__t05Posts');assert.equal(posts.length,1);assert.equal(posts[0].body.sessions[0].session_id,id);assert.equal(posts[0].body.sessions[0].expected_row_version,1);
    await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');await reload(browser);await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.checked===true');
    assert.ok(await browser.evaluate('document.querySelector(".conversation-choices").innerText.includes("内容已变化")'));
    await browser.evaluate('document.querySelector("[data-action=discard-conversation-handling-draft]").click()');await browser.waitFor("!document.querySelector('.detail-accept-dialog')");await openOptions(browser);await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.checked===false');await browser.waitFor(`(async()=>{const counts=await (${storedCounts});return counts.drafts===0&&counts.operations===0;})()`);
  },{workbenchDraftRecoveryEnabled:true});
});

test('restore rejects an ended canonical choice and a fresh Ticket rejection clears its encrypted copy and private view',async()=>{
  await browserScenario(async({browser,pool,principals,tickets})=>{
    await choose(browser);await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');const id=await browser.evaluate('document.querySelector("[data-session-choice]").dataset.sessionChoice');
    await pool.query("UPDATE conversation.session SET status='ENDED',ended_at=platform.local_now(),close_reason='T05_SYNTHETIC_ENDED' WHERE id=$1::uuid",[id]);await reload(browser);
    await browser.waitFor('document.querySelector("[data-action=take-and-start-with-conversations]")?.disabled===false');await browser.waitFor(`(async()=>{const counts=await (${storedCounts});return counts.drafts===0&&counts.operations===0;})()`);
    assert.equal(await browser.evaluate('[...document.querySelectorAll("[data-session-choice] input[type=checkbox]")].filter(e=>e.checkVisibility()).length'),0);assert.equal(await browser.evaluate(`document.querySelector('.ticket-conversation-handling').innerText.includes(${JSON.stringify(id)})`),false);
    assert.equal(await browser.evaluate('Boolean(document.querySelector("[data-action=retain-current-communicator]"))'),false);
    await pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[principals[0].id]);await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[principals[0].id]);await pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[principals[0].id]);
    await browser.evaluate('document.querySelector("[data-action=take-and-start-with-conversations]").click()');await browser.waitFor('!document.querySelector(".ticket-conversation-handling")');await browser.waitFor(`(async()=>{const counts=await (${storedCounts});return counts.drafts===0&&counts.operations===0;})()`);
    assert.equal(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(tickets[0].ticket.id)})`),false);
  },{workbenchDraftRecoveryEnabled:true});
});

async function assertActionBlocked(browser,selector,{mayBeAbsent=false}={}){
 const result=await browser.evaluate(`(()=>{
   const button=document.querySelector(${JSON.stringify(selector)});
   if(!button)return {blocked:${mayBeAbsent},activated:false};
   const blocked=button.disabled||button.matches('[aria-disabled="true"]');
   let activated=false;
   const onClick=()=>{activated=true;};
   button.addEventListener('click',onClick);
   try{button.click();}finally{button.removeEventListener('click',onClick);}
   return {blocked,activated};
 })()`);
 assert.deepEqual(result,{blocked:true,activated:false},selector);
 // Card 35A keeps blocked actions focusable; real Enter and Space must not activate them either.
 if(!await browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.matches('[aria-disabled="true"]')===true`))return;
 await browser.evaluate(`(()=>{const read=fetch;globalThis.__blockedActionPosts=0;globalThis.__restoreBlockedActionFetch=()=>{fetch=read;};fetch=(path,options)=>{if(String(options?.method??'GET').toUpperCase()==='POST')globalThis.__blockedActionPosts++;return read(path,options);};document.querySelector(${JSON.stringify(selector)}).focus();})()`);
 try{
  for(const [key,code,windowsVirtualKeyCode] of [['Enter','Enter',13],[' ','Space',32]]){
   assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`),true,selector+' keeps focus');
   for(const type of ['keyDown','keyUp'])await browser.command('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode});
  }
  await browser.evaluate('new Promise(resolve=>setTimeout(resolve,200))');
  assert.equal(await browser.evaluate('globalThis.__blockedActionPosts'),0,selector+' keyboard activation stays blocked');
  assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(selector)})?.matches('[aria-disabled="true"]')`),true,selector);
 }finally{await browser.evaluate('globalThis.__restoreBlockedActionFetch?.()');}
}

for(const phase of ['before','after'])test('a temporary '+phase+'-save read failure preserves an independent choice',async()=>{
 await browserScenario(async({browser,principals,tickets})=>{
  const ticketId=tickets[0].ticket.id,scope={principal:principals[0].id,kind:'ticket',id:ticketId,purpose:'ticket-conversation-handling'};
  await openOptions(browser);await browser.waitFor('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]")?.disabled===false');
  await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]").click()');
  await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');
  const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')),recovery='/workbench/app/'+manifest['src/feedback-recovery.ts'].file;
  const tab=await yxxTab(browser,new URL('/workbench/app/',await browser.evaluate('location.origin')).href);
  try{
   await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreT05Timer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=TAKE_SELECTED]").click()');
   await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.disabled===false');
   const sessionId=await browser.evaluate('document.querySelector("[data-session-choice]").dataset.sessionChoice');
   await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").click()');
   await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+'),id=crypto.randomUUID();await store.saveDraft(copy.handle,copy.text,{commandId:id});globalThis.__finishT05Peer=()=>store.settleDraft(copy.handle,id,copy.handle.record.revision);})()');
   await browser.waitFor('Boolean(document.querySelector("[data-action=check-expired-conversation-handling]"))');
   await browser.evaluate(`(()=>{const read=fetch;let used=false;fetch=(path,options)=>{if(!used&&String(path).includes(${JSON.stringify(phase==='before'?'/api/lifecycle/bootstrap':'/api/conversations/')})){used=true;return Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));}return read(path,options);};})()`);
   await browser.evaluate('globalThis.__restoreT05Timer()');await tab.evaluate('globalThis.__finishT05Peer()');
   await browser.waitFor('document.body.innerText.includes('+JSON.stringify(phase==='before'?'本页输入未保存':'草稿暂未恢复')+')');
   if(phase==='before')await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("请先留在此页")');
   await assertActionBlocked(browser,'[data-action=take-and-start-with-conversations]',{mayBeAbsent:true});
   if(phase==='before')await assertActionBlocked(browser,'[data-action=confirm-conversation-handling]');
   const saved=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+');return {value:copy.text===null?null:JSON.parse(copy.text),operation:copy.handle.operation};})()');
   assert.equal(saved.operation,null);
   if(phase==='before'){assert.equal(saved.value,null);assert.equal(await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]")?.checked'),true);assert.equal(await browser.evaluate('document.body.innerText.includes("刷新页面后再试")'),false);}
   else{assert.equal(saved.value.choice,'TAKE_SELECTED');assert.equal(saved.value.sessions[0].session_id,sessionId);await reload(browser);await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.checked===true');}
  }finally{await tab.close();}
 },{workbenchDraftRecoveryEnabled:true});
});

test('a failed peer operation leaves this page\'s independent conversation choice visible',async()=>{
 await browserScenario(async({browser,principals,tickets})=>{
  const ticketId=tickets[0].ticket.id,scope={principal:principals[0].id,kind:'ticket',id:ticketId,purpose:'ticket-conversation-handling'};
  await openOptions(browser);await browser.waitFor('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]")?.disabled===false');
  await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]").click()');
  await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');
  const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')),recovery='/workbench/app/'+manifest['src/feedback-recovery.ts'].file;
  const tab=await yxxTab(browser,new URL('/workbench/app/',await browser.evaluate('location.origin')).href);
  try{
   await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreConflictTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=TAKE_SELECTED]").click()');
   await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.disabled===false');
   await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").click()');
   await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+'),id=crypto.randomUUID();await store.saveDraft(copy.handle,copy.text,{commandId:id});globalThis.__failT05Peer=()=>store.saveDraft(copy.handle,copy.text,{settledCommandId:id});})()');
   await browser.waitFor('Boolean(document.querySelector("[data-action=check-expired-conversation-handling]"))');
   await browser.evaluate("(()=>{const read=fetch;globalThis.__t05FailedSessionReads=0;fetch=(path,options)=>{if(String(path).includes('/api/conversations/')){globalThis.__t05FailedSessionReads++;return Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));}return read(path,options);};})()");
   await browser.evaluate('globalThis.__restoreConflictTimer()');await tab.evaluate('globalThis.__failT05Peer()');
   await browser.waitFor('globalThis.__t05FailedSessionReads>0&&document.body.innerText.includes("本页输入未保存")');
   assert.equal(await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]")?.checked'),true);
   assert.equal(await browser.evaluate('document.querySelector("[data-action=confirm-conversation-handling]")?.disabled'),true);
   const saved=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+');return {value:JSON.parse(copy.text),operation:copy.handle.operation};})()');
   assert.equal(saved.value.choice,'RETAIN_CURRENT');assert.equal(saved.operation,null);
  }finally{await browser.evaluate('globalThis.__restoreConflictTimer?.()');await tab.close();}
 },{workbenchDraftRecoveryEnabled:true});
});

test('checking a failed peer operation keeps the independent conversation selection visible',async()=>{
 await browserScenario(async({browser,principals,tickets})=>{
  const ticketId=tickets[0].ticket.id,scope={principal:principals[0].id,kind:'ticket',id:ticketId,purpose:'ticket-conversation-handling'},id=randomUUID();
  await openOptions(browser);await browser.waitFor('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]")?.disabled===false');await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]").click()');
  await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');
  const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')),recovery='/workbench/app/'+manifest['src/feedback-recovery.ts'].file,tab=await yxxTab(browser,new URL('/workbench/app/',await browser.evaluate('location.origin')).href);
  try{
   await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreT05CheckTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
   await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=TAKE_SELECTED]").click()');await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.disabled===false');await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").click()');
   await tab.evaluate(`(async()=>{const store=await import(${JSON.stringify(recovery)}),copy=await store.openDraft(${JSON.stringify(scope)}),value=JSON.parse(copy.text);value.pending={action:'take-and-start-with-conversations',command:{client_command_id:${JSON.stringify(id)},expected_version:1,reason_code:'WORKBENCH_TAKE_AND_START',resolver_team_id:'PILOT_IT',communication_choice:value.choice,sessions:[]}};await store.saveDraft(copy.handle,JSON.stringify(value),{commandId:${JSON.stringify(id)}});})()`);
   await browser.waitFor('Boolean(document.querySelector("[data-action=check-expired-conversation-handling]"))');await browser.evaluate('globalThis.__restoreT05CheckTimer()');
   await browser.evaluate(`(()=>{const read=fetch;fetch=(path,options)=>String(path).endsWith('/conversation-handling-commands/${id}')?Promise.resolve(Response.json({state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}})):read(path,options);})()`);
   await browser.evaluate(instrument);
   await browser.evaluate('document.querySelector("[data-action=check-expired-conversation-handling]").click()');
   await browser.waitFor('document.body.innerText.includes("本页输入未保存")');
   await browser.waitFor('document.querySelector(".conversation-handling-state")?.textContent.includes("已核对原操作失败")&&document.querySelector("[data-conversation-draft-status]")?.textContent.includes("另一页面仍有草稿")');
   assert.equal(await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]")?.checked'),true);assert.equal(await browser.evaluate('Boolean(document.querySelector(".detail-accept-dialog"))'),true);assert.equal(await browser.evaluate('document.querySelector("[data-action=confirm-conversation-handling]")?.disabled'),true);
   await assertActionBlocked(browser,'[data-action=confirm-conversation-handling]');
   assert.deepEqual(await browser.evaluate('globalThis.__t05Acks'),['/api/tickets/'+ticketId+'/conversation-handling-commands/'+id]);
   assert.deepEqual(await browser.evaluate('globalThis.__t05Posts'),[]);
  }finally{await browser.evaluate('globalThis.__restoreT05CheckTimer?.()');await tab.close();}
 },{workbenchDraftRecoveryEnabled:true});
});

test('a temporarily unavailable related list still shows this page\'s unsaved selected session',async()=>{
 await browserScenario(async({browser})=>{
  await openOptions(browser);await browser.waitFor('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]")?.disabled===false');
  await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]").click()');
  await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');
  await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreRelatedTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>ms===500?timer(()=>{},2147483647):timer(fn,ms,...args);})()");
  try{
   await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=TAKE_SELECTED]").click()');
   await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.disabled===false');
   const sessionId=await browser.evaluate('document.querySelector("[data-session-choice]").dataset.sessionChoice');
   await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").click()');
   await browser.evaluate("(()=>{const read=fetch;globalThis.__t05FailedRelatedReads=0;fetch=(path,options)=>{if(String(path).includes('/related-conversations?')){globalThis.__t05FailedRelatedReads++;return Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));}return read(path,options);};})()");
   await browser.evaluate('document.querySelector("[data-action=refresh-conversation-handling]").click()');
   await browser.waitFor('globalThis.__t05FailedRelatedReads>0&&Boolean(document.querySelector(".detail-accept-dialog .selected-sessions li"))');
   assert.equal(await browser.evaluate('document.querySelector("[data-action=confirm-conversation-handling]")?.disabled'),true);
   await browser.evaluate('document.querySelector(".detail-accept-dialog [data-action=toggle-full-numbers]").click()');
   assert.equal(await browser.evaluate('document.querySelector(".detail-accept-dialog .selected-sessions").innerText.includes('+JSON.stringify(sessionId)+')'),true);
  }finally{await browser.evaluate('globalThis.__restoreRelatedTimer?.()');}
 },{workbenchDraftRecoveryEnabled:true});
});

test('an unrelated settlement and temporary reauthorization failure never suggest refreshing an unsaved choice',async()=>{
 await browserScenario(async({browser,principals,tickets})=>{
  const ticketId=tickets[0].ticket.id,scope={principal:principals[0].id,kind:'ticket',id:ticketId,purpose:'ticket-conversation-handling'},other={...scope,purpose:'internal-note'};
  await openOptions(browser);await browser.waitFor('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]")?.disabled===false');
  await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=RETAIN_CURRENT]").click()');
  await browser.waitFor('document.querySelector("[data-conversation-draft-status]")?.textContent.includes("草稿已保存")');
  const manifest=JSON.parse(await readFile(new URL('../web/admin-workbench/.vite/manifest.json',import.meta.url),'utf8')),recovery='/workbench/app/'+manifest['src/feedback-recovery.ts'].file;
  const tab=await yxxTab(browser,new URL('/workbench/app/',await browser.evaluate('location.origin')).href);
  try{
   await browser.evaluate("(()=>{const timer=window.setTimeout;globalThis.__restoreRebaseTimer=()=>{window.setTimeout=timer;};window.setTimeout=(fn,ms,...args)=>{if(ms!==500)return timer(fn,ms,...args);globalThis.__flushRebaseTimer=()=>fn(...args);return timer(()=>{},2147483647);};})()");
   await browser.evaluate('document.querySelector(".detail-accept-dialog input[value=TAKE_SELECTED]").click()');
   await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.disabled===false');
   await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]").click()');await browser.waitFor('typeof globalThis.__flushRebaseTimer==="function"');
   await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(other)+'),id=crypto.randomUUID();await store.saveDraft(copy.handle,"{}",{commandId:id});await store.settleDraft(copy.handle,id,copy.handle.record.revision);})()');
   await browser.evaluate("(()=>{const read=fetch;let used=false;fetch=(path,options)=>{if(!used&&String(path)==='/api/lifecycle/bootstrap'){used=true;return Promise.resolve(new Response('{}',{status:503,headers:{'content-type':'application/json'}}));}return read(path,options);};})()");
   await browser.evaluate('globalThis.__restoreRebaseTimer();globalThis.__flushRebaseTimer()');
   await browser.waitFor('document.body.innerText.includes("本页输入未保存")');
   assert.equal(await browser.evaluate('document.querySelector("[data-session-choice] input[type=checkbox]")?.checked'),true);
   assert.equal(await browser.evaluate('document.body.innerText.includes("刷新页面后再试")'),false);
   assert.equal(await browser.evaluate('document.querySelector("[data-action=confirm-conversation-handling]")?.disabled'),true);
   await browser.evaluate('document.querySelector("[aria-label=关闭接单选项]").click()');
   await browser.waitFor('Boolean(document.querySelector("[data-action=show-unsaved-conversation-handling]"))');
   await browser.evaluate('document.querySelector("[data-action=show-unsaved-conversation-handling]").click()');
   await browser.waitFor('document.querySelector("[data-session-choice] input[type=checkbox]")?.checked===true');
   const saved=await tab.evaluate('(async()=>{const store=await import('+JSON.stringify(recovery)+'),copy=await store.openDraft('+JSON.stringify(scope)+');return JSON.parse(copy.text);})()');
   assert.equal(saved.choice,'RETAIN_CURRENT');
  }finally{await browser.evaluate('globalThis.__restoreRebaseTimer?.()');await tab.close();}
 },{workbenchDraftRecoveryEnabled:true});
});
