import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWeComAppTokenProvider } from './p2-g2-wecom-app-token.mjs';
import { createWeComOAuthCodeResolver } from './p2-g2-wecom-oauth-provider.mjs';
import { readWeComResponse } from './p2-g2-wecom-oauth-provider.mjs';
import { validYxxUserId } from './p2-g2-yixiaoxiu-contract.mjs';
import { WorkbenchError, WORKBENCH_ERROR_CODES } from './p2-006-workbench-query.mjs';

const STAFF_ROLES = Object.freeze(['HANDLER', 'DISPATCHER', 'ADMIN']);
const ROOT = '/workbench';
const LOGIN_PATH = `${ROOT}/login`;
const CALLBACK_PATH = `${ROOT}/callback`;
const LOGOUT_PATH = `${ROOT}/logout`;
const SESSION_COOKIE = '__Host-wecom_workbench_session';
const CSRF_COOKIE = '__Host-wecom_workbench_csrf';
const INTENT_COOKIE = '__Host-wecom_workbench_intent';
const STATE_TTL_MS = 5 * 60_000;
const DEFAULT_ABSOLUTE_TTL_MS = 8 * 60 * 60_000;
const DEFAULT_IDLE_TTL_MS = 30 * 60_000;
const MAX_ALLOWLIST = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PAGE_PATHS = new Set([ROOT, `${ROOT}/`, `${ROOT}/lifecycle`, `${ROOT}/incidents`]);

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const random = () => randomBytes(32).toString('base64url');
const nowMs = now => String(Math.trunc(now()));

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left, 'utf8'); const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function fail(code, status = 400) { throw new WorkbenchError(code, status); }

function readCookie(request, name) {
  const values = (request?.headers?.cookie ?? '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
  return values.length === 1 ? values[0] : null;
}

function cookie(name, value, maxAge, { httpOnly = true } = {}) {
  return `${name}=${value}; Path=/; ${httpOnly ? 'HttpOnly; ' : ''}Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name, options) { return cookie(name, '', 0, options); }

function validPath(value) { return PAGE_PATHS.has(value); }

function requireConfig({ pool, publicOrigin, corpId, agentId, absoluteTtlMs, idleTtlMs }) {
  if (!pool || typeof pool.query !== 'function' || typeof publicOrigin !== 'string'
    || !/^https:\/\/[^/?#]+$/u.test(publicOrigin) || typeof corpId !== 'string' || !corpId
    || typeof agentId !== 'string' || !/^\d{1,20}$/u.test(agentId)
    || !Number.isSafeInteger(absoluteTtlMs) || absoluteTtlMs < 10 * 60_000 || absoluteTtlMs > 24 * 60 * 60_000
    || !Number.isSafeInteger(idleTtlMs) || idleTtlMs < 60_000 || idleTtlMs > absoluteTtlMs) {
    throw new TypeError('WORKBENCH_AUTH_CONFIGURATION_INVALID');
  }
}

function endpoint(path, token) {
  const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${path}`);
  url.searchParams.set('access_token', token);
  return url;
}

async function fetchJson(fetchImpl, url, init = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return await readWeComResponse(response, controller.signal);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export function createWeComWorkbenchAuthentication({
  pool,
  publicOrigin,
  corpId,
  agentId,
  appSecret,
  accessTokenProvider = null,
  fetchImpl = fetch,
  now = Date.now,
  absoluteTtlMs = DEFAULT_ABSOLUTE_TTL_MS,
  idleTtlMs = DEFAULT_IDLE_TTL_MS,
  maxAllowlist = MAX_ALLOWLIST,
} = {}) {
  requireConfig({ pool, publicOrigin, corpId, agentId, absoluteTtlMs, idleTtlMs });
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(maxAllowlist) || maxAllowlist < 1 || maxAllowlist > 256) {
    throw new TypeError('WORKBENCH_AUTH_CONFIGURATION_INVALID');
  }
  const tokenProvider = accessTokenProvider ?? createWeComAppTokenProvider({ corpId, appSecret, fetchImpl });
  if (typeof tokenProvider !== 'function') throw new TypeError('WORKBENCH_AUTH_TOKEN_PROVIDER_REQUIRED');
  const resolveCode = createWeComOAuthCodeResolver({ accessTokenProvider: tokenProvider, fetchImpl });
  let closed = false;
  let initialized = false;
  let mappingDigest = null;
  const principalByUserId = new Map();

  async function audit({ sessionId = null, principalId = null, identityHash = null, eventType, reasonCode, providerErrcode = null }) {
    await pool.query(`INSERT INTO pilot_ticket.workbench_auth_event
      (session_id,principal_id,identity_hash,event_type,reason_code,provider_errcode)
      VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6)`,
    [sessionId, principalId, identityHash, eventType, reasonCode, providerErrcode]);
  }

  async function refreshIdentityMapping() {
    if (closed) fail(WORKBENCH_ERROR_CODES.authNotReady, 503);
    initialized = false;
    mappingDigest = null;
    principalByUserId.clear();
    const schema = await pool.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='035_p2_016_workbench_wecom_auth'");
    if (schema.rowCount !== 1) throw new Error('WORKBENCH_AUTH_SCHEMA_NOT_READY');
    const result = await pool.query(`SELECT DISTINCT p.id::text AS principal_id,p.wecom_user_id
      FROM pilot_ticket.pilot_principal p
      JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
      WHERE p.is_active AND r.role=ANY($1::text[])
      ORDER BY p.id::text`, [STAFF_ROLES]);
    if (!result.rowCount || result.rowCount > maxAllowlist) throw new Error('WORKBENCH_AUTH_ALLOWLIST_INVALID');
    const rows = result.rows;
    const next = new Map();
    const token = await tokenProvider();
    for (let offset = 0; offset < rows.length; offset += 32) {
      const chunk = rows.slice(offset, offset + 32);
      const body = await fetchJson(fetchImpl, endpoint('batch/userid_to_openuserid', token), {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userid_list: chunk.map(row => row.wecom_user_id) }),
      });
      if (body?.errcode !== 0 || !Array.isArray(body.open_userid_list)
        || body.open_userid_list.length !== chunk.length
        || (body.invalid_userid_list !== undefined && (!Array.isArray(body.invalid_userid_list) || body.invalid_userid_list.length))) {
        throw new Error('WORKBENCH_AUTH_IDENTITY_MAPPING_FAILED');
      }
      const byRaw = new Map(chunk.map(row => [row.wecom_user_id.toLowerCase(), row]));
      for (const mapped of body.open_userid_list) {
        const raw = byRaw.get(String(mapped?.userid ?? '').toLowerCase());
        const open = mapped?.open_userid;
        if (!raw || !validYxxUserId(open) || next.has(open)) throw new Error('WORKBENCH_AUTH_IDENTITY_MAPPING_AMBIGUOUS');
        next.set(open, raw.principal_id);
      }
    }
    principalByUserId.clear();
    for (const [key, value] of next) principalByUserId.set(key, value);
    mappingDigest = hash(JSON.stringify([...principalByUserId.entries()].sort(([a], [b]) => a.localeCompare(b))));
    initialized = true;
    return Object.freeze({ principal_count: rows.length, mapping_digest: mappingDigest });
  }

  function ensureReady() {
    if (closed || !initialized || !mappingDigest) fail(WORKBENCH_ERROR_CODES.authNotReady, 503);
  }

  async function begin({ request, response, returnPath = ROOT } = {}) {
    ensureReady();
    if (!validPath(returnPath)) fail(WORKBENCH_ERROR_CODES.authStateInvalid, 400);
    const state = random();
    const browserBinding = random();
    const created = Number(now());
    const expires = created + STATE_TTL_MS;
    await pool.query(`INSERT INTO pilot_ticket.workbench_login_intent
      (state_hash,browser_binding_hash,return_path,created_epoch_ms,created_at,expires_epoch_ms,expires_at)
      VALUES ($1,$2,$3,$4,platform.local_from_epoch_ms($4),$5,platform.local_from_epoch_ms($5))`,
    [hash(state), hash(browserBinding), returnPath, created, expires]);
    await audit({ eventType: 'LOGIN_STARTED', reasonCode: 'LOGIN_REDIRECT' });
    const location = new URL('https://login.work.weixin.qq.com/wwlogin/sso/login');
    for (const [key, value] of Object.entries({ login_type: 'CorpApp', appid: corpId, agentid: agentId,
      redirect_uri: `${publicOrigin}${CALLBACK_PATH}`, state, lang: 'zh' })) location.searchParams.set(key, value);
    response.writeHead(302, { location: location.href, 'cache-control': 'no-store', 'set-cookie': [
      cookie(INTENT_COOKIE, browserBinding, 300),
    ] });
    response.end();
  }

  async function complete({ request, response, url } = {}) {
    ensureReady();
    const keys = [...url.searchParams.keys()];
    if (keys.some(key => !['code', 'state'].includes(key)) || url.searchParams.getAll('code').length !== 1
      || url.searchParams.getAll('state').length !== 1) fail(WORKBENCH_ERROR_CODES.authStateInvalid, 400);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const browserBinding = readCookie(request, INTENT_COOKIE);
    if (typeof code !== 'string' || !code || typeof state !== 'string' || !state || !browserBinding) {
      fail(WORKBENCH_ERROR_CODES.authStateInvalid, 400);
    }
    const consumed = await pool.query(`UPDATE pilot_ticket.workbench_login_intent
      SET consumed_epoch_ms=$3,consumed_at=platform.local_from_epoch_ms($3)
      WHERE state_hash=$1 AND browser_binding_hash=$2 AND consumed_epoch_ms IS NULL AND expires_epoch_ms>$3
      RETURNING return_path`, [hash(state), hash(browserBinding), Number(now())]);
    if (consumed.rowCount !== 1) {
      await audit({ eventType: 'LOGIN_REJECTED', reasonCode: 'STATE_INVALID' });
      fail(WORKBENCH_ERROR_CODES.authStateInvalid, 400);
    }
    let identity;
    try {
      identity = await resolveCode(code);
    } catch {
      await audit({ eventType: 'OAUTH_FAILED', reasonCode: 'OAUTH_PROVIDER_FAILED' });
      fail(WORKBENCH_ERROR_CODES.authFailed, 502);
    }
    const userid = identity?.userid;
    const principalId = typeof userid === 'string' ? principalByUserId.get(userid) : null;
    const identityHash = typeof userid === 'string' ? hash(userid) : null;
    if (!principalId || !UUID.test(principalId)) {
      await audit({ identityHash, eventType: 'LOGIN_REJECTED', reasonCode: 'PRINCIPAL_NOT_ALLOWED' });
      fail(WORKBENCH_ERROR_CODES.forbidden, 403);
    }
    const sessionToken = random();
    const csrfToken = random();
    const issued = Number(now());
    const expires = issued + absoluteTtlMs;
    const session = await pool.query(`INSERT INTO pilot_ticket.workbench_auth_session
      (session_token_hash,csrf_token_hash,principal_id,identity_hash,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_epoch_ms,expires_at)
      VALUES ($1,$2,$3::uuid,$4,platform.local_from_epoch_ms($5),$5,platform.local_from_epoch_ms($5),$5,$6,platform.local_from_epoch_ms($6)) RETURNING session_id::text`,
    [hash(sessionToken), hash(csrfToken), principalId, identityHash, issued, expires]);
    await audit({ sessionId: session.rows[0].session_id, principalId, identityHash,
      eventType: 'LOGIN_SUCCEEDED', reasonCode: 'OAUTH_LOGIN' });
    response.writeHead(303, { location: consumed.rows[0].return_path, 'cache-control': 'no-store', 'set-cookie': [
      clearCookie(INTENT_COOKIE), cookie(SESSION_COOKIE, sessionToken, Math.floor(absoluteTtlMs / 1000)),
      cookie(CSRF_COOKIE, csrfToken, Math.floor(absoluteTtlMs / 1000), { httpOnly: false }),
    ] });
    response.end();
  }

  async function authenticate(request) {
    ensureReady();
    const sessionToken = readCookie(request, SESSION_COOKIE);
    if (!sessionToken) return null;
    const currentEpoch = Number(nowMs(now));
    const result = await pool.query(`SELECT s.session_id::text,s.principal_id::text,s.csrf_token_hash,
        s.last_seen_epoch_ms::text,s.expires_epoch_ms::text,s.expires_at,p.is_active,
        COALESCE(bool_or(r.role=ANY($2::text[])),false) AS can_work
      FROM pilot_ticket.workbench_auth_session s
      JOIN pilot_ticket.pilot_principal p ON p.id=s.principal_id
      LEFT JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
      WHERE s.session_token_hash=$1 AND s.state='ACTIVE'
      GROUP BY s.session_id,s.principal_id,s.csrf_token_hash,s.last_seen_epoch_ms,s.expires_epoch_ms,s.expires_at,p.is_active`,
    [hash(sessionToken), STAFF_ROLES]);
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];
    const expires = Number(row.expires_epoch_ms);
    const lastSeen = Number(row.last_seen_epoch_ms);
    if (!row.is_active || row.can_work !== true) {
      const revokedEpoch = Number(nowMs(now));
      await pool.query(`UPDATE pilot_ticket.workbench_auth_session
        SET state='REVOKED',revoked_epoch_ms=$2,revoked_at=platform.local_from_epoch_ms($2)
        WHERE session_id=$1::uuid AND state='ACTIVE'`, [row.session_id, revokedEpoch]);
      await audit({ sessionId: row.session_id, principalId: row.principal_id,
        eventType: 'SESSION_REVOKED', reasonCode: row.is_active ? 'ROLE_REMOVED' : 'PRINCIPAL_DISABLED' });
      return null;
    }
    if (currentEpoch >= expires) {
      await pool.query(`UPDATE pilot_ticket.workbench_auth_session
        SET state='EXPIRED',last_seen_epoch_ms=$2,last_seen_at=platform.local_from_epoch_ms($2)
        WHERE session_id=$1::uuid AND state='ACTIVE'`, [row.session_id, currentEpoch]);
      await audit({ sessionId: row.session_id, principalId: row.principal_id, eventType: 'SESSION_EXPIRED', reasonCode: 'ABSOLUTE_TTL' });
      return null;
    }
    if (currentEpoch - lastSeen > idleTtlMs) {
      await pool.query(`UPDATE pilot_ticket.workbench_auth_session
        SET state='EXPIRED',last_seen_epoch_ms=$2,last_seen_at=platform.local_from_epoch_ms($2)
        WHERE session_id=$1::uuid AND state='ACTIVE'`, [row.session_id, currentEpoch]);
      await audit({ sessionId: row.session_id, principalId: row.principal_id, eventType: 'SESSION_EXPIRED', reasonCode: 'IDLE_TTL' });
      return null;
    }
    await pool.query(`UPDATE pilot_ticket.workbench_auth_session
      SET last_seen_epoch_ms=$2,last_seen_at=platform.local_from_epoch_ms($2)
      WHERE session_id=$1::uuid AND state='ACTIVE'`, [row.session_id, currentEpoch]);
    const csrf = readCookie(request, CSRF_COOKIE);
    return Object.freeze({ principal_id: row.principal_id, auth_method: 'COOKIE', expires_at: row.expires_at,
      expires_epoch_ms: row.expires_epoch_ms, csrf_token: secureEqual(hash(csrf ?? ''), row.csrf_token_hash) ? csrf : null,
      public_origin: publicOrigin, session_id: row.session_id });
  }

  async function logout({ request, response } = {}) {
    if (request.headers.origin !== publicOrigin || request.headers['sec-fetch-site'] === 'cross-site') {
      fail(WORKBENCH_ERROR_CODES.originInvalid, 403);
    }
    const sessionToken = readCookie(request, SESSION_COOKIE);
    if (sessionToken) {
      const current = await pool.query(`SELECT session_id::text,principal_id::text,csrf_token_hash FROM pilot_ticket.workbench_auth_session
        WHERE session_token_hash=$1 AND state='ACTIVE'`, [hash(sessionToken)]);
      if (current.rowCount === 1) {
        const csrfCookie = readCookie(request, CSRF_COOKIE);
        if (!secureEqual(request.headers['x-csrf-token'], csrfCookie)
          || !secureEqual(hash(csrfCookie ?? ''), current.rows[0].csrf_token_hash)) {
          fail(WORKBENCH_ERROR_CODES.csrfInvalid, 403);
        }
        const currentEpoch = Number(nowMs(now));
        await pool.query(`UPDATE pilot_ticket.workbench_auth_session
          SET state='REVOKED',revoked_epoch_ms=$2,revoked_at=platform.local_from_epoch_ms($2)
          WHERE session_id=$1::uuid AND state='ACTIVE'`, [current.rows[0].session_id, currentEpoch]);
        await audit({ sessionId: current.rows[0].session_id, principalId: current.rows[0].principal_id,
          eventType: 'LOGOUT', reasonCode: 'USER_LOGOUT' });
      }
    }
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'set-cookie': [
      clearCookie(SESSION_COOKIE), clearCookie(CSRF_COOKIE, { httpOnly: false }), clearCookie(INTENT_COOKIE),
    ] });
    response.end(JSON.stringify({ logged_out: true }));
  }

  async function handler({ request, response, url }) {
    if (url.pathname === LOGIN_PATH && request.method === 'GET' && !url.search) { await begin({ request, response }); return true; }
    if (url.pathname === CALLBACK_PATH && request.method === 'GET') { await complete({ request, response, url }); return true; }
    if (url.pathname === LOGOUT_PATH && request.method === 'POST' && !url.search) { await logout({ request, response }); return true; }
    if (PAGE_PATHS.has(url.pathname) && request.method === 'GET') {
      if (await authenticate(request)) return false;
      await begin({ request, response, returnPath: url.pathname }); return true;
    }
    return false;
  }

  return Object.freeze({
    initialize: refreshIdentityMapping,
    mappingDigest: () => mappingDigest,
    authenticate,
    unauthenticatedHandler: handler,
    close: () => { closed = true; principalByUserId.clear(); },
  });
}
