import type { BoardColumn, CompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail, WorkbenchRecord,SourceGroupDisplay,SourceGroupPage,SourceGroupNameCommand,SourceGroupNameResult } from '../../../../contracts/web01_workbench_contracts';
import type {P2016InternalNoteCommand,P2016InternalNoteResult,P2016InternalNoteReceipt,P2016SelfHandlingCommand,P2016SelfHandlingResult,P2016HandlingCycle,P2016CompletionCommand,P2016CompletionResult,P2016CompletionReceipt,P2016ConversationHandlingCommand,P2016ConversationHandlingAction,P2016ConversationHandlingResult,P2016RelatedConversationPage,P2016ConversationHandlingAcknowledgement} from '../../../../contracts/p2_016_contracts';
import type {WorkbenchRealtimeCapability} from '../../../../contracts/workbench_realtime_contracts';
import type {P2016AssignmentAction,P2016AssignmentCommand,P2016AssignmentTargets,P2016AssignmentResult} from '../../../../contracts/p2_016_contracts';
export type {P2016AssignmentAction,P2016AssignmentCommand};
import type {ManualReportCommand,ManualReportCapabilities,ManualReportReceipt,ManualReportResult} from '../../../../contracts/workbench_manual_report_contracts';
import {decodeManualReportCapabilities,decodeManualReportReceipt,decodeManualReportResult} from '../../../../src/workbench-manual-report-browser-contracts.mjs';
import type {CanonicalItem,ReviewReference} from '../../../../contracts/workbench_review_contracts';
let authorizationEpoch=0,transportWritable=true;
export function setWorkbenchTransportWritable(value:boolean){transportWritable=value;}
export function workbenchTransportWritable(){return transportWritable;}
export function advanceWorkbenchAuthorizationEpoch(){authorizationEpoch++;}
function requireCurrentRead(epoch:number,signal:AbortSignal){signal.throwIfAborted();if(epoch!==authorizationEpoch)throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');}
export type {P2016InternalNoteCommand,P2016SelfHandlingCommand,P2016CompletionCommand,P2016ConversationHandlingCommand,P2016ConversationHandlingAction,P2016RelatedConversationPage};
export type SelfHandlingAction="take-and-start"|"accept-for-later";
export interface TicketCommandContext {id:string;version:number;allowed_actions:string[];resolver_team_id:string;handling_cycle?:P2016HandlingCycle|null}
export class UnknownCommandOutcome extends Error {constructor(){super('COMMAND_OUTCOME_UNKNOWN');}}
export type { BoardColumn, CompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail };
export class ApiError extends Error { constructor(public status:number,public code:string){super(code);} }
function object(value: unknown): Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;}
function text(value:unknown): string {if(typeof value!=='string')throw new ApiError(502,'INVALID_RESPONSE');return value;}
function nullable(value:unknown): string|null {return value===null?null:text(value);}
function strings(value:unknown):string[] {if(!Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value.map(text);}
function datetime(value:unknown):string {const v=text(value);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(v))throw new ApiError(502,'INVALID_RESPONSE');return v;}
function id(value:unknown):string {const v=text(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(v))throw new ApiError(502,'INVALID_RESPONSE');return v;}
function decodeGroup(value:unknown):SourceGroupDisplay {
  const v=object(value),ref=text(v.ref),version=text(v.row_version),name=nullable(v.display_name);
  if(!/^[a-f0-9]{64}$/u.test(ref)||!/^(0|[1-9][0-9]{0,18})$/u.test(version)||BigInt(version)>9223372036854775807n
    ||!['ADMIN_CONFIRMED','UNREGISTERED'].includes(text(v.name_source))
    ||(v.name_source==='UNREGISTERED'?(name!==null||version!=='0'):(name===null||version==='0')))throw new ApiError(502,'INVALID_RESPONSE');
  return {ref,display_name:name,row_version:version,name_source:v.name_source as SourceGroupDisplay['name_source']};
}
function decodeGroupPage(value:unknown):SourceGroupPage {
  const v=object(value);if(!Array.isArray(v.items)||v.items.length>100)throw new ApiError(502,'INVALID_RESPONSE');
  const items=v.items.map(decodeGroup);if(new Set(items.map(group=>group.ref)).size!==items.length)throw new ApiError(502,'INVALID_RESPONSE');
  return {items,next_cursor:nullable(v.next_cursor)};
}
function decodeCard(value:unknown):WorkbenchCard {
  const v=object(value);if(!['ticket','review','intake'].includes(text(v.kind))||!['pending','active','closed'].includes(text(v.column)))throw new ApiError(502,'INVALID_RESPONSE');
  return {kind:v.kind as WorkbenchCard['kind'],id:id(v.id),intake_id:id(v.intake_id),column:v.column as BoardColumn,
    number:text(v.number),title:text(v.title),status:text(v.status),priority:nullable(v.priority),source:text(v.source),
    source_label:text(v.source_label),source_group:v.source_group===null?null:decodeGroup(v.source_group),
    location:nullable(v.location),reporter_name:nullable(v.reporter_name),assignee_name:nullable(v.assignee_name),review_reason:nullable(v.review_reason),
    created_at:datetime(v.created_at),updated_at:datetime(v.updated_at),completed_at:v.completed_at===null?null:datetime(v.completed_at)};
}
function decodePage(value:unknown):BoardPage {
  const v=object(value),r=object(v.range);
  if(!Array.isArray(v.items)||v.items.length>100||!['pending','active','closed'].includes(text(v.column))||!['recent','all','cancelled'].includes(text(r.mode))||r.timezone!=='Asia/Shanghai')throw new ApiError(502,'INVALID_RESPONSE');
  const column=v.column as BoardColumn,items=v.items.map(decodeCard);if(items.some(item=>item.column!==column))throw new ApiError(502,'INVALID_RESPONSE');
  return {items,column,next_cursor:nullable(v.next_cursor),range:{mode:r.mode as CompletionRange,from:datetime(r.from),until:datetime(r.until),timezone:'Asia/Shanghai'}};
}
function decodeRecord(value:unknown):WorkbenchRecord {
  const v=object(value);if(!['REPORT','INTERNAL','EXTERNAL'].includes(text(v.audience)))throw new ApiError(502,'INVALID_RESPONSE');
  return {id:text(v.id),at:datetime(v.at),type:text(v.type),text:nullable(v.text),audience:v.audience as WorkbenchRecord['audience'],actor:nullable(v.actor),old_status:nullable(v.old_status),new_status:nullable(v.new_status)};
}
function decodeDetail(value:unknown):WorkbenchDetail {
  const v=object(value),r=object(v.responsibility);if(!Array.isArray(v.records)||v.records.length>100)throw new ApiError(502,'INVALID_RESPONSE');
  let refs:ReviewReference[]|undefined;
  if(Object.hasOwn(v,'review_refs')){
    if(!Array.isArray(v.review_refs)||v.review_refs.length>100)throw new ApiError(502,'INVALID_RESPONSE');
    refs=v.review_refs.map(value=>{const ref=object(value),row=text(ref.row_version);
      if(Object.keys(ref).length!==3||!['PENDING','RESOLVED','CANCELLED'].includes(text(ref.status))||! /^[1-9][0-9]{0,18}$/u.test(row)||BigInt(row)>9223372036854775807n)throw new ApiError(502,'INVALID_RESPONSE');
      return {id:id(ref.id),status:ref.status as ReviewReference['status'],row_version:row};});
    if(new Set(refs.map(ref=>ref.id)).size!==refs.length)throw new ApiError(502,'INVALID_RESPONSE');
  }
  let requested:CanonicalItem|undefined;
  if(Object.hasOwn(v,'requested_item')){const req=object(v.requested_item);if(Object.keys(req).length!==2||req.kind!=='review')throw new ApiError(502,'INVALID_RESPONSE');requested={kind:'review',id:id(req.id)};}
  return {item:decodeCard(v.item),description:nullable(v.description),records:v.records.map(decodeRecord),next_cursor:nullable(v.next_cursor),
    responsibility:{ticket_assignee_name:nullable(r.ticket_assignee_name),conversation_assignees:strings(r.conversation_assignees)},...(refs?{review_refs:refs}:{}),...(requested?{requested_item:requested}:{})};
}
export interface Principal extends WorkbenchRealtimeCapability {ticket_assignment_enabled:boolean;manual_reports_enabled:boolean;manual_report_draft_recovery_enabled:boolean;principal_id:string;display_name:string;roles:string[];csrf_token:string|null;source_group_directory_enabled:boolean;internal_notes_enabled:boolean;ticket_self_handling_enabled:boolean;ticket_conversation_self_handling_enabled:boolean;ticket_conversation_draft_recovery_enabled:boolean;ticket_staff_completion_enabled:boolean;draft_recovery_enabled:boolean;staff_completion_draft_recovery_enabled:boolean;manual_review_enabled:boolean;manual_review_draft_recovery_enabled:boolean;logout_enabled:boolean}
function optionalFlag(value:unknown):boolean{if(value===undefined)return false;if(typeof value!=='boolean')throw new ApiError(502,'INVALID_RESPONSE');return value;} function decodePrincipal(value:unknown):Principal {
  const v=object(value),interval=v.polling_interval_ms,expires=text(v.expires_epoch_ms),revision=nullable(v.authorization_revision),manual=optionalFlag(v.manual_review_enabled),recovery=optionalFlag(v.manual_review_draft_recovery_enabled),manualReports=optionalFlag(v.manual_reports_enabled),manualReportRecovery=optionalFlag(v.manual_report_draft_recovery_enabled);
  if(typeof v.source_group_directory_enabled!=='boolean'||typeof v.internal_notes_enabled!=='boolean'||typeof v.ticket_self_handling_enabled!=='boolean'||typeof v.ticket_conversation_self_handling_enabled!=='boolean'||typeof v.ticket_conversation_draft_recovery_enabled!=='boolean'||typeof v.ticket_staff_completion_enabled!=='boolean'||typeof v.draft_recovery_enabled!=='boolean'||typeof v.staff_completion_draft_recovery_enabled!=='boolean'||typeof v.logout_enabled!=='boolean'
    ||(recovery&&!manual)||(manualReportRecovery&&!manualReports)||typeof v.realtime_sse_enabled!=='boolean'||typeof v.realtime_sse_available!=='boolean'||typeof interval!=='number'||!Number.isInteger(interval)||interval<1000||interval>300000
    ||!/^(0|[1-9][0-9]{0,18})$/u.test(expires)||BigInt(expires)>9223372036854775807n||v.sse_endpoint!==(v.realtime_sse_enabled?'/api/realtime/events?scope=workbench':null)
    ||(v.realtime_sse_enabled?(revision===null||!/^[a-f0-9]{64}$/u.test(revision)):(revision!==null||v.realtime_sse_available)))throw new ApiError(502,'INVALID_RESPONSE');
  return {principal_id:id(v.principal_id),display_name:text(v.display_name),roles:strings(v.roles),ticket_assignment_enabled:optionalFlag(v.ticket_assignment_enabled),csrf_token:nullable(v.csrf_token),source_group_directory_enabled:v.source_group_directory_enabled,internal_notes_enabled:v.internal_notes_enabled,ticket_self_handling_enabled:v.ticket_self_handling_enabled,ticket_conversation_self_handling_enabled:v.ticket_conversation_self_handling_enabled,ticket_conversation_draft_recovery_enabled:v.ticket_conversation_draft_recovery_enabled,ticket_staff_completion_enabled:v.ticket_staff_completion_enabled,draft_recovery_enabled:v.draft_recovery_enabled,staff_completion_draft_recovery_enabled:v.staff_completion_draft_recovery_enabled,manual_review_enabled:manual,manual_review_draft_recovery_enabled:recovery,manual_reports_enabled:manualReports,manual_report_draft_recovery_enabled:manualReportRecovery,logout_enabled:v.logout_enabled,
    realtime_sse_enabled:v.realtime_sse_enabled,realtime_sse_available:v.realtime_sse_available,sse_endpoint:v.realtime_sse_enabled?'/api/realtime/events?scope=workbench':null,polling_interval_ms:interval,expires_epoch_ms:expires,authorization_revision:revision};
}
function version(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function decodeTicketContext(value:unknown,ticketId:string):TicketCommandContext {
  const v=object(value),actions=strings(v.allowed_actions),ticket=id(v.id);
  if(ticket!==ticketId||actions.length>32||new Set(actions).size!==actions.length||actions.some(action=>! /^[a-z][a-z-]{0,63}$/u.test(action)))throw new ApiError(502,'INVALID_RESPONSE');
  const team=text(v.resolver_team_id);if(!/^[A-Z][A-Z0-9_]{0,63}$/u.test(team))throw new ApiError(502,'INVALID_RESPONSE');
  if(actions.some(action=>['take-and-start','accept-for-later','take-and-start-with-conversations','accept-for-later-with-conversations','complete'].includes(action))&&!Object.hasOwn(v,'handling_cycle'))throw new ApiError(502,'INVALID_RESPONSE');
  return {id:ticket,version:version(v.version),allowed_actions:actions,resolver_team_id:team,...(Object.hasOwn(v,'handling_cycle')?{handling_cycle:v.handling_cycle===null?null:decodeCycle(v.handling_cycle)}:{})};
}
async function rejectAuthorization(response:Response):Promise<never>{
  let code='AUTHORIZATION_REJECTED';
  try {const value:unknown=await response.json(),candidate=text(object(object(value).error).code);if(/^[A-Z][A-Z0-9_]{0,100}$/u.test(candidate))code=candidate;}
  catch { /* The HTTP rejection remains authoritative when its error detail is unreadable. */ }
  throw new ApiError(response.status,code);
}
async function get<T>(path:string,signal:AbortSignal,decode:(value:unknown)=>T):Promise<T> {
  const epoch=authorizationEpoch;
  try{
  const response=await fetch(path,{signal,credentials:'same-origin',redirect:'error',headers:{accept:'application/json'},cache:'no-store'});
  requireCurrentRead(epoch,signal);
  // A credible HTTP authorization rejection fences cached authority even if its error body cannot be decoded.
  if([401,403,404].includes(response.status))return rejectAuthorization(response);
  if(!response.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(response.ok?502:response.status,'INVALID_RESPONSE');
  const value:unknown=await response.json();
  requireCurrentRead(epoch,signal);
  if(!response.ok){const v=object(value),e=object(v.error);throw new ApiError(response.status,text(e.code));}
  return decode(value);
  }catch(error){requireCurrentRead(epoch,signal);throw error;}
}
function decodeCycle(value:unknown):P2016HandlingCycle {const v=object(value);return {id:id(v.id),cycle_no:version(v.cycle_no),first_responsibility_event_id:v.first_responsibility_event_id===null?null:id(v.first_responsibility_event_id),...(Object.hasOwn(v,'staff_completion_event_id')?{staff_completion_event_id:v.staff_completion_event_id===null?null:id(v.staff_completion_event_id)}:{})};}
function decodeTicketReceipt(v:Record<string,unknown>,ticketId:string):P2016InternalNoteResult {return {ok:true,ticket_id:ticketId,ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id),control_event_id:null,replayed:v.replayed as boolean};}
function decodeCompletion(value:unknown,ticketId:string):P2016CompletionResult {
  const v=object(value),c=object(v.completion),event=id(v.ticket_event_id);
  if(Object.keys(v).length!==7||v.ok!==true||id(v.ticket_id)!==ticketId||typeof v.replayed!=='boolean'||v.control_event_id!==null||Object.keys(c).length!==4||id(c.event_id)!==event||c.basis!=='STAFF_COMPLETED')throw new ApiError(502,'INVALID_RESPONSE');
  return {...decodeTicketReceipt(v,ticketId),completion:{cycle_id:id(c.cycle_id),cycle_no:version(c.cycle_no),event_id:event,basis:'STAFF_COMPLETED'}};
}
async function postTicketCommand<T>(ticketId:string,action:string,command:P2016InternalNoteCommand|P2016SelfHandlingCommand|P2016CompletionCommand|P2016ConversationHandlingCommand|P2016AssignmentCommand,csrfToken:string|null,signal:AbortSignal,decode:(value:Record<string,unknown>)=>T):Promise<T> {
    try{
      const response=await fetch('/api/tickets/'+encodeURIComponent(ticketId)+'/'+action,{
        method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',
        headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
      if([401,403,404].includes(response.status))return await rejectAuthorization(response);
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
      const v=object(await response.json());
      if(!response.ok){
        const code=text(object(v.error).code);
        if(!/^[A-Z][A-Z0-9_]{0,100}$/u.test(code))throw new UnknownCommandOutcome();
        // A durable FAILED receipt is a known refusal. An unstructured server failure may follow a commit.
        if(response.status<500||(v.ok===false&&typeof v.replayed==='boolean'&&object(v.error).retryable===false)||['P2_016_DISABLED','P2_016_SELF_HANDLING_UNAVAILABLE','P2_016_STAFF_COMPLETION_UNAVAILABLE'].includes(code))throw new ApiError(response.status,code);
        throw new UnknownCommandOutcome();
      }
      if(v.ok!==true||id(v.ticket_id)!==ticketId||typeof v.replayed!=='boolean'||v.control_event_id!==null)throw new UnknownCommandOutcome();
      return decode(v);
    }catch(error){if(error instanceof ApiError&&([401,403,404].includes(error.status)||error.code!=='INVALID_RESPONSE'))throw error;throw new UnknownCommandOutcome();}

}
export const api={
  assignmentTargets:(ticketId:string,team:string|null,signal:AbortSignal):Promise<P2016AssignmentTargets>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/assignment-targets'+(team?'?'+new URLSearchParams({resolver_team_id:team}):''),signal,value=>{
    const v=object(value);if(Object.keys(v).length!==3||!Array.isArray(v.resolver_teams)||v.resolver_teams.length>100||!Array.isArray(v.items)||v.items.length>100||v.resolver_team_id!==team)throw new ApiError(502,'INVALID_RESPONSE');
    const resolver_teams=v.resolver_teams.map(value=>{const row=object(value),team_id=text(row.team_id),display_name=text(row.display_name);if(Object.keys(row).length!==2||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(team_id)||!display_name||display_name.length>128)throw new ApiError(502,'INVALID_RESPONSE');return {team_id,display_name};});
    const items=v.items.map(value=>{const row=object(value),principal_id=id(row.principal_id),display_name=text(row.display_name);if(Object.keys(row).length!==2||!display_name||display_name.length>128)throw new ApiError(502,'INVALID_RESPONSE');return {principal_id,display_name};});
    if(new Set(resolver_teams.map(group=>group.team_id)).size!==resolver_teams.length||new Set(items.map(item=>item.principal_id)).size!==items.length||(team===null?items.length!==0:!resolver_teams.some(group=>group.team_id===team)))throw new ApiError(502,'INVALID_RESPONSE');
    return {resolver_teams,resolver_team_id:team,items};
  }),
  assignTicket:(ticketId:string,action:P2016AssignmentAction,command:P2016AssignmentCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016AssignmentResult>=>postTicketCommand(ticketId,action,command,csrfToken,signal,v=>{
    if(Object.keys(v).length!==9||v.communication_choice!==command.communication_choice||!Array.isArray(v.conversations)||v.conversations.length!==0)throw new UnknownCommandOutcome();
    return {...decodeTicketReceipt(v,ticketId),handling_cycle:v.handling_cycle===null?null:decodeCycle(v.handling_cycle),communication_choice:command.communication_choice,conversations:[]};
  }),
  manualReportCapabilities:(signal:AbortSignal):Promise<ManualReportCapabilities>=>get('/api/workbench/reports/capabilities',signal,value=>{try{return decodeManualReportCapabilities(value);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  manualReportReceipt:(commandId:string,signal:AbortSignal):Promise<ManualReportReceipt>=>get('/api/workbench/reports/commands/'+encodeURIComponent(commandId),signal,value=>{try{return decodeManualReportReceipt(value,commandId);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  submitManualReport:async(command:ManualReportCommand,csrfToken:string|null,signal:AbortSignal):Promise<ManualReportResult>=>{
    try{
      const response=await fetch('/api/workbench/reports',{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
      if([401,403,404].includes(response.status))return await rejectAuthorization(response);
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
      const value:unknown=await response.json(),v=object(value);
      if(!response.ok){const e=object(v.error),code=text(e.code);if(!/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code))throw new UnknownCommandOutcome();
        if(response.status<500||v.ok===false&&typeof v.replayed==='boolean'&&e.retryable===false||code==='P2_016_DISABLED')throw new ApiError(response.status,code);throw new UnknownCommandOutcome();}
      const result=decodeManualReportResult(v,command.client_command_id);if(result.source!==command.source||response.status!==(result.replayed?200:202))throw new UnknownCommandOutcome();return result;
    }catch(error){if(error instanceof ApiError&&([401,403,404].includes(error.status)||error.code!=='INVALID_RESPONSE'))throw error;throw new UnknownCommandOutcome();}
  },
  relatedConversations:(ticketId:string,cursor:string|null,signal:AbortSignal):Promise<P2016RelatedConversationPage>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/related-conversations?'+new URLSearchParams({limit:'20',...(cursor?{cursor}:{})}),signal,value=>{
    const v=object(value);if(Object.keys(v).length!==2||!Array.isArray(v.items)||v.items.length>20)throw new ApiError(502,'INVALID_RESPONSE');
    const items=v.items.map((value):P2016RelatedConversationPage['items'][number]=>{const row=object(value),raw=text(row.session_row_version),status=row.assignment_status;
      if(Object.keys(row).length!==6||!/^[1-9][0-9]{0,18}$/u.test(raw)||BigInt(raw)>9223372036854775807n||typeof row.take_allowed!=='boolean'||(status!==null&&status!=='ASSIGNED'&&status!=='UNASSIGNED')||(row.take_allowed&&BigInt(raw)>2147483647n))throw new ApiError(502,'INVALID_RESPONSE');
      return {session_id:id(row.session_id),session_row_version:raw,conversation_principal_id:row.conversation_principal_id===null?null:id(row.conversation_principal_id),conversation_principal_name:nullable(row.conversation_principal_name),assignment_status:status,take_allowed:row.take_allowed};
    });
    if(new Set(items.map(row=>row.session_id.toLowerCase())).size!==items.length)throw new ApiError(502,'INVALID_RESPONSE');
    return {items,next_cursor:nullable(v.next_cursor)};
  }),
  readConversation:(sessionId:string,signal:AbortSignal):Promise<void>=>get('/api/conversations/'+encodeURIComponent(sessionId),signal,value=>{if(id(object(object(value).session).session_id)!==sessionId)throw new ApiError(502,'INVALID_RESPONSE');}),
  handleConversations:(ticketId:string,action:P2016ConversationHandlingAction,command:P2016ConversationHandlingCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016ConversationHandlingResult>=>postTicketCommand(ticketId,action,command,csrfToken,signal,v=>{
    if(v.communication_choice!==command.communication_choice||!Array.isArray(v.conversations)||v.conversations.length!==command.sessions.length)throw new UnknownCommandOutcome();
    const conversations=v.conversations.map(value=>{const row=object(value),session=id(row.session_id),original=command.sessions.find(item=>item.session_id===session),raw=row.session_row_version;
      if(Object.keys(row).length!==4||!original||typeof row.changed!=='boolean'||typeof raw!=='number'||!Number.isSafeInteger(raw)||raw!==original.expected_row_version+(row.changed?1:0)||(row.changed?(typeof row.control_event_id!=='string'):row.control_event_id!==null))throw new UnknownCommandOutcome();
      return {session_id:session,session_row_version:raw,control_event_id:row.control_event_id===null?null:id(row.control_event_id),changed:row.changed};
    });
    if(new Set(conversations.map(row=>row.session_id)).size!==conversations.length)throw new UnknownCommandOutcome();
    const cycle=decodeCycle(v.handling_cycle);if(cycle.first_responsibility_event_id===null)throw new UnknownCommandOutcome();
    return {...decodeTicketReceipt(v,ticketId),handling_cycle:{...cycle,first_responsibility_event_id:cycle.first_responsibility_event_id},communication_choice:command.communication_choice,conversations};
  }),
  conversationHandlingAcknowledgement:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016ConversationHandlingAcknowledgement>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/conversation-handling-commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===2){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||!/^P2_016_[A-Z0-9_]{1,64}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4&&id(v.ticket_id)===ticketId)return {state:'COMMITTED',ticket_id:ticketId,ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id)};
    throw new ApiError(502,'INVALID_RESPONSE');
  }),
  completeTicket:(ticketId:string,command:P2016CompletionCommand,csrfToken:string|null,signal:AbortSignal)=>postTicketCommand(ticketId,'complete',command,csrfToken,signal,v=>{
    const result=decodeCompletion(v,ticketId);if(result.completion.cycle_id!==command.handling_cycle_id||result.ticket_version<command.expected_version+1||result.ticket_version>command.expected_version+2)throw new UnknownCommandOutcome();return result;
  }),
  completionReceipt:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016CompletionReceipt>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/completion/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(id(v.ticket_id)!==ticketId||id(v.client_command_id)!==commandId)throw new ApiError(502,'INVALID_RESPONSE');const base={ticket_id:ticketId,client_command_id:commandId};
    if(v.state==='UNKNOWN'&&Object.keys(v).length===3)return {...base,state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===4){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4){const result=decodeCompletion(v.result,ticketId);if(result.replayed!==true)throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'COMMITTED',result};}
    throw new ApiError(502,'INVALID_RESPONSE');
  }),
  async logout(csrfToken:string|null){
    if(!csrfToken)throw new ApiError(403,'CSRF_UNAVAILABLE');
    const response=await fetch('/workbench/logout',{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','x-csrf-token':csrfToken}});
    if([401,403,404].includes(response.status))return rejectAuthorization(response);
    if(response.status!==200||!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
    const value=object(await response.json());if(Object.keys(value).length!==1||value.logged_out!==true)throw new UnknownCommandOutcome();
  },
  internalNoteReceipt:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016InternalNoteReceipt>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/internal-notes/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(id(v.ticket_id)!==ticketId||id(v.client_command_id)!==commandId)throw new ApiError(502,'INVALID_RESPONSE');
    const base={ticket_id:ticketId,client_command_id:commandId};
    if(v.state==='UNKNOWN'&&Object.keys(v).length===3)return {...base,state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===4){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4){const r=object(v.result);if(Object.keys(r).length!==6||r.ok!==true||id(r.ticket_id)!==ticketId||r.control_event_id!==null||r.replayed!==true)throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'COMMITTED',result:{ok:true,ticket_id:ticketId,ticket_version:version(r.ticket_version),ticket_event_id:id(r.ticket_event_id),control_event_id:null,replayed:true}};}
    throw new ApiError(502,'INVALID_RESPONSE');
  }),

  sourceGroups:(q:string,cursor:string|null,signal:AbortSignal)=>get('/api/workbench/source-groups?'+new URLSearchParams({limit:'50',q,...(cursor?{cursor}:{})}),signal,decodeGroupPage),
  bootstrap:(signal:AbortSignal)=>get('/api/lifecycle/bootstrap',signal,decodePrincipal),
  ticketCommandContext:(ticketId:string,signal:AbortSignal)=>get('/api/tickets/'+encodeURIComponent(ticketId),signal,value=>decodeTicketContext(value,ticketId)),
  addInternalNote:(ticketId:string,command:P2016InternalNoteCommand,csrfToken:string|null,signal:AbortSignal)=>postTicketCommand(ticketId,'internal-notes',command,csrfToken,signal,v=>decodeTicketReceipt(v,ticketId)),
  selfHandle:(ticketId:string,action:SelfHandlingAction,command:P2016SelfHandlingCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016SelfHandlingResult>=>postTicketCommand(ticketId,action,command,csrfToken,signal,v=>{
    const receipt=decodeTicketReceipt(v,ticketId),cycle=decodeCycle(v.handling_cycle);if(cycle.first_responsibility_event_id===null)throw new UnknownCommandOutcome();
    return {...receipt,handling_cycle:{...cycle,first_responsibility_event_id:cycle.first_responsibility_event_id}};
  }),
  board:(column:BoardColumn,range:CompletionRange,cursor:string|null,signal:AbortSignal)=>get('/api/workbench/board?'+new URLSearchParams({column,range,limit:'50',...(cursor?{cursor}:{})}),signal,decodePage),
  detail:(kind:string,id:string,cursor:string|null,signal:AbortSignal)=>get('/api/workbench/items/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id)+'?'+new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}),signal,value=>{
    const detail=decodeDetail(value);if(detail.item.kind!==kind||detail.item.id.toLowerCase()!==id.toLowerCase()){
      if(kind!=='review'||detail.requested_item?.kind!==kind||detail.requested_item.id.toLowerCase()!==id.toLowerCase())throw new ApiError(502,'INVALID_RESPONSE');
    }else if(detail.requested_item)throw new ApiError(502,'INVALID_RESPONSE');return detail;
  }),
  async saveGroupName(ref:string,command:SourceGroupNameCommand,csrfToken:string|null,signal:AbortSignal):Promise<SourceGroupNameResult> {
    try{
      const response=await fetch('/api/workbench/source-groups/'+encodeURIComponent(ref)+'/name',{
        method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',
        headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
      if([401,403,404].includes(response.status))return await rejectAuthorization(response);
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
      const v=object(await response.json());
      if(!response.ok){const code=text(object(v.error).code);if(!/^[A-Z][A-Z0-9_]{0,100}$/u.test(code))throw new UnknownCommandOutcome();if(response.status<500||code==='P2_016_DISABLED')throw new ApiError(response.status,code);throw new UnknownCommandOutcome();}
      if(v.ok!==true||typeof v.replayed!=='boolean')throw new UnknownCommandOutcome();
      const group=decodeGroup(v.group);
      if(group.ref!==ref||group.row_version!==String(BigInt(command.expected_row_version)+1n)||group.display_name!==command.display_name.trim()||group.name_source!=='ADMIN_CONFIRMED')throw new UnknownCommandOutcome();
      return {ok:true,group,replayed:v.replayed};
    }catch(error){if(error instanceof ApiError&&([401,403,404].includes(error.status)||error.code!=='INVALID_RESPONSE'))throw error;throw new UnknownCommandOutcome();}
  },
};
export const statusLabels:Record<string,string>={NEW:'待接单',QUEUED:'待接单',ACCEPTED:'已领取',REOPENED:'重新报障',PENDING:'待复核',RECEIVED:'已受理待建单',WAITING_DESCRIPTION:'待补充报修信息',WAITING_TRIAGE:'待判断',FAILED:'受理处理失败',IN_PROGRESS:'处理中',WAITING_REQUESTER:'等待补充',WAITING_VENDOR:'等待厂商',RESOLVED:'已解决待确认',CLOSED:'已关闭',CANCELLED:'已取消',DUPLICATE_LINKED:'已关联重复单'};
export const sourceLabels:Record<string,string>={WECOM_GROUP:'群聊报修',WECOM_DIRECT:'Bot 私聊',YIXIAOXIU_WEB:'医小修',WEB_REQUEST:'医小修'};
export function errorMessage(error:unknown):string {
  if(error instanceof ApiError){if(error.status===401)return '会话已失效，请重新进入已授权工作台。';if(error.status===403)return '当前身份没有操作权限。';if(error.status===404)return '事项不存在，或不在当前授权范围内。';if(error.status===409)return '资料已被其他人修改，请重新读取后再保存。';return '服务请求失败（'+error.status+'），请重试。';}
  return '连接失败，暂时无法读取服务端数据。';
}
