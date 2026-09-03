import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

export const P2_015_MIGRATION_ID = '030_p2_015_rule_first_intake_orchestration';
const MIGRATION_URL = new URL('../database/migrations/030_p2_015_rule_first_intake_orchestration.sql', import.meta.url);
export const P2_015_RELATIONS = Object.freeze([
  'intake.contact_journey','intake.channel_leg','intake.continuation_ref',
  'intake.deterministic_decision','intake.manual_review_item','intake.safe_action_suggestion',
]);
const REQUIRED_CONSTRAINTS = Object.freeze([
  'contact_journey_entry_mode_check','contact_journey_due_pair_check','contact_journey_retention_pair_check',
  'channel_leg_journey_id_fkey','channel_leg_journey_ordinal_unique','channel_leg_type_check','channel_leg_hashes_check',
  'continuation_ref_token_hash_key','continuation_ref_expiry_pair_check','continuation_ref_state_shape_check',
  'deterministic_decision_journey_ordinal_unique','deterministic_decision_decision_key_key','deterministic_decision_result_check',
  'manual_review_item_review_key_key','manual_review_resolution_shape_check',
  'safe_action_decision_ordinal_unique','safe_action_suggestion_action_key_key','safe_action_execution_shape_check',
]);
const REQUIRED_INDEXES = Object.freeze([
  'contact_journey_reporter_status_activity_idx','contact_journey_evaluation_due_idx',
  'channel_leg_journey_ordinal_idx','channel_leg_session_idx','channel_leg_source_message_idx',
  'continuation_ref_active_journey_purpose_idx','continuation_ref_expiry_state_idx',
  'deterministic_decision_source_window_idx','deterministic_decision_result_review_idx',
  'manual_review_pending_priority_keyset_idx','manual_review_one_pending_per_decision_idx',
  'safe_action_state_created_idx','safe_action_result_ref_idx',
]);

function failure(code) { const error = new Error(code); error.code = code; return error; }
function body(sql) {
  const match = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql);
  if (!match) throw failure('P2_015_MIGRATION_FILE_INVALID');
  return match[1];
}

async function marker(pool) {
  const result = await pool.query(`SELECT checksum_sha256,applied_at,applied_epoch_ms::text
    FROM platform.schema_migration WHERE migration_id=$1`, [P2_015_MIGRATION_ID]);
  return result.rows[0] ?? null;
}

export async function p2015CatalogInventory(pool) {
  const tables = await pool.query(`SELECT schemaname||'.'||tablename AS name FROM pg_tables
    WHERE schemaname='intake' AND tablename=ANY($1::text[]) ORDER BY tablename`, [P2_015_RELATIONS.map((name) => name.split('.')[1])]);
  const constraints = await pool.query(`SELECT c.conname AS name,n.nspname||'.'||r.relname AS relation,
    c.contype AS type,pg_get_constraintdef(c.oid,true) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='intake' AND r.relname=ANY($1::text[]) ORDER BY relation,name`, [P2_015_RELATIONS.map((name) => name.split('.')[1])]);
  const indexes = await pool.query(`SELECT schemaname||'.'||tablename AS relation,indexname AS name,indexdef AS definition
    FROM pg_indexes WHERE schemaname='intake' AND tablename=ANY($1::text[]) ORDER BY relation,name`, [P2_015_RELATIONS.map((name) => name.split('.')[1])]);
  const foreignKeys = constraints.rows.filter((row) => row.type === 'f');
  const forbiddenTypes = await pool.query(`SELECT count(*)::integer AS count FROM information_schema.columns
    WHERE table_schema='intake' AND table_name=ANY($1::text[]) AND data_type IN ('timestamp with time zone','time with time zone')`, [P2_015_RELATIONS.map((name) => name.split('.')[1])]);
  return Object.freeze({ tables: tables.rows.map((row) => row.name), constraints: constraints.rows,
    indexes: indexes.rows, foreign_keys: foreignKeys, forbidden_time_type_count: forbiddenTypes.rows[0].count });
}

export async function validateP2015Catalog(pool) {
  const inventory = await p2015CatalogInventory(pool);
  const expected = [...P2_015_RELATIONS].sort();
  if (inventory.tables.length !== expected.length || inventory.tables.some((value, index) => value !== expected[index])) throw failure('P2_015_SCHEMA_DRIFT_TABLES');
  if (inventory.forbidden_time_type_count !== 0) throw failure('P2_015_SCHEMA_DRIFT_TIME_TYPES');
  if (inventory.constraints.length < 55) throw failure('P2_015_SCHEMA_DRIFT_CONSTRAINTS');
  if (inventory.indexes.length < 24) throw failure('P2_015_SCHEMA_DRIFT_INDEXES');
  const constraintNames = new Set(inventory.constraints.map((row) => row.name));
  if (REQUIRED_CONSTRAINTS.some((name) => !constraintNames.has(name))) throw failure('P2_015_SCHEMA_DRIFT_CONSTRAINTS');
  const indexNames = new Set(inventory.indexes.map((row) => row.name));
  if (REQUIRED_INDEXES.some((name) => !indexNames.has(name))) throw failure('P2_015_SCHEMA_DRIFT_INDEXES');
  const requiredForeignTargets = ['intake.service_intake','conversation.session','conversation.thread','pilot_ticket.ticket','channel.message_inbox'];
  const definitions = inventory.foreign_keys.map((row) => row.definition).join('\n');
  if (requiredForeignTargets.some((target) => !definitions.includes(target))) throw failure('P2_015_SCHEMA_DRIFT_FOREIGN_KEYS');
  const extras = await pool.query(`SELECT count(*)::integer AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='intake' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal`, [P2_015_RELATIONS.map((name) => name.split('.')[1])]);
  if (extras.rows[0].count !== 0) throw failure('P2_015_SCHEMA_DRIFT_TRIGGER');
  return inventory;
}

export async function migrateP2015({ databaseUrl, mode = 'apply', PoolFactory = createPostgresPool } = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) throw failure('P2_015_DATABASE_URL_REQUIRED');
  if (!['apply','check','status'].includes(mode)) throw failure('P2_015_MIGRATION_MODE_INVALID');
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const pool = PoolFactory({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true, application_name: 'p2_015_migrator' });
  try {
    const arch = await pool.query(`SELECT count(*)::integer AS count FROM platform.schema_migration
      WHERE migration_id='022_arch_005_asia_shanghai_time_contract'`);
    if (arch.rows[0].count !== 1) throw failure('P2_015_REQUIRES_ARCH_005');
    const existing = await marker(pool);
    if (existing) {
      if (existing.checksum_sha256 !== checksum) throw failure('P2_015_MIGRATION_CHECKSUM_MISMATCH');
      const inventory = await validateP2015Catalog(pool);
      return Object.freeze({ status: 'NOOP_ALREADY_APPLIED', mode, checksum_sha256: checksum, inventory });
    }
    if (mode === 'status') return Object.freeze({ status: 'READY_FOR_030', mode, checksum_sha256: checksum });
    if (mode === 'check') {
      const client = await pool.connect();
      try { await client.query('BEGIN'); await client.query(body(sql)); await client.query('ROLLBACK'); }
      catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
      return Object.freeze({ status: 'CHECK_ROLLBACK_SUCCEEDED', mode, checksum_sha256: checksum });
    }
    await pool.query(sql);
    await pool.query(`WITH applied AS (SELECT platform.physical_epoch_ms() AS epoch_ms)
      INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch_ms),epoch_ms FROM applied`, [P2_015_MIGRATION_ID, checksum]);
    const inventory = await validateP2015Catalog(pool);
    return Object.freeze({ status: 'APPLIED', mode, checksum_sha256: checksum, inventory });
  } finally { await pool.end().catch(() => {}); }
}

function parse(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--migrate')) return 'apply';
  if (argv.length === 1 && argv[0] === '--check') return 'check';
  if (argv.length === 1 && argv[0] === '--status') return 'status';
  throw failure('P2_015_MIGRATION_ARGS_INVALID');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify({ task: 'P2-015', ...(await migrateP2015({ databaseUrl: process.env.PILOT_DATABASE_URL, mode: parse(process.argv.slice(2)) })) })); }
  catch (error) { console.log(JSON.stringify({ task: 'P2-015', ok: false, error_code: error?.code ?? 'P2_015_MIGRATION_FAILED' })); process.exitCode = 1; }
}
