import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { G1RuntimeOptions, G1RuntimeExtension, G1AuthenticationPort } from './p2-g1-runtime.mjs';
import type { ReporterHttpHandler } from './p2-016-reporter-http.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
import type { StaffDirectoryStore } from './p2-007-staff-directory-store.mjs';
import type { OrchestrationWorkerOptions } from './p2-016-orchestration-adapters.mjs';
import type { P2015Worker } from './p2-015-worker.mjs';
import type { TicketActionAfterHook, PublicTicketEvent } from './p1-006-ticket-state-actions.mjs';

type RealtimeProjector = ReturnType<typeof createP2016RealtimeProjector>;
type Notifications = ReturnType<typeof createP2016TicketNotificationProjector>;
type TicketFacade = ReturnType<typeof createP2016TicketCommandFacade>;
type ReviewFacade = ReturnType<typeof createP2016ManualReviewFacade>;
type IncidentReporterAdapter = NonNullable<Parameters<typeof createP2016ReporterTimeline>[0]>['incidentAdapter'];
export interface P2016IncidentExtension extends G1RuntimeExtension { ready(): boolean | Promise<boolean>; reporterAdapter?: IncidentReporterAdapter }
export interface P2016HttpExtension { handler: ReporterHttpHandler; close(): unknown | Promise<unknown> }
type WebOAuthPort = import('./p2-g2-wecom-web-oauth.mjs').WeComOAuth;
export interface P2016ClosurePort extends Pick<ReturnType<typeof createTicketClosureService>, 'runAutoClose' | 'runAutoCloseReminders'> { afterTicketAction: TicketActionAfterHook }
export type ClosureNotificationInput = { transaction: PostgresTransaction; ticket: { id: string; intake_id?: string; source_intake_id?: string }; event: Pick<PublicTicketEvent, 'event_id' | 'event_type' | 'aggregate_version' | 'old_status' | 'new_status'> };
export type P2016ClosureOptions = Omit<NonNullable<Parameters<typeof createTicketClosureService>[0]>, 'beforeTransaction' | 'outbox'> & { beforeTransaction?: (transaction: PostgresTransaction) => Promise<unknown>; outbox: { enqueueTicketEvent(input: ClosureNotificationInput): Promise<unknown> } };
export type P2016ClosureFactory = (options: P2016ClosureOptions) => P2016ClosurePort;
interface P2016RuntimeOptionsInput extends Omit<G1RuntimeOptions, 'pool' | 'publicOrigin' | 'allowedTargetHashes'> { pool: PostgresPool; publicOrigin: string; flags?: unknown; reporterHmacSecret?: string; reporterOrigin?: string; allowedHosts?: readonly string[]; allowedTargetHashes?: readonly string[]; allowLocalHttp?: boolean; liveApproval?: { live?: boolean; scope?: boolean; send?: boolean } | null; inboundScope?: unknown; orchestrationWorker?: Pick<P2015Worker, 'processDueBatch'> | null; identityHmacKey?: string; directoryPort?: OrchestrationWorkerOptions['directoryPort']; directorySource?: string; directoryStore?: Pick<StaffDirectoryStore, 'findByReporterHash'> | null; directorySourceScope?: string; directorySyncJob?: OrchestrationWorkerOptions['directorySyncJob']; ruleEngine?: OrchestrationWorkerOptions['ruleEngine']; ruleFirstFlags?: unknown; ticketNotificationAdditionalEvents?: readonly string[]; incidentExtensionFactory?: ((input: { pool: PostgresPool; realtime: Parameters<NonNullable<G1RuntimeOptions['extensionFactory']>>[0]['realtime']; query: P2016TicketQuery }) => P2016IncidentExtension) | null; personDestinationAuthorizer?: OrchestrationWorkerOptions['personDestinationAuthorizer']; communicationAppend?: OrchestrationWorkerOptions['communicationAppend']; wecomWebOAuth?: { enabled?: boolean; [key: string]: unknown }; reporterPolicy?: 'LEGACY_BOUND_GRANT' | 'MEMBER_REQUIRED'; reporterMemberEntry?: unknown; identityMapping?: unknown; yxxSelfService?: { featureFlags?: unknown; quota?: unknown } | null; limitedRequestGuard?: G1RuntimeExtension['unauthenticatedHandler'] | null; workbenchAuthentication?: (G1AuthenticationPort & { mappingDigest?: () => unknown; unauthenticatedHandler?: G1RuntimeExtension['unauthenticatedHandler'] }) | null }
export type P2016RuntimeOptions = { [K in keyof P2016RuntimeOptionsInput]: {} extends Pick<P2016RuntimeOptionsInput, K> ? P2016RuntimeOptionsInput[K] | undefined : P2016RuntimeOptionsInput[K] };
export type P2016EnabledRuntime = ReturnType<typeof createP2G1Runtime> & { query: P2016TicketQuery; tickets: TicketFacade; reviews: ReviewFacade; reporterAccess: ReturnType<typeof createP2016ReporterAccess>; notifications: Notifications; realtimeProjector: RealtimeProjector; orchestrationWorker: Pick<P2015Worker, 'processDueBatch'> | null; incidentExtension: P2016IncidentExtension | null; selfService: P2016HttpExtension | null; runAutoClose: () => ReturnType<P2016ClosurePort['runAutoClose']>; runAutoCloseReminders: () => ReturnType<P2016ClosurePort['runAutoCloseReminders']> };
export interface P2016DisabledRuntime { disabled: true; start(): Promise<{ disabled: boolean }>; stop(): Promise<{ stopped: boolean; disabled: boolean }> }
type OptionalExtensionInput = { pool: PostgresPool; oauth: WebOAuthPort; publicOrigin: string; reporterHmacSecret: string | undefined; reporterMemberEntry: unknown; identityMapping: unknown; access?: ReturnType<typeof createP2016ReporterAccess>; incidentAdapter?: IncidentReporterAdapter; profile?: 'FULL_SERVICE_LOOP'; featureFlags?: unknown; quota?: unknown };
type OptionalExtensionFactory = (input: OptionalExtensionInput) => P2016HttpExtension;
import { createP2G1Runtime } from './p2-g1-runtime.mjs';
import { createChannelMessageInbox } from './p1-003-channel-message-inbox.mjs';
import { createP2016DirectIntakeProcessor, P2016_DIRECT_IDLE_TIMEOUT_MS } from './p2-016-direct-intake.mjs';
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
import { appendP2016Realtime,lockP2016Realtime } from './p2-016-realtime-appender.mjs';
import { createP2016OrchestrationWorker } from './p2-016-orchestration-adapters.mjs';
import { normalizeP2015FeatureFlags } from './p2-015-domain-contracts.mjs';
import { createP2016InboundScope } from './p2-016-inbound-scope.mjs';
import { createWeComWebOAuth } from './p2-g2-wecom-web-oauth.mjs';
import { createWeComOAuthHttp } from './p2-g2-wecom-oauth-http.mjs';
import {createYxxMemberExtension} from './p2-g2-yixiaoxiu-server.mjs';
import {reporterAccessPolicy,validateYxxEntryConfig,failYxx} from './p2-g2-yixiaoxiu-contract.mjs';
import {createYxxSelfServiceExtension} from './yxx-self-service-runtime.mjs';
import { staffDirectorySchemaReady } from './p2-007-third-party-staff-directory.mjs';

// Explicit composition of the existing Workbench/API/SSE and Communication worker, not a second server.
export function createP2016Runtime(options: P2016RuntimeOptions & { flags: { TICKET_LIFECYCLE_WORKBENCH_ENABLED: true } }): P2016EnabledRuntime;
export function createP2016Runtime(options?: P2016RuntimeOptions): P2016EnabledRuntime | P2016DisabledRuntime;
export function createP2016Runtime({pool,flags={},principalId,principalIds=null,publicOrigin,listenPort=0,
  reporterHmacSecret,reporterOrigin=publicOrigin,allowedHosts=[],allowedTargetHashes=[],allowLocalHttp=false,
  gatewayEnabled=false,senderEnabled=false,liveApproval=null,inboundScope=null,botId,secret,wsUrl,clientFactory,
  senderAdapter=null,orchestrationWorker=null,identityHmacKey,directoryPort,directorySource='WECOM_DIRECTORY',directoryStore=null,directorySourceScope='FORMAL',directorySyncJob=null,ruleEngine,ruleFirstFlags={},ticketNotificationAdditionalEvents=[],testAuthTtlMs=900000,closePoolOnStop=false,
  gatewayStatusProvider=null,communicationStatusProvider=null,requireGateway=gatewayEnabled,incidentExtensionFactory=null,personDestinationAuthorizer=null,communicationAppend,wecomWebOAuth={},
  reporterPolicy='LEGACY_BOUND_GRANT',reporterMemberEntry={},identityMapping=null,yxxSelfService=null,limitedRequestGuard=null,
  workbenchAuthentication=null,externalSendEnabled=true}: P2016RuntimeOptions={} as P2016RuntimeOptions): P2016EnabledRuntime | P2016DisabledRuntime {
  const featureFlags=flagsP2016(flags) as Record<'TICKET_LIFECYCLE_WORKBENCH_ENABLED' | 'REPORTER_TIMELINE_ENABLED' | 'WECOM_TEMPLATE_CARD_ENABLED', boolean>,enabled=featureFlags.TICKET_LIFECYCLE_WORKBENCH_ENABLED;
  const policy=reporterAccessPolicy(reporterPolicy) as 'LEGACY_BOUND_GRANT' | 'MEMBER_REQUIRED',memberConfig=validateYxxEntryConfig(reporterMemberEntry as Record<string, unknown>);
  if(policy==='MEMBER_REQUIRED'&&(!memberConfig.enabled||wecomWebOAuth.enabled!==true||!featureFlags.REPORTER_TIMELINE_ENABLED))failYxx('CONFIG_INVALID');
  if(memberConfig.enabled&&policy!=='MEMBER_REQUIRED')failYxx('CONFIG_INVALID');
  if(yxxSelfService!==null&&policy!=='MEMBER_REQUIRED')failYxx('CONFIG_INVALID');
  if(!enabled)return Object.freeze({disabled:true as const,start:async()=>({disabled:true}),stop:async()=>({stopped:true,disabled:true})});
  if((gatewayEnabled||senderEnabled)&&!(liveApproval?.live===true&&liveApproval?.scope===true&&liveApproval?.send===true))failP2016('LIVE_APPROVAL_REQUIRED',403);
  const scope=gatewayEnabled?createP2016InboundScope(inboundScope):null;
  if(scope&&((inboundScope as { bot_id?: unknown }).bot_id!==botId||scope.allowed_target_hashes.some(h=>!allowedTargetHashes.includes(h))||allowedTargetHashes.some(h=>!scope.allowed_target_hashes.includes(h))))failP2016('LIVE_SCOPE_REQUIRED',403);
  if(featureFlags.WECOM_TEMPLATE_CARD_ENABLED&&!featureFlags.REPORTER_TIMELINE_ENABLED)failP2016('REPORTER_REQUIRED_FOR_CARD',503);
  const access=createP2016ReporterAccess({pool,enabled:featureFlags.REPORTER_TIMELINE_ENABLED,hmacSecret:reporterHmacSecret as string});
  const webOAuth: WebOAuthPort=(createWeComWebOAuth as typeof createWeComWebOAuth & ((input: Record<string, unknown>) => WebOAuthPort))({...wecomWebOAuth,publicOrigin:reporterOrigin});
  const oauthHttp: ReporterHttpHandler=createWeComOAuthHttp({oauth:webOAuth,publicOrigin:reporterOrigin});
  const notifications=createP2016TicketNotificationProjector({enabled,cardEnabled:featureFlags.WECOM_TEMPLATE_CARD_ENABLED,reporterAccess:access,explicitReferenceEnabled:featureFlags.REPORTER_TIMELINE_ENABLED,personDestinationAuthorizer,communicationAppend,additionalEventTypes:ticketNotificationAdditionalEvents});
  const query=createP2016TicketQuery({pool,enabled,directoryStore,directorySourceScope});
  const ruleFlags=normalizeP2015FeatureFlags(ruleFirstFlags);
  const inbox=createChannelMessageInbox({pool}),intakeProcessor=createP2016DirectIntakeProcessor({idleTimeoutMs:P2016_DIRECT_IDLE_TIMEOUT_MS});
  // A message is durably accepted before deterministic evaluation. Failed evaluation is recoverable from the Inbox/Intake.
  const operationalIntake=Object.freeze({accept:(input: unknown)=>scope&&!scope.accepts((input as { message?: unknown } | null)?.message)
    ?Promise.resolve({ok:false as const,error:{code:'P2_016_INBOUND_SCOPE_REJECTED',retryable:false as const}}):inbox.accept(input,intakeProcessor)});
  let realtimeProjector: RealtimeProjector | undefined,tickets: TicketFacade | undefined,reviews: ReviewFacade | undefined,closure: P2016ClosurePort | undefined,incidentExtension: P2016IncidentExtension | null=null,memberExtension: P2016HttpExtension | null=null,selfService: P2016HttpExtension | null=null;
  const runtime=createP2G1Runtime({pool,operationalIntake,principalId,principalIds,publicOrigin,listenPort,
    botId,secret,wsUrl,allowedTargetHashes,gatewayEnabled,senderEnabled,senderAdapter,clientFactory,testAuthTtlMs,
    authentication:workbenchAuthentication,externalSendEnabled,
    projectionIntervalMs:1000,communicationIntervalMs:1000,closePoolOnStop,gatewayStatusProvider,communicationStatusProvider,requireGateway,
    realtimeAppender:appendP2016Realtime,
    projectionTransactionStart:({transaction})=>lockP2016Realtime(transaction),
    realtimeScopeLimit:256,
    senderFactory:({gateway})=>createP2016WeComSender({gateway,enabled:senderEnabled,cardEnabled:featureFlags.WECOM_TEMPLATE_CARD_ENABLED,
      reporterAccess:access,origin:reporterOrigin,allowedHosts,allowedTargetHashes,allowLocalHttp,linkMode:policy}),
    extensionFactory:({controlService,realtime})=>{
      realtimeProjector=createP2016RealtimeProjector({pool,enabled,wakeup:realtime.wakeup});
      if(yxxSelfService===null&&!orchestrationWorker&&(directorySyncJob||ruleFlags.rule_first_orchestration_enabled&&ruleFlags.manual_review_queue_enabled))
        orchestrationWorker=createP2016OrchestrationWorker({pool,identityHmacKey:identityHmacKey as string,directoryPort,directorySource,directorySyncJob,ruleEngine,notifications,realtime:realtimeProjector,personDestinationAuthorizer,communicationAppend});
      closure=(createTicketClosureService as typeof createTicketClosureService & P2016ClosureFactory)({pool,beforeTransaction:realtimeProjector.lock,resolveReporterActor:async()=>null,outbox:{enqueueTicketEvent:async (input: ClosureNotificationInput)=>{
        const n=await notifications.project(input);await (realtimeProjector as RealtimeProjector).ticket(input);return {...n,delivery_ids:n.delivery_id?[n.delivery_id]:[]};
      }}});
      tickets=createP2016TicketCommandFacade({pool,enabled,query,controlService,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket});
      reviews=createP2016ManualReviewFacade({pool,enabled,query,notificationProjector:notifications,realtimeProjector,personDestinationAuthorizer,communicationAppend});
      const deliveryControl=createP2016DeliveryControl({pool,query,enabled,externalSendEnabled});
      incidentExtension=incidentExtensionFactory?.({pool,realtime,query})??null;
      const ticketHttp=createP2016WorkbenchHttp({query,tickets,reviews,deliveryControl,enabled});
      const ticketStatic=createP2016WorkbenchStatic({enabled,conversationEnabled:true});
      if(policy==='MEMBER_REQUIRED')memberExtension=(createYxxMemberExtension as typeof createYxxMemberExtension & OptionalExtensionFactory)({pool,oauth:webOAuth,publicOrigin:reporterOrigin,
        reporterHmacSecret,reporterMemberEntry:memberConfig,identityMapping,access,incidentAdapter:incidentExtension?.reporterAdapter??null});
      if(yxxSelfService!==null)selfService=(createYxxSelfServiceExtension as typeof createYxxSelfServiceExtension & OptionalExtensionFactory)({pool,oauth:webOAuth,publicOrigin:reporterOrigin,
        reporterHmacSecret,reporterMemberEntry:memberConfig,identityMapping,profile:'FULL_SERVICE_LOOP',featureFlags:yxxSelfService.featureFlags??{},quota:yxxSelfService.quota});
      const reporterHttp=createP2016ReporterHttp({access,timeline:createP2016ReporterTimeline({pool,access,enabled:featureFlags.REPORTER_TIMELINE_ENABLED,incidentAdapter:incidentExtension?.reporterAdapter??null}),
        enabled:featureFlags.REPORTER_TIMELINE_ENABLED,publicOrigin:reporterOrigin,allowLocalHttp,accessPolicy:policy,memberHandler:memberExtension?.handler as ReporterHttpHandler | null});
      return {
        readiness:async base=>{
          let schema=false;try{schema=(await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='031_p2_016_ticket_lifecycle_workbench_notifications'")).rowCount===1;}catch{/* dependency stays not ready */}
          let workbenchAuthSchema=true;
          if(workbenchAuthentication){
            try{workbenchAuthSchema=(await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='035_p2_016_workbench_wecom_auth'")).rowCount===1
              &&typeof workbenchAuthentication.mappingDigest==='function'&&Boolean(workbenchAuthentication.mappingDigest());}
            catch{workbenchAuthSchema=false;}
          }
          const incidentReady=incidentExtension?await incidentExtension.ready():true;
          let selfServiceSchema=true;
          if(selfService){
            try{selfServiceSchema=(await pool.query(`SELECT migration_id FROM platform.schema_migration
              WHERE migration_id IN ('033_yxx_self_service_intake','034_yxx_self_service_direct_chat_check')`)).rowCount===2;}
            catch{selfServiceSchema=false;}
          }
          const directorySchema=!directoryStore||await staffDirectorySchemaReady(pool);
          const ready=base.ok&&schema&&workbenchAuthSchema&&incidentReady&&selfServiceSchema&&directorySchema;
          return {ok:ready,base_service_ready:ready,ai_enhancement_ready:false,ai_enabled:false,
            checks:{...base.checks,p2_016_schema:schema,workbench_wecom_auth:workbenchAuthSchema,...(directoryStore?{third_staff_directory_schema:directorySchema}:{}),...(selfService?{yxx_self_service_schema:selfServiceSchema}:{})},scope:'INTERNAL_BETA_NOT_PHASE2_GO'};
        },
        authenticatedHandler:async context=>(await incidentExtension?.authenticatedHandler?.(context))||ticketHttp(context),
        unauthenticatedHandler:async context=>(await workbenchAuthentication?.unauthenticatedHandler?.(context))
          ||(await limitedRequestGuard?.(context))||(await selfService?.handler(context))
          ||(policy==='MEMBER_REQUIRED'?reporterHttp(context):(await oauthHttp(context))||reporterHttp(context)),
        staticHandler:async(pathname,response)=>(await incidentExtension?.staticHandler?.(pathname,response))||ticketStatic(pathname,response),
        runOnce:async()=>{if(orchestrationWorker)await orchestrationWorker.processDueBatch({feature_flags:ruleFirstFlags,batch_size:20});await (realtimeProjector as RealtimeProjector).runOnce();await incidentExtension?.runOnce?.();},
      };
    },
  });
  const systemActions=createTicketActionService({pool,authorize:async({actor,action})=>actor.type==='SYSTEM'&&action==='auto-close',afterAction:(closure as P2016ClosurePort).afterTicketAction});
  return Object.freeze({...runtime,query,tickets:tickets as TicketFacade,reviews:reviews as ReviewFacade,reporterAccess:access,notifications,realtimeProjector:realtimeProjector as RealtimeProjector,orchestrationWorker,incidentExtension,
    selfService,
    stop:async()=>{await selfService?.close();memberExtension?.close();(webOAuth as {close?:()=>void}).close?.();return runtime.stop();},
    // Explicit system job, never exposed as an HTTP/User/Reporter action. Scheduling belongs to the approved worker role.
    runAutoClose:async()=>(closure as P2016ClosurePort).runAutoClose({actionService:systemActions,limit:20}),
    runAutoCloseReminders:async()=>(closure as P2016ClosurePort).runAutoCloseReminders({limit:20})});
}
