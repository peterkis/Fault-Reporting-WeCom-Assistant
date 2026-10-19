import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import type {T11Fixture} from './helpers/t11-completion-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {yxxTab} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import type {IncomingMessage,ServerResponse} from 'node:http';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
async function completionBrowser(context:T11Fixture,run:(browser:Browser,capture:(name:string)=>Promise<void>)=>Promise<void>,{width=1920,page=false}:{width?:number;page?:boolean}={}){
  const ticket=context.tickets[0],cookie=context.browserCookies[0];assert.ok(ticket);assert.ok(cookie);assert.equal(typeof cookie.url,'string');
  const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  const screenshots:{file:string;width:number;height:number;sha256:string}[]=[];let browser:Browser|undefined,error:unknown;
  try{
    browser=await launchSystemBrowser({url:context.origin+'/workbench/app/items/ticket/'+ticket.ticket.id+(page?'?detail=page':''),width,height:1080,cookies:[{...cookie,url:cookie.url as string}]});assert.ok(browser);
    await browser.command('Page.enable');await browser.waitFor("Boolean(document.querySelector('#detail-title'))");
    const active=browser,capture=async(name:string)=>{const pixels=Buffer.from(await active.screenshot(),'base64'),file=join(directory,name);await writeFile(file,pixels);screenshots.push({file,width:pixels.readUInt32BE(16),height:pixels.readUInt32BE(20),sha256:createHash('sha256').update(pixels).digest('hex')});};
    await run(browser,capture);
    console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',staff_completion:true,screenshots}));
  }catch(failure){error=failure;try{if(browser){await writeFile(join(directory,'failure.png'),Buffer.from(await browser.screenshot(),'base64'));await writeFile(join(directory,'failure.json'),JSON.stringify(await browser.evaluate('({text:document.body.innerText,commands:globalThis.__t11Commands})')));}}catch(diagnosticFailure){error=new AggregateError([error,diagnosticFailure],'BROWSER_FAILURE_DIAGNOSTICS');}}
  await closeBrowserTestResources([async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});}],error);
}
async function type(browser:{evaluate:(expression:string)=>Promise<unknown>},selector:string,value:string){await browser.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
const instrument="(()=>{const original=globalThis.fetch;globalThis.__t11Commands=[];globalThis.__t11Reads=[];globalThis.fetch=(path,options)=>{if(options?.method==='POST')globalThis.__t11Commands.push({path:String(path),body:JSON.parse(options.body)});else globalThis.__t11Reads.push(String(path));return original(path,options);};})()";
async function reload(browser:Browser){const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${before}&&document.readyState==='complete'`);}
async function ready(browser:Browser,version=4){await browser.waitFor(`document.querySelector('.ticket-completion-version')?.textContent===${JSON.stringify('工单版本 '+version)}&&document.querySelector('[data-completion-draft-status]')?.textContent.includes('草稿仅在当前浏览器')`);}
async function saved(browser:Browser){await browser.waitFor("document.querySelector('[data-completion-draft-status]')?.textContent.includes('已保存恢复副本')");}
async function input(browser:Browser,process:string,summary:string){await type(browser,'#completion-process',process);await type(browser,'#completion-summary',summary);await browser.evaluate("document.querySelector('#completion-confirmed').click()");await browser.waitFor("document.querySelector('[data-action=complete-ticket]').disabled===false");}
const draftState="new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations']),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{db.close();resolve({drafts:drafts.result.map(row=>({id:row.id,purpose:row.purpose})),operations:operations.result.map(row=>({commandId:row.commandId,id:row.id,purpose:row.purpose,keys:Object.keys(row)}))});};};})";
function droppedCompletion(context:T11Fixture){
  let drop=true;
  const intercept=(request:IncomingMessage,response:ServerResponse)=>{if(drop&&request.method==='POST'&&/^\/api\/tickets\/[^/]+\/complete$/u.test(request.url??''))response.end=()=>{request.socket.destroy();return response;};};
  context.runtime.server.on('request',intercept);
  return {drop:()=>{drop=true;},restore:()=>{drop=false;},close:()=>context.runtime.server.removeListener('request',intercept)};
}
async function completionCount(context:T11Fixture,id:string){return (await context.pool.query<{n:number}>("SELECT count(*)::int AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.closed' AND reason_code='STAFF_COMPLETED'",[id])).rows[0]?.n;}

test('MVP without drafts completes take, wait, resume, completion, reopen and retake in the same document',async()=>{
  await withT11Fixture(async context=>{
    const id=await t11NewTicket(context),http=await t11Http(context);
    const boot=await (await http.get('/api/lifecycle/bootstrap')).json() as Record<string,unknown>;
    for(const key of ['draft_recovery_enabled','staff_completion_draft_recovery_enabled','ticket_conversation_draft_recovery_enabled','ticket_waiting_action_draft_recovery_enabled'])assert.equal(boot[key],false,key);
    await completionBrowser({...context,tickets:[{ticket:{id},intake:{intakeId:context.tickets[0]?.intake.intakeId??''}}]},async(browser,capture)=>{
      const documentStart=await browser.evaluate('performance.timeOrigin');await browser.evaluate(instrument);
      const take="[data-action='take-and-start-with-conversations']";
      await browser.waitFor("document.querySelector('[data-action=accept-for-later-with-conversations]')?.disabled===false");
      await browser.evaluate("document.querySelector('[data-action=accept-for-later-with-conversations]').click()");
      await browser.waitFor("document.querySelector('.properties')?.innerText.includes('已领取')&&document.querySelector('[data-action=take-and-start-with-conversations]')?.disabled===false");
      assert.equal(await browser.evaluate("document.querySelector('.workflow-next')?.textContent.includes('“'+document.querySelector('[data-action=take-and-start-with-conversations]').textContent+'”')"),true,'the next-step instruction names the actual start button after accepting for later');
      await browser.waitFor(`document.querySelector(${JSON.stringify(take)})?.disabled===false`);
      assert.equal(await browser.evaluate("Boolean(document.querySelector('.ticket-conversation-handling fieldset'))"),false,'no empty communication choice before taking an unlinked ticket');
      await browser.evaluate(`document.querySelector(${JSON.stringify(take)}).click()`);
      await browser.waitFor("document.querySelector('.properties')?.innerText.includes('处理中')&&Boolean(document.querySelector('#completion-process'))");
      await browser.evaluate("document.querySelector('[data-action=request-information]').click()");
      await type(browser,'[data-waiting-purpose=request-information] textarea','请电话补充合成设备的错误提示。');
      await browser.evaluate("document.querySelector('[data-waiting-purpose=request-information] button[type=submit]').click()");
      await browser.waitFor("document.querySelector('.properties')?.innerText.includes('等待补充')&&Boolean(document.querySelector('[data-action=resume]'))");
      await browser.evaluate("document.querySelector('[data-action=resume]').click()");
      await type(browser,'[data-waiting-purpose=resume] textarea','已电话收到合成错误提示，继续排查。');
      await browser.evaluate("document.querySelector('[data-waiting-purpose=resume] button[type=submit]').click()");
      await browser.waitFor("document.querySelector('.properties')?.innerText.includes('处理中')&&Boolean(document.querySelector('#completion-process'))");
      await input(browser,'内部合成排查过程，不能给报修人查看。','已恢复合成设备，请重试。');
      await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");
      await browser.waitFor("document.querySelector('.properties')?.innerText.includes('已关闭')&&Boolean(document.querySelector('#reopen-reason'))");
      const completed=await http.detail(id);assert.equal(completed.status,'CLOSED');assert.equal(completed.handling_cycle?.cycle_no,1);
      await type(browser,'#reopen-reason','电话回访确认同一故障仍未解决，请继续处理。');
      await browser.waitFor("document.querySelector('[data-action=reopen-ticket]')?.disabled===false");
      await browser.evaluate("document.querySelector('[data-action=reopen-ticket]').click()");
      await browser.waitFor(`document.querySelector('.properties')?.innerText.includes('重新报障')&&document.querySelector(${JSON.stringify(take)})?.disabled===false`);
      const reopened=await http.detail(id);assert.equal(reopened.status,'REOPENED');assert.equal(reopened.handling_cycle?.cycle_no,2);assert.notEqual(reopened.handling_cycle?.id,completed.handling_cycle?.id);assert.equal(reopened.handling_cycle?.first_responsibility_event_id,null);
      await browser.evaluate(`document.querySelector(${JSON.stringify(take)}).click()`);
      await browser.waitFor("document.querySelector('.properties')?.innerText.includes('处理中')");
      assert.equal(await browser.evaluate('performance.timeOrigin'),documentStart,'no reload required when the next action becomes available');
      const commands=await browser.evaluate('globalThis.__t11Commands') as {path:string;body:{client_command_id:string}}[];
      assert.equal(commands.length,7);assert.equal(new Set(commands.map(row=>row.body.client_command_id)).size,7);
      assert.equal(commands.filter(row=>row.path.endsWith('/complete')).length,1);assert.equal(commands.filter(row=>row.path.endsWith('/reopen')).length,1);
      const visible=String(await browser.evaluate("document.querySelector('.detail-body').innerText"));
      assert.doesNotMatch(visible,/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|\bSYSTEM\b|\bUUID\b|工单版本|ticket\.[a-z_]+/iu);
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-completion-draft-status],[data-conversation-draft-status],[data-reopen-draft-status]'))"),false);
      assert.equal(await completionCount(context,id),1);await capture('new-detail-1920.png');
    },{page:true});
  },{recoveryEnabled:false,conversationHandlingEnabled:true,reopenEnabled:true,waitingEnabled:true});
});

test('production 600px completion form requires independent confirmed summaries and closes with one POST and current GET facts',async()=>{
  await withT11Fixture(async context=>{
    const ticket=context.tickets[0];assert.ok(ticket);const http=await t11Http(context);await http.start(ticket.ticket.id);
    await completionBrowser(context,async(browser,capture)=>{
      await browser.waitFor("document.querySelector('.ticket-handling-version')?.textContent==='工单版本 4'");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('#completion-process'))"),true,'production completion form must exist');
      await browser.waitFor("document.querySelector('[data-completion-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
      assert.equal(await browser.evaluate("Math.round(document.querySelector('.detail-dialog').getBoundingClientRect().width)"),600);
      await browser.evaluate(instrument);
      await type(browser,'#completion-process','INTERNAL_T11_FORM_CANARY：独立排查过程');
      assert.equal(await browser.evaluate("document.querySelector('#completion-summary').value"),'');
      await type(browser,'#completion-summary','合成打印服务已恢复。');
      assert.equal(await browser.evaluate("document.querySelector('[data-action=complete-ticket]').disabled"),true);
      await browser.evaluate("document.querySelector('#completion-confirmed').click()");
      await type(browser,'#completion-summary','合成打印服务已恢复，请重试。');
      assert.equal(await browser.evaluate("document.querySelector('#completion-confirmed').checked"),false,'editing the external summary requires explicit confirmation again');
      await browser.evaluate("document.querySelector('#completion-confirmed').click()");
      await browser.waitFor("document.querySelector('[data-action=complete-ticket]').disabled===false");
      await capture('new-detail-1920.png');
      await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");
      await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('已完工')&&document.querySelector('.properties')?.innerText.includes('已关闭')&&document.querySelector('.ticket-completion-version')?.textContent==='工单版本 5'");
      const posts=await browser.evaluate('globalThis.__t11Commands') as {path:string;body:{internal_process:string;external_summary:string;external_summary_confirmed:boolean}}[];
      assert.equal(posts.length,1);assert.equal(posts[0]?.path,'/api/tickets/'+ticket.ticket.id+'/complete');
      assert.equal(posts[0]?.body.internal_process,'INTERNAL_T11_FORM_CANARY：独立排查过程');assert.equal(posts[0]?.body.external_summary,'合成打印服务已恢复，请重试。');assert.equal(posts[0]?.body.external_summary_confirmed,true);
      assert.equal(await browser.evaluate(`globalThis.__t11Reads.some(path=>path.startsWith('/api/tickets/${ticket.ticket.id}'))`),true);
      assert.equal((await http.detail(ticket.ticket.id)).status,'CLOSED');await capture('new-detail-page-1920.png');
    });
  });
});

test('completion purpose restores its encrypted independent fields with Notes disabled and discarding removes the copy without a command',async()=>{
  await withT11Fixture(async context=>{
    const id=context.tickets[0]?.ticket.id;assert.ok(id);const http=await t11Http(context);await http.start(id);
    const capability=await (await http.get('/api/lifecycle/bootstrap')).json() as Record<string,unknown>;
    assert.equal(capability.internal_notes_enabled,false);assert.equal(capability.draft_recovery_enabled,false);assert.equal(capability.staff_completion_draft_recovery_enabled,true);
    await completionBrowser(context,async(browser,capture)=>{
      await ready(browser);await browser.evaluate(instrument);
      await input(browser,'INTERNAL_T11_REFRESH_CANARY：独立排查过程','可公开的恢复结果。');await saved(browser);
      const cryptography=await browser.evaluate("(async()=>{const row=await new Promise((resolve,reject)=>{const open=indexedDB.open('wecom-workbench-drafts-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,read=db.transaction('drafts').objectStore('drafts').getAll();read.onsuccess=()=>{db.close();resolve(read.result.find(row=>row.purpose==='staff-completion'));};};});let exportError=null;try{await crypto.subtle.exportKey('raw',row.key);}catch(error){exportError=error.name;}return {extractable:row.key.extractable,algorithm:row.key.algorithm,exportError,ttl:row.expiresAt-row.firstSavedAt,plaintext:JSON.stringify(row).includes('INTERNAL_T11_REFRESH_CANARY'),bytes:row.ciphertext.byteLength};})()") as {extractable:boolean;algorithm:unknown;exportError:string;ttl:number;plaintext:boolean;bytes:number};
      assert.equal(cryptography.extractable,false);assert.deepEqual(cryptography.algorithm,{name:'AES-GCM',length:256});assert.equal(cryptography.exportError,'InvalidAccessError');assert.equal(cryptography.ttl,86400000);assert.equal(cryptography.plaintext,false);assert.ok(cryptography.bytes>16&&cryptography.bytes<=16400);
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument});await reload(browser);
      await browser.waitFor("document.querySelector('#completion-process')?.value==='INTERNAL_T11_REFRESH_CANARY：独立排查过程'&&document.querySelector('#completion-summary')?.value==='可公开的恢复结果。'");
      assert.equal(await browser.evaluate("document.querySelector('#completion-confirmed').checked"),false);assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),0);assert.equal(await browser.evaluate("document.querySelector('[data-action=complete-ticket]').disabled"),true);
      await capture('new-detail-1920.png');await browser.evaluate("document.querySelector('[data-action=discard-completion-draft]').click()");
      await browser.waitFor("document.querySelector('#completion-process')?.value===''&&document.querySelector('#completion-summary')?.value===''");
      await browser.waitFor(`(async()=>{const v=await (${draftState});return v.drafts.length===0&&v.operations.length===0;})()`);
      await reload(browser);await ready(browser);assert.equal(await browser.evaluate("document.querySelector('#completion-process').value"),'');assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),0);assert.equal(await completionCount(context,id),0);await capture('new-detail-page-1920.png');
    });
  },{notesEnabled:false});
});

test('lost real committed completion responses retain the original command and refresh recovers only its safe read-only receipt',async()=>{
  await withT11Fixture(async context=>{
    const id=context.tickets[0]?.ticket.id;assert.ok(id);const http=await t11Http(context);await http.start(id);const fault=droppedCompletion(context);
    try{await completionBrowser(context,async(browser,capture)=>{
      await ready(browser);await browser.evaluate(instrument);await input(browser,'INTERNAL_T11_UNKNOWN_CANARY：原处理过程','原对外结果。');await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");
      await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('结果未知')");
      const original=await browser.evaluate('globalThis.__t11Commands[0]') as {path:string;body:Record<string,unknown>};assert.equal(original.path,'/api/tickets/'+id+'/complete');assert.equal(original.body.expected_version,4);assert.equal(await completionCount(context,id),1);
      assert.equal(await browser.evaluate("document.querySelector('#completion-process').disabled&&document.querySelector('#completion-summary').disabled&&document.querySelector('[data-action=complete-ticket]').disabled"),true);
      assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),1);fault.restore();await browser.evaluate("document.querySelector('[data-action=check-completion]').click()");
      await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('已核对原操作结果')");assert.deepEqual(await browser.evaluate('globalThis.__t11Commands'),[original,original]);assert.equal(await completionCount(context,id),1);
      await browser.waitFor(`(async()=>{const v=await (${draftState});return v.drafts.length===0&&v.operations.length===0;})()`);await capture('new-detail-1920.png');
      const second=await t11NewTicket(context),secondStarted=await http.start(second);await browser.command('Page.navigate',{url:context.origin+'/workbench/app/items/ticket/'+second});await ready(browser,secondStarted.version);await browser.evaluate(instrument);fault.drop();
      await input(browser,'INTERNAL_T11_REFRESH_UNKNOWN_CANARY：刷新不得恢复','第二个安全结果。');await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('结果未知')");
      const unknown=await browser.evaluate('globalThis.__t11Commands[0]') as {path:string;body:{client_command_id:string}};assert.equal(await completionCount(context,second),1);
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument});await reload(browser);
      await browser.waitFor(`Boolean(document.querySelector('[data-action=check-completion-receipt]'))&&document.querySelector('.ticket-completion-version')?.textContent===${JSON.stringify('工单版本 '+(secondStarted.version+1))}`);
      assert.equal(await browser.evaluate("document.querySelector('#completion-process').value"),'');assert.equal(await browser.evaluate("document.querySelector('#completion-summary').value"),'');assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),0);
      const state=await browser.evaluate(draftState) as {drafts:unknown[];operations:{commandId:string;id:string;purpose:string;keys:string[]}[]};assert.equal(state.drafts.length,0);assert.equal(state.operations.length,1);assert.equal(state.operations[0]?.commandId,unknown.body.client_command_id);assert.equal(state.operations[0]?.purpose,'staff-completion');assert.equal(JSON.stringify(state).includes('INTERNAL_T11_REFRESH_UNKNOWN_CANARY'),false);
      assert.equal(await browser.evaluate("globalThis.__t11Reads.some(path=>path.includes('/completion/commands/'))"),false);
      fault.restore();await browser.evaluate("document.querySelector('[data-action=check-completion-receipt]').click()");await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('已核对原操作结果')");
      assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),0);assert.equal(await browser.evaluate(`globalThis.__t11Reads.filter(path=>path==='/api/tickets/${second}/completion/commands/${unknown.body.client_command_id}').length`),1);assert.equal(await completionCount(context,second),1);
      await browser.waitFor(`(async()=>{const v=await (${draftState});return v.drafts.length===0&&v.operations.length===0;})()`);await capture('new-detail-page-1920.png');
    });}finally{fault.close();}
  },{notesEnabled:false});
});

test('completion conflict preserves independent input and current refetch focus while trusted cross-tab loss fences a late real acknowledgement',async()=>{
  await withT11Fixture(async context=>{
    const id=context.tickets[0]?.ticket.id;assert.ok(id);const http=await t11Http(context);await http.start(id);
    await completionBrowser(context,async(browser,capture)=>{
      await ready(browser);await browser.evaluate(instrument);await input(browser,'INTERNAL_T11_CONFLICT_CANARY：保留独立过程','冲突前安全结果。');
      await browser.evaluate("(()=>{const original=fetch;globalThis.fetch=(path,options)=>options?.method==='POST'&&String(path).endsWith('/complete')?new Promise((resolve,reject)=>{globalThis.__releaseCompletionPost=()=>original(path,options).then(resolve,reject);}):original(path,options);})()");await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");await browser.waitFor("typeof globalThis.__releaseCompletionPost==='function'");
      const note=await http.post(id,'internal-notes',{client_command_id:randomUUID(),expected_version:4,reason_code:'T11_CONFLICT',note:'INTERNAL_T11_OTHER_NOTE',external_visible:false});assert.equal(note.status,200);
      await browser.evaluate('globalThis.__releaseCompletionPost()');await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('完工冲突')&&document.querySelector('.ticket-completion-version')?.textContent==='工单版本 5'");
      assert.equal(await browser.evaluate("document.querySelector('#completion-process').value"),'INTERNAL_T11_CONFLICT_CANARY：保留独立过程');assert.equal(await browser.evaluate("document.querySelector('#completion-summary').value"),'冲突前安全结果。');assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),1);assert.equal(await completionCount(context,id),0);
      await browser.evaluate("document.querySelector('#completion-process').focus();document.querySelector('[data-action=refresh-completion]').click()");await browser.waitFor("document.querySelector('.ticket-completion-version')?.textContent==='工单版本 5'&&document.querySelector('[data-action=complete-ticket]').disabled===false");assert.equal(await browser.evaluate('document.activeElement.id'),'completion-process');await capture('new-detail-1920.png');
      // From here use a second fixture with Notes disabled so Shell's completion-purpose gate is exercised.
      await browser.evaluate("document.querySelector('[data-action=discard-completion-draft]').click()");await browser.waitFor("document.querySelector('#completion-process')?.value===''");
    });
  });
  await withT11Fixture(async context=>{
    const id=context.tickets[0]?.ticket.id;assert.ok(id);const http=await t11Http(context);await http.start(id);
    await completionBrowser(context,async(browser,capture)=>{
      let tab:Awaited<ReturnType<typeof yxxTab>>|undefined;
      try{
        await ready(browser);await input(browser,'INTERNAL_T11_LOSS_CANARY：失权清理','失权前安全结果。');await saved(browser);
        tab=await yxxTab(browser,context.origin+'/workbench/app/items/ticket/'+id);await tab.waitFor("document.querySelector('#completion-process')?.value==='INTERNAL_T11_LOSS_CANARY：失权清理'");
        await browser.evaluate(instrument);await browser.evaluate("(()=>{const original=fetch;globalThis.fetch=async(path,options)=>{const result=await original(path,options);if(options?.method==='POST'&&String(path).endsWith('/complete')&&result.status===200)return new Promise(resolve=>{globalThis.__releaseCompletionAck=()=>resolve(result);}).then(value=>{globalThis.__lateCompletionAckReleased=true;return value;});return result;};})()");await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");await browser.waitFor("typeof globalThis.__releaseCompletionAck==='function'");assert.equal(await completionCount(context,id),1);
        await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[context.principals[0]?.id]);await tab.evaluate("document.querySelector('[data-action=refresh-completion]').click()");
        await tab.waitFor("!document.querySelector('#completion-process')&&document.body.innerText.includes('会话')");await browser.waitFor("!document.querySelector('#completion-process')&&document.body.innerText.includes('会话')");
        await browser.evaluate('globalThis.__releaseCompletionAck()');await browser.waitFor('globalThis.__lateCompletionAckReleased===true');assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),1);assert.equal(await browser.evaluate("document.body.innerText.includes('INTERNAL_T11_LOSS_CANARY')||document.body.innerText.includes('已完工')"),false);
        const commandId=await browser.evaluate('globalThis.__t11Commands[0].body.client_command_id');assert.equal((await context.pool.query<{state:string}>('SELECT state FROM pilot_ticket.ticket_command_receipt WHERE ticket_id=$1::uuid AND client_command_id=$2::uuid',[id,commandId])).rows[0]?.state,'COMMITTED');
        await browser.waitFor(`(async()=>{const v=await (${draftState});return v.drafts.length===0&&v.operations.length===0;})()`);assert.equal(await completionCount(context,id),1);await capture('new-detail-page-1920.png');
      }finally{await tab?.close();}
    });
  },{notesEnabled:false});
});

test('raw recovery false keeps completion available without IndexedDB or receipt access and only explicitly replays the same unknown command',async()=>{
  await withT11Fixture(async context=>{
    const id=context.tickets[0]?.ticket.id;assert.ok(id);const http=await t11Http(context);await http.start(id);
    const capability=await (await http.get('/api/lifecycle/bootstrap')).json() as Record<string,unknown>;assert.equal(capability.ticket_staff_completion_enabled,true);assert.equal(capability.internal_notes_enabled,false);assert.equal(capability.staff_completion_draft_recovery_enabled,false);
    const fault=droppedCompletion(context);
    try{await completionBrowser(context,async(browser,capture)=>{
      await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:instrument+";(()=>{const open=indexedDB.open.bind(indexedDB);globalThis.__t11IDBOpens=0;indexedDB.open=(...args)=>{globalThis.__t11IDBOpens++;return open(...args);};})()"});await reload(browser);await browser.waitFor("document.querySelector('.ticket-completion-version')?.textContent==='工单版本 4'");
      assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-completion-draft-status]'))"),false);
      await type(browser,'#completion-process','INTERNAL_T11_MEMORY_DISCARD');await browser.evaluate("document.querySelector('[data-action=discard-completion-draft]').click()");assert.equal(await browser.evaluate("document.querySelector('#completion-process').value"),'');
      await input(browser,'INTERNAL_T11_MEMORY_UNKNOWN：原正文','内存模式安全结果。');await browser.evaluate("document.querySelector('[data-action=complete-ticket]').click()");await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('结果未知')");
      const original=await browser.evaluate('globalThis.__t11Commands[0]');assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),1);assert.equal(await browser.evaluate("document.querySelector('[data-action=complete-ticket]').disabled&&document.querySelector('#completion-summary').disabled"),true);assert.equal(await browser.evaluate('globalThis.__t11IDBOpens'),0);await capture('new-detail-1920.png');
      fault.restore();await browser.evaluate("document.querySelector('[data-action=check-completion]').click()");await browser.waitFor("document.querySelector('.ticket-completion-state')?.textContent.includes('已核对原操作结果')");assert.deepEqual(await browser.evaluate('globalThis.__t11Commands'),[original,original]);assert.equal(await completionCount(context,id),1);assert.equal(await browser.evaluate('globalThis.__t11IDBOpens'),0);
      await reload(browser);await browser.waitFor("document.querySelector('.properties')?.innerText.includes('已关闭')");assert.equal((await http.detail(id)).version,5);assert.equal(await browser.evaluate("Boolean(document.querySelector('#completion-process'))"),false,'a completed round has no inactive completion editor');assert.equal(await browser.evaluate('globalThis.__t11Commands.length'),0);assert.equal(await browser.evaluate("globalThis.__t11Reads.some(path=>path.includes('/completion/commands/'))"),false);assert.equal(await browser.evaluate('globalThis.__t11IDBOpens'),0);assert.deepEqual(await browser.evaluate("indexedDB.databases().then(rows=>rows.map(row=>row.name))"),[]);await capture('new-detail-page-1920.png');
      assert.equal(await browser.evaluate("globalThis.__t11Reads.some(path=>path.includes('/assignment-targets'))"),false,'a closed readable Ticket must not request unavailable assignment targets');
      assert.equal((await http.get('/api/tickets/'+id+'/assignment-targets')).status,403,'closed Ticket read does not grant assignment authority');
    });}finally{fault.close();}
  },{notesEnabled:false,recoveryEnabled:false,assignmentEnabled:true});
});
