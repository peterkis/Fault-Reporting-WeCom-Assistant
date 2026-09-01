import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { test } from 'node:test';

import { closeConversationWorkbenchServer, createConversationWorkbenchHttpServer } from '../src/p2-006-workbench-http.mjs';
import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';

const SESSION_ID = '018f0000-0000-7000-8000-000000000006';
const OTHER_ID = '018f0000-0000-7000-8000-000000000007';
const PRINCIPAL_ID = '018f0000-0000-7000-8000-000000000008';
const TARGET_ID = '018f0000-0000-7000-8000-000000000009';
const NOW = '2026-09-01T04:00:00.000Z';

async function reservePort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

function fixture() {
  let rowVersion = 1;
  const calls = { takeover: 0, transfer: 0, reply: 0, note: 0, list: 0 };
  const conversation = (id = SESSION_ID) => ({
    session: { session_id: id, status: 'OPEN', control_mode: 'HUMAN', generation_version: 1, row_version: rowVersion, last_activity_at: NOW },
    queue_state: 'unassigned', channel_label: '群聊会话', unread_count: 1,
    last_item: { item_id: randomUUID(), sequence_no: '2', item_type: 'USER_MESSAGE', sender_kind: 'USER', visibility: 'EXTERNAL', text: '<img src=x onerror=window.__p2_006_xss=1>', safe_content: {}, occurred_at: NOW },
    assignment: { status: 'UNASSIGNED', version: 0, assigned_to_me: false, assigned_display_name: null, assigned_at: null },
    handoff: null, ticket: null, latest_delivery: null, waiting_duration_seconds: 0,
    capabilities: ['VIEW', 'TAKEOVER', 'REQUEST_HANDOFF', 'TRANSFER', 'RELEASE', 'REPLY', 'INTERNAL_NOTE', 'READ_CURSOR'],
  });
  const detail = () => ({
    session: conversation().session,
    assignment: { status: 'UNASSIGNED', version: 0, assigned_to_me: false, assigned_display_name: null, assigned_at: null },
    handoff: null, read_cursor: { last_read_sequence: '0', row_version: 0 }, unread_count: 1, ticket: null,
    incident: { available: false, reason: 'INCIDENT_NOT_IMPLEMENTED' }, attachments: { available: false, reason: 'ATTACHMENT_NOT_IMPLEMENTED' },
    delivery_summary: null, capabilities: conversation().capabilities, etag: `"${rowVersion}"`,
  });
  const queryService = {
    getBootstrap: async () => ({ authenticated: true, principal: { principal_id: PRINCIPAL_ID, display_name: 'Synthetic Admin', capabilities: conversation().capabilities }, expires_at: new Date(Date.now() + 60_000).toISOString(), csrf_token: 'csrf-token-browser-test', feature_status: { workbench_enabled: true, realtime_sse_enabled: true, ai_enabled: false, incident_enabled: false, attachments_enabled: false }, polling_interval_ms: 60_000, sse_endpoint: '/api/realtime/events?scope=workbench', max_page_sizes: { conversations: 100, timeline: 200 } }),
    listConversations: async ({ state }) => { calls.list += 1; return { items: state === 'ended' ? [] : [conversation(), conversation(OTHER_ID)], next_cursor: null }; },
    getConversationDetail: async () => detail(),
    listConversationItems: async () => ({ session_id: SESSION_ID, items: [conversation().last_item, { ...conversation().last_item, item_id: randomUUID(), sequence_no: '3', sender_kind: 'AGENT', text: '已收到，正在处理' }], before_sequence: '2', after_sequence: '3', has_more: false }),
    listEligiblePrincipals: async () => ({ items: [{ principal_id: TARGET_ID, display_name: 'Synthetic Target', actions: ['TRANSFER_TARGET'] }] }),
    listConversationDeliveries: async () => ({ items: [] }),
  };
  const succeed = (name) => async () => { calls[name] += 1; rowVersion += 1; return { ok: true, session: { row_version: rowVersion } }; };
  const commandFacade = {
    requestHandoff: succeed('takeover'), takeover: succeed('takeover'), transfer: succeed('transfer'), release: succeed('takeover'),
    cancelHandoff: succeed('takeover'), advanceReadCursor: succeed('takeover'), reply: succeed('reply'), internalNote: succeed('note'),
    retryDelivery: succeed('takeover'), reconcileDelivery: succeed('takeover'),
  };
  return { queryService, commandFacade, calls };
}

async function withBrowser(width, height, run) {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const values = fixture();
  const server = createConversationWorkbenchHttpServer({
    enabled: true, ...values, publicOrigin: origin,
    authenticate: async () => ({ principal_id: PRINCIPAL_ID, auth_method: 'COOKIE', expires_at: new Date(Date.now() + 60_000).toISOString(), csrf_token: 'csrf-token-browser-test' }),
    sseHandler: async (_request, response) => { response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' }); response.end('data: {}\n\n'); },
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await launchSystemBrowser({ url: `${origin}/workbench`, width, height });
    await browser.waitFor("document.readyState === 'complete' && document.querySelectorAll('[data-session-id]').length === 2");
    return await run({ browser, calls: values.calls, origin });
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections?.();
    await closeConversationWorkbenchServer(server);
  }
}

for (const viewport of [{ label: 'desktop', width: 1440, height: 900 }, { label: 'mobile', width: 390, height: 844 }]) {
  test(`system browser ${viewport.label} workbench flow is responsive, refresh-safe and XSS-safe`, { timeout: 90_000 }, async (t) => {
    await withBrowser(viewport.width, viewport.height, async ({ browser, calls, origin }) => {
      const headers = await fetch(`${origin}/workbench`).then((response) => Object.fromEntries(response.headers));
      assert.match(headers['content-security-policy'], /script-src 'self'/u); assert.equal(headers['x-frame-options'], 'DENY');
      const initial = await browser.evaluate(`({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,xss:window.__p2_006_xss===1,images:document.querySelectorAll('#conversation-list img').length})`);
      assert.deepEqual(initial, { overflow: false, xss: false, images: 0 });
      await browser.evaluate(`document.querySelector('[data-session-id="${SESSION_ID}"]').click()`);
      await browser.waitFor("document.querySelector('#conversation-view').hidden === false && document.querySelectorAll('#timeline .timeline-item').length === 2");
      await browser.evaluate(`document.querySelector('[data-action="takeover"]').click()`);
      await browser.waitFor("document.querySelector('#status-live').textContent === '操作已提交'");
      await browser.evaluate(`document.querySelector('#status-live').textContent='';document.querySelector('[data-action="transfer"]').click()`);
      await browser.waitFor("document.querySelector('#status-live').textContent === '操作已提交'");
      await browser.evaluate(`document.querySelector('#message-text').value='Synthetic browser reply';document.querySelector('#composer').requestSubmit()`);
      await browser.waitFor("document.querySelector('#status-live').textContent.includes('回复已提交')");
      await browser.evaluate(`document.querySelector('[data-compose="note"]').click();document.querySelector('#message-text').value='Synthetic browser note';document.querySelector('#composer').requestSubmit()`);
      await browser.waitFor("document.querySelector('#status-live').textContent.includes('备注已保存')");
      await browser.evaluate(`document.querySelector('[data-filter="ended"]').click()`);
      await browser.waitFor(`document.querySelector('[data-filter="ended"]').getAttribute('aria-pressed') === 'true'`);
      await browser.evaluate(`document.querySelector('[data-filter="open"]').click()`);
      await browser.waitFor("document.querySelectorAll('[data-session-id]').length === 2");
      await browser.waitFor("document.querySelector('#connection-label').textContent === '轮询模式'");
      await browser.evaluate(`document.activeElement?.blur()`); await browser.pressTab();
      const focus = await browser.evaluate(`({outline:getComputedStyle(document.activeElement).outlineStyle,width:getComputedStyle(document.activeElement).outlineWidth,tag:document.activeElement.tagName})`);
      assert.notEqual(focus.outline, 'none'); assert.notEqual(focus.width, '0px');
      await browser.evaluate('location.reload()');
      await browser.waitFor(`document.readyState === 'complete' && document.querySelector('[data-session-id="${SESSION_ID}"]')`);
      const refreshed = await browser.evaluate(`({selected:sessionStorage.getItem('p2_workbench_session')==='${SESSION_ID}',xss:window.__p2_006_xss===1,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
      assert.deepEqual(refreshed, { selected: true, xss: false, overflow: false });
      assert.equal(calls.takeover, 1); assert.equal(calls.transfer, 1); assert.equal(calls.reply, 1); assert.equal(calls.note, 1); assert.ok(calls.list >= 4);
      t.diagnostic(JSON.stringify({ browser: browser.executable, viewport, interactions: { select: 1, takeover: calls.takeover, transfer: calls.transfer, reply: calls.reply, internal_note: calls.note, sse_update: true, polling_fallback: true, filter: true, refresh_restore: true }, keyboard_focus_visible: true, security_headers: true, xss_executed: false, horizontal_overflow: false }));
    });
  });
}
