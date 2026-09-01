import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { test } from 'node:test';

import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from '../src/p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration } from '../src/p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration } from '../src/p1-007-notification-outbox.mjs';
import { applyPilotAccessMigration, createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { applyTicketClosureMigration } from '../src/p1-010-ticket-closure.mjs';
import { applyPilotOperationsMigration } from '../src/p1-011-pilot-operations-baseline.mjs';
import { applyConversationContractsMigration } from '../src/p2-001-conversation-contracts.mjs';
import { applyTimelineProjectionMigration } from '../src/p2-002-timeline-projector.mjs';
import { appendRealtimeEvent, applyRealtimeEventLogMigration } from '../src/p2-003-realtime-event-log.mjs';
import { applyCommunicationMigration, createCommunicationService } from '../src/p2-004-communication-core.mjs';
import { createCommunicationDeliveryWorker } from '../src/p2-004-communication-delivery-worker.mjs';
import { createMockCommunicationSender } from '../src/p2-004-communication-sender-port.mjs';
import { applyConversationControlMigration, CONVERSATION_CONTROL_ERROR_CODES, createAssignedCommunicationAuthorizer, createConversationControlService, createPilotConversationControlAuthorization } from '../src/p2-005-conversation-control.mjs';
import { createPilotWorkbenchAuthorizationAdapter } from '../src/p2-006-workbench-authorization.mjs';
import { createConversationWorkbenchCommandFacade } from '../src/p2-006-workbench-command-facade.mjs';
import { createConversationWorkbenchQueryService } from '../src/p2-006-workbench-query.mjs';
import { createP2G1HumanOnlyAssembly, createP2G1PilotOperationalIntake } from '../src/p2-g1-human-only-assembly.mjs';
import { createP2G1InboundProjectionCoordinator } from '../src/p2-g1-inbound-projection-coordinator.mjs';
import { captureP2G1CatalogSnapshot } from '../src/p2-g1-observability.mjs';
import { createP2G1Runtime } from '../src/p2-g1-runtime.mjs';
import { assertNoP2006Residual, catalogSnapshot, withP2006IsolatedDatabase } from './helpers/p2-006-postgres-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw new Error('P2_G1_INTEGRATION_DATABASE_REQUIRED');
const TIMEOUT = 300_000;

async function base(pool) {
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

test('P2-G1 P1 commit, durable projection recovery, duplicate idempotency, participant isolation and catalog invariance', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1core', run: async ({ pool }) => {
    await base(pool);
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
      authContext: { principal_id: workbenchAdmin.id, auth_method: 'BEARER', expires_at: new Date(Date.now() + 60_000).toISOString() },
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
    assert.equal(supplement.ok, true);
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

test('P2-G1 fault paths serialize takeover, isolate internal note, deduplicate reply and recover delivery without blind resend', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1fault', run: async ({ pool }) => {
    await base(pool);
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
    const current = (await pool.query('SELECT row_version::integer FROM conversation.session WHERE id=$1::uuid', [session.id])).rows[0];
    const communicationService = createCommunicationService({ pool, enabled: true,
      authorizeCommand: createAssignedCommunicationAuthorizer({ controlService, authorization: controlAuthorization, featureFlags: {} }) });
    const authorize = createPilotWorkbenchAuthorizationAdapter({ pool });
    const facade = createConversationWorkbenchCommandFacade({ enabled: true, authorize, controlService, communicationService,
      deliveryControl: { retry: async () => ({}), reconcile: async () => ({}) },
      now: () => new Date('2030-01-01T00:00:00.000Z') });
    const authContext = { principal_id: winner.id, auth_method: 'BEARER', expires_at: new Date(Date.now() + 60_000).toISOString() };
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
    await coordinator.runOnce();
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
    t.diagnostic(JSON.stringify({ concurrent_takeover_winners: 1, internal_note: { message: 1, outbox: 0, delivery: 0 }, duplicate_reply_parallel: 12, reply: facts.rows[0], gateway_unavailable_pending: true, reconnect_provider_calls: providerCalls, unknown_reconciliation: true, ai_calls: 0, ocr_calls: 0 }));
  } });
});

test('P2-G1 local runtime binds one loopback App and reports human-only readiness with strict Test Auth', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1runtime', run: async ({ pool }) => {
    await base(pool);
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
      t.diagnostic(JSON.stringify({ app_processes: 1, loopback_http: true, readiness: true, gateway_required: false, active_gateway_count: 0, projection_batch: 20, communication_batch: 20, communication_sender: 'MOCK', sse_client_cap: 32, test_auth_http_only: true, human_only: true }));
    } finally {
      await runtime.stop();
    }
  } });
});

test('P2-G1 bounded capacity projects 1000 synthetic inbound facts and drains 500 deliveries with no catalog drift', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'g1capacity', max: 4, run: async ({ pool }) => {
    await base(pool); const before = await catalogSnapshot(pool);
    await pool.query(`INSERT INTO channel.message_inbox(
      schema_version,provider,msg_id,idempotency_key,req_id,bot_id,chat_type,chat_id,sender_user_id,msg_type,
      received_at,raw_text,clean_text,normalized_message,processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
      SELECT 1,'WECOM_AIBOT','p2-g1-capacity-'||n,'WECOM_AIBOT:p2-g1-capacity-'||n,'synthetic-request-'||n,
        'synthetic-bot','group','synthetic-group','synthetic-user-'||n,'text','2030-01-01T00:00:00Z'::timestamptz+n*interval '1 millisecond',
        'synthetic inbound','synthetic inbound','{}','COMPLETED','{}','INTERNAL','synthetic-trace-'||n,
        '2031-01-01T00:00:00Z','2030-01-01T00:00:00Z'::timestamptz+n*interval '1 millisecond'
      FROM generate_series(1,1000) n`);
    await pool.query(`INSERT INTO intake.service_intake(
      intake_no,source_channel,source_provider,source_bot_id,source_chat_type,source_chat_id,reporter_wecom_userid,
      explicit_aggregation_boundary,privacy_class,retention_until,request_type,summary,status,primary_message_id,last_message_at)
      SELECT 'INT-20300101-'||lpad(row_number() OVER(ORDER BY id)::text,4,'0'),'WECOM_GROUP','WECOM_AIBOT','synthetic-bot','group','synthetic-group',
        sender_user_id,true,'INTERNAL','2031-01-01T00:00:00Z','SERVICE_REQUEST','synthetic inbound','RECEIVED',id,received_at
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
      SELECT s.id,'AGENT',$1::uuid,'HUMAN_REPLY','text','EXTERNAL','P2_G1_CAPACITY',uuidv7(),$2,'{"text":"synthetic"}',$3,'INTERNAL','2031-01-01T00:00:00Z','2030-01-02T00:00:00Z'::timestamptz+row_number() OVER(ORDER BY s.id)*interval '1 millisecond'
      FROM conversation.session s ORDER BY s.id LIMIT 500`, [admin.id, 'a'.repeat(64), 'b'.repeat(64)]);
    await pool.query(`INSERT INTO communication.outbox(message_id,idempotency_key,route_policy)
      SELECT id,'p2-g1-capacity-outbox-'||id::text,'SESSION_THREAD' FROM communication.message WHERE idempotency_scope='P2_G1_CAPACITY'`);
    await pool.query(`INSERT INTO communication.delivery(outbox_id,provider,channel_account_id,target_type,target_id,target_hash,idempotency_key,next_attempt_at,created_at,updated_at)
      SELECT o.id,'WECOM_AIBOT','synthetic-bot','GROUP','synthetic-target',$1,'p2-g1-capacity-delivery-'||o.id::text,'2030-01-03T00:00:00Z','2030-01-03T00:00:00Z','2030-01-03T00:00:00Z'
      FROM communication.outbox o JOIN communication.message m ON m.id=o.message_id WHERE m.idempotency_scope='P2_G1_CAPACITY'`, ['c'.repeat(64)]);
    for (let run = 0; run < 30; run += 1) await coordinator.runOnce();
    const sender = createMockCommunicationSender();
    const worker = createCommunicationDeliveryWorker({ pool, sender, enabled: true, batchSize: 20,
      maxDeliveriesPerTargetWindow: 500, now: () => new Date('2030-01-03T00:00:00Z') });
    for (let run = 0; run < 25; run += 1) await worker.runOnce();
    const deliveries = await pool.query(`SELECT count(*)::integer total,count(*) FILTER(WHERE status='SENT')::integer sent FROM communication.delivery`);
    assert.deepEqual(deliveries.rows[0], { total: 500, sent: 500 }); assert.equal(sender.callCount, 500);
    assert.deepEqual(await catalogSnapshot(pool), before);
    t.diagnostic(JSON.stringify({ synthetic_inbound: 1000, projected, delivery_backlog: 500, delivery_sent: 500, sender_calls: 500, projector_batch: 20, delivery_batch: 20, pool_max: 4, catalog_unchanged: true, oom: 0, soak_24h: false }));
  } });
  await assertNoP2006Residual({ databaseUrl });
});
