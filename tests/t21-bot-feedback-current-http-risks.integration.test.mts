// SOURCE_ONLY / NOT_REGISTERED / NOT_COMPILED / NOT_RUN.
// Intended repository location: tests/t21-bot-feedback-current-http-risks.integration.test.mts.
// One original owned PG fixture per test, stock concurrency 1, timeout 240s.
// SQL below only arranges isolated faults/row locks or observes physical time/locks.
// Business outcomes are checked through current Bot HTTP receipt and staff HTTP detail.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import type {PostgresPool,PostgresPoolClient} from '../src/platform/postgres-pool.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {withT21DraftFixture,t21FeedbackCommand,t21Send,t21Object,t21Config,t21Mapping,t21OAuthOptions} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import type {T21DraftFixture} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {browser,login,origin,secret} from './helpers/yxx-ss-009-http-fixture.mjs';

type MemberBrowser=ReturnType<typeof browser>;
type HttpResponse=Awaited<ReturnType<MemberBrowser['request']>>;
type Pending=Promise<HttpResponse>;
const options={timeout:240_000,concurrency:false};
const sourceLockSql='SELECT id FROM intake.service_intake WHERE id=(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$1::uuid) FOR UPDATE';

async function observedWait(pool:PostgresPool,blockerPid:number,queryFragment:string){
  // A pending JS Promise or a sleep is not evidence of a PostgreSQL row wait.
  const deadline=performance.now()+750;
  do{
    const waiting=await pool.query<{pid:number}>(`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock'
        AND $1::integer=ANY(pg_blocking_pids(pid)) AND strpos(query,$2)>0`,[blockerPid,queryFragment]);
    if(waiting.rowCount===1)return waiting.rows[0]?.pid;
    await delay(10);
  }while(performance.now()<deadline);
  assert.fail('T21_REAL_PG_LOCK_WAIT_NOT_OBSERVED');
}

async function sourceBlocker(f:T21DraftFixture){
  const client=await f.context.pool.connect();
  try{
    await client.query('BEGIN');
    const pid=(await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;
    assert.equal(typeof pid,'number');
    await client.query(sourceLockSql,[f.ticketId]);
    return {client,pid:pid as number};
  }catch(error){await client.query('ROLLBACK');client.release();throw error;}
}

async function finishBlocker(client:PostgresPoolClient,pending:Pending|null,commit=false){
  try{await client.query(commit?'COMMIT':'ROLLBACK');}finally{client.release();}
  // Drain the real request even if arrangement/assertions throw; no queued writer
  // may survive into listener or database cleanup. Preserve the primary failure.
  if(pending)await pending.catch(()=>undefined);
}

async function unknown(member:MemberBrowser,f:T21DraftFixture,commandId:string){
  const response=await member.request(f.path+'/feedback/commands/'+commandId);
  assert.equal(response.status,200,response.text);
  assert.deepEqual(response.json(),{client_command_id:commandId,public_ref:f.publicRef,state:'UNKNOWN'});
}

async function unchangedStaff(f:T21DraftFixture){
  await f.verifyStaff(async staff=>{
    const detail=await staff.detail(f.ticketId);
    assert.equal(detail.id,f.ticketId);
    assert.equal(detail.ticket_no,f.completed.ticket_no);
    assert.equal(detail.status,'CLOSED');
    assert.equal(detail.version,f.completed.version);
    assert.equal(detail.assignee_id,f.completed.assignee_id);
    assert.equal(detail.resolver_team_id,f.completed.resolver_team_id);
    assert.deepEqual(detail.handling_cycle,f.completed.handling_cycle);
    assert.equal(detail.reopen_follow_up,undefined);
  });
}

test('T21 source physical retention expiring during an observed source row wait rejects and rolls back',options,async()=>{
  await withT21DraftFixture(async f=>{
    const app=await f.replaceMember(),member=browser(app.server);await login(member,'a');
    const {command,csrf}=await t21FeedbackCommand(member,f.path);
    const deadline=(await f.context.pool.query<{epoch:string}>('SELECT (platform.physical_epoch_ms()+1200)::text AS epoch')).rows[0]?.epoch;
    assert.ok(deadline);
    await f.context.pool.query(`UPDATE intake.service_intake
      SET retention_until_epoch_ms=$2::bigint,retention_until=platform.local_from_epoch_ms($2::bigint)
      WHERE id=(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$1::uuid)`,[f.ticketId,deadline]);
    const {client,pid}=await sourceBlocker(f);let pending:Pending|null=null;
    try{
      pending=t21Send(member,f.path,command,csrf);
      await observedWait(f.context.pool,pid,'JOIN intake.service_intake');
      const waitDeadline=performance.now()+1400;
      for(;;){
        const now=(await f.context.pool.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch;
        assert.ok(now);
        if(BigInt(now)>=BigInt(deadline))break;
        assert.ok(performance.now()<waitDeadline,'T21_PHYSICAL_EXPIRY_NOT_REACHED');await delay(10);
      }
      await client.query('COMMIT');
      const response=await pending;assert.equal(response.status,404,response.text);
      assert.equal(t21Object(t21Object(response.json()).error).code,'YXX_ENTRY_NOT_FOUND');
      assert.equal((await member.request(f.path)).status,404);
      assert.equal((await member.request(f.path+'/feedback/commands/'+command.client_command_id)).status,404);
    }finally{await finishBlocker(client,pending);}
    // Restore only the external retention fault; it creates no ticket/cycle/receipt.
    await f.context.pool.query(`WITH stamp AS (SELECT platform.physical_epoch_ms()+2592000000 AS epoch)
      UPDATE intake.service_intake SET retention_until_epoch_ms=stamp.epoch,
        retention_until=platform.local_from_epoch_ms(stamp.epoch) FROM stamp
      WHERE id=(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$1::uuid)`,[f.ticketId]);
    await unknown(member,f,command.client_command_id);await unchangedStaff(f);
  });
});

test('T21 local OAuth logout while waiting on the actual source row prevents commit; fresh login reads original UNKNOWN',options,async()=>{
  await withT21DraftFixture(async f=>{
    const app=await f.replaceMember(),member=browser(app.server);await login(member,'a');
    const {command,csrf}=await t21FeedbackCommand(member,f.path),{client,pid}=await sourceBlocker(f);let pending:Pending|null=null;
    try{
      pending=t21Send(member,f.path,command,csrf);await observedWait(f.context.pool,pid,'JOIN intake.service_intake');
      const logout=await member.request('/api/reporter/logout',{method:'POST',body:{},headers:{origin,'content-type':'application/json'}});
      assert.equal(logout.status,200,logout.text);await client.query('COMMIT');
      assert.equal((await pending).status,401);
      assert.equal((await member.request(f.path+'/feedback/commands/'+command.client_command_id)).status,401);
    }finally{await finishBlocker(client,pending);}
    await login(member,'a');await unknown(member,f,command.client_command_id);await unchangedStaff(f);
  });
});

test('T21 current Bot source revocation committed by the blocking transaction rejects the queued feedback',options,async()=>{
  await withT21DraftFixture(async f=>{
    const app=await f.replaceMember(),member=browser(app.server);await login(member,'a');
    const {command,csrf}=await t21FeedbackCommand(member,f.path),{client,pid}=await sourceBlocker(f);let pending:Pending|null=null;
    try{
      pending=t21Send(member,f.path,command,csrf);await observedWait(f.context.pool,pid,'JOIN intake.service_intake');
      await client.query(`UPDATE intake.service_intake SET source_bot_id='t21-revoked-source'
        WHERE id=(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$1::uuid)`,[f.ticketId]);
      await client.query('COMMIT');assert.equal((await pending).status,404);
      assert.equal((await member.request(f.path+'/feedback/commands/'+command.client_command_id)).status,404);
    }finally{await finishBlocker(client,pending);}
    await f.context.pool.query(`UPDATE intake.service_intake SET source_bot_id='bot-test'
      WHERE id=(SELECT source_intake_id FROM pilot_ticket.ticket WHERE id=$1::uuid)`,[f.ticketId]);
    await unknown(member,f,command.client_command_id);await unchangedStaff(f);
  });
});

for(const stage of ['BEFORE','AFTER'] as const)test('T21 injected '+stage+' receipt INSERT fault rolls back Core and current Bot original command',options,async()=>{
  await withT21DraftFixture(async f=>{
    const app=await f.replaceMember(),member=browser(app.server);await login(member,'a');
    const {command,csrf}=await t21FeedbackCommand(member,f.path),gate='t21_receipt_'+randomUUID();
    assert.match(command.client_command_id,/^[a-f0-9-]{36}$/u);assert.match(gate,/^[a-z0-9_-]+$/u);
    // BEFORE receipt insert is after shared Core reopen. AFTER is after receipt
    // insert, before final recheck/COMMIT. Gate observation proves this stage was
    // reached; the injected exception must not surface private SQL in the DTO.
    await f.context.pool.query(`CREATE FUNCTION pilot_ticket.t21_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $fault$
      BEGIN IF NEW.command_type='BOT_REPORTER_FEEDBACK' AND NEW.client_command_id::text=TG_ARGV[0] THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(TG_ARGV[1],0));
        RAISE EXCEPTION 'T21_EXTERNAL_RECEIPT_FAULT'; END IF; RETURN NEW; END $fault$`);
    await f.context.pool.query(`CREATE TRIGGER t21_receipt_fault ${stage} INSERT ON pilot_ticket.ticket_command_receipt
      FOR EACH ROW EXECUTE FUNCTION pilot_ticket.t21_receipt_fault('${command.client_command_id}','${gate}')`);
    const client=await f.context.pool.connect();let pending:Pending|null=null;
    try{
      await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[gate]);
      const pid=(await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.equal(typeof pid,'number');
      pending=t21Send(member,f.path,command,csrf);await observedWait(f.context.pool,pid as number,'INSERT INTO pilot_ticket.ticket_command_receipt');
      await client.query('COMMIT');const failed=await pending;assert.equal(failed.status,503,failed.text);
      assert.equal(failed.text.includes('T21_EXTERNAL_RECEIPT_FAULT'),false);
      assert.equal(failed.text.includes('ticket_command_receipt'),false);
      await unknown(member,f,command.client_command_id);
    }finally{
      await finishBlocker(client,pending);
      await f.context.pool.query('DROP TRIGGER t21_receipt_fault ON pilot_ticket.ticket_command_receipt');
      await f.context.pool.query('DROP FUNCTION pilot_ticket.t21_receipt_fault()');
    }
    await unchangedStaff(f);
  });
});

test('T21 current WRITE flag loss during the actual source wait cannot commit while current Bot READ remains usable',options,async()=>{
  await withT21DraftFixture(async f=>{
    // Independent existing member profile, same owned pool and approved synthetic
    // current scope. It exposes the caller's mutable flags without a test-only
    // writer seam. No historical App pin or wider App authorization is introduced.
    await f.closeMember();
    const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    const app=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:f.context.pool,publicOrigin:origin,
      reporterMemberEntry:t21Config,identityMapping:await t21Mapping(),reporterHmacSecret:secret,
      oauth:createWeComWebOAuth(t21OAuthOptions()),botReporterFeedbackEnabled:true,
      yxxSelfService:{featureFlags:flags,reporterFeedbackEnabled:false,pollMilliseconds:100}});
    let client:PostgresPoolClient|null=null,pending:Pending|null=null;
    try{
      await app.start();await app.selfService.pump?.stop();const member=browser(app.server);await login(member,'a');
      const prepared=await t21FeedbackCommand(member,f.path),blocker=await sourceBlocker(f);client=blocker.client;
      pending=t21Send(member,f.path,prepared.command,prepared.csrf);await observedWait(f.context.pool,blocker.pid,'JOIN intake.service_intake');
      flags.YIXIAOXIU_SELF_SERVICE_ENABLED=false;await client.query('COMMIT');
      const response=await pending;
      // Fail-closed status may be FLAGS_CHANGED 503 or an explicit write-denial
      // 403; neither may be 200/COMMITTED. Fixing this known risk is not authorized
      // by this unrun draft. Do not pre-label the current product RED or PASS.
      assert.ok(response.status===403||response.status===503,response.text);
      await unknown(member,f,prepared.command.client_command_id);
      assert.equal((await member.request(f.path)).status,200);
    }finally{
      if(client)await finishBlocker(client,pending);await app.stop();assert.equal(app.server.listening,false);
    }
    await unchangedStaff(f);
  });
});
