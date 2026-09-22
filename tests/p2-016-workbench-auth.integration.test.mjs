import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
import { migrateWorkbenchAuth } from '../scripts/p2-016-workbench-auth-migrate.mjs';
import { createWeComWorkbenchAuthentication } from '../src/p2-016-workbench-wecom-auth.mjs';
import { withP2016IsolatedDatabase, applyThrough030, assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';

const origin = 'https://cd3120.mobimedical.cn';
function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function recorder() { return { status: null, headers: null, body: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body = '') { this.body = body; } }; }
function cookieValue(headers, name) { return headers['set-cookie'].find(value => value.startsWith(`${name}=`)).slice(name.length + 1).split(';', 1)[0]; }

test('035 workbench auth migration is isolated, atomic, reentrant and schema-complete', async () => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  assert.ok(databaseUrl, 'PILOT_DATABASE_URL is required; database tests must not be skipped');
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'p2016wbauth', run: async ({ pool, databaseUrl: isolated }) => {
    await applyThrough030({ pool, databaseUrl: isolated });
    await migrateP2016({ databaseUrl: isolated });
    assert.equal((await migrateWorkbenchAuth({ databaseUrl: isolated, mode: 'status' })).status, 'READY_FOR_035');
    assert.equal((await migrateWorkbenchAuth({ databaseUrl: isolated, mode: 'check' })).status, 'CHECK_ROLLBACK_SUCCEEDED');
    assert.equal((await pool.query("SELECT to_regclass('pilot_ticket.workbench_auth_session') AS relation")).rows[0].relation, null);

    assert.equal((await migrateWorkbenchAuth({ databaseUrl: isolated })).status, 'APPLIED');
    const relations = (await pool.query(`SELECT n.nspname||'.'||c.relname AS relation
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='pilot_ticket' AND c.relname=ANY($1::text[]) ORDER BY relation`,
    [['workbench_auth_event', 'workbench_auth_session', 'workbench_login_intent']])).rows.map(row => row.relation);
    assert.deepEqual(relations, ['pilot_ticket.workbench_auth_event', 'pilot_ticket.workbench_auth_session', 'pilot_ticket.workbench_login_intent']);
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM platform.schema_migration WHERE migration_id='035_p2_016_workbench_wecom_auth'")).rows[0].count, 1);
    assert.equal((await migrateWorkbenchAuth({ databaseUrl: isolated })).status, 'NOOP_ALREADY_APPLIED');

    const principal = (await pool.query(`INSERT INTO pilot_ticket.pilot_principal(wecom_user_id,display_name)
      VALUES ('workbench-raw','Workbench Integration') RETURNING id::text`)).rows[0].id;
    await pool.query(`INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES ($1::uuid,'HANDLER')`, [principal]);
    const auth = createWeComWorkbenchAuthentication({ pool, publicOrigin: origin, corpId: 'ww-integration', agentId: '1000001',
      accessTokenProvider: async () => 'synthetic-token', now: () => Date.now(), fetchImpl: async url => url.pathname.endsWith('/batch/userid_to_openuserid')
        ? response({ errcode: 0, open_userid_list: [{ userid: 'workbench-raw', open_userid: 'workbench-open' }] })
        : response({ errcode: 0, userid: 'workbench-open' }) });
    await auth.initialize();
    const start = recorder();
    await auth.unauthenticatedHandler({ request: { method: 'GET', headers: {} }, response: start, url: new URL(`${origin}/workbench`) });
    const intentCookie = cookieValue(start.headers, '__Host-wecom_workbench_intent');
    const state = new URL(start.headers.location).searchParams.get('state');
    const callback = recorder();
    await auth.unauthenticatedHandler({ request: { method: 'GET', headers: { cookie: `__Host-wecom_workbench_intent=${intentCookie}` } }, response: callback,
      url: new URL(`${origin}/workbench/callback?code=integration-code&state=${state}`) });
    const sessionCookie = cookieValue(callback.headers, '__Host-wecom_workbench_session');
    const csrfCookie = cookieValue(callback.headers, '__Host-wecom_workbench_csrf');
    const context = await auth.authenticate({ headers: { cookie: `__Host-wecom_workbench_session=${sessionCookie}; __Host-wecom_workbench_csrf=${csrfCookie}` } });
    assert.equal(context.principal_id, principal);
    const logout = recorder();
    await auth.unauthenticatedHandler({ request: { method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin', 'x-csrf-token': csrfCookie,
      cookie: `__Host-wecom_workbench_session=${sessionCookie}; __Host-wecom_workbench_csrf=${csrfCookie}` } }, response: logout, url: new URL(`${origin}/workbench/logout`) });
    assert.equal(logout.status, 200);
    assert.equal((await pool.query('SELECT state FROM pilot_ticket.workbench_auth_session WHERE principal_id=$1::uuid ORDER BY created_epoch_ms DESC LIMIT 1', [principal])).rows[0].state, 'REVOKED');
    await auth.close();
  }});
  await assertNoP2016Residual({ databaseUrl });
});
