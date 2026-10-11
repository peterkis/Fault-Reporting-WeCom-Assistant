// SOURCE_ONLY / NOT_REGISTERED / NOT_COMPILED / NOT_RUN.
// Intended repository location: tests/t21-bot-ordinary-supplement-no-reopen.integration.test.mts.
// Genuine in-process Bot callback adapter -> durable Inbox/Intake -> projected
// Conversation Session -> original Journey Ports -> genuine staff HTTP completion.
// No SDK, sending or public callback endpoint is claimed. No target status is seeded.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT11Fixture,t11Http} from './helpers/t11-completion-fixture.mjs';
import {t21Object} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {createPilotTicketCore} from '../src/p1-005-pilot-ticket-core.mjs';
import {createRuleFirstOrchestrator} from '../src/p2-015-rule-first-orchestrator.mjs';
import {createDecisionStore} from '../src/p2-015-decision-store.mjs';
import {createManualReviewStore} from '../src/p2-015-manual-review.mjs';
import {createServiceIntakeDecisionPort} from '../src/p2-015-service-intake-decision-port.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort,createP2004FixedCommunicationPort} from '../src/p2-015-safe-action-executor.mjs';

test('T21 ordinary Bot supplement and thanks continue the same real Intake/Journey without implicitly reopening a staff-completed Ticket',
  {timeout:240_000,concurrency:false},async()=>{
  await withT11Fixture(async context=>{
    const tag=randomUUID(),bot='t21-ordinary-bot-'+tag,reporter='t21-ordinary-reporter-'+tag;
    const decisions=createDecisionStore(),orchestrator=createRuleFirstOrchestrator({pool:context.pool,
      identityHmacKey:'t21-real-inbox-journey-synthetic-key',decisionStore:decisions,
      safeActionExecutor:createSafeActionExecutor({decisionStore:decisions,
        intakeDecisionPort:createServiceIntakeDecisionPort(),manualReviewStore:createManualReviewStore(),
        ticketCommandPort:createExistingTicketCommandPort({ticketCore:createPilotTicketCore({pool:context.pool})}),
        communicationPort:createP2004FixedCommunicationPort()})});
    const flags={RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true};
    const accept=async(text:string)=>{
      const id=randomUUID(),accepted=await context.runtime.assembly.handleFrame({cmd:'aibot_msg_callback',
        headers:{req_id:'t21-'+id},body:{msgid:'t21-'+id,aibotid:bot,chattype:'single',from:{userid:reporter},msgtype:'text',text:{content:text}}});
      assert.equal(accepted.ok,true);
      const result=t21Object(t21Object(accepted).result),intake=t21Object(result.intake);
      assert.equal(typeof intake.id,'string');
      // Use the ID returned by the durable adapter; never look up a latest Ticket.
      const intakeId=String(intake.id);
      for(let attempt=0;attempt<20;attempt++){
        await context.runtime.coordinator.runOnce();
        if(t21Object(await context.runtime.coordinator.backlog()).channel_messages===0)break;
      }
      assert.equal(t21Object(await context.runtime.coordinator.backlog()).channel_messages,0);
      const evaluated=await orchestrator.processPersistedIntake({service_intake_id:intakeId,feature_flags:flags,trace_id:'t21-ordinary-'+id});
      return {intakeId,result,evaluated:t21Object(evaluated)};
    };
    const first=await accept('3楼护士站HIS登录报错'),journeyId=t21Object(first.evaluated.journey).id;
    assert.equal(typeof journeyId,'string');assert.equal(t21Object(first.result.aggregation).action,'CREATED');
    const actions=first.evaluated.action_results;assert.ok(Array.isArray(actions));
    const ticketAction=actions.map(t21Object).find(action=>action.result_ref_type==='TICKET');
    assert.ok(ticketAction);assert.equal(typeof ticketAction.result_ref_id,'string');const ticketId=String(ticketAction.result_ref_id);
    const staff=await t11Http(context),started=await staff.start(ticketId);
    assert.equal((await staff.post(ticketId,'complete',staff.command(started))).status,200);
    const completed=await staff.detail(ticketId);assert.equal(completed.status,'CLOSED');
    assert.equal(completed.intake_id,first.intakeId);assert.ok(completed.handling_cycle?.staff_completion_event_id);
    const readJourney=async()=>{
      const response=await staff.get('/api/contact-journeys/'+journeyId);assert.equal(response.status,200);
      return t21Object(await response.json());
    };
    const originalJourney=await readJourney();assert.equal(originalJourney.linked_ticket_id,ticketId);
    assert.equal(originalJourney.origin_intake_id,first.intakeId);
    for(const text of ['补充：错误提示为403。','谢谢']){
      const next=await accept(text);
      assert.equal(next.intakeId,first.intakeId,'ordinary message must use the genuine open Session/source association');
      assert.equal(t21Object(next.result.aggregation).action,'APPENDED');
      assert.equal(t21Object(next.result.message).relation_type,'SUPPLEMENT');
      assert.equal(t21Object(next.evaluated.journey).id,journeyId);
      const journey=await readJourney();assert.equal(journey.id,journeyId);assert.equal(journey.linked_ticket_id,ticketId);
      const current=await staff.detail(ticketId);
      assert.equal(current.status,'CLOSED');assert.equal(current.version,completed.version);
      assert.equal(current.ticket_no,completed.ticket_no);assert.equal(current.assignee_id,completed.assignee_id);
      assert.deepEqual(current.handling_cycle,completed.handling_cycle);assert.equal(current.reopen_follow_up,undefined);
    }
    // Public message/Journey outcomes establish association; public staff detail
    // establishes no implicit reopen. No private SQL state/count assertion.
  });
});
