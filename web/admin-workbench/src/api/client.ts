import {decodeFollowAttention,decodeFollowReceipt,decodeFollowResult,matchesFollowResult} from '../../../../src/workbench-follow-browser-contracts.mjs';
import type {FollowItem,WorkbenchFollowAttention,WorkbenchFollowCommand,WorkbenchFollowResult,WorkbenchFollowReceipt} from '../../../../src/workbench-follow-browser-contracts.mjs';
import {decodeSupplementPage,decodeSupplementMaterial,decodeSupplementResult,decodeSupplementReceipt,decodeSupplementSummary} from '../features/supplement-follow-up/client';
import type {SupplementFollowUpCommand,SupplementFollowUpTarget,SupplementFollowUpPage,SupplementFollowUpResult,SupplementFollowUpReceipt,SupplementFollowUpSummary} from '../features/supplement-follow-up/client';
type WorkbenchCard=CoreWorkbenchCard&{attention?:WorkbenchFollowAttention;supplement_follow_up?:SupplementFollowUpSummary};
type BoardPage=Omit<CoreBoardPage,'items'>&{items:WorkbenchCard[]};
type WorkbenchDetail=Omit<CoreWorkbenchDetail,'item'>&{item:WorkbenchCard};
export type {WorkbenchFollowCommand,WorkbenchFollowResult,WorkbenchFollowReceipt};
import {decodeAssignmentHistory} from '../../../../src/workbench-assignment-history-browser-contracts.mjs';
import type {WaitingAction,WaitingCommand,WaitingResult,WaitingCapability,WaitingAcknowledgement} from '../../../../contracts/workbench_waiting_contracts';
import type {P2016TakeoverCompletionCommand,P2016TakeoverCompletionResult,P2016TakeoverCompletionTargets,P2016TakeoverCompletionAcknowledgement} from '../../../../contracts/p2_016_takeover_completion_contracts';
export type {P2016TakeoverCompletionCommand};
import type { BoardColumn, CompletionRange, BoardPage as CoreBoardPage, WorkbenchCard as CoreWorkbenchCard, WorkbenchDetail as CoreWorkbenchDetail, WorkbenchRecord,SourceGroupDisplay,SourceGroupPage,SourceGroupNameCommand,SourceGroupNameResult } from '../../../../contracts/web01_workbench_contracts';
import type {P2016InternalNoteCommand,P2016InternalNoteResult,P2016InternalNoteReceipt,P2016SelfHandlingCommand,P2016SelfHandlingResult,P2016HandlingCycle,P2016CompletionCommand,P2016CompletionResult,P2016CompletionReceipt,P2016ConversationHandlingCommand,P2016ConversationHandlingAction,P2016ConversationHandlingResult,P2016RelatedConversationPage,P2016ConversationHandlingAcknowledgement} from '../../../../contracts/p2_016_contracts';
import type {WorkbenchRealtimeCapability} from '../../../../contracts/workbench_realtime_contracts';
import type {P2016TicketNotification} from '../../../../contracts/p2_016_contracts';
import type {LocalDateTime,PhysicalEpochMs} from '../../../../contracts/time_contracts';
export type {P2016TicketNotification};
import type {P2016ReopenResult,P2016ReopenReceipt} from '../../../../contracts/p2_016_contracts';
import type {P2016TicketDetail} from '../../../../contracts/p2_016_contracts';
import type {P2016AssignmentAction,P2016AssignmentCommand,P2016AssignmentTargets,P2016AssignmentResult,P2016AssignmentAcknowledgement} from '../../../../contracts/p2_016_contracts';
import type {P2016UnassignCommand,P2016UnassignResult,P2016UnassignAcknowledgement,P2016UnassignTargets} from '../../../../contracts/workbench_unassign_contracts';
export type {P2016UnassignCommand,P2016UnassignResult,P2016UnassignAcknowledgement,P2016UnassignTargets};
import type {P2016ReturnToDispatchCommand,P2016ReturnToDispatchResult,P2016ReturnToDispatchAcknowledgement,P2016ReturnToDispatchTargets,P2016ReturnSession,P2016ReturnToDispatchCapability} from '../../../../contracts/workbench_return_to_dispatch_contracts';
export type {P2016AssignmentAction,P2016AssignmentCommand};
import type {P2016TakeoverAction,P2016TakeoverCommand,P2016TakeoverTargets,P2016TakeoverResult,P2016TakeoverAcknowledgement} from '../../../../contracts/p2_016_takeover_contracts';
export type {P2016TakeoverAction,P2016TakeoverCommand};
import type {ManualReportCapabilities} from '../../../../contracts/workbench_manual_report_contracts';
import type {ManualReportAdmissionCommand,ManualReportAdmissionResult,ManualReportAdmissionReceipt} from '../../../../src/workbench-manual-report-browser-contracts.mjs';
import type {WorkbenchReporterCandidates} from '../../../../contracts/workbench_reporter_candidates_contracts';
import {decodeVerifiedManualReportRejection,decodeReporterCandidates,decodeManualReportCapabilities,decodeManualReportReceipt,decodeManualReportResult} from '../../../../src/workbench-manual-report-browser-contracts.mjs';
import type {SharedFollowUpCommand,SharedFollowUpActive} from '../../../../contracts/workbench_follow_up_schedule_contracts';
import type {CanonicalItem,ReviewReference} from '../../../../contracts/workbench_review_contracts';
let authorizationEpoch=0,transportWritable=true;
export function setWorkbenchTransportWritable(value:boolean){transportWritable=value;}
export function workbenchTransportWritable(){return transportWritable;}
export function advanceWorkbenchAuthorizationEpoch(){authorizationEpoch++;}
function requireCurrentRead(epoch:number,signal:AbortSignal){signal.throwIfAborted();if(epoch!==authorizationEpoch)throw new DOMException('AUTHORIZATION_EPOCH_CHANGED','AbortError');}
export function captureWorkbenchRead(signal:AbortSignal):()=>void {const epoch=authorizationEpoch;return()=>requireCurrentRead(epoch,signal);}
export type {P2016InternalNoteCommand,P2016SelfHandlingCommand,P2016CompletionCommand,P2016ConversationHandlingCommand,P2016ConversationHandlingAction,P2016RelatedConversationPage};
export type SelfHandlingAction="take-and-start"|"accept-for-later";
export interface P2016ReopenCommand {client_command_id:string;expected_version:number;reason_code:'STAFF_REOPEN';note:string}
export interface TicketCommandContext {id:string;version:number;allowed_actions:string[];resolver_team_id:string;handling_cycle?:P2016HandlingCycle|null;reopen_follow_up?:NonNullable<P2016TicketDetail['reopen_follow_up']>}
export class UnknownCommandOutcome extends Error {constructor(){super('COMMAND_OUTCOME_UNKNOWN');}}
export type { BoardColumn, CompletionRange, BoardPage, WorkbenchCard, WorkbenchDetail };
export class ApiError extends Error { constructor(public status:number,public code:string){super(code);} }
export class ConfirmedManualReportRejection extends ApiError {constructor(status:number,code:string,readonly commandId:string){super(status,code);}}
function object(value: unknown): Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value as Record<string,unknown>;}
function text(value:unknown): string {if(typeof value!=='string')throw new ApiError(502,'INVALID_RESPONSE');return value;}
function nullable(value:unknown): string|null {return value===null?null:text(value);}
function strings(value:unknown):string[] {if(!Array.isArray(value))throw new ApiError(502,'INVALID_RESPONSE');return value.map(text);}
function datetime(value:unknown):string {const v=text(value);if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(v))throw new ApiError(502,'INVALID_RESPONSE');return v;}
export {notificationDatetime as decodeWorkbenchDateTime};
function notificationDatetime(value:unknown):LocalDateTime {
  const v=datetime(value),year=Number(v.slice(0,4)),month=Number(v.slice(5,7)),day=Number(v.slice(8,10));
  const hour=Number(v.slice(11,13)),minute=Number(v.slice(14,16)),second=Number(v.slice(17,19));
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const maximum=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1];
  if(year<1||month<1||month>12||day<1||maximum===undefined||day>maximum||hour>23||minute>59||second>59)throw new ApiError(502,'INVALID_RESPONSE');
  // The original second-precision format and Gregorian calendar/clock checks establish the opaque business-time brand.
  return v as LocalDateTime;
}
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
/** The same closed active value is consumed by authorized cards and the detail view. */
export function decodeSharedFollowUpActive(value:unknown):SharedFollowUpActive {
  const v=object(value),keys=['schedule_version','due_at','due_epoch_ms','is_due'];
  if(Object.keys(v).length!==keys.length||Object.keys(v).some(key=>!keys.includes(key)))throw new ApiError(502,'INVALID_RESPONSE');
  const revision=text(v.schedule_version),due=notificationDatetime(v.due_at),epoch=text(v.due_epoch_ms),expected=Date.parse(due.replace(' ','T')+'+08:00');
  if(!/^[1-9][0-9]{0,18}$/u.test(revision)||BigInt(revision)>9223372036854775807n||typeof v.is_due!=='boolean'
    ||!/^(0|[1-9][0-9]{0,18})$/u.test(epoch)||!Number.isSafeInteger(expected)||expected<0||BigInt(epoch)!==BigInt(expected)||BigInt(epoch)%1000n!==0n)throw new ApiError(502,'INVALID_RESPONSE');
  // Explicit Shanghai parsing, nonnegative integer equality and second precision establish the epoch brand.
  return {schedule_version:revision,due_at:due,due_epoch_ms:epoch as PhysicalEpochMs,is_due:v.is_due};
}
function decodeAttention(value:unknown):WorkbenchFollowAttention {
  try{return decodeFollowAttention(value);}catch{throw new ApiError(502,'INVALID_RESPONSE');}
}
function decodeCard(value:unknown):WorkbenchCard {
  const v=object(value);if(Object.hasOwn(v,'follow_up_schedule')&&v.kind!=='ticket')throw new ApiError(502,'INVALID_RESPONSE');if(!['ticket','review','intake'].includes(text(v.kind))||!['pending','active','closed'].includes(text(v.column)))throw new ApiError(502,'INVALID_RESPONSE');
  return {kind:v.kind as WorkbenchCard['kind'],id:id(v.id),intake_id:id(v.intake_id),column:v.column as BoardColumn,
    number:text(v.number),title:text(v.title),status:text(v.status),priority:nullable(v.priority),source:text(v.source),
    source_label:text(v.source_label),source_group:v.source_group===null?null:decodeGroup(v.source_group),
    ...(Object.hasOwn(v,'follow_up_schedule')?{follow_up_schedule:v.follow_up_schedule===null?null:decodeSharedFollowUpActive(v.follow_up_schedule)}:{}),
    ...(Object.hasOwn(v,'attention')?{attention:decodeAttention(v.attention)}:{}),
    ...(Object.hasOwn(v,'supplement_follow_up')?{supplement_follow_up:(()=>{if(v.kind!=='ticket')throw new ApiError(502,'INVALID_RESPONSE');try{return decodeSupplementSummary(v.supplement_follow_up);}catch{throw new ApiError(502,'INVALID_RESPONSE');}})()}:{}),
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
  const material=Object.hasOwn(v,'read_material')?object(v.read_material):null;
  if(material&&(v.audience!=='REPORT'||Object.keys(material).length!==2||typeof material.source_ref!=='string'||!/^(?:channel:[1-9][0-9]{0,18}|(?:web|manual):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.test(material.source_ref)||typeof material.revision!=='string'||!/^[1-9][0-9]{0,18}$/u.test(material.revision)||BigInt(material.revision)>9223372036854775807n))throw new ApiError(502,'INVALID_RESPONSE');
  return {id:text(v.id),at:datetime(v.at),type:text(v.type),text:nullable(v.text),audience:v.audience as WorkbenchRecord['audience'],actor:nullable(v.actor),old_status:nullable(v.old_status),new_status:nullable(v.new_status),...(material?{read_material:{source_ref:text(material.source_ref),revision:text(material.revision)}}:{})};
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
import type {WorkbenchActivityCapability} from '../../../../contracts/workbench_activity_contracts';
export interface Principal {workbench_reminders_enabled?:boolean;reminders_endpoint?:'/api/workbench/reminders'|null;manual_review_resolve_and_start_enabled?:boolean;board_actions_enabled?:boolean}
export interface Principal extends Partial<WorkbenchActivityCapability>,WorkbenchRealtimeCapability,P2016ReturnToDispatchCapability,WaitingCapability {supplement_follow_up_enabled?:boolean;supplement_follow_up_draft_recovery_enabled?:boolean;incident_delivery_control_enabled?:boolean;incident_delivery_control_draft_recovery_enabled?:boolean;workbench_follow_enabled?:boolean;workbench_follow_draft_recovery_enabled?:boolean;notification_exceptions_enabled?:boolean;assignment_history_enabled?:boolean;ticket_takeover_completion_enabled?:boolean;ticket_takeover_completion_draft_recovery_enabled?:boolean;ticket_takeover_enabled?:boolean;ticket_takeover_draft_recovery_enabled?:boolean;personal_read_enabled?:boolean;ticket_round_notifications_enabled:boolean;follow_up_schedules_enabled:boolean;follow_up_schedule_receipt_enabled:boolean;follow_up_schedule_draft_recovery_enabled?:boolean;ticket_reopen_draft_recovery_enabled?:boolean;ticket_reopen_rounds_enabled:boolean;ticket_unassign_enabled:boolean;ticket_unassign_draft_recovery_enabled:boolean;ticket_assignment_enabled:boolean;ticket_assignment_draft_recovery_enabled:boolean;manual_reports_enabled:boolean;reporter_candidates_enabled?:boolean;manual_report_draft_recovery_enabled:boolean;principal_id:string;display_name:string;roles:string[];csrf_token:string|null;source_group_directory_enabled:boolean;internal_notes_enabled:boolean;ticket_self_handling_enabled:boolean;ticket_conversation_self_handling_enabled:boolean;ticket_conversation_draft_recovery_enabled:boolean;ticket_staff_completion_enabled:boolean;draft_recovery_enabled:boolean;staff_completion_draft_recovery_enabled:boolean;manual_review_enabled:boolean;manual_review_draft_recovery_enabled:boolean;conversation_workspace_enabled:boolean;conversation_draft_recovery_enabled:boolean;incident_owner_transfer_enabled?:boolean;incident_owner_transfer_draft_recovery_enabled?:boolean;incident_public_progress_enabled?:boolean;incident_public_progress_draft_recovery_enabled?:boolean;incident_internal_notes_enabled?:boolean;incident_internal_note_draft_recovery_enabled?:boolean;incident_candidate_workspace_enabled:boolean;incident_candidate_draft_recovery_enabled:boolean;logout_enabled:boolean}
function optionalFlag(value:unknown):boolean{if(value===undefined)return false;if(typeof value!=='boolean')throw new ApiError(502,'INVALID_RESPONSE');return value;} function decodePrincipal(value:unknown):Principal {
  const v=object(value),waitingEnabled=optionalFlag(v.ticket_waiting_actions_enabled),waitingRecovery=optionalFlag(v.ticket_waiting_action_draft_recovery_enabled),returnEnabled=optionalFlag(v.ticket_return_to_dispatch_enabled),returnRecovery=optionalFlag(v.ticket_return_to_dispatch_draft_recovery_enabled),unassign=optionalFlag(v.ticket_unassign_enabled),unassignRecovery=optionalFlag(v.ticket_unassign_draft_recovery_enabled),interval=v.polling_interval_ms,expires=text(v.expires_epoch_ms),revision=nullable(v.authorization_revision),manual=optionalFlag(v.manual_review_enabled),recovery=optionalFlag(v.manual_review_draft_recovery_enabled),manualReports=optionalFlag(v.manual_reports_enabled),reporterCandidates=optionalFlag(v.reporter_candidates_enabled),manualReportRecovery=optionalFlag(v.manual_report_draft_recovery_enabled),followUp=optionalFlag(v.follow_up_schedules_enabled),followUpRecovery=optionalFlag(v.follow_up_schedule_draft_recovery_enabled);
  if(typeof v.source_group_directory_enabled!=='boolean'||typeof v.internal_notes_enabled!=='boolean'||typeof v.ticket_self_handling_enabled!=='boolean'||typeof v.ticket_conversation_self_handling_enabled!=='boolean'||typeof v.ticket_conversation_draft_recovery_enabled!=='boolean'||typeof v.ticket_staff_completion_enabled!=='boolean'||typeof v.draft_recovery_enabled!=='boolean'||typeof v.staff_completion_draft_recovery_enabled!=='boolean'||typeof v.conversation_workspace_enabled!=='boolean'||typeof v.conversation_draft_recovery_enabled!=='boolean'||typeof v.incident_candidate_workspace_enabled!=='boolean'||typeof v.incident_candidate_draft_recovery_enabled!=='boolean'||typeof v.logout_enabled!=='boolean'
    ||(followUpRecovery&&!followUp)||(unassignRecovery&&!unassign)||(recovery&&!manual)||(reporterCandidates&&!manualReports)||(manualReportRecovery&&!manualReports)||typeof v.realtime_sse_enabled!=='boolean'||typeof v.realtime_sse_available!=='boolean'||typeof interval!=='number'||!Number.isInteger(interval)||interval<1000||interval>300000
    ||!/^(0|[1-9][0-9]{0,18})$/u.test(expires)||BigInt(expires)>9223372036854775807n||v.sse_endpoint!==(v.realtime_sse_enabled?'/api/realtime/events?scope=workbench':null)
    ||(v.realtime_sse_enabled?(revision===null||!/^[a-f0-9]{64}$/u.test(revision)):(revision!==null||v.realtime_sse_available)))throw new ApiError(502,'INVALID_RESPONSE');
  if(optionalFlag(v.incident_delivery_control_draft_recovery_enabled)&&!optionalFlag(v.incident_delivery_control_enabled))throw new ApiError(502,'INVALID_RESPONSE');
  if(optionalFlag(v.incident_public_progress_draft_recovery_enabled)&&!optionalFlag(v.incident_public_progress_enabled))throw new ApiError(502,'INVALID_RESPONSE');
  if(optionalFlag(v.incident_internal_note_draft_recovery_enabled)&&!optionalFlag(v.incident_internal_notes_enabled))throw new ApiError(502,'INVALID_RESPONSE');
  if(optionalFlag(v.incident_owner_transfer_draft_recovery_enabled)&&!optionalFlag(v.incident_owner_transfer_enabled))throw new ApiError(502,'INVALID_RESPONSE');
  if(returnRecovery&&!returnEnabled||waitingRecovery&&!waitingEnabled)throw new ApiError(502,'INVALID_RESPONSE');
  const follow=optionalFlag(v.workbench_follow_enabled),followRecovery=optionalFlag(v.workbench_follow_draft_recovery_enabled);
  if(followRecovery&&!follow)throw new ApiError(502,'INVALID_RESPONSE');
  const reminders=optionalFlag(v.workbench_reminders_enabled);
  if(reminders?v.reminders_endpoint!=='/api/workbench/reminders':v.reminders_endpoint!==undefined&&v.reminders_endpoint!==null)throw new ApiError(502,'INVALID_RESPONSE');
  const supplement=optionalFlag(v.supplement_follow_up_enabled),supplementRecovery=optionalFlag(v.supplement_follow_up_draft_recovery_enabled);
  if(supplementRecovery&&!supplement)throw new ApiError(502,'INVALID_RESPONSE');
  let activity:Partial<WorkbenchActivityCapability>={};
  if(v.activity_enabled!==undefined){
    if(typeof v.activity_enabled!=='boolean'||v.activity_enabled&&!v.realtime_sse_enabled)throw new ApiError(502,'INVALID_RESPONSE');
    const limits=object(v.activity_limits),expected={lease_ttl_ms:15000,heartbeat_ms:5000,viewing_idle_ms:60000,editing_idle_ms:10000,max_objects_per_browser:2,max_browsers_per_principal:4,max_browsers:64,max_leases:128,max_leases_per_object:16} as const;
    if(Object.keys(limits).length!==Object.keys(expected).length||Object.entries(expected).some(([key,value])=>limits[key]!==value))throw new ApiError(502,'INVALID_RESPONSE');
    activity={activity_enabled:v.activity_enabled,activity_limits:expected};
  }
  return {...activity,board_actions_enabled:optionalFlag(v.board_actions_enabled),workbench_reminders_enabled:reminders,reminders_endpoint:reminders?'/api/workbench/reminders':null,supplement_follow_up_enabled:supplement,supplement_follow_up_draft_recovery_enabled:supplementRecovery,incident_delivery_control_enabled:optionalFlag(v.incident_delivery_control_enabled),incident_delivery_control_draft_recovery_enabled:optionalFlag(v.incident_delivery_control_draft_recovery_enabled),workbench_follow_enabled:follow,workbench_follow_draft_recovery_enabled:followRecovery,notification_exceptions_enabled:optionalFlag(v.notification_exceptions_enabled),incident_owner_transfer_enabled:optionalFlag(v.incident_owner_transfer_enabled),incident_owner_transfer_draft_recovery_enabled:optionalFlag(v.incident_owner_transfer_draft_recovery_enabled),incident_public_progress_enabled:optionalFlag(v.incident_public_progress_enabled),incident_public_progress_draft_recovery_enabled:optionalFlag(v.incident_public_progress_draft_recovery_enabled),incident_internal_notes_enabled:optionalFlag(v.incident_internal_notes_enabled),incident_internal_note_draft_recovery_enabled:optionalFlag(v.incident_internal_note_draft_recovery_enabled),assignment_history_enabled:optionalFlag(v.assignment_history_enabled),ticket_waiting_actions_enabled:waitingEnabled,ticket_waiting_action_draft_recovery_enabled:waitingRecovery,ticket_return_to_dispatch_enabled:returnEnabled,ticket_return_to_dispatch_draft_recovery_enabled:returnRecovery,personal_read_enabled:optionalFlag(v.personal_read_enabled),principal_id:id(v.principal_id),display_name:text(v.display_name),roles:strings(v.roles),ticket_round_notifications_enabled:optionalFlag(v.ticket_round_notifications_enabled),follow_up_schedules_enabled:followUp,follow_up_schedule_receipt_enabled:optionalFlag(v.follow_up_schedule_receipt_enabled),follow_up_schedule_draft_recovery_enabled:followUpRecovery,ticket_reopen_rounds_enabled:optionalFlag(v.ticket_reopen_rounds_enabled),ticket_reopen_draft_recovery_enabled:optionalFlag(v.ticket_reopen_draft_recovery_enabled),ticket_unassign_enabled:unassign,ticket_unassign_draft_recovery_enabled:unassignRecovery,ticket_takeover_completion_enabled:optionalFlag(v.ticket_takeover_completion_enabled),ticket_takeover_completion_draft_recovery_enabled:optionalFlag(v.ticket_takeover_completion_draft_recovery_enabled),ticket_takeover_enabled:optionalFlag(v.ticket_takeover_enabled),ticket_takeover_draft_recovery_enabled:optionalFlag(v.ticket_takeover_draft_recovery_enabled),ticket_assignment_enabled:optionalFlag(v.ticket_assignment_enabled),ticket_assignment_draft_recovery_enabled:optionalFlag(v.ticket_assignment_draft_recovery_enabled),csrf_token:nullable(v.csrf_token),source_group_directory_enabled:v.source_group_directory_enabled,internal_notes_enabled:v.internal_notes_enabled,ticket_self_handling_enabled:v.ticket_self_handling_enabled,ticket_conversation_self_handling_enabled:v.ticket_conversation_self_handling_enabled,ticket_conversation_draft_recovery_enabled:v.ticket_conversation_draft_recovery_enabled,ticket_staff_completion_enabled:v.ticket_staff_completion_enabled,draft_recovery_enabled:v.draft_recovery_enabled,staff_completion_draft_recovery_enabled:v.staff_completion_draft_recovery_enabled,manual_review_resolve_and_start_enabled:optionalFlag(v.manual_review_resolve_and_start_enabled),manual_review_enabled:manual,manual_review_draft_recovery_enabled:recovery,manual_reports_enabled:manualReports,reporter_candidates_enabled:reporterCandidates,manual_report_draft_recovery_enabled:manualReportRecovery,conversation_workspace_enabled:v.conversation_workspace_enabled,conversation_draft_recovery_enabled:v.conversation_draft_recovery_enabled,incident_candidate_workspace_enabled:v.incident_candidate_workspace_enabled,incident_candidate_draft_recovery_enabled:v.incident_candidate_draft_recovery_enabled,logout_enabled:v.logout_enabled,
    realtime_sse_enabled:v.realtime_sse_enabled,realtime_sse_available:v.realtime_sse_available,sse_endpoint:v.realtime_sse_enabled?'/api/realtime/events?scope=workbench':null,polling_interval_ms:interval,expires_epoch_ms:expires,authorization_revision:revision};
}
function version(value:unknown):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>2147483647)throw new ApiError(502,'INVALID_RESPONSE');return value;}
function decodeTicketContext(value:unknown,ticketId:string):TicketCommandContext {
  const v=object(value),actions=strings(v.allowed_actions),ticket=id(v.id);
  if(ticket!==ticketId||actions.length>32||new Set(actions).size!==actions.length||actions.some(action=>! /^[a-z][a-z-]{0,63}$/u.test(action)))throw new ApiError(502,'INVALID_RESPONSE');
  const team=text(v.resolver_team_id);if(!/^[A-Z][A-Z0-9_]{0,63}$/u.test(team))throw new ApiError(502,'INVALID_RESPONSE');
  if(actions.some(action=>['take-and-start','accept-for-later','take-and-start-with-conversations','accept-for-later-with-conversations','complete','return-to-dispatch'].includes(action))&&!Object.hasOwn(v,'handling_cycle'))throw new ApiError(502,'INVALID_RESPONSE');
  let followUp:NonNullable<P2016TicketDetail['reopen_follow_up']>|undefined;
  if(Object.hasOwn(v,'reopen_follow_up')){const f=object(v.reopen_follow_up);if(Object.keys(f).length!==3||f.origin!=='WEB_REPORTER'&&f.origin!=='BOT_REPORTER'&&f.origin!=='STAFF'||typeof f.is_previous_handler!=='boolean'||f.awaiting_acceptance!==true)throw new ApiError(502,'INVALID_RESPONSE');followUp={origin:f.origin,is_previous_handler:f.is_previous_handler,awaiting_acceptance:true};}
  return {id:ticket,version:version(v.version),allowed_actions:actions,resolver_team_id:team,...(Object.hasOwn(v,'handling_cycle')?{handling_cycle:v.handling_cycle===null?null:decodeCycle(v.handling_cycle)}:{}),...(followUp?{reopen_follow_up:followUp}:{})};
}
function decodeTicketNotifications(value:unknown):{items:P2016TicketNotification[]} {
  const page=object(value);
  if(Object.keys(page).length!==1||!Array.isArray(page.items)||page.items.length>100)throw new ApiError(502,'INVALID_RESPONSE');
  const items=page.items.map(value=>{
    const row=object(value),hasNode=Object.hasOwn(row,'node'),hasCycle=Object.hasOwn(row,'cycle_no'),hasRoute=Object.hasOwn(row,'route_kind');
    const keys=['notification_type','destination_type','delivery_id','status','side_effect_state','attempt_count','sent_at','created_at',...(hasNode?['node','cycle_no']:[]),...(hasRoute?['route_kind']:[])];
    if(hasNode!==hasCycle||Object.keys(row).length!==keys.length||Object.keys(row).some(key=>!keys.includes(key))
      ||!['TICKET_CREATED','TICKET_ACCEPTED','TICKET_IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','TICKET_RESOLVED','TICKET_CLOSED','TICKET_REOPENED','TICKET_CANCELLED'].includes(text(row.notification_type))
      ||!['PERSON','GROUP'].includes(text(row.destination_type))||!['PENDING','LEASED','SENDING','SENT','DEAD_LETTER','RECONCILIATION_REQUIRED','CANCELLED'].includes(text(row.status))
      ||!['NOT_ATTEMPTED','ACKNOWLEDGED','UNKNOWN'].includes(text(row.side_effect_state))
      ||hasRoute&&(row.route_kind!=='YIXIAOXIU_APP'||row.destination_type!=='PERSON')
      ||typeof row.attempt_count!=='number'||!Number.isInteger(row.attempt_count)||row.attempt_count<0||row.attempt_count>2147483647)throw new ApiError(502,'INVALID_RESPONSE');
    let round:Pick<P2016TicketNotification,'node'|'cycle_no'>={};
    if(hasNode){
      const node=row.node;
      if(node===null){if(row.cycle_no!==null)throw new ApiError(502,'INVALID_RESPONSE');round={node:null,cycle_no:null};}
      else {if(node!=='FIRST_RESPONSIBILITY'&&node!=='STAFF_COMPLETED')throw new ApiError(502,'INVALID_RESPONSE');round={node,cycle_no:version(row.cycle_no)};}
    }
    return {...round,...(hasRoute?{route_kind:'YIXIAOXIU_APP' as const}:{}),notification_type:row.notification_type as P2016TicketNotification['notification_type'],
      destination_type:row.destination_type as P2016TicketNotification['destination_type'],delivery_id:id(row.delivery_id),
      status:row.status as P2016TicketNotification['status'],side_effect_state:row.side_effect_state as P2016TicketNotification['side_effect_state'],
      attempt_count:row.attempt_count,sent_at:row.sent_at===null?null:notificationDatetime(row.sent_at),created_at:notificationDatetime(row.created_at)};
  });
  if(new Set(items.map(item=>item.delivery_id.toLowerCase())).size!==items.length)throw new ApiError(502,'INVALID_RESPONSE');
  return {items};
}
export async function rejectAuthorization(response:Response):Promise<never>{
  let code='AUTHORIZATION_REJECTED';
  try {const value:unknown=await response.json(),candidate=text(object(object(value).error).code);if(/^[A-Z][A-Z0-9_]{0,100}$/u.test(candidate))code=candidate;}
  catch { /* The HTTP rejection remains authoritative when its error detail is unreadable. */ }
  throw new ApiError(response.status,code);
}
async function get<T>(path:string,signal:AbortSignal,decode:(value:unknown,response:Response)=>T):Promise<T> {
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
  return decode(value,response);
  }catch(error){requireCurrentRead(epoch,signal);throw error;}
}
export {get as readWorkbench};
function decodeCycle(value:unknown):P2016HandlingCycle {const v=object(value);return {id:id(v.id),cycle_no:version(v.cycle_no),first_responsibility_event_id:v.first_responsibility_event_id===null?null:id(v.first_responsibility_event_id),...(Object.hasOwn(v,'staff_completion_event_id')?{staff_completion_event_id:v.staff_completion_event_id===null?null:id(v.staff_completion_event_id)}:{})};}
function decodeTicketReceipt(v:Record<string,unknown>,ticketId:string):P2016InternalNoteResult {return {ok:true,ticket_id:ticketId,ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id),control_event_id:null,replayed:v.replayed as boolean};}
function decodeCompletion(value:unknown,ticketId:string):P2016CompletionResult {
  const v=object(value),c=object(v.completion),event=id(v.ticket_event_id);
  if(Object.keys(v).length!==7||v.ok!==true||id(v.ticket_id)!==ticketId||typeof v.replayed!=='boolean'||v.control_event_id!==null||Object.keys(c).length!==4||id(c.event_id)!==event||c.basis!=='STAFF_COMPLETED')throw new ApiError(502,'INVALID_RESPONSE');
  return {...decodeTicketReceipt(v,ticketId),completion:{cycle_id:id(c.cycle_id),cycle_no:version(c.cycle_no),event_id:event,basis:'STAFF_COMPLETED'}};
}
function decodeReopen(value:unknown,ticketId:string):P2016ReopenResult {
  const v=object(value),c=object(v.handling_cycle);
  if(Object.keys(v).length!==7||v.ok!==true||id(v.ticket_id)!==ticketId||typeof v.replayed!=='boolean'||v.control_event_id!==null
    ||Object.keys(c).length!==4||version(c.cycle_no)<2||c.first_responsibility_event_id!==null||c.staff_completion_event_id!==null)throw new ApiError(502,'INVALID_RESPONSE');
  return {...decodeTicketReceipt(v,ticketId),handling_cycle:{id:id(c.id),cycle_no:version(c.cycle_no),first_responsibility_event_id:null,staff_completion_event_id:null}};
}
export async function postTicketCommand<T>(ticketId:string,action:string,command:P2016InternalNoteCommand|P2016SelfHandlingCommand|P2016CompletionCommand|P2016ConversationHandlingCommand|P2016AssignmentCommand|P2016TakeoverCommand|P2016UnassignCommand|P2016ReopenCommand|P2016ReturnToDispatchCommand|P2016TakeoverCompletionCommand|SharedFollowUpCommand,csrfToken:string|null,signal:AbortSignal,decode:(value:Record<string,unknown>)=>T):Promise<T> {
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
        if(response.status<500||(v.ok===false&&typeof v.replayed==='boolean'&&object(v.error).retryable===false)||['P2_016_DISABLED','P2_016_SELF_HANDLING_UNAVAILABLE','P2_016_STAFF_COMPLETION_UNAVAILABLE'].includes(code)||(action==='unassign'&&code==='P2_016_UNASSIGN_UNAVAILABLE')||(action==='follow-up-schedule'&&code==='P2_016_FOLLOW_UP_UNAVAILABLE')||(action==='return-to-dispatch'&&code==='P2_016_RETURN_TO_DISPATCH_UNAVAILABLE'))throw new ApiError(response.status,code);
        throw new UnknownCommandOutcome();
      }
      if(v.ok!==true||id(v.ticket_id)!==ticketId||typeof v.replayed!=='boolean'||v.control_event_id!==null)throw new UnknownCommandOutcome();
      return decode(v);
    }catch(error){if(error instanceof ApiError&&([401,403,404].includes(error.status)||error.code!=='INVALID_RESPONSE'))throw error;throw new UnknownCommandOutcome();}

}
async function postFollow(requested:FollowItem,command:WorkbenchFollowCommand,csrfToken:string|null,signal:AbortSignal):Promise<WorkbenchFollowResult>{
  const current=captureWorkbenchRead(signal);
  try{
    const response=await fetch('/api/workbench/items/'+encodeURIComponent(requested.kind)+'/'+encodeURIComponent(requested.id)+'/follow',{
      method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',
      headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_follow_version+'"',...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
    current();
    if([401,403,404].includes(response.status))return await rejectAuthorization(response);
    if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
    const value:unknown=await response.json();current();
    if(!response.ok){
      const code=text(object(object(value).error).code);
      if(response.status<500&&/^[A-Z][A-Z0-9_]{0,127}$/u.test(code))throw new ApiError(response.status,code);
      throw new UnknownCommandOutcome();
    }
    if(response.status!==200)throw new UnknownCommandOutcome();
    const result=decodeFollowResult(value);if(!matchesFollowResult(command,result,requested))throw new UnknownCommandOutcome();return result;
  }catch(error){current();if(error instanceof ApiError&&error.code!=='INVALID_RESPONSE')throw error;throw new UnknownCommandOutcome();}
}
export const api={
  supplementFollowUpMaterial:(ticketId:string,target:SupplementFollowUpTarget,signal:AbortSignal)=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/supplement-follow-up/material?'+new URLSearchParams({source_ref:target.source_ref,revision:target.revision}),signal,value=>{try{return decodeSupplementMaterial(value,ticketId,target);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  supplementFollowUpPage:(ticketId:string,cursor:string|null,signal:AbortSignal):Promise<SupplementFollowUpPage>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/supplement-follow-up?'+new URLSearchParams({limit:'50',...(cursor?{cursor}:{})}),signal,value=>{try{return decodeSupplementPage(value,ticketId);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  supplementFollowUpReceipt:(ticketId:string,commandId:string,signal:AbortSignal):Promise<SupplementFollowUpReceipt>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/supplement-follow-up/commands/'+encodeURIComponent(commandId),signal,value=>{try{return decodeSupplementReceipt(value,ticketId,commandId);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  recordSupplementDisposition:async(ticketId:string,command:SupplementFollowUpCommand,csrfToken:string|null,signal:AbortSignal):Promise<SupplementFollowUpResult>=>{
    const current=captureWorkbenchRead(signal);
    try{
      const response=await fetch('/api/tickets/'+encodeURIComponent(ticketId)+'/supplement-follow-up',{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
      current();if([401,403,404].includes(response.status))return await rejectAuthorization(response);
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
      const value:unknown=await response.json();current();
      if(!response.ok){const code=text(object(object(value).error).code);if(/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code)&&(response.status<500||code==='P2_016_DISABLED'))throw new ApiError(response.status,code);throw new UnknownCommandOutcome();}
      if(response.status!==200)throw new UnknownCommandOutcome();return decodeSupplementResult(value,ticketId,command.client_command_id,command);
    }catch(error){current();if(error instanceof ApiError&&error.code!=='INVALID_RESPONSE')throw error;throw new UnknownCommandOutcome();}
  },
  follow:postFollow,
  followReceipt:(requested:FollowItem,commandId:string,signal:AbortSignal):Promise<WorkbenchFollowReceipt>=>get('/api/workbench/items/'+encodeURIComponent(requested.kind)+'/'+encodeURIComponent(requested.id)+'/follow/commands/'+encodeURIComponent(commandId),signal,value=>{
    try{return decodeFollowReceipt(value,requested,commandId);}catch{throw new ApiError(502,'INVALID_RESPONSE');}
  }),
  takeoverCompletionTargets:(ticketId:string,team:string|null,signal:AbortSignal):Promise<P2016TakeoverCompletionTargets>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/takeover-completion-targets'+(team===null?'':'?'+new URLSearchParams({resolver_team_id:team})),signal,value=>{
    const v=object(value),actions=strings(v.allowed_actions);if(Object.keys(v).length!==3||!Array.isArray(v.resolver_teams)||v.resolver_teams.length>100||v.resolver_team_id!==team||actions.length>1||actions.some(action=>action!=='takeover-and-complete'))throw new ApiError(502,'INVALID_RESPONSE');
    const resolver_teams=v.resolver_teams.map(value=>{const row=object(value),team_id=text(row.team_id),display_name=text(row.display_name);if(Object.keys(row).length!==2||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(team_id)||!display_name||display_name.length>128)throw new ApiError(502,'INVALID_RESPONSE');return {team_id,display_name};});if(new Set(resolver_teams.map(row=>row.team_id)).size!==resolver_teams.length||team!==null&&!resolver_teams.some(row=>row.team_id===team))throw new ApiError(502,'INVALID_RESPONSE');
    return {resolver_teams,resolver_team_id:team,allowed_actions:actions.map(()=> 'takeover-and-complete' as const)};
  }),
  takeoverCompletionAcknowledgement:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016TakeoverCompletionAcknowledgement>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/takeover-completion/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===2){const error=object(v.error),code=text(error.code);if(Object.keys(error).length===2&&error.retryable===false&&/^[A-Z][A-Z0-9_]{0,63}$/u.test(code))return {state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===5&&v.ticket_id===ticketId){const event=id(v.ticket_event_id),c=object(v.completion);if(Object.keys(c).length===4&&id(c.event_id)===event&&c.basis==='STAFF_COMPLETED')return {state:'COMMITTED',ticket_id:ticketId,ticket_version:version(v.ticket_version),ticket_event_id:event,completion:{cycle_id:id(c.cycle_id),cycle_no:version(c.cycle_no),event_id:event,basis:'STAFF_COMPLETED'}};}
    throw new ApiError(502,'INVALID_RESPONSE');
  }),
  takeoverCompletionTicket:async(ticketId:string,command:P2016TakeoverCompletionCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016TakeoverCompletionResult>=>{
    const requireCurrent=captureWorkbenchRead(signal);try{const result=await postTicketCommand(ticketId,'takeover-and-complete',command,csrfToken,signal,v=>{
      const keys=['ok','ticket_id','ticket_version','ticket_event_id','control_event_id','replayed','completion','communication_choice','conversations'];
      if(Object.keys(v).length!==keys.length||Object.keys(v).some(key=>!keys.includes(key))||v.communication_choice!==command.communication_choice||!Array.isArray(v.conversations)||v.conversations.length!==command.sessions.length)throw new UnknownCommandOutcome();
      const completed=decodeCompletion({ok:v.ok,ticket_id:v.ticket_id,ticket_version:v.ticket_version,ticket_event_id:v.ticket_event_id,control_event_id:v.control_event_id,replayed:v.replayed,completion:v.completion},ticketId);
      if(completed.completion.cycle_id!==command.handling_cycle_id||![command.expected_version+2,command.expected_version+3].includes(completed.ticket_version))throw new UnknownCommandOutcome();
      const conversations=v.conversations.map(value=>{const row=object(value),session_id=id(row.session_id),selected=command.sessions.find(item=>item.session_id===session_id);if(Object.keys(row).length!==4||!selected||typeof row.changed!=='boolean'||version(row.session_row_version)!==selected.expected_row_version+(row.changed?1:0)||row.changed&&row.control_event_id===null||!row.changed&&row.control_event_id!==null)throw new UnknownCommandOutcome();return {session_id,session_row_version:version(row.session_row_version),changed:row.changed,control_event_id:row.control_event_id===null?null:id(row.control_event_id)};});
      if(new Set(conversations.map(row=>row.session_id)).size!==conversations.length)throw new UnknownCommandOutcome();return {...completed,communication_choice:command.communication_choice,conversations};
    });requireCurrent();return result;}catch(error){requireCurrent();throw error;}
  },
  waitingAction:(ticketId:string,action:WaitingAction,command:WaitingCommand,csrfToken:string|null,signal:AbortSignal):Promise<WaitingResult>=>postTicketCommand(ticketId,action,command,csrfToken,signal,v=>{
    if(Object.keys(v).length!==7||!Object.hasOwn(v,'handling_cycle_id'))throw new UnknownCommandOutcome();
    return {...decodeTicketReceipt(v,ticketId),handling_cycle_id:v.handling_cycle_id===null?null:id(v.handling_cycle_id)};
  }),
  waitingAcknowledgement:(ticketId:string,action:WaitingAction,commandId:string,signal:AbortSignal):Promise<WaitingAcknowledgement>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/'+action+'/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);
    if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN'};
    if(v.state==='COMMITTED'&&Object.keys(v).length===4&&v.ticket_id===ticketId)return {state:'COMMITTED',ticket_id:ticketId,ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id)};
    if(v.state==='FAILED'&&Object.keys(v).length===2){const error=object(v.error),code=text(error.code);if(Object.keys(error).length===2&&error.retryable===false&&/^(P2_016|TICKET)_[A-Z][A-Z0-9_]{0,80}$/u.test(code))return {state:'FAILED',error:{code,retryable:false}};}
    throw new ApiError(502,'INVALID_RESPONSE');
  }),
  // Existing canonical Session READ endpoints only; an absent member in a truncated list is not revocation evidence.
  returnCommunicationTargets:async(ticketId:string,_target:string|null,sessions:readonly P2016ReturnSession[],signal:AbortSignal):Promise<P2016ReturnToDispatchTargets>=>{
    id(ticketId);if(sessions.length>8||new Set(sessions.map(row=>id(row.session_id).toLowerCase())).size!==sessions.length)throw new ApiError(400,'INVALID_INPUT');
    if(!sessions.length)return {items:[]};
    type EligibleTarget=P2016ReturnToDispatchTargets['items'][number];
    let intersection=new Map<string,EligibleTarget>(),firstPage=true;
    for(const selected of [...sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id))){
      const page=await get('/api/conversations/'+encodeURIComponent(id(selected.session_id))+'/eligible-principals',signal,value=>{
        const v=object(value);if(Object.keys(v).length!==1||!Array.isArray(v.items)||v.items.length>100)throw new ApiError(502,'INVALID_RESPONSE');
        const items=v.items.map(value=>{const row=object(value),principal_id=id(row.principal_id),display_name=text(row.display_name),actions=strings(row.actions);if(Object.keys(row).length!==3||!display_name||actions.some(action=>!['TRANSFER_TARGET','FORCE_TRANSFER_TARGET'].includes(action)))throw new ApiError(502,'INVALID_RESPONSE');return {principal_id,display_name,actions};});
        if(new Set(items.map(row=>row.principal_id.toLowerCase())).size!==items.length)throw new ApiError(502,'INVALID_RESPONSE');return items;
      });
      const allowed=new Map<string,EligibleTarget>(page.filter(row=>row.actions.includes('TRANSFER_TARGET')).map(row=>[row.principal_id.toLowerCase(),{principal_id:row.principal_id,display_name:row.display_name}]));
      if(firstPage){intersection=allowed;firstPage=false;}
      else for(const principal of intersection.keys())if(!allowed.has(principal))intersection.delete(principal);
    }
    return {items:[...intersection.values()].sort((a,b)=>a.display_name.localeCompare(b.display_name)||a.principal_id.localeCompare(b.principal_id))};
  },
  returnAcknowledgement:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016ReturnToDispatchAcknowledgement>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/return-to-dispatch/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===2){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||!/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4&&id(v.ticket_id).toLowerCase()===ticketId.toLowerCase())return {state:'COMMITTED',ticket_id:id(v.ticket_id),ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id)};
    throw new ApiError(502,'INVALID_RESPONSE');
  }),
  returnTicket:async(ticketId:string,command:P2016ReturnToDispatchCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016ReturnToDispatchResult>=>{
    const requireCurrent=captureWorkbenchRead(signal);requireCurrent();
    try{
      const result=await postTicketCommand(ticketId,'return-to-dispatch',command,csrfToken,signal,v=>{
        if(Object.keys(v).length!==9||version(v.ticket_version)!==command.expected_version+1||v.communication_choice!==command.communication_choice||!Array.isArray(v.conversations)||v.conversations.length!==command.sessions.length)throw new UnknownCommandOutcome();
        const originals=new Map(command.sessions.map(row=>[row.session_id.toLowerCase(),row]));
        const conversations=v.conversations.map(value=>{const row=object(value),session=id(row.session_id),original=originals.get(session.toLowerCase());
          if(Object.keys(row).length!==4||!original||typeof row.changed!=='boolean'||version(row.session_row_version)!==original.expected_row_version+(row.changed?1:0)||(row.changed?typeof row.control_event_id!=='string':row.control_event_id!==null))throw new UnknownCommandOutcome();
          return {session_id:session,session_row_version:version(row.session_row_version),control_event_id:row.control_event_id===null?null:id(row.control_event_id),changed:row.changed};});
        if(new Set(conversations.map(row=>row.session_id.toLowerCase())).size!==conversations.length)throw new UnknownCommandOutcome();
        let handling_cycle:P2016ReturnToDispatchResult['handling_cycle']=null;
        if(v.handling_cycle!==null){const cycle=object(v.handling_cycle);if(Object.keys(cycle).length!==3)throw new UnknownCommandOutcome();handling_cycle={id:id(cycle.id),cycle_no:version(cycle.cycle_no),first_responsibility_event_id:id(cycle.first_responsibility_event_id)};}
        return {...decodeTicketReceipt(v,ticketId),handling_cycle,communication_choice:command.communication_choice,conversations};
      });requireCurrent();return result;
    }catch(error){requireCurrent();throw error;}
  },

  takeoverTargets:(ticketId:string,team:string|null,signal:AbortSignal):Promise<P2016TakeoverTargets>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/takeover-targets'+(team===null?'':'?'+new URLSearchParams({resolver_team_id:team})),signal,value=>{
    const v=object(value),actions=strings(v.allowed_actions);if(Object.keys(v).length!==3||!Array.isArray(v.resolver_teams)||v.resolver_teams.length>100||v.resolver_team_id!==team||actions.length>2||new Set(actions).size!==actions.length||actions.some(action=>action!=='takeover'&&action!=='takeover-and-start'))throw new ApiError(502,'INVALID_RESPONSE');
    const resolver_teams=v.resolver_teams.map(value=>{const row=object(value),team_id=text(row.team_id),display_name=text(row.display_name);if(Object.keys(row).length!==2||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(team_id)||!display_name||display_name.length>128)throw new ApiError(502,'INVALID_RESPONSE');return {team_id,display_name};});if(new Set(resolver_teams.map(row=>row.team_id)).size!==resolver_teams.length||team!==null&&!resolver_teams.some(row=>row.team_id===team))throw new ApiError(502,'INVALID_RESPONSE');
    return {resolver_teams,resolver_team_id:team,allowed_actions:actions.map(action=>{if(action==='takeover'||action==='takeover-and-start')return action;throw new ApiError(502,'INVALID_RESPONSE');})};
  }),
  takeoverAcknowledgement:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016TakeoverAcknowledgement>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/takeover/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===2){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||!/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4&&id(v.ticket_id).toLowerCase()===ticketId.toLowerCase())return {state:'COMMITTED',ticket_id:id(v.ticket_id),ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id)};throw new ApiError(502,'INVALID_RESPONSE');
  }),
  takeoverTicket:async(ticketId:string,action:P2016TakeoverAction,command:P2016TakeoverCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016TakeoverResult>=>{
    const requireCurrent=captureWorkbenchRead(signal);requireCurrent();
    try{const result=await postTicketCommand(ticketId,action,command,csrfToken,signal,v=>{
      const keys=['ok','ticket_id','ticket_version','ticket_event_id','control_event_id','handling_cycle','communication_choice','conversations','replayed'],increment=version(v.ticket_version)-command.expected_version;
      if(Object.keys(v).length!==keys.length||Object.keys(v).some(key=>!keys.includes(key))||(action==='takeover'?increment!==1:increment!==2&&increment!==3)||v.communication_choice!==command.communication_choice||!Array.isArray(v.conversations)||v.conversations.length!==command.sessions.length)throw new UnknownCommandOutcome();
      let handling_cycle:P2016TakeoverResult['handling_cycle']=null;if(v.handling_cycle!==null){const c=object(v.handling_cycle);if(Object.keys(c).length!==3)throw new UnknownCommandOutcome();handling_cycle={id:id(c.id),cycle_no:version(c.cycle_no),first_responsibility_event_id:c.first_responsibility_event_id===null?null:id(c.first_responsibility_event_id)};}if(action==='takeover-and-start'&&!handling_cycle?.first_responsibility_event_id)throw new UnknownCommandOutcome();
      const originals=new Map(command.sessions.map(row=>[row.session_id.toLowerCase(),row]));const conversations=v.conversations.map(value=>{const row=object(value),session=id(row.session_id),original=originals.get(session.toLowerCase()),revision=row.session_row_version;if(Object.keys(row).length!==4||!original||typeof row.changed!=='boolean'||typeof revision!=='number'||!Number.isSafeInteger(revision)||revision!==original.expected_row_version+(row.changed?1:0)||(row.changed?typeof row.control_event_id!=='string':row.control_event_id!==null))throw new UnknownCommandOutcome();return {session_id:session,session_row_version:revision,control_event_id:row.control_event_id===null?null:id(row.control_event_id),changed:row.changed};});if(new Set(conversations.map(row=>row.session_id.toLowerCase())).size!==conversations.length)throw new UnknownCommandOutcome();
      return {...decodeTicketReceipt(v,ticketId),handling_cycle,communication_choice:command.communication_choice,conversations};
    });requireCurrent();return result;}catch(error){requireCurrent();throw error;}
  },
  unassignAcknowledgement:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016UnassignAcknowledgement>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/unassign/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===2){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||!/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4&&id(v.ticket_id).toLowerCase()===ticketId.toLowerCase())return {state:'COMMITTED',ticket_id:id(v.ticket_id),ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id)};
    throw new ApiError(502,'INVALID_RESPONSE');
  }),
  unassignCommunicationTargets:(ticketId:string,target:string|null,signal:AbortSignal):Promise<P2016UnassignTargets>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/unassign/communication-targets'+(target===null?'':'?'+new URLSearchParams({target_principal_id:id(target)})),signal,value=>{
    const v=object(value);if(Object.keys(v).length!==1||!Array.isArray(v.items)||v.items.length>100)throw new ApiError(502,'INVALID_RESPONSE');
    const items=v.items.map(value=>{const row=object(value),principal_id=id(row.principal_id),display_name=text(row.display_name);if(Object.keys(row).length!==2||!display_name)throw new ApiError(502,'INVALID_RESPONSE');return {principal_id,display_name};});
    if(new Set(items.map(row=>row.principal_id.toLowerCase())).size!==items.length)throw new ApiError(502,'INVALID_RESPONSE');return {items};
  }),
  unassignTicket:async(ticketId:string,command:P2016UnassignCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016UnassignResult>=>{
    const requireCurrent=captureWorkbenchRead(signal);requireCurrent();
    try{
      const result=await postTicketCommand(ticketId,'unassign',command,csrfToken,signal,v=>{
        if(Object.keys(v).length!==9||version(v.ticket_version)!==command.expected_version+1||v.communication_choice!==command.communication_choice||!Array.isArray(v.conversations)||v.conversations.length!==command.sessions.length)throw new UnknownCommandOutcome();
        const originals=new Map(command.sessions.map(row=>[row.session_id.toLowerCase(),row]));
        const conversations=v.conversations.map(value=>{const row=object(value),session=id(row.session_id),original=originals.get(session.toLowerCase());
          if(Object.keys(row).length!==4||!original||typeof row.changed!=='boolean'||version(row.session_row_version)!==original.expected_row_version+(row.changed?1:0)||(row.changed?typeof row.control_event_id!=='string':row.control_event_id!==null))throw new UnknownCommandOutcome();
          return {session_id:session,session_row_version:version(row.session_row_version),control_event_id:row.control_event_id===null?null:id(row.control_event_id),changed:row.changed};});
        if(new Set(conversations.map(row=>row.session_id.toLowerCase())).size!==conversations.length)throw new UnknownCommandOutcome();
        let handling_cycle:P2016UnassignResult['handling_cycle']=null;
        if(v.handling_cycle!==null){const cycle=object(v.handling_cycle);if(Object.keys(cycle).length!==3)throw new UnknownCommandOutcome();handling_cycle={id:id(cycle.id),cycle_no:version(cycle.cycle_no),first_responsibility_event_id:id(cycle.first_responsibility_event_id)};}
        return {...decodeTicketReceipt(v,ticketId),handling_cycle,communication_choice:command.communication_choice,conversations};
      });requireCurrent();return result;
    }catch(error){requireCurrent();throw error;}
  },
  assignmentAcknowledgement:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016AssignmentAcknowledgement>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/assignment/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(v.state==='UNKNOWN'&&Object.keys(v).length===1)return {state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===2){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||!/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4&&id(v.ticket_id)===ticketId)return {state:'COMMITTED',ticket_id:ticketId,ticket_version:version(v.ticket_version),ticket_event_id:id(v.ticket_event_id)};
    throw new ApiError(502,'INVALID_RESPONSE');
  }),
  assignmentTargets:(ticketId:string,team:string|null,signal:AbortSignal,target:string|null=null):Promise<P2016AssignmentTargets>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/assignment-targets'+(team?'?'+new URLSearchParams({resolver_team_id:team,...(target?{target_principal_id:target}:{})}):''),signal,value=>{
    const v=object(value);if(Object.keys(v).length!==3||!Array.isArray(v.resolver_teams)||v.resolver_teams.length>100||!Array.isArray(v.items)||v.items.length>100||v.resolver_team_id!==team)throw new ApiError(502,'INVALID_RESPONSE');
    const resolver_teams=v.resolver_teams.map(value=>{const row=object(value),team_id=text(row.team_id),display_name=text(row.display_name);if(Object.keys(row).length!==2||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(team_id)||!display_name||display_name.length>128)throw new ApiError(502,'INVALID_RESPONSE');return {team_id,display_name};});
    const items=v.items.map(value=>{const row=object(value),principal_id=id(row.principal_id),display_name=text(row.display_name);if(Object.keys(row).length!==2||!display_name||display_name.length>128)throw new ApiError(502,'INVALID_RESPONSE');return {principal_id,display_name};});
    if(new Set(resolver_teams.map(group=>group.team_id)).size!==resolver_teams.length||new Set(items.map(item=>item.principal_id)).size!==items.length||(team===null?items.length!==0:!resolver_teams.some(group=>group.team_id===team)))throw new ApiError(502,'INVALID_RESPONSE');
    return {resolver_teams,resolver_team_id:team,items};
  }),
  assignTicket:(ticketId:string,action:P2016AssignmentAction,command:P2016AssignmentCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016AssignmentResult>=>postTicketCommand(ticketId,action,command,csrfToken,signal,v=>{
    if(Object.keys(v).length!==9||v.communication_choice!==command.communication_choice||!Array.isArray(v.conversations)||v.conversations.length!==command.sessions.length)throw new UnknownCommandOutcome();
    const conversations=v.conversations.map(value=>{const row=object(value),session=id(row.session_id),original=command.sessions.find(item=>item.session_id===session),raw=row.session_row_version;
      if(Object.keys(row).length!==4||!original||typeof row.changed!=='boolean'||typeof raw!=='number'||!Number.isSafeInteger(raw)||raw!==original.expected_row_version+(row.changed?1:0)||(row.changed?(typeof row.control_event_id!=='string'):row.control_event_id!==null))throw new UnknownCommandOutcome();
      return {session_id:session,session_row_version:raw,control_event_id:row.control_event_id===null?null:id(row.control_event_id),changed:row.changed};});
    if(new Set(conversations.map(row=>row.session_id)).size!==conversations.length)throw new UnknownCommandOutcome();
    return {...decodeTicketReceipt(v,ticketId),handling_cycle:v.handling_cycle===null?null:decodeCycle(v.handling_cycle),communication_choice:command.communication_choice,conversations};
  }),
  reporterCandidates:(query:string,cursor:string|null,signal:AbortSignal):Promise<WorkbenchReporterCandidates>=>get('/api/workbench/reporter-candidates?'+new URLSearchParams({q:query,limit:'10',...(cursor?{cursor}:{})}),signal,value=>{try{return decodeReporterCandidates(value);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  manualReportCapabilities:(signal:AbortSignal):Promise<ManualReportCapabilities>=>get('/api/workbench/reports/capabilities',signal,value=>{try{return decodeManualReportCapabilities(value);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  manualReportReceipt:(commandId:string,signal:AbortSignal):Promise<ManualReportAdmissionReceipt>=>get('/api/workbench/reports/commands/'+encodeURIComponent(commandId),signal,value=>{try{return decodeManualReportReceipt(value,commandId);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  submitManualReport:async(command:ManualReportAdmissionCommand,csrfToken:string|null,signal:AbortSignal):Promise<ManualReportAdmissionResult>=>{
    try{
      const response=await fetch('/api/workbench/reports',{method:'POST',signal,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/json','idempotency-key':command.client_command_id,...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:JSON.stringify(command)});
      if(!response.ok&&response.status!==401&&command.reporter.verification==='VERIFIED_SELECTION'&&response.headers.get('content-type')?.startsWith('application/json')){
        try{const rejected=decodeVerifiedManualReportRejection(await response.clone().json(),command.client_command_id);throw new ConfirmedManualReportRejection(response.status,rejected.error.code,rejected.receipt.client_command_id);}
        catch(error){if(error instanceof ConfirmedManualReportRejection)throw error;}
      }
      if([401,403,404].includes(response.status))return await rejectAuthorization(response);
      if(!response.headers.get('content-type')?.startsWith('application/json'))throw new UnknownCommandOutcome();
      const value:unknown=await response.json(),v=object(value);
      if(!response.ok){const e=object(v.error),code=text(e.code);if(!/^P2_016_[A-Z][A-Z0-9_]{0,55}$/u.test(code))throw new UnknownCommandOutcome();
        if(response.status<500||v.ok===false&&typeof v.replayed==='boolean'&&e.retryable===false||code==='P2_016_DISABLED')throw new ApiError(response.status,code);throw new UnknownCommandOutcome();}
      const result=decodeManualReportResult(v,command.client_command_id);if(result.source!==command.source||result.reporter_verification!==(command.reporter.verification==='VERIFIED_SELECTION'?'VERIFIED':'UNVERIFIED')||response.status!==(result.replayed?200:202))throw new UnknownCommandOutcome();return result;
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
  reopenTicket:(ticketId:string,command:P2016ReopenCommand,csrfToken:string|null,signal:AbortSignal)=>postTicketCommand(ticketId,'reopen',command,csrfToken,signal,v=>{
    const result=decodeReopen(v,ticketId);if(result.ticket_version!==command.expected_version+1)throw new UnknownCommandOutcome();return result;
  }),
  reopenReceipt:(ticketId:string,commandId:string,signal:AbortSignal):Promise<P2016ReopenReceipt>=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/reopen/commands/'+encodeURIComponent(commandId),signal,value=>{
    const v=object(value);if(id(v.ticket_id)!==ticketId||id(v.client_command_id)!==commandId)throw new ApiError(502,'INVALID_RESPONSE');const base={ticket_id:ticketId,client_command_id:commandId};
    if(v.state==='UNKNOWN'&&Object.keys(v).length===3)return {...base,state:'UNKNOWN'};
    if(v.state==='FAILED'&&Object.keys(v).length===4){const e=object(v.error),code=text(e.code);if(Object.keys(e).length!==2||e.retryable!==false||! /^[A-Z][A-Z0-9_]{0,63}$/u.test(code))throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'FAILED',error:{code,retryable:false}};}
    if(v.state==='COMMITTED'&&Object.keys(v).length===4){const result=decodeReopen(v.result,ticketId);if(result.replayed!==true)throw new ApiError(502,'INVALID_RESPONSE');return {...base,state:'COMMITTED',result};}
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
  assignmentHistory:(ticketId:string,cursor:string|null,signal:AbortSignal)=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/assignment-history?'+new URLSearchParams({limit:'20',...(cursor?{cursor}:{})}),signal,value=>{try{return decodeAssignmentHistory(value,ticketId);}catch{throw new ApiError(502,'INVALID_RESPONSE');}}),
  ticketNotifications:(ticketId:string,signal:AbortSignal)=>get('/api/tickets/'+encodeURIComponent(ticketId)+'/deliveries',signal,decodeTicketNotifications),
  ticketCommandContext:(ticketId:string,signal:AbortSignal)=>get('/api/tickets/'+encodeURIComponent(ticketId),signal,value=>decodeTicketContext(value,ticketId)),
  addInternalNote:(ticketId:string,command:P2016InternalNoteCommand,csrfToken:string|null,signal:AbortSignal)=>postTicketCommand(ticketId,'internal-notes',command,csrfToken,signal,v=>decodeTicketReceipt(v,ticketId)),
  selfHandle:(ticketId:string,action:SelfHandlingAction,command:P2016SelfHandlingCommand,csrfToken:string|null,signal:AbortSignal):Promise<P2016SelfHandlingResult>=>postTicketCommand(ticketId,action,command,csrfToken,signal,v=>{
    const receipt=decodeTicketReceipt(v,ticketId),cycle=decodeCycle(v.handling_cycle);if(cycle.first_responsibility_event_id===null)throw new UnknownCommandOutcome();
    return {...receipt,handling_cycle:{...cycle,first_responsibility_event_id:cycle.first_responsibility_event_id}};
  }),
  board:(column:BoardColumn,range:CompletionRange,cursor:string|null,signal:AbortSignal,scope?:'team'|'related')=>get('/api/workbench/board?'+new URLSearchParams({column,range,limit:'50',...(cursor?{cursor}:{}),...(scope?{scope}:{})}),signal,decodePage),
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
