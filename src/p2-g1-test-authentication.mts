import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { IncomingMessage } from 'node:http';
export interface TestAuthOptions { pool?: PostgresPool; principalId?: string | undefined; principalIds?: readonly string[] | null; publicOrigin?: string | undefined; ttlMs?: number; cookieName?: string; now?: () => Date; token?: string; csrfToken?: string; tokens?: readonly string[] | null; csrfTokens?: readonly string[] | null }
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';

export const P2_G1_TEST_AUTH_ERROR_CODES = Object.freeze({
  configurationInvalid: 'P2_G1_TEST_AUTH_CONFIGURATION_INVALID',
  principalForbidden: 'P2_G1_TEST_AUTH_PRINCIPAL_FORBIDDEN',
});
export const P2_G1_TEST_AUTH_MAX_TTL_MS = 65 * 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function secureEqual(left: unknown, right: unknown) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header: unknown, name: string) {
  if (typeof header !== 'string') return null;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index > 0 && pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return null;
}

function configuredPrincipals(principalId: unknown, principalIds: unknown) {
  const values = principalIds === null || principalIds === undefined ? [principalId] : principalIds;
  if (!Array.isArray(values) || values.length < 1 || values.length > 4
    || values.some((value) => typeof value !== 'string' || !UUID.test(value))) {
    throw new TypeError(P2_G1_TEST_AUTH_ERROR_CODES.configurationInvalid);
  }
  const normalized = values.map((value) => value.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError(P2_G1_TEST_AUTH_ERROR_CODES.configurationInvalid);
  }
  return normalized;
}

function configuredSecrets(values: unknown, count: number, minimumLength: number) {
  if (values === null || values === undefined) return Array.from({ length: count }, () => randomBytes(32).toString('base64url'));
  if (!Array.isArray(values) || values.length !== count
    || values.some((value) => typeof value !== 'string' || value.length < minimumLength)) {
    throw new TypeError(P2_G1_TEST_AUTH_ERROR_CODES.configurationInvalid);
  }
  return [...values] as string[];
}

export function createP2G1TestAuthentication({
  pool,
  principalId,
  principalIds = null,
  publicOrigin,
  ttlMs = 15 * 60_000,
  cookieName = 'p2_g1_test',
  now = () => new Date(),
  token = randomBytes(32).toString('base64url'),
  csrfToken = randomBytes(32).toString('base64url'),
  tokens = null,
  csrfTokens = null,
}: TestAuthOptions = {}) {
  const identities = configuredPrincipals(principalId, principalIds);
  const configuredTokens = tokens === null && identities.length === 1 ? [token] : configuredSecrets(tokens, identities.length, 32);
  const configuredCsrfTokens = csrfTokens === null && identities.length === 1 ? [csrfToken] : configuredSecrets(csrfTokens, identities.length, 16);
  if (!pool || typeof (pool as PostgresPool).query !== 'function'
    || typeof publicOrigin !== 'string' || !/^https?:\/\/127\.0\.0\.1(?::\d+)?$/u.test(publicOrigin)
    || !Number.isInteger(ttlMs) || ttlMs < 10_000 || ttlMs > P2_G1_TEST_AUTH_MAX_TTL_MS
    || typeof now !== 'function'
    || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(cookieName)) {
    throw new TypeError(P2_G1_TEST_AUTH_ERROR_CODES.configurationInvalid);
  }
  const issuedAt = now();
  if (!(issuedAt instanceof Date) || !Number.isFinite(issuedAt.getTime()) || issuedAt.getTime() < 0) {
    throw new TypeError(P2_G1_TEST_AUTH_ERROR_CODES.configurationInvalid);
  }
  const expiresEpochMs = String(issuedAt.getTime() + ttlMs);
  const expiresAt = formatEpochMsToShanghaiLocal(expiresEpochMs);

  const sessions = Object.freeze(identities.map((id, index) => Object.freeze({
    principal_id: id,
    token: configuredTokens[index] as string,
    csrf_token: configuredCsrfTokens[index] as string,
    cookie_name: identities.length === 1 ? cookieName : `${cookieName}_${index + 1}`,
  })));

  async function principalAllowed(candidateId: string) {
    const result = await (pool as PostgresPool).query<{ is_active: boolean; roles: string[] | null }>(
      `SELECT p.id::text,p.is_active,array_agg(r.role ORDER BY r.role) FILTER(WHERE r.role IS NOT NULL) AS roles
         FROM pilot_ticket.pilot_principal p
         LEFT JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
        WHERE p.id=$1::uuid GROUP BY p.id,p.is_active`,
      [candidateId],
    );
    if (result.rowCount !== 1 || (result.rows[0] as { is_active: boolean; roles: string[] | null }).is_active !== true) return false;
    const roles = (result.rows[0] as { is_active: boolean; roles: string[] | null }).roles ?? [];
    return roles.some((role) => ['HANDLER', 'DISPATCHER', 'ADMIN'].includes(role));
  }

  async function authenticate(request: IncomingMessage) {
    const current = now();
    if (!(current instanceof Date) || current.getTime() >= Number(expiresEpochMs)) return null;
    const session = sessions.find((entry) => secureEqual(cookieValue(request?.headers?.cookie, entry.cookie_name), entry.token));
    if (!session || !await principalAllowed(session.principal_id)) return null;
    return Object.freeze({
      principal_id: session.principal_id,
      auth_method: 'COOKIE',
      expires_at: expiresAt,
      expires_epoch_ms: expiresEpochMs,
      csrf_token: session.csrf_token,
      public_origin: publicOrigin as string,
    });
  }

  function browserCookie(index = 0) {
    const session = sessions[index];
    if (!session) throw new TypeError(P2_G1_TEST_AUTH_ERROR_CODES.configurationInvalid);
    return Object.freeze({
      name: session.cookie_name,
      value: session.token,
      url: publicOrigin,
      httpOnly: true,
      secure: (publicOrigin as string).startsWith('https://'),
      sameSite: 'Strict',
      expires: Math.floor(Number(expiresEpochMs) / 1000),
    });
  }

  function browserCookies() { return Object.freeze(sessions.map((_, index) => browserCookie(index))); }

  function setCookieHeader(index = 0) {
    const session = sessions[index];
    if (!session) throw new TypeError(P2_G1_TEST_AUTH_ERROR_CODES.configurationInvalid);
    const secure = (publicOrigin as string).startsWith('https://') ? '; Secure' : '';
    return `${session.cookie_name}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`;
  }

  return Object.freeze({ authenticate, browserCookie, browserCookies, setCookieHeader, expires_at: expiresAt, expires_epoch_ms: expiresEpochMs });
}
