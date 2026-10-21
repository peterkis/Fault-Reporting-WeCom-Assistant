// Explicit maintenance for the H5 schema; never enables runtime feature flags.
// All new DDL and ARCH005 receipts commit together under the existing pool boundary.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import {followUpDueSchemaReady} from './workbench-follow-up-due-migrate.mjs';
import {mvpNotificationSchemaReady} from '../src/mvp-notification-policy.mjs';
import {assertH5MigrationStructure} from './h5-migration-structure.mjs';

const migrations=[
  '064_yixiaoxiu_h5_member_service',
  '065_yixiaoxiu_h5_web_media',
  '066_yixiaoxiu_h5_media_previews',
] as const;
type MigrationId=typeof migrations[number];
type Stage=0|1|2|3;
interface Options {databaseUrl:string;expectedDatabase:string;mode?:'check'|'apply';includePreviews?:boolean}
interface Migration {id:MigrationId;body:string;checksum:string}
interface Marker {migration_id:string;checksum_sha256:string;time_pair:boolean}
const prerequisites=[
  '031_p2_016_ticket_lifecycle_workbench_notifications',
  '033_yxx_self_service_intake','034_yxx_self_service_direct_chat_check',
  '036_p2_007_third_party_staff_directory','039_ticket_self_handling_cycles',
  '040_ticket_staff_completion','043_ticket_reopen_rounds',
  '049_workbench_follow_up_schedules','053_workbench_follow_up_due_signals',
  '063_mvp_notifications_app_members',
] as const;
const digest=(input:Buffer|string)=>createHash('sha256').update(input).digest('hex');
function invalid(code='H5_MIGRATION_INVALID'):never{throw Error(code);}
async function sqlInput(id:MigrationId):Promise<Migration>{
  const bytes=await readFile(new URL('../database/migrations/'+id+'.sql',import.meta.url));
  const sql=bytes.toString('utf8');
  if(!Buffer.from(sql).equals(bytes))invalid('H5_MIGRATION_FILE_INVALID');
  const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if(!body)invalid('H5_MIGRATION_FILE_INVALID');
  // Match existing migration semantics: exact UTF8 input, no EOL conversion.
  return {id,body,checksum:digest(sql)};
}
async function assertPrerequisites(tx:PostgresTransaction){
  const rows=(await tx.query<Marker>('SELECT migration_id,checksum_sha256,applied_at=platform.local_from_epoch_ms(applied_epoch_ms) AS time_pair FROM platform.schema_migration WHERE migration_id=ANY($1::text[])',[[...prerequisites]])).rows;
  for(const id of prerequisites){
    const sql=await readFile(new URL('../database/migrations/'+id+'.sql',import.meta.url),'utf8');
    if(!rows.some(row=>row.migration_id===id&&row.checksum_sha256===digest(sql)&&row.time_pair===true))invalid('H5_MIGRATION_PREREQUISITE_INVALID');
  }
  // Do not call the frozen complete 034-catalog checker on successor schemas.
  if(!await followUpDueSchemaReady(tx)||!await mvpNotificationSchemaReady(tx))invalid('H5_MIGRATION_PREREQUISITE_INVALID');
}
async function stageOf(tx:PostgresTransaction,inputs:readonly Migration[]):Promise<Stage>{
  const rows=(await tx.query<Marker>('SELECT migration_id,checksum_sha256,applied_at=platform.local_from_epoch_ms(applied_epoch_ms) AS time_pair FROM platform.schema_migration WHERE migration_id=ANY($1::text[])',[[...migrations]])).rows;
  let stage:Stage=0,gap=false;
  for(const [index,input]of inputs.entries()){
    const row=rows.find(value=>value.migration_id===input.id);
    if(!row){gap=true;continue;}
    if(gap||row.checksum_sha256!==input.checksum||row.time_pair!==true)invalid('H5_MIGRATION_RECEIPT_DRIFT');
    if(index===0)stage=1;else if(index===1)stage=2;else stage=3;
  }
  return stage;
}
async function assertPristine(tx:PostgresTransaction){
  const result=await tx.query<{partial:boolean}>(`SELECT
    EXISTS(SELECT 1 FROM unnest(ARRAY['intake.web_report_urge','intake.web_report_evaluation',
      'pilot_ticket.ticket_public_progress','intake.web_media_upload']) name WHERE to_regclass(name) IS NOT NULL)
    OR EXISTS(SELECT 1 FROM pg_attribute WHERE attnum>0 AND NOT attisdropped AND (
      attrelid=to_regclass('intake.web_command_receipt') AND attname='h5_result'
      OR attrelid=to_regclass('intake.web_request_binding') AND attname IN ('h5_profile_attempts','h5_profile_next_attempt_epoch_ms')))
    OR to_regprocedure('intake.guard_web_media_identity()') IS NOT NULL AS partial`);
  if(result.rows[0]?.partial!==false)invalid('H5_MIGRATION_UNRECEIPTED_OBJECTS');
}


export async function migrateYxxH5({databaseUrl,expectedDatabase,mode='check',includePreviews=false}:Options){
  if(typeof databaseUrl!=='string'||!databaseUrl||!['check','apply'].includes(mode)
    ||typeof includePreviews!=='boolean'||typeof expectedDatabase!=='string'||!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/u.test(expectedDatabase))invalid();
  const inputs=await Promise.all(migrations.map(sqlInput));
  const media=inputs.find(input=>input.id===migrations[1]);if(!media)invalid('H5_MIGRATION_FILE_INVALID');
  const pool=createPostgresPool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'yxx_h5_migrator'});
  try{return await transactionP2016(pool,async tx=>{
    await tx.query("SET LOCAL lock_timeout='5s'");
    await tx.query("SET LOCAL statement_timeout='60s'");
    await tx.query('SET LOCAL search_path=pg_catalog,platform');
    const database=(await tx.query<{name:string}>('SELECT current_database() AS name')).rows[0];
    if(database?.name!==expectedDatabase)invalid('H5_MIGRATION_DATABASE_MISMATCH');
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('YXX_H5_MIGRATION'))");
    await assertPrerequisites(tx);
    let stage=await stageOf(tx,inputs);
    if(stage===0)await assertPristine(tx);else await assertH5MigrationStructure(tx,stage,media.body);
    const desired=includePreviews?3:2;
    const pending=inputs.slice(stage,desired);
    if(!pending.length)return {status:'NOOP_ALREADY_APPLIED',migrations:inputs.slice(0,stage).map(input=>({migration_id:input.id,checksum_sha256:input.checksum}))};
    if(mode==='check')return {status:'PENDING',migrations:pending.map(input=>({migration_id:input.id,checksum_sha256:input.checksum}))};
    for(const input of pending){
      await tx.query(input.body);
      const next:1|2|3=input.id===migrations[0]?1:input.id===migrations[1]?2:3;
      await assertH5MigrationStructure(tx,next,media.body);
      const stamp=await tx.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch)
        INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
        SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp RETURNING migration_id`,[input.id,input.checksum]);
      if(stamp.rowCount!==1)invalid('H5_MIGRATION_RECEIPT_CONFLICT');
      stage=next;
    }
    await assertH5MigrationStructure(tx,stage===0?invalid():stage,media.body);
    return {status:'APPLIED',migrations:pending.map(input=>({migration_id:input.id,checksum_sha256:input.checksum}))};
  });}
  catch(error){
    if(error instanceof Error&&/^H5_MIGRATION_[A-Z0-9_]+$/u.test(error.message))throw error;
    invalid('H5_MIGRATION_FAILED');
  }finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),switches=args.filter(arg=>arg==='--check'||arg==='--apply');
    const databases=args.filter(arg=>arg.startsWith('--expected-database='));
    if(switches.length>1||databases.length!==1||new Set(args).size!==args.length
      ||args.some(arg=>!['--check','--apply','--include-previews'].includes(arg)&&!arg.startsWith('--expected-database=')))invalid();
    const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)invalid();
    const result=await migrateYxxH5({databaseUrl,expectedDatabase:databases[0]?.slice('--expected-database='.length)??'',mode:switches[0]==='--apply'?'apply':'check',includePreviews:args.includes('--include-previews')});
    console.log(JSON.stringify(result));
  }catch{console.error(JSON.stringify({ok:false,error_code:'H5_MIGRATION_FAILED'}));process.exitCode=1;}
}
