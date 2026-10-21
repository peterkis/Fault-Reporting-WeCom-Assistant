import type {IncomingMessage} from 'node:http';
import type {PostgresPool} from './platform/postgres-pool.mjs';
import type {WeComOAuth,EnabledWeComOAuth} from './p2-g2-wecom-web-oauth.mjs';
import type {OAuthHttpContext} from './p2-g2-wecom-oauth-http.mjs';
import type {YxxProfile} from './p2-g2-yixiaoxiu-contract.mjs';
import type {YxxIdentityMapping} from './p2-g2-yixiaoxiu-delegated-identity.mjs';
import type {YxxMemberFlags} from './yxx-self-service-authorization.mjs';
import type {YxxQuota} from './yxx-self-service-command.mjs';
import type {YxxOrchestratorOptions} from './yxx-self-service-orchestrator.mjs';
import type {ServiceCatalog} from './p2-007-service-catalog.mjs';
import type {YxxH5Runtime,YxxH5RuntimeOptions} from './yxx-h5-runtime.mjs';
export interface YxxSelfServiceExtensionOptions {h5?:YxxH5RuntimeOptions|null;h5Runtime?:YxxH5Runtime|null;applicationMemberVerifier?:ApplicationMemberVerifier|null;h5EntryMemberVerifier?:ApplicationMemberVerifier|null;reporterFeedbackDraftRecoveryEnabled?:boolean;reporterFeedbackEnabled?:boolean;pool:PostgresPool;oauth:WeComOAuth;publicOrigin:string;reporterMemberEntry:unknown;identityMapping?:YxxIdentityMapping|null|undefined;reporterHmacSecret:string|undefined;profile?:Extract<YxxProfile,'MEMBER_SELF_SERVICE'|'FULL_SERVICE_LOOP'>;featureFlags?:Partial<YxxMemberFlags>|undefined;ruleEngine?:YxxOrchestratorOptions['ruleEngine'];realtimeProjector?:YxxOrchestratorOptions['realtimeProjector'];pollMilliseconds?:number|undefined;quota?:YxxQuota|undefined;serviceCatalog?:ServiceCatalog|null}
import { createHmac } from 'node:crypto';
import {createYxxSelfServiceFeedback} from './yxx-self-service-feedback.mjs';
import { createYxxMemberAuthorizer } from './p2-g2-yixiaoxiu-authorizer.mjs';
import { validateYxxEntryConfig, failYxx } from './p2-g2-yixiaoxiu-contract.mjs';
import { readWeComCookie, sessionName, createWeComOAuthHttp } from './p2-g2-wecom-oauth-http.mjs';
import { createYxxSelfServiceStore } from './yxx-self-service-store.mjs';
import { createYxxMemberCommandContext } from './yxx-self-service-command.mjs';
import { createYxxSelfServiceSupplement } from './yxx-self-service-supplement.mjs';
import { createYxxSelfServiceAuthorization } from './yxx-self-service-authorization.mjs';
import { createYxxSelfServiceQuery } from './yxx-self-service-query.mjs';
import { createYxxSelfServiceNativeHttp } from './yxx-self-service-native-http.mjs';
import { createYxxSelfServiceOrchestrator, createYxxSelfServiceWorker } from './yxx-self-service-orchestrator.mjs';
import {loadServiceCatalog} from './p2-007-service-catalog.mjs';
import {createRuleEngine} from './p2-007-rule-engine.mjs';
import {createYxxApplicationMemberAuthentication} from './yxx-application-member-auth.mjs';
import type {ApplicationMemberVerifier} from './wecom-application-member.mjs';
import {createYxxH5Runtime,createYxxH5RequestAuthentication} from './yxx-h5-runtime.mjs';
import {pathToFileURL} from 'node:url';
import {createYxxH5Http} from './yxx-h5-http.mjs';
import {createYxxH5Static} from './yxx-h5-static.mjs';
import {projectYxxH5Urge} from './yxx-h5-realtime.mjs';

// Composition only: the existing command/store/Core retain all business authority.
export function resolveYxxServiceCatalog(selected:ServiceCatalog|null|undefined,owner:{getServiceCatalog?:()=>ServiceCatalog}|null|undefined,customProcessor=false):ServiceCatalog|null {
  if(owner?.getServiceCatalog){
    try{const actual=owner.getServiceCatalog();return selected===undefined||selected===actual?actual:null;}catch{return null;}
  }
  if(selected!==undefined)return selected;
  if(owner||customProcessor)return null;
  try{return loadServiceCatalog();}catch{return null;}
}

export function createYxxSelfServiceExtension({ pool, oauth, publicOrigin, reporterMemberEntry,
  identityMapping, reporterHmacSecret, applicationMemberVerifier=null,h5EntryMemberVerifier=null, profile = 'MEMBER_SELF_SERVICE', featureFlags = {},
  ruleEngine, realtimeProjector, pollMilliseconds = 5000, quota = Object.assign(async () => true, {localOnly:true as const}), serviceCatalog, reporterFeedbackEnabled=false,reporterFeedbackDraftRecoveryEnabled=false,h5=null,h5Runtime=null }:YxxSelfServiceExtensionOptions & {reporterFeedbackEnabled?:boolean}={} as YxxSelfServiceExtensionOptions) {
  if(typeof reporterFeedbackEnabled!=='boolean'||typeof reporterFeedbackDraftRecoveryEnabled!=='boolean'||reporterFeedbackDraftRecoveryEnabled&&!reporterFeedbackEnabled)failYxx('CONFIG_INVALID');
  const config = validateYxxEntryConfig(reporterMemberEntry);
  if (!['MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP'].includes(profile)
    || !['VERIFIED_DELEGATED_MAPPING','VERIFIED_APP_OPENID'].includes(config.identityMode)
    || config.identityMode==='VERIFIED_APP_OPENID'&&typeof applicationMemberVerifier!=='function'
    || typeof reporterHmacSecret !== 'string' || Buffer.byteLength(reporterHmacSecret) < 32
    || (pool?.options?.max as number) > 4) failYxx('CONFIG_INVALID');
  const member = createYxxMemberAuthorizer({ pool, oauth, config, identityMapping });
  const digest = (purpose:string,values:unknown[]) => createHmac('sha256', reporterHmacSecret)
    .update(JSON.stringify([purpose, ...values])).digest('hex');
  const performanceEntryEnabled=h5Runtime?.performanceEnabled===true||h5?.enabled===true&&h5.performanceEnabled===true;
  if(h5EntryMemberVerifier!==null&&(!performanceEntryEnabled||typeof h5EntryMemberVerifier!=='function'))failYxx('CONFIG_INVALID');
  const appMember=config.enabled&&config.identityMode==='VERIFIED_APP_OPENID'&&applicationMemberVerifier?createYxxApplicationMemberAuthentication({oauth:oauth as EnabledWeComOAuth,config,identityMapping:identityMapping??null,secret:reporterHmacSecret,flags:featureFlags,verifyMember:applicationMemberVerifier,h5EntryVerifier:h5EntryMemberVerifier,...(h5Runtime?.enabled===true||h5?.enabled===true?{requestBudgetMs:60_000}:{})}):null;
  function legacyAuthenticate(request:IncomingMessage) {
    const token = readWeComCookie(request, sessionName);
    const identity = member.authenticate(token);
    // Mapping is already verified and bounded at initialization, never fetched in a transaction.
    return { profile, flags: featureFlags,
      write_flag: featureFlags.YIXIAOXIU_SELF_SERVICE_ENABLED === true,
      csrf_token: digest('csrf', [token]), session_generation: digest('session', [token]),
      canonical_reporter_binding: digest('member', [config.corpId, config.agentId, identity.userid]),
      source_corp_scope: config.corpId, source_app_scope: config.agentId, proof_ref: config.proofRef,
      bot_owner: { botId: config.botId, userId: identity.userid } };
  }
  const recheck=(request:IncomingMessage)=>appMember?appMember.recheck(request):legacyAuthenticate(request);
  const requestAuthentication=createYxxH5RequestAuthentication({authenticate:(request:IncomingMessage)=>appMember?appMember.authenticate(request,profile):legacyAuthenticate(request),authenticateEntry:(request:IncomingMessage)=>appMember?appMember.authenticateEntry(request,profile):legacyAuthenticate(request),recheck});
  const authenticate=requestAuthentication.authenticate;
  const h5Extension=h5Runtime??createYxxH5Runtime({pool,scopeSecret:reporterHmacSecret,publicOrigin,corpId:config.enabled?config.corpId:'',agentId:config.enabled?config.agentId:'',options:h5,onUrge:projectYxxH5Urge,
    onPublicProgress:realtimeProjector?.ticket?async input=>{await realtimeProjector.ticket?.(input);}:null});
  if(h5Extension.enabled){
    if(!oauth.enabled||typeof oauth.enableH5Session!=='function')failYxx('CONFIG_INVALID');
    oauth.enableH5Session();
  }
  const store = createYxxSelfServiceStore({ pool, scopeSecret: reporterHmacSecret,h5Enabled:h5Extension.enabled,onBindMedia:h5Extension.media?.claimInTransaction??null });
  const feedbackStore=reporterFeedbackEnabled?createYxxSelfServiceFeedback({pool,scopeSecret:reporterHmacSecret}):null;
  const command = createYxxMemberCommandContext({ store, feedbackStore,h5Lifecycle:h5Extension.lifecycle, profile, flags: featureFlags, authenticate,
    recheck: Object.assign(({ request }:{request:IncomingMessage}) => recheck(request), { localOnly: true as const }),
    quota });
  const authorization = createYxxSelfServiceAuthorization({ profile, flags: featureFlags, authenticate,
    recheck: Object.assign(recheck, { localOnly: true as const }) });
  const query = createYxxSelfServiceQuery({ pool, store, feedbackStore, authorization, scopeSecret: reporterHmacSecret,
    h5Lifecycle:h5Extension.lifecycle,h5Profile:h5Extension.profile,h5Media:h5Extension.enabled?h5Extension.queryMedia:null,
    h5MediaEntry:h5Extension.performanceEnabled?h5Extension.queryMediaEntry:null });
  const catalog=resolveYxxServiceCatalog(serviceCatalog,ruleEngine);
  const h5Http=createYxxH5Http({enabled:h5Extension.enabled,performanceEnabled:h5Extension.performanceEnabled,publicOrigin,command,query,authorization,media:h5Extension.media,wecom:h5Extension.wecom,sdk:h5Extension.sdk});
  const native = createYxxSelfServiceNativeHttp({ publicOrigin, oauth:oauth as EnabledWeComOAuth,
    oauthHttp: createWeComOAuthHttp({ oauth, publicOrigin }), profile, featureFlags,
    command, reporterFeedbackEnabled,reporterFeedbackDraftRecoveryEnabled, supplement: createYxxSelfServiceSupplement({ command }), query,
    authenticateMember: ({ request }:{request:IncomingMessage}) => authenticate(request), recoveryBindingSecret: reporterHmacSecret, serviceCatalog:catalog,
    h5Handler:h5Extension.enabled?h5Http.handler:null,h5Static:h5Extension.enabled?createYxxH5Static({enabled:true,...(h5Extension.previousStaticRoot?{previousRoot:pathToFileURL(h5Extension.previousStaticRoot.replace(/[\\/]?$/u,'/'))}:{})}):null,
    ...(h5Extension.enabled?{h5Bootstrap:(request:IncomingMessage)=>query.h5Bootstrap({request,sdk:h5Extension.sdk})}:{}),
    ...(h5Extension.performanceEnabled&&h5EntryMemberVerifier?{authenticateH5EntryMember:({request}:{request:IncomingMessage})=>requestAuthentication.authenticateEntry(request)}:{}),
    ...(h5Extension.performanceEnabled?{h5Entry:({request,input,bootstrap})=>query.h5Entry({request,input,bootstrap,sdk:h5Extension.sdk})}:{}) });
  // FULL is processed by the original Worker. Its App never constructs a Web pump.
  const orchestrator = profile === 'MEMBER_SELF_SERVICE'
    ? createYxxSelfServiceOrchestrator({ pool, profile, featureFlags,
      ruleEngine:ruleEngine??(catalog?createRuleEngine({catalog}):undefined), realtimeProjector }) : null;
  const pump = orchestrator ? createYxxSelfServiceWorker({ orchestrator, pollMilliseconds }) : null;
  let inFlight = 0;
  return Object.freeze({ query, command, pump, orchestrator,h5:h5Extension,
    async handler(context:OAuthHttpContext) {
      if(!context.url.pathname.startsWith('/wecom/yixiaoxiu/')&&!context.url.pathname.startsWith('/api/yixiaoxiu/'))return false;
      if (inFlight >= 32) {
        context.response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        context.response.end(JSON.stringify({ error: { code: 'YXX_UNAVAILABLE', retryable: true } }));
        return true;
      }
      inFlight++;
      try { return await native.handler(context); } finally { requestAuthentication.release(context.request);inFlight--; }
    },
    start() { return pump?.start(); },
    async close() { member.close(); await query.closeH5Reads(); await pump?.stop();if(!h5Runtime)await h5Extension.close(); },
  });
}
