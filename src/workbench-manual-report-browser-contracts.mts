import type {ManualReportCommand,ManualReportResult,ManualReportCapabilities,ManualReportReceipt,ManualReportProjection} from '../contracts/workbench_manual_report_contracts.js';
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
export function decodeManualReportCommand(value:unknown):ManualReportCommand{
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
  return decodeManualReportCommand({schema_version:1,client_command_id:id,source:input.source,description:input.description.trim(),location:{text:input.unknown?null:input.location.trim(),unknown:input.unknown},
    reporter:{verification:'UNVERIFIED',name:input.name.trim(),contact:input.contact.trim(),department:input.department.trim()||null}});
}
export function decodeManualReportProjection(value:unknown):ManualReportProjection{
  const v=exact(value,['source_kind','source','description','location','reporter','identity_source','actor_principal_id','manual_contact_required','external_notification']),r=exact(v.reporter,['verification','name','contact','department']),l=exact(v.location,['text','unknown']);
  if(v.source_kind!=='MANUAL_REPORT'||v.identity_source!=='HAND_ENTERED'||v.manual_contact_required!==true||v.external_notification!==false||r.verification!=='UNVERIFIED'||typeof l.unknown!=='boolean'||l.unknown&&l.text!==null)bad();
  const description=text(v.description,4000,1,true),name=text(r.name,100,1),contact=text(r.contact,100,1),department=r.department===null?null:text(r.department,100,1),location=l.unknown?null:text(l.text,200,1);
  if(description!==description.trim()||name!==name.trim()||contact!==contact.trim()||department!==null&&department!==department.trim()||location!==null&&location!==location.trim())bad();
  return {source_kind:'MANUAL_REPORT',source:source(v.source),description,location:{text:location,unknown:l.unknown},reporter:{verification:'UNVERIFIED',name,contact,department},identity_source:'HAND_ENTERED',actor_principal_id:uuid(v.actor_principal_id),manual_contact_required:true,external_notification:false};
}
const resultCodes=['TICKET_ELIGIBLE','NEEDS_DESCRIPTION','MANUAL_REVIEW_REQUIRED','RELATED_FOLLOW_UP','STATUS_QUERY','SERVICE_REQUEST','BUSINESS_CONSULTATION','ACKNOWLEDGEMENT','OUT_OF_SCOPE','INCIDENT_REVIEW_CANDIDATE'] as const;
const statuses=['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','RESOLVED','CLOSED','REOPENED','CANCELLED','DUPLICATE_LINKED'] as const;
export function decodeManualReportResult(value:unknown,id:string):ManualReportResult{
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
export function decodeManualReportReceipt(value:unknown,id:string):ManualReportReceipt{
  if(!value||typeof value!=='object'||Array.isArray(value))bad();const v=value as Record<string,unknown>;
  if(uuid(v.client_command_id)!==id)bad();const base={client_command_id:id};
  if(v.state==='UNKNOWN'){exact(v,['client_command_id','state']);return {...base,state:'UNKNOWN'};}
  if(v.state==='FAILED'){exact(v,['client_command_id','state','error']);const e=exact(v.error,['code','retryable']),code=text(e.code,64,1);if(e.retryable!==false||!/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code))bad();return {...base,state:'FAILED',error:{code,retryable:false}};}
  if(v.state==='COMMITTED'){exact(v,['client_command_id','state','result']);const result=decodeManualReportResult(v.result,id);if(result.replayed!==true)bad();return {...base,state:'COMMITTED',result:{...result,replayed:true}};}bad();
}
export function encodeManualReportDraft(value:ManualReportInput,pending:ManualReportCommand|null):string{
  // Store a pending command only once, so bounded Unicode descriptions are not
  // duplicated in the existing 16 KiB recovery envelope.
  return JSON.stringify(pending?{schema:1,pending}:{schema:1,value});
}
export function decodeManualReportDraft(text:string):{value:ManualReportInput;pending:ManualReportCommand|null}{
  const input:unknown=JSON.parse(text);if(!input||typeof input!=='object'||Array.isArray(input))bad();const root=input as Record<string,unknown>;if(root.schema!==1)bad();
  if(Object.hasOwn(root,'pending')){exact(root,['schema','pending']);const pending=decodeManualReportCommand(root.pending);return {pending,value:{source:pending.source,name:pending.reporter.name,contact:pending.reporter.contact,department:pending.reporter.department??'',description:pending.description,location:pending.location.text??'',unknown:pending.location.unknown}};}
  exact(root,['schema','value']);return {value:decodeManualReportInput(root.value),pending:null};
}
