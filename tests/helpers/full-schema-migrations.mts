import {migrationConnection} from '../../app/server/scripts/migration-database.mjs';
import { readFile } from 'node:fs/promises';
import { createPostgresPool } from '../../app/server/src/platform/postgres-pool.mjs';
import { migrateCurrentBaselineWithYxx } from '../../app/server/scripts/migrate-current-baseline.mjs';
import { migrateWorkbenchAuth } from '../../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import { migrateThirdPartyStaffDirectory } from '../../app/server/scripts/p2-007-migrate.mjs';
import { migrateWorkbenchSourceGroups } from '../../app/server/scripts/workbench-source-groups-migrate.mjs';
import { migrateTicketSelfHandling } from '../../app/server/scripts/ticket-self-handling-migrate.mjs';
import { migrateTicketStaffCompletion } from '../../app/server/scripts/ticket-staff-completion-migrate.mjs';
import { migrateTicketRoundNotifications } from '../../app/server/scripts/ticket-round-notifications-migrate.mjs';
import { migrateWorkbenchManualReports } from '../../app/server/scripts/workbench-manual-reports-migrate.mjs';
import { migrateTicketReopenRounds } from '../../app/server/scripts/ticket-reopen-rounds-migrate.mjs';
import { migrateWorkbenchVerifiedManualReports } from '../../app/server/scripts/workbench-verified-manual-reports-migrate.mjs';
import { migrateWorkbenchPersonalRead } from '../../app/server/scripts/workbench-personal-read-migrate.mjs';
import { migrateWorkbenchFollow } from '../../app/server/scripts/workbench-follow-migrate.mjs';
import { migrateTicketUnassign } from '../../app/server/scripts/ticket-unassign-migrate.mjs';
import { migrateTicketReturnToDispatch } from '../../app/server/scripts/ticket-return-to-dispatch-migrate.mjs';
import { migrateWorkbenchFollowUpSchedules } from '../../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import { migrateBotReporterFeedback } from '../../app/server/scripts/bot-reporter-feedback-migrate.mjs';
import { migrateWorkbenchFollowUpDueSignals } from '../../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import { migrateIncidentInternalNotes } from '../../app/server/scripts/incident-internal-notes-migrate.mjs';
import { migrateIncidentPublicProgress } from '../../app/server/scripts/incident-public-progress-migrate.mjs';
import { migrateIncidentOwnerTransfer } from '../../app/server/scripts/incident-owner-transfer-migrate.mjs';
import { migrateIncidentDeliveryControl } from '../../app/server/scripts/incident-delivery-control-migrate.mjs';
import { migrateConversationDeliveryCommands } from '../../app/server/scripts/conversation-delivery-commands-migrate.mjs';
import { migrateWorkbenchSupplementFollowUp } from '../../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import { migrateMvpNotifications } from '../../app/server/scripts/mvp-notifications-migrate.mjs';
import { migrateYxxH5 } from '../../app/server/scripts/yxx-h5-migrate.mjs';
import { migrateTicketReporterProfiles } from '../../app/server/scripts/ticket-reporter-profiles-migrate.mjs';
import { migrateWorkbenchDisplayMedia } from '../../app/server/scripts/workbench-display-media-migrate.mjs';
import { migrateServiceClosure } from '../../app/server/scripts/service-closure-migrate.mjs';
import { migrateCompletionDismissal } from '../../app/server/scripts/completion-dismissal-migrate.mjs';
import { migrateNotificationVocabulary } from '../../app/server/scripts/notification-vocabulary-migrate.mjs';
import { migrateSystemClosureRestore } from '../../app/server/scripts/system-closure-restore-migrate.mjs';
import { migrateTicketTerminalAt } from '../../app/server/scripts/ticket-terminal-at-migrate.mjs';
import { migrateFkIndexes } from '../../app/server/scripts/fk-indexes-migrate.mjs';
import { migrateRetentionTimeContract } from '../../app/server/scripts/retention-and-time-contract-migrate.mjs';

export interface FullSchemaMigrationOptions {
  readonly beforeClosureMigration?: () => Promise<void>;
  readonly includeWorkbenchAuth?: boolean;
  readonly includeThirdPartyStaffDirectory?: boolean;
}

const RAW_MEDIA_SQL_FILES = [
  '064_yixiaoxiu_h5_member_service.sql',
  '065_yixiaoxiu_h5_web_media.sql',
  '066_yixiaoxiu_h5_media_previews.sql',
  '067_ticket_reporter_profiles.sql',
  '068_workbench_actor_avatar_cache.sql',
  '069_h5_media_conversion_diagnostics.sql',
  '070_workbench_media_video_thumbnails.sql',
] as const;

async function applyRawMediaMigrationsWithout036(databaseUrl: string): Promise<void> {
  const pool = createPostgresPool({
    ...migrationConnection(databaseUrl),
    max: 1,
    application_name: 'full_schema_raw_media_helper',
  });
  try {
    for (const file of RAW_MEDIA_SQL_FILES) {
      const sql = await readFile(new URL(`../../database/migrations/${file}`, import.meta.url), 'utf8');
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
}

/**
 * Shared full-schema migration sequence up through 074 (before 075/076/077).
 * Applies 001..074 cleanly on an isolated database without depending on Card 42A's 075.
 */
export async function applyFullSchemaThrough074(
  databaseUrl: string,
  options: FullSchemaMigrationOptions = {},
): Promise<void> {
  const apply = { databaseUrl, mode: 'apply' as const };
  const expectedDatabase = new URL(databaseUrl).pathname.slice(1);
  const includeWorkbenchAuth = options.includeWorkbenchAuth ?? true;
  const includeThirdPartyStaffDirectory = options.includeThirdPartyStaffDirectory ?? true;

  await migrateCurrentBaselineWithYxx({ databaseUrl });
  if (includeWorkbenchAuth) await migrateWorkbenchAuth(apply);
  if (includeThirdPartyStaffDirectory) await migrateThirdPartyStaffDirectory(apply);

  for (const step of [
    migrateWorkbenchSourceGroups,
    migrateTicketSelfHandling,
    migrateTicketStaffCompletion,
    migrateTicketRoundNotifications,
    migrateWorkbenchManualReports,
    migrateTicketReopenRounds,
    migrateWorkbenchVerifiedManualReports,
    migrateWorkbenchPersonalRead,
    migrateWorkbenchFollow,
    migrateTicketUnassign,
    // With 049 present, return-to-dispatch installs the 057 compatibility migration.
    migrateWorkbenchFollowUpSchedules,
    migrateTicketReturnToDispatch,
    migrateBotReporterFeedback,
    migrateWorkbenchFollowUpDueSignals,
    migrateIncidentInternalNotes,
    migrateIncidentPublicProgress,
    migrateIncidentOwnerTransfer,
    migrateIncidentDeliveryControl,
    migrateConversationDeliveryCommands,
    migrateWorkbenchSupplementFollowUp,
    migrateMvpNotifications,
  ]) {
    await step(apply);
  }

  if (includeThirdPartyStaffDirectory) {
    await migrateYxxH5({ ...apply, expectedDatabase, includePreviews: true });
    await migrateTicketReporterProfiles({ ...apply, expectedDatabase });
    for (const target of ['avatars', 'media', 'previews'] as const) {
      await migrateWorkbenchDisplayMedia({ ...apply, expectedDatabase, target });
    }
  } else {
    await applyRawMediaMigrationsWithout036(databaseUrl);
  }

  await options.beforeClosureMigration?.();
  await migrateServiceClosure(apply);
  await migrateCompletionDismissal(apply);
  await migrateNotificationVocabulary(apply);
  await migrateSystemClosureRestore(apply);
}

/** Applies Card 42C's registered schema migrations (076 + 077) after full prerequisites exist. */
export async function applyCard42cMigrations(databaseUrl: string): Promise<void> {
  const apply = { databaseUrl, mode: 'apply' as const };
  await migrateFkIndexes(apply);
  await migrateRetentionTimeContract(apply);
}

/** Shared full-schema setup through Card 42C (001..077). */
export async function applyFullSchemaThrough077(
  databaseUrl: string,
  options: FullSchemaMigrationOptions = {},
): Promise<void> {
  await applyFullSchemaThrough074(databaseUrl, options);
  await migrateTicketTerminalAt({databaseUrl,mode:'apply'});
  await applyCard42cMigrations(databaseUrl);
}
