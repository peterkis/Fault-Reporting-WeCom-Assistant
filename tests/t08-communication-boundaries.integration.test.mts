// Registered original T08 tracer; initially NOT_RUN. Real original T08 selected relation and same-Tx rollback cases.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,object,rows,text} from './helpers/t08-fixture.mjs';
import type {T08Fixture} from './helpers/t08-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createContactJourneyStore} from '../src/p2-015-contact-journey.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createRuleFirstOrchestrator} from '../src/p2-015-rule-first-orchestrator.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort} from '../src/p2-015-safe-action-executor.mjs';
import {createManualReviewStore} from '../src/p2-015-manual-review.mjs';
import {createDecisionStore} from '../src/p2-015-decision-store.mjs';
import {createServiceIntakeDecisionPort} from '../src/p2-015-service-intake-decision-port.mjs';

const command=(target:string,sessions:{session_id:string;expected_row_version:number}[])=>({client_command_id:randomUUID(),expected_version:2,
 reason_code:'WORKBENCH_UNASSIGN',reason:'原处理未开始，明确原子交接所选沟通。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:target,sessions});
async function drain(fixture:T08Fixture){const initial=await fixture.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/fixture.runtime.coordinator.batchSize)+3;
 for(let step=0;step<bound;step++){const inbound=await fixture.runtime.coordinator.runOnce(),realtime=await fixture.runtime.realtimeProjector.runOnce({limit:100});
  assert.ok(inbound.streams.every(stream=>stream.failures.length===0));if(inbound.processed===0&&realtime.processed===0&&(await fixture.runtime.coordinator.backlog()).total===0)return;}
 assert.fail('finite T08 projection did not settle');}
async function accept(fixture:T08Fixture,ticket:string){const handler=await fixture.http(2);assert.equal((await handler.post('/api/tickets/'+ticket+'/accept',{
 client_command_id:randomUUID(),expected_version:1,reason_code:'T08_BOUNDARY_REAL_ACCEPT'})).status,200);}

test('unassign Ticket READ does not substitute for exact canonical Session membership, row version or a current internal receiver',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),ticket=await fixture.createTicket(),other=await fixture.createTicket(),path='/api/tickets/'+ticket;
  await accept(fixture,ticket);await drain(fixture);const source=rows((await admin.get(path+'/related-conversations')).value.items)[0];assert.ok(source);
  const foreign=rows((await admin.get('/api/tickets/'+other+'/related-conversations')).value.items)[0];assert.ok(foreign);
  assert.equal((await admin.get('/api/conversations/'+foreign.session_id)).status,200,'a readable unrelated Session is not a canonical link');
  const before={ticket:(await admin.get(path)).value,responsibility:(await admin.get(path+'/responsibility')).value,
   history:(await admin.get(path+'/events?limit=200')).value,deliveries:(await admin.get(path+'/deliveries')).value};
  const selected=[{session_id:text(source.session_id),expected_row_version:Number(source.session_row_version)}];
  const stale=command(fixture.otherHandler,[{session_id:text(source.session_id),expected_row_version:Number(source.session_row_version)+1}]);
  assert.equal((await admin.post(path+'/unassign',stale)).status,409);
  const unrelated=command(fixture.otherHandler,[{session_id:text(foreign.session_id),expected_row_version:Number(foreign.session_row_version)}]);
  assert.equal((await admin.post(path+'/unassign',unrelated)).status,404);
  const missing=command(randomUUID(),selected);assert.equal((await admin.post(path+'/unassign',missing)).status,403);
  assert.deepEqual({ticket:(await admin.get(path)).value,responsibility:(await admin.get(path+'/responsibility')).value,
   history:(await admin.get(path+'/events?limit=200')).value,deliveries:(await admin.get(path+'/deliveries')).value},before);
  for(const body of [stale,unrelated,missing])assert.equal((await fixture.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=$1::uuid',[body.client_command_id])).rowCount,0);
 });
});

test('failure on the second explicitly selected real Journey Session rolls back the first Control write and all Ticket facts',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),ticket=await fixture.createTicket(),path='/api/tickets/'+ticket;await accept(fixture,ticket);await drain(fixture);
  const original=(await admin.get(path)).value,core=createPilotTicketCore({pool:fixture.pool});
  // This minimal fixture deliberately has no background Orchestration worker. Establish the origin
  // through its existing real Port, exactly as the production source flow does; no SQL relation writes.
  const orchestrator=createRuleFirstOrchestrator({pool:fixture.pool,identityHmacKey:'t08-only-synthetic-origin-key',decisionStore:createDecisionStore(),
   safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:core}),manualReviewStore:createManualReviewStore(),decisionStore:createDecisionStore()}),
   ruleEngine:{catalog_version:'T08_FIXTURE',rule_set_version:'T08_FIXTURE',evaluate(){throw Error('synthetic origin requests human review');}}});
  const prepared=object(await orchestrator.processPersistedIntake({service_intake_id:text(original.intake_id),feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}}));
  assert.equal(prepared.ok,true);assert.equal(prepared.model_provider_calls,0);assert.equal(prepared.sender_calls,0);await drain(fixture);
  assert.equal((await admin.get(path)).value.version,2);assert.equal((await admin.get(path)).value.assignee_id,fixture.handler);
  const leg=(await fixture.pool.query<{journey_id:string;reporter_identity_hash:string;provider_context_hash:string;channel_identity_hash:string}>(`SELECT l.journey_id::text,l.reporter_identity_hash,l.provider_context_hash,l.channel_identity_hash
   FROM intake.channel_leg l JOIN pilot_ticket.ticket t ON t.source_intake_id=l.source_intake_id WHERE t.id=$1::uuid`,[ticket])).rows[0];assert.ok(leg);
  const continuations=[];for(let n=0;n<2;n++)continuations.push(object(await seedPersistedIntake({pool:fixture.pool,text:'T08 real rollback continuation '+n,requestType:'INCIDENT',status:'RECEIVED'})));await drain(fixture);
  const selected:{session_id:string;expected_row_version:number}[]=[];
  for(const intake of continuations){const session=(await fixture.pool.query<{id:string;thread_id:string;row_version:string}>('SELECT id::text,thread_id::text,row_version::text FROM conversation.session WHERE service_intake_id=$1::uuid',[intake.intakeId])).rows[0];assert.ok(session);
   await createContactJourneyStore().ensureLeg({transaction:fixture.pool,input:{journey_id:leg.journey_id,leg_type:'GROUP_CONTINUATION',source_intake_id:text(intake.intakeId),conversation_thread_id:session.thread_id,conversation_session_id:session.id,
    origin_channel_message_id:text(intake.messageId),provider_context_hash:leg.provider_context_hash,channel_identity_hash:leg.channel_identity_hash,reporter_identity_hash:leg.reporter_identity_hash,opened_at:text(intake.receivedAt)}});
   selected.push({session_id:session.id,expected_row_version:Number(session.row_version)});}
  selected.sort((a,b)=>a.session_id.localeCompare(b.session_id));const first=selected[0],last=selected.at(-1);assert.ok(first&&last);assert.equal(rows((await admin.get(path+'/related-conversations')).value.items).length,3);
  const snapshot=async()=>({ticket:(await admin.get(path)).value,events:(await admin.get(path+'/events?limit=200')).value,responsibility:(await admin.get(path+'/responsibility')).value,deliveries:(await admin.get(path+'/deliveries')).value,
   sessions:(await fixture.pool.query('SELECT id::text,row_version::text,generation_version::text,control_mode FROM conversation.session WHERE id=ANY($1::uuid[]) ORDER BY id',[selected.map(row=>row.session_id)])).rows,
   counts:(await fixture.pool.query('SELECT (SELECT count(*) FROM conversation.control_event)::int AS control,(SELECT count(*) FROM conversation.realtime_event)::int AS realtime,(SELECT count(*) FROM pilot_ticket.ticket_handling_cycle)::int AS cycle')).rows});
  const before=await snapshot(),body=command(fixture.otherHandler,selected);let installed=false;
  try{
   await fixture.pool.query('CREATE SEQUENCE platform.t08_first_write_observation');
   await fixture.pool.query(`CREATE FUNCTION platform.t08_second_selected_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM conversation.control_event WHERE session_id='${first.session_id}'::uuid AND client_command_id=NEW.client_command_id) THEN RAISE EXCEPTION 'T08_FIRST_WRITE_NOT_REACHED'; END IF;
    PERFORM nextval('platform.t08_first_write_observation');RAISE EXCEPTION 'T08_SECOND_WRITE_FAILURE_AFTER_FIRST';END $$`);
   await fixture.pool.query(`CREATE TRIGGER t08_second_selected_failure BEFORE INSERT ON conversation.control_event FOR EACH ROW WHEN (NEW.session_id='${last.session_id}'::uuid) EXECUTE FUNCTION platform.t08_second_selected_failure()`);installed=true;
   const failed=await admin.post(path+'/unassign',body);assert.equal(failed.status,503,JSON.stringify(failed.value));
   assert.equal((await fixture.pool.query('SELECT is_called FROM platform.t08_first_write_observation')).rows[0]?.is_called,true,'the second injected failure proves the first actual Control write existed');
   assert.deepEqual(await snapshot(),before);
   assert.deepEqual((await fixture.pool.query('SELECT state FROM pilot_ticket.ticket_command_receipt WHERE ticket_id=$1::uuid AND client_command_id=$2::uuid',[ticket,body.client_command_id])).rows,[{state:'FAILED'}]);
   assert.equal((await fixture.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=$1::uuid',[body.client_command_id])).rowCount,0);
   const ack=await admin.get(path+'/unassign/commands/'+body.client_command_id);assert.equal(ack.status,200);assert.equal(ack.value.state,'FAILED');assert.deepEqual(Object.keys(ack.value).sort(),['error','state']);
  }finally{if(installed)await fixture.pool.query('DROP TRIGGER t08_second_selected_failure ON conversation.control_event');await fixture.pool.query('DROP FUNCTION IF EXISTS platform.t08_second_selected_failure()');await fixture.pool.query('DROP SEQUENCE IF EXISTS platform.t08_first_write_observation');}
  const succeeded=await admin.post(path+'/unassign',command(fixture.otherHandler,selected));assert.equal(succeeded.status,200,JSON.stringify(succeeded.value));
  const changed=rows(succeeded.value.conversations);assert.equal(changed.length,2);assert.ok(changed.every(row=>row.changed===true&&typeof row.control_event_id==='string'));
  assert.equal((await admin.get(path)).value.status,'QUEUED');assert.equal((await admin.get(path)).value.assignee_id,null);assert.equal((await admin.get(path)).value.version,3);
  const responsibility=rows((await admin.get(path+'/responsibility')).value.conversations);for(const row of selected){const current=responsibility.find(current=>current.session_id===row.session_id);assert.ok(current);assert.equal(current.conversation_principal_id,fixture.otherHandler);assert.equal(Number(current.session_row_version),row.expected_row_version+1);}
  assert.deepEqual((await admin.get(path+'/deliveries')).value,before.deliveries);
 });
});
