import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {failP2016} from '../src/p2-016-domain-contracts.mjs';

export const PERSONAL_READ_MIGRATION_ID='047_workbench_personal_read';
export async function personalReadSchemaReady(tx:PostgresTransaction):Promise<boolean>{
  const row=(await tx.query<{ready:boolean}>(`SELECT EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id=$1)
    AND EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id='042_workbench_manual_reports')
    AND to_regclass('pilot_ticket.personal_material_read_position') IS NOT NULL
    AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='ticket_command_receipt' AND column_name='source_intake_id' AND data_type='uuid') AS ready`,[PERSONAL_READ_MIGRATION_ID])).rows[0];
  return row?.ready===true;
}
export async function migrateWorkbenchPersonalRead({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'}){
  if(!databaseUrl||!['check','apply'].includes(mode))failP2016();
  const sql=await readFile(new URL('../database/migrations/'+PERSONAL_READ_MIGRATION_ID+'.sql',import.meta.url),'utf8');
  const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
  const checksum=createHash('sha256').update(sql).digest('hex');
  const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'workbench_personal_read_migrator'});
  const tx=await pool.connect();
  try{
    await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='60s'");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('WORKBENCH_PERSONAL_READ_MIGRATION'))");
    if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='031_p2_016_ticket_lifecycle_workbench_notifications'")).rowCount!==1)failP2016('ACTION_FAILED',409);
    if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='042_workbench_manual_reports'")).rowCount!==1)failP2016('ACTION_FAILED',409);
    const applied=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[PERSONAL_READ_MIGRATION_ID])).rows[0];
    if(applied){if(applied.checksum_sha256!==checksum||!await personalReadSchemaReady(tx))failP2016('ACTION_FAILED',409);await tx.query('ROLLBACK');return {status:'NOOP_ALREADY_APPLIED',migration_id:PERSONAL_READ_MIGRATION_ID};}
    await tx.query(body);
    await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[PERSONAL_READ_MIGRATION_ID,checksum]);
    if(!await personalReadSchemaReady(tx))failP2016('ACTION_FAILED',409);
    await tx.query(mode==='check'?'ROLLBACK':'COMMIT');return {status:mode==='check'?'CHECK_ROLLBACK_SUCCEEDED':'APPLIED',migration_id:PERSONAL_READ_MIGRATION_ID};
  }catch(error){await tx.query('ROLLBACK').catch(()=>{});throw error;}
  finally{tx.release();await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),databaseUrl=process.env.PILOT_DATABASE_URL;
  if(!databaseUrl||args.length>1||args.some(arg=>!['--check','--apply'].includes(arg)))throw Error('PERSONAL_READ_MIGRATION_INPUT_INVALID');
  try{console.log(JSON.stringify(await migrateWorkbenchPersonalRead({databaseUrl,mode:args[0]==='--apply'?'apply':'check'})));}
  catch{console.error(JSON.stringify({ok:false,error_code:'PERSONAL_READ_MIGRATION_FAILED'}));process.exitCode=1;}
}
