import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createYxxSelfServiceNativeHttp } from '../src/yxx-self-service-native-http.mjs';
import { launchSystemBrowser, closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';

const FLAGS = Object.freeze({ YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true });
const REFS = Object.freeze({ A: 'A'.repeat(32), B: 'B'.repeat(32) });

function fixture(origin) {
  const state = { commandCalls: [], supplementCalls: [], detailCalls: [], timelineCalls: [], next: 0, supplementConflict: false };
  const memberFor = (request) => (request.headers.cookie ?? '').includes('member-b') ? 'B' : 'A';
  const oauth = {
    authenticate(token) {
      if (!['member-a', 'member-b'].includes(token)) throw new Error('expired');
      return { userid: token };
    },
    logout() {},
    begin() { return { location: `${origin}/wecom/yixiaoxiu/login?state=synthetic`, browserToken: 'synthetic-browser-token' }; },
  };
  const context = async ({ sessionToken }) => ({
    profile: 'MEMBER_SELF_SERVICE', flags: FLAGS, csrf_token: `csrf-${sessionToken}`,
  });
  const receipt = requestRef => ({ request_ref: requestRef, status: 'ACCEPTED' });
  const command = {
    async accept({ request, input }) {
      state.commandCalls.push({ member: memberFor(request), input });
      const requestRef = state.next++ % 2 === 0 ? REFS.A : REFS.B;
      return { replayed: false, receipt: receipt(requestRef) };
    },
  };
  const supplement = {
    async accept({ request, requestRef, input }) {
      state.supplementCalls.push({ member: memberFor(request), requestRef, input });
      if (state.supplementConflict) { const error = new Error('version'); error.code = 'YXX_VERSION_CONFLICT'; throw error; }
      return { replayed: false, receipt: receipt(requestRef) };
    },
  };
  const query = {
    async list({ request }) {
      const member = memberFor(request);
      return { schema_version: 1, items: [{ kind: 'WEB_REQUEST', ref: REFS[member], intake_no: `YXX-${member}`, display_status: '已收到', created_at: '2026-09-16 23:00:00', ticket: null }], next_cursor: null };
    },
    async detailWithEtag({ request, requestRef, ifNoneMatch }) {
      state.detailCalls.push({ member: memberFor(request), requestRef, ifNoneMatch });
      const etag = `"${requestRef}-v1"`;
      if (ifNoneMatch === etag) return { status: 304, body: null, etag };
      return { status: 200, etag, body: { schema_version: 1, source_kind: 'WEB_REQUEST', request_ref: requestRef,
        intake_no: `YXX-${requestRef.slice(0, 4)}`, display_status: '待补充', input_revision: '1', processed_revision: '0',
        updated_at: '2026-09-16 23:00:00', safe_description: '<img src=x onerror=window.__xss=1>', supplements: [], can_supplement: true, ticket: null } };
    },
    async timeline({ request, requestRef, limit }) {
      state.timelineCalls.push({ member: memberFor(request), requestRef, limit });
      return { schema_version: 1, items: [{ event_type: 'intake.accepted', summary: '已收到报修', occurred_at: '2026-09-16 23:00:00' }], next_cursor: null };
    },
    async commandStatus({ request, clientCommandId }) { return { status: 'ACCEPTED', client_command_id: clientCommandId, member: memberFor(request) }; },
  };
  const oauthHttp = async ({ response }) => { response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' }); response.end('<p>旧认证提示</p>'); return true; };
  const config = { publicOrigin: origin, oauth, oauthHttp, command, supplement, query,
    authenticateMember: context, featureFlags: FLAGS, sessionCookieName: 'yxx_session' };
  return { native: createYxxSelfServiceNativeHttp(config), config, state, oauth };
}

async function startFixture({ enabled = true } = {}) {
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${reservation.address().port}`;
  await new Promise(resolve => reservation.close(resolve));
  const values = fixture(origin);
  const native = enabled ? values.native : createYxxSelfServiceNativeHttp({ ...values.config, featureFlags: { ...FLAGS, YIXIAOXIU_SELF_SERVICE_ENABLED: false } });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const handled = await native.handler({ request, response, url });
    if (!handled && !response.writableEnded) { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(Number(new URL(origin).port), '127.0.0.1', resolve));
  return { origin, server, ...values };
}

async function closeServer(server) { await new Promise(resolve => server.close(resolve)); }

test('SS-007 native HTTP keeps the fixed homepage gate and closed API boundary', async () => {
  const fixtureState = await startFixture();
  const disabledState = await startFixture({ enabled: false });
  try {
    const { origin, state } = fixtureState;
    const get = (path, headers = {}) => fetch(origin + path, { headers });
    const root = await get('/wecom/yixiaoxiu/', { cookie: 'yxx_session=member-a' });
    assert.equal(root.status, 200);
    assert.match(await root.text(), /自助报修/u);
    const bootstrap = await get('/api/yixiaoxiu/bootstrap', { cookie: 'yxx_session=member-a' });
    assert.equal(bootstrap.status, 200);
    const bootstrapBody = await bootstrap.json();
    assert.equal(bootstrapBody.profile, 'MEMBER_SELF_SERVICE');
    assert.equal(bootstrapBody.write_enabled, true);
    assert.equal(typeof bootstrapBody.csrf_token, 'string');
    assert.equal((await get('/api/yixiaoxiu/bootstrap')).status, 401);
    const disabledRoot = await fetch(disabledState.origin + '/wecom/yixiaoxiu/', { headers: { cookie: 'yxx_session=member-a' } });
    assert.equal(disabledRoot.status, 401);
    assert.doesNotMatch(await disabledRoot.text(), /new-report-form|我的报修/u);
    const badOrigin = await fetch(origin + '/api/yixiaoxiu/requests', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin: 'https://attacker.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(badOrigin.status, 403);
    const badCsrf = await fetch(origin + '/api/yixiaoxiu/requests', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000000', 'x-csrf-token': 'wrong', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000000', description: '普通描述', location: { text: '护士站', unknown: false } }) });
    assert.equal(badCsrf.status, 403);
    assert.equal(state.commandCalls.length, 0);
    const accepted = await fetch(origin + '/api/yixiaoxiu/requests', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000001', 'x-csrf-token': 'csrf-member-a', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000001', description: '普通描述', location: { text: '护士站', unknown: false } }) });
    assert.equal(accepted.status, 202);
    assert.equal((await accepted.json()).location, `/wecom/yixiaoxiu/reports/${REFS.A}`);
    assert.equal(state.commandCalls.length, 1);
    const detail = await get(`/api/yixiaoxiu/requests/${REFS.A}`, { cookie: 'yxx_session=member-a' });
    assert.equal(detail.status, 200);
    const etag = detail.headers.get('etag');
    assert.equal((await get(`/api/yixiaoxiu/requests/${REFS.A}`, { cookie: 'yxx_session=member-a', 'if-none-match': etag })).status, 304);
    assert.equal((await get(`/api/yixiaoxiu/requests/${REFS.A}/timeline?limit=50`, { cookie: 'yxx_session=member-a' })).status, 200);
    assert.equal(state.timelineCalls.at(-1).limit, 50);
    const supplement = await fetch(origin + `/api/yixiaoxiu/requests/${REFS.A}/supplements`, { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000002', 'x-csrf-token': 'csrf-member-a', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000002', expected_input_revision: '1', text: '补充事实' }) });
    assert.equal(supplement.status, 202);
    assert.equal(state.supplementCalls.length, 1);
    fixtureState.state.supplementConflict = true;
    const conflict = await fetch(origin + `/api/yixiaoxiu/requests/${REFS.A}/supplements`, { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000003', 'x-csrf-token': 'csrf-member-a', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000003', expected_input_revision: '1', text: '旧版本' }) });
    assert.equal(conflict.status, 409);
    assert.equal((await fetch(origin + '/wecom/yixiaoxiu/logout', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{}' })).status, 200);
  } finally { await closeServer(fixtureState.server); await closeServer(disabledState.server); }
});

test('SS-007 native UI renders safely at phone and desktop sizes and keeps tabs isolated', { timeout: 120000 }, async () => {
  const fixtureState = await startFixture();
  const browsers = [];
  try {
    const { origin, state } = fixtureState;
    for (const [width, height] of [[390, 844], [1440, 900]]) {
      const browser = await launchSystemBrowser({ url: `${origin}/wecom/yixiaoxiu/`, width, height,
        cookies: [{ name: 'yxx_session', value: 'member-a', url: `${origin}/wecom/yixiaoxiu/` }] });
      browsers.push(browser);
      await browser.waitFor("document.querySelector('#home-view').hidden===false");
      assert.match(await browser.evaluate('document.cookie'), /yxx_session=member-a/u);
      assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'), false);
      assert.equal(await browser.evaluate("document.querySelectorAll('label[for]').length >= 7"), true);
      assert.equal(await browser.evaluate("document.body.textContent.includes('患者资料')"), true);
      assert.equal(await browser.evaluate("document.body.textContent.includes('工单号只在真实工单生成后出现')"), true);
      assert.equal(await browser.evaluate("document.querySelectorAll('script[src]').length"), 1);
      assert.equal(await browser.evaluate("document.querySelector('img')===null"), true);
      await browser.evaluate("document.querySelector('#new-report-link').click()");
      await browser.waitFor("document.querySelector('#new-view').hidden===false");
      await browser.waitFor("document.querySelector('#submit-report').disabled===false");
      const beforeCommands = state.commandCalls.filter(call => call.member === 'A').length;
      await browser.evaluate("document.querySelector('#description').value='网页故障';document.querySelector('#location-text').value='护士站';document.querySelector('#service-code').value='打印机';document.querySelector('#new-report-form').requestSubmit();document.querySelector('#new-report-form').requestSubmit()");
      await browser.waitFor("location.pathname.startsWith('/wecom/yixiaoxiu/reports/')");
      assert.equal(state.commandCalls.filter(call => call.member === 'A').length, beforeCommands + 1);
      assert.equal(state.commandCalls.at(-1).input.service_code, null);
      assert.equal(await browser.evaluate("document.querySelector('[onerror]')===null"), true);
      assert.equal(await browser.evaluate("window.__xss===undefined"), true);
      assert.equal(await browser.evaluate("sessionStorage.getItem('yxx.self_service.pending_command')"), null);
      assert.equal(await browser.evaluate("Object.keys(sessionStorage).every(key=>key==='yxx.self_service.pending_command')"), true);
      assert.equal(await browser.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
      await browser.waitFor("document.querySelector('#supplement-form').hidden===false");
      const beforeSupplements = state.supplementCalls.filter(call => call.member === 'A').length;
      await browser.evaluate("document.querySelector('#supplement-text').value='补充事实';document.querySelector('#supplement-form').requestSubmit();document.querySelector('#supplement-form').requestSubmit()");
      await browser.waitFor("document.querySelector('#submit-supplement').disabled===false");
      assert.equal(state.supplementCalls.filter(call => call.member === 'A').length, beforeSupplements + 1);
      const focused = await browser.evaluate("document.activeElement?.id");
      assert.equal(typeof focused, 'string');
    }
    const other = await launchSystemBrowser({ url: `${origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-b', url: `${origin}/wecom/yixiaoxiu/` }] });
    browsers.push(other);
    await other.waitFor("document.querySelector('#home-view').hidden===false");
    await other.evaluate("location.assign('/wecom/yixiaoxiu/reports')", { awaitPromise: false });
    await other.waitFor("document.querySelector('#reports-view').hidden===false");
    assert.equal(await other.evaluate("document.body.textContent.includes('B')"), true);
    assert.equal(await other.evaluate("document.body.textContent.includes('A')"), false);
    assert.equal(state.commandCalls.filter(call => call.member === 'B').length, 0);
    const source = await readFile(new URL('../web/p2-reporter/self-service.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|eval\(/u);
    assert.match(source, /AbortController/u);
    assert.match(source, /visibilitychange/u);
    assert.match(source, /state\.detailEtag=detail\.etag/u);
  } finally { await closeBrowserTestResources(browsers.map(browser => browser.close)); await closeServer(fixtureState.server); }
});
