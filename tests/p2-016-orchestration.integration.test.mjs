import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createP2016OrchestrationWorker } from '../src/p2-016-orchestration-adapters.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { createP2016RealtimeProjector } from '../src/p2-016-realtime-projector.mjs';
import { createP2016TicketCommandFacade } from '../src/p2-016-ticket-command-facade.mjs';
import { createP2016TicketQuery } from '../src/p2-016-ticket-query.mjs';
import { createTicketClosureService } from '../src/p1-010-ticket-closure.mjs';
import { createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
test('P2-016 existing rule worker creates Ticket notifications, safe group/direct guidance and SYSTEM-only timeout closure',async()=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016orch',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    const notifications=createP2016TicketNotificationProjector({additionalEventTypes:['ticket.created'],enabled:true}),realtime=createP2016RealtimeProjector({pool,enabled:true});
    const workerEpoch=String(BigInt((await pool.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0].epoch)+10800000n);
    const worker=createP2016OrchestrationWorker({pool,notifications,realtime,identityHmacKey:'synthetic-only-identity-hmac-key',
      now:()=>workerEpoch});
    const report=await seedPersistedIntake({pool,text:'处方提交不了'});
    await seedPersistedIntake({pool,text:'系统不行'});await seedPersistedIntake({pool,text:'重置密码',chatType:'single'});
    assert.equal((await worker.processDueBatch()).disabled,true);
    const run=await worker.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
    assert.equal(run.processed,3);assert.equal(run.model_provider_calls,0);
    const rows=(await pool.query('SELECT id::text,request_type FROM pilot_ticket.ticket ORDER BY ticket_no')).rows;
    assert.equal(rows.length,2);assert.equal((await pool.query('SELECT count(*)::integer AS n FROM communication.ticket_notification_binding')).rows[0].n,3);
    const guidance=(await pool.query("SELECT m.content,d.target_type FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id WHERE m.sender_system_code='RULE_FIRST_ORCHESTRATOR'")).rows;
    assert.equal(guidance.length,2);assert.deepEqual(guidance.map(g=>g.target_type).sort(),['GROUP','PERSON']);
    assert.doesNotMatch(JSON.stringify(guidance),/token|userid|chatid|ticket_id|provider_error/u);
    assert.equal((await worker.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}})).processed,0);
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-closure-admin',displayName:'合成管理员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    let clock=Date.now();const closure=createTicketClosureService({pool,now:()=>new Date(clock),resolveReporterActor:async()=>null,outbox:{enqueueTicketEvent:input=>notifications.project(input)}});
    const query=createP2016TicketQuery({pool,enabled:true}),facade=createP2016TicketCommandFacade({pool,query,enabled:true,closure});
    const ticketId=(await pool.query('SELECT id::text FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid',[report.intakeId])).rows[0].id;
    const authContext={principal_id:principal.id};
    for(const action of ['accept','start','resolve']){const ticket=await query.detail({authContext,ticketId});const result=await facade.perform({authContext,command:{ticket_id:ticketId,action,expected_version:ticket.version,client_command_id:randomUUID(),reason_code:'SYNTHETIC_CLOSURE'}});assert.equal(result.ok,true,JSON.stringify(result));}
    const current=await query.detail({authContext,ticketId});
    await assert.rejects(facade.perform({authContext,command:{ticket_id:ticketId,action:'auto-close',expected_version:current.version,client_command_id:randomUUID(),reason_code:'FORBIDDEN'}}),{code:'P2_016_INPUT_INVALID'});
    clock+=45*3600000;assert.deepEqual((await closure.runAutoCloseReminders()).reminded_ticket_ids,[ticketId]);
    clock+=4*3600000;
    const system=createTicketActionService({pool,authorize:async({actor,action})=>actor.type==='SYSTEM'&&action==='auto-close',afterAction:closure.afterTicketAction});
    assert.deepEqual((await closure.runAutoClose({actionService:system})).closed_ticket_ids,[ticketId]);
    assert.equal((await query.detail({authContext,ticketId})).status,'CLOSED');
    assert.deepEqual((await closure.runAutoClose({actionService:system})).closed_ticket_ids,[]);
  }});
});
