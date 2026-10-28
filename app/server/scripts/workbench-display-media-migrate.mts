import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';

const targets={avatars:{id:'068_workbench_actor_avatar_cache',prior:'031_p2_016_ticket_lifecycle_workbench_notifications',present:"to_regclass('workbench.actor_avatar_cache') IS NOT NULL"},media:{id:'069_h5_media_conversion_diagnostics',prior:'065_yixiaoxiu_h5_web_media',present:"EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='intake' AND table_name='web_media_upload' AND column_name IN ('conversion_error_code','conversion_error_stage','conversion_attempted_epoch_ms'))"}} as const;
async function validShape(tx:PostgresTransaction,target:keyof typeof targets){
  const shape=target==='avatars'?{schema:'workbench',table:'actor_avatar_cache',fields:{principal_id:'uuid',identity_hash:'text',status:'text',avatar_bytes:'bytea',avatar_sha256:'text',error_code:'text',attempted_epoch_ms:'int8',expires_epoch_ms:'int8'}}:{schema:'intake',table:'web_media_upload',fields:{conversion_error_code:'text',conversion_attempted_epoch_ms:'int8',conversion_error_stage:'text'}};
  const rows=await tx.query<{column_name:string;udt_name:string}>('SELECT column_name,udt_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',[shape.schema,shape.table]);
  return Object.entries(shape.fields).every(([name,type])=>rows.rows.some(row=>row.column_name===name&&row.udt_name===type));
}
export async function migrateWorkbenchDisplayMedia({databaseUrl,expectedDatabase,target,mode='check'}:{databaseUrl:string;expectedDatabase:string;target:keyof typeof targets;mode?:'check'|'apply'}){
  if(!databaseUrl||!expectedDatabase||!Object.hasOwn(targets,target)||!['check','apply'].includes(mode))throw Error('DISPLAY_MEDIA_MIGRATION_INVALID');
  const selected=targets[target],sql=await readFile(new URL('../../../database/migrations/'+selected.id+'.sql',import.meta.url),'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if(!body)throw Error('DISPLAY_MEDIA_MIGRATION_INVALID');const checksum=createHash('sha256').update(sql).digest('hex');
  const pool=createPostgresPool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'workbench_display_media_migrator'});
  try{return await transactionP2016(pool,async tx=>{
    await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='30s'");
    if((await tx.query<{name:string}>('SELECT current_database() AS name')).rows[0]?.name!==expectedDatabase)throw Error('DISPLAY_MEDIA_DATABASE_MISMATCH');
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('WORKBENCH_DISPLAY_MEDIA_MIGRATION'))");
    const prior=await readFile(new URL('../../../database/migrations/'+selected.prior+'.sql',import.meta.url),'utf8');
    if((await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[selected.prior])).rows[0]?.checksum_sha256!==createHash('sha256').update(prior).digest('hex'))throw Error('DISPLAY_MEDIA_PREDECESSOR_MISMATCH');
    const marker=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[selected.id])).rows[0],present=(await tx.query<{present:boolean}>('SELECT '+selected.present+' AS present')).rows[0]?.present===true;
    if(marker){if(marker.checksum_sha256!==checksum||!present||!await validShape(tx,target))throw Error('DISPLAY_MEDIA_SCHEMA_MISMATCH');return {status:'NOOP_ALREADY_APPLIED',migration_id:selected.id};}
    if(present)throw Error('DISPLAY_MEDIA_SCHEMA_UNTRACKED');if(mode==='check')return {status:'PENDING',migration_id:selected.id};
    await tx.query(body);if(!await validShape(tx,target))throw Error('DISPLAY_MEDIA_SCHEMA_MISMATCH');await tx.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp`,[selected.id,checksum]);
    return {status:'APPLIED',migration_id:selected.id};
  });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),target=args.find(arg=>arg.startsWith('--target='))?.slice(9),databaseUrl=process.env.PILOT_DATABASE_URL,expectedDatabase=process.env.WORKBENCH_EXPECTED_DATABASE;
  if(args.length>2||new Set(args).size!==args.length||args.some(arg=>!['--check','--apply','--target=avatars','--target=media'].includes(arg))||!['avatars','media'].includes(target??'')||!databaseUrl||!expectedDatabase)throw Error('DISPLAY_MEDIA_MIGRATION_INVALID');
  await migrateWorkbenchDisplayMedia({databaseUrl,expectedDatabase,target:target as 'avatars'|'media',mode:args.includes('--apply')?'apply':'check'}).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('DISPLAY_MEDIA_MIGRATION_FAILED');process.exitCode=1;});
}
