import type {PostgresPool} from './platform/postgres-pool.mjs';
import type {WeComOAuth,EnabledWeComOAuth} from './p2-g2-wecom-web-oauth.mjs';
import type {YxxIdentityMapping} from './p2-g2-yixiaoxiu-delegated-identity.mjs';
import type {ReporterAccess} from './p2-016-reporter-access.mjs';
import type {ReporterTimeline} from './p2-016-reporter-timeline.mjs';
import type {YxxMemberFlags} from './yxx-self-service-authorization.mjs';
import type {TicketAppNotificationOptions} from '../contracts/workbench_app_notification_contracts.js';
export interface YxxMemberExtensionOptions {pool:PostgresPool;oauth:WeComOAuth;publicOrigin:string;reporterHmacSecret:string|undefined;reporterMemberEntry:unknown;identityMapping?:YxxIdentityMapping|null|undefined;access?:ReporterAccess|null;incidentAdapter?:Parameters<typeof createP2016ReporterTimeline>[0]['incidentAdapter']|undefined;now?:()=>number;botReporterFeedbackEnabled?:boolean;botReporterFeedbackDraftRecoveryEnabled?:boolean;feedbackProfile?:'MEMBER_SELF_SERVICE'|'FULL_SERVICE_LOOP'|null;feedbackFeatureFlags?:Partial<YxxMemberFlags>;appNotifications?:TicketAppNotificationOptions|null}
import {createWeComOAuthServer} from './p2-g2-wecom-oauth-server.mjs';
import {createWeComOAuthHttp} from './p2-g2-wecom-oauth-http.mjs';
import {createP2016ReporterAccess} from './p2-016-reporter-access.mjs';
import {createP2016ReporterTimeline} from './p2-016-reporter-timeline.mjs';
import {createP2012ReporterTimelineAdapter} from './p2-012-reporter-timeline-adapter.mjs';
import {createYxxMemberAuthorizer} from './p2-g2-yixiaoxiu-authorizer.mjs';
import {createYxxMemberHttp} from './p2-g2-yixiaoxiu-http.mjs';
import {createBotReporterFeedback} from './bot-reporter-feedback.mjs';
import {failYxx} from './p2-g2-yixiaoxiu-contract.mjs';

export function createYxxMemberExtension({pool,oauth,publicOrigin,reporterHmacSecret,reporterMemberEntry,identityMapping=null,access=null,incidentAdapter=undefined,now=Date.now,botReporterFeedbackEnabled=false,botReporterFeedbackDraftRecoveryEnabled=false,feedbackProfile=null,feedbackFeatureFlags={},appNotifications=null}:YxxMemberExtensionOptions){
  if(typeof botReporterFeedbackEnabled!=='boolean'||typeof botReporterFeedbackDraftRecoveryEnabled!=='boolean'||feedbackProfile!==null&&!['MEMBER_SELF_SERVICE','FULL_SERVICE_LOOP'].includes(feedbackProfile))failYxx('CONFIG_INVALID');
  const authorizer=createYxxMemberAuthorizer({pool,oauth,config:reporterMemberEntry,identityMapping,reporterHmacSecret,appNotifications});
  const feedback=feedbackProfile?createBotReporterFeedback({pool,authorizer,scopeSecret:reporterHmacSecret as string,enabled:botReporterFeedbackEnabled,draftRecoveryEnabled:botReporterFeedbackDraftRecoveryEnabled,featureFlags:feedbackFeatureFlags}):null;
  access??=createP2016ReporterAccess({pool,enabled:true,hmacSecret:reporterHmacSecret as string});
  const timeline=createP2016ReporterTimeline({pool,enabled:true,authorizeRead:authorizer.read,
    feedbackContext:botReporterFeedbackEnabled&&feedback?(tx,input)=>feedback.context(tx,{sessionToken:input.sessionToken,publicRef:input.publicRef}):null,
    incidentAdapter:incidentAdapter===undefined?createP2012ReporterTimelineAdapter({pool,enabled:true}):incidentAdapter});
  return createYxxMemberHttp({oauth:oauth as EnabledWeComOAuth,oauthHttp:createWeComOAuthHttp({oauth,publicOrigin}),access,timeline,authorizer,publicOrigin,now,feedback});
}
// Reuse the single existing server; do not mount Workbench, commands, Worker or Gateway.
export function createYxxReadonlyServer(options:YxxMemberExtensionOptions){
  const extension=createYxxMemberExtension({...options,feedbackProfile:null,botReporterFeedbackEnabled:false});
  const server=createWeComOAuthServer({oauth:options.oauth,publicOrigin:options.publicOrigin,
    memberHandler:extension.handler,profile:'MEMBER_TICKET_READONLY'});
  server.once('close',()=>extension.close());return server;
}
