// STAGED_RUNTIME / first real execution pending. Original prepared body and assertions retained.
// Two bounded cases. Real PG/Core/HTTP/runtime.start ticks; no manufactured business facts or success Port.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createP2016Runtime,type P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {createRealtimeEventStore} from '../src/p2-003-realtime-event-log.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../src/p2-006-workbench-authorization.mjs';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';

function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const response=await http.get(path);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
async function snapshot(http:T37Http,path:string){return {ticket:await current(http,path),schedule:await current(http,path+'/follow-up-schedule'),
  events:await current(http,path+'/events?limit=200'),deliveries:await current(http,path+'/deliveries')};}
async function setDue(http:T37Http,path:string){
  const ticket=await current(http,path),schedule=await current(http,path+'/follow-up-schedule');
  const result=await http.post(path+'/follow-up-schedule',{client_command_id:randomUUID(),expected_version:version(ticket.version),
    expected_schedule_version:text(schedule.schedule_version),reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action:'SET',due_at:'2020-01-02 09:30:00'});
  assert.equal(result.status,200,JSON.stringify(result.value));
}
async function replay(fixture:T37Fixture){
  const authorization=createPilotWorkbenchAuthorizationAdapter({pool:fixture.pool});
  const principal=await authorization.resolvePrincipal({principal_id:fixture.dispatcher});assert.ok(principal);
  const scope=await authorization.resolveRealtimeAuthorization(principal,{limit:256,availabilityFallback:true,followUpSchedulesEnabled:true});assert.ok(scope);
  return (await createRealtimeEventStore({pool:fixture.pool,enabled:true}).listAuthorizedEvents({authorization:scope,afterEventId:'0',limit:200})).events;
}
async function markerCount(fixture:T37Fixture,ticketId?:string){
  const result=await fixture.pool.query<{count:number}>('SELECT count(*)::integer AS count FROM pilot_ticket.follow_up_due_signal WHERE ($1::uuid IS NULL OR ticket_id=$1::uuid)',[ticketId??null]);
  const count=result.rows[0]?.count;assert.equal(typeof count,'number');return count;
}
async function restartedHttp(runtime:P2016EnabledRuntime,origin:string):Promise<T37Http>{
  const entry=runtime.authenticate.browserCookies?.()[0];assert.ok(entry);const cookie=entry.name+'='+entry.value;
  const get=async(path:string)=>{const response=await fetch(origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
  const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=text(bootstrap.value.csrf_token);
  const post=async(path:string,body:Readonly<Record<string,unknown>>)=>{
    const response=await fetch(origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,
      'idempotency-key':text(body.client_command_id),'if-match':'"'+version(body.expected_version)+'"'},body:JSON.stringify(body)});
    return {status:response.status,value:object(await response.json())};
  };return {get,post};
}
async function boundedWait(read:()=>Promise<boolean>){
  for(let attempt=0;attempt<60;attempt++){if(await read())return true;await delay(250);}return false;
}
function dueEvents(events:Awaited<ReturnType<typeof replay>>,ticketId:string){return events.filter(event=>event.event_type==='ticket.updated'&&event.aggregate_id===ticketId&&event.payload.reason==='FOLLOW_UP_DUE');}

test('actual runtime worker ticks continue ordinary notification projection when isolated follow-up readiness fails',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
    const queued=await current(handler,path);assert.equal(queued.status,'QUEUED');
    // Existing native lifecycle HTTP creates its actual Ticket event, notification binding and pending Delivery.
    const accepted=await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'T37_DUE_ISOLATION_ACCEPT'});
    assert.equal(accepted.status,200,JSON.stringify(accepted.value));
    const acceptedTicket=await current(handler,path);assert.equal(acceptedTicket.status,'ACCEPTED');assert.equal(acceptedTicket.assignee_id,fixture.handler);
    const deliveries=rows((await current(dispatcher,path+'/deliveries')).items);assert.equal(deliveries.length,1);
    const delivery=deliveries[0];assert.ok(delivery);assert.equal(delivery.notification_type,'TICKET_ACCEPTED');assert.equal(delivery.status,'PENDING');
    const deliveryId=text(delivery.delivery_id),deliveryChanges=async()=> (await replay(fixture)).filter(event=>event.event_type==='ticket.notification.delivery_changed'&&event.payload.delivery_id===deliveryId);
    assert.equal((await deliveryChanges()).length,0,'only the existing background projector emits delivery_changed');
    assert.ok((await replay(fixture)).some(event=>event.event_type==='ticket.notification.created'&&event.payload.delivery_id===deliveryId));
    await setDue(handler,path);const before=await snapshot(dispatcher,path);assert.equal(object(before.schedule.active).is_due,true);
    assert.equal(await markerCount(fixture),0,'fault injection must not remove any published marker');
    // Deliberate schema failure in this fresh fixture DB only; no Ticket, ownership, schedule or event DML.
    await fixture.pool.query('DROP TABLE pilot_ticket.follow_up_due_signal');
    await assert.rejects(()=>fixture.runtime.runFollowUpDueBatch(),{code:'P2_016_FOLLOW_UP_UNAVAILABLE'});
    await fixture.runtime.stop();assert.equal(fixture.runtime.server.listening,false);
    const runtime=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:fixture.origin,
      listenPort:Number(new URL(fixture.origin).port),principalIds:[fixture.dispatcher,fixture.handler,fixture.otherHandler],
      gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,workbenchFollowUpSchedulesEnabled:true});
    try{
      await assert.rejects(()=>runtime.runFollowUpDueBatch(),{code:'P2_016_FOLLOW_UP_UNAVAILABLE'});
      assert.ok((await runtime.coordinator.backlog()).total>0,'real Core/intake facts must leave genuine upstream projection work');
      // start() installs the existing 1000ms projection timer; no direct call to realtimeProjector.runOnce().
      await runtime.start();const restarted=await restartedHttp(runtime,fixture.origin);
      const upstreamAdvanced=await boundedWait(async()=> (await runtime.coordinator.backlog()).total===0);
      assert.equal(upstreamAdvanced,true,'T37_REAL_RUNTIME_TICK_PREREQUISITE');
      const ordinaryAdvanced=await boundedWait(async()=> (await deliveryChanges()).length>0);
      console.log('T37_DUE_ISOLATION '+JSON.stringify({actual_runtime_ticks:true,upstream_advanced:upstreamAdvanced,
        due_direct_error:'P2_016_FOLLOW_UP_UNAVAILABLE',ordinary_delivery_projection_advanced:ordinaryAdvanced,external_sender_enabled:false}));
      assert.equal(ordinaryAdvanced,true,'T37_DUE_FAILURE_MUST_NOT_BLOCK_EXISTING_REALTIME_PROJECTOR');
      const published=await deliveryChanges();assert.equal(published.length,1);assert.equal(published[0]?.aggregate_id,ticketId);assert.equal(published[0]?.payload.status,'PENDING');
      await assert.rejects(()=>runtime.runFollowUpDueBatch(),{code:'P2_016_FOLLOW_UP_UNAVAILABLE'},'ordinary progress must not conceal the due failure');
      assert.deepEqual(await snapshot(restarted,path),before,'projection cannot change Ticket facts, versions or Delivery state');
      assert.equal(dueEvents(await replay(fixture),ticketId).length,0);
    }finally{
      await runtime.stop();assert.equal(runtime.server.listening,false);
      assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);
      assert.equal((await runtime.observability.metrics()).sse_clients,0);
    }
  },{workbenchFollowUpSchedulesEnabled:true});
});

test('a real PG rejection during due realtime append rolls its marker back and one later retry commits exactly once',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
    await setDue(dispatcher,path);const before=await snapshot(dispatcher,path);
    assert.equal(await markerCount(fixture,ticketId),0);assert.equal(dueEvents(await replay(fixture),ticketId).length,0);
    // This isolated-DB trigger only rejects the real follow-up realtime insert. It never writes business facts.
    // The sequence is a nontransactional test witness: only a visible, already inserted marker advances it.
    try{
      await fixture.pool.query('CREATE SEQUENCE platform.t37_due_marker_write_observation');
      assert.equal((await fixture.pool.query<{is_called:boolean}>('SELECT is_called FROM platform.t37_due_marker_write_observation')).rows[0]?.is_called,false);
      await fixture.pool.query(`CREATE FUNCTION conversation.t37_reject_due_insert() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN
          IF NOT EXISTS(SELECT 1 FROM pilot_ticket.follow_up_due_signal
            WHERE ticket_id=NEW.aggregate_id::uuid AND schedule_version=(NEW.payload->>'follow_up_schedule_version')::bigint)
          THEN RAISE EXCEPTION 'T37_DUE_MARKER_PREREQUISITE_MISSING'; END IF;
          PERFORM nextval('platform.t37_due_marker_write_observation');
          RAISE EXCEPTION 'T37_INJECTED_DUE_REALTIME_FAILURE';
        END;
        $fault$`);
      await fixture.pool.query(`CREATE TRIGGER t37_reject_due_insert BEFORE INSERT ON conversation.realtime_event FOR EACH ROW
        WHEN (NEW.publisher_name='P2_016_FOLLOW_UP' AND NEW.event_variant='FOLLOW_UP_DUE')
        EXECUTE FUNCTION conversation.t37_reject_due_insert()`);
      await assert.rejects(()=>fixture.runtime.runFollowUpDueBatch(),{code:'CONVERSATION_REALTIME_STORAGE_FAILED'});
      assert.equal((await fixture.pool.query<{is_called:boolean}>('SELECT is_called FROM platform.t37_due_marker_write_observation')).rows[0]?.is_called,true,
        'the real failing append must first observe the marker inserted in its own transaction');
      assert.equal(await markerCount(fixture,ticketId),0,'the marker preceding the failed append must roll back');
      assert.equal(dueEvents(await replay(fixture),ticketId).length,0);
      assert.deepEqual(await snapshot(dispatcher,path),before);
    }finally{
      await fixture.pool.query('DROP TRIGGER IF EXISTS t37_reject_due_insert ON conversation.realtime_event');
      await fixture.pool.query('DROP FUNCTION IF EXISTS conversation.t37_reject_due_insert()');
      await fixture.pool.query('DROP SEQUENCE IF EXISTS platform.t37_due_marker_write_observation');
    }
    assert.deepEqual(await fixture.runtime.runFollowUpDueBatch(),{scanned:1,emitted:1,skipped:0});
    assert.equal(await markerCount(fixture,ticketId),1);assert.equal(dueEvents(await replay(fixture),ticketId).length,1);
    assert.deepEqual(await fixture.runtime.runFollowUpDueBatch(),{scanned:0,emitted:0,skipped:0});
    assert.equal(await markerCount(fixture,ticketId),1);assert.equal(dueEvents(await replay(fixture),ticketId).length,1);
    assert.deepEqual(await snapshot(dispatcher,path),before);
  },{workbenchFollowUpSchedulesEnabled:true});
});
