import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ownerTransferMigrationInputs} from './p2-012-owner-transfer-schema.mjs';
export const INCIDENT_DELIVERY_CONTROL_MIGRATION_ID='060_workbench_incident_delivery_control';
export const INCIDENT_DELIVERY_CONTROL_CATALOG_SHA256='68f45974fef29d706aac306d879c0a604289662ba1423f9a35d77559d96f7f89';
const relations=['incident.candidate_review','incident.incident','incident.incident_report','incident.reporter_subscription','incident.incident_event','incident.command_receipt','communication.incident_notification_binding'];
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function incidentDeliveryControlMigrationInputs(){
 const old=await ownerTransferMigrationInputs(),sql=await readFile(new URL('../database/migrations/'+INCIDENT_DELIVERY_CONTROL_MIGRATION_ID+'.sql',import.meta.url),'utf8');
 return [...old,{id:INCIDENT_DELIVERY_CONTROL_MIGRATION_ID,sql,checksum_sha256:sha(sql)}];
}
/** All seven original relations, including every old column, check, FK, index and no custom trigger. */
export async function incidentDeliveryControlSchemaInventory(tx:PostgresTransaction){
 const tables=await tx.query("SELECT n.nspname||'.'||c.relname AS relation,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='incident' AND c.relkind IN ('r','p','v','m','f')) OR n.nspname||'.'||c.relname=$1 ORDER BY relation",[relations[6]]);
 const columns=await tx.query("SELECT n.nspname||'.'||c.relname AS relation,a.attname AS name,a.attnum AS ordinal,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname||'.'||c.relname=ANY($1::text[]) ORDER BY relation,ordinal",[relations]);
 const constraints=await tx.query("SELECT n.nspname||'.'||r.relname AS relation,c.conname AS name,c.contype AS type,c.convalidated AS validated,c.condeferrable AS deferrable,c.condeferred AS deferred,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name",[relations]);
 const indexes=await tx.query("SELECT n.nspname||'.'||r.relname AS relation,c.relname AS name,i.indisvalid AS valid,i.indisready AS ready,pg_get_indexdef(c.oid) AS definition FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name",[relations]);
 const triggers=await tx.query("SELECT n.nspname||'.'||r.relname AS relation,t.tgname AS name FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE NOT t.tgisinternal AND n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name",[relations]);
 const routines=await tx.query("SELECT n.nspname AS schema,p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='incident' ORDER BY name");
 return {tables:tables.rows,columns:columns.rows,constraints:constraints.rows,indexes:indexes.rows,triggers:triggers.rows,routines:routines.rows};
}
export const incidentDeliveryControlSchemaHash=(value:Awaited<ReturnType<typeof incidentDeliveryControlSchemaInventory>>)=>sha(JSON.stringify(value));
export async function incidentDeliveryControlCatalogReady(tx:PostgresTransaction){try{return incidentDeliveryControlSchemaHash(await incidentDeliveryControlSchemaInventory(tx))===INCIDENT_DELIVERY_CONTROL_CATALOG_SHA256;}catch{return false;}}
export async function incidentDeliveryControlSchemaReady(tx:PostgresTransaction){
 try{const inputs=await incidentDeliveryControlMigrationInputs(),markers=await tx.query<{migration_id:string;checksum_sha256:string}>('SELECT migration_id,checksum_sha256 FROM platform.schema_migration WHERE migration_id=ANY($1::text[])',[inputs.map(i=>i.id)]);
  return markers.rowCount===inputs.length&&inputs.every(input=>markers.rows.some(m=>m.migration_id===input.id&&m.checksum_sha256===input.checksum_sha256))&&await incidentDeliveryControlCatalogReady(tx);
 }catch{return false;}
}
