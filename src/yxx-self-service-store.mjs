import {randomBytes,randomUUID,createHmac,timingSafeEqual} from 'node:crypto';
import {hashP2016,snapshotP2016,stampP2016,textHashP2016,transactionP2016,uuidP2016} from './p2-016-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal,shanghaiLocalToEpochMs} from './platform/time-contract.mjs';

export const YXX_WEB_LIMITS=Object.freeze({description:4000,location:200,department:100,extension:20,supplement:2000,body:16*1024,list:50,timeline:100,window:50});
const IMPACTS=new Set(['UNKNOWN','SELF','SINGLE_WORKSTATION','MULTIPLE_USERS','DEPARTMENT']);
const HASH=/^[a-f0-9]{64}$/u;
const REF=/^[A-Za-z0-9_-]{32}$/u;
const TICKET_TIMELINE_EVENTS=Object.freeze(['ticket.created','ticket.queued','ticket.accepted','ticket.started','ticket.waiting_requester','ticket.waiting_vendor','ticket.resumed','ticket.information_added','ticket.resolved','ticket.closed','ticket.reopened','ticket.cancelled']);
const cleanText=(value,max)=>{if(typeof value!=='string')throw new TypeError('YXX_INPUT_INVALID');const text=value.trim();if(!text||Array.from(text).length>max||Buffer.byteLength(text,'utf8')>max*4)throw new TypeError('YXX_INPUT_INVALID');return text;};
const optionalText=(value,max)=>value===null?null:typeof value==='string'&&value.trim()===''?null:cleanText(value,max);
const ensureHash=value=>{if(typeof value!=='string'||!HASH.test(value))throw new TypeError('YXX_SCOPE_INVALID');return value;};
const requestRef=value=>{if(typeof value!=='string'||!REF.test(value))throw new TypeError('YXX_REQUEST_REF_INVALID');return value;};
const opaqueRef=()=>randomBytes(24).toString('base64url');

export function parseYxxRequestInput(value){
  const input=snapshotP2016(value);
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['schema_version','client_command_id','description','location','service_code','impact_scope','reported_department_text','extension'].includes(key))
    ||input.schema_version!==1)throw new TypeError('YXX_INPUT_INVALID');
  uuidP2016(input.client_command_id);
  const description=cleanText(input.description,YXX_WEB_LIMITS.description);
  if(!input.location||Array.isArray(input.location)||typeof input.location!=='object'||Object.keys(input.location).some(key=>!['text','unknown'].includes(key))||typeof input.location.unknown!=='boolean')throw new TypeError('YXX_INPUT_INVALID');
  const locationText=input.location.unknown
    ? (input.location.text===null||(typeof input.location.text==='string'&&input.location.text.trim()==='')?null:optionalText(input.location.text,YXX_WEB_LIMITS.location))
    : cleanText(input.location.text,YXX_WEB_LIMITS.location);
  let serviceCode=input.service_code===null?null:cleanText(input.service_code,64).toUpperCase();if(serviceCode!==null&&!/^[A-Z][A-Z0-9_]{0,63}$/u.test(serviceCode))throw new TypeError('YXX_INPUT_INVALID');
  if(typeof input.impact_scope!=='string'||!IMPACTS.has(input.impact_scope))throw new TypeError('YXX_INPUT_INVALID');
  const department=optionalText(input.reported_department_text,YXX_WEB_LIMITS.department);
  const extension=input.extension===null?null:cleanText(input.extension,YXX_WEB_LIMITS.extension);if(extension!==null&&!/^[0-9][0-9 -]{0,19}$/u.test(extension))throw new TypeError('YXX_INPUT_INVALID');
  return Object.freeze({schema_version:1,client_command_id:input.client_command_id.toLowerCase(),description,location:Object.freeze({text:locationText,unknown:input.location.unknown}),service_code:serviceCode,impact_scope:input.impact_scope,reported_department_text:department,extension});
}

export function parseYxxSupplementInput(value){
  const input=snapshotP2016(value);
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['schema_version','client_command_id','expected_input_revision','text'].includes(key))||input.schema_version!==1)throw new TypeError('YXX_INPUT_INVALID');
  uuidP2016(input.client_command_id);if(typeof input.expected_input_revision!=='string'||!/^[1-9][0-9]*$/u.test(input.expected_input_revision))throw new TypeError('YXX_INPUT_INVALID');
  return Object.freeze({schema_version:1,client_command_id:input.client_command_id.toLowerCase(),expected_input_revision:input.expected_input_revision,text:cleanText(input.text,YXX_WEB_LIMITS.supplement)});
}

function safeTicket(row){return row?.ticket_no?Object.freeze({ticket_no:row.ticket_no,status:row.ticket_status??row.status,updated_at:row.ticket_updated_at?String(row.ticket_updated_at):row.updated_at?String(row.updated_at):undefined}):null;}
function localEpoch(value){try{return String(shanghaiLocalToEpochMs(String(value)));}catch{return '0';}}
function displayStatus(row){
  if(row.pilot_ticket_id)return 'TICKET_CREATED';
  if(row.input_revision!==row.processed_revision)return 'RECEIVED_PROCESSING';
  if(row.status==='WAITING_DESCRIPTION')return 'WAITING_FOR_DETAILS';
  if(row.status==='WAITING_REVIEW'||row.status==='WAITING_TRIAGE'||row.review_id)return 'UNDER_REVIEW';
  if(row.status==='IGNORED'||row.status==='COMPLETED')return 'NOT_SERVICE';
  return 'RECEIVED_PROCESSING';
}
function timelineItem(row){
  if(row.event_source==='TICKET'){
    const eventType=row.event_type==='ticket.created'?'TICKET_CREATED':'TICKET_UPDATED';
    const ticket=row.ticket_no?{ticket_no:row.ticket_no,status:row.ticket_status,updated_at:String(row.ticket_updated_at)}:null;
    return {event_type:eventType,occurred_at:String(row.occurred_at),occurred_epoch_ms:localEpoch(row.occurred_at),summary:eventType==='TICKET_CREATED'?'工单已创建':'工单状态已更新',ticket};
  }
  const terminalStatus=row.payload?.new_status;
  const eventType=terminalStatus==='IGNORED'?'NOT_SERVICE':terminalStatus==='COMPLETED'?'NOT_SERVICE'
    :terminalStatus==='WAITING_DESCRIPTION'?'WAITING_FOR_DETAILS':terminalStatus==='WAITING_TRIAGE'?'UNDER_REVIEW'
      :row.event_type==='intake.web_received'?'REQUEST_ACCEPTED'
    :row.event_type==='intake.web_supplement_added'?'SUPPLEMENT_ACCEPTED'
      :row.event_type==='intake.description_requested'?'WAITING_FOR_DETAILS'
        :row.event_type==='intake.manual_review_required'?'UNDER_REVIEW'
          :row.event_type==='intake.ticket_created'?'TICKET_CREATED':'PROCESSING';
  const ticket=eventType==='TICKET_CREATED'&&row.ticket_no?{ticket_no:row.ticket_no,status:row.ticket_status,updated_at:String(row.ticket_updated_at)}:null;
  const summary=eventType==='REQUEST_ACCEPTED'?'报修已收到':eventType==='SUPPLEMENT_ACCEPTED'?'补充说明已收到':eventType==='WAITING_FOR_DETAILS'?'需要补充故障现象':eventType==='UNDER_REVIEW'?'正在人工审核':eventType==='TICKET_CREATED'?'工单已创建':eventType==='NOT_SERVICE'?'不属于报修范围':'报修正在处理中';
  return {event_type:eventType,occurred_at:String(row.occurred_at),occurred_epoch_ms:localEpoch(row.occurred_at),summary,ticket};
}
function publicDetail(row){
  const created=String(row.created_at),updated=String(row.updated_at);
  return Object.freeze({request_ref:row.request_ref,intake_no:row.intake_no,source_kind:'WEB_REQUEST',input_revision:String(row.input_revision),processed_revision:String(row.processed_revision),display_status:displayStatus(row),needs_action:row.needs_action??null,safe_description:row.safe_description,safe_location:row.safe_location??null,created_at:created,created_epoch_ms:localEpoch(created),updated_at:updated,updated_epoch_ms:localEpoch(updated),ticket:safeTicket(row),safe_clarification:row.safe_clarification??null,can_supplement:BigInt(row.input_revision)<BigInt(YXX_WEB_LIMITS.window)&&!['CLOSED','CANCELLED'].includes(row.ticket_status??'')&&row.revoked_at===null});
}
function cursorToken(payload,secret){const data=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');return data+'.'+createHmac('sha256',secret).update(data).digest('base64url');}
function decodeCursor(value,secret,scopeHash){if(typeof value!=='string'||value.length>2048)throw new TypeError('YXX_CURSOR_INVALID');const parts=value.split('.');if(parts.length!==2||!parts[0]||!parts[1])throw new TypeError('YXX_CURSOR_INVALID');const [data,signature]=parts;const expected=createHmac('sha256',secret).update(data).digest('base64url');const a=Buffer.from(signature),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))throw new TypeError('YXX_CURSOR_INVALID');let parsed;try{parsed=JSON.parse(Buffer.from(data,'base64url').toString('utf8'));}catch{throw new TypeError('YXX_CURSOR_INVALID');}if(parsed.scope_hash!==scopeHash||typeof parsed.created_at!=='string'||typeof parsed.id!=='string')throw new TypeError('YXX_CURSOR_INVALID');return parsed;}
function timelineKey(row){return {occurred_at:String(row.occurred_at),source_rank:Number(row.source_rank),source_id:String(row.source_id),source_ordinal:Number(row.source_ordinal),event_source:row.event_source,timeline_ordinal:Number(row.timeline_ordinal)};}
function compareTimeline(left,right){return left.occurred_at<right.occurred_at?-1:left.occurred_at>right.occurred_at?1:left.source_rank!==right.source_rank?left.source_rank-right.source_rank:left.source_id<right.source_id?-1:left.source_id>right.source_id?1:0;}
function timelineSourceKey(row){return `${row.event_source}:${row.source_id}`;}

export function createYxxSelfServiceStore({pool,scopeSecret='yxx-self-service-cursor-secret',now=()=>String(Date.now()),retentionMs=30*24*60*60*1000}={}){
  if(!pool?.connect||typeof scopeSecret!=='string'||Buffer.byteLength(scopeSecret)<16)throw new TypeError('YXX_STORE_CONFIG_INVALID');
  const commandScope=scope=>ensureHash(scope.scopeHash??scope.canonical_reporter_binding);
  const stamp=()=>stampP2016(now);
  async function acceptInTransaction({scope,input,kind='SUBMIT',requestRef:nullRef=null,transaction:tx,onNewCommand=null,onBeforeCommit=null}){
    if(!scope||kind!=='SUBMIT'&&kind!=='SUPPLEMENT')throw new TypeError('YXX_INPUT_INVALID');if(typeof scope.sourceCorpScope!=='string'||scope.sourceCorpScope.length<1||scope.sourceCorpScope.length>128||typeof scope.sourceAppScope!=='string'||scope.sourceAppScope.length<1||scope.sourceAppScope.length>128)throw new TypeError('YXX_SCOPE_INVALID');const value=kind==='SUBMIT'?parseYxxRequestInput(input):parseYxxSupplementInput(input);if(kind==='SUPPLEMENT')requestRef(nullRef);const scopeHash=commandScope(scope);const commandHash=hashP2016({kind,request_ref:kind==='SUPPLEMENT'?nullRef:null,schema_version:value.schema_version,...value});
      const beforeCommit=async(payload)=>{if(onBeforeCommit===null)return;if(typeof onBeforeCommit!=='function'||await onBeforeCommit(payload)!==true){const error=new Error('YXX_AUTH_RECHECK_FAILED');error.code='YXX_AUTH_RECHECK_FAILED';throw error;}};
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[scopeHash+':'+value.client_command_id]);
      const existing=await tx.query(`SELECT r.id::text,r.command_hash,r.result_intake_id::text,r.result_request_ref,r.accepted_revision,to_char(r.accepted_at,'YYYY-MM-DD HH24:MI:SS') AS accepted_at,r.accepted_epoch_ms::text,i.intake_no
        FROM intake.web_command_receipt r LEFT JOIN intake.service_intake i ON i.id=r.result_intake_id
        WHERE r.scope_hash=$1 AND r.client_command_id=$2::uuid FOR UPDATE OF r`,[scopeHash,value.client_command_id]);
      if(existing.rowCount){const row=existing.rows[0];const active=await tx.query(`SELECT b.canonical_reporter_binding,b.source_corp_scope,b.source_app_scope,b.revoked_at,b.retention_until_epoch_ms::text AS binding_retention_epoch_ms,i.retention_until_epoch_ms::text AS intake_retention_epoch_ms
          FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
         WHERE b.intake_id=$1::uuid FOR SHARE OF b,i`,[row.result_intake_id]);const binding=active.rows[0],current=stamp();if(active.rowCount!==1||binding.canonical_reporter_binding!==scopeHash||binding.source_corp_scope!==(scope.sourceCorpScope)||binding.source_app_scope!==(scope.sourceAppScope)||binding.revoked_at!==null||binding.binding_retention_epoch_ms===null||binding.intake_retention_epoch_ms===null||BigInt(binding.binding_retention_epoch_ms)<=BigInt(current.epoch)||BigInt(binding.intake_retention_epoch_ms)<=BigInt(current.epoch)){const error=new Error('YXX_NOT_FOUND');error.code='YXX_NOT_FOUND';error.status=404;throw error;}if(row.command_hash!==commandHash){const error=new Error('YXX_COMMAND_CONFLICT');error.code='YXX_COMMAND_CONFLICT';error.status=409;throw error;}const receipt={client_command_id:value.client_command_id,status:'ACCEPTED',request_ref:row.result_request_ref,intake_no:row.intake_no??null,accepted_revision:String(row.accepted_revision),accepted_at:String(row.accepted_at),accepted_epoch_ms:String(row.accepted_epoch_ms)};await beforeCommit({scope,value,kind,transaction:tx,replayed:true,receipt});return {replayed:true,receipt};}
      if(onNewCommand!==null){if(typeof onNewCommand!=='function')throw new TypeError('YXX_INPUT_INVALID');if(await onNewCommand({scope,value,kind,transaction:tx})!==true){const error=new Error('YXX_MEMBER_QUOTA_EXCEEDED');error.code='YXX_MEMBER_QUOTA_EXCEEDED';error.status=429;throw error;}}
      const current=stamp(),retentionEpoch=String(BigInt(current.epoch)+BigInt(retentionMs)),retentionLocal=formatEpochMsToShanghaiLocal(retentionEpoch),receiptId=randomUUID();let intakeId,requestRefValue=nullRef,revision=1;
      if(kind==='SUBMIT'){
        intakeId=randomUUID();requestRefValue=opaqueRef();
        await tx.query(`INSERT INTO intake.web_command_receipt(id,scope_hash,client_command_id,command_kind,command_hash,schema_version,accepted_revision,status,accepted_at,accepted_epoch_ms,created_at)
          VALUES($1::uuid,$2,$3::uuid,$4,$5,1,1,'ACCEPTED',$6::timestamp without time zone,$7::bigint,$6::timestamp without time zone)`,[receiptId,scopeHash,value.client_command_id,kind,commandHash,current.local,current.epoch]);
        await tx.query(`INSERT INTO intake.service_intake(id,intake_no,source_channel,source_provider,source_bot_id,source_chat_type,source_chat_id,reporter_wecom_userid,
          explicit_aggregation_boundary,privacy_class,retention_until,request_type,summary,reported_department_id,reported_location_text,status,primary_message_id,message_count,last_message_at,version,created_at,updated_at,primary_web_submission_id,source_app_scope,canonical_reporter_binding)
          VALUES($1::uuid,'INT-'||to_char($2::timestamp without time zone,'YYYYMMDD')||'-'||lpad(nextval('intake.service_intake_number_seq')::text,4,'0'),'PORTAL','YIXIAOXIU_WEB',NULL,NULL,NULL,NULL,FALSE,'PERSONAL',$3::timestamp without time zone,'SERVICE_REQUEST',LEFT($8,500),NULL,$4,'RECEIVED',NULL,1,$2::timestamp without time zone,1,$2::timestamp without time zone,$2::timestamp without time zone,$5::uuid,$6,$7)`,[intakeId,current.local,retentionLocal,value.location.text,randomUUID(),scope.sourceAppScope,scopeHash,value.description]);
        const primary=(await tx.query('SELECT primary_web_submission_id::text FROM intake.service_intake WHERE id=$1::uuid FOR UPDATE',[intakeId])).rows[0].primary_web_submission_id;
        await tx.query(`INSERT INTO intake.web_request_binding(intake_id,request_ref,source_corp_scope,source_app_scope,canonical_reporter_binding,proof_ref,input_revision,processed_revision,next_attempt_epoch_ms,retention_until,retention_until_epoch_ms)
          VALUES($1::uuid,$2,$3,$4,$5,$6,1,0,$7::bigint,$8::timestamp without time zone,$9::bigint)`,[intakeId,requestRefValue,scope.sourceCorpScope,scope.sourceAppScope,scopeHash,scope.proofRef??null,current.epoch,retentionLocal,retentionEpoch]);
        await tx.query(`INSERT INTO intake.web_submission(id,intake_id,command_receipt_id,kind,input_revision,sequence_no,safe_content,canonical_content_hash,canonical_reporter_binding,received_at,received_epoch_ms,retention_until,retention_until_epoch_ms)
          VALUES($1::uuid,$2::uuid,$3::uuid,'SUBMIT',1,1,$4::jsonb,$5,$6,$7::timestamp without time zone,$8::bigint,$9::timestamp without time zone,$10::bigint)`,[primary,intakeId,receiptId,JSON.stringify(value),hashP2016(value),scopeHash,current.local,current.epoch,retentionLocal,retentionEpoch]);
        await tx.query(`INSERT INTO intake.contact_journey(id,creation_key,origin_intake_id,entry_mode,origin_channel,current_channel,source_app_scope,reporter_identity_hash,profile_resolution_status,profile_snapshot,profile_snapshot_hash,status,evaluation_due_at,evaluation_due_epoch_ms,reported_at,last_activity_at,privacy_class,retention_until,retention_until_epoch_ms)
          VALUES($1::uuid,$2,$3::uuid,'APP_WEB_SELF_SERVICE','PORTAL','PORTAL',$4,$5,'NOT_REQUIRED',$6::jsonb,$7,'OPEN',$8::timestamp without time zone,$9::bigint,$10::timestamp without time zone,$10,'PERSONAL',$11::timestamp without time zone,$12::bigint)`,[randomUUID(),'web:'+intakeId,intakeId,scope.sourceAppScope,scopeHash,JSON.stringify({source:'YIXIAOXIU_WEB'}),hashP2016({source:'YIXIAOXIU_WEB'}),current.local,current.epoch,current.local,retentionLocal,retentionEpoch]);
        const journey=(await tx.query('SELECT id::text FROM intake.contact_journey WHERE origin_intake_id=$1::uuid',[intakeId])).rows[0].id;
        await tx.query(`INSERT INTO intake.channel_leg(journey_id,leg_ordinal,leg_type,source_intake_id,web_submission_id,provider_context_hash,channel_identity_hash,reporter_identity_hash,opened_at)
          VALUES($1::uuid,1,'WEB_FORM',$2::uuid,$3::uuid,$4,$5,$6,$7::timestamp without time zone)`,[journey,intakeId,primary,textHashP2016('YIXIAOXIU_WEB'),textHashP2016(scope.sourceAppScope),scopeHash,current.local]);
        await tx.query(`INSERT INTO intake.service_intake_event(event_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
          VALUES('intake.web_received',$1::uuid,1,1,$2::timestamp without time zone,$3::text,$4::jsonb)`,[intakeId,current.local,receiptId,JSON.stringify({source_kind:'WEB_REQUEST',input_revision:'1'})]);
        await tx.query('UPDATE intake.service_intake SET primary_web_submission_id=$2::uuid WHERE id=$1::uuid',[intakeId,primary]);
        await tx.query('UPDATE intake.web_command_receipt SET result_intake_id=$2::uuid,result_request_ref=$3 WHERE id=$1::uuid',[receiptId,intakeId,requestRefValue]);
        const intake=(await tx.query('SELECT intake_no FROM intake.service_intake WHERE id=$1::uuid',[intakeId])).rows[0];
        const receipt={client_command_id:value.client_command_id,status:'ACCEPTED',request_ref:requestRefValue,intake_no:intake.intake_no,accepted_revision:'1',accepted_at:current.local,accepted_epoch_ms:current.epoch};
        await beforeCommit({scope,value,kind,transaction:tx,replayed:false,receipt});
        return {replayed:false,receipt};
      }
      requestRefValue=requestRef(nullRef);const locked=await tx.query(`SELECT b.intake_id::text,b.input_revision,b.retention_until,i.intake_no,i.pilot_ticket_id::text,i.status,t.status AS ticket_status
        FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id WHERE b.request_ref=$1 AND b.canonical_reporter_binding=$2 AND b.source_corp_scope=$3 AND b.source_app_scope=$4 AND b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND i.retention_until>platform.local_now() AND (t.status IS NULL OR t.status NOT IN ('CLOSED','CANCELLED')) FOR UPDATE OF b,i`,[requestRefValue,scopeHash,scope.sourceCorpScope,scope.sourceAppScope]);
      if(locked.rowCount!==1){const error=new Error('YXX_NOT_FOUND');error.code='YXX_NOT_FOUND';error.status=404;throw error;}
      const row=locked.rows[0];if(BigInt(value.expected_input_revision)!==BigInt(row.input_revision)){const error=new Error('YXX_VERSION_CONFLICT');error.code='YXX_VERSION_CONFLICT';error.status=409;throw error;}if(BigInt(row.input_revision)>=BigInt(YXX_WEB_LIMITS.window)){const error=new Error('YXX_LIMIT_EXCEEDED');error.code='YXX_LIMIT_EXCEEDED';error.status=413;throw error;}
      revision=Number(row.input_revision)+1;intakeId=row.intake_id;
      await tx.query(`INSERT INTO intake.web_command_receipt(id,scope_hash,client_command_id,command_kind,command_hash,schema_version,accepted_revision,status,accepted_at,accepted_epoch_ms,created_at,result_intake_id,result_request_ref)
        VALUES($1::uuid,$2,$3::uuid,'SUPPLEMENT',$4,1,$5,'ACCEPTED',$6::timestamp without time zone,$7::bigint,$6::timestamp without time zone,$8::uuid,$9)`,[receiptId,scopeHash,value.client_command_id,commandHash,revision,current.local,current.epoch,intakeId,requestRefValue]);
      const submissionId=randomUUID();await tx.query(`INSERT INTO intake.web_submission(id,intake_id,command_receipt_id,kind,input_revision,sequence_no,safe_content,canonical_content_hash,canonical_reporter_binding,received_at,received_epoch_ms,retention_until,retention_until_epoch_ms)
        VALUES($1::uuid,$2::uuid,$3::uuid,'SUPPLEMENT',$4,$4,$5::jsonb,$6,$7,$8::timestamp without time zone,$9::bigint,$10::timestamp without time zone,$11::bigint)`,[submissionId,intakeId,receiptId,revision,JSON.stringify(value),hashP2016(value),scopeHash,current.local,current.epoch,retentionLocal,retentionEpoch]);
      await tx.query(`UPDATE intake.web_submission SET retention_until=$2::timestamp without time zone,
        retention_until_epoch_ms=$3::bigint WHERE intake_id=$1::uuid`,[intakeId,retentionLocal,retentionEpoch]);
      await tx.query(`UPDATE intake.web_request_binding SET input_revision=$2,updated_at=$3::timestamp without time zone,
        next_attempt_epoch_ms=$4::bigint,retention_until=$5::timestamp without time zone,retention_until_epoch_ms=$6::bigint
        WHERE intake_id=$1::uuid`,[intakeId,revision,current.local,current.epoch,retentionLocal,retentionEpoch]);
      const intakeUpdate=await tx.query(`UPDATE intake.service_intake SET summary=LEFT(COALESCE(summary,'') || E'\\n' || $3,500),
        retention_until=$4::timestamp without time zone,retention_until_epoch_ms=$5::bigint,
        updated_at=$2::timestamp without time zone,version=version+1 WHERE id=$1::uuid RETURNING version`,[intakeId,current.local,value.text,retentionLocal,retentionEpoch]);
      await tx.query(`UPDATE intake.contact_journey SET retention_until=$2::timestamp without time zone,
        retention_until_epoch_ms=$3::bigint,updated_at=GREATEST(created_at,$4::timestamp without time zone)
        WHERE origin_intake_id=$1::uuid`,[intakeId,retentionLocal,retentionEpoch,current.local]);
      const aggregateVersion=intakeUpdate.rows[0]?.version;
      const eventCount=(await tx.query('SELECT COALESCE(max(event_ordinal),0)+1 AS n FROM intake.service_intake_event WHERE intake_id=$1::uuid',[intakeId])).rows[0].n;
      await tx.query(`INSERT INTO intake.service_intake_event(event_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
        VALUES('intake.web_supplement_added',$1::uuid,$2,$3,$4::timestamp without time zone,$5,$6::jsonb)`,[intakeId,aggregateVersion,eventCount, current.local,receiptId,JSON.stringify({source_kind:'WEB_REQUEST',input_revision:String(revision)})]);
      const receipt={client_command_id:value.client_command_id,status:'ACCEPTED',request_ref:requestRefValue,intake_no:row.intake_no,accepted_revision:String(revision),accepted_at:current.local,accepted_epoch_ms:current.epoch};
      await beforeCommit({scope,value,kind,transaction:tx,replayed:false,receipt});
      return {replayed:false,receipt};
  }
  async function accept(args){
    if(args?.transaction)return acceptInTransaction(args);
    return transactionP2016(pool,transaction=>acceptInTransaction({...args,transaction}));
  }
  async function getRequest({scope,requestRef:ref}){const scopeHash=commandScope(scope);requestRef(ref);return transactionP2016(pool,async tx=>{const q=await tx.query(`SELECT b.request_ref,b.input_revision,b.processed_revision,b.revoked_at,i.intake_no,i.status,i.pilot_ticket_id::text,to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,web.safe_description,web.safe_location,
      t.ticket_no,t.status AS ticket_status,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at,EXISTS (SELECT 1 FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING') AS has_pending_review FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id LEFT JOIN LATERAL (SELECT s.safe_content->>'description' AS safe_description,CASE WHEN (s.safe_content->'location'->>'unknown')::boolean THEN NULL ELSE s.safe_content->'location'->>'text' END AS safe_location FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUBMIT' ORDER BY s.input_revision LIMIT 1) web ON TRUE LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id WHERE b.request_ref=$1 AND b.canonical_reporter_binding=$2 AND b.source_corp_scope=$3 AND b.source_app_scope=$4 AND b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND i.retention_until>platform.local_now() FOR SHARE OF b,i`,[ref,scopeHash,scope.sourceCorpScope,scope.sourceAppScope]);if(q.rowCount!==1){const e=new Error('YXX_NOT_FOUND');e.code='YXX_NOT_FOUND';e.status=404;throw e;}const row=q.rows[0];return publicDetail({...row,review_id:row.has_pending_review?'pending':null,safe_description:row.safe_description??'',safe_location:row.safe_location,ticket:row.ticket_no?{ticket_no:row.ticket_no,status:row.ticket_status,updated_at:row.ticket_updated_at}:null});});}
  async function listMyReports({scope,limit=20,cursor=null}={}){const scopeHash=commandScope(scope);if(!Number.isInteger(limit)||limit<1||limit>YXX_WEB_LIMITS.list)throw new TypeError('YXX_LIMIT_INVALID');const after=cursor===null||cursor===undefined?null:decodeCursor(cursor,scopeSecret,scopeHash);return transactionP2016(pool,async tx=>{const args=[scopeHash,scope.sourceCorpScope,scope.sourceAppScope,limit+1];let where='b.canonical_reporter_binding=$1 AND b.source_corp_scope=$2 AND b.source_app_scope=$3 AND b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND i.retention_until>platform.local_now()';if(after){where+=' AND (b.created_at,b.intake_id)<($5::timestamp without time zone,$6::uuid)';args.push(after.created_at,after.id);}const q=await tx.query(`SELECT b.request_ref,b.intake_id::text AS id,i.intake_no,to_char(b.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,i.pilot_ticket_id::text,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at,t.ticket_no,t.status AS ticket_status,i.status,b.input_revision,b.processed_revision FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id LEFT JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id WHERE ${where} ORDER BY b.created_at DESC,b.intake_id DESC LIMIT $4`,args);const rows=q.rows.slice(0,limit);const items=rows.map(row=>({kind:'WEB_REQUEST',ref:row.request_ref,display_status:displayStatus(row),created_at:String(row.created_at),created_epoch_ms:localEpoch(row.created_at),ticket:row.ticket_no?{ticket_no:row.ticket_no,status:row.ticket_status,updated_at:String(row.ticket_updated_at)}:null}));const next=rows.length===limit&&q.rows.length>limit?cursorToken({scope_hash:scopeHash,created_at:String(rows.at(-1).created_at),id:rows.at(-1).id},scopeSecret):null;return {items,next_cursor:next};});}
  async function timelineCombined({scope,requestRef:ref,after=null,before=null,cursor=null,limit=50}={}) {
    const scopeHash=commandScope(scope);requestRef(ref);
    if(after!==null&&before!==null||cursor!==null&&(after!==null||before!==null))throw new TypeError('YXX_CURSOR_INVALID');
    if(!Number.isInteger(limit)||limit<1||limit>YXX_WEB_LIMITS.timeline)throw new TypeError('YXX_LIMIT_INVALID');
    return transactionP2016(pool,async tx=>{
      const owner=await tx.query('SELECT b.intake_id::text FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.request_ref=$1 AND b.canonical_reporter_binding=$2 AND b.source_corp_scope=$3 AND b.source_app_scope=$4 AND b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND i.retention_until>platform.local_now()',[ref,scopeHash,scope.sourceCorpScope,scope.sourceAppScope]);
      if(owner.rowCount!==1){const e=new Error('YXX_NOT_FOUND');e.code='YXX_NOT_FOUND';e.status=404;throw e;}
      let key=null,numericBoundary=null,order='ASC';
       if(cursor){const [data,signature]=cursor.split('.');if(!data||!signature)throw new TypeError('YXX_CURSOR_INVALID');const expected=createHmac('sha256',scopeSecret).update(data).digest('base64url'),a=Buffer.from(signature),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))throw new TypeError('YXX_CURSOR_INVALID');try{const parsed=JSON.parse(Buffer.from(data,'base64url').toString('utf8'));if(parsed.scope_hash!==scopeHash||parsed.request_ref!==ref||!Number.isSafeInteger(parsed.timeline_ordinal)||parsed.timeline_ordinal<1||!Number.isInteger(parsed.intake_high_water)||!Number.isInteger(parsed.ticket_high_water)||parsed.intake_high_water<0||parsed.ticket_high_water<0||!['ASC','DESC'].includes(parsed.direction)||typeof parsed.occurred_at!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/u.test(parsed.occurred_at)||!Number.isInteger(parsed.source_rank)||!Number.isInteger(parsed.source_ordinal)||!['INTAKE','TICKET'].includes(parsed.event_source)||typeof parsed.source_id!=='string'||!/^[0-9a-f-]{36}$/iu.test(parsed.source_id)||parsed.seen_source_keys!==undefined&&(!Array.isArray(parsed.seen_source_keys)||parsed.seen_source_keys.some(value=>typeof value!=='string'||!/^(INTAKE|TICKET):[0-9a-f-]{36}$/iu.test(value))))throw new Error('cursor');parsed.seen_source_keys=Array.isArray(parsed.seen_source_keys)?parsed.seen_source_keys:[];key=parsed;order=parsed.direction;}catch{throw new TypeError('YXX_CURSOR_INVALID');}}
      else if(after!==null){if(!/^[0-9]+$/u.test(after)||!Number.isSafeInteger(Number(after)))throw new TypeError('YXX_CURSOR_INVALID');numericBoundary=Number(after);}
      else if(before!==null){if(!/^[0-9]+$/u.test(before)||!Number.isSafeInteger(Number(before)))throw new TypeError('YXX_CURSOR_INVALID');numericBoundary=Number(before);order='DESC';}
      const args=[owner.rows[0].intake_id,limit+1,TICKET_TIMELINE_EVENTS];let boundarySql='';
        if(key){args.push(key.occurred_at,key.source_rank,key.source_id,key.intake_high_water,key.ticket_high_water,key.seen_source_keys);boundarySql=order==='ASC'?`WHERE NOT ((event_source||':'||source_id)=ANY($9::text[])) AND ((occurred_at>$4::timestamp without time zone OR (occurred_at=$4::timestamp without time zone AND source_rank>$5::integer) OR (occurred_at=$4::timestamp without time zone AND source_rank=$5::integer AND source_id>$6::text)) OR (event_source='INTAKE' AND source_ordinal>$7) OR (event_source='TICKET' AND source_ordinal>$8))`:`WHERE NOT ((event_source||':'||source_id)=ANY($9::text[])) AND ((event_source='INTAKE' AND source_ordinal<=$7) OR (event_source='TICKET' AND source_ordinal<=$8)) AND (occurred_at<$4::timestamp without time zone OR (occurred_at=$4::timestamp without time zone AND source_rank<$5::integer) OR (occurred_at=$4::timestamp without time zone AND source_rank=$5::integer AND source_id<$6::text))`;}
      else if(numericBoundary!==null){args.push(numericBoundary);boundarySql=order==='ASC'?'WHERE timeline_ordinal>$4':'WHERE timeline_ordinal<$4';}
      const q=await tx.query(`WITH all_events AS (
           SELECT 'INTAKE'::text AS event_source,e.event_type,e.payload,e.occurred_at::timestamp without time zone AS occurred_at,e.event_ordinal::integer AS source_ordinal,e.event_id::text AS source_id,
                  t.ticket_no,t.status AS ticket_status,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at,0::integer AS source_rank
            FROM intake.service_intake_event e LEFT JOIN pilot_ticket.ticket t ON t.source_intake_id=e.intake_id
           WHERE e.intake_id=$1::uuid AND (e.event_type<>'intake.ticket_created' OR NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket_event te WHERE te.ticket_id=t.id AND te.event_type='ticket.created'))
          UNION ALL
           SELECT 'TICKET'::text AS event_source,te.event_type,jsonb_build_object('new_status',te.new_status),te.created_at::timestamp without time zone,te.event_ordinal::integer,te.event_id::text,
                  t.ticket_no,te.new_status,to_char(te.created_at,'YYYY-MM-DD HH24:MI:SS'),1::integer
            FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_event te ON te.ticket_id=t.id
           WHERE t.source_intake_id=$1::uuid AND te.event_type=ANY($3::text[])
         ), annotated AS (
          SELECT all_events.*,
                 COALESCE(MAX(source_ordinal) FILTER (WHERE event_source='INTAKE') OVER (),0)::integer AS intake_high_water,
                  COALESCE(MAX(source_ordinal) FILTER (WHERE event_source='TICKET') OVER (),0)::integer AS ticket_high_water,
                  row_number() OVER (ORDER BY occurred_at,source_rank,source_id)::bigint AS timeline_ordinal
            FROM all_events
        )
        SELECT event_source,event_type,payload,to_char(occurred_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at,source_rank,source_ordinal,source_id,
               intake_high_water,ticket_high_water,timeline_ordinal,
               ticket_no,ticket_status,ticket_updated_at
         FROM annotated ${boundarySql} ORDER BY occurred_at ${order},source_rank ${order},source_id ${order} LIMIT $2`,args);
      const rows=q.rows.slice(0,limit);if(order==='DESC')rows.reverse();const items=rows.map(timelineItem);
        const next=rows.length===limit&&q.rows.length>limit?(()=>{
          const last=rows.at(-1),previous=key?timelineKey(key):null;
          let boundary=order==='ASC'&&previous?previous:timelineKey(order==='ASC'?last:rows[0]);
          if(order==='ASC')for(const row of rows.map(timelineKey))if(compareTimeline(row,boundary)>0)boundary=row;
          const snapshotIntakeHighWater=Number(rows[0]?.intake_high_water??key?.intake_high_water??0);
          const snapshotTicketHighWater=Number(rows[0]?.ticket_high_water??key?.ticket_high_water??0);
          const intakeHighWater=order==='DESC'?snapshotIntakeHighWater:Number(key?.intake_high_water??snapshotIntakeHighWater);
          const ticketHighWater=order==='DESC'?snapshotTicketHighWater:Number(key?.ticket_high_water??snapshotTicketHighWater);
          const seenSourceKeys=[...new Set([...(key?.seen_source_keys??[]),...rows.map(timelineSourceKey)])];
          const data=Buffer.from(JSON.stringify({scope_hash:scopeHash,request_ref:ref,timeline_ordinal:boundary.timeline_ordinal,intake_high_water:intakeHighWater,ticket_high_water:ticketHighWater,seen_source_keys:seenSourceKeys,direction:order,
            occurred_at:boundary.occurred_at,source_rank:boundary.source_rank,source_ordinal:boundary.source_ordinal,event_source:boundary.event_source,source_id:boundary.source_id}),'utf8').toString('base64url');
          return data+'.'+createHmac('sha256',scopeSecret).update(data).digest('base64url');
        })():null;
      return {items,next_cursor:next};
    });
  }
  async function timeline({scope,requestRef:ref,after=null,before=null,cursor=null,limit=50}={}){const scopeHash=commandScope(scope);requestRef(ref);if(after!==null&&before!==null||cursor!==null&&(after!==null||before!==null))throw new TypeError('YXX_CURSOR_INVALID');if(!Number.isInteger(limit)||limit<1||limit>YXX_WEB_LIMITS.timeline)throw new TypeError('YXX_LIMIT_INVALID');return transactionP2016(pool,async tx=>{const owner=await tx.query('SELECT b.intake_id::text FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.request_ref=$1 AND b.canonical_reporter_binding=$2 AND b.source_corp_scope=$3 AND b.source_app_scope=$4 AND b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND i.retention_until>platform.local_now()',[ref,scopeHash,scope.sourceCorpScope,scope.sourceAppScope]);if(owner.rowCount!==1){const e=new Error('YXX_NOT_FOUND');e.code='YXX_NOT_FOUND';e.status=404;throw e;}let boundary=null,order='ASC';if(cursor){const [data,signature]=cursor.split('.');if(!data||!signature)throw new TypeError('YXX_CURSOR_INVALID');const expected=createHmac('sha256',scopeSecret).update(data).digest('base64url'),a=Buffer.from(signature),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))throw new TypeError('YXX_CURSOR_INVALID');try{const parsed=JSON.parse(Buffer.from(data,'base64url').toString('utf8'));if(parsed.scope_hash!==scopeHash||parsed.request_ref!==ref||!Number.isInteger(parsed.event_ordinal)||!['ASC','DESC'].includes(parsed.direction))throw new Error('cursor');boundary=parsed.event_ordinal;order=parsed.direction;}catch{throw new TypeError('YXX_CURSOR_INVALID');}}else if(after!==null){if(!/^[0-9]+$/u.test(after))throw new TypeError('YXX_CURSOR_INVALID');boundary=Number(after);}else if(before!==null){if(!/^[0-9]+$/u.test(before))throw new TypeError('YXX_CURSOR_INVALID');boundary=Number(before);order='DESC';}const args=[owner.rows[0].intake_id,limit+1];let where='e.intake_id=$1::uuid';if(boundary!==null){where+=order==='ASC'?' AND e.event_ordinal>$3':' AND e.event_ordinal<$3';args.push(boundary);}const q=await tx.query(`SELECT e.event_type,e.payload,to_char(e.occurred_at,'YYYY-MM-DD HH24:MI:SS') AS occurred_at,e.event_ordinal,t.ticket_no,t.status AS ticket_status,to_char(t.updated_at,'YYYY-MM-DD HH24:MI:SS') AS ticket_updated_at FROM intake.service_intake_event e LEFT JOIN pilot_ticket.ticket t ON t.source_intake_id=e.intake_id WHERE ${where} ORDER BY e.event_ordinal ${order} LIMIT $2`,args);const rows=q.rows.slice(0,limit);if(order==='DESC')rows.reverse();const items=rows.map(timelineItem);const next=rows.length===limit&&q.rows.length>limit?(()=>{const ordinal=order==='ASC'?rows.at(-1).event_ordinal:rows[0].event_ordinal;const data=Buffer.from(JSON.stringify({scope_hash:scopeHash,request_ref:ref,event_ordinal:Number(ordinal),direction:order}),'utf8').toString('base64url');return data+'.'+createHmac('sha256',scopeSecret).update(data).digest('base64url');})():null;return {items,next_cursor:next};});}
  async function command({scope,clientCommandId}){const scopeHash=commandScope(scope);uuidP2016(clientCommandId);return transactionP2016(pool,async tx=>{const q=await tx.query(`SELECT r.client_command_id::text,r.status,r.result_request_ref AS request_ref,i.intake_no,r.accepted_revision,to_char(r.accepted_at,'YYYY-MM-DD HH24:MI:SS') AS accepted_at,r.accepted_epoch_ms::text FROM intake.web_command_receipt r LEFT JOIN intake.service_intake i ON i.id=r.result_intake_id JOIN intake.web_request_binding b ON b.intake_id=r.result_intake_id WHERE r.scope_hash=$1 AND r.client_command_id=$2::uuid AND b.source_corp_scope=$3 AND b.source_app_scope=$4 AND b.revoked_at IS NULL AND b.retention_until>platform.local_now() AND i.retention_until>platform.local_now()`,[scopeHash,clientCommandId,scope.sourceCorpScope,scope.sourceAppScope]);if(q.rowCount!==1){const e=new Error('YXX_NOT_FOUND');e.code='YXX_NOT_FOUND';e.status=404;throw e;}return q.rows[0];});}
  return Object.freeze({accept,acceptInTransaction,getRequest,listMyReports,timeline:timelineCombined,command,parseYxxRequestInput,parseYxxSupplementInput});
}
