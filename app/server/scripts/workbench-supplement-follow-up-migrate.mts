import {createHash} from 'node:crypto';
import {readReadyFollowReceipt} from './workbench-follow-migrate.mjs';
import {projectWorkbenchCatalog,workbenchReadinessCatalog} from './workbench-readiness-catalog.mjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {failP2016} from '../src/p2-016-domain-contracts.mjs';
export const SUPPLEMENT_FOLLOW_UP_MIGRATION_ID='062_workbench_supplement_follow_up';
const FILE=new URL('../../../database/migrations/'+SUPPLEMENT_FOLLOW_UP_MIGRATION_ID+'.sql',import.meta.url);
const RELATIONS=['pilot_ticket.workbench_supplement_disposition','pilot_ticket.workbench_supplement_reply_binding'];
// Frozen after the actual isolated PG18 catalog-only preparation; never a business PASS.
export const SUPPLEMENT_CATALOG_SHA256='b97aa3cf902bf60307de2500e0d1c3e547ca2ea4f142cf8def07f635a9a50c97';
export async function supplementFollowUpCatalog(tx:PostgresTransaction){
 return workbenchReadinessCatalog(tx, RELATIONS, 'supplement');
}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function supplementFollowUpSchemaReady(tx:PostgresTransaction):Promise<boolean>{
 const present=(await tx.query<{present:boolean}>("SELECT to_regclass('platform.schema_migration') IS NOT NULL AS present")).rows[0];if(!present?.present)return false;
 const receipt=await readReadyFollowReceipt(tx, {
   prerequisite: {migrationId: SUPPLEMENT_FOLLOW_UP_MIGRATION_ID, checksum: async () => sha(await readFile(FILE,'utf8'))},
   catalogRelations: RELATIONS,
 });
 if(!receipt)return false;
 const catalog=projectWorkbenchCatalog(receipt.catalog, RELATIONS, 'supplement');
 const indexes=await receipt.priorIndexes(RELATIONS,catalog.indexes);
 return indexes!==null&&sha(JSON.stringify({...catalog,indexes}))===SUPPLEMENT_CATALOG_SHA256;
}
export async function migrateWorkbenchSupplementFollowUp({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'|'status'}){
 if(!databaseUrl||!['check','apply','status'].includes(mode))failP2016();
 const sql=await readFile(FILE,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
 const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'workbench_supplement_follow_up_migrator'}),tx=await pool.connect();
 try{
  await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='60s'");await tx.query("SELECT pg_advisory_xact_lock(hashtext('WORKBENCH_SUPPLEMENT_FOLLOW_UP_MIGRATION'))");
  if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='031_p2_016_ticket_lifecycle_workbench_notifications'")).rowCount!==1)failP2016('ACTION_FAILED',409);
  const old=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[SUPPLEMENT_FOLLOW_UP_MIGRATION_ID])).rows[0];
  if(old){if(old.checksum_sha256!==sha(sql)||!await supplementFollowUpSchemaReady(tx))failP2016('ACTION_FAILED',409);await tx.query('ROLLBACK');return {status:'NOOP_ALREADY_APPLIED',migration_id:SUPPLEMENT_FOLLOW_UP_MIGRATION_ID};}
  if(mode==='status'){await tx.query('ROLLBACK');return {status:'PENDING',migration_id:SUPPLEMENT_FOLLOW_UP_MIGRATION_ID};}
  await tx.query(body);await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
   SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[SUPPLEMENT_FOLLOW_UP_MIGRATION_ID,sha(sql)]);
  if(!await supplementFollowUpSchemaReady(tx))failP2016('ACTION_FAILED',409);
  await tx.query(mode==='check'?'ROLLBACK':'COMMIT');return {status:mode==='check'?'CHECK_ROLLBACK_SUCCEEDED':'APPLIED',migration_id:SUPPLEMENT_FOLLOW_UP_MIGRATION_ID};
 }catch(error){await tx.query('ROLLBACK').catch(()=>{});throw error;}finally{tx.release();await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl||args.length>1||args.some(v=>!['--check','--apply','--status'].includes(v)))throw Error('SUPPLEMENT_MIGRATION_INPUT_INVALID');
 try{console.log(JSON.stringify(await migrateWorkbenchSupplementFollowUp({databaseUrl,mode:args[0]==='--apply'?'apply':args[0]==='--status'?'status':'check'})));}
 catch{console.error(JSON.stringify({ok:false,error_code:'SUPPLEMENT_MIGRATION_FAILED'}));process.exitCode=1;}
}
