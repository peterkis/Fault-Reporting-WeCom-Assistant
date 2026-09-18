import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createYxxSelfServiceNativeHttp } from '../src/yxx-self-service-native-http.mjs';

const recoveryBindingSecret = 'ss007-http-recovery-secret-0123456789abcdef';

test('SS-007 native write UI requires an explicit member write flag while read APIs remain available', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  const csrf = 'csrf-member-write-012345678901234567890';
  let native, writeFlag, profile, writes = 0;
  const server = createServer(async (request, response) => {
    if (!await native.handler({ request, response, url: new URL(request.url, origin) })) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { cookie: '__Host-wecom_session=synthetic', origin, 'content-type': 'application/json', 'x-csrf-token': csrf };
  try {
    for (profile of ['MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP']) {
      native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, profile, featureFlags: flags, recoveryBindingSecret,
        oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
        authenticateMember: async () => ({ profile, flags, write_flag: writeFlag, csrf_token: csrf,
          canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-write', source_app_scope: 'app-write' }),
        command: { accept() { writes++; } }, supplement: { accept() { writes++; } },
        query: { list: () => ({ items: [] }), detailWithEtag: () => ({ status: 200, body: {} }), timeline() {}, commandStatus() {} } });
      for (writeFlag of [false, undefined, 'true']) {
        for (const path of ['/api/yixiaoxiu/bootstrap', '/wecom/yixiaoxiu/', '/wecom/yixiaoxiu/reports/new', `/wecom/yixiaoxiu/reports/${'A'.repeat(32)}`]) {
          const response = await fetch(origin + path, { headers });
          assert.equal(response.status, 403, `${profile} ${String(writeFlag)} ${path}`);
          assert.doesNotMatch(await response.text(), /self-service\.js|<form/u);
        }
        for (const path of ['/api/yixiaoxiu/requests', `/api/yixiaoxiu/requests/${'A'.repeat(32)}/supplements`]) {
          assert.equal((await fetch(origin + path, { method: 'POST', headers, body: '{}' })).status, 403);
        }
        assert.equal((await fetch(origin + '/api/yixiaoxiu/my-reports', { headers })).status, 200);
      }
      writeFlag = true;
      const response = await fetch(origin + '/api/yixiaoxiu/bootstrap', { headers });
      assert.equal(response.status, 200);
      const bootstrap = await response.json();
      assert.equal(bootstrap.can_submit, true); assert.equal(bootstrap.can_supplement, true);
      assert.equal((await fetch(origin + '/wecom/yixiaoxiu/reports/new', { headers })).status, 200);
    }
    assert.equal(writes, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SS-007 command recovery rejects every query before dispatch or route fallthrough', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  let native, queries = 0, fallthrough = 0;
  const server = createServer(async (request, response) => {
    if (!await native.handler({ request, response, url: new URL(request.url, origin) })) { fallthrough++; response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, featureFlags: flags, recoveryBindingSecret,
    oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
    authenticateMember: async () => ({ profile: 'MEMBER_SELF_SERVICE', flags, write_flag: true,
      csrf_token: 'csrf-command-012345678901234567890123', canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-command', source_app_scope: 'app-command' }),
    command: { accept() {} }, supplement: { accept() {} },
    query: { list() {}, detailWithEtag() {}, timeline() {}, commandStatus() { queries++; return {}; } } });
  const path = '/api/yixiaoxiu/commands/00000000-0000-4000-8000-000000000001';
  const headers = { cookie: '__Host-wecom_session=synthetic' };
  try {
    for (const query of ['?extra=1', '?cursor=', '?extra=1&extra=2', '?%65xtra=1']) {
      const response = await fetch(origin + path + query, { headers });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'YXX_INPUT_INVALID', retryable: false } });
    }
    assert.equal(queries, 0); assert.equal(fallthrough, 0);
    for (const id of ['not-a-uuid', 'g'.repeat(36), '0'.repeat(35), '', '00000000-0000-0000-0000-000000000000', 'bad/extra']) {
      const response = await fetch(origin + '/api/yixiaoxiu/commands/' + id, { headers });
      assert.equal(response.status, 400, id);
      assert.deepEqual(await response.json(), { error: { code: 'YXX_INPUT_INVALID', retryable: false } });
    }
    assert.equal(queries, 0); assert.equal(fallthrough, 0);
    assert.equal((await fetch(origin + path, { headers })).status, 200);
    assert.equal(queries, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SS-007 malformed request references return 400 without dispatch or fallthrough', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  let native, calls = 0, fallthrough = 0;
  const server = createServer(async (request, response) => {
    if (!await native.handler({ request, response, url: new URL(request.url, origin) })) { fallthrough++; response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, csrf = 'csrf-request-route-01234567890123456789';
  const unknown = () => { calls++; throw Object.assign(new Error('unknown'), { status: 404, code: 'YXX_NOT_FOUND' }); };
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, featureFlags: flags, recoveryBindingSecret,
    oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
    authenticateMember: async () => ({ profile: 'MEMBER_SELF_SERVICE', flags, write_flag: true, csrf_token: csrf,
      canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-ref', source_app_scope: 'app-ref' }),
    command: { accept() {} }, supplement: { accept: unknown },
    query: { list() {}, detailWithEtag: unknown, timeline: unknown, commandStatus() {} } });
  const headers = { cookie: '__Host-wecom_session=synthetic', origin, 'content-type': 'application/json', 'x-csrf-token': csrf };
  try {
    for (const [method, suffix] of [['GET', ''], ['GET', '/timeline'], ['POST', '/supplements']]) {
      for (const ref of ['not-a-ref', '', 'A'.repeat(31), 'A'.repeat(33), '%21'.repeat(32), 'bad/extra']) {
        const response = await fetch(origin + '/api/yixiaoxiu/requests/' + ref + suffix, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) });
        assert.equal(response.status, 400, method + ' ' + ref + suffix);
        assert.deepEqual(await response.json(), { error: { code: 'YXX_INPUT_INVALID', retryable: false } });
      }
    }
    assert.equal(calls, 0); assert.equal(fallthrough, 0);
    for (const [method, suffix] of [['GET', ''], ['GET', '/timeline'], ['POST', '/supplements']]) {
      assert.equal((await fetch(origin + '/api/yixiaoxiu/requests/' + 'A'.repeat(32) + suffix, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) })).status, 404);
    }
    assert.equal(calls, 3); assert.equal(fallthrough, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SS-007 native factory accepts only the OAuth callback session cookie', () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  const config = { publicOrigin: 'http://127.0.0.1:3000', oauth: { authenticate() {} }, oauthHttp() {},
    command: { accept() {} }, supplement: { accept() {} }, query: { list() {}, detailWithEtag() {}, timeline() {}, commandStatus() {} },
    authenticateMember() {}, featureFlags: flags, recoveryBindingSecret };
  assert.doesNotThrow(() => createYxxSelfServiceNativeHttp(config));
  assert.doesNotThrow(() => createYxxSelfServiceNativeHttp({ ...config, sessionCookieName: '__Host-wecom_session' }));
  assert.throws(() => createYxxSelfServiceNativeHttp({ ...config, sessionCookieName: 'yxx_session' }), { code: 'YXX_CONFIG_INVALID', status: 503 });
});

test('SS-007 dependency failures remain terminal service or permission failures', async () => {
  let failure = new Error('private dependency detail');
  let oauthFailure = null;
  let beginFailure = null;
  let delegated = 0;
  let returnPath = null;
  let native;
  const server = createServer(async (request, response) => {
    await native.handler({ request, response, url: new URL(request.url, origin) });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin,
    oauth: { authenticate() { if (oauthFailure) throw oauthFailure; return {}; },
      begin(input) { if (beginFailure) throw beginFailure; returnPath = input.returnPath; return { location: origin + '/synthetic-authorize?state=' + 'a'.repeat(64), browserToken: 'synthetic' }; } },
    oauthHttp: async ({ response }) => { delegated++; response.writeHead(401); response.end(); return true; },
    command: { accept() {} }, supplement: { accept() {} },
    query: { list() {}, detailWithEtag() {}, timeline() {}, commandStatus() {} },
    authenticateMember: async () => { throw failure; },
    featureFlags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true },
    recoveryBindingSecret,
  });
  try {
    for (const status of [503, 403]) {
      failure = Object.assign(new Error('private dependency detail'), { status, code: status === 503 ? 'DEPENDENCY_DOWN' : 'MEMBER_DENIED' });
      for (const path of ['/api/yixiaoxiu/bootstrap', '/wecom/yixiaoxiu/', '/wecom/yixiaoxiu/reports/new']) {
        const response = await fetch(origin + path, { headers: { cookie: '__Host-wecom_session=synthetic' }, redirect: 'manual' });
        assert.equal(response.status, status, path);
        assert.equal(response.headers.has('location'), false);
        const text = await response.text();
        assert.doesNotMatch(text, /private dependency detail|DEPENDENCY_DOWN|MEMBER_DENIED/);
        if (status === 403 && path !== '/api/yixiaoxiu/bootstrap') assert.match(text, /当前账号没有此项权限/u);
      }
    }
    failure = new Error('private database error');
    assert.equal((await fetch(origin + '/api/yixiaoxiu/bootstrap', { headers: { cookie: '__Host-wecom_session=synthetic' } })).status, 503);
    oauthFailure = Object.assign(new Error('closed provider'), { status: 503, code: 'WECOM_AUTH_UNAVAILABLE' });
    assert.equal((await fetch(origin + '/api/yixiaoxiu/bootstrap', { headers: { cookie: '__Host-wecom_session=synthetic' } })).status, 503);
    assert.equal(delegated, 0);
    const unauthenticatedPage = await fetch(origin + '/wecom/yixiaoxiu/reports/new', { redirect: 'manual' });
    assert.equal(unauthenticatedPage.status, 302);
    assert.equal(returnPath, '/wecom/yixiaoxiu/?auth_return=1');
    beginFailure = Object.assign(new Error('closed OAuth gate'), { status: 503, code: 'WECOM_AUTH_UNAVAILABLE' });
    const failedNativePage = await fetch(origin + '/wecom/yixiaoxiu/reports/new', { redirect: 'manual' });
    assert.equal(failedNativePage.status, 503);
    assert.match(failedNativePage.headers.get('content-type') ?? '', /^text\/html/u);
    assert.equal(failedNativePage.headers.has('location'), false);
    assert.doesNotMatch(await failedNativePage.text(), /closed OAuth gate|WECOM_AUTH_UNAVAILABLE/u);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SS-007 JSON bodies reject duplicate decoded keys before commands', async () => {
  let calls = 0, native, commandFailure = null;
  const csrf = 'synthetic-csrf-at-least-thirty-two-characters';
  const server = createServer(async (request, response) => {
    await native.handler({ request, response, url: new URL(request.url, origin) });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, oauth: { authenticate: () => ({}) },
    oauthHttp: async () => false,
    command: { accept: async ({ input }) => { if(commandFailure)throw commandFailure; calls++; return { receipt: {
      client_command_id: input.client_command_id ?? '00000000-0000-4000-8000-000000000001', request_ref: 'A'.repeat(32), status: 'ACCEPTED',
      intake_no: 'INT-20260917-0001', accepted_revision: '1', accepted_at: '2026-09-17 09:00:00', accepted_epoch_ms: '1789606800000' } }; } },
    supplement: { accept() {} }, query: { list() {}, detailWithEtag() {}, timeline() {}, commandStatus() {} },
    authenticateMember: async () => ({ profile: 'MEMBER_SELF_SERVICE', write_flag: true, flags, csrf_token: csrf,
      canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-http', source_app_scope: 'app-http' }), featureFlags: flags,
    recoveryBindingSecret,
  });
  const send = body => fetch(origin + '/api/yixiaoxiu/requests', { method: 'POST', headers: {
    origin, cookie: '__Host-wecom_session=synthetic', 'content-type': 'application/json', 'x-csrf-token': csrf,
  }, body });
  try {
    for (const body of ['{"description":"a","description":"b"}',
      '{"location":{"text":"a","text":"b"}}',
      '{"location":{"text":"a","te\\u0078t":"b"}}',
      '{"a":[{"k":1,"k":2}]}']) {
      const response = await send(body);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'YXX_INPUT_INVALID');
    }
    assert.equal(calls, 0);
    assert.equal((await send('{"a":{"k":1},"b":{"k":2},"text":"literal \\"k\\": text"}')).status, 202);
    assert.equal(calls, 1, 'equal keys in different objects and punctuation inside strings remain valid');
    commandFailure = Object.assign(new Error('private input detail'), { status: 400, code: 'P2_016_INPUT_INVALID' });
    const invalid = await send('{}');
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: { code: 'YXX_INPUT_INVALID', retryable: false } });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SS-007 recovery scope is stable across CSRF rotation and separates protected member scopes', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  const context = { profile: 'MEMBER_SELF_SERVICE', write_flag: true, flags, csrf_token: 'csrf-one-0123456789012345678901234567',
    canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-one', source_app_scope: 'app-one' };
  let native;
  const server = createServer(async (request, response) => native.handler({ request, response, url: new URL(request.url, origin) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
    command: { accept() {} }, supplement: { accept() {} }, query: { list() {}, detailWithEtag() {}, timeline() {}, commandStatus() {} },
    authenticateMember: async () => ({ ...context }), featureFlags: flags, recoveryBindingSecret });
  const bootstrap = async () => (await fetch(origin + '/api/yixiaoxiu/bootstrap', { headers: { cookie: '__Host-wecom_session=synthetic' } })).json();
  try {
    const first = await bootstrap();
    context.csrf_token = 'csrf-two-0123456789012345678901234567';
    const rotated = await bootstrap();
    assert.equal(rotated.recovery_scope, first.recovery_scope);
    context.canonical_reporter_binding = 'b'.repeat(64);
    const otherMember = await bootstrap();
    assert.notEqual(otherMember.recovery_scope, first.recovery_scope);
    context.canonical_reporter_binding = 'a'.repeat(64); context.source_app_scope = 'app-two';
    const otherApp = await bootstrap();
    assert.notEqual(otherApp.recovery_scope, first.recovery_scope);
    context.source_app_scope = 'app-one'; context.source_corp_scope = 'corp-two';
    const otherCorp = await bootstrap();
    assert.notEqual(otherCorp.recovery_scope, first.recovery_scope);
    assert.equal('canonical_reporter_binding' in first, false);
    assert.equal('source_corp_scope' in first, false);
    assert.equal('source_app_scope' in first, false);
    assert.doesNotMatch(JSON.stringify(first), /corp-one|app-one|a{64}/u);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('SS-007 direct detail pages enforce ownership before rendering the shell', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  let native, outcome = 200, calls = 0;
  const server = createServer(async (request, response) => native.handler({ request, response, url: new URL(request.url, origin) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
    command: { accept() {} }, supplement: { accept() {} },
    query: { list() {}, timeline() {}, commandStatus() {}, async detailWithEtag(input) {
      calls++; assert.equal(input.requestRef, 'A'.repeat(32)); assert.equal(input.ifNoneMatch, undefined);
      if (outcome !== 200) throw Object.assign(new Error('private ownership detail'), { status: outcome, code: 'YXX_NOT_FOUND' });
      return { status: 200, body: {} };
    } },
    authenticateMember: async () => ({ profile: 'MEMBER_SELF_SERVICE', write_flag: true, flags, csrf_token: 'csrf-page-0123456789012345678901234567',
      canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-page', source_app_scope: 'app-page' }),
    featureFlags: flags, recoveryBindingSecret });
  try {
    for (const status of [200, 404, 503]) {
      outcome = status;
      const response = await fetch(origin + '/wecom/yixiaoxiu/reports/' + 'A'.repeat(32), { headers: { cookie: '__Host-wecom_session=synthetic', 'if-none-match': 'untrusted' }, redirect: 'manual' });
      assert.equal(response.status, status);
      const html = await response.text();
      if (status === 200) assert.match(html, /self-service.js/);
      else assert.doesNotMatch(html, /self-service.js|private ownership detail/);
      assert.equal(response.headers.has('location'), false);
    }
    assert.equal(calls, 3);
    for (const path of ['/wecom/yixiaoxiu/reports', '/wecom/yixiaoxiu/reports/new']) assert.equal((await fetch(origin + path, { headers: { cookie: '__Host-wecom_session=synthetic' } })).status, 200);
    assert.equal(calls, 3);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SS-007 detail rejects an oversized If-None-Match before query dispatch', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  let native; let detailCalls = 0;
  const server = createServer(async (request, response) => native.handler({ request, response, url: new URL(request.url, origin) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
    command: { accept() {} }, supplement: { accept() {} },
    query: { list() {}, timeline() {}, commandStatus() {}, detailWithEtag() { detailCalls += 1; } },
    authenticateMember: async () => ({ profile: 'MEMBER_SELF_SERVICE', write_flag: true, flags, csrf_token: 'csrf-etag-0123456789012345678901234567',
      canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-etag', source_app_scope: 'app-etag' }),
    featureFlags: flags, recoveryBindingSecret });
  try {
    const response = await fetch(`${origin}/api/yixiaoxiu/requests/${'A'.repeat(32)}`, {
      headers: { cookie: '__Host-wecom_session=synthetic', 'if-none-match': 'x'.repeat(257) },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'YXX_INPUT_INVALID', retryable: false } });
    assert.equal(detailCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('SS-007 report source filters reject explicit empty and unknown values before querying', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  let native; const sources = [];
  const server = createServer(async (request, response) => native.handler({ request, response, url: new URL(request.url, origin) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
    command: { accept() {} }, supplement: { accept() {} },
    query: { async list(input) { sources.push(input.source); return { items: [], next_cursor: null }; }, detailWithEtag() {}, timeline() {}, commandStatus() {} },
    authenticateMember: async () => ({ profile: 'MEMBER_SELF_SERVICE', write_flag: true, flags, csrf_token: 'csrf-filter-0123456789012345678901234567',
      canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-filter', source_app_scope: 'app-filter' }),
    featureFlags: flags, recoveryBindingSecret });
  try {
    const get = suffix => fetch(origin + '/api/yixiaoxiu/my-reports' + suffix, { headers: { cookie: '__Host-wecom_session=synthetic' } });
    for (const suffix of ['?source=', '?source', '?source=web', '?source=ALL', '?source=%20', '?source=WEB&source=BOT']) {
      const response = await get(suffix); assert.equal(response.status, 400, suffix);
      assert.equal((await response.json()).error.code, 'YXX_INPUT_INVALID');
    }
    assert.deepEqual(sources, []);
    for (const suffix of ['', '?source=WEB', '?source=BOT']) assert.equal((await get(suffix)).status, 200);
    assert.deepEqual(sources, [null, 'WEB', 'BOT']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SS-007 timeline rejects an explicitly empty cursor before querying', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  let native; let timelineCalls = 0;
  const server = createServer(async (request, response) => native.handler({ request, response, url: new URL(request.url, origin) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
    command: { accept() {} }, supplement: { accept() {} },
    query: { list() {}, detailWithEtag() {}, async timeline() { timelineCalls += 1; return { items: [], next_cursor: null }; }, commandStatus() {} },
    authenticateMember: async () => ({ profile: 'MEMBER_SELF_SERVICE', write_flag: true, flags, csrf_token: 'csrf-timeline-0123456789012345678901234567',
      canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-timeline', source_app_scope: 'app-timeline' }),
    featureFlags: flags, recoveryBindingSecret });
  try {
    const response = await fetch(`${origin}/api/yixiaoxiu/requests/${'A'.repeat(32)}/timeline?cursor=`, {
      headers: { cookie: '__Host-wecom_session=synthetic' },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: 'YXX_INPUT_INVALID', retryable: false } });
    assert.equal(timelineCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('SS-007 write routes reject unknown query parameters before invoking commands', async () => {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  const csrf = 'csrf-write-query-0123456789012345678901234567';
  const requestRef = 'A'.repeat(32);
  let commandCalls = 0; let supplementCalls = 0; let native;
  const server = createServer(async (request, response) => native.handler({ request, response, url: new URL(request.url, origin) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, oauth: { authenticate: () => ({}) }, oauthHttp: async () => false,
    command: { async accept() { commandCalls += 1; return {}; } },
    supplement: { async accept() { supplementCalls += 1; return {}; } },
    query: { list() {}, detailWithEtag() {}, timeline() {}, commandStatus() {} },
    authenticateMember: async () => ({ profile: 'MEMBER_SELF_SERVICE', write_flag: true, flags, csrf_token: csrf,
      canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp-write-query', source_app_scope: 'app-write-query' }),
    featureFlags: flags, recoveryBindingSecret,
  });
  const headers = { origin, cookie: '__Host-wecom_session=synthetic', 'content-type': 'application/json', 'x-csrf-token': csrf, 'sec-fetch-site': 'same-origin' };
  const commandBody = JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000010', description: '网页报修', location: { text: '护士站', unknown: false },
    service_code: null, impact_scope: 'UNKNOWN', reported_department_text: null, extension: null });
  const supplementBody = JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000011', expected_input_revision: '1', text: '补充事实' });
  const suffixes = ['?foo=bar', '?foo', '?foo=', '?a=1&a=2'];
  try {
    for (const suffix of suffixes) {
      const commandResponse = await fetch(origin + '/api/yixiaoxiu/requests' + suffix, { method: 'POST', headers, body: commandBody });
      assert.equal(commandResponse.status, 400, `command ${suffix}`);
      assert.deepEqual(await commandResponse.json(), { error: { code: 'YXX_INPUT_INVALID', retryable: false } });
      const supplementResponse = await fetch(origin + `/api/yixiaoxiu/requests/${requestRef}/supplements${suffix}`, { method: 'POST', headers, body: supplementBody });
      assert.equal(supplementResponse.status, 400, `supplement ${suffix}`);
      assert.deepEqual(await supplementResponse.json(), { error: { code: 'YXX_INPUT_INVALID', retryable: false } });
    }
    assert.equal(commandCalls, 0);
    assert.equal(supplementCalls, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('SS-007 logout rejects unknown query and body fields without clearing sessions', async () => {
  let native; const loggedOut = [];
  const server = createServer(async (request, response) => {
    if (!await native.handler({ request, response, url: new URL(request.url, origin) })) { response.writeHead(418); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  native = createYxxSelfServiceNativeHttp({ publicOrigin: origin, oauth: { authenticate: () => ({}), logout: token => loggedOut.push(token) }, oauthHttp: async () => false,
    command: { accept() {} }, supplement: { accept() {} }, query: { list() {}, detailWithEtag() {}, timeline() {}, commandStatus() {} },
    authenticateMember: async () => ({}), recoveryBindingSecret });
  const send = (suffix, body, requestOrigin = origin) => fetch(origin + '/wecom/yixiaoxiu/logout' + suffix, { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', cookie: '__Host-wecom_session=synthetic' }, body });
  try {
    for (const [suffix, body] of [['?extra=1','{}'],['','{"extra":true}'],['','[]'],['','null']]) {
      const response = await send(suffix, body); assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'YXX_ENTRY_INPUT_INVALID', retryable: false } });
      assert.equal(response.headers.has('set-cookie'), false);
    }
    assert.deepEqual(loggedOut, []);
    const originFailure = await send('', '{}', 'https://other.invalid');
    assert.equal(originFailure.status, 403);
    assert.deepEqual(await originFailure.json(), { error: { code: 'YXX_ENTRY_ORIGIN_INVALID', retryable: false } });
    assert.deepEqual(loggedOut, []);
    const contentTypeFailure = await fetch(origin + '/wecom/yixiaoxiu/logout', { method: 'POST', headers: { origin, cookie: '__Host-wecom_session=synthetic' }, body: '{}' });
    assert.equal(contentTypeFailure.status, 400);
    assert.deepEqual(await contentTypeFailure.json(), { error: { code: 'YXX_ENTRY_INPUT_INVALID', retryable: false } });
    assert.deepEqual(loggedOut, []);
    const accepted = await send('', '{}'); assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { logged_out: true });
    assert.deepEqual(loggedOut, ['synthetic']);
    assert.match(accepted.headers.get('set-cookie'), /__Host-wecom_session=;.*Max-Age=0/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
