// STAGED_RUNTIME / first actual authority, resource or schema boundary execution pending.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createRealtimeEventStore} from '../app/server/src/p2-003-realtime-event-log.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../app/server/src/p2-006-workbench-authorization.mjs';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';

function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
async function drain(fixture:T37Fixture){
  const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0),JSON.stringify(inbound.streams));
    if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;
  }
  assert.fail('actual canonical Session/timeline projection did not settle within the fixture bound');
}
async function setDue(http:T37Http,path:string){
  const ticket=await current(http,path),schedule=await current(http,path+'/follow-up-schedule');
  const result=await http.post(path+'/follow-up-schedule',{client_command_id:randomUUID(),expected_version:version(ticket.version),
    expected_schedule_version:text(schedule.schedule_version),reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:'2020-01-02 09:30:00'});
  assert.equal(result.status,200,JSON.stringify(result.value));return result.value;
}
async function scope(fixture:T37Fixture,principalId:string){
  const authorization=createPilotWorkbenchAuthorizationAdapter({pool:fixture.pool});
  const principal=await authorization.resolvePrincipal({principal_id:principalId});assert.ok(principal);
  const value=await authorization.resolveRealtimeAuthorization(principal,{limit:256,availabilityFallback:true,followUpSchedulesEnabled:true});assert.ok(value);
  return value;
}
function dueFor(input:unknown,ticketId:string){
  const event=object(input);return event.event_type==='ticket.updated'&&event.aggregate_type==='TICKET'&&event.aggregate_id===ticketId&&object(event.payload).reason==='FOLLOW_UP_DUE';
}
function noteFor(input:unknown,sessionId:string){
  const event=object(input);return event.event_type==='conversation.item.created'&&object(event.payload).session_id===sessionId&&object(event.payload).item_type==='INTERNAL_NOTE';
}

/** Reads only the native HTTP endpoint. An absent event never passes by timeout. */
async function openSse(fixture:T37Fixture,lastEventId?:string){
  const entry=fixture.runtime.authenticate.browserCookies?.()[1];assert.ok(entry);
  const abort=new AbortController(),openTimer=setTimeout(()=>abort.abort(),15_000);
  let response:Response;
  try{
    response=await fetch(fixture.origin+'/api/realtime/events?scope=workbench',{signal:abort.signal,
      headers:{cookie:entry.name+'='+entry.value,...(lastEventId===undefined?{}:{'last-event-id':lastEventId})}});
  }catch(error){abort.abort();throw error;}finally{clearTimeout(openTimer);}
  if(response.status!==200){await response.body?.cancel();abort.abort();assert.fail('native HANDLER SSE returned '+response.status);}
  if(!/^text\/event-stream(?:;|$)/u.test(response.headers.get('content-type')??'')||!response.body){await response.body?.cancel();abort.abort();assert.fail('native SSE response body/content type missing');}
  const reader=response.body.getReader(),decoder=new TextDecoder(),seen:Record<string,unknown>[]=[];
  let buffer='',bytes=0,closed=false;
  const lifetime=setTimeout(()=>abort.abort(),60_000);
  async function close(){
    if(closed)return;closed=true;clearTimeout(lifetime);abort.abort();
    try{await reader.cancel();}catch{/* fetch abort may have already cancelled the same stream. */}finally{reader.releaseLock();}
  }
  async function until(predicate:(event:Record<string,unknown>)=>boolean,label:string){
    const timer=setTimeout(()=>abort.abort(),15_000);
    try{
      while(!closed){
        let boundary=buffer.indexOf('\n\n');
        while(boundary>=0){
          const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
          const lines=frame.split('\n'),data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(data){
            const event=object(JSON.parse(data)),id=lines.find(line=>line.startsWith('id:'))?.slice(3).trim(),kind=lines.find(line=>line.startsWith('event:'))?.slice(6).trim();
            assert.match(text(event.event_id),/^[1-9][0-9]*$/u);assert.equal(event.event_id,id);assert.equal(event.event_type,kind);
            object(event.payload);seen.push(event);assert.ok(seen.length<=400,'bounded SSE frame count');
            if(predicate(event))return event;
          }
          boundary=buffer.indexOf('\n\n');
        }
        const next=await reader.read();assert.equal(next.done,false,label+': stream ended before the actual event');
        assert.ok(next.value);bytes+=next.value.byteLength;assert.ok(bytes<=2_097_152,'bounded SSE byte count');
        buffer=(buffer+decoder.decode(next.value,{stream:true})).replaceAll('\r\n','\n');
      }
      assert.fail(label+': stream closed before the actual event');
    }finally{clearTimeout(timer);}
  }
  return {seen,until,close};
}

test('native HANDLER due SSE and authorized replay require current Ticket READ even while actual Session CONTROL remains',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
    const queued=await current(dispatcher,path);
    const assigned=await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',
      target_principal_id:fixture.otherHandler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(assigned.status,200,JSON.stringify(assigned.value));await drain(fixture);
    const related=await current(dispatcher,path+'/related-conversations?limit=20'),sources=rows(related.items);
    assert.equal(sources.length,1);assert.equal(related.next_cursor,null);const source=sources[0];assert.ok(source);
    const sessionId=text(source.session_id),sessionPath='/api/conversations/'+sessionId,session=await current(handler,sessionPath);
    const takeover=await handler.post(sessionPath+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(object(session.session).row_version),reason_code:'T37_DUE_REAL_COMMUNICATOR'});
    assert.equal(takeover.status,200,JSON.stringify(takeover.value));assert.equal(object((await current(handler,sessionPath)).assignment).assigned_to_me,true);
    await drain(fixture);
    assert.equal((await current(handler,path)).assignee_id,fixture.otherHandler);
    assert.equal((await setDue(dispatcher,path)).schedule_version,'1');
    const initialScope=await scope(fixture,fixture.handler);
    assert.equal(initialScope.allow_system_events,false);assert.equal(initialScope.allow_restricted_admin,false);
    assert.ok(initialScope.allowed_session_ids.includes(sessionId));assert.ok(initialScope.allowed_system_ticket_ids?.includes(ticketId));
    const bootstrap=await current(handler,'/api/lifecycle/bootstrap');assert.equal(bootstrap.realtime_sse_enabled,true);assert.equal(bootstrap.realtime_sse_available,true);
    const streams:Awaited<ReturnType<typeof openSse>>[]=[];
    try{
      const live=await openSse(fixture);streams.push(live);
      assert.deepEqual(await fixture.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
      const first=await live.until(event=>dueFor(event,ticketId),'first authorized due');
      assert.deepEqual(first.payload,{ticket_id:ticketId,follow_up_schedule_version:'1',reason:'FOLLOW_UP_DUE'});
      assert.equal(first.aggregate_version,String((await current(dispatcher,path)).version));
      await fixture.setHandlerTeams([]);
      assert.equal((await handler.get(path)).status,404);assert.equal((await handler.get(path+'/follow-up-schedule')).status,404);
      const independent=await current(handler,sessionPath);assert.equal(object(independent.assignment).assigned_to_me,true);
      const lostScope=await scope(fixture,fixture.handler);
      assert.ok(lostScope.allowed_session_ids.includes(sessionId),'real Session authorization remains');
      assert.equal(lostScope.allowed_system_ticket_ids?.includes(ticketId)??false,false,'Session CONTROL cannot substitute for Ticket READ');
      assert.equal((await setDue(dispatcher,path)).schedule_version,'2');
      const beforeDue={ticket:await current(dispatcher,path),responsibility:await current(dispatcher,path+'/responsibility'),deliveries:await current(dispatcher,path+'/deliveries')};
      assert.deepEqual(await fixture.runtime.runFollowUpDueBatch({limit:20}),{scanned:1,emitted:1,skipped:0});
      assert.deepEqual({ticket:await current(dispatcher,path),responsibility:await current(dispatcher,path+'/responsibility'),deliveries:await current(dispatcher,path+'/deliveries')},beforeDue);

      // A real authorized Session command supplies a later ordered event, not an invented wakeup/frame.
      const noteSession=await current(handler,sessionPath),noteText='T37 合成内部 Session CONTROL 屏障 '+randomUUID();
      const note=await handler.post(sessionPath+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:version(object(noteSession.session).row_version),
        reason_code:'T37_SESSION_CONTROL_AFTER_READ_LOSS',text:noteText});
      assert.equal(note.status,201,JSON.stringify(note.value));assert.equal(note.value.command_status,'COMMITTED');assert.equal(note.value.outbox_id,null);assert.deepEqual(note.value.delivery_ids,[]);
      await drain(fixture);
      const barrier=await live.until(event=>noteFor(event,sessionId),'same connection authorized Session note');
      assert.ok(BigInt(text(barrier.event_id))>BigInt(text(first.event_id)));
      assert.deepEqual(live.seen.filter(event=>dueFor(event,ticketId)).map(event=>object(event.payload).follow_up_schedule_version),['1']);
      assert.equal(JSON.stringify(live.seen).includes(noteText),false,'SSE remains a safe hint, without internal-note content');

      const store=createRealtimeEventStore({pool:fixture.pool,enabled:true});
      const broadPage=await store.listAuthorizedEvents({authorization:await scope(fixture,fixture.dispatcher),afterEventId:'0',limit:200});
      const due=broadPage.events.filter(event=>dueFor(event,ticketId));assert.deepEqual(due.map(event=>event.payload.follow_up_schedule_version),['1','2']);
      const second=due[1];assert.ok(second);assert.ok(BigInt(text(barrier.event_id))>BigInt(second.event_id),'actual later barrier proves the denied due was scanned, rather than merely delayed');
      const narrowPage=await store.listAuthorizedEvents({authorization:await scope(fixture,fixture.handler),afterEventId:'0',limit:200});
      assert.ok(narrowPage.events.some(event=>event.event_id===barrier.event_id));assert.equal(narrowPage.events.some(event=>dueFor(event,ticketId)),false);

      const reconnect=await openSse(fixture,'0');streams.push(reconnect);
      await reconnect.until(event=>event.event_id===barrier.event_id,'new native HANDLER connection replays authorized Session barrier');
      assert.equal(reconnect.seen.some(event=>dueFor(event,ticketId)),false,'new connection cannot replay either due revision after Ticket READ loss');
      assert.equal((await handler.get(path)).status,404);assert.equal(object((await current(handler,sessionPath)).assignment).assigned_to_me,true);
      assert.equal(JSON.stringify(reconnect.seen).includes(noteText),false);
    }finally{await Promise.all(streams.map(stream=>stream.close()));}
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true,workbenchRealtimeEnabled:true});
});
