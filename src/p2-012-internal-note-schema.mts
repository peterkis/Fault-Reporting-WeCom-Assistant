import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {createHash} from 'node:crypto';
import {publicProgressSchemaReady} from './p2-012-public-progress-schema.mjs';
/** Only the additive 055 surface; other accepted Ticket migrations are independent. */
export async function internalNoteSchemaInventory(tx:PostgresTransaction){
  const columns=await tx.query(`SELECT attname,format_type(atttypid,atttypmod) AS type,attnotnull FROM pg_attribute
    WHERE attrelid='incident.incident_event'::regclass AND attname IN ('internal_note_text','internal_note_incident_version') AND NOT attisdropped ORDER BY attname`);
  const constraints=await tx.query(`SELECT conrelid::regclass::text AS relation,conname,convalidated,pg_get_constraintdef(oid,true) AS definition
    FROM pg_constraint WHERE (conrelid='incident.incident_event'::regclass AND conname IN ('incident_event_event_type_check','p2012_internal_note_shape'))
      OR (conrelid='incident.command_receipt'::regclass AND conname='command_receipt_command_type_check') ORDER BY relation,conname`);
  const indexes=await tx.query(`SELECT indisvalid,indisready,pg_get_indexdef(indexrelid) AS definition FROM pg_index
    WHERE indexrelid=to_regclass('incident.p2012_internal_note_page_idx')`);
  return {columns:columns.rows,constraints:constraints.rows,indexes:indexes.rows};
}
export const internalNoteSchemaHash=(value:Awaited<ReturnType<typeof internalNoteSchemaInventory>>)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const INTERNAL_NOTE_SCHEMA_SHA256='485113befa00e22cbc3fcd54bf4f7eb30c13cd7d4fa072e724d91b8cc6e982e8';
export async function internalNoteSchemaReady(tx:PostgresTransaction){
  try{
    const inventory=await internalNoteSchemaInventory(tx);
    return internalNoteSchemaHash(inventory)===INTERNAL_NOTE_SCHEMA_SHA256||await publicProgressSchemaReady(tx);
  }catch{return false;}
}
