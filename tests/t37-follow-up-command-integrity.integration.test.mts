// STAGED_RUNTIME / first actual command-integrity execution pending.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT37Fixture,object,rows,text,type T37Fixture,type T37Http} from './helpers/t37-follow-up-fixture.mjs';

function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function current(http:T37Http,path:string){const result=await http.get(path);assert.equal(result.status,200,JSON.stringify(result.value));return result.value;}
function command(ticket:Record<string,unknown>,schedule:Record<string,unknown>,action:'SET'|'CANCEL'='SET'){
  return {client_command_id:randomUUID(),expected_version:version(ticket.version),expected_schedule_version:text(schedule.schedule_version),
    reason_code:'WORKBENCH_FOLLOW_UP_SCHEDULE',action,due_at:action==='SET'?'2030-01-03 09:30:00':null};
}
async function snapshot(fixture:T37Fixture,http:T37Http,ticketId:string){
  const path='/api/tickets/'+ticketId;
  return {ticket:await current(http,path),schedule:await current(http,path+'/follow-up-schedule'),
    events:await current(http,path+'/events?limit=200'),responsibility:await current(http,path+'/responsibility'),deliveries:await current(http,path+'/deliveries'),
    stored:{
      current:(await fixture.pool.query('SELECT * FROM pilot_ticket.follow_up_schedule WHERE ticket_id=$1::uuid',[ticketId])).rows,
      revision:(await fixture.pool.query('SELECT * FROM pilot_ticket.follow_up_schedule_revision WHERE ticket_id=$1::uuid ORDER BY schedule_version',[ticketId])).rows,
      marker:(await fixture.pool.query('SELECT * FROM pilot_ticket.follow_up_due_signal WHERE ticket_id=$1::uuid ORDER BY schedule_version',[ticketId])).rows,
    },
    realtime:(await fixture.pool.query('SELECT * FROM conversation.realtime_event WHERE aggregate_type=\'TICKET\' AND aggregate_id=$1 ORDER BY event_id',[ticketId])).rows,
  };
}
async function failedAck(http:T37Http,path:string,id:string,code:string){
  assert.deepEqual(await current(http,path+'/follow-up-schedule/commands/'+id),{ticket_id:path.slice('/api/tickets/'.length),client_command_id:id,state:'FAILED',error:{code,retryable:false}});
}
async function arrange(fixture:T37Fixture,http:T37Http,ticketId:string){
  const path='/api/tickets/'+ticketId,ticket=await current(http,path),schedule=await current(http,path+'/follow-up-schedule');
  const input={...command(ticket,schedule),due_at:'2030-01-02 09:30:00'},result=await http.post(path+'/follow-up-schedule',input);
  assert.equal(result.status,200,JSON.stringify(result.value));
  const acknowledgement=await current(http,path+'/follow-up-schedule/commands/'+input.client_command_id);
  assert.deepEqual(acknowledgement,{ticket_id:ticketId,client_command_id:input.client_command_id,state:'COMMITTED',result:{...result.value,replayed:true}});
  return {input,result,acknowledgement,before:await snapshot(fixture,http,ticketId)};
}

test('real SET/CANCEL reject each stale version and changed UUID payload while two fresh competing commands commit only one revision',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const http=await fixture.http(0),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,original=await arrange(fixture,http,ticketId),before=original.before;
    // Header and body agree through the real fixture: these exercise the two business checks, not If-Match syntax.
    for(const action of ['SET','CANCEL'] as const)for(const stale of ['ticket','schedule'] as const){
      const input={...command(before.ticket,before.schedule,action),
        ...(stale==='ticket'?{expected_version:original.input.expected_version}:{expected_schedule_version:original.input.expected_schedule_version})};
      const result=await http.post(path+'/follow-up-schedule',input);assert.equal(result.status,409,JSON.stringify(result.value));
      assert.deepEqual(result.value,{ok:false,error:{code:'P2_016_VERSION_CONFLICT',retryable:false},replayed:false});
      await failedAck(http,path,input.client_command_id,'P2_016_VERSION_CONFLICT');
      assert.deepEqual(await snapshot(fixture,http,ticketId),before,'a stale '+stale+' version must not change '+action+' business facts');
      assert.deepEqual(await current(http,path+'/follow-up-schedule/commands/'+original.input.client_command_id),original.acknowledgement);
    }
    const changed=await http.post(path+'/follow-up-schedule',{...original.input,due_at:'2030-01-04 09:30:00'});
    assert.equal(changed.status,409,JSON.stringify(changed.value));assert.equal(object(changed.value.error).code,'P2_016_COMMAND_CONFLICT');
    assert.deepEqual(await snapshot(fixture,http,ticketId),before);
    assert.deepEqual(await current(http,path+'/follow-up-schedule/commands/'+original.input.client_command_id),original.acknowledgement);

    const inputs=[command(before.ticket,before.schedule,'SET'),command(before.ticket,before.schedule,'CANCEL')];
    const results=await Promise.all(inputs.map(input=>http.post(path+'/follow-up-schedule',input)));
    assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
    const won=results.findIndex(result=>result.status===200),lost=1-won,winner=results[won],loser=results[lost],winningInput=inputs[won],losingInput=inputs[lost];
    assert.ok(winner&&loser&&winningInput&&losingInput);assert.equal(object(loser.value.error).code,'P2_016_VERSION_CONFLICT');
    const after=await snapshot(fixture,http,ticketId),next=String(BigInt(text(before.schedule.schedule_version))+1n);
    assert.equal(after.ticket.version,version(before.ticket.version)+1);assert.equal(after.schedule.schedule_version,next);
    assert.equal(winner.value.ticket_version,after.ticket.version);assert.equal(winner.value.schedule_version,next);assert.equal(winner.value.replayed,false);
    if(winningInput.action==='CANCEL')assert.equal(after.schedule.active,null);
    else assert.equal(object(after.schedule.active).due_at,winningInput.due_at);
    for(const key of ['status','assignee_id','resolver_team_id','intake_id','handling_cycle'])assert.deepEqual(after.ticket[key],before.ticket[key]);
    assert.deepEqual(after.responsibility,before.responsibility);assert.deepEqual(after.deliveries,before.deliveries);assert.deepEqual(after.stored.marker,before.stored.marker);
    const events=rows(after.events.items),priorEvents=rows(before.events.items);assert.equal(events.length,priorEvents.length+1);assert.deepEqual(events.slice(0,-1),priorEvents);
    assert.equal(events.at(-1)?.event_id,winner.value.ticket_event_id);assert.equal(events.at(-1)?.event_type,winningInput.action==='SET'?'ticket.follow_up_scheduled':'ticket.follow_up_cancelled');
    assert.equal(after.stored.revision.length,before.stored.revision.length+1);assert.deepEqual(after.stored.revision.slice(0,-1),before.stored.revision);
    assert.equal(rows(after.schedule.history).length,rows(before.schedule.history).length+1);
    assert.deepEqual(rows(after.schedule.history).slice(1),rows(before.schedule.history));
    assert.equal(after.realtime.length,before.realtime.length+1);assert.deepEqual(after.realtime.slice(0,-1),before.realtime);
    assert.equal(after.realtime.at(-1)?.source_id,winner.value.ticket_event_id);assert.equal(after.realtime.at(-1)?.event_type,'ticket.command.committed');
    await failedAck(http,path,losingInput.client_command_id,'P2_016_VERSION_CONFLICT');
    assert.deepEqual(await current(http,path+'/follow-up-schedule/commands/'+winningInput.client_command_id),{ticket_id:ticketId,client_command_id:winningInput.client_command_id,state:'COMMITTED',result:{...winner.value,replayed:true}});
    assert.deepEqual(await current(http,path+'/follow-up-schedule/commands/'+original.input.client_command_id),original.acknowledgement);
    console.log('T37_COMMAND_CONFLICTS '+JSON.stringify({stale_ticket_and_schedule_per_action:true,changed_uuid_body_refused:true,concurrent_statuses:results.map(result=>result.status),one_new_revision:true,original_ack_unchanged:true}));
  },{workbenchFollowUpSchedulesEnabled:true});
});

test('real SET/CANCEL failure after Ticket Event and both 049 writes rolls back business facts and preserves a terminal FAILED receipt',{timeout:240000},async()=>{
  await withT37Fixture(async fixture=>{
    const http=await fixture.http(0),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,original=await arrange(fixture,http,ticketId),before=original.before;
    const failedInputs:ReturnType<typeof command>[]=[];
    // Only fault DDL is synthetic. Ticket, Event, current schedule, revision and receipts are written exclusively by native HTTP.
    try{
      await fixture.pool.query('CREATE SEQUENCE platform.t37_schedule_write_observation');
      assert.equal((await fixture.pool.query<{is_called:boolean}>('SELECT is_called FROM platform.t37_schedule_write_observation')).rows[0]?.is_called,false);
      await fixture.pool.query(`CREATE FUNCTION conversation.t37_reject_schedule_commit() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN
          IF NOT EXISTS(
            SELECT 1 FROM pilot_ticket.ticket t
            JOIN pilot_ticket.ticket_event e ON e.ticket_id=t.id AND e.event_id::text=NEW.source_id
            JOIN pilot_ticket.follow_up_schedule_revision r ON r.ticket_id=t.id AND r.ticket_event_id=e.event_id
            JOIN pilot_ticket.follow_up_schedule s ON s.ticket_id=r.ticket_id AND s.schedule_version=r.schedule_version
            WHERE t.id::text=NEW.aggregate_id AND t.version=e.aggregate_version AND e.aggregate_version=NEW.aggregate_version
              AND ((r.action='SET' AND e.event_type='ticket.follow_up_scheduled' AND s.scheduled_event_id=e.event_id
                    AND s.due_at=r.due_at AND s.due_epoch_ms=r.due_epoch_ms)
                OR (r.action='CANCEL' AND e.event_type='ticket.follow_up_cancelled'
                    AND s.scheduled_event_id IS NULL AND s.due_at IS NULL AND s.due_epoch_ms IS NULL))
          ) THEN RAISE EXCEPTION 'T37_SCHEDULE_TRANSACTION_PREREQUISITE_MISSING'; END IF;
          PERFORM nextval('platform.t37_schedule_write_observation');
          RAISE EXCEPTION 'T37_INJECTED_SCHEDULE_REALTIME_FAILURE';
        END;
        $fault$`);
      await fixture.pool.query(`CREATE TRIGGER t37_reject_schedule_commit BEFORE INSERT ON conversation.realtime_event FOR EACH ROW
        WHEN (NEW.publisher_name='P2_016_WORKBENCH' AND NEW.source_type='TICKET_EVENT' AND NEW.aggregate_type='TICKET' AND NEW.event_type='ticket.command.committed')
        EXECUTE FUNCTION conversation.t37_reject_schedule_commit()`);
      for(const action of ['SET','CANCEL'] as const){
        await fixture.pool.query('ALTER SEQUENCE platform.t37_schedule_write_observation RESTART WITH 1');
        assert.deepEqual((await fixture.pool.query<{last_value:string;is_called:boolean}>('SELECT last_value::text,is_called FROM platform.t37_schedule_write_observation')).rows,[{last_value:'1',is_called:false}]);
        const input=command(before.ticket,before.schedule,action);failedInputs.push(input);
        const result=await http.post(path+'/follow-up-schedule',input);
        // appendRealtimeEvent storage failure is mapped by the existing ledger to ACTION_FAILED; HTTP maps FAILED to 503.
        assert.equal(result.status,503,JSON.stringify(result.value));assert.deepEqual(result.value,{ok:false,error:{code:'P2_016_ACTION_FAILED',retryable:false},replayed:false});
        assert.deepEqual((await fixture.pool.query<{last_value:string;is_called:boolean}>('SELECT last_value::text,is_called FROM platform.t37_schedule_write_observation')).rows,
          [{last_value:'1',is_called:true}],'the failing real append must observe native Ticket/Event and both 049 writes first');
        assert.deepEqual(await snapshot(fixture,http,ticketId),before,'SAVEPOINT rollback restores all business facts for '+action);
        await failedAck(http,path,input.client_command_id,'P2_016_ACTION_FAILED');
        const receipts=await fixture.pool.query(`SELECT state,error_code,retryable,result_snapshot,result_ticket_version,result_ticket_event_id::text,result_control_event_id::text
          FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid AND command_type='WORKBENCH_FOLLOW_UP_SCHEDULE'`,
          ['P2_016:'+fixture.dispatcher,input.client_command_id,ticketId]);
        assert.deepEqual(receipts.rows,[{state:'FAILED',error_code:'P2_016_ACTION_FAILED',retryable:false,result_snapshot:null,result_ticket_version:null,result_ticket_event_id:null,result_control_event_id:null}],
          'the existing terminal failure receipt is intentionally outside the rolled-back business savepoint');
        assert.deepEqual(await current(http,path+'/follow-up-schedule/commands/'+original.input.client_command_id),original.acknowledgement);
      }
    }finally{
      const failures:unknown[]=[];
      try{await fixture.pool.query('DROP TRIGGER IF EXISTS t37_reject_schedule_commit ON conversation.realtime_event');}catch(error){failures.push(error);}
      try{await fixture.pool.query('DROP FUNCTION IF EXISTS conversation.t37_reject_schedule_commit()');}catch(error){failures.push(error);}
      try{await fixture.pool.query('DROP SEQUENCE IF EXISTS platform.t37_schedule_write_observation');}catch(error){failures.push(error);}
      if(failures.length)throw new AggregateError(failures,'T37_SCHEDULE_FAULT_CLEANUP_FAILED');
    }
    for(const input of failedInputs){
      const replay=await http.post(path+'/follow-up-schedule',input);assert.equal(replay.status,503);
      assert.deepEqual(replay.value,{ok:false,error:{code:'P2_016_ACTION_FAILED',retryable:false},replayed:true});
    }
    assert.deepEqual(await snapshot(fixture,http,ticketId),before,'removing the fault cannot turn a terminal FAILED UUID into a new write');
    const fresh=command(before.ticket,before.schedule,'CANCEL'),success=await http.post(path+'/follow-up-schedule',fresh);assert.equal(success.status,200,JSON.stringify(success.value));
    const recovered=await snapshot(fixture,http,ticketId);assert.equal(recovered.ticket.version,version(before.ticket.version)+1);assert.equal(recovered.schedule.schedule_version,String(BigInt(text(before.schedule.schedule_version))+1n));assert.equal(recovered.schedule.active,null);
    assert.equal(recovered.stored.revision.length,before.stored.revision.length+1);assert.equal(rows(recovered.events.items).length,rows(before.events.items).length+1);assert.equal(recovered.realtime.length,before.realtime.length+1);
    assert.deepEqual(recovered.responsibility,before.responsibility);assert.deepEqual(recovered.deliveries,before.deliveries);assert.deepEqual(recovered.stored.marker,before.stored.marker);
    assert.deepEqual(await current(http,path+'/follow-up-schedule/commands/'+original.input.client_command_id),original.acknowledgement);
    console.log('T37_COMMAND_TRANSACTION_ROLLBACK '+JSON.stringify({set_cancel_witnessed_after_ticket_event_and_049:true,all_business_rolled_back:true,failed_receipts_retained:true,failed_uuid_not_retried:true,new_uuid_commits_once:true}));
  },{workbenchFollowUpSchedulesEnabled:true});
});
