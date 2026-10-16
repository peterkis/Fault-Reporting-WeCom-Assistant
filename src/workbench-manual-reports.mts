import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {WorkbenchHttpOptions} from './p2-006-workbench-http.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {ManualReportCommand,ManualReportResult,ManualReportReceipt,ManualReportCapabilities} from '../contracts/workbench_manual_report_contracts.js';
import {createPilotTicketCore,isTicketStatus} from './p1-005-pilot-ticket-core.mjs';
import {appendTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {createManualReportRulePolicy} from './workbench-manual-report-policy.mjs';
import {manualReportFields} from './workbench-manual-report-source.mjs';
import {createDecisionStore} from './p2-015-decision-store.mjs';
import {createManualReviewStore} from './p2-015-manual-review.mjs';
import {createServiceIntakeDecisionPort} from './p2-015-service-intake-decision-port.mjs';
import {createSafeActionExecutor} from './p2-015-safe-action-executor.mjs';
import {routeRuleFailure} from './p2-015-decision-router.mjs';
import type {SafeRoute} from './p2-015-decision-router.mjs';
import {safeHash,P2_015_RESULT_CODES} from './p2-015-domain-contracts.mjs';
import {failP2016,guardP2016,exactP2016,uuidP2016,publicP2016,stampP2016,transactionP2016,P2016_ERROR_CODES,hashP2016} from './p2-016-domain-contracts.mjs';
import {formatEpochMsToShanghaiLocal} from './platform/time-contract.mjs';
import type {LocalDateTime} from '../contracts/time_contracts.js';
import type {TicketStatus} from './p1-005-pilot-ticket-core.mjs';
import type {createP2016RealtimeProjector} from './p2-016-realtime-projector.mjs';
import type {ManualReporterDirectoryOptions,VerifiedManualReportCommand,VerifiedManualReportResult,ManualReporterAdmissionEnvelope,VerifiedManualReportRejection} from '../contracts/workbench_reporter_candidates_contracts.js';
import type {YxxMemberScope} from './yxx-self-service-authorization.mjs';
import {createWorkbenchReporterCandidates} from './workbench-reporter-candidates.mjs';
import {WorkbenchError} from './p2-006-workbench-query.mjs';
import type {ManualReportSelfHandlingCommand,ManualReportSelfHandlingContext} from '../contracts/workbench_manual_report_self_handling_contracts.js';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import {selfHandlingSchemaReady,selfHandlingEligibility,performFirstTicketResponsibilityInTransaction} from './workbench-ticket-self-handling.mjs';
import {verifiedManualReportCommand,retainedReporterTarget} from './workbench-reporter-verification.mjs';
class ConfirmedReporterRejection extends WorkbenchError {
  constructor(status:number,readonly rejection:VerifiedManualReportRejection){super(rejection.error.code,status);}
}
type HttpContext=Parameters<NonNullable<WorkbenchHttpOptions['authenticatedHandler']>>[0];
type Realtime=Pick<ReturnType<typeof createP2016RealtimeProjector>,'lock'|'ticket'|'review'>;
interface Options {pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean;selfHandlingEnabled?:boolean;selfHandlingHooks?:Omit<SelfHandlingHooks,'realtimeProjector'>;draftRecoveryEnabled?:boolean;reporterCandidatesEnabled?:boolean;reporterDirectory?:ManualReporterDirectoryOptions|null;realtimeProjector?:Realtime|null}
type AdmissionCommand=ManualReportCommand|VerifiedManualReportCommand;
type AdmissionResult=ManualReportResult|VerifiedManualReportResult;
type AdmissionReceipt=Exclude<ManualReportReceipt,{state:'COMMITTED'}>|{client_command_id:string;state:'COMMITTED';result:AdmissionResult&{replayed:true}};
export function manualReportCommand(input:unknown):ManualReportCommand{
  const v=exactP2016(input,['schema_version','client_command_id','source','description','location','reporter']);
  if(v.schema_version!==1)failP2016();
  return publicP2016({schema_version:1,client_command_id:uuidP2016(v.client_command_id),...manualReportFields({source:v.source,description:v.description,location:v.location,reporter:v.reporter})});
}
export function manualReportSelfHandlingCommand(input:unknown):ManualReportSelfHandlingCommand{
  const v=exactP2016(input,['schema_version','client_command_id','source','description','location','reporter','resolver_team_id']);
  const {resolver_team_id,...base}=v;
  if(typeof resolver_team_id!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(resolver_team_id))failP2016();
  return publicP2016({...manualReportCommand(base),resolver_team_id});
}
export async function manualReportsSchemaReady(pool:PostgresTransaction){
  try{return (await pool.query("SELECT migration_id FROM platform.schema_migration WHERE migration_id IN ('033_yxx_self_service_intake','042_workbench_manual_reports')")).rowCount===2;}catch{return false;}
}
function manualExcerpt(value:string,maximum:number){
  let result='';for(const character of value){if(result.length+character.length>maximum)break;result+=character;}return result;
}
function storedResult(input:unknown,commandId:string):AdmissionResult&{replayed:true}{
  try{
    const keys=['ok','client_command_id','intake_id','intake_no','source','reporter_verification','manual_contact_required','external_notification','result_code','ticket','review'];
    const candidate=exactP2016(input,[...keys,'notification_eligibility'],keys),verified=candidate.reporter_verification==='VERIFIED';
    const v=exactP2016(candidate,verified?[...keys,'notification_eligibility']:keys);
    const resultCode=P2_015_RESULT_CODES.find(code=>code===v.result_code);
    if(v.ok!==true||uuidP2016(v.client_command_id)!==commandId||typeof v.intake_no!=='string'||!/^INT-[0-9]{8}-[0-9]{4,}$/u.test(v.intake_no)
      ||(v.source!=='PHONE'&&v.source!=='ON_SITE')||(!verified&&(v.reporter_verification!=='UNVERIFIED'||v.manual_contact_required!==true))
      ||verified&&((v.notification_eligibility!=='ELIGIBLE'&&v.notification_eligibility!=='NOT_REACHABLE')||v.manual_contact_required!==(v.notification_eligibility!=='ELIGIBLE'))
      ||v.external_notification!==false||!resultCode)failP2016();
    const ticket=v.ticket===null?null:exactP2016(v.ticket,['id','number','status']);
    if(ticket&&(typeof ticket.number!=='string'||!/^IT-[0-9]{8}-[0-9]{4,}$/u.test(ticket.number)||!isTicketStatus(ticket.status)))failP2016();
    const review=v.review===null?null:exactP2016(v.review,['id','status']);if(review&&review.status!=='PENDING')failP2016();
    const base:Omit<ManualReportResult,'reporter_verification'|'manual_contact_required'|'replayed'>&{replayed:true}={ok:true,client_command_id:commandId,intake_id:uuidP2016(v.intake_id),intake_no:v.intake_no,source:v.source,
      external_notification:false as const,result_code:resultCode,
      ticket:ticket?{id:uuidP2016(ticket.id),number:ticket.number as string,status:ticket.status as TicketStatus}:null,
      review:review?{id:uuidP2016(review.id),status:'PENDING' as const}:null,replayed:true as const};
    if(verified){if(v.notification_eligibility!=='ELIGIBLE'&&v.notification_eligibility!=='NOT_REACHABLE')failP2016();
      return publicP2016({...base,reporter_verification:'VERIFIED',manual_contact_required:v.notification_eligibility!=='ELIGIBLE',notification_eligibility:v.notification_eligibility});}
    return publicP2016({...base,reporter_verification:'UNVERIFIED',manual_contact_required:true});
  }catch{failP2016('ACTION_FAILED',503);}
}
export function createWorkbenchManualReports({pool,query,enabled=false,selfHandlingEnabled=false,selfHandlingHooks={},draftRecoveryEnabled=false,reporterCandidatesEnabled=false,reporterDirectory=null,realtimeProjector=null}:Options){
  if(typeof enabled!=='boolean'||typeof selfHandlingEnabled!=='boolean'||typeof draftRecoveryEnabled!=='boolean'||typeof reporterCandidatesEnabled!=='boolean')failP2016('FLAG_INVALID',503);
  const reporterCandidates=createWorkbenchReporterCandidates({enabled:enabled&&reporterCandidatesEnabled,directory:reporterDirectory});
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
  async function capabilities(authContext:unknown):Promise<ManualReportCapabilities>{
    return transactionP2016(pool,async tx=>{await tx.query('SET TRANSACTION READ ONLY');await authorize(authContext,tx);
      return publicP2016({can_create:true,manual_contact_required:true,external_notification:false,draft_recovery_enabled:draftRecoveryEnabled});});
  }
  async function currentAuthentication(authContext:unknown,tx:PostgresTransaction,lock=false){
    if(!authContext||typeof authContext!=='object'||Array.isArray(authContext))failP2016('FORBIDDEN',403);
    const context=authContext as Record<string,unknown>,expiry=context.expires_epoch_ms;
    if(typeof expiry!=='string'||!/^[1-9][0-9]{0,18}$/u.test(expiry)||BigInt(expiry)>9223372036854775807n)failP2016('FORBIDDEN',403);
    const principal=uuidP2016(context.principal_id);
    const current=context.session_id===undefined
      ?await tx.query('SELECT 1 WHERE $1::bigint>platform.physical_epoch_ms()',[expiry])
      :await tx.query(`SELECT session_id FROM pilot_ticket.workbench_auth_session
        WHERE session_id=$1::uuid AND principal_id=$2::uuid AND state='ACTIVE'
          AND expires_epoch_ms>platform.physical_epoch_ms() AND $3::bigint>platform.physical_epoch_ms()${lock?' FOR SHARE':''}`,
      [uuidP2016(context.session_id),principal,expiry]);
    if(current.rowCount!==1)failP2016('FORBIDDEN',403);
    // PostgreSQL may evaluate the physical-time predicate before a row-lock
    // wait. Recheck in a new statement while holding the unchanged session row.
    if(lock)await currentAuthentication(authContext,tx);
  }
  async function currentCreationAuthority(authContext:unknown,tx:PostgresTransaction){
    await authorize(authContext,tx);await currentAuthentication(authContext,tx);
    const context=authContext as Record<string,unknown>;
    const current=await tx.query(`SELECT 1 FROM pilot_ticket.pilot_principal p
      WHERE p.id=$1::uuid AND p.is_active AND $3::bigint>platform.physical_epoch_ms()
        AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id
          AND (r.role IN ('ADMIN','DISPATCHER') OR r.role='HANDLER' AND EXISTS(
            SELECT 1 FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team t ON t.team_id=m.team_id
            WHERE m.principal_id=p.id AND t.is_active)))
        AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM pilot_ticket.workbench_auth_session s
          WHERE s.session_id=$2::uuid AND s.principal_id=p.id AND s.state='ACTIVE'
            AND s.expires_epoch_ms>platform.physical_epoch_ms()))`,
    [uuidP2016(context.principal_id),context.session_id===undefined?null:uuidP2016(context.session_id),context.expires_epoch_ms]);
    if(current.rowCount!==1)failP2016('FORBIDDEN',403);
  }
  async function authorizeSelfHandling(authContext:unknown,transaction:PostgresTransaction,teamId?:string,lock=false){
    guardP2016(enabled&&selfHandlingEnabled);
    await currentAuthentication(authContext,transaction);
    if(!await selfHandlingSchemaReady(transaction))failP2016('SELF_HANDLING_UNAVAILABLE',503);
    const {principal}=await authorize(authContext,transaction);
    const teams=await transaction.query<{id:string;name:string}>(`SELECT rt.team_id AS id,rt.display_name AS name
      FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
      JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
      WHERE p.id=$1::uuid AND p.is_active AND rt.is_active AND r.role IN ('ADMIN','DISPATCHER','HANDLER')
        AND ($2::text IS NULL OR rt.team_id=$2) ORDER BY rt.team_id,r.role LIMIT 301${lock?' FOR SHARE OF p,r,m,rt':''}`,
    [principal.principal_id,teamId??null]);
    if(teamId&&!teams.rowCount)failP2016('FORBIDDEN',403);
    const current=await authorize(authContext,transaction);
    if(current.principal.principal_id!==principal.principal_id)failP2016('FORBIDDEN',403);
    await currentAuthentication(authContext,transaction);
    return {principal:current.principal,teams:[...new Map(teams.rows.map(team=>[team.id,team])).values()]};
  }
  async function selfHandlingContext(authContext:unknown,teamId?:string):Promise<ManualReportSelfHandlingContext>{
    return transactionP2016(pool,async tx=>{
      await tx.query('SET TRANSACTION READ ONLY');const {teams}=await authorizeSelfHandling(authContext,tx,teamId);
      if(teams.length>100)failP2016('LIMIT_INVALID',503);
      return publicP2016({can_take_and_start:teams.length>0,resolver_teams:teams,manual_contact_required:true,external_notification:false,draft_recovery_enabled:draftRecoveryEnabled});
    });
  }
  const currentPrincipal=(authContext:unknown)=>transactionP2016(pool,async tx=>{await tx.query('SET TRANSACTION READ ONLY');return (await authorize(authContext,tx)).principal;});
  async function committedTarget(tx:PostgresTransaction,principal:WorkbenchPrincipal,command:VerifiedManualReportCommand):Promise<YxxMemberScope|null>{
    const row=(await tx.query<{state:string;hash:string;purpose:string;proof:unknown}>(`SELECT r.state,r.command_type AS purpose,r.command_hash AS hash,i.manual_reporter_verification AS proof
      FROM pilot_ticket.ticket_command_receipt r LEFT JOIN intake.service_intake i ON i.manual_command_receipt_id=r.id
      AND i.source_channel='MANUAL' AND i.source_provider='STAFF_MANUAL_REPORT' AND i.manual_actor_principal_id=r.actor_principal_id
      AND i.retention_until>platform.local_now() AND r.command_type='WORKBENCH_MANUAL_REPORT'
      WHERE r.command_scope=$1 AND r.client_command_id=$2::uuid AND r.actor_principal_id=$3::uuid LIMIT 1`,
    ['P2_016:'+principal.principal_id,command.client_command_id,principal.principal_id])).rows[0];
    if(row&&(row.purpose!=='WORKBENCH_MANUAL_REPORT'||row.hash!==hashP2016({...command,action:'manual-report'})))failP2016('COMMAND_CONFLICT',409);
    return row?.state==='COMMITTED'?retainedReporterTarget(row.proof,principal.principal_id,command.reporter):null;
  }
  async function verifyForCommand(authContext:unknown,command:VerifiedManualReportCommand){
    guardP2016(reporterCandidatesEnabled);
    const before=await transactionP2016(pool,async tx=>{await tx.query('SET TRANSACTION READ ONLY');const {principal}=await authorize(authContext,tx);
      if((await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('045_workbench_verified_manual_reports','051_workbench_verified_manual_report_candidate_ref_check')")).rowCount!==2)failP2016('ACTION_FAILED',503);
      return {principal,target:await committedTarget(tx,principal,command)};});
    const outcome=await reporterCandidates.verify(before.principal.principal_id,command.reporter,before.target).then(value=>({ok:true as const,value}),(error:unknown)=>({ok:false as const,error}));
    const after=await currentPrincipal(authContext);if(after.principal_id!==before.principal.principal_id)failP2016('FORBIDDEN',403);
    try{
      if(!outcome.ok)throw outcome.error;
      reporterCandidates.fence(after.principal_id,command.reporter,outcome.value,before.target);
      return {principalId:after.principal_id,target:before.target,verification:outcome.value};
    }catch(error){
      // An object-read refusal must never reveal or replace an existing commit.
      if(before.target!==null)throw error;
      const failed=await ledger.execute({command:{...command,action:'manual-report'},receiptType:'WORKBENCH_MANUAL_REPORT',authorize:async tx=>{
        const context=await authorize(authContext,tx);if(context.principal.principal_id!==after.principal_id)failP2016('FORBIDDEN',403);return context;
      },run:async()=>{throw error;}});
      // A concurrent original commit wins the same ledger lock. Its result is
      // deliberately not returned through a rejected Directory selection.
      if(failed.ok!==false||failed.error.retryable!==false||!P2016_ERROR_CODES.includes(failed.error.code))throw error;
      const current=await currentPrincipal(authContext);if(current.principal_id!==after.principal_id)failP2016('FORBIDDEN',403);
      const rejection:VerifiedManualReportRejection={error:{code:failed.error.code,retryable:false},receipt:{client_command_id:command.client_command_id,state:'FAILED',error:{code:failed.error.code,retryable:false}}};
      throw new ConfirmedReporterRejection(error instanceof WorkbenchError?error.status:503,rejection);
    }
  }
  async function receipt(authContext:unknown,commandId:string):Promise<AdmissionReceipt>{
    guardP2016(draftRecoveryEnabled);
    return transactionP2016(pool,async tx=>{
      await tx.query('SET TRANSACTION READ ONLY');await currentAuthentication(authContext,tx);const {principal}=await authorize(authContext,tx);
      const row=(await tx.query<{state:unknown;result:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_snapshot AS result,error_code AS error,retryable
        FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND command_type='WORKBENCH_MANUAL_REPORT' LIMIT 1`,
      ['P2_016:'+principal.principal_id,commandId])).rows[0];
      const base={client_command_id:commandId};
      const current=await authorize(authContext,tx);if(current.principal.principal_id!==principal.principal_id)failP2016('FORBIDDEN',403);
      await currentCreationAuthority(authContext,tx);
      if(!row||row.state==='STARTED')return publicP2016({...base,state:'UNKNOWN'});
      if(row.state==='FAILED'&&row.retryable===false&&typeof row.error==='string'&&P2016_ERROR_CODES.includes(row.error))return publicP2016({...base,state:'FAILED',error:{code:row.error,retryable:false}});
      if(row.state==='COMMITTED')return publicP2016({...base,state:'COMMITTED',result:storedResult(row.result,commandId)});
      failP2016('ACTION_FAILED',503);
    });
  }
  async function admit(tx:PostgresTransaction,authContext:unknown,principal:WorkbenchPrincipal,command:AdmissionCommand,verification:ManualReporterAdmissionEnvelope|null=null,resolverTeamId?:string):Promise<Omit<ManualReportResult,'replayed'>|Omit<VerifiedManualReportResult,'replayed'>>{
    if((command.reporter.verification==='VERIFIED_SELECTION')!==(verification!==null))failP2016('ACTION_FAILED',503);
    if(verification&&command.reporter.verification==='VERIFIED_SELECTION')reporterCandidates.fence(principal.principal_id,command.reporter,verification,null);
    await realtimeProjector?.lock(tx);
    const stamp=stampP2016(),retentionEpoch=String(BigInt(stamp.epoch)+30n*86400000n),retention=formatEpochMsToShanghaiLocal(retentionEpoch);
    const eligibility=verification?.proof.reachability.status==='REACHABLE'?'ELIGIBLE' as const:'NOT_REACHABLE' as const;
    const snapshot=verification?{source:command.source,description:command.description,location:command.location,
      reporter:{verification:'VERIFIED',name:verification.proof.profile_at_report.display_name,departments:verification.proof.profile_at_report.departments},
      identity_source:'VERIFIED_DIRECTORY_SELECTION',manual_contact_required:eligibility!=='ELIGIBLE',notification_eligibility:eligibility,external_notification:false}
      :{source:command.source,description:command.description,location:command.location,reporter:command.reporter,identity_source:'HAND_ENTERED',manual_contact_required:true,external_notification:false};
    const receipt=(await tx.query<{id:string}>("SELECT id::text FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND command_type='WORKBENCH_MANUAL_REPORT'",['P2_016:'+principal.principal_id,command.client_command_id])).rows[0];if(!receipt)failP2016('ACTION_FAILED',503);
    const intake=(await tx.query<{id:string;intake_no:string}>(`WITH number AS (SELECT nextval('intake.service_intake_number_seq')::text AS n)
      INSERT INTO intake.service_intake(intake_no,source_channel,source_provider,source_bot_id,source_chat_type,reporter_wecom_userid,primary_message_id,
        explicit_aggregation_boundary,privacy_class,retention_until,retention_until_epoch_ms,request_type,summary,reported_location_text,status,last_message_at,
        manual_report_snapshot,manual_actor_principal_id,manual_command_receipt_id${verification?',manual_reporter_verification':''})
      SELECT 'INT-'||to_char($1::timestamp without time zone,'YYYYMMDD')||'-'||lpad(n,GREATEST(4,char_length(n)),'0'),
        'MANUAL','STAFF_MANUAL_REPORT',NULL,NULL,NULL,NULL,true,'PERSONAL',$2::timestamp without time zone,$3::bigint,'UNKNOWN',$4,$5,'RECEIVED',$1::timestamp without time zone,$6::jsonb,$7::uuid,$8::uuid${verification?',$9::jsonb':''}
      FROM number RETURNING id::text,intake_no`,[stamp.local,retention,retentionEpoch,manualExcerpt(command.description,500),command.location.text,JSON.stringify(snapshot),principal.principal_id,receipt.id,...(verification?[JSON.stringify(verification)]:[])])).rows[0];if(!intake)failP2016('ACTION_FAILED',503);
    const trace='manual:'+intake.id;
    await tx.query(`INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
      VALUES('intake.received','intake',$1::uuid,1,1,$2::timestamp without time zone,$3,$4::jsonb)`,[intake.id,stamp.local,trace,JSON.stringify({intake_id:intake.id,source_channel:'MANUAL',source:command.source,actor_principal_id:principal.principal_id,
        reporter_verification:verification?'VERIFIED':'UNVERIFIED',manual_contact_required:verification?eligibility!=='ELIGIBLE':true})]);
    // Hand-entry identifies only this independent source. Verified selection
    // retains the explicitly mapped canonical target, never a name/phone match.
    const contactScope=verification?verification.proof.scope.scopeHash:safeHash({source:'STAFF_MANUAL_REPORT',intake_id:intake.id}),
      profile=verification?{source:'VERIFIED_DIRECTORY_SELECTION',version:verification.selection.candidate_version,verification:'VERIFIED',profile_at_report:verification.proof.profile_at_report,manual_contact_required:eligibility!=='ELIGIBLE'}
        :{source:'HAND_ENTERED',version:'1',verification:'UNVERIFIED',manual_contact_required:true};
    const journey=(await tx.query<{id:string}>(`INSERT INTO intake.contact_journey(creation_key,origin_intake_id,entry_mode,origin_channel,current_channel,reporter_identity_hash,
      profile_resolution_status,profile_snapshot,profile_snapshot_hash,status,evaluation_due_at,evaluation_due_epoch_ms,reported_at,last_activity_at,privacy_class,retention_until,retention_until_epoch_ms)
      VALUES($1,$2::uuid,'STAFF_MANUAL_REPORT','MANUAL','MANUAL',$3,'NOT_REQUIRED',$4::jsonb,$5,'OPEN',$6::timestamp without time zone,$7::bigint,$6::timestamp without time zone,$6::timestamp without time zone,'PERSONAL',$8::timestamp without time zone,$9::bigint) RETURNING id::text`,
    [trace,intake.id,contactScope,JSON.stringify(profile),safeHash(profile),stamp.local,stamp.epoch,retention,retentionEpoch])).rows[0];if(!journey)failP2016('ACTION_FAILED',503);
    const leg=(await tx.query<{id:string}>(`INSERT INTO intake.channel_leg(journey_id,leg_ordinal,leg_type,source_intake_id,provider_context_hash,channel_identity_hash,reporter_identity_hash,status,opened_at)
      VALUES($1::uuid,1,'MANUAL_REPORT',$2::uuid,$3,$4,$5,'OPEN',$6::timestamp without time zone) RETURNING id::text`,[journey.id,intake.id,safeHash({source:'STAFF_MANUAL_REPORT'}),safeHash({source:command.source,intake_id:intake.id}),contactScope,stamp.local])).rows[0];if(!leg)failP2016('ACTION_FAILED',503);
    const context={service_intake_id:intake.id,journey_ref:journey.id,safe_normalized_text:command.description,input_hash:safeHash(snapshot),source_refs:[trace],message_sequence_window:{start:1,end:1,count:1},delivery_mode:'APP_ONLY'};
    let route:SafeRoute;
    try{route=createManualReportRulePolicy().route({text:command.description,source_ref:trace,source_kind:'USER_TEXT',observed_at:stamp.local,occurrence_location:command.location.text},context);}catch{route=routeRuleFailure(context);}
    const decision=await decisions.record({transaction:tx,input:{...route,journey_id:journey.id,channel_leg_id:leg.id,service_intake_id:intake.id,source_kind:'MANUAL',
      source_window_start_sequence:1,source_window_end_sequence:1,source_message_count:1,source_hash:safeHash(snapshot),safe_result:route,requires_manual_review:route.manual_review_required,
      ticket_creation_recommended:route.ticket_creation_recommended,incident_review_candidate:route.incident_review_candidate,observed_at:stamp.local as LocalDateTime}});
    const executor=createSafeActionExecutor({decisionStore:decisions,manualReviewStore:reviews,intakeDecisionPort:intakes,ticketCommandPort:{async createMinimalTicket({transaction,intake_id,occurred_at,trace_id}){
      const created=await core.createForIntakeInTransaction({transaction,intakeId:intake_id,occurredAt:occurred_at,traceId:trace_id,title:manualExcerpt(command.description,200),...(resolverTeamId?{resolverTeamId}:{})});
      if(created.created){const event=await appendTicketEvent({transaction,ticket:created.ticket,eventType:'ticket.created',actor:{type:'PILOT_USER',id:principal.principal_id},traceId:trace_id});await realtimeProjector?.ticket({transaction,ticket:created.ticket,event});}return created;
    }}});
    await executor.execute({transaction:tx,decision,context:{trace_id:trace,privacy_class:'PERSONAL',retention_until:retention,retention_until_epoch_ms:retentionEpoch}});
    const ticket=(await tx.query<{id:string;number:string;status:TicketStatus}>(`SELECT id::text,ticket_no AS number,status FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid`,[intake.id])).rows[0]??null;
    const review=(await tx.query<{id:string;status:'PENDING'}>(`SELECT id::text,status FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status='PENDING' ORDER BY created_at,id LIMIT 1`,[intake.id])).rows[0]??null;
    if(review)await realtimeProjector?.review({transaction:tx,reviewId:review.id});
    const current=await authorize(authContext,tx);await currentAuthentication(authContext,tx);
    if(verification&&command.reporter.verification==='VERIFIED_SELECTION')reporterCandidates.fence(current.principal.principal_id,command.reporter,verification,null);
    const base={ok:true as const,client_command_id:command.client_command_id,intake_id:intake.id,intake_no:intake.intake_no,source:command.source,external_notification:false as const,result_code:route.result_code,ticket,review};
    return verification?publicP2016({...base,reporter_verification:'VERIFIED',manual_contact_required:eligibility!=='ELIGIBLE',notification_eligibility:eligibility})
      :publicP2016({...base,reporter_verification:'UNVERIFIED',manual_contact_required:true});
  }
  return Object.freeze({
    async handler({request,response,url,authContext,readJson,validateWriteRequest,json}:HttpContext){
      if(url.pathname==='/api/workbench/reports/self-handling-context'){
        if(request.method!=='GET')failP2016('NOT_FOUND',404);
        const params=[...url.searchParams.keys()];if(params.length>1||params.some(key=>key!=='resolver_team_id'))failP2016();
        const team=url.searchParams.get('resolver_team_id');if(team!==null&&!/^[A-Z][A-Z0-9_]{0,63}$/u.test(team))failP2016();
        json(response,200,await selfHandlingContext(authContext,team??undefined));return true;
      }
      if(url.pathname==='/api/workbench/reports/take-and-start'){
        guardP2016(enabled&&selfHandlingEnabled);if(request.method!=='POST')failP2016('NOT_FOUND',404);if(url.searchParams.size)failP2016();
        const body=await readJson(request);if(Buffer.byteLength(JSON.stringify(body),'utf8')>16*1024)failP2016('BODY_TOO_LARGE',413);
        validateWriteRequest(request,authContext,body,{sessionMutation:false});const command=manualReportSelfHandlingCommand(body);
        const result=await ledger.execute({command:{...command,action:'manual-report-take-and-start'},receiptType:'WORKBENCH_MANUAL_REPORT',
          authorize:tx=>authorizeSelfHandling(authContext,tx,command.resolver_team_id),
          afterReceiptLock:async tx=>{await authorizeSelfHandling(authContext,tx,command.resolver_team_id,true);},
          run:async tx=>{
            const {principal}=await authorizeSelfHandling(authContext,tx,command.resolver_team_id,true);
            const admitted=await admit(tx,authContext,principal,command,null,command.resolver_team_id);
            if(!admitted.ticket||admitted.review!==null||admitted.result_code!=='TICKET_ELIGIBLE'&&admitted.result_code!=='SERVICE_REQUEST')failP2016('SELF_HANDLING_STATE_CONFLICT',409);
            const {ticket}=await query.authorizedTicket({authContext,ticketId:admitted.ticket.id,transaction:tx,lock:true});
            const current=await authorizeSelfHandling(authContext,tx,command.resolver_team_id,true);
            if(ticket.resolver_team_id!==command.resolver_team_id)failP2016('FORBIDDEN',403);
            const eligibility=await selfHandlingEligibility(tx,current.principal,ticket,true);
            if(!eligibility.actions.includes('take-and-start'))failP2016('SELF_HANDLING_STATE_CONFLICT',409);
            await performFirstTicketResponsibilityInTransaction({transaction:tx,ticket,principal:current.principal,
              command:{action:'take-and-start',ticket_id:ticket.id,client_command_id:command.client_command_id,expected_version:ticket.version,reason_code:'MANUAL_REPORT_SELF_HANDLING',resolver_team_id:command.resolver_team_id},
              initialCycle:eligibility.cycle,tracePrefix:'t19:',realtimeProjector:realtimeProjector?.ticket??null,...selfHandlingHooks});
            await authorizeSelfHandling(authContext,tx,command.resolver_team_id,true);
            // Acquire the current real session only after all business waits.
            // A pending official logout must be able to finish while we wait.
            await currentAuthentication(authContext,tx,true);
            return publicP2016({...admitted,ticket:{...admitted.ticket,status:'IN_PROGRESS' as const}});
          }});
        await transactionP2016(pool,async tx=>{await tx.query('SET TRANSACTION READ ONLY');await authorizeSelfHandling(authContext,tx,command.resolver_team_id);});
        const reply=result.ok===true&&result.replayed?storedResult(Object.fromEntries(Object.entries(result).filter(([key])=>key!=='replayed')),command.client_command_id):result;
        json(response,reply.ok===false?503:reply.replayed?200:202,reply);return true;
      }
      if(url.pathname==='/api/workbench/reporter-candidates'){
        guardP2016(enabled&&reporterCandidatesEnabled);if(request.method!=='GET')failP2016('NOT_FOUND',404);
        const principal=await currentPrincipal(authContext);
        // Network/adapter wait is outside the database transaction. Current
        // creation authority is checked again before any page or error returns.
        const outcome=await reporterCandidates.search(principal.principal_id,url.searchParams).then(
          page=>({ok:true as const,page}),(error:unknown)=>({ok:false as const,error}));
        const current=await currentPrincipal(authContext);if(current.principal_id!==principal.principal_id)failP2016('FORBIDDEN',403);
        if(!outcome.ok)throw outcome.error;json(response,200,outcome.page);return true;
      }
      const capabilityPath=url.pathname==='/api/workbench/reports/capabilities',receiptPath=/^\/api\/workbench\/reports\/commands\/([^/]+)$/u.exec(url.pathname);
      if(url.pathname!=='/api/workbench/reports'&&!capabilityPath&&!receiptPath)return false;guardP2016(enabled);if(url.searchParams.size)failP2016();
      if(request.method==='GET'&&capabilityPath){json(response,200,await capabilities(authContext));return true;}
      if(request.method==='GET'&&receiptPath){json(response,200,await receipt(authContext,uuidP2016(receiptPath[1])));return true;}
      if(request.method!=='POST'||capabilityPath||receiptPath)failP2016('NOT_FOUND',404);
      const body=await readJson(request);if(Buffer.byteLength(JSON.stringify(body),'utf8')>16*1024)failP2016('BODY_TOO_LARGE',413);validateWriteRequest(request,authContext,body,{sessionMutation:false});
      const candidate=exactP2016(body,['schema_version','client_command_id','source','description','location','reporter']);
      const rawReporter=exactP2016(candidate.reporter,['verification','candidate_ref','candidate_version','name','contact','department'],['verification']);
      const command=rawReporter.verification==='VERIFIED_SELECTION'?verifiedManualReportCommand(body):manualReportCommand(body);
      const verifiedCommand=command.reporter.verification==='VERIFIED_SELECTION'?verifiedManualReportCommand(body):null;
      let checked:Awaited<ReturnType<typeof verifyForCommand>>|null;
      try{checked=verifiedCommand?await verifyForCommand(authContext,verifiedCommand):null;}
      catch(error){if(error instanceof ConfirmedReporterRejection){json(response,error.status,error.rejection);return true;}throw error;}
      const result=await ledger.execute({command:{...command,action:'manual-report'},receiptType:'WORKBENCH_MANUAL_REPORT',authorize:async tx=>{
        const context=await authorize(authContext,tx);
        if(checked&&verifiedCommand){if(context.principal.principal_id!==checked.principalId)failP2016('FORBIDDEN',403);
          const target=await committedTarget(tx,context.principal,verifiedCommand);
          if(checked.target&&(!target||hashP2016(target)!==hashP2016(checked.target)))failP2016('ACTION_FAILED',503);
          reporterCandidates.fence(context.principal.principal_id,verifiedCommand.reporter,checked.verification,checked.target);}
        return context;
      },afterReceiptLock:tx=>currentCreationAuthority(authContext,tx),run:async(tx,{principal})=>{
        const verification=checked?.verification??null;
        if(verification&&verification.purpose!=='ADMISSION')throw failP2016('ACTION_FAILED',503);
        const admitted=await admit(tx,authContext,principal,command,verification);
        await currentAuthentication(authContext,tx,true);await authorize(authContext,tx);
        if(verification&&command.reporter.verification==='VERIFIED_SELECTION')reporterCandidates.fence(principal.principal_id,command.reporter,verification,null);
        return admitted;
      }});
      if(verifiedCommand&&result.ok===true&&result.replayed){
        // A concurrent original commit can win after preflight. Recheck current
        // READ against its retained original target outside the ledger transaction.
        const read=checked?.verification.purpose==='READ_COMMITTED'?checked:await verifyForCommand(authContext,verifiedCommand);if(read.verification.purpose!=='READ_COMMITTED')failP2016('ACTION_FAILED',503);
        const current=await transactionP2016(pool,async tx=>{await tx.query('SET TRANSACTION READ ONLY');const context=await authorize(authContext,tx);
          const target=await committedTarget(tx,context.principal,verifiedCommand);if(!target||!read.target||hashP2016(target)!==hashP2016(read.target))failP2016('ACTION_FAILED',503);
          reporterCandidates.fence(context.principal.principal_id,verifiedCommand.reporter,read.verification,target);return context.principal;});
        if(current.principal_id!==read.principalId)failP2016('FORBIDDEN',403);
      }
      if(verifiedCommand&&checked&&result.ok===true&&!result.replayed){
        const current=await currentPrincipal(authContext);if(current.principal_id!==checked.principalId)failP2016('FORBIDDEN',403);
        reporterCandidates.fence(current.principal_id,verifiedCommand.reporter,checked.verification,null);
      }
      const reply=result.ok===true&&result.replayed?storedResult(Object.fromEntries(Object.entries(result).filter(([key])=>key!=='replayed')),command.client_command_id):result;
      json(response,reply.ok===false?503:reply.replayed?200:202,reply);return true;
    },
  });
}
