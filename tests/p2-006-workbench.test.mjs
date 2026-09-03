import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { encodeConversationCursor, decodeConversationCursor, createConversationWorkbenchQueryService, WORKBENCH_ERROR_CODES } from '../src/p2-006-workbench-query.mjs';
import { createConversationWorkbenchHttpServer, listenConversationWorkbenchServer, closeConversationWorkbenchServer } from '../src/p2-006-workbench-http.mjs';
import { createConversationWorkbenchCommandFacade } from '../src/p2-006-workbench-command-facade.mjs';
import { initialWorkbenchState, reduceWorkbenchState, loadRefreshState, saveRefreshState } from '../web/p2-workbench/workbench-state.mjs';

const root = process.cwd();
const sessionId = '00000000-0000-4000-8000-000000000111';
const principalId = '00000000-0000-4000-8000-000000000001';
const expiresEpochMs = () => String(Date.now() + 60_000);
const expiresAt = (epochMs = expiresEpochMs()) => {
  const date = new Date(Number(epochMs));
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(date).filter((part) => part.type !== 'literal');
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
};

function fakeAuthorize() {
  const principal = Object.freeze({ principal_id: principalId, display_name: 'Synthetic', is_active: true, roles: ['ADMIN'], team_ids: [] });
  return Object.freeze({
    resolvePrincipal: async () => principal, safePrincipal: () => ({ principal_id: principalId, display_name: 'Synthetic', capabilities: ['VIEW'] }),
    actionsFor: () => Object.freeze(['VIEW']), sessionAccessPredicate: () => ({ sql: 'TRUE', values: [] }),
    authorizeSession: async () => true, isAdmin: () => true, listEligiblePrincipals: async () => Object.freeze([]),
  });
}

function fakeHttpServices() {
  return {
    queryService: Object.freeze({
      getBootstrap: async ({ authContext }) => ({ authenticated: true, principal: { principal_id: principalId, display_name: 'Synthetic', capabilities: [] }, expires_at: authContext.expires_at, expires_epoch_ms: authContext.expires_epoch_ms, csrf_token: authContext.csrf_token, capabilities: [], feature_status: {}, polling_interval_ms: 5000, sse_endpoint: '/api/realtime/events?scope=workbench', max_page_sizes: { conversations: 100, timeline: 200 } }),
      listConversations: async () => ({ items: [], next_cursor: null }),
      getConversationDetail: async () => ({ session: { session_id: sessionId, row_version: 1 }, assignment: {}, handoff: null, read_cursor: {}, unread_count: 0, ticket: null, incident: { available: false, reason: 'INCIDENT_NOT_IMPLEMENTED' }, attachments: { available: false, reason: 'ATTACHMENT_NOT_IMPLEMENTED' }, delivery_summary: null, capabilities: [], etag: '"1"' }),
      listConversationItems: async () => ({ items: [], before_sequence: null, after_sequence: null, has_more: false }),
      listEligiblePrincipals: async () => ({ items: [] }), listConversationDeliveries: async () => ({ items: [] }),
    }),
    commandFacade: new Proxy({}, { get: () => async () => ({ ok: true }) }),
  };
}

async function withServer(authenticate, run, options = {}) {
  const services = fakeHttpServices();
  const server = createConversationWorkbenchHttpServer({ enabled: options.enabled ?? true, ...services, authenticate, publicOrigin: 'http://127.0.0.1' });
  const address = await listenConversationWorkbenchServer(server);
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await closeConversationWorkbenchServer(server); }
}

test('workbench schemas parse and OpenAPI 3.1 exposes every implemented route', () => {
  for (const file of ['workbench_bootstrap.schema.json', 'workbench_conversation_page.schema.json', 'workbench_conversation_detail.schema.json', 'workbench_delivery_action.schema.json', 'workbench_error.schema.json']) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(root, 'contracts', file), 'utf8')), file);
  }
  const openapi = fs.readFileSync(path.join(root, 'contracts/conversation_center.openapi.yaml'), 'utf8');
  assert.match(openapi, /^openapi: 3\.1\.0$/mu);
  for (const route of ['/workbench/bootstrap:', '/conversations/{sessionId}/handoff/request:', '/conversations/{sessionId}/transfer:', '/conversations/{sessionId}/read-cursor:', '/deliveries/{deliveryId}/retry:', '/deliveries/{deliveryId}/reconcile:', '/realtime/events:']) assert.match(openapi, new RegExp(route.replace(/[{}]/gu, '\\$&')));
});

test('opaque cursor round-trips normalized timestamp and session id', () => {
  const encoded = encodeConversationCursor({ last_activity_at: '2026-09-01 00:00:00', session_id: sessionId });
  assert.deepEqual(decodeConversationCursor(encoded), { last_activity_at: '2026-09-01 00:00:00', session_id: sessionId });
  assert.doesNotMatch(encoded, /userid|chatid|participant/iu);
});

test('opaque cursor rejects malformed, oversized, and structurally extended values', () => {
  for (const value of ['abc', 'A'.repeat(1025), Buffer.from(JSON.stringify({ v: 1, t: new Date().toISOString(), s: sessionId, x: 1 })).toString('base64url')]) {
    assert.throws(() => decodeConversationCursor(value), (error) => error.code === WORKBENCH_ERROR_CODES.cursorInvalid);
  }
});

test('disabled query service performs zero database and authorization calls', async () => {
  let calls = 0;
  const service = createConversationWorkbenchQueryService({ enabled: false, pool: { query: async () => { calls += 1; } }, authorize: { resolvePrincipal: async () => { calls += 1; } } });
  await assert.rejects(service.listConversations({}), (error) => error.code === WORKBENCH_ERROR_CODES.disabled);
  assert.equal(calls, 0);
});

test('list SQL applies authorization in WHERE before keyset ORDER BY and LIMIT', async () => {
  let statement = '';
  const pool = { query: async (sql) => { statement = sql; return { rows: [], rowCount: 0 }; } };
  const service = createConversationWorkbenchQueryService({ enabled: true, pool, authorize: fakeAuthorize() });
  await service.listConversations({ authContext: {}, state: 'open', limit: 30 });
  assert.ok(statement.indexOf('WHERE TRUE') >= 0);
  assert.ok(statement.indexOf('WHERE TRUE') < statement.indexOf('ORDER BY s.last_activity_at'));
  assert.ok(statement.indexOf('ORDER BY s.last_activity_at') < statement.lastIndexOf('LIMIT'));
  assert.doesNotMatch(statement, /\bOFFSET\b/iu);
});

test('query page limit and state filters fail closed', async () => {
  const service = createConversationWorkbenchQueryService({ enabled: true, pool: { query: async () => ({ rows: [] }) }, authorize: fakeAuthorize() });
  await assert.rejects(service.listConversations({ authContext: {}, limit: 101 }), (error) => error.code === WORKBENCH_ERROR_CODES.pageLimitInvalid);
  await assert.rejects(service.listConversations({ authContext: {}, state: 'ai_processing' }), (error) => error.code === WORKBENCH_ERROR_CODES.requestInvalid);
});

test('HTTP server construction fails when authentication port is absent', () => {
  const services = fakeHttpServices();
  assert.throws(() => createConversationWorkbenchHttpServer({ enabled: true, ...services }), /AuthenticationPort/u);
});

test('HTTP API rejects unauthenticated and expired contexts without fallback', async () => {
  await withServer(async () => null, async (base) => {
    const response = await fetch(`${base}/api/workbench/bootstrap`); assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, WORKBENCH_ERROR_CODES.unauthenticated);
  });
  const expiredEpoch = String(Date.now() - 1);
  await withServer(async () => ({ principal_id: principalId, auth_method: 'COOKIE', expires_at: expiresAt(expiredEpoch), expires_epoch_ms: expiredEpoch, csrf_token: '0123456789abcdef' }), async (base) => {
    const response = await fetch(`${base}/api/realtime/events`); assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, WORKBENCH_ERROR_CODES.authExpired);
  });
});

test('Cookie writes require exact origin, same-site context, constant-time CSRF and matching idempotency', async () => {
  const authenticate = async () => { const epoch = expiresEpochMs(); return { principal_id: principalId, auth_method: 'COOKIE', expires_at: expiresAt(epoch), expires_epoch_ms: epoch, csrf_token: '0123456789abcdef' }; };
  await withServer(authenticate, async (base) => {
    const id = crypto.randomUUID(); const body = JSON.stringify({ client_command_id: id, expected_row_version: 1, text: 'synthetic' });
    const headers = { 'content-type': 'application/json', 'idempotency-key': id, 'if-match': '"1"', origin: 'http://wrong.invalid', 'sec-fetch-site': 'same-origin', 'x-csrf-token': '0123456789abcdef' };
    let response = await fetch(`${base}/api/conversations/${sessionId}/messages`, { method: 'POST', headers, body });
    assert.equal(response.status, 403); assert.equal((await response.json()).error.code, WORKBENCH_ERROR_CODES.originInvalid);
    headers.origin = 'http://127.0.0.1'; headers['sec-fetch-site'] = 'cross-site';
    response = await fetch(`${base}/api/conversations/${sessionId}/messages`, { method: 'POST', headers, body }); assert.equal(response.status, 403);
    headers['sec-fetch-site'] = 'same-origin'; headers['x-csrf-token'] = 'bad';
    response = await fetch(`${base}/api/conversations/${sessionId}/messages`, { method: 'POST', headers, body }); assert.equal(response.status, 403);
    headers['x-csrf-token'] = '0123456789abcdef';
    response = await fetch(`${base}/api/conversations/${sessionId}/messages`, { method: 'POST', headers, body }); assert.equal(response.status, 202);
  });
});

test('Bearer mode requires Authorization header and tokens in query are forbidden', async () => {
  const authenticate = async () => { const epoch = expiresEpochMs(); return { principal_id: principalId, auth_method: 'BEARER', expires_at: expiresAt(epoch), expires_epoch_ms: epoch }; };
  await withServer(authenticate, async (base) => {
    let response = await fetch(`${base}/api/workbench/bootstrap?token=secret`); assert.equal(response.status, 401);
    const id = crypto.randomUUID(); response = await fetch(`${base}/api/conversations/${sessionId}/release`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': id, 'if-match': '"1"' }, body: JSON.stringify({ client_command_id: id, expected_row_version: 1 }) });
    assert.equal(response.status, 401);
  });
});

test('HTTP security headers contain strict CSP without inline or eval and no wildcard CORS', async () => {
  await withServer(async () => { const epoch = expiresEpochMs(); return { principal_id: principalId, auth_method: 'COOKIE', expires_at: expiresAt(epoch), expires_epoch_ms: epoch, csrf_token: '0123456789abcdef' }; }, async (base) => {
    const response = await fetch(`${base}/api/workbench/bootstrap`); assert.equal(response.status, 200);
    const csp = response.headers.get('content-security-policy'); assert.match(csp, /default-src 'self'/u); assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/u);
    assert.equal(response.headers.get('x-frame-options'), 'DENY'); assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});

test('non-JSON and oversized write bodies are rejected with stable public errors', async () => {
  const authenticate = async () => { const epoch = expiresEpochMs(); return { principal_id: principalId, auth_method: 'COOKIE', expires_at: expiresAt(epoch), expires_epoch_ms: epoch, csrf_token: '0123456789abcdef' }; };
  await withServer(authenticate, async (base) => {
    let response = await fetch(`${base}/api/conversations/${sessionId}/release`, { method: 'POST', body: 'x' }); assert.equal(response.status, 415);
    const id = crypto.randomUUID(); response = await fetch(`${base}/api/conversations/${sessionId}/release`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1', 'sec-fetch-site': 'same-origin', 'x-csrf-token': '0123456789abcdef', 'idempotency-key': id, 'if-match': '"1"' }, body: JSON.stringify({ client_command_id: id, expected_row_version: 1, reason_code: 'X'.repeat(40_000) }) });
    assert.equal(response.status, 413);
  });
});

test('command facade delegates frozen control and communication ports without sender access', async () => {
  const calls = [];
  const facade = createConversationWorkbenchCommandFacade({ enabled: true, authorize: { ...fakeAuthorize(), isAdmin: () => true },
    controlService: { takeoverSession: async (command) => { calls.push(['takeover', command]); return { ok: true }; } },
    communicationService: { commitExternalMessage: async (command) => { calls.push(['reply', command]); return { command_status: 'COMMITTED' }; } },
    deliveryControl: { retry: async () => ({}), reconcile: async () => ({}) }, now: () => new Date('2026-09-01 08:00:00') });
  await facade.takeover({ authContext: {}, sessionId, body: { client_command_id: crypto.randomUUID(), expected_row_version: 1 } });
  await facade.reply({ authContext: {}, sessionId, body: { client_command_id: crypto.randomUUID(), expected_row_version: 2, text: 'reply' } });
  assert.equal(calls[0][0], 'takeover'); assert.equal(calls[1][0], 'reply');
  assert.equal(calls[1][1].command.destination_policy, 'SESSION_THREAD'); assert.equal(Object.hasOwn(calls[1][1].command, 'target_id'), false);
});

test('UI source renders untrusted content through text nodes only', () => {
  const source = fs.readFileSync(path.join(root, 'web/p2-workbench/workbench.js'), 'utf8');
  assert.match(source, /textContent/u); assert.match(source, /createElement/u);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/iu);
  for (const payload of ['<script>', '<img onerror=', 'javascript:', '<svg onload=', '&lt;script&gt;', '\u202E']) assert.ok(payload.length > 0);
});

test('UI reducer bounds conversations and timeline arrays', () => {
  let state = initialWorkbenchState();
  const conversations = Array.from({ length: 260 }, (_, index) => ({ session: { session_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` } }));
  state = reduceWorkbenchState(state, { type: 'CONVERSATIONS', items: conversations, nextCursor: null }); assert.equal(state.conversations.length, 200);
  const items = Array.from({ length: 500 }, (_, index) => ({ item_id: String(index) }));
  state = reduceWorkbenchState(state, { type: 'ITEMS', items }); assert.equal(state.items.length, 400);
});

test('refresh storage persists only selected id and filter', () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  saveRefreshState({ filter: 'mine', selectedSessionId: sessionId, message: 'must-not-persist', csrf: 'must-not-persist' }, storage);
  assert.deepEqual([...values.keys()].sort(), ['p2_workbench_filter', 'p2_workbench_session']);
  assert.deepEqual(loadRefreshState(storage), { filter: 'mine', selectedSessionId: sessionId });
});

test('P2-006 creates no migration and static preview check succeeds', async () => {
  assert.equal(fs.existsSync(path.join(root, 'database/migrations/022_p2_006_workbench.sql')), false);
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['scripts/p2-006-preview.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
