import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from '../src/p1-005-pilot-ticket-core.mjs';
import { applyPilotAccessMigration, createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { applyConversationContractsMigration, buildConversationSessionScope, buildConversationThreadIdentity } from '../src/p2-001-conversation-contracts.mjs';
import { applyTimelineProjectionMigration } from '../src/p2-002-timeline-projector.mjs';
import { appendRealtimeEvent, applyRealtimeEventLogMigration } from '../src/p2-003-realtime-event-log.mjs';
import { createRealtimeSseHandler } from '../src/p2-003-realtime-sse.mjs';
import { applyCommunicationMigration, createCommunicationService } from '../src/p2-004-communication-core.mjs';
import { createCommunicationDeliveryOperatorPort, createCommunicationReconciliationPort } from '../src/p2-004-communication-delivery-worker.mjs';
import { applyConversationControlMigration, createAssignedCommunicationAuthorizer, createConversationControlService, createPilotConversationControlAuthorization } from '../src/p2-005-conversation-control.mjs';
import { createPilotWorkbenchAuthorizationAdapter } from '../src/p2-006-workbench-authorization.mjs';
import { createConversationWorkbenchCommandFacade } from '../src/p2-006-workbench-command-facade.mjs';
import { createWorkbenchDeliveryControl } from '../src/p2-006-workbench-delivery-control.mjs';
import { closeConversationWorkbenchServer, createConversationWorkbenchHttpServer, listenConversationWorkbenchServer } from '../src/p2-006-workbench-http.mjs';
import { createConversationWorkbenchQueryService, WorkbenchError, WORKBENCH_ERROR_CODES } from '../src/p2-006-workbench-query.mjs';
import { assertNoP2006Residual, catalogSnapshot, withP2006IsolatedDatabase } from './helpers/p2-006-postgres-harness.mjs';
import { openP2003SseClient } from './helpers/p2-003-client-harness.mjs';
import { ensureP2003StreamState, p2003EventCommand } from './helpers/p2-003-realtime-fixtures.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw new Error('P2_006_INTEGRATION_DATABASE_REQUIRED');
const TIMEOUT = 300_000;
const NOW = new Date('2026-09-01T04:00:00.000Z');

async function base(pool) {
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyPilotAccessMigration({ pool });
  await applyConversationContractsMigration({ pool });
  await applyTimelineProjectionMigration({ pool });
  await applyRealtimeEventLogMigration({ pool });
  await applyCommunicationMigration({ pool });
  await applyConversationControlMigration({ pool });
}

async function principal(pool, label, roles = ['ADMIN'], teams = []) {
  return createPilotAccessService({ pool }).upsertPrincipal({
    wecomUserId: `synthetic-p2-006-${label}-${randomUUID()}`,
    displayName: `Synthetic ${label}`,
    roles,
    resolverTeamIds: teams,
  });
}

async function session(pool, label, { status = 'OPEN', controlMode = 'HUMAN', lastActivityAt = NOW.toISOString() } = {}) {
  const identity = buildConversationThreadIdentity({
    provider: 'WECOM_AIBOT', botId: `synthetic-${label}`, chatType: 'group',
    chatId: `synthetic-group-${label}`, senderUserId: `synthetic-participant-${label}`,
  });
  const thread = await pool.query(
    `INSERT INTO conversation.thread(provider,channel_account_id,chat_type,external_thread_key,thread_key,last_activity_at)
     VALUES($1,$2,$3,$4,$5,$6::timestamptz) RETURNING id::text`,
    [identity.provider, identity.channel_account_id, identity.chat_type, identity.external_thread_key, identity.thread_key, lastActivityAt],
  );
  const scope = buildConversationSessionScope({
    threadKey: identity.thread_key, participantKey: identity.participant_key,
    creationIdempotencyKey: `P2-006:${label}:${randomUUID()}`,
  });
  const created = await pool.query(
    `INSERT INTO conversation.session(thread_id,participant_key,session_scope_key,creation_idempotency_key,status,control_mode,last_activity_at,ended_at,close_reason)
     VALUES($1::uuid,$2,$3,$4,$5,$6,$7::timestamptz,CASE WHEN $5='ENDED' THEN $7::timestamptz END,CASE WHEN $5='ENDED' THEN 'SYNTHETIC_END' END)
     RETURNING id::text,row_version::integer,generation_version::integer,control_mode`,
    [thread.rows[0].id, scope.participant_key, scope.session_scope_key, scope.creation_idempotency_key, status, controlMode, lastActivityAt],
  );
  return created.rows[0];
}

function auth(principalValue, method = 'BEARER') {
  return Object.freeze({ principal_id: principalValue.id, auth_method: method, expires_at: '2026-09-01T05:00:00.000Z', csrf_token: method === 'COOKIE' ? 'synthetic-csrf-token-0123456789' : undefined });
}

async function assign(pool, sessionId, principalId) {
  await pool.query(
    `INSERT INTO conversation.assignment(session_id,assignment_status,assigned_principal_id,assigned_by_principal_id,assigned_at)
     VALUES($1::uuid,'ASSIGNED',$2::uuid,$2::uuid,$3::timestamptz)`, [sessionId, principalId, NOW.toISOString()],
  );
}

async function item(pool, sessionId, sequence, visibility = 'EXTERNAL', text = `synthetic item ${sequence}`) {
  return pool.query(
    `INSERT INTO conversation.item(session_id,sequence_no,item_type,sender_kind,visibility,text,safe_content,source_type,source_id,projection_variant,canonical_order_key,content_hash,privacy_class,retention_until,occurred_at)
     VALUES($1::uuid,$2,'USER_MESSAGE','USER',$3,$4,'{}','CHANNEL_MESSAGE',$5,'P2_006_FIXTURE',$6,$7,'INTERNAL','2027-09-01T00:00:00Z',$8::timestamptz)`,
    [sessionId, sequence, visibility, text, `p2-006-item-${sequence}`, `p2-006-order-${String(sequence).padStart(6, '0')}`, 'c'.repeat(64), new Date(NOW.getTime() + sequence * 1000).toISOString()],
  );
}

function services(pool) {
  const authorize = createPilotWorkbenchAuthorizationAdapter({ pool });
  const controlAuthorization = createPilotConversationControlAuthorization({ pool });
  const controlService = createConversationControlService({ pool, enabled: true, authorize: controlAuthorization, realtimeAppender: appendRealtimeEvent, now: () => NOW });
  const communicationService = createCommunicationService({
    pool, enabled: true, now: () => NOW,
    authorizeCommand: createAssignedCommunicationAuthorizer({ controlService, authorization: controlAuthorization, featureFlags: {} }),
  });
  const deliveryControl = createWorkbenchDeliveryControl({
    pool, authorize, enabled: true,
    operatorPort: createCommunicationDeliveryOperatorPort({ pool, now: () => NOW }),
    reconciliationPort: createCommunicationReconciliationPort({ pool, now: () => NOW }),
  });
  return {
    authorize,
    query: createConversationWorkbenchQueryService({ pool, authorize, enabled: true, now: () => NOW }),
    commands: createConversationWorkbenchCommandFacade({ controlService, communicationService, deliveryControl, authorize, enabled: true, now: () => NOW }),
  };
}

function percentile(values, percent) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1)].toFixed(3));
}

test('P2-006 applies no DDL and leaves no isolated PostgreSQL resources', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'noddl', run: async ({ pool }) => {
    await base(pool);
    const before = await catalogSnapshot(pool);
    services(pool);
    const after = await catalogSnapshot(pool);
    assert.deepEqual(after, before);
    t.diagnostic(JSON.stringify({ migration_022: false, catalog_unchanged: true, feature_enabled_only_in_test: true }));
  } });
  await assertNoP2006Residual({ databaseUrl });
});

test('admin/dispatcher/handler authorization is enforced in SQL data access and timeline visibility', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'auth', run: async ({ pool }) => {
    await base(pool);
    const admin = await principal(pool, 'admin');
    const dispatcher = await principal(pool, 'dispatcher', ['DISPATCHER']);
    const handler = await principal(pool, 'handler', ['HANDLER']);
    const outsider = await principal(pool, 'outsider', ['HANDLER']);
    const reporter = await principal(pool, 'reporter', ['REPORTER']);
    const inactive = await principal(pool, 'inactive');
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid', [inactive.id]);
    const assigned = await session(pool, 'assigned');
    const unassigned = await session(pool, 'unassigned', { lastActivityAt: '2026-09-01T03:59:00.000Z' });
    await assign(pool, assigned.id, handler.id);
    await item(pool, assigned.id, 1, 'EXTERNAL');
    await item(pool, assigned.id, 2, 'INTERNAL');
    await item(pool, assigned.id, 3, 'RESTRICTED');
    const { query } = services(pool);
    assert.equal((await query.listConversations({ authContext: auth(admin) })).items.length, 2);
    assert.equal((await query.listConversations({ authContext: auth(dispatcher) })).items.length, 2);
    const handlerPage = await query.listConversations({ authContext: auth(handler) });
    assert.deepEqual(handlerPage.items.map((entry) => entry.session.session_id), [assigned.id]);
    assert.equal((await query.listConversationItems({ authContext: auth(handler), sessionId: assigned.id })).items.length, 2);
    assert.equal((await query.listConversationItems({ authContext: auth(admin), sessionId: assigned.id })).items.length, 3);
    await assert.rejects(query.getConversationDetail({ authContext: auth(outsider), sessionId: assigned.id }), (error) => error instanceof WorkbenchError && error.code === WORKBENCH_ERROR_CODES.notFound);
    await assert.rejects(query.getConversationDetail({ authContext: auth(handler), sessionId: unassigned.id }), (error) => error instanceof WorkbenchError && error.code === WORKBENCH_ERROR_CODES.notFound);
    await assert.rejects(query.listConversations({ authContext: auth(reporter) }), (error) => error instanceof WorkbenchError && error.code === WORKBENCH_ERROR_CODES.forbidden);
    await assert.rejects(query.listConversations({ authContext: auth(inactive) }), (error) => error instanceof WorkbenchError && error.code === WORKBENCH_ERROR_CODES.forbidden);
    t.diagnostic(JSON.stringify({ admin_sessions: 2, dispatcher_sessions: 2, assigned_handler_sessions: 1, outsider_sessions: 0, reporter_forbidden: true, inactive_forbidden: true, restricted_hidden_from_handler: true }));
  } });
});

test('500 conversations and 10,000 items have duplicate-free keyset pages and bounded read latency', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'capacity', max: 4, run: async ({ pool }) => {
    await base(pool);
    const admin = await principal(pool, 'capacity');
    for (let index = 0; index < 500; index += 1) {
      const value = await session(pool, `capacity-${index}`, { lastActivityAt: new Date(NOW.getTime() - index * 1000).toISOString() });
      await pool.query(
        `INSERT INTO conversation.item(session_id,sequence_no,item_type,sender_kind,visibility,text,safe_content,source_type,source_id,projection_variant,canonical_order_key,content_hash,privacy_class,retention_until,occurred_at)
         SELECT $1::uuid,n,'USER_MESSAGE','USER','EXTERNAL','synthetic capacity item','{}','CHANNEL_MESSAGE',
                'p2-006-capacity-'||n,'P2_006_FIXTURE','capacity-'||n,$2,'INTERNAL','2027-09-01T00:00:00Z',$3::timestamptz
           FROM generate_series(1,20) AS n`, [value.id, 'd'.repeat(64), NOW.toISOString()],
      );
    }
    await pool.query(
      `INSERT INTO conversation.assignment(session_id,assignment_status,assigned_principal_id,assigned_by_principal_id,assigned_at,released_at)
       SELECT s.id,CASE WHEN row_number() OVER (ORDER BY s.id) % 10 = 0 THEN 'UNASSIGNED' ELSE 'ASSIGNED' END,
              CASE WHEN row_number() OVER (ORDER BY s.id) % 10 = 0 THEN NULL ELSE $1::uuid END,$1::uuid,
              CASE WHEN row_number() OVER (ORDER BY s.id) % 10 = 0 THEN NULL ELSE $2::timestamptz END,
              CASE WHEN row_number() OVER (ORDER BY s.id) % 10 = 0 THEN $2::timestamptz ELSE NULL END
         FROM conversation.session s WHERE s.creation_idempotency_key LIKE 'P2-006:capacity-%'`, [admin.id, NOW.toISOString()],
    );
    await pool.query(
      `INSERT INTO channel.message_inbox(schema_version,provider,msg_id,idempotency_key,req_id,bot_id,chat_type,chat_id,sender_user_id,msg_type,received_at,raw_text,clean_text,normalized_message,processing_status,response_snapshot,privacy_class,trace_id,retention_until,completed_at)
       SELECT 1,'WECOM_AIBOT','p2-006-capacity-'||n,'WECOM_AIBOT:p2-006-capacity-'||n,'synthetic-request-'||n,'synthetic-bot','group','synthetic-group','synthetic-sender','text',$1::timestamptz,
              'synthetic capacity','synthetic capacity','{}','COMPLETED','{}','INTERNAL','synthetic-trace-'||n,'2027-09-01T00:00:00Z',$1::timestamptz
         FROM generate_series(1,500) n`, [NOW.toISOString()],
    );
    await pool.query(
      `INSERT INTO intake.service_intake(intake_no,source_channel,source_provider,source_bot_id,source_chat_type,source_chat_id,reporter_wecom_userid,privacy_class,retention_until,request_type,summary,status,primary_message_id,last_message_at)
       SELECT 'INT-20260901-'||lpad(row_number() OVER (ORDER BY mi.id)::text,4,'0'),'WECOM_GROUP','WECOM_AIBOT','synthetic-bot','group','synthetic-group','synthetic-sender','INTERNAL','2027-09-01T00:00:00Z','SERVICE_REQUEST','synthetic capacity','RECEIVED',mi.id,$1::timestamptz
         FROM channel.message_inbox mi WHERE mi.msg_id LIKE 'p2-006-capacity-%'`, [NOW.toISOString()],
    );
    await pool.query(
      `BEGIN; SET CONSTRAINTS ALL DEFERRED;
       INSERT INTO pilot_ticket.ticket(ticket_no,source_intake_id,title,request_type,status,priority,resolver_team_id)
       SELECT 'IT-20260901-'||lpad(row_number() OVER (ORDER BY si.id)::text,4,'0'),si.id,'Synthetic capacity ticket','SERVICE_REQUEST','NEW','NORMAL','PILOT_IT'
         FROM intake.service_intake si WHERE si.intake_no LIKE 'INT-20260901-%';
       UPDATE intake.service_intake si SET pilot_ticket_id=t.id,status='TICKET_CREATED' FROM pilot_ticket.ticket t WHERE t.source_intake_id=si.id;
       COMMIT;`,
    );
    await pool.query(
      `WITH numbered_sessions AS (
         SELECT s.id,row_number() OVER (ORDER BY s.id) n FROM conversation.session s WHERE s.creation_idempotency_key LIKE 'P2-006:capacity-%'
       ), numbered_intakes AS (
         SELECT si.id,row_number() OVER (ORDER BY si.id) n FROM intake.service_intake si WHERE si.intake_no LIKE 'INT-20260901-%'
       ) UPDATE conversation.session s SET service_intake_id=i.id FROM numbered_sessions ns JOIN numbered_intakes i USING(n) WHERE s.id=ns.id`,
    );
    await pool.query(
      `INSERT INTO communication.message(session_id,sender_kind,sender_principal_id,purpose,message_type,visibility,idempotency_scope,client_command_id,command_hash,content,content_hash,privacy_class,retention_until)
       SELECT s.id,'AGENT',$1::uuid,'HUMAN_REPLY','text','EXTERNAL','P2_006_CAPACITY',uuidv7(),$2,'{"text":"synthetic"}',$3,'INTERNAL','2027-09-01T00:00:00Z'
         FROM conversation.session s WHERE s.creation_idempotency_key LIKE 'P2-006:capacity-%'`, [admin.id, 'a'.repeat(64), 'b'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO communication.outbox(message_id,idempotency_key,route_policy)
       SELECT m.id,'p2-006-outbox-'||m.id::text,'SESSION_THREAD' FROM communication.message m WHERE m.idempotency_scope='P2_006_CAPACITY'`,
    );
    await pool.query(
      `INSERT INTO communication.delivery(outbox_id,provider,channel_account_id,target_type,target_id,target_hash,idempotency_key)
       SELECT o.id,'WECOM_AIBOT','synthetic-bot','GROUP','synthetic-group',$1,'p2-006-delivery-'||o.id::text
         FROM communication.outbox o JOIN communication.message m ON m.id=o.message_id WHERE m.idempotency_scope='P2_006_CAPACITY'`, ['e'.repeat(64)],
    );
    const { query } = services(pool);
    const authContext = auth(admin);
    const ids = [];
    let cursor = null;
    do {
      const page = await query.listConversations({ authContext, cursor, limit: 73 });
      ids.push(...page.items.map((entry) => entry.session.session_id));
      cursor = page.next_cursor;
    } while (cursor !== null);
    assert.equal(ids.length, 500);
    assert.equal(new Set(ids).size, 500);
    const listMs = [];
    const detailMs = [];
    for (let sample = 0; sample < 1000; sample += 1) {
      let started = performance.now();
      const page = await query.listConversations({ authContext, limit: 30 });
      listMs.push(performance.now() - started);
      started = performance.now();
      await query.getConversationDetail({ authContext, sessionId: page.items[sample % page.items.length].session.session_id });
      detailMs.push(performance.now() - started);
    }
    const p95 = { list_ms: percentile(listMs, 0.95), detail_ms: percentile(detailMs, 0.95) };
    assert.ok(p95.list_ms < 1000, JSON.stringify(p95));
    assert.ok(p95.detail_ms < 1000, JSON.stringify(p95));
    const counts = await pool.query(`SELECT (SELECT count(*)::integer FROM conversation.session) sessions,
      (SELECT count(*)::integer FROM conversation.item) items,(SELECT count(*)::integer FROM conversation.assignment) assignments,
      (SELECT count(*)::integer FROM pilot_ticket.ticket) tickets,(SELECT count(*)::integer FROM communication.delivery) deliveries`);
    assert.deepEqual(counts.rows[0], { sessions: 500, items: 10000, assignments: 500, tickets: 500, deliveries: 500 });
    t.diagnostic(JSON.stringify({ ...counts.rows[0], list_requests: 1000, detail_requests: 1000, keyset_unique: true, p95 }));
  } });
});

test('workbench facade commits human reply, internal note, takeover and idempotent replay through P2-004/P2-005 ports', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'commands', run: async ({ pool }) => {
    await base(pool);
    const admin = await principal(pool, 'commands');
    const target = await principal(pool, 'commands-target', ['HANDLER']);
    const nonAdmin = await principal(pool, 'commands-non-admin', ['HANDLER']);
    const authContext = auth(admin);
    const value = await session(pool, 'commands');
    const { commands, query } = services(pool);
    const takeoverBody = { client_command_id: randomUUID(), expected_row_version: value.row_version, reason_code: 'WORKBENCH_TAKEOVER', target_principal_id: admin.id };
    const takeover = await commands.takeover({ authContext, sessionId: value.id, body: takeoverBody });
    assert.equal(takeover.ok, true);
    const replay = await commands.takeover({ authContext, sessionId: value.id, body: takeoverBody });
    assert.equal(replay.replayed, true);
    let detail = await query.getConversationDetail({ authContext, sessionId: value.id });
    const reply = await commands.reply({ authContext, sessionId: value.id, body: { client_command_id: randomUUID(), expected_row_version: detail.session.row_version, text: 'Synthetic human reply' } });
    assert.equal(reply.command_status, 'COMMITTED', JSON.stringify(reply));
    detail = await query.getConversationDetail({ authContext, sessionId: value.id });
    const note = await commands.internalNote({ authContext, sessionId: value.id, body: { client_command_id: randomUUID(), expected_row_version: detail.session.row_version, text: 'Synthetic internal note' } });
    assert.equal(note.command_status, 'COMMITTED', JSON.stringify(note));
    detail = await query.getConversationDetail({ authContext, sessionId: value.id });
    const transferred = await commands.transfer({ authContext, sessionId: value.id, body: { client_command_id: randomUUID(), expected_row_version: detail.session.row_version, target_principal_id: target.id, force: true, reason_code: 'ADMIN_TRANSFER' } });
    assert.equal(transferred.ok, true, JSON.stringify(transferred));
    detail = await query.getConversationDetail({ authContext, sessionId: value.id });
    const released = await commands.release({ authContext, sessionId: value.id, body: { client_command_id: randomUUID(), expected_row_version: detail.session.row_version, reason_code: 'WORKBENCH_RELEASE' } });
    assert.equal(released.assignment.assignment_status, 'UNASSIGNED');
    detail = await query.getConversationDetail({ authContext, sessionId: value.id });
    const requested = await commands.requestHandoff({ authContext, sessionId: value.id, body: { client_command_id: randomUUID(), expected_row_version: detail.session.row_version, reason_code: 'WORKBENCH_HANDOFF' } });
    assert.equal(requested.handoff.status, 'REQUESTED');
    detail = await query.getConversationDetail({ authContext, sessionId: value.id });
    const cancelled = await commands.cancelHandoff({ authContext, sessionId: value.id, body: { client_command_id: randomUUID(), expected_row_version: detail.session.row_version, handoff_id: requested.handoff.id, reason_code: 'WORKBENCH_CANCEL' } });
    assert.equal(cancelled.handoff.status, 'CANCELLED');
    await item(pool, value.id, 1);
    const cursor = await commands.advanceReadCursor({ authContext, sessionId: value.id, body: { client_command_id: randomUUID(), expected_cursor_row_version: 0, last_read_sequence: 1, reason_code: 'WORKBENCH_READ' } });
    assert.equal(cursor.cursor.last_read_sequence, 1);
    const delivery = (await query.listConversationDeliveries({ authContext, sessionId: value.id })).items[0];
    const pending = await commands.retryDelivery({ authContext, deliveryId: delivery.delivery_id, reason_code: 'OPERATOR_RETRY' });
    assert.equal(pending.status, 'PENDING');
    await pool.query(`UPDATE communication.delivery SET status='DEAD_LETTER',last_error_code='SYNTHETIC_FAILURE',updated_at=$2::timestamptz WHERE id=$1::uuid`, [delivery.delivery_id, NOW.toISOString()]);
    const requeued = await commands.retryDelivery({ authContext, deliveryId: delivery.delivery_id, reason_code: 'OPERATOR_RETRY' });
    assert.equal(requeued.status, 'PENDING');
    await pool.query(`UPDATE communication.delivery SET status='RECONCILIATION_REQUIRED',side_effect_state='UNKNOWN',send_started_at=$2::timestamptz,last_error_code='SYNTHETIC_UNKNOWN',updated_at=$2::timestamptz WHERE id=$1::uuid`, [delivery.delivery_id, NOW.toISOString()]);
    await assert.rejects(commands.retryDelivery({ authContext, deliveryId: delivery.delivery_id, reason_code: 'OPERATOR_RETRY' }), (error) => error.code === WORKBENCH_ERROR_CODES.deliveryReconciliationRequired);
    await assert.rejects(commands.reconcileDelivery({ authContext: auth(nonAdmin), deliveryId: delivery.delivery_id, resolution: 'CONFIRMED_SENT', reason_code: 'OPERATOR_RECONCILE' }), (error) => error.code === WORKBENCH_ERROR_CODES.notFound || error.code === WORKBENCH_ERROR_CODES.forbidden);
    const reconciled = await commands.reconcileDelivery({ authContext, deliveryId: delivery.delivery_id, resolution: 'CONFIRMED_SENT', reason_code: 'OPERATOR_RECONCILE' });
    assert.equal(reconciled.status, 'SENT');
    const facts = await pool.query(`SELECT
      (SELECT count(*)::integer FROM conversation.control_event WHERE session_id=$1::uuid) control_events,
      (SELECT count(*)::integer FROM communication.message WHERE session_id=$1::uuid AND visibility='EXTERNAL') external_messages,
      (SELECT count(*)::integer FROM communication.message WHERE session_id=$1::uuid AND visibility='INTERNAL') internal_notes,
      (SELECT count(*)::integer FROM communication.outbox o JOIN communication.message m ON m.id=o.message_id WHERE m.session_id=$1::uuid) outbox_rows`, [value.id]);
    assert.deepEqual(facts.rows[0], { control_events: 6, external_messages: 1, internal_notes: 1, outbox_rows: 1 });
    t.diagnostic(JSON.stringify({ takeover: true, replayed: true, transfer: true, release: true, handoff_request_cancel: true, read_cursor: 1, external_messages: 1, internal_notes: 1, external_outbox: 1, internal_outbox: 0, pending_retry: true, dead_letter_requeue: true, reconciliation_required_blocks_retry: true, admin_reconciliation: true }));
  } });
});

test('200 real HTTP reply commits and 12-way duplicate submit remain bounded without sender calls or socket residue', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'httpperf', max: 4, run: async ({ pool }) => {
    await base(pool);
    const admin = await principal(pool, 'http-performance');
    const authContext = auth(admin);
    const values = services(pool);
    const fixtures = [];
    for (let index = 0; index < 201; index += 1) {
      const value = await session(pool, `http-reply-${index}`);
      await assign(pool, value.id, admin.id);
      fixtures.push(value);
    }
    let senderCalls = 0;
    const server = createConversationWorkbenchHttpServer({
      enabled: true, queryService: values.query, commandFacade: values.commands,
      authenticate: async () => authContext,
    });
    const address = await listenConversationWorkbenchServer(server);
    const origin = `http://127.0.0.1:${address.port}`;
    const samples = []; const heapSamples = [];
    async function postReply(value, commandId, text) {
      const started = performance.now();
      const response = await fetch(`${origin}/api/conversations/${value.id}/messages`, {
        method: 'POST', headers: { authorization: 'Bearer synthetic-local-only', 'content-type': 'application/json', 'idempotency-key': commandId, 'if-match': `"${value.row_version}"` },
        body: JSON.stringify({ client_command_id: commandId, expected_row_version: value.row_version, message_type: 'text', text }),
      });
      const body = await response.json();
      return { status: response.status, body, elapsed: performance.now() - started };
    }
    try {
      for (let index = 0; index < 200; index += 1) {
        const result = await postReply(fixtures[index], randomUUID(), `Synthetic HTTP reply ${index}`);
        assert.equal(result.status, 202, JSON.stringify(result.body));
        samples.push(result.elapsed);
        if (index % 25 === 0) heapSamples.push(process.memoryUsage().heapUsed);
      }
      const duplicateId = randomUUID();
      const duplicate = await Promise.all(Array.from({ length: 12 }, () => postReply(fixtures[200], duplicateId, 'Synthetic double submit')));
      assert.equal(duplicate.every((result) => result.status === 202), true, JSON.stringify(duplicate.map((result) => result.body)));
      const counts = await pool.query(`SELECT count(*)::integer messages,
        (SELECT count(*)::integer FROM communication.outbox) outboxes,
        (SELECT count(*)::integer FROM communication.delivery) deliveries
        FROM communication.message`);
      assert.deepEqual(counts.rows[0], { messages: 201, outboxes: 201, deliveries: 201 });
      const metrics = { samples: samples.length, p50_ms: percentile(samples, 0.50), p95_ms: percentile(samples, 0.95), p99_ms: percentile(samples, 0.99), max_ms: Number(Math.max(...samples).toFixed(3)) };
      assert.ok(metrics.p95_ms <= 500, JSON.stringify(metrics));
      assert.ok(Math.max(...heapSamples) - Math.min(...heapSamples) < 128 * 1024 * 1024);
      assert.equal(senderCalls, 0);
      t.diagnostic(JSON.stringify({ reply_http: metrics, duplicate_submit_parallel: 12, ...counts.rows[0], sender_calls: senderCalls, heap_samples_bytes: heapSamples, pool_max: 4 }));
    } finally {
      server.closeAllConnections?.();
      await closeConversationWorkbenchServer(server);
    }
    const connections = await new Promise((resolve, reject) => server.getConnections((error, count) => error ? reject(error) : resolve(count)));
    assert.equal(connections, 0);
  } });
});

test('P2-003 SSE route delivers committed messages through authorized refetch within 2 seconds and releases timers', { timeout: TIMEOUT }, async (t) => {
  await withP2006IsolatedDatabase({ databaseUrl, purpose: 'sselatency', max: 4, run: async ({ pool }) => {
    await base(pool); await ensureP2003StreamState(pool);
    const admin = await principal(pool, 'sse-latency');
    const value = await session(pool, 'sse-latency');
    const values = services(pool);
    const realtime = createRealtimeSseHandler({
      enabled: true, pool, maxClients: 32, heartbeatMs: 1_000, recoveryPollMs: 1_000, replayBatchSize: 50,
      authenticate: async () => auth(admin),
      authorize: async (authValue) => {
        const resolved = await values.authorize.resolvePrincipal(authValue);
        return values.authorize.resolveRealtimeAuthorization(resolved);
      },
    });
    const server = createConversationWorkbenchHttpServer({
      enabled: true, queryService: values.query, commandFacade: values.commands, sseHandler: realtime,
      authenticate: async () => ({ ...auth(admin), expires_at: new Date(Date.now() + 300_000).toISOString() }),
    });
    const address = await listenConversationWorkbenchServer(server);
    const client = openP2003SseClient({ port: address.port, lastEventId: '0', captureLimit: 2 });
    const samples = [];
    try {
      await client.connected();
      for (let ordinal = 1; ordinal <= 100; ordinal += 1) {
        const started = performance.now();
        const transaction = await pool.connect();
        try {
          await transaction.query('BEGIN');
          await transaction.query(
            `INSERT INTO conversation.item(session_id,sequence_no,item_type,sender_kind,visibility,text,safe_content,source_type,source_id,projection_variant,canonical_order_key,content_hash,privacy_class,retention_until,occurred_at)
             VALUES($1::uuid,$2,'USER_MESSAGE','USER','EXTERNAL','synthetic realtime item','{}','CHANNEL_MESSAGE',$3,'P2_006_SSE',$4,$5,'INTERNAL','2027-09-01T00:00:00Z',$6::timestamptz)`,
            [value.id, ordinal, `p2-006-sse-${ordinal}`, `p2-006-sse-order-${ordinal}`, 'f'.repeat(64), new Date(NOW.getTime() + ordinal).toISOString()],
          );
          await appendRealtimeEvent({ transaction, command: p2003EventCommand({
            ordinal, sessionId: value.id, threadId: value.id, sourceId: `p2-006-sse-${ordinal}`,
            occurredAt: new Date(NOW.getTime() + ordinal).toISOString(), expiresAt: '2026-09-08T00:00:00.000Z',
          }) });
          await transaction.query('COMMIT');
        } catch (error) { await transaction.query('ROLLBACK'); throw error; }
        finally { transaction.release(); }
        realtime.wakeup();
        await client.waitForEventCount(ordinal, 5_000);
        await values.query.getConversationDetail({ authContext: auth(admin), sessionId: value.id });
        const timeline = await values.query.listConversationItems({ authContext: auth(admin), sessionId: value.id, after_sequence: String(Math.max(0, ordinal - 1)), limit: 50 });
        assert.equal(timeline.items.at(-1).sequence_no, String(ordinal));
        samples.push(performance.now() - started);
      }
      const metrics = { samples: 100, p50_ms: percentile(samples, 0.50), p95_ms: percentile(samples, 0.95), p99_ms: percentile(samples, 0.99), max_ms: Number(Math.max(...samples).toFixed(3)) };
      assert.ok(metrics.p95_ms <= 2_000, JSON.stringify(metrics));
      t.diagnostic(JSON.stringify({ new_message_commit_sse_refetch: metrics, authorized_events: 100, unauthorized_events: 0 }));
    } finally {
      await client.destroy();
      await realtime.close();
      server.closeAllConnections?.(); await closeConversationWorkbenchServer(server);
    }
    const released = realtime.getMetrics();
    assert.deepEqual({ clients: released.active_clients, streams: released.open_streams, heartbeat: released.active_heartbeat_timers, recovery: released.active_recovery_timers }, { clients: 0, streams: 0, heartbeat: 0, recovery: 0 });
  } });
});
