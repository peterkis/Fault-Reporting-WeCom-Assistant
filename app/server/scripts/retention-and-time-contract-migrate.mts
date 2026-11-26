import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import type { PostgresTransaction } from '../src/platform/postgres-pool.mjs';
import { transactionP2016, failP2016 } from '../src/p2-016-domain-contracts.mjs';

/** Card 42C-2/3/4: retention_until_epoch_ms indexes, inlinable platform.local_now(), and realtime expiry index cleanup. */
export const RETENTION_TIME_CONTRACT_MIGRATION_ID = '077_retention_and_time_contract';
const file = new URL('../../../database/migrations/077_retention_and_time_contract.sql', import.meta.url);

export interface ExpectedRetentionIndexTarget {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly columns: readonly string[];
}

const RAW_RETENTION_INDEX_TARGETS: readonly ExpectedRetentionIndexTarget[] = [
  { schema: 'intake', table: 'service_intake', name: 'service_intake_retention_epoch_idx', columns: ['retention_until_epoch_ms', 'id'] },
  { schema: 'communication', table: 'message', name: 'communication_message_retention_epoch_idx', columns: ['retention_until_epoch_ms', 'id'] },
  { schema: 'intake', table: 'contact_journey', name: 'contact_journey_retention_epoch_idx', columns: ['retention_until_epoch_ms', 'id'] },
  { schema: 'incident', table: 'incident', name: 'incident_retention_epoch_idx', columns: ['retention_until_epoch_ms', 'id'] },
  { schema: 'intake', table: 'web_submission', name: 'web_submission_retention_epoch_idx', columns: ['retention_until_epoch_ms', 'id'] },
  { schema: 'intake', table: 'web_request_binding', name: 'web_request_binding_retention_epoch_idx', columns: ['retention_until_epoch_ms', 'intake_id'] },
  { schema: 'intake', table: 'web_report_urge', name: 'web_report_urge_retention_epoch_idx', columns: ['retention_until_epoch_ms', 'id'] },
  { schema: 'intake', table: 'web_report_evaluation', name: 'web_report_evaluation_retention_epoch_idx', columns: ['retention_until_epoch_ms', 'id'] },
  { schema: 'operations', table: 'backup_checkpoint', name: 'operations_backup_retention_epoch_id_idx', columns: ['retention_until_epoch_ms', 'id'] },
];

export const RETENTION_INDEX_TARGETS: readonly ExpectedRetentionIndexTarget[] = Object.freeze(
  RAW_RETENTION_INDEX_TARGETS.map((entry) =>
    Object.freeze({
      schema: entry.schema,
      table: entry.table,
      name: entry.name,
      columns: Object.freeze([...entry.columns]),
    }),
  ),
);

const SCAN_INDEX_TARGETS: readonly ExpectedRetentionIndexTarget[] = [
  ...RETENTION_INDEX_TARGETS,
  {schema:'channel',table:'message_inbox',name:'channel_message_inbox_retention_epoch_idx',columns:['retention_until_epoch_ms','id']},
  {schema:'conversation',table:'item',name:'conversation_item_retention_epoch_idx',columns:['retention_until_epoch_ms','session_id','sequence_no']},
];
const SCAN_INDEX_SPECS_JSON = JSON.stringify(SCAN_INDEX_TARGETS);
const RETENTION_TARGET_SPECS_JSON = JSON.stringify(RETENTION_INDEX_TARGETS);

export const EXPECTED_POST_077_LOCAL_NOW_NORMALIZED_BODY =
  "SELECT pg_catalog.date_trunc('second', pg_catalog.timezone('Asia/Shanghai', pg_catalog.transaction_timestamp()))::timestamp without time zone";

const PRE_077_LOCAL_NOW_SQL = `
CREATE OR REPLACE FUNCTION platform.local_now()
RETURNS timestamp without time zone
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, platform
AS $arch005_local_now$
    SELECT date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')::timestamp without time zone
$arch005_local_now$;
COMMENT ON FUNCTION platform.local_now() IS
    'Transaction-consistent Asia/Shanghai LocalDateTime at second precision.';
`;

async function source() {
  const sql = await readFile(file, 'utf8');
  const body = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if (!body) failP2016();
  return { sql, body, checksum: createHash('sha256').update(sql).digest('hex') };
}

/** Applies the 077 body inside the caller's transaction without registering it. */
export async function applyRetentionTimeContractSql(tx: Pick<PostgresTransaction, 'query'>): Promise<void> {
  const { body } = await source();
  await tx.query(body);
}

const RETENTION_STRUCTURE_FIELDS_SQL = `
  (SELECT count(*)::integer
     FROM jsonb_to_recordset($1::jsonb) AS expected(schema text, "table" text, name text, columns text[])
     JOIN pg_namespace AS nsp ON nsp.nspname = expected.schema
     JOIN pg_class AS cls ON cls.relnamespace = nsp.oid AND cls.relname = expected.name
     JOIN pg_am AS am ON am.oid = cls.relam
     JOIN pg_index AS idx ON idx.indexrelid = cls.oid
     JOIN pg_class AS tbl ON tbl.oid = idx.indrelid
     JOIN pg_namespace AS tnsp ON tnsp.oid = tbl.relnamespace
    WHERE tnsp.nspname = expected.schema
      AND tbl.relname = expected."table"
      AND cls.relkind = 'i'
      AND cls.relpersistence = 'p'
      AND am.amname = 'btree'
      AND idx.indisvalid
      AND idx.indisready
      AND idx.indislive
      AND idx.indimmediate
      AND NOT idx.indisunique
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnatts = idx.indnkeyatts
      AND idx.indnkeyatts = cardinality(expected.columns)
      AND pg_get_indexdef(idx.indexrelid) = format('CREATE INDEX %I ON %I.%I USING btree (%s)',
        expected.name, expected.schema, expected."table", array_to_string(expected.columns, ', '))
      AND ARRAY(
        SELECT att.attname::text
          FROM unnest(idx.indkey::smallint[]) WITH ORDINALITY AS k(attnum, pos)
          JOIN pg_attribute AS att
            ON att.attrelid = tbl.oid
           AND att.attnum = k.attnum
         ORDER BY k.pos
      ) = expected.columns) AS retention_index_count,
  EXISTS(
    SELECT 1
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      JOIN pg_language AS l ON l.oid = p.prolang
     WHERE n.nspname = 'platform'
       AND p.proname = 'local_now'
       AND p.pronargs = 0
       AND l.lanname = 'sql'
       AND p.provolatile = 's'
       AND NOT p.prosecdef
       AND NOT p.proisstrict
       AND NOT p.proretset
       AND p.proconfig IS NULL
       AND p.prorettype = 'timestamp without time zone'::regtype
       AND btrim(regexp_replace(p.prosrc, '[[:space:]]+', ' ', 'g')) = $2::text
  ) AS local_now_ok,
  EXISTS(
    SELECT 1
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'platform'
       AND p.proname = 'physical_epoch_ms'
       AND p.pronargs = 0
       AND p.provolatile = 'v'
       AND NOT p.proretset
       AND p.prorettype = 'bigint'::regtype
  ) AS physical_epoch_ok,
  (to_regclass('conversation.conversation_realtime_event_expiry_event_idx') IS NULL) AS legacy_expiry_absent,
  EXISTS(
    SELECT 1
      FROM pg_index AS idx
      JOIN pg_class AS cls ON cls.oid = idx.indexrelid
      JOIN pg_am AS am ON am.oid = cls.relam
     WHERE idx.indexrelid = to_regclass('conversation.conversation_realtime_expiry_epoch_idx')
       AND idx.indrelid = to_regclass('conversation.realtime_event')
       AND cls.relkind = 'i'
       AND cls.relpersistence = 'p'
       AND am.amname = 'btree'
       AND idx.indisvalid
       AND idx.indisready
       AND idx.indislive
       AND idx.indimmediate
       AND NOT idx.indisunique
       AND idx.indpred IS NULL
       AND idx.indexprs IS NULL
       AND idx.indnatts = idx.indnkeyatts
       AND pg_get_indexdef(idx.indexrelid) = 'CREATE INDEX conversation_realtime_expiry_epoch_idx ON conversation.realtime_event USING btree (expires_epoch_ms, event_id)'
       AND idx.indnkeyatts = 2
       AND ARRAY(
         SELECT a.attname::text
           FROM unnest(idx.indkey::smallint[]) WITH ORDINALITY AS k(attnum, pos)
           JOIN pg_attribute AS a
             ON a.attrelid = to_regclass('conversation.realtime_event')
            AND a.attnum = k.attnum
          ORDER BY k.pos
       ) = ARRAY['expires_epoch_ms', 'event_id']::text[]
  ) AS epoch_expiry_valid
`;

interface RetentionStructureRow {
  readonly checksum_sha256?: string | null;
  readonly retention_index_count: number;
  readonly local_now_ok: boolean;
  readonly physical_epoch_ok: boolean;
  readonly legacy_expiry_absent: boolean;
  readonly epoch_expiry_valid: boolean;
}

function isStructureSatisfied(row: RetentionStructureRow | undefined): boolean {
  return Boolean(
    row
    && row.retention_index_count === SCAN_INDEX_TARGETS.length
    && row.local_now_ok
    && row.physical_epoch_ok
    && row.legacy_expiry_absent
    && row.epoch_expiry_valid,
  );
}

export async function retentionTimeContractStructureValid(tx: Pick<PostgresTransaction, 'query'>): Promise<boolean> {
  const row = (await tx.query<RetentionStructureRow>(
    `SELECT ${RETENTION_STRUCTURE_FIELDS_SQL}`,
    [SCAN_INDEX_SPECS_JSON, EXPECTED_POST_077_LOCAL_NOW_NORMALIZED_BODY],
  )).rows[0];
  return isStructureSatisfied(row);
}

export async function retentionTimeContractSchemaReady(tx: Pick<PostgresTransaction, 'query'>): Promise<boolean> {
  const { checksum } = await source();
  const row = (await tx.query<RetentionStructureRow>(
    `SELECT
       (SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id = $3::text) AS checksum_sha256,
       ${RETENTION_STRUCTURE_FIELDS_SQL}`,
    [SCAN_INDEX_SPECS_JSON, EXPECTED_POST_077_LOCAL_NOW_NORMALIZED_BODY, RETENTION_TIME_CONTRACT_MIGRATION_ID],
  )).rows[0];
  return row?.checksum_sha256 === checksum && isStructureSatisfied(row);
}

async function findMissingRetentionPrerequisites(tx: Pick<PostgresTransaction, 'query'>): Promise<string | null> {
  const baseRow = (await tx.query<{ missing_base: string | null }>(
    `SELECT CASE
       WHEN NOT EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id = '022_arch_005_asia_shanghai_time_contract')
         THEN '022_arch_005_asia_shanghai_time_contract'
       WHEN to_regclass('conversation.realtime_event') IS NULL
         THEN 'conversation.realtime_event'
       WHEN to_regclass('conversation.conversation_realtime_expiry_epoch_idx') IS NULL
         THEN 'conversation.conversation_realtime_expiry_epoch_idx'
       ELSE NULL
     END AS missing_base`,
  )).rows[0];
  if (baseRow?.missing_base) return baseRow.missing_base;

  const colRow = (await tx.query<{ missing_ref: string | null }>(
    `SELECT (
       SELECT expected.schema || '.' || expected."table" || '.' || req.col
         FROM jsonb_to_recordset($1::jsonb) AS expected(schema text, "table" text, name text, columns text[])
         CROSS JOIN LATERAL unnest(expected.columns) AS req(col)
         LEFT JOIN pg_namespace AS nsp ON nsp.nspname = expected.schema
         LEFT JOIN pg_class AS tbl ON tbl.relnamespace = nsp.oid AND tbl.relname = expected."table" AND tbl.relkind = 'r'
         LEFT JOIN pg_attribute AS att ON att.attrelid = tbl.oid AND att.attname = req.col AND NOT att.attisdropped
        WHERE att.attnum IS NULL
        ORDER BY expected.schema, expected."table", req.col
        LIMIT 1
     ) AS missing_ref`,
    [RETENTION_TARGET_SPECS_JSON],
  )).rows[0];
  return colRow?.missing_ref ?? null;
}

async function findOccupiedRetentionIndexName(tx: Pick<PostgresTransaction, 'query'>): Promise<string | null> {
  const row = (await tx.query<{ occupied_name: string | null }>(
    `SELECT (
       SELECT expected.schema || '.' || expected.name
         FROM jsonb_to_recordset($1::jsonb) AS expected(schema text, "table" text, name text, columns text[])
         JOIN pg_namespace AS nsp ON nsp.nspname = expected.schema
         JOIN pg_class AS cls ON cls.relnamespace = nsp.oid AND cls.relname = expected.name
        ORDER BY expected.schema, expected.name
        LIMIT 1
     ) AS occupied_name`,
    [RETENTION_TARGET_SPECS_JSON],
  )).rows[0];
  return row?.occupied_name ?? null;
}

export async function restoreRetentionTimeContractBaseline(tx: Pick<PostgresTransaction, 'query'>): Promise<void> {
  await tx.query(PRE_077_LOCAL_NOW_SQL);
  await tx.query(
    `CREATE INDEX IF NOT EXISTS conversation_realtime_event_expiry_event_idx
       ON conversation.realtime_event (expires_at, event_id)`,
  );
  for (const target of RETENTION_INDEX_TARGETS) {
    if (!/^[a-z_][a-z0-9_]*$/u.test(target.schema) || !/^[a-z_][a-z0-9_]*$/u.test(target.name)) {
      throw Error('RETENTION_TIME_CONTRACT_IDENTIFIER_INVALID');
    }
    await tx.query(`DROP INDEX IF EXISTS ${target.schema}.${target.name}`);
  }
}

export async function migrateRetentionTimeContract({
  databaseUrl,
  mode = 'check',
}: {
  databaseUrl: string;
  mode?: 'check' | 'apply' | 'rollback';
}) {
  if (!databaseUrl || !['check', 'apply', 'rollback'].includes(mode)) failP2016();
  const { body, checksum } = await source();
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    application_name: 'retention_time_contract_migrator',
  });
  try {
    return await transactionP2016(pool, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('RETENTION_TIME_CONTRACT_MIGRATION'))");
      const registry = (await tx.query<{ present: boolean }>(
        "SELECT to_regclass('platform.schema_migration') IS NOT NULL AS present",
      )).rows[0];
      if (!registry?.present && mode === 'apply') {
        throw Error('RETENTION_TIME_CONTRACT_PREREQUISITE_MISSING:platform.schema_migration');
      }
      const existing = registry?.present ? (await tx.query<{ checksum_sha256: string }>(
        'SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id = $1',
        [RETENTION_TIME_CONTRACT_MIGRATION_ID],
      )).rows[0] : undefined;
      if (existing) {
        if (existing.checksum_sha256 !== checksum || !(await retentionTimeContractSchemaReady(tx))) {
          throw Error('RETENTION_TIME_CONTRACT_SCHEMA_DRIFT');
        }
        if (mode !== 'rollback') {
          return { status: 'NOOP_ALREADY_APPLIED', migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID };
        }
        await restoreRetentionTimeContractBaseline(tx);
        await tx.query('DELETE FROM platform.schema_migration WHERE migration_id = $1', [
          RETENTION_TIME_CONTRACT_MIGRATION_ID,
        ]);
        return { status: 'ROLLED_BACK', migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID };
      }
      if (mode === 'rollback') return { status: 'NOT_APPLIED', migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID };
      if (mode === 'check') return { status: 'PENDING', migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID };

      const missingPrereq = await findMissingRetentionPrerequisites(tx);
      if (missingPrereq) throw Error(`RETENTION_TIME_CONTRACT_PREREQUISITE_MISSING:${missingPrereq}`);
      const occupied = await findOccupiedRetentionIndexName(tx);
      if (occupied) throw Error(`RETENTION_TIME_CONTRACT_TARGET_NAME_OCCUPIED:${occupied}`);

      await tx.query(body);
      if (!(await retentionTimeContractStructureValid(tx))) {
        throw Error('RETENTION_TIME_CONTRACT_SCHEMA_DRIFT');
      }
      await tx.query(
        `WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
         INSERT INTO platform.schema_migration(migration_id, checksum_sha256, applied_at, applied_epoch_ms)
         SELECT $1, $2, platform.local_from_epoch_ms(epoch), epoch FROM stamp`,
        [RETENTION_TIME_CONTRACT_MIGRATION_ID, checksum],
      );
      return { status: 'APPLIED', migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID };
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !['--check', '--apply', '--rollback'].includes(arg))) {
    throw Error('RETENTION_TIME_CONTRACT_ARGUMENT_INVALID');
  }
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) throw Error('RETENTION_TIME_CONTRACT_DATABASE_URL_REQUIRED');
  try {
    const mode = args[0] === '--apply' ? 'apply' : args[0] === '--rollback' ? 'rollback' : 'check';
    console.log(JSON.stringify(await migrateRetentionTimeContract({ databaseUrl, mode })));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error_code: 'RETENTION_TIME_CONTRACT_MIGRATION_FAILED',
      detail: error instanceof Error ? error.message.slice(0, 200) : null,
    }));
    process.exitCode = 1;
  }
}
