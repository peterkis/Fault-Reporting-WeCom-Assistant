import type {YxxSafeTicket,YxxTimelineEvent} from '../../../contracts/yxx_self_service_contracts.js';
import type {H5Profile,H5Handler,H5PublicProgress,H5UrgeSummary,H5EvaluationContext,H5Limits} from '../../../contracts/yxx_h5_v2_contracts.js';
import type {YxxFeedbackContext} from '../../../contracts/yxx_self_service_feedback_contracts.js';
import type {Bootstrap,ReportItem,ReportPage,RequestDetail,H5Media,H5Thumbnail,H5EntryResponse,H5SupplementPage,H5DepartmentPage,H5DepartmentSummary,YxxTimeline,EndpointResponseMap} from './types';
import {record,text,boolean,number,nullable,array,optional,date,epoch,decode,type Decoder} from './guards';

const nullableText=nullable(text),nullableNumber=nullable(number);
const ticket=(value:unknown):value is YxxSafeTicket=>record(value)&&text(value.ticket_no)&&text(value.status)&&optional(value.updated_at,date);
const profile=(value:unknown):value is H5Profile=>record(value)&&nullableText(value.name)&&nullableText(value.department)&&nullableText(value.phone)&&nullableText(value.avatar_url);
const handler=(value:unknown):value is H5Handler=>record(value)&&nullableText(value.name)&&nullableText(value.team_name)&&nullableText(value.phone)&&nullableText(value.avatar_url)&&nullableText(value.chat_url);
const progress=(value:unknown):value is H5PublicProgress=>record(value)&&text(value.summary)&&nullableText(value.estimated_at)&&nullableText(value.estimated_epoch_ms)&&number(value.version)&&text(value.updated_at)&&text(value.updated_epoch_ms);
const thumbnail=(value:unknown):value is H5Thumbnail=>record(value)&&['PENDING','READY','UNAVAILABLE'].includes(String(value.status))&&nullableText(value.url)&&nullableText(value.mime_type)&&nullableNumber(value.byte_size);
const media=(value:unknown):value is H5Media&{thumbnail?:H5Thumbnail|null}=>record(value)&&text(value.media_ref)&&['VOICE','IMAGE','VIDEO'].includes(String(value.kind))&&text(value.mime_type)&&number(value.byte_size)&&nullableNumber(value.duration_ms)&&text(value.url)&&['PENDING','READY','UNAVAILABLE'].includes(String(value.playback_status))&&nullableText(value.playback_mime_type)&&optional(value.thumbnail,nullable(thumbnail));
const urge=(value:unknown):value is H5UrgeSummary=>record(value)&&boolean(value.active)&&number(value.count)&&nullableText(value.last_urged_at)&&nullableText(value.last_urged_epoch_ms)&&nullableText(value.next_allowed_at)&&nullableText(value.next_allowed_epoch_ms)&&boolean(value.can_urge);
const evaluation=(value:unknown):value is H5EvaluationContext=>record(value)&&boolean(value.can_evaluate)&&nullableText(value.completed_round_ref)&&nullableNumber(value.completed_round_no)&&nullableNumber(value.ticket_version)&&nullableNumber(value.rating)&&nullableText(value.comment)&&nullableText(value.evaluated_at)&&nullableText(value.evaluated_epoch_ms);
const limits=(value:unknown):value is H5Limits=>record(value)&&value.voice_count===1&&value.voice_duration_seconds===60&&number(value.voice_bytes)&&value.image_count===6&&number(value.image_bytes)&&value.video_count===1&&value.video_duration_seconds===60&&number(value.video_bytes)&&number(value.total_bytes);
const bootstrap=(value:unknown):value is Bootstrap=>record(value)&&value.authenticated===true&&value.identity_mode==='MEMBER_SELF_SERVICE'&&boolean(value.read_only)&&boolean(value.can_submit)&&boolean(value.can_supplement)&&text(value.csrf_token)&&text(value.recovery_scope)&&value.recovery_scope.length>0&&record(value.h5)&&profile(value.h5.profile)&&boolean(value.h5.can_upload)&&boolean(value.h5.can_urge)&&boolean(value.h5.can_evaluate)&&boolean(value.h5.can_view_department)&&record(value.h5.sdk)&&boolean(value.h5.sdk.enabled)&&nullableText(value.h5.sdk.corp_id)&&nullableText(value.h5.sdk.agent_id)&&record(value.h5.support)&&value.h5.support.emergency_phone==='18117887318'&&value.h5.support.service_phone==='61318500'&&limits(value.h5.limits);
const report=(value:unknown):value is ReportItem=>{
 if(!record(value)||!['WEB_REQUEST','BOT_TICKET'].includes(String(value.kind))||!text(value.ref)||!text(value.display_status)||!date(value.created_at)||!epoch(value.created_epoch_ms)||!nullable(ticket)(value.ticket)||!optional(value.safe_summary,nullableText)||!optional(value.safe_location,nullableText)||!optional(value.service_category,nullableText)||!optional(value.detail_url,nullableText))return false;
 return value.h5===undefined||(record(value.h5)&&optional(value.h5.handler,nullable(handler))&&optional(value.h5.public_progress,nullable(progress))&&optional(value.h5.media_count,number)&&optional(value.h5.intent,(intent):intent is 'FAULT'|'CONTACT_REQUEST'=>intent==='FAULT'||intent==='CONTACT_REQUEST'));
};
const reports=(value:unknown):value is ReportPage=>record(value)&&array(report)(value.items)&&nullableText(value.next_cursor);
const supplement=(value:unknown):value is H5SupplementPage['items'][number]=>record(value)&&text(value.input_revision)&&nullableText(value.text);
const supplements=(value:unknown):value is H5SupplementPage=>record(value)&&array(supplement)(value.items)&&nullableText(value.next_cursor);
const feedbackContext=(value:unknown):value is YxxFeedbackContext=>{
 if(!record(value)||value.schema_version!==1)return false;
 return value.can_feedback===true?text(value.completed_round_ref)&&number(value.completed_round_no)&&number(value.ticket_version)&&value.rejection===null:value.can_feedback===false&&value.completed_round_ref===null&&value.completed_round_no===null&&value.ticket_version===null&&['WRITE_DISABLED','TICKET_NOT_CREATED','ROUND_NOT_COMPLETED','ROUND_ALREADY_REOPENED'].includes(String(value.rejection));
};
const detail=(value:unknown):value is RequestDetail=>{
 if(!record(value)||!text(value.request_ref)||!text(value.intake_no)||value.source_kind!=='WEB_REQUEST'||!text(value.input_revision)||!text(value.processed_revision)||!['RECEIVED_PROCESSING','WAITING_FOR_DETAILS','UNDER_REVIEW','TICKET_CREATED','NOT_SERVICE'].includes(String(value.display_status))||!nullableText(value.needs_action)||!text(value.safe_description)||!array(supplement)(value.supplements)||!optional(value.supplements_cursor,nullableText)||!nullableText(value.safe_location)||!date(value.created_at)||!epoch(value.created_epoch_ms)||!date(value.updated_at)||!epoch(value.updated_epoch_ms)||!nullable(ticket)(value.ticket)||!nullableText(value.safe_clarification)||!boolean(value.can_supplement)||!optional(value.feedback_context,feedbackContext))return false;
 const h5=value.h5;return record(h5)&&nullableNumber(h5.ticket_version)&&array(media)(h5.media)&&nullable(handler)(h5.handler)&&nullable(progress)(h5.public_progress)&&urge(h5.urge)&&evaluation(h5.evaluation)&&(h5.intent==='FAULT'||h5.intent==='CONTACT_REQUEST');
};
const timelineEvent=(value:unknown):value is YxxTimelineEvent=>record(value)&&text(value.event_type)&&date(value.occurred_at)&&epoch(value.occurred_epoch_ms)&&text(value.summary)&&nullable(ticket)(value.ticket);
const timeline=(value:unknown):value is YxxTimeline=>record(value)&&array(timelineEvent)(value.items)&&nullableText(value.next_cursor);
const departmentReport=(value:unknown):value is H5DepartmentPage['items'][number]=>record(value)&&text(value.ticket_no)&&nullableText(value.service_category)&&text(value.status)&&nullable(progress)(value.public_progress)&&text(value.created_at);
const department=(value:unknown):value is H5DepartmentPage=>record(value)&&array(departmentReport)(value.items)&&nullableText(value.next_cursor)&&number(value.total)&&number(value.active_count);
const departmentSummary=(value:unknown):value is H5DepartmentSummary=>record(value)&&number(value.total)&&number(value.active_count)&&text(value.membership_revision);
const entry=(value:unknown):value is H5EntryResponse=>{
 if(!record(value)||value.schema_version!==1||!bootstrap(value.bootstrap)||!text(value.membership_revision))return false;
 const data=value.data;if(value.view==='report')return data===null;
 if(!record(data))return false;
 switch(value.view){
  case'home':return array(report)(data.recent_reports)&&data.recent_reports.length<=3&&(value.bootstrap.h5.can_view_department?departmentSummary(data.department_summary)&&data.department_summary.membership_revision===value.membership_revision:data.department_summary===null);
  case'reports':return reports(data.reports)&&data.reports.items.length<=20;
  case'department':return department(data.department)&&data.department.items.length<=20;
  case'request':{
   if(!detail(data.detail)||typeof data.detail.supplements_cursor==='undefined'||data.detail.supplements.length>20||!data.detail.h5.media.every(item=>item.thumbnail!==undefined)||!record(data.timeline))return false;
   return data.timeline.status==='READY'?timeline(data.timeline.data)&&data.timeline.data.items.length<=20:data.timeline.status==='UNAVAILABLE'&&data.timeline.code==='YXX_UNAVAILABLE';
  }
  default:return false;
 }
};
type ReadResponses=Pick<EndpointResponseMap,'bootstrap'|'reports'|'detail'|'timeline'|'supplements'|'department'|'departmentSummary'|'entry'>;
export const readDecoders={bootstrap:decode(bootstrap),reports:decode(reports),detail:decode(detail),timeline:decode(timeline),supplements:decode(supplements),department:decode(department),departmentSummary:decode(departmentSummary),entry:decode(entry)} satisfies {[K in keyof ReadResponses]:Decoder<ReadResponses[K]>};
