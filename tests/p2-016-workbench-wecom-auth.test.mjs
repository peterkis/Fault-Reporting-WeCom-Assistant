import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeComWorkbenchAuthentication } from '../src/p2-016-workbench-wecom-auth.mjs';
import { createWorkbenchDeliveryControl } from '../src/p2-006-workbench-delivery-control.mjs';
import { WORKBENCH_ERROR_CODES, WorkbenchError } from '../src/p2-006-workbench-query.mjs';
import { migrateWorkbenchAuth } from '../scripts/p2-016-workbench-auth-migrate.mjs';

const origin = 'https://cd3120.mobimedical.cn';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakePool({ identity = 'open-staff' } = {}) {
  const state = { intent: null, session: null, events: [] };
  return {
    state,
    async query(sql, values = []) {
      if (sql.includes("SELECT 1 FROM platform.schema_migration WHERE migration_id='035_p2_016_workbench_wecom_auth'")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('SELECT DISTINCT p.id::text AS principal_id')) {
        return { rowCount: 1, rows: [{ principal_id: '11111111-1111-4111-8111-111111111111', wecom_user_id: 'staff-raw' }] };
      }
      if (sql.includes('INSERT INTO pilot_ticket.workbench_login_intent')) {
        state.intent = { state_hash: values[0], browser_hash: values[1], return_path: values[2], created: values[3], expires: values[4] };
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO pilot_ticket.workbench_auth_event')) {
        state.events.push(values);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('UPDATE pilot_ticket.workbench_login_intent')) {
        const matches = state.intent && !state.intent.consumed && state.intent.state_hash === values[0]
          && state.intent.browser_hash === values[1] && state.intent.expires > values[2];
        if (!matches) return { rowCount: 0, rows: [] };
        state.intent.consumed = true;
        return { rowCount: 1, rows: [{ return_path: state.intent.return_path }] };
      }
      if (sql.includes('INSERT INTO pilot_ticket.workbench_auth_session')) {
        state.session = {
          session_id: '22222222-2222-4222-8222-222222222222', session_hash: values[0], csrf_hash: values[1],
          principal_id: values[2], identity_hash: values[3], last_seen: values[4], expires: values[5], state: 'ACTIVE',
        };
        return { rowCount: 1, rows: [{ session_id: state.session.session_id }] };
      }
      if (sql.includes('SELECT s.session_id::text,s.principal_id::text,s.csrf_token_hash')) {
        if (!state.session || state.session.session_hash !== values[0] || state.session.state !== 'ACTIVE') return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ session_id: state.session.session_id, principal_id: state.session.principal_id,
          csrf_token_hash: state.session.csrf_hash, last_seen_epoch_ms: String(state.session.last_seen),
          expires_epoch_ms: String(state.session.expires), expires_at: '1970-01-01 00:00:00', is_active: true, can_work: true }] };
      }
      if (sql.includes('UPDATE pilot_ticket.workbench_auth_session') && sql.includes("SET last_seen_epoch_ms")) {
        state.session.last_seen = values[1];
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('SELECT session_id::text,principal_id::text,csrf_token_hash')) {
        if (!state.session || state.session.session_hash !== values[0]) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ session_id: state.session.session_id, principal_id: state.session.principal_id, csrf_token_hash: state.session.csrf_hash }] };
      }
      if (sql.includes("SET state='REVOKED'")) {
        state.session.state = 'REVOKED';
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`UNEXPECTED_QUERY:${sql.slice(0, 80)}`);
    },
  };
}

function responseRecorder() {
  return { status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = '') { this.body = body; } };
}

function cookieValue(headers, name) {
  const item = (headers['set-cookie'] ?? []).find(value => value.startsWith(`${name}=`));
  return item?.slice(name.length + 1).split(';', 1)[0] ?? null;
}

test('workbench WeCom auth creates QR redirect, consumes state once, and persists a session', async () => {
  const pool = fakePool();
  const auth = createWeComWorkbenchAuthentication({ pool, publicOrigin: origin, corpId: 'ww-test', agentId: '1000001',
    identityHashKey:'synthetic-identity-key-1234567890',
    accessTokenProvider: async () => 'token', fetchImpl: async url => url.pathname.endsWith('/batch/userid_to_openuserid')
      ? response({ errcode: 0, open_userid_list: [{ userid: 'staff-raw', open_userid: 'open-staff' }] })
      : response({ errcode: 0, userid: url.searchParams.get('code') === 'raw-code' ? 'staff-raw' : 'open-staff' }), now: () => 1_000_000 });
  await auth.initialize();
  const start = responseRecorder();
  await auth.unauthenticatedHandler({ request: { method: 'GET', headers: {} }, response: start, url: new URL(`${origin}/workbench`) });
  assert.equal(start.status, 302);
  const loginUrl = new URL(start.headers.location);
  assert.equal(loginUrl.origin, 'https://login.work.weixin.qq.com');
  assert.equal(loginUrl.pathname, '/wwlogin/sso/login');
  assert.equal(loginUrl.searchParams.get('login_type'), 'CorpApp');
  assert.equal(loginUrl.searchParams.get('appid'), 'ww-test');
  assert.equal(loginUrl.searchParams.get('agentid'), '1000001');
  assert.equal(loginUrl.searchParams.get('redirect_uri'), `${origin}/workbench/callback`);
  const intentCookie = cookieValue(start.headers, '__Host-wecom_workbench_intent');
  const state = loginUrl.searchParams.get('state');
  assert.ok(intentCookie && state);

  const callback = responseRecorder();
  await auth.unauthenticatedHandler({
    request: { method: 'GET', headers: { cookie: `__Host-wecom_workbench_intent=${intentCookie}` } },
    response: callback, url: new URL(`${origin}/workbench/callback?code=one-time-code&state=${state}`),
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, '/workbench');
  const sessionCookie = cookieValue(callback.headers, '__Host-wecom_workbench_session');
  const csrfCookie = cookieValue(callback.headers, '__Host-wecom_workbench_csrf');
  assert.ok(sessionCookie && csrfCookie);
  assert.match(cookieValue(callback.headers, '__Host-wecom_workbench_session'), /.+/u);
  assert.match(callback.headers['set-cookie'].find(value => value.startsWith('__Host-wecom_workbench_session=')), /HttpOnly; Secure; SameSite=Lax/u);
  assert.doesNotMatch(callback.headers['set-cookie'].find(value => value.startsWith('__Host-wecom_workbench_csrf=')), /HttpOnly/u);

  const context = await auth.authenticate({ headers: { cookie: `__Host-wecom_workbench_session=${sessionCookie}; __Host-wecom_workbench_csrf=${csrfCookie}` } });
  assert.equal(context.principal_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(context.auth_method, 'COOKIE');
  assert.equal(context.csrf_token, csrfCookie);

  const lifecycleStart = responseRecorder();
  await auth.unauthenticatedHandler({ request: { method: 'GET', headers: {} }, response: lifecycleStart, url: new URL(`${origin}/workbench/lifecycle`) });
  assert.equal(pool.state.intent.return_path, '/workbench/lifecycle');

  const secondStart = responseRecorder();
  await auth.unauthenticatedHandler({ request: { method: 'GET', headers: {} }, response: secondStart, url: new URL(`${origin}/workbench`) });
  const secondIntent = cookieValue(secondStart.headers, '__Host-wecom_workbench_intent');
  const secondState = new URL(secondStart.headers.location).searchParams.get('state');
  await assert.rejects(
    auth.unauthenticatedHandler({
      request: { method: 'GET', headers: { cookie: `__Host-wecom_workbench_intent=${secondIntent}` } }, response: responseRecorder(),
      url: new URL(`${origin}/workbench/callback?code=raw-code&state=${secondState}`),
    }),
    error => error instanceof WorkbenchError && error.code === WORKBENCH_ERROR_CODES.forbidden,
  );

  const loggedOut = responseRecorder();
  await auth.unauthenticatedHandler({
    request: { method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', 'x-csrf-token': csrfCookie,
      cookie: `__Host-wecom_workbench_session=${sessionCookie}; __Host-wecom_workbench_csrf=${csrfCookie}` } },
    response: loggedOut, url: new URL(`${origin}/workbench/logout`),
  });
  assert.equal(loggedOut.status, 200);
  assert.equal(await auth.authenticate({ headers: { cookie: `__Host-wecom_workbench_session=${sessionCookie}; __Host-wecom_workbench_csrf=${csrfCookie}` } }), null);
  await assert.rejects(
    auth.unauthenticatedHandler({
      request: { method: 'GET', headers: { cookie: `__Host-wecom_workbench_intent=${intentCookie}` } }, response: responseRecorder(),
      url: new URL(`${origin}/workbench/callback?code=one-time-code&state=${state}`),
    }),
    error => error instanceof WorkbenchError && error.code === WORKBENCH_ERROR_CODES.authStateInvalid,
  );
});

test('external delivery controls fail closed when public workbench sending is disabled', async () => {
  const control = createWorkbenchDeliveryControl({
    pool: { query: async () => ({ rowCount: 0, rows: [] }) }, authorize: {}, enabled: true, externalSendEnabled: false,
    operatorPort: { scheduleRetry: async () => ({ ok: true }) }, reconciliationPort: { reconcileUnknownDelivery: async () => ({ ok: true }) },
  });
  await assert.rejects(control.retry({ authContext: {}, deliveryId: '11111111-1111-4111-8111-111111111111' }),
    error => error instanceof WorkbenchError && error.code === WORKBENCH_ERROR_CODES.externalSendDisabled);
});

function migrationPool() {
  const state = { applied: false, committed: false, rolledBack: false, marker: false };
  const client = {
    async query(sql) {
      if (sql === 'BEGIN') return { rowCount: 0, rows: [] };
      if (sql === 'ROLLBACK') { state.rolledBack = true; return { rowCount: 0, rows: [] }; }
      if (sql === 'COMMIT') { state.committed = true; return { rowCount: 0, rows: [] }; }
      if (sql.includes('pg_advisory_xact_lock')) return { rowCount: 0, rows: [] };
      if (sql.includes("migration_id='031_p2_016_ticket_lifecycle_workbench_notifications'")) return { rowCount: 1, rows: [{}] };
      if (sql.includes('SELECT checksum_sha256 FROM platform.schema_migration')) return { rowCount: state.marker ? 1 : 0, rows: [] };
      if (sql.includes('CREATE TABLE pilot_ticket.workbench_auth_session')) { state.applied = true; return { rowCount: 0, rows: [] }; }
      if (sql.includes('WITH stamp AS')) { state.marker = true; return { rowCount: 1, rows: [] }; }
      throw new Error(`UNEXPECTED_MIGRATION_QUERY:${sql.slice(0, 80)}`);
    },
    release() {},
  };
  return { state, async connect() { return client; }, async end() {} };
}

test('workbench auth migration exposes status, check rollback and apply without a down migration', async () => {
  const checked = migrationPool();
  assert.deepEqual(await migrateWorkbenchAuth({ databaseUrl: 'postgres://synthetic', mode: 'check', PoolFactory: () => checked }),
    { status: 'CHECK_ROLLBACK_SUCCEEDED', mode: 'check' });
  assert.equal(checked.state.applied, true);
  assert.equal(checked.state.rolledBack, true);
  assert.equal(checked.state.committed, false);

  const status = migrationPool();
  assert.deepEqual(await migrateWorkbenchAuth({ databaseUrl: 'postgres://synthetic', mode: 'status', PoolFactory: () => status }),
    { status: 'READY_FOR_035', mode: 'status' });
  assert.equal(status.state.applied, false);

  const applied = migrationPool();
  assert.deepEqual(await migrateWorkbenchAuth({ databaseUrl: 'postgres://synthetic', mode: 'apply', PoolFactory: () => applied }),
    { status: 'APPLIED', mode: 'apply' });
  assert.equal(applied.state.committed, true);
  assert.equal(applied.state.marker, true);
});
