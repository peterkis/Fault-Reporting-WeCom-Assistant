import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withP2012Database, applyThrough031 } from './helpers/p2-012-postgres-harness.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';
import { createP2G1HumanOnlyAssembly } from '../src/p2-g1-human-only-assembly.mjs';
import { createChannelMessageInbox } from '../src/p1-003-channel-message-inbox.mjs';
import { createP2016DirectIntakeProcessor } from '../src/p2-016-direct-intake.mjs';

test('late actual Conversation projection fills null Leg/Journey references on an idle Worker cycle without rewriting Decision or Ticket',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'g2latebind',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const admin=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-late-admin',displayName:'模拟坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    // The Runtime is intentionally not started: no background projector timer.
    const runtime=createP2012Runtime({pool,principalId:admin.id,publicOrigin:'http://127.0.0.1:43129',flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true}});
    const inbox=createChannelMessageInbox({pool}),processor=createP2016DirectIntakeProcessor();
    const assembly=createP2G1HumanOnlyAssembly({operationalIntake:{accept:input=>inbox.accept(input,processor)},projectAfterCommit:false});
    const worker=createP2016OrchestrationWorker({pool,identityHmacKey:'synthetic-late-identity-key',notifications:runtime.notifications,realtime:runtime.realtimeProjector});
    const flags={RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true};
    try{
      await assembly.handleFrame({cmd:'aibot_msg_callback',headers:{req_id:randomUUID()},body:{msgid:randomUUID(),aibotid:'synthetic-late-bot',
        chattype:'single',from:{userid:'synthetic-late-reporter'},msgtype:'text',text:{content:'打印机卡纸'}}});
      assert.equal((await worker.processDueBatch({feature_flags:flags,now_epoch_ms:String(Date.now()+15000)})).processed,1);
      const leg=(await pool.query('SELECT id,journey_id,source_intake_id,conversation_session_id,conversation_thread_id FROM intake.channel_leg')).rows[0];
      assert.equal(leg.conversation_session_id,null);assert.equal(leg.conversation_thread_id,null);
      const decision=(await pool.query('SELECT id,input_hash,result_hash,safe_result FROM intake.deterministic_decision')).rows;
      const tickets=(await pool.query('SELECT id,status FROM pilot_ticket.ticket')).rows;assert.equal(tickets.length,1);
      assert.equal((await runtime.coordinator.runOnce()).failures,0);
      const session=(await pool.query('SELECT id,thread_id,participant_key FROM conversation.session WHERE service_intake_id=$1',[leg.source_intake_id])).rows[0];assert.ok(session);
      // Owned negative fixture: a mismatching Reporter is not a binding source.
      await pool.query('UPDATE conversation.session SET participant_key=$2 WHERE id=$1',[session.id,'synthetic-foreign-reporter']);
      await worker.processDueBatch({feature_flags:flags});
      assert.equal((await pool.query('SELECT conversation_session_id FROM intake.channel_leg WHERE id=$1',[leg.id])).rows[0].conversation_session_id,null);
      await pool.query('UPDATE conversation.session SET participant_key=$2 WHERE id=$1',[session.id,session.participant_key]);
      const concurrent=await Promise.all(Array.from({length:12},()=>worker.processDueBatch({feature_flags:flags})));
      assert.ok(concurrent.every(result=>result.processed===0));
      const bound=(await pool.query('SELECT id,conversation_session_id,conversation_thread_id,row_version::text FROM intake.channel_leg WHERE id=$1',[leg.id])).rows[0];
      assert.equal(bound.id,leg.id);assert.equal(bound.conversation_session_id,session.id);assert.equal(bound.conversation_thread_id,session.thread_id);
      assert.equal(bound.row_version,'2');
      const journey=(await pool.query('SELECT origin_session_id,current_session_id FROM intake.contact_journey WHERE id=$1',[leg.journey_id])).rows[0];
      assert.deepEqual(journey,{origin_session_id:session.id,current_session_id:session.id});
      await worker.processDueBatch({feature_flags:flags});
      assert.deepEqual((await pool.query('SELECT id,conversation_session_id,conversation_thread_id,row_version::text FROM intake.channel_leg WHERE id=$1',[leg.id])).rows[0],bound);
      assert.deepEqual((await pool.query('SELECT id,input_hash,result_hash,safe_result FROM intake.deterministic_decision')).rows,decision);
      assert.deepEqual((await pool.query('SELECT id,status FROM pilot_ticket.ticket')).rows,tickets);
    }finally{await worker.stop();await runtime.stop();}
  }});
});
