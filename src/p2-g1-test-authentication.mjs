import { randomBytes, timingSafeEqual } from 'node:crypto';

export const P2_G1_TEST_AUTH_ERROR_CODES = Object.freeze({
  configurationInvalid: 'P2_G1_TEST_AUTH_CONFIGURATION_INVALID',
  principalForbidden: 'P2_G1_TEST_AUTH_PRINCIPAL_FORBIDDEN',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header, name) {
  if (typeof header !== 'string') return null;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index > 0 && pair.slice(0, index).trim() === name) return pair.slice(index + 1).trim();
  }
  return null;
}

export function createP2G1TestAuthentication({
  pool,
  principalId,
  publicOrigin,
  ttlMs = 15 * 60_000,
  cookieName = 'p2_g1_test',
  now = () => new Date(),
  token = randomBytes(32).toString('base64url'),
  csrfToken = randomBytes(32).toString('base64url'),
} = {}) {
  if (!pool || typeof pool.query !== 'function' || !UUID.test(principalId ?? '')
    || typeof publicOrigin !== 'string' || !/^https?:\/\/127\.0\.0\.1(?::\d+)?$/u.test(publicOrigin)
    || !Number.isInteger(ttlMs) || ttlMs < 10_000 || ttlMs > 3_600_000
    || typeof now !== 'function' || typeof token !== 'string' || token.length < 32
    || typeof csrfToken !== 'string' || csrfToken.length < 16
    || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(cookieName)) {
    throw new TypeError(P2_G1_TEST_AUTH_ERROR_CODES.configurationInvalid);
  }
  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);

  async function principalAllowed() {
    const result = await pool.query(
      `SELECT p.id::text,p.is_active,array_agg(r.role ORDER BY r.role) FILTER(WHERE r.role IS NOT NULL) AS roles
         FROM pilot_ticket.pilot_principal p
         LEFT JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
        WHERE p.id=$1::uuid GROUP BY p.id,p.is_active`,
      [principalId],
    );
    if (result.rowCount !== 1 || result.rows[0].is_active !== true) return false;
    const roles = result.rows[0].roles ?? [];
    return roles.some((role) => ['HANDLER', 'DISPATCHER', 'ADMIN'].includes(role));
  }

  async function authenticate(request) {
    const current = now();
    if (current.getTime() >= expiresAt.getTime()) return null;
    const candidate = cookieValue(request?.headers?.cookie, cookieName);
    if (!secureEqual(candidate, token)) return null;
    if (!await principalAllowed()) return null;
    return Object.freeze({
      principal_id: principalId.toLowerCase(),
      auth_method: 'COOKIE',
      expires_at: expiresAt.toISOString(),
      csrf_token: csrfToken,
      public_origin: publicOrigin,
    });
  }

  function browserCookie() {
    return Object.freeze({
      name: cookieName,
      value: token,
      url: publicOrigin,
      httpOnly: true,
      secure: publicOrigin.startsWith('https://'),
      sameSite: 'Strict',
      expires: Math.floor(expiresAt.getTime() / 1000),
    });
  }

  function setCookieHeader() {
    const secure = publicOrigin.startsWith('https://') ? '; Secure' : '';
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}${secure}`;
  }

  return Object.freeze({ authenticate, browserCookie, setCookieHeader, expires_at: expiresAt.toISOString() });
}
