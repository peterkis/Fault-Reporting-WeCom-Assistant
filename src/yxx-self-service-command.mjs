import { timingSafeEqual } from 'node:crypto';
import { snapshotP2015Json } from './p2-015-domain-contracts.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const PROFILES = new Set(['OAUTH_ONLY', 'MEMBER_TICKET_READONLY', 'MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function text(value, code, maximum = 128) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) fail(code);
  return value;
}

function flag(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === undefined || value === null) return false;
  fail('YXX_COMMAND_FLAGS_INVALID');
}

function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function header(request, name) {
  const headers = request?.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? null : typeof value === 'string' ? value : null;
}

function configFlags(input) {
  const value = snapshotP2015Json(input ?? {});
  if (Object.keys(value).some((key) => !['YIXIAOXIU_SELF_SERVICE_ENABLED', 'YIXIAOXIU_MY_REPORTS_ENABLED'].includes(key))) {
    fail('YXX_COMMAND_FLAGS_INVALID');
  }
  return Object.freeze({
    YIXIAOXIU_SELF_SERVICE_ENABLED: flag(value.YIXIAOXIU_SELF_SERVICE_ENABLED),
    YIXIAOXIU_MY_REPORTS_ENABLED: flag(value.YIXIAOXIU_MY_REPORTS_ENABLED),
  });
}

function validatedAuth(auth, fallbackProfile, fallbackFlags) {
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) fail('YXX_AUTH_REQUIRED');
  const selectedProfile = auth.profile ?? fallbackProfile;
  const selectedFlags = auth.flags === undefined ? fallbackFlags : configFlags(auth.flags);
  if (selectedProfile !== fallbackProfile
    || selectedFlags.YIXIAOXIU_SELF_SERVICE_ENABLED !== fallbackFlags.YIXIAOXIU_SELF_SERVICE_ENABLED
    || selectedFlags.YIXIAOXIU_MY_REPORTS_ENABLED !== fallbackFlags.YIXIAOXIU_MY_REPORTS_ENABLED) {
    fail('YXX_MEMBER_WRITE_DISABLED');
  }
  if (selectedProfile === 'MEMBER_TICKET_READONLY' || selectedProfile === 'OAUTH_ONLY'
    || !['MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP'].includes(selectedProfile)
    || auth.write_flag !== true || selectedFlags.YIXIAOXIU_SELF_SERVICE_ENABLED !== true
    || selectedProfile === 'MEMBER_SELF_SERVICE' && selectedFlags.YIXIAOXIU_MY_REPORTS_ENABLED !== true) {
    fail('YXX_MEMBER_WRITE_DISABLED');
  }
  const csrf = text(auth.csrf_token, 'YXX_COMMAND_AUTH_INVALID', 512);
  const binding = text(auth.canonical_reporter_binding, 'YXX_COMMAND_AUTH_INVALID', 128);
  if (!HASH.test(binding)) fail('YXX_COMMAND_AUTH_INVALID');
  const generationValue = auth.session_generation ?? auth.generation ?? null;
  const sessionGeneration = generationValue === null ? null : text(generationValue, 'YXX_COMMAND_AUTH_INVALID', 256);
  const trusted = {
    scopeHash: binding,
    sourceCorpScope: text(auth.source_corp_scope, 'YXX_COMMAND_AUTH_INVALID'),
    sourceAppScope: text(auth.source_app_scope, 'YXX_COMMAND_AUTH_INVALID'),
    proofRef: text(auth.proof_ref, 'YXX_COMMAND_AUTH_INVALID', 256),
  };
  return Object.freeze({ profile: selectedProfile, flags: selectedFlags, write_flag: true,
    csrf_token: csrf, session_generation: sessionGeneration, scope: Object.freeze(trusted) });
}

function validatedReadAuth(auth, fallbackProfile, fallbackFlags) {
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) fail('YXX_AUTH_REQUIRED');
  const selectedProfile = auth.profile ?? fallbackProfile;
  const selectedFlags = auth.flags === undefined ? fallbackFlags : configFlags(auth.flags);
  if (selectedProfile !== fallbackProfile
    || selectedFlags.YIXIAOXIU_SELF_SERVICE_ENABLED !== fallbackFlags.YIXIAOXIU_SELF_SERVICE_ENABLED
    || selectedFlags.YIXIAOXIU_MY_REPORTS_ENABLED !== fallbackFlags.YIXIAOXIU_MY_REPORTS_ENABLED
    || !['MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP'].includes(selectedProfile)
    || selectedFlags.YIXIAOXIU_SELF_SERVICE_ENABLED !== true
    || selectedProfile === 'MEMBER_SELF_SERVICE' && selectedFlags.YIXIAOXIU_MY_REPORTS_ENABLED !== true) {
    fail('YXX_MEMBER_READ_DISABLED');
  }
  const binding = text(auth.canonical_reporter_binding, 'YXX_COMMAND_AUTH_INVALID', 128);
  if (!HASH.test(binding)) fail('YXX_COMMAND_AUTH_INVALID');
  const generationValue = auth.session_generation ?? auth.generation ?? null;
  const sessionGeneration = generationValue === null ? null : text(generationValue, 'YXX_COMMAND_AUTH_INVALID', 256);
  return Object.freeze({ profile: selectedProfile, flags: selectedFlags, write_flag: auth.write_flag === true,
    session_generation: sessionGeneration, scope: Object.freeze({ scopeHash: binding,
      sourceCorpScope: text(auth.source_corp_scope, 'YXX_COMMAND_AUTH_INVALID'),
      sourceAppScope: text(auth.source_app_scope, 'YXX_COMMAND_AUTH_INVALID'),
      proofRef: text(auth.proof_ref, 'YXX_COMMAND_AUTH_INVALID', 256) }) });
}

function sameReadAuthContext(left, right) {
  return left.profile === right.profile
    && left.write_flag === right.write_flag
    && left.flags.YIXIAOXIU_SELF_SERVICE_ENABLED === right.flags.YIXIAOXIU_SELF_SERVICE_ENABLED
    && left.flags.YIXIAOXIU_MY_REPORTS_ENABLED === right.flags.YIXIAOXIU_MY_REPORTS_ENABLED
    && left.session_generation === right.session_generation
    && left.scope.scopeHash === right.scope.scopeHash
    && left.scope.sourceCorpScope === right.scope.sourceCorpScope
    && left.scope.sourceAppScope === right.scope.sourceAppScope
    && left.scope.proofRef === right.scope.proofRef;
}

function sameAuthContext(left, right) {
  return left.profile === right.profile
    && left.write_flag === right.write_flag
    && left.flags.YIXIAOXIU_SELF_SERVICE_ENABLED === right.flags.YIXIAOXIU_SELF_SERVICE_ENABLED
    && left.flags.YIXIAOXIU_MY_REPORTS_ENABLED === right.flags.YIXIAOXIU_MY_REPORTS_ENABLED
    && left.session_generation === right.session_generation
    && left.scope.scopeHash === right.scope.scopeHash
    && left.scope.sourceCorpScope === right.scope.sourceCorpScope
    && left.scope.sourceAppScope === right.scope.sourceAppScope
    && left.scope.proofRef === right.scope.proofRef;
}

// This adapter is the only command boundary allowed to turn an authenticated
// member request into a Web acceptance. Identity, scope, flags, CSRF and quota
// come from protected server dependencies; none can be supplied by the form.
// `quota.localOnly` is an explicit contract: its callback may use only the
// supplied transaction/local state and must never call OAuth or a network API.
export function createYxxMemberCommandContext({ store, authenticate, recheck, profile = 'OAUTH_ONLY', flags = {}, quota } = {}) {
  if (!store?.accept || typeof authenticate !== 'function' || !PROFILES.has(profile)
    || typeof recheck !== 'function' || recheck.localOnly !== true
    || typeof quota !== 'function' || quota.localOnly !== true) {
    fail('YXX_COMMAND_CONFIG_INVALID');
  }
  const configuredFlags = configFlags(flags);

  async function authorize({ request, input, kind = 'SUBMIT' } = {}) {
    if (!['SUBMIT', 'SUPPLEMENT'].includes(kind)) fail('YXX_COMMAND_INPUT_INVALID');
    const safeInput = snapshotP2015Json(input);
    let auth;
    try { auth = snapshotP2015Json(await authenticate(request)); } catch { fail('YXX_AUTH_REQUIRED'); }
    const context = validatedAuth(auth, profile, configuredFlags);
    if (!equalSecret(header(request, 'x-csrf-token'), context.csrf_token)) fail('YXX_CSRF_INVALID');
    const commandId = safeInput?.client_command_id;
    if (header(request, 'idempotency-key') !== commandId) fail('YXX_IDEMPOTENCY_KEY_INVALID');
    return context;
  }

  async function checkQuota(context, value, kind, transaction) {
    try { return await quota({ profile: context.profile, kind, client_command_id: value.client_command_id, transaction }) === true; }
    catch { return false; }
  }

  async function verifyBeforeCommit(context, request, transaction) {
    let latest;
    try { latest = snapshotP2015Json(await recheck({ request, context, transaction })); }
    catch (error) {
      if (error?.code === 'YXX_MEMBER_WRITE_DISABLED' || error?.code === 'YXX_COMMAND_AUTH_INVALID') throw error;
      fail('YXX_AUTH_RECHECK_FAILED');
    }
    const checked = validatedAuth(latest, context.profile, context.flags);
    if (!sameAuthContext(context, checked)) fail('YXX_AUTH_RECHECK_FAILED');
    return true;
  }

  async function accept({ request, input, kind = 'SUBMIT', requestRef } = {}) {
    const context = await authorize({ request, input, kind });
    return store.accept({ scope: context.scope, input, kind, requestRef,
      onNewCommand: ({ value, kind: commandKind, transaction }) => checkQuota(context, value, commandKind, transaction),
      onBeforeCommit: ({ transaction }) => verifyBeforeCommit(context, request, transaction) });
  }

  async function acceptInTransaction({ request, input, kind = 'SUBMIT', requestRef, transaction } = {}) {
    const context = await authorize({ request, input, kind });
    return store.acceptInTransaction({ scope: context.scope, input, kind, requestRef, transaction,
      onNewCommand: ({ value, kind: commandKind, transaction: current }) => checkQuota(context, value, commandKind, current),
      onBeforeCommit: ({ transaction: current }) => verifyBeforeCommit(context, request, current) });
  }

  async function commandStatus({ request, clientCommandId } = {}) {
    let auth;
    try { auth = snapshotP2015Json(await authenticate(request)); } catch { fail('YXX_AUTH_REQUIRED'); }
    const context = validatedReadAuth(auth, profile, configuredFlags);
    const result = await store.command({ scope: context.scope, clientCommandId });
    let latest;
    try { latest = snapshotP2015Json(await recheck({ request, context })); }
    catch { fail('YXX_AUTH_RECHECK_FAILED'); }
    if (!sameReadAuthContext(context, validatedReadAuth(latest, context.profile, context.flags))) {
      fail('YXX_AUTH_RECHECK_FAILED');
    }
    return result;
  }

  return Object.freeze({ authorize, accept, acceptInTransaction, commandStatus });
}

export const createYxxSelfServiceCommand = createYxxMemberCommandContext;
