import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';

for(const seam of ['event','cycle-link','realtime','receipt'] as const)test('real '+seam+' fault rolls back the entire waiting Action, round linkage and projections while preserving a FAILED original UUID',async()=>{
  await withT10Fixture(async context=>{
    const http=await t11Http(context,2),target=context.tickets[0];assert.ok(target);const before=await http.start(target.ticket.id),command={client_command_id:randomUUID(),expected_version:before.version,reason_code:'WAITING_VENDOR',note:'INTERNAL_T10_ROLLBACK_CANARY',external_visible:false},path='/api/tickets/'+target.ticket.id;
    const snapshot=async()=>({ticket:await http.detail(target.ticket.id),events:await (await http.get(path+'/events')).json() as unknown,responsibility:await (await http.get(path+'/responsibility')).json() as unknown,deliveries:await (await http.get(path+'/deliveries')).json() as unknown,links:(await context.pool.query('SELECT cycle_id::text,ticket_event_id::text FROM pilot_ticket.ticket_handling_cycle_event WHERE ticket_id=$1::uuid ORDER BY ticket_event_id',[target.ticket.id])).rows,realtime:(await context.pool.query('SELECT event_id::text FROM conversation.realtime_event WHERE aggregate_id=$1 ORDER BY event_id',[target.ticket.id])).rows});const original=await snapshot();
    const table=seam==='event'?'pilot_ticket.ticket_event':seam==='cycle-link'?'pilot_ticket.ticket_handling_cycle_event':seam==='realtime'?'conversation.realtime_event':'pilot_ticket.ticket_command_receipt';
    const condition=seam==='receipt'?"NEW.client_command_id='"+command.client_command_id+"'::uuid AND NEW.state='COMMITTED'":seam==='realtime'?"NEW.aggregate_id='"+target.ticket.id+"' AND NEW.event_type='ticket.status.changed'":"NEW.ticket_id='"+target.ticket.id+"'::uuid";
    await context.pool.query('CREATE SEQUENCE platform.t10_fault_seen');await context.pool.query("CREATE FUNCTION platform.t10_actual_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('platform.t10_fault_seen'); RAISE EXCEPTION 'T10_SYNTHETIC_FAULT' USING ERRCODE='P0001'; END $$");
    try{
      await context.pool.query('CREATE TRIGGER t10_actual_fault BEFORE '+(seam==='receipt'?'UPDATE':'INSERT')+' ON '+table+' FOR EACH ROW WHEN ('+condition+') EXECUTE FUNCTION platform.t10_actual_fault()');
      const response=await http.post(target.ticket.id,'wait-vendor',command);assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,error:{code:'P2_016_ACTION_FAILED',retryable:false},replayed:false});assert.equal((await context.pool.query<{is_called:boolean}>('SELECT is_called FROM platform.t10_fault_seen')).rows[0]?.is_called,true,'the actual requested fault seam was reached');assert.deepEqual(await snapshot(),original);
      const ack=await http.get(path+'/wait-vendor/commands/'+command.client_command_id);assert.equal(ack.status,200);assert.deepEqual(await ack.json(),{state:'FAILED',error:{code:'P2_016_ACTION_FAILED',retryable:false}});
      await context.pool.query('DROP TRIGGER t10_actual_fault ON '+table);
      const replay=await http.post(target.ticket.id,'wait-vendor',command);assert.equal(replay.status,503);assert.deepEqual(await replay.json(),{ok:false,error:{code:'P2_016_ACTION_FAILED',retryable:false},replayed:true});assert.deepEqual(await snapshot(),original,'replaying the failed original UUID never re-executes its Action');
      assert.equal((await http.post(target.ticket.id,'wait-vendor',{...command,client_command_id:randomUUID()})).status,200,'only a new explicit intent may attempt the corrected Action');
    }finally{await context.pool.query('DROP TRIGGER IF EXISTS t10_actual_fault ON '+table);await context.pool.query('DROP FUNCTION platform.t10_actual_fault()');await context.pool.query('DROP SEQUENCE platform.t10_fault_seen');}
  });
});
