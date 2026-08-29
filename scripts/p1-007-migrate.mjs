import { Pool } from 'pg';
import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from '../src/p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration } from '../src/p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration } from '../src/p1-007-notification-outbox.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'PILOT_DATABASE_URL_REQUIRED', retryable: false } })}\n`);
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000 });
  try {
    await applyChannelMessageInboxMigration({ pool });
    await applyServiceIntakeMigration({ pool });
    await applyPilotTicketCoreMigration({ pool });
    await applyTicketStateActionMigration({ pool });
    await applyNotificationOutboxMigration({ pool });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      task: 'P1-007',
      relations: ['notification.outbox', 'notification.delivery', 'notification.delivery_attempt'],
    })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'P1_007_MIGRATION_FAILED', retryable: true } })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
