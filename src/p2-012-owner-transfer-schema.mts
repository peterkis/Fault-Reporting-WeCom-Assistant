import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {publicProgressSchemaInventory} from './p2-012-public-progress-schema.mjs';
export const OWNER_TRANSFER_MIGRATION_ID='054_workbench_incident_owner_transfer';
export const OWNER_TRANSFER_SCHEMA_SHA256='d61fa6640688ec38523f80a1d08ed309dc1e409d668998b0944dfe8c4412cd09';
const migrationIds=['032_p2_012_human_confirmed_incident','055_workbench_incident_internal_notes','058_workbench_incident_public_progress',OWNER_TRANSFER_MIGRATION_ID] as const;
const sha=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
/** Actual runtime SQL bytes: old checksums are neither rewritten nor inferred. */
export async function ownerTransferMigrationInputs(){return Promise.all(migrationIds.map(async id=>{const sql=await readFile(new URL('../database/migrations/'+id+'.sql',import.meta.url),'utf8');return {id,sql,checksum_sha256:sha(sql)};}));}
/** Complete accepted 055/058 surface plus the original event authority/FK and 054 shape. */
export async function ownerTransferSchemaInventory(tx:PostgresTransaction){
 const prerequisite=await publicProgressSchemaInventory(tx);
 const constraints=await tx.query("SELECT conrelid::regclass::text AS relation,conname,convalidated,pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE (conrelid='incident.incident_event'::regclass AND conname IN ('p2012_owner_transfer_shape','p2012_event_resource','p2012_event_actor')) OR (conrelid='incident.command_receipt'::regclass AND conname='p2012_command_event_fk') ORDER BY relation,conname");
 return {prerequisite,constraints:constraints.rows};
}
export const ownerTransferSchemaHash=(value:Awaited<ReturnType<typeof ownerTransferSchemaInventory>>)=>sha(JSON.stringify(value));
export async function ownerTransferCatalogReady(tx:PostgresTransaction){try{return ownerTransferSchemaHash(await ownerTransferSchemaInventory(tx))===OWNER_TRANSFER_SCHEMA_SHA256;}catch{return false;}}
export async function ownerTransferSchemaReady(tx:PostgresTransaction){
 try{const inputs=await ownerTransferMigrationInputs(),markers=await tx.query<{migration_id:string;checksum_sha256:string}>('SELECT migration_id,checksum_sha256 FROM platform.schema_migration WHERE migration_id=ANY($1::text[])',[inputs.map(input=>input.id)]);
  return markers.rowCount===inputs.length&&inputs.every(input=>markers.rows.some(marker=>marker.migration_id===input.id&&marker.checksum_sha256===input.checksum_sha256))&&await ownerTransferCatalogReady(tx);
 }catch{return false;}
}
