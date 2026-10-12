import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT12Fixture} from './helpers/t12-completion-fixture.mjs';
import {t12FreshHttp} from './helpers/t12-fresh-http.mjs';
import {acceptedSetup,object,rows,text,version} from './helpers/t07-public-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {createTicketActionService} from '../src/p1-006-ticket-state-actions.mjs';
import {listenConversationWorkbenchServer,closeConversationWorkbenchServer} from '../src/p2-006-workbench-http.mjs';

test('seven actual later write boundaries roll back earlier selected Control and transferred Ticket, waiting resume, closure, cycle and promise, retaining only stable FAILED outer audits',async()=>{
 await withT12Fixture(async f=>{
  const s=await acceptedSetup(f);
  assert.equal((await s.a.post(s.path+'/start',{client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'T12_ATOMIC_START'})).status,200);
  const started=(await s.a.get(s.path)).value,core=createTicketActionService({pool:f.pool,authorize:createPilotAccessService({pool:f.pool}).authorizeAction});
  assert.equal((await core.perform({ticketId:s.first.ticket.id,action:'wait-vendor',actor:{type:'PILOT_USER',id:s.owner.id},expectedVersion:version(started.version),reasonCode:'T12_ATOMIC_WAIT',traceId:'t12-atomic-wait'})).ok,true);
  const assigned=rows((await s.a.get(s.path+'/related-conversations')).value.items)[0];assert.ok(assigned);
  assert.equal((await s.a.post('/api/conversations/'+text(assigned.session_id)+'/release',{client_command_id:randomUUID(),expected_row_version:Number(text(assigned.session_row_version)),reason_code:'T12_ATOMIC_RELEASE'})).status,200);
  const selected=rows((await s.b.get(s.path+'/related-conversations')).value.items)[0];assert.ok(selected);assert.equal(selected.take_allowed,true);
  let drained=false;for(let n=0;n<3;n++)if((await f.runtime.realtimeProjector.runOnce({limit:100})).processed===0){drained=true;break;}assert.equal(drained,true);
  // Stop the owned timers before physical snapshots; retain the same public handler and close it explicitly below.
  await f.runtime.stop();await listenConversationWorkbenchServer(f.runtime.server,{port:Number(new URL(f.origin).port)});
  try{
   const a=await t12FreshHttp(f,0),b=await t12FreshHttp(f,2),ticketId=s.first.ticket.id,sessionId=text(selected.session_id);
   const snapshot=async()=>({ticket:(await b.get(s.path)).value,events:(await a.get(s.path+'/events')).value,communication:(await a.get(s.path+'/responsibility')).value.conversations,deliveries:(await a.get(s.path+'/deliveries')).value,
    cycle:(await f.pool.query('SELECT * FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid ORDER BY cycle_no',[ticketId])).rows,
    links:(await f.pool.query('SELECT * FROM pilot_ticket.ticket_handling_cycle_event WHERE ticket_id=$1::uuid ORDER BY ticket_event_id',[ticketId])).rows,
    commitments:(await f.pool.query('SELECT * FROM pilot_ticket.staff_completion_notification_commitment WHERE ticket_id=$1::uuid ORDER BY cycle_id',[ticketId])).rows,
    session:(await f.pool.query('SELECT s.row_version::text,s.generation_version::text,s.control_mode,a.assigned_principal_id::text,a.assignment_version::text FROM conversation.session s LEFT JOIN conversation.assignment a ON a.session_id=s.id WHERE s.id=$1::uuid',[sessionId])).rows,
    control:(await f.pool.query('SELECT id::text,client_command_id::text FROM conversation.control_event WHERE session_id=$1::uuid ORDER BY id',[sessionId])).rows,
    realtime:(await f.pool.query('SELECT event_id::text FROM conversation.realtime_event ORDER BY event_id')).rows});
   const before=await snapshot();assert.equal(before.ticket.status,'WAITING_VENDOR');const cycle=object(before.ticket.handling_cycle);
   const boundaries:{table:string;operation:'INSERT'|'UPDATE';predicate:string;filter?:string;name:string}[]=[
    {table:'pilot_ticket.ticket_event',operation:'INSERT',predicate:`NEW.ticket_id='${ticketId}'::uuid AND NEW.event_type='ticket.resumed'`,name:'resume-event'},
    {table:'pilot_ticket.ticket_event',operation:'INSERT',predicate:`NEW.ticket_id='${ticketId}'::uuid AND NEW.event_type='ticket.closed' AND NEW.reason_code='STAFF_COMPLETED'`,name:'close-event'},
    {table:'pilot_ticket.ticket_handling_cycle_event',operation:'INSERT',predicate:`NEW.ticket_id='${ticketId}'::uuid`,filter:"IF NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket_event WHERE event_id=NEW.ticket_event_id AND event_type='ticket.closed' AND reason_code='STAFF_COMPLETED') THEN RETURN NEW; END IF;",name:'closed-cycle-link'},
    {table:'pilot_ticket.ticket_handling_cycle',operation:'UPDATE',predicate:`NEW.ticket_id='${ticketId}'::uuid AND NEW.staff_completion_event_id IS NOT NULL`,name:'staff-cycle-end'},
    {table:'pilot_ticket.staff_completion_notification_commitment',operation:'INSERT',predicate:`NEW.ticket_id='${ticketId}'::uuid`,name:'durable-promise'},
    {table:'conversation.realtime_event',operation:'INSERT',predicate:`NEW.aggregate_id='${ticketId}' AND NEW.event_type='ticket.command.committed'`,filter:"IF NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket_event WHERE event_id::text=NEW.payload->>'ticket_event_id' AND event_type='ticket.closed' AND reason_code='STAFF_COMPLETED') THEN RETURN NEW; END IF;",name:'final-closed-realtime'},
    {table:'pilot_ticket.ticket_command_receipt',operation:'UPDATE',predicate:`NEW.ticket_id='${ticketId}'::uuid AND NEW.command_type='WORKBENCH_TICKET_TAKEOVER_COMPLETION' AND NEW.state='COMMITTED'`,name:'outer-committed-receipt'}
   ];
   const command=()=>({client_command_id:randomUUID(),expected_version:version(before.ticket.version),reason_code:'STAFF_COMPLETED',resolver_team_id:'T07_NETWORK',handling_cycle_id:text(cycle.id),communication_choice:'TAKE_SELECTED',sessions:[{session_id:sessionId,expected_row_version:Number(text(selected.session_row_version))}],internal_process:'T12_ATOMIC_PRIVATE_CANARY',external_summary:'服务已恢复，请重新尝试。',external_summary_confirmed:true});
   for(const boundary of boundaries){const body=command();let installed=false;
    try{
     await f.pool.query('CREATE SEQUENCE platform.t12_earlier_writes_observed');
     await f.pool.query(`CREATE FUNCTION platform.t12_later_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${boundary.filter??''} IF NOT EXISTS(SELECT 1 FROM conversation.control_event WHERE session_id='${sessionId}'::uuid AND client_command_id='${body.client_command_id}'::uuid) OR NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket WHERE id='${ticketId}'::uuid AND assignee_id='${s.actor.id}'::uuid AND resolver_team_id='T07_NETWORK' AND version>${body.expected_version}) THEN RAISE EXCEPTION 'T12_EARLIER_REAL_WRITES_NOT_REACHED'; END IF; PERFORM nextval('platform.t12_earlier_writes_observed'); RAISE EXCEPTION 'T12_SYNTHETIC_LATER_WRITE_FAILURE'; END $$`);
     await f.pool.query(`CREATE TRIGGER t12_later_write_failure BEFORE ${boundary.operation} ON ${boundary.table} FOR EACH ROW WHEN (${boundary.predicate}) EXECUTE FUNCTION platform.t12_later_write_failure()`);installed=true;
     const failed=await b.post(s.path+'/takeover-and-complete',body);assert.equal(failed.status,503,JSON.stringify(failed.value));assert.equal(object(failed.value.error).retryable,false);
     assert.equal((await f.pool.query('SELECT is_called FROM platform.t12_earlier_writes_observed')).rows[0]?.is_called,true,'the '+boundary.name+' fault must follow actual earlier Control and Ticket writes');
     assert.deepEqual(await snapshot(),before);
     assert.deepEqual((await f.pool.query('SELECT state,command_type,result_ticket_event_id,result_control_event_id FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[body.client_command_id])).rows,[{state:'FAILED',command_type:'WORKBENCH_TICKET_TAKEOVER_COMPLETION',result_ticket_event_id:null,result_control_event_id:null}]);
     assert.equal((await f.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=$1::uuid',[body.client_command_id])).rowCount,0);
    }finally{if(installed)await f.pool.query(`DROP TRIGGER t12_later_write_failure ON ${boundary.table}`);await f.pool.query('DROP FUNCTION IF EXISTS platform.t12_later_write_failure()');await f.pool.query('DROP SEQUENCE IF EXISTS platform.t12_earlier_writes_observed');}
    const replay=await b.post(s.path+'/takeover-and-complete',body);assert.equal(replay.status,503);assert.equal(replay.value.replayed,true);assert.equal(object(replay.value.error).retryable,false);assert.deepEqual(await snapshot(),before);
    console.log('T12_LATER_ATOMIC_ROLLBACK '+JSON.stringify({boundary:boundary.name,actual_earlier_control_and_ticket:true,status:503,all_facts_unchanged:true,stable_failed_replay:true}));
   }
   const body=command(),committed=await b.post(s.path+'/takeover-and-complete',body);assert.equal(committed.status,200,JSON.stringify(committed.value));const after=await snapshot();
   assert.equal(after.ticket.status,'CLOSED');assert.equal(after.ticket.version,body.expected_version+3);assert.equal(after.ticket.assignee_id,s.actor.id);assert.equal(object(after.ticket.handling_cycle).id,cycle.id);assert.equal(after.commitments.length,1);
   const prior=rows(before.events.items),events=rows(after.events.items);assert.deepEqual(events.slice(0,prior.length),prior);assert.deepEqual(events.slice(prior.length).map(row=>row.event_type),['ticket.assignment_transferred','ticket.resumed','ticket.closed']);
   assert.equal((await f.pool.query('SELECT 1 FROM conversation.control_event WHERE client_command_id=$1::uuid',[body.client_command_id])).rowCount,1);
   assert.deepEqual((await f.pool.query('SELECT state,command_type FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[body.client_command_id])).rows,[{state:'COMMITTED',command_type:'WORKBENCH_TICKET_TAKEOVER_COMPLETION'}]);
  }finally{f.runtime.server.closeAllConnections();await closeConversationWorkbenchServer(f.runtime.server);assert.equal(f.runtime.server.listening,false);const connections=await new Promise<number>((resolve,reject)=>f.runtime.server.getConnections((error,count)=>error?reject(error):resolve(count)));assert.equal(connections,0);}
 });
});
