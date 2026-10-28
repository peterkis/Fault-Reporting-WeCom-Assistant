import {randomUUID} from 'node:crypto';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {ReporterDirectoryPort} from '../../../contracts/p2_015_contracts.js';
import {reporterIdentityHash} from './p2-015-contact-journey.mjs';
import {transactionP2016,failP2016} from './p2-016-domain-contracts.mjs';
import {shanghaiLocalToEpochMs} from './platform/time-contract.mjs';
import {applicationRecipientProof} from './yxx-application-member-auth.mjs';
import {applicationMemberId} from './wecom-application-member.mjs';
import type {ReporterApplicationScope} from './workbench-reporter-directory.mjs';
import {sourceLabel} from './workbench-source-groups.mjs';

export interface TicketReporterProfile {
 ticket_id:string;source_intake_id:string;source_channel:'WECOM_DIRECT'|'WECOM_GROUP'|'PORTAL'|'MANUAL';
 source_label:string;
 name:string|null;department:string|null;source:'REPORT_SNAPSHOT'|'LATER_LOOKUP'|null;
 captured_at:string|null;state:'PENDING'|'PARTIAL'|'RESOLVED'|'UNAVAILABLE';
}
const columns={ticket_id:'uuid',source_intake_id:'uuid',source_provider:'text',source_channel:'text',source_label:'text',source_bot_id:'text',reporter_identity_hash:'text',state:'text',reporter_name:'text',reporter_department:'text',profile_source:'text',captured_epoch_ms:'bigint',attempts:'integer',next_attempt_epoch_ms:'bigint',lease_token:'uuid',lease_until_epoch_ms:'bigint',created_epoch_ms:'bigint',updated_epoch_ms:'bigint'};
export async function ticketReporterProfilesSchemaReady(tx:PostgresTransaction):Promise<boolean>{
 try{return (await tx.query<{ok:boolean}>(`SELECT
  EXISTS(SELECT 1 FROM platform.schema_migration WHERE migration_id='067_ticket_reporter_profiles')
  AND (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('intake.ticket_reporter_profile') AND attnum>0 AND NOT attisdropped)=18
  AND NOT EXISTS(SELECT 1 FROM jsonb_each_text($1::jsonb) shape WHERE NOT EXISTS(
    SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('intake.ticket_reporter_profile') AND a.attname=shape.key AND NOT a.attisdropped AND format_type(a.atttypid,a.atttypmod)=shape.value))
  AND (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('intake.ticket_reporter_profile') AND conname IN ('ticket_reporter_profile_pkey','ticket_reporter_profile_material','ticket_reporter_profile_state','ticket_reporter_profile_lease','ticket_reporter_profile_source_kind'))=5
  AND (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('intake.ticket_reporter_profile') AND contype='f' AND confdeltype='r')=2
  AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('intake.ticket_reporter_profile') AND tgname='ticket_reporter_profile_source_immutable' AND tgenabled='O')
  AND to_regclass('intake.ticket_reporter_profile_due') IS NOT NULL AS ok`,[JSON.stringify(columns)])).rows[0]?.ok===true;}catch{return false;}
}

/** Caller has authorized these Tickets; its normal post-projection READ check still applies. */
export async function readTicketReporterProfiles(tx:PostgresTransaction,ticketIds:readonly string[]):Promise<ReadonlyMap<string,TicketReporterProfile>>{
 if(ticketIds.length>100)failP2016();if(!ticketIds.length)return new Map();
 const rows=(await tx.query<TicketReporterProfile>(`SELECT p.ticket_id::text,p.source_intake_id::text,p.source_channel,p.source_label,
  p.reporter_name AS name,p.reporter_department AS department,p.profile_source AS source,
  to_char(platform.local_from_epoch_ms(p.captured_epoch_ms),'YYYY-MM-DD HH24:MI:SS') AS captured_at,p.state
  FROM intake.ticket_reporter_profile p JOIN pilot_ticket.ticket t ON t.id=p.ticket_id AND t.source_intake_id=p.source_intake_id
  WHERE p.ticket_id=ANY($1::uuid[])`,[ticketIds])).rows;
 return new Map(rows.map(row=>[row.ticket_id,row]));
}

function record(value:unknown):Record<string,unknown>|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}
function label(value:unknown,maximum:number):string|null{return typeof value==='string'&&value.trim()&&[...value].length<=maximum&&!/[\x00-\x1f\x7f<>]/u.test(value)?value.trim():null;}
function material(snapshot:unknown){
 const value=record(snapshot),contact=record(value?.contact);
 const name=label(contact?.name,256),memberships=value?.memberships;
 const departments=Array.isArray(memberships)?memberships.slice(0,20).map(m=>label(record(m)?.name,128)).filter((v):v is string=>v!==null):[];
 const department=label([...new Set(departments)].join('、'),4096);
 let epoch:string|null=null;
 if(typeof value?.fetched_at==='string')try{epoch=shanghaiLocalToEpochMs(value.fetched_at);}catch{/* Unknown historic capture time is not invented. */}
 return {name,department,epoch,complete:name!==null&&department!==null};
}
interface Source {
 ticket_id:string;intake_id:string;source_provider:string;source_channel:string;source_bot_id:string|null;reporter_id:string|null;
 reporter_identity_hash:string;profile_resolution_status:string;profile_snapshot:unknown;created_epoch_ms:string;
 manual_name:string|null;manual_department:string|null;manual_departments:unknown;manual_verification:string|null;manual_source:string|null;web_binding:unknown;
}
interface Claimed extends Source {attempts:number;lease_token:string;reporter_name:string|null;reporter_department:string|null}
const sourceColumns=`t.id::text AS ticket_id,i.id::text AS intake_id,i.source_provider,i.source_channel,i.source_bot_id,
 i.reporter_wecom_userid AS reporter_id,j.reporter_identity_hash,j.profile_resolution_status,j.profile_snapshot,
 (extract(epoch FROM j.created_at AT TIME ZONE 'Asia/Shanghai')*1000)::bigint::text AS created_epoch_ms,
 to_jsonb(i)->'manual_report_snapshot'->'reporter'->>'name' AS manual_name,
 to_jsonb(i)->'manual_report_snapshot'->'reporter'->>'department' AS manual_department,
 to_jsonb(i)->'manual_report_snapshot'->'reporter'->'departments' AS manual_departments,
 to_jsonb(i)->'manual_report_snapshot'->'reporter'->>'verification' AS manual_verification,
 to_jsonb(i)->'manual_report_snapshot'->>'source' AS manual_source`;
const sourceJoins=`JOIN intake.service_intake i ON i.id=t.source_intake_id
 JOIN intake.contact_journey j ON j.origin_intake_id=i.id AND j.linked_ticket_id=t.id`;
const webBindingSql=`jsonb_build_object('corp',b.source_corp_scope,'app',b.source_app_scope,'hash',b.canonical_reporter_binding,
 'namespace',to_jsonb(b)->>'notify_identity_namespace','member',to_jsonb(b)->>'notify_recipient_id','proof',to_jsonb(b)->>'notify_proof_ref',
 'scope_proof',b.proof_ref,'revoked',b.revoked_at IS NOT NULL,'intake_hash',to_jsonb(i)->>'canonical_reporter_binding',
 'intake_app',to_jsonb(i)->>'source_app_scope','journey_app',to_jsonb(j)->>'source_app_scope')`;
const backoffMs=[60_000,300_000,900_000,3_600_000,21_600_000,86_400_000,86_400_000,86_400_000] as const;
interface Options {pool:PostgresPool;botId:string;identityHmacKey:string;directoryPort:ReporterDirectoryPort;enabled?:boolean;applicationScope?:ReporterApplicationScope}
export function createTicketReporterProfileWorker({pool,botId,identityHmacKey,directoryPort,enabled=false,applicationScope}:Options){
 if(typeof enabled!=='boolean'||enabled&&(!botId||botId.length>128||identityHmacKey.length<16||typeof directoryPort?.resolve!=='function'))failP2016();
 let running=false;
 const selectedSource=sourceColumns+(applicationScope?','+webBindingSql:' ,NULL::jsonb')+' AS web_binding';
 const joins=sourceJoins+(applicationScope?' LEFT JOIN intake.web_request_binding b ON b.intake_id=i.id':'');
 const webSourceValid=(source:Source)=>{const b=record(source.web_binding);return Boolean(applicationScope&&b&&b.corp===applicationScope.corpId&&b.app===applicationScope.agentId
  &&b.hash===source.reporter_identity_hash&&b.intake_hash===b.hash&&b.intake_app===b.app&&b.journey_app===b.app);};
 function identityValid(source:Source):boolean{
  if(source.source_provider==='WECOM_AIBOT')return source.source_bot_id===botId&&typeof source.reporter_id==='string'
   &&reporterIdentityHash({provider:source.source_provider,bot_id:botId,reporter_external_id:source.reporter_id,hmac_key:identityHmacKey})===source.reporter_identity_hash;
  if(source.source_provider==='STAFF_MANUAL_REPORT')return ['VERIFIED','UNVERIFIED'].includes(source.manual_verification??'');
  const b=record(source.web_binding);
  return source.source_provider==='YIXIAOXIU_WEB'&&Boolean(applicationScope&&b&&b.corp===applicationScope.corpId&&b.app===applicationScope.agentId
   &&b.hash===source.reporter_identity_hash&&b.intake_hash===b.hash&&b.intake_app===b.app&&b.journey_app===b.app
   &&b.revoked===false&&b.namespace==='APP_OPEN_USERID'&&applicationMemberId(b.member)
   &&b.proof===applicationRecipientProof(applicationScope.scopeSecret,{scopeHash:source.reporter_identity_hash,sourceCorpScope:applicationScope.corpId,sourceAppScope:applicationScope.agentId},b.member));
 }
 async function projectMissing(){
  const rows=(await pool.query<Source>(`SELECT ${selectedSource} FROM pilot_ticket.ticket t ${joins}
   WHERE ((i.source_provider='WECOM_AIBOT' AND i.source_bot_id=$1 AND i.source_channel IN ('WECOM_DIRECT','WECOM_GROUP'))
     OR (i.source_provider='STAFF_MANUAL_REPORT' AND i.source_channel='MANUAL')
     ${applicationScope?"OR (i.source_provider='YIXIAOXIU_WEB' AND i.source_channel='PORTAL' AND b.source_corp_scope=$2 AND b.source_app_scope=$3)":''})
   AND NOT EXISTS(SELECT 1 FROM intake.ticket_reporter_profile p WHERE p.ticket_id=t.id)
   ORDER BY t.id LIMIT 20`,[botId,...(applicationScope?[applicationScope.corpId,applicationScope.agentId]:[])])).rows;
  if(!rows.length)return 0;
  const entries=rows.map(row=>{
   const lookupAllowed=identityValid(row),valid=row.source_provider==='YIXIAOXIU_WEB'?webSourceValid(row):lookupAllowed,manual=row.source_provider==='STAFF_MANUAL_REPORT';
   const manualName=label(row.manual_name,256),manualDepartments=row.manual_verification==='VERIFIED'&&Array.isArray(row.manual_departments)?row.manual_departments.slice(0,20).map(name=>({name})):[{name:row.manual_department}];
   const profile=valid&&manual?material({contact:{name:manualName?manualName+(row.manual_verification==='VERIFIED'?'（本次已核实）':'（身份未核实）'):null},memberships:manualDepartments})
    :valid&&row.profile_resolution_status==='RESOLVED'?material(row.profile_snapshot):material(null);
   const hasMaterial=profile.name!==null||profile.department!==null;
   return {...row,profile_snapshot:undefined,profile_resolution_status:undefined,name:profile.name,department:profile.department,
    source_label:manual?(row.manual_source==='PHONE'?'电话代录':row.manual_source==='ON_SITE'?'现场代录':sourceLabel('MANUAL')):sourceLabel(row.source_channel),
    profile_source:hasMaterial?'REPORT_SNAPSHOT':null,captured_epoch_ms:hasMaterial?(profile.epoch??row.created_epoch_ms):null,
    state:!valid?'UNAVAILABLE':profile.complete?'RESOLVED':manual||!lookupAllowed?'UNAVAILABLE':hasMaterial?'PARTIAL':'PENDING',attempts:lookupAllowed?1:8};
  });
  const result=await pool.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch)
   INSERT INTO intake.ticket_reporter_profile(ticket_id,source_intake_id,source_provider,source_channel,source_label,source_bot_id,reporter_identity_hash,state,
    reporter_name,reporter_department,profile_source,captured_epoch_ms,attempts,next_attempt_epoch_ms,created_epoch_ms,updated_epoch_ms)
   SELECT p.ticket_id,p.intake_id,p.source_provider,p.source_channel,p.source_label,p.source_bot_id,p.reporter_identity_hash,p.state,p.name,p.department,p.profile_source,p.captured_epoch_ms,p.attempts,
    CASE WHEN p.state IN ('PENDING','PARTIAL') THEN GREATEST(stamp.epoch,p.created_epoch_ms+60000) ELSE NULL END,stamp.epoch,stamp.epoch
   FROM jsonb_to_recordset($1::jsonb) AS p(ticket_id uuid,intake_id uuid,source_provider text,source_channel text,source_label text,source_bot_id text,reporter_id text,
    reporter_identity_hash text,state text,name text,department text,profile_source text,captured_epoch_ms bigint,attempts int,created_epoch_ms bigint)
   JOIN pilot_ticket.ticket t ON t.id=p.ticket_id AND t.source_intake_id=p.intake_id
   JOIN intake.service_intake i ON i.id=p.intake_id AND i.source_provider=p.source_provider AND i.source_channel=p.source_channel AND i.source_bot_id IS NOT DISTINCT FROM p.source_bot_id AND i.reporter_wecom_userid IS NOT DISTINCT FROM p.reporter_id
   JOIN intake.contact_journey j ON j.origin_intake_id=i.id AND j.linked_ticket_id=t.id AND j.reporter_identity_hash=p.reporter_identity_hash
   CROSS JOIN stamp ON CONFLICT(ticket_id) DO NOTHING`,[JSON.stringify(entries)]);
  return result.rowCount??0;
 }
 async function claim():Promise<Claimed|null>{
  return transactionP2016(pool,async tx=>{
   const row=(await tx.query<Claimed>(`SELECT ${selectedSource},p.attempts,p.reporter_name,p.reporter_department
    FROM intake.ticket_reporter_profile p JOIN pilot_ticket.ticket t ON t.id=p.ticket_id AND t.source_intake_id=p.source_intake_id ${joins}
    WHERE ((p.source_provider='WECOM_AIBOT' AND p.source_bot_id=$1) ${applicationScope?"OR (p.source_provider='YIXIAOXIU_WEB' AND b.source_corp_scope=$2 AND b.source_app_scope=$3)":''}) AND p.state IN ('PENDING','PARTIAL') AND p.attempts<8
     AND p.next_attempt_epoch_ms<=platform.physical_epoch_ms()
     AND (p.lease_until_epoch_ms IS NULL OR p.lease_until_epoch_ms<=platform.physical_epoch_ms())
     AND p.reporter_identity_hash=j.reporter_identity_hash AND p.source_provider=i.source_provider AND p.source_channel=i.source_channel AND p.source_bot_id IS NOT DISTINCT FROM i.source_bot_id
    ORDER BY p.next_attempt_epoch_ms,p.ticket_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`,[botId,...(applicationScope?[applicationScope.corpId,applicationScope.agentId]:[])])).rows[0];
   if(!row)return null;
   const token=randomUUID(),attempts=row.attempts+1,delay=backoffMs[attempts-1];if(delay===undefined)failP2016();
   await tx.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch) UPDATE intake.ticket_reporter_profile SET attempts=$2,
    lease_token=$3,lease_until_epoch_ms=stamp.epoch+10000,next_attempt_epoch_ms=stamp.epoch+$4,updated_epoch_ms=stamp.epoch
    FROM stamp WHERE ticket_id=$1`,[row.ticket_id,attempts,token,delay]);
   return {...row,attempts,lease_token:token};
  });
 }
 async function complete(source:Claimed,snapshot:unknown){
  const next=material(snapshot),score=Number(next.name!==null)+Number(next.department!==null),oldScore=Number(source.reporter_name!==null)+Number(source.reporter_department!==null);
  const replace=score>0&&score>=oldScore,state=next.complete?'RESOLVED':source.attempts>=8?'UNAVAILABLE':Math.max(score,oldScore)>0?'PARTIAL':'PENDING';
  const result=await pool.query(`WITH stamp AS(SELECT platform.physical_epoch_ms() AS epoch)
   UPDATE intake.ticket_reporter_profile p SET state=$3,
    reporter_name=CASE WHEN $4 THEN $5 ELSE p.reporter_name END,reporter_department=CASE WHEN $4 THEN $6 ELSE p.reporter_department END,
    profile_source=CASE WHEN $4 THEN 'LATER_LOOKUP' ELSE p.profile_source END,captured_epoch_ms=CASE WHEN $4 THEN COALESCE($7::bigint,stamp.epoch) ELSE p.captured_epoch_ms END,
    next_attempt_epoch_ms=CASE WHEN $3 IN ('RESOLVED','UNAVAILABLE') THEN NULL ELSE p.next_attempt_epoch_ms END,
    lease_token=NULL,lease_until_epoch_ms=NULL,updated_epoch_ms=stamp.epoch
   FROM stamp,pilot_ticket.ticket t,intake.service_intake i,intake.contact_journey j
   WHERE p.ticket_id=$1 AND p.lease_token=$2 AND p.lease_until_epoch_ms>stamp.epoch AND t.id=p.ticket_id AND t.source_intake_id=p.source_intake_id
    AND i.id=p.source_intake_id AND i.source_provider=p.source_provider AND i.source_channel=p.source_channel AND i.source_bot_id IS NOT DISTINCT FROM p.source_bot_id
    AND i.reporter_wecom_userid IS NOT DISTINCT FROM $8 AND j.origin_intake_id=i.id AND j.linked_ticket_id=t.id AND j.reporter_identity_hash=p.reporter_identity_hash
    ${applicationScope?`AND (p.source_provider<>'YIXIAOXIU_WEB' OR EXISTS(SELECT 1 FROM intake.web_request_binding b WHERE b.intake_id=i.id AND b.revoked_at IS NULL AND ${webBindingSql}=$9::jsonb))`:''}`,
  [source.ticket_id,source.lease_token,state,replace,next.name,next.department,next.epoch,source.reporter_id,...(applicationScope?[JSON.stringify(source.web_binding)]:[])]);
  return result.rowCount===1;
 }
 return {ready:()=>enabled?ticketReporterProfilesSchemaReady(pool):Promise.resolve(true),async runOnce(){
  if(!enabled||running)return {projected:0,attempted:0,completed:0};running=true;
  try{
   // Reclaim exhausted interrupted attempts without deleting their retained material.
   await pool.query(`UPDATE intake.ticket_reporter_profile SET state='UNAVAILABLE',next_attempt_epoch_ms=NULL,lease_token=NULL,lease_until_epoch_ms=NULL,
    updated_epoch_ms=platform.physical_epoch_ms() WHERE ((source_provider='WECOM_AIBOT' AND source_bot_id=$1) ${applicationScope?"OR (source_provider='YIXIAOXIU_WEB' AND EXISTS(SELECT 1 FROM intake.web_request_binding b WHERE b.intake_id=source_intake_id AND b.source_corp_scope=$2 AND b.source_app_scope=$3))":''}) AND state IN ('PENDING','PARTIAL') AND attempts>=8
     AND (lease_until_epoch_ms IS NULL OR lease_until_epoch_ms<=platform.physical_epoch_ms())`,[botId,...(applicationScope?[applicationScope.corpId,applicationScope.agentId]:[])]);
   const projected=await projectMissing(),source=await claim();if(!source)return {projected,attempted:0,completed:0};
   let snapshot:unknown=null;
   if(identityValid(source))try{
    const b=record(source.web_binding),web=source.source_provider==='YIXIAOXIU_WEB';
    const result=await directoryPort.resolve({source:'WECOM_DIRECTORY',source_provider:source.source_provider,source_namespace:web?'APP_OPEN_USERID':source.source_provider,
     bot_id:source.source_bot_id,reporter_external_id:web?b?.member:source.reporter_id,reporter_identity_hash:source.reporter_identity_hash,
     ...(web?{source_corp_scope:b?.corp,source_app_scope:b?.app,recipient_proof:b?.proof}:{})});
    if(result.status==='RESOLVED')snapshot=result.snapshot;
   }catch{/* Failed lookups keep the persistent backoff; no provider error text is exposed. */}
   const completed=await complete(source,snapshot);return {projected,attempted:1,completed:Number(completed)};
  }finally{running=false;}
 }};
}
