import type { IncomingMessage } from 'node:http';
import type { YxxProfile } from './p2-g2-yixiaoxiu-contract.mjs';
export interface YxxMemberFlags { readonly YIXIAOXIU_SELF_SERVICE_ENABLED: boolean; readonly YIXIAOXIU_MY_REPORTS_ENABLED: boolean }
declare const scopeMember: unique symbol;
export interface YxxMemberScope<Member extends string = string> { readonly scopeHash: string & {readonly [scopeMember]: Member}; readonly sourceCorpScope: string; readonly sourceAppScope: string; readonly proofRef: string }
export interface YxxBotOwner { readonly botId: string; readonly userId: string }
interface MemberContextFields { readonly flags: YxxMemberFlags; readonly write_flag: boolean; readonly csrf_token: string | null; readonly session_generation: string | null; readonly bot_owner: YxxBotOwner | null; readonly identity_mode: string | null }
export type YxxMemberContext = MemberContextFields & ({readonly profile: 'OAUTH_ONLY'; readonly scope: null} | {readonly profile: Exclude<YxxProfile,'OAUTH_ONLY'>; readonly scope: YxxMemberScope});
export type YxxActiveMemberContext = YxxMemberContext & {scope:YxxMemberScope};
export type YxxMemberOperation = 'MY_REPORTS' | 'WEB_DETAIL' | 'WEB_TIMELINE' | 'WEB_COMMAND' | 'BOT_TICKET' | 'BOT_LIST';
export type YxxMemberSource = 'WEB' | 'BOT';
export type LocalOnly<Args, Result = unknown> = ((input: Args) => Result | Promise<Result>) & {readonly localOnly: true};
export interface YxxAuthorizationOptions<Request = IncomingMessage> { authenticate: (request: Request) => unknown | Promise<unknown>; recheck: LocalOnly<Request>; profile?: YxxProfile; flags?: unknown; scopeResolver?: LocalOnly<unknown> | null; botOwnerResolver?: LocalOnly<unknown> | null }
export interface YxxMemberReadInput<Request = IncomingMessage> { request: Request; operation?: YxxMemberOperation; source?: YxxMemberSource | null }
type RawAuth = Record<string, unknown>;
import { timingSafeEqual } from 'node:crypto';
import { snapshotP2016 } from './p2-016-domain-contracts.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const PROFILES = new Set(['OAUTH_ONLY', 'MEMBER_TICKET_READONLY', 'MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP']);
const SOURCES = new Set(['WEB', 'BOT']);
const FLAGS = Object.freeze(['YIXIAOXIU_SELF_SERVICE_ENABLED', 'YIXIAOXIU_MY_REPORTS_ENABLED'] as const);

export const YXX_MEMBER_READ_OPERATIONS = Object.freeze({
  MY_REPORTS: 'MY_REPORTS',
  WEB_DETAIL: 'WEB_DETAIL',
  WEB_TIMELINE: 'WEB_TIMELINE',
  WEB_COMMAND: 'WEB_COMMAND',
  BOT_TICKET: 'BOT_TICKET',
  BOT_LIST: 'BOT_LIST',
});

function fail(code: string, status = 403): never {
  const error = new Error(code) as Error & {code:string;status:number};
  error.code = code;
  error.status = status;
  throw error;
}

function nonEmpty(value: unknown, code: string, maximum = 256) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) fail(code);
  return value;
}

function hash(value: unknown, code = 'YXX_MEMBER_SCOPE_INVALID') {
  if (typeof value !== 'string' || !HASH.test(value)) fail(code);
  return value;
}

function bool(value: unknown, code = 'YXX_MEMBER_FLAGS_INVALID') {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false' || value === undefined || value === null) return false;
  fail(code, 503);
}

function flags(value: unknown) {
  const selected = value === undefined ? {} : snapshotP2016(value) as RawAuth | null;
  if (!selected || Array.isArray(selected) || typeof selected !== 'object'
    || Object.keys(selected).some((key) => !FLAGS.includes(key as typeof FLAGS[number]))) fail('YXX_MEMBER_FLAGS_INVALID', 503);
  return Object.freeze({
    YIXIAOXIU_SELF_SERVICE_ENABLED: bool(selected.YIXIAOXIU_SELF_SERVICE_ENABLED),
    YIXIAOXIU_MY_REPORTS_ENABLED: bool(selected.YIXIAOXIU_MY_REPORTS_ENABLED),
  });
}

function sourceValue(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !SOURCES.has(value)) fail('YXX_MEMBER_SOURCE_INVALID');
  return value;
}

function safeSourceScope(value: RawAuth): YxxMemberScope {
  const scope = (value?.scope && typeof value.scope === 'object' ? value.scope : value) as RawAuth;
  const scopeHash = scope?.scopeHash ?? value?.canonical_reporter_binding;
  const sourceCorpScope = scope?.sourceCorpScope ?? value?.source_corp_scope;
  const sourceAppScope = scope?.sourceAppScope ?? value?.source_app_scope;
  const proofRef = scope?.proofRef ?? value?.proof_ref;
  return Object.freeze({
    scopeHash: hash(scopeHash) as YxxMemberScope['scopeHash'],
    sourceCorpScope: nonEmpty(sourceCorpScope, 'YXX_MEMBER_SCOPE_INVALID', 128),
    sourceAppScope: nonEmpty(sourceAppScope, 'YXX_MEMBER_SCOPE_INVALID', 128),
    proofRef: nonEmpty(proofRef, 'YXX_MEMBER_SCOPE_INVALID', 256),
  });
}

function safeBotOwner(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const botId = (value as RawAuth).botId ?? (value as RawAuth).bot_id ?? (value as RawAuth).sourceBotId ?? (value as RawAuth).source_bot_id;
  const userId = (value as RawAuth).userId ?? (value as RawAuth).userid ?? (value as RawAuth).wecomUserId ?? (value as RawAuth).wecom_userid;
  if (typeof botId !== 'string' || botId.length < 1 || botId.length > 128
    || typeof userId !== 'string' || userId.length < 1 || userId.length > 256) return null;
  return Object.freeze({ botId, userId });
}

function authProfile(value: RawAuth, configured: YxxProfile): YxxProfile {
  const selected = value?.profile ?? configured;
  if (!PROFILES.has(selected as string) || (value?.profile !== undefined && selected !== configured)) {
    fail('YXX_MEMBER_PROFILE_INVALID', 503);
  }
  return selected as YxxProfile;
}

function equalText(left: unknown, right: unknown) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameContext(left: YxxMemberContext, right: YxxMemberContext) {
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

function operationAllowed(context: YxxMemberContext, operation: YxxMemberOperation, source: YxxMemberSource | null) {
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
  if (context.flags.YIXIAOXIU_MY_REPORTS_ENABLED !== true) fail('YXX_MEMBER_READ_DISABLED', 403);
  if (operation === YXX_MEMBER_READ_OPERATIONS.MY_REPORTS && selectedSource !== null && selectedSource !== 'WEB' && selectedSource !== 'BOT') {
    fail('YXX_MEMBER_SOURCE_INVALID');
  }
  return true;
}

function normalizeAuth(value: unknown, configuredProfile: YxxProfile, configuredFlags: YxxMemberFlags, botOwnerResolver: LocalOnly<unknown> | null): YxxMemberContext {
  let auth;
  try { auth = snapshotP2016(value) as RawAuth | null; } catch { fail('YXX_MEMBER_AUTH_REQUIRED', 401); }
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
export function createYxxSelfServiceAuthorization<Request = IncomingMessage>({
  authenticate,
  recheck,
  profile = 'OAUTH_ONLY',
  flags: configuredFlags = {},
  scopeResolver = null,
  botOwnerResolver = null,
}: YxxAuthorizationOptions<Request> = {} as YxxAuthorizationOptions<Request>) {
  if (typeof authenticate !== 'function' || typeof recheck !== 'function' || recheck.localOnly !== true
    || !PROFILES.has(profile) || (scopeResolver !== null && (typeof scopeResolver !== 'function' || scopeResolver.localOnly !== true))
    || (botOwnerResolver !== null && (typeof botOwnerResolver !== 'function' || botOwnerResolver.localOnly !== true))) {
    fail('YXX_MEMBER_AUTH_CONFIG_INVALID', 503);
  }
  const immutableFlags = flags(configuredFlags);

  async function resolve(request: Request, phase = 'authenticate') {
    let raw;
    try {
      raw = phase === 'recheck' ? await recheck(request) : await authenticate(request);
      if (scopeResolver) {
        const base = snapshotP2016(raw) as RawAuth;
        const resolved = await scopeResolver(base);
        raw = { ...base, ...snapshotP2016(resolved) as RawAuth };
      }
      let context = normalizeAuth(raw, profile, immutableFlags, botOwnerResolver);
      if (botOwnerResolver) {
        const owner = await botOwnerResolver(raw);
        context = Object.freeze({ ...context, bot_owner: safeBotOwner(owner) });
      }
      return context;
    } catch (error) {
      if ((error as {code?:string} | null)?.code?.startsWith('YXX_MEMBER_')) throw error;
      fail(phase === 'recheck' ? 'YXX_MEMBER_AUTH_RECHECK_FAILED' : 'YXX_MEMBER_AUTH_REQUIRED', phase === 'recheck' ? 503 : 401);
    }
  }

  async function authorize({ request, operation = YXX_MEMBER_READ_OPERATIONS.MY_REPORTS, source = null }: YxxMemberReadInput<Request> = {} as YxxMemberReadInput<Request>) {
    const context = await resolve(request);
    operationAllowed(context, operation, source);
    return context;
  }

  async function revalidate(request: Request, context: YxxMemberContext) {
    const latest = await resolve(request, 'recheck');
    if (!sameContext(context, latest)) fail('YXX_MEMBER_AUTH_RECHECK_FAILED', 503);
    return latest;
  }

  async function read<T>({ request, operation = YXX_MEMBER_READ_OPERATIONS.MY_REPORTS, source = null, run }: YxxMemberReadInput<Request> & { run: (context: YxxActiveMemberContext) => Promise<T> } = {} as YxxMemberReadInput<Request> & {run: (context:YxxActiveMemberContext)=>Promise<T>}) {
    if (typeof run !== 'function') fail('YXX_MEMBER_RUN_REQUIRED', 503);
    const context = await authorize({ request, operation, source });
    let value: T | undefined;
    let thrown: unknown = null;
    try { value = await run(context as YxxActiveMemberContext); } catch (error) { thrown = error; }
    try { await revalidate(request, context); } catch (error) { if (!thrown) throw error; }
    if (thrown) throw thrown;
    return value as T;
  }

  return Object.freeze({
    authenticate: (request: Request) => resolve(request),
    authorize,
    read,
    revalidate,
    sameContext,
  });
}

export { sameContext as sameYxxMemberContext };
