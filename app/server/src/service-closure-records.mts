import type {ClosureReasonCode,ClosureSecondaryReasonCode,NormalizedClosureInput} from '../../../contracts/unified_closure_contracts.js';
import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import {SUPPLEMENT_MATERIALS_SQL,SUPPLEMENT_RESOLUTION_SQL} from './workbench-supplement-follow-up.mjs';
import {exactP2016,failP2016,localP2016} from './p2-016-domain-contracts.mjs';

export const CLOSURE_REASONS:Readonly<Record<ClosureReasonCode,string>>=Object.freeze({FALSE_REPORT_OR_TEST:'误报或测试',DUPLICATE:'重复报修',NOT_IT_SCOPE:'非 IT 范围',REPORTER_WITHDREW:'报修人撤回',REPORTER_UNREACHABLE:'无法联系报修人',OTHER:'其他'});
export const CLOSURE_SECONDARY_REASONS:Readonly<Record<ClosureSecondaryReasonCode,string>>=Object.freeze({HUMAN_CONFIRMED:'人工核对确认',INFORMATION_INSUFFICIENT:'描述不足，需要补充',BUSINESS_CONSULTATION_CONFIRMED:'已核对为业务咨询',ACKNOWLEDGED:'确认收到',OUT_OF_SCOPE_CONFIRMED:'已核对为范围外诉求',SERVICE_REQUEST_CONFIRMED:'已核对为服务请求',INCIDENT_REVIEW_PENDING:'待公共故障审核',STALE_REVIEW_CANCELLED:'明确取消旧复核'});
export interface ClosureRecord extends NormalizedClosureInput {id:string;subject_type:'TICKET'|'INTAKE';ticket_id:string|null;intake_id:string|null;before_status:string;before_assignee_id:string|null;before_team_id:string|null;before_version:number;before_cycle_id:string|null;before_snapshot:Record<string,unknown>;closed_by:string|null;source:'MANUAL'|'SYSTEM';closed_at:string;closure_ticket_event_id:string|null;closure_intake_event_id:string|null;notification_message_id:string|null;notification_processed_at:string|null;restored_at:string|null;restored_by:string|null;restoration_event_id:string|null}
export function normalizeClosureInput(input:unknown):NormalizedClosureInput{
 const v=exactP2016(input,['reason_code','secondary_reason_code','note','duplicate_of_ref','notify_reporter'],['reason_code']);
 if(typeof v.reason_code!=='string'||!Object.hasOwn(CLOSURE_REASONS,v.reason_code))failP2016();
 const reason=v.reason_code as ClosureReasonCode;
 if(v.note!==undefined&&v.note!==null&&(typeof v.note!=='string'||v.note.length>2000))failP2016();
 const note=typeof v.note==='string'&&v.note.trim()?v.note:null;
 if(reason==='OTHER'&&note===null)failP2016();
 const secondary=v.secondary_reason_code??null;
 if(reason==='NOT_IT_SCOPE'?(typeof secondary!=='string'||!Object.hasOwn(CLOSURE_SECONDARY_REASONS,secondary)):secondary!==null)failP2016();
 const duplicate=v.duplicate_of_ref??null;
 if(duplicate!==null&&(reason!=='DUPLICATE'||typeof duplicate!=='string'||!duplicate.trim()||duplicate.length>128))failP2016();
 if(v.notify_reporter!==undefined&&typeof v.notify_reporter!=='boolean')failP2016();
 const notify=reason==='OTHER'?(v.notify_reporter??false):reason!=='FALSE_REPORT_OR_TEST';
 if(reason!=='OTHER'&&v.notify_reporter!==undefined&&v.notify_reporter!==notify)failP2016();
 return {reason_code:reason,secondary_reason_code:secondary as ClosureSecondaryReasonCode|null,note,duplicate_of_ref:duplicate as string|null,notify_reporter:notify};
}
export const CLOSURE_NOTIFICATION_TEMPLATES=Object.freeze({
 FALSE_REPORT_OR_TEST:'已关闭',DUPLICATE:'您的报修与已有报修重复，我们会在原报修中继续跟进。',NOT_IT_SCOPE:'您反映的问题不属于信息科受理范围，建议联系相关部门处理。',REPORTER_WITHDREW:'已按您的要求撤销本次报修。',REPORTER_UNREACHABLE:'多次联系未果，本次报修已关闭。如仍需处理，请重新报修。',OTHER:'您的报修已关闭。如仍需处理，请重新报修。',RESTORED:'您的报修已重新受理，我们会继续处理。',
});
export function reporterClosureText(record:Pick<NormalizedClosureInput,'reason_code'|'duplicate_of_ref'>):string{
 return CLOSURE_NOTIFICATION_TEMPLATES[record.reason_code]+(record.reason_code==='DUPLICATE'&&record.duplicate_of_ref?'原报修编号：'+record.duplicate_of_ref:'');
}
/** SQL selects only these two fields; no internal note enters the reporter DTO. */
export const REPORTER_CLOSURE_JOIN_SQL=`LEFT JOIN pilot_ticket.closure_record public_closure ON public_closure.restored_at IS NULL AND
 ((t.id IS NOT NULL AND public_closure.ticket_id=t.id) OR (t.id IS NULL AND public_closure.intake_id=i.id))`;
export const REPORTER_CLOSURE_FIELDS_SQL=`CASE WHEN public_closure.id IS NULL THEN NULL ELSE jsonb_build_object('reason_code',public_closure.reason_code,'duplicate_of_ref',public_closure.duplicate_of_ref) END AS closure_public`;
export function reporterClosureProjection(value:unknown,status:string|null):string|null{
 if(!['CANCELLED','DUPLICATE_LINKED','IGNORED'].includes(status??''))return null;
 if(value===null||value===undefined)failP2016('ACTION_FAILED',503);
 const record=exactP2016(value,['reason_code','duplicate_of_ref']);
 if(typeof record.reason_code!=='string'||!Object.hasOwn(CLOSURE_REASONS,record.reason_code)||record.duplicate_of_ref!==null&&typeof record.duplicate_of_ref!=='string')failP2016('ACTION_FAILED',503);
 return reporterClosureText({reason_code:record.reason_code as ClosureReasonCode,duplicate_of_ref:record.duplicate_of_ref as string|null});
}
export async function insertClosureRecord({transaction:tx,subjectType,subjectId,beforeStatus,beforeAssignee=null,beforeTeam=null,beforeVersion,beforeCycle=null,beforeSnapshot={},actor,source,input,ticketEventId=null,intakeEventId=null}:{transaction:PostgresTransaction;subjectType:'TICKET'|'INTAKE';subjectId:string;beforeStatus:string;beforeAssignee?:string|null;beforeTeam?:string|null;beforeVersion:number;beforeCycle?:string|null;beforeSnapshot?:Record<string,unknown>;actor:string|null;source:'MANUAL'|'SYSTEM';input:NormalizedClosureInput;ticketEventId?:string|null;intakeEventId?:string|null}):Promise<ClosureRecord>{
 const r=await tx.query<ClosureRecord>(`INSERT INTO pilot_ticket.closure_record(subject_type,ticket_id,intake_id,reason_code,secondary_reason_code,note,duplicate_of_ref,notify_reporter,before_status,before_assignee_id,before_team_id,before_version,before_cycle_id,before_snapshot,closed_by,source,closure_ticket_event_id,closure_intake_event_id)
  VALUES($1,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::uuid,$14::jsonb,$15,$16,$17::uuid,$18::uuid) RETURNING *`,
 [subjectType,subjectType==='TICKET'?subjectId:null,subjectType==='INTAKE'?subjectId:null,input.reason_code,input.secondary_reason_code,input.note,input.duplicate_of_ref,input.notify_reporter,beforeStatus,beforeAssignee,beforeTeam,beforeVersion,beforeCycle,JSON.stringify(beforeSnapshot),actor,source,ticketEventId,intakeEventId]);
 const record=r.rows[0];if(!record)failP2016('ACTION_FAILED',503);return record;
}
export async function currentClosure(tx:PostgresTransaction,kind:'TICKET'|'INTAKE',id:string,lock=false):Promise<ClosureRecord>{
 const row=(await tx.query<ClosureRecord>(`SELECT * FROM pilot_ticket.closure_record WHERE ${kind==='TICKET'?'ticket_id':'intake_id'}=$1::uuid AND restored_at IS NULL${lock?' FOR UPDATE':''}`,[id])).rows[0];
 if(!row)failP2016('ACTION_FAILED',503);return row;
}
export async function markClosureRestored(tx:PostgresTransaction,record:ClosureRecord,actor:string,eventId:string):Promise<void>{
 const r=await tx.query(`UPDATE pilot_ticket.closure_record SET restored_at=GREATEST(closed_at,date_trunc('second',clock_timestamp() AT TIME ZONE 'Asia/Shanghai')),restored_by=$2::uuid,restoration_event_id=$3::uuid WHERE id=$1::uuid AND restored_at IS NULL`,[record.id,actor,eventId]);
 if(r.rowCount!==1)failP2016('VERSION_CONFLICT',409);
}
export async function intakeClosureSnapshot(tx:PostgresTransaction,intakeId:string):Promise<Record<string,unknown>>{
 const journeys=(await tx.query(`SELECT j.id::text,j.status,j.ended_at FROM intake.contact_journey j WHERE j.origin_intake_id=$1::uuid OR EXISTS(SELECT 1 FROM intake.channel_leg l WHERE l.journey_id=j.id AND l.source_intake_id=$1::uuid) ORDER BY j.id FOR UPDATE OF j`,[intakeId])).rows;
 const reviews=(await tx.query(`SELECT id::text,status,row_version::text,resolution_command_id::text,resolution_command_hash,resolution_code,resolution_reason_code,resolved_by_principal_id::text,resolution_decision_id::text,resolved_at
  FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status='PENDING' ORDER BY created_at,id FOR UPDATE`,[intakeId])).rows;
 return {reviews,journeys};
}
export async function effectiveClosureAssignee(tx:PostgresTransaction,record:ClosureRecord):Promise<{status:string;assignee:string|null}>{
 if(record.before_assignee_id===null)return {status:record.before_status,assignee:null};
 const roles=await tx.query<{role:string}>(`SELECT r.role FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
  WHERE p.id=$1::uuid AND p.is_active AND r.role IN ('ADMIN','DISPATCHER','HANDLER') ORDER BY r.role FOR SHARE OF p,r`,[record.before_assignee_id]);
 if(roles.rows.some(row=>row.role==='ADMIN'||row.role==='DISPATCHER'))return {status:record.before_status,assignee:record.before_assignee_id};
 if(roles.rows.some(row=>row.role==='HANDLER')){
  const membership=await tx.query(`SELECT m.principal_id FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
   WHERE m.principal_id=$1::uuid AND m.team_id=$2 AND rt.is_active FOR SHARE OF m,rt`,[record.before_assignee_id,record.before_team_id]);
  if(membership.rowCount)return {status:record.before_status,assignee:record.before_assignee_id};
 }
 return {status:'QUEUED',assignee:null};
}
export async function terminateClosureFollowUps(tx:PostgresTransaction,record:ClosureRecord,intakeId:string):Promise<void>{
 if(record.ticket_id===null)return;
 const features=(await tx.query<{supplements:boolean;schedules:boolean;deadlines:boolean;cards:boolean;urges:boolean}>(`SELECT
  to_regclass('pilot_ticket.workbench_supplement_disposition') IS NOT NULL AND to_regclass('intake.web_submission') IS NOT NULL AS supplements,
  to_regclass('pilot_ticket.follow_up_schedule') IS NOT NULL AS schedules,to_regclass('notification.card_action_task') IS NOT NULL AS cards,to_regclass('intake.web_report_urge') IS NOT NULL AS urges,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='pilot_ticket' AND table_name='ticket' AND column_name='auto_close_epoch_ms') AS deadlines`)).rows[0];
 if(features?.supplements)await tx.query(SUPPLEMENT_MATERIALS_SQL+` INSERT INTO pilot_ticket.closure_supplement_termination(closure_id,ticket_id,source_intake_id,source_ref,revision)
  SELECT $3::uuid,$2::uuid,m.source_intake_id,m.source_ref,m.revision FROM materials m WHERE NOT EXISTS(${SUPPLEMENT_RESOLUTION_SQL})`,[intakeId,record.ticket_id,record.id]);
 if(features?.schedules)await tx.query('UPDATE pilot_ticket.follow_up_schedule SET due_at=NULL,due_epoch_ms=NULL,scheduled_event_id=NULL WHERE ticket_id=$1::uuid',[record.ticket_id]);
 if(features?.urges)await tx.query(`UPDATE pilot_ticket.closure_record SET before_snapshot=before_snapshot||jsonb_build_object('urge_sequence',(SELECT COALESCE(max(sequence_no),0)::text FROM intake.web_report_urge WHERE ticket_id=$2::uuid)) WHERE id=$1::uuid`,[record.id,record.ticket_id]);
 if(features?.deadlines)await tx.query('UPDATE pilot_ticket.ticket SET auto_close_at=NULL,auto_close_epoch_ms=NULL,auto_close_reminder_at=NULL,auto_close_reminder_epoch_ms=NULL WHERE id=$1::uuid',[record.ticket_id]);
 // A version-bound card is already fenced by the Ticket transition. Consuming it
 // also makes the termination explicit; existing receipts remain immutable.
 if(features?.cards)await tx.query('UPDATE notification.card_action_task SET consumed_at=COALESCE(consumed_at,platform.local_now()) WHERE ticket_id=$1::uuid AND consumed_at IS NULL',[record.ticket_id]);
}
/** Timestamp is the state-transition transaction's physical clock, never a source observation. */
export async function appendIntakeClosureEvent(tx:PostgresTransaction,input:{intakeId:string;version:number;type:'intake.closed'|'intake.restored';oldStatus:string;newStatus:string;actor:string|null;traceId:string}):Promise<string>{
 const row=(await tx.query<{id:string}>(`INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
  SELECT $2,'intake',$1::uuid,$3,COALESCE(max(event_ordinal),0)+1,date_trunc('second',clock_timestamp() AT TIME ZONE 'Asia/Shanghai'),$4,$5::jsonb FROM intake.service_intake_event WHERE intake_id=$1::uuid RETURNING event_id::text AS id`,
 [input.intakeId,input.type,input.version,input.traceId,JSON.stringify({old_status:input.oldStatus,new_status:input.newStatus,actor_principal_id:input.actor})])).rows[0];
 if(!row)failP2016('ACTION_FAILED',503);return row.id;
}
export function closureRecordTime(value:string):string{return localP2016(value);}
