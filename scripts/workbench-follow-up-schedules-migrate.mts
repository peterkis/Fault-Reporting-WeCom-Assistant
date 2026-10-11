import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';

export const FOLLOW_UP_MIGRATION_ID='049_workbench_follow_up_schedules';
const file=new URL('../database/migrations/049_workbench_follow_up_schedules.sql',import.meta.url);
export async function followUpSchemaReady(queryable:PostgresTransaction):Promise<boolean>{
  const checksum=createHash('sha256').update(await readFile(file,'utf8')).digest('hex');
  const result=await queryable.query<{checksum_sha256:unknown;current_table:unknown;revision_table:unknown;current_time_pair:boolean;revision_time_pair:boolean}>(`SELECT checksum_sha256,
    to_regclass('pilot_ticket.follow_up_schedule')::text AS current_table,to_regclass('pilot_ticket.follow_up_schedule_revision')::text AS revision_table,
    EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('pilot_ticket.follow_up_schedule')
      AND c.conname='follow_up_current_time_pair' AND c.contype='c' AND c.convalidated AND c.conenforced AND NOT c.condeferrable) AS current_time_pair,
    EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=to_regclass('pilot_ticket.follow_up_schedule_revision')
      AND c.conname='follow_up_revision_time_pair' AND c.contype='c' AND c.convalidated AND c.conenforced AND NOT c.condeferrable) AS revision_time_pair
    FROM platform.schema_migration WHERE migration_id=$1`,[FOLLOW_UP_MIGRATION_ID]);
  const row=result.rows[0];return row?.checksum_sha256===checksum&&row.current_table==='pilot_ticket.follow_up_schedule'&&row.revision_table==='pilot_ticket.follow_up_schedule_revision'
    &&row.current_time_pair===true&&row.revision_time_pair===true;
}
export async function migrateWorkbenchFollowUpSchedules({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'}){
  if(!databaseUrl||!['check','apply'].includes(mode))failP2016();
  const sql=await readFile(file,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
  const checksum=createHash('sha256').update(sql).digest('hex');
  const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'follow_up_schedule_migrator'});
  try{return await transactionP2016(pool,async transaction=>{
    await transaction.query("SELECT pg_advisory_xact_lock(hashtext('FOLLOW_UP_SCHEDULE_MIGRATION'))");
    if((await transaction.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='031_p2_016_ticket_lifecycle_workbench_notifications'")).rowCount!==1)failP2016('FOLLOW_UP_UNAVAILABLE',503);
    const existing=await transaction.query<{checksum_sha256:unknown}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[FOLLOW_UP_MIGRATION_ID]);
    if(existing.rows[0]){
      if(existing.rows[0].checksum_sha256!==checksum||!await followUpSchemaReady(transaction))failP2016('FOLLOW_UP_UNAVAILABLE',503);
      return {status:'NOOP_ALREADY_APPLIED',migration_id:FOLLOW_UP_MIGRATION_ID};
    }
    if(mode==='check')return {status:'PENDING',migration_id:FOLLOW_UP_MIGRATION_ID};
    if((await transaction.query("SELECT to_regclass('pilot_ticket.follow_up_schedule') AS current_table,to_regclass('pilot_ticket.follow_up_schedule_revision') AS revision_table")).rows.some(row=>row.current_table!==null||row.revision_table!==null))failP2016('FOLLOW_UP_UNAVAILABLE',503);
    await transaction.query(body);
    await transaction.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
      INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[FOLLOW_UP_MIGRATION_ID,checksum]);
    if(!await followUpSchemaReady(transaction))failP2016('FOLLOW_UP_UNAVAILABLE',503);
    return {status:'APPLIED',migration_id:FOLLOW_UP_MIGRATION_ID};
  });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--check','--apply'].includes(arg)))throw Error('FOLLOW_UP_MIGRATION_ARGUMENT_INVALID');
  const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw Error('FOLLOW_UP_DATABASE_URL_REQUIRED');
  try{console.log(JSON.stringify(await migrateWorkbenchFollowUpSchedules({databaseUrl,mode:args[0]==='--apply'?'apply':'check'})));}
  catch{console.error(JSON.stringify({ok:false,error_code:'FOLLOW_UP_MIGRATION_FAILED'}));process.exitCode=1;}
}
