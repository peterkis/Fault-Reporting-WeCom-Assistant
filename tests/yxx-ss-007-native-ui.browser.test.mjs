import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createYxxSelfServiceNativeHttp } from '../src/yxx-self-service-native-http.mjs';
import { launchSystemBrowser, closeBrowserTestResources } from './helpers/p2-006-browser-harness.mjs';
import { assertP2016Schema } from './helpers/p2-016-schema-assert.mjs';

const FLAGS = Object.freeze({ YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true });
const REFS = Object.freeze({ A: 'A'.repeat(32), B: 'B'.repeat(32) });
const RECOVERY_SECRET = 'ss007-recovery-secret-0123456789abcdef';
const csrfFor = token => `csrf-${token}-012345678901234567890123`;

function fixture(origin) {
  const state = { commandCalls: [], supplementCalls: [], listCalls: [], detailCalls: [], timelineCalls: [],
    commandStatusCalls: [], next: 0, supplementConflict: false };
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
    profile: 'MEMBER_SELF_SERVICE', flags: FLAGS, csrf_token: state.csrfOverride ?? csrfFor(sessionToken),
    canonical_reporter_binding: sessionToken === 'member-b' ? 'b'.repeat(64) : 'a'.repeat(64),
    source_corp_scope: 'corp-local', source_app_scope: 'app-local',
  });
  const receipt = requestRef => ({ request_ref: requestRef, status: 'ACCEPTED' });
  const command = {
    async accept({ request, input }) {
      if (state.commandError) throw state.commandError;
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
    async list({ request, cursor }) {
      const member = memberFor(request);
      state.listCalls.push({ member, cursor });
      if (state.paginatedLists && member === 'A') {
        if (cursor === 'page-2') return { schema_version: 1, items: [{ kind: 'WEB_REQUEST', ref: REFS.B, intake_no: 'YXX-PAGE-2', display_status: 'UNDER_REVIEW', created_at: '2026-09-16 22:00:00', ticket: null }], next_cursor: null };
        return { schema_version: 1, items: [{ kind: 'WEB_REQUEST', ref: REFS.A, intake_no: 'YXX-PAGE-1', display_status: 'RECEIVED_PROCESSING', created_at: '2026-09-16 23:00:00', ticket: null }], next_cursor: 'page-2' };
      }
      return { schema_version: 1, items: [{ kind: 'WEB_REQUEST', ref: REFS[member], intake_no: `YXX-${member}`, display_status: 'RECEIVED_PROCESSING', created_at: '2026-09-16 23:00:00', ticket: null }], next_cursor: null };
    },
    async detailWithEtag({ request, requestRef, ifNoneMatch }) {
      const member = memberFor(request);
      state.detailCalls.push({ member, requestRef, ifNoneMatch });
      if (state.detailNotFound) { const value = new Error('not found'); value.code = 'YXX_NOT_FOUND'; value.status = 404; throw value; }
      if (state.enforceOwnership && requestRef !== REFS[member]) { const value = new Error('not found'); value.code = 'YXX_NOT_FOUND'; value.status = 404; throw value; }
      const revision = state.detailRevision ?? '1';
      const etag = `"${requestRef}-v${revision}"`;
      if (ifNoneMatch === etag) return { status: 304, body: null, etag };
      return { status: 200, etag, body: { source_kind: 'WEB_REQUEST', request_ref: requestRef,
        intake_no: `YXX-${requestRef.slice(0, 4)}`, display_status: 'WAITING_FOR_DETAILS', input_revision: revision, processed_revision: '0',
        needs_action: '请补充故障现象', updated_at: '2026-09-16 23:00:00', updated_epoch_ms: '1789570800000',
        created_at: '2026-09-16 23:00:00', created_epoch_ms: '1789570800000', safe_description: '<img src=x onerror=window.__xss=1>',
        safe_location: '护士站', safe_clarification: null, supplements: [], can_supplement: true, ticket: null } };
    },
    async timeline({ request, requestRef, limit, cursor, before }) {
      state.timelineCalls.push({ member: memberFor(request), requestRef, limit, cursor, before });
      if (state.timelineNotFound) { const value = new Error('not found'); value.code = 'YXX_NOT_FOUND'; value.status = 404; throw value; }
      const older = cursor !== null && cursor !== undefined;
      return { items: [{ event_type: older ? 'PROCESSING' : 'REQUEST_ACCEPTED', summary: older ? `更早记录 ${cursor}` : '最近记录',
        occurred_at: older ? '2026-09-16 22:00:00' : '2026-09-16 23:00:00', occurred_epoch_ms: older ? '1789567200000' : '1789570800000', ticket: null }],
        next_cursor: state.timelineEnds ? null : older ? `${cursor}-next` : 'cursor-1' };
    },
    async commandStatus({ request, clientCommandId }) {
      state.commandStatusCalls.push({ member: memberFor(request), clientCommandId });
      if (state.commandStatusResponses?.length) { const value = state.commandStatusResponses.shift(); if (value instanceof Error) throw value; return value; }
      if (state.commandStatusError) throw state.commandStatusError;
      return { status: 'ACCEPTED', client_command_id: clientCommandId, member: memberFor(request) };
    },
  };
  const oauthHttp = async ({ response }) => { response.writeHead(401, { 'content-type': 'text/html; charset=utf-8' }); response.end('<p>旧认证提示</p>'); return true; };
  const config = { publicOrigin: origin, oauth, oauthHttp, command, supplement, query,
    authenticateMember: context, featureFlags: FLAGS, sessionCookieName: 'yxx_session', recoveryBindingSecret: RECOVERY_SECRET };
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

async function waitForState(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('timed out waiting for fixture state');
}

async function setSyntheticVisibility(browser, hidden) {
  // Deterministic seam for the page's visibility handler; this does not claim
  // that the operating system actually backgrounded the browser process.
  await browser.evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:${hidden}});document.dispatchEvent(new Event('visibilitychange'))`);
}

test('SS-007 refreshed member CSRF survives clearing the previous form', { timeout: 45000 }, async () => {
  const f = await startFixture(); let browser;
  try {
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    await browser.evaluate("location.assign('/wecom/yixiaoxiu/reports/new')", { awaitPromise: false });
    await browser.waitFor("document.querySelector('#new-view')?.hidden===false");
    await browser.evaluate("document.querySelector('#description').value='旧会话草稿'");
    f.state.csrfOverride = 'refreshed-synthetic-csrf-01234567890123456789';
    await browser.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    await browser.waitFor("document.querySelector('#description').value===''");
    assert.equal(await browser.evaluate('window.__yxx_csrf'), f.state.csrfOverride);
    await browser.evaluate("document.querySelector('#description').value='新会话报修';document.querySelector('#location-unknown').checked=true;document.querySelector('#new-report-form').requestSubmit()");
    await browser.waitFor("location.pathname==='/wecom/yixiaoxiu/reports/" + REFS.A + "'");
    assert.equal(f.state.commandCalls.length, 1);
  } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
});

test('SS-007 v2 recovery scope clears a different member fence after a full reload', { timeout: 45000 }, async () => {
  const f = await startFixture(); let browser;
  const commandId = '00000000-0000-4000-8000-000000000096';
  try {
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    await browser.evaluate("location.assign('/wecom/yixiaoxiu/reports/new')", { awaitPromise: false });
    await browser.waitFor("document.querySelector('#new-view')?.hidden===false");
    const scopeA = await browser.evaluate("fetch('/api/yixiaoxiu/bootstrap').then(response=>response.json()).then(value=>value.recovery_scope)");
    await browser.evaluate(`sessionStorage.setItem('yxx.self_service.pending_command',JSON.stringify({v:2,id:'${commandId}',scope:'${scopeA}'}));document.querySelector('#description').value='A成员旧草稿';document.cookie='yxx_session=member-b; Path=/';location.reload()`, { awaitPromise: false });
    await browser.waitFor("document.querySelector('#new-view')?.hidden===false&&sessionStorage.getItem('yxx.self_service.pending_command')===null");
    assert.equal(await browser.evaluate("document.querySelector('#description').value"), '');
    assert.equal(await browser.evaluate("document.querySelector('#submit-report').disabled"), false);
    assert.equal(f.state.commandStatusCalls.some(call => call.member === 'B'), false);
  } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
});

test('SS-007 same-scope CSRF rotation keeps the v2 recovery UUID and uses GET only', { timeout: 45000 }, async () => {
  const f = await startFixture(); let browser;
  const commandId = '00000000-0000-4000-8000-000000000095';
  try {
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    await browser.evaluate("location.assign('/wecom/yixiaoxiu/reports/new')", { awaitPromise: false });
    await browser.waitFor("document.querySelector('#new-view')?.hidden===false");
    const scope = await browser.evaluate("fetch('/api/yixiaoxiu/bootstrap').then(response=>response.json()).then(value=>value.recovery_scope)");
    f.state.commandStatusError = Object.assign(new Error('not found'), { code: 'YXX_NOT_FOUND', status: 404 });
    await browser.evaluate(`sessionStorage.setItem('yxx.self_service.pending_command',JSON.stringify({v:2,id:'${commandId}',scope:'${scope}'}));document.querySelector('#description').value='需要重新确认的草稿'`);
    f.state.csrfOverride = 'rotated-same-member-csrf-012345678901234567890';
    await setSyntheticVisibility(browser, false);
    await waitForState(() => f.state.commandStatusCalls.some(call => call.clientCommandId === commandId));
    const persisted = JSON.parse(await browser.evaluate("sessionStorage.getItem('yxx.self_service.pending_command')"));
    assert.deepEqual(persisted, { v: 2, id: commandId, scope });
    assert.equal(await browser.evaluate("document.querySelector('#description').value"), '');
    assert.equal(await browser.evaluate("document.querySelector('#submit-report').disabled"), true);
    assert.equal(f.state.commandCalls.length, 0);
    assert.equal(f.state.supplementCalls.length, 0);
  } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
});

test('SS-007 synthetic visibility restore preserves ETag, bounds an endless timeline, and reloads the first list page', { timeout: 45000 }, async () => {
  const f = await startFixture(); let browser;
  try {
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    await browser.evaluate(`location.assign('/wecom/yixiaoxiu/reports/${REFS.A}')`, { awaitPromise: false });
    await browser.waitFor("document.querySelector('#detail-source')?.textContent.includes('YXX-AAAA')");
    const beforeRestore = f.state.detailCalls.length;
    await setSyntheticVisibility(browser, true);
    await setSyntheticVisibility(browser, false);
    await waitForState(() => f.state.detailCalls.length > beforeRestore && f.state.detailCalls.at(-1).ifNoneMatch === `"${REFS.A}-v1"`);
    await browser.waitFor("document.querySelector('#detail-source')?.textContent.includes('YXX-AAAA')&&document.querySelector('#supplement-form')?.hidden===false");
    assert.equal(await browser.evaluate("document.querySelector('#detail-facts').textContent.includes('undefined')"), false);
    assert.equal(f.state.timelineCalls.at(-1).before, String(Number.MAX_SAFE_INTEGER));
    const beforeOlder = f.state.timelineCalls.length;
    await browser.evaluate("document.querySelector('#load-older-timeline').click()");
    await waitForState(() => f.state.timelineCalls.length > beforeOlder && f.state.timelineCalls.at(-1).cursor === 'cursor-1');
    await browser.waitFor("document.querySelector('#detail-timeline')?.textContent.includes('更早记录 cursor-1')&&document.querySelector('#detail-timeline')?.textContent.includes('最近记录')");
    assert.equal(await browser.evaluate("document.querySelector('#load-older-timeline').hidden"), false);
    assert.equal(await browser.evaluate("document.querySelector('#timeline-window-note').textContent.includes('下次状态刷新')"), true);

    f.state.paginatedLists = true;
    await browser.close();
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    const beforeList = f.state.listCalls.length;
    await browser.evaluate("location.assign('/wecom/yixiaoxiu/reports')", { awaitPromise: false });
    await waitForState(() => f.state.listCalls.length > beforeList);
    await browser.waitFor(`document.querySelector('#report-list')?.textContent.includes('${REFS.A}')`);
    await browser.evaluate("document.querySelector('#load-more-reports').click()");
    await waitForState(() => f.state.listCalls.at(-1)?.cursor === 'page-2');
    await browser.waitFor(`document.querySelector('#report-list')?.textContent.includes('${REFS.B}')`);
    const beforeListRestore = f.state.listCalls.length;
    await setSyntheticVisibility(browser, true);
    await setSyntheticVisibility(browser, false);
    await waitForState(() => f.state.listCalls.length > beforeListRestore);
    assert.equal(f.state.listCalls.at(-1).cursor, null);
    await browser.waitFor(`!document.querySelector('#report-list')?.textContent.includes('${REFS.B}')`);
    assert.equal(await browser.evaluate(`document.querySelector('#report-list').textContent.includes('${REFS.A}')`), true);
  } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
});

test('SS-007 detail and timeline 404 clear rendered state and stop polling', { timeout: 60000 }, async () => {
  for (const failureKind of ['detail', 'timeline']) {
    const f = await startFixture(); let browser;
    try {
      browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
        cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
      await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
      await browser.evaluate(`location.assign('/wecom/yixiaoxiu/reports/${REFS.A}')`, { awaitPromise: false });
      await browser.waitFor("document.querySelector('#detail-description')?.textContent.includes('<img')");
      await browser.evaluate("window.setTimeout=((actual)=>((callback,delay,...args)=>actual(callback,Math.min(delay,30),...args)))(window.setTimeout.bind(window))");
      if (failureKind === 'detail') f.state.detailNotFound = true;
      else f.state.timelineNotFound = true;
      await setSyntheticVisibility(browser, false);
      await browser.waitFor("document.querySelector('#home-view')?.hidden===false&&document.querySelector('#app-status')?.textContent.includes('不存在')");
      const callsAfter404 = failureKind === 'detail' ? f.state.detailCalls.length : f.state.timelineCalls.length;
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.equal(failureKind === 'detail' ? f.state.detailCalls.length : f.state.timelineCalls.length, callsAfter404);
      assert.equal(await browser.evaluate("document.querySelector('#detail-description').textContent"), '');
      assert.equal(await browser.evaluate("document.querySelector('#detail-timeline').textContent"), '');
      assert.equal(await browser.evaluate("document.querySelector('#supplement-form').hidden"), true);
    } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
  }
});

test('SS-007 pending recovery stays GET-only, survives 404, and is discarded on an in-memory identity change', { timeout: 45000 }, async () => {
  const f = await startFixture(); let browser;
  const commandId = '00000000-0000-4000-8000-000000000099';
  try {
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    await browser.evaluate(`location.assign('/wecom/yixiaoxiu/reports/${REFS.A}')`, { awaitPromise: false });
    await browser.waitFor("document.querySelector('#detail-description')?.textContent.includes('<img')");
    f.state.commandStatusError = Object.assign(new Error('not found'), { code: 'YXX_NOT_FOUND', status: 404 });
    await browser.evaluate(`sessionStorage.setItem('yxx.self_service.pending_command',JSON.stringify({v:1,id:'${commandId}'}))`);
    const beforeRecovery = f.state.commandStatusCalls.length;
    await setSyntheticVisibility(browser, true);
    await setSyntheticVisibility(browser, false);
    await waitForState(() => f.state.commandStatusCalls.length > beforeRecovery);
    await browser.waitFor("document.querySelector('#app-status')?.textContent.includes('尚未可查询')");
    assert.notEqual(await browser.evaluate("sessionStorage.getItem('yxx.self_service.pending_command')"), null);
    assert.equal(f.state.commandCalls.length, 0);
    assert.equal(f.state.supplementCalls.length, 0);

    f.state.commandStatusError = null;
    f.state.enforceOwnership = true;
    const beforeIdentityChange = f.state.commandStatusCalls.length;
    await setSyntheticVisibility(browser, true);
    await browser.evaluate("document.cookie='yxx_session=member-b; Path=/'");
    await setSyntheticVisibility(browser, false);
    await browser.waitFor(`window.__yxx_csrf==='${csrfFor('member-b')}'&&sessionStorage.getItem('yxx.self_service.pending_command')===null`);
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(f.state.commandStatusCalls.length, beforeIdentityChange);
    assert.equal(await browser.evaluate("document.querySelector('#detail-description').textContent"), '');
    assert.equal(await browser.evaluate("document.body.textContent.includes('YXX-AAAA')"), false);
    assert.equal(f.state.commandCalls.length, 0);
    assert.equal(f.state.supplementCalls.length, 0);
  } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
});

test('SS-007 pending recovery retries only GET, then requires an explicit bounded restart', { timeout: 45000 }, async () => {
  const f = await startFixture(); let browser;
  const commandId = '00000000-0000-4000-8000-000000000098';
  const notFound = () => Object.assign(new Error('not found'), { code: 'YXX_NOT_FOUND', status: 404 });
  try {
    f.state.commandStatusResponses = [notFound(), notFound(), notFound(), notFound(), notFound(),
      { status: 'ACCEPTED', client_command_id: commandId, request_ref: REFS.A }];
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    await browser.evaluate(`sessionStorage.setItem('yxx.self_service.pending_command',JSON.stringify({v:1,id:'${commandId}'}))`);
    await setSyntheticVisibility(browser, false);
    await waitForState(() => f.state.commandStatusCalls.length === 5, 18000);
    await browser.waitFor("document.querySelector('#retry-pending')?.hidden===false");
    assert.equal(await browser.evaluate("document.querySelector('#app-status').textContent.includes('旧版恢复记录')"), true);
    assert.notEqual(await browser.evaluate("sessionStorage.getItem('yxx.self_service.pending_command')"), null);
    assert.equal(f.state.commandCalls.length, 0);
    assert.equal(f.state.supplementCalls.length, 0);
    await browser.evaluate("document.querySelector('#retry-pending').click()");
    await browser.waitFor(`location.pathname==='/wecom/yixiaoxiu/reports/${REFS.A}'`);
    assert.equal(f.state.commandStatusCalls.length, 6);
    assert.equal(f.state.commandCalls.length, 0);
    assert.equal(f.state.supplementCalls.length, 0);
  } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
});

test('SS-007 logout clears member DOM and timers before a hanging response', { timeout: 45000 }, async () => {
  const f = await startFixture(); let browser;
  try {
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    await browser.evaluate(`location.assign('/wecom/yixiaoxiu/reports/${REFS.A}')`, { awaitPromise: false });
    await browser.waitFor("document.querySelector('#detail-description')?.textContent.includes('<img')");
    f.state.commandStatusError = Object.assign(new Error('not found'), { code: 'YXX_NOT_FOUND', status: 404 });
    await browser.evaluate(`(() => {
      sessionStorage.setItem('yxx.self_service.pending_command',JSON.stringify({v:1,id:'00000000-0000-4000-8000-000000000097'}));
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await waitForState(() => f.state.commandStatusCalls.length === 1);
    const recoveryCallsBeforeLogout = f.state.commandStatusCalls.length;
    await browser.evaluate(`(() => {
      const actualFetch=window.fetch.bind(window);
      window.fetch=(path,options)=>String(path).endsWith('/logout')?new Promise(()=>{}):actualFetch(path,options);
      document.querySelector('#logout').click();
    })()`);
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false&&document.querySelector('#app-status')?.textContent.includes('正在退出')");
    assert.equal(await browser.evaluate("document.querySelector('#detail-description').textContent"), '');
    assert.equal(await browser.evaluate("document.querySelector('#detail-timeline').textContent"), '');
    assert.equal(await browser.evaluate("sessionStorage.getItem('yxx.self_service.pending_command')"), null);
    assert.equal(await browser.evaluate("window.__yxx_csrf===undefined"), true);
    assert.equal(await browser.evaluate("document.querySelector('#retry-pending').hidden"), true);
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(f.state.commandStatusCalls.length, recoveryCallsBeforeLogout);
  } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
});

test('SS-007 a stale unauthorized response cannot clear the newer member operation', { timeout: 45000 }, async () => {
  const f = await startFixture(); let browser;
  try {
    browser = await launchSystemBrowser({ url: `${f.origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-a', url: f.origin }] });
    await browser.waitFor("document.querySelector('#home-view')?.hidden===false");
    await browser.evaluate(`(() => {
      const actualFetch=window.fetch.bind(window);let first=true;
      window.fetch=(path,options)=>{
        if(first&&String(path).startsWith('/api/yixiaoxiu/my-reports')){
          first=false;
          return new Promise(resolve=>{window.__releaseStale=()=>resolve(new Response(JSON.stringify({error:{code:'YXX_AUTH_REQUIRED'}}),{status:401,headers:{'content-type':'application/json'}}));});
        }
        return actualFetch(path,options);
      };
      history.pushState({},'', '/wecom/yixiaoxiu/reports');
    })()`);
    await setSyntheticVisibility(browser, false);
    await browser.waitFor("typeof window.__releaseStale==='function'");
    await setSyntheticVisibility(browser, true);
    await browser.evaluate("document.cookie='yxx_session=member-b; Path=/'");
    await setSyntheticVisibility(browser, false);
    await browser.waitFor(`window.__yxx_csrf==='${csrfFor('member-b')}'&&document.querySelector('#report-list')?.textContent.includes('${REFS.B}')`);
    await browser.evaluate("(async()=>{window.__releaseStale();await new Promise(resolve=>setTimeout(resolve,50));})()");
    assert.equal(await browser.evaluate(`document.querySelector('#report-list').textContent.includes('${REFS.B}')`), true);
    assert.equal(await browser.evaluate("document.querySelector('#reports-view').hidden"), false);
    assert.equal(await browser.evaluate(`window.__yxx_csrf==='${csrfFor('member-b')}'`), true);
  } finally { await closeBrowserTestResources([()=>browser?.close(),()=>closeServer(f.server)]); }
});

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
    await assertP2016Schema('yxx_self_service_bootstrap', bootstrapBody);
    assert.equal(bootstrapBody.identity_mode, 'MEMBER_SELF_SERVICE');
    assert.equal(bootstrapBody.read_only, false);
    assert.equal(bootstrapBody.can_submit, true);
    assert.equal(typeof bootstrapBody.csrf_token, 'string');
    assert.equal((await get('/api/yixiaoxiu/bootstrap')).status, 401);
    const malformedCommand = await get('/api/yixiaoxiu/commands/00000000-0000-0000-0000-000000000000', { cookie: 'yxx_session=member-a' });
    assert.equal(malformedCommand.status, 400);
    assert.equal((await malformedCommand.json()).error.code, 'YXX_INPUT_INVALID');
    const disabledRoot = await fetch(disabledState.origin + '/wecom/yixiaoxiu/', { headers: { cookie: 'yxx_session=member-a' } });
    assert.equal(disabledRoot.status, 401);
    assert.doesNotMatch(await disabledRoot.text(), /new-report-form|我的报修/u);
    const badOrigin = await fetch(origin + '/api/yixiaoxiu/requests', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin: 'https://attacker.invalid', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(badOrigin.status, 403);
    const badCsrf = await fetch(origin + '/api/yixiaoxiu/requests', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000000', 'x-csrf-token': 'wrong', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000000', description: '普通描述', location: { text: '护士站', unknown: false } }) });
    assert.equal(badCsrf.status, 403);
    assert.equal(state.commandCalls.length, 0);
    const accepted = await fetch(origin + '/api/yixiaoxiu/requests', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000001', 'x-csrf-token': csrfFor('member-a'), 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000001', description: '普通描述', location: { text: '护士站', unknown: false } }) });
    assert.equal(accepted.status, 202);
    assert.equal((await accepted.json()).location, `/wecom/yixiaoxiu/reports/${REFS.A}`);
    assert.equal(state.commandCalls.length, 1);
    for (const message of ['YXX_INPUT_INVALID', 'YXX_CURSOR_INVALID', 'YXX_LIMIT_INVALID']) {
      state.commandError = new TypeError(message);
      const rejected = await fetch(origin + '/api/yixiaoxiu/requests', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'x-csrf-token': csrfFor('member-a') }, body: '{}' });
      assert.equal(rejected.status, 400, message);
    }
    state.commandError = null;
    const detail = await get(`/api/yixiaoxiu/requests/${REFS.A}`, { cookie: 'yxx_session=member-a' });
    assert.equal(detail.status, 200);
    const etag = detail.headers.get('etag');
    assert.equal((await get(`/api/yixiaoxiu/requests/${REFS.A}`, { cookie: 'yxx_session=member-a', 'if-none-match': etag })).status, 304);
    assert.equal((await get(`/api/yixiaoxiu/requests/${REFS.A}/timeline?limit=50`, { cookie: 'yxx_session=member-a' })).status, 200);
    assert.equal(state.timelineCalls.at(-1).limit, 50);
    const supplement = await fetch(origin + `/api/yixiaoxiu/requests/${REFS.A}/supplements`, { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000002', 'x-csrf-token': csrfFor('member-a'), 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000002', expected_input_revision: '1', text: '补充事实' }) });
    assert.equal(supplement.status, 202);
    assert.equal(state.supplementCalls.length, 1);
    fixtureState.state.supplementConflict = true;
    const conflict = await fetch(origin + `/api/yixiaoxiu/requests/${REFS.A}/supplements`, { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'idempotency-key': '00000000-0000-4000-8000-000000000003', 'x-csrf-token': csrfFor('member-a'), 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ schema_version: 1, client_command_id: '00000000-0000-4000-8000-000000000003', expected_input_revision: '1', text: '旧版本' }) });
    assert.equal(conflict.status, 409);
    assert.equal((await fetch(origin + '/wecom/yixiaoxiu/logout', { method: 'POST', headers: { cookie: 'yxx_session=member-a', origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{}' })).status, 200);
  } finally { await closeServer(fixtureState.server); await closeServer(disabledState.server); }
});

test('SS-007 native UI renders safely at phone and desktop sizes and keeps tabs isolated', { timeout: 120000 }, async () => {
  const fixtureState = await startFixture();
  const browsers = [];
  let failure;
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
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('#logout')).color"), 'rgb(22, 78, 61)');
      await browser.evaluate("document.querySelector('#new-report-link').click()");
      await browser.waitFor("document.querySelector('#new-view').hidden===false");
      await browser.waitFor("document.querySelector('#submit-report').disabled===false");
      const beforeCommands = state.commandCalls.filter(call => call.member === 'A').length;
      await browser.evaluate("document.querySelector('#description').value='网页故障';document.querySelector('#location-text').value='护士站';document.querySelector('#service-code').value='打印机';document.querySelector('#new-report-form').requestSubmit();document.querySelector('#new-report-form').requestSubmit()");
      await browser.waitFor("/^\\/wecom\\/yixiaoxiu\\/reports\\/[A-Za-z0-9_-]{32}$/.test(location.pathname)");
      await browser.waitFor("document.querySelector('#detail-description')?.textContent.includes('<img src=x')");
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
      assert.equal(state.timelineCalls.some(call => call.before === String(Number.MAX_SAFE_INTEGER)), true);
      const focused = await browser.evaluate("document.activeElement?.id");
      assert.equal(typeof focused, 'string');
    }
    const other = await launchSystemBrowser({ url: `${origin}/wecom/yixiaoxiu/`, width: 390, height: 844,
      cookies: [{ name: 'yxx_session', value: 'member-b', url: `${origin}/wecom/yixiaoxiu/` }] });
    browsers.push(other);
    await other.waitFor("document.querySelector('#home-view').hidden===false");
    await other.evaluate("location.assign('/wecom/yixiaoxiu/reports')", { awaitPromise: false });
      await other.waitFor("document.querySelector('#reports-view').hidden===false");
    assert.equal(await other.evaluate("document.querySelector('#report-list').textContent.includes('已收到，正在处理')"), true);
    assert.equal(await other.evaluate("document.body.textContent.includes('B')"), true);
    assert.equal(await other.evaluate("document.body.textContent.includes('A')"), false);
    assert.equal(state.commandCalls.filter(call => call.member === 'B').length, 0);
    const source = await readFile(new URL('../web/p2-reporter/self-service.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|eval\(/u);
    assert.match(source, /AbortController/u);
    assert.match(source, /visibilitychange/u);
    assert.match(source, /state\.detailEtag=detail\.etag/u);
  } catch (error) { failure = error; }
  finally { await closeBrowserTestResources([...browsers.map(browser => browser.close), () => closeServer(fixtureState.server)], failure); }
});
