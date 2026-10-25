// Registered final-authorizer transport boundary tracer; external first draft retained.
// Future tests/t21-final-authorizer-write-loss.integration.test.mts.
// One existing owned isolated PG and one synthetic MEMBER App. The temporary
// gate delegates all time values to the untouched original native clock.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import type {PostgresPoolClient} from '../app/server/src/platform/postgres-pool.mjs';
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {withT21DraftFixture,t21Config,t21Mapping,t21OAuthOptions,t21Login,t21FeedbackCommand,t21Send,t21Object} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {browser,origin,secret} from './helpers/yxx-ss-009-http-fixture.mjs';

interface ClockDefinition {oid:string;definition:string;comment:string|null}
const clockMetadata=`SELECT p.oid::text AS oid,pg_get_functiondef(p.oid) AS definition,
  obj_description(p.oid,'pg_proc') AS comment FROM pg_proc p WHERE p.oid='platform.physical_epoch_ms()'::regprocedure`;
// Deliberately the exact current production authorizer statement, observed in
// pg_stat_activity. If that statement changes, review this narrow tracer first.
const lastAuthorizationSql=`SELECT r.ticket_id::text,i.id::text AS source_intake_id,r.public_ref,r.journey_id::text,r.reporter_binding_hash,
      i.source_provider,i.source_bot_id,i.reporter_wecom_userid
      FROM pilot_ticket.reporter_public_ref r JOIN pilot_ticket.ticket t ON t.id=r.ticket_id
      JOIN intake.service_intake i ON i.id=t.source_intake_id
      LEFT JOIN intake.contact_journey j ON j.id=r.journey_id
      WHERE r.public_ref=$1 AND r.status='ACTIVE' AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND (r.journey_id IS NULL OR j.retention_until_epoch_ms>platform.physical_epoch_ms())
      FOR SHARE OF r,t,i`;

test('T21 WRITE loss during the actual final authorizer DB await rolls back Core and original Bot receipt while READ survives',
  {timeout:240_000,concurrency:false},async()=>{
  await withT21DraftFixture(async f=>{
    await f.closeMember();
    const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    const app=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:f.context.pool,publicOrigin:origin,
      reporterMemberEntry:t21Config,identityMapping:await t21Mapping(),reporterHmacSecret:secret,
      oauth:createWeComWebOAuth(t21OAuthOptions()),botReporterFeedbackEnabled:true,
      yxxSelfService:{featureFlags:flags,reporterFeedbackEnabled:false,pollMilliseconds:100}});
    let holder:PostgresPoolClient|null=null,pending:ReturnType<typeof t21Send>|null=null;
    let installed=false,gateHeld=false,baseline:ClockDefinition|null=null;
    let postResponse:Awaited<ReturnType<typeof t21Send>>|null=null,receiptValue:Record<string,unknown>|null=null;
    let memberDetailStatus:number|null=null,originalCommandId:string|null=null;
    try{
      await app.start();await app.selfService.pump?.stop();const member=browser(app.server);await t21Login(member,'a');
      const {command,csrf}=await t21FeedbackCommand(member,f.path);originalCommandId=command.client_command_id;
      const gate='t21_final_auth_'+randomUUID();
      assert.match(command.client_command_id,/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
      assert.match(f.ticketId,/^[a-f0-9-]{36}$/u);assert.match(gate,/^[a-z0-9_-]+$/u);
      const metadata=(await f.context.pool.query<ClockDefinition>(clockMetadata)).rows[0];assert.ok(metadata);baseline=metadata;
      assert.equal((await f.context.pool.query<{unused:boolean}>("SELECT to_regprocedure('platform.t21_final_auth_native_clock()') IS NULL AS unused")).rows[0]?.unused,true);
      holder=await f.context.pool.connect();
      // Atomic external fault installation. The original function's body,
      // volatility, ownership and native clock remain untouched under its OID.
      await holder.query('BEGIN');
      try{
        await holder.query('ALTER FUNCTION platform.physical_epoch_ms() RENAME TO t21_final_auth_native_clock');
        await holder.query(`CREATE FUNCTION platform.physical_epoch_ms() RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY INVOKER
          SET search_path=pg_catalog,platform AS $gate$
          BEGIN
            IF strpos(current_query(),'FROM pilot_ticket.reporter_public_ref r')>0
              AND strpos(current_query(),'JOIN intake.service_intake')>0
              AND EXISTS(SELECT 1 FROM pilot_ticket.ticket_command_receipt
                WHERE command_type='BOT_REPORTER_FEEDBACK' AND state='COMMITTED' AND actor_principal_id IS NULL
                  AND client_command_id='${command.client_command_id}'::uuid AND ticket_id='${f.ticketId}'::uuid
                  AND xmin::text::bigint=(pg_current_xact_id_if_assigned()::text::bigint % 4294967296))
            THEN PERFORM pg_advisory_xact_lock(hashtextextended('${gate}',0)); END IF;
            RETURN platform.t21_final_auth_native_clock();
          END $gate$`);
        await holder.query('COMMIT');installed=true;
      }catch(error){await holder.query('ROLLBACK');throw error;}
      await holder.query('BEGIN');gateHeld=true;
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[gate]);
      const blockerPid=(await holder.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.equal(typeof blockerPid,'number');
      pending=t21Send(member,f.path,command,csrf);
      const deadline=performance.now()+750;let observed=false;
      do{
        const wait=await f.context.pool.query<{pid:number}>(`SELECT pid FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND $1::integer=ANY(pg_blocking_pids(pid)) AND query=$2`,[blockerPid,lastAuthorizationSql]);
        if(wait.rowCount===1){observed=true;break;}await delay(10);
      }while(performance.now()<deadline);
      assert.equal(observed,true,'the exact final authorizer statement must be waiting after its own actual receipt INSERT');
      // This is the actual object already supplied to the real Bot service.
      // No session, current READ flag, source/binding, round or clock is changed.
      flags.YIXIAOXIU_SELF_SERVICE_ENABLED=false;
      await holder.query('COMMIT');gateHeld=false;postResponse=await pending;
      // Collect current public consequences before expected assertions, so a
      // real pre-fix 200 retains COMMITTED/REOPENED evidence rather than stopping
      // before those publicly observable outcomes have been recorded.
      const receipt=await member.request(f.path+'/feedback/commands/'+command.client_command_id);
      assert.equal(receipt.status,200,receipt.text);receiptValue=t21Object(receipt.json());
      memberDetailStatus=(await member.request(f.path)).status;
    }finally{
      // Unblock and drain before touching function definitions or closing App.
      // Restoring an in-flight function would invalidate the real arrangement.
      try{
        if(holder&&gateHeld){await holder.query('ROLLBACK');gateHeld=false;}
        if(pending)await pending.catch(()=>undefined);
      }finally{
        try{await app.stop();assert.equal(app.server.listening,false);}
        finally{
          if(holder){
            try{
              if(installed){
                await holder.query('BEGIN');
                try{
                  await holder.query('DROP FUNCTION platform.physical_epoch_ms()');
                  await holder.query('ALTER FUNCTION platform.t21_final_auth_native_clock() RENAME TO physical_epoch_ms');
                  await holder.query('COMMIT');installed=false;
                }catch(error){await holder.query('ROLLBACK');throw error;}
                const restored=(await holder.query<ClockDefinition>(clockMetadata)).rows[0];
                assert.deepEqual(restored,baseline,'restore the exact native OID, definition bytes and comment');
                assert.equal((await holder.query<{unused:boolean}>("SELECT to_regprocedure('platform.t21_final_auth_native_clock()') IS NULL AS unused")).rows[0]?.unused,true);
              }
            }finally{holder.release();}
          }
        }
      }
    }
    assert.ok(postResponse&&receiptValue&&originalCommandId);
    await f.verifyStaff(async staff=>{
      const current=await staff.detail(f.ticketId);
      console.log('T21_FINAL_AUTH_WRITE_LOSS '+JSON.stringify({post_status:postResponse?.status,
        receipt_state:receiptValue?.state,current_read_status:memberDetailStatus,
        staff_status:current.status,staff_version:current.version,prior_version:f.completed.version,
        same_completed_cycle:current.handling_cycle?.id===f.completed.handling_cycle?.id}));
      assert.equal(postResponse?.status,403,postResponse?.text);
      assert.deepEqual(receiptValue,{client_command_id:originalCommandId,public_ref:f.publicRef,state:'UNKNOWN'});
      assert.equal(memberDetailStatus,200,'current Bot READ is independent of new WRITE');
      assert.equal(current.id,f.ticketId);assert.equal(current.ticket_no,f.completed.ticket_no);
      assert.equal(current.intake_id,f.completed.intake_id);assert.equal(current.status,'CLOSED');
      assert.equal(current.version,f.completed.version);assert.equal(current.assignee_id,f.completed.assignee_id);
      assert.equal(current.resolver_team_id,f.completed.resolver_team_id);
      assert.deepEqual(current.handling_cycle,f.completed.handling_cycle);assert.equal(current.reopen_follow_up,undefined);
    });
  });
});
