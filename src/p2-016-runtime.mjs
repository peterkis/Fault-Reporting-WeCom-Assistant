import { createP2G1Runtime } from './p2-g1-runtime.mjs';
import { createChannelMessageInbox } from './p1-003-channel-message-inbox.mjs';
import { createServiceIntakeProcessor } from './p1-004-service-intake.mjs';
import { createTicketClosureService } from './p1-010-ticket-closure.mjs';
import { createTicketActionService } from './p1-006-ticket-state-actions.mjs';
import { createP2016ReporterAccess } from './p2-016-reporter-access.mjs';
import { createP2016ReporterTimeline } from './p2-016-reporter-timeline.mjs';
import { createP2016ReporterHttp } from './p2-016-reporter-http.mjs';
import { createP2016WeComSender } from './p2-016-wecom-sender.mjs';
import { createP2016TicketQuery } from './p2-016-ticket-query.mjs';
import { createP2016TicketCommandFacade } from './p2-016-ticket-command-facade.mjs';
import { createP2016ManualReviewFacade } from './p2-016-manual-review-facade.mjs';
import { createP2016TicketNotificationProjector } from './p2-016-ticket-notification-projector.mjs';
import { createP2016RealtimeProjector } from './p2-016-realtime-projector.mjs';
import { createP2016DeliveryControl } from './p2-016-delivery-control.mjs';
import { createP2016WorkbenchHttp } from './p2-016-workbench-http.mjs';
import { createP2016WorkbenchStatic } from './p2-016-workbench-static.mjs';
import { flagsP2016,failP2016 } from './p2-016-domain-contracts.mjs';
import { appendP2016Realtime } from './p2-016-realtime-appender.mjs';
import { createP2016OrchestrationWorker } from './p2-016-orchestration-adapters.mjs';
import { normalizeP2015FeatureFlags } from './p2-015-domain-contracts.mjs';
import { createP2016InboundScope } from './p2-016-inbound-scope.mjs';

// Explicit composition of the existing Workbench/API/SSE and Communication worker, not a second server.
export function createP2016Runtime({pool,flags={},principalId,principalIds=null,publicOrigin,listenPort=0,
  reporterHmacSecret,reporterOrigin=publicOrigin,allowedHosts=[],allowedTargetHashes=[],allowLocalHttp=false,
  gatewayEnabled=false,senderEnabled=false,liveApproval=null,inboundScope=null,botId,secret,wsUrl,clientFactory,
  senderAdapter=null,orchestrationWorker=null,identityHmacKey,directoryPort,ruleEngine,ruleFirstFlags={},testAuthTtlMs=900000,closePoolOnStop=false,
  gatewayStatusProvider=null,communicationStatusProvider=null,requireGateway=gatewayEnabled,incidentExtensionFactory=null}={}) {
  const featureFlags=flagsP2016(flags),enabled=featureFlags.TICKET_LIFECYCLE_WORKBENCH_ENABLED;
  if(!enabled)return Object.freeze({disabled:true,start:async()=>({disabled:true}),stop:async()=>({stopped:true,disabled:true})});
  if((gatewayEnabled||senderEnabled)&&!(liveApproval?.live===true&&liveApproval?.scope===true&&liveApproval?.send===true))failP2016('LIVE_APPROVAL_REQUIRED',403);
  const scope=gatewayEnabled?createP2016InboundScope(inboundScope):null;
  if(scope&&(inboundScope.bot_id!==botId||scope.allowed_target_hashes.some(h=>!allowedTargetHashes.includes(h))||allowedTargetHashes.some(h=>!scope.allowed_target_hashes.includes(h))))failP2016('LIVE_SCOPE_REQUIRED',403);
  if(featureFlags.WECOM_TEMPLATE_CARD_ENABLED&&!featureFlags.REPORTER_TIMELINE_ENABLED)failP2016('REPORTER_REQUIRED_FOR_CARD',503);
  const access=createP2016ReporterAccess({pool,enabled:featureFlags.REPORTER_TIMELINE_ENABLED,hmacSecret:reporterHmacSecret});
  const notifications=createP2016TicketNotificationProjector({enabled,cardEnabled:featureFlags.WECOM_TEMPLATE_CARD_ENABLED,reporterAccess:access});
  const query=createP2016TicketQuery({pool,enabled});
  const ruleFlags=normalizeP2015FeatureFlags(ruleFirstFlags);
  const inbox=createChannelMessageInbox({pool}),intakeProcessor=createServiceIntakeProcessor();
  // A message is durably accepted before deterministic evaluation. Failed evaluation is recoverable from the Inbox/Intake.
  const operationalIntake=Object.freeze({accept:input=>scope&&!scope.accepts(input?.message)
    ?Promise.resolve({ok:false,error:{code:'P2_016_INBOUND_SCOPE_REJECTED',retryable:false}}):inbox.accept(input,intakeProcessor)});
  let realtimeProjector,tickets,reviews,closure,incidentExtension=null;
  const runtime=createP2G1Runtime({pool,operationalIntake,principalId,principalIds,publicOrigin,listenPort,
    botId,secret,wsUrl,allowedTargetHashes,gatewayEnabled,senderEnabled,senderAdapter,clientFactory,testAuthTtlMs,
    projectionIntervalMs:1000,communicationIntervalMs:1000,closePoolOnStop,gatewayStatusProvider,communicationStatusProvider,requireGateway,
    realtimeAppender:appendP2016Realtime,
    realtimeScopeLimit:256,
    senderFactory:({gateway})=>createP2016WeComSender({gateway,enabled:senderEnabled,cardEnabled:featureFlags.WECOM_TEMPLATE_CARD_ENABLED,
      reporterAccess:access,origin:reporterOrigin,allowedHosts,allowedTargetHashes,allowLocalHttp}),
    extensionFactory:({controlService,realtime})=>{
      realtimeProjector=createP2016RealtimeProjector({pool,enabled,wakeup:realtime.wakeup});
      if(!orchestrationWorker&&ruleFlags.rule_first_orchestration_enabled&&ruleFlags.manual_review_queue_enabled)
        orchestrationWorker=createP2016OrchestrationWorker({pool,identityHmacKey,directoryPort,ruleEngine,notifications,realtime:realtimeProjector});
      closure=createTicketClosureService({pool,beforeTransaction:realtimeProjector.lock,resolveReporterActor:async()=>null,outbox:{enqueueTicketEvent:async input=>{
        const n=await notifications.project(input);await realtimeProjector.ticket(input);return {...n,delivery_ids:n.delivery_id?[n.delivery_id]:[]};
      }}});
      tickets=createP2016TicketCommandFacade({pool,enabled,query,controlService,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket});
      reviews=createP2016ManualReviewFacade({pool,enabled,query,notificationProjector:notifications,realtimeProjector});
      const deliveryControl=createP2016DeliveryControl({pool,query,enabled});
      incidentExtension=incidentExtensionFactory?.({pool,realtime,query})??null;
      const ticketHttp=createP2016WorkbenchHttp({query,tickets,reviews,deliveryControl,enabled});
      const ticketStatic=createP2016WorkbenchStatic({enabled,conversationEnabled:true});
      return {
        readiness:async base=>{
          let schema=false;try{schema=(await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='031_p2_016_ticket_lifecycle_workbench_notifications'")).rowCount===1;}catch{/* dependency stays not ready */}
          const incidentReady=incidentExtension?await incidentExtension.ready():true;
          return {ok:base.ok&&schema&&incidentReady,base_service_ready:base.ok&&schema&&incidentReady,ai_enhancement_ready:false,ai_enabled:false,
            checks:{...base.checks,p2_016_schema:schema},scope:'INTERNAL_BETA_NOT_PHASE2_GO'};
        },
        authenticatedHandler:async context=>(await incidentExtension?.authenticatedHandler?.(context))||ticketHttp(context),
        unauthenticatedHandler:createP2016ReporterHttp({access,timeline:createP2016ReporterTimeline({pool,access,enabled:featureFlags.REPORTER_TIMELINE_ENABLED,incidentAdapter:incidentExtension?.reporterAdapter??null}),
          enabled:featureFlags.REPORTER_TIMELINE_ENABLED,publicOrigin:reporterOrigin,allowLocalHttp}),
        staticHandler:async(pathname,response)=>(await incidentExtension?.staticHandler?.(pathname,response))||ticketStatic(pathname,response),
        runOnce:async()=>{if(orchestrationWorker)await orchestrationWorker.processDueBatch({feature_flags:ruleFirstFlags,batch_size:20});await realtimeProjector.runOnce();await incidentExtension?.runOnce?.();},
      };
    },
  });
  const systemActions=createTicketActionService({pool,authorize:async({actor,action})=>actor.type==='SYSTEM'&&action==='auto-close',afterAction:closure.afterTicketAction});
  return Object.freeze({...runtime,query,tickets,reviews,reporterAccess:access,notifications,realtimeProjector,orchestrationWorker,incidentExtension,
    // Explicit system job, never exposed as an HTTP/User/Reporter action. Scheduling belongs to the approved worker role.
    runAutoClose:async()=>closure.runAutoClose({actionService:systemActions,limit:20}),
    runAutoCloseReminders:async()=>closure.runAutoCloseReminders({limit:20})});
}
