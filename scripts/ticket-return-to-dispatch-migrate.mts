import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';
import {followUpSchemaReady} from './workbench-follow-up-schedules-migrate.mjs';
export const RETURN_TO_DISPATCH_MIGRATION_ID='048_ticket_return_to_dispatch';
export const RETURN_FOLLOW_UP_COMPATIBILITY_MIGRATION_ID='057_ticket_return_follow_up_compatibility';
async function migrationSql(id:string){
 const sql=await readFile(new URL('../database/migrations/'+id+'.sql',import.meta.url),'utf8');
 const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
 return{body,checksum:createHash('sha256').update(sql).digest('hex')};
}
async function migrationTarget(tx:PostgresTransaction){
 if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('031_p2_016_ticket_lifecycle_workbench_notifications','039_ticket_self_handling_cycles','046_ticket_unassign')")).rowCount!==3)failP2016('RETURN_TO_DISPATCH_UNAVAILABLE',503);
 const followUp=(await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='049_workbench_follow_up_schedules'")).rowCount===1;
 if(followUp){if(!await followUpSchemaReady(tx))failP2016('RETURN_TO_DISPATCH_UNAVAILABLE',503);return RETURN_FOLLOW_UP_COMPATIBILITY_MIGRATION_ID;}
 if((await tx.query("SELECT to_regclass('pilot_ticket.follow_up_schedule') AS current_table,to_regclass('pilot_ticket.follow_up_schedule_revision') AS revision_table")).rows.some(row=>row.current_table!==null||row.revision_table!==null))failP2016('RETURN_TO_DISPATCH_UNAVAILABLE',503);
 return RETURN_TO_DISPATCH_MIGRATION_ID;
}
/** A 049-first installation requires a real 057 receipt; it never borrows or fabricates a 048 stamp. */
export async function returnToDispatchMigrationReady(tx:PostgresTransaction):Promise<boolean>{
 try{
  const id=await migrationTarget(tx),expected=await migrationSql(id),legacy=await migrationSql(RETURN_TO_DISPATCH_MIGRATION_ID);
  const stamps=await tx.query<{migration_id:string;checksum_sha256:unknown}>('SELECT migration_id,checksum_sha256 FROM platform.schema_migration WHERE migration_id=ANY($1::text[])',[[id,RETURN_TO_DISPATCH_MIGRATION_ID]]);
  if(stamps.rows.some(row=>row.migration_id===RETURN_TO_DISPATCH_MIGRATION_ID&&row.checksum_sha256!==legacy.checksum)
    ||!stamps.rows.some(row=>row.migration_id===id&&row.checksum_sha256===expected.checksum))return false;
  const row=(await tx.query<{type_check:unknown;metadata_check:unknown}>(`SELECT
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='ticket_event_type_check' AND contype='c' AND convalidated AND conenforced AND NOT condeferrable) AS type_check,
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='pilot_ticket.ticket_event'::regclass AND conname='p2016_assignment_metadata_check' AND contype='c' AND convalidated AND conenforced AND NOT condeferrable) AS metadata_check`)).rows[0];
  return typeof row?.type_check==='string'&&typeof row.metadata_check==='string'
    &&row.type_check.includes("'ticket.returned_to_dispatch'")&&row.metadata_check.includes("'ticket.returned_to_dispatch'")
    &&(id===RETURN_TO_DISPATCH_MIGRATION_ID||row.type_check.includes("'ticket.follow_up_scheduled'")&&row.type_check.includes("'ticket.follow_up_cancelled'"));
 }catch{return false;}
}
export async function migrateTicketReturnToDispatch({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'}) {
 if(!databaseUrl||!['check','apply'].includes(mode))failP2016();
 const legacy=await migrationSql(RETURN_TO_DISPATCH_MIGRATION_ID);
 const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'ticket_return_to_dispatch_migrator'});
 try{return await transactionP2016(pool,async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('TICKET_RETURN_TO_DISPATCH_MIGRATION'))");
  // Serialize the existing shared DDL before deciding whether 049 is committed.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('FOLLOW_UP_SCHEDULE_MIGRATION'))");
  const id=await migrationTarget(tx),selected=id===RETURN_TO_DISPATCH_MIGRATION_ID?legacy:await migrationSql(id);
  const old=await tx.query<{checksum_sha256:unknown}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[RETURN_TO_DISPATCH_MIGRATION_ID]);
  if(old.rows[0]&&old.rows[0].checksum_sha256!==legacy.checksum)failP2016('RETURN_TO_DISPATCH_UNAVAILABLE',503);
  const existing=await tx.query<{checksum_sha256:unknown}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[id]);
  if(existing.rows[0]){if(existing.rows[0].checksum_sha256!==selected.checksum||!await returnToDispatchMigrationReady(tx))failP2016('RETURN_TO_DISPATCH_UNAVAILABLE',503);return {status:'NOOP_ALREADY_APPLIED',migration_id:id};}
  if(mode==='check')return {status:'PENDING',migration_id:id};
  await tx.query(selected.body);
  await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
    INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
    SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[id,selected.checksum]);
  if(!await returnToDispatchMigrationReady(tx))failP2016('RETURN_TO_DISPATCH_UNAVAILABLE',503);
  return {status:'APPLIED',migration_id:id};
 });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--check','--apply'].includes(arg)))throw Error('RETURN_TO_DISPATCH_MIGRATION_ARGUMENT_INVALID');
 const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw Error('RETURN_TO_DISPATCH_DATABASE_URL_REQUIRED');
 try{console.log(JSON.stringify(await migrateTicketReturnToDispatch({databaseUrl,mode:args[0]==='--apply'?'apply':'check'})));}
 catch{console.error(JSON.stringify({ok:false,error_code:'RETURN_TO_DISPATCH_MIGRATION_FAILED'}));process.exitCode=1;}
}
