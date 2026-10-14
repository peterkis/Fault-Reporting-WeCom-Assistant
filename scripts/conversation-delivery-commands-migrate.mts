import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {CONVERSATION_DELIVERY_MIGRATION_ID,conversationDeliveryReceiptSchemaShape} from '../src/p2-006-delivery-command-schema.mjs';
export async function migrateConversationDeliveryCommands({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'check'|'apply'|'status'}){
 if(!databaseUrl||!['check','apply','status'].includes(mode))throw Error('CONVERSATION_DELIVERY_MIGRATION_INPUT_INVALID');
 const sql=await readFile(new URL('../database/migrations/'+CONVERSATION_DELIVERY_MIGRATION_ID+'.sql',import.meta.url),'utf8'),body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
 if(!body)throw Error('CONVERSATION_DELIVERY_MIGRATION_FILE_INVALID');const checksum=createHash('sha256').update(sql).digest('hex');
 const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'conversation_delivery_commands_migrator'}),tx=await pool.connect();
 try{
  await tx.query('BEGIN');await tx.query("SET LOCAL lock_timeout='5s'");await tx.query("SET LOCAL statement_timeout='60s'");
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('P2_016_MIGRATION'))");await tx.query("SELECT pg_advisory_xact_lock(hashtext('CONVERSATION_DELIVERY_MIGRATION'))");
  const old=(await tx.query<{checksum_sha256:string}>('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[CONVERSATION_DELIVERY_MIGRATION_ID])).rows[0];
  if(old){if(old.checksum_sha256!==checksum||!await conversationDeliveryReceiptSchemaShape(tx))throw Error('CONVERSATION_DELIVERY_SCHEMA_DRIFT');await tx.query('ROLLBACK');return {status:'NOOP_ALREADY_APPLIED',migration_id:CONVERSATION_DELIVERY_MIGRATION_ID};}
  const before=await conversationDeliveryReceiptSchemaShape(tx,'before');if(!before)throw Error('CONVERSATION_DELIVERY_PREDECESSOR_DRIFT');
  if(mode==='status'){await tx.query('ROLLBACK');return {status:'PENDING',migration_id:CONVERSATION_DELIVERY_MIGRATION_ID};}
  await tx.query(body);await tx.query("WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp",[CONVERSATION_DELIVERY_MIGRATION_ID,checksum]);
  if(await conversationDeliveryReceiptSchemaShape(tx)!==before)throw Error('CONVERSATION_DELIVERY_SCHEMA_DRIFT');
  await tx.query(mode==='check'?'ROLLBACK':'COMMIT');return {status:mode==='check'?'CHECK_ROLLBACK_SUCCEEDED':'APPLIED',migration_id:CONVERSATION_DELIVERY_MIGRATION_ID};
 }catch(error){await tx.query('ROLLBACK').catch(()=>{});throw error;}
 finally{tx.release();await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),databaseUrl=process.env.PILOT_DATABASE_URL;
 if(!databaseUrl||args.length>1||args.some(x=>!['--check','--apply','--status'].includes(x)))throw Error('CONVERSATION_DELIVERY_MIGRATION_INPUT_INVALID');
 try{console.log(JSON.stringify(await migrateConversationDeliveryCommands({databaseUrl,mode:args[0]==='--apply'?'apply':args[0]==='--status'?'status':'check'})));}
 catch{console.error(JSON.stringify({ok:false,error_code:'CONVERSATION_DELIVERY_MIGRATION_FAILED'}));process.exitCode=1;}
}
