import { fileURLToPath, pathToFileURL } from 'node:url';
import { databaseUrlForP2002Database } from './p2-002-postgres-harness.mjs';

const DATABASE_NAME_PATTERN = /^p2_002_[a-z0-9]+_[a-f0-9_]+$/u;
const databaseName = process.env.P2_002_TEST_DATABASE_NAME;
const mode = process.env.P2_002_TEST_MIGRATION_MODE;
const baseDatabaseUrl = process.env.PILOT_DATABASE_URL;

if (
  typeof databaseName !== 'string'
  || !DATABASE_NAME_PATTERN.test(databaseName)
  || !['migrate', 'check'].includes(mode)
  || typeof baseDatabaseUrl !== 'string'
  || baseDatabaseUrl.length === 0
) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: { code: 'P2_002_MIGRATION_CHILD_INPUT_INVALID', retryable: false },
  })}\n`);
  process.exitCode = 1;
} else {
  const migrationScriptPath = fileURLToPath(
    new URL('../../scripts/p2-002-migrate.mjs', import.meta.url),
  );
  process.env.PILOT_DATABASE_URL = databaseUrlForP2002Database(
    baseDatabaseUrl,
    databaseName,
  );
  delete process.env.P2_002_TEST_DATABASE_NAME;
  delete process.env.P2_002_TEST_MIGRATION_MODE;
  process.argv = [
    process.execPath,
    migrationScriptPath,
    mode === 'check' ? '--check' : '--migrate',
  ];

  try {
    await import(pathToFileURL(migrationScriptPath).href);
  } catch {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: { code: 'P2_002_MIGRATION_CHILD_FAILED', retryable: false },
    })}\n`);
    process.exitCode = 1;
  }
}
