import type {ManualReportCommand,ManualReportResult,ManualReportCapabilities,ManualReportReceipt,ManualReportProjection} from '../contracts/workbench_manual_report_contracts.js';
import type {VerifiedManualReportCommand,VerifiedManualReportResult,VerifiedManualReportReceipt,VerifiedManualReportProjection,ManualReporterSelection,WorkbenchReporterCandidates} from '../contracts/workbench_reporter_candidates_contracts.js';
export type ManualReportAdmissionCommand=ManualReportCommand|VerifiedManualReportCommand;
export type ManualReportAdmissionResult=ManualReportResult|VerifiedManualReportResult;
export type ManualReportAdmissionReceipt=ManualReportReceipt|VerifiedManualReportReceipt;
export type ManualReportSourceProjection=ManualReportProjection|VerifiedManualReportProjection;
export class ManualReportContractError extends Error{}
export const MANUAL_REPORT_DRAFT_ID='00000000-0000-4000-8000-000000000072';
export interface ManualReportInput {source:'PHONE'|'ON_SITE';name:string;contact:string;department:string;description:string;location:string;unknown:boolean}
export const emptyManualReportInput=():ManualReportInput=>({source:'PHONE',name:'',contact:'',department:'',description:'',location:'',unknown:false});
export const hasManualReportInput=(v:ManualReportInput)=>Boolean(v.name||v.contact||v.department||v.description||v.location||v.unknown||v.source!=='PHONE');
function bad():never{throw new ManualReportContractError('MANUAL_REPORT_CONTRACT_INVALID');}
function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))bad();return value as Record<string,unknown>;}
function text(value:unknown,max:number,min=0,multiline=false):string{if(typeof value!=='string'||Array.from(value).length>max||Array.from(value).length<min||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)||!multiline&&/[\r\n\t]/u.test(value))bad();return value;}
function uuid(value:unknown):string{const v=text(value,36,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v))bad();return v;}
function source(value:unknown):ManualReportCommand['source']{if(value!=='PHONE'&&value!=='ON_SITE')bad();return value;}
export function decodeManualReportInput(value:unknown):ManualReportInput{
  const v=exact(value,['source','name','contact','department','description','location','unknown']);if(typeof v.unknown!=='boolean')bad();
  return {source:source(v.source),name:text(v.name,100),contact:text(v.contact,100),department:text(v.department,100),description:text(v.description,4000,0,true),location:text(v.location,200),unknown:v.unknown};
}
export function decodeManualReportCommand(value:unknown):ManualReportAdmissionCommand{
  if(value&&typeof value==='object'&&!Array.isArray(value)&&'reporter' in value&&value.reporter&&typeof value.reporter==='object'&&'verification' in value.reporter&&value.reporter.verification==='VERIFIED_SELECTION')return decodeVerifiedManualReportCommand(value);
  const v=exact(value,['schema_version','client_command_id','source','description','location','reporter']),r=exact(v.reporter,['verification','name','contact','department']),l=exact(v.location,['text','unknown']);
  if(v.schema_version!==1||r.verification!=='UNVERIFIED'||typeof l.unknown!=='boolean'||l.unknown&&l.text!==null)bad();
  const description=text(v.description,4000,1,true),name=text(r.name,100,1),contact=text(r.contact,100,1);
  if(description!==description.trim()||name!==name.trim()||contact!==contact.trim())bad();
  const location=l.unknown?null:text(l.text,200,1);if(location!==null&&location!==location.trim())bad();
  const department=r.department===null?null:text(r.department,100,1);if(department!==null&&department!==department.trim())bad();
  return Object.freeze({schema_version:1,client_command_id:uuid(v.client_command_id),source:source(v.source),description,
    location:Object.freeze({text:location,unknown:l.unknown}),reporter:Object.freeze({verification:'UNVERIFIED',name,contact,department})});
}
export function manualReportCommandFromInput(input:ManualReportInput,id:string):ManualReportCommand{
  const command=decodeManualReportCommand({schema_version:1,client_command_id:id,source:input.source,description:input.description.trim(),location:{text:input.unknown?null:input.location.trim(),unknown:input.unknown},
    reporter:{verification:'UNVERIFIED',name:input.name.trim(),contact:input.contact.trim(),department:input.department.trim()||null}});
  if(command.reporter.verification!=='UNVERIFIED')bad();return {...command,reporter:command.reporter};
}
export function decodeManualReportProjection(value:unknown):ManualReportSourceProjection{
  if(value&&typeof value==='object'&&'identity_source' in value&&value.identity_source==='VERIFIED_DIRECTORY_SELECTION')return decodeVerifiedManualReportProjection(value);
  const v=exact(value,['source_kind','source','description','location','reporter','identity_source','actor_principal_id','manual_contact_required','external_notification']),r=exact(v.reporter,['verification','name','contact','department']),l=exact(v.location,['text','unknown']);
  if(v.source_kind!=='MANUAL_REPORT'||v.identity_source!=='HAND_ENTERED'||v.manual_contact_required!==true||v.external_notification!==false||r.verification!=='UNVERIFIED'||typeof l.unknown!=='boolean'||l.unknown&&l.text!==null)bad();
  const description=text(v.description,4000,1,true),name=text(r.name,100,1),contact=text(r.contact,100,1),department=r.department===null?null:text(r.department,100,1),location=l.unknown?null:text(l.text,200,1);
  if(description!==description.trim()||name!==name.trim()||contact!==contact.trim()||department!==null&&department!==department.trim()||location!==null&&location!==location.trim())bad();
  return {source_kind:'MANUAL_REPORT',source:source(v.source),description,location:{text:location,unknown:l.unknown},reporter:{verification:'UNVERIFIED',name,contact,department},identity_source:'HAND_ENTERED',actor_principal_id:uuid(v.actor_principal_id),manual_contact_required:true,external_notification:false};
}
const resultCodes=['TICKET_ELIGIBLE','NEEDS_DESCRIPTION','MANUAL_REVIEW_REQUIRED','RELATED_FOLLOW_UP','STATUS_QUERY','SERVICE_REQUEST','BUSINESS_CONSULTATION','ACKNOWLEDGEMENT','OUT_OF_SCOPE','INCIDENT_REVIEW_CANDIDATE'] as const;
const statuses=['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','RESOLVED','CLOSED','REOPENED','CANCELLED','DUPLICATE_LINKED'] as const;
export function decodeManualReportResult(value:unknown,id:string):ManualReportAdmissionResult{
  if(value&&typeof value==='object'&&'reporter_verification' in value&&value.reporter_verification==='VERIFIED'){
    const v=exact(value,['ok','client_command_id','intake_id','intake_no','source','reporter_verification','manual_contact_required','external_notification','result_code','ticket','review','replayed','notification_eligibility']);
    const eligibility=notificationEligibility(v.notification_eligibility,v.manual_contact_required),{notification_eligibility,...base}=v;
    const result=decodeManualReportResult({...base,reporter_verification:'UNVERIFIED',manual_contact_required:true},id);
    return {...result,reporter_verification:'VERIFIED',manual_contact_required:eligibility!=='ELIGIBLE',notification_eligibility:eligibility};
  }
  const v=exact(value,['ok','client_command_id','intake_id','intake_no','source','reporter_verification','manual_contact_required','external_notification','result_code','ticket','review','replayed']),result=resultCodes.find(code=>code===v.result_code);
  const number=text(v.intake_no,64,1);if(v.ok!==true||uuid(v.client_command_id)!==id||!/^INT-[0-9]{8}-[0-9]{4,}$/u.test(number)||v.reporter_verification!=='UNVERIFIED'||v.manual_contact_required!==true||v.external_notification!==false||typeof v.replayed!=='boolean'||!result)bad();
  let ticket:ManualReportResult['ticket']=null,review:ManualReportResult['review']=null;
  if(v.ticket!==null){const t=exact(v.ticket,['id','number','status']),status=statuses.find(code=>code===t.status),number=text(t.number,64,1);if(!status||!/^IT-[0-9]{8}-[0-9]{4,}$/u.test(number))bad();ticket={id:uuid(t.id),number,status};}
  if(v.review!==null){const r=exact(v.review,['id','status']);if(r.status!=='PENDING')bad();review={id:uuid(r.id),status:'PENDING'};}
  return {ok:true,client_command_id:id,intake_id:uuid(v.intake_id),intake_no:number,source:source(v.source),reporter_verification:'UNVERIFIED',manual_contact_required:true,external_notification:false,result_code:result,ticket,review,replayed:v.replayed};
}
export function decodeManualReportCapabilities(value:unknown):ManualReportCapabilities{
  const v=exact(value,['can_create','manual_contact_required','external_notification','draft_recovery_enabled']);if(v.can_create!==true||v.manual_contact_required!==true||v.external_notification!==false||typeof v.draft_recovery_enabled!=='boolean')bad();
  return {can_create:true,manual_contact_required:true,external_notification:false,draft_recovery_enabled:v.draft_recovery_enabled};
}
export function decodeManualReportReceipt(value:unknown,id:string):ManualReportAdmissionReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value))bad();const v=value as Record<string,unknown>;
  if(uuid(v.client_command_id)!==id)bad();const base={client_command_id:id};
  if(v.state==='UNKNOWN'){exact(v,['client_command_id','state']);return {...base,state:'UNKNOWN'};}
  if(v.state==='FAILED'){exact(v,['client_command_id','state','error']);const e=exact(v.error,['code','retryable']),code=text(e.code,64,1);if(e.retryable!==false||!/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code))bad();return {...base,state:'FAILED',error:{code,retryable:false}};}
  if(v.state==='COMMITTED'){exact(v,['client_command_id','state','result']);const result=decodeManualReportResult(v.result,id);if(result.replayed!==true)bad();if(result.reporter_verification==='VERIFIED')return {...base,state:'COMMITTED',result:{...result,replayed:true}};return {...base,state:'COMMITTED',result:{...result,replayed:true}};}bad();
}
export function encodeManualReportDraft(value:ManualReportInput,pending:ManualReportAdmissionCommand|null):string{
  // Store a pending command only once, so bounded Unicode descriptions are not
  // duplicated in the existing 16 KiB recovery envelope.
  return JSON.stringify(pending?{schema:1,pending}:{schema:1,value});
}
export function decodeManualReportDraft(text:string):{value:ManualReportInput;pending:ManualReportAdmissionCommand|null}{
  const input:unknown=JSON.parse(text);if(!input||typeof input!=='object'||Array.isArray(input))bad();const root=input as Record<string,unknown>;if(root.schema!==1)bad();
  if(Object.hasOwn(root,'pending')){exact(root,['schema','pending']);const pending=decodeManualReportCommand(root.pending);return {pending,value:{source:pending.source,name:pending.reporter.verification==='UNVERIFIED'?pending.reporter.name:'',contact:pending.reporter.verification==='UNVERIFIED'?pending.reporter.contact:'',department:pending.reporter.verification==='UNVERIFIED'?pending.reporter.department??'':'',description:pending.description,location:pending.location.text??'',unknown:pending.location.unknown}};}
  exact(root,['schema','value']);return {value:decodeManualReportInput(root.value),pending:null};
}

function notificationEligibility(value:unknown,manual:unknown):'ELIGIBLE'|'NOT_REACHABLE'{if((value!=='ELIGIBLE'&&value!=='NOT_REACHABLE')||manual!==(value!=='ELIGIBLE'))bad();return value;}
function opaque(value:unknown,min:number,max:number){const v=text(value,max,min);if(!/^[A-Za-z0-9_-]+$/u.test(v))bad();return v;}
export function decodeReporterSelection(value:unknown):ManualReporterSelection{
  const v=exact(value,['verification','candidate_ref','candidate_version']);if(v.verification!=='VERIFIED_SELECTION'||typeof v.candidate_version!=='string'||!/^[a-f0-9]{64}$/u.test(v.candidate_version))bad();
  return {verification:'VERIFIED_SELECTION',candidate_ref:opaque(v.candidate_ref,32,256),candidate_version:v.candidate_version};
}
export function decodeVerifiedManualReportCommand(value:unknown):VerifiedManualReportCommand{
  const v=exact(value,['schema_version','client_command_id','source','description','location','reporter']),l=exact(v.location,['text','unknown']);
  if(v.schema_version!==1||typeof l.unknown!=='boolean'||l.unknown&&l.text!==null)bad();const description=text(v.description,4000,1,true),location=l.unknown?null:text(l.text,200,1);
  if(description!==description.trim()||location!==null&&location!==location.trim())bad();
  return {schema_version:1,client_command_id:uuid(v.client_command_id),source:source(v.source),description,location:{text:location,unknown:l.unknown},reporter:decodeReporterSelection(v.reporter)};
}
export function verifiedManualReportCommandFromInput(input:ManualReportInput,id:string,selection:ManualReporterSelection):VerifiedManualReportCommand{
  return decodeVerifiedManualReportCommand({schema_version:1,client_command_id:id,source:input.source,description:input.description.trim(),location:{text:input.unknown?null:input.location.trim(),unknown:input.unknown},reporter:selection});
}
export function decodeVerifiedManualReportProjection(value:unknown):VerifiedManualReportProjection{
  const v=exact(value,['source_kind','source','description','location','reporter','identity_source','actor_principal_id','manual_contact_required','external_notification','notification_eligibility']),r=exact(v.reporter,['verification','name','departments']),l=exact(v.location,['text','unknown']);
  if(v.source_kind!=='MANUAL_REPORT'||v.identity_source!=='VERIFIED_DIRECTORY_SELECTION'||v.external_notification!==false||r.verification!=='VERIFIED'||typeof l.unknown!=='boolean'||l.unknown&&l.text!==null||!Array.isArray(r.departments)||r.departments.length>20)bad();
  const description=text(v.description,4000,1,true),name=text(r.name,100,1),departments=r.departments.map(item=>text(item,100,1)),location=l.unknown?null:text(l.text,200,1),eligibility=notificationEligibility(v.notification_eligibility,v.manual_contact_required);
  if(description!==description.trim()||name!==name.trim()||departments.some(item=>item!==item.trim())||new Set(departments).size!==departments.length||location!==null&&location!==location.trim())bad();
  return {source_kind:'MANUAL_REPORT',source:source(v.source),description,location:{text:location,unknown:l.unknown},reporter:{verification:'VERIFIED',name,departments},identity_source:'VERIFIED_DIRECTORY_SELECTION',actor_principal_id:uuid(v.actor_principal_id),manual_contact_required:eligibility!=='ELIGIBLE',external_notification:false,notification_eligibility:eligibility};
}
export function decodeReporterCandidates(value:unknown):WorkbenchReporterCandidates{
  const v=exact(value,['schema_version','candidates','next_cursor','manual_fallback_available']);if(v.schema_version!==1||v.manual_fallback_available!==true||!Array.isArray(v.candidates)||v.candidates.length>10||new TextEncoder().encode(JSON.stringify(value)).length>16384)bad();
  const candidates=v.candidates.map((value):WorkbenchReporterCandidates['candidates'][number]=>{const r=exact(value,['candidate_ref','candidate_version','display_name','departments','profile_source','binding_verified','message_reachability']),selection=decodeReporterSelection({verification:'VERIFIED_SELECTION',candidate_ref:r.candidate_ref,candidate_version:r.candidate_version});
    if(r.binding_verified!==true||(r.profile_source!=='WECOM_DIRECTORY'&&r.profile_source!=='THIRD_PARTY_STAFF_DIRECTORY')||(r.message_reachability!=='REACHABLE'&&r.message_reachability!=='UNREACHABLE'&&r.message_reachability!=='UNKNOWN')||!Array.isArray(r.departments)||r.departments.length>20)bad();
    const display_name=text(r.display_name,100,1),departments=r.departments.map(item=>text(item,100,1));if(display_name!==display_name.trim()||departments.some(item=>item!==item.trim())||new Set(departments).size!==departments.length)bad();
    return {candidate_ref:selection.candidate_ref,candidate_version:selection.candidate_version,display_name,departments,profile_source:r.profile_source,binding_verified:true as const,message_reachability:r.message_reachability};});
  if(new Set(candidates.map(candidate=>candidate.candidate_ref)).size!==candidates.length)bad();
  return {schema_version:1,candidates,next_cursor:v.next_cursor===null?null:opaque(v.next_cursor,1,512),manual_fallback_available:true};
}