import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';

/** ADR-0058: Ticket COMPLETED / DISMISSED, Intake DISMISSED, ticket.completed / ticket.dismissed / intake.dismissed, TICKET_COMPLETED. */
export const COMPLETION_DISMISSAL_MIGRATION_ID='072_ticket_completion_dismissal';
const file=new URL('../../../database/migrations/072_ticket_completion_dismissal.sql',import.meta.url);
async function source(){const sql=await readFile(file,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();return {sql,body,checksum:createHash('sha256').update(sql).digest('hex')};}

/**
 * Applies the 072 body inside the caller's transaction without registering it. For isolated test databases built from a partial
 * migration chain (some have no `platform.schema_migration`); call it after every other migration of that chain.
 */
export async function applyCompletionDismissalSql(tx:Pick<PostgresTransaction,'query'>):Promise<void>{
 const {body}=await source();
 await tx.query(body);
}

export async function completionDismissalSchemaReady(tx:PostgresTransaction):Promise<boolean>{
 const {checksum}=await source();
 const row=(await tx.query<{checksum_sha256:string;baseline:boolean}>(`SELECT checksum_sha256,to_regclass('pilot_ticket.completion_dismissal_baseline') IS NOT NULL AS baseline
  FROM platform.schema_migration WHERE migration_id=$1`,[COMPLETION_DISMISSAL_MIGRATION_ID])).rows[0];
 return row?.checksum_sha256===checksum&&row.baseline;
}
/** Roles that write ticket or intake status must fail before timers, intake or network startup when 072 is missing. */
export async function requireCompletionDismissalSchema({pool}:{pool:PostgresTransaction}):Promise<void>{
 let ready=false;
 try{ready=await completionDismissalSchemaReady(pool);}catch{ /* Missing base schema or unavailable DB is not ready. */ }
 if(!ready)throw new Error('COMPLETION_DISMISSAL_SCHEMA_REQUIRED');
}

/** Restores the recorded pre-072 constraint and function definitions and drops the baseline table. Never touches data. */
export async function restoreCompletionDismissalBaseline(tx:Pick<PostgresTransaction,'query'>):Promise<void>{
 const baseline=(await tx.query<{object_kind:'CONSTRAINT'|'FUNCTION';object_name:string;relation:string|null;definition:string}>(
  'SELECT object_kind,object_name,relation,definition FROM pilot_ticket.completion_dismissal_baseline ORDER BY object_kind,object_name')).rows;
 if(!baseline.length)throw Error('COMPLETION_DISMISSAL_ROLLBACK_BASELINE_REQUIRED');
 for(const row of baseline){
  if(row.object_kind==='FUNCTION'){await tx.query(row.definition);continue;}
  if(!row.relation)throw Error('COMPLETION_DISMISSAL_ROLLBACK_BASELINE_REQUIRED');
  const relation=row.relation.split('.').map(part=>'"'+part.replaceAll('"','""')+'"').join('.'),name='"'+row.object_name.replaceAll('"','""')+'"';
  await tx.query('ALTER TABLE '+relation+' DROP CONSTRAINT '+name);
  await tx.query('ALTER TABLE '+relation+' ADD CONSTRAINT '+name+' '+row.definition);
 }
 await tx.query('DROP TABLE pilot_ticket.completion_dismissal_baseline');
}

/** Rows that hold the 072 vocabulary; rollback refuses while any exist because it never maps data back. */
export const COMPLETION_DISMISSAL_NEW_VALUE_PROBES=[
 "SELECT 1 FROM pilot_ticket.ticket WHERE status IN ('COMPLETED','DISMISSED') LIMIT 1",
 "SELECT 1 FROM pilot_ticket.ticket_event WHERE new_status IN ('COMPLETED','DISMISSED') OR old_status IN ('COMPLETED','DISMISSED') OR event_type IN ('ticket.completed','ticket.dismissed') LIMIT 1",
 "SELECT 1 FROM intake.service_intake WHERE status='DISMISSED' LIMIT 1",
 "SELECT 1 FROM intake.service_intake_event WHERE event_type='intake.dismissed' LIMIT 1",
] as const;

export async function migrateCompletionDismissal({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'|'rollback'}){
 if(!databaseUrl||!['check','apply','rollback'].includes(mode))failP2016();
 const {body,checksum}=await source(),pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'completion_dismissal_migrator'});
 try{return await transactionP2016(pool,async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('COMPLETION_DISMISSAL_MIGRATION'))");
  const existing=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[COMPLETION_DISMISSAL_MIGRATION_ID])).rows[0];
  if(existing){
   if(existing.checksum_sha256!==checksum||!await completionDismissalSchemaReady(tx))throw Error('COMPLETION_DISMISSAL_SCHEMA_DRIFT');
   if(mode!=='rollback')return {status:'NOOP_ALREADY_APPLIED',migration_id:COMPLETION_DISMISSAL_MIGRATION_ID};
   // Rollback restores the pre-072 vocabulary; it never maps data, so the database must hold no new-value rows.
   for(const probe of COMPLETION_DISMISSAL_NEW_VALUE_PROBES)if((await tx.query(probe)).rowCount)throw Error('COMPLETION_DISMISSAL_ROLLBACK_REQUIRES_EMPTY_FIXTURE');
   await restoreCompletionDismissalBaseline(tx);
   await tx.query('DELETE FROM platform.schema_migration WHERE migration_id=$1',[COMPLETION_DISMISSAL_MIGRATION_ID]);
   return {status:'ROLLED_BACK',migration_id:COMPLETION_DISMISSAL_MIGRATION_ID};
  }
  if(mode==='rollback')return {status:'NOT_APPLIED',migration_id:COMPLETION_DISMISSAL_MIGRATION_ID};
  if(mode==='check')return {status:'PENDING',migration_id:COMPLETION_DISMISSAL_MIGRATION_ID};
  await tx.query(body);
  await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
   SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[COMPLETION_DISMISSAL_MIGRATION_ID,checksum]);
  return {status:'APPLIED',migration_id:COMPLETION_DISMISSAL_MIGRATION_ID};
 });}finally{await pool.end();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--check','--apply','--rollback'].includes(arg)))throw Error('COMPLETION_DISMISSAL_ARGUMENT_INVALID');
 const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw Error('COMPLETION_DISMISSAL_DATABASE_URL_REQUIRED');
 try{console.log(JSON.stringify(await migrateCompletionDismissal({databaseUrl,mode:args[0]==='--apply'?'apply':args[0]==='--rollback'?'rollback':'check'})));}
 catch(error){console.error(JSON.stringify({ok:false,error_code:'COMPLETION_DISMISSAL_MIGRATION_FAILED',detail:error instanceof Error?error.message.slice(0,200):null}));process.exitCode=1;}
}
