import { createHmac } from 'node:crypto';
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

// Composition only: the existing command/store/Core retain all business authority.
export function createYxxSelfServiceExtension({ pool, oauth, publicOrigin, reporterMemberEntry,
  identityMapping, reporterHmacSecret, profile = 'MEMBER_SELF_SERVICE', featureFlags = {},
  ruleEngine, realtimeProjector, pollMilliseconds = 5000, quota = Object.assign(async () => true, {localOnly:true}) } = {}) {
  const config = validateYxxEntryConfig(reporterMemberEntry);
  if (!['MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP'].includes(profile)
    || config.identityMode !== 'VERIFIED_DELEGATED_MAPPING'
    || typeof reporterHmacSecret !== 'string' || Buffer.byteLength(reporterHmacSecret) < 32
    || pool?.options?.max > 4) failYxx('CONFIG_INVALID');
  const member = createYxxMemberAuthorizer({ pool, oauth, config, identityMapping });
  const digest = (purpose, values) => createHmac('sha256', reporterHmacSecret)
    .update(JSON.stringify([purpose, ...values])).digest('hex');
  function authenticate(request) {
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
  const store = createYxxSelfServiceStore({ pool, scopeSecret: reporterHmacSecret });
  const command = createYxxMemberCommandContext({ store, profile, flags: featureFlags, authenticate,
    recheck: Object.assign(({ request }) => authenticate(request), { localOnly: true }),
    quota });
  const authorization = createYxxSelfServiceAuthorization({ profile, flags: featureFlags, authenticate,
    recheck: Object.assign(authenticate, { localOnly: true }) });
  const query = createYxxSelfServiceQuery({ pool, store, authorization, scopeSecret: reporterHmacSecret });
  const native = createYxxSelfServiceNativeHttp({ publicOrigin, oauth,
    oauthHttp: createWeComOAuthHttp({ oauth, publicOrigin }), profile, featureFlags,
    command, supplement: createYxxSelfServiceSupplement({ command }), query,
    authenticateMember: ({ request }) => authenticate(request), recoveryBindingSecret: reporterHmacSecret });
  // FULL is processed by the original Worker. Its App never constructs a Web pump.
  const orchestrator = profile === 'MEMBER_SELF_SERVICE'
    ? createYxxSelfServiceOrchestrator({ pool, profile, featureFlags, ruleEngine, realtimeProjector }) : null;
  const pump = orchestrator ? createYxxSelfServiceWorker({ orchestrator, pollMilliseconds }) : null;
  let inFlight = 0;
  return Object.freeze({ query, command, pump, orchestrator,
    async handler(context) {
      if(!context.url.pathname.startsWith('/wecom/yixiaoxiu/')&&!context.url.pathname.startsWith('/api/yixiaoxiu/'))return false;
      if (inFlight >= 32) {
        context.response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        context.response.end(JSON.stringify({ error: { code: 'YXX_UNAVAILABLE', retryable: true } }));
        return true;
      }
      inFlight++;
      try { return await native.handler(context); } finally { inFlight--; }
    },
    start() { return pump?.start(); },
    async close() { member.close(); await pump?.stop(); },
  });
}
