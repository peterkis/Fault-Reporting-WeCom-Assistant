import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT09Fixture,object,rows,version} from './helpers/t09-fixture.mjs';
import {prepareT09Selected,readT09SelectedFacts} from './helpers/t09-selected-public-scenario.mjs';

test('a second selected communication write fails after the first real Control, rolls back all return facts, and only a new explicit UUID can then commit the original round',async()=>{
 await withT09Fixture(async fixture=>{
  const scenario=await prepareT09Selected(fixture),{admin,path,ticketId,selected,target}=scenario;
  const first=selected[0],last=selected[1];assert.ok(first&&last);assert.equal(selected.length,2);
  let settled=false;for(let n=0;n<3;n++){const projected=await fixture.runtime.realtimeProjector.runOnce({limit:100});if(projected.processed===0){settled=true;break;}}assert.equal(settled,true,'finite realtime setup must settle before the rollback snapshot');
  const snapshot=async()=>({public:await readT09SelectedFacts(admin,path,selected),sessions:(await fixture.pool.query('SELECT s.id::text,s.row_version::text,s.generation_version::text,s.control_mode,a.assigned_principal_id::text,a.assignment_version::text FROM conversation.session s LEFT JOIN conversation.assignment a ON a.session_id=s.id WHERE s.id=ANY($1::uuid[]) ORDER BY s.id',[selected.map(row=>row.session_id)])).rows,counts:(await fixture.pool.query(`SELECT (SELECT count(*)::integer FROM conversation.control_event) AS controls,(SELECT count(*)::integer FROM conversation.realtime_event) AS realtime,(SELECT count(*)::integer FROM pilot_ticket.ticket_handling_cycle) AS cycles,(SELECT count(*)::integer FROM pilot_ticket.ticket_handling_cycle_event) AS cycle_links,(SELECT count(*)::integer FROM communication.message) AS messages,(SELECT count(*)::integer FROM communication.outbox) AS outboxes,(SELECT count(*)::integer FROM communication.delivery) AS deliveries,(SELECT count(*)::integer FROM communication.ticket_notification_binding) AS notifications`)).rows});
  const before=await snapshot(),command={client_command_id:randomUUID(),expected_version:version(before.public.ticket.version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'合成第二次沟通写入故障，须保持全部原事实。',unfinished_work:'设备未完成维修，需要一次明确的新意图。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:target,sessions:selected};
  let installed=false;
  try{
   // Isolated PG fault only. The sequence survives rollback and proves that the real first write was reached.
   await fixture.pool.query('CREATE SEQUENCE platform.t09_first_control_observation');
   await fixture.pool.query(`CREATE FUNCTION platform.t09_second_control_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM conversation.control_event WHERE session_id='${first.session_id}'::uuid AND client_command_id=NEW.client_command_id) THEN RAISE EXCEPTION 'T09_FIRST_WRITE_NOT_REACHED'; END IF; PERFORM nextval('platform.t09_first_control_observation'); RAISE EXCEPTION 'T09_SECOND_WRITE_AFTER_FIRST'; END $$`);
   await fixture.pool.query(`CREATE TRIGGER t09_second_control_failure BEFORE INSERT ON conversation.control_event FOR EACH ROW WHEN (NEW.session_id='${last.session_id}'::uuid) EXECUTE FUNCTION platform.t09_second_control_failure()`);installed=true;
   const failed=await admin.post(path+'/return-to-dispatch',command);assert.equal(failed.status,503,JSON.stringify(failed.value));
   assert.equal((await fixture.pool.query<{is_called:boolean}>('SELECT is_called FROM platform.t09_first_control_observation')).rows[0]?.is_called,true,'the second native failure occurred after the first real Control write');
   assert.deepEqual(await snapshot(),before,'Ticket/event/cycle/Session/assignment/generation/realtime/notification facts roll back together');
   assert.deepEqual((await fixture.pool.query("SELECT state,command_type FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid",[command.client_command_id])).rows,[{state:'FAILED',command_type:'WORKBENCH_TICKET_RETURN_TO_DISPATCH'}]);
   assert.equal((await fixture.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=$1::uuid',[command.client_command_id])).rowCount,0);
  }finally{
   if(installed)await fixture.pool.query('DROP TRIGGER t09_second_control_failure ON conversation.control_event');
   await fixture.pool.query('DROP FUNCTION IF EXISTS platform.t09_second_control_failure()');
   await fixture.pool.query('DROP SEQUENCE IF EXISTS platform.t09_first_control_observation');
  }
  const replay=await admin.post(path+'/return-to-dispatch',command);assert.equal(replay.status,503);assert.equal(replay.value.replayed,true);assert.deepEqual(await snapshot(),before,'a terminal failed original UUID never silently retries its writes');
  const committed=await admin.post(path+'/return-to-dispatch',{...command,client_command_id:randomUUID()});assert.equal(committed.status,200,JSON.stringify(committed.value));
  const after=await snapshot();assert.equal(after.public.ticket.status,'QUEUED');assert.equal(after.public.ticket.assignee_id,null);assert.equal(after.public.ticket.resolver_team_id,before.public.ticket.resolver_team_id);assert.equal(after.public.ticket.version,version(before.public.ticket.version)+1);assert.equal(after.public.ticket.intake_id,before.public.ticket.intake_id);assert.deepEqual(after.public.ticket.handling_cycle,before.public.ticket.handling_cycle);assert.deepEqual(after.public.deliveries,before.public.deliveries);
  const changed=rows(committed.value.conversations);assert.equal(changed.length,2);for(const original of selected){const row=changed.find(item=>item.session_id===original.session_id);assert.ok(row);assert.equal(row.changed,true);assert.equal(row.session_row_version,original.expected_row_version+1);assert.equal(rows(after.public.responsibility.conversations).find(item=>item.session_id===original.session_id)?.conversation_principal_id,target);}
  assert.deepEqual(rows(after.public.responsibility.conversations).find(row=>row.session_id===scenario.primary.session_id),scenario.primary,'the unselected original communicator remains independent');
  const oldEvents=rows(before.public.events.items),events=rows(after.public.events.items);assert.deepEqual(events.slice(0,-1),oldEvents);assert.equal(events.at(-1)?.event_type,'ticket.returned_to_dispatch');assert.equal(events.at(-1)?.has_internal_note,true);assert.equal(events.at(-1)?.has_external_note,false);
  const cycle=object(after.public.ticket.handling_cycle);assert.equal((await fixture.pool.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid',[ticketId])).rowCount,1);assert.equal(cycle.id,object(before.public.ticket.handling_cycle).id);
  console.log('T09_SECOND_SESSION_ATOMICITY '+JSON.stringify({actual_first_write:true,second_native_failure:503,all_business_facts_rolled_back:true,original_failed_replay:503,new_explicit_command:200,same_round:true}));
 },{ticketReturnToDispatchEnabled:true});
});
