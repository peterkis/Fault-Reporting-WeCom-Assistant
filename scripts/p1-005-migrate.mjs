import { Pool } from 'pg';
import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from '../src/p1-005-pilot-ticket-core.mjs';

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
    process.stdout.write(`${JSON.stringify({
      ok: true,
      task: 'P1-005',
      migrations: [
        '001_p1_003_channel_message_inbox',
        '002_p1_004_service_intake',
        '003_p1_005_pilot_ticket_core',
      ],
      relations: ['pilot_ticket.resolver_team', 'pilot_ticket.ticket'],
    })}\n`);
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'P1_005_MIGRATION_FAILED', retryable: true } })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
