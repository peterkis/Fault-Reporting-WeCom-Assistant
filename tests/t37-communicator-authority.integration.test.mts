import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';

function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
async function snapshot(http:T37Http,path:string){return {ticket:await current(http,path),schedule:await current(http,path+'/follow-up-schedule'),
  responsibility:await current(http,path+'/responsibility'),events:await current(http,path+'/events?limit=200'),deliveries:await current(http,path+'/deliveries')};}
function scheduleCommand(ticket:Record<string,unknown>,schedule:Record<string,unknown>,action:'SET'|'CANCEL',dueAt:string|null){
  return {client_command_id:randomUUID(),expected_version:version(ticket.version),expected_schedule_version:text(schedule.schedule_version),
    reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action,due_at:dueAt};
}
/** Same actual coordinator/realtime Ports and finite bound used by T06/T08; no fabricated Session/assignment. */
async function drain(fixture:T37Fixture){
  const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;
  }
  assert.fail('actual canonical Session projection did not settle within the fixture bound');
}

test('current canonical communicator needs current Ticket READ and loses new shared-time maintenance on actual Session release', {timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),communicator=await fixture.http(1),path='/api/tickets/'+await fixture.createTicket();
    const queued=await current(dispatcher,path);
    const assigned=await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',
      target_principal_id:fixture.otherHandler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(assigned.status,200,JSON.stringify(assigned.value));
    await drain(fixture);
    const related=await current(dispatcher,path+'/related-conversations?limit=20'),sources=rows(related.items);
    assert.equal(sources.length,1,'single-source fixture must establish an actual canonical relation');assert.equal(related.next_cursor,null);
    const source=sources[0];assert.ok(source);const sessionPath='/api/conversations/'+text(source.session_id);
    const sessionBefore=await current(communicator,sessionPath),initialSession=object(sessionBefore.session);
    assert.notEqual(initialSession.status,'ENDED');assert.equal(initialSession.session_id,source.session_id);
    const takeover=await communicator.post(sessionPath+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(initialSession.row_version),reason_code:'T37_CURRENT_COMMUNICATOR'});
    assert.equal(takeover.status,200,JSON.stringify(takeover.value));
    const controlled=await current(communicator,sessionPath);assert.equal(object(controlled.assignment).status,'ASSIGNED');assert.equal(object(controlled.assignment).assigned_to_me,true);
    const canonicalNow=rows((await current(communicator,path+'/related-conversations?limit=20')).items);
    assert.ok(canonicalNow.some(row=>row.session_id===source.session_id&&row.assignment_status==='ASSIGNED'&&row.conversation_principal_id===fixture.handler));
    const before=await snapshot(dispatcher,path);assert.equal((await communicator.get(path)).status,200);
    assert.equal(before.ticket.assignee_id,fixture.otherHandler);assert.notEqual(before.ticket.assignee_id,fixture.handler);
    assert.ok(object(before.ticket.handling_cycle).id,'actual T06 assignment established039 cycle');
    const command=scheduleCommand(before.ticket,before.schedule,'SET','2030-01-02 09:30:00');
    // This is the intended original product RED: current producer omits canonical communicator maintenance.
    const set=await communicator.post(path+'/follow-up-schedule',command);assert.equal(set.status,200,JSON.stringify(set.value));
    const arranged=await snapshot(dispatcher,path);
    assert.equal(object(arranged.schedule.active).due_at,'2030-01-02 09:30:00');assert.equal(arranged.schedule.schedule_version,'1');
    assert.equal(arranged.ticket.version,version(before.ticket.version)+1);assert.equal(arranged.ticket.status,before.ticket.status);
    assert.equal(arranged.ticket.assignee_id,fixture.otherHandler);assert.equal(arranged.ticket.resolver_team_id,before.ticket.resolver_team_id);
    assert.deepEqual(arranged.ticket.handling_cycle,before.ticket.handling_cycle);assert.deepEqual(arranged.responsibility,before.responsibility);
    assert.equal(rows(arranged.events.items).length,rows(before.events.items).length+1);assert.deepEqual(arranged.deliveries,before.deliveries);
    assert.deepEqual((await current(communicator,path+'/follow-up-schedule')).allowed_actions,['SET','CANCEL']);

    const beforeRelease=await current(communicator,sessionPath);
    const release=await communicator.post(sessionPath+'/release',{client_command_id:randomUUID(),expected_row_version:version(object(beforeRelease.session).row_version),reason_code:'T37_RELEASE_COMMUNICATION_ONLY'});
    assert.equal(release.status,200,JSON.stringify(release.value));assert.equal(object(release.value.assignment).assignment_status,'UNASSIGNED');
    assert.equal(object((await current(communicator,sessionPath)).assignment).assigned_to_me,false);
    assert.equal((await communicator.get(path)).status,200,'actual team READ remains after communication release');
    const released=await snapshot(dispatcher,path);assert.deepEqual(released.schedule,arranged.schedule);assert.deepEqual(released.ticket,arranged.ticket);
    assert.deepEqual((await current(communicator,path+'/follow-up-schedule')).allowed_actions,[]);
    for(const [action,due] of [['SET','2030-01-02 10:00:00'],['CANCEL',null]] as const){
      const rejected=await communicator.post(path+'/follow-up-schedule',scheduleCommand(released.ticket,released.schedule,action,due));
      assert.equal(rejected.status,403,JSON.stringify(rejected.value));assert.deepEqual(await snapshot(dispatcher,path),released);
    }
    const originalAck=await communicator.get(path+'/follow-up-schedule/commands/'+command.client_command_id);assert.equal(originalAck.status,200);
    assert.deepEqual(originalAck.value,{client_command_id:command.client_command_id,ticket_id:text(arranged.ticket.id),state:'COMMITTED',result:{...set.value,replayed:true}});

    const unassigned=await current(communicator,sessionPath);
    const retake=await communicator.post(sessionPath+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(object(unassigned.session).row_version),reason_code:'T37_RETAKE_READ_FENCE'});
    assert.equal(retake.status,200,JSON.stringify(retake.value));assert.equal(object((await current(communicator,sessionPath)).assignment).assigned_to_me,true);
    await fixture.setHandlerTeams([]); // Actual Principal configuration Port; no SQL assignment or business-state writes.
    const independent=await current(communicator,sessionPath);assert.equal(object(independent.assignment).assigned_to_me,true);
    const note=await communicator.post(sessionPath+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:version(object(independent.session).row_version),
      reason_code:'T37_SESSION_CONTROL_WITHOUT_TICKET_READ',text:'T37 合成内部沟通记录'});assert.equal(note.status,201,JSON.stringify(note.value));
    const lostRead=await snapshot(dispatcher,path);
    assert.equal((await communicator.get(path)).status,404);assert.equal((await communicator.get(path+'/follow-up-schedule')).status,404);
    assert.equal((await communicator.get(path+'/follow-up-schedule/commands/'+command.client_command_id)).status,404);
    const forbidden=await communicator.post(path+'/follow-up-schedule',scheduleCommand(lostRead.ticket,lostRead.schedule,'CANCEL',null));
    assert.equal(forbidden.status,404,JSON.stringify(forbidden.value));assert.deepEqual(await snapshot(dispatcher,path),lostRead);
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true});
});
