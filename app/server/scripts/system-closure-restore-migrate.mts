import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';

/** ADR-0056 supplement: system restoration of a system out-of-scope Intake closure (restored_by empty, restore_source SYSTEM). */
export const SYSTEM_CLOSURE_RESTORE_MIGRATION_ID='074_system_closure_restore';
const file=new URL('../../../database/migrations/074_system_closure_restore.sql',import.meta.url);
/** The pre-074 restoration rule (071 with the 073 ended_at name); rollback puts it back. */
const ORIGINAL_RESTORE_CHECK=`CHECK((restored_at IS NULL AND restored_by IS NULL AND restoration_event_id IS NULL)
 OR (restored_at IS NOT NULL AND restored_by IS NOT NULL AND restoration_event_id IS NOT NULL AND restored_at>=ended_at))`;
async function source(){const sql=await readFile(file,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();return {sql,body,checksum:createHash('sha256').update(sql).digest('hex')};}

/**
 * Applies the 074 body inside the caller's transaction without registering it. For isolated test databases built from a partial
 * migration chain; call it after 073. Without the closure record table (a chain before 071) it does nothing.
 */
export async function applySystemClosureRestoreSql(tx:Pick<PostgresTransaction,'query'>):Promise<void>{
 const {body}=await source();
 await tx.query(body);
}

export async function systemClosureRestoreSchemaReady(tx:Pick<PostgresTransaction,'query'>):Promise<boolean>{
 const {checksum}=await source();
 const row=(await tx.query<{checksum_sha256:string;column:boolean}>(`SELECT checksum_sha256,EXISTS(SELECT 1 FROM information_schema.columns
   WHERE table_schema='pilot_ticket' AND table_name='closure_record' AND column_name='restore_source') AS column
  FROM platform.schema_migration WHERE migration_id=$1`,[SYSTEM_CLOSURE_RESTORE_MIGRATION_ID])).rows[0];
 return row?.checksum_sha256===checksum&&row.column;
}
/** Roles that process Web self-service input must fail before startup when 074 is missing. */
export async function requireSystemClosureRestoreSchema({pool}:{pool:Pick<PostgresTransaction,'query'>}):Promise<void>{
 let ready=false;
 try{ready=await systemClosureRestoreSchemaReady(pool);}catch{ /* Missing base schema or unavailable DB is not ready. */ }
 if(!ready)throw new Error('SYSTEM_CLOSURE_RESTORE_SCHEMA_REQUIRED');
}

/** System restorations exist only under 074; rollback refuses while any exist because it never rewrites them. */
export async function systemClosureRestoresPresent(tx:Pick<PostgresTransaction,'query'>):Promise<boolean>{
 return Boolean((await tx.query("SELECT 1 FROM pilot_ticket.closure_record WHERE restored_at IS NOT NULL AND restored_by IS NULL LIMIT 1")).rowCount);
}
/** Restores the pre-074 restoration rule and drops the derived column. Never maps or deletes data. */
export async function restoreSystemClosureRestoreBaseline(tx:Pick<PostgresTransaction,'query'>):Promise<void>{
 await tx.query('ALTER TABLE pilot_ticket.closure_record DROP CONSTRAINT closure_restore_actor');
 await tx.query('ALTER TABLE pilot_ticket.closure_record ADD CONSTRAINT closure_restore_actor '+ORIGINAL_RESTORE_CHECK);
 await tx.query('ALTER TABLE pilot_ticket.closure_record DROP COLUMN restore_source');
}

export async function migrateSystemClosureRestore({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'|'rollback'}){
 if(!databaseUrl||!['check','apply','rollback'].includes(mode))failP2016();
 const {body,checksum}=await source(),pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'system_closure_restore_migrator'});
 try{return await transactionP2016(pool,async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('SYSTEM_CLOSURE_RESTORE_MIGRATION'))");
  const existing=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[SYSTEM_CLOSURE_RESTORE_MIGRATION_ID])).rows[0];
  if(existing){
   if(existing.checksum_sha256!==checksum||!await systemClosureRestoreSchemaReady(tx))throw Error('SYSTEM_CLOSURE_RESTORE_SCHEMA_DRIFT');
   if(mode!=='rollback')return {status:'NOOP_ALREADY_APPLIED',migration_id:SYSTEM_CLOSURE_RESTORE_MIGRATION_ID};
   if(await systemClosureRestoresPresent(tx))throw Error('SYSTEM_CLOSURE_RESTORE_ROLLBACK_REQUIRES_EMPTY_FIXTURE');
   await restoreSystemClosureRestoreBaseline(tx);
   await tx.query('DELETE FROM platform.schema_migration WHERE migration_id=$1',[SYSTEM_CLOSURE_RESTORE_MIGRATION_ID]);
   return {status:'ROLLED_BACK',migration_id:SYSTEM_CLOSURE_RESTORE_MIGRATION_ID};
  }
  if(mode==='rollback')return {status:'NOT_APPLIED',migration_id:SYSTEM_CLOSURE_RESTORE_MIGRATION_ID};
  if(mode==='check')return {status:'PENDING',migration_id:SYSTEM_CLOSURE_RESTORE_MIGRATION_ID};
  if((await tx.query<{present:boolean}>("SELECT to_regclass('pilot_ticket.closure_record') IS NOT NULL AS present")).rows[0]?.present!==true)throw Error('SYSTEM_CLOSURE_RESTORE_REQUIRES_071');
  await tx.query(body);
  await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
   SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[SYSTEM_CLOSURE_RESTORE_MIGRATION_ID,checksum]);
  return {status:'APPLIED',migration_id:SYSTEM_CLOSURE_RESTORE_MIGRATION_ID};
 });}finally{await pool.end();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--check','--apply','--rollback'].includes(arg)))throw Error('SYSTEM_CLOSURE_RESTORE_ARGUMENT_INVALID');
 const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw Error('SYSTEM_CLOSURE_RESTORE_DATABASE_URL_REQUIRED');
 try{console.log(JSON.stringify(await migrateSystemClosureRestore({databaseUrl,mode:args[0]==='--apply'?'apply':args[0]==='--rollback'?'rollback':'check'})));}
 catch(error){console.error(JSON.stringify({ok:false,error_code:'SYSTEM_CLOSURE_RESTORE_MIGRATION_FAILED',detail:error instanceof Error?error.message.slice(0,200):null}));process.exitCode=1;}
}
