import type { UidResolver, DirectoryLimits, DirectoryMember, PersonProfile } from './p2-007-staff-directory-contracts.mjs';
type ProviderBody = { result?: unknown; data?: { token?: unknown } };
export type DirectoryProfileResult =
 | { status: 'RESOLVED'; profile: PersonProfile; protocol_warnings: string[]; resolution_method: string | null; provider_member_ref: string }
 | { status: 'DEFERRED'; reason_code: string; resolution_method?: string | null }
 | { status: 'AMBIGUOUS'; reason_code: string; mismatches: string[] };
export interface DirectoryAdapterOptions {
 baseUrl?: string | undefined; keyProvider?: (() => unknown | Promise<unknown>) | undefined;
 uidResolver?: UidResolver | undefined; fetchImpl?: typeof fetch | undefined;
 beforeRequest?: ((input: { path: string; signal: AbortSignal }) => Promise<void>) | undefined;
 timeoutMs?: number | undefined; limits?: DirectoryLimits | undefined;
}
export interface ProfileRequest { source_identity?: { namespace?: unknown; value?: unknown; local_binding?: unknown }; expected_member?: DirectoryMember | null; signal?: AbortSignal | undefined }
export type StaffDirectoryAdapter = ReturnType<typeof createThirdPartyStaffDirectoryAdapter>;
import {
  createFailClosedUidResolver,
  matchDirectoryProfile,
  normalizeOrganizationTree,
  normalizePersonDetail,
  THIRD_STAFF_DIRECTORY_LIMITS,
  THIRD_STAFF_FORMAL_BASE_URL,
} from './p2-007-staff-directory-contracts.mjs';

function failure(code: string) {
  const error = new Error(code);
  (error as Error & { code: string }).code = code;
  return error;
}

function validateBaseUrl(value: string) {
  if (value !== THIRD_STAFF_FORMAL_BASE_URL) throw failure('THIRD_STAFF_DIRECTORY_FORMAL_BASE_URL_REQUIRED');
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function boundedText(value: unknown, code: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) throw failure(code);
  return value;
}

async function readJson(response: Response, maximumBytes: number): Promise<ProviderBody> {
  if (!response) throw failure('THIRD_STAFF_DIRECTORY_RESPONSE_INVALID');
  if (typeof response.body?.getReader !== 'function') {
    if (!response.ok) throw failure(`THIRD_STAFF_DIRECTORY_HTTP_${response.status}`);
    throw failure('THIRD_STAFF_DIRECTORY_RESPONSE_INVALID');
  }
  const reader = response.body.getReader();
  let complete = false;
  try {
    // Authentication failures need no body parsing (including HTML error pages).
    if (!response.ok) throw failure(`THIRD_STAFF_DIRECTORY_HTTP_${response.status}`);
    const length = response.headers?.get('content-length');
    if (typeof length === 'string' && /^\d+$/u.test(length)
      && BigInt(length) > BigInt(maximumBytes)) throw failure('THIRD_STAFF_DIRECTORY_RESPONSE_TOO_LARGE');
    const bytes = Buffer.allocUnsafe(maximumBytes);
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      if (!(value instanceof Uint8Array)) throw failure('THIRD_STAFF_DIRECTORY_RESPONSE_INVALID');
      if (value.byteLength > maximumBytes - size) throw failure('THIRD_STAFF_DIRECTORY_RESPONSE_TOO_LARGE');
      bytes.set(value, size);
      size += value.byteLength;
    }
    try { return JSON.parse(bytes.subarray(0, size).toString('utf8')) as ProviderBody; }
    catch { throw failure('THIRD_STAFF_DIRECTORY_JSON_INVALID'); }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function createRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), timeoutMs);
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
      timer = null;
      parentSignal?.removeEventListener('abort', abort);
    },
  };
}

export function createThirdPartyStaffDirectoryAdapter({
  baseUrl = THIRD_STAFF_FORMAL_BASE_URL,
  keyProvider = () => null,
  uidResolver = createFailClosedUidResolver(),
  fetchImpl = fetch,
  beforeRequest = async () => {},
  timeoutMs = 30_000,
  limits = THIRD_STAFF_DIRECTORY_LIMITS,
}: DirectoryAdapterOptions = {}) {
  const origin = validateBaseUrl(baseUrl);
  if (typeof keyProvider !== 'function' || typeof fetchImpl !== 'function' || typeof beforeRequest !== 'function'
    || !uidResolver || typeof uidResolver.resolveQueryUid !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw failure('THIRD_STAFF_DIRECTORY_ADAPTER_INVALID');
  }

  let cachedToken: string | null = null;
  let tokenInFlight: Promise<string> | null = null;
  let closed = false;

  async function post(path: string, fields: Record<string, string>, maximumBytes: number, parentSignal?: AbortSignal) {
    if (closed) throw failure('THIRD_STAFF_DIRECTORY_ADAPTER_CLOSED');
    const request = createRequestSignal(parentSignal, timeoutMs);
    try {
      await beforeRequest({ path, signal: request.signal });
      request.signal.throwIfAborted();
      if (closed) throw failure('THIRD_STAFF_DIRECTORY_ADAPTER_CLOSED');
      const response = await fetchImpl(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        redirect: 'error',
        signal: request.signal,
      });
      return await readJson(response, maximumBytes);
    } catch (error) {
      if (['THIRD_STAFF_DIRECTORY_HTTP_401', 'THIRD_STAFF_DIRECTORY_HTTP_403'].includes((error as { code: string } | null)?.code as string)) {
        invalidateToken(fields.token);
      }
      throw error;
    } finally {
      request.clear();
    }
  }

  async function getToken(signal?: AbortSignal): Promise<string> {
    if (closed) throw failure('THIRD_STAFF_DIRECTORY_ADAPTER_CLOSED');
    if (cachedToken) return cachedToken;
    if (tokenInFlight) return tokenInFlight;
    tokenInFlight = (async () => {
      const key = await Promise.resolve(keyProvider()) as string;
      boundedText(key, 'THIRD_STAFF_DIRECTORY_KEY_REQUIRED', 4_096);
      const body = await post('/token/getToken', { key }, limits.maximumTokenResponseBytes, signal);
      if (body?.result !== 'TRUE' || typeof body?.data?.token !== 'string' || body.data.token.length === 0) {
        throw failure('THIRD_STAFF_DIRECTORY_TOKEN_REJECTED');
      }
      if (closed) throw failure('THIRD_STAFF_DIRECTORY_ADAPTER_CLOSED');
      cachedToken = boundedText(body.data.token, 'THIRD_STAFF_DIRECTORY_TOKEN_REJECTED', 4_096);
      return cachedToken;
    })();
    try { return await tokenInFlight; } finally { tokenInFlight = null; }
  }

  function invalidateToken(rejectedToken: string | null | undefined = cachedToken) {
    // A delayed rejection of an older request must not evict a refreshed token.
    if (cachedToken === rejectedToken) cachedToken = null;
  }

  async function syncOrganizationTree({ source_scope: sourceScope = 'FORMAL', root_ref: rootRef, signal }: { source_scope?: string; root_ref?: string | undefined; signal?: AbortSignal | undefined } = {}) {
    boundedText(sourceScope, 'THIRD_STAFF_DIRECTORY_SOURCE_SCOPE_INVALID', 128);
    boundedText(rootRef, 'THIRD_STAFF_DIRECTORY_ROOT_REQUIRED', 256);
    const token = await getToken(signal);
    const body = await post('/token/getOrganizationTree', {
      token,
      parent_id: rootRef as string,
      get_user: 'get',
    }, limits.maximumResponseBytes, signal);
    if (body?.result !== 'TRUE' || !Array.isArray(body.data)) {
      invalidateToken(token);
      throw failure('THIRD_STAFF_DIRECTORY_TREE_REJECTED');
    }
    const normalized = normalizeOrganizationTree(body.data, limits);
    return Object.freeze({ source_scope: sourceScope, root_ref: rootRef, ...normalized });
  }

  async function getPersonProfile({ source_identity: sourceIdentity, expected_member: expectedMember = null, signal }: ProfileRequest = {}): Promise<DirectoryProfileResult> {
    const resolution = await uidResolver.resolveQueryUid({
      source_namespace: sourceIdentity?.namespace,
      source_identity_ref: sourceIdentity?.value,
      local_binding: sourceIdentity?.local_binding ?? null,
    });
    if (!resolution || resolution.status !== 'RESOLVED') {
      return Object.freeze({ status: 'DEFERRED', reason_code: resolution?.reason_code ?? 'UID_UNRESOLVED' });
    }
    boundedText(resolution.uid, 'THIRD_STAFF_DIRECTORY_UID_INVALID', 4_096);
    const token = await getToken(signal);
    const body = await post('/token/getUserInfo', { token, uid: resolution.uid }, limits.maximumDetailResponseBytes, signal);
    if (body?.result !== 'TRUE') {
      // Formal evidence uses -1 for both invalid tokens and unknown UIDs.
      // A business rejection does not prove authentication failure; retain the
      // shared token and defer rather than guessing that the member is absent.
      return Object.freeze({
        status: 'DEFERRED', reason_code: 'PROVIDER_REJECTION_UNCLASSIFIED',
        resolution_method: resolution.method ?? null,
      });
    }
    const normalized = normalizePersonDetail(body);
    if (expectedMember) {
      const match = matchDirectoryProfile(normalized.profile, expectedMember);
      if (!match.matched) {
        return Object.freeze({ status: 'AMBIGUOUS', reason_code: 'DETAIL_DIRECTORY_MISMATCH', mismatches: match.mismatches });
      }
    }
    return Object.freeze({
      status: 'RESOLVED', profile: normalized.profile,
      protocol_warnings: normalized.protocol_warnings,
      resolution_method: resolution.method ?? null,
      provider_member_ref: normalized.profile.provider_user_id,
    });
  }

  return Object.freeze({
    syncOrganizationTree,
    getPersonProfile,
    invalidateToken,
    close() { cachedToken = null; tokenInFlight = null; closed = true; },
  });
}
