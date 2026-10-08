import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createDecisionStore } from '../src/p2-015-decision-store.mjs';
import { createManualReviewStore } from '../src/p2-015-manual-review.mjs';
import { createRuleFirstOrchestrator } from '../src/p2-015-rule-first-orchestrator.mjs';
import { createExistingTicketCommandPort,createSafeActionExecutor } from '../src/p2-015-safe-action-executor.mjs';
import { createServiceIntakeDecisionPort } from '../src/p2-015-service-intake-decision-port.mjs';
import { createP2016ManualReviewFacade } from '../src/p2-016-manual-review-facade.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030,assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
import { assertP2016Schema } from './helpers/p2-016-schema-assert.mjs';
import {createChannelMessageInbox} from '../src/p1-003-channel-message-inbox.mjs';
import {createServiceIntakeProcessor} from '../src/p1-004-service-intake.mjs';
import {formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;
test('P2-016 review resolution and Safe Action commit or roll back together',async()=>{
  assert.ok(databaseUrl,'database required');
  await withP2016IsolatedDatabase({databaseUrl,purpose:'p2016review',run:async({pool,databaseUrl:isolated})=>{
    await applyThrough030({pool,databaseUrl:isolated});await migrateP2016({databaseUrl:isolated});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-reviewer',displayName:'审核坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const authContext={principal_id:principal.id},decisionStore=createDecisionStore(),manualReviewStore=createManualReviewStore();
    const executor=createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),manualReviewStore,decisionStore,
      ticketCommandPort:createExistingTicketCommandPort({ticketCore:createPilotTicketCore({pool})})});
    const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'synthetic-rule-key-32-characters',
      decisionStore,safeActionExecutor:executor,ruleEngine:{catalog_version:'TEST',rule_set_version:'TEST',evaluate(){throw new Error('synthetic');}}});
    const seed=async()=>{
      const input=await seedPersistedIntake({pool,text:'不确定的合成报修'});
      const result=await orchestrator.processPersistedIntake({service_intake_id:input.intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
      return {input,result};
    };
    const f=createP2016ManualReviewFacade({pool,enabled:true,notificationProjector:createP2016TicketNotificationProjector({additionalEventTypes:['ticket.created'],enabled:true})});
    await seed();
    const first=(await f.listManualReviews({authContext})).items[0],before=await f.getManualReviewDetail({authContext,reviewId:first.id});
    await assertP2016Schema('p2_016_manual_review_list',await f.listManualReviews({authContext}));
    await assertP2016Schema('p2_016_manual_review_detail',before);
    const body={client_command_id:randomUUID(),expected_row_version:first.row_version,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'HUMAN_CONFIRMED'};
    const results=await Promise.all(Array.from({length:12},()=>f.resolveManualReview({authContext,reviewId:first.id,body})));
    assert.ok(results.every(r=>r.ok),JSON.stringify(results));assert.equal(results.filter(r=>!r.replayed).length,1);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM communication.ticket_notification_binding')).rows[0].n,2);
    assert.deepEqual((await f.getManualReviewDetail({authContext,reviewId:first.id})).safe_result,before.safe_result);
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM intake.deterministic_decision WHERE status='HUMAN_OVERRIDDEN'")).rows[0].n,1);
    await assert.rejects(f.resolveManualReview({authContext,reviewId:first.id,body:{...body,resolution_reason_code:'DIFFERENT'}}),{code:'P2_016_COMMAND_CONFLICT'});
    const pending=await seed(),review=(await f.listManualReviews({authContext})).items[0];
    const broken=createP2016ManualReviewFacade({pool,enabled:true,communicationAppend:async()=>{throw new Error('synthetic-send-port-failure');}});
    const failed=await broken.resolveManualReview({authContext,reviewId:review.id,body:{client_command_id:randomUUID(),expected_row_version:review.row_version,
      resolution_code:'REQUEST_DESCRIPTION',resolution_reason_code:'NEEDS_DESCRIPTION'}});
    assert.equal(failed.ok,false);
    assert.equal((await f.getManualReviewDetail({authContext,reviewId:review.id})).status,'PENDING');
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM intake.deterministic_decision WHERE journey_id=$1::uuid AND status='HUMAN_OVERRIDDEN'",[pending.result.journey.id])).rows[0].n,0);
    const kept=await f.resolveManualReview({authContext,reviewId:review.id,body:{client_command_id:randomUUID(),expected_row_version:review.row_version,
      resolution_code:'KEEP_INCIDENT_REVIEW_CANDIDATE',resolution_reason_code:'KEEP_CANDIDATE'}});
    assert.equal(kept.ok,true);assert.equal(kept.action_count,0);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,1);
    await seed();
    const botCancelReview=(await f.listManualReviews({authContext})).items[0];
    const cancelled=await f.resolveManualReview({authContext,reviewId:botCancelReview.id,body:{client_command_id:randomUUID(),expected_row_version:botCancelReview.row_version,
      resolution_code:'CANCEL_REVIEW',resolution_reason_code:'BOT_CANCELLED'}});
    assert.equal(cancelled.ok,true);assert.equal(cancelled.action_count,0);
    assert.equal((await pool.query('SELECT result_code FROM intake.deterministic_decision WHERE id=$1::uuid',[cancelled.resolution_decision_id])).rows[0].result_code,'MANUAL_REVIEW_REQUIRED');
  }});
  await assertNoP2016Residual({databaseUrl});
});

test('T14 genuine Bot supplement invalidates the original Review without changing its row version',async()=>{
  await withP2016IsolatedDatabase({databaseUrl,purpose:'t14basis',run:async context=>{
    const {pool}=context;await applyThrough030(context);await migrateP2016({databaseUrl:context.databaseUrl});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'t14-synthetic-reviewer',displayName:'复核员',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const authContext={principal_id:principal.id},store=createManualReviewStore(),decisions=createDecisionStore();
    const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'t14-only-synthetic-identity-key',decisionStore:decisions,
      safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),manualReviewStore:store,decisionStore:decisions,
        ticketCommandPort:createExistingTicketCommandPort({ticketCore:createPilotTicketCore({pool})})}),
      ruleEngine:{catalog_version:'TEST',rule_set_version:'TEST',evaluate(){throw new Error('synthetic');}}});
    const input=await seedPersistedIntake({pool,text:'原始不确定材料'});
    await orchestrator.processPersistedIntake({service_intake_id:input.intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
    const facade=createP2016ManualReviewFacade({pool,enabled:true}),review=(await facade.listManualReviews({authContext})).items[0];
    const original=await facade.getManualReviewDetail({authContext,reviewId:review.id});
    const source=(await pool.query('SELECT source_chat_id FROM intake.service_intake WHERE id=$1::uuid',[input.intakeId])).rows[0];
    const epoch=(await pool.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0].epoch,msgId='t14-'+randomUUID();
    const message={schema_version:1,provider:'WECOM_AIBOT',idempotency_key:'WECOM_AIBOT:'+msgId,msg_id:msgId,req_id:msgId,bot_id:'bot-test',chat_type:'group',chat_id:source.source_chat_id,
      sender_user_id:'user-test',msg_type:'text',provider_create_epoch_ms:null,create_time:null,received_epoch_ms:epoch,received_at:formatEpochMsToShanghaiLocal(epoch),
      content:[{kind:'text',text:{raw:'补充：实际是咨询，不是故障',clean:'补充：实际是咨询，不是故障'}}],quote:null};
    const appended=await createChannelMessageInbox({pool}).accept({message,traceId:'t14-synthetic',privacyClass:'INTERNAL',retentionUntil:input.retentionUntil},createServiceIntakeProcessor());
    assert.equal(appended.ok,true);assert.equal(appended.result.intake.id,input.intakeId);assert.equal(appended.result.message.sequence_no,2);
    const current=await facade.getManualReviewDetail({authContext,reviewId:review.id});assert.equal(current.row_version,original.row_version);assert.deepEqual(current.safe_result,original.safe_result);
    const outcome=await facade.resolveManualReview({authContext,reviewId:review.id,body:{client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'HUMAN_CONFIRMED'}});
    assert.equal(outcome.ok,false);assert.equal(outcome.error.code,'P2_016_VERSION_CONFLICT');
    assert.equal((await facade.getManualReviewDetail({authContext,reviewId:review.id})).status,'PENDING');
    const facts=(await pool.query(`SELECT (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,
      (SELECT count(*)::integer FROM intake.deterministic_decision WHERE status='HUMAN_OVERRIDDEN') AS decisions,
      (SELECT count(*)::integer FROM communication.outbox) AS outbox`)).rows[0];
    assert.deepEqual(facts,{tickets:0,decisions:0,outbox:0});
  }});await assertNoP2016Residual({databaseUrl});
});
