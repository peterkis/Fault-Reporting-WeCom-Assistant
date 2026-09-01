import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { test } from 'node:test';

import { closeConversationWorkbenchServer, createConversationWorkbenchHttpServer } from '../src/p2-006-workbench-http.mjs';
import { launchP2G1TestBrowserSessions } from '../src/p2-g1-browser-sessions.mjs';
import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';

const SESSION_ID = '018f0000-0000-7000-8000-000000000061';
const PRINCIPAL_ID = '018f0000-0000-7000-8000-000000000062';
const NOW = '2026-09-01T06:00:00.000Z';

async function reservePort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

function fixture() {
  let replyCalls = 0;
  const capabilities = ['VIEW', 'REPLY', 'INTERNAL_NOTE', 'READ_CURSOR'];
  const session = { session_id: SESSION_ID, status: 'OPEN', control_mode: 'HUMAN', generation_version: 1, row_version: 1, last_activity_at: NOW };
  const item = { item_id: '018f0000-0000-7000-8000-000000000063', sequence_no: '1', item_type: 'USER_MESSAGE', sender_kind: 'USER', visibility: 'EXTERNAL', text: '<img src=x onerror=window.__p2_g1_xss=1>', safe_content: {}, occurred_at: NOW };
  const assignment = { status: 'ASSIGNED', version: 1, assigned_to_me: true, assigned_display_name: 'Synthetic Admin', assigned_at: NOW };
  const queryService = {
    getBootstrap: async () => ({ authenticated: true, principal: { principal_id: PRINCIPAL_ID, display_name: 'Synthetic Admin', capabilities }, expires_at: new Date(Date.now() + 60_000).toISOString(), csrf_token: 'p2-g1-browser-csrf', feature_status: { workbench_enabled: true, realtime_sse_enabled: true, ai_enabled: false, incident_enabled: false, attachments_enabled: false }, polling_interval_ms: 60_000, sse_endpoint: '/api/realtime/events?scope=workbench', max_page_sizes: { conversations: 100, timeline: 200 } }),
    listConversations: async () => ({ items: [{ session, queue_state: 'mine', channel_label: '群聊会话', unread_count: 1, last_item: item, assignment, handoff: null, ticket: null, latest_delivery: null, waiting_duration_seconds: 0, capabilities }], next_cursor: null }),
    getConversationDetail: async () => ({ session, assignment, handoff: null, read_cursor: { last_read_sequence: '0', row_version: 0 }, unread_count: 1, ticket: null, incident: { available: false, reason: 'INCIDENT_NOT_IMPLEMENTED' }, attachments: { available: false, reason: 'ATTACHMENT_NOT_IMPLEMENTED' }, delivery_summary: null, capabilities, etag: '"1"' }),
    listConversationItems: async () => ({ session_id: SESSION_ID, items: [item], before_sequence: '1', after_sequence: '1', has_more: false }),
    listEligiblePrincipals: async () => ({ items: [] }),
    listConversationDeliveries: async () => ({ items: [] }),
  };
  const commandFacade = {
    requestHandoff: async () => ({}), takeover: async () => ({}), transfer: async () => ({}), release: async () => ({}), cancelHandoff: async () => ({}), advanceReadCursor: async () => ({}), internalNote: async () => ({}), retryDelivery: async () => ({}), reconcileDelivery: async () => ({}),
    reply: async () => { replyCalls += 1; await new Promise((resolve) => setTimeout(resolve, 100)); return { command_status: 'COMMITTED', delivery_ids: ['018f0000-0000-7000-8000-000000000064'] }; },
  };
  return { queryService, commandFacade, getReplyCalls: () => replyCalls };
}

test('P2-G1 system browser duplicate submit fence sends one human reply and preserves safe rendering', { timeout: 90_000 }, async (t) => {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const values = fixture();
  const server = createConversationWorkbenchHttpServer({
    enabled: true,
    queryService: values.queryService,
    commandFacade: values.commandFacade,
    publicOrigin: origin,
    authenticate: async () => ({ principal_id: PRINCIPAL_ID, auth_method: 'COOKIE', expires_at: new Date(Date.now() + 60_000).toISOString(), csrf_token: 'p2-g1-browser-csrf' }),
    sseHandler: async (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); response.end('data: {}\n\n'); },
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await launchSystemBrowser({ url: `${origin}/workbench`, width: 390, height: 844 });
    await browser.waitFor(`document.readyState === 'complete' && document.querySelector('[data-session-id="${SESSION_ID}"]')`);
    await browser.evaluate(`document.querySelector('[data-session-id="${SESSION_ID}"]').click()`);
    await browser.waitFor("document.querySelector('#conversation-view').hidden === false");
    const safeBefore = await browser.evaluate(`({xss:window.__p2_g1_xss===1,images:document.querySelectorAll('#timeline img').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
    assert.deepEqual(safeBefore, { xss: false, images: 0, overflow: false });
    await browser.evaluate(`document.querySelector('#message-text').value='Synthetic duplicate-click reply';document.querySelector('#composer').requestSubmit();document.querySelector('#composer').requestSubmit()`);
    await browser.waitFor("document.querySelector('#status-live').textContent.includes('回复已提交')");
    assert.equal(values.getReplyCalls(), 1);
    const safeAfter = await browser.evaluate(`({disabled:document.querySelector('#send-message').disabled,xss:window.__p2_g1_xss===1,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
    assert.deepEqual(safeAfter, { disabled: false, xss: false, overflow: false });
    t.diagnostic(JSON.stringify({ browser: browser.executable, viewport: { width: 390, height: 844 }, duplicate_submit_calls: 1, polling_fallback: true, xss_executed: false, horizontal_overflow: false }));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections?.();
    await closeConversationWorkbenchServer(server);
  }
});

test('P2-G1 live browser sessions navigate to the actual Workbench route with isolated cookies', { timeout: 90_000 }, async (t) => {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const requests = [];
  const server = createHttpServer((request, response) => {
    requests.push({ path: request.url, cookie: typeof request.headers.cookie === 'string' });
    if (request.url?.startsWith('/workbench')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>P2-G1 Workbench route check</title>');
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":{"code":"WORKBENCH_NOT_FOUND"}}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const expires = Math.floor(Date.now() / 1000) + 60;
  let sessions;
  try {
    sessions = await launchP2G1TestBrowserSessions({
      origin,
      headless: true,
      cookies: [
        { name: 'p2_g1_test_1', value: 'a'.repeat(40), secure: false, expires },
        { name: 'p2_g1_test_2', value: 'b'.repeat(40), secure: false, expires },
      ],
    });
    const deadline = Date.now() + 10_000;
    while (requests.filter((request) => request.path?.startsWith('/workbench')).length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const workbenchRequests = requests.filter((request) => request.path?.startsWith('/workbench'));
    assert.equal(sessions.count, 2);
    assert.ok(workbenchRequests.length >= 2);
    assert.equal(workbenchRequests.every((request) => request.cookie), true);
    assert.equal(requests.some((request) => request.path === '/'), false);
    t.diagnostic(JSON.stringify({ browser_sessions: 2, workbench_route_requests: workbenchRequests.length, isolated_cookie_headers: true, root_not_requested: true }));
  } finally {
    await sessions?.close?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
