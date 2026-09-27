import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

export const THIRD_STAFF_DIRECTORY_MIGRATION_ID = '036_p2_007_third_party_staff_directory';
export const THIRD_STAFF_DIRECTORY_RELATIONS = Object.freeze([
  'directory.sync_run', 'directory.current_snapshot', 'directory.department_current',
  'directory.member_current', 'directory.membership_current', 'directory.identity_binding',
]);
const FILE = new URL('../database/migrations/036_p2_007_third_party_staff_directory.sql', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };

export async function validateThirdPartyStaffDirectoryCatalog(pool) {
  const result = await pool.query(`SELECT n.nspname||'.'||c.relname AS relation
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='directory' AND c.relkind='r' ORDER BY relation`);
  const actual = result.rows.map(row => row.relation);
  const expected = [...THIRD_STAFF_DIRECTORY_RELATIONS].sort();
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail('THIRD_STAFF_DIRECTORY_SCHEMA_DRIFT');
  }
  return Object.freeze({ relations: actual });
}

export async function migrateThirdPartyStaffDirectory({ databaseUrl, mode = 'apply', PoolFactory = createPostgresPool } = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0 || !['apply', 'check', 'status'].includes(mode)) {
    fail('THIRD_STAFF_DIRECTORY_MIGRATION_INPUT_INVALID');
  }
  const sql = await readFile(FILE, 'utf8');
  const body = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if (!body) fail('THIRD_STAFF_DIRECTORY_MIGRATION_FILE_INVALID');
  const checksum = sha(sql);
  const pool = PoolFactory({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000,
    application_name: 'p2_007_staff_directory_migrator' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('P2_007_THIRD_STAFF_DIRECTORY_MIGRATION'))");
    if ((await client.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='035_p2_016_workbench_wecom_auth'")).rowCount !== 1) {
      fail('THIRD_STAFF_DIRECTORY_REQUIRES_035');
    }
    const existing = await client.query('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1', [THIRD_STAFF_DIRECTORY_MIGRATION_ID]);
    if (existing.rowCount === 1) {
      if (existing.rows[0].checksum_sha256 !== checksum) fail('THIRD_STAFF_DIRECTORY_MIGRATION_CHECKSUM_MISMATCH');
      const inventory = await validateThirdPartyStaffDirectoryCatalog(client);
      await client.query('ROLLBACK');
      return Object.freeze({ status: 'NOOP_ALREADY_APPLIED', mode, checksum_sha256: checksum, inventory });
    }
    if (mode === 'status') {
      await client.query('ROLLBACK');
      return Object.freeze({ status: 'READY_FOR_036', mode, checksum_sha256: checksum });
    }
    await client.query(body);
    const inventory = await validateThirdPartyStaffDirectoryCatalog(client);
    if (mode === 'check') {
      await client.query('ROLLBACK');
      return Object.freeze({ status: 'CHECK_ROLLBACK_SUCCEEDED', mode, checksum_sha256: checksum, inventory });
    }
    await client.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
      INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`, [THIRD_STAFF_DIRECTORY_MIGRATION_ID, checksum]);
    await client.query('COMMIT');
    return Object.freeze({ status: 'APPLIED', mode, checksum_sha256: checksum, inventory });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    if (/^THIRD_STAFF_DIRECTORY_[A-Z0-9_]+$/u.test(error?.code ?? '')) throw error;
    fail('THIRD_STAFF_DIRECTORY_MIGRATION_FAILED');
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && !['--check', '--status', '--migrate'].includes(args[0]))) {
      fail('THIRD_STAFF_DIRECTORY_MIGRATION_ARGS_INVALID');
    }
    const result = await migrateThirdPartyStaffDirectory({
      databaseUrl: process.env.PILOT_DATABASE_URL,
      mode: args[0] === '--check' ? 'check' : args[0] === '--status' ? 'status' : 'apply',
    });
    console.log(JSON.stringify({ task: 'P2-007-THIRD-PARTY-STAFF-DIRECTORY', ...result }));
  } catch (error) {
    console.log(JSON.stringify({ task: 'P2-007-THIRD-PARTY-STAFF-DIRECTORY', ok: false,
      error_code: error.code ?? 'THIRD_STAFF_DIRECTORY_MIGRATION_FAILED' }));
    process.exitCode = 1;
  }
}
