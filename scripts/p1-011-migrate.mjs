import { Pool } from 'pg';
import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from '../src/p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration } from '../src/p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration } from '../src/p1-007-notification-outbox.mjs';
import { applyPilotAccessMigration } from '../src/p1-009-pilot-access-workbench.mjs';
import { applyTicketClosureMigration } from '../src/p1-010-ticket-closure.mjs';
import { applyPilotOperationsMigration } from '../src/p1-011-pilot-operations-baseline.mjs';

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
    await applyPilotAccessMigration({ pool });
    await applyTicketClosureMigration({ pool });
    await applyPilotOperationsMigration({ pool });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      task: 'P1-011',
      relations: [
        'operations.audit_event',
        'operations.backup_checkpoint',
        'operations.restore_drill',
      ],
    })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'P1_011_MIGRATION_FAILED', retryable: true } })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
