import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from '../src/p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration } from '../src/p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration } from '../src/p1-007-notification-outbox.mjs';
import {
  applyConversationContractsMigration,
  buildConversationSessionScope,
  buildConversationThreadIdentity,
} from '../src/p2-001-conversation-contracts.mjs';
import { applyTimelineProjectionMigration } from '../src/p2-002-timeline-projector.mjs';
import {
  REALTIME_ERROR_CODES,
  REALTIME_STREAM_NAME,
  appendRealtimeEvent,
  applyRealtimeEventLogMigration,
  checkRealtimeRetention,
  cleanupRealtimeRetention,
  createRealtimeEventStore,
  getRealtimeReplayWindow,
  listAuthorizedRealtimeEvents,
} from '../src/p2-003-realtime-event-log.mjs';
import {
  assertNoP2003CliChildResidual,
  runP2003MigrationProcess,
  runP2003RetentionProcess,
} from './helpers/p2-003-cli-process-harness.mjs';
import {
  assertNoP2003ClientResidual,
  destroyAllP2003SseClients,
  openP2003SseClient,
  requestP2003Fallback,
} from './helpers/p2-003-client-harness.mjs';
import {
  assertNoP2003OwnedDatabaseResidual,
  waitForP2003BackendClosed,
  withP2003IsolatedDatabase,
} from './helpers/p2-003-postgres-harness.mjs';
import {
  ensureP2003StreamState,
  insertP2003MinimalEvents,
  p2003Authorization,
  p2003EventCommand,
} from './helpers/p2-003-realtime-fixtures.mjs';
import {
  assertNoP2003ServerChildResidual,
  spawnP2003ServerProcess,
} from './helpers/p2-003-sse-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
  throw new Error('P2_003_INTEGRATION_DATABASE_REQUIRED');
}

const TEST_TIMEOUT = 120_000;
const STREAM_NAME = REALTIME_STREAM_NAME ?? 'CONVERSATION_WORKBENCH';

async function applyBaseMigrations(pool) {
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyNotificationOutboxMigration({ pool });
  await applyConversationContractsMigration({ pool });
  await applyTimelineProjectionMigration({ pool });
}

async function createSyntheticConversationSession(pool, label) {
  const identity = buildConversationThreadIdentity({
    provider: 'WECOM_AIBOT',
    botId: `p2-003-bot-${label}`,
    chatType: 'group',
    chatId: `p2-003-chat-${label}`,
    senderUserId: `p2-003-participant-${label}`,
  });
  const thread = await pool.query(
    `INSERT INTO conversation.thread (
       provider, channel_account_id, chat_type, external_thread_key,
       thread_key, last_activity_at
     ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     RETURNING id::text, thread_key`,
    [
      identity.provider,
      identity.channel_account_id,
      identity.chat_type,
      identity.external_thread_key,
      identity.thread_key,
      '2026-08-31T00:00:00.000Z',
    ],
  );
  const creationIdempotencyKey = `P2-003-INTEGRATION:${label}`;
  const scope = buildConversationSessionScope({
    threadKey: thread.rows[0].thread_key,
    participantKey: identity.participant_key,
    serviceIntakeId: null,
    creationIdempotencyKey,
  });
  const session = await pool.query(
    `INSERT INTO conversation.session (
       thread_id, participant_key, service_intake_id, session_scope_key,
       creation_idempotency_key, last_activity_at
     ) VALUES ($1::uuid, $2, NULL, $3, $4, $5::timestamptz)
     RETURNING id::text`,
    [
      thread.rows[0].id,
      scope.participant_key,
      scope.session_scope_key,
      scope.creation_idempotency_key,
      '2026-08-31T00:00:00.000Z',
    ],
  );
  return Object.freeze({
    threadId: thread.rows[0].id,
    sessionId: session.rows[0].id,
  });
}

async function applicationTableNames(pool) {
  const result = await pool.query(
    `SELECT schemaname || '.' || tablename AS relation_name
       FROM pg_tables
      WHERE schemaname <> 'information_schema'
        AND schemaname !~ '^pg_'
      ORDER BY schemaname, tablename`,
  );
  return result.rows.map((row) => row.relation_name);
}

async function relationContractSnapshot(pool, relationNames) {
  const result = await pool.query(
    `WITH requested(relation_name) AS (
       SELECT unnest($1::text[])
     )
     SELECT requested.relation_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'name', attribute.attname,
                       'type', format_type(attribute.atttypid, attribute.atttypmod),
                       'not_null', attribute.attnotnull,
                       'identity', attribute.attidentity,
                       'generated', attribute.attgenerated,
                       'default', pg_get_expr(default_record.adbin, default_record.adrelid)
                     ) ORDER BY attribute.attnum)
                FROM pg_attribute AS attribute
                LEFT JOIN pg_attrdef AS default_record
                  ON default_record.adrelid = attribute.attrelid
                 AND default_record.adnum = attribute.attnum
               WHERE attribute.attrelid = to_regclass(requested.relation_name)
                 AND attribute.attnum > 0
                 AND NOT attribute.attisdropped
            ), '[]'::jsonb) AS columns,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'name', constraint_record.conname,
                       'type', constraint_record.contype,
                       'definition', pg_get_constraintdef(constraint_record.oid, true),
                       'validated', constraint_record.convalidated,
                       'deferrable', constraint_record.condeferrable,
                       'deferred', constraint_record.condeferred
                     ) ORDER BY constraint_record.conname)
                FROM pg_constraint AS constraint_record
               WHERE constraint_record.conrelid = to_regclass(requested.relation_name)
            ), '[]'::jsonb) AS constraints,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'name', index_record.indexrelid::regclass::text,
                       'definition', pg_get_indexdef(index_record.indexrelid),
                       'valid', index_record.indisvalid,
                       'ready', index_record.indisready,
                       'unique', index_record.indisunique,
                       'predicate', pg_get_expr(index_record.indpred, index_record.indrelid)
                     ) ORDER BY index_record.indexrelid::regclass::text)
                FROM pg_index AS index_record
               WHERE index_record.indrelid = to_regclass(requested.relation_name)
            ), '[]'::jsonb) AS indexes
       FROM requested
      ORDER BY requested.relation_name`,
    [relationNames],
  );
  return result.rows;
}

async function nonRelationSnapshot(pool) {
  const routines = await pool.query(
    `SELECT namespace_record.nspname AS schema_name,
            procedure_record.proname AS routine_name,
            pg_get_function_identity_arguments(procedure_record.oid) AS arguments,
            procedure_record.prokind AS kind,
            procedure_record.prosrc AS source
       FROM pg_proc AS procedure_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = procedure_record.pronamespace
      WHERE namespace_record.nspname <> 'information_schema'
        AND namespace_record.nspname !~ '^pg_'
      ORDER BY schema_name, routine_name, arguments`,
  );
  const triggers = await pool.query(
    `SELECT trigger_record.tgrelid::regclass::text AS relation_name,
            trigger_record.tgname AS trigger_name,
            pg_get_triggerdef(trigger_record.oid, true) AS definition
       FROM pg_trigger AS trigger_record
      WHERE NOT trigger_record.tgisinternal
      ORDER BY relation_name, trigger_name`,
  );
  return Object.freeze({ routines: routines.rows, triggers: triggers.rows });
}

async function auxiliaryCatalogSnapshot(pool) {
  const schemas = await pool.query(
    `SELECT schema_name
       FROM information_schema.schemata
      WHERE schema_name <> 'information_schema'
        AND schema_name !~ '^pg_'
      ORDER BY schema_name`,
  );
  const relations = await pool.query(
    `SELECT namespace_record.nspname AS schema_name,
            class_record.relname AS relation_name,
            class_record.relkind AS relation_kind
       FROM pg_class AS class_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = class_record.relnamespace
      WHERE namespace_record.nspname <> 'information_schema'
        AND namespace_record.nspname !~ '^pg_'
        AND class_record.relkind = ANY($1::"char"[])
      ORDER BY schema_name, relation_name`,
    [['S', 'v', 'm', 'f', 'p', 'I', 'c']],
  );
  const types = await pool.query(
    `SELECT namespace_record.nspname AS schema_name,
            type_record.typname AS type_name,
            type_record.typtype AS type_kind
       FROM pg_type AS type_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = type_record.typnamespace
      WHERE namespace_record.nspname <> 'information_schema'
        AND namespace_record.nspname !~ '^pg_'
        AND type_record.typtype = ANY($1::"char"[])
      ORDER BY schema_name, type_name`,
    [['d', 'e', 'r', 'm']],
  );
  const extensions = await pool.query(
    `SELECT extension_record.extname AS extension_name,
            extension_record.extversion AS extension_version,
            namespace_record.nspname AS schema_name
       FROM pg_extension AS extension_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = extension_record.extnamespace
      ORDER BY extension_name`,
  );
  return Object.freeze({
    schemas: schemas.rows,
    relations: relations.rows,
    types: types.rows,
    extensions: extensions.rows,
  });
}

function assertSuccessfulMigrationProcess(execution, mode, databaseName, isolatedDatabaseUrl) {
  assert.deepEqual(execution.exit, { code: 0, signal: null, killed: false });
  assert.equal(execution.stderr, '');
  assert.equal(execution.stdout.includes(databaseName), false);
  assert.equal(execution.stdout.includes(isolatedDatabaseUrl), false);
  assert.deepEqual(execution.result, {
    ok: true,
    task: 'P2-003',
    mode,
    migrations: ['012_p2_003_realtime_event_log'],
    relations: [
      'conversation.realtime_event',
      'conversation.realtime_stream_state',
    ],
    feature_flags_enabled: false,
  });
}

function stableRealtimeError(code) {
  return (error) => error?.code === code || error?.message === code;
}

test('P2-003 migration 012 is exact, reentrant, CLI-scoped, and check-only rolls back', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  let evidence;
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'migration',
    max: 4,
    run: async ({ pool, databaseName, databaseUrl: isolatedDatabaseUrl }) => {
      await applyBaseMigrations(pool);
      const beforeTables = await applicationTableNames(pool);
      const beforeContracts = await relationContractSnapshot(pool, beforeTables);
      const beforeNonRelations = await nonRelationSnapshot(pool);
      const beforeAuxiliaryCatalog = await auxiliaryCatalogSnapshot(pool);

      const precheck = await runP2003MigrationProcess({
        databaseUrl: isolatedDatabaseUrl,
        mode: 'check',
      });
      assertSuccessfulMigrationProcess(precheck, 'check', databaseName, isolatedDatabaseUrl);
      assert.deepEqual(await applicationTableNames(pool), beforeTables);
      assert.deepEqual(await relationContractSnapshot(pool, beforeTables), beforeContracts);
      assert.deepEqual(await nonRelationSnapshot(pool), beforeNonRelations);
      assert.deepEqual(await auxiliaryCatalogSnapshot(pool), beforeAuxiliaryCatalog);

      const first = await runP2003MigrationProcess({
        databaseUrl: isolatedDatabaseUrl,
        mode: 'migrate',
      });
      assertSuccessfulMigrationProcess(first, 'migrate', databaseName, isolatedDatabaseUrl);
      const afterFirstTables = await applicationTableNames(pool);
      assert.deepEqual(afterFirstTables.filter((name) => !beforeTables.includes(name)), [
        'conversation.realtime_event',
        'conversation.realtime_stream_state',
      ]);
      assert.deepEqual(await relationContractSnapshot(pool, beforeTables), beforeContracts);
      assert.deepEqual(await nonRelationSnapshot(pool), beforeNonRelations);
      const afterAuxiliaryCatalog = await auxiliaryCatalogSnapshot(pool);
      assert.deepEqual(afterAuxiliaryCatalog.schemas, beforeAuxiliaryCatalog.schemas);
      assert.deepEqual(afterAuxiliaryCatalog.types, beforeAuxiliaryCatalog.types);
      assert.deepEqual(afterAuxiliaryCatalog.extensions, beforeAuxiliaryCatalog.extensions);
      assert.deepEqual(
        afterAuxiliaryCatalog.relations.filter((relation) => (
          relation.schema_name !== 'conversation'
          || relation.relation_name !== 'realtime_event_event_id_seq'
        )),
        beforeAuxiliaryCatalog.relations,
      );
      assert.deepEqual(
        afterAuxiliaryCatalog.relations.filter((relation) => (
          relation.schema_name === 'conversation'
          && relation.relation_name === 'realtime_event_event_id_seq'
        )),
        [{
          schema_name: 'conversation',
          relation_name: 'realtime_event_event_id_seq',
          relation_kind: 'S',
        }],
      );
      const realtimeContracts = await relationContractSnapshot(pool, [
        'conversation.realtime_event',
        'conversation.realtime_stream_state',
      ]);

      const repeat = await runP2003MigrationProcess({
        databaseUrl: isolatedDatabaseUrl,
        mode: 'migrate',
      });
      assertSuccessfulMigrationProcess(repeat, 'migrate', databaseName, isolatedDatabaseUrl);
      assert.deepEqual(await applicationTableNames(pool), afterFirstTables);
      assert.deepEqual(await relationContractSnapshot(pool, [
        'conversation.realtime_event',
        'conversation.realtime_stream_state',
      ]), realtimeContracts);
      assert.deepEqual(await auxiliaryCatalogSnapshot(pool), afterAuxiliaryCatalog);

      const postcheck = await runP2003MigrationProcess({
        databaseUrl: isolatedDatabaseUrl,
        mode: 'check',
      });
      assertSuccessfulMigrationProcess(postcheck, 'check', databaseName, isolatedDatabaseUrl);
      assert.deepEqual(await relationContractSnapshot(pool, beforeTables), beforeContracts);
      assert.deepEqual(await relationContractSnapshot(pool, [
        'conversation.realtime_event',
        'conversation.realtime_stream_state',
      ]), realtimeContracts);
      assert.deepEqual(await nonRelationSnapshot(pool), beforeNonRelations);
      assert.deepEqual(await auxiliaryCatalogSnapshot(pool), afterAuxiliaryCatalog);
      evidence = {
        migration_process_runs: 4,
        migration_files_executed: 1,
        relations_added: 2,
        prior_catalog_unchanged: true,
        precheck_rolled_back: true,
        postcheck_rolled_back: true,
      };
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

test('P2-003 migration fails closed for missing column, weak check, wrong unique and index drift', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  const scenarios = [
    {
      purpose: 'missingcol',
      sql: 'ALTER TABLE conversation.realtime_event DROP COLUMN publisher_version CASCADE',
    },
    {
      purpose: 'weakcheck',
      sql: `ALTER TABLE conversation.realtime_event
              DROP CONSTRAINT conversation_realtime_event_payload_object_check;
            ALTER TABLE conversation.realtime_event
              ADD CONSTRAINT conversation_realtime_event_payload_object_check CHECK (true)`,
    },
    {
      purpose: 'wrongunique',
      sql: `ALTER TABLE conversation.realtime_event
              DROP CONSTRAINT conversation_realtime_event_event_key_unique;
            CREATE INDEX conversation_realtime_event_event_key_unique
              ON conversation.realtime_event (event_key)`,
    },
    {
      purpose: 'wrongmethod',
      sql: `DROP INDEX conversation.conversation_realtime_event_visibility_event_idx;
            CREATE INDEX conversation_realtime_event_visibility_event_idx
              ON conversation.realtime_event USING hash (visibility_scope)`,
    },
    {
      purpose: 'predicate',
      sql: `DROP INDEX conversation.conversation_realtime_event_expiry_event_idx;
            CREATE INDEX conversation_realtime_event_expiry_event_idx
              ON conversation.realtime_event (expires_at, event_id)
              WHERE event_id > 0`,
    },
  ];
  for (const scenario of scenarios) {
    await withP2003IsolatedDatabase({
      databaseUrl,
      purpose: scenario.purpose,
      max: 4,
      run: async ({ pool, databaseName, databaseUrl: isolatedDatabaseUrl }) => {
        await applyBaseMigrations(pool);
        await applyRealtimeEventLogMigration({ pool });
        await pool.query(scenario.sql);
        const before = await relationContractSnapshot(pool, [
          'conversation.realtime_event',
          'conversation.realtime_stream_state',
        ]);
        const execution = await runP2003MigrationProcess({
          databaseUrl: isolatedDatabaseUrl,
          mode: 'migrate',
        });
        assert.deepEqual(execution.exit, { code: 1, signal: null, killed: false });
        assert.equal(execution.stderr, '');
        assert.equal(execution.stdout.includes(databaseName), false);
        assert.equal(execution.stdout.includes(isolatedDatabaseUrl), false);
        assert.deepEqual(execution.result, {
          ok: false,
          error: {
            code: 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
            retryable: false,
          },
        });
        assert.deepEqual(await relationContractSnapshot(pool, [
          'conversation.realtime_event',
          'conversation.realtime_stream_state',
        ]), before);
      },
    });
  }
  t.diagnostic(JSON.stringify({ drift_scenarios: scenarios.length, temp_database_cleanup: true }));
});

test('P2-003 append, concurrency, caller transaction, durable replay and authorization are exact', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  let evidence;
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'eventcore',
    max: 4,
    run: async ({ pool }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      const sessionId = randomUUID();
      const otherSessionId = randomUUID();
      const threadId = randomUUID();
      const store = createRealtimeEventStore({
        pool,
        enabled: true,
        defaultRetentionMs: 7 * 24 * 60 * 60 * 1_000,
      });

      const firstCommand = p2003EventCommand({ ordinal: 1, sessionId, threadId });
      const first = await store.append({ command: firstCommand });
      assert.equal(first.status, 'INSERTED');
      assert.equal(first.inserted_count, 1);
      const replay = await store.append({ command: firstCommand });
      assert.equal(replay.status, 'REPLAYED');
      assert.equal(replay.event_id, first.event_id);
      await assert.rejects(
        store.append({
          command: p2003EventCommand({
            ordinal: 1,
            sessionId,
            threadId,
            payload: { state: 'CONFLICTING' },
          }),
        }),
        stableRealtimeError('CONVERSATION_REALTIME_EVENT_CONFLICT'),
      );

      const sameCommand = p2003EventCommand({
        ordinal: 2,
        sessionId,
        threadId,
        sourceId: 'fixture.concurrent.same',
      });
      const sameResults = await Promise.all(
        Array.from({ length: 12 }, () => store.append({ command: sameCommand })),
      );
      assert.equal(sameResults.filter((value) => value.status === 'INSERTED').length, 1);
      assert.equal(sameResults.filter((value) => value.status === 'REPLAYED').length, 11);
      assert.equal(new Set(sameResults.map((value) => value.event_id)).size, 1);
      const samePersistentCount = await pool.query(
        `SELECT count(*)::integer AS count
           FROM conversation.realtime_event
          WHERE source_id = 'fixture.concurrent.same'`,
      );
      assert.equal(samePersistentCount.rows[0].count, 1);

      const differentResults = await Promise.all(
        Array.from({ length: 12 }, (_, index) => store.append({
          command: p2003EventCommand({
            ordinal: index + 10,
            sessionId,
            threadId,
            sourceId: `fixture.concurrent.different.${index + 1}`,
          }),
        })),
      );
      assert.equal(differentResults.every((value) => value.status === 'INSERTED'), true);
      assert.equal(new Set(differentResults.map((value) => value.event_id)).size, 12);
      const sortedDifferentIds = differentResults
        .map((value) => BigInt(value.event_id))
        .toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0);
      assert.equal(sortedDifferentIds.every((value, index) => (
        index === 0 || value > sortedDifferentIds[index - 1]
      )), true);
      assert.ok(pool.totalCount <= 4);

      const rollbackCommand = p2003EventCommand({
        ordinal: 100,
        sessionId,
        threadId,
        sourceId: 'fixture.transaction.rollback',
      });
      const rollbackClient = await pool.connect();
      let rolledBackEventId;
      try {
        await rollbackClient.query('BEGIN');
        const pending = await appendRealtimeEvent({
          transaction: rollbackClient,
          command: rollbackCommand,
        });
        rolledBackEventId = pending.event_id;
        await rollbackClient.query('ROLLBACK');
      } finally {
        rollbackClient.release();
      }
      const rollbackCount = await pool.query(
        'SELECT count(*)::integer AS count FROM conversation.realtime_event WHERE source_id = $1',
        ['fixture.transaction.rollback'],
      );
      assert.equal(rollbackCount.rows[0].count, 0);

      const afterHole = await store.append({
        command: p2003EventCommand({
          ordinal: 101,
          sessionId,
          threadId,
          sourceId: 'fixture.transaction.after-hole',
        }),
      });
      assert.ok(BigInt(afterHole.event_id) > BigInt(rolledBackEventId));
      const acrossNaturalHole = await listAuthorizedRealtimeEvents({
        pool,
        streamName: STREAM_NAME,
        afterEventId: String(BigInt(rolledBackEventId) - 1n),
        limit: 50,
        authorization: p2003Authorization({ sessionIds: [sessionId] }),
      });
      assert.equal(acrossNaturalHole.events[0]?.event_id, afterHole.event_id);
      assert.ok(BigInt(acrossNaturalHole.next_after_event_id) >= BigInt(afterHole.event_id));

      const ackCommand = p2003EventCommand({
        ordinal: 102,
        sessionId,
        threadId,
        sourceId: 'fixture.transaction.ack-loss',
      });
      const ackClient = await pool.connect();
      let committedWithoutAck;
      try {
        await ackClient.query('BEGIN');
        committedWithoutAck = await appendRealtimeEvent({
          transaction: ackClient,
          command: ackCommand,
        });
        await ackClient.query('COMMIT');
      } finally {
        ackClient.release();
      }
      const afterAckLoss = await store.append({ command: ackCommand });
      assert.equal(afterAckLoss.status, 'REPLAYED');
      assert.equal(afterAckLoss.event_id, committedWithoutAck.event_id);
      const ackPersistentCount = await pool.query(
        `SELECT count(*)::integer AS count
           FROM conversation.realtime_event
          WHERE source_id = 'fixture.transaction.ack-loss'`,
      );
      assert.equal(ackPersistentCount.rows[0].count, 1);

      const sessionScoped = await store.append({
        command: p2003EventCommand({
          ordinal: 200,
          sessionId,
          threadId,
          sourceId: 'fixture.auth.session',
        }),
      });
      const threadScoped = await store.append({
        command: p2003EventCommand({
          ordinal: 201,
          sessionId,
          threadId,
          sourceId: 'fixture.auth.thread',
          scopeType: 'THREAD',
        }),
      });
      const systemScoped = await store.append({
        command: p2003EventCommand({
          ordinal: 202,
          sessionId,
          threadId,
          sourceId: 'fixture.auth.system',
          scopeType: 'SYSTEM',
          eventType: 'conversation.timeline.rebuilt',
          sourceType: 'TIMELINE_REBUILD',
          aggregateType: 'CONVERSATION_TIMELINE',
        }),
      });
      const restricted = await store.append({
        command: p2003EventCommand({
          ordinal: 203,
          sessionId,
          threadId,
          sourceId: 'fixture.auth.restricted',
          visibilityScope: 'RESTRICTED_ADMIN',
        }),
      });
      const unauthorized = await store.append({
        command: p2003EventCommand({
          ordinal: 204,
          sessionId: otherSessionId,
          threadId,
          sourceId: 'fixture.auth.unauthorized',
        }),
      });

      const fullAuthorization = p2003Authorization({
        sessionIds: [sessionId],
        threadIds: [threadId],
        allowSystemEvents: true,
        allowRestrictedAdmin: true,
      });
      const allAuthorized = await listAuthorizedRealtimeEvents({
        pool,
        streamName: STREAM_NAME,
        afterEventId: '0',
        limit: 200,
        authorization: fullAuthorization,
      });
      const visibleIds = new Set(allAuthorized.events.map((event) => event.event_id));
      for (const expected of [sessionScoped, threadScoped, systemScoped, restricted]) {
        assert.equal(visibleIds.has(expected.event_id), true);
      }
      assert.equal(visibleIds.has(unauthorized.event_id), false);
      for (const event of allAuthorized.events) {
        assert.deepEqual(Object.keys(event).toSorted(), [
          'aggregate_id',
          'aggregate_type',
          'aggregate_version',
          'created_at',
          'event_id',
          'event_type',
          'occurred_at',
          'payload',
          'visibility_scope',
        ]);
      }

      const ordinaryAuthorization = p2003Authorization({
        sessionIds: [sessionId],
        threadIds: [threadId],
        allowSystemEvents: true,
      });
      const ordinary = await listAuthorizedRealtimeEvents({
        pool,
        streamName: STREAM_NAME,
        afterEventId: '0',
        limit: 200,
        authorization: ordinaryAuthorization,
      });
      assert.equal(ordinary.events.some((event) => event.event_id === restricted.event_id), false);

      const beforeClipping = await getRealtimeReplayWindow({ pool, streamName: STREAM_NAME });
      await insertP2003MinimalEvents({
        pool,
        count: 51,
        sessionId: otherSessionId,
        sourceOffset: 800,
      });
      const authorizedBeyondUnscopedRows = await store.append({
        command: p2003EventCommand({
          ordinal: 205,
          sessionId,
          threadId,
          sourceId: 'fixture.auth.after-unscoped-window',
        }),
      });
      const scopeClippedBeforeLimit = await listAuthorizedRealtimeEvents({
        pool,
        streamName: STREAM_NAME,
        afterEventId: beforeClipping.high_watermark_event_id,
        limit: 1,
        authorization: p2003Authorization({ sessionIds: [sessionId] }),
      });
      assert.deepEqual(
        scopeClippedBeforeLimit.events.map((event) => event.event_id),
        [authorizedBeyondUnscopedRows.event_id],
      );
      assert.ok(
        BigInt(scopeClippedBeforeLimit.next_after_event_id)
          >= BigInt(authorizedBeyondUnscopedRows.event_id),
      );

      const beforeBulk = await getRealtimeReplayWindow({ pool, streamName: STREAM_NAME });
      const bulk = await insertP2003MinimalEvents({
        pool,
        count: 125,
        sessionId,
        sourceOffset: 1_000,
      });
      let cursor = beforeBulk.high_watermark_event_id;
      const bulkIds = [];
      let replayBatches = 0;
      while (bulkIds.length < 125) {
        const page = await listAuthorizedRealtimeEvents({
          pool,
          streamName: STREAM_NAME,
          afterEventId: cursor,
          limit: 50,
          authorization: fullAuthorization,
        });
        replayBatches += 1;
        bulkIds.push(...page.events.map((event) => event.event_id));
        assert.ok(page.events.length <= 50);
        assert.ok(BigInt(page.next_after_event_id) >= BigInt(cursor));
        cursor = page.next_after_event_id;
      }
      assert.equal(replayBatches, 3);
      assert.equal(bulkIds.length, 125);
      assert.equal(bulkIds[0], bulk.first_event_id);
      assert.equal(bulkIds.at(-1), bulk.last_event_id);

      const afterBulkWindow = await getRealtimeReplayWindow({
        pool,
        streamName: STREAM_NAME,
      });
      await assert.rejects(
        listAuthorizedRealtimeEvents({
          pool,
          streamName: STREAM_NAME,
          afterEventId: String(BigInt(afterBulkWindow.high_watermark_event_id) + 1n),
          limit: 50,
          authorization: fullAuthorization,
        }),
        stableRealtimeError('CONVERSATION_REALTIME_CURSOR_AHEAD'),
      );

      const floor = bulk.first_event_id;
      const floorClient = await pool.connect();
      try {
        await floorClient.query('BEGIN');
        await floorClient.query(
          `DELETE FROM conversation.realtime_event
            WHERE stream_name = $1
              AND event_id <= $2::bigint`,
          [STREAM_NAME, floor],
        );
        await floorClient.query(
          `UPDATE conversation.realtime_stream_state
              SET retention_floor_event_id = $2::bigint,
                  row_version = row_version + 1,
                  updated_at = CURRENT_TIMESTAMP
            WHERE stream_name = $1`,
          [STREAM_NAME, floor],
        );
        await floorClient.query('COMMIT');
      } finally {
        floorClient.release();
      }
      await assert.rejects(
        listAuthorizedRealtimeEvents({
          pool,
          streamName: STREAM_NAME,
          afterEventId: '0',
          limit: 50,
          authorization: fullAuthorization,
        }),
        stableRealtimeError('CONVERSATION_REALTIME_REPLAY_GAP'),
      );

      const finalCount = await pool.query(
        'SELECT count(*)::integer AS count FROM conversation.realtime_event',
      );
      evidence = {
        same_event_concurrency: 12,
        different_event_concurrency: 12,
        pool_maximum: 4,
        natural_identity_hole: true,
        ack_loss_replayed: true,
        replay_batch_count: replayBatches,
        replay_batch_maximum: 50,
        authorization_variants: 4,
        retained_event_count: finalCount.rows[0].count,
      };
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

async function retentionState(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::integer
          FROM conversation.realtime_event
         WHERE stream_name = $1) AS event_count,
       (SELECT COALESCE(jsonb_agg(event_id::text ORDER BY event_id), '[]'::jsonb)
          FROM conversation.realtime_event
         WHERE stream_name = $1) AS event_ids,
       (SELECT retention_floor_event_id::text
          FROM conversation.realtime_stream_state
         WHERE stream_name = $1) AS retention_floor_event_id,
       (SELECT row_version::text
          FROM conversation.realtime_stream_state
         WHERE stream_name = $1) AS row_version`,
    [STREAM_NAME],
  );
  return result.rows[0];
}

async function makeEventsDefinitelyExpired(pool) {
  await pool.query(
    `UPDATE conversation.realtime_event
        SET occurred_at = TIMESTAMPTZ '2020-01-01 00:00:00+00',
            expires_at = TIMESTAMPTZ '2021-01-01 00:00:00+00'
      WHERE stream_name = $1`,
    [STREAM_NAME],
  );
}

test('P2-003 retention check/apply preserves prefix and floor semantics with CLI authorization', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  let evidence;
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'retention',
    max: 4,
    run: async ({ pool, databaseName, databaseUrl: isolatedDatabaseUrl }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      await ensureP2003StreamState(pool);
      const sessionId = randomUUID();
      const expiredPrefix = await insertP2003MinimalEvents({
        pool,
        count: 2,
        sessionId,
        expired: true,
        sourceOffset: 10_000,
      });
      await makeEventsDefinitelyExpired(pool);
      const live = await insertP2003MinimalEvents({
        pool,
        count: 1,
        sessionId,
        sourceOffset: 11_000,
      });
      await pool.query(
        `UPDATE conversation.realtime_event
            SET occurred_at = TIMESTAMPTZ '2029-01-01 00:00:00+00',
                expires_at = TIMESTAMPTZ '2031-01-01 00:00:00+00'
          WHERE event_id = $1::bigint`,
        [live.first_event_id],
      );
      const expiredAfterLive = await insertP2003MinimalEvents({
        pool,
        count: 1,
        sessionId,
        expired: true,
        sourceOffset: 12_000,
      });
      await pool.query(
        `UPDATE conversation.realtime_event
            SET occurred_at = TIMESTAMPTZ '2020-01-01 00:00:00+00',
                expires_at = TIMESTAMPTZ '2021-01-01 00:00:00+00'
          WHERE event_id = $1::bigint`,
        [expiredAfterLive.first_event_id],
      );

      const beforeCheck = await retentionState(pool);
      const check = await checkRealtimeRetention({
        pool,
        streamName: STREAM_NAME,
        limit: 200,
        now: '2030-01-01T00:00:00.000Z',
      });
      assert.equal(check.mode, 'CHECK');
      assert.equal(check.checked_count, 4);
      assert.equal(check.expired_prefix_count, 2);
      assert.equal(check.deleted_count, 0);
      assert.equal(check.write_performed, false);
      assert.deepEqual(await retentionState(pool), beforeCheck);

      const cliCheck = await runP2003RetentionProcess({
        databaseUrl: isolatedDatabaseUrl,
        mode: 'check',
      });
      assert.deepEqual(cliCheck.exit, { code: 0, signal: null, killed: false });
      assert.equal(cliCheck.stderr, '');
      assert.equal(cliCheck.stdout.includes(databaseName), false);
      assert.equal(cliCheck.stdout.includes(isolatedDatabaseUrl), false);
      assert.equal(cliCheck.result?.ok, true);
      assert.equal(cliCheck.result?.operation, 'retention_cleanup');
      assert.equal(cliCheck.result?.mode, 'check');
      assert.equal(cliCheck.result?.checked_count, 4);
      assert.equal(cliCheck.result?.expired_prefix_count, 2);
      assert.equal(cliCheck.result?.deleted_count, 0);
      assert.equal(cliCheck.result?.write_performed, false);
      assert.equal(cliCheck.result?.apply_requires_explicit_approval, true);
      assert.equal(cliCheck.result?.feature_flags_enabled, false);
      assert.deepEqual(await retentionState(pool), beforeCheck);

      const unauthorized = await runP2003RetentionProcess({
        databaseUrl: isolatedDatabaseUrl,
        mode: 'apply',
        approved: false,
      });
      assert.deepEqual(unauthorized.exit, { code: 1, signal: null, killed: false });
      assert.equal(
        unauthorized.result?.error?.code,
        'CONVERSATION_REALTIME_RETENTION_NOT_AUTHORIZED',
      );
      assert.deepEqual(await retentionState(pool), beforeCheck);

      const cleanup = await cleanupRealtimeRetention({
        pool,
        streamName: STREAM_NAME,
        limit: 200,
        authorized: true,
        now: '2030-01-01T00:00:00.000Z',
      });
      assert.equal(cleanup.mode, 'APPLY');
      assert.equal(cleanup.checked_count, 4);
      assert.equal(cleanup.expired_prefix_count, 2);
      assert.equal(cleanup.deleted_count, 2);
      assert.equal(cleanup.write_performed, true);
      assert.ok(cleanup.deleted_count <= 200);
      const afterCleanup = await retentionState(pool);
      assert.deepEqual(afterCleanup.event_ids, [live.first_event_id, expiredAfterLive.first_event_id]);
      assert.equal(afterCleanup.retention_floor_event_id, expiredPrefix.last_event_id);
      assert.ok(BigInt(afterCleanup.row_version) > BigInt(beforeCheck.row_version));
      const retry = await cleanupRealtimeRetention({
        pool,
        streamName: STREAM_NAME,
        limit: 200,
        authorized: true,
        now: '2030-01-01T00:00:00.000Z',
      });
      assert.equal(retry.mode, 'APPLY');
      assert.equal(retry.deleted_count, 0);
      assert.equal(retry.write_performed, false);
      assert.deepEqual(await retentionState(pool), afterCleanup);

      await assert.rejects(
        listAuthorizedRealtimeEvents({
          pool,
          streamName: STREAM_NAME,
          afterEventId: '0',
          limit: 50,
          authorization: p2003Authorization({ sessionIds: [sessionId] }),
        }),
        stableRealtimeError('CONVERSATION_REALTIME_REPLAY_GAP'),
      );
      const gapServer = spawnP2003ServerProcess({
        databaseUrl: isolatedDatabaseUrl,
        sessionId,
        threadId: randomUUID(),
        heartbeatMs: 1_000,
        recoveryPollMs: 100,
        poolMax: 4,
      });
      try {
        const gapAddress = await gapServer.waitUntilReady();
        const cursorAhead = await requestP2003Fallback({
          port: gapAddress.port,
          lastEventId: String(BigInt(expiredAfterLive.first_event_id) + 1n),
        });
        assert.equal(cursorAhead.status_code, 409);
        assert.deepEqual(cursorAhead.body, {
          ok: false,
          error: {
            code: 'CONVERSATION_REALTIME_CURSOR_AHEAD',
            retryable: false,
          },
        });
        const cursorAheadMetrics = await gapServer.snapshot();
        assert.equal(cursorAheadMetrics.active_clients, 0);
        assert.equal(cursorAheadMetrics.open_streams, 0);
        assert.equal(cursorAheadMetrics.active_heartbeat_timers, 0);
        assert.equal(cursorAheadMetrics.active_recovery_timers, 0);
        const gapFallback = await requestP2003Fallback({
          port: gapAddress.port,
          lastEventId: '0',
        });
        assert.equal(gapFallback.status_code, 410);
        assert.deepEqual(gapFallback.body, {
          ok: false,
          error: {
            code: 'CONVERSATION_REALTIME_REPLAY_GAP',
            retryable: false,
          },
          fallback: {
            fallback_required: true,
            reason: 'REPLAY_GAP',
            poll_after_ms: 1_000,
            strategy: 'REFETCH_CONVERSATION_LIST_AND_TIMELINE',
            latest_event_id: expiredAfterLive.first_event_id,
            retention_floor_event_id: expiredPrefix.last_event_id,
          },
        });
        const gapMetrics = await gapServer.snapshot();
        assert.equal(gapMetrics.active_clients, 0);
        assert.equal(gapMetrics.open_streams, 0);
        assert.equal(gapMetrics.active_heartbeat_timers, 0);
        assert.equal(gapMetrics.active_recovery_timers, 0);
        assert.deepEqual(await gapServer.shutdown(), {
          code: 0,
          signal: null,
          killed: false,
        });
        assert.deepEqual(gapServer.output(), { stdout: '', stderr: '' });
      } finally {
        await gapServer.ensureTerminated().catch(() => {});
      }
      await waitForP2003BackendClosed({
        pool,
        applicationName: gapServer.applicationName,
      });
      const fromFloor = await listAuthorizedRealtimeEvents({
        pool,
        streamName: STREAM_NAME,
        afterEventId: expiredPrefix.last_event_id,
        limit: 50,
        authorization: p2003Authorization({ sessionIds: [sessionId] }),
      });
      assert.deepEqual(
        fromFloor.events.map((event) => event.event_id),
        [live.first_event_id, expiredAfterLive.first_event_id],
      );
      evidence = {
        check_zero_write: true,
        unauthorized_apply_zero_write: true,
        deleted_prefix_count: 2,
        floor_event_id: afterCleanup.retention_floor_event_id,
        expired_after_live_retained: true,
        retry_idempotent: true,
        replay_gap_http_fallback: true,
        cursor_ahead_http_409: true,
      };
    },
  });

  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'retcli',
    max: 4,
    run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      await ensureP2003StreamState(pool);
      await insertP2003MinimalEvents({
        pool,
        count: 1,
        sessionId: randomUUID(),
        expired: true,
        sourceOffset: 20_000,
      });
      await makeEventsDefinitelyExpired(pool);
      const execution = await runP2003RetentionProcess({
        databaseUrl: isolatedDatabaseUrl,
        mode: 'apply',
        approved: true,
      });
      assert.deepEqual(execution.exit, { code: 0, signal: null, killed: false });
      assert.equal(execution.result?.ok, true);
      assert.equal(execution.result?.operation, 'retention_cleanup');
      assert.equal(execution.result?.mode, 'apply');
      assert.equal(execution.result?.deleted_count, 1);
      assert.equal(execution.result?.write_performed, true);
      assert.equal(execution.result?.apply_requires_explicit_approval, true);
      assert.equal(execution.result?.feature_flags_enabled, false);
      assert.equal((await retentionState(pool)).event_count, 0);
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, authorized_cli_apply: true }));
});

test('P2-003 retention delete/floor is atomic and every cleanup batch is at most 200', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'retatomic',
    max: 4,
    run: async ({ pool }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      await ensureP2003StreamState(pool);
      await insertP2003MinimalEvents({
        pool,
        count: 10,
        sessionId: randomUUID(),
        expired: true,
        sourceOffset: 30_000,
      });
      await makeEventsDefinitelyExpired(pool);
      const before = await retentionState(pool);
      await assert.rejects(
        cleanupRealtimeRetention({
          pool,
          streamName: STREAM_NAME,
          limit: 200,
          authorized: true,
          now: '2030-01-01T00:00:00.000Z',
          faultInjection: {
            afterDeleteBeforeFloor: async () => {
              throw new Error('P2_003_SYNTHETIC_RETENTION_CRASH');
            },
          },
        }),
      );
      assert.deepEqual(await retentionState(pool), before);
    },
  });

  let batchEvidence;
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'retbatch',
    max: 4,
    run: async ({ pool }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      await ensureP2003StreamState(pool);
      const inserted = await insertP2003MinimalEvents({
        pool,
        count: 201,
        sessionId: randomUUID(),
        expired: true,
        sourceOffset: 40_000,
      });
      await makeEventsDefinitelyExpired(pool);
      const first = await cleanupRealtimeRetention({
        pool,
        streamName: STREAM_NAME,
        limit: 200,
        authorized: true,
        now: '2030-01-01T00:00:00.000Z',
      });
      assert.equal(first.mode, 'APPLY');
      assert.equal(first.deleted_count, 200);
      assert.equal(first.write_performed, true);
      const afterFirst = await retentionState(pool);
      assert.equal(afterFirst.event_count, 1);
      assert.equal(afterFirst.event_ids[0], inserted.last_event_id);
      const second = await cleanupRealtimeRetention({
        pool,
        streamName: STREAM_NAME,
        limit: 200,
        authorized: true,
        now: '2030-01-01T00:00:00.000Z',
      });
      assert.equal(second.mode, 'APPLY');
      assert.equal(second.deleted_count, 1);
      assert.equal(second.write_performed, true);
      const afterSecond = await retentionState(pool);
      assert.equal(afterSecond.event_count, 0);
      assert.equal(afterSecond.retention_floor_event_id, inserted.last_event_id);
      batchEvidence = {
        first_batch_deleted: 200,
        second_batch_deleted: 1,
        floor_delete_atomic_rollback: true,
      };
    },
  });
  t.diagnostic(JSON.stringify(batchEvidence));
});

async function waitForServerMetrics(serverProcess, predicate, {
  timeoutMs = 15_000,
  intervalMs = 25,
} = {}) {
  const startedAt = Date.now();
  let polls = 0;
  let metrics;
  while (Date.now() - startedAt <= timeoutMs) {
    polls += 1;
    metrics = await serverProcess.snapshot();
    if (predicate(metrics)) {
      return Object.freeze({ metrics, polls });
    }
    await delay(intervalMs);
  }
  assert.fail(`P2_003_SERVER_METRIC_TIMEOUT:${JSON.stringify(metrics)}`);
}

function mean(values) {
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

test('P2-003 localhost SSE admits 32 clients, rejects 33, heartbeats, delivers and releases resources', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  let evidence;
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'capacity',
    max: 4,
    run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      await ensureP2003StreamState(pool);
      const sessionId = randomUUID();
      const threadId = randomUUID();
      const serverProcess = spawnP2003ServerProcess({
        databaseUrl: isolatedDatabaseUrl,
        sessionId,
        threadId,
        maxClients: 32,
        heartbeatMs: 100,
        recoveryPollMs: 100,
        replayBatchSize: 50,
        maxWritableBufferBytes: 65_536,
        drainTimeoutMs: 1_000,
        poolMax: 4,
      });
      const clients = [];
      const heapSamples = [];
      try {
        const address = await serverProcess.waitUntilReady();
        heapSamples.push((await serverProcess.snapshot()).heap_used_bytes);
        for (let group = 0; group < 4; group += 1) {
          const groupClients = Array.from({ length: 8 }, () => openP2003SseClient({
            port: address.port,
            lastEventId: '0',
          }));
          clients.push(...groupClients);
          await Promise.all(groupClients.map((client) => client.connected()));
          const snapshot = await waitForServerMetrics(
            serverProcess,
            (metrics) => metrics.active_clients === clients.length,
          );
          heapSamples.push(snapshot.metrics.heap_used_bytes);
        }
        const atCapacity = await serverProcess.snapshot();
        assert.equal(atCapacity.active_clients, 32);
        assert.equal(atCapacity.peak_clients, 32);
        assert.equal(atCapacity.active_heartbeat_timers, 32);
        assert.equal(atCapacity.active_recovery_timers, 32);
        assert.equal(atCapacity.open_streams, 32);
        assert.ok(atCapacity.pool_total_count <= 4);

        const fallback = await requestP2003Fallback({ port: address.port });
        assert.equal(fallback.status_code, 503);
        assert.equal(fallback.body.error.code, 'CONVERSATION_REALTIME_CAPACITY_REACHED');
        assert.deepEqual(fallback.body.fallback, {
          fallback_required: true,
          reason: 'CAPACITY_REACHED',
          poll_after_ms: 1000,
          strategy: 'POLL_UNTIL_SSE_AVAILABLE',
          latest_event_id: null,
          retention_floor_event_id: null,
        });
        assert.equal((await serverProcess.snapshot()).active_clients, 32);
        await clients[0].waitForHeartbeatCount(1);

        const inserted = await insertP2003MinimalEvents({
          pool,
          count: 100,
          sessionId,
          sourceOffset: 50_000,
        });
        await serverProcess.wakeup();
        await Promise.all(clients.map((client) => client.waitForEventCount(100, 30_000)));
        for (const client of clients) {
          const snapshot = client.snapshot();
          assert.equal(snapshot.event_count, 100);
          assert.equal(snapshot.first_event_id, inserted.first_event_id);
          assert.equal(snapshot.last_event_id, inserted.last_event_id);
          assert.equal(snapshot.captured_events.length, 0);
        }
        const afterDelivery = await serverProcess.snapshot();
        heapSamples.push(afterDelivery.heap_used_bytes);
        assert.equal(afterDelivery.capacity_rejection_count, 1);
        assert.equal(afterDelivery.delivered_event_count, 3_200);
        assert.ok(afterDelivery.max_writable_length <= 65_536);
        assert.ok(afterDelivery.pool_total_count <= 4);

        await Promise.all(clients.map((client) => client.destroy()));
        const released = await waitForServerMetrics(serverProcess, (metrics) => (
          metrics.active_clients === 0
          && metrics.open_streams === 0
          && metrics.active_heartbeat_timers === 0
          && metrics.active_recovery_timers === 0
          && metrics.active_drain_waiters === 0
          && metrics.hub_active_clients === 0
          && metrics.socket_count === 0
        ));
        heapSamples.push(released.metrics.heap_used_bytes);
        const firstToLastHeapTrend = Math.max(0, heapSamples.at(-1) - heapSamples[0]);
        const peakHeapDelta = Math.max(...heapSamples) - heapSamples[0];
        assert.ok(firstToLastHeapTrend < 128 * 1024 * 1024);
        assert.ok(peakHeapDelta < 256 * 1024 * 1024);
        evidence = {
          peak_client_count: atCapacity.peak_clients,
          event_count: 100,
          each_client_received: 100,
          capacity_rejections: afterDelivery.capacity_rejection_count,
          maximum_writable_length: afterDelivery.max_writable_length,
          slow_client_disconnects: afterDelivery.slow_client_disconnect_count,
          heap_samples_bytes: heapSamples,
          first_heap_bytes: heapSamples[0],
          last_heap_bytes: heapSamples.at(-1),
          heap_sample_mean_bytes: mean(heapSamples),
          first_to_last_heap_trend_bytes: firstToLastHeapTrend,
          peak_heap_delta_bytes: peakHeapDelta,
          database_query_batches: afterDelivery.replay_query_batch_count,
          resource_release_polls: released.polls,
        };
        const exit = await serverProcess.shutdown();
        assert.deepEqual(exit, { code: 0, signal: null, killed: false });
        assert.deepEqual(serverProcess.output(), { stdout: '', stderr: '' });
      } finally {
        await Promise.all(clients.map((client) => client.destroy().catch(() => {})));
        await serverProcess.ensureTerminated().catch(() => {});
      }
      await waitForP2003BackendClosed({
        pool,
        applicationName: serverProcess.applicationName,
      });
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

test('P2-003 child kill/restart replays Last-Event-ID and missed wakeup recovers from PostgreSQL', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  let evidence;
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'restart',
    max: 4,
    run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      const sessionId = randomUUID();
      const threadId = randomUUID();
      const store = createRealtimeEventStore({ pool, enabled: true });
      const first = await store.append({
        command: p2003EventCommand({
          ordinal: 1,
          sessionId,
          threadId,
          sourceId: 'fixture.restart.first',
        }),
      });
      const serverA = spawnP2003ServerProcess({
        databaseUrl: isolatedDatabaseUrl,
        sessionId,
        threadId,
        heartbeatMs: 200,
        recoveryPollMs: 100,
        drainTimeoutMs: 1_000,
      });
      let clientA;
      let serverB;
      let clientB;
      try {
        const addressA = await serverA.waitUntilReady();
        clientA = openP2003SseClient({
          port: addressA.port,
          lastEventId: '0',
          captureLimit: 1,
        });
        await clientA.connected();
        await clientA.waitForEventCount(1);
        assert.equal(clientA.snapshot().last_event_id, first.event_id);
        const killed = await serverA.terminate('SIGKILL');
        assert.equal(killed.killed, true);
        assert.ok(killed.signal !== null || (Number.isInteger(killed.code) && killed.code !== 0));
        await clientA.waitForClose().catch(() => {});
        const backendClosePolls = await waitForP2003BackendClosed({
          pool,
          applicationName: serverA.applicationName,
        });

        const second = await store.append({
          command: p2003EventCommand({
            ordinal: 2,
            sessionId,
            threadId,
            sourceId: 'fixture.restart.second',
          }),
        });
        serverB = spawnP2003ServerProcess({
          databaseUrl: isolatedDatabaseUrl,
          sessionId,
          threadId,
          heartbeatMs: 200,
          recoveryPollMs: 100,
          drainTimeoutMs: 1_000,
        });
        const addressB = await serverB.waitUntilReady();
        clientB = openP2003SseClient({
          port: addressB.port,
          lastEventId: first.event_id,
          captureLimit: 2,
        });
        await clientB.connected();
        await clientB.waitForEventCount(1);
        assert.equal(clientB.snapshot().first_event_id, second.event_id);

        const third = await store.append({
          command: p2003EventCommand({
            ordinal: 3,
            sessionId,
            threadId,
            sourceId: 'fixture.restart.missed-wakeup',
          }),
        });
        await clientB.waitForEventCount(2, 15_000);
        assert.equal(clientB.snapshot().last_event_id, third.event_id);
        const metrics = await serverB.snapshot();
        assert.ok(metrics.replay_query_batch_count >= 2);
        evidence = {
          killed_server_exit: killed,
          killed_server_backend_close_polls: backendClosePolls,
          first_event_id: first.event_id,
          post_restart_event_id: second.event_id,
          recovery_poll_event_id: third.event_id,
          app_restart_postgresql_replay: true,
          missed_wakeup_recovered: true,
          server_a_port: addressA.port,
          server_b_port: addressB.port,
        };
        await clientB.destroy();
        const exitB = await serverB.shutdown();
        assert.deepEqual(exitB, { code: 0, signal: null, killed: false });
        assert.deepEqual(serverB.output(), { stdout: '', stderr: '' });
      } finally {
        await clientA?.destroy().catch(() => {});
        await clientB?.destroy().catch(() => {});
        await serverA.ensureTerminated().catch(() => {});
        await serverB?.ensureTerminated().catch(() => {});
      }
      if (serverB) {
        await waitForP2003BackendClosed({
          pool,
          applicationName: serverB.applicationName,
        });
      }
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

test('P2-003 real paused slow client is isolated while normal delivery and append continue', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  let evidence;
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'slowclient',
    max: 4,
    run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      await ensureP2003StreamState(pool);
      const conversation = await createSyntheticConversationSession(pool, 'slow-client');
      const { sessionId, threadId } = conversation;
      const businessBefore = await pool.query(
        `SELECT row_version::text, last_activity_at
           FROM conversation.session
          WHERE id = $1::uuid`,
        [sessionId],
      );
      assert.equal(businessBefore.rows.length, 1);
      const serverProcess = spawnP2003ServerProcess({
        databaseUrl: isolatedDatabaseUrl,
        sessionId,
        threadId,
        heartbeatMs: 1_000,
        recoveryPollMs: 100,
        replayBatchSize: 50,
        maxWritableBufferBytes: 65_536,
        drainTimeoutMs: 5_000,
        poolMax: 4,
      });
      let normalClient;
      let slowClient;
      try {
        const address = await serverProcess.waitUntilReady();
        slowClient = openP2003SseClient({
          port: address.port,
          lastEventId: '0',
          paused: true,
        });
        await slowClient.connected();
        await waitForServerMetrics(serverProcess, (metrics) => metrics.active_clients === 1);
        const beforeBulkMetrics = await serverProcess.snapshot();
        const bulk = await insertP2003MinimalEvents({
          pool,
          count: 5_000,
          sessionId,
          sourceOffset: 100_000,
        });
        await serverProcess.wakeup();
        const activeSlowWriteWindow = await waitForServerMetrics(
          serverProcess,
          (metrics) => metrics.replay_query_batch_count
              > beforeBulkMetrics.replay_query_batch_count
            && metrics.active_drain_waiters === 1
            && metrics.slow_client_disconnect_count === 0
            && metrics.active_clients === 1,
          { timeoutMs: 15_000, intervalMs: 5 },
        );
        const businessClient = await pool.connect();
        let afterSlow;
        let businessUpdate;
        try {
          await businessClient.query('BEGIN');
          businessUpdate = await businessClient.query(
            `UPDATE conversation.session
                SET row_version = row_version + 1,
                    last_activity_at = TIMESTAMPTZ '2026-08-31 02:00:00+00'
              WHERE id = $1::uuid
              RETURNING row_version::text, last_activity_at`,
            [sessionId],
          );
          afterSlow = await appendRealtimeEvent({
            transaction: businessClient,
            command: p2003EventCommand({
              ordinal: 5_001,
              sessionId,
              threadId,
              sourceId: 'fixture.slow.business-transaction',
              payload: { state: 'ACTIVE', ordinal: 5_001 },
            }),
          });
          await businessClient.query('COMMIT');
        } catch (error) {
          await businessClient.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          businessClient.release();
        }
        assert.equal(afterSlow.status, 'INSERTED');
        assert.equal(
          businessUpdate.rows[0].row_version,
          String(BigInt(businessBefore.rows[0].row_version) + 1n),
        );
        assert.equal(
          businessUpdate.rows[0].last_activity_at.toISOString(),
          '2026-08-31T02:00:00.000Z',
        );
        normalClient = openP2003SseClient({ port: address.port, lastEventId: '0' });
        await normalClient.connected();
        const normalJoinedDuringSlowDrain = await waitForServerMetrics(
          serverProcess,
          (metrics) => metrics.active_clients === 2
            && metrics.active_drain_waiters >= 1
            && metrics.slow_client_disconnect_count === 0,
          { timeoutMs: 15_000, intervalMs: 5 },
        );
        await serverProcess.wakeup();
        const [normalAfterFailure, slowClosed] = await Promise.all([
          normalClient.waitForEventCount(5_001, 60_000),
          waitForServerMetrics(
            serverProcess,
            (metrics) => metrics.slow_client_disconnect_count === 1
              && metrics.active_clients === 1,
            { timeoutMs: 60_000, intervalMs: 50 },
          ),
        ]);
        assert.equal(normalAfterFailure.event_count, 5_001);
        await slowClient.waitForClose().catch(() => {});
        assert.equal(normalClient.snapshot().first_event_id, bulk.first_event_id);
        assert.equal(normalClient.snapshot().last_event_id, afterSlow.event_id);
        const persisted = await pool.query(
          `SELECT
             (SELECT count(*)::integer FROM conversation.realtime_event) AS event_count,
             (SELECT count(*)::integer
                FROM conversation.realtime_event
               WHERE source_id = 'fixture.slow.business-transaction') AS business_event_count,
             (SELECT row_version::text
                FROM conversation.session
               WHERE id = $1::uuid) AS session_row_version,
             (SELECT last_activity_at
                FROM conversation.session
               WHERE id = $1::uuid) AS session_last_activity_at`,
          [sessionId],
        );
        assert.equal(persisted.rows[0].event_count, 5_001);
        assert.equal(persisted.rows[0].business_event_count, 1);
        assert.equal(persisted.rows[0].session_row_version, businessUpdate.rows[0].row_version);
        assert.equal(
          persisted.rows[0].session_last_activity_at.toISOString(),
          '2026-08-31T02:00:00.000Z',
        );
        const metrics = await serverProcess.snapshot();
        assert.equal(metrics.slow_client_disconnect_count, 1);
        assert.equal(metrics.active_clients, 1);
        assert.ok(metrics.max_writable_length <= 65_536 + 4_096);
        evidence = {
          slow_disconnect_count: metrics.slow_client_disconnect_count,
          normal_client_received: normalClient.snapshot().event_count,
          persisted_event_count: persisted.rows[0].event_count,
          slow_disconnect_polls: slowClosed.polls,
          active_slow_write_window_polls: activeSlowWriteWindow.polls,
          normal_joined_during_slow_drain_polls: normalJoinedDuringSlowDrain.polls,
          normal_client_remained_connected: true,
          append_during_slow_write_window: true,
          business_transaction_during_slow_write_window: true,
        };
        await normalClient.destroy();
        await serverProcess.shutdown();
      } finally {
        await normalClient?.destroy().catch(() => {});
        await slowClient?.destroy().catch(() => {});
        await serverProcess.ensureTerminated().catch(() => {});
      }
      await waitForP2003BackendClosed({
        pool,
        applicationName: serverProcess.applicationName,
      });
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

test('P2-003 streams 5,000 events in bounded batches and bounded heap without retaining frames', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  let evidence;
  await withP2003IsolatedDatabase({
    databaseUrl,
    purpose: 'resource',
    max: 4,
    run: async ({ pool, databaseUrl: isolatedDatabaseUrl }) => {
      await applyBaseMigrations(pool);
      await applyRealtimeEventLogMigration({ pool });
      await ensureP2003StreamState(pool);
      const sessionId = randomUUID();
      const threadId = randomUUID();
      const inserted = await insertP2003MinimalEvents({
        pool,
        count: 5_000,
        sessionId,
        sourceOffset: 200_000,
      });
      const serverProcess = spawnP2003ServerProcess({
        databaseUrl: isolatedDatabaseUrl,
        sessionId,
        threadId,
        heartbeatMs: 1_000,
        recoveryPollMs: 1_000,
        replayBatchSize: 50,
        maxWritableBufferBytes: 65_536,
        drainTimeoutMs: 1_000,
        poolMax: 4,
      });
      let client;
      const heapSamples = [];
      try {
        const address = await serverProcess.waitUntilReady();
        heapSamples.push((await serverProcess.snapshot()).heap_used_bytes);
        client = openP2003SseClient({
          port: address.port,
          lastEventId: '0',
          captureLimit: 0,
        });
        await client.connected();
        for (const expected of [1_000, 2_000, 3_000, 4_000, 5_000]) {
          await client.waitForEventCount(expected, 60_000);
          heapSamples.push((await serverProcess.snapshot()).heap_used_bytes);
        }
        const clientResult = client.snapshot();
        const metrics = await serverProcess.snapshot();
        assert.equal(clientResult.event_count, 5_000);
        assert.equal(clientResult.first_event_id, inserted.first_event_id);
        assert.equal(clientResult.last_event_id, inserted.last_event_id);
        assert.equal(clientResult.captured_events.length, 0);
        assert.ok(metrics.replay_query_batch_count >= 100);
        assert.ok(metrics.replay_query_batch_count <= 101);
        assert.ok(metrics.max_writable_length <= 65_536);
        assert.ok(metrics.pool_total_count <= 4);
        const firstToLastHeapTrend = Math.max(0, heapSamples.at(-1) - heapSamples[0]);
        const peakHeapDelta = Math.max(...heapSamples) - heapSamples[0];
        assert.ok(firstToLastHeapTrend < 128 * 1024 * 1024);
        assert.ok(peakHeapDelta < 256 * 1024 * 1024);
        evidence = {
          event_count: clientResult.event_count,
          replay_query_batch_count: metrics.replay_query_batch_count,
          replay_batch_size: 50,
          captured_frame_count: clientResult.captured_events.length,
          maximum_parser_buffer_bytes: clientResult.maximum_parser_buffer_bytes,
          maximum_writable_length: metrics.max_writable_length,
          heap_samples_bytes: heapSamples,
          first_to_last_heap_trend_bytes: firstToLastHeapTrend,
          peak_heap_delta_bytes: peakHeapDelta,
        };
        await client.destroy();
        await serverProcess.shutdown();
      } finally {
        await client?.destroy().catch(() => {});
        await serverProcess.ensureTerminated().catch(() => {});
      }
      await waitForP2003BackendClosed({
        pool,
        applicationName: serverProcess.applicationName,
      });
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

test('P2-003 suite leaves no owned database, schema, child, backend, socket, port or timer residual', {
  timeout: TEST_TIMEOUT,
}, async (t) => {
  let clientResidual;
  let emergencyCleanup;
  try {
    clientResidual = assertNoP2003ClientResidual();
  } finally {
    emergencyCleanup = await destroyAllP2003SseClients();
  }
  assert.equal(emergencyCleanup.destroyed_client_count, 0);
  assert.equal(emergencyCleanup.destroyed_fallback_request_count, 0);
  assert.equal(emergencyCleanup.destroyed_http_socket_count, 0);
  const cliResidual = assertNoP2003CliChildResidual();
  const serverResidual = await assertNoP2003ServerChildResidual();
  const databaseResidual = await assertNoP2003OwnedDatabaseResidual({ databaseUrl });
  t.diagnostic(JSON.stringify({
    ...clientResidual,
    ...cliResidual,
    ...serverResidual,
    ...databaseResidual,
    emergency_client_cleanup_count: emergencyCleanup.destroyed_client_count,
    emergency_fallback_cleanup_count: emergencyCleanup.destroyed_fallback_request_count,
    emergency_http_socket_cleanup_count: emergencyCleanup.destroyed_http_socket_count,
  }));
});
