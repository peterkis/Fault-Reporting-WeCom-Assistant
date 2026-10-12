import {ApiError,UnknownCommandOutcome,captureWorkbenchRead} from '../../api/client';

export const candidateStates=['CANDIDATE','UNDER_REVIEW','CONFIRMED','REJECTED','EXPIRED'] as const;
export type CandidateState=typeof candidateStates[number];
export interface CandidateListItem {id:string;status:CandidateState;row_version:string;service_family:string;symptom_family:string;distinct_reporters:number|null;distinct_departments:number|null;distinct_locations:number|null;expires_at:string}
export interface CandidatePage {items:CandidateListItem[];next_cursor:string|null}
export const candidateActions=['START_REVIEW','REJECT_CANDIDATE','CONFIRM_INCIDENT'] as const;
export type CandidateAction=typeof candidateActions[number];
export const incidentScopes=['LOCAL','BUILDING','CAMPUS','HOSPITAL_WIDE'] as const;
export type IncidentScope=typeof incidentScopes[number];
export const candidateReasons=['OPERATOR_REVIEWED','CONFIRMED_SHARED_FAULT','INCORRECT_ASSOCIATION','RECOVERY_CONFIRMED','SUBSCRIPTION_REQUEST','SCOPE_CORRECTION','MAINTENANCE_EXPIRED','WORKBENCH_CONFIRMED'] as const;
export type CandidateReason=typeof candidateReasons[number];
interface CommandBase {client_command_id:string;reason_code:CandidateReason}
export type CandidateOperation={candidateId:string;action:'START_REVIEW'|'REJECT_CANDIDATE';body:CommandBase&{expected_row_version:string}}|
  {candidateId:string;action:'CONFIRM_INCIDENT';body:CommandBase&{expected_candidate_version:string;expected_material_basis:string;confirmed_scope:IncidentScope;owner_principal_id:string;owner_team_id:string|null;selected_report_refs:readonly string[];primary_ticket_id:string|null}};
export interface CandidateCommandResult {ok:true;result_ref_type:'CANDIDATE'|'INCIDENT';result_ref_id:string;result_row_version:string;result_event_id:string;replayed:boolean}
export type CandidateReceipt={candidate_review_id:string;client_command_id:string}&({state:'UNKNOWN'}|{state:'FAILED';error:{code:string;retryable:false}}|{state:'COMMITTED';result:CandidateCommandResult});
export interface IncidentResult {id:string;incident_no:string;status:string;confirmed_scope:IncidentScope;service_family:string;symptom_family:string;severity:string;safe_title:string;row_version:string;confirmed_at:string;roles:string[];owner_principal_id?:string;owner_display_name?:string|null;owner_team_id?:string|null;primary_ticket_id?:string|null;primary_ticket_no?:string|null}
export class CandidateCommandRefusal extends ApiError {}
export interface CandidateOwner {id:string;display_name:string;teams:{team_id:string;display_name:string}[];teams_truncated:boolean}
export interface CandidateSource {source_decision_id:string;journey_id:string;ticket_id:string|null;ticket_no:string|null;service_intake_id:string}
export interface CandidateMaterial {source_decision_id:string;source_kind:'BOT'|'WEB';original_revision:string;current_revision:string|null;original_source_hash:string;current_source_hash:string|null;status:'CURRENT'|'CHANGED'|'EXPIRED'}
export interface CandidateDetail extends CandidateListItem {scope_candidate:string;clinical_severity_candidate:string;reason_codes:string[];evidence_fact_ids:string[];correlation_window_ms:number|null;first_seen_at:string|null;last_seen_at:string|null;source_result_hash:string;source_decision:{id:string;result_code:string;reason_code:string;catalog_version:string;rule_set_version:string;engine_version:string;decision_policy_version:string;input_hash:string;result_hash:string;source_refs:string[]};manual_review:{id:string;status:string;row_version:string}|null;report_sources:CandidateSource[];visible_report_source_count:number;report_sources_truncated:boolean;eligible_owners:CandidateOwner[];eligible_owners_truncated:boolean;allowed_actions:CandidateAction[];allowed_scopes:IncidentScope[];material_basis:string|null;materials:CandidateMaterial[];roles:string[]}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;}
function text(value:unknown,maximum=256):string {if(typeof value!=='string'||value.length>maximum)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function id(value:unknown):string {const result=text(value);if(!UUID.test(result))throw new ApiError(502,'INVALID_RESPONSE');return result;}
function version(value:unknown):string {const result=text(value);if(!/^[1-9][0-9]{0,18}$/u.test(result)||BigInt(result)>9223372036854775807n)throw new ApiError(502,'INVALID_RESPONSE');return result;}
function count(value:unknown):number|null {if(value===null)return null;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function bool(value:unknown):boolean {if(typeof value!=='boolean')throw new ApiError(502,'INVALID_RESPONSE');return value;}
function list<T>(value:unknown,maximum:number,decode:(value:unknown)=>T):T[]{if(!Array.isArray(value)||value.length>maximum)throw new ApiError(502,'INVALID_RESPONSE');return value.map(decode);}
function unique<T>(values:T[],key:(value:T)=>string):T[]{if(new Set(values.map(key)).size!==values.length)throw new ApiError(502,'INVALID_RESPONSE');return values;}
function nullableText(value:unknown):string|null {return value===null?null:text(value);}
function hash(value:unknown):string {const result=text(value);if(!/^[a-f0-9]{64}$/u.test(result))throw new ApiError(502,'INVALID_RESPONSE');return result;}
function timestamp(value:unknown):string {const result=text(value);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(result))throw new ApiError(502,'INVALID_RESPONSE');return result;}
function member<T extends string>(value:unknown,allowed:readonly T[]):T {if(typeof value!=='string'||!allowed.includes(value as T))throw new ApiError(502,'INVALID_RESPONSE');return value as T;}
function exact(value:Record<string,unknown>,keys:readonly string[]){if(Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new ApiError(502,'INVALID_RESPONSE');}
const receiptErrorCodes=['P2_012_COMMAND_CONFLICT','P2_012_COMMAND_FAILED','P2_012_CURSOR_INVALID','P2_012_DIRECT_DESTINATION_REQUIRED','P2_012_DISABLED','P2_012_EXPIRY_CONFLICT','P2_012_FLAG_INVALID','P2_012_FORBIDDEN','P2_012_INPUT_INVALID','P2_012_LIMIT_INVALID','P2_012_LIVE_APPROVAL_REQUIRED','P2_012_NOTIFICATION_EVENT_INVALID','P2_012_NOTIFICATION_FAILED','P2_012_NOT_FOUND','P2_012_OWNER_INVALID','P2_012_PRIMARY_NOT_LINKED','P2_012_PRIMARY_STILL_LINKED','P2_012_REPORT_ALREADY_LINKED','P2_012_SOURCE_CONFLICT','P2_012_SOURCE_EVIDENCE_INCOMPLETE','P2_012_SOURCE_NOT_FOUND','P2_012_STATE_CONFLICT','P2_012_TICKET_ALREADY_LINKED','P2_012_VERSION_CONFLICT'] as const;
function errorCode(value:unknown):string {return member(value,receiptErrorCodes);}
function teamCode(value:unknown):string {const code=text(value,64);if(!/^[A-Z][A-Z0-9_]{0,63}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return code;}
export function isCandidateId(value:string){return UUID.test(value);}
export function decodeCandidateOperation(value:unknown,candidateId:string):CandidateOperation {
  const operation=object(value);exact(operation,['candidateId','action','body']);if(id(operation.candidateId)!==candidateId)throw new ApiError(502,'INVALID_RESPONSE');
  const action=member(operation.action,candidateActions),body=object(operation.body),base={client_command_id:id(body.client_command_id),reason_code:member(body.reason_code,candidateReasons)};
  if(action!=='CONFIRM_INCIDENT'){exact(body,['client_command_id','reason_code','expected_row_version']);return {candidateId,action,body:{...base,expected_row_version:version(body.expected_row_version)}};}
  exact(body,['client_command_id','reason_code','expected_candidate_version','expected_material_basis','confirmed_scope','owner_principal_id','owner_team_id','selected_report_refs','primary_ticket_id']);
  const refs=unique(list(body.selected_report_refs,100,id),value=>value);if(refs.length===0)throw new ApiError(502,'INVALID_RESPONSE');
  return {candidateId,action,body:{...base,expected_candidate_version:version(body.expected_candidate_version),expected_material_basis:hash(body.expected_material_basis),confirmed_scope:member(body.confirmed_scope,incidentScopes),owner_principal_id:id(body.owner_principal_id),owner_team_id:body.owner_team_id===null?null:teamCode(body.owner_team_id),selected_report_refs:refs,primary_ticket_id:body.primary_ticket_id===null?null:id(body.primary_ticket_id)}};
}
function decodeResult(value:unknown,candidateId:string):CandidateCommandResult {
  const r=object(value);exact(r,['ok','result_ref_type','result_ref_id','result_row_version','result_event_id','replayed']);if(r.ok!==true)throw new ApiError(502,'INVALID_RESPONSE');
  const type=member(r.result_ref_type,['CANDIDATE','INCIDENT'] as const),ref=id(r.result_ref_id);if(type==='CANDIDATE'&&ref!==candidateId)throw new ApiError(502,'INVALID_RESPONSE');
  return {ok:true,result_ref_type:type,result_ref_id:ref,result_row_version:version(r.result_row_version),result_event_id:id(r.result_event_id),replayed:bool(r.replayed)};
}
function decodeReceipt(value:unknown,candidateId:string,commandId:string):CandidateReceipt {
  const r=object(value);if(id(r.candidate_review_id)!==candidateId||id(r.client_command_id)!==commandId)throw new ApiError(502,'INVALID_RESPONSE');
  const base={candidate_review_id:candidateId,client_command_id:commandId};
  if(r.state==='UNKNOWN'){exact(r,['candidate_review_id','client_command_id','state']);return {...base,state:'UNKNOWN'};}
  if(r.state==='FAILED'){exact(r,['candidate_review_id','client_command_id','state','error']);const error=object(r.error);exact(error,['code','retryable']);if(error.retryable!==false)throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'FAILED',error:{code:errorCode(error.code),retryable:false}};}
  if(r.state==='COMMITTED'){exact(r,['candidate_review_id','client_command_id','state','result']);const result=decodeResult(r.result,candidateId);if(result.replayed!==true)throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'COMMITTED',result};}
  throw new ApiError(502,'INVALID_RESPONSE');
}
function decodeIncident(value:unknown,incidentId:string):IncidentResult {
  const r=object(value);if(id(r.id)!==incidentId)throw new ApiError(502,'INVALID_RESPONSE');
  const result:IncidentResult={id:incidentId,incident_no:text(r.incident_no),status:member(r.status,['CONFIRMED_LOCAL','CONFIRMED_BUILDING','CONFIRMED_CAMPUS','CONFIRMED_HOSPITAL_WIDE','INVESTIGATING','RESOLVED','CLOSED'] as const),confirmed_scope:member(r.confirmed_scope,incidentScopes),service_family:text(r.service_family),symptom_family:text(r.symptom_family),severity:text(r.severity),safe_title:text(r.safe_title),row_version:version(r.row_version),confirmed_at:timestamp(r.confirmed_at),roles:unique(list(r.roles,3,value=>member(value,['ADMIN','DISPATCHER','HANDLER'] as const)),value=>value)};
  if(Object.hasOwn(r,'owner_principal_id'))result.owner_principal_id=id(r.owner_principal_id);
  if(Object.hasOwn(r,'owner_display_name'))result.owner_display_name=nullableText(r.owner_display_name);
  if(Object.hasOwn(r,'owner_team_id'))result.owner_team_id=r.owner_team_id===null?null:teamCode(r.owner_team_id);
  if(Object.hasOwn(r,'primary_ticket_id'))result.primary_ticket_id=r.primary_ticket_id===null?null:id(r.primary_ticket_id);
  if(Object.hasOwn(r,'primary_ticket_no'))result.primary_ticket_no=nullableText(r.primary_ticket_no);
  if(!result.roles.some(role=>role==='ADMIN'||role==='DISPATCHER')&&['owner_principal_id','owner_display_name','owner_team_id','primary_ticket_id','primary_ticket_no'].some(key=>Object.hasOwn(r,key)))throw new ApiError(502,'INVALID_RESPONSE');
  return result;
}
function decodeItem(value:unknown):CandidateListItem {
  const row=object(value),status=text(row.status),expires=text(row.expires_at);
  if(!candidateStates.includes(status as CandidateState)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(expires))throw new ApiError(502,'INVALID_RESPONSE');
  return {id:id(row.id),status:status as CandidateState,row_version:version(row.row_version),service_family:text(row.service_family),symptom_family:text(row.symptom_family),distinct_reporters:count(row.distinct_reporters),distinct_departments:count(row.distinct_departments),distinct_locations:count(row.distinct_locations),expires_at:expires};
}
function decodePage(value:unknown):CandidatePage {
  const row=object(value);if(!Array.isArray(row.items)||row.items.length>100)throw new ApiError(502,'INVALID_RESPONSE');
  const items=row.items.map(decodeItem);if(new Set(items.map(item=>item.id)).size!==items.length)throw new ApiError(502,'INVALID_RESPONSE');
  return {items,next_cursor:row.next_cursor===null?null:text(row.next_cursor,2048)};
}
function decodeDetail(value:unknown,candidateId:string):CandidateDetail {
  const row=object(value),base=decodeItem(value);if(base.id!==candidateId)throw new ApiError(502,'INVALID_RESPONSE');
  const decision=object(row.source_decision),manual=row.manual_review===null?null:object(row.manual_review);
  const sources=unique(list(row.report_sources,100,value=>{const s=object(value);return {source_decision_id:id(s.source_decision_id),journey_id:id(s.journey_id),ticket_id:s.ticket_id===null?null:id(s.ticket_id),ticket_no:nullableText(s.ticket_no),service_intake_id:id(s.service_intake_id)};}),s=>s.source_decision_id);
  const owners=unique(list(row.eligible_owners,100,value=>{const o=object(value);return {id:id(o.id),display_name:text(o.display_name),teams:unique(list(o.teams,20,value=>{const team=object(value),teamId=text(team.team_id,64);if(!/^[A-Z][A-Z0-9_]{0,63}$/u.test(teamId))throw new ApiError(502,'INVALID_RESPONSE');return {team_id:teamId,display_name:text(team.display_name)};}),t=>t.team_id),teams_truncated:bool(o.teams_truncated)};}),o=>o.id);
  const materials=unique(list(row.materials,101,value=>{const m=object(value);return {source_decision_id:id(m.source_decision_id),source_kind:member(m.source_kind,['BOT','WEB'] as const),original_revision:version(m.original_revision),current_revision:m.current_revision===null?null:version(m.current_revision),original_source_hash:hash(m.original_source_hash),current_source_hash:m.current_source_hash===null?null:hash(m.current_source_hash),status:member(m.status,['CURRENT','CHANGED','EXPIRED'] as const)};}),m=>m.source_decision_id);
  const population=count(row.visible_report_source_count);if(population===null||population<sources.length||bool(row.report_sources_truncated)!==(population>sources.length))throw new ApiError(502,'INVALID_RESPONSE');
  return {...base,scope_candidate:text(row.scope_candidate),clinical_severity_candidate:text(row.clinical_severity_candidate),reason_codes:list(row.reason_codes,100,value=>text(value,100)),evidence_fact_ids:list(row.evidence_fact_ids,1000,value=>text(value,100)),correlation_window_ms:count(row.correlation_window_ms),first_seen_at:row.first_seen_at===null?null:timestamp(row.first_seen_at),last_seen_at:row.last_seen_at===null?null:timestamp(row.last_seen_at),source_result_hash:hash(row.source_result_hash),
    source_decision:{id:id(decision.id),result_code:member(decision.result_code,['INCIDENT_REVIEW_CANDIDATE'] as const),reason_code:text(decision.reason_code,100),catalog_version:text(decision.catalog_version),rule_set_version:text(decision.rule_set_version),engine_version:text(decision.engine_version),decision_policy_version:text(decision.decision_policy_version),input_hash:hash(decision.input_hash),result_hash:hash(decision.result_hash),source_refs:list(decision.source_refs,100,value=>text(value,100))},
    manual_review:manual?{id:id(manual.id),status:member(manual.status,['PENDING','RESOLVED','CANCELLED'] as const),row_version:version(manual.row_version)}:null,
    report_sources:sources,visible_report_source_count:population,report_sources_truncated:row.report_sources_truncated as boolean,eligible_owners:owners,eligible_owners_truncated:bool(row.eligible_owners_truncated),materials,material_basis:row.material_basis===null?null:hash(row.material_basis),
    allowed_actions:unique(list(row.allowed_actions,3,value=>member(value,candidateActions)),value=>value),allowed_scopes:unique(list(row.allowed_scopes,4,value=>member(value,incidentScopes)),value=>value),roles:unique(list(row.roles,3,value=>member(value,['ADMIN','DISPATCHER','HANDLER'] as const)),value=>value)};
}
async function get<T>(path:string,signal:AbortSignal,decode:(value:unknown)=>T):Promise<T>{
  const requireCurrent=captureWorkbenchRead(signal);try{
  const response=await fetch(path,{signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json'}});
  requireCurrent();
  if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');
  if(!response.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(response.ok?502:response.status,'INVALID_RESPONSE');
  const value:unknown=await response.json();requireCurrent();if(!response.ok){const error=object(object(value).error),code=text(error.code,100);if(!/^[A-Z][A-Z0-9_]{0,100}$/u.test(code))throw new ApiError(response.status,'INVALID_RESPONSE');throw new ApiError(response.status,code);}
  return decode(value);
  }catch(error){requireCurrent();throw error;}
}
export const candidateApi={
  list:(state:CandidateState,cursor:string|null,signal:AbortSignal):Promise<CandidatePage>=>get('/api/incident-candidates?'+new URLSearchParams({state,limit:'30',...(cursor?{cursor}:{})}),signal,decodePage),
  detail:(candidateId:string,signal:AbortSignal):Promise<CandidateDetail>=>get('/api/incident-candidates/'+encodeURIComponent(id(candidateId)),signal,value=>decodeDetail(value,candidateId)),
  receipt:(candidateId:string,commandId:string,signal:AbortSignal):Promise<CandidateReceipt>=>get('/api/incident-candidates/'+id(candidateId)+'/commands/'+id(commandId),signal,value=>decodeReceipt(value,candidateId,commandId)),
  incident:(incidentId:string,signal:AbortSignal):Promise<IncidentResult>=>get('/api/incidents/'+id(incidentId),signal,value=>decodeIncident(value,incidentId)),
  async perform(operation:CandidateOperation,csrfToken:string|null,signal:AbortSignal):Promise<CandidateCommandResult>{
    const original=decodeCandidateOperation(operation,operation.candidateId),routes={START_REVIEW:'start-review',REJECT_CANDIDATE:'reject',CONFIRM_INCIDENT:'confirm'};
    const expected=original.action==='CONFIRM_INCIDENT'?original.body.expected_candidate_version:original.body.expected_row_version;
    try{
      const response=await fetch('/api/incident-candidates/'+original.candidateId+'/'+routes[original.action],{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':original.body.client_command_id,'if-match':'"'+expected+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(original.body)});
      if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
      const value:unknown=await response.json(),r=object(value);
      if(!response.ok){
        const error=object(r.error),code=errorCode(error.code);
        if(r.ok===false&&typeof r.replayed==='boolean'&&error.retryable===false){exact(r,['ok','error','replayed']);exact(error,['code','retryable']);throw new CandidateCommandRefusal(response.status,code);}
        throw new UnknownCommandOutcome();
      }
      const result=decodeResult(r,original.candidateId);
      if(result.result_ref_type!==(original.action==='CONFIRM_INCIDENT'?'INCIDENT':'CANDIDATE')||(result.result_ref_type==='CANDIDATE'&&result.result_row_version!==(BigInt(expected)+1n).toString()))throw new UnknownCommandOutcome();
      return result;
    }catch(error){if(error instanceof CandidateCommandRefusal||(error instanceof ApiError&&[401,403,404].includes(error.status)))throw error;throw new UnknownCommandOutcome();}
  },
};

export type IncidentInvestigationCommand=Readonly<{client_command_id:string;expected_row_version:string;reason_code:'OPERATOR_REVIEWED'}>;
export interface IncidentCommandResult extends Omit<CandidateCommandResult,'result_ref_type'>{result_ref_type:'INCIDENT'}
export class IncidentCommandRefusal extends ApiError {}
export const incidentActions=['START_INVESTIGATING','CORRECT_SCOPE','SET_PRIMARY_TICKET','LINK_REPORT','UNLINK_REPORT','MARK_REPORTER_RECOVERED','PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION','RESOLVE_INCIDENT','CLOSE_INCIDENT'] as const;
export type IncidentAction=typeof incidentActions[number];
type IncidentBody=Readonly<CommandBase&{expected_row_version:string}>;
export type IncidentOperation={incidentId:string}&(
  {action:'START_INVESTIGATING'|'RESOLVE_INCIDENT'|'CLOSE_INCIDENT';body:IncidentBody}|
  {action:'CORRECT_SCOPE';body:IncidentBody&{confirmed_scope:IncidentScope}}|
  {action:'SET_PRIMARY_TICKET';body:IncidentBody&{primary_ticket_id:string|null}}|
  {action:'LINK_REPORT';body:IncidentBody&{source_decision_id:string}}|
  {action:'UNLINK_REPORT'|'MARK_REPORTER_RECOVERED';reportId:string;body:IncidentBody&{expected_report_version:string}}|
  {action:'PAUSE_SUBSCRIPTION'|'RESUME_SUBSCRIPTION';subscriptionId:string;body:IncidentBody&{expected_subscription_version:string;direct_channel_leg_id?:string|null}});
export interface IncidentChildPage<T>{items:T[];next_cursor:string|null}
export interface IncidentReportItem{id:string;ticket_id:string|null;ticket_no:string|null;service_intake_id:string;link_state:'CANDIDATE'|'LINKED'|'UNLINKED'|'REJECTED';impact_state:'UNKNOWN'|'IMPACTED'|'RECOVERED';row_version:string;linked_at:string|null;unlinked_at:string|null;recovered_at:string|null}
export interface IncidentLinkableItem{id:string;source_decision_id:string;ticket_no:string}
export interface IncidentSubscriptionItem{id:string;representative_report_id:string;status:'PENDING_DESTINATION'|'ACTIVE'|'PAUSED'|'ENDED';impact_state:'UNKNOWN'|'IMPACTED'|'RECOVERED';row_version:string;last_notified_incident_version:string|null;created_at:string;updated_at:string}
const nullableId=(value:unknown)=>value===null?null:id(value);
const nullableTimestamp=(value:unknown)=>value===null?null:timestamp(value);
function zeroVersion(value:unknown):string{const result=text(value);if(!/^(0|[1-9][0-9]{0,18})$/u.test(result)||BigInt(result)>9223372036854775807n)throw new ApiError(502,'INVALID_RESPONSE');return result;}
function childPage<T>(value:unknown,decode:(value:unknown)=>T,identity:(item:T)=>string):IncidentChildPage<T>{const page=object(value);exact(page,['items','next_cursor']);return {items:unique(list(page.items,30,decode),identity),next_cursor:page.next_cursor===null?null:text(page.next_cursor,2048)};}
function reportItem(value:unknown):IncidentReportItem{
  const r=object(value);exact(r,['id','ticket_id','ticket_no','service_intake_id','link_state','impact_state','row_version','linked_at','unlinked_at','recovered_at']);
  return {id:id(r.id),ticket_id:nullableId(r.ticket_id),ticket_no:nullableText(r.ticket_no),service_intake_id:id(r.service_intake_id),link_state:member(r.link_state,['CANDIDATE','LINKED','UNLINKED','REJECTED'] as const),impact_state:member(r.impact_state,['UNKNOWN','IMPACTED','RECOVERED'] as const),row_version:version(r.row_version),linked_at:nullableTimestamp(r.linked_at),unlinked_at:nullableTimestamp(r.unlinked_at),recovered_at:nullableTimestamp(r.recovered_at)};
}
function subscriptionItem(value:unknown):IncidentSubscriptionItem{
  const s=object(value);exact(s,['id','representative_report_id','status','impact_state','row_version','last_notified_incident_version','created_at','updated_at']);
  return {id:id(s.id),representative_report_id:id(s.representative_report_id),status:member(s.status,['PENDING_DESTINATION','ACTIVE','PAUSED','ENDED'] as const),impact_state:member(s.impact_state,['UNKNOWN','IMPACTED','RECOVERED'] as const),row_version:version(s.row_version),last_notified_incident_version:s.last_notified_incident_version===null?null:zeroVersion(s.last_notified_incident_version),created_at:timestamp(s.created_at),updated_at:timestamp(s.updated_at)};
}
export function decodeIncidentOperation(value:unknown):IncidentOperation{
  const op=object(value),target=id(op.incidentId),action=member(op.action,incidentActions),body=object(op.body),base={client_command_id:id(body.client_command_id),expected_row_version:version(body.expected_row_version),reason_code:member(body.reason_code,candidateReasons)},keys=['client_command_id','expected_row_version','reason_code'];
  exact(op,['incidentId','action','body',...(['UNLINK_REPORT','MARK_REPORTER_RECOVERED'].includes(action)?['reportId']:['PAUSE_SUBSCRIPTION','RESUME_SUBSCRIPTION'].includes(action)?['subscriptionId']:[])]);
  if(action==='CORRECT_SCOPE'){exact(body,[...keys,'confirmed_scope']);return {incidentId:target,action,body:{...base,confirmed_scope:member(body.confirmed_scope,incidentScopes)}};}
  if(action==='SET_PRIMARY_TICKET'){exact(body,[...keys,'primary_ticket_id']);return {incidentId:target,action,body:{...base,primary_ticket_id:nullableId(body.primary_ticket_id)}};}
  if(action==='LINK_REPORT'){exact(body,[...keys,'source_decision_id']);return {incidentId:target,action,body:{...base,source_decision_id:id(body.source_decision_id)}};}
  if(action==='UNLINK_REPORT'||action==='MARK_REPORTER_RECOVERED'){exact(body,[...keys,'expected_report_version']);return {incidentId:target,action,reportId:id(op.reportId),body:{...base,expected_report_version:version(body.expected_report_version)}};}
  if(action==='PAUSE_SUBSCRIPTION'||action==='RESUME_SUBSCRIPTION'){
    const direct=action==='RESUME_SUBSCRIPTION'&&Object.hasOwn(body,'direct_channel_leg_id');exact(body,[...keys,'expected_subscription_version',...(direct?['direct_channel_leg_id']:[])]);
    return {incidentId:target,action,subscriptionId:id(op.subscriptionId),body:{...base,expected_subscription_version:version(body.expected_subscription_version),...(direct?{direct_channel_leg_id:nullableId(body.direct_channel_leg_id)}:{})}};
  }
  exact(body,keys);if(action==='START_INVESTIGATING'&&base.reason_code!=='OPERATOR_REVIEWED')throw new ApiError(502,'INVALID_RESPONSE');return {incidentId:target,action,body:base};
}
async function performIncident(operation:IncidentOperation,csrfToken:string|null,signal:AbortSignal):Promise<IncidentCommandResult>{
  const original=decodeIncidentOperation(operation),body=original.body,requireCurrent=captureWorkbenchRead(signal);requireCurrent();
  const route=original.action==='UNLINK_REPORT'||original.action==='MARK_REPORTER_RECOVERED'?'reports/'+original.reportId+(original.action==='UNLINK_REPORT'?'/unlink':'/mark-recovered'):
    original.action==='PAUSE_SUBSCRIPTION'||original.action==='RESUME_SUBSCRIPTION'?'subscriptions/'+original.subscriptionId+(original.action==='PAUSE_SUBSCRIPTION'?'/pause':'/resume'):
    {START_INVESTIGATING:'start-investigating',CORRECT_SCOPE:'correct-scope',SET_PRIMARY_TICKET:'primary-ticket',LINK_REPORT:'reports/link',RESOLVE_INCIDENT:'resolve',CLOSE_INCIDENT:'close'}[original.action];
  try{
    const response=await fetch('/api/incidents/'+original.incidentId+'/'+route,{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(body)});
    requireCurrent();if([401,403,404].includes(response.status))throw new ApiError(response.status,'AUTHORIZATION_REJECTED');
    if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();const value:unknown=await response.json();requireCurrent();const r=object(value);
    if(!response.ok){const error=object(r.error),code=errorCode(error.code);if(r.ok===false&&typeof r.replayed==='boolean'&&error.retryable===false){exact(r,['ok','error','replayed']);exact(error,['code','retryable']);throw new IncidentCommandRefusal(response.status,code);}throw new UnknownCommandOutcome();}
    const result=decodeResult(r,original.incidentId);if(response.status!==200||result.result_ref_type!=='INCIDENT'||result.result_ref_id!==original.incidentId||result.result_row_version!==(BigInt(body.expected_row_version)+1n).toString())throw new UnknownCommandOutcome();return {...result,result_ref_type:'INCIDENT'};
  }catch(error){if(error instanceof IncidentCommandRefusal||(error instanceof ApiError&&[401,403,404].includes(error.status)))throw error;throw new UnknownCommandOutcome();}
}
const childPath=(incidentId:string,part:string,cursor:string|null)=>'/api/incidents/'+id(incidentId)+'/'+part+'?'+new URLSearchParams({limit:'30',...(cursor?{cursor}:{})});
export const incidentApi={
  startInvestigation:(incidentId:string,body:IncidentInvestigationCommand,csrfToken:string|null,signal:AbortSignal)=>performIncident({incidentId,action:'START_INVESTIGATING',body},csrfToken,signal),
  perform:performIncident,
  reports:(incidentId:string,cursor:string|null,signal:AbortSignal)=>get(childPath(incidentId,'reports',cursor),signal,value=>childPage(value,reportItem,item=>item.id)),
  subscriptions:(incidentId:string,cursor:string|null,signal:AbortSignal)=>get(childPath(incidentId,'subscriptions',cursor),signal,value=>childPage(value,subscriptionItem,item=>item.id)),
  linkable:(incidentId:string,cursor:string|null,signal:AbortSignal)=>get(childPath(incidentId,'linkable-reports',cursor),signal,value=>childPage(value,input=>{const r=object(input);exact(r,['source_decision_id','id','ticket_no']);return {id:id(r.id),source_decision_id:id(r.source_decision_id),ticket_no:text(r.ticket_no)};},item=>item.id)),
  ticketAssignee:(ticketId:string,signal:AbortSignal)=>get('/api/tickets/'+id(ticketId),signal,value=>{const r=object(value);if(id(r.id)!==ticketId)throw new ApiError(502,'INVALID_RESPONSE');return nullableId(r.assignee_id);}),
};
