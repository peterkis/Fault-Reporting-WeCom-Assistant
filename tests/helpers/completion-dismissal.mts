import {checkedLoopbackDatabaseUrl,fixtureMigrationConnection} from '../../app/server/src/platform/loopback-database.mjs';
import {applyCompletionDismissalSql,restoreCompletionDismissalBaseline,COMPLETION_DISMISSAL_MIGRATION_ID,completionDismissalNewValuesPresent} from '../../app/server/scripts/completion-dismissal-migrate.mjs';
import {applyNotificationVocabularySql,restoreNotificationVocabularyBaseline,NOTIFICATION_VOCABULARY_MIGRATION_ID,notificationVocabularyNewValuesPresent} from '../../app/server/scripts/notification-vocabulary-migrate.mjs';
import {applySystemClosureRestoreSql,restoreSystemClosureRestoreBaseline,SYSTEM_CLOSURE_RESTORE_MIGRATION_ID,systemClosureRestoresPresent} from '../../app/server/scripts/system-closure-restore-migrate.mjs';
import {applyTicketTerminalAtSql} from '../../app/server/scripts/ticket-terminal-at-migrate.mjs';
import {createPostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import type {PostgresPool,PostgresTransaction} from '../../app/server/src/platform/postgres-pool.mjs';
import {transactionP2016} from '../../app/server/src/p2-016-domain-contracts.mjs';

/** Reapply the 072–074 closure vocabulary and the 075 terminal pair after a partial fixture migration chain.
 * Use only the fixture's owned database (pool or URL).
 */
export async function ensureCompletionDismissal(target:PostgresTransaction|string):Promise<void>{
 if(typeof target==='string'){
   const pool=createPostgresPool({...fixtureMigrationConnection(checkedLoopbackDatabaseUrl(target)),max:1,application_name:'completion_dismissal_fixture'});
   try{await ensureCompletionDismissal(pool);}finally{await pool.end();}
   return;
 }
 await applyCompletionDismissalSql(target);
 await applyNotificationVocabularySql(target);
 await applySystemClosureRestoreSql(target);
 await applyTicketTerminalAtSql(target);
}

/** Restore the historical 072–074 vocabulary baselines in partial-chain tests.
 * The fixture database owner releases 075 when it drops its database.
 */
export async function releaseCompletionDismissal(pool:PostgresTransaction&Pick<PostgresPool,'connect'>):Promise<void>{
 await releaseSystemClosureRestore(pool);
 await releaseNotificationVocabulary(pool);
 const state=(await pool.query<{baseline:boolean;registry:boolean}>("SELECT to_regclass('pilot_ticket.completion_dismissal_baseline') IS NOT NULL AS baseline,to_regclass('platform.schema_migration') IS NOT NULL AS registry")).rows[0];
 if(!state?.baseline)return;
 if(state.registry&&(await pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[COMPLETION_DISMISSAL_MIGRATION_ID])).rowCount)return;
 if(await completionDismissalNewValuesPresent(pool))throw Error('COMPLETION_DISMISSAL_SHARED_FIXTURE_ROWS_REMAIN');
 await transactionP2016(pool,tx=>restoreCompletionDismissalBaseline(tx));
}
async function releaseNotificationVocabulary(pool:PostgresTransaction&Pick<PostgresPool,'connect'>):Promise<void>{
 const state=(await pool.query<{baseline:boolean;registry:boolean}>("SELECT to_regclass('pilot_ticket.notification_vocabulary_baseline') IS NOT NULL AS baseline,to_regclass('platform.schema_migration') IS NOT NULL AS registry")).rows[0];
 if(!state?.baseline)return;
 if(state.registry&&(await pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[NOTIFICATION_VOCABULARY_MIGRATION_ID])).rowCount)return;
 if(await notificationVocabularyNewValuesPresent(pool))throw Error('NOTIFICATION_VOCABULARY_SHARED_FIXTURE_ROWS_REMAIN');
 await transactionP2016(pool,tx=>restoreNotificationVocabularyBaseline(tx));
}
async function releaseSystemClosureRestore(pool:PostgresTransaction&Pick<PostgresPool,'connect'>):Promise<void>{
 const state=(await pool.query<{column:boolean;registry:boolean}>("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='closure_record' AND column_name='restore_source') AS column,to_regclass('platform.schema_migration') IS NOT NULL AS registry")).rows[0];
 if(!state?.column)return;
 if(state.registry&&(await pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[SYSTEM_CLOSURE_RESTORE_MIGRATION_ID])).rowCount)return;
 if(await systemClosureRestoresPresent(pool))throw Error('SYSTEM_CLOSURE_RESTORE_SHARED_FIXTURE_ROWS_REMAIN');
 await transactionP2016(pool,tx=>restoreSystemClosureRestoreBaseline(tx));
}
