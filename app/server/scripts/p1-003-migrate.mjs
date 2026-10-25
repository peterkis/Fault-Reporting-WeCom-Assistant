import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { stopLegacyMigrationAfterArch005 } from '../src/platform/legacy-migration-guard.mjs';
import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: {
      code: 'PILOT_DATABASE_URL_REQUIRED',
      retryable: false,
    },
  })}\n`);
  process.exitCode = 1;
} else {
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await stopLegacyMigrationAfterArch005(pool, '001_p1_003_channel_message_inbox');
    await applyChannelMessageInboxMigration({ pool });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      task: 'P1-003',
      migration: '001_p1_003_channel_message_inbox',
      relation: 'channel.message_inbox',
    })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: {
        code: 'P1_003_MIGRATION_FAILED',
        retryable: true,
      },
    })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
