// STAGED_RUNTIME / first actual authority, resource or schema boundary execution pending.
// Intended location after review: tests/t37-communicator-boundaries.integration.test.mts.
// No independent conversation end HTTP/Control action exists in the current source.
// ENDED below is produced by the native coordinator's existing DIFFERENT_INTAKE transition:
// two distinct persisted single-chat Intakes for the same bot/participant, then coordinator.runOnce().
// No test UPDATE/INSERT of conversation.session, conversation.assignment or canonical relation tables.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createContactJourneyStore} from '../src/p2-015-contact-journey.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createRuleFirstOrchestrator} from '../src/p2-015-rule-first-orchestrator.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort} from '../src/p2-015-safe-action-executor.mjs';
import {createManualReviewStore} from '../src/p2-015-manual-review.mjs';
import {createDecisionStore} from '../src/p2-015-decision-store.mjs';
import {createServiceIntakeDecisionPort} from '../src/p2-015-service-intake-decision-port.mjs';

interface OriginLeg {journey_id:string;reporter_identity_hash:string;provider_context_hash:string;channel_identity_hash:string}
interface SessionRow {id:string;thread_id:string;row_version:string;status:string;service_intake_id:string}
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
async function snapshot(http:T37Http,path:string){return {ticket:await current(http,path),schedule:await current(http,path+'/follow-up-schedule'),events:await current(http,path+'/events?limit=200'),responsibility:await current(http,path+'/responsibility'),deliveries:await current(http,path+'/deliveries')};}
function command(ticket:Record<string,unknown>,schedule:Record<string,unknown>,action:'SET'|'CANCEL'='SET'){
  return {client_command_id:randomUUID(),expected_version:version(ticket.version),expected_schedule_version:text(schedule.schedule_version),reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action,due_at:action==='SET'?'2030-01-02 09:30:00':null};
}
async function drain(fixture:T37Fixture){
  const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;
  }
  assert.fail('T37_BOUNDARIES_NATIVE_PROJECTION_DID_NOT_SETTLE');
}
async function sessionForIntake(fixture:T37Fixture,intakeId:string):Promise<SessionRow>{
  const result=await fixture.pool.query<SessionRow>('SELECT id::text,thread_id::text,row_version::text,status,service_intake_id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[intakeId]);
  assert.equal(result.rows.length,1,'each fresh fixture Intake must have its actual coordinator-created Session');const session=result.rows[0];assert.ok(session);return session;
}
async function takeover(dispatcher:T37Http,sessionId:string,targetPrincipal:string){
  const path='/api/conversations/'+sessionId,before=await current(dispatcher,path);
  const result=await dispatcher.post(path+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(object(before.session).row_version),target_principal_id:targetPrincipal,reason_code:'T37_BOUNDARY_CANONICAL_OWNER'});
  assert.equal(result.status,200,JSON.stringify(result.value));
}
async function originJourney(fixture:T37Fixture,ticket:Record<string,unknown>):Promise<OriginLeg>{
  // Same existing Orchestrator/Command Ports used by the T08 multi-Session fixture.
  // This fixture has no background orchestration worker; explicitly establish the real origin leg.
  const core=createPilotTicketCore({pool:fixture.pool}),orchestrator=createRuleFirstOrchestrator({pool:fixture.pool,identityHmacKey:'t37-only-synthetic-origin-identity-key',decisionStore:createDecisionStore(),
    safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:core}),manualReviewStore:createManualReviewStore(),decisionStore:createDecisionStore()}),
    ruleEngine:{catalog_version:'T37_BOUNDARY_FIXTURE',rule_set_version:'T37_BOUNDARY_FIXTURE',evaluate(){throw Error('synthetic origin requests human review');}}});
  const prepared=object(await orchestrator.processPersistedIntake({service_intake_id:text(ticket.intake_id),feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}}));
  assert.equal(prepared.ok,true);assert.equal(prepared.model_provider_calls,0);assert.equal(prepared.sender_calls,0);await drain(fixture);
  const leg=(await fixture.pool.query<OriginLeg>(`SELECT l.journey_id::text,l.reporter_identity_hash,l.provider_context_hash,l.channel_identity_hash
    FROM intake.channel_leg l JOIN pilot_ticket.ticket t ON t.source_intake_id=l.source_intake_id WHERE t.id=$1::uuid`,[ticket.id])).rows[0];
  assert.ok(leg,'the original canonical leg must come from the real Orchestrator Port');return leg;
}
async function continuation(fixture:T37Fixture,origin:OriginLeg,chatType:'group'|'single'):Promise<SessionRow>{
  const intake=object(await seedPersistedIntake({pool:fixture.pool,text:'T37 actual '+chatType+' continuation '+randomUUID(),chatType,requestType:'INCIDENT',status:'RECEIVED'}));
  await drain(fixture);const session=await sessionForIntake(fixture,text(intake.intakeId));assert.equal(session.status,'OPEN');
  await createContactJourneyStore().ensureLeg({transaction:fixture.pool,input:{journey_id:origin.journey_id,leg_type:chatType==='group'?'GROUP_CONTINUATION':'DIRECT_ORGANIC',source_intake_id:text(intake.intakeId),
    conversation_thread_id:session.thread_id,conversation_session_id:session.id,origin_channel_message_id:text(intake.messageId),provider_context_hash:origin.provider_context_hash,
    channel_identity_hash:origin.channel_identity_hash,reporter_identity_hash:origin.reporter_identity_hash,opened_at:text(intake.receivedAt)}});
  return session;
}

test('only an active ASSIGNED Session in this Ticket canonical relation authorizes shared follow-up, including multiple, foreign and genuinely ENDED Sessions',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const dispatcher=await fixture.http(0),communicator=await fixture.http(1),ticketId=await fixture.createTicket(),foreignTicketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
    const queued=await current(dispatcher,path),assignment=await dispatcher.post(path+'/assign',{client_command_id:randomUUID(),expected_version:version(queued.version),reason_code:'WORKBENCH_ASSIGN',
      target_principal_id:fixture.otherHandler,resolver_team_id:text(queued.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(assignment.status,200,JSON.stringify(assignment.value));await drain(fixture);
    const initial=await current(dispatcher,path),originSession=await sessionForIntake(fixture,text(initial.intake_id)),journey=await originJourney(fixture,initial);
    const group=await continuation(fixture,journey,'group'),direct=await continuation(fixture,journey,'single');
    const foreignTicket=await current(dispatcher,'/api/tickets/'+foreignTicketId),foreign=await sessionForIntake(fixture,text(foreignTicket.intake_id));
    await takeover(dispatcher,originSession.id,fixture.otherHandler);await takeover(dispatcher,group.id,fixture.otherHandler);await takeover(dispatcher,foreign.id,fixture.handler);
    const foreignRead=await current(communicator,'/api/conversations/'+foreign.id);assert.equal(object(foreignRead.assignment).status,'ASSIGNED');assert.equal(object(foreignRead.assignment).assigned_to_me,true);
    const related=await current(dispatcher,path+'/related-conversations?limit=20'),canonical=rows(related.items).map(row=>text(row.session_id)).sort();
    assert.deepEqual(canonical,[originSession.id,group.id,direct.id].sort());assert.equal(related.next_cursor,null);assert.equal(canonical.includes(foreign.id),false);
    assert.equal((await communicator.get(path)).status,200,'target Ticket READ is independently available');
    const foreignOnly=await snapshot(dispatcher,path);assert.equal(foreignOnly.ticket.assignee_id,fixture.otherHandler);assert.notEqual(foreignOnly.ticket.assignee_id,fixture.handler);
    assert.deepEqual((await current(communicator,path+'/follow-up-schedule')).allowed_actions,[]);
    const refusedForeign=await communicator.post(path+'/follow-up-schedule',command(foreignOnly.ticket,foreignOnly.schedule));assert.equal(refusedForeign.status,403,JSON.stringify(refusedForeign.value));
    assert.deepEqual(await snapshot(dispatcher,path),foreignOnly,'owning a readable foreign Session cannot write this Ticket');

    // One of three canonical Sessions now belongs to the communicator. Others stay independently owned.
    await takeover(dispatcher,direct.id,fixture.handler);
    const controlled=await current(communicator,'/api/conversations/'+direct.id);assert.equal(object(controlled.session).status,'OPEN');assert.equal(object(controlled.assignment).status,'ASSIGNED');assert.equal(object(controlled.assignment).assigned_to_me,true);
    const ownedCanonical=rows((await current(dispatcher,path+'/related-conversations?limit=20')).items).filter(row=>row.assignment_status==='ASSIGNED'&&row.conversation_principal_id===fixture.handler);
    assert.deepEqual(ownedCanonical.map(row=>row.session_id),[direct.id]);
    assert.deepEqual((await current(communicator,path+'/follow-up-schedule')).allowed_actions,['SET']);
    const before=await snapshot(dispatcher,path),setCommand=command(before.ticket,before.schedule),set=await communicator.post(path+'/follow-up-schedule',setCommand);
    assert.equal(set.status,200,JSON.stringify(set.value));const arranged=await snapshot(dispatcher,path);
    assert.equal(arranged.ticket.version,version(before.ticket.version)+1);assert.equal(arranged.ticket.assignee_id,fixture.otherHandler);assert.deepEqual(arranged.ticket.handling_cycle,before.ticket.handling_cycle);
    assert.equal(arranged.schedule.schedule_version,'1');assert.equal(object(arranged.schedule.active).due_at,'2030-01-02 09:30:00');assert.deepEqual(arranged.responsibility,before.responsibility);assert.deepEqual(arranged.deliveries,before.deliveries);
    assert.equal(rows(arranged.events.items).length,rows(before.events.items).length+1);assert.deepEqual((await current(communicator,path+'/follow-up-schedule')).allowed_actions,['SET','CANCEL']);

    // Existing native inbound boundary, not a fabricated end action or a direct Session state update.
    // seedPersistedIntake(single) keeps bot-test/user-test, so a new Intake resolves the same thread/participant.
    // Do not ensureLeg for this new topic: it must not become another canonical authority for the target Ticket.
    const nextTopic=object(await seedPersistedIntake({pool:fixture.pool,text:'T37 explicit distinct persisted single-chat topic '+randomUUID(),chatType:'single',requestType:'INCIDENT',status:'RECEIVED'}));
    await drain(fixture);const newSession=await sessionForIntake(fixture,text(nextTopic.intakeId));
    assert.notEqual(newSession.id,direct.id);assert.equal(newSession.thread_id,direct.thread_id);assert.equal(newSession.status,'OPEN');
    const ended=await current(communicator,'/api/conversations/'+direct.id);assert.equal(object(ended.session).status,'ENDED');assert.equal(object(ended.assignment).status,'ASSIGNED');assert.equal(object(ended.assignment).assigned_to_me,true,'the status fence must reject ENDED even while the assignment fact remains mine');
    const persisted=(await fixture.pool.query<{status:string;close_reason:string;assignment_status:string;assigned_principal_id:string}>(`SELECT s.status,s.close_reason,a.assignment_status,a.assigned_principal_id::text
      FROM conversation.session s JOIN conversation.assignment a ON a.session_id=s.id WHERE s.id=$1::uuid`,[direct.id])).rows[0];
    assert.deepEqual(persisted,{status:'ENDED',close_reason:'DIFFERENT_INTAKE',assignment_status:'ASSIGNED',assigned_principal_id:fixture.handler});
    const remaining=rows((await current(dispatcher,path+'/related-conversations?limit=20')).items).map(row=>text(row.session_id)).sort();assert.deepEqual(remaining,[originSession.id,group.id].sort());assert.equal(remaining.includes(newSession.id),false);
    assert.equal(object((await current(communicator,'/api/conversations/'+foreign.id)).assignment).assigned_to_me,true,'the foreign ownership remains real throughout the ENDED check');
    assert.equal((await communicator.get(path)).status,200);assert.deepEqual((await current(communicator,path+'/follow-up-schedule')).allowed_actions,[]);
    const afterEnd=await snapshot(dispatcher,path);assert.deepEqual(afterEnd.ticket,arranged.ticket);assert.deepEqual(afterEnd.schedule,arranged.schedule);assert.deepEqual(afterEnd.events,arranged.events);assert.deepEqual(afterEnd.deliveries,arranged.deliveries);
    for(const action of ['SET','CANCEL'] as const){const rejected=await communicator.post(path+'/follow-up-schedule',command(afterEnd.ticket,afterEnd.schedule,action));assert.equal(rejected.status,403,JSON.stringify(rejected.value));assert.deepEqual(await snapshot(dispatcher,path),afterEnd);}
    const receipt=await communicator.get(path+'/follow-up-schedule/commands/'+setCommand.client_command_id);assert.equal(receipt.status,200);assert.deepEqual(receipt.value,{ticket_id:ticketId,client_command_id:setCommand.client_command_id,state:'COMMITTED',result:{...set.value,replayed:true}});
    console.log('T37_COMMUNICATOR_BOUNDARIES '+JSON.stringify({real_http_pg:true,canonical_count_before_end:3,own_foreign_refused:true,one_owned_canonical_set:true,ended_native_transition:'DIFFERENT_INTAKE',ended_assignment_still_mine:true,ended_set_cancel_refused:true,original_ack_still_readable:true}));
  },{workbenchFollowUpSchedulesEnabled:true,ticketAssignmentEnabled:true});
});

// Minimal independent resource-bound follow-up (not asserted by this semantic case):
// 1. Use this same ensureLeg setup at 3 and 21 real canonical Sessions; keep exactly one active
//    ASSIGNED-to-me canonical Session and a separately ASSIGNED-to-me foreign Session.
// 2. Pass a transparent PostgresTransaction to runtime.query.isCurrentCommunicator. Its generic
//    query<R>(sql,values) must await the real acquired client.query<R>, record only call count /
//    result.rows.length, and return the untouched result. Use real principal authContext and
//    BEGIN/finally ROLLBACK. No SQL text matching or fabricated row results.
// 3. Both sizes must yield the same true/false result, constant query count, and at most one
//    returned row per authorizer statement. Cover lock:false and lock:true. An old all-Session
//    scan is detected by actual returned rows and N+1 count even when the semantic result is true.
// 4. If verifying the lock bound, leave the authorizer transaction open, then use a second real
//    client and SELECT ... FOR UPDATE NOWAIT: an unselected canonical Session and its assignment
//    must stay lockable; the selected Session must conflict. Roll back and release both clients.
