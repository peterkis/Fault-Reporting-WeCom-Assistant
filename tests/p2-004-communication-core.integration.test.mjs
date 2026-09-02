import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { adaptWeComSdkFrame } from '../src/p1-002-wecom-sdk-adapter.mjs';
import { applyChannelMessageInboxMigration, createChannelMessageInbox } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration, createServiceIntakeProcessor } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration, createPilotTicketCore, createPilotTicketProcessor } from '../src/p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration, createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration, createNotificationDeliveryWorker, createNotificationOutbox } from '../src/p1-007-notification-outbox.mjs';
import { applyConversationContractsMigration, buildConversationSessionScope, buildConversationThreadIdentity } from '../src/p2-001-conversation-contracts.mjs';
import { applyTimelineProjectionMigration } from '../src/p2-002-timeline-projector.mjs';
import { applyRealtimeEventLogMigration } from '../src/p2-003-realtime-event-log.mjs';
import {
  COMMUNICATION_ERROR_CODES,
  applyCommunicationMigration,
  createCommunicationService,
  createP1NotificationCompatibilityAdapter,
} from '../src/p2-004-communication-core.mjs';
import { createCommunicationDeliveryWorker, createCommunicationReconciliationPort } from '../src/p2-004-communication-delivery-worker.mjs';
import { createMockCommunicationSender } from '../src/p2-004-communication-sender-port.mjs';
import { assertNoP2004Residual, withP2004IsolatedDatabase } from './helpers/p2-004-postgres-harness.mjs';
import { assertNoP2004WorkerChildResidual, killP2004WorkerChild, spawnP2004WorkerStage } from './helpers/p2-004-worker-process-harness.mjs';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.PILOT_DATABASE_URL;
if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw new Error('P2_004_INTEGRATION_DATABASE_REQUIRED');
const TEST_TIMEOUT = 180_000;
const ACTOR_ID = '018f6f15-7a11-7cc0-9e40-222222222222';
const WORKER_TEST_CLOCK_MS = Date.now() + 24 * 60 * 60 * 1000;

async function applyBaseMigrations(pool) {
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyNotificationOutboxMigration({ pool });
  await applyConversationContractsMigration({ pool });
  await applyTimelineProjectionMigration({ pool });
  await applyRealtimeEventLogMigration({ pool });
}

async function tableNames(pool) {
  const result = await pool.query(
    `SELECT schemaname || '.' || tablename AS name FROM pg_tables
      WHERE schemaname <> 'information_schema' AND schemaname !~ '^pg_'
      ORDER BY schemaname, tablename`,
  );
  return result.rows.map((row) => row.name);
}

async function catalogSignature(pool, relations) {
  const result = await pool.query(
    `SELECT relation_name,
            (SELECT jsonb_agg(jsonb_build_array(attribute.attname, format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull, pg_get_expr(default_record.adbin, default_record.adrelid)) ORDER BY attribute.attnum)
               FROM pg_attribute AS attribute
               LEFT JOIN pg_attrdef AS default_record ON default_record.adrelid = attribute.attrelid AND default_record.adnum = attribute.attnum
              WHERE attribute.attrelid = to_regclass(relation_name) AND attribute.attnum > 0 AND NOT attribute.attisdropped) AS columns,
            (SELECT jsonb_agg(jsonb_build_array(constraint_record.conname, pg_get_constraintdef(constraint_record.oid, true)) ORDER BY constraint_record.conname)
               FROM pg_constraint AS constraint_record WHERE constraint_record.conrelid = to_regclass(relation_name)) AS constraints,
            (SELECT jsonb_agg(pg_get_indexdef(index_record.indexrelid) ORDER BY index_record.indexrelid::regclass::text)
               FROM pg_index AS index_record WHERE index_record.indrelid = to_regclass(relation_name)) AS indexes
       FROM unnest($1::text[]) AS relation_name ORDER BY relation_name`,
    [relations],
  );
  return result.rows;
}

async function runMigrationCli(isolatedDatabaseUrl, mode) {
  const args = ['scripts/p2-004-migrate.mjs', mode === 'check' ? '--check' : '--migrate'];
  const { stdout, stderr } = await execFileAsync(process.execPath, args, {
    cwd: process.cwd(), env: { ...process.env, PILOT_DATABASE_URL: isolatedDatabaseUrl }, timeout: 30_000,
  });
  assert.equal(stderr, '');
  assert.equal(stdout.includes(isolatedDatabaseUrl), false);
  return JSON.parse(stdout);
}

async function createSession(pool, label, { status = 'OPEN', rowVersion = 3, chatType = 'group' } = {}) {
  const identity = buildConversationThreadIdentity({
    provider: 'WECOM_AIBOT', botId: `synthetic-account-${label}`, chatType,
    chatId: chatType === 'group' ? `synthetic-group-${label}` : null,
    senderUserId: `synthetic-participant-${label}`,
  });
  const thread = await pool.query(
    `INSERT INTO conversation.thread (provider, channel_account_id, chat_type, external_thread_key, thread_key)
     VALUES ($1,$2,$3,$4,$5) RETURNING id::text`,
    [identity.provider, identity.channel_account_id, identity.chat_type, identity.external_thread_key, identity.thread_key],
  );
  const creationKey = `P2-004-SYNTHETIC:${label}:${randomUUID()}`;
  const scope = buildConversationSessionScope({
    threadKey: identity.thread_key, participantKey: identity.participant_key,
    serviceIntakeId: null, creationIdempotencyKey: creationKey,
  });
  const session = await pool.query(
    `INSERT INTO conversation.session (
       thread_id, participant_key, session_scope_key, creation_idempotency_key,
       status, row_version, last_activity_at, ended_at, close_reason
     ) VALUES ($1::uuid,$2,$3,$4,$5,$6,'2026-08-31T00:00:00Z',
       CASE WHEN $5='ENDED' THEN '2026-08-31T00:01:00Z'::timestamptz ELSE NULL END,
       CASE WHEN $5='ENDED' THEN 'SYNTHETIC_END' ELSE NULL END)
     RETURNING id::text`,
    [thread.rows[0].id, scope.participant_key, scope.session_scope_key, scope.creation_idempotency_key, status, rowVersion],
  );
  return Object.freeze({ sessionId: session.rows[0].id, threadId: thread.rows[0].id, rowVersion, identity });
}

function externalCommand(session, overrides = {}) {
  return {
    session_id: session.sessionId, expected_row_version: session.rowVersion,
    client_command_id: randomUUID(), sender_kind: 'AGENT', message_type: 'text',
    visibility: 'EXTERNAL', text: 'synthetic reply', privacy_class: 'INTERNAL',
    retention_until: '2027-08-31T00:00:00.000Z', ...overrides,
  };
}

function systemCommand(overrides = {}) {
  return {
    client_command_id: randomUUID(), sender_system_code: 'SYNTHETIC_SYSTEM',
    message_type: 'text', content: { text: 'synthetic system notification' },
    privacy_class: 'INTERNAL', retention_until: '2027-08-31T00:00:00.000Z', ...overrides,
  };
}

function destination(label = 'one') {
  return { provider: 'WECOM_AIBOT', channel_account_id: 'synthetic-account', target_type: 'GROUP', target_id: `synthetic-target-${label}` };
}

async function factCounts(pool) {
  const result = await pool.query(
    `SELECT (SELECT count(*)::integer FROM communication.message) AS messages,
            (SELECT count(*)::integer FROM communication.outbox) AS outboxes,
            (SELECT count(*)::integer FROM communication.delivery) AS deliveries,
            (SELECT count(*)::integer FROM communication.delivery_attempt) AS attempts`,
  );
  return result.rows[0];
}

test('migration 020 is exact, reentrant, CLI-scoped, check-only, and preserves 005/010/011/012 catalogs', { timeout: TEST_TIMEOUT }, async (t) => {
  await withP2004IsolatedDatabase({ databaseUrl, purpose: 'migration', run: async ({ pool, databaseUrl: isolated }) => {
    await applyBaseMigrations(pool);
    const beforeTables = await tableNames(pool);
    const frozenRelations = [
      'notification.outbox', 'notification.delivery', 'notification.delivery_attempt',
      'conversation.thread', 'conversation.session', 'conversation.item', 'conversation.timeline_source_binding',
      'conversation.timeline_projection_checkpoint', 'conversation.realtime_event', 'conversation.realtime_stream_state',
    ];
    const frozenBefore = await catalogSignature(pool, frozenRelations);
    const check = await runMigrationCli(isolated, 'check');
    assert.deepEqual(check, {
      ok: true, task: 'P2-004', mode: 'check', migrations: ['020_p2_004_unified_communication'],
      relations: ['communication.message', 'communication.outbox', 'communication.delivery', 'communication.delivery_attempt'], feature_flags_enabled: false,
    });
    assert.deepEqual(await tableNames(pool), beforeTables);
    const first = await runMigrationCli(isolated, 'migrate');
    assert.equal(first.ok, true);
    assert.deepEqual((await tableNames(pool)).filter((name) => !beforeTables.includes(name)), [
      'communication.delivery', 'communication.delivery_attempt', 'communication.message', 'communication.outbox',
    ]);
    const communicationSignature = await catalogSignature(pool, ['communication.message', 'communication.outbox', 'communication.delivery', 'communication.delivery_attempt']);
    await applyCommunicationMigration({ pool });
    assert.deepEqual(await catalogSignature(pool, ['communication.message', 'communication.outbox', 'communication.delivery', 'communication.delivery_attempt']), communicationSignature);
    assert.deepEqual(await catalogSignature(pool, frozenRelations), frozenBefore);
    const noRoutines = await pool.query(
      `SELECT count(*)::integer AS count FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid=p.pronamespace WHERE n.nspname='communication'`,
    );
    const noTriggers = await pool.query(
      `SELECT count(*)::integer AS count FROM pg_trigger AS t JOIN pg_class AS c ON c.oid=t.tgrelid JOIN pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname='communication' AND NOT t.tgisinternal`,
    );
    assert.deepEqual({ routines: noRoutines.rows[0].count, triggers: noTriggers.rows[0].count }, { routines: 0, triggers: 0 });
    t.diagnostic(JSON.stringify({ first_apply: true, repeated_apply: true, check_rollback: true, frozen_catalog_relations: frozenRelations.length }));
  }});
});

test('migration 020 fails closed for missing columns, weakened checks, wrong unique, index method and predicate', { timeout: TEST_TIMEOUT }, async (t) => {
  const mutations = [
    ['missingcol', 'ALTER TABLE communication.message DROP COLUMN content_hash CASCADE'],
    ['weakcheck', "ALTER TABLE communication.message DROP CONSTRAINT communication_message_command_hash_check; ALTER TABLE communication.message ADD CONSTRAINT communication_message_command_hash_check CHECK (true)"],
    ['wrongunique', 'ALTER TABLE communication.message DROP CONSTRAINT communication_message_command_unique; ALTER TABLE communication.message ADD CONSTRAINT communication_message_command_unique UNIQUE (client_command_id)'],
    ['indexmethod', "DROP INDEX communication.communication_delivery_claim_idx; CREATE INDEX communication_delivery_claim_idx ON communication.delivery USING hash (status) WHERE status IN ('PENDING','LEASED')"],
    ['indexpred', "DROP INDEX communication.communication_delivery_claim_idx; CREATE INDEX communication_delivery_claim_idx ON communication.delivery USING btree (next_attempt_at, priority, created_at, id) WHERE status = 'PENDING'"],
  ];
  for (const [purpose, mutation] of mutations) {
    await withP2004IsolatedDatabase({ databaseUrl, purpose, run: async ({ pool }) => {
      await applyBaseMigrations(pool);
      await applyCommunicationMigration({ pool });
      await pool.query(mutation);
      await assert.rejects(applyCommunicationMigration({ pool }), (error) => error?.message === COMMUNICATION_ERROR_CODES.schemaDrift);
    }});
  }
  t.diagnostic(JSON.stringify({ drift_mutations: mutations.map(([name]) => name), stable_error: COMMUNICATION_ERROR_CODES.schemaDrift }));
});

test('Communication service commits atomically, isolates idempotency scopes, and never mutates Session', { timeout: TEST_TIMEOUT }, async (t) => {
  await withP2004IsolatedDatabase({ databaseUrl, purpose: 'service', run: async ({ pool }) => {
    await applyBaseMigrations(pool); await applyCommunicationMigration({ pool });
    const session = await createSession(pool, 'service');
    const service = createCommunicationService({ pool, enabled: true, authorizeCommand: async () => true });
    const command = externalCommand(session);
    const beforeSession = await pool.query('SELECT row_version, generation_version, control_mode, last_activity_at FROM conversation.session WHERE id=$1::uuid', [session.sessionId]);
    const doubleClicks = await Promise.all(Array.from({ length: 12 }, () => service.commitExternalMessage({ command, actor: { principal_id: ACTOR_ID, sender_display_name: 'display-only' } })));
    assert.equal(doubleClicks.filter((result) => result.replayed === false).length, 1);
    assert.equal(doubleClicks.filter((result) => result.replayed === true).length, 11);
    assert.deepEqual(await factCounts(pool), { messages: 1, outboxes: 1, deliveries: 1, attempts: 0 });
    assert.deepEqual(Object.keys(doubleClicks[0]), ['message_id', 'outbox_id', 'delivery_ids', 'command_status', 'replayed', 'created_at']);
    assert.equal(JSON.stringify(doubleClicks).includes(session.identity.external_thread_key), false);
    const delayedReplay = await service.commitExternalMessage({
      command: { ...command, retention_until: '2027-09-01T00:00:00.000Z' },
      actor: { principal_id: ACTOR_ID },
    });
    assert.equal(delayedReplay.replayed, true);
    assert.deepEqual(await factCounts(pool), { messages: 1, outboxes: 1, deliveries: 1, attempts: 0 });

    const conflict = await service.commitExternalMessage({ command: { ...command, text: 'changed body' }, actor: { principal_id: ACTOR_ID } });
    assert.equal(conflict.error.code, COMMUNICATION_ERROR_CODES.commandConflict);
    const secondHuman = await service.commitExternalMessage({ command: { ...command, client_command_id: randomUUID() }, actor: { principal_id: ACTOR_ID } });
    assert.equal(secondHuman.replayed, false);
    const ai = await service.commitExternalMessage({ command: { ...command, client_command_id: randomUUID(), sender_kind: 'AI', sender_system_code: 'AI_SYNTHETIC' }, actor: { kind: 'AI' } });
    assert.equal(ai.replayed, false);
    const singleSession = await createSession(pool, 'single-destination', { chatType: 'single' });
    const single = await service.commitExternalMessage({ command: externalCommand(singleSession), actor: { principal_id: ACTOR_ID } });
    const resolvedTargets = await pool.query(
      `SELECT delivery.target_type
         FROM communication.delivery AS delivery
         JOIN communication.outbox AS outbox ON outbox.id = delivery.outbox_id
        WHERE outbox.message_id = $1::uuid`,
      [single.message_id],
    );
    assert.deepEqual(resolvedTargets.rows, [{ target_type: 'PERSON' }]);
    const note = await service.commitInternalNote({ command: {
      session_id: session.sessionId, expected_row_version: session.rowVersion, client_command_id: randomUUID(),
      text: 'synthetic internal note', privacy_class: 'SENSITIVE_INTERNAL', retention_until: '2027-08-31T00:00:00Z',
    }, actor: { principal_id: ACTOR_ID } });
    assert.equal(note.outbox_id, null); assert.deepEqual(note.delivery_ids, []);
    assert.deepEqual(await factCounts(pool), { messages: 5, outboxes: 4, deliveries: 4, attempts: 0 });
    const afterSession = await pool.query('SELECT row_version, generation_version, control_mode, last_activity_at FROM conversation.session WHERE id=$1::uuid', [session.sessionId]);
    assert.deepEqual(afterSession.rows, beforeSession.rows);

    const missing = await service.commitExternalMessage({ command: { ...externalCommand(session), session_id: randomUUID() }, actor: { principal_id: ACTOR_ID } });
    assert.equal(missing.error.code, COMMUNICATION_ERROR_CODES.sessionNotFound);
    const stale = await service.commitExternalMessage({ command: { ...externalCommand(session), expected_row_version: 99 }, actor: { principal_id: ACTOR_ID } });
    assert.equal(stale.error.code, COMMUNICATION_ERROR_CODES.sessionVersionConflict);
    const ended = await createSession(pool, 'ended', { status: 'ENDED' });
    const endedResult = await service.commitExternalMessage({ command: externalCommand(ended), actor: { principal_id: ACTOR_ID } });
    assert.equal(endedResult.error.code, COMMUNICATION_ERROR_CODES.sessionEnded);
    const denied = createCommunicationService({ pool, enabled: true });
    assert.equal((await denied.commitExternalMessage({ command: externalCommand(session), actor: { principal_id: ACTOR_ID } })).error.code, COMMUNICATION_ERROR_CODES.senderUnauthorized);
    const media = await service.commitExternalMessage({ command: externalCommand(session, { message_type: 'file', attachment_ids: [randomUUID()], text: 'descriptor' }), actor: { principal_id: ACTOR_ID } });
    assert.equal(media.error.code, COMMUNICATION_ERROR_CODES.mediaNotAuthorized);

    const beforeFailure = await factCounts(pool);
    const failing = createCommunicationService({ pool, enabled: true, authorizeCommand: async () => true, destinationResolver: async () => { throw new Error('raw destination failure'); } });
    assert.equal((await failing.commitExternalMessage({ command: externalCommand(session), actor: { principal_id: ACTOR_ID } })).error.code, COMMUNICATION_ERROR_CODES.storageFailed);
    assert.deepEqual(await factCounts(pool), beforeFailure);
    t.diagnostic(JSON.stringify({ browser_double_click_concurrency: 12, committed_fact_sets: 1, human_ai_same_body_isolated: true, internal_note_outbox_count: 0 }));
  }});
});

test('Delivery Worker enforces claim CAS, ACK, retry, dead letter, timeout unknown and lease recovery', { timeout: TEST_TIMEOUT }, async (t) => {
  await withP2004IsolatedDatabase({ databaseUrl, purpose: 'worker', run: async ({ pool }) => {
    await applyBaseMigrations(pool); await applyCommunicationMigration({ pool });
    const service = createCommunicationService({ pool, enabled: true });
    let clock = WORKER_TEST_CLOCK_MS;
    const createDelivery = async (label, targets = [destination(label)]) => service.commitSystemNotification({ command: systemCommand({ content: { text: `synthetic-${label}` } }), trustedDestinations: targets });

    const ackFact = await createDelivery('ack');
    const ackSender = createMockCommunicationSender();
    const ackWorker = createCommunicationDeliveryWorker({ pool, sender: ackSender, enabled: true, now: () => new Date(clock), leaseMs: 1000, sendTimeoutMs: 100 });
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => ackWorker.runOnce({ limit: 1 })));
    assert.equal(concurrent.reduce((sum, result) => sum + result.processed, 0), 1);
    assert.equal(ackSender.callCount, 1);
    assert.equal((await ackWorker.getDelivery({ deliveryId: ackFact.delivery_ids[0] })).status, 'SENT');

    let retryCalls = 0;
    const retryFact = await createDelivery('retry');
    const retrySender = createMockCommunicationSender({ behavior: async () => {
      retryCalls += 1;
      return retryCalls === 1
        ? { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: 'GATEWAY_UNAVAILABLE', retryable: true }
        : { outcome: 'ACKNOWLEDGED', provider_message_id: 'mock-reconnect', error_code: null };
    }});
    const retryWorker = createCommunicationDeliveryWorker({ pool, sender: retrySender, enabled: true, now: () => new Date(clock), leaseMs: 1000, sendTimeoutMs: 100, retryBaseMs: 50, maxAttempts: 3 });
    assert.equal((await retryWorker.deliver({ deliveryId: retryFact.delivery_ids[0] })).status, 'PENDING');
    clock += 51;
    assert.equal((await retryWorker.deliver({ deliveryId: retryFact.delivery_ids[0] })).status, 'SENT');

    const deadFact = await createDelivery('dead');
    const deadWorker = createCommunicationDeliveryWorker({ pool, sender: createMockCommunicationSender({ behavior: async () => ({ outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: 'PERMANENT_REJECTION', retryable: false }) }), enabled: true, now: () => new Date(clock), leaseMs: 1000, sendTimeoutMs: 100, maxAttempts: 3 });
    assert.equal((await deadWorker.deliver({ deliveryId: deadFact.delivery_ids[0] })).status, 'DEAD_LETTER');

    const timeoutFact = await createDelivery('timeout');
    const timeoutWorker = createCommunicationDeliveryWorker({ pool, sender: createMockCommunicationSender({ behavior: async () => new Promise(() => {}) }), enabled: true, now: () => new Date(clock), leaseMs: 1000, sendTimeoutMs: 10 });
    assert.equal((await timeoutWorker.deliver({ deliveryId: timeoutFact.delivery_ids[0] })).status, 'RECONCILIATION_REQUIRED');

    const leasedFact = await createDelivery('leased');
    await pool.query("UPDATE communication.delivery SET status='LEASED', lease_token=$2::uuid, lease_expires_at=$3::timestamptz WHERE id=$1::uuid", [leasedFact.delivery_ids[0], randomUUID(), new Date(clock - 1)]);
    assert.equal((await ackWorker.deliver({ deliveryId: leasedFact.delivery_ids[0] })).status, 'SENT');

    const sendingFact = await createDelivery('sending');
    const staleToken = randomUUID();
    await pool.query(
      `UPDATE communication.delivery SET status='SENDING', attempt_count=1, lease_token=$2::uuid,
       lease_expires_at=$3::timestamptz, send_started_at=$4::timestamptz WHERE id=$1::uuid`,
      [sendingFact.delivery_ids[0], staleToken, new Date(clock - 1), new Date(clock - 100)],
    );
    await pool.query(
      `INSERT INTO communication.delivery_attempt (delivery_id,attempt_no,outcome,side_effect_state,lease_token,request_id,started_at)
       VALUES ($1::uuid,1,'STARTED','NOT_ATTEMPTED',$2::uuid,'synthetic-stale',$3::timestamptz)`,
      [sendingFact.delivery_ids[0], staleToken, new Date(clock - 100)],
    );
    const recovered = await ackWorker.recoverExpiredSending();
    assert.equal(recovered.delivery_ids.includes(sendingFact.delivery_ids[0]), true);
    assert.equal((await ackWorker.getDelivery({ deliveryId: sendingFact.delivery_ids[0] })).status, 'RECONCILIATION_REQUIRED');
    const attempts = await pool.query('SELECT outcome FROM communication.delivery_attempt WHERE delivery_id=$1::uuid ORDER BY attempt_no', [sendingFact.delivery_ids[0]]);
    assert.deepEqual(attempts.rows, [{ outcome: 'RECONCILIATION_REQUIRED' }]);
    t.diagnostic(JSON.stringify({ concurrent_workers: 12, single_claim: true, gateway_reconnect: true, timeout_unknown: true, leased_recovered: true, sending_not_resent: true }));
  }});
});

test('multi-target delivery is isolated, target rate limit is durable, and reconciliation is explicit', { timeout: TEST_TIMEOUT }, async (t) => {
  await withP2004IsolatedDatabase({ databaseUrl, purpose: 'targets', run: async ({ pool }) => {
    await applyBaseMigrations(pool); await applyCommunicationMigration({ pool });
    const service = createCommunicationService({ pool, enabled: true });
    let clock = WORKER_TEST_CLOCK_MS;
    const multi = await service.commitSystemNotification({ command: systemCommand(), trustedDestinations: [destination('good'), destination('bad')] });
    const sender = createMockCommunicationSender({ behavior: async (request) => request.target_id.endsWith('bad')
      ? { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: 'SYNTHETIC_REJECTION', retryable: false }
      : { outcome: 'ACKNOWLEDGED', provider_message_id: 'mock-good', error_code: null } });
    const worker = createCommunicationDeliveryWorker({ pool, sender, enabled: true, now: () => new Date(clock), leaseMs: 1000, sendTimeoutMs: 100 });
    const processed = await worker.runOnce({ limit: 2 });
    assert.deepEqual(processed.results.map((row) => row.status).sort(), ['DEAD_LETTER', 'SENT']);

    const sameTargetOne = await service.commitSystemNotification({ command: systemCommand(), trustedDestinations: [destination('limited')] });
    const sameTargetTwo = await service.commitSystemNotification({ command: systemCommand(), trustedDestinations: [destination('limited')] });
    const rateWorker = createCommunicationDeliveryWorker({ pool, sender: createMockCommunicationSender(), enabled: true, now: () => new Date(clock), leaseMs: 1000, sendTimeoutMs: 100, maxDeliveriesPerTargetWindow: 1, rateLimitWindowMs: 1000 });
    assert.equal((await rateWorker.deliver({ deliveryId: sameTargetOne.delivery_ids[0] })).status, 'SENT');
    assert.equal(await rateWorker.deliver({ deliveryId: sameTargetTwo.delivery_ids[0] }), null);
    clock += 1001;
    assert.equal((await rateWorker.deliver({ deliveryId: sameTargetTwo.delivery_ids[0] })).status, 'SENT');

    const unknown = await service.commitSystemNotification({ command: systemCommand(), trustedDestinations: [destination('unknown')] });
    const unknownWorker = createCommunicationDeliveryWorker({ pool, sender: createMockCommunicationSender({ behavior: async () => ({ outcome: 'UNKNOWN', provider_message_id: null, error_code: 'ACK_LOST' }) }), enabled: true, now: () => new Date(clock), leaseMs: 1000, sendTimeoutMs: 100 });
    assert.equal((await unknownWorker.deliver({ deliveryId: unknown.delivery_ids[0] })).status, 'RECONCILIATION_REQUIRED');
    const port = createCommunicationReconciliationPort({ pool, now: () => new Date(clock + 1) });
    assert.equal((await port.reconcileUnknownDelivery({ deliveryId: unknown.delivery_ids[0], expectedStatus: 'RECONCILIATION_REQUIRED', resolution: 'CONFIRMED_SENT', reasonCode: 'MANUAL_PROVIDER_CONFIRMATION', authorized: false })).error.code, COMMUNICATION_ERROR_CODES.reconciliationUnauthorized);
    assert.equal((await port.reconcileUnknownDelivery({ deliveryId: unknown.delivery_ids[0], expectedStatus: 'RECONCILIATION_REQUIRED', resolution: 'CONFIRMED_SENT', reasonCode: 'MANUAL_PROVIDER_CONFIRMATION', authorized: true })).status, 'SENT');
    const audit = await pool.query('SELECT outcome,side_effect_state FROM communication.delivery_attempt WHERE delivery_id=$1::uuid ORDER BY attempt_no', [unknown.delivery_ids[0]]);
    assert.deepEqual(audit.rows.map((row) => row.outcome), ['RECONCILIATION_REQUIRED', 'SENT']);
    for (const [label, resolution, expectedStatus] of [
      ['unknown-requeue', 'CONFIRMED_NOT_SENT_REQUEUE', 'PENDING'],
      ['unknown-cancel', 'CANCEL', 'CANCELLED'],
    ]) {
      const fact = await service.commitSystemNotification({ command: systemCommand(), trustedDestinations: [destination(label)] });
      assert.equal((await unknownWorker.deliver({ deliveryId: fact.delivery_ids[0] })).status, 'RECONCILIATION_REQUIRED');
      assert.equal((await port.reconcileUnknownDelivery({
        deliveryId: fact.delivery_ids[0], expectedStatus: 'RECONCILIATION_REQUIRED', resolution,
        reasonCode: 'MANUAL_PROVIDER_CONFIRMATION', authorized: true,
      })).status, expectedStatus);
    }
    t.diagnostic(JSON.stringify({ multi_target_count: multi.delivery_ids.length, isolated_outcomes: ['SENT', 'DEAD_LETTER'], target_rate_limit: true, reconciliation_resolutions: ['CONFIRMED_SENT', 'CONFIRMED_NOT_SENT_REQUEUE', 'CANCEL'] }));
  }});
});

test('real Worker kill/restart reclaims LEASED but never blindly resends SENDING', { timeout: TEST_TIMEOUT }, async (t) => {
  await withP2004IsolatedDatabase({ databaseUrl, purpose: 'killworker', run: async ({ pool, databaseUrl: isolated }) => {
    await applyBaseMigrations(pool); await applyCommunicationMigration({ pool });
    const service = createCommunicationService({ pool, enabled: true });
    const leasedFact = await service.commitSystemNotification({ command: systemCommand(), trustedDestinations: [destination('kill-leased')] });
    const leasedChild = await spawnP2004WorkerStage({ databaseUrl: isolated, deliveryId: leasedFact.delivery_ids[0], mode: 'LEASED', nowMs: WORKER_TEST_CLOCK_MS });
    const leasedExit = await killP2004WorkerChild(leasedChild);
    assert.notEqual(leasedExit.signal ?? leasedExit.code, null);
    const restartSender = createMockCommunicationSender();
    const restartWorker = createCommunicationDeliveryWorker({ pool, sender: restartSender, enabled: true, now: () => new Date(WORKER_TEST_CLOCK_MS + 1001), leaseMs: 1000, sendTimeoutMs: 100 });
    assert.equal((await restartWorker.deliver({ deliveryId: leasedFact.delivery_ids[0] })).status, 'SENT');
    assert.equal(restartSender.callCount, 1);

    const sendingFact = await service.commitSystemNotification({ command: systemCommand(), trustedDestinations: [destination('kill-sending')] });
    const sendingChild = await spawnP2004WorkerStage({ databaseUrl: isolated, deliveryId: sendingFact.delivery_ids[0], mode: 'SENDING', nowMs: WORKER_TEST_CLOCK_MS });
    const sendingExit = await killP2004WorkerChild(sendingChild);
    assert.notEqual(sendingExit.signal ?? sendingExit.code, null);
    const noResendSender = createMockCommunicationSender();
    const noResendWorker = createCommunicationDeliveryWorker({ pool, sender: noResendSender, enabled: true, now: () => new Date(WORKER_TEST_CLOCK_MS + 120_001), leaseMs: 1000, sendTimeoutMs: 100 });
    assert.equal((await noResendWorker.recoverExpiredSending()).recovered, 1);
    assert.equal((await noResendWorker.getDelivery({ deliveryId: sendingFact.delivery_ids[0] })).status, 'RECONCILIATION_REQUIRED');
    assert.equal(noResendSender.callCount, 0);
    t.diagnostic(JSON.stringify({ leased_child_exit: leasedExit, leased_restart_sent: true, sending_child_exit: sendingExit, sending_restart_reconciled: true, blind_resend_count: 0 }));
  }});
});

test('P1 compatibility is read-only until it delegates to the existing P1 worker', { timeout: TEST_TIMEOUT }, async (t) => {
  await withP2004IsolatedDatabase({ databaseUrl, purpose: 'legacy', run: async ({ pool }) => {
    await applyBaseMigrations(pool); await applyCommunicationMigration({ pool });
    const msgId = `p2-004-p1-${randomUUID()}`;
    const adapted = adaptWeComSdkFrame({
      cmd: 'aibot_msg_callback', headers: { req_id: `req-${msgId}` }, body: {
        msgid: msgId, aibotid: 'synthetic-bot', chattype: 'group', chatid: `synthetic-group-${msgId}`,
        from: { userid: `synthetic-reporter-${msgId}` }, msgtype: 'text', text: { content: 'HIS 登录失败，提示权限错误' },
      },
    }, { receivedAt: '2026-08-31T00:00:00.000Z' });
    const processor = createPilotTicketProcessor({ serviceIntakeProcessor: createServiceIntakeProcessor(), ticketCore: createPilotTicketCore({ pool }) });
    const accepted = await createChannelMessageInbox({ pool }).accept({
      message: adapted.message, traceId: `trace-${msgId}`, privacyClass: 'INTERNAL', retentionUntil: '2027-08-31T00:00:00Z',
    }, processor);
    const outbox = createNotificationOutbox({ targetsForEvent: () => [{ channel: 'PILOT_TEAM', targetKey: 'synthetic-team-target' }] });
    const actions = createTicketActionService({ pool, afterAction: (context) => outbox.enqueueTicketEvent(context) });
    const action = await actions.perform({
      ticketId: accepted.result.ticket.id, action: 'accept', actor: { type: 'PILOT_USER', id: randomUUID() },
      expectedVersion: accepted.result.ticket.version, note: 'synthetic acceptance', externalVisible: true, traceId: `trace-action-${msgId}`,
    });
    const deliveryId = action.side_effects.delivery_ids[0];
    const legacyWorker = createNotificationDeliveryWorker({ pool, sender: async () => ({ ok: true, providerMessageId: 'legacy-mock-ack' }) });
    const adapter = createP1NotificationCompatibilityAdapter({ pool, legacyWorker });
    const before = await catalogSignature(pool, ['notification.outbox', 'notification.delivery', 'notification.delivery_attempt']);
    const view = await adapter.getLegacyDeliveryView({ deliveryId });
    const list = await adapter.listLegacyDeliveryViews({ limit: 10 });
    assert.equal(view.source_kind, 'P1_NOTIFICATION');
    assert.equal(list.some((entry) => entry.delivery_id === deliveryId), true);
    assert.deepEqual(await catalogSignature(pool, ['notification.outbox', 'notification.delivery', 'notification.delivery_attempt']), before);
    assert.equal(JSON.stringify(view).includes('synthetic-team-target'), false);
    const delivered = await adapter.deliverLegacy({ deliveryId });
    assert.equal(delivered.status, 'SENT');
    assert.deepEqual(await factCounts(pool), { messages: 0, outboxes: 0, deliveries: 0, attempts: 0 });
    t.diagnostic(JSON.stringify({ p1_read_snapshot_unchanged: true, p1_delivery_delegated: true, communication_rows_created: 0 }));
  }});
});

test('500 deliveries remain bounded at batch 20 and interruption resumes without resource growth', { timeout: TEST_TIMEOUT }, async (t) => {
  await withP2004IsolatedDatabase({ databaseUrl, purpose: 'capacity', run: async ({ pool }) => {
    await applyBaseMigrations(pool); await applyCommunicationMigration({ pool });
    const service = createCommunicationService({ pool, enabled: true });
    for (let message = 0; message < 25; message += 1) {
      const targets = Array.from({ length: 20 }, (_, index) => destination(`capacity-${message}-${index}`));
      const result = await service.commitSystemNotification({ command: systemCommand({ content: { text: `capacity-${message}` } }), trustedDestinations: targets });
      assert.equal(result.delivery_ids.length, 20);
    }
    const sender = createMockCommunicationSender();
    const worker = createCommunicationDeliveryWorker({ pool, sender, enabled: true, now: () => new Date(WORKER_TEST_CLOCK_MS), batchSize: 20, leaseMs: 1000, sendTimeoutMs: 100 });
    const heapSamples = [process.memoryUsage().heapUsed];
    let processed = 0;
    for (let run = 0; run < 5; run += 1) {
      const result = await worker.runOnce(); processed += result.processed; heapSamples.push(process.memoryUsage().heapUsed);
    }
    assert.equal(processed, 100);
    for (;;) {
      const result = await worker.runOnce();
      processed += result.processed;
      if (result.processed === 0) break;
      if (processed % 100 === 0) heapSamples.push(process.memoryUsage().heapUsed);
    }
    assert.equal(processed, 500); assert.equal(sender.callCount, 500);
    const states = await pool.query('SELECT status,count(*)::integer AS count FROM communication.delivery GROUP BY status');
    assert.deepEqual(states.rows, [{ status: 'SENT', count: 500 }]);
    const growth = heapSamples.at(-1) - heapSamples[0];
    assert.ok(growth < 32 * 1024 * 1024, `bounded heap growth expected, observed ${growth}`);
    t.diagnostic(JSON.stringify({ deliveries: 500, batch_size: 20, interrupted_after: 100, resumed_to: 500, heap_samples: heapSamples, heap_growth_bytes: growth, soak_claimed: false }));
  }});
});

test('P2-004 integration leaves no owned database or backend residual', { timeout: TEST_TIMEOUT }, async (t) => {
  const childResidual = assertNoP2004WorkerChildResidual();
  const residual = await assertNoP2004Residual({ databaseUrl });
  t.diagnostic(JSON.stringify({ ...residual, ...childResidual, worker_count: 0, timer_count: 0, child_process_count: 0 }));
});
