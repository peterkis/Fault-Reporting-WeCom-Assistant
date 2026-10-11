// Registered associated-Journey retention tracer; external first draft is retained.
// Future tests/t21-associated-journey-retention.integration.test.mts.
// Requires only the optional helper addition beside this external draft.
// Journey/source/ref association comes from existing owning Ports. SQL here is
// limited to external retention fault/physical time and actual source lock wait.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import {withT21DraftFixture,t21FeedbackCommand,t21Send,t21Object} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {browser} from './helpers/yxx-ss-009-http-fixture.mjs';
import {t21Login as login} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';

test('T21 genuine associated Journey expiring during the actual source row wait rejects the original feedback and rolls back',
  {timeout:240_000,concurrency:false},async()=>{
  await withT21DraftFixture(async f=>{
    assert.equal(typeof f.associatedJourneyId,'string');assert.ok(f.associatedJourneyId);
    const app=await f.replaceMember(),member=browser(app.server);await login(member,'a');
    // The original source-bound member/ref and genuinely staff-completed cycle
    // are initially allowed. Only Journey retention will change in this test.
    const {command,csrf}=await t21FeedbackCommand(member,f.path),client=await f.context.pool.connect();
    let pending:ReturnType<typeof t21Send>|null=null;
    try{
      await client.query('BEGIN');
      const pid=(await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
      assert.equal(typeof pid,'number');
      await client.query(`SELECT id FROM intake.service_intake
        WHERE id=(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$1::uuid) FOR UPDATE`,[f.ticketId]);
      pending=t21Send(member,f.path,command,csrf);
      const observedDeadline=performance.now()+750;let observed=false;
      do{
        const wait=await f.context.pool.query<{pid:number}>(`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND $1::integer=ANY(pg_blocking_pids(pid)) AND strpos(query,'JOIN intake.service_intake')>0`,[pid]);
        if(wait.rowCount===1){observed=true;break;}await delay(10);
      }while(performance.now()<observedDeadline);
      assert.equal(observed,true,'must observe the actual authorizer source row wait, not Promise state');
      // Fault injected only after the writer's source wait is observed. No
      // source identity/status, r.journey_id or Ticket/ledger row is rewritten.
      const deadline=(await f.context.pool.query<{epoch:string}>(`WITH stamp AS (SELECT platform.physical_epoch_ms()+250 AS epoch)
        UPDATE intake.contact_journey SET retention_until_epoch_ms=stamp.epoch,
          retention_until=platform.local_from_epoch_ms(stamp.epoch) FROM stamp
        WHERE id=$1::uuid RETURNING retention_until_epoch_ms::text AS epoch`,[f.associatedJourneyId])).rows[0]?.epoch;
      assert.ok(deadline);const expiryDeadline=performance.now()+700;
      for(;;){
        const now=(await f.context.pool.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch;
        assert.ok(now);if(BigInt(now)>=BigInt(deadline))break;
        assert.ok(performance.now()<expiryDeadline,'physical Journey expiry was not reached');await delay(10);
      }
      await client.query('COMMIT');
      const failed=await pending;assert.equal(failed.status,404,failed.text);
      assert.equal(t21Object(t21Object(failed.json()).error).code,'YXX_ENTRY_NOT_FOUND');
      assert.equal((await member.request(f.path)).status,404);
      assert.equal((await member.request(f.path+'/feedback/commands/'+command.client_command_id)).status,404);
    }finally{
      try{await client.query('ROLLBACK');}finally{client.release();}
      if(pending)await pending.catch(()=>undefined);
    }
    // Clear only the external expiry fault, then current READ can test original
    // UUID rollback through its safe purpose-specific receipt. No new POST.
    await f.context.pool.query(`WITH stamp AS (SELECT platform.physical_epoch_ms()+2592000000 AS epoch)
      UPDATE intake.contact_journey SET retention_until_epoch_ms=stamp.epoch,
        retention_until=platform.local_from_epoch_ms(stamp.epoch) FROM stamp WHERE id=$1::uuid`,[f.associatedJourneyId]);
    const receipt=await member.request(f.path+'/feedback/commands/'+command.client_command_id);
    assert.equal(receipt.status,200,receipt.text);
    assert.deepEqual(receipt.json(),{client_command_id:command.client_command_id,public_ref:f.publicRef,state:'UNKNOWN'});
    await f.verifyStaff(async staff=>{
      const unchanged=await staff.detail(f.ticketId);assert.equal(unchanged.id,f.ticketId);
      assert.equal(unchanged.ticket_no,f.completed.ticket_no);assert.equal(unchanged.intake_id,f.completed.intake_id);
      assert.equal(unchanged.status,'CLOSED');assert.equal(unchanged.version,f.completed.version);
      assert.equal(unchanged.assignee_id,f.completed.assignee_id);assert.equal(unchanged.resolver_team_id,f.completed.resolver_team_id);
      assert.deepEqual(unchanged.handling_cycle,f.completed.handling_cycle);assert.equal(unchanged.reopen_follow_up,undefined);
    });
  },{associatedJourney:true});
});
