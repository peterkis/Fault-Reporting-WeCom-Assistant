import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transactionP2016,failP2016} from '../src/p2-016-domain-contracts.mjs';
import {followUpSchemaReady} from './workbench-follow-up-schedules-migrate.mjs';

export const FOLLOW_UP_DUE_MIGRATION_ID='053_workbench_follow_up_due_signals';
const file=new URL('../database/migrations/053_workbench_follow_up_due_signals.sql',import.meta.url);

export async function followUpDueSchemaReady(queryable:PostgresTransaction):Promise<boolean>{
  if(!await followUpSchemaReady(queryable))return false;
  const checksum=createHash('sha256').update(await readFile(file,'utf8')).digest('hex');
  const ledger=await queryable.query<{checksum_sha256:unknown}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[FOLLOW_UP_DUE_MIGRATION_ID]);
  if(ledger.rows[0]?.checksum_sha256!==checksum)return false;
  const catalog=await queryable.query<{ready:boolean}>(`WITH relation AS (
    SELECT oid FROM pg_class WHERE oid=to_regclass('pilot_ticket.follow_up_due_signal') AND relkind='r' AND relpersistence='p'
  ), columns AS (
    SELECT a.* FROM pg_attribute a JOIN relation r ON r.oid=a.attrelid WHERE a.attnum>0 AND NOT a.attisdropped
  ), key_columns AS (
    SELECT ARRAY[(SELECT attnum FROM columns WHERE attname='ticket_id'),
                 (SELECT attnum FROM columns WHERE attname='schedule_version')]::smallint[] AS ids
  ) SELECT (
    (SELECT count(*)=3 AND bool_and(attnotnull AND CASE attname
      WHEN 'ticket_id' THEN atttypid='uuid'::regtype AND atttypmod=-1
      WHEN 'schedule_version' THEN atttypid='bigint'::regtype AND atttypmod=-1
      WHEN 'published_at' THEN atttypid='timestamp without time zone'::regtype AND atttypmod=0
      ELSE false END) FROM columns)
    AND EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
      WHERE c.conrelid=r.oid AND c.conname='follow_up_due_signal_pkey' AND c.contype='p'
        AND c.convalidated AND c.conenforced AND NOT c.condeferrable AND c.conkey=k.ids
        AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready)
    AND EXISTS(SELECT 1 FROM pg_constraint c
      WHERE c.conrelid=r.oid AND c.conname='follow_up_due_signal_revision_fk' AND c.contype='f'
        AND c.convalidated AND c.conenforced AND NOT c.condeferrable AND c.conkey=k.ids
        AND c.confrelid=to_regclass('pilot_ticket.follow_up_schedule_revision')
        AND c.confkey=ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='ticket_id' AND NOT attisdropped),
          (SELECT attnum FROM pg_attribute WHERE attrelid=c.confrelid AND attname='schedule_version' AND NOT attisdropped)]::smallint[]
        AND c.confupdtype='a' AND c.confdeltype='a' AND c.confmatchtype='s')
    AND EXISTS(SELECT 1 FROM pg_constraint c
      WHERE c.conrelid=r.oid AND c.conname='follow_up_due_signal_positive_version' AND c.contype='c'
        AND c.convalidated AND c.conenforced AND NOT c.condeferrable
        AND c.conkey=ARRAY[(SELECT attnum FROM columns WHERE attname='schedule_version')]::smallint[]
        AND regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')='schedule_version>=1')
    ) AS ready FROM relation r CROSS JOIN key_columns k`);
  return catalog.rows[0]?.ready===true;
}

export async function migrateWorkbenchFollowUpDueSignals({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'}){
  if(!databaseUrl||!['check','apply'].includes(mode))failP2016();
  const sql=await readFile(file,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];if(!body)failP2016();
  const checksum=createHash('sha256').update(sql).digest('hex');
  const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'follow_up_due_migrator'});
  try{return await transactionP2016(pool,async transaction=>{
    await transaction.query("SELECT pg_advisory_xact_lock(hashtext('FOLLOW_UP_DUE_SIGNAL_MIGRATION'))");
    if(!await followUpSchemaReady(transaction))failP2016('FOLLOW_UP_UNAVAILABLE',503);
    const existing=await transaction.query<{checksum_sha256:unknown}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[FOLLOW_UP_DUE_MIGRATION_ID]);
    if(existing.rows[0]){
      if(existing.rows[0].checksum_sha256!==checksum||!await followUpDueSchemaReady(transaction))failP2016('FOLLOW_UP_UNAVAILABLE',503);
      return {status:'NOOP_ALREADY_APPLIED',migration_id:FOLLOW_UP_DUE_MIGRATION_ID};
    }
    const table=await transaction.query<{marker_table:unknown}>("SELECT to_regclass('pilot_ticket.follow_up_due_signal') AS marker_table");
    if(table.rows.some(row=>row.marker_table!==null))failP2016('FOLLOW_UP_UNAVAILABLE',503);
    if(mode==='check')return {status:'PENDING',migration_id:FOLLOW_UP_DUE_MIGRATION_ID};
    await transaction.query(body);
    await transaction.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
      INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
      SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[FOLLOW_UP_DUE_MIGRATION_ID,checksum]);
    if(!await followUpDueSchemaReady(transaction))failP2016('FOLLOW_UP_UNAVAILABLE',503);
    return {status:'APPLIED',migration_id:FOLLOW_UP_DUE_MIGRATION_ID};
  });}finally{await pool.end();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--check','--apply'].includes(arg)))throw Error('FOLLOW_UP_DUE_MIGRATION_ARGUMENT_INVALID');
  const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw Error('FOLLOW_UP_DUE_DATABASE_URL_REQUIRED');
  try{console.log(JSON.stringify(await migrateWorkbenchFollowUpDueSignals({databaseUrl,mode:args[0]==='--apply'?'apply':'check'})));}
  catch{console.error(JSON.stringify({ok:false,error_code:'FOLLOW_UP_DUE_MIGRATION_FAILED'}));process.exitCode=1;}
}
