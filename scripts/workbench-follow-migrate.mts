import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {failP2016} from '../src/p2-016-domain-contracts.mjs';
import {p2016CatalogInventory} from './p2-016-migrate.mjs';

export const FOLLOW_MIGRATION_ID='044_workbench_item_follow';
const SQL_URL=new URL('../database/migrations/'+FOLLOW_MIGRATION_ID+'.sql',import.meta.url);
// Complete receipt inventory captured after the unchanged 031 -> 042 -> 047
// migrations, and after optional 050. Includes every column, constraint, index,
// and trigger; other capabilities retain their own schema inventories.
const RECEIPT_047='a7184f19a7bae6b9fcd94aa2099dd63187a25f3f988c6d79c91f0e2c4187c9b3';
const RECEIPT_047_050='383852a01474f598915d2e58548f6d95f5b64bd7810052ba5f6047e2e079ecff';
const RECEIPT_PREDECESSORS=['031_p2_016_ticket_lifecycle_workbench_notifications','042_workbench_manual_reports','047_workbench_personal_read'] as const;
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
export async function followReceiptSchemaReady(tx:PostgresTransaction):Promise<boolean>{
  const markers=(await tx.query<{migration_id:string;checksum_sha256:string}>("SELECT migration_id,checksum_sha256 FROM platform.schema_migration WHERE migration_id=ANY($1::text[]) ORDER BY migration_id",[[...RECEIPT_PREDECESSORS,'050_bot_reporter_feedback']])).rows;
  const bot=markers.find(row=>row.migration_id==='050_bot_reporter_feedback');
  if(RECEIPT_PREDECESSORS.some(id=>!markers.some(row=>row.migration_id===id)))return false;
  const checksum=async(name:string)=>createHash('sha256').update(await readFile(new URL('../database/migrations/'+name+'.sql',import.meta.url))).digest('hex');
  for(const marker of markers)if(marker.checksum_sha256!==await checksum(marker.migration_id))return false;
  const complete:unknown=await p2016CatalogInventory(tx);
  if(!isRecord(complete))return false;
  const receipt:Record<string,unknown>={};
  for(const category of ['relations','columns','constraints','indexes','triggers']){
    const rows=complete[category];if(!Array.isArray(rows)||!rows.every(isRecord))return false;
    receipt[category]=rows.filter(row=>row.relation==='pilot_ticket.ticket_command_receipt');
  }
  return createHash('sha256').update(JSON.stringify(receipt)).digest('hex')===(bot?RECEIPT_047_050:RECEIPT_047);
}
/** Exact feature inventory. No weakening of the existing receipt resource/purpose guards. */
export async function followSchemaReady(tx:PostgresTransaction):Promise<boolean>{
  if(!await followReceiptSchemaReady(tx))return false;
  const sql=await readFile(SQL_URL,'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
  const row=(await tx.query<{ready:boolean}>(`SELECT
    EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id=$1 AND checksum_sha256=$2)
    AND EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id='047_workbench_personal_read')
    AND EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('pilot_ticket.workbench_item_follow') AND relkind='r' AND relpersistence='p' AND NOT relispartition AND NOT relrowsecurity AND NOT relforcerowsecurity)
    AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('pilot_ticket.workbench_item_follow') AND NOT tgisinternal)
    AND (SELECT count(*)=6 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='workbench_item_follow')
    AND (SELECT count(*)=6 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='workbench_item_follow' AND is_nullable='NO' AND is_generated='NEVER' AND
      ((column_name IN ('principal_id','source_intake_id') AND data_type='uuid' AND column_default IS NULL)
       OR (column_name='following' AND data_type='boolean' AND column_default IS NULL)
       OR (column_name='row_version' AND data_type='bigint' AND column_default='1')
       OR (column_name IN ('created_at','updated_at') AND data_type='timestamp without time zone' AND column_default='platform.local_now()')))
    AND (SELECT count(*)=10 FROM pg_constraint WHERE conrelid=to_regclass('pilot_ticket.workbench_item_follow'))
    AND (SELECT count(*)=6 FROM pg_constraint WHERE conrelid=to_regclass('pilot_ticket.workbench_item_follow') AND contype='n' AND convalidated
      AND pg_get_constraintdef(oid) IN ('NOT NULL principal_id','NOT NULL source_intake_id','NOT NULL following','NOT NULL row_version','NOT NULL created_at','NOT NULL updated_at'))
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('pilot_ticket.workbench_item_follow') AND contype='p' AND convalidated AND pg_get_constraintdef(oid)='PRIMARY KEY (principal_id, source_intake_id)')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('pilot_ticket.workbench_item_follow') AND contype='c' AND convalidated AND pg_get_constraintdef(oid)='CHECK ((row_version >= 1))')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('pilot_ticket.workbench_item_follow') AND contype='f' AND convalidated AND pg_get_constraintdef(oid)='FOREIGN KEY (principal_id) REFERENCES pilot_ticket.pilot_principal(id) ON DELETE RESTRICT')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('pilot_ticket.workbench_item_follow') AND contype='f' AND convalidated AND pg_get_constraintdef(oid)='FOREIGN KEY (source_intake_id) REFERENCES intake.service_intake(id) ON DELETE RESTRICT')
    AND (SELECT count(*)=2 FROM pg_index WHERE indrelid=to_regclass('pilot_ticket.workbench_item_follow'))
    AND EXISTS(SELECT 1 FROM pg_index WHERE indrelid=to_regclass('pilot_ticket.workbench_item_follow') AND indisvalid AND indisready AND indisunique AND indisprimary)
    AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid
      WHERE i.indrelid=to_regclass('pilot_ticket.workbench_item_follow') AND ix.relname='workbench_item_follow_active_idx'
        AND i.indisvalid AND i.indisready AND NOT i.indisunique AND NOT i.indisprimary
        AND pg_get_indexdef(i.indexrelid)='CREATE INDEX workbench_item_follow_active_idx ON pilot_ticket.workbench_item_follow USING btree (principal_id, source_intake_id) WHERE following') AS ready`,[FOLLOW_MIGRATION_ID,checksum])).rows[0];
  return row?.ready===true;
}
export async function migrateWorkbenchFollow({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'|'status'}){
  if(!databaseUrl||!['check','apply','status'].includes(mode))failP2016();
  const sql=await readFile(SQL_URL,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
  const checksum=createHash('sha256').update(sql).digest('hex'),pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'workbench_follow_migrator'}),tx=await pool.connect();
  try{
    await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='60s'");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('WORKBENCH_FOLLOW_MIGRATION'))");
    if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='047_workbench_personal_read'")).rowCount!==1)failP2016('ACTION_FAILED',409);
    const old=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[FOLLOW_MIGRATION_ID])).rows[0];
    if(old){if(old.checksum_sha256!==checksum||!await followSchemaReady(tx))failP2016('ACTION_FAILED',409);await tx.query('ROLLBACK');return {status:'NOOP_ALREADY_APPLIED',migration_id:FOLLOW_MIGRATION_ID};}
    if(mode==='status'){await tx.query('ROLLBACK');return {status:'PENDING',migration_id:FOLLOW_MIGRATION_ID};}
    await tx.query(body);await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[FOLLOW_MIGRATION_ID,checksum]);
    if(!await followSchemaReady(tx))failP2016('ACTION_FAILED',409);
    await tx.query(mode==='check'?'ROLLBACK':'COMMIT');return {status:mode==='check'?'CHECK_ROLLBACK_SUCCEEDED':'APPLIED',migration_id:FOLLOW_MIGRATION_ID};
  }catch(error){await tx.query('ROLLBACK').catch(()=>{});throw error;}
  finally{tx.release();await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),databaseUrl=process.env.PILOT_DATABASE_URL;
 if(!databaseUrl||args.length>1||args.some(x=>!['--check','--apply','--status'].includes(x)))throw Error('FOLLOW_MIGRATION_INPUT_INVALID');
 try{console.log(JSON.stringify(await migrateWorkbenchFollow({databaseUrl,mode:args[0]==='--apply'?'apply':args[0]==='--status'?'status':'check'})));}
 catch{console.error(JSON.stringify({ok:false,error_code:'FOLLOW_MIGRATION_FAILED'}));process.exitCode=1;}
}
