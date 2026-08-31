import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const migrationNames = Object.freeze([
  '012_p2_003_realtime_event_log',
]);

const relationNames = Object.freeze([
  'conversation.realtime_event',
  'conversation.realtime_stream_state',
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
    throw new Error('P2_003_MIGRATION_FILE_INVALID');
  }
  return match[1];
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
  for (const migration of migrations) {
    await pool.query(migration.sql);
  }
}

const options = parseArguments(process.argv.slice(2));
const databaseUrl = process.env.PILOT_DATABASE_URL;

if (options === null) {
  writeResult({
    ok: false,
    error: { code: 'P2_003_MIGRATION_ARGUMENTS_INVALID', retryable: false },
  });
  process.exitCode = 1;
} else if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
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
    const migrations = await readMigrations();
    if (options.mode === 'check') {
      await runCheck({ pool, migrations });
    } else {
      await runMigrate({ pool, migrations });
    }

    writeResult({
      ok: true,
      task: 'P2-003',
      mode: options.mode,
      migrations: migrationNames,
      relations: relationNames,
      feature_flags_enabled: false,
    });
  } catch (error) {
    const isSchemaDrift = error instanceof Error
      && error.message === 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED';

    writeResult({
      ok: false,
      error: {
        code: isSchemaDrift
          ? 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED'
          : 'P2_003_MIGRATION_FAILED',
        retryable: !isSchemaDrift,
      },
    });
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}
