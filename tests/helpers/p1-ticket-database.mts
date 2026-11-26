import {test} from 'node:test';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {applyChannelMessageInboxMigration} from '../../app/server/src/p1-003-channel-message-inbox.mjs';
import {applyServiceIntakeMigration} from '../../app/server/src/p1-004-service-intake.mjs';
import {migrateCurrentBaseline} from '../../app/server/scripts/migrate-current-baseline.mjs';
import {migrateServiceClosure} from '../../app/server/scripts/service-closure-migrate.mjs';
import {migrateCompletionDismissal} from '../../app/server/scripts/completion-dismissal-migrate.mjs';
import {migrateNotificationVocabulary} from '../../app/server/scripts/notification-vocabulary-migrate.mjs';
import {migrateSystemClosureRestore} from '../../app/server/scripts/system-closure-restore-migrate.mjs';
import {migrateTicketTerminalAt} from '../../app/server/scripts/ticket-terminal-at-migrate.mjs';
import {withP2015IsolatedDatabase} from './p2-015-postgres-harness.mjs';

type WithPool = (pool: PostgresPool) => Promise<void>;
type Prepare = (pool: PostgresPool, databaseUrl: string) => Promise<void>;

export async function prepareCurrentTicketSchema(pool: PostgresPool, databaseUrl: string): Promise<void> {
  await applyChannelMessageInboxMigration({pool});
  await applyServiceIntakeMigration({pool});
  const apply = {databaseUrl, mode: 'apply' as const};
  await migrateCurrentBaseline(apply);
  for (const migrate of [
    migrateServiceClosure,
    migrateCompletionDismissal,
    migrateNotificationVocabulary,
    migrateSystemClosureRestore,
    migrateTicketTerminalAt,
  ]) {
    await migrate(apply);
  }
}

/** Only the harness uses the admin URL. Preparation receives its owned pool and matching fixture URL. */
export function isolatedTicketTests(purpose: string, prepare: Prepare) {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  return (name: string, run: WithPool) => test(name, {skip: !databaseUrl}, () => withP2015IsolatedDatabase({
    databaseUrl,
    purpose,
    run: async ({pool, databaseUrl: fixtureUrl}: {pool: PostgresPool; databaseUrl: string}) => {
      await prepare(pool, fixtureUrl);
      await run(pool);
    },
  }));
}
