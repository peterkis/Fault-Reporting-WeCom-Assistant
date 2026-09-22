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

async function authFixture(run) {
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016authfix',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});await migrateWorkbenchAuth({databaseUrl});
    const principal=(await pool.query("INSERT INTO pilot_ticket.pilot_principal(wecom_user_id,display_name) VALUES ('raw-staff','Staff') RETURNING id::text")).rows[0].id;
    await pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES ($1,'HANDLER')",[principal]);
    const options={pool,publicOrigin:origin,corpId:'ww-fixture',agentId:'1000001',identityHashKey:'synthetic-identity-key-1234567890',accessTokenProvider:async()=> 'synthetic-token'};
    const mapped=()=>response({errcode:0,open_userid_list:[{userid:'raw-staff',open_userid:'open-staff'}]});
    await run({pool,principal,options,mapped});
  }});
}
async function loginIntent(auth,code='code') {
  const start=recorder();
  await auth.unauthenticatedHandler({request:{method:'GET',headers:{}},response:start,url:new URL(origin+'/workbench/login')});
  return {request:{method:'GET',headers:{cookie:'__Host-wecom_workbench_intent='+cookieValue(start.headers,'__Host-wecom_workbench_intent')}},
    response:recorder(),url:new URL(`${origin}/workbench/callback?code=${code}&state=${new URL(start.headers.location).searchParams.get('state')}`)};
}

test('busy callback preserves the second login intent and permits retry without consuming its code',async()=>{
  await authFixture(async({pool,options,mapped})=>{
    let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
    const codes=[];
    const auth=createWeComWorkbenchAuthentication({...options,fetchImpl:async url=>{
      if(url.pathname.endsWith('userid_to_openuserid'))return mapped();
      codes.push(url.searchParams.get('code'));entered();await held;return response({errcode:0,userid:'open-staff'});
    }});
    await auth.initialize();const first=await loginIntent(auth,'first'),second=await loginIntent(auth,'second');
    const pending=auth.unauthenticatedHandler(first);
    try{
      await started;
      await assert.rejects(auth.unauthenticatedHandler(second),{code:'WORKBENCH_AUTH_BUSY',status:503});
      assert.deepEqual(codes,['first']);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.workbench_login_intent WHERE consumed_epoch_ms IS NULL')).rows[0].n,1);
    }finally{release();await pending;}
    await auth.unauthenticatedHandler(second);assert.equal(second.response.status,303);
    assert.deepEqual(codes,['first','second']);
    await assert.rejects(auth.unauthenticatedHandler(second),{code:'WORKBENCH_AUTH_STATE_INVALID'});
    await auth.close();
  });
});

test('audit pseudonyms are stable for one key and change when the audit key changes',async()=>{
  await authFixture(async({pool,options,mapped})=>{
    const hashes=[];
    for(const identityHashKey of ['audit-key-a-12345678901234567890','audit-key-a-12345678901234567890','audit-key-b-12345678901234567890']){
      const auth=createWeComWorkbenchAuthentication({...options,identityHashKey,fetchImpl:async url=>url.pathname.endsWith('userid_to_openuserid')?mapped():response({errcode:0,userid:'open-staff'})});
      await auth.initialize();await auth.unauthenticatedHandler(await loginIntent(auth));await auth.close();
      hashes.push((await pool.query("SELECT identity_hash FROM pilot_ticket.workbench_auth_event WHERE event_type='LOGIN_SUCCEEDED' ORDER BY id DESC LIMIT 1")).rows[0].identity_hash);
    }
    assert.equal(hashes[0],hashes[1]);assert.notEqual(hashes[0],hashes[2]);
    assert.throws(()=>createWeComWorkbenchAuthentication({...options,identityHashKey:undefined}),/WORKBENCH_AUTH_CONFIGURATION_INVALID/);
  });
});

test('anonymous login burst is limited before database writes and recovers after the window',async()=>{
  await authFixture(async({pool,options,mapped})=>{
    let epoch=Date.now();const auth=createWeComWorkbenchAuthentication({...options,now:()=>epoch,loginRequestsPerMinute:3,fetchImpl:async()=>mapped()});
    await auth.initialize();
    for(let i=0;i<3;i++)await loginIntent(auth);
    await assert.rejects(loginIntent(auth),{code:'WORKBENCH_AUTH_RATE_LIMITED',status:429});
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.workbench_login_intent')).rows[0].n,3);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.workbench_auth_event')).rows[0].n,3);
    epoch+=60000;await loginIntent(auth);await auth.close();
  });
});

test('maintenance removes expired technical records in bounded batches and retains live sessions and recent audit',async()=>{
  await authFixture(async({pool,options,mapped})=>{
    let epoch=Date.now()-31*86400000;
    const auth=createWeComWorkbenchAuthentication({...options,now:()=>epoch,fetchImpl:async url=>url.pathname.endsWith('userid_to_openuserid')?mapped():response({errcode:0,userid:'open-staff'})});
    await auth.initialize();await auth.unauthenticatedHandler(await loginIntent(auth));
    await pool.query("UPDATE pilot_ticket.workbench_auth_event SET occurred_at=platform.local_from_epoch_ms($1)",[epoch]);
    // Populate an expired technical backlog without creating business facts.
    await pool.query(`INSERT INTO pilot_ticket.workbench_login_intent(state_hash,browser_binding_hash,return_path,created_epoch_ms,created_at,expires_epoch_ms,expires_at)
      SELECT lpad(to_hex(i),64,'0'),repeat('a',64),'/workbench',$1,platform.local_from_epoch_ms($1),$1::bigint+300000,platform.local_from_epoch_ms($1::bigint+300000) FROM generate_series(1,204) i`,[epoch]);
    epoch=Date.now();const live=await loginIntent(auth);await auth.unauthenticatedHandler(live);
    const cookie=live.response.headers['set-cookie'].map(v=>v.split(';')[0]).join('; ');
    const removed=await auth.runMaintenance();
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.workbench_login_intent')).rows[0].n,6);
    assert.equal(removed.intents,200);assert.equal(removed.sessions,1);assert.equal(removed.events,2);
    assert.ok(await auth.authenticate({headers:{cookie}}));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.workbench_auth_event')).rows[0].n,2);
    assert.equal((await auth.runMaintenance()).intents,5);
    assert.equal((await auth.runMaintenance()).intents,0);
    await auth.close();
  });
});

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
      identityHashKey:'synthetic-identity-key-1234567890',
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
