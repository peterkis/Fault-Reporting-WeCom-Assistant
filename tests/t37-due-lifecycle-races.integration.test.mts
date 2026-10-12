// STAGED_RUNTIME / first actual authority, resource or schema boundary execution pending.
// Only actual Core/HTTP commands establish facts. The query barrier forwards real PG calls/results unchanged.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {createRealtimeEventStore} from '../src/p2-003-realtime-event-log.mjs';
import {createPilotWorkbenchAuthorizationAdapter} from '../src/p2-006-workbench-authorization.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';

const past='2020-01-02 09:30:00',future='2030-01-02 09:30:00';
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const response=await http.get(path);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;}
async function facts(http:T37Http,path:string){return {ticket:await current(http,path),schedule:await current(http,path+'/follow-up-schedule'),
  events:await current(http,path+'/events?limit=200'),responsibility:await current(http,path+'/responsibility'),deliveries:await current(http,path+'/deliveries')};}
function scheduleCommand(ticket:Record<string,unknown>,schedule:Record<string,unknown>,action:'SET'|'CANCEL',dueAt:string|null){return {
  client_command_id:randomUUID(),expected_version:version(ticket.version),expected_schedule_version:text(schedule.schedule_version),
  reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action,due_at:dueAt};}
async function set(http:T37Http,path:string,dueAt:string){
  const ticket=await current(http,path),schedule=await current(http,path+'/follow-up-schedule');
  const response=await http.post(path+'/follow-up-schedule',scheduleCommand(ticket,schedule,'SET',dueAt));assert.equal(response.status,200,JSON.stringify(response.value));
}
async function markers(fixture:T37Fixture,ticketId:string){return (await fixture.pool.query<{schedule_version:string}>(
  'SELECT schedule_version::text FROM pilot_ticket.follow_up_due_signal WHERE ticket_id=$1::uuid ORDER BY schedule_version',[ticketId])).rows.map(row=>row.schedule_version);}
async function signals(fixture:T37Fixture,ticketId:string){
  const authorization=createPilotWorkbenchAuthorizationAdapter({pool:fixture.pool}),principal=await authorization.resolvePrincipal({principal_id:fixture.dispatcher});assert.ok(principal);
  const scope=await authorization.resolveRealtimeAuthorization(principal,{limit:256,availabilityFallback:true,followUpSchedulesEnabled:true});assert.ok(scope);
  const page=await createRealtimeEventStore({pool:fixture.pool,enabled:true}).listAuthorizedEvents({authorization:scope,afterEventId:'0',limit:200});
  return page.events.filter(event=>event.aggregate_id===ticketId&&event.event_type==='ticket.updated'&&event.payload.reason==='FOLLOW_UP_DUE');
}
async function within<T>(task:Promise<T>,label:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([task,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(Error(label)),10000);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
function holdActualCandidateResults(pool:PostgresPool,expectedCalls=1){
  const original=pool.query,captured:{ticket_id:string;schedule_version:string}[][]=[];
  let entered:()=>void=()=>{},release:()=>void=()=>{};
  const arrived=new Promise<void>(resolve=>{entered=resolve;}),released=new Promise<void>(resolve=>{release=resolve;});
  const forwarded=new Proxy(original,{apply(target,receiver:unknown,args:unknown[]){
    const actual:unknown=Reflect.apply(target,receiver,args);
    const sql=args[0];
    if(typeof sql!=='string'||!sql.includes('FROM pilot_ticket.follow_up_schedule s')||!sql.includes('ORDER BY s.due_epoch_ms,s.ticket_id LIMIT $1'))return actual;
    return Promise.resolve(actual).then(async result=>{
      // Observe an already completed real SELECT; neither rows nor errors are fabricated or modified.
      captured.push(rows(object(result).rows).map(row=>({ticket_id:text(row.ticket_id),schedule_version:text(row.schedule_version)})));
      if(captured.length===expectedCalls)entered();
      await released;return result;
    });
  }});
  pool.query=forwarded;
  return {captured,wait:()=>within(arrived,'T37_REAL_DUE_CANDIDATE_BOUNDARY_NOT_REACHED'),release,
    restore:()=>{pool.query=original;release();}};
}

test('a genuinely RESOLVED Ticket retains its active due arrangement but cannot receive a new SET or CANCEL',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),handler=await fixture.http(1),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
    for(const action of ['accept','start']){
      const ticket=await current(handler,path),response=await handler.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version(ticket.version),reason_code:'T37_REAL_'+action.toUpperCase()});
      assert.equal(response.status,200,JSON.stringify(response.value));
    }
    assert.equal((await current(handler,path)).status,'IN_PROGRESS');await set(handler,path,past);
    const running=await current(handler,path),resolve=await handler.post(path+'/resolve',{client_command_id:randomUUID(),expected_version:version(running.version),reason_code:'T37_REAL_RESOLVE'});
    assert.equal(resolve.status,200,JSON.stringify(resolve.value));const resolved=await facts(dispatcher,path);
    assert.equal(resolved.ticket.status,'RESOLVED');assert.equal(object(resolved.schedule.active).due_at,past);assert.equal(object(resolved.schedule.active).is_due,true);
    assert.equal(resolved.schedule.schedule_version,'1');assert.deepEqual(resolved.schedule.allowed_actions,[]);
    for(const actor of [handler,dispatcher]){
      const readable=await current(actor,path+'/follow-up-schedule');assert.equal(object(readable.active).is_due,true);assert.deepEqual(readable.allowed_actions,[]);
      for(const [action,dueAt] of [['SET',future],['CANCEL',null]] as const){
        const refused=await actor.post(path+'/follow-up-schedule',scheduleCommand(resolved.ticket,resolved.schedule,action,dueAt));
        assert.equal(refused.status,403,JSON.stringify(refused.value));assert.deepEqual(await facts(dispatcher,path),resolved);
      }
    }
    assert.deepEqual(await markers(fixture,ticketId),[]);assert.equal((await signals(fixture,ticketId)).length,0);
    assert.deepEqual(await fixture.runtime.runFollowUpDueBatch(),{scanned:1,emitted:1,skipped:0});
    assert.deepEqual(await markers(fixture,ticketId),['1']);const emitted=await signals(fixture,ticketId);assert.equal(emitted.length,1);
    assert.equal(emitted[0]?.aggregate_version,String(resolved.ticket.version));assert.equal(emitted[0]?.payload.follow_up_schedule_version,'1');
    assert.deepEqual(await facts(dispatcher,path),resolved,'due publication must not close RESOLVED or alter version, Event, responsibility or Delivery');
    assert.deepEqual(await fixture.runtime.runFollowUpDueBatch(),{scanned:0,emitted:0,skipped:0});assert.equal((await signals(fixture,ticketId)).length,1);
  },{workbenchFollowUpSchedulesEnabled:true});
});

test('already selected due candidates recheck real close and reschedule commits and two native runtimes publish one revision once',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),handler=await fixture.http(1),closedId=await fixture.createTicket(),closedPath='/api/tickets/'+closedId;
    const queued=await current(handler,closedPath),started=await handler.post(closedPath+'/take-and-start',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'T37_RACE_REAL_START',resolver_team_id:text(queued.resolver_team_id)});
    assert.equal(started.status,200,JSON.stringify(started.value));await set(handler,closedPath,past);
    const beforeClose=await facts(handler,closedPath),closeGate=holdActualCandidateResults(fixture.pool);
    const oldCloseCandidate=fixture.runtime.runFollowUpDueBatch();void oldCloseCandidate.catch(()=>{});
    try{
      await closeGate.wait();assert.deepEqual(closeGate.captured,[[{ticket_id:closedId,schedule_version:'1'}]]);
      // The actual command acquires its existing stream/Ticket/cycle locks and commits while the old candidate is parked.
      const closed=await handler.post(closedPath+'/complete',{client_command_id:randomUUID(),expected_version:version(beforeClose.ticket.version),reason_code:'STAFF_COMPLETED',
        handling_cycle_id:text(object(beforeClose.ticket.handling_cycle).id),internal_process:'T37 有界真实关闭竞争验证',external_summary:'合成处置已完成。',external_summary_confirmed:true});
      assert.equal(closed.status,200,JSON.stringify(closed.value));const committed=await facts(handler,closedPath);assert.equal(committed.ticket.status,'CLOSED');assert.equal(committed.schedule.active,null);
      closeGate.release();assert.deepEqual(await oldCloseCandidate,{scanned:1,emitted:0,skipped:1});
      assert.deepEqual(await markers(fixture,closedId),[]);assert.equal((await signals(fixture,closedId)).length,0);assert.deepEqual(await facts(handler,closedPath),committed);
    }finally{closeGate.restore();await Promise.allSettled([oldCloseCandidate]);}

    const changedId=await fixture.createTicket(),changedPath='/api/tickets/'+changedId;await set(dispatcher,changedPath,past);
    const changeGate=holdActualCandidateResults(fixture.pool),oldRevision=fixture.runtime.runFollowUpDueBatch();void oldRevision.catch(()=>{});
    try{
      await changeGate.wait();assert.deepEqual(changeGate.captured,[[{ticket_id:changedId,schedule_version:'1'}]]);
      await set(dispatcher,changedPath,future);const committed=await facts(dispatcher,changedPath);assert.equal(committed.schedule.schedule_version,'2');assert.equal(object(committed.schedule.active).is_due,false);
      changeGate.release();assert.deepEqual(await oldRevision,{scanned:1,emitted:0,skipped:1});
      assert.deepEqual(await markers(fixture,changedId),[]);assert.equal((await signals(fixture,changedId)).length,0);assert.deepEqual(await facts(dispatcher,changedPath),committed);
    }finally{changeGate.restore();await Promise.allSettled([oldRevision]);}

    await set(dispatcher,changedPath,past);const beforeConcurrent=await facts(dispatcher,changedPath);assert.equal(beforeConcurrent.schedule.schedule_version,'3');
    const second=createP2016Runtime({pool:fixture.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:fixture.origin,listenPort:Number(new URL(fixture.origin).port),
      principalIds:[fixture.dispatcher,fixture.handler,fixture.otherHandler],gatewayEnabled:false,senderEnabled:false,externalSendEnabled:false,workbenchFollowUpSchedulesEnabled:true});
    // A second actual composition has its own dueBusy guard. No second HTTP listener, worker timer or pool is opened.
    const concurrentGate=holdActualCandidateResults(fixture.pool,2),firstRun=fixture.runtime.runFollowUpDueBatch(),secondRun=second.runFollowUpDueBatch();
    void firstRun.catch(()=>{});void secondRun.catch(()=>{});
    try{
      await concurrentGate.wait();assert.deepEqual(concurrentGate.captured,[[{ticket_id:changedId,schedule_version:'3'}],[{ticket_id:changedId,schedule_version:'3'}]]);
      concurrentGate.release();const outcomes=await Promise.all([firstRun,secondRun]);
      assert.deepEqual(outcomes.map(result=>result.scanned),[1,1]);assert.equal(outcomes.reduce((sum,result)=>sum+result.emitted,0),1);assert.equal(outcomes.reduce((sum,result)=>sum+result.skipped,0),1);
      assert.deepEqual(await markers(fixture,changedId),['3']);const emitted=await signals(fixture,changedId);assert.equal(emitted.length,1);assert.equal(emitted[0]?.payload.follow_up_schedule_version,'3');
      assert.deepEqual(await facts(dispatcher,changedPath),beforeConcurrent);assert.deepEqual(await markers(fixture,closedId),[]);
      assert.deepEqual(await fixture.runtime.runFollowUpDueBatch(),{scanned:0,emitted:0,skipped:0});assert.deepEqual(await second.runFollowUpDueBatch(),{scanned:0,emitted:0,skipped:0});
      console.log('T37_DUE_RACE '+JSON.stringify({real_candidate_selects:true,close_before_recheck:true,reschedule_before_recheck:true,concurrent_runtime_results:outcomes,markers:1,due_events:1}));
    }finally{
      concurrentGate.restore();await Promise.allSettled([firstRun,secondRun]);await second.stop();assert.equal(second.server.listening,false);assert.equal((await second.observability.metrics()).sse_clients,0);
    }
  },{workbenchFollowUpSchedulesEnabled:true,lifecycleEnabled:true});
});
