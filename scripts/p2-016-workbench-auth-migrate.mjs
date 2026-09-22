import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

export const WORKBENCH_AUTH_MIGRATION_ID = '035_p2_016_workbench_wecom_auth';
const FILE = new URL('../database/migrations/035_p2_016_workbench_wecom_auth.sql', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };

export async function migrateWorkbenchAuth({ databaseUrl, mode = 'apply', PoolFactory = createPostgresPool } = {}) {
  if (typeof databaseUrl !== 'string' || !databaseUrl || !['apply', 'check', 'status'].includes(mode)) {
    fail('WORKBENCH_AUTH_MIGRATION_INPUT_INVALID');
  }
  const sql = await readFile(FILE, 'utf8');
  const body = /^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if (!body) fail('WORKBENCH_AUTH_MIGRATION_FILE_INVALID');
  const checksum = sha(sql);
  const pool = PoolFactory({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000,
    application_name: 'p2_016_workbench_auth_migrator' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('P2_016_WORKBENCH_AUTH_MIGRATION'))");
    const predecessor = await client.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='031_p2_016_ticket_lifecycle_workbench_notifications'");
    if (predecessor.rowCount !== 1) fail('WORKBENCH_AUTH_REQUIRES_031');
    const existing = await client.query('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1', [WORKBENCH_AUTH_MIGRATION_ID]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum_sha256 !== checksum) fail('WORKBENCH_AUTH_MIGRATION_CHECKSUM_MISMATCH');
      await client.query('ROLLBACK');
      return { status: 'NOOP_ALREADY_APPLIED', mode };
    }
    if (mode === 'status') {
      await client.query('ROLLBACK');
      return { status: 'READY_FOR_035', mode };
    }
    await client.query(body);
    if (mode === 'check') {
      await client.query('ROLLBACK');
      return { status: 'CHECK_ROLLBACK_SUCCEEDED', mode };
    }
    await client.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
      INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`, [WORKBENCH_AUTH_MIGRATION_ID, checksum]);
    await client.query('COMMIT');
    return { status: 'APPLIED', mode };
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    if (/^WORKBENCH_AUTH_[A-Z0-9_]+$/u.test(error?.code ?? '')) throw error;
    fail('WORKBENCH_AUTH_MIGRATION_FAILED');
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && !['--check', '--status', '--migrate'].includes(args[0]))) {
      fail('WORKBENCH_AUTH_MIGRATION_ARGS_INVALID');
    }
    const result = await migrateWorkbenchAuth({
      databaseUrl: process.env.PILOT_DATABASE_URL,
      mode: args[0] === '--check' ? 'check' : args[0] === '--status' ? 'status' : 'apply',
    });
    console.log(JSON.stringify({ task: 'P2-016-WORKBENCH-AUTH', ...result }));
  } catch (error) {
    console.log(JSON.stringify({ task: 'P2-016-WORKBENCH-AUTH', ok: false, error_code: error.code ?? 'WORKBENCH_AUTH_MIGRATION_FAILED' }));
    process.exitCode = 1;
  }
}
