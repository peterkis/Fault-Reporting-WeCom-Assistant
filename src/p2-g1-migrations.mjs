import { applyChannelMessageInboxMigration } from './p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from './p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from './p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration } from './p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration } from './p1-007-notification-outbox.mjs';
import { applyPilotAccessMigration } from './p1-009-pilot-access-workbench.mjs';
import { applyTicketClosureMigration } from './p1-010-ticket-closure.mjs';
import { applyPilotOperationsMigration } from './p1-011-pilot-operations-baseline.mjs';
import { applyConversationContractsMigration } from './p2-001-conversation-contracts.mjs';
import { applyTimelineProjectionMigration } from './p2-002-timeline-projector.mjs';
import { applyRealtimeEventLogMigration } from './p2-003-realtime-event-log.mjs';
import { applyCommunicationMigration } from './p2-004-communication-core.mjs';
import { applyConversationControlMigration } from './p2-005-conversation-control.mjs';
import { migrateCurrentBaseline } from '../scripts/migrate-current-baseline.mjs';

export async function applyP2G1Migrations({ pool, databaseUrl } = {}) {
  if (!pool || typeof pool.query !== 'function' || typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new TypeError('P2_G1_MIGRATION_CONFIGURATION_INVALID');
  }
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyNotificationOutboxMigration({ pool });
  await applyPilotAccessMigration({ pool });
  await applyTicketClosureMigration({ pool });
  await applyPilotOperationsMigration({ pool });
  await applyConversationContractsMigration({ pool });
  await applyTimelineProjectionMigration({ pool });
  await applyRealtimeEventLogMigration({ pool });
  await applyCommunicationMigration({ pool });
  await applyConversationControlMigration({ pool });
  await migrateCurrentBaseline({ databaseUrl });
  return Object.freeze({ migration_count: 14, latest_migration: '022' });
}
