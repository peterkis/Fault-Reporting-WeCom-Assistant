// Original production PC tracer. Only SOURCE prepared: the actual form must fail before consumer implementation.
// One current HANDLER/default-retain workflow; real HTTP preconditions and real commit, no success handler.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withT09Fixture,object,rows,text,version} from './helpers/t09-fixture.mjs';
import type {T09Http} from './helpers/t09-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type RequestFact={order:number;method:string;path:string;status:number|null;body:unknown;idempotency_key:string|null;if_match:string|null;csrf_present:boolean;origin_same:boolean};
type Screenshot={file:string;width:number;height:number;sha256:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stages=['PC_DETAIL_REAL','FORM_PRESENT','DUAL_REQUIRED','PRE_SUBMIT_REFRESH_RESTORE','ACTUAL_POST_UNKNOWN','UNKNOWN_REFRESH_ORIGINAL_ID','EXPLICIT_SAFE_ACK','CURRENT_FACTS_AND_CLEANUP'] as const;
type Stage=typeof stages[number];
const root="document.querySelector('.ticket-return-to-dispatch')";
const input=(label:string)=>`Array.from((${root})?.querySelectorAll('textarea')??[]).find(row=>Array.from(row.labels??[]).some(label=>label.textContent?.includes(${JSON.stringify(label)})))`;
const reasonInput=input('停止原因'),unfinishedInput=input('未完成工作');
const action="document.querySelector('[data-action=return-to-dispatch]')",check="document.querySelector('[data-action=check-return-to-dispatch-command]')";
const property=(label:string)=>`Array.from(document.querySelectorAll('.properties dt')).find(row=>row.textContent?.trim()===${JSON.stringify(label)})?.nextElementSibling?.textContent?.trim()`;
const queued=`Boolean(document.querySelector('#detail-title'))&&(${property('状态')})==='待接单'&&(${property('处理责任')})==='等待领取'`;
const fill=(selector:string,value:string)=>`(()=>{const row=${selector};if(!(row instanceof HTMLTextAreaElement))throw Error('T09_REQUIRED_TEXTAREA_MISSING');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(row,${JSON.stringify(value)});row.dispatchEvent(new Event('input',{bubbles:true}));})()`;
function copies(principal:string,ticket:string){
  const filter=`row.principal===${JSON.stringify(principal)}&&row.kind==='ticket'&&row.id===${JSON.stringify(ticket)}&&row.purpose==='ticket-return-to-dispatch'`;
  return `new Promise((resolve,reject)=>{const request=indexedDB.open('wecom-workbench-drafts-v1',2);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['drafts','operations'],'readonly'),drafts=tx.objectStore('drafts').getAll(),operations=tx.objectStore('operations').getAll();tx.oncomplete=()=>{const result={drafts:drafts.result.filter(row=>${filter}).map(row=>({purpose:row.purpose,revision:row.revision,firstSavedAt:row.firstSavedAt,expiresAt:row.expiresAt,bytes:row.ciphertext.byteLength,extractable:row.key.extractable,algorithm:row.key.algorithm.name,keys:Object.keys(row)})),operations:operations.result.filter(row=>${filter})};db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error);};};})`;
}
function failureDetails(value:unknown):Record<string,unknown>{
  return value instanceof AggregateError?{name:value.name,message:value.message,errors:Array.from(value.errors,(nested:unknown)=>failureDetails(nested))}
    :value instanceof Error?{name:value.name,message:value.message,stack:value.stack}:{value:String(value)};
}
async function publicGet(http:T09Http,path:string){const response=await http.get(path);assert.equal(response.status,200,path);return response.value;}
function header(request:IncomingMessage,name:string){const value=request.headers[name];return typeof value==='string'?value:null;}
function safeRequest(fact:RequestFact){
  const encoded=JSON.stringify(fact.body),body=fact.body&&typeof fact.body==='object'&&!Array.isArray(fact.body)?fact.body:null;
  const {body:_body,...safe}=fact;
  return {...safe,body_keys:body?Object.keys(body):[],body_sha256:typeof encoded==='string'?createHash('sha256').update(encoded).digest('hex'):null};
}

// Existing host budget and browser launch/wait defaults; no timeout override or source runtime fallback.
test('production PC current handler restores two required inputs and returns a real WAITING_VENDOR Ticket retaining communication, then reconciles only the original UNKNOWN command through GET',async()=>{
  await withT09Fixture(async fixture=>{
    const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,webPath='/api/workbench/items/ticket/'+ticketId;
    const bootstrap=await publicGet(handler,'/api/lifecycle/bootstrap');assert.equal(bootstrap.principal_id,fixture.handler);
    assert.ok(Array.isArray(bootstrap.roles)&&bootstrap.roles.includes('HANDLER'));
    // This existing sibling capability proves only the transparent raw option; never supplies a T09 action or form.
    assert.equal(bootstrap.ticket_unassign_draft_recovery_enabled,true);assert.equal(bootstrap.realtime_sse_enabled,false);
    const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));
    await fixture.runtime.coordinator.runOnce();
    const related=rows((await publicGet(handler,path+'/responsibility')).conversations);assert.equal(related.length,1);const source=related[0];assert.ok(source);const sessionId=text(source.session_id);
    const taken=await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(Number(text(source.session_row_version))),reason_code:'T09_PC_REAL_COMMUNICATOR'});assert.equal(taken.status,200,JSON.stringify(taken.value));
    for(const[actionName,reasonCode]of[['accept','T09_PC_REAL_ACCEPT'],['start','T09_PC_REAL_START'],['wait-vendor','T09_PC_REAL_WAIT']]as const){const response=await handler.post(path+'/'+actionName,{client_command_id:randomUUID(),expected_version:version((await publicGet(handler,path)).version),reason_code:reasonCode});assert.equal(response.status,200,JSON.stringify(response.value));}
    const before=await publicGet(handler,path),beforeResponsibility=await publicGet(handler,path+'/responsibility'),history=rows((await publicGet(handler,path+'/events?limit=200')).items),deliveries=await publicGet(handler,path+'/deliveries');
    assert.equal(before.status,'WAITING_VENDOR');assert.equal(before.assignee_id,fixture.handler);assert.equal(before.resolver_team_id,'PILOT_IT');
    const cycle=object(before.handling_cycle);assert.equal(cycle.cycle_no,1);assert.equal(cycle.first_responsibility_event_id,assigned.value.ticket_event_id);
    assert.ok(history.some(event=>event.event_type==='ticket.started'));assert.ok(history.some(event=>event.event_type==='ticket.waiting_vendor'));
    assert.equal(rows(beforeResponsibility.conversations).find(row=>row.session_id===sessionId)?.conversation_principal_id,fixture.handler);
    assert.equal(rows(deliveries.items).filter(row=>row.notification_type==='TICKET_ACCEPTED').length,1);
    const beforeWeb=await publicGet(handler,webPath+'?limit=100'),external=rows(beforeWeb.records).filter(row=>row.audience==='EXTERNAL');
    const ownerName=text(beforeResponsibility.ticket_assignee_name),cookie=fixture.runtime.authenticate.browserCookies?.()[2];assert.ok(cookie);
    const cookieHeader=cookie.name+'='+cookie.value,requests:RequestFact[]=[];
    const observe=(request:IncomingMessage,response:ServerResponse)=>{
      if(!request.headers.cookie?.split(';').some(part=>part.trim()===cookieHeader))return;
      const url=new URL(request.url??'/',fixture.origin);if(!url.pathname.startsWith('/api/'))return;
      const fact:RequestFact={order:requests.length,method:request.method??'',path:url.pathname,status:null,body:null,idempotency_key:header(request,'idempotency-key'),if_match:header(request,'if-match'),csrf_present:typeof request.headers['x-csrf-token']==='string'&&request.headers['x-csrf-token'].length>0,origin_same:request.headers.origin===fixture.origin};
      requests.push(fact);response.once('finish',()=>{fact.status=response.statusCode;});
      if(fact.method==='POST'){request.pause();const chunks:Buffer[]=[];let size=0;request.on('data',(chunk:unknown)=>{const bytes=Buffer.isBuffer(chunk)?chunk:typeof chunk==='string'?Buffer.from(chunk):null;if(bytes){size+=bytes.length;if(size<=32768)chunks.push(bytes);}});request.once('end',()=>{if(size>32768)return;try{fact.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fact.body=null;}});}
    };
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:Screenshot[]=[],completed:Stage[]=[];let browser:Browser|undefined,primary:unknown,terminal:unknown,activeStage:Stage='PC_DETAIL_REAL';
    const reason='T09 PC 合成停止原因 '+randomUUID(),unfinished='T09 PC 合成未完成工作：厂商配件未到，继续由原沟通人跟进。 '+randomUUID(),stored=copies(fixture.handler,ticketId);
    const posts=()=>requests.filter(row=>row.method==='POST'),acks=()=>requests.filter(row=>row.path.startsWith(path+'/return-to-dispatch/commands/'));
    const capture=async()=>{assert.ok(browser);if(screenshots.length)return;const bytes=Buffer.from(text(await browser.screenshot()),'base64');assert.ok(bytes.length>=24);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(8),13);assert.equal(bytes.subarray(12,16).toString('ascii'),'IHDR');const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert.equal(width,1280);assert.equal(height,900);const file=join(directory,'new-detail-1280.png');await writeFile(file,bytes);screenshots.push({file:file.replaceAll('\\','/'),width,height,sha256:createHash('sha256').update(bytes).digest('hex')});};
    fixture.runtime.server.on('request',observe);
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticketId,width:1280,height:900,cookies:[{...cookie,url:fixture.origin}]});assert.ok(browser);
      await browser.waitFor(`Boolean(document.querySelector('#detail-title'))&&(${property('状态')})==='等待厂商'&&(${property('处理责任')})?.includes(${JSON.stringify(ownerName)})`);
      assert.equal(await browser.evaluate('location.origin'),fixture.origin);assert.equal(await browser.evaluate('innerWidth'),1280);assert.equal(await browser.evaluate('innerHeight'),900);completed.push(activeStage);
      // First T09 boundary: missing actual production form is a future RED, not a preflight capability assumption.
      activeStage='FORM_PRESENT';await browser.waitFor(`Boolean(${action})&&Boolean(${reasonInput})&&Boolean(${unfinishedInput})`);completed.push(activeStage);
      activeStage='DUAL_REQUIRED';assert.equal(await browser.evaluate(`(${root})?.querySelector('input[value=RETAIN_CURRENT]')?.checked`),true);assert.equal(await browser.evaluate(`(${root})?.querySelector('input[value=TRANSFER_SELECTED]')?.checked`),false);
      assert.equal(await browser.evaluate(`(${reasonInput}).maxLength`),500);assert.equal(await browser.evaluate(`(${unfinishedInput}).maxLength`),1400);assert.equal(await browser.evaluate(`(${action}).disabled`),true);assert.equal(posts().length,0);
      await browser.evaluate(fill(reasonInput,reason));assert.equal(await browser.evaluate(`(${action}).disabled`),true);await browser.evaluate(fill(unfinishedInput,'   '));assert.equal(await browser.evaluate(`(${action}).disabled`),true);assert.equal(posts().length,0);
      await browser.evaluate(fill(unfinishedInput,unfinished));await browser.waitFor(`(${action})?.disabled===false&&document.querySelector('[data-return-to-dispatch-draft-status]')?.textContent.includes('已保存恢复副本')`);assert.equal(posts().length,0);completed.push(activeStage);
      activeStage='PRE_SUBMIT_REFRESH_RESTORE';const saved=object(await browser.evaluate(stored)),drafts=rows(saved.drafts);assert.equal(drafts.length,1);const draft=drafts[0];assert.ok(draft);assert.equal(draft.extractable,false);assert.equal(draft.algorithm,'AES-GCM');assert.equal(Number(draft.expiresAt)-Number(draft.firstSavedAt),86400000);assert.ok(Number(draft.bytes)<=16400);assert.equal(JSON.stringify(saved).includes(reason),false);assert.equal(JSON.stringify(saved).includes(unfinished),false);assert.deepEqual(saved.operations,[]);
      const timeOrigin=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(timeOrigin)}&&(${reasonInput})?.value===${JSON.stringify(reason)}&&(${unfinishedInput})?.value===${JSON.stringify(unfinished)}&&(${action})?.disabled===false`);
      assert.equal(await browser.evaluate(`(${root})?.querySelector('input[value=RETAIN_CURRENT]')?.checked`),true);assert.equal(posts().length,0);assert.equal(acks().length,0);completed.push(activeStage);
      activeStage='ACTUAL_POST_UNKNOWN';
      // Await the genuine server commit before losing only its client acknowledgement; never forge a response.
      await browser.evaluate(`(()=>{const send=fetch;globalThis.fetch=async(url,options)=>{const response=await send(url,options);if(options?.method==='POST'&&String(url)===${JSON.stringify(path+'/return-to-dispatch')}){globalThis.__t09RealCommit={status:response.status,body:await response.clone().json()};globalThis.__t09OriginalCommand=JSON.parse(options.body);throw new TypeError('T09_REAL_ACK_LOST');}return response;};})()`);
      await browser.evaluate(`(${action}).click()`);await browser.waitFor(`(${root})?.innerText.includes('结果未知')&&Boolean(${check})`);
      const commit=object(await browser.evaluate('globalThis.__t09RealCommit')),result=object(commit.body),original=object(await browser.evaluate('globalThis.__t09OriginalCommand'));assert.equal(commit.status,200);assert.equal(result.ok,true);assert.equal(result.replayed,false);assert.equal(result.ticket_version,version(before.version)+1);assert.deepEqual(result.handling_cycle,cycle);assert.deepEqual(result.conversations,[]);
      const commandId=text(original.client_command_id);assert.match(commandId,UUID);assert.deepEqual(original,{client_command_id:commandId,expected_version:version(before.version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason,unfinished_work:unfinished,communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
      assert.equal(posts().length,1);const post=posts()[0];assert.ok(post);assert.equal(post.path,path+'/return-to-dispatch');assert.equal(post.status,200);assert.deepEqual(post.body,original);assert.equal(post.idempotency_key,commandId);assert.equal(post.if_match,'"'+version(before.version)+'"');assert.equal(post.csrf_present,true);assert.equal(post.origin_same,true);assert.equal(acks().length,0);
      const committed=await publicGet(admin,path),committedResponsibility=await publicGet(admin,path+'/responsibility'),committedHistory=rows((await publicGet(admin,path+'/events?limit=200')).items);assert.equal(committed.status,'QUEUED');assert.equal(committed.assignee_id,null);assert.equal(committed.resolver_team_id,before.resolver_team_id);assert.equal(committed.intake_id,before.intake_id);assert.deepEqual(committed.handling_cycle,cycle);assert.equal(committed.version,version(before.version)+1);assert.deepEqual(committedResponsibility.conversations,beforeResponsibility.conversations);
      assert.equal(committedHistory.length,history.length+1);assert.deepEqual(committedHistory.slice(0,-1),history);const returned=committedHistory.at(-1);assert.ok(returned);assert.equal(returned.event_type,'ticket.returned_to_dispatch');assert.equal(returned.event_id,result.ticket_event_id);assert.equal(returned.old_status,'WAITING_VENDOR');assert.equal(returned.new_status,'QUEUED');assert.equal(returned.has_internal_note,true);assert.equal(returned.has_external_note,false);assert.equal(committedHistory.filter(row=>row.event_type==='ticket.returned_to_dispatch').length,1);assert.deepEqual(await publicGet(admin,path+'/deliveries'),deliveries);completed.push(activeStage);
      activeStage='UNKNOWN_REFRESH_ORIGINAL_ID';const pending=object(await browser.evaluate(stored)),operations=rows(pending.operations);assert.equal(operations.length,1);const operation=operations[0];assert.ok(operation);assert.equal(operation.commandId,commandId);assert.deepEqual(Object.keys(operation).sort(),['commandId','createdAt','id','kind','principal','purpose','scope']);assert.equal(JSON.stringify(operation).includes(reason),false);assert.equal(JSON.stringify(operation).includes(unfinished),false);
      const unknownOrigin=await browser.evaluate('performance.timeOrigin');await browser.command('Page.reload');await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(unknownOrigin)}&&Boolean(${check})`);assert.equal(posts().length,1);assert.equal(acks().length,0,'UNKNOWN and refresh never POST or reconcile automatically');assert.deepEqual(object(await browser.evaluate(stored)).operations,[operation]);
      assert.equal(await browser.evaluate(`(${root})?.innerText.includes(${JSON.stringify(reason)})`),false);assert.equal(await browser.evaluate(`(${root})?.innerText.includes(${JSON.stringify(unfinished)})`),false);completed.push(activeStage);
      activeStage='EXPLICIT_SAFE_ACK';const ackPath=path+'/return-to-dispatch/commands/'+commandId;
      await browser.evaluate(`(()=>{const send=fetch;globalThis.fetch=async(url,options)=>{const response=await send(url,options);if((options?.method??'GET')==='GET'&&String(url)===${JSON.stringify(ackPath)})globalThis.__t09RealAck={status:response.status,body:await response.clone().json()};return response;};})()`);
      await browser.evaluate(`(${check}).click()`);await browser.waitFor(`(${root})?.innerText.includes('原操作已核对为提交')&&(${queued})`);
      const acknowledgement=object(await browser.evaluate('globalThis.__t09RealAck'));assert.equal(acknowledgement.status,200);assert.deepEqual(acknowledgement.body,{state:'COMMITTED',ticket_id:ticketId,ticket_version:version(before.version)+1,ticket_event_id:text(result.ticket_event_id)});
      assert.equal(posts().length,1);assert.equal(acks().length,1);const ack=acks()[0];assert.ok(ack);assert.equal(ack.method,'GET');assert.equal(ack.path,ackPath);assert.equal(ack.status,200);completed.push(activeStage);
      activeStage='CURRENT_FACTS_AND_CLEANUP';
      // Observe actual consumer re-reads before independent ADMIN comparison, so test GETs cannot impersonate UI refresh.
      assert.ok(requests.some(row=>row.method==='GET'&&row.order>ack.order&&row.path===path&&row.status===200));assert.ok(requests.some(row=>row.method==='GET'&&row.order>ack.order&&row.path===webPath&&row.status===200));
      assert.deepEqual(await publicGet(admin,path),committed);assert.deepEqual(await publicGet(admin,path+'/responsibility'),committedResponsibility);assert.deepEqual(rows((await publicGet(admin,path+'/events?limit=200')).items),committedHistory);assert.deepEqual(await publicGet(admin,path+'/deliveries'),deliveries);
      const records=rows((await publicGet(admin,webPath+'?limit=100')).records);assert.deepEqual(records.filter(row=>row.audience==='EXTERNAL'),external);assert.ok(records.some(row=>row.id==='event:'+text(returned.event_id)&&row.audience==='INTERNAL'&&typeof row.text==='string'&&row.text.includes(reason)&&row.text.includes(unfinished)));
      await browser.waitFor(`(${root})?.innerText.includes('原操作已核对为提交')&&!(${root})?.innerText.includes('清理尚未确认')`);assert.deepEqual(object(await browser.evaluate(stored)),{drafts:[],operations:[]});assert.equal(posts().length,1);assert.equal(acks().length,1);await capture();completed.push(activeStage);
    }catch(error){primary=error;}
    finally{
      try{await closeBrowserTestResources([async()=>{if(primary&&browser)await capture();},async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},async()=>{fixture.runtime.server.removeListener('request',observe);assert.equal((await fixture.runtime.observability.metrics()).sse_clients,0);}],primary);}catch(error){terminal=error;}
      const diagnostic=join(tmpdir(),'t09-first-production-pc-'+randomUUID()+'.json');
      try{await writeFile(diagnostic,JSON.stringify({status:terminal?'FAIL':'BROWSER_SLICE_COMPLETE',active_stage:activeStage,completed,not_reached:stages.filter(stage=>!completed.includes(stage)&&stage!==activeStage),public_http_preconditions:'COMPLETE_BEFORE_BROWSER',requests:requests.map(safeRequest),screenshots,...(terminal?{error:failureDetails(terminal)}:{})},null,2));}catch(error){terminal=terminal?new AggregateError([terminal,error],'T09_BROWSER_AND_DIAGNOSTIC_FAILED'):error;}
      console.log('T09_BROWSER_DIAGNOSTIC '+JSON.stringify({file:diagnostic.replaceAll('\\','/')}));
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',status:terminal?'FAIL':'BROWSER_SLICE_COMPLETE',t09_first_public_tracer:true,scenario:'PC_CURRENT_HANDLER_WAITING_VENDOR_DEFAULT_RETAIN_REFRESH_REAL_UNKNOWN_GET_ONLY',active_stage:activeStage,completed,screenshots}));if(terminal)throw terminal;
    }
  },{ticketReturnToDispatchEnabled:true,workbenchDraftRecoveryEnabled:true});
});
