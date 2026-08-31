import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const migrationName = '021_p2_005_conversation_control';
const relationNames = Object.freeze([
  'conversation.assignment',
  'conversation.handoff',
  'conversation.read_cursor',
  'conversation.control_event',
]);

function writeResult(result) { process.stdout.write(`${JSON.stringify(result)}\n`); }
function bodyForCheck(sql) {
  const match = /^\uFEFF?\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql);
  if (match === null) throw new Error('P2_005_MIGRATION_FILE_INVALID');
  return match[1];
}

const args = process.argv.slice(2);
const mode = args.length === 0 || (args.length === 1 && args[0] === '--migrate')
  ? 'migrate' : args.length === 1 && args[0] === '--check' ? 'check' : null;
const databaseUrl = process.env.PILOT_DATABASE_URL;

if (mode === null) {
  writeResult({ ok: false, error: { code: 'P2_005_MIGRATION_ARGUMENTS_INVALID', retryable: false } });
  process.exitCode = 1;
} else if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
  writeResult({ ok: false, error: { code: 'PILOT_DATABASE_URL_REQUIRED', retryable: false } });
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000 });
  try {
    const sql = await readFile(new URL(`../database/migrations/${migrationName}.sql`, import.meta.url), 'utf8');
    if (mode === 'check') {
      const client = await pool.connect(); let open = false;
      try {
        await client.query('BEGIN'); open = true;
        await client.query(bodyForCheck(sql));
        await client.query('ROLLBACK'); open = false;
      } finally {
        if (open) await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    } else await pool.query(sql);
    writeResult({ ok: true, task: 'P2-005', mode, migrations: [migrationName], relations: relationNames, feature_flags_enabled: false });
  } catch (error) {
    const drift = error?.message === 'P2_005_SCHEMA_DRIFT_REMEDIATION_REQUIRED';
    writeResult({ ok: false, error: { code: drift ? 'P2_005_SCHEMA_DRIFT_REMEDIATION_REQUIRED' : 'P2_005_MIGRATION_FAILED', retryable: !drift } });
    process.exitCode = 1;
  } finally { await pool.end().catch(() => {}); }
}
