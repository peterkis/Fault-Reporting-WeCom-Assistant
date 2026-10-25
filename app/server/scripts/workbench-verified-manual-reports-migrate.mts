import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';
export const VERIFIED_MANUAL_REPORT_MIGRATION_ID='045_workbench_verified_manual_reports';
const required=[VERIFIED_MANUAL_REPORT_MIGRATION_ID,'051_workbench_verified_manual_report_candidate_ref_check'];
export async function migrateWorkbenchVerifiedManualReports({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'}){
  if(!databaseUrl||!['check','apply'].includes(mode))failP2016();
  const migrations=await Promise.all(required.map(async id=>{
    const sql=await readFile(new URL('../../../database/migrations/'+id+'.sql',import.meta.url),'utf8');
    const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
    return {id,body,checksum:createHash('sha256').update(sql).digest('hex')};
  }));
  const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'verified_manual_reports_migrator'});
  try{return await transactionP2016(pool,async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('VERIFIED_MANUAL_REPORTS_MIGRATION'))");
    if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='042_workbench_manual_reports'")).rowCount!==1)failP2016('ACTION_FAILED',409);
    const missing:typeof migrations=[];
    for(const migration of migrations){
      const old=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[migration.id])).rows[0];
      if(old){if(old.checksum_sha256!==migration.checksum)failP2016('ACTION_FAILED',409);}else missing.push(migration);
    }
    if(!missing.length)return {status:'NOOP_ALREADY_APPLIED',migration_id:VERIFIED_MANUAL_REPORT_MIGRATION_ID};
    if(mode==='check')return {status:'PENDING',migration_id:VERIFIED_MANUAL_REPORT_MIGRATION_ID};
    for(const migration of missing){
      await tx.query(migration.body);
      await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[migration.id,migration.checksum]);
    }
    return {status:'APPLIED',migration_id:VERIFIED_MANUAL_REPORT_MIGRATION_ID};
  });}finally{await pool.end();}
}
