// PostgreSQL18 required-object checks for the H5 migration stages.
// Unrelated successor columns, constraints and indexes remain allowed.
import type {PostgresTransaction} from '../src/platform/postgres-pool.mjs';

type Stage=1|2|3;
type SqlValue=string|number|boolean|null;
interface Column {relation:string;name:string;type:string;not_null:boolean;identity:string;generated:string;default_expression:string|null}
interface Constraint {relation:string;name:string;kind:string;validated:boolean;enforced:boolean;deferrable:boolean;deferred:boolean;keys:string[];referenced_relation:string|null;referenced_keys:string[]|null;on_update:string;on_delete:string;match:string;expression:string|null;index_valid:boolean|null;index_ready:boolean|null;index_unique:boolean|null;index_primary:boolean|null}
interface Index {relation:string;name:string;valid:boolean;ready:boolean;unique:boolean;primary:boolean;method:string;key_names:(string|null)[];key_options:number[];key_opclasses:string[];predicate:string|null;expressions:string|null}
interface Surface {columns:Column[];constraints:Constraint[];indexes:Index[]}
interface ColumnSpec {name:string;type:string;notNull:boolean;identity?:string;default?:string}
const requiredRelations=['intake.web_report_urge','intake.web_report_evaluation','pilot_ticket.ticket_public_progress','intake.web_media_upload'];
function invalid():never{throw Error('H5_MIGRATION_STRUCTURE_DRIFT');}
function need(value:boolean){if(!value)invalid();}
const same=(left:readonly SqlValue[]|null,right:readonly SqlValue[])=>left!==null&&left.length===right.length&&left.every((item,index)=>item===right[index]);

// Only remove whitespace outside quoted literals/identifiers. Parentheses,
// casts, operator order and literal contents remain significant. In particular
// a named CHECK(... OR true) cannot match the expected complete expression.
function tokens(value:string):string{
  let result='',quote:"'"|'"'|undefined;
  for(let index=0;index<value.length;index++){
    const char=value[index];if(char===undefined)invalid();
    if(quote){result+=char;if(char===quote){if(value[index+1]===quote){result+=quote;index++;}else quote=undefined;}}
    else if(char==="'"||char==='"'){quote=char;result+=char;}
    else if(!/\s/u.test(char))result+=char;
  }
  if(quote)invalid();return result;
}
const expression=(actual:string|null,expected:string)=>actual!==null&&tokens(actual)===tokens(expected);
const atom=(value:string)=>`(${value})`;
const and=(...values:string[])=>atom(values.join(' AND '));
const or=(...values:string[])=>atom(values.join(' OR '));
const equalText=(column:string,value:string)=>atom(`${column} = '${value}'::text`);
const notEqualText=(column:string,value:string)=>atom(`${column} <> '${value}'::text`);
const isNull=(column:string)=>atom(`${column} IS NULL`);
const notNull=(column:string)=>atom(`${column} IS NOT NULL`);
const anyText=(column:string,values:readonly string[])=>atom(`${column} = ANY (ARRAY[${values.map(value=>`'${value}'::text`).join(', ')}])`);
const allText=(column:string,values:readonly string[])=>atom(`${column} <> ALL (ARRAY[${values.map(value=>`'${value}'::text`).join(', ')}])`);
const between=(column:string,min:number,max:number)=>and(atom(`${column} >= ${min}`),atom(`${column} <= ${max}`));
const hex=(column:string)=>atom(`${column} ~ '^[a-f0-9]{64}$'::text`);
const pair=(local:string,epoch:string)=>atom(`${local} = local_from_epoch_ms(${epoch})`);
const C=(name:string,type:string,notNull=true,defaultExpression?:string):ColumnSpec=>defaultExpression===undefined?{name,type,notNull}:{name,type,notNull,default:defaultExpression};

async function surface(tx:PostgresTransaction):Promise<Surface>{
  const columns=(await tx.query<Column>(`SELECT n.nspname||'.'||r.relname AS relation,a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_attribute a JOIN pg_class r ON r.oid=a.attrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attnum>0 AND NOT a.attisdropped AND (n.nspname||'.'||r.relname=ANY($1::text[])
      OR a.attrelid=to_regclass('intake.web_command_receipt') AND a.attname='h5_result'
      OR a.attrelid=to_regclass('intake.web_request_binding') AND a.attname IN ('h5_profile_attempts','h5_profile_next_attempt_epoch_ms'))`,[requiredRelations])).rows;
  const constraints=(await tx.query<Constraint>(`SELECT n.nspname||'.'||r.relname AS relation,c.conname AS name,c.contype AS kind,
    c.convalidated AS validated,c.conenforced AS enforced,c.condeferrable AS deferrable,c.condeferred AS deferred,
    ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,pos)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.pos) AS keys,
    CASE WHEN c.confrelid=0 THEN NULL ELSE rn.nspname||'.'||rr.relname END AS referenced_relation,
    CASE WHEN c.confrelid=0 THEN NULL ELSE ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,pos)
      JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.pos) END AS referenced_keys,
    c.confupdtype AS on_update,c.confdeltype AS on_delete,c.confmatchtype AS match,pg_get_expr(c.conbin,c.conrelid) AS expression,
    i.indisvalid AS index_valid,i.indisready AS index_ready,i.indisunique AS index_unique,i.indisprimary AS index_primary
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    LEFT JOIN pg_class rr ON rr.oid=c.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rr.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid=c.conindid
    WHERE n.nspname||'.'||r.relname=ANY($1::text[])
      OR c.conrelid=to_regclass('intake.web_command_receipt') AND c.conname IN
        ('web_command_receipt_schema_check','web_command_receipt_kind_check','web_h5_result_purpose')
      OR c.conrelid=to_regclass('intake.web_request_binding') AND c.contype='c'
      OR c.conrelid=to_regclass('conversation.realtime_event') AND c.conname='conversation_realtime_event_source_type_check'`,[requiredRelations])).rows;
  const indexes=(await tx.query<Index>(`SELECT n.nspname||'.'||r.relname AS relation,ix.relname AS name,
    i.indisvalid AS valid,i.indisready AS ready,i.indisunique AS unique,i.indisprimary AS primary,am.amname AS method,
    ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(num,pos)
      LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num WHERE k.pos<=i.indnkeyatts ORDER BY k.pos) AS key_names,
    ARRAY(SELECT option::integer FROM unnest(i.indoption::smallint[]) WITH ORDINALITY o(option,pos) ORDER BY pos) AS key_options,
    ARRAY(SELECT pn.nspname||'.'||p.opcname FROM unnest(i.indclass::oid[]) WITH ORDINALITY o(oid,pos)
      JOIN pg_opclass p ON p.oid=o.oid JOIN pg_namespace pn ON pn.oid=p.opcnamespace ORDER BY pos) AS key_opclasses,
    pg_get_expr(i.indpred,i.indrelid) AS predicate,pg_get_expr(i.indexprs,i.indrelid) AS expressions
    FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
    WHERE n.nspname||'.'||r.relname=ANY($1::text[])`,[requiredRelations])).rows;
  return {columns,constraints,indexes};
}
function columns(surface:Surface,relation:string,specs:readonly ColumnSpec[]){
  for(const spec of specs){
    const found=surface.columns.find(column=>column.relation===relation&&column.name===spec.name);
    need(found!==undefined&&found.type===spec.type&&found.not_null===spec.notNull&&found.generated===''&&found.identity===(spec.identity??'')
      &&(spec.default===undefined?found.default_expression===null:expression(found.default_expression,spec.default)));
  }
}
const validConstraint=(constraint:Constraint)=>constraint.validated&&constraint.enforced&&!constraint.deferrable&&!constraint.deferred;
function check(surface:Surface,relation:string,expected:string,name?:string){
  need(surface.constraints.some(constraint=>constraint.relation===relation&&constraint.kind==='c'&&validConstraint(constraint)
    &&(name===undefined||constraint.name===name)&&expression(constraint.expression,expected)));
}
function key(surface:Surface,relation:string,kind:'p'|'u',names:readonly string[],name?:string){
  need(surface.constraints.some(constraint=>constraint.relation===relation&&constraint.kind===kind&&validConstraint(constraint)
    &&(name===undefined||constraint.name===name)&&same(constraint.keys,names)&&constraint.index_valid===true&&constraint.index_ready===true
    &&constraint.index_unique===true&&(kind==='u'||constraint.index_primary===true)));
}
function foreignKey(surface:Surface,relation:string,names:readonly string[],reference:string,referenced:readonly string[],onDelete='a',name?:string){
  need(surface.constraints.some(constraint=>constraint.relation===relation&&constraint.kind==='f'&&validConstraint(constraint)
    &&(name===undefined||constraint.name===name)&&same(constraint.keys,names)&&constraint.referenced_relation===reference
    &&same(constraint.referenced_keys,referenced)&&constraint.on_update==='a'&&constraint.on_delete===onDelete&&constraint.match==='s'));
}
function index(surface:Surface,relation:string,name:string,names:readonly string[],options:readonly number[],opclasses:readonly string[],predicate?:string){
  need(surface.indexes.some(found=>found.relation===relation&&found.name===name&&found.valid&&found.ready&&!found.unique&&!found.primary
    &&found.method==='btree'&&same(found.key_names,names)&&same(found.key_options,options)&&same(found.key_opclasses,opclasses)
    &&found.expressions===null&&(predicate===undefined?found.predicate===null:expression(found.predicate,predicate))));
}

function memberStructure(s:Surface){
  columns(s,'intake.web_command_receipt',[C('h5_result','jsonb',false)]);
  columns(s,'intake.web_request_binding',[C('h5_profile_attempts','integer',true,'0'),C('h5_profile_next_attempt_epoch_ms','bigint',false)]);
  check(s,'intake.web_request_binding',between('h5_profile_attempts',0,1000));
  check(s,'intake.web_request_binding',or(isNull('h5_profile_next_attempt_epoch_ms'),atom('h5_profile_next_attempt_epoch_ms >= 0')));
  check(s,'conversation.realtime_event',anyText('source_type',['CONVERSATION_SESSION','CONVERSATION_ITEM','TIMELINE_REBUILD','COMMUNICATION_DELIVERY','TICKET_EVENT','HANDOFF_EVENT','READ_CURSOR','INCIDENT_EVENT','GATEWAY_EVENT','MANUAL_REVIEW','WEB_REPORT_URGE']),'conversation_realtime_event_source_type_check');
  check(s,'intake.web_command_receipt',atom('schema_version = ANY (ARRAY[1, 2])'),'web_command_receipt_schema_check');
  check(s,'intake.web_command_receipt',anyText('command_kind',['SUBMIT','SUPPLEMENT','FEEDBACK','URGE','EVALUATION']),'web_command_receipt_kind_check');
  check(s,'intake.web_command_receipt',or(and(anyText('command_kind',['URGE','EVALUATION']),notNull('h5_result'),atom("jsonb_typeof(h5_result) = 'object'::text")),and(allText('command_kind',['URGE','EVALUATION']),isNull('h5_result'))),'web_h5_result_purpose');
  const base=[C('id','uuid',true,'uuidv7()'),C('ticket_id','uuid'),C('source_intake_id','uuid'),C('scope_hash','text'),C('client_command_id','uuid'),C('occurred_at','timestamp without time zone'),C('occurred_epoch_ms','bigint'),C('retention_until_epoch_ms','bigint')];
  columns(s,'intake.web_report_urge',[...base,{...C('sequence_no','bigint'),identity:'a'},C('cycle_id','uuid',false)]);
  columns(s,'intake.web_report_evaluation',[...base,C('completed_cycle_id','uuid'),C('completion_event_id','uuid'),C('rating','smallint'),C('comment','text',false)]);
  for(const relation of ['intake.web_report_urge','intake.web_report_evaluation']){
    key(s,relation,'p',['id']);key(s,relation,'u',['scope_hash','client_command_id']);
    foreignKey(s,relation,['ticket_id'],'pilot_ticket.ticket',['id']);foreignKey(s,relation,['source_intake_id'],'intake.service_intake',['id']);
    check(s,relation,hex('scope_hash'));check(s,relation,pair('occurred_at','occurred_epoch_ms'));check(s,relation,atom('retention_until_epoch_ms > occurred_epoch_ms'));
  }
  key(s,'intake.web_report_urge','u',['sequence_no']);foreignKey(s,'intake.web_report_urge',['cycle_id'],'pilot_ticket.ticket_handling_cycle',['id']);
  index(s,'intake.web_report_urge','web_report_urge_current_idx',['ticket_id','cycle_id','occurred_epoch_ms'],[0,0,3],['pg_catalog.uuid_ops','pg_catalog.uuid_ops','pg_catalog.int8_ops']);
  key(s,'intake.web_report_evaluation','u',['completed_cycle_id']);
  foreignKey(s,'intake.web_report_evaluation',['completed_cycle_id'],'pilot_ticket.ticket_handling_cycle',['id']);
  foreignKey(s,'intake.web_report_evaluation',['completion_event_id'],'pilot_ticket.ticket_event',['event_id']);
  check(s,'intake.web_report_evaluation',between('rating',1,5));
  check(s,'intake.web_report_evaluation',or(isNull('comment'),and(atom('char_length(comment) >= 1'),atom('char_length(comment) <= 200'))));
  const progress='pilot_ticket.ticket_public_progress';
  columns(s,progress,[C('id','uuid',true,'uuidv7()'),C('ticket_id','uuid'),C('ticket_version','integer'),C('ticket_event_id','uuid'),C('actor_principal_id','uuid'),C('client_command_id','uuid'),C('command_hash','text'),C('summary','text'),C('estimated_at','timestamp without time zone',false),C('estimated_epoch_ms','bigint',false),C('occurred_at','timestamp without time zone'),C('occurred_epoch_ms','bigint'),C('result_snapshot','jsonb')]);
  key(s,progress,'p',['id']);key(s,progress,'u',['actor_principal_id','client_command_id']);key(s,progress,'u',['ticket_id','ticket_version']);
  foreignKey(s,progress,['ticket_id'],'pilot_ticket.ticket',['id']);foreignKey(s,progress,['ticket_event_id'],'pilot_ticket.ticket_event',['event_id']);foreignKey(s,progress,['actor_principal_id'],'pilot_ticket.pilot_principal',['id']);
  check(s,progress,atom('ticket_version > 0'));check(s,progress,hex('command_hash'));check(s,progress,between('char_length(summary)',1,500));
  check(s,progress,atom("jsonb_typeof(result_snapshot) = 'object'::text"));check(s,progress,pair('occurred_at','occurred_epoch_ms'));
  check(s,progress,or(and(isNull('estimated_at'),isNull('estimated_epoch_ms')),and(notNull('estimated_at'),notNull('estimated_epoch_ms'),pair('estimated_at','estimated_epoch_ms'))));
  index(s,progress,'ticket_public_progress_latest_idx',['ticket_id','ticket_version'],[0,3],['pg_catalog.uuid_ops','pg_catalog.int4_ops']);
}
function mediaStructure(s:Surface,stage:2|3){
  const media='intake.web_media_upload';
  columns(s,media,[C('media_ref','uuid'),C('scope_hash','text'),C('source_corp_scope','text'),C('source_app_scope','text'),C('client_command_id','uuid'),C('command_hash','text'),C('kind','text'),C('mime_type','text'),C('expected_byte_size','bigint',false),C('byte_size','bigint',false),C('sha256','text',false),C('duration_ms','integer',false),C('state','text'),C('write_lease','uuid',false),C('write_started_epoch_ms','bigint',false),C('transcode_lease','uuid',false),C('transcode_started_epoch_ms','bigint',false),C('playback_status','text',true,"'PENDING'::text"),C('playback_mime_type','text',false),C('playback_byte_size','bigint',false),C('playback_sha256','text',false),C('created_epoch_ms','bigint',true,'physical_epoch_ms()'),C('expires_epoch_ms','bigint'),C('intake_id','uuid',false),C('submission_id','uuid',false),C('request_ref','text',false),C('purged_epoch_ms','bigint',false)]);
  key(s,media,'p',['media_ref']);key(s,media,'u',['scope_hash','client_command_id'],'web_media_idempotency');
  foreignKey(s,media,['intake_id'],'intake.web_request_binding',['intake_id'],'r');foreignKey(s,media,['request_ref'],'intake.web_request_binding',['request_ref'],'r');
  foreignKey(s,media,['submission_id','intake_id'],'intake.web_submission',['id','intake_id'],'r','web_media_submission_intake_fk');
  for(const name of ['scope_hash','command_hash','sha256','playback_sha256'])check(s,media,hex(name));
  for(const name of ['source_corp_scope','source_app_scope'])check(s,media,between(`char_length(${name})`,1,128));
  check(s,media,between('char_length(mime_type)',1,64));check(s,media,anyText('kind',['VOICE','IMAGE','VIDEO']));
  for(const name of ['expected_byte_size','byte_size','playback_byte_size'])check(s,media,between(name,1,20971520));
  check(s,media,between('duration_ms',1,60000));check(s,media,anyText('state',['RESERVED','WRITING','READY','BOUND','CANCELLED']));
  check(s,media,anyText('playback_status',['READY','PENDING','UNAVAILABLE']));
  check(s,media,and(atom('expires_epoch_ms > created_epoch_ms'),or(equalText('state','BOUND'),atom('expires_epoch_ms <= (created_epoch_ms + 86400000)'))),'web_media_initial_retention');
  check(s,media,atom(`COALESCE(byte_size, expected_byte_size, (1)::bigint) <= CASE kind WHEN 'VOICE'::text THEN 5242880 WHEN 'IMAGE'::text THEN 10485760 ELSE 20971520 END`),'web_media_bytes_per_kind');
  check(s,media,or(allText('state',['READY','BOUND']),and(notNull('byte_size'),notNull('sha256'))),'web_media_content_state');
  check(s,media,or(and(equalText('state','BOUND'),notNull('intake_id'),notNull('submission_id'),notNull('request_ref')),and(notEqualText('state','BOUND'),isNull('intake_id'),isNull('submission_id'),isNull('request_ref'))),'web_media_binding_state');
  check(s,media,atom(`${equalText('state','WRITING')} = ${notNull('write_lease')}`),'web_media_write_state');
  check(s,media,atom(`${isNull('write_lease')} = ${isNull('write_started_epoch_ms')}`),'web_media_write_start');
  check(s,media,atom(`${isNull('transcode_lease')} = ${isNull('transcode_started_epoch_ms')}`),'web_media_transcode_start');
  check(s,media,or(and(equalText('playback_status','READY'),notNull('playback_mime_type'),notNull('playback_byte_size'),notNull('playback_sha256')),and(notEqualText('playback_status','READY'),isNull('playback_mime_type'),isNull('playback_byte_size'),isNull('playback_sha256'))),'web_media_playback');
  index(s,media,'web_media_scope_unbound',['scope_hash','expires_epoch_ms'],[0,0],['pg_catalog.text_ops','pg_catalog.int8_ops'],anyText('state',['RESERVED','WRITING','READY']));
  index(s,media,'web_media_intake',['intake_id','created_epoch_ms','media_ref'],[0,0,0],['pg_catalog.uuid_ops','pg_catalog.int8_ops','pg_catalog.uuid_ops'],equalText('state','BOUND'));
  if(stage===2)return;
  columns(s,media,[C('thumbnail_status','text',true,"'PENDING'::text"),C('thumbnail_mime_type','text',false),C('thumbnail_byte_size','bigint',false),C('thumbnail_sha256','text',false)]);
  check(s,media,anyText('thumbnail_status',['PENDING','READY','UNAVAILABLE']));check(s,media,between('thumbnail_byte_size',1,163840));check(s,media,hex('thumbnail_sha256'));
  check(s,media,or(and(equalText('thumbnail_status','READY'),equalText('kind','IMAGE'),equalText('thumbnail_mime_type','image/jpeg'),notNull('thumbnail_byte_size'),notNull('thumbnail_sha256')),and(notEqualText('thumbnail_status','READY'),isNull('thumbnail_mime_type'),isNull('thumbnail_byte_size'),isNull('thumbnail_sha256'))),'web_media_thumbnail_state');
  index(s,media,'web_media_pending_thumbnail',['created_epoch_ms','media_ref'],[0,0],['pg_catalog.int8_ops','pg_catalog.uuid_ops'],and(equalText('kind','IMAGE'),anyText('state',['READY','BOUND']),equalText('thumbnail_status','PENDING')));
  index(s,media,'web_media_pending_playback',['created_epoch_ms','media_ref'],[0,0],['pg_catalog.int8_ops','pg_catalog.uuid_ops'],and(anyText('kind',['VOICE','VIDEO']),anyText('state',['READY','BOUND']),equalText('playback_status','PENDING')));
}

/** Validate just the installed stages. No whole-catalog counts or fingerprint. */
export async function assertH5MigrationStructure(tx:PostgresTransaction,stage:Stage,mediaSqlBody:string){
  const relations=requiredRelations.slice(0,stage===1?3:4);
  const tables=(await tx.query<{relation:string;kind:string;persistence:string;row_security:boolean;force_row_security:boolean;is_partition:boolean}>(`SELECT n.nspname||'.'||c.relname AS relation,c.relkind AS kind,c.relpersistence AS persistence,
    c.relrowsecurity AS row_security,c.relforcerowsecurity AS force_row_security,c.relispartition AS is_partition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=ANY($1::text[])`,[relations])).rows;
  for(const relation of relations)need(tables.some(row=>row.relation===relation&&row.kind==='r'&&row.persistence==='p'&&!row.row_security&&!row.force_row_security&&!row.is_partition));
  const s=await surface(tx);memberStructure(s);
  // A valid predecessor receipt cannot legitimize unreceipted successor DDL.
  if(stage===1){
    const absent=(await tx.query<{ready:boolean}>(`SELECT to_regclass('intake.web_media_upload') IS NULL
      AND to_regprocedure('intake.guard_web_media_identity()') IS NULL AS ready`)).rows[0];
    need(absent?.ready===true);return;
  }
  mediaStructure(s,stage);
  if(stage===2){
    need(!s.columns.some(row=>row.relation==='intake.web_media_upload'&&['thumbnail_status','thumbnail_mime_type','thumbnail_byte_size','thumbnail_sha256'].includes(row.name)));
    need(!s.constraints.some(row=>row.relation==='intake.web_media_upload'&&row.name==='web_media_thumbnail_state'));
    need(!s.indexes.some(row=>row.relation==='intake.web_media_upload'&&['web_media_pending_thumbnail','web_media_pending_playback'].includes(row.name)));
  }
  const expectedBody=/CREATE FUNCTION intake\.guard_web_media_identity\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/u.exec(mediaSqlBody)?.[1];
  if(expectedBody===undefined)throw Error('H5_MIGRATION_FILE_INVALID');
  const routines=(await tx.query<{body:string;language:string;kind:string;returns_trigger:boolean;argument_count:number;variadic:boolean;security_definer:boolean;volatility:string;parallel:string;leakproof:boolean;strict:boolean;set_returning:boolean;configuration:string[]|null}>(`SELECT p.prosrc AS body,l.lanname AS language,p.prokind AS kind,p.prorettype='trigger'::regtype AS returns_trigger,
    p.pronargs AS argument_count,p.provariadic<>0 AS variadic,p.prosecdef AS security_definer,p.provolatile AS volatility,p.proparallel AS parallel,
    p.proleakproof AS leakproof,p.proisstrict AS strict,p.proretset AS set_returning,p.proconfig AS configuration
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure('intake.guard_web_media_identity()')`)).rows;
  const routine=routines[0];need(routines.length===1&&routine!==undefined&&routine.body===expectedBody&&routine.language==='plpgsql'&&routine.kind==='f'&&routine.returns_trigger
    &&routine.argument_count===0&&!routine.variadic&&!routine.security_definer&&routine.volatility==='v'&&routine.parallel==='u'&&!routine.leakproof&&!routine.strict&&!routine.set_returning&&routine.configuration===null);
  const trigger=(await tx.query<{valid:boolean}>(`SELECT t.tgname='web_media_identity_guard' AND t.tgenabled='O' AND t.tgtype=23 AND t.tgnargs=0
    AND t.tgfoid=to_regprocedure('intake.guard_web_media_identity()') AND NOT t.tgisinternal AND t.tgconstraint=0
    AND t.tgqual IS NULL AND cardinality(t.tgattr::smallint[])=0 AS valid FROM pg_trigger t
    WHERE t.tgrelid=to_regclass('intake.web_media_upload') AND t.tgname='web_media_identity_guard'`)).rows;
  need(trigger.length===1&&trigger[0]?.valid===true);
}
