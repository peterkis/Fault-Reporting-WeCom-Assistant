import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeComWorkbenchAuthentication } from '../app/server/src/p2-016-workbench-wecom-auth.mjs';
import { createWorkbenchDeliveryControl } from '../app/server/src/p2-006-workbench-delivery-control.mjs';
import { WORKBENCH_ERROR_CODES, WorkbenchError } from '../app/server/src/p2-006-workbench-query.mjs';
import { migrateWorkbenchAuth } from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';

const origin = 'https://cd3120.mobimedical.cn';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakePool({ identity = 'open-staff' } = {}) {
  const state = { intent: null, session: null, events: [],displayName:'信息科工作人员' };
  return {
    state,
    async query(sql, values = []) {
      if(sql.startsWith('UPDATE pilot_ticket.pilot_principal SET display_name=')){
        if(state.session?.state!=='ACTIVE'||values[0]!==state.session.principal_id||values[2]!=='staff-raw')return {rowCount:0,rows:[]};
        state.displayName=values[1];return {rowCount:1,rows:[{id:values[0]}]};
      }
      if(sql.includes('session_guard')&&sql.includes(' AS current'))return {rowCount:1,rows:[{current:state.session?.state==='ACTIVE'}]};
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
  let revokeDuringProfile=false;
  const auth = createWeComWorkbenchAuthentication({ pool, publicOrigin: origin, corpId: 'ww-test', agentId: '1000001',
    profileReader:async id=>{assert.equal(id,'open-staff');if(revokeDuringProfile)pool.state.session.state='REVOKED';return {openUserId:id,displayName:'合成姓名',departmentName:'合成信息科',checkedEpochMs:'1000000'};},
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
  assert.deepEqual(await auth.currentDisplay(context),{name:'合成姓名',department:'合成信息科'});
  assert.equal(pool.state.displayName,'合成姓名');
  revokeDuringProfile=true;
  await assert.rejects(auth.currentDisplay(context),{code:WORKBENCH_ERROR_CODES.unauthenticated});
  pool.state.session.state='ACTIVE';revokeDuringProfile=false;

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

test('desktop entry binds the existing QR intent to the fixed PC route and rejects injected destinations', async () => {
  const pool = fakePool();
  const auth = createWeComWorkbenchAuthentication({pool, publicOrigin:origin, corpId:'ww-test',agentId:'1000001',identityHashKey:'synthetic-desktop-identity-key',
    accessTokenProvider:async()=> 'synthetic',fetchImpl:async url=>url.pathname.endsWith('/batch/userid_to_openuserid')
      ? response({errcode:0,open_userid_list:[{userid:'staff-raw',open_userid:'open-staff'}]}) : response({errcode:0,userid:'open-staff'})});
  await auth.initialize();
  const request={method:'GET',headers:{}}, start=responseRecorder();
  await auth.unauthenticatedHandler({request,response:start,url:new URL(origin+'/workbench/desktop')});
  assert.equal(start.status,302);assert.equal(pool.state.intent.return_path,'/workbench');
  const state=new URL(start.headers.location).searchParams.get('state'),binding=cookieValue(start.headers,'__Host-wecom_workbench_intent');
  assert.match(state,/^desktop\.[A-Za-z0-9_-]{43}$/u);
  await assert.rejects(auth.unauthenticatedHandler({request:{method:'GET',headers:{cookie:'__Host-wecom_workbench_intent='+binding}},response:responseRecorder(),url:new URL(origin+'/workbench/callback?code=desktop-code&state='+state.slice(8))}),{code:WORKBENCH_ERROR_CODES.authStateInvalid});
  const callback=responseRecorder();
  await auth.unauthenticatedHandler({request:{method:'GET',headers:{cookie:'__Host-wecom_workbench_intent='+binding}},response:callback,url:new URL(origin+'/workbench/callback?code=desktop-code&state='+state)});
  assert.equal(callback.status,303);assert.equal(callback.headers.location,'/workbench/app/');
  const loggedIn=responseRecorder();
  await auth.unauthenticatedHandler({request:{method:'GET',headers:{cookie:'__Host-wecom_workbench_session='+cookieValue(callback.headers,'__Host-wecom_workbench_session')}},response:loggedIn,url:new URL(origin+'/workbench/desktop')});
  assert.equal(loggedIn.status,303);assert.equal(loggedIn.headers.location,'/workbench/app/');assert.equal(loggedIn.headers['set-cookie'],undefined);
  for(const suffix of ['?return_to=https://evil.test','?x=1'])await assert.rejects(auth.unauthenticatedHandler({request,response:responseRecorder(),url:new URL(origin+'/workbench/desktop'+suffix)}));
  await assert.rejects(auth.unauthenticatedHandler({request:{method:'POST',headers:{}},response:responseRecorder(),url:new URL(origin+'/workbench/desktop')}));
  assert.equal(await auth.unauthenticatedHandler({request,response:responseRecorder(),url:new URL(origin+'/api/lifecycle/bootstrap')}),false);
});

test('embedded login shares the one-use desktop intent and exposes only dedicated public assets',async()=>{
  const pool=fakePool();
  const auth=createWeComWorkbenchAuthentication({pool,publicOrigin:origin,corpId:'ww-test',agentId:'1000001',identityHashKey:'synthetic-embedded-identity-key',accessTokenProvider:async()=>'token',fetchImpl:async url=>url.pathname.endsWith('/batch/userid_to_openuserid')?response({errcode:0,open_userid_list:[{userid:'staff-raw',open_userid:'open-staff'}]}):response({errcode:0,userid:'open-staff'}),now:()=>1_000_000});
  await auth.initialize();
  try{
    const start=responseRecorder();
    assert.equal(await auth.unauthenticatedHandler({request:{method:'GET',headers:{}},response:start,url:new URL(origin+'/workbench/desktop/embedded')}),true);
    assert.equal(start.status,200);assert.match(start.headers['content-type'],/^text\/html/u);
    assert.match(start.headers['content-security-policy'],/frame-src https:\/\/login\.work\.weixin\.qq\.com/u);
    assert.match(start.headers['content-security-policy'],/frame-ancestors 'none'/u);assert.equal(start.headers['referrer-policy'],'origin');
    assert.equal(start.headers['cache-control'],'no-store');assert.doesNotMatch(start.body,/synthetic-embedded-identity-key|__Host-wecom_workbench_intent=/u);
    const state=start.body.match(/data-state="(desktop\.[A-Za-z0-9_-]{43})"/u)?.[1],binding=cookieValue(start.headers,'__Host-wecom_workbench_intent');assert.ok(state&&binding);
    assert.match(start.body,/data-issued="1000000" data-expires="1300000"/u);assert.equal(pool.state.intent.return_path,'/workbench');
    const script=start.body.match(/<script type="module" src="([^"]+)"/u)?.[1];assert.ok(script?.startsWith('/workbench/desktop/assets/'));
    const asset=responseRecorder();await auth.unauthenticatedHandler({request:{method:'GET',headers:{}},response:asset,url:new URL(script,origin)});assert.equal(asset.status,200);assert.match(asset.headers['content-type'],/javascript/u);assert.ok(Buffer.isBuffer(asset.body));
    const unknown=responseRecorder();await auth.unauthenticatedHandler({request:{method:'GET',headers:{}},response:unknown,url:new URL(origin+'/workbench/desktop/assets/unknown.js')});assert.equal(unknown.status,404);
    assert.equal(await auth.unauthenticatedHandler({request:{method:'GET',headers:{}},response:responseRecorder(),url:new URL(origin+'/workbench/app/assets/unknown.js')}),false);
    const callback=responseRecorder();await auth.unauthenticatedHandler({request:{method:'GET',headers:{cookie:'__Host-wecom_workbench_intent='+binding}},response:callback,url:new URL(origin+'/workbench/callback?code=embedded-code&state='+state)});assert.equal(callback.status,303);assert.equal(callback.headers.location,'/workbench/app/');
    await assert.rejects(auth.unauthenticatedHandler({request:{method:'GET',headers:{cookie:'__Host-wecom_workbench_intent='+binding}},response:responseRecorder(),url:new URL(origin+'/workbench/callback?code=embedded-code&state='+state)}),{code:WORKBENCH_ERROR_CODES.authStateInvalid});
    const existing=responseRecorder();await auth.unauthenticatedHandler({request:{method:'GET',headers:{cookie:'__Host-wecom_workbench_session='+cookieValue(callback.headers,'__Host-wecom_workbench_session')}},response:existing,url:new URL(origin+'/workbench/desktop/embedded')});assert.equal(existing.status,303);assert.equal(existing.headers.location,'/workbench/app/');
    for(const [method,suffix] of [['GET','?return_to=x'],['POST','']])await assert.rejects(auth.unauthenticatedHandler({request:{method,headers:{}},response:responseRecorder(),url:new URL(origin+'/workbench/desktop/embedded'+suffix)}));
  }finally{await auth.close();}
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
