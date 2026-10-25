import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { test } from 'node:test';
import { createPostgresPool } from '../app/server/src/platform/postgres-pool.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import { migrateCurrentBaseline } from '../app/server/scripts/migrate-current-baseline.mjs';

import { applyChannelMessageInboxMigration } from '../app/server/src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../app/server/src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration } from '../app/server/src/p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration } from '../app/server/src/p1-007-notification-outbox.mjs';
import { applyPilotAccessMigration, createPilotAccessService } from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import { applyTicketClosureMigration } from '../app/server/src/p1-010-ticket-closure.mjs';
import { applyPilotOperationsMigration } from '../app/server/src/p1-011-pilot-operations-baseline.mjs';
import { applyConversationContractsMigration } from '../app/server/src/p2-001-conversation-contracts.mjs';
import { applyTimelineProjectionMigration, mapChannelMessageTimelineSource } from '../app/server/src/p2-002-timeline-projector.mjs';
import { appendRealtimeEvent, applyRealtimeEventLogMigration } from '../app/server/src/p2-003-realtime-event-log.mjs';
import { applyCommunicationMigration, createCommunicationService } from '../app/server/src/p2-004-communication-core.mjs';
import { createCommunicationDeliveryWorker } from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import { createMockCommunicationSender } from '../app/server/src/p2-004-communication-sender-port.mjs';
import { applyConversationControlMigration, CONVERSATION_CONTROL_ERROR_CODES, createAssignedCommunicationAuthorizer, createConversationControlService, createPilotConversationControlAuthorization } from '../app/server/src/p2-005-conversation-control.mjs';
import { createPilotWorkbenchAuthorizationAdapter } from '../app/server/src/p2-006-workbench-authorization.mjs';
import { createConversationWorkbenchCommandFacade } from '../app/server/src/p2-006-workbench-command-facade.mjs';
import { createConversationWorkbenchQueryService } from '../app/server/src/p2-006-workbench-query.mjs';
import { createP2G1HumanOnlyAssembly, createP2G1PilotOperationalIntake } from '../app/server/src/p2-g1-human-only-assembly.mjs';
import { createP2G1InboundProjectionCoordinator, createP2G1TimelineProjector } from '../app/server/src/p2-g1-inbound-projection-coordinator.mjs';
import { captureP2G1CatalogSnapshot } from '../app/server/src/p2-g1-observability.mjs';
import { createP2G1ProcessCluster } from '../app/server/src/p2-g1-process-cluster.mjs';
import { createP2G1Runtime } from '../app/server/src/p2-g1-runtime.mjs';
import { assertNoP2006Residual, catalogSnapshot, withP2006IsolatedDatabase } from './helpers/p2-006-postgres-harness.mjs';
import { runP2G1ReplayGap } from '../app/server/scripts/p2-g1-replay-gap-e2e.mjs';
import { submitP2G1ResourceInternalNote } from '../app/server/scripts/p2-g1-resource-observation.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw new Error('P2_G1_INTEGRATION_DATABASE_REQUIRED');
const TIMEOUT = 300_000;

async function base(pool, isolatedDatabaseUrl) {
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyNotificationOutboxMigration({ pool });
  await applyPilotAccessMigration({ pool });
  await applyTicketClosureMigration({ pool });
  await applyPilotOperationsMigration({ pool });
  await applyConversationContractsMigration({ pool });
  await applyTimelineProjectionMigration({ pool });
  await applyRealtimeEventLogMigration({ pool });
  await applyCommunicationMigration({ pool });
  await applyConversationControlMigration({ pool });
  await migrateCurrentBaseline({ databaseUrl: isolatedDatabaseUrl });
}

function frame({ msgId, sender, text, group = 'synthetic-p2-g1-group' }) {
  return { cmd: 'aibot_msg_callback', headers: { req_id: `req-${msgId}` }, body: {
    msgid: msgId, aibotid: 'synthetic-p2-g1-bot', chattype: 'group', chatid: group,
    from: { userid: sender }, msgtype: 'text', text: { content: text },
  } };
}

function operational(pool) {
  return createP2G1PilotOperationalIntake({ pool, identityHashKey: 'synthetic-p2-g1-identity-hash-key' });
}

async function principal(pool, label) {
  return createPilotAccessService({ pool }).upsertPrincipal({
    wecomUserId: `synthetic-p2-g1-${label}-${randomUUID()}`,
    displayName: `Synthetic ${label}`,
    roles: ['ADMIN'],
    resolverTeamIds: [],
  });
}

async function reservePort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForSseEvent(response, eventType, { timeoutMs = 12_000 } = {}) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffered = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      let timer;
      const result = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('P2_G1_SSE_EVENT_TIMEOUT')), remaining); }),
      ]).finally(() => clearTimeout(timer));
      if (result.done) return false;
      buffered += decoder.decode(result.value, { stream: true });
      if (buffered.includes(`event: ${eventType}\n`)) return true;
      if (buffered.length > 8192) buffered = buffered.slice(-4096);
    }
    return false;
  } finally { await reader.cancel().catch(() => {}); }
}

test('P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1core', run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
    await base(pool, isolatedDatabaseUrl);
    const catalogBefore = await catalogSnapshot(pool);
    const coordinator = createP2G1InboundProjectionCoordinator({ pool, enabled: true, batchSize: 20 });
    const intake = operational(pool);
    const assembly = createP2G1HumanOnlyAssembly({ operationalIntake: intake, coordinator });
    const messageId = `p2-g1-${randomUUID()}`;
    const firstFrame = frame({ msgId: messageId, sender: 'synthetic-participant-a', text: '新报修：合成测试终端无法登录。' });
    const first = await assembly.handleFrame(firstFrame);
    assert.equal(first.ok, true); assert.equal(first.p1_committed, true);
    let counts = await pool.query(`SELECT
      (SELECT count(*)::integer FROM pilot_ticket.ticket) tickets,
      (SELECT count(*)::integer FROM conversation.thread) threads,
      (SELECT count(*)::integer FROM conversation.session) sessions,
      (SELECT count(*)::integer FROM conversation.item WHERE item_type='USER_MESSAGE') user_items,
      (SELECT count(*)::integer FROM conversation.realtime_event WHERE event_type='conversation.item.created' AND payload->>'item_type'='USER_MESSAGE') realtime_events`);
    assert.deepEqual(counts.rows[0], { tickets: 1, threads: 1, sessions: 1, user_items: 1, realtime_events: 1 });
    const workbenchAdmin = await principal(pool, 'end-to-end-workbench');
    const workbenchAuthorization = createPilotWorkbenchAuthorizationAdapter({ pool });
    const workbench = createConversationWorkbenchQueryService({ pool, enabled: true, authorize: workbenchAuthorization });
    const visible = await workbench.listConversations({
      authContext: { principal_id: workbenchAdmin.id, auth_method: 'BEARER', expires_epoch_ms: String(Date.now() + 60_000) },
      state: 'open',
    });
    assert.equal(visible.items.length, 1);
    assert.equal(visible.items[0].last_item.item_type, 'TICKET_EVENT');
    const replay = await assembly.handleFrame(firstFrame); assert.equal(replay.ok, true);
    let versions = await pool.query('SELECT generation_version::integer,row_version::integer FROM conversation.session');
    assert.deepEqual(versions.rows[0], { generation_version: 1, row_version: 1 });
    counts = await pool.query(`SELECT (SELECT count(*)::integer FROM pilot_ticket.ticket) tickets,(SELECT count(*)::integer FROM conversation.item WHERE item_type='USER_MESSAGE') items,(SELECT count(*)::integer FROM conversation.realtime_event WHERE payload->>'item_type'='USER_MESSAGE') events`);
    assert.deepEqual(counts.rows[0], { tickets: 1, items: 1, events: 1 });

    const supplement = await assembly.handleFrame(frame({ msgId: `p2-g1-${randomUUID()}`, sender: 'synthetic-participant-a', text: '补充：合成账号仍无法登录。' }));
    assert.equal(supplement.ok, true, JSON.stringify(supplement));
    assert.equal(supplement.projection?.failures ?? 0, 0, JSON.stringify(supplement));
    versions = await pool.query('SELECT generation_version::integer,row_version::integer FROM conversation.session');
    assert.deepEqual(versions.rows[0], { generation_version: 2, row_version: 2 });
    await assembly.handleFrame(frame({ msgId: `p2-g1-${randomUUID()}`, sender: 'synthetic-participant-b', text: '新报修：HIS 登录失败，提示权限错误。' }));
    counts = await pool.query(`SELECT (SELECT count(*)::integer FROM conversation.thread) threads,(SELECT count(*)::integer FROM conversation.session) sessions,(SELECT count(*)::integer FROM pilot_ticket.ticket) tickets`);
    assert.deepEqual(counts.rows[0], { threads: 1, sessions: 2, tickets: 2 });

    const deferred = createP2G1HumanOnlyAssembly({ operationalIntake: intake, coordinator: { runOnce: async () => { throw new Error('synthetic projector stop'); } } });
    const deferredResult = await deferred.handleFrame(frame({ msgId: `p2-g1-${randomUUID()}`, sender: 'synthetic-participant-c', text: '新报修：HIS 登录失败，提示权限错误。' }));
    assert.equal(deferredResult.ok, true); assert.equal(deferredResult.projection.error_code, 'P2_G1_PROJECTION_DEFERRED');
    assert.equal((await pool.query('SELECT count(*)::integer count FROM pilot_ticket.ticket')).rows[0].count, 3);
    const recovered = await coordinator.runOnce(); assert.ok(recovered.processed >= 1); assert.equal(recovered.failures, 0);
    assert.equal((await coordinator.backlog()).total, 0);
    assert.deepEqual(await catalogSnapshot(pool), catalogBefore);
    assert.ok((await captureP2G1CatalogSnapshot(pool)).length > 0);
    t.diagnostic(JSON.stringify({ tickets: 3, duplicate_ticket_delta: 0, duplicate_item_delta: 0, participant_sessions: 3, first_versions: [1,1], next_versions: [2,2], p1_survived_projection_failure: true, recovery_backlog: 0, catalog_unchanged: true }));
  } });
});

test('P2-G1 different Intake atomically ends the prior participant Session before opening the next', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1boundary', run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
    await base(pool, isolatedDatabaseUrl);
    const coordinator = createP2G1InboundProjectionCoordinator({ pool, enabled: true, batchSize: 20 });
    const assembly = createP2G1HumanOnlyAssembly({ operationalIntake: operational(pool), coordinator });
    const sender = 'synthetic-boundary-participant';
    const first = await assembly.handleFrame(frame({ msgId: `p2-g1-${randomUUID()}`, sender, text: '新报修：合成测试终端无法登录。' }));
    const second = await assembly.handleFrame(frame({ msgId: `p2-g1-${randomUUID()}`, sender, text: '新报修：另一台合成测试终端无法登录。' }));
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.projection.failures, 0);
    const result = await pool.query(`SELECT
      count(*)::integer sessions,
      count(*) FILTER(WHERE status='ENDED' AND close_reason='DIFFERENT_INTAKE')::integer ended_for_intake,
      count(*) FILTER(WHERE status='OPEN')::integer active,
      min(generation_version) FILTER(WHERE status='OPEN')::integer active_generation,
      min(row_version) FILTER(WHERE status='OPEN')::integer active_row_version
      FROM conversation.session`);
    assert.deepEqual(result.rows[0], { sessions: 2, ended_for_intake: 1, active: 1, active_generation: 1, active_row_version: 1 });
    const counts = await pool.query(`SELECT
      (SELECT count(*)::integer FROM pilot_ticket.ticket) tickets,
      (SELECT count(*)::integer FROM conversation.item WHERE item_type='USER_MESSAGE') user_items,
      (SELECT count(*)::integer FROM conversation.realtime_event WHERE event_type='conversation.item.created' AND payload->>'item_type'='USER_MESSAGE') realtime_events`);
    assert.deepEqual(counts.rows[0], { tickets: 2, user_items: 2, realtime_events: 2 });
    t.diagnostic(JSON.stringify({ different_intake_sessions: 2, prior_ended: 1, active_sessions: 1, active_versions: [1, 1], projection_failures: 0 }));
  } });
});

test('P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1fault', run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
    await base(pool, isolatedDatabaseUrl);
    const coordinator = createP2G1InboundProjectionCoordinator({ pool, enabled: true });
    const assembly = createP2G1HumanOnlyAssembly({ operationalIntake: operational(pool), coordinator });
    await assembly.handleFrame(frame({ msgId: `p2-g1-${randomUUID()}`, sender: 'synthetic-fault-user', text: '新报修：合成工作站异常。' }));
    const session = (await pool.query('SELECT id::text,row_version::integer FROM conversation.session')).rows[0];
    const a = await principal(pool, 'agent-a'); const b = await principal(pool, 'agent-b');
    const controlAuthorization = createPilotConversationControlAuthorization({ pool });
    const controlService = createConversationControlService({ pool, enabled: true, authorize: controlAuthorization, realtimeAppender: appendRealtimeEvent });
    const take = (actor) => controlService.takeoverSession({ command_type: 'TAKEOVER', session_id: session.id, client_command_id: randomUUID(), idempotency_scope: 'P2_G1_TAKEOVER', expected_row_version: session.row_version, actor_principal_id: actor.id, target_principal_id: actor.id, reason_code: 'HUMAN_TAKEOVER' });
    const race = await Promise.all([take(a), take(b)]);
    assert.equal(race.filter((result) => result.ok).length, 1);
    assert.equal(race.filter((result) => result.error?.code === CONVERSATION_CONTROL_ERROR_CODES.sessionVersionConflict).length, 1);
    const winner = race[0].ok ? a : b;
    assert.equal((await coordinator.runOnce()).failures, 0);
    const current = (await pool.query('SELECT row_version::integer FROM conversation.session WHERE id=$1::uuid', [session.id])).rows[0];
    const communicationService = createCommunicationService({ pool, enabled: true,
      authorizeCommand: createAssignedCommunicationAuthorizer({ controlService, authorization: controlAuthorization, featureFlags: {} }) });
    const authorize = createPilotWorkbenchAuthorizationAdapter({ pool });
    const facade = createConversationWorkbenchCommandFacade({ enabled: true, authorize, controlService, communicationService,
      deliveryControl: { retry: async () => ({}), reconcile: async () => ({}) },
      now: () => new Date('2030-01-01 08:00:00') });
    const authContext = { principal_id: winner.id, auth_method: 'BEARER', expires_epoch_ms: String(Date.now() + 60_000) };
    const noteId = randomUUID();
    const note = await facade.internalNote({ authContext, sessionId: session.id, body: { client_command_id: noteId, expected_row_version: current.row_version, text: 'Synthetic internal note' } });
    assert.equal(note.command_status, 'COMMITTED');
    const noteReplay = await facade.internalNote({ authContext, sessionId: session.id, body: { client_command_id: noteId, expected_row_version: current.row_version, text: 'Synthetic internal note' } });
    assert.equal(noteReplay.replayed, true);
    let afterNote = await pool.query(`SELECT
      (SELECT count(*)::integer FROM communication.message WHERE purpose='INTERNAL_NOTE') messages,
      (SELECT count(*)::integer FROM communication.outbox) outboxes,
      (SELECT count(*)::integer FROM communication.delivery) deliveries`);
    assert.deepEqual(afterNote.rows[0], { messages: 1, outboxes: 0, deliveries: 0 });
    const noteProjection = await coordinator.runOnce();
    assert.equal(noteProjection.failures, 0, JSON.stringify(noteProjection));
    assert.equal((await pool.query("SELECT count(*)::integer count FROM conversation.item WHERE item_type='INTERNAL_NOTE'")).rows[0].count, 1);

    const replyId = randomUUID();
    const replyBody = { client_command_id: replyId, expected_row_version: current.row_version, message_type: 'text', text: 'Synthetic human reply' };
    const replies = await Promise.all(Array.from({ length: 12 }, () => facade.reply({ authContext, sessionId: session.id, body: replyBody })));
    assert.equal(replies.filter((result) => result.command_status === 'COMMITTED').length, 1);
    assert.equal(replies.filter((result) => result.command_status === 'REPLAYED').length, 11);
    const facts = await pool.query(`SELECT
      (SELECT count(*)::integer FROM communication.message WHERE purpose='HUMAN_REPLY') messages,
      (SELECT count(*)::integer FROM communication.outbox) outboxes,
      (SELECT count(*)::integer FROM communication.delivery) deliveries`);
    assert.deepEqual(facts.rows[0], { messages: 1, outboxes: 1, deliveries: 1 });
    await coordinator.runOnce();
    const deliveryId = replies[0].delivery_ids[0];
    let providerCalls = 0;
    const unavailable = createMockCommunicationSender({ behavior: async () => { const error = new Error('unavailable'); error.code = 'GATEWAY_UNAVAILABLE_BEFORE_SEND'; throw error; } });
    const workerBeforeReconnect = createCommunicationDeliveryWorker({ pool, sender: unavailable, enabled: true, retryBaseMs: 1 });
    const pending = await workerBeforeReconnect.deliver({ deliveryId }); assert.equal(pending.status, 'PENDING');
    const acknowledged = createMockCommunicationSender({ behavior: async () => { providerCalls += 1; return { outcome: 'ACKNOWLEDGED', provider_message_id: 'synthetic-ack', error_code: null }; } });
    const workerAfterReconnect = createCommunicationDeliveryWorker({ pool, sender: acknowledged, enabled: true, retryBaseMs: 1, now: () => new Date(Date.now() + 1000) });
    const sent = await workerAfterReconnect.deliver({ deliveryId }); assert.equal(sent.status, 'SENT'); assert.equal(providerCalls, 1);

    const secondReply = await facade.reply({ authContext, sessionId: session.id, body: { ...replyBody, client_command_id: randomUUID(), text: 'Synthetic ambiguous reply' } });
    const unknownSender = createMockCommunicationSender({ behavior: async () => ({ outcome: 'UNKNOWN', provider_message_id: null, error_code: 'SYNTHETIC_UNKNOWN', retryable: false }) });
    const unknownWorker = createCommunicationDeliveryWorker({ pool, sender: unknownSender, enabled: true, now: () => new Date(Date.now() + 2_000) });
    const unknown = await unknownWorker.deliver({ deliveryId: secondReply.delivery_ids[0] }); assert.equal(unknown.status, 'RECONCILIATION_REQUIRED');
    const projectedDeliveries = await coordinator.runOnce();
    assert.equal(projectedDeliveries.failures, 0, JSON.stringify(projectedDeliveries.streams.map((stream) => ({
      source_stream: stream.source_stream,
      failure_codes: stream.failures.map((failure) => failure.code),
    }))));
    assert.equal((await coordinator.backlog()).total, 0);
    assert.equal((await pool.query("SELECT count(*)::integer count FROM conversation.item WHERE source_type='DELIVERY'")).rows[0].count, 3);
    t.diagnostic(JSON.stringify({ concurrent_takeover_winners: 1, internal_note: { message: 1, outbox: 0, delivery: 0 }, duplicate_reply_parallel: 12, reply: facts.rows[0], gateway_unavailable_pending: true, reconnect_provider_calls: providerCalls, unknown_reconciliation: true, ai_calls: 0, ocr_calls: 0 }));
  } });
});

test('P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1runtime', run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
    await base(pool, isolatedDatabaseUrl);
    const admin = await principal(pool, 'runtime');
    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    const runtime = createP2G1Runtime({
      pool,
      operationalIntake: operational(pool),
      principalId: admin.id,
      publicOrigin: origin,
      listenPort: port,
      allowedTargetHashes: [],
      gatewayEnabled: false,
      senderEnabled: false,
      senderAdapter: createMockCommunicationSender(),
      projectionIntervalMs: 50,
      communicationIntervalMs: 50,
    });
    try {
      const started = await runtime.start();
      assert.equal(started.address.address, '127.0.0.1');
      assert.equal(runtime.server.maxConnections, 128);
      assert.equal(started.cookie.httpOnly, true);
      assert.equal(started.cookie.sameSite, 'Strict');
      const liveResponse = await fetch(`${origin}/health/live`);
      const readyResponse = await fetch(`${origin}/health/ready`);
      const metricsResponse = await fetch(`${origin}/health/metrics`);
      assert.equal(liveResponse.status, 200);
      assert.equal((await liveResponse.json()).ok, true);
      assert.equal(readyResponse.status, 200);
      const ready = await readyResponse.json();
      assert.equal(ready.ok, true);
      assert.equal(ready.checks.gateway_authenticated, true);
      assert.equal(metricsResponse.status, 200);
      const metrics = await metricsResponse.json();
      for (const field of ['rss_bytes','heap_used_bytes','cpu_percent','event_loop_delay_p95_ms','pool_total','pool_max','sse_clients','projection_backlog','communication_pending','dead_letter','reconciliation_required','active_resources','active_sockets']) {
        assert.equal(Number.isFinite(metrics[field]), true, field);
      }
      assert.equal(runtime.gateway.getStatus().active_gateway_count, 0);
      const sseController = new AbortController();
      try {
        const sseResponse = await fetch(`${origin}/api/realtime/events?scope=workbench`, {
          headers: { cookie: `${started.cookie.name}=${started.cookie.value}` },
          signal: sseController.signal,
        });
        assert.equal(sseResponse.status, 200);
        const observed = waitForSseEvent(sseResponse, 'conversation.item.created');
        const inbound = await runtime.assembly.handleFrame(frame({
          msgId: `p2-g1-runtime-${randomUUID()}`,
          sender: 'synthetic-runtime-new-session',
          text: '新报修：合成实时授权刷新验证。',
        }));
        assert.equal(inbound.ok, true);
        assert.equal(await observed, true, 'an SSE connection established before Session creation did not receive the new authorized event');
      } finally { sseController.abort(); }
      t.diagnostic(JSON.stringify({ app_processes: 1, loopback_http: true, readiness: true, gateway_required: false, active_gateway_count: 0, projection_batch: 20, communication_batch: 20, communication_sender: 'MOCK', sse_client_cap: 32, dynamic_realtime_authorization: true, test_auth_http_only: true, human_only: true }));
    } finally {
      await runtime.stop();
    }
  } });
});

test('P2-G1 process cluster runs App, Worker and Gateway in three bounded Node processes', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1cluster', run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
    await base(pool, isolatedDatabaseUrl);
    const principals = [await principal(pool, 'cluster-a'), await principal(pool, 'cluster-b')];
    const seed = createP2G1HumanOnlyAssembly({ operationalIntake: operational(pool), coordinator: createP2G1InboundProjectionCoordinator({ pool, enabled: true, batchSize: 20 }), privacyClass: 'INTERNAL' });
    assert.equal((await seed.handleFrame(frame({ msgId: `p2-g1-cluster-${randomUUID()}`, sender: 'synthetic-cluster-participant', text: '新报修：合成分进程资源负载。' }))).ok, true);
    const port = await reservePort();
    const cluster = createP2G1ProcessCluster({
      databaseUrl: isolatedDatabaseUrl,
      identityHashKey: 'synthetic-p2-g1-cluster-hash-key',
      principalIds: principals.map((value) => value.id),
      listenPort: port,
      gatewayEnabled: false,
      senderEnabled: false,
      allowedTargetHashes: [],
    });
    try {
      const started = await cluster.start();
      assert.equal(started.process_count, 3);
      assert.equal(started.origin, `http://127.0.0.1:${port}`);
      assert.equal(started.cookies.length, 2);
      assert.equal(started.readiness.ok, true);
      const metrics = await cluster.metrics();
      assert.equal(metrics.process_count, 3);
      assert.equal(metrics.app_pool_max, 4);
      assert.equal(metrics.worker_pool_max, 2);
      assert.equal(metrics.gateway_pool_max, 1);
      for (const field of ['app_rss_bytes','worker_rss_bytes','gateway_rss_bytes','total_rss_bytes','total_heap_used_bytes','postgres_active_connections','postgres_idle_connections','postgres_max_connections']) {
        assert.equal(Number.isFinite(metrics[field]) && metrics[field] >= 0, true, field);
      }
      assert.equal(metrics.total_rss_bytes, metrics.app_rss_bytes + metrics.worker_rss_bytes + metrics.gateway_rss_bytes);
      const beforeNote = await pool.query(`SELECT
        (SELECT count(*)::int FROM communication.message WHERE purpose='INTERNAL_NOTE') messages,
        (SELECT count(*)::int FROM communication.outbox) outboxes,
        (SELECT count(*)::int FROM communication.delivery) deliveries`);
      await submitP2G1ResourceInternalNote(started.origin, started.cookies[0], 'Synthetic bounded resource note');
      const afterNote = await pool.query(`SELECT
        (SELECT count(*)::int FROM communication.message WHERE purpose='INTERNAL_NOTE') messages,
        (SELECT count(*)::int FROM communication.outbox) outboxes,
        (SELECT count(*)::int FROM communication.delivery) deliveries`);
      assert.equal(afterNote.rows[0].messages - beforeNote.rows[0].messages, 1);
      assert.equal(afterNote.rows[0].outboxes - beforeNote.rows[0].outboxes, 0);
      assert.equal(afterNote.rows[0].deliveries - beforeNote.rows[0].deliveries, 0);
      t.diagnostic(JSON.stringify({ process_count: 3, app_pool_max: 4, worker_pool_max: 2, gateway_pool_max: 1, combined_runtime: false, raw_identifiers_recorded: false }));
    } finally {
      const stopped = await cluster.stop();
      assert.equal(stopped.process_count, 0);
    }
  } });
});

test('P2-G1 isolated PostgreSQL Replay Gap drives real Edge through Last-Event-ID, 410 and refetch', { timeout: TIMEOUT }, async (t) => {
  const result = await runP2G1ReplayGap({
    databaseUrl,
    identityHashKey: 'synthetic-p2-g1-replay-gap-hash-key',
    liveCandidate: 'a'.repeat(40),
    headless: true,
  });
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.database_scope, 'ISOLATED_POSTGRESQL_TEST_DATABASE');
  assert.equal(result.pilot_database_mutated, false);
  assert.equal(result.http_status, 410);
  assert.equal(result.eventsource_last_event_id_used, true);
  assert.ok(result.eventsource_http_410_count >= 1);
  assert.equal(result.list_refetched, true);
  assert.equal(result.detail_refetched, true);
  assert.equal(result.timeline_refetched, true);
  assert.equal(result.duplicate_timeline_item_count, 0);
  assert.equal(result.process_count, 3);
  assert.equal(result.combined_runtime, false);
  assert.equal(result.browser_cleanup, true);
  assert.equal(result.process_cleanup, true);
  const residualPool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000 });
  try {
    const residual = await residualPool.query("SELECT count(*)::int AS count FROM pg_database WHERE datname LIKE 'p2_g1_isolated_replaygap_%'");
    assert.equal(residual.rows[0].count, 0);
  } finally { await residualPool.end(); }
  t.diagnostic(JSON.stringify({ http_status: 410, last_event_id: true, refetch: ['LIST','DETAIL','TIMELINE'], process_count: 3, isolated_database_cleanup: true }));
});

test('P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1capacity', max: 4, run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
    await base(pool, isolatedDatabaseUrl); const before = await catalogSnapshot(pool);
    await pool.query(`INSERT INTO channel.message_inbox(
      schema_version,provider,msg_id,idempotency_key,req_id,bot_id,chat_type,chat_id,sender_user_id,msg_type,
      received_at,raw_text,clean_text,normalized_message,processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
      SELECT 1,'WECOM_AIBOT','p2-g1-capacity-'||n,'WECOM_AIBOT:p2-g1-capacity-'||n,'synthetic-request-'||n,
        'synthetic-bot','group','synthetic-group','synthetic-user-'||n,'text','2030-01-01 08:00:00'::timestamp without time zone,
        'synthetic inbound','synthetic inbound','{}','COMPLETED','{}','INTERNAL','synthetic-trace-'||n,
        '2031-01-01 08:00:00','2030-01-01 08:00:00'::timestamp without time zone
      FROM generate_series(1,1000) n`);
    await pool.query(`INSERT INTO intake.service_intake(
      intake_no,source_channel,source_provider,source_bot_id,source_chat_type,source_chat_id,reporter_wecom_userid,
      explicit_aggregation_boundary,privacy_class,retention_until,request_type,summary,status,primary_message_id,last_message_at)
      SELECT 'INT-20300101-'||lpad(row_number() OVER(ORDER BY id)::text,4,'0'),'WECOM_GROUP','WECOM_AIBOT','synthetic-bot','group','synthetic-group',
        sender_user_id,true,'INTERNAL','2031-01-01 08:00:00','SERVICE_REQUEST','synthetic inbound','RECEIVED',id,received_at
      FROM channel.message_inbox`);
    const coordinator = createP2G1InboundProjectionCoordinator({ pool, enabled: true, batchSize: 20 });
    let projected = 0;
    for (let run = 0; run < 60; run += 1) { const result = await coordinator.runOnce(); projected += result.processed; if ((await coordinator.backlog()).channel_messages === 0) break; }
    const inbound = await pool.query(`SELECT
      (SELECT count(*)::integer FROM conversation.thread) threads,
      (SELECT count(*)::integer FROM conversation.session) sessions,
      (SELECT count(*)::integer FROM conversation.item WHERE item_type='USER_MESSAGE') items,
      (SELECT count(*)::integer FROM conversation.realtime_event WHERE event_type='conversation.item.created') events,
      (SELECT count(*)::integer FROM conversation.session WHERE generation_version=1 AND row_version=1) initial_versions`);
    assert.deepEqual(inbound.rows[0], { threads: 1, sessions: 1000, items: 1000, events: 1000, initial_versions: 1000 });

    const admin = await principal(pool, 'capacity');
    await pool.query(`INSERT INTO communication.message(session_id,sender_kind,sender_principal_id,purpose,message_type,visibility,idempotency_scope,client_command_id,command_hash,content,content_hash,privacy_class,retention_until,created_at)
      SELECT s.id,'AGENT',$1::uuid,'HUMAN_REPLY','text','EXTERNAL','P2_G1_CAPACITY',uuidv7(),$2,'{"text":"synthetic"}',$3,'INTERNAL','2031-01-01 08:00:00','2030-01-02 08:00:00'::timestamp without time zone
      FROM conversation.session s ORDER BY s.id LIMIT 500`, [admin.id, 'a'.repeat(64), 'b'.repeat(64)]);
    await pool.query(`INSERT INTO communication.outbox(message_id,idempotency_key,route_policy)
      SELECT id,'p2-g1-capacity-outbox-'||id::text,'SESSION_THREAD' FROM communication.message WHERE idempotency_scope='P2_G1_CAPACITY'`);
    await pool.query(`INSERT INTO communication.delivery(outbox_id,provider,channel_account_id,target_type,target_id,target_hash,idempotency_key,next_attempt_at,created_at,updated_at)
      SELECT o.id,'WECOM_AIBOT','synthetic-bot','GROUP','synthetic-target',$1,'p2-g1-capacity-delivery-'||o.id::text,'2030-01-03 08:00:00','2030-01-03 08:00:00','2030-01-03 08:00:00'
      FROM communication.outbox o JOIN communication.message m ON m.id=o.message_id WHERE m.idempotency_scope='P2_G1_CAPACITY'`, ['c'.repeat(64)]);
    for (let run = 0; run < 30; run += 1) await coordinator.runOnce();
    const sender = createMockCommunicationSender();
    const worker = createCommunicationDeliveryWorker({ pool, sender, enabled: true, batchSize: 20,
      maxDeliveriesPerTargetWindow: 500, now: () => new Date('2030-01-03 08:00:00') });
    for (let run = 0; run < 25; run += 1) await worker.runOnce();
    const deliveries = await pool.query(`SELECT count(*)::integer total,count(*) FILTER(WHERE status='SENT')::integer sent FROM communication.delivery`);
    assert.deepEqual(deliveries.rows[0], { total: 500, sent: 500 }); assert.equal(sender.callCount, 500);
    assert.deepEqual(await catalogSnapshot(pool), before);
    t.diagnostic(JSON.stringify({ synthetic_inbound: 1000, projected, delivery_backlog: 500, delivery_sent: 500, sender_calls: 500, projector_batch: 20, delivery_batch: 20, pool_max: 4, catalog_unchanged: true, oom: 0, soak_24h: false }));
  } });
  await assertNoP2006Residual({ databaseUrl });
});

test('P2-G1 takes the original Thread before any Session foreign-key lock and replays the same material once',{timeout:TIMEOUT},async t=>{
 await withP2006IsolatedDatabase({databaseUrl,purpose:'g1lock',run:async({pool,databaseUrl:isolated})=>{
  await base(pool,isolated);let observation={};
 const original=await seedPersistedIntake({pool,text:'G1 lock ordering original channel material'});
 const coordinator=createP2G1InboundProjectionCoordinator({pool,enabled:true});
 const initial=await coordinator.runOnce();assert.equal(initial.failures,0);
 const session=(await pool.query('SELECT s.id::text,s.thread_id::text,i.retention_until FROM conversation.session s JOIN intake.service_intake i ON i.id=s.service_intake_id WHERE s.service_intake_id=$1::uuid',[original.intakeId])).rows[0];assert.ok(session);
 const clock=(await pool.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0];assert.ok(clock);
 const tag='g1-lock-'+randomUUID();
 const message=(await pool.query(`INSERT INTO channel.message_inbox(schema_version,provider,msg_id,idempotency_key,req_id,bot_id,
   chat_type,chat_id,sender_user_id,msg_type,received_at,raw_text,clean_text,normalized_message,
   processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
   SELECT schema_version,provider,$2,'WECOM_AIBOT:'||$2,'req-'||$2,bot_id,chat_type,chat_id,sender_user_id,msg_type,
    platform.local_from_epoch_ms($3::bigint),raw_text,clean_text,normalized_message,'COMPLETED','{}'::jsonb,privacy_class,
    'trace-'||$2,retention_until,platform.local_from_epoch_ms($3::bigint) FROM channel.message_inbox WHERE id=$1::bigint
   RETURNING id::text,provider,bot_id,chat_type,chat_id,sender_user_id,msg_type,clean_text,received_at,privacy_class,retention_until`,[original.messageId,tag,clock.epoch])).rows[0];assert.ok(message);
 await pool.query(`INSERT INTO intake.service_intake_message(intake_id,channel_message_id,relation_type,sequence_no,linked_at,trace_id)
   VALUES($1::uuid,$2::bigint,'SUPPLEMENT',2,platform.local_from_epoch_ms($3::bigint),$4)`,[original.intakeId,message.id,clock.epoch,tag]);
 const record=mapChannelMessageTimelineSource({...message,source_ordinal:2},{projectorName:'CONVERSATION_TIMELINE',projectorVersion:'P2-G1.1',sourceStream:'CHANNEL_MESSAGE_INBOX',sessionId:session.id,privacyClass:message.privacy_class,retentionUntil:message.retention_until});
 const blocker=await pool.connect();let pending=null,writerPid=null;
 const projector=createP2G1TimelineProjector({pool,enabled:true,transactionStartHook:async({transaction})=>{writerPid=(await transaction.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;}});
 try{
  await blocker.query('BEGIN');const blockerPid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await blocker.query('SELECT id FROM conversation.thread WHERE id=$1::uuid FOR UPDATE',[session.thread_id]);
  pending=projector.projectBatch({projectorName:'CONVERSATION_TIMELINE',projectorVersion:'P2-G1.1',sourceStream:'CHANNEL_MESSAGE_INBOX',records:[record],cursorValue:message.id});
  void pending.catch(()=>{});
  let blocked=false;const deadline=performance.now()+10000;
  while(performance.now()<deadline){
   if(writerPid!==null)blocked=(await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))",[writerPid,blockerPid])).rowCount===1;
   if(blocked)break;await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(blocked,true,'the original projector transaction must be waiting on the held original Thread');
  observation={blocker_pid:blockerPid,writer_pid:writerPid,session_id:session.id,thread_id:session.thread_id,writer_waiting_on_blocker:true};
  await blocker.query('SELECT id FROM conversation.session WHERE id=$1::uuid FOR UPDATE NOWAIT',[session.id]);
  observation.session_lock_available_while_thread_held=true;
  await blocker.query('ROLLBACK');const result=await pending;assert.equal(result.inserted_count,1);
  const replay=await projector.projectBatch({projectorName:'CONVERSATION_TIMELINE',projectorVersion:'P2-G1.1',sourceStream:'CHANNEL_MESSAGE_INBOX',records:[record],cursorValue:message.id});
  assert.equal(replay.inserted_count,0);assert.equal(replay.replayed_count,1);
  assert.equal((await coordinator.runOnce()).failures,0);assert.equal((await coordinator.backlog()).total,0);
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
  t.diagnostic(JSON.stringify({lock_order:'THREAD_BEFORE_SESSION',...observation,actual_inserted:1,replay_inserted:0,replay_replayed:1,backlog:0}));
 }});
});
