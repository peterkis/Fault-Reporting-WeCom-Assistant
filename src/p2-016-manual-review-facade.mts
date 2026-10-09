import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { WorkbenchPrincipal } from './p2-006-workbench-authorization.mjs';
import type { ManualReviewStore, ReviewRow, ReviewResolutionCode, ReviewPriority, ReviewStatus } from './p2-015-manual-review.mjs';
import type { SafeActionType, SafeActionSuggestion } from './p2-015-decision-router.mjs';
import type { DecisionRow } from './p2-015-decision-store.mjs';
import type { JourneyProjectionRow } from './p2-015-projections.mjs';
import type { SafeActionContext } from './p2-015-safe-action-executor.mjs';
import type { CommunicationResult, CommunicationDestination, CommunicationCommand } from './p2-004-communication-core.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
import type { OrchestrationWorkerOptions, PersonDestinationAuthorizer } from './p2-016-orchestration-adapters.mjs';
import type { LedgerResult } from './p2-016-ticket-command-ledger.mjs';
import type {CanonicalItem,ReviewReceipt,ReviewMaterialProjection} from '../contracts/workbench_review_contracts.js';
type FacadeResolutionCode = Exclude<ReviewResolutionCode, 'LINK_EXISTING_JOURNEY'>;
interface ReviewBody { [key: string]: unknown; client_command_id: unknown; expected_row_version: unknown; resolution_code: FacadeResolutionCode; resolution_reason_code: unknown; target_journey_id?: unknown;expected_material_basis?:unknown }
interface DetailInput { authContext: unknown; reviewId: unknown; transaction?: PostgresTransaction }
interface SourceRow { source_provider: string; source_bot_id: string; reporter_wecom_userid: string; source_chat_type: 'single' | 'group'; source_chat_id: string; summary: unknown; retention_until: string; retention_until_epoch_ms: string; session_id: string | null; row_version: number }
interface WebReportRow { source_provider: string; initial_content: unknown; supplement_items: unknown }
export interface ManualReviewCurrentResult { ok: true; review_id: unknown; status: Exclude<ReviewStatus, 'PENDING'>; resolution_decision_id: string; action_count: number }
export type ManualReviewLedgerResult = LedgerResult<ManualReviewCurrentResult>;
export interface ManualReviewFacadeOptions { pool: PostgresPool; enabled?: boolean; workspaceEnabled?:boolean; manualSourceEnabled?:boolean; draftRecoveryEnabled?:boolean; query?: P2016TicketQuery; notificationProjector?: OrchestrationWorkerOptions['notifications'] | null; realtimeProjector?: OrchestrationWorkerOptions['realtime'] | null; communicationAppend?: typeof appendCommunication | undefined; now?: () => string; personDestinationAuthorizer?: PersonDestinationAuthorizer | null }
type CommunicationObservation = NonNullable<CommunicationResult> & { error?: { code: string } };
import { createManualReviewStore } from './p2-015-manual-review.mjs';
import { createDecisionStore } from './p2-015-decision-store.mjs';
import { createSafeActionExecutor,createP2004FixedCommunicationPort } from './p2-015-safe-action-executor.mjs';
import { createServiceIntakeDecisionPort } from './p2-015-service-intake-decision-port.mjs';
import { createPilotTicketCore } from './p1-005-pilot-ticket-core.mjs';
import { p2016TicketSourceIntake } from './p2-016-guided-journey.mjs';
import { appendTicketEvent } from './p1-006-ticket-state-actions.mjs';
import { appendCommunication } from './p2-004-communication-core.mjs';
import { safeHash } from './p2-015-domain-contracts.mjs';
import {readManualReportSource} from './workbench-manual-report-source.mjs';
import { projectContactJourney,projectDecision } from './p2-015-projections.mjs';
import { createP2016CommandLedger } from './p2-016-ticket-command-ledger.mjs';
import { createP2016TicketQuery,ticketPredicateP2016 } from './p2-016-ticket-query.mjs';
import { failP2016,guardP2016,exactP2016,uuidP2016,codeP2016,limitP2016,publicP2016,stampP2016,cursorP2016,decodeCursorP2016,textHashP2016,localP2016,transactionP2016 } from './p2-016-domain-contracts.mjs';
const ACTIONS: Readonly<Record<FacadeResolutionCode, SafeActionType[]>>=Object.freeze({
  CONFIRM_TICKET_ELIGIBLE:['APPLY_INTAKE_CLASSIFICATION','CREATE_MINIMAL_TICKET'],
  CLASSIFY_SERVICE_REQUEST:['APPLY_INTAKE_CLASSIFICATION','ROUTE_SERVICE_REQUEST'],
  REQUEST_DESCRIPTION:['REQUEST_ONE_DESCRIPTION'],CLASSIFY_BUSINESS_CONSULTATION:[],
  ACKNOWLEDGE:['SEND_FIXED_ACKNOWLEDGEMENT'],MARK_OUT_OF_SCOPE:['SEND_FIXED_SCOPE_NOTICE'],
  KEEP_INCIDENT_REVIEW_CANDIDATE:[],CANCEL_REVIEW:[],
});
const WEB_ACTIONS: Readonly<Record<FacadeResolutionCode, SafeActionType[]>>=Object.freeze({
  CONFIRM_TICKET_ELIGIBLE:['APPLY_INTAKE_CLASSIFICATION','CREATE_MINIMAL_TICKET'],
  CLASSIFY_SERVICE_REQUEST:['APPLY_INTAKE_CLASSIFICATION','ROUTE_SERVICE_REQUEST'],
  REQUEST_DESCRIPTION:['APPLY_INTAKE_CLASSIFICATION'],CLASSIFY_BUSINESS_CONSULTATION:['APPLY_INTAKE_CLASSIFICATION'],
  ACKNOWLEDGE:['APPLY_INTAKE_CLASSIFICATION'],MARK_OUT_OF_SCOPE:['APPLY_INTAKE_CLASSIFICATION'],KEEP_INCIDENT_REVIEW_CANDIDATE:[],CANCEL_REVIEW:[],
});
function derivedCommand(id: string) {const h=textHashP2016('P2016_PERSON_GUIDANCE:'+id);return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
function boundedTicketTitle(value: unknown) {if(typeof value!=='string'||value.length===0)return null;let title='';for(const character of value){if(title.length+character.length>200)break;title+=character;}return title||null;}
async function webReportForIntake(queryable: PostgresTransaction,intakeId: string) {
  let result;
  try { result=await queryable.query<WebReportRow>(`SELECT i.source_provider,initial.safe_content AS initial_content,
      COALESCE(supplements.items,'[]'::jsonb) AS supplement_items
    FROM intake.service_intake i
    JOIN intake.web_request_binding b ON b.intake_id=i.id
      AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
    LEFT JOIN LATERAL (SELECT s.safe_content FROM intake.web_submission s
      WHERE s.intake_id=i.id AND s.kind='SUBMIT' AND s.retention_until>platform.local_now() ORDER BY s.input_revision LIMIT 1) initial ON TRUE
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('input_revision',s.input_revision::text,
      'text',s.safe_content->>'text') ORDER BY s.input_revision) AS items
      FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUPPLEMENT' AND s.retention_until>platform.local_now()) supplements ON TRUE
    WHERE i.id=$1::uuid AND i.retention_until>platform.local_now()`,[intakeId]); }
  catch(error) { if((error as { code?: unknown } | null)?.code==='42P01')return null; throw error; }
  const row=result.rows[0] as WebReportRow;if(result.rowCount!==1||row.source_provider!=='YIXIAOXIU_WEB')return null;
  const initial=row.initial_content&&typeof row.initial_content==='object'?row.initial_content as Record<string, unknown>:{};
  const supplements=Array.isArray(row.supplement_items)?row.supplement_items:[];
  return {source_kind:'WEB_REQUEST',description:typeof initial.description==='string'?initial.description:null,
    location:initial.location??null,service_code:initial.service_code??null,impact_scope:initial.impact_scope??null,
    reported_department_text:initial.reported_department_text??null,extension:initial.extension??null,
    supplements:supplements.map(item=>({input_revision:String((item as Record<string, unknown>).input_revision),text:typeof (item as Record<string, unknown>).text==='string'?(item as Record<string, unknown>).text:null}))};
}
export function createP2016ManualReviewFacade({pool,enabled=false,workspaceEnabled=false,manualSourceEnabled=false,draftRecoveryEnabled=false,query=createP2016TicketQuery({pool,enabled}),notificationProjector=null,realtimeProjector=null,
  communicationAppend=appendCommunication,now=()=>String(Date.now()),personDestinationAuthorizer=null}: ManualReviewFacadeOptions) {
  if(personDestinationAuthorizer!==null&&typeof personDestinationAuthorizer!=='function')failP2016();
  if(typeof manualSourceEnabled!=='boolean')failP2016();
  const ledger=createP2016CommandLedger({pool}),decisions=createDecisionStore(),core=createPilotTicketCore({pool});
  function storeFor(principal: WorkbenchPrincipal,transaction: PostgresTransaction=pool) {
    const predicate=ticketPredicateP2016(principal);
    return createManualReviewStore({manualSource:manualSourceEnabled,authorizer:{authorizedJourneyIds:async()=>{
      const q=await transaction.query<{ id: string }>(`SELECT j.id::text FROM intake.contact_journey j LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
        WHERE ${predicate.sql} ORDER BY j.id LIMIT 10001`,predicate.values);
      if(q.rows.length>10000)failP2016('REVIEW_SCOPE_TOO_LARGE',503);
      return q.rows.map(r=>r.id);
    }}});
  }
  async function detail({authContext,reviewId,transaction=pool}: DetailInput) {
    const principal=await query.principal(authContext,transaction),store=storeFor(principal,transaction);
    try{return {principal,store,review:await store.get({transaction,principal,review_id:uuidP2016(reviewId)})};}
    catch(error){if((error as { code?: unknown }).code==='P2_015_AUTHORIZATION_DENIED')failP2016('NOT_FOUND',404);throw error;}
  }
  async function materialFor(context:Awaited<ReturnType<typeof detail>>,transaction:PostgresTransaction):Promise<ReviewMaterialProjection>{
    try{return await context.store.material({transaction,principal:context.principal,review_id:context.review.id});}
    catch(error){if((error as {code?:unknown}).code==='P2_015_AUTHORIZATION_DENIED')failP2016('NOT_FOUND',404);throw error;}
  }
  async function canonicalItem(input:DetailInput):Promise<CanonicalItem>{
    const transaction=input.transaction??pool,context=await detail(input);
    await materialFor(context,transaction);
    const {review,principal}=context,predicate=ticketPredicateP2016(principal,2);
    const ticket=await transaction.query<{id:string}>(`SELECT t.id::text FROM pilot_ticket.ticket t
      JOIN intake.manual_review_item r ON r.id=$1::uuid JOIN intake.contact_journey j ON j.id=r.journey_id
      WHERE (t.source_intake_id=r.service_intake_id OR t.id=r.linked_ticket_id OR t.id=j.linked_ticket_id)
        AND ${predicate.sql} ORDER BY CASE WHEN t.id=j.linked_ticket_id THEN 0 ELSE 1 END,t.id LIMIT 1`,[review.id,...predicate.values]);
    const actual=ticket.rows[0];if(actual)return {kind:'ticket',id:actual.id};
    const pending=await transaction.query<{id:string}>(`SELECT r.id::text FROM intake.manual_review_item r
      JOIN intake.contact_journey j ON j.id=r.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
      JOIN intake.service_intake i ON i.id=r.service_intake_id WHERE r.service_intake_id=$1::uuid AND r.status='PENDING'
        AND ${predicate.sql} AND i.retention_until>platform.local_now() AND j.retention_until_epoch_ms>platform.physical_epoch_ms()
        AND NOT EXISTS (SELECT 1 FROM pilot_ticket.ticket actual
          WHERE actual.source_intake_id=r.service_intake_id OR actual.id=r.linked_ticket_id OR actual.id=j.linked_ticket_id)
        AND NOT EXISTS (SELECT 1 FROM intake.manual_review_item earlier WHERE earlier.service_intake_id=r.service_intake_id AND earlier.status='PENDING'
          AND (earlier.created_at,earlier.id)<(r.created_at,r.id))
      ORDER BY r.created_at,r.id LIMIT 1`,[review.service_intake_id,...predicate.values]);
    return pending.rows[0]?{kind:'review',id:pending.rows[0].id}:{kind:'intake',id:review.service_intake_id};
  }
  return Object.freeze({
    async listManualReviews({authContext,priority=null,cursor=null,limit,status='PENDING'}: { authContext: unknown; priority?: string | null; cursor?: string | null; limit?: unknown; status?: string }) {
      guardP2016(enabled);if(status!=='PENDING')failP2016();
      if(priority!==null&&!['LOW','NORMAL','HIGH','URGENT'].includes(priority))failP2016();
      const principal=await query.principal(authContext),store=storeFor(principal);
      const decoded=cursor?decodeCursorP2016(cursor,['priority','page']) as { priority: unknown; page: { priority_rank: number; created_at: string; id: string } }:null;
      if(decoded&&decoded.priority!==priority)failP2016('CURSOR_INVALID');
      if(decoded){
        const page=exactP2016(decoded.page,['priority_rank','created_at','id']) as { priority_rank: number; created_at: unknown; id: unknown };
        if(!Number.isInteger(page.priority_rank)||page.priority_rank<1||page.priority_rank>4)failP2016('CURSOR_INVALID');
        uuidP2016(page.id);localP2016(page.created_at);
      }
      const result=await store.list({transaction:pool,principal,priority:priority as ReviewPriority | null,cursor:decoded?.page??null,limit:limitP2016(limit)});
      return publicP2016({items:result.items,next_cursor:result.next_cursor?cursorP2016({priority,page:result.next_cursor}):null});
    },
    canonicalItem,
    async manualReviewReceipt({authContext,reviewId:inputReview,commandId:inputCommand}:{authContext:unknown;reviewId:unknown;commandId:unknown}):Promise<ReviewReceipt>{
      guardP2016(enabled);guardP2016(workspaceEnabled&&draftRecoveryEnabled);
      const reviewId=uuidP2016(inputReview),commandId=uuidP2016(inputCommand);
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION READ ONLY');
        const context=await detail({authContext,reviewId,transaction});
        await materialFor(context,transaction);
        const selected=await transaction.query<{state:unknown;snapshot:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_snapshot AS snapshot,error_code AS error,retryable
          FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid
          AND review_id=$3::uuid AND actor_principal_id=$4::uuid AND command_type='MANUAL_REVIEW' LIMIT 1`,
        ['P2_016:'+context.principal.principal_id,commandId,reviewId,context.principal.principal_id]);
        const row=selected.rows[0],base={client_command_id:commandId,review_id:reviewId};
        if(!row||row.state==='STARTED')return publicP2016({...base,state:'UNKNOWN'});
        try{
          if(row.state==='FAILED'&&row.retryable===false)return publicP2016({...base,state:'FAILED',error:{code:codeP2016(row.error),retryable:false}});
          if(row.state==='COMMITTED'){
            const result=exactP2016(row.snapshot,['ok','review_id','status','resolution_decision_id','action_count']);
            if(result.ok!==true||uuidP2016(result.review_id)!==reviewId||(result.status!=='RESOLVED'&&result.status!=='CANCELLED')
              ||typeof result.action_count!=='number'||!Number.isInteger(result.action_count)||result.action_count<0||result.action_count>20)failP2016();
            return publicP2016({...base,state:'COMMITTED',result:{ok:true,review_id:reviewId,status:result.status,
              resolution_decision_id:uuidP2016(result.resolution_decision_id),action_count:result.action_count,replayed:true}});
          }
        }catch{failP2016('ACTION_FAILED',503);}
        failP2016('ACTION_FAILED',503);
      });
    },
    async getManualReviewDetail(input: DetailInput) {
      guardP2016(enabled);const {review,principal,store}=await detail(input),transaction=input.transaction??pool;
      const report=await webReportForIntake(transaction,review.service_intake_id);
      if(!workspaceEnabled)return publicP2016({...review,...(report?{web_report:report}:{}),allowed_resolutions:Object.keys(ACTIONS),unsupported_resolutions:['LINK_EXISTING_JOURNEY']});
      const material=await materialFor({review,principal,store},transaction);
      const manual=manualSourceEnabled&&material.material_basis.source_kind==='MANUAL'?await readManualReportSource(transaction,review.service_intake_id):null;
      const allowed=review.status!=='PENDING'?[]:material.material_basis.stale?['CANCEL_REVIEW']:Object.keys(ACTIONS);
      return publicP2016({...review,...(report?{web_report:report}:{}),...(manual?{manual_report:manual.report}:{}),...material,canonical_item:await canonicalItem(input),allowed_resolutions:allowed,unsupported_resolutions:['LINK_EXISTING_JOURNEY']});
    },
    async journey({authContext,journeyId,part=null}: { authContext: unknown; journeyId: unknown; part?: string | null }) {
      const principal=await query.principal(authContext),predicate=ticketPredicateP2016(principal,2);
      const q=await pool.query<JourneyProjectionRow>(`SELECT j.* FROM intake.contact_journey j LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
        WHERE j.id=$1::uuid AND ${predicate.sql}`,[uuidP2016(journeyId),...predicate.values]);
      if(q.rowCount!==1)failP2016('NOT_FOUND',404);
      if(part===null)return projectContactJourney(q.rows[0] as JourneyProjectionRow);
      if(part==='legs')return publicP2016((await pool.query(`SELECT id::text,journey_id::text,leg_ordinal,leg_type,source_intake_id::text,
        conversation_session_id::text,status,row_version::text,opened_at,closed_at FROM intake.channel_leg WHERE journey_id=$1::uuid ORDER BY leg_ordinal LIMIT 100`,[journeyId])).rows);
      if(part==='decisions')return publicP2016((await pool.query<DecisionRow>('SELECT * FROM intake.deterministic_decision WHERE journey_id=$1::uuid ORDER BY decision_ordinal LIMIT 100',[journeyId])).rows.map(projectDecision));
      failP2016();
    },
    async resolveManualReview({authContext,reviewId,body}: { authContext: unknown; reviewId: unknown; body: unknown }): Promise<ManualReviewLedgerResult> {
      guardP2016(enabled);const v=exactP2016(body,['client_command_id','expected_row_version','resolution_code','resolution_reason_code','target_journey_id','expected_material_basis'],
        ['client_command_id','expected_row_version','resolution_code','resolution_reason_code']) as ReviewBody;
      if(!Object.hasOwn(ACTIONS,v.resolution_code)||v.target_journey_id!==undefined)failP2016('RESOLUTION_NOT_PERMITTED',403);
      if(typeof v.expected_row_version!=='string')failP2016();
      const expected=String(v.expected_row_version);
      if(!/^[1-9][0-9]{0,18}$/u.test(expected)||BigInt(expected)>9223372036854775807n)failP2016();
      const {expected_material_basis:materialBasis,...fields}=v;
      if(materialBasis!==undefined){guardP2016(workspaceEnabled);if(typeof materialBasis!=='string'||!/^[a-f0-9]{64}$/u.test(materialBasis))failP2016();}
      const command={...fields,...(typeof materialBasis==='string'?{expected_material_basis:materialBasis}:{}),expected_row_version:expected,client_command_id:uuidP2016(v.client_command_id),review_id:uuidP2016(reviewId),action:'MANUAL_REVIEW',
        resolution_reason_code:codeP2016(v.resolution_reason_code)};
      return ledger.execute({command,authorize:async transaction=>{
        const c=await detail({authContext,reviewId,transaction});if(workspaceEnabled)await materialFor(c,transaction);return {...c,ticket:null};
      },run:async(transaction,{principal,review,store}): Promise<ManualReviewCurrentResult>=>{
        await realtimeProjector?.lock?.(transaction);
        await transaction.query('SELECT id FROM intake.service_intake WHERE id=$1::uuid FOR UPDATE',[review.service_intake_id]);
        await transaction.query('SELECT id FROM intake.contact_journey WHERE id=$1::uuid FOR UPDATE',[review.journey_id]);
         const resolvedAt=stampP2016(now).local;
         const resolution=await store.resolve({transaction,principal,command:{...command,resolved_at:resolvedAt}});
        if(!(resolution as { resolution_decision_id?: string }).resolution_decision_id)failP2016('REVIEW_ALREADY_RESOLVED',409);
        const source=(await transaction.query<SourceRow>(`SELECT i.source_provider,i.source_bot_id,i.reporter_wecom_userid,i.source_chat_type,i.source_chat_id,i.summary,
          i.retention_until,i.retention_until_epoch_ms::text,s.id::text AS session_id,s.row_version::integer
          FROM intake.service_intake i LEFT JOIN conversation.session s ON s.service_intake_id=i.id AND s.status<>'ENDED'
          WHERE i.id=$1::uuid`,[review.service_intake_id])).rows[0] as SourceRow;
        const webSource=source?.source_provider==='YIXIAOXIU_WEB';
        const appOnly=webSource||manualSourceEnabled&&source?.source_provider==='STAFF_MANUAL_REPORT';
        const actionTypes=workspaceEnabled&&!appOnly&&['REQUEST_DESCRIPTION','CLASSIFY_BUSINESS_CONSULTATION','ACKNOWLEDGE','MARK_OUT_OF_SCOPE'].includes(v.resolution_code)
          ? ['APPLY_INTAKE_CLASSIFICATION',...ACTIONS[v.resolution_code]] as SafeActionType[] : (appOnly?WEB_ACTIONS:ACTIONS)[v.resolution_code];
        const suggestions: SafeActionSuggestion[]=actionTypes.map((type,index)=>{
          const payload={service_intake_id:review.service_intake_id,journey_ref:review.journey_id};
          return {action_type:type,action_ordinal:index+1,execution_policy:'HUMAN_CONFIRM_REQUIRED',safe_payload:payload,payload_hash:safeHash(payload)};
        });
        const decision=await decisions.ensureHumanActions({transaction,decisionId:(resolution as { resolution_decision_id: string }).resolution_decision_id,suggestions});
        const fixed=appOnly?null:createP2004FixedCommunicationPort({append:async input=>{
          const group=source.source_chat_type==='group';
          const guided=group&&v.resolution_code==='REQUEST_DESCRIPTION';
          const personAllowed=guided&&(personDestinationAuthorizer===null||await personDestinationAuthorizer({transaction,bot_id:source.source_bot_id,reporter_user_id:source.reporter_wecom_userid})===true);
          const primary={...input.command,...(source.session_id?{expected_row_version:source.row_version}:{}),
            content:guided?{text:'已收到您的消息。可直接在群里补充故障情况，也可选择机器人单聊。请勿在群内提供患者、账号或联系方式等敏感信息。'}:input.command.content};
          const result=await communicationAppend({...input,command:primary}) as CommunicationObservation;
          if(result.error)failP2016('ACTION_FAILED',503);
          if(personAllowed) {
            const direct=await communicationAppend({...input,command:{...primary,client_command_id:derivedCommand(primary.client_command_id),
              content:input.command.content},resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:source.source_bot_id,target_type:'PERSON',target_id:source.reporter_wecom_userid}]});
            if((direct as CommunicationObservation).error)failP2016('ACTION_FAILED',503);
          }return result;
        }});
        const executor=createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),manualReviewStore:store,decisionStore:decisions,communicationPort:fixed,
          ticketCommandPort:{createMinimalTicket:async({transaction:tx,intake_id,occurred_at,trace_id})=>{
            const intakeId=await p2016TicketSourceIntake({transaction:tx,intakeId:intake_id});
            const result=await core.createForIntakeInTransaction({transaction:tx,intakeId,occurredAt:occurred_at,traceId:trace_id,title:boundedTicketTitle(source.summary)});
            if(result.created){const event=await appendTicketEvent({transaction:tx,ticket:result.ticket,eventType:'ticket.created',
              actor:{type:'PILOT_USER',id:principal.principal_id},traceId:trace_id});
              if(!appOnly&&notificationProjector)await notificationProjector.project({transaction:tx,ticket:result.ticket,event});
              if(realtimeProjector)await realtimeProjector.ticket({transaction:tx,ticket:result.ticket,event});}
            return result;
          }}});
        const actionContext: SafeActionContext={trace_id:'p2-016:'+command.client_command_id,session_id:source.session_id??null,
          privacy_class:appOnly?'PERSONAL':'INTERNAL',retention_until:source.retention_until,
          retention_until_epoch_ms:source.retention_until_epoch_ms,
          ...(!appOnly?{destination:{provider:'WECOM_AIBOT',channel_account_id:source.source_bot_id,
            target_type:source.source_chat_type==='group'?'GROUP':'PERSON',target_id:source.source_chat_type==='group'?source.source_chat_id:source.reporter_wecom_userid}}:{})};
        const actions=await executor.execute({transaction,decision:appOnly?{...decision,applied_at:resolvedAt}:decision,context:actionContext});
        if(actions.some(a=>a.failed_safe))failP2016('REVIEW_ACTION_FAILED',409);
        if(appOnly&&v.resolution_code==='REQUEST_DESCRIPTION') {
          const journeyUpdate=await transaction.query(`UPDATE intake.contact_journey
            SET status='WAITING_DESCRIPTION',row_version=row_version+1,updated_at=GREATEST(created_at,platform.local_now())
            WHERE id=$1::uuid AND status='WAITING_REVIEW' RETURNING id`,[review.journey_id]);
          if(journeyUpdate.rowCount!==1)failP2016('ACTION_FAILED',409);
        } else if(appOnly&&['ACKNOWLEDGE','MARK_OUT_OF_SCOPE','CLASSIFY_BUSINESS_CONSULTATION'].includes(v.resolution_code)) {
          const journeyUpdate=await transaction.query(`UPDATE intake.contact_journey
            SET status='ENDED',ended_at=$2::timestamp without time zone,row_version=row_version+1,
                updated_at=GREATEST(created_at,$2::timestamp without time zone)
            WHERE id=$1::uuid AND status='WAITING_REVIEW' RETURNING id`,[review.journey_id,resolvedAt]);
          if(journeyUpdate.rowCount!==1)failP2016('ACTION_FAILED',409);
        }
        if(realtimeProjector)await realtimeProjector.review({transaction,reviewId:reviewId as string});
        return {ok:true,review_id:reviewId,status:resolution.status,resolution_decision_id:(resolution as { resolution_decision_id: string }).resolution_decision_id,action_count:actions.length};
      }});
    },
  });
}
