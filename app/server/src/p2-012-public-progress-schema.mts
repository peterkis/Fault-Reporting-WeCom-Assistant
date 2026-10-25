import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {createHash} from 'node:crypto';
import {ownerTransferSchemaReady} from './p2-012-owner-transfer-schema.mjs';
/** Includes the complete 055 surface and its shared checks, not enum containment. */
export async function publicProgressSchemaInventory(tx:PostgresTransaction){
  const columns=await tx.query(`SELECT attrelid::regclass::text AS relation,attname,format_type(atttypid,atttypmod) AS type,attnotnull FROM pg_attribute
    WHERE ((attrelid='incident.incident_event'::regclass AND attname IN ('internal_note_text','internal_note_incident_version','public_progress_summary','public_progress_incident_version'))
     OR (attrelid='communication.incident_notification_binding'::regclass AND attname='direct_channel_leg_id')) AND NOT attisdropped ORDER BY relation,attname`);
  const constraints=await tx.query(`SELECT conrelid::regclass::text AS relation,conname,convalidated,pg_get_constraintdef(oid,true) AS definition FROM pg_constraint
    WHERE (conrelid='incident.incident_event'::regclass AND conname IN ('incident_event_event_type_check','p2012_internal_note_shape','p2012_public_progress_shape'))
     OR (conrelid='incident.command_receipt'::regclass AND conname='command_receipt_command_type_check')
     OR (conrelid='communication.incident_notification_binding'::regclass AND conname IN ('incident_notification_binding_template_code_check','p2012_public_progress_direct_leg_fk','p2012_public_progress_binding_shape')) ORDER BY relation,conname`);
  const indexes=await tx.query(`SELECT indexrelid::regclass::text AS name,indisvalid,indisready,pg_get_indexdef(indexrelid) AS definition FROM pg_index
    WHERE indexrelid IN (to_regclass('incident.p2012_internal_note_page_idx'),to_regclass('incident.p2012_public_progress_page_idx'),to_regclass('communication.p2012_public_progress_delivery_page_idx')) ORDER BY name`);
  return {columns:columns.rows,constraints:constraints.rows,indexes:indexes.rows};
}
export const publicProgressSchemaHash=(value:Awaited<ReturnType<typeof publicProgressSchemaInventory>>)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const PUBLIC_PROGRESS_SCHEMA_SHA256='d1f95e25c15637aafb3d3f72eae8e1756731345133f0b447df3277e6057401f6';
export async function publicProgressSchemaReady(tx:PostgresTransaction){try{return publicProgressSchemaHash(await publicProgressSchemaInventory(tx))===PUBLIC_PROGRESS_SCHEMA_SHA256||await ownerTransferSchemaReady(tx);}catch{return false;}}
