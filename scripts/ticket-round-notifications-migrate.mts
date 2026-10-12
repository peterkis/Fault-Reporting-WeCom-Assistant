import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';

export const ROUND_NOTIFICATION_MIGRATION_ID='041_ticket_round_notifications';
export async function migrateTicketRoundNotifications({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'}) {
  if(!databaseUrl||!['check','apply'].includes(mode))failP2016();
  const sql=await readFile(new URL('../database/migrations/'+ROUND_NOTIFICATION_MIGRATION_ID+'.sql',import.meta.url),'utf8');
  const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
  const checksum=createHash('sha256').update(sql).digest('hex');
  const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'ticket_round_notification_migrator'});
  try{return await transactionP2016(pool,async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('TICKET_ROUND_NOTIFICATION_MIGRATION'))");
    const previous=await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='040_ticket_staff_completion'");
    if(previous.rowCount!==1)failP2016('ACTION_FAILED',409);
    const applied=await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[ROUND_NOTIFICATION_MIGRATION_ID]);
    const upgradeGroups=async()=>{
      if(mode!=='apply')return;
      const id='052_ticket_group_round_notifications';
      const next=await readFile(new URL('../database/migrations/'+id+'.sql',import.meta.url),'utf8');
      const nextBody=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(next)?.[1];if(!nextBody)failP2016();
      const nextChecksum=createHash('sha256').update(next).digest('hex');
      const existing=await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[id]);
      if(existing.rows[0]){if(existing.rows[0].checksum_sha256!==nextChecksum)failP2016('ACTION_FAILED',409);return;}
      await tx.query(nextBody);
      await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
        INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
        SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[id,nextChecksum]);
    };
    if(applied.rows[0]){
      if(applied.rows[0].checksum_sha256!==checksum)failP2016('ACTION_FAILED',409);
      await upgradeGroups();
      return {status:'NOOP_ALREADY_APPLIED',migration_id:ROUND_NOTIFICATION_MIGRATION_ID};
    }
    if(mode==='check')return {status:'PENDING',migration_id:ROUND_NOTIFICATION_MIGRATION_ID};
    await tx.query(body);
    await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
      INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[ROUND_NOTIFICATION_MIGRATION_ID,checksum]);
    await upgradeGroups();
    return {status:'APPLIED',migration_id:ROUND_NOTIFICATION_MIGRATION_ID};
  });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length>1||args.some(arg=>!['--check','--apply'].includes(arg)))throw new Error('ROUND_NOTIFICATION_MIGRATION_ARGUMENT_INVALID');
  const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw new Error('ROUND_NOTIFICATION_DATABASE_URL_REQUIRED');
  try{console.log(JSON.stringify(await migrateTicketRoundNotifications({databaseUrl,mode:args[0]==='--apply'?'apply':'check'})));}
  catch{console.error(JSON.stringify({ok:false,error_code:'ROUND_NOTIFICATION_MIGRATION_FAILED'}));process.exitCode=1;}
}
