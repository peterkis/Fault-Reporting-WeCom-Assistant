import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

export const P2_016_MIGRATION_ID = '031_p2_016_ticket_lifecycle_workbench_notifications';
export const P2_016_RELATIONS = Object.freeze([
  'pilot_ticket.ticket_command_receipt', 'pilot_ticket.reporter_public_ref',
  'pilot_ticket.reporter_access_grant', 'pilot_ticket.reporter_access_session',
  'pilot_ticket.reporter_access_event', 'communication.ticket_notification_binding',
]);
const FILE = new URL('../database/migrations/031_p2_016_ticket_lifecycle_workbench_notifications.sql', import.meta.url);
const EXPECTED_CATALOG_SHA256 = '5521c4fc34481ef22e46cab4e0f3e1fdea232c995cef2f823008d0ea9142fb20';
const EXPECTED_PREDECESSOR_SHA256 = '4cbdded3abdd2861d2db7cd197eba8471ae46302a37b222fadc74815ba1acb48';
const sha = (value) => createHash('sha256').update(value).digest('hex');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

export async function p2016CatalogInventory(tx) {
  const relations = await tx.query(`SELECT n.nspname||'.'||c.relname AS relation,c.relkind,c.relpersistence,
      c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname||'.'||c.relname=ANY($1::text[]) ORDER BY relation`, [P2_016_RELATIONS]);
  const columns = await tx.query(`SELECT n.nspname||'.'||c.relname AS relation,a.attname AS name,
      a.attnum AS ordinal,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
      a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attnum>0 AND NOT a.attisdropped AND
      (n.nspname||'.'||c.relname=ANY($1::text[]) OR
       (n.nspname='pilot_ticket' AND c.relname='ticket_event' AND a.attname='assignment_metadata'))
    ORDER BY relation,ordinal`, [P2_016_RELATIONS]);
  const constraints = await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,c.conname AS name,
      c.contype AS type,c.convalidated AS validated,c.condeferrable AS deferrable,
      c.condeferred AS deferred,pg_get_constraintdef(c.oid,true) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname||'.'||r.relname=ANY($1::text[]) OR
      (n.nspname='pilot_ticket' AND r.relname='ticket_event' AND c.conname IN ('ticket_event_type_check','p2016_assignment_metadata_check')) OR
      (n.nspname='conversation' AND r.relname='realtime_event' AND c.conname IN (
        'conversation_realtime_event_type_vocabulary_check','conversation_realtime_event_source_type_check','conversation_realtime_event_aggregate_type_check'))
    ORDER BY relation,name`, [P2_016_RELATIONS]);
  const indexes = await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,c.relname AS name,
      i.indisvalid AS valid,i.indisready AS ready,pg_get_indexdef(c.oid) AS definition
    FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_class c ON c.oid=i.indexrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname||'.'||r.relname=ANY($1::text[]) OR
      (n.nspname='pilot_ticket' AND r.relname='ticket' AND c.relname='p2016_ticket_keyset_idx')
    ORDER BY relation,name`, [P2_016_RELATIONS]);
  const triggers = await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,t.tgname AS name
    FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name`, [P2_016_RELATIONS]);
  return { relations: relations.rows, columns: columns.rows, constraints: constraints.rows,
    indexes: indexes.rows, triggers: triggers.rows };
}

export function p2016CatalogHash(inventory) { return sha(JSON.stringify(inventory)); }
export async function validateP2016Catalog(tx) {
  const inventory = await p2016CatalogInventory(tx);
  if (p2016CatalogHash(inventory) !== EXPECTED_CATALOG_SHA256) fail('P2_016_SCHEMA_DRIFT');
  return inventory;
}

export async function migrateP2016({ databaseUrl, mode = 'apply', PoolFactory = createPostgresPool } = {}) {
  if (typeof databaseUrl !== 'string' || !databaseUrl || !['apply','check','status'].includes(mode)) fail('P2_016_MIGRATION_INPUT_INVALID');
  const sql = await readFile(FILE, 'utf8');
  const body = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if (!body) fail('P2_016_MIGRATION_FILE_INVALID');
  const checksum = sha(sql);
  const pool = PoolFactory({ connectionString: databaseUrl, max: 1,
    connectionTimeoutMillis: 5000, application_name: 'p2_016_migrator' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('P2_016_MIGRATION'))");
    const predecessor = await client.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='030_p2_015_rule_first_intake_orchestration'");
    if (predecessor.rowCount !== 1) fail('P2_016_REQUIRES_030');
    const existing = await client.query('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1', [P2_016_MIGRATION_ID]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum_sha256 !== checksum) fail('P2_016_MIGRATION_CHECKSUM_MISMATCH');
      const inventory = await validateP2016Catalog(client);
      await client.query('ROLLBACK');
      return { status: 'NOOP_ALREADY_APPLIED', mode, inventory };
    }
    const partial = await p2016CatalogInventory(client);
    if (p2016CatalogHash(partial)!==EXPECTED_PREDECESSOR_SHA256) fail('P2_016_PARTIAL_SCHEMA');
    if (mode === 'status') { await client.query('ROLLBACK'); return { status: 'READY_FOR_031', mode }; }
    await client.query(body);
    const inventory = await validateP2016Catalog(client);
    if (mode === 'check') await client.query('ROLLBACK');
    else {
      await client.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
        INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
        SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`, [P2_016_MIGRATION_ID,checksum]);
      await client.query('COMMIT');
    }
    return { status: mode === 'check' ? 'CHECK_ROLLBACK_SUCCEEDED' : 'APPLIED', mode, inventory };
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    if (/^P2_016_[A-Z0-9_]+$/u.test(error?.code ?? '')) throw error;
    fail('P2_016_MIGRATION_FAILED');
  } finally { client?.release(); await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && !['--check','--status','--migrate'].includes(args[0]))) fail('P2_016_MIGRATION_ARGS_INVALID');
    const result = await migrateP2016({ databaseUrl: process.env.PILOT_DATABASE_URL,
      mode: args[0] === '--check' ? 'check' : args[0] === '--status' ? 'status' : 'apply' });
    console.log(JSON.stringify({ task: 'P2-016', status: result.status, mode: result.mode,
      catalog_sha256: result.inventory ? p2016CatalogHash(result.inventory) : null }));
  } catch (error) { console.log(JSON.stringify({ task: 'P2-016', ok: false, error_code: error.code ?? 'P2_016_MIGRATION_FAILED' })); process.exitCode=1; }
}
