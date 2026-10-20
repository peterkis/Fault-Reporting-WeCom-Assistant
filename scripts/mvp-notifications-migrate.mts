import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {mvpNotificationSchemaReady} from '../src/mvp-notification-policy.mjs';
import {transactionP2016} from '../src/p2-016-domain-contracts.mjs';

export const MVP_NOTIFICATION_MIGRATION_ID='063_mvp_notifications_app_members';
function fail():never{throw Error('MVP_NOTIFICATION_SCHEMA_INVALID');}
export async function migrateMvpNotifications({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'}){
 if(!databaseUrl||!['check','apply'].includes(mode))fail();
 const sql=await readFile(new URL('../database/migrations/'+MVP_NOTIFICATION_MIGRATION_ID+'.sql',import.meta.url),'utf8');
 const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)fail();
 const checksum=createHash('sha256').update(sql).digest('hex');
 const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'mvp_notification_migrator'});
 try{return await transactionP2016(pool,async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('MVP_NOTIFICATION_MIGRATION'))");
  if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('033_yxx_self_service_intake','052_ticket_group_round_notifications')")).rowCount!==2)fail();
  const row=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[MVP_NOTIFICATION_MIGRATION_ID])).rows[0];
  if(row){if(row.checksum_sha256!==checksum||!await mvpNotificationSchemaReady(tx))fail();return {status:'NOOP_ALREADY_APPLIED',migration_id:MVP_NOTIFICATION_MIGRATION_ID};}
  if(mode==='check')return {status:'PENDING',migration_id:MVP_NOTIFICATION_MIGRATION_ID};
  await tx.query(body);
  await tx.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
    SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[MVP_NOTIFICATION_MIGRATION_ID,checksum]);
  if(!await mvpNotificationSchemaReady(tx))fail();
  return {status:'APPLIED',migration_id:MVP_NOTIFICATION_MIGRATION_ID};
 });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),databaseUrl=process.env.PILOT_DATABASE_URL;
 if(args.length>1||args.some(arg=>!['--check','--apply'].includes(arg))||!databaseUrl)fail();
 await migrateMvpNotifications({databaseUrl,mode:args[0]==='--apply'?'apply':'check'}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('MVP_NOTIFICATION_MIGRATION_FAILED');process.exitCode=1;});
}
