import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {transaction,fail} from '../src/p2-012-domain-contracts.mjs';
import {ownerTransferSchemaReady} from '../src/p2-012-owner-transfer-schema.mjs';
import {INCIDENT_DELIVERY_CONTROL_MIGRATION_ID,incidentDeliveryControlMigrationInputs,incidentDeliveryControlCatalogReady,incidentDeliveryControlSchemaReady,incidentDeliveryControlSchemaInventory,incidentDeliveryControlSchemaHash} from '../src/p2-012-incident-delivery-schema.mjs';
export async function migrateIncidentDeliveryControl({databaseUrl,mode='check'}:{databaseUrl:string;mode?:'apply'|'check'|'status'}){
 if(!databaseUrl||!['apply','check','status'].includes(mode))fail();
 const inputs=await incidentDeliveryControlMigrationInputs(),own=inputs.find(i=>i.id===INCIDENT_DELIVERY_CONTROL_MIGRATION_ID);if(!own)fail();
 const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(own.sql)?.[1];if(!body)fail();
 const pool=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'incident_delivery_control_migrator'});
 try{return await transaction(pool,async tx=>{
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('P2_012_MIGRATION'))");
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('P2_012_COMMAND',0))");
  const markers=await tx.query<{migration_id:string;checksum_sha256:string}>('SELECT migration_id,checksum_sha256 FROM platform.schema_migration WHERE migration_id=ANY($1::text[])',[inputs.map(i=>i.id)]);
  if(inputs.filter(i=>i.id!==own.id).some(i=>!markers.rows.some(m=>m.migration_id===i.id&&m.checksum_sha256===i.checksum_sha256)))fail('COMMAND_FAILED',503);
  const old=markers.rows.find(m=>m.migration_id===own.id);
  if(old){if(old.checksum_sha256!==own.checksum_sha256||!await incidentDeliveryControlSchemaReady(tx))fail('COMMAND_FAILED',503);return {status:'NOOP_ALREADY_APPLIED',migration_id:own.id,catalog_sha256:incidentDeliveryControlSchemaHash(await incidentDeliveryControlSchemaInventory(tx))};}
  if(!await ownerTransferSchemaReady(tx))fail('COMMAND_FAILED',503);
  if(mode==='status')return {status:'READY_FOR_060',migration_id:own.id};
  if(mode==='check')await tx.query('SAVEPOINT incident_delivery_schema_check');
  await tx.query(body);if(!await incidentDeliveryControlCatalogReady(tx))fail('COMMAND_FAILED',503);
  const catalog_sha256=incidentDeliveryControlSchemaHash(await incidentDeliveryControlSchemaInventory(tx));
  if(mode==='check')await tx.query('ROLLBACK TO SAVEPOINT incident_delivery_schema_check');
  else {await tx.query("WITH stamp AS (SELECT platform.physical_epoch_ms() AS epoch) INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms) SELECT $1,$2,platform.local_from_epoch_ms(epoch),epoch FROM stamp",[own.id,own.checksum_sha256]);if(!await incidentDeliveryControlSchemaReady(tx))fail('COMMAND_FAILED',503);}
  return {status:mode==='check'?'CHECK_ROLLBACK_SUCCEEDED':'APPLIED',migration_id:own.id,catalog_sha256};
 });}finally{await pool.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),mode=args[0]==='--apply'?'apply':args[0]==='--status'?'status':'check';
 if(args.length>1||args.some(a=>!['--apply','--check','--status'].includes(a)))throw new Error('INCIDENT_DELIVERY_MIGRATION_ARGUMENT_INVALID');
 const databaseUrl=process.env.PILOT_DATABASE_URL;if(!databaseUrl)throw new Error('INCIDENT_DELIVERY_DATABASE_URL_REQUIRED');
 try{console.log(JSON.stringify(await migrateIncidentDeliveryControl({databaseUrl,mode})));}catch{console.error(JSON.stringify({ok:false,error_code:'INCIDENT_DELIVERY_CONTROL_MIGRATION_FAILED'}));process.exitCode=1;}
}
