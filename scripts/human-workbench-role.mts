import {pathToFileURL} from 'node:url';
import {runApp,runGateway,runWorker} from './p2-g1-process-role.mjs';
import {readWorkbenchRoleSettings,readWorkbenchWorkerSettings,createWorkbenchNotificationOptions,resolveWorkbenchMention,configurationError} from '../src/human-workbench-configuration.mjs';
import type {WorkbenchRole,WorkerRoleSettings} from '../src/human-workbench-configuration.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import type {P2016RuntimeOptions,P2016ClosureFactory,ClosureNotificationInput} from '../src/p2-016-runtime.mjs';
import {createP2016ReporterAccess} from '../src/p2-016-reporter-access.mjs';
import {createP2016TicketNotificationProjector} from '../src/p2-016-ticket-notification-projector.mjs';
import {createP2016RealtimeProjector} from '../src/p2-016-realtime-projector.mjs';
import {createP2016OrchestrationWorker} from '../src/p2-016-orchestration-adapters.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createP2016InboundScope} from '../src/p2-016-inbound-scope.mjs';
import {createChannelMessageInbox} from '../src/p1-003-channel-message-inbox.mjs';
import {createP2016DirectIntakeProcessor} from '../src/p2-016-direct-intake.mjs';
import {createTicketClosureService} from '../src/p1-010-ticket-closure.mjs';
import {createTicketActionService} from '../src/p1-006-ticket-state-actions.mjs';
import {createWeComWorkbenchAuthentication} from '../src/p2-016-workbench-wecom-auth.mjs';
import {createWeComAppTokenProvider} from '../src/p2-g2-wecom-app-token.mjs';
import {createWeComOAuthCodeResolver} from '../src/p2-g2-wecom-oauth-provider.mjs';
import {createYxxDelegatedIdentityMapping} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createP2G1WeComGateway} from '../src/p2-g1-wecom-gateway.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {createApplicationMemberVerifier} from '../src/wecom-application-member.mjs';
import {textHashP2016} from '../src/p2-016-domain-contracts.mjs';
import {createMvpNotificationAdmission} from '../src/mvp-group-replies.mjs';
import {createWorkbenchBotMemberAdmission} from '../src/human-workbench-bot-member-admission.mjs';

// Explicit recipe for this entry only. Unlisted Runtime options retain their defaults.
export const HUMAN_WORKBENCH_OPTIONS={
 mvpNotificationsEnabled:true,
 ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketAssignmentEnabled:true,ticketWaitingActionsEnabled:true,
 ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,ticketRoundNotificationsEnabled:true,
 workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,workbenchManualReportsEnabled:true,
 workbenchConversationsEnabled:true,workbenchConversationInboxEnabled:true,workbenchRealtimeEnabled:true,
 workbenchInternalNotesEnabled:true,workbenchDraftRecoveryEnabled:false,workbenchSupplementFollowUpEnabled:true,
 workbenchPersonalReadEnabled:true,sourceGroupDirectoryEnabled:true,notificationExceptionsEnabled:true,
 botReporterFeedbackEnabled:true,botReporterFeedbackDraftRecoveryEnabled:false,
 yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},reporterFeedbackEnabled:true,reporterFeedbackDraftRecoveryEnabled:false},
} satisfies Partial<P2016RuntimeOptions>;

/** Tests may replace external HTTP/SDK leaves only; parsing, auth, business, DB and all three roles remain real. */
export interface WorkbenchExternalBoundaries {fetchImpl?:typeof fetch;clientFactory?:NonNullable<Parameters<typeof createP2G1WeComGateway>[0]>['clientFactory']}
export async function main(argv=process.argv.slice(2),boundaries:WorkbenchExternalBoundaries={}){
 if(typeof process.send!=='function'||argv.length!==1||!['--role=app','--role=worker','--role=gateway'].includes(argv[0]??''))configurationError('role');
 const role=(argv[0] as string).slice(7).toUpperCase() as WorkbenchRole;
 process.once('disconnect',()=>process.exit(1));
 if(role==='WORKER')return runHumanWorkbenchWorker(readWorkbenchWorkerSettings(),process.env.PILOT_LOG_IDENTITY_HASH_KEY as string,process.env.P2_016_REPORTER_HMAC_SECRET as string);
 const s=readWorkbenchRoleSettings(role);
 if(s.memberEntry.validationProfile==='ISOLATED_TEST'){
  const db=new URL(process.env.PILOT_DATABASE_URL??'');
  if(!['localhost','127.0.0.1'].includes(db.hostname)||!/^p2_015_[a-z0-9_]+$/u.test(db.pathname.slice(1))||!boundaries.fetchImpl||(role==='GATEWAY'&&!boundaries.clientFactory))configurationError('isolatedBoundaries');
 }
 const fetchImpl=boundaries.fetchImpl??fetch;
 const reporterHmacSecret=process.env.P2_016_REPORTER_HMAC_SECRET as string,identityHmacKey=process.env.PILOT_LOG_IDENTITY_HASH_KEY as string;
 const allowedHosts=[new URL(s.reporterOrigin).host],appNotifications=['VERIFIED_DELEGATED_MAPPING','VERIFIED_APP_OPENID'].includes(s.memberEntry.identityMode)?createWorkbenchNotificationOptions(s,reporterHmacSecret):null;
 const tokenProvider=createWeComAppTokenProvider({corpId:s.memberEntry.corpId,appSecret:process.env.APP_SECRET??'disabled',fetchImpl});
 const applicationMemberVerifier=createApplicationMemberVerifier({accessTokenProvider:tokenProvider,fetchImpl});
 const access=(pool:PostgresPool)=>createP2016ReporterAccess({pool,enabled:true,hmacSecret:reporterHmacSecret});
 if(role==='APP'){
  const flags={TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true} as const;
  const mapping=['VERIFIED_DELEGATED_MAPPING','VERIFIED_APP_OPENID'].includes(s.memberEntry.identityMode)?await createYxxDelegatedIdentityMapping({config:s.memberEntry,accessTokenProvider:tokenProvider,fetchImpl}):null;
  return runApp({publicOrigin:s.publicOrigin,externalSendEnabled:s.transportEnabled,
   authenticationFactory:async({pool,publicOrigin})=>{
    const auth=createWeComWorkbenchAuthentication({pool,publicOrigin,corpId:s.memberEntry.corpId,agentId:s.memberEntry.agentId,identityHashKey:identityHmacKey,accessTokenProvider:tokenProvider,fetchImpl});
    try{await auth.initialize();return auth;}catch(error){await auth.close();throw error;}
   },
   runtimeFactory:options=>{
    const runtime=createP2016Runtime({...options,...HUMAN_WORKBENCH_OPTIONS,...(!mapping?{yxxSelfService:null,botReporterFeedbackEnabled:false}:{}),identityHmacKey,workbenchAuthentication:options.authentication,
    flags,
    applicationMemberVerifier,groupNotificationTargets:s.groupNotificationTargets??[],reporterOrigin:s.reporterOrigin,reporterHmacSecret,reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:s.memberEntry,identityMapping:mapping,appNotifications,allowedHosts,
    wecomWebOAuth:{enabled:true,corpId:s.memberEntry.corpId,agentId:s.memberEntry.agentId,resolveCode:createWeComOAuthCodeResolver({accessTokenProvider:tokenProvider,fetchImpl})}});
    return {...runtime,start:async()=>{
     const started=await runtime.start();
     try{
      const response=await fetch('http://127.0.0.1:'+started.address.port+'/health/ready',{signal:AbortSignal.timeout(5000)});
      const readiness=await response.json() as {checks:Record<string,unknown>};
      const missing=Object.entries(readiness.checks).filter(([key,value])=>value===false&&(key.includes('schema')||key==='workbench_wecom_auth')).map(([key])=>key);
      if(missing.length)throw new Error('HUMAN_WORKBENCH_SCHEMA_REQUIRED:'+missing.join(','));
      return started;
     }catch(error){await runtime.stop();throw error;}
    }};
   },
  });
 }
 if(role==='GATEWAY'){
 const memberAdmission=s.botInboundEnabled?createWorkbenchBotMemberAdmission({botId:s.botId,accessTokenProvider:tokenProvider,fetchImpl}):null;
 return runGateway({
  intakeFactory:({pool})=>{
   const scope=memberAdmission?null:createP2016InboundScope({bot_id:s.botId,person_hashes:s.personTargetHashes,group_hashes:s.groupTargetHashes});
   const inbox=createChannelMessageInbox({pool}),processor=createP2016DirectIntakeProcessor({identityHmacKey});
   return {accept:async input=>{
    const message=(input as {message?:unknown}).message;
    const allowed=memberAdmission?await memberAdmission.accepts(message):scope?.accepts(message)===true;
    return allowed?inbox.accept(input,processor):{ok:false,error:{code:'HUMAN_WORKBENCH_INBOUND_SCOPE_REJECTED',retryable:false}};
   }};
  },
  ...(boundaries.clientFactory?{gatewayFactory:options=>createP2G1WeComGateway({...options,clientFactory:boundaries.clientFactory})}:{}),
  senderFactory:({pool,...options})=>createP2016WeComSender({...options,mvpPolicy:true,groupReplies:{pool,authorize:async basis=>memberAdmission?memberAdmission.qualifyDelivery({provider:'WECOM_AIBOT',bot_id:basis.bot_id,sender_user_id:basis.reporter,chat_type:'group',chat_id:basis.group_id}):(s.groupTargetHashes??[]).includes(textHashP2016(basis.group_id))},cardEnabled:true,linkMode:'MEMBER_REQUIRED',reporterAccess:access(pool),origin:s.reporterOrigin,allowedHosts,
   ...(memberAdmission?{qualifyBotNotificationRecipient:async(source:{botId:string;reporterUserId:string})=>memberAdmission.qualifyDelivery({provider:'WECOM_AIBOT',bot_id:source.botId,sender_user_id:source.reporterUserId,chat_type:'single'})}:{}),
   groupRoundNotifications:{pool,mvpPolicy:true,routes:s.groupRoutes??[],resolveMentionUserId:async input=>{
    if(s.memberEntry.identityMode==='VERIFIED_APP_OPENID'&&memberAdmission)return await memberAdmission.qualifyDelivery({provider:'WECOM_AIBOT',bot_id:input.botId,sender_user_id:input.reporterUserId,chat_type:'group',chat_id:input.groupId})?input.reporterUserId:null;
    return resolveWorkbenchMention(s,input);
   },fetchImpl},
   ...(appNotifications?{appRoundNotifications:{pool,applicationMemberVerifier,notifications:appNotifications,agentId:Number(s.memberEntry.agentId),accessTokenProvider:tokenProvider,fetchImpl}}:{})}),
 });
 }
}
function runHumanWorkbenchWorker(s:WorkerRoleSettings,identityHmacKey:string,reporterHmacSecret:string){
 const access=(pool:PostgresPool)=>createP2016ReporterAccess({pool,enabled:true,hmacSecret:reporterHmacSecret});
 return runWorker({deliveryAttemptAdmissionFactory:()=>createMvpNotificationAdmission(),reportCycleHealth:true,extensionFactory:({pool})=>{
  const notifications=createP2016TicketNotificationProjector({mvpPolicy:true,enabled:true,cardEnabled:true,reporterAccess:access(pool),explicitReferenceEnabled:true,roundNotificationBotId:s.botId});
  const realtime=createP2016RealtimeProjector({pool,enabled:true});
  const orchestration=createP2016OrchestrationWorker({pool,mvpPolicy:true,notifications,realtime,identityHmacKey,yxxSelfService:HUMAN_WORKBENCH_OPTIONS.yxxSelfService});
  const closure=(createTicketClosureService as typeof createTicketClosureService & P2016ClosureFactory)({pool,beforeTransaction:realtime.lock,resolveReporterActor:async()=>null,outbox:{enqueueTicketEvent:async(input:ClosureNotificationInput)=>{
   const n=await notifications.project(input);await realtime.ticket(input);return {...n,delivery_ids:n.delivery_id?[n.delivery_id]:[]};
  }}});
  const actions=createTicketActionService({pool,authorize:async({actor,action})=>actor.type==='SYSTEM'&&action==='auto-close',afterAction:closure.afterTicketAction});
  return {runOnce:async()=>{await orchestration.processDueBatch({feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true},batch_size:20});await closure.runAutoCloseReminders({limit:20});await closure.runAutoClose({actionService:actions,limit:20});await realtime.runOnce();}};
 }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(error=>{
 const message=error instanceof Error&&/^HUMAN_WORKBENCH_(?:CONFIG_INVALID|SCHEMA_REQUIRED):[A-Za-z0-9_.,]+$/u.test(error.message)?error.message:'HUMAN_WORKBENCH_ROLE_FAILED';
 process.send?.({type:'role-failed',role:process.argv[2]?.slice(7).toUpperCase(),error_code:message});process.exit(1);
});
