import {createWorkbenchReviewStart} from './workbench-review-start.mjs';
import {createWorkbenchSupplementFollowUp,createWorkbenchSupplementFollowUpHttp} from './workbench-supplement-follow-up.mjs';
import {createHash} from 'node:crypto';
import {createWorkbenchActivity} from './workbench-activity.mjs';
import {createWorkbenchActivityHttp} from './workbench-activity-http.mjs';
import type {WorkbenchActivityField,WorkbenchActivityTarget} from '../contracts/workbench_activity_contracts.js';
import {createWorkbenchFollow} from './workbench-follow.mjs';
import {createTicketTakeoverCompletionService} from './workbench-ticket-takeover-completion.mjs';
import {createTicketTakeoverService} from './workbench-ticket-takeover.mjs';
import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { G1RuntimeOptions, G1RuntimeExtension, G1AuthenticationPort } from './p2-g1-runtime.mjs';
import type { ReporterHttpHandler } from './p2-016-reporter-http.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
import type { StaffDirectoryStore } from './p2-007-staff-directory-store.mjs';
import type { OrchestrationWorkerOptions } from './p2-016-orchestration-adapters.mjs';
import type { P2015Worker } from './p2-015-worker.mjs';
import type {ServiceCatalog} from './p2-007-service-catalog.mjs';
import type { TicketActionAfterHook, PublicTicketEvent } from './p1-006-ticket-state-actions.mjs';
import { createWeb01WorkbenchQuery } from './web01-workbench-query.mjs';
import { createWeb01WorkbenchHttp } from './web01-workbench-http.mjs';
import { createWeb01WorkbenchStatic } from './web01-workbench-static.mjs';
import {createWorkbenchSourceGroups} from './workbench-source-groups.mjs';
import {createTicketSelfHandlingService,selfHandlingSchemaReady} from './workbench-ticket-self-handling.mjs';
import {createTicketConversationHandlingService} from './workbench-ticket-conversation-handling.mjs';
import {createTicketAssignmentService} from './workbench-ticket-assignment.mjs';
import {createTicketUnassignService,unassignSchemaReady} from './workbench-ticket-unassign.mjs';
import {createTicketReturnToDispatchService,returnToDispatchSchemaReady} from './workbench-ticket-return-to-dispatch.mjs';
import {createTicketStaffCompletionService,staffCompletionSchemaReady} from './workbench-ticket-completion.mjs';
import {createTicketRoundNotifications,roundNotificationSchemaReady} from './workbench-ticket-round-notifications.mjs';
import {normalizeAppNotificationOptions} from './workbench-app-notification-target.mjs';
import type {TicketAppNotificationOptions} from '../contracts/workbench_app_notification_contracts.js';
import type {WorkbenchAppNotificationSenderOptions} from './workbench-app-notification-sender.mjs';
import {reopenRoundsSchemaReady} from './ticket-reopen-rounds.mjs';
import {createWorkbenchAttachments} from './workbench-attachments.mjs';
import type {AttachmentStore} from '../contracts/workbench_attachment_contracts.js';
import {createWorkbenchConversations} from './workbench-conversations.mjs';
import {createWorkbenchNotificationExceptions} from './workbench-notification-exceptions.mjs';
import type {NotificationExceptionIncidentScopePort} from './workbench-notification-exceptions.mjs';
import {createWorkbenchPersonalRead,createWorkbenchPersonalReadHttp} from './workbench-personal-read.mjs';
import {createWorkbenchManualReports,manualReportsSchemaReady} from './workbench-manual-reports.mjs';
import type {ManualReporterDirectoryOptions} from '../contracts/workbench_reporter_candidates_contracts.js';
import {createWorkbenchFollowUpSchedules} from './workbench-follow-up-schedules.mjs';
import {followUpDueSchemaReady} from '../scripts/workbench-follow-up-due-migrate.mjs';
interface P2016RuntimeOptionsInput {workbenchActivityEnabled?:boolean}
interface P2016RuntimeOptionsInput {notificationExceptionsEnabled?:boolean;workbenchAssignmentHistoryEnabled?:boolean;workbenchPersonalReadEnabled?:boolean;workbenchFollowUpSchedulesEnabled?:boolean;groupRoundNotifications?:Omit<WorkbenchGroupNotificationOptions,'pool'|'enabled'>|null}
interface P2016RuntimeOptionsInput {appNotifications?:TicketAppNotificationOptions|null;appNotificationTransport?:Omit<WorkbenchAppNotificationSenderOptions,'pool'|'notifications'|'enabled'|'origin'|'allowedHosts'|'allowLocalHttp'>|null}
interface P2016RuntimeOptionsInput { workbenchFollowEnabled?:boolean;ticketRoundNotificationsEnabled?:boolean;ticketReopenRoundsEnabled?:boolean;ticketReturnToDispatchEnabled?:boolean;ticketUnassignEnabled?:boolean;ticketAssignmentEnabled?:boolean;ticketTakeoverEnabled?:boolean;ticketTakeoverCompletionEnabled?:boolean;ticketWaitingActionsEnabled?:boolean;ticketStaffCompletionEnabled?:boolean;workbenchConversationsEnabled?:boolean;workbenchManualReportsEnabled?:boolean;workbenchReporterCandidatesEnabled?:boolean;manualReporterDirectory?:ManualReporterDirectoryOptions|null;workbenchRealtimeEnabled?:boolean;workbenchManualReviewEnabled?:boolean;ticketSelfHandlingEnabled?:boolean;ticketConversationSelfHandlingEnabled?:boolean;sourceGroupDirectoryEnabled?:boolean;workbenchInternalNotesEnabled?:boolean;workbenchDraftRecoveryEnabled?:boolean;workbenchAttachmentsEnabled?:boolean;attachmentStore?:AttachmentStore|null }

interface P2016RuntimeOptionsInput {workbenchReviewResolveAndStartEnabled?:boolean;workbenchBoardActionsEnabled?:boolean}

type RealtimeProjector = ReturnType<typeof createP2016RealtimeProjector>;
type Notifications = ReturnType<typeof createP2016TicketNotificationProjector>;
type TicketFacade = ReturnType<typeof createP2016TicketCommandFacade>;
type ReviewFacade = ReturnType<typeof createP2016ManualReviewFacade>;
type IncidentReporterAdapter = NonNullable<Parameters<typeof createP2016ReporterTimeline>[0]>['incidentAdapter'];
export interface P2016IncidentExtension extends G1RuntimeExtension {deliveryControlEnabled?:boolean; notificationExceptionScope?:NotificationExceptionIncidentScopePort; ready(): boolean | Promise<boolean>; reporterAdapter?: IncidentReporterAdapter;candidateWorkspaceEnabled?:boolean;internalNotesEnabled?:boolean;publicProgressEnabled?:boolean;ownerTransferEnabled?:boolean }
export interface P2016HttpExtension { handler: ReporterHttpHandler; close(): unknown | Promise<unknown> }
type WebOAuthPort = import('./p2-g2-wecom-web-oauth.mjs').WeComOAuth;
export interface P2016ClosurePort extends Pick<ReturnType<typeof createTicketClosureService>, 'runAutoClose' | 'runAutoCloseReminders'> { afterTicketAction: TicketActionAfterHook }
export type ClosureNotificationInput = { transaction: PostgresTransaction; ticket: { id: string; intake_id?: string; source_intake_id?: string }; event: Pick<PublicTicketEvent, 'event_id' | 'event_type' | 'aggregate_version' | 'old_status' | 'new_status'> };
export type P2016ClosureOptions = Omit<NonNullable<Parameters<typeof createTicketClosureService>[0]>, 'beforeTransaction' | 'outbox'> & { beforeTransaction?: (transaction: PostgresTransaction) => Promise<unknown>; outbox: { enqueueTicketEvent(input: ClosureNotificationInput): Promise<unknown> } };
export type P2016ClosureFactory = (options: P2016ClosureOptions) => P2016ClosurePort;
interface P2016RuntimeOptionsInput extends Omit<G1RuntimeOptions, 'pool' | 'publicOrigin' | 'allowedTargetHashes'> { pool: PostgresPool; publicOrigin: string; workbenchSupplementFollowUpEnabled?:boolean; flags?: unknown; reporterHmacSecret?: string; reporterOrigin?: string; allowedHosts?: readonly string[]; allowedTargetHashes?: readonly string[]; allowLocalHttp?: boolean; liveApproval?: { live?: boolean; scope?: boolean; send?: boolean } | null; inboundScope?: unknown; orchestrationWorker?: Pick<P2015Worker, 'processDueBatch'> | null; identityHmacKey?: string; directoryPort?: OrchestrationWorkerOptions['directoryPort']; directorySource?: string; directoryStore?: Pick<StaffDirectoryStore, 'findByReporterHash'> | null; directorySourceScope?: string; directorySyncJob?: OrchestrationWorkerOptions['directorySyncJob']; ruleEngine?: OrchestrationWorkerOptions['ruleEngine']; serviceCatalog?: ServiceCatalog|null; ruleFirstFlags?: unknown; ticketNotificationAdditionalEvents?: readonly string[]; incidentExtensionFactory?: ((input: { pool: PostgresPool; realtime: Parameters<NonNullable<G1RuntimeOptions['extensionFactory']>>[0]['realtime']; query: P2016TicketQuery }) => P2016IncidentExtension) | null; personDestinationAuthorizer?: OrchestrationWorkerOptions['personDestinationAuthorizer']; communicationAppend?: OrchestrationWorkerOptions['communicationAppend']; wecomWebOAuth?: import('./p2-g2-wecom-web-oauth.mjs').WeComOAuthOptions; botReporterFeedbackEnabled?:boolean;botReporterFeedbackDraftRecoveryEnabled?:boolean; reporterPolicy?: 'LEGACY_BOUND_GRANT' | 'MEMBER_REQUIRED'; reporterMemberEntry?: unknown; identityMapping?: import('./p2-g2-yixiaoxiu-delegated-identity.mjs').YxxIdentityMapping | null; yxxSelfService?: { reporterFeedbackDraftRecoveryEnabled?:boolean;reporterFeedbackEnabled?:boolean; featureFlags?: Partial<import('./yxx-self-service-authorization.mjs').YxxMemberFlags>; quota?: import('./yxx-self-service-command.mjs').YxxQuota } | null; limitedRequestGuard?: G1RuntimeExtension['unauthenticatedHandler'] | null; workbenchAuthentication?: (G1AuthenticationPort & { supportsLogout?:boolean; mappingDigest?: () => unknown; unauthenticatedHandler?: G1RuntimeExtension['unauthenticatedHandler'] }) | null }
export type P2016RuntimeOptions = { [K in keyof P2016RuntimeOptionsInput]: {} extends Pick<P2016RuntimeOptionsInput, K> ? P2016RuntimeOptionsInput[K] | undefined : P2016RuntimeOptionsInput[K] };
export type P2016EnabledRuntime = ReturnType<typeof createP2G1Runtime> & { roundNotifications:ReturnType<typeof createTicketRoundNotifications>;runFollowUpDueBatch:ReturnType<typeof createWorkbenchFollowUpSchedules>['runDueBatch'];query: P2016TicketQuery; tickets: TicketFacade; reviews: ReviewFacade; reporterAccess: ReturnType<typeof createP2016ReporterAccess>; notifications: Notifications; realtimeProjector: RealtimeProjector; orchestrationWorker: Pick<P2015Worker, 'processDueBatch'> | null; incidentExtension: P2016IncidentExtension | null; selfService: P2016HttpExtension | null; runAutoClose: () => ReturnType<P2016ClosurePort['runAutoClose']>; runAutoCloseReminders: () => ReturnType<P2016ClosurePort['runAutoCloseReminders']> };
export interface P2016DisabledRuntime { disabled: true; start(): Promise<{ disabled: boolean }>; stop(): Promise<{ stopped: boolean; disabled: boolean }> }
import { createP2G1Runtime } from './p2-g1-runtime.mjs';
import { createChannelMessageInbox } from './p1-003-channel-message-inbox.mjs';
import { createP2016DirectIntakeProcessor, P2016_DIRECT_IDLE_TIMEOUT_MS } from './p2-016-direct-intake.mjs';
import { createTicketClosureService } from './p1-010-ticket-closure.mjs';
import { createTicketActionService } from './p1-006-ticket-state-actions.mjs';
import { createP2016ReporterAccess } from './p2-016-reporter-access.mjs';
import { createP2016ReporterTimeline } from './p2-016-reporter-timeline.mjs';
import { createP2016ReporterHttp } from './p2-016-reporter-http.mjs';
import { createP2016WeComSender } from './p2-016-wecom-sender.mjs';
import type {WorkbenchGroupNotificationOptions} from './workbench-group-notification-sender.mjs';
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
import {createYxxSelfServiceExtension,resolveYxxServiceCatalog} from './yxx-self-service-runtime.mjs';
import { staffDirectorySchemaReady } from './p2-007-third-party-staff-directory.mjs';
import {botFeedbackSchemaReady} from './bot-reporter-feedback.mjs';

// Explicit composition of the existing Workbench/API/SSE and Communication worker, not a second server.
export function createP2016Runtime(options: P2016RuntimeOptions & { flags: { TICKET_LIFECYCLE_WORKBENCH_ENABLED: true } }): P2016EnabledRuntime;
export function createP2016Runtime(options?: P2016RuntimeOptions): P2016EnabledRuntime | P2016DisabledRuntime;
export function createP2016Runtime({pool,flags={},principalId,principalIds=null,publicOrigin,listenPort=0,
  reporterHmacSecret,reporterOrigin=publicOrigin,allowedHosts=[],allowedTargetHashes=[],allowLocalHttp=false,
  gatewayEnabled=false,senderEnabled=false,liveApproval=null,inboundScope=null,botId,secret,wsUrl,clientFactory,groupRoundNotifications=null,appNotifications=null,appNotificationTransport=null,
  senderAdapter=null,deliveryAttemptAdmission=null,orchestrationWorker=null,identityHmacKey,directoryPort,directorySource='WECOM_DIRECTORY',directoryStore=null,directorySourceScope='FORMAL',directorySyncJob=null,ruleEngine,serviceCatalog,ruleFirstFlags={},ticketNotificationAdditionalEvents=[],testAuthTtlMs=900000,closePoolOnStop=false,
  gatewayStatusProvider=null,communicationStatusProvider=null,requireGateway=gatewayEnabled,incidentExtensionFactory=null,personDestinationAuthorizer=null,communicationAppend,wecomWebOAuth={},
  reporterPolicy='LEGACY_BOUND_GRANT',reporterMemberEntry={},identityMapping=null,yxxSelfService=null,limitedRequestGuard=null,botReporterFeedbackEnabled=false,botReporterFeedbackDraftRecoveryEnabled=false,
  workbenchBoardActionsEnabled=false,workbenchSupplementFollowUpEnabled=false,workbenchActivityEnabled=false,workbenchAuthentication=null,workbenchFollowEnabled=false,workbenchAssignmentHistoryEnabled=false,workbenchPersonalReadEnabled=false,workbenchFollowUpSchedulesEnabled=false,ticketRoundNotificationsEnabled=false,ticketReopenRoundsEnabled=false,ticketReturnToDispatchEnabled=false,ticketUnassignEnabled=false,ticketAssignmentEnabled=false,ticketTakeoverEnabled=false,ticketTakeoverCompletionEnabled=false,ticketWaitingActionsEnabled=false,workbenchRealtimeEnabled=false,workbenchManualReportsEnabled=false,workbenchReporterCandidatesEnabled=false,manualReporterDirectory=null,ticketStaffCompletionEnabled=false,workbenchManualReviewEnabled=false,workbenchReviewResolveAndStartEnabled=false,ticketSelfHandlingEnabled=false,ticketConversationSelfHandlingEnabled=false,sourceGroupDirectoryEnabled=false,workbenchInternalNotesEnabled=false,workbenchDraftRecoveryEnabled=false,workbenchAttachmentsEnabled=false,attachmentStore=null,workbenchConversationsEnabled=false,notificationExceptionsEnabled=false,externalSendEnabled=true}: P2016RuntimeOptions={} as P2016RuntimeOptions): P2016EnabledRuntime | P2016DisabledRuntime {
  if(typeof workbenchSupplementFollowUpEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof notificationExceptionsEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchPersonalReadEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchFollowUpSchedulesEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchAssignmentHistoryEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchBoardActionsEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchFollowEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketTakeoverEnabled!=='boolean'||typeof ticketTakeoverCompletionEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketAssignmentEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketWaitingActionsEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketRoundNotificationsEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchManualReportsEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchReporterCandidatesEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchActivityEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchRealtimeEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketConversationSelfHandlingEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketStaffCompletionEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketReturnToDispatchEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketUnassignEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketReopenRoundsEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof botReporterFeedbackEnabled!=='boolean'||typeof botReporterFeedbackDraftRecoveryEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchConversationsEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof ticketSelfHandlingEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof sourceGroupDirectoryEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchAttachmentsEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchInternalNotesEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchManualReviewEnabled!=='boolean'||typeof workbenchReviewResolveAndStartEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  if(typeof workbenchDraftRecoveryEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  const featureFlags=flagsP2016(flags) as Record<'TICKET_LIFECYCLE_WORKBENCH_ENABLED' | 'REPORTER_TIMELINE_ENABLED' | 'WECOM_TEMPLATE_CARD_ENABLED', boolean>,enabled=featureFlags.TICKET_LIFECYCLE_WORKBENCH_ENABLED;
  const policy=reporterAccessPolicy(reporterPolicy) as 'LEGACY_BOUND_GRANT' | 'MEMBER_REQUIRED',memberConfig=validateYxxEntryConfig(reporterMemberEntry as Record<string, unknown>);
  if(policy==='MEMBER_REQUIRED'&&(!memberConfig.enabled||wecomWebOAuth.enabled!==true||!featureFlags.REPORTER_TIMELINE_ENABLED))failYxx('CONFIG_INVALID');
  if(memberConfig.enabled&&policy!=='MEMBER_REQUIRED')failYxx('CONFIG_INVALID');
  if(yxxSelfService!==null&&policy!=='MEMBER_REQUIRED')failYxx('CONFIG_INVALID');
  if(botReporterFeedbackEnabled&&(policy!=='MEMBER_REQUIRED'||yxxSelfService===null))failYxx('CONFIG_INVALID');
  if(ticketRoundNotificationsEnabled&&(!ticketSelfHandlingEnabled||!ticketStaffCompletionEnabled||!featureFlags.WECOM_TEMPLATE_CARD_ENABLED||!featureFlags.REPORTER_TIMELINE_ENABLED||policy!=='MEMBER_REQUIRED'))failP2016('ROUND_NOTIFICATIONS_CONFIG_INVALID',503);
  const roundBotId=ticketRoundNotificationsEnabled?memberConfig.botId:'ROUND_DISABLED';
  if(typeof roundBotId!=='string'||!roundBotId||roundBotId.length>128)failP2016('ROUND_NOTIFICATIONS_CONFIG_INVALID',503);
  if(!enabled)return Object.freeze({disabled:true as const,start:async()=>({disabled:true}),stop:async()=>({stopped:true,disabled:true})});
  if((gatewayEnabled||senderEnabled)&&!(liveApproval?.live===true&&liveApproval?.scope===true&&liveApproval?.send===true))failP2016('LIVE_APPROVAL_REQUIRED',403);
  const app=normalizeAppNotificationOptions(appNotifications);
  const scope=gatewayEnabled?createP2016InboundScope(inboundScope):null;
  if(scope&&((inboundScope as { bot_id?: unknown }).bot_id!==botId||scope.allowed_target_hashes.some(h=>!allowedTargetHashes.includes(h))||allowedTargetHashes.some(h=>!scope.allowed_target_hashes.includes(h))))failP2016('LIVE_SCOPE_REQUIRED',403);
  if(featureFlags.WECOM_TEMPLATE_CARD_ENABLED&&!featureFlags.REPORTER_TIMELINE_ENABLED)failP2016('REPORTER_REQUIRED_FOR_CARD',503);
  const access=createP2016ReporterAccess({pool,enabled:featureFlags.REPORTER_TIMELINE_ENABLED,hmacSecret:reporterHmacSecret as string});
  const webOAuth: WebOAuthPort=(createWeComWebOAuth as typeof createWeComWebOAuth)({...wecomWebOAuth,publicOrigin:reporterOrigin});
  const oauthHttp: ReporterHttpHandler=createWeComOAuthHttp({oauth:webOAuth,publicOrigin:reporterOrigin});
  const notifications=createP2016TicketNotificationProjector({enabled,cardEnabled:featureFlags.WECOM_TEMPLATE_CARD_ENABLED,reporterAccess:access,explicitReferenceEnabled:featureFlags.REPORTER_TIMELINE_ENABLED,personDestinationAuthorizer,communicationAppend,additionalEventTypes:ticketNotificationAdditionalEvents,roundNotificationBotId:ticketRoundNotificationsEnabled?roundBotId:null});
  const roundNotifications=createTicketRoundNotifications({pool,enabled:ticketRoundNotificationsEnabled,botId:roundBotId,reporterAccess:access,personDestinationAuthorizer,communicationAppend,appNotifications:app});
  const query=createP2016TicketQuery({pool,enabled,workbenchAssignmentHistoryEnabled,ticketReopenRoundsEnabled,directoryStore,directorySourceScope,ticketSelfHandlingEnabled,ticketConversationSelfHandlingEnabled,ticketStaffCompletionEnabled,ticketAssignmentEnabled,ticketTakeoverEnabled,ticketTakeoverCompletionEnabled,ticketWaitingActionsEnabled,ticketUnassignEnabled,ticketReturnToDispatchEnabled,ticketRoundNotificationsEnabled});
  const ruleFlags=normalizeP2015FeatureFlags(ruleFirstFlags);
  const inbox=createChannelMessageInbox({pool}),intakeProcessor=createP2016DirectIntakeProcessor({idleTimeoutMs:P2016_DIRECT_IDLE_TIMEOUT_MS});
  // A message is durably accepted before deterministic evaluation. Failed evaluation is recoverable from the Inbox/Intake.
  const operationalIntake=Object.freeze({accept:(input: unknown)=>scope&&!scope.accepts((input as { message?: unknown } | null)?.message)
    ?Promise.resolve({ok:false as const,error:{code:'P2_016_INBOUND_SCOPE_REJECTED',retryable:false as const}}):inbox.accept(input,intakeProcessor)});
  let activity:ReturnType<typeof createWorkbenchActivity>|null=null;
  let attachments:ReturnType<typeof createWorkbenchAttachments>|null=null;
  let runFollowUpDueBatch:ReturnType<typeof createWorkbenchFollowUpSchedules>['runDueBatch']|undefined;
  let realtimeProjector: RealtimeProjector | undefined,tickets: TicketFacade | undefined,reviews: ReviewFacade | undefined,closure: P2016ClosurePort | undefined,incidentExtension: P2016IncidentExtension | null=null,memberExtension: P2016HttpExtension | null=null,selfService: P2016HttpExtension | null=null;
  const supplementFollowUp=createWorkbenchSupplementFollowUp({pool,query,enabled:workbenchSupplementFollowUpEnabled});
  const runtime:ReturnType<typeof createP2G1Runtime>=createP2G1Runtime({pool,operationalIntake,principalId,principalIds,publicOrigin,listenPort,
    botId,secret,wsUrl,allowedTargetHashes,gatewayEnabled,senderEnabled,senderAdapter,deliveryAttemptAdmission,clientFactory,testAuthTtlMs,
    authentication:workbenchAuthentication,externalSendEnabled,reporterPrivateReplies:workbenchConversationsEnabled,
    supplementReplyBindingFactory:authorization=>supplementFollowUp.replyBinding(authorization),
    projectionIntervalMs:1000,communicationIntervalMs:1000,closePoolOnStop,gatewayStatusProvider,communicationStatusProvider,requireGateway,
    realtimeAppender:appendP2016Realtime,
    projectionTransactionStart:({transaction})=>lockP2016Realtime(transaction),
    realtimeScopeLimit:256,
    realtimeAvailabilityFallback:workbenchRealtimeEnabled,realtimeFollowUpSchedulesEnabled:workbenchFollowUpSchedulesEnabled,
    senderFactory:({gateway})=>createP2016WeComSender({gateway,enabled:senderEnabled,cardEnabled:featureFlags.WECOM_TEMPLATE_CARD_ENABLED,
      reporterAccess:access,origin:reporterOrigin,allowedHosts,allowedTargetHashes,allowLocalHttp,linkMode:policy,...(groupRoundNotifications?{groupRoundNotifications:{...groupRoundNotifications,pool}}:{}),
      ...(app&&appNotificationTransport?{appRoundNotifications:{...appNotificationTransport,pool,notifications:{...app,enabled:app.enabled&&externalSendEnabled}}}:{})}),
    extensionFactory:({controlService,realtime,queryService,commandFacade,authorization})=>{
      realtimeProjector=createP2016RealtimeProjector({pool,enabled,wakeup:realtime.wakeup});
      const followUpSchedules=createWorkbenchFollowUpSchedules({pool,query,enabled:workbenchFollowUpSchedulesEnabled,realtimeProjector:realtimeProjector.ticket,wakeup:realtime.wakeup});
      runFollowUpDueBatch=followUpSchedules.runDueBatch;
      if(yxxSelfService===null&&!orchestrationWorker&&(directorySyncJob||ruleFlags.rule_first_orchestration_enabled&&ruleFlags.manual_review_queue_enabled))
        orchestrationWorker=createP2016OrchestrationWorker({pool,identityHmacKey:identityHmacKey as string,directoryPort,directorySource,directorySyncJob,ruleEngine,notifications,realtime:realtimeProjector,personDestinationAuthorizer,communicationAppend});
      closure=(createTicketClosureService as typeof createTicketClosureService & P2016ClosureFactory)({pool,beforeTransaction:realtimeProjector.lock,resolveReporterActor:async()=>null,outbox:{enqueueTicketEvent:async (input: ClosureNotificationInput)=>{
        const n=await notifications.project(input);await (realtimeProjector as RealtimeProjector).ticket(input);return {...n,delivery_ids:n.delivery_id?[n.delivery_id]:[]};
      }}});
      tickets=createP2016TicketCommandFacade({pool,enabled,ticketStaffCompletionEnabled,ticketTakeoverCompletionEnabled,ticketWaitingActionsEnabled,ticketReopenRoundsEnabled,query,controlService,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket});
      reviews=createP2016ManualReviewFacade({pool,enabled,workspaceEnabled:workbenchManualReviewEnabled,manualSourceEnabled:workbenchManualReportsEnabled,draftRecoveryEnabled:workbenchDraftRecoveryEnabled,query,notificationProjector:notifications,realtimeProjector,personDestinationAuthorizer,communicationAppend});
      const reviewStart=workbenchManualReviewEnabled&&workbenchReviewResolveAndStartEnabled?createWorkbenchReviewStart({pool,query,reviews,controlService,enabled:true,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket}):null;
      const deliveryControl=createP2016DeliveryControl({pool,query,enabled,externalSendEnabled});
      incidentExtension=incidentExtensionFactory?.({pool,realtime,query})??null;
      const selfHandling=ticketSelfHandlingEnabled?createTicketSelfHandlingService({pool,query,enabled:true,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket}):null;
      const conversationHandling=ticketConversationSelfHandlingEnabled?createTicketConversationHandlingService({pool,query,controlService,enabled:true,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket}):null;
      const staffCompletion=ticketStaffCompletionEnabled?createTicketStaffCompletionService({pool,query,enabled:true,realtimeProjector:realtimeProjector.ticket}):null;
      const manualReports=createWorkbenchManualReports({pool,query,enabled:workbenchManualReportsEnabled,selfHandlingEnabled:ticketSelfHandlingEnabled,selfHandlingHooks:{closure,notificationProjector:notifications},draftRecoveryEnabled:workbenchDraftRecoveryEnabled,reporterCandidatesEnabled:workbenchReporterCandidatesEnabled,reporterDirectory:manualReporterDirectory,realtimeProjector});
      const takeoverCompletion=ticketTakeoverCompletionEnabled?createTicketTakeoverCompletionService({pool,query,controlService,enabled:true,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket}):null;
      const takeover=ticketTakeoverEnabled?createTicketTakeoverService({pool,query,controlService,enabled:true,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket}):null;
      const assignment=ticketAssignmentEnabled?createTicketAssignmentService({pool,query,controlService,enabled:true,closure,notificationProjector:notifications,realtimeProjector:realtimeProjector.ticket}):null;
      const unassign=ticketUnassignEnabled?createTicketUnassignService({pool,query,controlService,enabled:true,realtimeProjector:realtimeProjector.ticket}):null;
      const returnToDispatchService=createTicketReturnToDispatchService({pool,query,controlService,enabled:ticketReturnToDispatchEnabled,realtimeProjector:realtimeProjector.ticket});
      const returnToDispatch=ticketReturnToDispatchEnabled?returnToDispatchService:null;
      const ticketHttp=createP2016WorkbenchHttp({workbenchBoardActionsEnabled,workbenchActivityEnabled,workbenchSupplementFollowUpEnabled,workbenchFollowEnabled,notificationExceptionsEnabled,workbenchAssignmentHistoryEnabled,query,tickets,reviews,reviewStart,deliveryControl,enabled,ticketWaitingActionsEnabled,workbenchPersonalReadEnabled,workbenchFollowUpSchedulesEnabled,followUpSchedules,ticketRoundNotificationsEnabled,ticketReopenRoundsEnabled,workbenchManualReviewEnabled,workbenchManualReportsEnabled,workbenchReporterCandidatesEnabled,sourceGroupDirectoryEnabled,workbenchInternalNotesEnabled,selfHandling,conversationHandling,takeover,takeoverCompletion,assignment,unassign,returnToDispatch,returnToDispatchAcknowledgement:returnToDispatchService.acknowledgement,staffCompletion,workbenchDraftRecoveryEnabled,workbenchConversationsEnabled,workbenchRealtimeEnabled,realtimeAuthorization:principal=>authorization.resolveRealtimeAuthorization(principal,{limit:256,availabilityFallback:true,followUpSchedulesEnabled:workbenchFollowUpSchedulesEnabled}),incidentDeliveryControlEnabled:incidentExtension?.deliveryControlEnabled===true,incidentDeliveryControlDraftRecoveryEnabled:incidentExtension?.deliveryControlEnabled===true&&workbenchDraftRecoveryEnabled,incidentOwnerTransferEnabled:incidentExtension?.ownerTransferEnabled===true,incidentOwnerTransferDraftRecoveryEnabled:incidentExtension?.ownerTransferEnabled===true&&workbenchDraftRecoveryEnabled,incidentPublicProgressEnabled:incidentExtension?.publicProgressEnabled===true,incidentPublicProgressDraftRecoveryEnabled:incidentExtension?.publicProgressEnabled===true&&workbenchDraftRecoveryEnabled,incidentInternalNotesEnabled:incidentExtension?.internalNotesEnabled===true,incidentInternalNoteDraftRecoveryEnabled:incidentExtension?.internalNotesEnabled===true&&workbenchDraftRecoveryEnabled,incidentCandidateWorkspaceEnabled:incidentExtension?.candidateWorkspaceEnabled===true,incidentCandidateDraftRecoveryEnabled:incidentExtension?.candidateWorkspaceEnabled===true&&workbenchDraftRecoveryEnabled,logoutReady:()=>workbenchAuthentication?.supportsLogout===true&&typeof workbenchAuthentication.mappingDigest==='function'&&Boolean(workbenchAuthentication.mappingDigest())});
      const ticketStatic=createP2016WorkbenchStatic({enabled,conversationEnabled:true});
      const sourceGroups=sourceGroupDirectoryEnabled?createWorkbenchSourceGroups({pool,query}):null;
      const follow=createWorkbenchFollow({pool,query,reviews,enabled:workbenchFollowEnabled,manualReviewEnabled:workbenchManualReviewEnabled,manualReportsEnabled:workbenchManualReportsEnabled});
      const workbenchQuery=createWeb01WorkbenchQuery({pool,query,sourceGroups,workbenchFollowEnabled,follow:workbenchFollowEnabled?follow:null,followUpSchedules:workbenchFollowUpSchedulesEnabled?followUpSchedules:null,manualReviewEnabled:workbenchManualReviewEnabled,manualReportsEnabled:workbenchManualReportsEnabled,personalReadEnabled:workbenchPersonalReadEnabled,reviews:workbenchManualReviewEnabled?reviews:null,supplementFollowUp:workbenchSupplementFollowUpEnabled?supplementFollowUp:null});
      const conversations=createWorkbenchConversations({pool,query:queryService,itemQuery:workbenchQuery,commands:commandFacade,enabled:workbenchConversationsEnabled,supplementFollowUpEnabled:workbenchSupplementFollowUpEnabled,replyReceiptAuthorization:supplementFollowUp.authorizeReplyReceipt});
      attachments=createWorkbenchAttachments({pool,query:workbenchQuery,enabled:workbenchAttachmentsEnabled,store:attachmentStore});
      const notificationExceptions=createWorkbenchNotificationExceptions({pool,query,enabled:notificationExceptionsEnabled,externalSendEnabled,incidentScope:incidentExtension?.notificationExceptionScope??null});
      const supplementFollowUpHttp=createWorkbenchSupplementFollowUpHttp(supplementFollowUp,workbenchSupplementFollowUpEnabled);
      const personalReadHttp=createWorkbenchPersonalReadHttp(createWorkbenchPersonalRead({pool,query,reviews,manualReviewEnabled:workbenchManualReviewEnabled,manualSourceEnabled:workbenchManualReportsEnabled,enabled:workbenchPersonalReadEnabled}),workbenchPersonalReadEnabled);
      if(workbenchActivityEnabled&&workbenchRealtimeEnabled){
        const authorizeActivity=async(authContext:unknown,target:WorkbenchActivityTarget,field:WorkbenchActivityField|null)=>{
          if(!authContext||typeof authContext!=='object'||!('auth_method' in authContext)||authContext.auth_method!=='COOKIE'
            ||!('expires_epoch_ms' in authContext)||typeof authContext.expires_epoch_ms!=='string'||!/^\d+$/u.test(authContext.expires_epoch_ms)||BigInt(authContext.expires_epoch_ms)<=BigInt(Date.now())
            ||!('csrf_token' in authContext)||typeof authContext.csrf_token!=='string'||!authContext.csrf_token)failP2016('FORBIDDEN',403);
          const principal=await query.principal(authContext),sessionId='session_id' in authContext?authContext.session_id:null;
          if(typeof sessionId==='string'){
            const session=await pool.query("SELECT 1 FROM pilot_ticket.workbench_auth_session WHERE session_id=$1::uuid AND principal_id=$2::uuid AND state='ACTIVE' AND expires_epoch_ms>platform.physical_epoch_ms()",[sessionId,principal.principal_id]);
            if(session.rowCount!==1)failP2016('FORBIDDEN',403);
          }
          const item=await workbenchQuery.authorizedItem(authContext,target.kind,target.id);
          if(item.kind!==target.kind||item.id!==target.id)failP2016('NOT_FOUND',404);
          if(field!==null){
            if(field==='manual-review'){
              if(!workbenchManualReviewEnabled)failP2016('FORBIDDEN',403);
              // Editing is a field of the currently displayed canonical Item.
              // A readable Item alone grants no permission to edit a Review.
              const detail=await workbenchQuery.detail({authContext,kind:target.kind,id:target.id,cursor:null,limit:'1'});
              let allowed=false;
              for(const ref of detail.review_refs??[]){
                if(ref.status!=='PENDING')continue;
                const review=await (reviews as ReviewFacade).getManualReviewDetail({authContext,reviewId:ref.id});
                const canonical=await (reviews as ReviewFacade).canonicalItem({authContext,reviewId:ref.id});
                if(review.status==='PENDING'&&review.allowed_resolutions.length>0&&canonical.kind===target.kind&&canonical.id===target.id){allowed=true;break;}
              }
              if(!allowed)failP2016('FORBIDDEN',403);
            }else{
              if(target.kind!=='ticket')failP2016('FORBIDDEN',403);
              const ticket=await query.detail({authContext,ticketId:target.id}),actions=ticket.allowed_actions;
              const allowed=field==='internal-note'?workbenchInternalNotesEnabled&&actions.includes('add-note')
                :field==='ticket-completion'?ticketStaffCompletionEnabled&&actions.includes('complete')
                :(ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled)&&actions.some(action=>['take-and-start','accept-for-later','take-and-start-with-conversations','accept-for-later-with-conversations'].includes(action));
              if(!allowed)failP2016('FORBIDDEN',403);
            }
          }
          const binding=createHash('sha256').update(JSON.stringify([principal.principal_id,sessionId,authContext.csrf_token])).digest('hex');
          return {principal_id:principal.principal_id,display_name:principal.display_name.slice(0,128)||'工作人员',binding};
        };
        activity=createWorkbenchActivity({enabled:true,authorize:authorizeActivity,wakeup:realtime.wakeup});
        realtime.setWorkbenchActivity?.(async authContext=>{try{return await activity?.signature(authContext)??null;}catch{activity?.releaseAuthentication(authContext);return null;}});
      }
      const activityHttp=createWorkbenchActivityHttp(activity);
      const web01Http=createWeb01WorkbenchHttp(workbenchQuery,sourceGroups,workbenchFollowEnabled,workbenchFollowEnabled?follow:null);
      const web01Static=createWeb01WorkbenchStatic({enabled,conversationsEnabled:workbenchConversationsEnabled,notificationExceptionsEnabled});
      if(policy==='MEMBER_REQUIRED')memberExtension=(createYxxMemberExtension as typeof createYxxMemberExtension)({pool,oauth:webOAuth,publicOrigin:reporterOrigin,
        reporterHmacSecret,reporterMemberEntry:memberConfig,identityMapping,access,incidentAdapter:incidentExtension?.reporterAdapter??null,appNotifications:app,
        botReporterFeedbackEnabled,botReporterFeedbackDraftRecoveryEnabled,feedbackProfile:'FULL_SERVICE_LOOP',feedbackFeatureFlags:yxxSelfService?.featureFlags??{}});
      if(yxxSelfService!==null)selfService=(createYxxSelfServiceExtension as typeof createYxxSelfServiceExtension)({pool,oauth:webOAuth,publicOrigin:reporterOrigin,
        reporterHmacSecret,reporterMemberEntry:memberConfig,identityMapping,profile:'FULL_SERVICE_LOOP',reporterFeedbackEnabled:yxxSelfService.reporterFeedbackEnabled??false,reporterFeedbackDraftRecoveryEnabled:yxxSelfService.reporterFeedbackDraftRecoveryEnabled??false,featureFlags:yxxSelfService.featureFlags??{},quota:yxxSelfService.quota,
        serviceCatalog:resolveYxxServiceCatalog(serviceCatalog,ruleEngine,Boolean(orchestrationWorker))});
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
          let sourceGroupSchema=true;
          if(sourceGroupDirectoryEnabled){try{sourceGroupSchema=(await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='037_workbench_source_group_names'")).rowCount===1;}catch{sourceGroupSchema=false;}}
          const selfHandlingReady=!(workbenchReviewResolveAndStartEnabled||workbenchAssignmentHistoryEnabled||ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketTakeoverEnabled||ticketWaitingActionsEnabled)||await selfHandlingSchemaReady(pool);
          const returnToDispatchReady=!ticketReturnToDispatchEnabled||await returnToDispatchSchemaReady(pool);
          const unassignReady=!ticketUnassignEnabled||await unassignSchemaReady(pool);
          const staffCompletionReady=!(ticketStaffCompletionEnabled||ticketTakeoverCompletionEnabled)||await staffCompletionSchemaReady(pool);
          const roundNotificationsReady=!ticketRoundNotificationsEnabled||await roundNotificationSchemaReady(pool);
          const manualReportsReady=!workbenchManualReportsEnabled||await manualReportsSchemaReady(pool);
          const followUpReady=!workbenchFollowUpSchedulesEnabled||await followUpDueSchemaReady(pool);
          const roundsRequested=ticketReopenRoundsEnabled||yxxSelfService?.reporterFeedbackEnabled===true||botReporterFeedbackEnabled;
          const reopenReady=!roundsRequested||await reopenRoundsSchemaReady(pool);
          const botFeedbackReady=!botReporterFeedbackEnabled||await botFeedbackSchemaReady(pool);
          const followReady=!workbenchFollowEnabled||await follow.ready();
          const supplementReady=!workbenchSupplementFollowUpEnabled||await supplementFollowUp.ready();
          const ready=supplementReady&&followReady&&followUpReady&&roundNotificationsReady&&botFeedbackReady&&reopenReady&&returnToDispatchReady&&unassignReady&&manualReportsReady&&staffCompletionReady&&selfHandlingReady&&base.ok&&schema&&workbenchAuthSchema&&incidentReady&&selfServiceSchema&&directorySchema&&sourceGroupSchema;
          return {ok:ready,base_service_ready:ready,ai_enhancement_ready:false,ai_enabled:false,
            checks:{...base.checks,p2_016_schema:schema,...(workbenchReviewResolveAndStartEnabled?{workbench_review_resolve_and_start_schema:selfHandlingReady}:{}),...(workbenchSupplementFollowUpEnabled?{workbench_supplement_follow_up_schema:supplementReady}:{}),...(workbenchFollowEnabled?{workbench_follow_schema:followReady}:{}),...(workbenchAssignmentHistoryEnabled?{assignment_history_schema:selfHandlingReady}:{}),...(ticketRoundNotificationsEnabled?{ticket_round_notification_schema:roundNotificationsReady}:{}),...(workbenchFollowUpSchedulesEnabled?{workbench_follow_up_schedules_schema:followUpReady}:{}),...(botReporterFeedbackEnabled?{bot_reporter_feedback_schema:botFeedbackReady}:{}),...(ticketReturnToDispatchEnabled?{ticket_return_to_dispatch_schema:returnToDispatchReady}:{}),...(roundsRequested?{ticket_reopen_rounds_schema:reopenReady}:{}),...(workbenchManualReportsEnabled?{workbench_manual_reports_schema:manualReportsReady}:{}),...(ticketStaffCompletionEnabled?{ticket_staff_completion_schema:staffCompletionReady}:{}),...(ticketTakeoverCompletionEnabled?{ticket_takeover_completion_schema:staffCompletionReady}:{}),...(ticketAssignmentEnabled?{ticket_assignment_schema:selfHandlingReady}:{}),...(ticketTakeoverEnabled?{ticket_takeover_schema:selfHandlingReady}:{}),...(ticketWaitingActionsEnabled?{ticket_waiting_actions_schema:selfHandlingReady}:{}),...(ticketSelfHandlingEnabled?{ticket_self_handling_schema:selfHandlingReady}:{}),...(ticketConversationSelfHandlingEnabled?{ticket_conversation_self_handling_schema:selfHandlingReady}:{}),workbench_wecom_auth:workbenchAuthSchema,...(sourceGroupDirectoryEnabled?{source_group_directory_schema:sourceGroupSchema}:{}),...(directoryStore?{third_staff_directory_schema:directorySchema}:{}),...(selfService?{yxx_self_service_schema:selfServiceSchema}:{})},scope:'INTERNAL_BETA_NOT_PHASE2_GO'};
        },
        authenticatedHandler:async context=>(await activityHttp(context))||(await supplementFollowUpHttp.handler(context))||(await notificationExceptions.handler(context))||(await personalReadHttp(context))||(await conversations.handler(context))||(await manualReports.handler(context))||(await attachments?.handler(context))||(await web01Http(context))||(await incidentExtension?.authenticatedHandler?.(context))||ticketHttp(context),
        unauthenticatedHandler:async context=>{
          const logout=activity&&context.request.method==='POST'&&context.url.pathname==='/workbench/logout';
          const current=logout?await workbenchAuthentication?.authenticate(context.request):null;
          const handled=await workbenchAuthentication?.unauthenticatedHandler?.(context);
          if(handled){if(logout&&context.response.statusCode===200&&current)activity?.releaseAuthentication(current);return true;}
          return (await limitedRequestGuard?.(context))||(await selfService?.handler(context))
            ||(policy==='MEMBER_REQUIRED'?reporterHttp(context):(await oauthHttp(context))||reporterHttp(context));
        },
        staticHandler:async(pathname,response)=>(await web01Static(pathname,response))||(await incidentExtension?.staticHandler?.(pathname,response))||ticketStatic(pathname,response),
        runOnce:async()=>{
          let dueFailed=false,dueError:unknown;
          try{await followUpSchedules.runDueBatch();}
          catch(error){
            dueFailed=true;dueError=error;
            // Existing projection metrics/readiness retain the failure; later work keeps its turn.
            runtime.observability.recordProjection({failures:1});
          }
          await roundNotifications.runOnce();
          if(orchestrationWorker)await orchestrationWorker.processDueBatch({feature_flags:ruleFirstFlags,batch_size:20});
          await (realtimeProjector as RealtimeProjector).runOnce();
          await incidentExtension?.runOnce?.();
          if(dueFailed)throw dueError;
        },
      };
    },
  });
  const systemActions=createTicketActionService({pool,authorize:async({actor,action})=>actor.type==='SYSTEM'&&action==='auto-close',afterAction:(closure as P2016ClosurePort).afterTicketAction});
  return Object.freeze({...runtime,roundNotifications,query,tickets:tickets as TicketFacade,reviews:reviews as ReviewFacade,reporterAccess:access,notifications,realtimeProjector:realtimeProjector as RealtimeProjector,orchestrationWorker,incidentExtension,
    selfService,runFollowUpDueBatch:(input?:{limit?:unknown})=>{if(!runFollowUpDueBatch)failP2016('FOLLOW_UP_UNAVAILABLE',503);return runFollowUpDueBatch(input);},
    stop:async()=>{activity?.close();await attachments?.close();await selfService?.close();memberExtension?.close();(webOAuth as {close?:()=>void}).close?.();return runtime.stop();},
    // Explicit system job, never exposed as an HTTP/User/Reporter action. Scheduling belongs to the approved worker role.
    runAutoClose:async()=>(closure as P2016ClosurePort).runAutoClose({actionService:systemActions,limit:20}),
    runAutoCloseReminders:async()=>(closure as P2016ClosurePort).runAutoCloseReminders({limit:20})});
}
