import {assertEpochMsString} from './platform/time-contract.mjs';
import type {ClosureHistoryPage,ClosureHistoryEntry,ClosureReasonCode,ClosureSecondaryReasonCode} from '../../../contracts/unified_closure_contracts.js';
import {CLOSURE_REASONS,CLOSURE_SECONDARY_REASONS,closureRecordTime} from './service-closure-records.mjs';
import type {createWeComWorkbenchAuthentication} from './p2-016-workbench-wecom-auth.mjs';
import {WorkbenchError,WORKBENCH_ERROR_CODES} from './p2-006-workbench-query.mjs';
import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createP2016ManualReviewFacade} from './p2-016-manual-review-facade.mjs';
import type {createP2016RealtimeProjector} from './p2-016-realtime-projector.mjs';
import type {createP2016TicketNotificationProjector} from './p2-016-ticket-notification-projector.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {ticketPredicateP2016} from './p2-016-ticket-query.mjs';
import {exactP2016,uuidP2016,versionP2016,failP2016,guardP2016,transactionP2016,codeP2016} from './p2-016-domain-contracts.mjs';
import {normalizeClosingInput,intakeClosureSnapshot,insertClosureRecord,currentClosure,markClosureRestored,appendIntakeClosureEvent} from './service-closure-records.mjs';
interface IntakeRow {id:string;status:string;version:number;request_type:string;pilot_ticket_id:string|null;linked_ticket:boolean}
export function createWorkbenchIntakeClosure({pool,query,enabled=false,realtime,notifications,reviews,currentSessionPredicate}:{currentSessionPredicate?:ReturnType<typeof createWeComWorkbenchAuthentication>['currentSessionPredicate']|undefined;pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean;realtime:Pick<ReturnType<typeof createP2016RealtimeProjector>,'lock'|'review'>;notifications:Pick<ReturnType<typeof createP2016TicketNotificationProjector>,'projectClosure'>;reviews:Pick<ReturnType<typeof createP2016ManualReviewFacade>,'resolveManualReviewInTransaction'>}){
 const ledger=createP2016CommandLedger({pool});
 async function authorize(authContext:unknown,id:string,tx:PostgresTransaction,lock=false){
  const principal=await query.principal(authContext,tx),predicate=ticketPredicateP2016(principal,2);
  // This is the same bare-Intake / Journey authority used by the canonical board.
  // HANDLER receives no extra unlinked Intake visibility from write permission.
  const intake=(await tx.query<IntakeRow>(`SELECT i.id::text,i.status,i.version,i.request_type,i.pilot_ticket_id::text,
   (i.pilot_ticket_id IS NOT NULL OR EXISTS(SELECT 1 FROM pilot_ticket.ticket direct WHERE direct.source_intake_id=i.id)
    OR EXISTS(SELECT 1 FROM intake.channel_leg own JOIN intake.contact_journey j ON j.id=own.journey_id JOIN pilot_ticket.ticket actual ON actual.id=j.linked_ticket_id WHERE own.source_intake_id=i.id)) AS linked_ticket FROM intake.service_intake i
   WHERE i.id=$1::uuid AND i.retention_until>platform.local_now() AND ($2::boolean OR EXISTS(
    SELECT 1 FROM intake.channel_leg l JOIN intake.contact_journey j ON j.id=l.journey_id JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
    WHERE l.source_intake_id=i.id AND j.retention_until_epoch_ms>platform.physical_epoch_ms() AND ${predicate.sql}))${lock?' FOR UPDATE OF i':''}`,[id,...predicate.values])).rows[0];
  if(!intake)failP2016('NOT_FOUND',404);return {principal,intake};
 }
 async function assertSession(authContext:unknown,principalId:string,tx:PostgresTransaction){
  if(currentSessionPredicate&&authContext&&typeof authContext==='object'&&'auth_method' in authContext&&authContext.auth_method==='COOKIE'){
   const proof=currentSessionPredicate(authContext,principalId);
   const session=(await tx.query<{current:boolean}>('SELECT '+proof.sql+' AS current',proof.values)).rows[0];
   if(session?.current!==true)throw new WorkbenchError(WORKBENCH_ERROR_CODES.unauthenticated,401);
  }
  if(authContext&&typeof authContext==='object'&&'expires_epoch_ms' in authContext){
   let expires:string;try{expires=assertEpochMsString(authContext.expires_epoch_ms);}catch{failP2016('FORBIDDEN',403);}
   if(BigInt(expires)<=BigInt(Date.now()))failP2016('FORBIDDEN',403);
  }
 }
 async function authorizeRead(authContext:unknown,id:string,tx:PostgresTransaction){
  const current=await authorize(authContext,id,tx);await assertSession(authContext,current.principal.principal_id,tx);return current;
 }
 return Object.freeze({
  async history({authContext,subjectId,kind,beforeVersion}:{authContext:unknown;subjectId:unknown;kind:'ticket'|'intake';beforeVersion:unknown}):Promise<ClosureHistoryPage>{
   guardP2016(enabled);const id=uuidP2016(subjectId);
   const before=beforeVersion==null?null:typeof beforeVersion==='string'&&/^[1-9][0-9]{0,9}$/u.test(beforeVersion)?Number(beforeVersion):NaN;
   if(before!==null&&(!Number.isInteger(before)||before>2147483647))failP2016('CURSOR_INVALID');
   return transactionP2016(pool,async tx=>{
    await tx.query('SET TRANSACTION READ ONLY');await tx.query("SET LOCAL statement_timeout='2000ms'");
    const read=async()=>{
     if(kind==='intake'){const value=await authorizeRead(authContext,id,tx);return {principal:value.principal,version:value.intake.version};}
     const value=await query.authorizedTicket({authContext,ticketId:id,transaction:tx});
     await assertSession(authContext,value.principal.principal_id,tx);return {principal:value.principal,version:value.ticket.version};
    };
    const initial=await read();
    type Row={id:string;before_version:number;reason_code:ClosureReasonCode;secondary_reason_code:ClosureSecondaryReasonCode|null;note:string|null;duplicate_of_ref:string|null;source:'MANUAL'|'SYSTEM';closed_at:string;closed_by_display_name:string|null;restored_at:string|null;restored_by_display_name:string|null;before_status:string;effective_status:string;assignee_name:string|null;notify_reporter:boolean;notification_state:ClosureHistoryEntry['notification_state']};
    const rows=(await tx.query<Row>(`SELECT c.id::text,c.before_version,c.reason_code,c.secondary_reason_code,c.note,c.duplicate_of_ref,c.source,c.closed_at,c.notify_reporter,
     closer.display_name AS closed_by_display_name,c.restored_at,restorer.display_name AS restored_by_display_name,c.before_status,
     CASE WHEN c.before_assignee_id IS NOT NULL AND NOT COALESCE(owner_valid.valid,false) THEN 'QUEUED' ELSE c.before_status END AS effective_status,
     CASE WHEN owner_valid.valid THEN owner.display_name ELSE NULL END AS assignee_name,
     CASE WHEN delivery.sent THEN 'SENT' WHEN delivery.unknown THEN 'UNKNOWN' ELSE 'NOT_SENT' END AS notification_state
     FROM pilot_ticket.closure_record c
     LEFT JOIN pilot_ticket.pilot_principal closer ON closer.id::text=c.closed_by
     LEFT JOIN pilot_ticket.pilot_principal restorer ON restorer.id=c.restored_by
     LEFT JOIN pilot_ticket.pilot_principal owner ON owner.id=c.before_assignee_id
     LEFT JOIN LATERAL (SELECT owner.is_active AND (EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=owner.id AND r.role IN ('ADMIN','DISPATCHER'))
       OR EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r JOIN pilot_ticket.pilot_team_member m ON m.principal_id=r.principal_id JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
        WHERE r.principal_id=owner.id AND r.role='HANDLER' AND m.team_id=c.before_team_id AND rt.is_active)) AS valid) owner_valid ON true
     LEFT JOIN LATERAL (SELECT bool_or(d.status='SENT' AND d.side_effect_state='ACKNOWLEDGED' AND d.sent_epoch_ms IS NOT NULL AND EXISTS(
       SELECT 1 FROM communication.delivery_attempt a WHERE a.delivery_id=d.id AND a.attempt_no=d.attempt_count AND a.outcome='SENT' AND a.side_effect_state='ACKNOWLEDGED' AND a.completed_epoch_ms IS NOT NULL)) AS sent,
       bool_or(d.status='SENDING' OR d.side_effect_state='UNKNOWN') AS unknown
       FROM communication.outbox o JOIN communication.delivery d ON d.outbox_id=o.id WHERE o.message_id=c.notification_message_id) delivery ON true
     WHERE c.${kind==='ticket'?'ticket_id':'intake_id'}=$1::uuid AND ($2::integer IS NULL OR c.before_version<$2)
     ORDER BY c.before_version DESC LIMIT 21`,[id,before])).rows;
    const current=await read();if(current.version!==initial.version||JSON.stringify(current.principal)!==JSON.stringify(initial.principal))failP2016('VERSION_CONFLICT',409);
    const visible=rows.slice(0,20),active=before===null?visible.find(row=>row.restored_at===null):undefined;
    return {subject_id:id,version:current.version,next_before_version:rows.length>20?visible.at(-1)?.before_version??null:null,
     restore_target:active?{status:active.effective_status,column:kind==='intake'||['NEW','QUEUED','ACCEPTED','REOPENED'].includes(active.effective_status)?'pending':'active',assignee_name:active.assignee_name,notify_reporter:active.notify_reporter,notification_state:active.notification_state}:null,
     items:visible.map(row=>({id:row.id,before_version:row.before_version,reason_code:row.reason_code,reason_label:CLOSURE_REASONS[row.reason_code],secondary_reason:row.secondary_reason_code?{code:row.secondary_reason_code,label:CLOSURE_SECONDARY_REASONS[row.secondary_reason_code]}:null,
      note:row.note,duplicate_of:row.duplicate_of_ref?{display_no:row.duplicate_of_ref}:null,source:row.source,closed_at:closureRecordTime(row.closed_at),closed_by_display_name:row.closed_by_display_name,
      notification_state:row.notification_state,restored_at:row.restored_at?closureRecordTime(row.restored_at):null,restored_by_display_name:row.restored_by_display_name}))};
   });
  },
  async context({authContext,intakeId}:{authContext:unknown;intakeId:unknown}){
   guardP2016(enabled);const id=uuidP2016(intakeId);
   return transactionP2016(pool,async tx=>{
    await tx.query('SET TRANSACTION READ ONLY');const initial=await authorizeRead(authContext,id,tx);
    const record=(await tx.query<{id:string}>('SELECT id::text FROM pilot_ticket.closure_record WHERE intake_id=$1::uuid AND restored_at IS NULL',[id])).rows[0];
    const review=(await tx.query<{id:string;row_version:string}>('SELECT id::text,row_version::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status=\'PENDING\' ORDER BY created_at,id LIMIT 1',[id])).rows[0]??null;
    const {principal,intake}=await authorizeRead(authContext,id,tx);if(intake.version!==initial.intake.version)failP2016('VERSION_CONFLICT',409);
    const worker=principal.is_active&&principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role));
    if(intake.status==='DISMISSED'&&!record)failP2016('ACTION_FAILED',503);
    return {subject_id:id,version:intake.version,status:intake.status,can_close:worker&&['RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'].includes(intake.status)&&!intake.linked_ticket,can_restore:worker&&intake.status==='DISMISSED'&&Boolean(record)&&!intake.linked_ticket,closure_id:record?.id??null,pending_review:review};
   });
  },
  async acknowledgement({authContext,intakeId,commandId,restoring}:{authContext:unknown;intakeId:unknown;commandId:unknown;restoring:boolean}){
   const id=uuidP2016(intakeId),command=uuidP2016(commandId);
   return transactionP2016(pool,async tx=>{
    await tx.query('SET TRANSACTION READ ONLY');const {principal}=await authorizeRead(authContext,id,tx);
    const receipt=(await tx.query<{state:string;result_snapshot:unknown;error_code:string;retryable:boolean}>(`SELECT state,result_snapshot,error_code,retryable FROM pilot_ticket.ticket_command_receipt WHERE closure_intake_id=$1::uuid AND client_command_id=$2::uuid AND command_scope=$3 AND actor_principal_id=$4::uuid AND command_type=$5`,[id,command,'P2_016:'+principal.principal_id,principal.principal_id,restoring?'WORKBENCH_INTAKE_RESTORE':'WORKBENCH_INTAKE_CLOSE'])).rows[0];
    await authorizeRead(authContext,id,tx);
    if(!receipt||receipt.state==='STARTED')return {state:'UNKNOWN' as const};
    if(receipt.state==='FAILED')return {state:'FAILED' as const,error:{code:codeP2016(receipt.error_code),retryable:false}};
    const v=exactP2016(receipt.result_snapshot,['ok','subject_type','subject_id','version','closure_id','event_id']);if(v.ok!==true||v.subject_type!=='INTAKE'||v.subject_id!==id)failP2016('ACTION_FAILED',503);
    return {state:'COMMITTED' as const,result:{ok:true as const,subject_type:'INTAKE' as const,subject_id:id,version:versionP2016(v.version),closure_id:uuidP2016(v.closure_id),event_id:uuidP2016(v.event_id),replayed:true}};
   });
  },
  async perform({authContext,intakeId,body,restoring=false}:{authContext:unknown;intakeId:unknown;body:unknown;restoring?:boolean}){
   guardP2016(enabled);const id=uuidP2016(intakeId),v=exactP2016(body,restoring?['client_command_id','expected_version','reason_code']:['client_command_id','expected_version','reason_code','secondary_reason_code','note','duplicate_of_ref','notify_reporter','expected_review_version','expected_material_basis'],['client_command_id','expected_version','reason_code']);
   if(v.expected_review_version!==undefined&&(typeof v.expected_review_version!=='string'||!/^[1-9][0-9]{0,18}$/u.test(v.expected_review_version)||BigInt(v.expected_review_version)>9223372036854775807n))failP2016();
   if(v.expected_material_basis!==undefined&&(typeof v.expected_material_basis!=='string'||!/^[a-f0-9]{64}$/u.test(v.expected_material_basis)))failP2016();
   const closure=restoring?null:normalizeClosingInput(Object.fromEntries(['reason_code','secondary_reason_code','note','duplicate_of_ref','notify_reporter'].filter(key=>Object.hasOwn(v,key)).map(key=>[key,v[key]])));
   if(restoring&&v.reason_code!=='RESTORE_CLOSED')failP2016();
   const command={...v,client_command_id:uuidP2016(v.client_command_id),expected_version:versionP2016(v.expected_version),source_intake_id:id,action:restoring?'INTAKE_RESTORE':'INTAKE_CLOSE'};
   return ledger.execute({command,receiptType:restoring?'WORKBENCH_INTAKE_RESTORE':'WORKBENCH_INTAKE_CLOSE',authorize:async tx=>{await authorize(authContext,id,tx);await realtime.lock(tx);return authorize(authContext,id,tx);},
    afterReceiptLock:tx=>authorize(authContext,id,tx),run:async tx=>{
     const {intake}=await authorize(authContext,id,tx,true);
     await tx.query(`SELECT p.id FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id WHERE p.id=(SELECT actor_principal_id FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid) AND p.is_active ORDER BY r.role FOR SHARE OF p,r`,['P2_016:'+(await query.principal(authContext,tx)).principal_id,command.client_command_id]);
     const {principal}=await authorize(authContext,id,tx);
     if(!principal.is_active||!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))failP2016('FORBIDDEN',403);
     if(intake.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
     if(intake.linked_ticket)failP2016('ACTION_FAILED',409);
     if(restoring){
      if(intake.status!=='DISMISSED')failP2016('ACTION_FAILED',409);
      const record=await currentClosure(tx,'INTAKE',id,true),snapshot=record.before_snapshot;
      if(!['RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'].includes(record.before_status))failP2016('ACTION_FAILED',503);
      await tx.query('UPDATE intake.service_intake SET status=$2,request_type=$3,version=version+1,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid',[id,record.before_status,snapshot.request_type??intake.request_type]);
      if(Array.isArray(snapshot.journeys))for(const j of snapshot.journeys){
       if(!j||typeof j!=='object'||typeof j.id!=='string'||typeof j.status!=='string')failP2016('ACTION_FAILED',503);
       await tx.query('UPDATE intake.contact_journey SET status=$2,ended_at=$3::timestamp,row_version=row_version+1,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid AND linked_ticket_id IS NULL',[j.id,j.status,j.ended_at??null]);
      }
      if(Array.isArray(snapshot.reviews))for(const r of snapshot.reviews){
       if(!r||typeof r!=='object'||typeof r.id!=='string'||r.status!=='PENDING')failP2016('ACTION_FAILED',503);
       await tx.query(`UPDATE intake.manual_review_item SET status='PENDING',row_version=row_version+1,resolution_command_id=NULL,resolution_command_hash=NULL,resolution_code=NULL,resolution_reason_code=NULL,resolved_by_principal_id=NULL,resolution_decision_id=NULL,resolved_at=NULL,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid AND service_intake_id=$2::uuid`,[r.id,id]);
       await realtime.review({transaction:tx,reviewId:r.id});
      }
      const event=await appendIntakeClosureEvent(tx,{intakeId:id,version:intake.version+1,type:'intake.restored',oldStatus:'DISMISSED',newStatus:record.before_status,actor:principal.principal_id,traceId:'closure:'+command.client_command_id});
      await markClosureRestored(tx,record,principal.principal_id,event);await notifications.projectClosure({transaction:tx,recordId:record.id,restoring:true});
      return {ok:true as const,subject_type:'INTAKE' as const,subject_id:id,version:intake.version+1,closure_id:record.id,event_id:event};
     }
     if(!closure||!['RECEIVED','WAITING_DESCRIPTION','WAITING_TRIAGE','FAILED'].includes(intake.status))failP2016('ACTION_FAILED',409);
     if(closure.duplicate_of_ref){const predicate=ticketPredicateP2016(principal,2);if(!(await tx.query(`SELECT t.id FROM pilot_ticket.ticket t WHERE t.ticket_no=$1 AND ${predicate.sql}`,[closure.duplicate_of_ref,...predicate.values])).rowCount)failP2016('NOT_FOUND',404);}
     const snapshot=await intakeClosureSnapshot(tx,id);
     const pending=Array.isArray(snapshot.reviews)?snapshot.reviews:[];
     if(pending.length){
      const canonical=pending[0];if(!canonical||typeof canonical!=='object'||canonical.row_version!==v.expected_review_version)failP2016('VERSION_CONFLICT',409);
      for(const review of pending){
       if(!review||typeof review!=='object'||typeof review.id!=='string'||typeof review.row_version!=='string')failP2016('ACTION_FAILED',503);
       const scopeClosure=closure.reason_code==='NOT_IT_SCOPE'&&review===canonical;
       const result=await reviews.resolveManualReviewInTransaction({authContext,reviewId:review.id,transaction:tx,body:{client_command_id:command.client_command_id,expected_row_version:review.row_version,
        resolution_code:scopeClosure?'MARK_OUT_OF_SCOPE':'CANCEL_REVIEW',resolution_reason_code:scopeClosure?closure.secondary_reason_code:closure.reason_code,
        ...(scopeClosure?closure:{}),...(typeof v.expected_material_basis==='string'?{expected_material_basis:v.expected_material_basis}:{})}});
       if(!result.ok)failP2016('ACTION_FAILED',409);
      }
      if(closure.reason_code==='NOT_IT_SCOPE'){
       const record=await currentClosure(tx,'INTAKE',id,true);if(!record.closure_intake_event_id)failP2016('ACTION_FAILED',503);
       return {ok:true as const,subject_type:'INTAKE' as const,subject_id:id,version:intake.version+1,closure_id:record.id,event_id:record.closure_intake_event_id};
      }
     }else if(v.expected_review_version!==undefined||v.expected_material_basis!==undefined)failP2016('VERSION_CONFLICT',409);
     await tx.query("UPDATE intake.service_intake SET status='DISMISSED',version=version+1,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid",[id]);
     const event=await appendIntakeClosureEvent(tx,{intakeId:id,version:intake.version+1,type:'intake.dismissed',oldStatus:intake.status,newStatus:'DISMISSED',actor:principal.principal_id,traceId:'closure:'+command.client_command_id});
     const record=await insertClosureRecord({transaction:tx,subjectType:'INTAKE',subjectId:id,beforeStatus:intake.status,beforeVersion:intake.version,beforeSnapshot:{...snapshot,request_type:intake.request_type},actor:principal.principal_id,source:'MANUAL',input:closure,intakeEventId:event});
     if(Array.isArray(snapshot.journeys))for(const j of snapshot.journeys){if(!j||typeof j!=='object'||typeof j.id!=='string')failP2016('ACTION_FAILED',503);await tx.query("UPDATE intake.contact_journey SET status='ENDED',ended_at=GREATEST(last_activity_at,platform.local_now()),row_version=row_version+1,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid AND linked_ticket_id IS NULL AND status<>'ENDED'",[j.id]);}
     await notifications.projectClosure({transaction:tx,recordId:record.id});
     return {ok:true as const,subject_type:'INTAKE' as const,subject_id:id,version:intake.version+1,closure_id:record.id,event_id:event};
    }});
  },
 });
}
