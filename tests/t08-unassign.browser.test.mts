// First real production-bundle tracer, initially run before the consumer exists.
// Only the first default-retain public production-bundle tracer; no test-owned success handler.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {withT08Fixture,object,rows,text} from './helpers/t08-fixture.mjs';
import type {T08Http} from './helpers/t08-fixture.mjs';
import {launchSystemBrowser,closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

type Browser=NonNullable<Awaited<ReturnType<typeof launchSystemBrowser>>>;
type RequestFact={order:number;method:string;path:string;status:number|null;body:unknown;idempotency_key:string|null;if_match:string|null;csrf_present:boolean;origin_same:boolean};
type Screenshot={file:string;width:number;height:number;sha256:string};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function failureDetails(value:unknown):Record<string,unknown>{
  return value instanceof AggregateError?{name:value.name,message:value.message,errors:Array.from(value.errors,(nested:unknown)=>failureDetails(nested))}
    :value instanceof Error?{name:value.name,message:value.message,stack:value.stack}:{value:String(value)};
}
async function publicGet(http:T08Http,path:string){const result=await http.get(path);assert.equal(result.status,200,path);return result.value;}
function header(request:IncomingMessage,name:string){const value=request.headers[name];return typeof value==='string'?value:null;}
const property=(label:string)=>`Array.from(document.querySelectorAll('.properties dt')).find(row=>row.textContent?.trim()===${JSON.stringify(label)})?.nextElementSibling?.textContent?.trim()`;
const section="document.querySelector('[data-action=unassign]')?.closest('section')";
const reasonInput=`Array.from((${section})?.querySelectorAll('textarea')??[]).find(input=>Array.from(input.labels??[]).some(label=>label.textContent?.includes('原因')))`;
const queuedDom=`Boolean(document.querySelector('#detail-title'))&&(${property('状态')})==='待接单'&&(${property('处理人')})==='等待领取'`;

// Keep the existing routed-host 240s budget and launch/wait defaults; no timeout override.
test('production ADMIN withdraws one legacy accepted unstarted Ticket with an internal reason and default retained communication',async()=>{
  await withT08Fixture(async fixture=>{
    const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
    const webPath='/api/workbench/items/ticket/'+ticketId;
    const bootstrap=await publicGet(admin,'/api/lifecycle/bootstrap');
    assert.equal(bootstrap.ticket_unassign_enabled,true);
    assert.equal(bootstrap.ticket_unassign_draft_recovery_enabled,false);
    assert.equal(bootstrap.ticket_assignment_enabled,false);
    assert.equal(bootstrap.ticket_conversation_self_handling_enabled,false);
    assert.equal(bootstrap.ticket_self_handling_enabled,false);
    assert.equal(bootstrap.conversation_workspace_enabled,false);
    assert.equal(bootstrap.realtime_sse_enabled,false);
    const queued=await publicGet(handler,path);assert.equal(queued.status,'QUEUED');assert.equal(queued.assignee_id,null);assert.equal(queued.version,1);
    // Real old HTTP creates responsibility; no SQL status/owner/event/cycle setup or assertion.
    assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_LEGACY_PUBLIC_ACCEPT'})).status,200);
    const before=await publicGet(admin,path),beforeResponsibility=await publicGet(admin,path+'/responsibility');
    assert.equal(before.status,'ACCEPTED');assert.equal(before.assignee_id,fixture.handler);assert.equal(before.version,2);
    assert.equal(before.handling_cycle??null,null,'a real legacy acceptance must not invent a handling round');
    assert.ok(Array.isArray(before.allowed_actions)&&before.allowed_actions.includes('unassign'));
    const beforeEvents=rows((await publicGet(admin,path+'/events?limit=200')).items),beforeDeliveries=await publicGet(admin,path+'/deliveries');
    assert.equal(beforeEvents.some(event=>event.event_type==='ticket.started'),false);
    const beforeWeb=await publicGet(admin,webPath+'?limit=100');
    const beforeExternal=rows(beforeWeb.records).filter(row=>row.audience==='EXTERNAL');
    const ownerName=text(beforeResponsibility.ticket_assignee_name);
    const rawCookie=fixture.runtime.authenticate.browserCookies?.()[0];assert.ok(rawCookie);
    // Existing public Cookie-injection API; do not print/save Cookie or CSRF values.
    const browserCookie={...rawCookie,url:fixture.origin},cookieHeader=rawCookie.name+'='+rawCookie.value;
    const requests:RequestFact[]=[];
    const observe=(request:IncomingMessage,response:ServerResponse)=>{
      if(!request.headers.cookie?.split(';').some(part=>part.trim()===cookieHeader))return;
      const url=new URL(request.url??'/',fixture.origin);if(!url.pathname.startsWith('/api/'))return;
      const fact:RequestFact={order:requests.length,method:request.method??'',path:url.pathname,status:null,body:null,
        idempotency_key:header(request,'idempotency-key'),if_match:header(request,'if-match'),
        csrf_present:typeof request.headers['x-csrf-token']==='string'&&request.headers['x-csrf-token'].length>0,
        origin_same:request.headers.origin===fixture.origin};
      requests.push(fact);response.once('finish',()=>{fact.status=response.statusCode;});
      // Preserve the real server's delayed async iterator; do not turn the request into an early flowing reader.
      if(fact.method==='POST'){
        request.pause();const chunks:Buffer[]=[];let size=0;
        request.on('data',(chunk:unknown)=>{const bytes=Buffer.isBuffer(chunk)?chunk:typeof chunk==='string'?Buffer.from(chunk):null;if(bytes){size+=bytes.length;if(size<=32_768)chunks.push(bytes);}});
        request.once('end',()=>{if(size>32_768)return;try{fact.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fact.body=null;}});
      }
    };
    const directory=join(tmpdir(),'web01-ui-'+randomUUID());await mkdir(directory);
    const screenshots:Screenshot[]=[];let browser:Browser|undefined,primary:unknown,terminal:unknown;
    const capture=async()=>{
      assert.ok(browser);if(screenshots.length)return;
      const bytes=Buffer.from(text(await browser.screenshot()),'base64');
      assert.ok(bytes.length>=24);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      assert.equal(bytes.readUInt32BE(8),13);assert.equal(bytes.subarray(12,16).toString('ascii'),'IHDR');
      const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);assert.equal(width,600);assert.equal(height,1080);
      const file=join(directory,'new-detail-600.png');await writeFile(file,bytes);
      screenshots.push({file:file.replaceAll('\\','/'),width,height,sha256:createHash('sha256').update(bytes).digest('hex')});
    };
    const reason='原处理人尚未开始，本次交回调度重新安排。';
    fixture.runtime.server.on('request',observe);
    try{
      browser=await launchSystemBrowser({url:fixture.origin+'/workbench/app/items/ticket/'+ticketId,width:600,height:1080,cookies:[browserCookie]});
      assert.ok(browser);
      await browser.waitFor(`Boolean(document.querySelector('#detail-title'))&&(${property('状态')})==='已领取'&&(${property('处理人')})?.includes(${JSON.stringify(ownerName)})`);
      assert.equal(await browser.evaluate('location.origin'),fixture.origin);
      assert.equal(await browser.evaluate('innerWidth'),600);
      await browser.waitFor(`Boolean(document.querySelector('[data-action=unassign]'))&&Boolean(${reasonInput})`);
      assert.equal(await browser.evaluate(`(${section})?.querySelector('input[type=radio][value=RETAIN_CURRENT]')?.checked`),true,'retaining communication is the actual default, not a test-selected replacement');
      assert.equal(await browser.evaluate(`(${section})?.querySelector('input[type=radio][value=TRANSFER_SELECTED]')?.checked`),false);
      assert.equal(await browser.evaluate("document.querySelector('[data-action=unassign]').disabled"),true,'an explicit internal reason is required');
      assert.equal(requests.filter(row=>row.method==='POST').length,0);
      await browser.evaluate(`(()=>{const input=${reasonInput};if(!input)throw Error('T08_INTERNAL_REASON_INPUT_REQUIRED');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(reason)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await browser.waitFor("document.querySelector('[data-action=unassign]')?.disabled===false");
      assert.equal(requests.filter(row=>row.method==='POST').length,0,'typing a reason must not submit');
      await browser.evaluate("document.querySelector('[data-action=unassign]').click()");
      await browser.waitFor(queuedDom);
      const posts=requests.filter(row=>row.method==='POST');assert.equal(posts.length,1);const post=posts[0];assert.ok(post);
      assert.equal(post.path,path+'/unassign');assert.equal(post.status,200);assert.equal(post.csrf_present,true);assert.equal(post.origin_same,true);assert.equal(post.if_match,'"2"');
      const command=object(post.body),commandId=text(command.client_command_id);assert.match(commandId,UUID);assert.equal(post.idempotency_key,commandId);
      assert.deepEqual(command,{client_command_id:commandId,expected_version:2,reason_code:'WORKBENCH_UNASSIGN',reason,
        communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
      // Assert the production browser's own re-read before making any test-side admin GET.
      assert.ok(requests.some(row=>row.method==='GET'&&row.order>post.order&&row.status===200&&[path,webPath].includes(row.path)),
        'the committed command must be followed by a current authorized production GET');
      const after=await publicGet(admin,path),afterResponsibility=await publicGet(admin,path+'/responsibility');
      assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,before.resolver_team_id);
      assert.equal(after.version,3);assert.equal(after.intake_id,before.intake_id);assert.equal(after.handling_cycle??null,null);
      assert.equal(afterResponsibility.ticket_assignee_id,null);assert.equal(afterResponsibility.resolver_team_id,beforeResponsibility.resolver_team_id);
      assert.deepEqual(afterResponsibility.conversations,beforeResponsibility.conversations,'default retain changes no actual communication facts');
      const afterEvents=rows((await publicGet(admin,path+'/events?limit=200')).items);
      assert.equal(afterEvents.length,beforeEvents.length+1);assert.deepEqual(afterEvents.slice(0,-1),beforeEvents);
      const last=afterEvents.at(-1);assert.ok(last);assert.equal(last.event_type,'ticket.unassigned');assert.equal(last.old_status,'ACCEPTED');assert.equal(last.new_status,'QUEUED');
      assert.equal(last.aggregate_version,3);assert.equal(last.has_internal_note,true);assert.equal(last.has_external_note,false);
      assert.equal(afterEvents.filter(event=>event.event_type==='ticket.unassigned').length,1);
      assert.deepEqual(await publicGet(admin,path+'/deliveries'),beforeDeliveries,'withdrawal creates no additional external Delivery');
      const afterWeb=await publicGet(admin,webPath+'?limit=100'),afterRecords=rows(afterWeb.records);
      assert.equal(afterWeb.description,beforeWeb.description);
      assert.ok(afterRecords.some(row=>row.id==='event:'+text(last.event_id)&&row.audience==='INTERNAL'&&row.text===reason));
      assert.deepEqual(afterRecords.filter(row=>row.audience==='EXTERNAL'),beforeExternal);
      assert.equal(afterRecords.some(row=>row.audience==='EXTERNAL'&&typeof row.text==='string'&&row.text.includes(reason)),false);
      const timeOrigin=await browser.evaluate('performance.timeOrigin'),reloadOrder=requests.length;
      await browser.command('Page.reload');
      await browser.waitFor(`performance.timeOrigin!==${JSON.stringify(timeOrigin)}&&(${queuedDom})`);
      assert.ok(requests.some(row=>row.order>=reloadOrder&&row.method==='GET'&&row.status===200&&[path,webPath].includes(row.path)));
      assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('.activity-list li')).some(row=>row.querySelector('.record-type')?.textContent==='报修人可见'&&row.querySelector('p')?.textContent?.includes(${JSON.stringify(reason)}))`),false);
      assert.equal(requests.filter(row=>row.method==='POST').length,1,'refresh reads current facts and never submits another command');
      assert.deepEqual((await publicGet(admin,path+'/events?limit=200')).items,afterEvents);
      assert.deepEqual(await publicGet(admin,path+'/deliveries'),beforeDeliveries);
      await browser.evaluate("document.querySelector('#detail-title').scrollIntoView({block:'start'})");
      await capture();
    }catch(error){primary=error;}
    finally{
      // The helper runs every closer and preserves the primary error together with cleanup errors.
      try{await closeBrowserTestResources([
        async()=>{if(primary&&browser)await capture();},
        async()=>{await browser?.close();if(browser)assert.deepEqual(browser.ownedResourceState(),{processes:0,profiles:0,commandTimers:0,sockets:0});},
        async()=>{fixture.runtime.server.removeListener('request',observe);assert.equal((await fixture.runtime.observability.metrics()).sse_clients,0);},
      ],primary);}catch(error){terminal=error;}
      const diagnostic=join(tmpdir(),'t08-first-production-browser-diagnostic-'+randomUUID()+'.json');
      try{await writeFile(diagnostic,JSON.stringify({status:terminal?'FAIL':'BROWSER_SLICE_COMPLETE',requests,screenshots,...(terminal?{error:failureDetails(terminal)}:{})},null,2));}
      catch(error){terminal=terminal?new AggregateError([terminal,error],'T08_BROWSER_AND_DIAGNOSTIC_FAILED'):error;}
      console.log('T08_BROWSER_DIAGNOSTIC '+JSON.stringify({file:diagnostic.replaceAll('\\','/')}));
      // One runner-approved 600 PNG only; no JSON/extra file shares its collector-owned folder.
      console.log('WEB01_BROWSER '+JSON.stringify({api:'REAL_LOOPBACK_HTTP_PG',status:terminal?'FAIL':'BROWSER_SLICE_COMPLETE',
        t08_first_public_tracer:true,scenario:'ADMIN_DEFAULT_RETAIN_LEGACY_ACCEPTANCE',
        screenshots}));
      if(terminal)throw terminal;
    }
    // withT08Fixture's existing finally then stops its real runtime and random database.
  },{ticketUnassignEnabled:true,ticketAssignmentEnabled:false,ticketConversationSelfHandlingEnabled:false,
    workbenchDraftRecoveryEnabled:false,workbenchConversationsEnabled:false,workbenchRealtimeEnabled:false});
});
