import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createTicketActionService} from '../src/p1-006-ticket-state-actions.mjs';

for(const [action,status] of [['request-information','WAITING_REQUESTER'],['wait-vendor','WAITING_VENDOR']] as const){
 test('one public composite command transfers, resumes and staff-closes the lawful '+status+' original cycle without a second receipt or reporter confirmation',async()=>{
  await withT12Fixture(async f=>{
   const s=await acceptedSetup(f);
   assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_LAWFUL_START'})).status,200);
   const started=(await s.a.get(s.path)).value;
   const core=createTicketActionService({pool:f.pool,authorize:createPilotAccessService({pool:f.pool}).authorizeAction});
   assert.equal((await core.perform({ticketId:s.first.ticket.id,action,actor:{type:'PILOT_USER',id:s.owner.id},expectedVersion:version(started.version),reasonCode:'T12_LAWFUL_WAIT',traceId:'t12-lawful-wait'})).ok,true);
   const before=(await s.b.get(s.path)).value,cycle=object(before.handling_cycle);assert.equal(before.status,status);
   const prior=rows((await s.a.get(s.path+'/events')).value.items),communication=(await s.a.get(s.path+'/responsibility')).value.conversations;
   const command={client_command_id:randomUUID(),expected_version:version(before.version),reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',handling_cycle_id:text(cycle.id),communication_choice:'RETAIN_CURRENT',sessions:[],internal_process:'T12_LAWFUL_WAIT_PRIVATE_CANARY',external_summary:'服务已恢复，请重新尝试。',external_summary_confirmed:true};
   const result=await s.b.post(s.path+'/takeover-and-complete',command);assert.equal(result.status,200,JSON.stringify(result.value));
   const after=(await s.b.get(s.path)).value,ended=object(after.handling_cycle);assert.equal(after.status,'CLOSED');assert.equal(after.version,command.expected_version+3);assert.equal(after.assignee_id,s.actor.id);assert.equal(after.resolver_team_id,'T07_NETWORK');assert.equal(after.intake_id,before.intake_id);
   for(const key of ['id','cycle_no','first_responsibility_event_id'])assert.equal(ended[key],cycle[key]);
   assert.deepEqual((await f.pool.query('SELECT source_intake_id::text,first_responsibility_event_id::text,staff_completion_event_id::text FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid AND id=$2::uuid',[s.first.ticket.id,cycle.id])).rows,[{source_intake_id:s.first.intake.intakeId,first_responsibility_event_id:cycle.first_responsibility_event_id,staff_completion_event_id:ended.staff_completion_event_id}]);
   const events=rows((await s.a.get(s.path+'/events')).value.items);assert.deepEqual(events.slice(0,prior.length),prior);
   const added=events.slice(prior.length);assert.deepEqual(added.map(e=>e.event_type),['ticket.assignment_transferred','ticket.resumed','ticket.closed']);
   const closed=added.at(-1);assert.ok(closed);assert.equal(ended.staff_completion_event_id,closed.event_id);assert.equal(object(result.value.completion).event_id,closed.event_id);
   assert.deepEqual((await s.a.get(s.path+'/responsibility')).value.conversations,communication);
   assert.deepEqual((await f.pool.query('SELECT reason_code,operator_type,operator_id,internal_note,external_note FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_id=$2::uuid',[s.first.ticket.id,closed.event_id])).rows,[{reason_code:'STAFF_COMPLETED',operator_type:'PILOT_USER',operator_id:s.actor.id,internal_note:command.internal_process,external_note:command.external_summary}]);
   assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle_event WHERE cycle_id=$1::uuid AND ticket_event_id=ANY($2::uuid[])',[cycle.id,added.map(e=>e.event_id)])).rowCount,3);
   assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid AND cycle_id=$2::uuid AND ticket_event_id=$3::uuid AND source_intake_id=$4::uuid',[s.first.ticket.id,cycle.id,closed.event_id,s.first.intake.intakeId])).rowCount,1);
   assert.equal((await f.pool.query("SELECT 1 FROM notification.card_action_task WHERE ticket_id=$1::uuid AND action_key='confirm_resolved'",[s.first.ticket.id])).rowCount,0);
   assert.deepEqual((await f.pool.query('SELECT command_type,state FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[command.client_command_id])).rows,[{command_type:'WORKBENCH_TICKET_TAKEOVER_COMPLETION',state:'COMMITTED'}]);
   assert.equal(JSON.stringify(result.value).includes(command.internal_process),false);
   const replay=await s.b.post(s.path+'/takeover-and-complete',command);assert.equal(replay.status,200);assert.deepEqual(replay.value,{...result.value,replayed:true});
   assert.deepEqual((await s.a.get(s.path+'/events')).value.items,events);assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid',[s.first.ticket.id])).rowCount,1);
  });
 });
}
