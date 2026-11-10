import {applyCompletionDismissalSql,restoreCompletionDismissalBaseline,COMPLETION_DISMISSAL_MIGRATION_ID,completionDismissalNewValuesPresent} from '../../app/server/scripts/completion-dismissal-migrate.mjs';
import {applyNotificationVocabularySql,restoreNotificationVocabularyBaseline,NOTIFICATION_VOCABULARY_MIGRATION_ID,notificationVocabularyNewValuesPresent} from '../../app/server/scripts/notification-vocabulary-migrate.mjs';
import {createPostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import type {PostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {transactionP2016} from '../../app/server/src/p2-016-domain-contracts.mjs';

type Queryable={query<T=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:T[];rowCount:number|null}>};
/**
 * ADR-0058 / cards 32C and 32D-L: re-applies the 072 closure vocabulary (COMPLETED / DISMISSED) and then the 073 notification
 * vocabulary (TICKET_DISMISSED / TICKET_RESTORED / auto-complete reminder) after a fixture's last migration.
 * Both bodies are re-runnable; call it whenever a fixture applies migrations after the shared web01 chain, or builds a chain of its own.
 * Accepts the fixture's pool or its isolated database URL.
 */
export async function ensureCompletionDismissal(target:Queryable|string):Promise<void>{
 if(typeof target!=='string'){await applyCompletionDismissalSql(target as never);await applyNotificationVocabularySql(target as never);return;}
 const pool=createPostgresPool({connectionString:target,max:1,application_name:'completion_dismissal_fixture'});
 try{await applyCompletionDismissalSql(pool as never);await applyNotificationVocabularySql(pool as never);}finally{await pool.end();}
}

/**
 * For the P1 tests that migrate the shared PILOT_DATABASE_URL in place (not an isolated copy): undoes an unregistered 073 and
 * then an unregistered 072 applied by {@link ensureCompletionDismissal}, so the next run's historical catalog checks see the original schema.
 * Call it before setup (recovers an interrupted run) and in `after` once the test's own rows are deleted.
 * A registered 072 / 073 (a real migration) is never touched; leftover new-vocabulary rows fail instead of being rewritten.
 */
export async function releaseCompletionDismissal(pool:Queryable&Pick<PostgresPool,'connect'>):Promise<void>{
 await releaseNotificationVocabulary(pool);
 const state=(await pool.query<{baseline:boolean;registry:boolean}>("SELECT to_regclass('pilot_ticket.completion_dismissal_baseline') IS NOT NULL AS baseline,to_regclass('platform.schema_migration') IS NOT NULL AS registry")).rows[0];
 if(!state?.baseline)return;
 if(state.registry&&(await pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[COMPLETION_DISMISSAL_MIGRATION_ID])).rowCount)return;
 if(await completionDismissalNewValuesPresent(pool as never))throw Error('COMPLETION_DISMISSAL_SHARED_FIXTURE_ROWS_REMAIN');
 await transactionP2016(pool,tx=>restoreCompletionDismissalBaseline(tx));
}
async function releaseNotificationVocabulary(pool:Queryable&Pick<PostgresPool,'connect'>):Promise<void>{
 const state=(await pool.query<{baseline:boolean;registry:boolean}>("SELECT to_regclass('pilot_ticket.notification_vocabulary_baseline') IS NOT NULL AS baseline,to_regclass('platform.schema_migration') IS NOT NULL AS registry")).rows[0];
 if(!state?.baseline)return;
 if(state.registry&&(await pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[NOTIFICATION_VOCABULARY_MIGRATION_ID])).rowCount)return;
 if(await notificationVocabularyNewValuesPresent(pool as never))throw Error('NOTIFICATION_VOCABULARY_SHARED_FIXTURE_ROWS_REMAIN');
 await transactionP2016(pool,tx=>restoreNotificationVocabularyBaseline(tx));
}
