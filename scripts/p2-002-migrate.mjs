import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { stopLegacyMigrationAfterArch005 } from '../src/platform/legacy-migration-guard.mjs';

const migrationNames = Object.freeze([
  '011_p2_002_timeline_projector',
]);

const relationNames = Object.freeze([
  'conversation.item',
  'conversation.item_source_binding',
  'conversation.projection_checkpoint',
]);

const dependencyRelations = Object.freeze([
  ['conversation', 'session'],
  ['channel', 'message_inbox'],
  ['intake', 'service_intake_message'],
  ['intake', 'service_intake'],
  ['pilot_ticket', 'ticket_event'],
  ['pilot_ticket', 'ticket'],
  ['notification', 'delivery_attempt'],
  ['notification', 'delivery'],
  ['notification', 'outbox'],
]);

const dependencyColumns = Object.freeze([
  ['conversation', 'session', 'id', 'uuid', true],
  ['conversation', 'session', 'service_intake_id', 'uuid', false],
  ['channel', 'message_inbox', 'id', 'bigint', true],
  ['channel', 'message_inbox', 'msg_type', 'text', true],
  ['channel', 'message_inbox', 'clean_text', 'text', false],
  ['channel', 'message_inbox', 'received_at', 'timestamp with time zone', true],
  ['channel', 'message_inbox', 'privacy_class', 'text', true],
  ['channel', 'message_inbox', 'retention_until', 'timestamp with time zone', true],
  ['intake', 'service_intake_message', 'intake_id', 'uuid', true],
  ['intake', 'service_intake_message', 'channel_message_id', 'bigint', true],
  ['intake', 'service_intake_message', 'relation_type', 'text', true],
  ['intake', 'service_intake_message', 'sequence_no', 'integer', true],
  ['intake', 'service_intake', 'id', 'uuid', true],
  ['intake', 'service_intake', 'privacy_class', 'text', true],
  ['intake', 'service_intake', 'retention_until', 'timestamp with time zone', true],
  ['pilot_ticket', 'ticket_event', 'event_id', 'uuid', true],
  ['pilot_ticket', 'ticket_event', 'ticket_id', 'uuid', true],
  ['pilot_ticket', 'ticket_event', 'event_type', 'text', true],
  ['pilot_ticket', 'ticket_event', 'old_status', 'text', false],
  ['pilot_ticket', 'ticket_event', 'new_status', 'text', true],
  ['pilot_ticket', 'ticket_event', 'aggregate_version', 'integer', true],
  ['pilot_ticket', 'ticket_event', 'event_ordinal', 'integer', true],
  ['pilot_ticket', 'ticket_event', 'internal_note', 'text', false],
  ['pilot_ticket', 'ticket_event', 'external_note', 'text', false],
  ['pilot_ticket', 'ticket_event', 'reason_code', 'text', false],
  ['pilot_ticket', 'ticket_event', 'created_at', 'timestamp with time zone', true],
  ['pilot_ticket', 'ticket', 'id', 'uuid', true],
  ['pilot_ticket', 'ticket', 'source_intake_id', 'uuid', true],
  ['notification', 'delivery_attempt', 'id', 'uuid', true],
  ['notification', 'delivery_attempt', 'delivery_id', 'uuid', true],
  ['notification', 'delivery_attempt', 'attempt_no', 'integer', true],
  ['notification', 'delivery_attempt', 'outcome', 'text', true],
  ['notification', 'delivery_attempt', 'error_code', 'text', false],
  ['notification', 'delivery_attempt', 'occurred_at', 'timestamp with time zone', true],
  ['notification', 'delivery', 'id', 'uuid', true],
  ['notification', 'delivery', 'outbox_id', 'uuid', true],
  ['notification', 'delivery', 'channel', 'text', true],
  ['notification', 'outbox', 'id', 'uuid', true],
  ['notification', 'outbox', 'ticket_id', 'uuid', true],
]);

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function parseArguments(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--migrate')) {
    return Object.freeze({ mode: 'migrate' });
  }
  if (argv.length === 1 && argv[0] === '--check') {
    return Object.freeze({ mode: 'check' });
  }
  return null;
}

function migrationBodyForCheck(sql) {
  const match = /^\uFEFF?\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(sql);
  if (match === null) {
    throw new Error('P2_002_MIGRATION_FILE_INVALID');
  }
  return match[1];
}

async function assertReadOnlyDependencyContract(queryable) {
  const result = await queryable.query(`
    WITH expected_relation AS (
      SELECT contract.schema_name, contract.relation_name
        FROM jsonb_to_recordset($1::jsonb)
          AS contract(schema_name TEXT, relation_name TEXT)
    ),
    expected_column AS (
      SELECT contract.schema_name, contract.relation_name,
             contract.column_name, contract.data_type,
             contract.is_not_null
        FROM jsonb_to_recordset($2::jsonb)
          AS contract(
            schema_name TEXT,
            relation_name TEXT,
            column_name TEXT,
            data_type TEXT,
            is_not_null BOOLEAN
          )
    )
    SELECT
      EXISTS (
        SELECT 1
          FROM pg_proc AS procedure_record
         WHERE procedure_record.oid = to_regprocedure('uuidv7()')
           AND procedure_record.prokind = 'f'
           AND procedure_record.prorettype = 'uuid'::regtype
           AND NOT procedure_record.proretset
      )
      AND NOT EXISTS (
        SELECT 1
          FROM expected_relation AS expected
          LEFT JOIN pg_namespace AS namespace_record
            ON namespace_record.nspname = expected.schema_name
          LEFT JOIN pg_class AS relation_record
            ON relation_record.relnamespace = namespace_record.oid
           AND relation_record.relname = expected.relation_name
         WHERE relation_record.oid IS NULL
            OR relation_record.relkind <> 'r'
            OR relation_record.relpersistence <> 'p'
      )
      AND NOT EXISTS (
        SELECT 1
          FROM expected_column AS expected
          LEFT JOIN pg_namespace AS namespace_record
            ON namespace_record.nspname = expected.schema_name
          LEFT JOIN pg_class AS relation_record
            ON relation_record.relnamespace = namespace_record.oid
           AND relation_record.relname = expected.relation_name
          LEFT JOIN pg_attribute AS attribute_record
            ON attribute_record.attrelid = relation_record.oid
           AND attribute_record.attname = expected.column_name
           AND attribute_record.attnum > 0
           AND NOT attribute_record.attisdropped
         WHERE attribute_record.attnum IS NULL
            OR format_type(
                 attribute_record.atttypid,
                 attribute_record.atttypmod
               ) <> expected.data_type
            OR attribute_record.attnotnull <> expected.is_not_null
      )
      AND EXISTS (
        SELECT 1
          FROM pg_constraint AS constraint_record
          JOIN pg_index AS index_record
            ON index_record.indexrelid = constraint_record.conindid
          JOIN pg_class AS index_relation
            ON index_relation.oid = index_record.indexrelid
          JOIN pg_am AS index_method
            ON index_method.oid = index_relation.relam
         WHERE constraint_record.conrelid = to_regclass('conversation.session')
           AND constraint_record.contype = 'p'
           AND constraint_record.convalidated
           AND NOT constraint_record.condeferrable
           AND NOT constraint_record.condeferred
           AND index_method.amname = 'btree'
           AND index_record.indisvalid
           AND index_record.indisready
           AND index_record.indimmediate
           AND ARRAY(
                 SELECT attribute_record.attname
                   FROM unnest(constraint_record.conkey)
                     WITH ORDINALITY AS key_column(attnum, position)
                   JOIN pg_attribute AS attribute_record
                     ON attribute_record.attrelid = constraint_record.conrelid
                    AND attribute_record.attnum = key_column.attnum
                  ORDER BY key_column.position
               ) = ARRAY['id']::name[]
      ) AS compatible`, [
    JSON.stringify(dependencyRelations.map(([schemaName, relationName]) => ({
      schema_name: schemaName,
      relation_name: relationName,
    }))),
    JSON.stringify(dependencyColumns.map(([
      schemaName,
      relationName,
      columnName,
      dataType,
      isNotNull,
    ]) => ({
      schema_name: schemaName,
      relation_name: relationName,
      column_name: columnName,
      data_type: dataType,
      is_not_null: isNotNull,
    }))),
  ]);

  if (result.rows[0]?.compatible !== true) {
    throw new Error('P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED');
  }
}

async function readMigrations() {
  return Promise.all(migrationNames.map(async (migrationName) => {
    const migrationUrl = new URL(
      `../database/migrations/${migrationName}.sql`,
      import.meta.url,
    );
    return Object.freeze({
      name: migrationName,
      sql: await readFile(fileURLToPath(migrationUrl), 'utf8'),
    });
  }));
}

async function runCheck({ pool, migrations }) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await assertReadOnlyDependencyContract(client);
    for (const migration of migrations) {
      await client.query(migrationBodyForCheck(migration.sql));
    }
    await client.query('ROLLBACK');
    transactionOpen = false;
  } finally {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => {});
    }
    client.release();
  }
}

async function runMigrate({ pool, migrations }) {
  await assertReadOnlyDependencyContract(pool);
  for (const migration of migrations) {
    await pool.query(migration.sql);
  }
}

const options = parseArguments(process.argv.slice(2));
const databaseUrl = process.env.PILOT_DATABASE_URL;

if (options === null) {
  writeResult({
    ok: false,
    error: { code: 'P2_002_MIGRATION_ARGUMENTS_INVALID', retryable: false },
  });
  process.exitCode = 1;
} else if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
  writeResult({
    ok: false,
    error: { code: 'PILOT_DATABASE_URL_REQUIRED', retryable: false },
  });
  process.exitCode = 1;
} else {
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });

  try {
    await stopLegacyMigrationAfterArch005(pool, '011_p2_002_timeline_projector');
    const migrations = await readMigrations();
    if (options.mode === 'check') {
      await runCheck({ pool, migrations });
    } else {
      await runMigrate({ pool, migrations });
    }

    writeResult({
      ok: true,
      task: 'P2-002',
      mode: options.mode,
      migrations: migrationNames,
      relations: relationNames,
      feature_flags_enabled: false,
    });
  } catch (error) {
    const isSchemaDrift = error instanceof Error
      && error.message === 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED';

    writeResult({
      ok: false,
      error: {
        code: isSchemaDrift
          ? 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED'
          : 'P2_002_MIGRATION_FAILED',
        retryable: !isSchemaDrift,
      },
    });
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}
