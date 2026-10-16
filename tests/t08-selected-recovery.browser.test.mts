// Registered original selected/purpose recovery tracer; initially NOT_RUN. Future location: tests/t08-selected-recovery.browser.test.mts.
// Exactly two production cases. The second needs only the fixture option forwarding described in its companion note.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withT08Fixture,object,rows,text} from './helpers/t08-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type Fact={order:number;method:string;path:string;status:number|null;body:unknown;reply:unknown;idempotency_key:string|null;if_match:string|null;csrf_present:boolean;origin_same:boolean};
type Screenshot={file:string;width:number;height:number;sha256:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const reasonInput="document.querySelector('.ticket-unassign textarea')",targetInput="document.querySelector('.ticket-unassign select')",draftStatus="document.querySelector('[data-unassign-draft-status]')";
const property=(label:string)=>`Array.from(document.querySelectorAll('.properties dt')).find(row=>row.textContent?.trim()===${JSON.stringify(label)})?.nextElementSibling?.textContent?.trim()`;
const queuedDom=`Boolean(document.querySelector('#detail-title'))&&(${property('状态')})==='待接单'&&(${property('处理责任')})==='等待领取'`;
const edit=(selector:string,value:string)=>`(()=>{const input=${selector};if(!input)throw Error('T08_PUBLIC_INPUT_MISSING');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`;
function header(request:IncomingMessage,name:string){const value=request.headers[name];return typeof value==='string'?value:null;}
function failure(value:unknown):unknown{return value instanceof AggregateError?{name:value.name,message:value.message,errors:value.errors.map(failure)}:value instanceof Error?{name:value.name,message:value.message,stack:value.stack}:String(value);}
async function reload(browser:Browser){const before=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${before}&&document.readyState==='complete'`);}
async function choose(browser:Browser,target:string){
 await browser.waitFor(`Boolean(${targetInput})&&(${targetInput}).disabled===false&&Array.from((${targetInput}).options).some(option=>option.value===${JSON.stringify(target)})`);
 await browser.evaluate(`(()=>{const input=${targetInput};Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(target)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await browser.waitFor(`(${targetInput})?.value===${JSON.stringify(target)}&&(${targetInput}).disabled===false`);
}
function stored(principal:string,ticketId:string,purpose:string){const scope=JSON.stringify([principal,'ticket',ticketId,purpose]);return `new Promise((resolve,reject)=>{
 const open=indexedDB.open('wecom-workbench-drafts-v1',2);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction(['drafts','operations'],'readonly'),record=tx.objectStore('drafts').get(${JSON.stringify(scope)}),operation=tx.objectStore('operations').get(${JSON.stringify(scope)});
 tx.onerror=()=>reject(tx.error);tx.onabort=()=>{db.close();reject(tx.error);};tx.oncomplete=()=>{db.close();const row=record.result;Promise.resolve(row?crypto.subtle.digest('SHA-256',row.ciphertext):null).then(digest=>resolve({revision:row?.revision??null,operation:operation.result?.commandId??null,ciphertext_sha256:digest?Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''):null})).catch(reject);};};})`;}

for(const temporary of [false,true])test(temporary
 ?'a temporary real target read failure preserves the encrypted selected draft, then current target revocation clears only unassign while Ticket READ and the internal-note copy survive'
 :'a production selected draft restores its current reason target canonical Session and version before one atomic Ticket withdrawal and Control transfer',async()=>{
 const options={ticketUnassignEnabled:true,ticketAssignmentEnabled:false,ticketConversationSelfHandlingEnabled:false,workbenchDraftRecoveryEnabled:true,
  workbenchConversationsEnabled:false,workbenchRealtimeEnabled:false,workbenchInternalNotesEnabled:temporary};
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,webPath='/api/workbench/items/ticket/'+ticketId;
  const target=fixture.otherHandler,targetPath=path+'/unassign/communication-targets',reason='T08 selected 内部撤派原因 '+randomUUID(),otherNote='T08 internal-note 独立保存内容 '+randomUUID();
  const bootstrap=await admin.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
  assert.equal(bootstrap.value.ticket_unassign_enabled,true);assert.equal(bootstrap.value.ticket_unassign_draft_recovery_enabled,true);
  assert.equal(bootstrap.value.ticket_assignment_enabled,false);assert.equal(bootstrap.value.ticket_conversation_self_handling_enabled,false);assert.equal(bootstrap.value.realtime_sse_enabled,false);
  assert.equal(bootstrap.value.internal_notes_enabled,temporary);if(temporary)assert.equal(bootstrap.value.draft_recovery_enabled,true);
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_SELECTED_RESTORE_REAL_ACCEPT'})).status,200);
  await fixture.runtime.coordinator.runOnce();const source=rows((await handler.get(path+'/responsibility')).value.conversations)[0];assert.ok(source);
  const sessionId=text(source.session_id),initialVersion=Number(source.session_row_version);assert.ok(Number.isSafeInteger(initialVersion)&&initialVersion>0);
  assert.equal((await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:initialVersion,reason_code:'T08_SELECTED_RESTORE_CONTROL'})).status,200);
  const before=(await admin.get(path)).value,beforeResponsibility=(await admin.get(path+'/responsibility')).value;
  assert.equal(before.status,'ACCEPTED');assert.equal(before.assignee_id,fixture.handler);assert.equal(before.version,2);
  assert.ok(Array.isArray(before.allowed_actions)&&before.allowed_actions.includes('unassign'));
  const current=rows(beforeResponsibility.conversations).find(row=>row.session_id===sessionId);assert.ok(current);assert.equal(current.conversation_principal_id,fixture.handler);
  const sessionVersion=Number(current.session_row_version);assert.ok(Number.isSafeInteger(sessionVersion)&&sessionVersion>0&&sessionVersion<=2147483647);
  const history=rows((await admin.get(path+'/events?limit=200')).value.items),delivery=(await admin.get(path+'/deliveries')).value;
  const beforeWeb=(await admin.get(webPath+'?limit=100')).value,external=rows(beforeWeb.records).filter(row=>row.audience==='EXTERNAL');
  const cookie=fixture.runtime.authenticate.browserCookies?.()[0];assert.ok(cookie);
  const requests:Fact[]=[],screenshots:Screenshot[]=[],directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
  let browser:Browser|undefined,primary:unknown,terminal:unknown,faultScript:string|null=null;
  const observe=(request:IncomingMessage,response:ServerResponse)=>{
   if(!request.headers.cookie?.split(';').some(part=>part.trim()===admin.cookie))return;
   const url=new URL(request.url??'/',fixture.origin);if(!url.pathname.startsWith('/api/'))return;
   const fact:Fact={order:requests.length,method:request.method??'',path:url.pathname,status:null,body:null,reply:null,idempotency_key:header(request,'idempotency-key'),if_match:header(request,'if-match'),csrf_present:typeof request.headers['x-csrf-token']==='string'&&request.headers['x-csrf-token'].length>0,origin_same:request.headers.origin===fixture.origin};requests.push(fact);
   response.once('finish',()=>{fact.status=response.statusCode;});
   if(fact.method==='POST'){
    request.pause();const chunks:Buffer[]=[];let size=0;
    request.on('data',(chunk:unknown)=>{const bytes=Buffer.isBuffer(chunk)?chunk:typeof chunk==='string'?Buffer.from(chunk):null;if(bytes){size+=bytes.length;if(size<=32768)chunks.push(bytes);}});
    request.once('end',()=>{if(size<=32768){try{fact.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fact.body=null;}}});
    const end=response.end.bind(response);response.end=((...args:Parameters<ServerResponse['end']>)=>{const bytes=args[0];if(typeof bytes==='string'||Buffer.isBuffer(bytes)){try{fact.reply=JSON.parse(bytes.toString());}catch{fact.reply=null;}}return end(...args);}) as ServerResponse['end'];
   }
  };
  const restored=`(${reasonInput})?.value===${JSON.stringify(reason)}&&(${reasonInput}).disabled===false&&document.querySelector('.ticket-unassign input[value=TRANSFER_SELECTED]')?.checked&&(${targetInput})?.value===${JSON.stringify(target)}&&(${targetInput}).disabled===false&&document.querySelector('[data-session-choice="${sessionId}"]')?.checked&&document.querySelector('[data-action=unassign]')?.disabled===false`;
  const capture=async()=>{if(!browser)return;await browser.evaluate("document.querySelector('#detail-title')?.scrollIntoView({block:'start'})");const bytes=Buffer.from(text(await browser.screenshot()),'base64'),file=join(directory,'new-detail-600.png');assert.equal(bytes.readUInt32BE(16),600);assert.equal(bytes.readUInt32BE(20),1080);await writeFile(file,bytes);screenshots.push({file:file.replaceAll('\\','/'),width:600,height:1080,sha256:createHash('sha256').update(bytes).digest('hex')});};
  fixture.runtime.server.on('request',observe);
  try{
   browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticketId,width:600,height:1080,cookies:[{...cookie,url:fixture.origin+'/'}]});assert.ok(browser);
   await browser.waitFor(`Boolean(${reasonInput})&&(${reasonInput}).disabled===false&&(${draftStatus})?.textContent.includes('草稿仅在当前浏览器')`);
   await browser.evaluate(edit(reasonInput,reason));await browser.evaluate("document.querySelector('.ticket-unassign input[value=TRANSFER_SELECTED]').click()");await choose(browser,target);
   await browser.waitFor(`Boolean(document.querySelector('[data-session-choice="${sessionId}"]'))&&document.querySelector('[data-session-choice="${sessionId}"]').disabled===false`);
   await browser.evaluate(`document.querySelector('[data-session-choice="${sessionId}"]').click()`);
   await browser.waitFor(`(${draftStatus})?.textContent.includes('已保存恢复副本')&&(${restored})`);
   const original=object(await browser.evaluate(stored(fixture.admin,ticketId,'ticket-unassign')));assert.ok(original.revision);assert.equal(original.operation,null);
   let noteCopy:Record<string,unknown>|null=null;
   if(temporary){
    await browser.waitFor("document.querySelector('#internal-note')?.disabled===false&&document.querySelector('[data-draft-status]')?.textContent.includes('草稿仅在当前浏览器')");
    await browser.evaluate(edit("document.querySelector('#internal-note')",otherNote));await browser.waitFor("document.querySelector('[data-draft-status]')?.textContent.includes('已保存恢复副本')");
    noteCopy=object(await browser.evaluate(stored(fixture.admin,ticketId,'internal-note')));assert.ok(noteCopy.revision);assert.equal(noteCopy.operation,null);
    await browser.command('Page.enable');
    faultScript=text(object(await browser.command('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=fetch;globalThis.__t08FaultCount=0;globalThis.__t08RealTargetStatuses=[];globalThis.__t08ReadFault=true;globalThis.__t08RestoreRead=()=>{globalThis.__t08ReadFault=false;globalThis.fetch=original;};globalThis.fetch=async(input,init)=>{const response=await original(input,init),url=new URL(typeof input==='string'?input:input.url,location.href);if(globalThis.__t08ReadFault&&(!init?.method||init.method==='GET')&&url.pathname===${JSON.stringify(targetPath)}&&url.searchParams.get('target_principal_id')===${JSON.stringify(target)}){globalThis.__t08RealTargetStatuses.push(response.status);if(response.status===200){await response.arrayBuffer();globalThis.__t08FaultCount++;throw new TypeError('T08_SYNTHETIC_NETWORK_FAILURE_AFTER_REAL_TARGET_READ');}}return response;};})()`})).identifier);
   }
   assert.equal(requests.filter(row=>row.method==='POST').length,0);
   await reload(browser);
   if(temporary){
    await browser.waitFor(`(${draftStatus})?.textContent.includes('恢复核验暂时不可用')&&globalThis.__t08FaultCount>=1`);
    const statuses:unknown=await browser.evaluate('globalThis.__t08RealTargetStatuses');assert.ok(Array.isArray(statuses)&&statuses.length>=1&&statuses.every((status:unknown)=>status===200));
    assert.equal(await browser.evaluate(`(${reasonInput})?.value`),'');assert.equal(await browser.evaluate(`(${targetInput})?.value??null`),null);
    assert.equal(await browser.evaluate("document.querySelectorAll('.ticket-unassign [data-session-choice]:checked').length"),0);
    assert.equal(await browser.evaluate(`document.querySelector('.ticket-unassign')?.innerText.includes(${JSON.stringify(reason)})`),false);
    assert.deepEqual(await browser.evaluate(stored(fixture.admin,ticketId,'ticket-unassign')),original);
    await browser.waitFor(`document.querySelector('#internal-note')?.value===${JSON.stringify(otherNote)}`);assert.deepEqual(await browser.evaluate(stored(fixture.admin,ticketId,'internal-note')),noteCopy);
    assert.equal(requests.filter(row=>row.method==='POST').length,0);
    await browser.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:faultScript});faultScript=null;await browser.evaluate('globalThis.__t08RestoreRead()');
    await reload(browser);await browser.waitFor(restored);
    assert.deepEqual(await browser.evaluate(stored(fixture.admin,ticketId,'ticket-unassign')),original);assert.deepEqual(await browser.evaluate(stored(fixture.admin,ticketId,'internal-note')),noteCopy);
    assert.equal(requests.filter(row=>row.method==='POST').length,0);
    const identity=(await fixture.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[target])).rows[0];assert.ok(identity);
    const revoked=await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['REPORTER'],resolverTeamIds:[]});assert.equal(revoked.id,target);
    assert.equal((await admin.get(targetPath+'?target_principal_id='+target)).status,403);assert.deepEqual((await admin.get(path)).value,before);
    await reload(browser);await browser.waitFor(`(async()=>{const copy=await (${stored(fixture.admin,ticketId,'ticket-unassign')});return copy.revision===null&&copy.operation===null;})()`);
    assert.deepEqual(await browser.evaluate(stored(fixture.admin,ticketId,'internal-note')),noteCopy,'target revocation must not purge another purpose record');
    assert.equal(await browser.evaluate(`(${reasonInput})?.value`),'');assert.equal(await browser.evaluate(`(${targetInput})?.value??null`),null);
    assert.equal(await browser.evaluate("document.querySelectorAll('.ticket-unassign [data-session-choice]:checked').length"),0);
    // A fresh document after the authorized scoped cleanup uses the new storage epoch; no second business action.
    await reload(browser);await browser.waitFor(`document.querySelector('#internal-note')?.value===${JSON.stringify(otherNote)}&&Boolean(${reasonInput})&&(${reasonInput}).value===''&&(${reasonInput}).disabled===false`);
    assert.deepEqual(await browser.evaluate(stored(fixture.admin,ticketId,'internal-note')),noteCopy);
    assert.equal(await browser.evaluate("Array.from(document.querySelectorAll('.properties dt')).find(row=>row.textContent?.trim()==='处理责任')?.nextElementSibling?.querySelector('.owner-name')?.textContent?.trim()"),text(beforeResponsibility.ticket_assignee_name));
    assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual((await admin.get(path+'/responsibility')).value,beforeResponsibility);
    assert.deepEqual((await admin.get(path+'/events?limit=200')).value.items,history);assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);
    assert.equal(requests.filter(row=>row.method==='POST').length,0);
   }else{
    await browser.waitFor(restored);assert.deepEqual(await browser.evaluate(stored(fixture.admin,ticketId,'ticket-unassign')),original);
    assert.equal(requests.filter(row=>row.method==='POST').length,0,'current authorized restoration never submits');
    const renderedVersion=await browser.evaluate(`document.querySelector('[data-session-choice="${sessionId}"]')?.closest('li')?.textContent`);assert.ok(typeof renderedVersion==='string'&&renderedVersion.includes('版本 '+sessionVersion));
    await browser.evaluate("document.querySelector('[data-action=unassign]').click()");await browser.waitFor(queuedDom);
    const posts=requests.filter(row=>row.method==='POST');assert.equal(posts.length,1);const post=posts[0];assert.ok(post);assert.equal(post.path,path+'/unassign');assert.equal(post.status,200);
    const body=object(post.body),commandId=text(body.client_command_id);assert.match(commandId,UUID);assert.equal(post.idempotency_key,commandId);assert.equal(post.if_match,'"2"');assert.equal(post.csrf_present,true);assert.equal(post.origin_same,true);
    assert.deepEqual(body,{client_command_id:commandId,expected_version:2,reason_code:'WORKBENCH_UNASSIGN',reason,communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:target,sessions:[{session_id:sessionId,expected_row_version:sessionVersion}]});
    const reply=object(post.reply);assert.deepEqual(Object.keys(reply).sort(),['communication_choice','control_event_id','conversations','handling_cycle','ok','replayed','ticket_event_id','ticket_id','ticket_version']);assert.equal(reply.ok,true);assert.equal(reply.replayed,false);assert.equal(reply.ticket_id,ticketId);assert.equal(reply.ticket_version,3);assert.equal(reply.communication_choice,'TRANSFER_SELECTED');assert.equal(reply.control_event_id,null);assert.equal(reply.handling_cycle,null);
    const changed=rows(reply.conversations);assert.equal(changed.length,1);assert.equal(changed[0]?.session_id,sessionId);assert.equal(changed[0]?.session_row_version,sessionVersion+1);assert.equal(changed[0]?.changed,true);assert.match(text(changed[0]?.control_event_id),UUID);
    assert.ok(requests.some(row=>row.method==='GET'&&row.order>post.order&&row.status===200&&[path,webPath].includes(row.path)),'production browser rereads the current committed Ticket');
    const after=(await admin.get(path)).value,responsibility=(await admin.get(path+'/responsibility')).value;
    assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.version,3);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.equal(after.intake_id,before.intake_id);assert.equal(after.handling_cycle??null,null);
    const transferred=rows(responsibility.conversations).find(row=>row.session_id===sessionId);assert.ok(transferred);assert.equal(transferred.conversation_principal_id,target);assert.equal(transferred.session_row_version,String(sessionVersion+1));
    assert.deepEqual(rows(responsibility.conversations).filter(row=>row.session_id!==sessionId),rows(beforeResponsibility.conversations).filter(row=>row.session_id!==sessionId));
    const events=rows((await admin.get(path+'/events?limit=200')).value.items);assert.deepEqual(events.slice(0,-1),history);assert.equal(events.filter(row=>row.event_type==='ticket.unassigned').length,1);assert.equal(events.at(-1)?.event_id,reply.ticket_event_id);assert.equal(events.at(-1)?.old_status,'ACCEPTED');assert.equal(events.at(-1)?.new_status,'QUEUED');assert.equal(events.at(-1)?.has_internal_note,true);assert.equal(events.at(-1)?.has_external_note,false);
    assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);const web=(await admin.get(webPath+'?limit=100')).value;
    assert.deepEqual(rows(web.records).filter(row=>row.audience==='EXTERNAL'),external);assert.equal(rows(web.records).some(row=>row.audience==='EXTERNAL'&&typeof row.text==='string'&&row.text.includes(reason)),false);
    await browser.waitFor(`(async()=>{const copy=await (${stored(fixture.admin,ticketId,'ticket-unassign')});return copy.revision===null&&copy.operation===null;})()`);
    await reload(browser);await browser.waitFor(queuedDom);assert.equal(requests.filter(row=>row.method==='POST').length,1);
    assert.deepEqual((await admin.get(path+'/responsibility')).value,responsibility);assert.deepEqual((await admin.get(path+'/events?limit=200')).value.items,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);
   }
  }catch(error){primary=error;}
  finally{
   try{await closeBrowserTestResources([
    async()=>{if(browser&&faultScript){await browser.command('Page.removeScriptToEvaluateOnNewDocument',{identifier:faultScript});faultScript=null;await browser.evaluate('globalThis.__t08RestoreRead?.()');}},
    capture,
    async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
    async()=>{fixture.runtime.server.removeListener('request',observe);assert.equal((await fixture.runtime.observability.metrics()).sse_clients,0);},
   ],primary);}catch(error){terminal=error;}
   const diagnostic=join(tmpdir(),'t08-selected-recovery-diagnostic-'+randomUUID()+'.json');
   try{await writeFile(diagnostic,JSON.stringify({temporary,status:terminal?'FAIL':'BROWSER_SLICE_COMPLETE',requests,screenshots,...(terminal?{error:failure(terminal)}:{})},null,2));}catch(error){terminal=terminal?new AggregateError([terminal,error],'T08_BROWSER_AND_DIAGNOSTIC_FAILED'):error;}
   console.log('T08_SELECTED_RECOVERY_DIAGNOSTIC '+JSON.stringify({file:diagnostic.replaceAll('\\','/')}));
   console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',status:terminal?'FAIL':'BROWSER_SLICE_COMPLETE',selected_recovery:true,scenario:temporary?'TEMPORARY_READ_AND_OWN_PURPOSE_REVOCATION':'SELECTED_CURRENT_RESTORE_AND_REAL_COMMIT',screenshots}));
   if(terminal)throw terminal;
  }
 },options);
});
