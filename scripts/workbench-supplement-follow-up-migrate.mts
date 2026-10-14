import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {failP2016} from '../src/p2-016-domain-contracts.mjs';
export const SUPPLEMENT_FOLLOW_UP_MIGRATION_ID='062_workbench_supplement_follow_up';
const FILE=new URL('../database/migrations/'+SUPPLEMENT_FOLLOW_UP_MIGRATION_ID+'.sql',import.meta.url);
const RELATIONS=['pilot_ticket.workbench_supplement_disposition'];
// Frozen after the actual isolated PG18 catalog-only preparation; never a business PASS.
export const SUPPLEMENT_CATALOG_SHA256='UNFROZEN_FAIL_CLOSED';
export async function supplementFollowUpCatalog(tx:PostgresTransaction){
 const relations=(await tx.query(`SELECT n.nspname||'.'||c.relname AS relation,c.relkind,c.relpersistence,c.relispartition,c.relrowsecurity,c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=ANY($1::text[]) ORDER BY relation`,[RELATIONS])).rows;
 const columns=(await tx.query(`SELECT n.nspname||'.'||c.relname AS relation,a.attname AS name,a.attnum AS ordinal,format_type(a.atttypid,a.atttypmod) AS type,
  a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expression
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname||'.'||c.relname=ANY($1::text[]) ORDER BY relation,ordinal`,[RELATIONS])).rows;
 const constraints=(await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,c.conname AS name,c.contype AS type,c.convalidated AS validated,c.condeferrable AS deferrable,
  c.condeferred AS deferred,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name`,[RELATIONS])).rows;
 const indexes=(await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,c.relname AS name,i.indisvalid AS valid,i.indisready AS ready,i.indisunique AS unique,i.indisprimary AS primary,
  pg_get_indexdef(c.oid) AS definition FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name`,[RELATIONS])).rows;
 const triggers=(await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,t.tgname AS name FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name`,[RELATIONS])).rows;
 return {relations,columns,constraints,indexes,triggers};
}
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function supplementFollowUpSchemaReady(tx:PostgresTransaction):Promise<boolean>{
 const present=(await tx.query<{present:boolean}>("SELECT to_regclass('platform.schema_migration') IS NOT NULL AS present")).rows[0];if(!present?.present)return false;
 const row=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[SUPPLEMENT_FOLLOW_UP_MIGRATION_ID])).rows[0];
 return row?.checksum_sha256===sha(await readFile(FILE,'utf8'))&&sha(JSON.stringify(await supplementFollowUpCatalog(tx)))===SUPPLEMENT_CATALOG_SHA256;
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
