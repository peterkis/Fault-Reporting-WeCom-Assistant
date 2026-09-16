import { createRuleFirstOrchestrator } from './p2-015-rule-first-orchestrator.mjs';
import { createP2015Worker } from './p2-015-worker.mjs';
import { createDecisionStore } from './p2-015-decision-store.mjs';
import { createManualReviewStore } from './p2-015-manual-review.mjs';
import { createServiceIntakeDecisionPort } from './p2-015-service-intake-decision-port.mjs';
import { createSafeActionExecutor,createP2004FixedCommunicationPort } from './p2-015-safe-action-executor.mjs';
import { createPilotTicketCore } from './p1-005-pilot-ticket-core.mjs';
import { appendTicketEvent } from './p1-006-ticket-state-actions.mjs';
import { appendCommunication } from './p2-004-communication-core.mjs';
import { textHashP2016,failP2016 } from './p2-016-domain-contracts.mjs';
import { createP2016GuidedJourneyStore,p2016AssociationDecision,p2016TicketSourceIntake } from './p2-016-guided-journey.mjs';
import { reconcileP2016ConversationBindings } from './p2-016-conversation-binding.mjs';
import { createYxxSelfServiceOrchestrator } from './yxx-self-service-orchestrator.mjs';

function guidanceId(id){const h=textHashP2016('P2016_GUIDANCE:'+id);return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
export function createP2016OrchestrationWorker({pool,identityHmacKey,notifications,realtime,directoryPort,ruleEngine,now,personDestinationAuthorizer=null,communicationAppend=appendCommunication,yxxSelfService=null}){
  if(personDestinationAuthorizer!==null&&typeof personDestinationAuthorizer!=='function')failP2016();
  const core=createPilotTicketCore({pool}),decisions=createDecisionStore({sourceWindowScope:'CHANNEL_LEG'}),reviews=createManualReviewStore();
  const communicationPort={appendFixed:async({transaction,action,context})=>{
    const session=context.session_id?(await transaction.query('SELECT row_version::integer FROM conversation.session WHERE id=$1::uuid',[context.session_id])).rows[0]:null;
    const append=async input=>communicationAppend({...input,command:{...input.command,...(session?{expected_row_version:session.row_version}:{})}});
    if(context.destination?.target_type!=='GROUP'||action.action_type!=='REQUEST_ONE_DESCRIPTION')return createP2004FixedCommunicationPort({append}).appendFixed({transaction,action,context});
    const row=(await transaction.query(`SELECT i.source_bot_id,i.reporter_wecom_userid FROM intake.service_intake i
      JOIN intake.deterministic_decision d ON d.service_intake_id=i.id
      JOIN intake.safe_action_suggestion a ON a.decision_id=d.id WHERE a.id=$1::uuid`,[action.id])).rows[0];
    if(!row)failP2016('NOTIFICATION_BINDING_INVALID');
    const personAllowed=personDestinationAuthorizer===null||await personDestinationAuthorizer({transaction,bot_id:row.source_bot_id,reporter_user_id:row.reporter_wecom_userid})===true;
    const group=await createP2004FixedCommunicationPort({append}).appendFixed({transaction,action,context:{...context,fixed_text:'已收到您的消息。可直接在群里补充故障情况，也可选择机器人单聊。请勿在群内提供患者、账号或联系方式等敏感信息。'}});
    if(personAllowed)await createP2004FixedCommunicationPort({append}).appendFixed({transaction,action:{...action,id:guidanceId(action.id)},context:{...context,
      destination:{provider:'WECOM_AIBOT',channel_account_id:row.source_bot_id,target_type:'PERSON',target_id:row.reporter_wecom_userid}}});
    return group;
  }};
  const executor=createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),decisionStore:decisions,communicationPort,
    manualReviewStore:{enqueue:async input=>{const review=await reviews.enqueue(input);await realtime.review({transaction:input.transaction,reviewId:review.id});return review;}},
    ticketCommandPort:{createMinimalTicket:async({transaction,intake_id,occurred_at,trace_id})=>{
      const intakeId=await p2016TicketSourceIntake({transaction,intakeId:intake_id});
      const result=await core.createForIntakeInTransaction({transaction,intakeId,occurredAt:occurred_at,traceId:trace_id});
      if(result.created){const event=await appendTicketEvent({transaction,ticket:result.ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:trace_id});
        await notifications.project({transaction,ticket:result.ticket,event});await realtime.ticket({transaction,ticket:result.ticket,event});}
      return result;
    }},
  });
  const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey,safeActionExecutor:executor,decisionStore:decisions,
    journeyStore:createP2016GuidedJourneyStore({now}),decisionOverride:p2016AssociationDecision,
    ...(directoryPort?{directoryPort}:{}),...(ruleEngine?{ruleEngine}:{})});
  // Scheduling cursor only: restart may rescan, but never invents or owns facts.
  let bindingCursor=null;
  const webOrchestrator=yxxSelfService===null?null:createYxxSelfServiceOrchestrator({pool,profile:'FULL_SERVICE_LOOP',ruleEngine,
    featureFlags:yxxSelfService.featureFlags??{YIXIAOXIU_SELF_SERVICE_ENABLED:false,YIXIAOXIU_MY_REPORTS_ENABLED:false}});
  return createP2015Worker({pool,orchestrator,webOrchestrator,beforeClaim:realtime.lock,afterBatch:async()=>{
    const scan=await reconcileP2016ConversationBindings({pool,identityHmacKey,beforeTransaction:realtime.lock,afterLegId:bindingCursor});
    bindingCursor=scan.scan_exhausted?null:scan.last_examined_id;
  }});
}
