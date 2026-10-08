import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {ManualReportCommand,ManualReportResult} from '../contracts/workbench_manual_report_contracts.js';
import {createPilotTicketCore} from './p1-005-pilot-ticket-core.mjs';
import {appendTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {createRuleEngine} from './p2-007-rule-engine.mjs';
import {createDecisionStore} from './p2-015-decision-store.mjs';
import {createManualReviewStore} from './p2-015-manual-review.mjs';
import {createServiceIntakeDecisionPort} from './p2-015-service-intake-decision-port.mjs';
import {createSafeActionExecutor} from './p2-015-safe-action-executor.mjs';
import {routeP2007Decision,routeRuleFailure} from './p2-015-decision-router.mjs';
import type {SafeRoute} from './p2-015-decision-router.mjs';
import {safeHash} from './p2-015-domain-contracts.mjs';
import {failP2016,guardP2016,exactP2016,uuidP2016,publicP2016,stampP2016} from './p2-016-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import type {LocalDateTime} from '../contracts/time_contracts.js';
import type {TicketStatus} from './p1-005-pilot-ticket-core.mjs';
import type {createP2016RealtimeProjector} from './p2-016-realtime-projector.mjs';
type HttpContext=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
type Realtime=Pick<ReturnType<typeof createP2016RealtimeProjector>,'lock'|'ticket'|'review'>;
interface Options {pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean;realtimeProjector?:Realtime|null}
function text(value:unknown,max:number,multiline=false):string{
  if(typeof value!=='string'||(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u:/[\u0000-\u001f\u007f]/u).test(value))failP2016();
  const result=value.trim();if(!result||[...result].length>max)failP2016();return result;
}
export function manualReportCommand(input:unknown):ManualReportCommand{
  const v=exactP2016(input,['schema_version','client_command_id','source','description','location','reporter']);
  if(v.schema_version!==1||(v.source!=='PHONE'&&v.source!=='ON_SITE'))failP2016();
  const location=exactP2016(v.location,['text','unknown']),reporter=exactP2016(v.reporter,['verification','name','contact','department']);
  if(typeof location.unknown!=='boolean'||location.unknown&&location.text!==null||reporter.verification!=='UNVERIFIED')failP2016();
  return publicP2016({schema_version:1,client_command_id:uuidP2016(v.client_command_id),source:v.source,description:text(v.description,4000,true),
    location:{unknown:location.unknown,text:location.unknown?null:text(location.text,200)},
    reporter:{verification:'UNVERIFIED',name:text(reporter.name,100),contact:text(reporter.contact,100),department:reporter.department===null?null:text(reporter.department,100)}});
}
export async function manualReportsSchemaReady(pool:PostgresTransaction){
  try{return (await pool.query("SELECT migration_id FROM platform.schema_migration WHERE migration_id IN ('033_yxx_self_service_intake','042_workbench_manual_reports')")).rowCount===2;}catch{return false;}
}
export function createWorkbenchManualReports({pool,query,enabled=false,realtimeProjector=null}:Options){
  const ledger=createP2016CommandLedger({pool}),core=createPilotTicketCore({pool});
  const decisions=createDecisionStore({webSource:true,manualSource:true}),reviews=createManualReviewStore({webSource:true}),intakes=createServiceIntakeDecisionPort();
  async function authorize(authContext:unknown,transaction:PostgresTransaction){
    guardP2016(enabled);if(!await manualReportsSchemaReady(transaction))failP2016('ACTION_FAILED',503);
    const principal=await query.principal(authContext,transaction);
    if(!principal.is_active)failP2016('FORBIDDEN',403);
    if(!principal.roles.some(role=>['ADMIN','DISPATCHER'].includes(role))){
      if(!principal.roles.includes('HANDLER'))failP2016('FORBIDDEN',403);
      const membership=await transaction.query('SELECT 1 FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team t ON t.team_id=m.team_id WHERE m.principal_id=$1::uuid AND t.is_active LIMIT 1',[principal.principal_id]);
      if(!membership.rowCount)failP2016('FORBIDDEN',403);
    }
    return {principal};
  }
  async function admit(tx:PostgresTransaction,principal:WorkbenchPrincipal,command:ManualReportCommand):Promise<Omit<ManualReportResult,'replayed'>>{
    await realtimeProjector?.lock(tx);
    const stamp=stampP2016(),retentionEpoch=String(BigInt(stamp.epoch)+30n*86400000n),retention=formatEpochMsToShanghaiLocal(retentionEpoch);
    const snapshot={source:command.source,description:command.description,location:command.location,reporter:command.reporter,identity_source:'HAND_ENTERED',manual_contact_required:true,external_notification:false};
    const receipt=(await tx.query<{id:string}>("SELECT id::text FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND command_type='WORKBENCH_MANUAL_REPORT'",['P2_016:'+principal.principal_id,command.client_command_id])).rows[0];if(!receipt)failP2016('ACTION_FAILED',503);
    const intake=(await tx.query<{id:string;intake_no:string}>(`WITH number AS (SELECT nextval('intake.service_intake_number_seq')::text AS n)
      INSERT INTO intake.service_intake(intake_no,source_channel,source_provider,source_bot_id,source_chat_type,reporter_wecom_userid,primary_message_id,
        explicit_aggregation_boundary,privacy_class,retention_until,retention_until_epoch_ms,request_type,summary,reported_location_text,status,last_message_at,
        manual_report_snapshot,manual_actor_principal_id,manual_command_receipt_id)
      SELECT 'INT-'||to_char($1::timestamp without time zone,'YYYYMMDD')||'-'||lpad(n,GREATEST(4,char_length(n)),'0'),
        'MANUAL','STAFF_MANUAL_REPORT',NULL,NULL,NULL,NULL,true,'PERSONAL',$2::timestamp without time zone,$3::bigint,'UNKNOWN',$4,$5,'RECEIVED',$1::timestamp without time zone,$6::jsonb,$7::uuid,$8::uuid
      FROM number RETURNING id::text,intake_no`,[stamp.local,retention,retentionEpoch,command.description.slice(0,500),command.location.text,JSON.stringify(snapshot),principal.principal_id,receipt.id])).rows[0];if(!intake)failP2016('ACTION_FAILED',503);
    const trace='manual:'+intake.id;
    await tx.query(`INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
      VALUES('intake.received','intake',$1::uuid,1,1,$2::timestamp without time zone,$3,$4::jsonb)`,[intake.id,stamp.local,trace,JSON.stringify({intake_id:intake.id,source_channel:'MANUAL',source:command.source,actor_principal_id:principal.principal_id,reporter_verification:'UNVERIFIED',manual_contact_required:true})]);
    // This hash identifies this independent contact/source scope only. It is
    // never a verified Person, member binding or matching key for name/phone.
    const contactScope=safeHash({source:'STAFF_MANUAL_REPORT',intake_id:intake.id}),profile={source:'HAND_ENTERED',version:'1',verification:'UNVERIFIED',manual_contact_required:true};
    const journey=(await tx.query<{id:string}>(`INSERT INTO intake.contact_journey(creation_key,origin_intake_id,entry_mode,origin_channel,current_channel,reporter_identity_hash,
      profile_resolution_status,profile_snapshot,profile_snapshot_hash,status,evaluation_due_at,evaluation_due_epoch_ms,reported_at,last_activity_at,privacy_class,retention_until,retention_until_epoch_ms)
      VALUES($1,$2::uuid,'STAFF_MANUAL_REPORT','MANUAL','MANUAL',$3,'NOT_REQUIRED',$4::jsonb,$5,'OPEN',$6::timestamp without time zone,$7::bigint,$6::timestamp without time zone,$6::timestamp without time zone,'PERSONAL',$8::timestamp without time zone,$9::bigint) RETURNING id::text`,
    [trace,intake.id,contactScope,JSON.stringify(profile),safeHash(profile),stamp.local,stamp.epoch,retention,retentionEpoch])).rows[0];if(!journey)failP2016('ACTION_FAILED',503);
    const leg=(await tx.query<{id:string}>(`INSERT INTO intake.channel_leg(journey_id,leg_ordinal,leg_type,source_intake_id,provider_context_hash,channel_identity_hash,reporter_identity_hash,status,opened_at)
      VALUES($1::uuid,1,'MANUAL_REPORT',$2::uuid,$3,$4,$5,'OPEN',$6::timestamp without time zone) RETURNING id::text`,[journey.id,intake.id,safeHash({source:'STAFF_MANUAL_REPORT'}),safeHash({source:command.source,intake_id:intake.id}),contactScope,stamp.local])).rows[0];if(!leg)failP2016('ACTION_FAILED',503);
    const context={service_intake_id:intake.id,journey_ref:journey.id,safe_normalized_text:command.description,input_hash:safeHash(snapshot),source_refs:[trace],message_sequence_window:{start:1,end:1,count:1},delivery_mode:'APP_ONLY'};
    let route:SafeRoute;
    try{route=routeP2007Decision(createRuleEngine().evaluate({text:command.description,source_ref:trace,source_kind:'USER_TEXT',observed_at:stamp.local,occurrence_location:command.location.text}),context);}catch{route=routeRuleFailure(context);}
    const decision=await decisions.record({transaction:tx,input:{...route,journey_id:journey.id,channel_leg_id:leg.id,service_intake_id:intake.id,source_kind:'MANUAL',
      source_window_start_sequence:1,source_window_end_sequence:1,source_message_count:1,source_hash:safeHash(snapshot),safe_result:route,requires_manual_review:route.manual_review_required,
      ticket_creation_recommended:route.ticket_creation_recommended,incident_review_candidate:route.incident_review_candidate,observed_at:stamp.local as LocalDateTime}});
    const executor=createSafeActionExecutor({decisionStore:decisions,manualReviewStore:reviews,intakeDecisionPort:intakes,ticketCommandPort:{async createMinimalTicket({transaction,intake_id,occurred_at,trace_id}){
      const created=await core.createForIntakeInTransaction({transaction,intakeId:intake_id,occurredAt:occurred_at,traceId:trace_id,title:command.description.slice(0,200)});
      if(created.created){const event=await appendTicketEvent({transaction,ticket:created.ticket,eventType:'ticket.created',actor:{type:'PILOT_USER',id:principal.principal_id},traceId:trace_id});await realtimeProjector?.ticket({transaction,ticket:created.ticket,event});}return created;
    }}});
    await executor.execute({transaction:tx,decision,context:{trace_id:trace,privacy_class:'PERSONAL',retention_until:retention,retention_until_epoch_ms:retentionEpoch}});
    const ticket=(await tx.query<{id:string;number:string;status:TicketStatus}>(`SELECT id::text,ticket_no AS number,status FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid`,[intake.id])).rows[0]??null;
    const review=(await tx.query<{id:string;status:'PENDING'}>(`SELECT id::text,status FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status='PENDING' ORDER BY created_at,id LIMIT 1`,[intake.id])).rows[0]??null;
    if(review)await realtimeProjector?.review({transaction:tx,reviewId:review.id});
    await authorize({principal_id:principal.principal_id},tx);
    return publicP2016({ok:true,client_command_id:command.client_command_id,intake_id:intake.id,intake_no:intake.intake_no,source:command.source,reporter_verification:'UNVERIFIED',manual_contact_required:true,external_notification:false,result_code:route.result_code,ticket,review});
  }
  return Object.freeze({
    async handler({request,response,url,authContext,readJson,validateWriteRequest,json}:HttpContext){
      if(url.pathname!=='/api/workbench/reports')return false;guardP2016(enabled);if(request.method!=='POST')failP2016('NOT_FOUND',404);if(url.searchParams.size)failP2016();
      const body=await readJson(request);if(Buffer.byteLength(JSON.stringify(body),'utf8')>16*1024)failP2016('BODY_TOO_LARGE',413);validateWriteRequest(request,authContext,body,{sessionMutation:false});
      const command=manualReportCommand(body),result=await ledger.execute({command:{...command,action:'manual-report'},receiptType:'WORKBENCH_MANUAL_REPORT',authorize:tx=>authorize(authContext,tx),run:(tx,{principal})=>admit(tx,principal,command)});
      json(response,result.ok===false?503:result.replayed?200:202,result);return true;
    },
  });
}
