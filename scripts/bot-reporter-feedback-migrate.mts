import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';
export const BOT_FEEDBACK_MIGRATION_ID='050_bot_reporter_feedback';
export async function migrateBotReporterFeedback({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'}){
  if(!databaseUrl||!['check','apply'].includes(mode))failP2016();
  const sql=await readFile(new URL('../database/migrations/050_bot_reporter_feedback.sql',import.meta.url),'utf8');
  const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
  const checksum=createHash('sha256').update(sql).digest('hex');
  const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'bot_reporter_feedback_migrator'});
  try{return await transactionP2016(pool,async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('BOT_REPORTER_FEEDBACK_MIGRATION'))");
    if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('031_p2_016_ticket_lifecycle_workbench_notifications','043_ticket_reopen_rounds')")).rowCount!==2)failP2016('ACTION_FAILED',409);
    const applied=await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[BOT_FEEDBACK_MIGRATION_ID]);
    if(applied.rows[0]){if(applied.rows[0].checksum_sha256!==checksum)failP2016('ACTION_FAILED',409);return {status:'NOOP_ALREADY_APPLIED',migration_id:BOT_FEEDBACK_MIGRATION_ID};}
    if(mode==='check')return {status:'PENDING',migration_id:BOT_FEEDBACK_MIGRATION_ID};
    await tx.query(body);
    await tx.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch)
      INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[BOT_FEEDBACK_MIGRATION_ID,checksum]);
    return {status:'APPLIED',migration_id:BOT_FEEDBACK_MIGRATION_ID};
  });}finally{await pool.end();}
}
