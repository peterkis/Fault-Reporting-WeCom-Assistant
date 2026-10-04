import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { testRoots } from './helpers/migration-roots.mjs';

import { createP2G1HumanOnlyAssembly, P2_G1_LIVE_MODES, validateP2G1ProcessApprovals } from '../src/p2-g1-human-only-assembly.mjs';
import { createP2G1InboundProjectionCoordinator, P2_G1_PROJECTION_STREAMS } from '../src/p2-g1-inbound-projection-coordinator.mjs';
import { createP2G1ProcessMetrics } from '../src/p2-g1-process-metrics.mjs';
import { createP2G1TestAuthentication } from '../src/p2-g1-test-authentication.mjs';
import { createP2G1WeComGateway } from '../src/p2-g1-wecom-gateway.mjs';
import { createP2G1WeComCommunicationSender } from '../src/p2-g1-wecom-sender.mjs';
import { configuredP2G1PrincipalIds, createP2G1RunId } from '../scripts/p2-g1-live-e2e.mjs';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

test('G1 staged preflight recognizes assembly files from source and runtime working directories without activating services', () => {
  const { sourceRoot, runtimeRoot } = testRoots();
  const script = pathToFileURL(path.join(runtimeRoot, 'scripts/p2-g1-check.mjs')).href;
  const probe = `import { runP2G1Check } from ${JSON.stringify(script)}; console.log(JSON.stringify(await runP2G1Check({ env: {} })));`;
  for (const cwd of [sourceRoot, runtimeRoot]) {
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.checks.assembly_sources_present, true, cwd);
    assert.equal(result.checks.migrations_present, true);
    assert.equal(result.checks.feature_defaults_off, true);
    assert.equal(result.checks.postgres, false);
    assert.equal(result.ok, false, 'No database check or readiness approval is implied');
  }
});

class FakeClient extends EventEmitter {
  constructor(send = async () => ({ errcode: 0, headers: { req_id: 'synthetic-ack' } })) { super(); this.send = send; this.connected = 0; this.disconnected = 0; this.calls = []; }
  connect() { this.connected += 1; }
  disconnect() { this.disconnected += 1; }
  async sendMessage(target, body) { this.calls.push({ target, body }); return this.send(target, body); }
}

test('live CLI exposes only the six explicit modes and requires three process fuses for sending', () => {
  assert.deepEqual(P2_G1_LIVE_MODES, ['inbound-shadow','human-live','reconnect','concurrent-takeover','internal-note','duplicate-reply']);
  assert.deepEqual(validateP2G1ProcessApprovals({}, { checkOnly: true }), { check_only: true, live_approved: false, send_approved: false });
  assert.throws(() => validateP2G1ProcessApprovals({}, { mode: 'human-live' }), /P2_G1_LIVE_APPROVAL_REQUIRED/u);
  const base = { P2_G1_LIVE_TEST_APPROVED: 'true', P2_G1_TEST_SCOPE_CONFIGURED: 'true' };
  assert.deepEqual(validateP2G1ProcessApprovals(base, { mode: 'inbound-shadow' }), { check_only: false, live_approved: true, send_approved: false });
  assert.deepEqual(validateP2G1ProcessApprovals(base, { mode: 'concurrent-takeover' }), { check_only: false, live_approved: true, send_approved: false });
  assert.deepEqual(validateP2G1ProcessApprovals(base, { mode: 'internal-note' }), { check_only: false, live_approved: true, send_approved: false });
  assert.throws(() => validateP2G1ProcessApprovals(base, { mode: 'human-live' }), /P2_G1_REAL_SEND_APPROVAL_REQUIRED/u);
  assert.deepEqual(validateP2G1ProcessApprovals({ ...base, P2_G1_REAL_WECOM_SEND_APPROVED: 'true' }, { mode: 'human-live' }), { check_only: false, live_approved: true, send_approved: true });
  assert.throws(() => validateP2G1ProcessApprovals({ ...base, AI_TRIAGE_ENABLED: 'true' }, { mode: 'inbound-shadow' }), /P2_G1_HUMAN_ONLY_FLAG_VIOLATION/u);
});

test('gateway process can commit inbound before the App process projects it', async () => {
  let accepted = 0;
  const assembly = createP2G1HumanOnlyAssembly({
    operationalIntake: { accept: async () => { accepted += 1; return { ok: true, result: { accepted: true } }; } },
    coordinator: null,
    projectAfterCommit: false,
    privacyClass: 'INTERNAL',
  });
  const result = await assembly.handleFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'synthetic-process-frame-request' },
    body: {
      msgid: 'synthetic-process-frame-message',
      aibotid: 'synthetic-process-bot',
      chattype: 'group',
      chatid: 'synthetic-process-group',
      from: { userid: 'synthetic-process-user' },
      msgtype: 'text',
      text: { content: '合成分进程入站。' },
    },
  });
  assert.equal(accepted, 1);
  assert.equal(result.ok, true);
  assert.equal(result.p1_committed, true);
  assert.deepEqual(result.projection, { processed: 0, failures: 0, deferred: true });
  assert.throws(() => createP2G1HumanOnlyAssembly({
    operationalIntake: { accept: async () => ({ ok: true }) },
    coordinator: { runOnce: async () => ({}) },
    projectAfterCommit: false,
  }), /P2_G1_ASSEMBLY_CONFIGURATION_INVALID/u);
});

test('process resource interface exposes bounded role metrics without a PID or environment', () => {
  const metrics = createP2G1ProcessMetrics({ role: 'APP' });
  const sample = metrics.sample();
  assert.equal(sample.role, 'APP');
  for (const field of ['rss_bytes','heap_used_bytes','heap_total_bytes','external_bytes','cpu_percent','event_loop_delay_p95_ms','active_resources','active_sockets','active_file_handles','active_handles','uptime_seconds']) {
    assert.equal(Number.isFinite(sample[field]) && sample[field] >= 0, true, field);
  }
  assert.equal(Object.hasOwn(sample, 'pid'), false);
  assert.equal(Object.hasOwn(sample, 'environment'), false);
  metrics.close();
  assert.throws(() => metrics.sample(), /P2_G1_PROCESS_METRICS_CLOSED/u);
});

test('gateway permits one active WSClient, gates readiness on authentication, reconnects and shuts down cleanly', async () => {
  const clients = [new FakeClient(), new FakeClient()]; let clientIndex = 0; let inbound = 0;
  const gateway = createP2G1WeComGateway({ enabled: true, botId: 'synthetic-bot', secret: 'synthetic-secret', clientFactory: () => clients[clientIndex++], onFrame: async () => { inbound += 1; } });
  await gateway.start();
  assert.equal(gateway.getStatus().active_gateway_count, 1);
  assert.throws(() => gateway.getAuthenticatedClient(), (error) => error.code === 'GATEWAY_UNAVAILABLE_BEFORE_SEND');
  clients[0].emit('authenticated'); assert.equal(gateway.getStatus().authenticated, true);
  clients[0].emit('message.text', { body: {} }); await new Promise((resolve) => setImmediate(resolve)); assert.equal(inbound, 1);
  clients[0].emit('disconnected'); assert.equal(gateway.getStatus().authenticated, false); assert.equal(gateway.getStatus().reconnect_total, 1);
  clients[0].emit('authenticated'); assert.equal(gateway.getAuthenticatedClient(), clients[0]);
  await gateway.stop(); assert.equal(clients[0].disconnected, 1); assert.equal(gateway.getStatus().active_gateway_count, 0);
  await gateway.start(); assert.equal(gateway.getStatus().authenticated, false); assert.equal(clients[1].connected, 1);
  clients[1].emit('authenticated'); assert.equal(gateway.getAuthenticatedClient(), clients[1]);
  await gateway.stop(); assert.equal(clients[1].disconnected, 1); assert.equal(gateway.getStatus().active_gateway_count, 0);
});

test('sender enforces persistent target hash allowlist and maps ACK, explicit rejection, unknown and gateway-unavailable safely', async () => {
  const target = 'synthetic-target'; const client = new FakeClient();
  const gateway = createP2G1WeComGateway({ enabled: true, botId: 'synthetic-bot', secret: 'synthetic-secret', clientFactory: () => client });
  await gateway.start(); client.emit('authenticated');
  const sender = createP2G1WeComCommunicationSender({ gateway, allowedTargetHashes: [hash(target)], enabled: true });
  const request = { provider: 'WECOM_AIBOT', channel_account_id: 'synthetic-bot', target_type: 'GROUP', target_id: target, delivery_id: '00000000-0000-4000-8000-000000000001', idempotency_key: 'synthetic-idempotency', message: { message_type: 'text', content: { text: 'synthetic reply' } }, signal: new AbortController().signal };
  assert.equal((await sender.send(request)).outcome, 'ACKNOWLEDGED'); assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0].body, { msgtype: 'markdown', markdown: { content: 'synthetic reply' } });
  assert.equal((await createP2G1WeComCommunicationSender({ gateway, allowedTargetHashes: [], enabled: true }).send(request)).error_code, 'P2_G1_SEND_SCOPE_FORBIDDEN');
  client.send = async () => { throw { errcode: 40003 }; }; assert.equal((await sender.send(request)).outcome, 'REJECTED_NOT_APPLIED');
  client.send = async () => ({}); assert.equal((await sender.send(request)).outcome, 'UNKNOWN');
  client.send = async () => { throw new Error('synthetic transport ambiguity'); }; assert.equal((await sender.send(request)).outcome, 'UNKNOWN');
  await gateway.stop(); await assert.rejects(sender.send(request), (error) => error.code === 'GATEWAY_UNAVAILABLE_BEFORE_SEND');
  assert.equal(JSON.stringify(await createP2G1WeComCommunicationSender({ gateway, allowedTargetHashes: [], enabled: false }).send(request)).includes(target), false);
});

test('test authentication is server-configured, active non-reporter only, short-lived and emits strict HttpOnly cookie metadata', async () => {
  const principalId = '00000000-0000-4000-8000-000000000001';
  let role = 'HANDLER'; let active = true;
  const pool = { query: async () => ({ rowCount: 1, rows: [{ id: principalId, is_active: active, roles: [role] }] }) };
  const auth = createP2G1TestAuthentication({ pool, principalId, publicOrigin: 'http://127.0.0.1:3200', token: 't'.repeat(40), csrfToken: 'c'.repeat(32) });
  const cookie = auth.browserCookie(); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict');
  assert.match(auth.setCookieHeader(), /HttpOnly; SameSite=Strict/u);
  assert.equal((await auth.authenticate({ headers: { cookie: `${cookie.name}=${cookie.value}` } })).principal_id, principalId);
  role = 'REPORTER'; assert.equal(await auth.authenticate({ headers: { cookie: `${cookie.name}=${cookie.value}` } }), null);
  role = 'ADMIN'; active = false; assert.equal(await auth.authenticate({ headers: { cookie: `${cookie.name}=${cookie.value}` } }), null);
  assert.equal(await auth.authenticate({ headers: { cookie: `${cookie.name}=wrong`, authorization: 'Bearer ignored' } }), null);
});

test('test authentication isolates two configured principals with independent short-lived cookies and CSRF values', async () => {
  const principalIds = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
  const pool = { query: async (_sql, values) => ({ rowCount: 1, rows: [{ id: values[0], is_active: true, roles: ['ADMIN'] }] }) };
  const auth = createP2G1TestAuthentication({
    pool,
    principalIds,
    publicOrigin: 'http://127.0.0.1:3200',
    tokens: ['a'.repeat(40), 'b'.repeat(40)],
    csrfTokens: ['c'.repeat(32), 'd'.repeat(32)],
  });
  const cookies = auth.browserCookies();
  assert.equal(cookies.length, 2);
  assert.notEqual(cookies[0].name, cookies[1].name);
  assert.equal((await auth.authenticate({ headers: { cookie: `${cookies[0].name}=${cookies[0].value}` } })).principal_id, principalIds[0]);
  assert.equal((await auth.authenticate({ headers: { cookie: `${cookies[1].name}=${cookies[1].value}` } })).principal_id, principalIds[1]);
  assert.notEqual((await auth.authenticate({ headers: { cookie: `${cookies[0].name}=${cookies[0].value}` } })).csrf_token,
    (await auth.authenticate({ headers: { cookie: `${cookies[1].name}=${cookies[1].value}` } })).csrf_token);
  assert.equal(await auth.authenticate({ headers: { cookie: `${cookies[0].name}=${cookies[1].value}` } }), null);
});

test('live harness requires two distinct configured principals and creates a safe unique run id', () => {
  const principals = configuredP2G1PrincipalIds({ P2_G1_TEST_PRINCIPAL_IDS: '00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002' });
  assert.equal(principals.length, 2);
  assert.throws(() => configuredP2G1PrincipalIds({ P2_G1_TEST_PRINCIPAL_ID: principals[0] }), /P2_G1_TEST_PRINCIPALS_INVALID/u);
  assert.throws(() => configuredP2G1PrincipalIds({ P2_G1_TEST_PRINCIPAL_IDS: `${principals[0]},${principals[0]}` }), /P2_G1_TEST_PRINCIPALS_INVALID/u);
  assert.equal(createP2G1RunId(new Date(2026, 8, 1, 12, 30, 0), () => 123456), 'P2G1-20260901123000-123456');
});

test('disabled coordinator performs no database work and batch/stream inventory are bounded', async () => {
  let calls = 0;
  const pool = { query: async () => { calls += 1; }, connect: async () => { calls += 1; } };
  const projector = { projectBatch: async () => { calls += 1; } };
  const coordinator = createP2G1InboundProjectionCoordinator({ pool, projector, enabled: false, batchSize: 20 });
  assert.deepEqual(await coordinator.runOnce(), { disabled: true, processed: 0, streams: [] }); assert.equal(calls, 0);
  assert.throws(() => createP2G1InboundProjectionCoordinator({ pool, projector, enabled: true, batchSize: 21 }), /P2_G1_PROJECTION_CONFIGURATION_INVALID/u);
  assert.equal(Object.keys(P2_G1_PROJECTION_STREAMS).length, 5);
});

test('temporary database failure is isolated behind stable projection errors without raw details or false success', async () => {
  const raw = 'synthetic raw database endpoint must not escape';
  const pool = { query: async () => { throw new Error(raw); }, connect: async () => { throw new Error(raw); } };
  const coordinator = createP2G1InboundProjectionCoordinator({ pool, projector: { projectBatch: async () => ({}) }, enabled: true, batchSize: 20 });
  const result = await coordinator.runOnce();
  assert.equal(result.processed, 0);
  assert.equal(result.failures, 5);
  assert.equal(JSON.stringify(result).includes(raw), false);
  assert.equal(result.streams.every((stream) => stream.failures[0].code === 'P2_G1_PROJECTION_STORAGE_FAILED'), true);
});

test('P2-002 transaction hook is optional and P2-G1 browser source has an in-flight duplicate-submit fence', () => {
  const projector = readFileSync('src/p2-002-timeline-projector.mjs', 'utf8');
  assert.match(projector, /itemTransactionHook = null/u);
  assert.match(projector, /await itemTransactionHook/u);
  const browser = readFileSync('web/p2-workbench/workbench.js', 'utf8');
  assert.match(browser, /composerPending/u);
  assert.match(browser, /if \(!value \|\| !state\.detail \|\| composerPending\) return/u);
  assert.match(browser, /eventSource\.addEventListener\(eventType, refresh\)/u);
  const realtimeSchema = JSON.parse(readFileSync('contracts/conversation_realtime_event.schema.json', 'utf8'));
  for (const eventType of realtimeSchema.$defs.event_type.enum) assert.equal(browser.includes(`'${eventType}'`), true, eventType);
  assert.match(browser, /if \(realtimeRefreshRunning\) \{ realtimeRefreshPending = true; return; \}/u);
  assert.match(browser, /while \(realtimeRefreshPending\)/u);
  assert.match(browser, /location\.hash\.match\(\/\^#test-agent-\(\[A-D\]\)\$\/u\)/u);
  assert.match(browser, /测试窗口 \$\{testSession\}/u);
  assert.match(readFileSync('web/p2-workbench/workbench.css', 'utf8'), /\[hidden\] \{ display: none !important; \}/u);
});

test('live script has no broad --live mode and no default live-send npm command', () => {
  const live = readFileSync('scripts/p2-g1-live-e2e.mjs', 'utf8');
  const browserSessions = readFileSync('src/p2-g1-browser-sessions.mjs', 'utf8');
  assert.doesNotMatch(live, /--live\b/u);
  assert.match(live, /supported_modes: P2_G1_LIVE_MODES/u);
  assert.match(live, /p2_g1_live_ready/u);
  assert.match(live, /raw_identifiers_recorded: false/u);
  assert.match(live, /sse-disconnect-a/u);
  assert.match(live, /gateway-disconnect/u);
  assert.match(live, /gateway-reconnect/u);
  assert.match(live, /createP2G1ProcessCluster/u);
  assert.match(live, /combined_runtime: false/u);
  assert.match(browserSessions, /Network\.setCookie/u);
  assert.match(browserSessions, /httpOnly: true/u);
  assert.match(browserSessions, /Promise\.race\(\[command\('Browser\.close'\), delay\(2_000\)\]\)/u);
  assert.match(browserSessions, /cleanupStaleProfiles/u);
  assert.match(browserSessions, /Page\.addScriptToEvaluateOnNewDocument/u);
  assert.match(browserSessions, /__p2g1SafeTelemetry/u);
  assert.match(browserSessions, /event_type: String\(type\), received_ms: Date\.now\(\)/u);
  assert.match(browserSessions, /category: requestCategory, start_ms: startMs, end_ms: Date\.now\(\), status:/u);
  assert.doesNotMatch(browserSessions, /lastEventId/u);
  assert.match(live, /process\.stdin\.removeAllListeners\('data'\)/u);
  assert.match(live, /process\.stdin\.pause\(\)/u);
  assert.match(readFileSync('src/p2-g1-runtime.mjs', 'utf8'), /refreshAuthorization: true/u);
  assert.match(readFileSync('src/p2-003-realtime-sse.mjs', 'utf8'), /state\.authorization = normalizeRealtimeAuthorization\(await authorizePrincipal/u);
  assert.doesNotMatch(browserSessions, /console\.(?:log|error)/u);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(Object.values(pkg.scripts).some((value) => /p2-g1-live-e2e\.mjs\s+--mode=/u.test(value)), false);
  const resource = readFileSync('scripts/p2-g1-resource-observation.mjs', 'utf8');
  assert.match(resource, /MINIMUM_DURATION_MS = 3_600_000/u);
  assert.match(resource, /app_rss_bytes/u);
  assert.match(resource, /worker_rss_bytes/u);
  assert.match(resource, /gateway_rss_bytes/u);
  assert.match(resource, /postgres_connection_utilization_percent/u);
  assert.match(resource, /claim_24h_soak: false/u);
  const replayGap = readFileSync('scripts/p2-g1-replay-gap-e2e.mjs', 'utf8');
  assert.match(replayGap, /P2_G1_ISOLATED_REPLAY_GAP_APPROVED/u);
  assert.match(replayGap, /pilot_database_mutated: false/u);
  assert.match(replayGap, /withP2G1IsolatedPostgres/u);
});
