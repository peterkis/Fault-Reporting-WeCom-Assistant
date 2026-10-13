import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {internalNoteSchemaInventory,internalNoteSchemaHash,internalNoteSchemaReady} from '../src/p2-012-internal-note-schema.mjs';
import {transaction,fail} from '../src/p2-012-domain-contracts.mjs';
export const INTERNAL_NOTE_MIGRATION_ID='055_workbench_incident_internal_notes';
const BASELINE_SHA256='96397e885abf2892b09c5981bfd34de334045f5932780bd375fc5c687edbc203';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function migrateIncidentInternalNotes({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'apply'|'check'|'status'}){
  if(!databaseUrl||!['apply','check','status'].includes(mode))fail();
  const sql=await readFile(new URL('../database/migrations/'+INTERNAL_NOTE_MIGRATION_ID+'.sql',import.meta.url),'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)fail();
  const previousSql=await readFile(new URL('../database/migrations/032_p2_012_human_confirmed_incident.sql',import.meta.url),'utf8'),checksum=sha(sql),pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'incident_internal_note_migrator'});
  try{return await transaction(pool,async tx=>{
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('P2_012_MIGRATION'))");
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_012_COMMAND',0))");
    const previous=await tx.query<{checksum_sha256:string}>("SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id='032_p2_012_human_confirmed_incident'");if(previous.rows[0]?.checksum_sha256!==sha(previousSql))fail('COMMAND_FAILED',503);
    const marker=await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[INTERNAL_NOTE_MIGRATION_ID]);
    if(marker.rows[0]){if(marker.rows[0].checksum_sha256!==checksum||!await internalNoteSchemaReady(tx))fail('COMMAND_FAILED',503);return {status:'NOOP_ALREADY_APPLIED',migration_id:INTERNAL_NOTE_MIGRATION_ID,catalog_sha256:internalNoteSchemaHash(await internalNoteSchemaInventory(tx))};}
    if(internalNoteSchemaHash(await internalNoteSchemaInventory(tx))!==BASELINE_SHA256)fail('COMMAND_FAILED',503);
    if(mode==='status')return {status:'READY_FOR_055',migration_id:INTERNAL_NOTE_MIGRATION_ID};
    if(mode==='check')await tx.query('SAVEPOINT note_schema_check');
    await tx.query(body);if(!await internalNoteSchemaReady(tx))fail('COMMAND_FAILED',503);const catalog_sha256=internalNoteSchemaHash(await internalNoteSchemaInventory(tx));
    if(mode==='check')await tx.query('ROLLBACK TO SAVEPOINT note_schema_check');
    else await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[INTERNAL_NOTE_MIGRATION_ID,checksum]);
    return {status:mode==='check'?'CHECK_ROLLBACK_SUCCEEDED':'APPLIED',migration_id:INTERNAL_NOTE_MIGRATION_ID,catalog_sha256};
  });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),mode=args[0]==='--apply'?'apply':args[0]==='--status'?'status':'check';
  if(args.length>1||args.some(arg=>!['--apply','--check','--status'].includes(arg)))throw new Error('INCIDENT_INTERNAL_NOTE_MIGRATION_ARGUMENT_INVALID');
  const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw new Error('INCIDENT_INTERNAL_NOTE_DATABASE_URL_REQUIRED');
  try{console.log(JSON.stringify(await migrateIncidentInternalNotes({databaseUrl,mode})));}catch{console.error(JSON.stringify({ok:false,error_code:'INCIDENT_INTERNAL_NOTE_MIGRATION_FAILED'}));process.exitCode=1;}
}
