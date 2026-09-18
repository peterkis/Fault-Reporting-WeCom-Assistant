import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';

export const YXX_MIGRATION_ID='033_yxx_self_service_intake';
export const YXX_CORRECTIVE_MIGRATION_ID='034_yxx_self_service_direct_chat_check';
const FILE=new URL('../database/migrations/033_yxx_self_service_intake.sql',import.meta.url);
const CORRECTIVE_FILE=new URL('../database/migrations/034_yxx_self_service_direct_chat_check.sql',import.meta.url);
const RELATIONS=Object.freeze(['intake.web_request_binding','intake.web_submission','intake.web_command_receipt']);
const REQUIRED_COLUMNS=Object.freeze({
  'intake.web_request_binding':['intake_id','request_ref','source_corp_scope','source_app_scope','canonical_reporter_binding','input_revision','processed_revision','next_attempt_epoch_ms','retry_count','last_safe_error_code','retention_until','retention_until_epoch_ms'],
  'intake.web_submission':['id','intake_id','command_receipt_id','kind','input_revision','sequence_no','safe_content','canonical_content_hash','canonical_reporter_binding','received_at','received_epoch_ms','retention_until','retention_until_epoch_ms'],
  'intake.web_command_receipt':['id','scope_hash','client_command_id','command_kind','command_hash','schema_version','result_intake_id','result_request_ref','accepted_revision','status','accepted_at','accepted_epoch_ms'],
});
const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{const error=new Error(code);error.code=code;throw error;};

export async function yxxCatalogInventory(tx){
  const relations=await tx.query(`SELECT n.nspname||'.'||c.relname AS relation,c.relkind,c.relpersistence,c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname||'.'||c.relname=ANY($1::text[]) ORDER BY relation`,[RELATIONS]);
  const columns=await tx.query(`SELECT n.nspname||'.'||c.relname AS relation,a.attname AS name,
      format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname||'.'||c.relname=ANY($1::text[])
    ORDER BY relation,a.attnum`,[RELATIONS]);
  const constraints=await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,c.conname AS name,c.contype AS type,
      c.convalidated AS validated,c.condeferrable AS deferrable,c.condeferred AS deferred,pg_get_constraintdef(c.oid,true) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname||'.'||r.relname=ANY($1::text[]) OR c.conname IN (
      'service_intake_primary_web_submission_fk','service_intake_web_source_check','service_intake_web_scope_check',
      'contact_journey_entry_mode_check','contact_journey_origin_channel_check','contact_journey_current_channel_check',
      'contact_journey_entry_origin_check','contact_journey_web_scope_check','channel_leg_type_check','channel_leg_web_source_check',
      'channel_leg_web_submission_fk','deterministic_decision_source_kind_check','deterministic_decision_web_source_check',
      'deterministic_decision_web_submission_fk','deterministic_decision_web_leg_fk','manual_review_basis_revision_check'
    ) ORDER BY relation,name`,[RELATIONS]);
  const indexes=await tx.query(`SELECT n.nspname||'.'||r.relname AS relation,c.relname AS name,i.indisunique AS unique_index,
      i.indisvalid AS valid,i.indisready AS ready,pg_get_indexdef(c.oid) AS definition
    FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname||'.'||r.relname=ANY($1::text[]) ORDER BY relation,name`,[RELATIONS]);
  const timeTypes=await tx.query(`SELECT count(*)::integer AS count FROM information_schema.columns
    WHERE table_schema='intake' AND table_name IN ('web_request_binding','web_submission','web_command_receipt')
      AND data_type='timestamp with time zone'`);
  return {relations:relations.rows,columns:columns.rows,constraints:constraints.rows,indexes:indexes.rows,
    forbidden_timezone_columns:timeTypes.rows[0]?.count??-1};
}

export function yxxCatalogHash(inventory){return sha(JSON.stringify(inventory));}
export function validateYxxCatalog(inventory){
  if(!inventory||inventory.forbidden_timezone_columns!==0)fail('YXX_SELF_SERVICE_TIME_TYPE_DRIFT');
  const relationSet=new Set(inventory.relations.map(v=>v.relation));
  if(RELATIONS.some(v=>!relationSet.has(v)))fail('YXX_SELF_SERVICE_RELATION_DRIFT');
  const columns=new Map();for(const row of inventory.columns){if(!columns.has(row.relation))columns.set(row.relation,new Set());columns.get(row.relation).add(row.name);}
  for(const [relation,names] of Object.entries(REQUIRED_COLUMNS))if(names.some(name=>!columns.get(relation)?.has(name)))fail('YXX_SELF_SERVICE_COLUMN_DRIFT');
  const constraints=new Map(inventory.constraints.map(v=>[v.name,v]));
  const expectedConstraints={
    web_binding_ref_check:['c','request_ref','^[A-Za-z0-9_-]{32}$'],
    web_binding_revision_check:['c','processed_revision','input_revision'],
    web_binding_retention_pair_check:['c','retention_until_epoch_ms','local_from_epoch_ms'],
    web_submission_kind_check:['c','kind','SUBMIT'],
    web_submission_intake_revision_unique:['u','intake_id','input_revision'],
    web_command_receipt_idempotency_unique:['u','scope_hash','client_command_id'],
    service_intake_web_source_check:['c','YIXIAOXIU_WEB','primary_web_submission_id'],
    channel_leg_web_source_check:['c','WEB_FORM','web_submission_id'],
    deterministic_decision_web_source_check:['c','source_kind','primary_web_submission_id'],
    channel_leg_web_submission_fk:['f','web_submission'],
    deterministic_decision_web_leg_fk:['f','channel_leg'],
    service_intake_primary_web_submission_fk:['f','web_submission'],
  };
  for(const [name,[type,...fragments]] of Object.entries(expectedConstraints)){
    const row=constraints.get(name);const definition=String(row?.definition??'');
    if(!row||row.type!==type||row.validated!==true||row.deferrable!== (name==='service_intake_primary_web_submission_fk')||fragments.some(fragment=>!definition.includes(fragment)))fail('YXX_SELF_SERVICE_CONSTRAINT_DRIFT');
  }
  const indexes=new Set(inventory.indexes.filter(v=>v.valid&&v.ready).map(v=>v.name));
  for(const name of ['web_binding_member_created_idx','web_binding_pending_idx','web_submission_intake_received_idx','web_receipt_result_idx'])if(!indexes.has(name))fail('YXX_SELF_SERVICE_INDEX_DRIFT');
  const pending=inventory.indexes.find(v=>v.name==='web_binding_pending_idx');
  if(!pending?.definition.includes("processed_revision < input_revision")||!pending.definition.includes("revoked_at IS NULL")||pending.unique_index)fail('YXX_SELF_SERVICE_INDEX_DRIFT');
  for(const name of ['web_command_receipt_idempotency_unique','web_submission_intake_revision_unique'])if(constraints.get(name)?.deferrable||constraints.get(name)?.deferred)fail('YXX_SELF_SERVICE_CONSTRAINT_DRIFT');
  return inventory;
}

function migrationBody(sql, code) {
  const body=/^\s*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/u.exec(sql)?.[1];
  if(!body)fail(code);
  return body;
}

async function insertMigrationMarker(client, migrationId, checksum) {
  const inserted=await client.query(`WITH applied AS (SELECT platform.physical_epoch_ms() AS epoch_ms)
    INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
    SELECT $1,$2,platform.local_from_epoch_ms(epoch_ms),epoch_ms FROM applied
    ON CONFLICT (migration_id) DO NOTHING RETURNING migration_id`,[migrationId,checksum]);
  if(inserted.rowCount!==1)fail('YXX_SELF_SERVICE_MIGRATION_MARKER_CONFLICT');
}

export async function migrateYxxSelfService({databaseUrl,mode='apply',PoolFactory=createPostgresPool}={}){
  if(typeof databaseUrl!=='string'||!databaseUrl)fail('YXX_SELF_SERVICE_DATABASE_URL_REQUIRED');
  if(!['apply','check','status'].includes(mode))fail('YXX_SELF_SERVICE_MIGRATION_MODE_INVALID');
  const sql=await readFile(FILE,'utf8'),correctionSql=await readFile(CORRECTIVE_FILE,'utf8');
  const body=migrationBody(sql,'YXX_SELF_SERVICE_MIGRATION_FILE_INVALID');
  const correctionBody=migrationBody(correctionSql,'YXX_SELF_SERVICE_CORRECTION_FILE_INVALID');
  const checksum=sha(sql),correctionChecksum=sha(correctionSql);
  const pool=PoolFactory({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'yxx_self_service_migrator'});let client;
  try{
    client=await pool.connect();await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('YXX_SELF_SERVICE_MIGRATION'))");
    if((await client.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='032_p2_012_human_confirmed_incident'")).rowCount!==1)fail('YXX_SELF_SERVICE_REQUIRES_032');
    const markers=await client.query('SELECT migration_id,checksum_sha256 FROM platform.schema_migration WHERE migration_id=ANY($1::text[])',[[YXX_MIGRATION_ID,YXX_CORRECTIVE_MIGRATION_ID]]);
    const markerById=new Map(markers.rows.map(row=>[row.migration_id,row.checksum_sha256]));
    if(markerById.has(YXX_MIGRATION_ID)&&markerById.get(YXX_MIGRATION_ID)!==checksum)fail('YXX_SELF_SERVICE_CHECKSUM_MISMATCH');
    if(markerById.has(YXX_CORRECTIVE_MIGRATION_ID)&&markerById.get(YXX_CORRECTIVE_MIGRATION_ID)!==correctionChecksum)fail('YXX_SELF_SERVICE_CORRECTION_CHECKSUM_MISMATCH');
    const pending033=!markerById.has(YXX_MIGRATION_ID),pending034=!markerById.has(YXX_CORRECTIVE_MIGRATION_ID);
    const status=pending033?'READY_FOR_033':pending034?'READY_FOR_034':'NOOP_ALREADY_APPLIED';
    if(mode==='status'){
      await client.query('ROLLBACK');
      return {status,mode,checksum_sha256:checksum,corrective_checksum_sha256:correctionChecksum};
    }
    if(pending033){await client.query(body);validateYxxCatalog(await yxxCatalogInventory(client));if(mode!=='check')await insertMigrationMarker(client,YXX_MIGRATION_ID,checksum);}
    if(pending034){await client.query(correctionBody);}
    const inventory=validateYxxCatalog(await yxxCatalogInventory(client));
    if(mode==='check'){
      await client.query('ROLLBACK');
      return {status:'CHECK_ROLLBACK_SUCCEEDED',mode,checksum_sha256:checksum,corrective_checksum_sha256:correctionChecksum,catalog_sha256:yxxCatalogHash(inventory),inventory};
    }
    if(pending034)await insertMigrationMarker(client,YXX_CORRECTIVE_MIGRATION_ID,correctionChecksum);
    await client.query('COMMIT');
    return {status:(pending033||pending034)?'APPLIED':'NOOP_ALREADY_APPLIED',mode,checksum_sha256:checksum,corrective_checksum_sha256:correctionChecksum,catalog_sha256:yxxCatalogHash(inventory),inventory};
  }catch(error){await client?.query('ROLLBACK').catch(()=>{});if(/^YXX_SELF_SERVICE_[A-Z0-9_]+$/u.test(error?.code??''))throw error;fail('YXX_SELF_SERVICE_MIGRATION_FAILED');}
  finally{client?.release();await pool.end();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const arg=process.argv[2];const mode=arg==='--check'?'check':arg==='--status'?'status':arg===undefined?'apply':fail('YXX_SELF_SERVICE_MIGRATION_ARGS_INVALID');const result=await migrateYxxSelfService({databaseUrl:process.env.PILOT_DATABASE_URL,mode});console.log(JSON.stringify({task:'YXX-SS-003',...result,inventory:undefined}));}
  catch(error){console.log(JSON.stringify({task:'YXX-SS-003',ok:false,error_code:error.code??'YXX_SELF_SERVICE_MIGRATION_FAILED'}));process.exitCode=1;}
}
