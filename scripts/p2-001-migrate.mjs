import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const migrationNames = [
  '001_p1_003_channel_message_inbox',
  '002_p1_004_service_intake',
  '003_p1_005_pilot_ticket_core',
  '010_p2_001_conversation_contracts',
];

const databaseUrl = process.env.PILOT_DATABASE_URL;

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
  writeResult({
    ok: false,
    error: { code: 'PILOT_DATABASE_URL_REQUIRED', retryable: false },
  });
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });

  try {
    for (const migrationName of migrationNames) {
      const migrationUrl = new URL(`../database/migrations/${migrationName}.sql`, import.meta.url);
      const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');
      await pool.query(sql);
    }

    writeResult({
      ok: true,
      task: 'P2-001',
      migrations: migrationNames,
      relations: ['conversation.thread', 'conversation.session'],
      feature_flags_enabled: false,
    });
  } catch (error) {
    const isSchemaDrift = error instanceof Error
      && error.message === 'P2_001_SCHEMA_DRIFT_REMEDIATION_REQUIRED';

    writeResult({
      ok: false,
      error: {
        code: isSchemaDrift
          ? 'P2_001_SCHEMA_DRIFT_REMEDIATION_REQUIRED'
          : 'P2_001_MIGRATION_FAILED',
        retryable: !isSchemaDrift,
      },
    });
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}
