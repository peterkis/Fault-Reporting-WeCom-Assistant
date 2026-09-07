import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { validateP2016Catalog,p2016CatalogInventory } from './p2-016-migrate.mjs';

export const P2012_MIGRATION_ID='032_p2_012_human_confirmed_incident';
export const P2012_RELATIONS=Object.freeze(['incident.candidate_review','incident.incident','incident.incident_report',
  'incident.reporter_subscription','incident.incident_event','incident.command_receipt','communication.incident_notification_binding']);
const FILE=new URL('../database/migrations/'+P2012_MIGRATION_ID+'.sql',import.meta.url);
const EXPECTED_CATALOG_SHA256='a03d314423eb4e1ee69a2f263cb272a95ed2540512c77b1309944dc5b5ee0701';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fail(code){const error=new Error(code);error.code=code;throw error;}

export async function p2012CatalogInventory(tx){
  const relations=await tx.query(`SELECT n.nspname||'.'||c.relname AS relation,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname='incident' AND c.relkind IN ('r','p','v','m','f')) OR n.nspname||'.'||c.relname=$1 ORDER BY relation`,[P2012_RELATIONS[6]]);
  const columns=await tx.query(`SELECT n.nspname||'.'||c.relname AS relation,a.attname AS name,a.attnum AS ordinal,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname||'.'||c.relname=ANY($1::text[]) ORDER BY relation,ordinal`,[P2012_RELATIONS]);
  const constraints=await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,c.conname AS name,c.contype AS type,
    c.convalidated AS validated,c.condeferrable AS deferrable,c.condeferred AS deferred,pg_get_constraintdef(c.oid,true) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name`,[P2012_RELATIONS]);
  const indexes=await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,c.relname AS name,i.indisvalid AS valid,
    i.indisready AS ready,pg_get_indexdef(c.oid) AS definition FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid
    JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name`,[P2012_RELATIONS]);
  const triggers=await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,t.tgname AS name FROM pg_trigger t
    JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name`,[P2012_RELATIONS]);
  const routines=await tx.query(`SELECT n.nspname AS schema,p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='incident' ORDER BY name`);
  return {relations:relations.rows,columns:columns.rows,constraints:constraints.rows,indexes:indexes.rows,triggers:triggers.rows,routines:routines.rows,predecessor:await p2016CatalogInventory(tx)};
}
export const p2012CatalogHash=inventory=>sha(JSON.stringify(inventory));
export async function validateP2012Catalog(tx){
  const inventory=await p2012CatalogInventory(tx);
  if(p2012CatalogHash(inventory)!==EXPECTED_CATALOG_SHA256)fail('P2_012_SCHEMA_DRIFT');
  return inventory;
}
export async function migrateP2012({databaseUrl,mode='apply',PoolFactory=createPostgresPool}={}){
  if(typeof databaseUrl!=='string'||!databaseUrl||!['apply','check','status'].includes(mode))fail('P2_012_MIGRATION_INPUT_INVALID');
  const sql=await readFile(FILE,'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if(!body)fail('P2_012_MIGRATION_FILE_INVALID');
  const checksum=sha(sql),pool=PoolFactory({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'p2_012_migrator'});
  let tx;
  try{
    tx=await pool.connect();await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='60s'");
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('P2_012_MIGRATION'))");
    if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='031_p2_016_ticket_lifecycle_workbench_notifications'")).rowCount!==1)fail('P2_012_REQUIRES_031');
    const marker=await tx.query('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[P2012_MIGRATION_ID]);
    if(marker.rowCount){
      if(marker.rows[0].checksum_sha256!==checksum)fail('P2_012_MIGRATION_CHECKSUM_MISMATCH');
      const inventory=await validateP2012Catalog(tx);await tx.query('ROLLBACK');return {status:'NOOP_ALREADY_APPLIED',mode,inventory};
    }
    await validateP2016Catalog(tx);
    const prior=await p2012CatalogInventory(tx);
    if(prior.relations.length||prior.routines.length)fail('P2_012_PARTIAL_SCHEMA');
    if(mode==='status'){await tx.query('ROLLBACK');return {status:'READY_FOR_032',mode};}
    await tx.query(body);const inventory=await validateP2012Catalog(tx);
    if(mode==='check')await tx.query('ROLLBACK');
    else{
      await tx.query(`WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch)
        INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
        SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[P2012_MIGRATION_ID,checksum]);
      await tx.query('COMMIT');
    }
    return {status:mode==='check'?'CHECK_ROLLBACK_SUCCEEDED':'APPLIED',mode,inventory};
  }catch(error){await tx?.query('ROLLBACK').catch(()=>{});if(/^P2_012_[A-Z0-9_]+$/u.test(error?.code??''))throw error;fail('P2_012_MIGRATION_FAILED');}
  finally{tx?.release();await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const args=process.argv.slice(2);if(args.length>1||(args.length&&!['--check','--status'].includes(args[0])))fail('P2_012_MIGRATION_ARGS_INVALID');
    const r=await migrateP2012({databaseUrl:process.env.PILOT_DATABASE_URL,mode:args[0]==='--check'?'check':args[0]==='--status'?'status':'apply'});
    console.log(JSON.stringify({task:'P2-012',status:r.status,mode:r.mode,catalog_sha256:r.inventory?p2012CatalogHash(r.inventory):null}));
  }catch(error){console.log(JSON.stringify({task:'P2-012',ok:false,error_code:error.code??'P2_012_MIGRATION_FAILED'}));process.exitCode=1;}
}
