import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import {ticketReporterProfilesSchemaReady} from '../src/ticket-reporter-profiles.mjs';

export const TICKET_REPORTER_PROFILES_MIGRATION_ID='067_ticket_reporter_profiles';
function invalid():never{throw Error('TICKET_REPORTER_PROFILES_MIGRATION_INVALID');}
export async function migrateTicketReporterProfiles({databaseUrl,expectedDatabase,mode='check'}:{databaseUrl:string;expectedDatabase:string;mode?:'check'|'apply'}){
 if(!databaseUrl||!expectedDatabase||!['check','apply'].includes(mode))invalid();
 const sql=await readFile(new URL('../../../database/migrations/'+TICKET_REPORTER_PROFILES_MIGRATION_ID+'.sql',import.meta.url),'utf8');
 const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)invalid();
 const checksum=createHash('sha256').update(sql).digest('hex');
 const pool=createPostgresPool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'ticket_reporter_profiles_migrator'});
 try{return await transactionP2016(pool,async tx=>{
  await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='30s'");
  if((await tx.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name!==expectedDatabase)invalid();
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('TICKET_REPORTER_PROFILES_MIGRATION'))");
  for(const id of ['030_p2_015_rule_first_intake_orchestration','031_p2_016_ticket_lifecycle_workbench_notifications']){
   const prior=await readFile(new URL('../../../database/migrations/'+id+'.sql',import.meta.url),'utf8');
   if((await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[id])).rows[0]?.checksum_sha256!==createHash('sha256').update(prior).digest('hex'))invalid();
  }
  const marker=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[TICKET_REPORTER_PROFILES_MIGRATION_ID])).rows[0];
  if(marker){if(marker.checksum_sha256!==checksum||!await ticketReporterProfilesSchemaReady(tx))invalid();return {status:'NOOP_ALREADY_APPLIED',migration_id:TICKET_REPORTER_PROFILES_MIGRATION_ID};}
  if((await tx.query<{present:boolean}>("SELECT to_regclass('intake.ticket_reporter_profile') IS NOT NULL OR to_regprocedure('intake.guard_ticket_reporter_profile_source()') IS NOT NULL AS present")).rows[0]?.present!==false)invalid();
  if(mode==='check')return {status:'PENDING',migration_id:TICKET_REPORTER_PROFILES_MIGRATION_ID};
  await tx.query(body);
  await tx.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
   SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[TICKET_REPORTER_PROFILES_MIGRATION_ID,checksum]);
  if(!await ticketReporterProfilesSchemaReady(tx))invalid();
  return {status:'APPLIED',migration_id:TICKET_REPORTER_PROFILES_MIGRATION_ID};
 });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),databaseUrl=process.env.PILOT_DATABASE_URL,expectedDatabase=process.env.WORKBENCH_EXPECTED_DATABASE;
 if(args.length>1||args.some(arg=>!['--check','--apply'].includes(arg))||!databaseUrl||!expectedDatabase)invalid();
 await migrateTicketReporterProfiles({databaseUrl,expectedDatabase,mode:args[0]==='--apply'?'apply':'check'}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('TICKET_REPORTER_PROFILES_MIGRATION_FAILED');process.exitCode=1;});
}
