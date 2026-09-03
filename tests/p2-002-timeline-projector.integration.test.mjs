import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { postgresTimestampToLocalDateTime } from '../src/platform/postgres-types.mjs';
import { migrateCurrentBaseline } from '../scripts/migrate-current-baseline.mjs';
import { adaptWeComSdkFrame } from '../src/p1-002-wecom-sdk-adapter.mjs';
import {
  applyChannelMessageInboxMigration,
  createChannelMessageInbox,
} from '../src/p1-003-channel-message-inbox.mjs';
import {
  applyServiceIntakeMigration,
  createServiceIntakeProcessor,
} from '../src/p1-004-service-intake.mjs';
import {
  applyPilotTicketCoreMigration,
  createPilotTicketCore,
  createPilotTicketProcessor,
} from '../src/p1-005-pilot-ticket-core.mjs';
import {
  applyTicketStateActionMigration,
  createTicketActionService,
} from '../src/p1-006-ticket-state-actions.mjs';
import {
  applyNotificationOutboxMigration,
  createNotificationDeliveryWorker,
  createNotificationOutbox,
} from '../src/p1-007-notification-outbox.mjs';
import { applyPilotAccessMigration } from '../src/p1-009-pilot-access-workbench.mjs';
import { applyTicketClosureMigration } from '../src/p1-010-ticket-closure.mjs';
import { applyPilotOperationsMigration } from '../src/p1-011-pilot-operations-baseline.mjs';
import {
  applyConversationContractsMigration,
  buildConversationSessionScope,
  buildConversationThreadIdentity,
} from '../src/p2-001-conversation-contracts.mjs';
import {
  TIMELINE_ERROR_CODES,
  applyTimelineProjectionMigration,
  computeTimelineCanonicalHash,
  createP1TimelineSourceAdapter,
  createTimelineProjector,
  createTimelineProjectorWorker,
  normalizeTimelineSourceRecord,
} from '../src/p2-002-timeline-projector.mjs';
import {
  databaseUrlForP2002Database,
  withP2002IsolatedDatabase,
} from './helpers/p2-002-postgres-harness.mjs';
import { runP2002MigrationProcess } from './helpers/p2-002-migrate-process-harness.mjs';
import { spawnP2002WorkerProcess } from './helpers/p2-002-worker-process-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const PROJECTOR_NAME = 'CONVERSATION_TIMELINE';
const PROJECTOR_VERSION = '1';
const RETENTION_UNTIL = '2027-08-30 08:00:00';

async function applyBaseMigrations(pool) {
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyNotificationOutboxMigration({ pool });
  await applyConversationContractsMigration({ pool });
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

async function userSchemaNames(pool) {
  const result = await pool.query(
    `SELECT namespace_record.nspname AS schema_name
       FROM pg_namespace AS namespace_record
      WHERE namespace_record.nspname <> 'information_schema'
        AND namespace_record.nspname !~ '^pg_'
      ORDER BY namespace_record.nspname`,
  );
  return result.rows.map((row) => row.schema_name);
}

async function userNonIndexRelations(pool) {
  const result = await pool.query(
    `SELECT namespace_record.nspname || '.' || relation_record.relname
              AS relation_name,
            relation_record.relkind AS relation_kind,
            relation_record.relpersistence AS persistence
       FROM pg_class AS relation_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = relation_record.relnamespace
      WHERE namespace_record.nspname <> 'information_schema'
        AND namespace_record.nspname !~ '^pg_'
        AND relation_record.relkind NOT IN ('i', 'I')
      ORDER BY namespace_record.nspname, relation_record.relname,
               relation_record.relkind`,
  );
  return result.rows;
}

async function userNonRelationCatalog(pool) {
  const routines = await pool.query(
    `SELECT namespace_record.nspname AS schema_name,
            procedure_record.proname AS routine_name,
            pg_get_function_identity_arguments(procedure_record.oid)
              AS identity_arguments,
            procedure_record.prokind AS routine_kind,
            language_record.lanname AS language_name,
            format_type(procedure_record.prorettype, NULL) AS return_type,
            procedure_record.provolatile AS volatility,
            procedure_record.prosecdef AS security_definer,
            procedure_record.proleakproof AS leakproof,
            procedure_record.prosrc AS source_definition
       FROM pg_proc AS procedure_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = procedure_record.pronamespace
       JOIN pg_language AS language_record
         ON language_record.oid = procedure_record.prolang
      WHERE namespace_record.nspname <> 'information_schema'
        AND namespace_record.nspname !~ '^pg_'
      ORDER BY namespace_record.nspname, procedure_record.proname,
               pg_get_function_identity_arguments(procedure_record.oid)`,
  );
  const standaloneTypes = await pool.query(
    `SELECT namespace_record.nspname AS schema_name,
            type_record.typname AS type_name,
            type_record.typtype AS type_kind,
            type_record.typcategory AS type_category,
            type_record.typnotnull AS not_null,
            type_record.typdefault AS default_value,
            COALESCE((
              SELECT jsonb_agg(enum_record.enumlabel ORDER BY enum_record.enumsortorder)
                FROM pg_enum AS enum_record
               WHERE enum_record.enumtypid = type_record.oid
            ), '[]'::jsonb) AS enum_labels
       FROM pg_type AS type_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = type_record.typnamespace
       LEFT JOIN pg_type AS element_type
         ON element_type.oid = type_record.typelem
      WHERE namespace_record.nspname <> 'information_schema'
        AND namespace_record.nspname !~ '^pg_'
        AND type_record.typrelid = 0
        AND (type_record.typelem = 0 OR element_type.typrelid = 0)
      ORDER BY namespace_record.nspname, type_record.typname`,
  );
  const extensions = await pool.query(
    `SELECT extension_record.extname AS extension_name,
            extension_record.extversion AS extension_version,
            namespace_record.nspname AS schema_name,
            extension_record.extrelocatable AS relocatable
       FROM pg_extension AS extension_record
       JOIN pg_namespace AS namespace_record
         ON namespace_record.oid = extension_record.extnamespace
      ORDER BY extension_record.extname`,
  );
  return {
    routines: routines.rows,
    standalone_types: standaloneTypes.rows,
    extensions: extensions.rows,
  };
}

async function relationContracts(pool, relationNames) {
  const result = await pool.query(
    `WITH requested(relation_name) AS (
       SELECT unnest($1::text[])
     )
     SELECT requested.relation_name,
            jsonb_build_object(
              'kind', relation.relkind,
              'persistence', relation.relpersistence,
              'columns', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                         'name', attribute.attname,
                         'type', format_type(attribute.atttypid, attribute.atttypmod),
                         'not_null', attribute.attnotnull,
                         'identity', attribute.attidentity,
                         'generated', attribute.attgenerated,
                         'default', pg_get_expr(attribute_default.adbin, attribute_default.adrelid)
                       ) ORDER BY attribute.attnum)
                  FROM pg_attribute AS attribute
                  LEFT JOIN pg_attrdef AS attribute_default
                    ON attribute_default.adrelid = attribute.attrelid
                   AND attribute_default.adnum = attribute.attnum
                 WHERE attribute.attrelid = relation.oid
                   AND attribute.attnum > 0
                   AND NOT attribute.attisdropped
              ), '[]'::jsonb),
              'constraints', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                         'name', constraint_record.conname,
                         'type', constraint_record.contype,
                         'definition', pg_get_constraintdef(constraint_record.oid, true),
                         'validated', constraint_record.convalidated,
                         'deferrable', constraint_record.condeferrable
                       ) ORDER BY constraint_record.conname)
                  FROM pg_constraint AS constraint_record
                 WHERE constraint_record.conrelid = relation.oid
              ), '[]'::jsonb),
              'indexes', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                         'name', index_relation.relname,
                         'definition', pg_get_indexdef(index_record.indexrelid),
                         'valid', index_record.indisvalid,
                         'ready', index_record.indisready
                       ) ORDER BY index_relation.relname)
                  FROM pg_index AS index_record
                  JOIN pg_class AS index_relation
                    ON index_relation.oid = index_record.indexrelid
                 WHERE index_record.indrelid = relation.oid
              ), '[]'::jsonb)
            ) AS contract
       FROM requested
       JOIN pg_class AS relation
         ON relation.oid = to_regclass(requested.relation_name)
      ORDER BY requested.relation_name`,
    [relationNames],
  );
  return result.rows;
}

async function nonInternalTriggerDefinitions(pool) {
  const result = await pool.query(
    `SELECT namespace.nspname AS schema_name,
            relation.relname AS relation_name,
            trigger_record.tgname AS trigger_name,
            pg_get_triggerdef(trigger_record.oid) AS definition
       FROM pg_trigger AS trigger_record
      JOIN pg_class AS relation ON relation.oid = trigger_record.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE NOT trigger_record.tgisinternal
        AND namespace.nspname <> 'information_schema'
        AND namespace.nspname !~ '^pg_'
      ORDER BY namespace.nspname, relation.relname, trigger_record.tgname`,
  );
  return result.rows;
}

function stableError(code, forbiddenText = null) {
  return (error) => {
    assert.equal(error?.code, code);
    assert.equal(error?.message, code);
    if (forbiddenText !== null) {
      assert.doesNotMatch(error.message, forbiddenText);
      assert.doesNotMatch(JSON.stringify(error), forbiddenText);
    }
    return true;
  };
}

async function createConversationSession(pool, label, { serviceIntakeId = null } = {}) {
  const identity = buildConversationThreadIdentity({
    provider: 'WECOM_AIBOT',
    botId: `synthetic-bot-${label}`,
    chatType: 'group',
    chatId: `synthetic-chat-${label}`,
    senderUserId: `synthetic-participant-${label}`,
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
      '2026-08-30 08:00:00',
    ],
  );
  const creationIdempotencyKey = `P2-002-INTEGRATION:${label}`;
  const scope = buildConversationSessionScope({
    threadKey: thread.rows[0].thread_key,
    participantKey: identity.participant_key,
    serviceIntakeId,
    creationIdempotencyKey,
  });
  const session = await pool.query(
    `INSERT INTO conversation.session (
       thread_id, participant_key, service_intake_id, session_scope_key,
       creation_idempotency_key, last_activity_at
     ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::timestamptz)
     RETURNING id::text`,
    [
      thread.rows[0].id,
      scope.participant_key,
      serviceIntakeId,
      scope.session_scope_key,
      scope.creation_idempotency_key,
      '2026-08-30 08:00:00',
    ],
  );
  return session.rows[0].id;
}

const SOURCE_DEFAULTS = Object.freeze({
  CHANNEL_MESSAGE: Object.freeze({
    itemType: 'USER_MESSAGE',
    senderKind: 'USER',
    visibility: 'EXTERNAL',
  }),
  COMMUNICATION_MESSAGE: Object.freeze({
    itemType: 'AGENT_MESSAGE',
    senderKind: 'AGENT',
    visibility: 'EXTERNAL',
  }),
  TICKET_EVENT: Object.freeze({
    itemType: 'TICKET_EVENT',
    senderKind: 'SYSTEM',
    visibility: 'INTERNAL',
  }),
  DELIVERY: Object.freeze({
    itemType: 'DELIVERY_STATUS',
    senderKind: 'SYSTEM',
    visibility: 'INTERNAL',
  }),
  HANDOFF_EVENT: Object.freeze({
    itemType: 'HANDOFF_EVENT',
    senderKind: 'SYSTEM',
    visibility: 'INTERNAL',
  }),
});

function sourceRecord({
  sessionId,
  sourceStream,
  sourceType = 'CHANNEL_MESSAGE',
  sourceId,
  projectionVariant = 'PRIMARY',
  occurredAt = '2026-08-30 09:00:00',
  sourceOrdinal = '1',
  text = 'synthetic timeline content',
  safeContent = { fixture_kind: 'P2_002_INTEGRATION' },
  itemType,
  senderKind,
  visibility,
  privacyClass = 'INTERNAL',
  retentionUntil = RETENTION_UNTIL,
}) {
  const defaults = SOURCE_DEFAULTS[sourceType];
  return normalizeTimelineSourceRecord({
    schema_version: 1,
    projector_name: PROJECTOR_NAME,
    projector_version: PROJECTOR_VERSION,
    source_stream: sourceStream,
    source_type: sourceType,
    source_id: sourceId,
    projection_variant: projectionVariant,
    session_id: sessionId,
    item_type: itemType ?? defaults.itemType,
    sender_kind: senderKind ?? defaults.senderKind,
    visibility: visibility ?? defaults.visibility,
    text,
    safe_content: safeContent,
    occurred_at: occurredAt,
    source_ordinal: String(sourceOrdinal),
    privacy_class: privacyClass,
    retention_until: retentionUntil,
  });
}

function projectOne(projector, record, options = {}) {
  return projector.projectOne({
    projectorName: PROJECTOR_NAME,
    projectorVersion: PROJECTOR_VERSION,
    sourceStream: record.source_stream,
    record,
    ...options,
  });
}

function projectBatch(projector, records, options = {}) {
  assert.ok(records.length > 0);
  return projector.projectBatch({
    projectorName: PROJECTOR_NAME,
    projectorVersion: PROJECTOR_VERSION,
    sourceStream: records[0].source_stream,
    records,
    ...options,
  });
}

async function rawSessionItems(pool, sessionId) {
  const result = await pool.query(
    `SELECT id::text, session_id::text, sequence_no::text,
            item_type, sender_kind, visibility, text, safe_content,
            source_type, source_id, projection_variant, canonical_order_key,
            content_hash, privacy_class, retention_until, occurred_at,
            projected_at
       FROM conversation.item
      WHERE session_id = $1::uuid
      ORDER BY conversation.item.sequence_no`,
    [sessionId],
  );
  return result.rows.map((row) => ({
    ...row,
    retention_until: postgresTimestampToLocalDateTime(row.retention_until),
    occurred_at: postgresTimestampToLocalDateTime(row.occurred_at),
    projected_at: postgresTimestampToLocalDateTime(row.projected_at),
  }));
}

async function sourceFactCounts(pool) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::integer FROM channel.message_inbox) AS channel_messages,
       (SELECT count(*)::integer FROM intake.service_intake) AS service_intakes,
       (SELECT count(*)::integer FROM intake.service_intake_message) AS intake_messages,
       (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,
       (SELECT count(*)::integer FROM pilot_ticket.ticket_event) AS ticket_events,
       (SELECT count(*)::integer FROM notification.outbox) AS outbox_rows,
       (SELECT count(*)::integer FROM notification.delivery) AS deliveries,
       (SELECT count(*)::integer FROM notification.delivery_attempt) AS delivery_attempts`,
  );
  return result.rows[0];
}

async function sourceFactSnapshots(pool) {
  const result = await pool.query(
    `SELECT relation_name, row_count, digest
       FROM (
         SELECT 'channel.message_inbox' AS relation_name,
                count(*)::integer AS row_count,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.id), '')) AS digest
           FROM channel.message_inbox AS source_row
         UNION ALL
         SELECT 'intake.service_intake', count(*)::integer,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.id), ''))
           FROM intake.service_intake AS source_row
         UNION ALL
         SELECT 'intake.service_intake_message', count(*)::integer,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.intake_id, source_row.channel_message_id), ''))
           FROM intake.service_intake_message AS source_row
         UNION ALL
         SELECT 'intake.service_intake_event', count(*)::integer,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.event_id), ''))
           FROM intake.service_intake_event AS source_row
         UNION ALL
         SELECT 'pilot_ticket.ticket', count(*)::integer,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.id), ''))
           FROM pilot_ticket.ticket AS source_row
         UNION ALL
         SELECT 'pilot_ticket.ticket_event', count(*)::integer,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.event_id), ''))
           FROM pilot_ticket.ticket_event AS source_row
         UNION ALL
         SELECT 'notification.outbox', count(*)::integer,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.id), ''))
           FROM notification.outbox AS source_row
         UNION ALL
         SELECT 'notification.delivery', count(*)::integer,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.id), ''))
           FROM notification.delivery AS source_row
         UNION ALL
         SELECT 'notification.delivery_attempt', count(*)::integer,
                md5(COALESCE(string_agg(to_jsonb(source_row)::text, '|'
                    ORDER BY source_row.id), ''))
           FROM notification.delivery_attempt AS source_row
       ) AS source_snapshots
      ORDER BY relation_name`,
  );
  return result.rows;
}

async function projectionState(pool, sessionId, sourceStream) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::integer FROM conversation.item
         WHERE session_id = $1::uuid) AS item_count,
       (SELECT count(*)::integer FROM conversation.item_source_binding
         WHERE session_id = $1::uuid) AS binding_count,
       (SELECT count(*)::integer FROM conversation.projection_checkpoint
         WHERE projector_name = $2 AND source_stream = $3) AS checkpoint_count,
       (SELECT cursor_value FROM conversation.projection_checkpoint
         WHERE projector_name = $2 AND source_stream = $3) AS cursor_value,
       (SELECT row_version::text FROM conversation.projection_checkpoint
         WHERE projector_name = $2 AND source_stream = $3) AS checkpoint_row_version,
       (SELECT last_batch_hash FROM conversation.projection_checkpoint
         WHERE projector_name = $2 AND source_stream = $3) AS checkpoint_batch_hash`,
    [sessionId, PROJECTOR_NAME, sourceStream],
  );
  return result.rows[0];
}

async function bindingSnapshot(pool, sessionId) {
  const result = await pool.query(
    `SELECT projector_name, projector_version, source_stream, source_type,
            source_id, projection_variant, session_id::text, item_id::text,
            source_hash, canonical_order_key, created_at, last_seen_at
       FROM conversation.item_source_binding
      WHERE session_id = $1::uuid
      ORDER BY canonical_order_key, source_type, source_id, projection_variant`,
    [sessionId],
  );
  return result.rows;
}

async function waitForPoolWaiter(pool) {
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    if (pool.waitingCount >= 1) {
      return attempt;
    }
    await delay(10);
  }
  assert.fail('P2_002_STALE_REBUILD_DID_NOT_WAIT_FOR_CONNECTION');
}

async function waitForWorkerBackendClosed(pool, workerToken) {
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const result = await pool.query(
      `SELECT count(*)::integer AS count
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND application_name = $1`,
      [workerToken],
    );
    if (result.rows[0].count === 0) {
      return attempt;
    }
    await delay(25);
  }
  assert.fail('P2_002_CHILD_DATABASE_BACKEND_DID_NOT_CLOSE');
}

function assertKilledWorker(exitInformation) {
  assert.equal(exitInformation.killed, true);
  assert.ok(
    exitInformation.signal !== null
    || (Number.isInteger(exitInformation.code) && exitInformation.code !== 0),
  );
}

function assertCleanWorkerOutput(worker) {
  assert.deepEqual(worker.output(), { stdout: '', stderr: '' });
}

function assertSuccessfulMigrationProcess(execution, mode, databaseName) {
  assert.deepEqual(execution.exit, { code: 0, signal: null });
  assert.equal(execution.stderr, '');
  assert.equal(execution.stdout.includes(databaseName), false);
  assert.equal(execution.stdout.includes(databaseUrl), false);
  assert.deepEqual(execution.result, {
    ok: true,
    task: 'P2-002',
    mode,
    migrations: ['011_p2_002_timeline_projector'],
    relations: [
      'conversation.item',
      'conversation.item_source_binding',
      'conversation.projection_checkpoint',
    ],
    feature_flags_enabled: false,
  });
}

integrationTest('P2-002 migration 011 first/repeat apply is exact and leaves P1/P2-001 unchanged', async () => {
  await withP2002IsolatedDatabase({
    databaseUrl,
    purpose: 'migration',
    run: async ({ pool }) => {
      await applyBaseMigrations(pool);
      const beforeTables = await applicationTableNames(pool);
      const beforeSchemas = await userSchemaNames(pool);
      const beforeNonIndexRelations = await userNonIndexRelations(pool);
      const beforeNonRelationCatalog = await userNonRelationCatalog(pool);
      const beforeContracts = await relationContracts(pool, beforeTables);
      const beforeTriggers = await nonInternalTriggerDefinitions(pool);

      await applyTimelineProjectionMigration({ pool });
      const afterFirstTables = await applicationTableNames(pool);
      const afterFirstNonIndexRelations = await userNonIndexRelations(pool);
      const addedTables = afterFirstTables.filter((name) => !beforeTables.includes(name));
      assert.deepEqual(addedTables, [
        'conversation.item',
        'conversation.item_source_binding',
        'conversation.projection_checkpoint',
      ]);
      assert.deepEqual(await userSchemaNames(pool), beforeSchemas);
      assert.deepEqual(await userNonRelationCatalog(pool), beforeNonRelationCatalog);
      assert.deepEqual(
        afterFirstNonIndexRelations.filter((relation) => !beforeNonIndexRelations.some(
          (beforeRelation) => (
            beforeRelation.relation_name === relation.relation_name
            && beforeRelation.relation_kind === relation.relation_kind
            && beforeRelation.persistence === relation.persistence
          ),
        )),
        [
          {
            relation_name: 'conversation.item',
            relation_kind: 'r',
            persistence: 'p',
          },
          {
            relation_name: 'conversation.item_source_binding',
            relation_kind: 'r',
            persistence: 'p',
          },
          {
            relation_name: 'conversation.projection_checkpoint',
            relation_kind: 'r',
            persistence: 'p',
          },
        ],
      );
      assert.deepEqual(
        await relationContracts(pool, beforeTables),
        beforeContracts,
      );
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), beforeTriggers);

      const afterFirstContracts = await relationContracts(pool, afterFirstTables);
      await applyTimelineProjectionMigration({ pool });
      assert.deepEqual(await applicationTableNames(pool), afterFirstTables);
      assert.deepEqual(
        await relationContracts(pool, afterFirstTables),
        afterFirstContracts,
      );
      assert.deepEqual(await userSchemaNames(pool), beforeSchemas);
      assert.deepEqual(await userNonIndexRelations(pool), afterFirstNonIndexRelations);
      assert.deepEqual(await userNonRelationCatalog(pool), beforeNonRelationCatalog);
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), beforeTriggers);

      const prohibited = afterFirstTables.filter((name) => (
        /^conversation\.(?:realtime_event|handoff|assignment_history|read_cursor)$/u.test(name)
        || /^(?:communication|ai|integration)\./u.test(name)
      ));
      assert.deepEqual(prohibited, []);
    },
  });
});

integrationTest('P2-002 migration CLI runs only 011, is repeatable, and rolls check mode back', async (t) => {
  let evidence;
  await withP2002IsolatedDatabase({
    databaseUrl,
    purpose: 'migrationcli',
    run: async ({ pool, databaseName }) => {
      await applyBaseMigrations(pool);
      const beforeTables = await applicationTableNames(pool);
      const beforeSchemas = await userSchemaNames(pool);
      const beforeNonIndexRelations = await userNonIndexRelations(pool);
      const beforeNonRelationCatalog = await userNonRelationCatalog(pool);
      const beforeContracts = await relationContracts(pool, beforeTables);
      const beforeTriggers = await nonInternalTriggerDefinitions(pool);

      const preApplyCheck = await runP2002MigrationProcess({
        databaseName,
        mode: 'check',
      });
      assertSuccessfulMigrationProcess(preApplyCheck, 'check', databaseName);
      assert.deepEqual(await applicationTableNames(pool), beforeTables);
      assert.deepEqual(await userSchemaNames(pool), beforeSchemas);
      assert.deepEqual(await userNonIndexRelations(pool), beforeNonIndexRelations);
      assert.deepEqual(await userNonRelationCatalog(pool), beforeNonRelationCatalog);
      assert.deepEqual(await relationContracts(pool, beforeTables), beforeContracts);
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), beforeTriggers);

      const firstApply = await runP2002MigrationProcess({
        databaseName,
        mode: 'migrate',
      });
      assertSuccessfulMigrationProcess(firstApply, 'migrate', databaseName);
      const afterFirstTables = await applicationTableNames(pool);
      const afterFirstNonIndexRelations = await userNonIndexRelations(pool);
      const addedTables = afterFirstTables.filter((name) => !beforeTables.includes(name));
      assert.deepEqual(addedTables, [
        'conversation.item',
        'conversation.item_source_binding',
        'conversation.projection_checkpoint',
      ]);
      assert.deepEqual(await userSchemaNames(pool), beforeSchemas);
      assert.deepEqual(await userNonRelationCatalog(pool), beforeNonRelationCatalog);
      assert.deepEqual(
        afterFirstNonIndexRelations.filter((relation) => !beforeNonIndexRelations.some(
          (beforeRelation) => (
            beforeRelation.relation_name === relation.relation_name
            && beforeRelation.relation_kind === relation.relation_kind
            && beforeRelation.persistence === relation.persistence
          ),
        )).map((relation) => [
          relation.relation_name,
          relation.relation_kind,
          relation.persistence,
        ]),
        [
          ['conversation.item', 'r', 'p'],
          ['conversation.item_source_binding', 'r', 'p'],
          ['conversation.projection_checkpoint', 'r', 'p'],
        ],
      );
      assert.deepEqual(await relationContracts(pool, beforeTables), beforeContracts);
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), beforeTriggers);
      const afterFirstContracts = await relationContracts(pool, afterFirstTables);

      const repeatApply = await runP2002MigrationProcess({
        databaseName,
        mode: 'migrate',
      });
      assertSuccessfulMigrationProcess(repeatApply, 'migrate', databaseName);
      assert.deepEqual(await applicationTableNames(pool), afterFirstTables);
      assert.deepEqual(
        await relationContracts(pool, afterFirstTables),
        afterFirstContracts,
      );
      assert.deepEqual(await userSchemaNames(pool), beforeSchemas);
      assert.deepEqual(await userNonIndexRelations(pool), afterFirstNonIndexRelations);
      assert.deepEqual(await userNonRelationCatalog(pool), beforeNonRelationCatalog);
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), beforeTriggers);

      const postApplyCheck = await runP2002MigrationProcess({
        databaseName,
        mode: 'check',
      });
      assertSuccessfulMigrationProcess(postApplyCheck, 'check', databaseName);
      assert.deepEqual(await applicationTableNames(pool), afterFirstTables);
      assert.deepEqual(
        await relationContracts(pool, afterFirstTables),
        afterFirstContracts,
      );
      assert.deepEqual(await userSchemaNames(pool), beforeSchemas);
      assert.deepEqual(await userNonIndexRelations(pool), afterFirstNonIndexRelations);
      assert.deepEqual(await userNonRelationCatalog(pool), beforeNonRelationCatalog);
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), beforeTriggers);

      evidence = Object.freeze({
        child_process_runs: 4,
        child_exit_codes: [
          preApplyCheck.exit.code,
          firstApply.exit.code,
          repeatApply.exit.code,
          postApplyCheck.exit.code,
        ],
        preapply_check_created_tables: 0,
        migration_files_executed: 1,
        tables_added: addedTables.length,
        p1_p2_001_catalog_unchanged: true,
        postapply_check_rolled_back: true,
      });
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

integrationTest('P2-002 migration CLI fails closed on incompatible read-only source dependencies', async (t) => {
  let evidence;
  await withP2002IsolatedDatabase({
    databaseUrl,
    purpose: 'clipreflight',
    run: async ({ pool, databaseName }) => {
      await applyBaseMigrations(pool);
      const beforeTables = await applicationTableNames(pool);
      await pool.query(
        'ALTER TABLE notification.delivery RENAME COLUMN channel TO channel_drifted',
      );
      const execution = await runP2002MigrationProcess({
        databaseName,
        mode: 'migrate',
      });
      assert.deepEqual(execution.exit, { code: 1, signal: null });
      assert.equal(execution.stderr, '');
      assert.equal(execution.stdout.includes(databaseName), false);
      assert.equal(execution.stdout.includes(databaseUrl), false);
      assert.deepEqual(execution.result, {
        ok: false,
        error: {
          code: 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
          retryable: false,
        },
      });
      assert.deepEqual(await applicationTableNames(pool), beforeTables);
      assert.equal(
        (await applicationTableNames(pool)).some((name) => (
          name === 'conversation.item'
          || name === 'conversation.item_source_binding'
          || name === 'conversation.projection_checkpoint'
        )),
        false,
      );
      evidence = Object.freeze({
        child_exit_code: execution.exit.code,
        stable_error: execution.result.error.code,
        p2_tables_created: 0,
      });
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

const driftScenarios = Object.freeze([
  Object.freeze({
    purpose: 'missingcolumn',
    title: 'missing column',
    sql: 'ALTER TABLE conversation.item DROP COLUMN projected_at',
  }),
  Object.freeze({
    purpose: 'weakcheck',
    title: 'weakened CHECK constraint',
    sql: `ALTER TABLE conversation.item
            DROP CONSTRAINT conversation_item_content_hash_check;
          ALTER TABLE conversation.item
            ADD CONSTRAINT conversation_item_content_hash_check
            CHECK (char_length(content_hash) >= 1)`,
  }),
  Object.freeze({
    purpose: 'badunique',
    title: 'wrong unique constraint columns',
    sql: `ALTER TABLE conversation.item_source_binding
            DROP CONSTRAINT conversation_item_source_binding_identity_unique;
          ALTER TABLE conversation.item_source_binding
            ADD CONSTRAINT conversation_item_source_binding_identity_unique UNIQUE (
              projector_name, source_stream, source_type, source_id, projection_variant
            )`,
  }),
  Object.freeze({
    purpose: 'badindex',
    title: 'wrong index access method',
    sql: `DROP INDEX conversation.conversation_item_retention_idx;
          CREATE INDEX conversation_item_retention_idx
            ON conversation.item USING hash (retention_until)`,
  }),
  Object.freeze({
    purpose: 'badpredicate',
    title: 'wrong partial-index predicate',
    sql: `DROP INDEX conversation.conversation_item_external_timeline_idx;
          CREATE INDEX conversation_item_external_timeline_idx
            ON conversation.item (session_id, sequence_no)
            WHERE visibility IN ('EXTERNAL', 'INTERNAL')`,
  }),
]);

for (const scenario of driftScenarios) {
  integrationTest(`P2-002 migration 011 fails closed on ${scenario.title}`, async () => {
    await withP2002IsolatedDatabase({
      databaseUrl,
      purpose: scenario.purpose,
      run: async ({ pool }) => {
        await applyBaseMigrations(pool);
        await applyTimelineProjectionMigration({ pool });
        await pool.query(scenario.sql);
        await assert.rejects(
          applyTimelineProjectionMigration({ pool }),
          stableError(TIMELINE_ERROR_CODES.schemaDrift),
        );
      },
    });
  });
}

integrationTest('P2-002 P1 source adapter reads Channel/Intake/Ticket/Delivery facts without mutating them', async (t) => {
  await withP2002IsolatedDatabase({
    databaseUrl,
    purpose: 'sourceadapter',
    max: 4,
    run: async ({ pool, databaseName }) => {
      await applyBaseMigrations(pool);
      await applyTimelineProjectionMigration({ pool });
      await applyPilotAccessMigration({ pool });
      await applyTicketClosureMigration({ pool });
      await applyPilotOperationsMigration({ pool });
      await migrateCurrentBaseline({
        databaseUrl: databaseUrlForP2002Database(databaseUrl, databaseName),
      });

      const rawProviderMessageId = `synthetic-provider-message-${randomUUID()}`;
      const syntheticUserId = `synthetic-user-${randomUUID()}`;
      const syntheticChatId = `synthetic-chat-${randomUUID()}`;
      const adapted = adaptWeComSdkFrame({
        cmd: 'aibot_msg_callback',
        headers: { req_id: `synthetic-request-${randomUUID()}` },
        body: {
          msgid: rawProviderMessageId,
          aibotid: 'synthetic-p2-002-bot',
          chattype: 'group',
          chatid: syntheticChatId,
          from: { userid: syntheticUserId },
          msgtype: 'text',
          text: { content: 'HIS synthetic 登录失败，提示权限错误' },
        },
      }, { receivedAt: '2026-08-30 09:00:00' });
      assert.equal(adapted.ok, true);
      const ticketProcessor = createPilotTicketProcessor({
        serviceIntakeProcessor: createServiceIntakeProcessor(),
        ticketCore: createPilotTicketCore({ pool }),
      });
      const acceptedMessage = await createChannelMessageInbox({ pool }).accept({
        message: adapted.message,
        traceId: `synthetic-trace-${randomUUID()}`,
        privacyClass: 'INTERNAL',
        retentionUntil: RETENTION_UNTIL,
      }, ticketProcessor);
      assert.equal(acceptedMessage.ok, true, JSON.stringify(acceptedMessage));
      const { intake, ticket } = acceptedMessage.result;
      assert.ok(ticket);

      const syntheticTargetKey = `synthetic-target-${randomUUID()}`;
      const syntheticProviderAck = `synthetic-provider-ack-${randomUUID()}`;
      const outbox = createNotificationOutbox({
        targetsForEvent: () => [{ channel: 'WECOM_DIRECT', targetKey: syntheticTargetKey }],
      });
      const actions = createTicketActionService({
        pool,
        afterAction: (context) => outbox.enqueueTicketEvent(context),
      });
      const action = await actions.perform({
        ticketId: ticket.id,
        action: 'accept',
        actor: { type: 'PILOT_USER', id: randomUUID() },
        expectedVersion: ticket.version,
        note: 'synthetic externally visible ticket status note',
        externalVisible: true,
        traceId: `synthetic-action-${randomUUID()}`,
      });
      assert.equal(action.ok, true);
      assert.equal(action.side_effects.delivery_ids.length, 1);
      const deliveryWorker = createNotificationDeliveryWorker({
        pool,
        sender: async () => ({ ok: true, providerMessageId: syntheticProviderAck }),
      });
      const delivery = await deliveryWorker.deliver({
        deliveryId: action.side_effects.delivery_ids[0],
      });
      assert.equal(delivery.status, 'SENT');

      const sessionId = await createConversationSession(pool, 'sourceadapter', {
        serviceIntakeId: intake.id,
      });
      const snapshotsBeforeRead = await sourceFactSnapshots(pool);
      const triggersBeforeRead = await nonInternalTriggerDefinitions(pool);
      const sourceAdapter = createP1TimelineSourceAdapter({
        pool,
        projectorName: PROJECTOR_NAME,
        projectorVersion: PROJECTOR_VERSION,
      });
      const records = await sourceAdapter.readSessionRecords({ sessionId });
      const sourceRecordCounts = {
        channel_message: records.filter((record) => (
          record.source_type === 'CHANNEL_MESSAGE'
          && record.source_stream === 'channel.message_inbox'
        )).length,
        ticket_event_variants: records.filter((record) => (
          record.source_type === 'TICKET_EVENT'
          && record.source_stream === 'pilot_ticket.ticket_event'
        )).length,
        delivery: records.filter((record) => (
          record.source_type === 'DELIVERY'
          && record.source_stream === 'notification.delivery_attempt'
        )).length,
      };
      assert.equal(records.length, 4);
      assert.deepEqual(sourceRecordCounts, {
        channel_message: 1,
        ticket_event_variants: 2,
        delivery: 1,
      });
      const channelRecord = records.find((record) => (
        record.source_type === 'CHANNEL_MESSAGE'
      ));
      assert.equal(channelRecord.source_id, acceptedMessage.channelMessageId);
      const expectedTicketEventIds = (await pool.query(
        `SELECT event_id::text AS event_id
           FROM pilot_ticket.ticket_event
          WHERE ticket_id = $1::uuid
          ORDER BY event_id`,
        [ticket.id],
      )).rows.map((row) => row.event_id);
      assert.deepEqual(
        [...new Set(records.filter((record) => (
          record.source_type === 'TICKET_EVENT'
        )).map((record) => record.source_id))].sort(),
        expectedTicketEventIds,
      );
      const deliveryRecord = records.find((record) => record.source_type === 'DELIVERY');
      assert.equal(deliveryRecord.source_id, action.side_effects.delivery_ids[0]);
      assert.ok(records.every((record) => (
        record.session_id === sessionId
        && record.privacy_class === 'INTERNAL'
        && record.retention_until === RETENTION_UNTIL
      )));
      const serializedRecords = JSON.stringify(records);
      for (const forbiddenValue of [
        rawProviderMessageId,
        syntheticUserId,
        syntheticChatId,
        syntheticTargetKey,
        syntheticProviderAck,
      ]) {
        assert.equal(serializedRecords.includes(forbiddenValue), false);
      }
      assert.deepEqual(await sourceFactSnapshots(pool), snapshotsBeforeRead);
      await delay(25);
      const projectionBeforeExplicitRebuild = await pool.query(
        `SELECT
           (SELECT count(*)::integer
              FROM conversation.item
             WHERE session_id = $1::uuid) AS item_count,
           (SELECT count(*)::integer
              FROM conversation.item_source_binding
             WHERE session_id = $1::uuid) AS binding_count,
           (SELECT count(*)::integer
              FROM conversation.projection_checkpoint) AS checkpoint_count`,
        [sessionId],
      );
      assert.deepEqual(projectionBeforeExplicitRebuild.rows[0], {
        item_count: 0,
        binding_count: 0,
        checkpoint_count: 0,
      });
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), triggersBeforeRead);

      const projector = createTimelineProjector({ pool, enabled: true, batchSize: 20 });
      const rebuilt = await projector.rebuildSession({
        sessionId,
        projectorName: PROJECTOR_NAME,
        projectorVersion: PROJECTOR_VERSION,
        records,
        authorized: true,
      });
      assert.equal(rebuilt.inserted_count, records.length);
      assert.equal(rebuilt.checkpoint_updated, false);
      assert.equal((await rawSessionItems(pool, sessionId)).length, records.length);
      assert.deepEqual(await sourceFactSnapshots(pool), snapshotsBeforeRead);
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), triggersBeforeRead);
      t.diagnostic(JSON.stringify({
        source_record_count: records.length,
        channel_message_count: sourceRecordCounts.channel_message,
        ticket_event_variant_count: sourceRecordCounts.ticket_event_variants,
        delivery_count: sourceRecordCounts.delivery,
        source_snapshot_unchanged: true,
      }));
    },
  });
});

integrationTest('P2-002 real worker processes roll back before commit and replay after ACK loss', async (t) => {
  let evidence;
  await withP2002IsolatedDatabase({
    databaseUrl,
    purpose: 'processkill',
    max: 4,
    run: async ({ pool, databaseName }) => {
      await applyBaseMigrations(pool);
      await applyTimelineProjectionMigration({ pool });
      const beforeCommitSessionId = await createConversationSession(pool, 'processbeforecommit');
      const afterCommitSessionId = await createConversationSession(pool, 'processaftercommit');
      const activeWorkers = new Set();
      const launch = (options) => {
        const worker = spawnP2002WorkerProcess({ databaseName, ...options });
        activeWorkers.add(worker);
        return worker;
      };

      try {
        const beforeCommitStream = 'child.before-commit';
        const beforeCommitWorker = launch({
          sessionId: beforeCommitSessionId,
          sourceStream: beforeCommitStream,
          sourceId: 'child-before-commit-source',
          mode: 'block-before-commit',
        });
        const beforeCommitStage = await beforeCommitWorker.waitForEvent(
          'BEFORE_COMMIT_BLOCKED',
        );
        assert.equal(beforeCommitStage.event, 'BEFORE_COMMIT_BLOCKED');
        const beforeCommitExit = await beforeCommitWorker.terminate('SIGKILL');
        assertKilledWorker(beforeCommitExit);
        const beforeCommitBackendPolls = await waitForWorkerBackendClosed(
          pool,
          beforeCommitWorker.workerToken,
        );
        assert.deepEqual(
          await projectionState(pool, beforeCommitSessionId, beforeCommitStream),
          {
            item_count: 0,
            binding_count: 0,
            checkpoint_count: 0,
            cursor_value: null,
            checkpoint_row_version: null,
            checkpoint_batch_hash: null,
          },
        );
        assertCleanWorkerOutput(beforeCommitWorker);

        const beforeCommitRestart = launch({
          sessionId: beforeCommitSessionId,
          sourceStream: beforeCommitStream,
          sourceId: 'child-before-commit-source',
          mode: 'normal',
        });
        const beforeCommitRestartResult = await beforeCommitRestart.waitForEvent(
          'PROJECTION_RESULT',
        );
        assert.equal(beforeCommitRestartResult.event, 'PROJECTION_RESULT');
        assert.equal(beforeCommitRestartResult.result.inserted_count, 1);
        assert.equal(beforeCommitRestartResult.result.replayed_count, 0);
        assert.equal(beforeCommitRestartResult.result.checkpoint_updated, true);
        const beforeCommitRestartExit = await beforeCommitRestart.waitForExit();
        assert.deepEqual(beforeCommitRestartExit, { code: 0, signal: null, killed: false });
        assertCleanWorkerOutput(beforeCommitRestart);
        const beforeCommitRestartState = await projectionState(
          pool,
          beforeCommitSessionId,
          beforeCommitStream,
        );
        assert.equal(beforeCommitRestartState.item_count, 1);
        assert.equal(beforeCommitRestartState.binding_count, 1);
        assert.equal(beforeCommitRestartState.checkpoint_count, 1);
        assert.equal(beforeCommitRestartState.cursor_value, '1');
        assert.equal(beforeCommitRestartState.checkpoint_row_version, '1');
        assert.match(beforeCommitRestartState.checkpoint_batch_hash, /^[a-f0-9]{64}$/u);

        const afterCommitStream = 'child.after-commit';
        const afterCommitWorker = launch({
          sessionId: afterCommitSessionId,
          sourceStream: afterCommitStream,
          sourceId: 'child-after-commit-source',
          mode: 'block-after-commit',
        });
        const afterCommitStage = await afterCommitWorker.waitForEvent(
          'AFTER_COMMIT_BEFORE_ACK_BLOCKED',
        );
        assert.equal(afterCommitStage.event, 'AFTER_COMMIT_BEFORE_ACK_BLOCKED');
        const afterCommitExit = await afterCommitWorker.terminate('SIGKILL');
        assertKilledWorker(afterCommitExit);
        const afterCommitBackendPolls = await waitForWorkerBackendClosed(
          pool,
          afterCommitWorker.workerToken,
        );
        const committedBeforeAck = await projectionState(
          pool,
          afterCommitSessionId,
          afterCommitStream,
        );
        assert.equal(committedBeforeAck.item_count, 1);
        assert.equal(committedBeforeAck.binding_count, 1);
        assert.equal(committedBeforeAck.checkpoint_count, 1);
        assert.equal(committedBeforeAck.cursor_value, '1');
        assert.equal(committedBeforeAck.checkpoint_row_version, '1');
        assert.match(committedBeforeAck.checkpoint_batch_hash, /^[a-f0-9]{64}$/u);
        assertCleanWorkerOutput(afterCommitWorker);

        const afterCommitRestart = launch({
          sessionId: afterCommitSessionId,
          sourceStream: afterCommitStream,
          sourceId: 'child-after-commit-source',
          mode: 'normal',
        });
        const afterCommitRestartResult = await afterCommitRestart.waitForEvent(
          'PROJECTION_RESULT',
        );
        assert.equal(afterCommitRestartResult.event, 'PROJECTION_RESULT', JSON.stringify(afterCommitRestartResult));
        assert.equal(afterCommitRestartResult.result.inserted_count, 0);
        assert.equal(afterCommitRestartResult.result.replayed_count, 1);
        assert.equal(afterCommitRestartResult.result.checkpoint_updated, false);
        const afterCommitRestartExit = await afterCommitRestart.waitForExit();
        assert.deepEqual(afterCommitRestartExit, { code: 0, signal: null, killed: false });
        assertCleanWorkerOutput(afterCommitRestart);
        assert.deepEqual(
          await projectionState(pool, afterCommitSessionId, afterCommitStream),
          committedBeforeAck,
        );

        evidence = {
          before_commit_kill_exit: beforeCommitExit,
          before_commit_backend_close_polls: beforeCommitBackendPolls,
          before_commit_restart_exit: beforeCommitRestartExit,
          before_commit_restart_inserted: 1,
          after_commit_kill_exit: afterCommitExit,
          after_commit_backend_close_polls: afterCommitBackendPolls,
          after_commit_restart_exit: afterCommitRestartExit,
          after_commit_restart_replayed: 1,
          final_item_count: 1,
          final_binding_count: 1,
          final_checkpoint_cursor: '1',
        };
      } finally {
        await Promise.all([...activeWorkers].map((worker) => worker.ensureTerminated()));
      }
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

integrationTest('P2-002 stale rebuild cannot delete a source committed after snapshot preparation', async (t) => {
  let evidence;
  await withP2002IsolatedDatabase({
    databaseUrl,
    purpose: 'stalerebuild',
    max: 4,
    run: async ({ pool, databaseName }) => {
      await applyBaseMigrations(pool);
      await applyTimelineProjectionMigration({ pool });
      const sessionId = await createConversationSession(pool, 'stalerebuild');
      const sourceStream = 'ticket.stale-rebuild';
      const projector = createTimelineProjector({ pool, enabled: true, batchSize: 20 });
      const oldFirst = sourceRecord({
        sessionId,
        sourceStream,
        sourceType: 'TICKET_EVENT',
        sourceId: 'stale-rebuild-old-1',
        projectionVariant: 'STATUS',
        sourceOrdinal: '1',
        occurredAt: '2026-08-30 19:00:00',
      });
      const oldSecond = sourceRecord({
        sessionId,
        sourceStream,
        sourceType: 'TICKET_EVENT',
        sourceId: 'stale-rebuild-old-2',
        projectionVariant: 'STATUS',
        sourceOrdinal: '2',
        occurredAt: '2026-08-30 19:01:00',
      });
      const oldFullSnapshot = Object.freeze([oldFirst, oldSecond]);
      await projectBatch(projector, oldFullSnapshot);
      const checkpointBeforeRace = await projector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream,
      });
      assert.equal(checkpointBeforeRace.cursor_value, '2');

      const rebuildPool = createPostgresPool({
        connectionString: databaseUrlForP2002Database(databaseUrl, databaseName),
        max: 1,
        connectionTimeoutMillis: 2_000,
        application_name: 'p2_002_stale_rebuild',
      });
      let heldClient;
      let staleRebuildPromise;
      try {
        heldClient = await rebuildPool.connect();
        const staleProjector = createTimelineProjector({
          pool: rebuildPool,
          enabled: true,
          batchSize: 20,
        });
        staleRebuildPromise = staleProjector.rebuildSession({
          sessionId,
          projectorName: PROJECTOR_NAME,
          projectorVersion: PROJECTOR_VERSION,
          records: oldFullSnapshot,
          authorized: true,
        });
        const connectionWaitPolls = await waitForPoolWaiter(rebuildPool);

        const newlyCommitted = sourceRecord({
          sessionId,
          sourceStream,
          sourceType: 'TICKET_EVENT',
          sourceId: 'stale-rebuild-new-3',
          projectionVariant: 'STATUS',
          sourceOrdinal: '3',
          occurredAt: '2026-08-30 19:02:00',
        });
        const newProjection = await projectOne(projector, newlyCommitted);
        assert.equal(newProjection.inserted_count, 1);
        assert.equal(newProjection.checkpoint_updated, true);
        const rowsAfterNewCommit = await rawSessionItems(pool, sessionId);
        const bindingsAfterNewCommit = await bindingSnapshot(pool, sessionId);
        const checkpointAfterNewCommit = await projector.getProjectionCheckpoint({
          projectorName: PROJECTOR_NAME,
          sourceStream,
        });
        assert.equal(rowsAfterNewCommit.length, 3);
        assert.equal(bindingsAfterNewCommit.length, 3);
        assert.equal(checkpointAfterNewCommit.cursor_value, '3');
        assert.ok(BigInt(checkpointAfterNewCommit.row_version) > BigInt(
          checkpointBeforeRace.row_version,
        ));

        heldClient.release();
        heldClient = null;
        await assert.rejects(
          staleRebuildPromise,
          stableError(TIMELINE_ERROR_CODES.rebuildFailed),
        );
        assert.deepEqual(await rawSessionItems(pool, sessionId), rowsAfterNewCommit);
        assert.deepEqual(await bindingSnapshot(pool, sessionId), bindingsAfterNewCommit);
        assert.deepEqual(await projector.getProjectionCheckpoint({
          projectorName: PROJECTOR_NAME,
          sourceStream,
        }), checkpointAfterNewCommit);

        const currentFullSnapshot = [oldSecond, newlyCommitted, oldFirst];
        const expectedHash = computeTimelineCanonicalHash(currentFullSnapshot);
        const successfulRebuild = await projector.rebuildSession({
          sessionId,
          projectorName: PROJECTOR_NAME,
          projectorVersion: PROJECTOR_VERSION,
          records: currentFullSnapshot,
          authorized: true,
        });
        assert.equal(successfulRebuild.inserted_count, 3);
        assert.equal(successfulRebuild.checkpoint_updated, false);
        assert.equal(successfulRebuild.canonical_hash, expectedHash);
        const rebuiltRows = await rawSessionItems(pool, sessionId);
        assert.deepEqual(
          rebuiltRows.map((row) => [row.sequence_no, row.source_id]),
          [
            ['1', 'stale-rebuild-old-1'],
            ['2', 'stale-rebuild-old-2'],
            ['3', 'stale-rebuild-new-3'],
          ],
        );
        assert.equal(computeTimelineCanonicalHash(rebuiltRows), expectedHash);
        assert.deepEqual(await projector.getProjectionCheckpoint({
          projectorName: PROJECTOR_NAME,
          sourceStream,
        }), checkpointAfterNewCommit);
        evidence = {
          connection_wait_polls: connectionWaitPolls,
          stale_rebuild_error: TIMELINE_ERROR_CODES.rebuildFailed,
          preserved_item_count: rowsAfterNewCommit.length,
          preserved_binding_count: bindingsAfterNewCommit.length,
          preserved_checkpoint_cursor: checkpointAfterNewCommit.cursor_value,
          full_rebuild_item_count: rebuiltRows.length,
          full_rebuild_hash: expectedHash,
        };
      } finally {
        if (heldClient) {
          heldClient.release();
        }
        if (staleRebuildPromise) {
          await staleRebuildPromise.catch(() => {});
        }
        await rebuildPool.end();
      }
    },
  });
  t.diagnostic(JSON.stringify({ ...evidence, temp_database_cleanup: true }));
});

integrationTest('P2-002 projector is idempotent, concurrent, transactional, rebuildable, private, and restart safe', async (t) => {
  await withP2002IsolatedDatabase({
    databaseUrl,
    purpose: 'runtime',
    max: 8,
    run: async ({ pool }) => {
      await applyBaseMigrations(pool);
      await applyTimelineProjectionMigration({ pool });
      const sourceFactsBefore = await sourceFactCounts(pool);
      const triggersBefore = await nonInternalTriggerDefinitions(pool);
      const projector = createTimelineProjector({ pool, enabled: true, batchSize: 200 });

      const oneSessionId = await createConversationSession(pool, 'one');
      const one = sourceRecord({
        sessionId: oneSessionId,
        sourceStream: 'channel.one',
        sourceId: 'internal-channel-row-one',
        text: 'synthetic external message',
      });
      const first = await projectOne(projector, one);
      assert.equal(first.received_count, 1);
      assert.equal(first.inserted_count, 1);
      assert.equal(first.replayed_count, 0);
      assert.equal(first.conflict_count, 0);
      assert.equal(first.session_count, 1);
      assert.equal(first.checkpoint_updated, true);
      assert.match(first.batch_hash, /^[a-f0-9]{64}$/u);

      let oneRows = await rawSessionItems(pool, oneSessionId);
      assert.equal(oneRows.length, 1);
      assert.equal(oneRows[0].sequence_no, '1');
      assert.equal(oneRows[0].source_id, one.source_id);
      const bindingCount = await pool.query(
        `SELECT count(*)::integer AS count
           FROM conversation.item_source_binding
          WHERE session_id = $1::uuid`,
        [oneSessionId],
      );
      assert.equal(bindingCount.rows[0].count, 1);

      const replay = await projectOne(projector, one);
      assert.equal(replay.inserted_count, 0);
      assert.equal(replay.replayed_count, 1);
      assert.equal(replay.checkpoint_updated, false);
      assert.equal((await rawSessionItems(pool, oneSessionId)).length, 1);

      const conflicting = sourceRecord({
        sessionId: oneSessionId,
        sourceStream: one.source_stream,
        sourceId: one.source_id,
        text: 'synthetic conflicting revision',
      });
      assert.notEqual(conflicting.source_hash, one.source_hash);
      await assert.rejects(
        projectOne(projector, conflicting),
        stableError(TIMELINE_ERROR_CODES.sourceConflict),
      );
      assert.equal((await rawSessionItems(pool, oneSessionId)).length, 1);

      const tightened = sourceRecord({
        sessionId: oneSessionId,
        sourceStream: one.source_stream,
        sourceId: one.source_id,
        text: one.text,
        privacyClass: 'SECRET',
        retentionUntil: '2026-09-30 08:00:00',
      });
      assert.equal(tightened.source_hash, one.source_hash);
      const tightenedReplay = await projectOne(projector, tightened, { cursorValue: '2' });
      assert.equal(tightenedReplay.inserted_count, 0);
      assert.equal(tightenedReplay.replayed_count, 1);
      oneRows = await rawSessionItems(pool, oneSessionId);
      assert.equal(oneRows[0].privacy_class, 'SECRET');
      assert.equal(oneRows[0].retention_until, '2026-09-30 08:00:00');

      const ticketSessionId = await createConversationSession(pool, 'ticketvariants');
      const ticketExternal = sourceRecord({
        sessionId: ticketSessionId,
        sourceStream: 'ticket.events',
        sourceType: 'TICKET_EVENT',
        sourceId: 'internal-ticket-event-one',
        projectionVariant: 'EXTERNAL_NOTE',
        sourceOrdinal: '7',
        text: 'synthetic external ticket note',
        visibility: 'EXTERNAL',
      });
      const ticketInternal = sourceRecord({
        sessionId: ticketSessionId,
        sourceStream: 'ticket.events',
        sourceType: 'TICKET_EVENT',
        sourceId: 'internal-ticket-event-one',
        projectionVariant: 'INTERNAL_NOTE',
        sourceOrdinal: '7',
        text: 'synthetic internal ticket note',
        visibility: 'INTERNAL',
      });
      const ticketStats = await projectBatch(projector, [ticketInternal, ticketExternal]);
      assert.equal(ticketStats.inserted_count, 2);
      const ticketRows = await rawSessionItems(pool, ticketSessionId);
      assert.deepEqual(
        ticketRows.map((row) => [row.projection_variant, row.visibility, row.text]),
        [
          ['EXTERNAL_NOTE', 'EXTERNAL', 'synthetic external ticket note'],
          ['INTERNAL_NOTE', 'INTERNAL', 'synthetic internal ticket note'],
        ],
      );
      assert.equal(new Set(ticketRows.map((row) => row.id)).size, 2);

      const sameConcurrentSessionId = await createConversationSession(pool, 'sameconcurrent');
      const sameConcurrent = sourceRecord({
        sessionId: sameConcurrentSessionId,
        sourceStream: 'channel.concurrent.same',
        sourceId: 'same-source-for-twelve-workers',
      });
      const sameConcurrentResults = await Promise.all(
        Array.from({ length: 12 }, () => projectOne(projector, sameConcurrent)),
      );
      assert.equal(
        sameConcurrentResults.reduce((sum, result) => sum + result.inserted_count, 0),
        1,
      );
      assert.equal(
        sameConcurrentResults.reduce((sum, result) => sum + result.replayed_count, 0),
        11,
      );
      assert.equal((await rawSessionItems(pool, sameConcurrentSessionId)).length, 1);

      const differentConcurrentSessionId = await createConversationSession(pool, 'differentconcurrent');
      const sameOccurredAt = '2026-08-30 10:00:00';
      const differentConcurrent = Array.from({ length: 12 }, (_, index) => sourceRecord({
        sessionId: differentConcurrentSessionId,
        sourceStream: 'channel.concurrent.different',
        sourceId: `different-source-${String(index + 1).padStart(2, '0')}`,
        sourceOrdinal: String(index + 1),
        occurredAt: sameOccurredAt,
      }));
      const differentConcurrentResults = await Promise.all(
        differentConcurrent.map((record) => projectOne(projector, record)),
      );
      assert.equal(
        differentConcurrentResults.reduce((sum, result) => sum + result.inserted_count, 0),
        12,
      );
      const differentConcurrentRows = await rawSessionItems(pool, differentConcurrentSessionId);
      assert.deepEqual(
        differentConcurrentRows.map((row) => row.sequence_no),
        Array.from({ length: 12 }, (_, index) => String(index + 1)),
      );
      assert.equal(new Set(differentConcurrentRows.map((row) => row.sequence_no)).size, 12);
      assert.deepEqual(
        differentConcurrentRows.map((row) => row.source_id),
        differentConcurrent.map((record) => record.source_id),
      );

      const rankSessionId = await createConversationSession(pool, 'sametimerank');
      const sourceTypesByRank = [
        'CHANNEL_MESSAGE',
        'COMMUNICATION_MESSAGE',
        'TICKET_EVENT',
        'DELIVERY',
        'HANDOFF_EVENT',
      ];
      const rankRecords = sourceTypesByRank.map((sourceType) => sourceRecord({
        sessionId: rankSessionId,
        sourceStream: 'timeline.same-time-rank',
        sourceType,
        sourceId: 'same-time-source',
        projectionVariant: `RANK_${sourceType}`,
        occurredAt: sameOccurredAt,
        sourceOrdinal: '1',
      }));
      await projectBatch(projector, [...rankRecords].reverse());
      assert.deepEqual(
        (await rawSessionItems(pool, rankSessionId)).map((row) => row.source_type),
        sourceTypesByRank,
      );

      const isolatedSessionA = await createConversationSession(pool, 'isolateda');
      const isolatedSessionB = await createConversationSession(pool, 'isolatedb');
      const isolatedRecords = [
        sourceRecord({
          sessionId: isolatedSessionA,
          sourceStream: 'channel.multi-session',
          sourceId: 'multi-session-a',
        }),
        sourceRecord({
          sessionId: isolatedSessionB,
          sourceStream: 'channel.multi-session',
          sourceId: 'multi-session-b',
        }),
      ];
      const isolatedStats = await projectBatch(projector, isolatedRecords);
      assert.equal(isolatedStats.session_count, 2);
      assert.deepEqual(
        (await rawSessionItems(pool, isolatedSessionA)).map((row) => row.source_id),
        ['multi-session-a'],
      );
      assert.deepEqual(
        (await rawSessionItems(pool, isolatedSessionB)).map((row) => row.source_id),
        ['multi-session-b'],
      );

      const missingSessionStream = 'channel.missing-session';
      const missingSessionRecord = sourceRecord({
        sessionId: randomUUID(),
        sourceStream: missingSessionStream,
        sourceId: 'missing-session-source',
      });
      await assert.rejects(
        projectOne(projector, missingSessionRecord),
        stableError(TIMELINE_ERROR_CODES.sessionNotFound),
      );
      assert.equal(await projector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: missingSessionStream,
      }), null);

      const rollbackSessionId = await createConversationSession(pool, 'rollback');
      const rollbackRecord = sourceRecord({
        sessionId: rollbackSessionId,
        sourceStream: 'channel.rollback',
        sourceId: 'rollback-source',
      });
      const rollbackProjector = createTimelineProjector({
        pool,
        enabled: true,
        faultInjection: {
          beforeCommit: async () => {
            throw new Error('synthetic private pre-commit failure token');
          },
        },
      });
      await assert.rejects(
        projectOne(rollbackProjector, rollbackRecord),
        stableError(TIMELINE_ERROR_CODES.storageFailed, /private pre-commit failure token/iu),
      );
      const rollbackCounts = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM conversation.item
             WHERE session_id = $1::uuid) AS item_count,
           (SELECT count(*)::integer FROM conversation.item_source_binding
             WHERE session_id = $1::uuid) AS binding_count,
           (SELECT count(*)::integer FROM conversation.projection_checkpoint
             WHERE projector_name = $2 AND source_stream = $3) AS checkpoint_count`,
        [rollbackSessionId, PROJECTOR_NAME, rollbackRecord.source_stream],
      );
      assert.deepEqual(rollbackCounts.rows[0], {
        item_count: 0,
        binding_count: 0,
        checkpoint_count: 0,
      });
      assert.equal((await projectOne(projector, rollbackRecord)).inserted_count, 1);

      const ackSessionId = await createConversationSession(pool, 'ackloss');
      const ackRecord = sourceRecord({
        sessionId: ackSessionId,
        sourceStream: 'channel.ack-loss',
        sourceId: 'ack-loss-source',
      });
      const ackLossProjector = createTimelineProjector({
        pool,
        enabled: true,
        faultInjection: {
          afterCommit: async () => {
            throw new Error('synthetic private post-commit ACK failure token');
          },
        },
      });
      await assert.rejects(
        projectOne(ackLossProjector, ackRecord),
        stableError(TIMELINE_ERROR_CODES.storageFailed, /private post-commit ACK failure token/iu),
      );
      const committedWithoutAck = await pool.query(
        `SELECT
           (SELECT count(*)::integer FROM conversation.item
             WHERE session_id = $1::uuid) AS item_count,
           (SELECT count(*)::integer FROM conversation.item_source_binding
             WHERE session_id = $1::uuid) AS binding_count,
           (SELECT count(*)::integer FROM conversation.projection_checkpoint
             WHERE projector_name = $2 AND source_stream = $3) AS checkpoint_count`,
        [ackSessionId, PROJECTOR_NAME, ackRecord.source_stream],
      );
      assert.deepEqual(committedWithoutAck.rows[0], {
        item_count: 1,
        binding_count: 1,
        checkpoint_count: 1,
      });
      const restartedProjector = createTimelineProjector({ pool, enabled: true, batchSize: 200 });
      const ackReplay = await projectOne(restartedProjector, ackRecord);
      assert.equal(ackReplay.inserted_count, 0);
      assert.equal(ackReplay.replayed_count, 1);
      assert.equal((await rawSessionItems(pool, ackSessionId)).length, 1);

      const rewound = await pool.query(
        `UPDATE conversation.projection_checkpoint
            SET cursor_value = '0', row_version = row_version + 1
          WHERE projector_name = $1 AND source_stream = $2
          RETURNING row_version::text`,
        [PROJECTOR_NAME, ackRecord.source_stream],
      );
      assert.equal(rewound.rowCount, 1);
      const replayAfterRewind = await projectOne(restartedProjector, ackRecord);
      assert.equal(replayAfterRewind.inserted_count, 0);
      assert.equal(replayAfterRewind.replayed_count, 1);
      assert.equal((await rawSessionItems(pool, ackSessionId)).length, 1);
      const recoveredCheckpoint = await restartedProjector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: ackRecord.source_stream,
      });
      assert.equal(recoveredCheckpoint.cursor_value, '1');

      const checkpointConflictRecord = sourceRecord({
        sessionId: ackSessionId,
        sourceStream: ackRecord.source_stream,
        sourceId: 'checkpoint-conflict-source',
        sourceOrdinal: '2',
        occurredAt: '2026-08-30 09:00:01',
      });
      await assert.rejects(
        projectOne(restartedProjector, checkpointConflictRecord, {
          expectedCheckpoint: { rowVersion: '999999' },
        }),
        stableError(TIMELINE_ERROR_CODES.checkpointConflict),
      );
      assert.equal((await rawSessionItems(pool, ackSessionId)).length, 1);
      assert.equal((await projectOne(restartedProjector, checkpointConflictRecord)).inserted_count, 1);

      const rebuildSessionId = await createConversationSession(pool, 'rebuild');
      const later = sourceRecord({
        sessionId: rebuildSessionId,
        sourceStream: 'ticket.rebuild',
        sourceType: 'TICKET_EVENT',
        sourceId: 'later-ticket-event',
        projectionVariant: 'STATUS',
        sourceOrdinal: '2',
        occurredAt: '2026-08-30 12:00:00',
      });
      const earlier = sourceRecord({
        sessionId: rebuildSessionId,
        sourceStream: 'ticket.rebuild',
        sourceType: 'TICKET_EVENT',
        sourceId: 'earlier-ticket-event',
        projectionVariant: 'STATUS',
        sourceOrdinal: '1',
        occurredAt: '2026-08-30 11:00:00',
      });
      await projectOne(projector, later);
      const checkpointBeforeOutOfOrder = await projector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: later.source_stream,
      });
      await assert.rejects(
        projectOne(projector, earlier),
        stableError(TIMELINE_ERROR_CODES.rebuildRequired),
      );
      assert.deepEqual(
        (await rawSessionItems(pool, rebuildSessionId)).map((row) => row.source_id),
        ['later-ticket-event'],
      );
      assert.deepEqual(await projector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: later.source_stream,
      }), checkpointBeforeOutOfOrder);

      const expectedCanonicalHash = computeTimelineCanonicalHash([earlier, later]);
      const rebuilt = await projector.rebuildSession({
        sessionId: rebuildSessionId,
        projectorName: PROJECTOR_NAME,
        projectorVersion: PROJECTOR_VERSION,
        records: [later, earlier],
        authorized: true,
      });
      assert.equal(rebuilt.inserted_count, 2);
      assert.equal(rebuilt.canonical_hash, expectedCanonicalHash);
      assert.equal(rebuilt.checkpoint_updated, false);
      assert.deepEqual(await projector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: later.source_stream,
      }), checkpointBeforeOutOfOrder);
      let rebuiltRows = await rawSessionItems(pool, rebuildSessionId);
      assert.deepEqual(
        rebuiltRows.map((row) => [row.sequence_no, row.source_id]),
        [
          ['1', 'earlier-ticket-event'],
          ['2', 'later-ticket-event'],
        ],
      );
      assert.equal(computeTimelineCanonicalHash(rebuiltRows), expectedCanonicalHash);

      const rebuiltAgain = await projector.rebuildSession({
        sessionId: rebuildSessionId,
        projectorName: PROJECTOR_NAME,
        projectorVersion: PROJECTOR_VERSION,
        records: [earlier, later],
        authorized: true,
      });
      assert.equal(rebuiltAgain.canonical_hash, rebuilt.canonical_hash);
      assert.equal(rebuiltAgain.checkpoint_updated, false);
      assert.deepEqual(await projector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: later.source_stream,
      }), checkpointBeforeOutOfOrder);
      rebuiltRows = await rawSessionItems(pool, rebuildSessionId);
      assert.equal(computeTimelineCanonicalHash(rebuiltRows), expectedCanonicalHash);

      const rowsBeforeFailedRebuild = rebuiltRows;
      const checkpointBeforeFailedRebuild = await projector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: later.source_stream,
      });
      const failingRebuildProjector = createTimelineProjector({
        pool,
        enabled: true,
        faultInjection: {
          beforeCommit: async () => {
            throw new Error('synthetic rebuild transaction failure');
          },
        },
      });
      await assert.rejects(
        failingRebuildProjector.rebuildSession({
          sessionId: rebuildSessionId,
          projectorName: PROJECTOR_NAME,
          projectorVersion: PROJECTOR_VERSION,
          records: [later, earlier],
          authorized: true,
        }),
        stableError(TIMELINE_ERROR_CODES.rebuildFailed),
      );
      assert.deepEqual(await rawSessionItems(pool, rebuildSessionId), rowsBeforeFailedRebuild);
      assert.deepEqual(await projector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: later.source_stream,
      }), checkpointBeforeFailedRebuild);

      const visibilitySessionId = await createConversationSession(pool, 'visibility');
      const visibilityRecords = [
        sourceRecord({
          sessionId: visibilitySessionId,
          sourceStream: 'timeline.visibility',
          sourceId: 'visible-external',
          sourceOrdinal: '1',
          text: 'synthetic external visible text',
          visibility: 'EXTERNAL',
        }),
        sourceRecord({
          sessionId: visibilitySessionId,
          sourceStream: 'timeline.visibility',
          sourceType: 'TICKET_EVENT',
          sourceId: 'visible-internal',
          projectionVariant: 'INTERNAL_NOTE',
          sourceOrdinal: '2',
          text: 'synthetic internal-only note',
          visibility: 'INTERNAL',
        }),
        sourceRecord({
          sessionId: visibilitySessionId,
          sourceStream: 'timeline.visibility',
          sourceType: 'HANDOFF_EVENT',
          sourceId: 'visible-restricted',
          projectionVariant: 'RESTRICTED_AUDIT',
          sourceOrdinal: '3',
          text: 'synthetic restricted-only note',
          visibility: 'RESTRICTED',
        }),
      ];
      await projectBatch(projector, visibilityRecords);
      const externalPage = await projector.listTimelineItems({
        sessionId: visibilitySessionId,
        audience: 'EXTERNAL',
      });
      assert.deepEqual(externalPage.items.map((item) => item.source_id), ['visible-external']);
      assert.doesNotMatch(JSON.stringify(externalPage), /internal-only|restricted-only/iu);

      const workbenchPage = await projector.listTimelineItems({
        sessionId: visibilitySessionId,
        audience: 'WORKBENCH',
      });
      assert.deepEqual(
        workbenchPage.items.map((item) => item.source_id),
        ['visible-external', 'visible-internal'],
      );
      assert.doesNotMatch(JSON.stringify(workbenchPage), /restricted-only/iu);
      await assert.rejects(
        projector.listTimelineItems({
          sessionId: visibilitySessionId,
          audience: 'RESTRICTED_ADMIN',
        }),
        stableError(TIMELINE_ERROR_CODES.rebuildNotAuthorized),
      );

      let restrictedAuthorizationCalls = 0;
      const restrictedProjector = createTimelineProjector({
        pool,
        enabled: true,
        restrictedAuthorizer: async ({ sessionId, audience }) => {
          restrictedAuthorizationCalls += 1;
          return sessionId === visibilitySessionId && audience === 'RESTRICTED_ADMIN';
        },
      });
      const restrictedPage = await restrictedProjector.listTimelineItems({
        sessionId: visibilitySessionId,
        audience: 'RESTRICTED_ADMIN',
        restrictedAuthorized: true,
      });
      assert.equal(restrictedAuthorizationCalls, 1);
      assert.deepEqual(
        restrictedPage.items.map((item) => item.source_id),
        ['visible-external', 'visible-internal', 'visible-restricted'],
      );

      const bulkSessionId = await createConversationSession(pool, 'bulk');
      const bulkStream = 'channel.bulk-worker';
      const totalBulkRecords = 2_001;
      let maximumRequestedLimit = 0;
      let maximumReturnedRecords = 0;
      let peakHeapBytes = process.memoryUsage().heapUsed;
      const startingHeapBytes = peakHeapBytes;
      const bulkHeapSamples = [];
      let bulkAdapterReadCalls = 0;
      const bulkAdapter = {
        sourceStream: bulkStream,
        async readBatch({ cursorValue, limit, signal }) {
          assert.notEqual(signal?.aborted, true);
          bulkAdapterReadCalls += 1;
          maximumRequestedLimit = Math.max(maximumRequestedLimit, limit);
          const firstOrdinal = Number(cursorValue ?? 0) + 1;
          if (firstOrdinal > totalBulkRecords) {
            return { records: [], cursor_value: String(totalBulkRecords), done: true };
          }
          const lastOrdinal = Math.min(firstOrdinal + limit - 1, totalBulkRecords);
          const records = [];
          for (let ordinal = firstOrdinal; ordinal <= lastOrdinal; ordinal += 1) {
            records.push(sourceRecord({
              sessionId: bulkSessionId,
              sourceStream: bulkStream,
              sourceId: `bulk-source-${String(ordinal).padStart(4, '0')}`,
              sourceOrdinal: String(ordinal),
              occurredAt: '2026-08-30 16:00:00',
              text: `synthetic bulk item ${ordinal}`,
            }));
          }
          maximumReturnedRecords = Math.max(maximumReturnedRecords, records.length);
          const sampledHeapBytes = process.memoryUsage().heapUsed;
          bulkHeapSamples.push(sampledHeapBytes);
          peakHeapBytes = Math.max(peakHeapBytes, sampledHeapBytes);
          return {
            records,
            cursor_value: String(lastOrdinal),
            done: lastOrdinal === totalBulkRecords,
          };
        },
      };
      const firstBulkProjector = createTimelineProjector({
        pool,
        enabled: true,
        batchSize: 20,
      });
      const firstBulkWorker = createTimelineProjectorWorker({
        sourceAdapter: bulkAdapter,
        projector: firstBulkProjector,
        batchSize: 20,
      });
      const firstBulkBatch = await firstBulkWorker.runOnce({
        projectorName: PROJECTOR_NAME,
        projectorVersion: PROJECTOR_VERSION,
        sourceStream: bulkStream,
      });
      assert.equal(firstBulkBatch.stats.inserted_count, 20);
      assert.equal(firstBulkBatch.cursor_value, '20');
      const checkpointAtBulkInterruption = await firstBulkProjector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: bulkStream,
      });
      assert.equal(checkpointAtBulkInterruption.cursor_value, '20');

      const interruptedRun = new AbortController();
      interruptedRun.abort();
      await assert.rejects(
        firstBulkWorker.run({
          projectorName: PROJECTOR_NAME,
          projectorVersion: PROJECTOR_VERSION,
          sourceStream: bulkStream,
          cursorValue: firstBulkBatch.cursor_value,
          signal: interruptedRun.signal,
        }),
        stableError(TIMELINE_ERROR_CODES.storageFailed),
      );
      assert.deepEqual(await firstBulkProjector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: bulkStream,
      }), checkpointAtBulkInterruption);
      assert.equal((await rawSessionItems(pool, bulkSessionId)).length, 20);

      const restartedBulkProjector = createTimelineProjector({
        pool,
        enabled: true,
        batchSize: 20,
      });
      const restartedBulkWorker = createTimelineProjectorWorker({
        sourceAdapter: bulkAdapter,
        projector: restartedBulkProjector,
        batchSize: 20,
      });
      const remainingBulk = await restartedBulkWorker.run({
        projectorName: PROJECTOR_NAME,
        projectorVersion: PROJECTOR_VERSION,
        sourceStream: bulkStream,
        cursorValue: firstBulkBatch.cursor_value,
      });
      assert.equal(remainingBulk.batch_count, 100);
      assert.equal(remainingBulk.received_count, totalBulkRecords - 20);
      assert.equal(remainingBulk.inserted_count, totalBulkRecords - 20);
      assert.equal(remainingBulk.replayed_count, 0);
      assert.equal(remainingBulk.cursor_value, String(totalBulkRecords));
      assert.ok(maximumRequestedLimit <= 20);
      assert.ok(maximumReturnedRecords <= 20);
      assert.equal(bulkAdapterReadCalls, 101);
      assert.equal(bulkHeapSamples.length, 101);
      assert.ok(peakHeapBytes - startingHeapBytes < 256 * 1024 * 1024);
      const heapSegmentSize = Math.ceil(bulkHeapSamples.length / 4);
      const heapSegmentMeans = [];
      for (let offset = 0; offset < bulkHeapSamples.length; offset += heapSegmentSize) {
        const segment = bulkHeapSamples.slice(offset, offset + heapSegmentSize);
        heapSegmentMeans.push(Math.round(
          segment.reduce((sum, value) => sum + value, 0) / segment.length,
        ));
      }
      assert.equal(heapSegmentMeans.length, 4);
      const firstToLastHeapTrendBytes = Math.max(
        0,
        heapSegmentMeans.at(-1) - heapSegmentMeans[0],
      );
      const maximumAdjacentHeapTrendBytes = Math.max(
        0,
        ...heapSegmentMeans.slice(1).map((mean, index) => (
          mean - heapSegmentMeans[index]
        )),
      );
      assert.ok(firstToLastHeapTrendBytes < 128 * 1024 * 1024);
      assert.ok(maximumAdjacentHeapTrendBytes < 128 * 1024 * 1024);

      const bulkFacts = await pool.query(
        `SELECT count(*)::integer AS item_count,
                count(DISTINCT sequence_no)::integer AS unique_sequence_count,
                min(sequence_no)::text AS first_sequence,
                max(sequence_no)::text AS last_sequence
           FROM conversation.item
          WHERE session_id = $1::uuid`,
        [bulkSessionId],
      );
      assert.deepEqual(bulkFacts.rows[0], {
        item_count: totalBulkRecords,
        unique_sequence_count: totalBulkRecords,
        first_sequence: '1',
        last_sequence: String(totalBulkRecords),
      });
      const bulkCheckpoint = await restartedBulkProjector.getProjectionCheckpoint({
        projectorName: PROJECTOR_NAME,
        sourceStream: bulkStream,
      });
      assert.equal(bulkCheckpoint.cursor_value, String(totalBulkRecords));

      assert.deepEqual(await sourceFactCounts(pool), sourceFactsBefore);
      assert.deepEqual(await nonInternalTriggerDefinitions(pool), triggersBefore);
      t.diagnostic(JSON.stringify({
        same_source_concurrency: 12,
        different_source_concurrency: 12,
        bulk_item_count: totalBulkRecords,
        bulk_batch_count: 101,
        bulk_max_batch_size: maximumReturnedRecords,
        bulk_peak_heap_delta_bytes: peakHeapBytes - startingHeapBytes,
        bulk_heap_sample_count: bulkHeapSamples.length,
        bulk_heap_segment_means_bytes: heapSegmentMeans,
        bulk_first_to_last_heap_trend_bytes: firstToLastHeapTrendBytes,
        bulk_max_adjacent_heap_trend_bytes: maximumAdjacentHeapTrendBytes,
        bulk_interrupted_at_cursor: checkpointAtBulkInterruption.cursor_value,
        bulk_restart_remaining_items: remainingBulk.inserted_count,
        rebuild_canonical_hash: expectedCanonicalHash,
        temp_database_cleanup: 'verified-by-finally',
      }));
    },
  });
});

integrationTest('P2-002 suite leaves no random database or worker backend residual', async (t) => {
  const adminPool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  try {
    const residual = await adminPool.query(
      `SELECT
         (SELECT count(*)::integer
            FROM pg_database
           WHERE datname ~ '^p2_002_') AS temp_database_count,
         (SELECT count(*)::integer
            FROM pg_stat_activity
           WHERE application_name ~ '^p2_002_(child_|stale_rebuild)')
           AS worker_backend_count`,
    );
    assert.deepEqual(residual.rows[0], {
      temp_database_count: 0,
      worker_backend_count: 0,
    });
    t.diagnostic(JSON.stringify({
      ...residual.rows[0],
      isolated_source_data_residual: 0,
      isolated_projection_schema_residual: 0,
    }));
  } finally {
    await adminPool.end();
  }
});
