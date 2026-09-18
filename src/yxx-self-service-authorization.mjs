import { timingSafeEqual } from 'node:crypto';
import { snapshotP2016 } from './p2-016-domain-contracts.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const PROFILES = new Set(['OAUTH_ONLY', 'MEMBER_TICKET_READONLY', 'MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP']);
const SOURCES = new Set(['WEB', 'BOT']);
const FLAGS = Object.freeze(['YIXIAOXIU_SELF_SERVICE_ENABLED', 'YIXIAOXIU_MY_REPORTS_ENABLED']);

export const YXX_MEMBER_READ_OPERATIONS = Object.freeze({
  MY_REPORTS: 'MY_REPORTS',
  WEB_DETAIL: 'WEB_DETAIL',
  WEB_TIMELINE: 'WEB_TIMELINE',
  WEB_COMMAND: 'WEB_COMMAND',
  BOT_TICKET: 'BOT_TICKET',
  BOT_LIST: 'BOT_LIST',
});

function fail(code, status = 403) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function nonEmpty(value, code, maximum = 256) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) fail(code);
  return value;
}

function hash(value, code = 'YXX_MEMBER_SCOPE_INVALID') {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code);
  return value;
}

function bool(value, code = 'YXX_MEMBER_FLAGS_INVALID') {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === undefined || value === null) return false;
  fail(code, 503);
}

function flags(value) {
  const selected = value === undefined ? {} : snapshotP2016(value);
  if (!selected || Array.isArray(selected) || typeof selected !== 'object'
    || Object.keys(selected).some((key) => !FLAGS.includes(key))) fail('YXX_MEMBER_FLAGS_INVALID', 503);
  return Object.freeze({
    YIXIAOXIU_SELF_SERVICE_ENABLED: bool(selected.YIXIAOXIU_SELF_SERVICE_ENABLED),
    YIXIAOXIU_MY_REPORTS_ENABLED: bool(selected.YIXIAOXIU_MY_REPORTS_ENABLED),
  });
}

function sourceValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !SOURCES.has(value)) fail('YXX_MEMBER_SOURCE_INVALID');
  return value;
}

function safeSourceScope(value) {
  const scope = value?.scope && typeof value.scope === 'object' ? value.scope : value;
  const scopeHash = scope?.scopeHash ?? value?.canonical_reporter_binding;
  const sourceCorpScope = scope?.sourceCorpScope ?? value?.source_corp_scope;
  const sourceAppScope = scope?.sourceAppScope ?? value?.source_app_scope;
  const proofRef = scope?.proofRef ?? value?.proof_ref;
  return Object.freeze({
    scopeHash: hash(scopeHash),
    sourceCorpScope: nonEmpty(sourceCorpScope, 'YXX_MEMBER_SCOPE_INVALID', 128),
    sourceAppScope: nonEmpty(sourceAppScope, 'YXX_MEMBER_SCOPE_INVALID', 128),
    proofRef: nonEmpty(proofRef, 'YXX_MEMBER_SCOPE_INVALID', 256),
  });
}

function safeBotOwner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const botId = value.botId ?? value.bot_id ?? value.sourceBotId ?? value.source_bot_id;
  const userId = value.userId ?? value.userid ?? value.wecomUserId ?? value.wecom_userid;
  if (typeof botId !== 'string' || botId.length < 1 || botId.length > 128
    || typeof userId !== 'string' || userId.length < 1 || userId.length > 256) return null;
  return Object.freeze({ botId, userId });
}

function authProfile(value, configured) {
  const selected = value?.profile ?? configured;
  if (!PROFILES.has(selected) || (value?.profile !== undefined && selected !== configured)) {
    fail('YXX_MEMBER_PROFILE_INVALID', 503);
  }
  return selected;
}

function equalText(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameContext(left, right) {
  return left.profile === right.profile
    && left.flags.YIXIAOXIU_SELF_SERVICE_ENABLED === right.flags.YIXIAOXIU_SELF_SERVICE_ENABLED
    && left.flags.YIXIAOXIU_MY_REPORTS_ENABLED === right.flags.YIXIAOXIU_MY_REPORTS_ENABLED
    && left.session_generation === right.session_generation
    && ((left.scope === null && right.scope === null)
      || (left.scope !== null && right.scope !== null
        && equalText(left.scope.scopeHash, right.scope.scopeHash)
        && equalText(left.scope.sourceCorpScope, right.scope.sourceCorpScope)
        && equalText(left.scope.sourceAppScope, right.scope.sourceAppScope)
        && equalText(left.scope.proofRef, right.scope.proofRef)))
    && left.bot_owner?.botId === right.bot_owner?.botId
    && left.bot_owner?.userId === right.bot_owner?.userId;
}

function operationAllowed(context, operation, source) {
  const selectedSource = sourceValue(source);
  if (!Object.values(YXX_MEMBER_READ_OPERATIONS).includes(operation)) fail('YXX_MEMBER_OPERATION_INVALID');
  if (context.profile === 'OAUTH_ONLY') fail('YXX_MEMBER_REQUIRED', 401);
  if (context.profile === 'MEMBER_TICKET_READONLY') {
    if (operation === YXX_MEMBER_READ_OPERATIONS.BOT_TICKET) return selectedSource === null || selectedSource === 'BOT';
    if (operation === YXX_MEMBER_READ_OPERATIONS.BOT_LIST) return selectedSource === 'BOT';
    fail('YXX_MEMBER_READ_DISABLED', 403);
  }
  if (operation === YXX_MEMBER_READ_OPERATIONS.BOT_TICKET || operation === YXX_MEMBER_READ_OPERATIONS.BOT_LIST) {
    if (selectedSource === 'WEB') fail('YXX_MEMBER_SOURCE_INVALID');
    return true;
  }
  if (context.flags.YIXIAOXIU_SELF_SERVICE_ENABLED !== true
    || context.flags.YIXIAOXIU_MY_REPORTS_ENABLED !== true) fail('YXX_MEMBER_READ_DISABLED', 403);
  if (operation === YXX_MEMBER_READ_OPERATIONS.MY_REPORTS && selectedSource !== null && selectedSource !== 'WEB' && selectedSource !== 'BOT') {
    fail('YXX_MEMBER_SOURCE_INVALID');
  }
  return true;
}

function normalizeAuth(value, configuredProfile, configuredFlags, botOwnerResolver) {
  let auth;
  try { auth = snapshotP2016(value); } catch { fail('YXX_MEMBER_AUTH_REQUIRED', 401); }
  if (!auth || Array.isArray(auth) || typeof auth !== 'object') fail('YXX_MEMBER_AUTH_REQUIRED', 401);
  const profile = authProfile(auth, configuredProfile);
  const selectedFlags = auth.flags === undefined ? configuredFlags : flags(auth.flags);
  for (const key of FLAGS) if (selectedFlags[key] !== configuredFlags[key]) fail('YXX_MEMBER_FLAGS_CHANGED', 503);
  if (profile === 'OAUTH_ONLY') return Object.freeze({
    profile,
    flags: selectedFlags,
    write_flag: false,
    csrf_token: null,
    session_generation: null,
    scope: null,
    bot_owner: null,
    identity_mode: null,
  });
  const scope = safeSourceScope(auth);
  const generation = auth.session_generation ?? auth.generation ?? null;
  if (generation !== null && (typeof generation !== 'string' || generation.length < 1 || generation.length > 256)) {
    fail('YXX_MEMBER_AUTH_INVALID', 401);
  }
  let owner = safeBotOwner(auth.bot_owner ?? auth.botOwner);
  if (!owner && !botOwnerResolver) owner = safeBotOwner({ botId: auth.bot_id ?? auth.botId, userId: auth.userid ?? auth.wecom_userid });
  return Object.freeze({
    profile,
    flags: selectedFlags,
    write_flag: auth.write_flag === true,
    csrf_token: typeof auth.csrf_token === 'string' ? auth.csrf_token : null,
    session_generation: generation,
    scope,
    bot_owner: owner,
    identity_mode: typeof auth.identity_mode === 'string' ? auth.identity_mode : null,
  });
}

/**
 * Server-side member read authorization. The request never supplies a scope;
 * it is derived from the protected authenticator and checked again after the
 * query. `recheck.localOnly` makes the isolation boundary explicit in tests
 * and prevents accidentally wiring a provider call into a DB read path.
 */
export function createYxxSelfServiceAuthorization({
  authenticate,
  recheck,
  profile = 'OAUTH_ONLY',
  flags: configuredFlags = {},
  scopeResolver = null,
  botOwnerResolver = null,
} = {}) {
  if (typeof authenticate !== 'function' || typeof recheck !== 'function' || recheck.localOnly !== true
    || !PROFILES.has(profile) || (scopeResolver !== null && (typeof scopeResolver !== 'function' || scopeResolver.localOnly !== true))
    || (botOwnerResolver !== null && (typeof botOwnerResolver !== 'function' || botOwnerResolver.localOnly !== true))) {
    fail('YXX_MEMBER_AUTH_CONFIG_INVALID', 503);
  }
  const immutableFlags = flags(configuredFlags);

  async function resolve(request, phase = 'authenticate') {
    let raw;
    try {
      raw = phase === 'recheck' ? await recheck(request) : await authenticate(request);
      if (scopeResolver) {
        const base = snapshotP2016(raw);
        const resolved = await scopeResolver(base);
        raw = { ...base, ...snapshotP2016(resolved) };
      }
      let context = normalizeAuth(raw, profile, immutableFlags, botOwnerResolver);
      if (botOwnerResolver) {
        const owner = await botOwnerResolver(raw);
        context = Object.freeze({ ...context, bot_owner: safeBotOwner(owner) });
      }
      return context;
    } catch (error) {
      if (error?.code?.startsWith('YXX_MEMBER_')) throw error;
      fail(phase === 'recheck' ? 'YXX_MEMBER_AUTH_RECHECK_FAILED' : 'YXX_MEMBER_AUTH_REQUIRED', phase === 'recheck' ? 503 : 401);
    }
  }

  async function authorize({ request, operation = YXX_MEMBER_READ_OPERATIONS.MY_REPORTS, source = null } = {}) {
    const context = await resolve(request);
    operationAllowed(context, operation, source);
    return context;
  }

  async function revalidate(request, context) {
    const latest = await resolve(request, 'recheck');
    if (!sameContext(context, latest)) fail('YXX_MEMBER_AUTH_RECHECK_FAILED', 503);
    return latest;
  }

  async function read({ request, operation = YXX_MEMBER_READ_OPERATIONS.MY_REPORTS, source = null, run } = {}) {
    if (typeof run !== 'function') fail('YXX_MEMBER_RUN_REQUIRED', 503);
    const context = await authorize({ request, operation, source });
    let value;
    let thrown = null;
    try { value = await run(context); } catch (error) { thrown = error; }
    try { await revalidate(request, context); } catch (error) { if (!thrown) throw error; }
    if (thrown) throw thrown;
    return value;
  }

  return Object.freeze({
    authenticate: (request) => resolve(request),
    authorize,
    read,
    revalidate,
    sameContext,
  });
}

export { sameContext as sameYxxMemberContext };
