import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {t12FreshHttp} from './helpers/t12-fresh-http.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {assertLocalDateTime} from '../app/server/src/platform/time-contract.mjs';
import {createContactJourneyStore} from '../app/server/src/p2-015-contact-journey.mjs';
import {listenConversationWorkbenchServer,closeConversationWorkbenchServer} from '../app/server/src/p2-006-workbench-http.mjs';

test('second canonical Session failure rolls back the first real Control, and a new explicit composite records original and new responsibility plus one staff end',async()=>{
 await withT12Fixture(async f=>{
  const s=await acceptedSetup(f);assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_TWO_START'})).status,200);
  const leg=(await f.pool.query<{journey_id:string;reporter_identity_hash:string;provider_context_hash:string;channel_identity_hash:string}>('SELECT journey_id::text,reporter_identity_hash,provider_context_hash,channel_identity_hash FROM intake.channel_leg WHERE source_intake_id=$1::uuid',[s.first.intake.intakeId])).rows[0];assert.ok(leg);
  const inputs:Record<string,unknown>[]=[];
  for(let n=0;n<2;n++){const input=object(await seedPersistedIntake({pool:f.pool,text:'T12 合成双会话 '+n,requestType:'INCIDENT',status:'RECEIVED'}));inputs.push(input);const admission=await createPilotTicketCore({pool:f.pool}).createForIntake({intakeId:text(input.intakeId),occurredAt:assertLocalDateTime(text(input.receivedAt)),traceId:'t12-two-public-admission'});assert.ok(admission.ticket);assert.equal(admission.ticket.resolver_team_id,'PILOT_IT');}
  for(let n=0;n<3;n++)await f.runtime.coordinator.runOnce();
  const selected:{session_id:string;expected_row_version:number}[]=[];
  for(const input of inputs){const session=(await f.pool.query<{id:string;thread_id:string;row_version:string}>('SELECT id::text,thread_id::text,row_version::text FROM conversation.session WHERE service_intake_id=$1::uuid',[input.intakeId])).rows[0];assert.ok(session);await createContactJourneyStore().ensureLeg({transaction:f.pool,input:{journey_id:leg.journey_id,leg_type:'GROUP_CONTINUATION',source_intake_id:text(input.intakeId),conversation_thread_id:session.thread_id,conversation_session_id:session.id,origin_channel_message_id:text(input.messageId),provider_context_hash:leg.provider_context_hash,channel_identity_hash:leg.channel_identity_hash,reporter_identity_hash:leg.reporter_identity_hash,opened_at:text(input.receivedAt)}});selected.push({session_id:session.id,expected_row_version:Number(session.row_version)});}
  selected.sort((a,b)=>a.session_id.localeCompare(b.session_id));const earlier=selected[0],last=selected[1];assert.ok(earlier&&last);
  const choices=await s.b.get(s.path+'/related-conversations');assert.equal(choices.status,200);assert.equal(rows(choices.value.items).length,3);assert.ok(selected.every(item=>rows(choices.value.items).some(row=>row.session_id===item.session_id&&row.session_row_version===String(item.expected_row_version)&&row.take_allowed===true)));
  let drained=false;for(let n=0;n<3;n++)if((await f.runtime.realtimeProjector.runOnce({limit:100})).processed===0){drained=true;break;}assert.equal(drained,true);
  await f.runtime.stop();await listenConversationWorkbenchServer(f.runtime.server,{port:Number(new URL(f.origin).port)});
  try{
   const a=await t12FreshHttp(f,0),b=await t12FreshHttp(f,2),ticketId=s.first.ticket.id;
   const snapshot=async()=>({ticket:(await b.get(s.path)).value,events:(await a.get(s.path+'/events')).value,communication:(await a.get(s.path+'/responsibility')).value.conversations,deliveries:(await a.get(s.path+'/deliveries')).value,
    cycles:(await f.pool.query('SELECT * FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid ORDER BY cycle_no',[ticketId])).rows,
    links:(await f.pool.query('SELECT * FROM pilot_ticket.ticket_handling_cycle_event WHERE ticket_id=$1::uuid ORDER BY ticket_event_id',[ticketId])).rows,
    promises:(await f.pool.query('SELECT * FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid',[ticketId])).rows,
    sessions:(await f.pool.query('SELECT s.id::text,s.row_version::text,s.generation_version::text,s.control_mode,a.assigned_principal_id::text,a.assignment_version::text FROM conversation.session s LEFT JOIN conversation.assignment a ON a.session_id=s.id WHERE s.id=ANY($1::uuid[]) ORDER BY s.id',[selected.map(row=>row.session_id)])).rows,
    control:(await f.pool.query('SELECT id::text,client_command_id::text FROM conversation.control_event ORDER BY id')).rows,
    realtime:(await f.pool.query('SELECT event_id::text FROM conversation.realtime_event ORDER BY event_id')).rows});
   const before=await snapshot(),cycle=object(before.ticket.handling_cycle),command={client_command_id:randomUUID(),expected_version:version(before.ticket.version),reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',handling_cycle_id:text(cycle.id),communication_choice:'TAKE_SELECTED',sessions:selected,internal_process:'T12_TWO_PRIVATE_CANARY',external_summary:'服务已恢复，请重新尝试。',external_summary_confirmed:true};let installed=false;
   try{
    await f.pool.query('CREATE SEQUENCE platform.t12_first_control_observed');
    await f.pool.query(`CREATE FUNCTION platform.t12_second_control_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM conversation.control_event WHERE session_id='${earlier.session_id}'::uuid AND client_command_id=NEW.client_command_id) THEN RAISE EXCEPTION 'T12_FIRST_CONTROL_NOT_REACHED'; END IF; PERFORM nextval('platform.t12_first_control_observed'); RAISE EXCEPTION 'T12_SECOND_CONTROL_AFTER_FIRST'; END $$`);
    await f.pool.query(`CREATE TRIGGER t12_second_control_failure BEFORE INSERT ON conversation.control_event FOR EACH ROW WHEN (NEW.session_id='${last.session_id}'::uuid) EXECUTE FUNCTION platform.t12_second_control_failure()`);installed=true;
    const failed=await b.post(s.path+'/takeover-and-complete',command);assert.equal(failed.status,503,JSON.stringify(failed.value));assert.equal((await f.pool.query('SELECT is_called FROM platform.t12_first_control_observed')).rows[0]?.is_called,true,'the actual second boundary must prove a first real Control, not a seeded success');
    assert.deepEqual(await snapshot(),before);assert.equal((await f.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=$1::uuid',[command.client_command_id])).rowCount,0);
    assert.deepEqual((await f.pool.query('SELECT state,command_type FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[command.client_command_id])).rows,[{state:'FAILED',command_type:'WORKBENCH_TICKET_TAKEOVER_COMPLETION'}]);
   }finally{if(installed)await f.pool.query('DROP TRIGGER t12_second_control_failure ON conversation.control_event');await f.pool.query('DROP FUNCTION IF EXISTS platform.t12_second_control_failure()');await f.pool.query('DROP SEQUENCE IF EXISTS platform.t12_first_control_observed');}
   const replay=await b.post(s.path+'/takeover-and-complete',command);assert.equal(replay.status,503);assert.equal(replay.value.replayed,true);assert.deepEqual(await snapshot(),before);
   const next={...command,client_command_id:randomUUID()},result=await b.post(s.path+'/takeover-and-complete',next);assert.equal(result.status,200,JSON.stringify(result.value));const after=await snapshot();assert.equal(after.ticket.status,'CLOSED');assert.equal(after.ticket.version,command.expected_version+2);assert.equal(after.ticket.assignee_id,s.actor.id);assert.equal(after.ticket.resolver_team_id,'T07_NETWORK');assert.equal(object(after.ticket.handling_cycle).id,cycle.id);assert.equal(after.cycles.length,1);assert.equal(after.promises.length,1);
   const prior=rows(before.events.items),events=rows(after.events.items);assert.deepEqual(events.slice(0,prior.length),prior);const added=events.slice(prior.length);assert.deepEqual(added.map(row=>row.event_type),['ticket.assignment_transferred','ticket.closed']);
   const transferred=added[0],closed=added[1];assert.ok(transferred&&closed);
   assert.deepEqual((await f.pool.query('SELECT operator_type,operator_id,assignment_metadata FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_id=$2::uuid',[ticketId,transferred.event_id])).rows,[{operator_type:'PILOT_USER',operator_id:s.actor.id,assignment_metadata:{old_assignee_id:s.owner.id,new_assignee_id:s.actor.id,old_team_id:'PILOT_IT',new_team_id:'T07_NETWORK'}}]);
   assert.deepEqual((await f.pool.query('SELECT reason_code,operator_type,operator_id,internal_note,external_note FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_id=$2::uuid',[ticketId,closed.event_id])).rows,[{reason_code:'STAFF_COMPLETED',operator_type:'PILOT_USER',operator_id:s.actor.id,internal_note:command.internal_process,external_note:command.external_summary}]);
   assert.deepEqual(rows(result.value.conversations).map(row=>({session_id:row.session_id,session_row_version:row.session_row_version,changed:row.changed})),selected.map(row=>({session_id:row.session_id,session_row_version:row.expected_row_version+1,changed:true})));
   assert.equal((await f.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=$1::uuid',[next.client_command_id])).rowCount,2);assert.deepEqual((await f.pool.query('SELECT state,command_type FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[next.client_command_id])).rows,[{state:'COMMITTED',command_type:'WORKBENCH_TICKET_TAKEOVER_COMPLETION'}]);
   console.log('T12_SECOND_SESSION_ATOMICITY '+JSON.stringify({actual_first_control:true,second_failure:503,all_facts_rollback:true,stable_failed_replay:true,new_explicit_command:200,controls:2,original_cycle:true}));
  }finally{f.runtime.server.closeAllConnections();await closeConversationWorkbenchServer(f.runtime.server);assert.equal(f.runtime.server.listening,false);const connections=await new Promise<number>((resolve,reject)=>f.runtime.server.getConnections((error,count)=>error?reject(error):resolve(count)));assert.equal(connections,0);}
 });
});
