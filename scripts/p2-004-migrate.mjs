import { readFile } from 'node:fs/promises';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { stopLegacyMigrationAfterArch005 } from '../src/platform/legacy-migration-guard.mjs';

const migrationName = '020_p2_004_unified_communication';
const relationNames = Object.freeze([
  'communication.message',
  'communication.outbox',
  'communication.delivery',
  'communication.delivery_attempt',
]);

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function migrationBodyForCheck(sql) {
  const match = /^\uFEFF?\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql);
  if (match === null) throw new Error('P2_004_MIGRATION_FILE_INVALID');
  return match[1];
}

const argumentsList = process.argv.slice(2);
const mode = argumentsList.length === 0 || (argumentsList.length === 1 && argumentsList[0] === '--migrate')
  ? 'migrate'
  : argumentsList.length === 1 && argumentsList[0] === '--check'
    ? 'check'
    : null;
const databaseUrl = process.env.PILOT_DATABASE_URL;

if (mode === null) {
  writeResult({ ok: false, error: { code: 'P2_004_MIGRATION_ARGUMENTS_INVALID', retryable: false } });
  process.exitCode = 1;
} else if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
  writeResult({ ok: false, error: { code: 'PILOT_DATABASE_URL_REQUIRED', retryable: false } });
  process.exitCode = 1;
} else {
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000 });
  try {
    await stopLegacyMigrationAfterArch005(pool, '020_p2_004_unified_communication');
    const sql = await readFile(new URL(`../database/migrations/${migrationName}.sql`, import.meta.url), 'utf8');
    if (mode === 'check') {
      const client = await pool.connect();
      let open = false;
      try {
        await client.query('BEGIN');
        open = true;
        await client.query(migrationBodyForCheck(sql));
        await client.query('ROLLBACK');
        open = false;
      } finally {
        if (open) await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    } else {
      await pool.query(sql);
    }
    writeResult({ ok: true, task: 'P2-004', mode, migrations: [migrationName], relations: relationNames, feature_flags_enabled: false });
  } catch (error) {
    const drift = error?.message === 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    writeResult({ ok: false, error: { code: drift ? 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED' : 'P2_004_MIGRATION_FAILED', retryable: !drift } });
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}
