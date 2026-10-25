import {ApiError,UnknownCommandOutcome} from '../../api/client';
import type {CanonicalItem,ReviewCommand,ReviewCommandResult,ReviewMaterialProjection,ReviewReceipt} from '../../../../../contracts/workbench_review_contracts';
import {decodeManualReportProjection} from '../../contracts/workbench-manual-report-browser-contracts.mjs';
import type {ManualReportSourceProjection} from '../../contracts/workbench-manual-report-browser-contracts.mjs';
export type {ReviewCommand,ReviewReceipt};
export const resolutions={CONFIRM_TICKET_ELIGIBLE:'确认为故障，受理工单',CLASSIFY_SERVICE_REQUEST:'确认为服务请求',REQUEST_DESCRIPTION:'请求补充描述',CLASSIFY_BUSINESS_CONSULTATION:'记录业务咨询',ACKNOWLEDGE:'记录确认回应',MARK_OUT_OF_SCOPE:'记录范围外诉求',KEEP_INCIDENT_REVIEW_CANDIDATE:'保留公共故障审核候选',CANCEL_REVIEW:'取消此复核'} as const;
export type Resolution=keyof typeof resolutions;
export interface ReviewView extends ReviewMaterialProjection {
  manual_report?:ManualReportSourceProjection;
  id:string;decision_id:string;service_intake_id:string;review_reason:string;row_version:string;status:'PENDING'|'RESOLVED'|'CANCELLED';canonical_item:CanonicalItem;
  evidence:{result:string;reason:string;known:{field:string;value:string}[];missing:string[];conflicts:{code:string;sources:string[]}[];
    sources:string[];versions:string[];risk:string;provenance:{field:string;value:string;source:string;confidence:string}[];suggestions:{type:string;policy:string}[]};
}
function invalid():never{throw new ApiError(502,'INVALID_RESPONSE');}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();return value as Record<string,unknown>;}
function exact(value:unknown,keys:readonly string[],required=keys){const v=object(value);if(Object.keys(v).some(key=>!keys.includes(key))||required.some(key=>!Object.hasOwn(v,key)))invalid();return v;}
function text(value:unknown,max=20000):string{if(typeof value!=='string'||value.length>max)invalid();return value;}
function uuid(value:unknown):string{const v=text(value,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v))invalid();return v;}
function hash(value:unknown):string{const v=text(value,64);if(!/^[a-f0-9]{64}$/u.test(v))invalid();return v;}
function code(value:unknown):string{const v=text(value,64);if(!/^[A-Z][A-Z0-9_]{0,63}$/u.test(v))invalid();return v;}
function flag(value:unknown):boolean{if(typeof value!=='boolean')invalid();return value;}
function list<T>(value:unknown,max:number,decode:(item:unknown)=>T):T[]{if(!Array.isArray(value)||value.length>max)invalid();return value.map(decode);}
function integer(value:unknown,max:number):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>max)invalid();return value;}
export function reviewVersion(value:unknown,zero=false):string{const v=text(value,19);if(!(zero?/^(0|[1-9][0-9]{0,18})$/u:/^[1-9][0-9]{0,18}$/u).test(v)||BigInt(v)>9223372036854775807n)invalid();return v;}
export function canonicalItem(value:unknown):CanonicalItem{const v=exact(value,['kind','id']);if(v.kind!=='ticket'&&v.kind!=='review'&&v.kind!=='intake')invalid();return {kind:v.kind,id:uuid(v.id)};}
function resolution(value:unknown):Resolution{const v=text(value,64);if(!Object.hasOwn(resolutions,v))invalid();return v as Resolution;}
export function decodeReviewCommand(value:unknown):ReviewCommand{
  const v=exact(value,['client_command_id','expected_row_version','resolution_code','resolution_reason_code','expected_material_basis'],['client_command_id','expected_row_version','resolution_code','resolution_reason_code']);
  return Object.freeze({client_command_id:uuid(v.client_command_id),expected_row_version:reviewVersion(v.expected_row_version),resolution_code:resolution(v.resolution_code),
    resolution_reason_code:code(v.resolution_reason_code),...(Object.hasOwn(v,'expected_material_basis')?{expected_material_basis:hash(v.expected_material_basis)}:{})});
}
function scalar(value:unknown):string|number|boolean|null{
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string')return text(value,4096);
  invalid();
}
function shown(value:unknown):string{const v=Array.isArray(value)?list(value,100,scalar):scalar(value);return typeof v==='string'?v:JSON.stringify(v);}
function decodeReview(value:unknown,target:string):ReviewView{
  const v=object(value),s=object(v.safe_result),basis=exact(v.material_basis,['source_kind','original_revision','current_revision','original_hash','current_hash','stale','reason']);
  if(uuid(v.id).toLowerCase()!==target.toLowerCase()||(v.status!=='PENDING'&&v.status!=='RESOLVED'&&v.status!=='CANCELLED')
    ||(basis.source_kind!=='BOT'&&basis.source_kind!=='WEB'&&basis.source_kind!=='MANUAL')||!['CURRENT','SOURCE_CHANGED','NEW_CHANNEL_LEG'].includes(text(basis.reason,32)))invalid();
  let manual:ManualReportSourceProjection|undefined;
  if(basis.source_kind==='MANUAL'){try{manual=decodeManualReportProjection(v.manual_report);}catch{invalid();}}
  else if(Object.hasOwn(v,'manual_report'))invalid();
  const stale=flag(basis.stale),reason=basis.reason as ReviewView['material_basis']['reason'];if(stale===(reason==='CURRENT'))invalid();
  const allowed=list(v.allowed_resolutions,8,resolution);if(new Set(allowed).size!==allowed.length||(v.status!=='PENDING'&&allowed.length)||(stale&&allowed.some(item=>item!=='CANCEL_REVIEW')))invalid();
  const unsupported=list(v.unsupported_resolutions,1,item=>{if(item!=='LINK_EXISTING_JOURNEY')invalid();return 'LINK_EXISTING_JOURNEY' as const;});if(new Set(unsupported).size!==unsupported.length)invalid();
  const fields=exact(s.known_fields,['selected_service_code','symptom_codes','domain_intent','transaction_stage','scope'],[]);
  const known=Object.entries(fields).map(([field,value])=>({field,value:field==='symptom_codes'?JSON.stringify(list(value,100,item=>text(item,128))):value===null?'未提供':text(value,128)}));
  const materials=list(v.materials,50,item=>{const m=exact(item,['source_ref','revision','text','in_original_basis']),ref=text(m.source_ref,160);
    if(!/^channel:[1-9][0-9]*$/u.test(ref)&&!/^web:[0-9a-f-]{36}$/iu.test(ref)&&!(basis.source_kind==='MANUAL'&&ref==='manual:'+uuid(v.service_intake_id)))invalid();
    return {source_ref:ref,revision:reviewVersion(m.revision,true),text:m.text===null?null:text(m.text),in_original_basis:flag(m.in_original_basis)};});
  if(materials.reduce((sum,item)=>sum+(item.text?.length??0),0)>20000)invalid();
  const projection:ReviewMaterialProjection={material_basis:{source_kind:basis.source_kind,original_revision:reviewVersion(basis.original_revision,true),current_revision:reviewVersion(basis.current_revision,true),
    original_hash:hash(basis.original_hash),current_hash:hash(basis.current_hash),stale,reason},materials,materials_truncated:flag(v.materials_truncated)};
  hash(s.input_hash);hash(s.result_hash);flag(s.manual_review_required);flag(s.ticket_creation_recommended);flag(s.incident_review_candidate);
  return {...projection,...(manual?{manual_report:manual}:{}),id:uuid(v.id),decision_id:uuid(v.decision_id),service_intake_id:uuid(v.service_intake_id),review_reason:code(v.review_reason_code),row_version:reviewVersion(v.row_version),status:v.status,
    canonical_item:canonicalItem(v.canonical_item),allowed_resolutions:allowed,unsupported_resolutions:unsupported,
    evidence:{result:code(s.result_code),reason:code(s.reason_code),known,missing:list(s.unknown_fields,100,item=>text(item,128)),
      conflicts:list(s.conflicts,100,item=>{const c=object(item);return {code:code(c.code),sources:c.source_refs===undefined?[]:list(c.source_refs,100,item=>text(item,160))};}),
      sources:list(s.source_refs,100,item=>text(item,160)),versions:[s.catalog_version,s.rule_set_version,s.engine_version,s.decision_policy_version].map(item=>text(item,128)),risk:code(s.clinical_safety_risk),
      provenance:list(s.fact_provenance,500,item=>{const p=object(item);hash(p.source_hash);return {field:text(p.field_path,128),value:shown(p.normalized_value),source:text(p.source_ref,160),confidence:code(p.confidence_level)};}),
      suggestions:list(s.safe_action_suggestions,20,item=>{const a=object(item);hash(a.payload_hash);integer(a.action_ordinal,20);return {type:code(a.action_type),policy:code(a.execution_policy)};})}};
}
export interface ReviewView {allowed_resolutions:Resolution[];unsupported_resolutions:'LINK_EXISTING_JOURNEY'[]}
function result(value:unknown,target:string):ReviewCommandResult{
  const v=exact(value,['ok','review_id','status','resolution_decision_id','action_count','replayed']);
  if(v.ok!==true||uuid(v.review_id).toLowerCase()!==target.toLowerCase()||(v.status!=='RESOLVED'&&v.status!=='CANCELLED')||typeof v.replayed!=='boolean')invalid();
  return {ok:true,review_id:uuid(v.review_id),status:v.status,resolution_decision_id:uuid(v.resolution_decision_id),action_count:integer(v.action_count,20),replayed:v.replayed};
}
async function authorization(response:Response):Promise<never>{let code='AUTHORIZATION_REJECTED';try{const raw=object(await response.json()),v=text(object(raw.error).code,100);if(/^[A-Z][A-Z0-9_]{0,100}$/u.test(v))code=v;}catch{/* HTTP authorization still fences an unreadable body. */}throw new ApiError(response.status,code);}
async function get<T>(path:string,signal:AbortSignal,decode:(value:unknown)=>T):Promise<T>{
  const response=await fetch(path,{signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});
  if([401,403,404].includes(response.status))return authorization(response);
  if(!response.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(response.ok?502:response.status,'INVALID_RESPONSE');
  const value:unknown=await response.json();if(!response.ok)throw new ApiError(response.status,code(object(object(value).error).code));return decode(value);
}
export const reviewApi={
  detail:(reviewId:string,signal:AbortSignal)=>get('/api/manual-reviews/'+encodeURIComponent(reviewId),signal,value=>decodeReview(value,reviewId)),
  receipt:(reviewId:string,commandId:string,signal:AbortSignal):Promise<ReviewReceipt>=>get('/api/manual-reviews/'+encodeURIComponent(reviewId)+'/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(uuid(v.review_id).toLowerCase()!==reviewId.toLowerCase()||uuid(v.client_command_id).toLowerCase()!==commandId.toLowerCase())invalid();
    const base={review_id:reviewId,client_command_id:commandId};
    if(v.state==='UNKNOWN'&&Object.keys(v).length===3)return {...base,state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===4){const error=exact(v.error,['code','retryable']);if(error.retryable!==false)invalid();return {...base,state:'FAILED',error:{code:code(error.code),retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4){const r=result(v.result,reviewId);if(r.replayed!==true)invalid();return {...base,state:'COMMITTED',result:{...r,replayed:true}};}
    invalid();
  }),
  async resolve(reviewId:string,command:ReviewCommand,csrfToken:string|null,signal:AbortSignal):Promise<ReviewCommandResult>{
    try{
      const response=await fetch('/api/manual-reviews/'+encodeURIComponent(reviewId)+'/resolve',{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',
        headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
      if([401,403,404].includes(response.status))return await authorization(response);
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
      const v=object(await response.json());
      if(!response.ok){const e=object(v.error),errorCode=code(e.code);if(response.status<500||(v.ok===false&&typeof v.replayed==='boolean'&&e.retryable===false)||errorCode==='P2_016_DISABLED')throw new ApiError(response.status,errorCode);throw new UnknownCommandOutcome();}
      return result(v,reviewId);
    }catch(error){if(error instanceof ApiError&&([401,403,404].includes(error.status)||error.code!=='INVALID_RESPONSE'))throw error;throw new UnknownCommandOutcome();}
  },
};
