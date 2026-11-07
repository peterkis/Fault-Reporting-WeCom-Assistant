import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';
export const SERVICE_CLOSURE_MIGRATION_ID='071_unified_service_closure';
const file=new URL('../../../database/migrations/071_unified_service_closure.sql',import.meta.url);
export async function serviceClosureSchemaReady(tx:PostgresTransaction):Promise<boolean>{
 const checksum=createHash('sha256').update(await readFile(file)).digest('hex');
 const row=(await tx.query<{checksum_sha256:string;record:boolean;termination:boolean}>(`SELECT checksum_sha256,
  to_regclass('pilot_ticket.closure_record') IS NOT NULL AS record,to_regclass('pilot_ticket.closure_supplement_termination') IS NOT NULL AS termination
  FROM platform.schema_migration WHERE migration_id=$1`,[SERVICE_CLOSURE_MIGRATION_ID])).rows[0];
 return row?.checksum_sha256===checksum&&row.record&&row.termination;
}
/** Current closure-enabled roles must fail before timers, intake or network startup. */
export async function requireServiceClosureSchema({pool}:{pool:PostgresTransaction}):Promise<void>{
 let ready=false;
 try{ready=await serviceClosureSchemaReady(pool);}catch{ /* Missing base schema or unavailable DB is not ready. */ }
 if(!ready)throw new Error('SERVICE_CLOSURE_SCHEMA_REQUIRED');
}
export async function migrateServiceClosure({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'|'rollback'}){
 if(!databaseUrl||!['check','apply','rollback'].includes(mode))failP2016();
 const sql=await readFile(file,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
 const checksum=createHash('sha256').update(sql).digest('hex'),pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'service_closure_migrator'});
 try{return await transactionP2016(pool,async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('SERVICE_CLOSURE_MIGRATION'))");
  const existing=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[SERVICE_CLOSURE_MIGRATION_ID])).rows[0];
  if(existing){
   if(existing.checksum_sha256!==checksum||!await serviceClosureSchemaReady(tx))throw Error('SERVICE_CLOSURE_SCHEMA_DRIFT');
   if(mode!=='rollback')return {status:'NOOP_ALREADY_APPLIED',migration_id:SERVICE_CLOSURE_MIGRATION_ID};
   if((await tx.query('SELECT 1 FROM pilot_ticket.closure_record LIMIT 1')).rowCount
    ||(await tx.query("SELECT 1 FROM pilot_ticket.ticket_event WHERE event_type IN ('ticket.restored','ticket.handling_aborted') LIMIT 1")).rowCount
    ||(await tx.query("SELECT 1 FROM intake.service_intake_event WHERE event_type IN ('intake.closed','intake.restored') LIMIT 1")).rowCount)throw Error('SERVICE_CLOSURE_ROLLBACK_REQUIRES_EMPTY_FIXTURE');
   const definitions=(await tx.query<{ticket_event_check:string;intake_event_check:string;command_resource_check:string}>('SELECT ticket_event_check,intake_event_check,command_resource_check FROM pilot_ticket.closure_migration_baseline')).rows[0];
   if(!definitions)throw Error('SERVICE_CLOSURE_ROLLBACK_BASELINE_REQUIRED');
   await tx.query('ALTER TABLE pilot_ticket.ticket_event DROP CONSTRAINT ticket_event_type_check');
   await tx.query('ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT ticket_event_type_check '+definitions.ticket_event_check);
   await tx.query('ALTER TABLE intake.service_intake_event DROP CONSTRAINT service_intake_event_type_check');
   await tx.query('ALTER TABLE intake.service_intake_event ADD CONSTRAINT service_intake_event_type_check '+definitions.intake_event_check);
   await tx.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT p2016_command_resource');
   await tx.query('ALTER TABLE pilot_ticket.ticket_command_receipt ADD CONSTRAINT p2016_command_resource '+definitions.command_resource_check);
   await tx.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP COLUMN closure_intake_id');
   await tx.query('DROP TABLE pilot_ticket.closure_supplement_termination,pilot_ticket.closure_record,pilot_ticket.closure_migration_baseline');
   await tx.query('DELETE FROM platform.schema_migration WHERE migration_id=$1',[SERVICE_CLOSURE_MIGRATION_ID]);
   return {status:'ROLLED_BACK',migration_id:SERVICE_CLOSURE_MIGRATION_ID};
  }
  if(mode==='rollback')return {status:'NOT_APPLIED',migration_id:SERVICE_CLOSURE_MIGRATION_ID};
  if(mode==='check')return {status:'PENDING',migration_id:SERVICE_CLOSURE_MIGRATION_ID};
  const before=(await tx.query<{ticket:string;intake:string;resource:string}>(`SELECT
   (SELECT pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='ticket_event_type_check') AS ticket,
   (SELECT pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid='intake.service_intake_event'::regclass AND conname='service_intake_event_type_check') AS intake,
   (SELECT pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_command_receipt'::regclass AND conname='p2016_command_resource') AS resource`)).rows[0];
  if(!before?.ticket||!before.intake||!before.resource)throw Error('SERVICE_CLOSURE_BASELINE_REQUIRED');
  await tx.query(body);
  await tx.query('CREATE TABLE pilot_ticket.closure_migration_baseline(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),ticket_event_check text NOT NULL,intake_event_check text NOT NULL,command_resource_check text NOT NULL)');
  await tx.query('INSERT INTO pilot_ticket.closure_migration_baseline(ticket_event_check,intake_event_check,command_resource_check) VALUES($1,$2,$3)',[before.ticket,before.intake,before.resource]);
  await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[SERVICE_CLOSURE_MIGRATION_ID,checksum]);
  return {status:'APPLIED',migration_id:SERVICE_CLOSURE_MIGRATION_ID};
 });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--check','--apply','--rollback'].includes(arg)))throw Error('SERVICE_CLOSURE_ARGUMENT_INVALID');
 const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw Error('SERVICE_CLOSURE_DATABASE_URL_REQUIRED');
 try{console.log(JSON.stringify(await migrateServiceClosure({databaseUrl,mode:args[0]==='--apply'?'apply':args[0]==='--rollback'?'rollback':'check'})));}
 catch{console.error(JSON.stringify({ok:false,error_code:'SERVICE_CLOSURE_MIGRATION_FAILED'}));process.exitCode=1;}
}
