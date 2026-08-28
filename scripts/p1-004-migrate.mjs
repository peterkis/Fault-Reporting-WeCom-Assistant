import { Pool } from 'pg';
import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../src/p1-004-service-intake.mjs';

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
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await applyChannelMessageInboxMigration({ pool });
    await applyServiceIntakeMigration({ pool });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      task: 'P1-004',
      migrations: [
        '001_p1_003_channel_message_inbox',
        '002_p1_004_service_intake',
      ],
      relations: [
        'intake.service_intake',
        'intake.service_intake_message',
        'intake.service_intake_event',
      ],
    })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: {
        code: 'P1_004_MIGRATION_FAILED',
        retryable: true,
      },
    })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
