import { createManualReviewStore } from './p2-015-manual-review.mjs';
import { createDecisionStore } from './p2-015-decision-store.mjs';
import { createSafeActionExecutor,createP2004FixedCommunicationPort } from './p2-015-safe-action-executor.mjs';
import { createServiceIntakeDecisionPort } from './p2-015-service-intake-decision-port.mjs';
import { createPilotTicketCore } from './p1-005-pilot-ticket-core.mjs';
import { p2016TicketSourceIntake } from './p2-016-guided-journey.mjs';
import { appendTicketEvent } from './p1-006-ticket-state-actions.mjs';
import { appendCommunication } from './p2-004-communication-core.mjs';
import { safeHash } from './p2-015-domain-contracts.mjs';
import { projectContactJourney,projectDecision } from './p2-015-projections.mjs';
import { createP2016CommandLedger } from './p2-016-ticket-command-ledger.mjs';
import { createP2016TicketQuery,ticketPredicateP2016 } from './p2-016-ticket-query.mjs';
import { failP2016,guardP2016,exactP2016,uuidP2016,codeP2016,limitP2016,publicP2016,stampP2016,cursorP2016,decodeCursorP2016,textHashP2016,localP2016 } from './p2-016-domain-contracts.mjs';
const ACTIONS=Object.freeze({
  CONFIRM_TICKET_ELIGIBLE:['APPLY_INTAKE_CLASSIFICATION','CREATE_MINIMAL_TICKET'],
  CLASSIFY_SERVICE_REQUEST:['APPLY_INTAKE_CLASSIFICATION','ROUTE_SERVICE_REQUEST'],
  REQUEST_DESCRIPTION:['REQUEST_ONE_DESCRIPTION'],CLASSIFY_BUSINESS_CONSULTATION:[],
  ACKNOWLEDGE:['SEND_FIXED_ACKNOWLEDGEMENT'],MARK_OUT_OF_SCOPE:['SEND_FIXED_SCOPE_NOTICE'],
  KEEP_INCIDENT_REVIEW_CANDIDATE:[],CANCEL_REVIEW:[],
});
const WEB_ACTIONS=Object.freeze({
  CONFIRM_TICKET_ELIGIBLE:['APPLY_INTAKE_CLASSIFICATION','CREATE_MINIMAL_TICKET'],
  CLASSIFY_SERVICE_REQUEST:['APPLY_INTAKE_CLASSIFICATION','ROUTE_SERVICE_REQUEST'],
  REQUEST_DESCRIPTION:['APPLY_INTAKE_CLASSIFICATION'],CLASSIFY_BUSINESS_CONSULTATION:['APPLY_INTAKE_CLASSIFICATION'],
  ACKNOWLEDGE:['APPLY_INTAKE_CLASSIFICATION'],MARK_OUT_OF_SCOPE:['APPLY_INTAKE_CLASSIFICATION'],KEEP_INCIDENT_REVIEW_CANDIDATE:[],CANCEL_REVIEW:[],
});
function derivedCommand(id) {const h=textHashP2016('P2016_PERSON_GUIDANCE:'+id);return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
function boundedTicketTitle(value) {if(typeof value!=='string'||value.length===0)return null;let title='';for(const character of value){if(title.length+character.length>200)break;title+=character;}return title||null;}
async function webReportForIntake(queryable,intakeId) {
  let result;
  try { result=await queryable.query(`SELECT i.source_provider,initial.safe_content AS initial_content,
      COALESCE(supplements.items,'[]'::jsonb) AS supplement_items
    FROM intake.service_intake i
    JOIN intake.web_request_binding b ON b.intake_id=i.id
      AND b.revoked_at IS NULL AND b.retention_until>platform.local_now()
    LEFT JOIN LATERAL (SELECT s.safe_content FROM intake.web_submission s
      WHERE s.intake_id=i.id AND s.kind='SUBMIT' ORDER BY s.input_revision LIMIT 1) initial ON TRUE
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('input_revision',s.input_revision::text,
      'text',s.safe_content->>'text') ORDER BY s.input_revision) AS items
      FROM intake.web_submission s WHERE s.intake_id=i.id AND s.kind='SUPPLEMENT') supplements ON TRUE
    WHERE i.id=$1::uuid AND i.retention_until>platform.local_now()`,[intakeId]); }
  catch(error) { if(error?.code==='42P01')return null; throw error; }
  const row=result.rows[0];if(result.rowCount!==1||row.source_provider!=='YIXIAOXIU_WEB')return null;
  const initial=row.initial_content&&typeof row.initial_content==='object'?row.initial_content:{};
  const supplements=Array.isArray(row.supplement_items)?row.supplement_items:[];
  return {source_kind:'WEB_REQUEST',description:typeof initial.description==='string'?initial.description:null,
    location:initial.location??null,service_code:initial.service_code??null,impact_scope:initial.impact_scope??null,
    reported_department_text:initial.reported_department_text??null,extension:initial.extension??null,
    supplements:supplements.map(item=>({input_revision:String(item.input_revision),text:typeof item.text==='string'?item.text:null}))};
}
export function createP2016ManualReviewFacade({pool,enabled=false,query=createP2016TicketQuery({pool,enabled}),notificationProjector=null,realtimeProjector=null,
  communicationAppend=appendCommunication,now=()=>String(Date.now()),personDestinationAuthorizer=null}) {
  if(personDestinationAuthorizer!==null&&typeof personDestinationAuthorizer!=='function')failP2016();
  const ledger=createP2016CommandLedger({pool}),decisions=createDecisionStore(),core=createPilotTicketCore({pool});
  function storeFor(principal,transaction=pool) {
    const predicate=ticketPredicateP2016(principal);
    return createManualReviewStore({authorizer:{authorizedJourneyIds:async()=>{
      const q=await transaction.query(`SELECT j.id::text FROM intake.contact_journey j LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
        WHERE ${predicate.sql} ORDER BY j.id LIMIT 10001`,predicate.values);
      if(q.rows.length>10000)failP2016('REVIEW_SCOPE_TOO_LARGE',503);
      return q.rows.map(r=>r.id);
    }}});
  }
  async function detail({authContext,reviewId,transaction=pool}) {
    const principal=await query.principal(authContext,transaction),store=storeFor(principal,transaction);
    try{return {principal,store,review:await store.get({transaction,principal,review_id:uuidP2016(reviewId)})};}
    catch(error){if(error.code==='P2_015_AUTHORIZATION_DENIED')failP2016('NOT_FOUND',404);throw error;}
  }
  return Object.freeze({
    async listManualReviews({authContext,priority=null,cursor=null,limit,status='PENDING'}) {
      guardP2016(enabled);if(status!=='PENDING')failP2016();
      if(priority!==null&&!['LOW','NORMAL','HIGH','URGENT'].includes(priority))failP2016();
      const principal=await query.principal(authContext),store=storeFor(principal);
      const decoded=cursor?decodeCursorP2016(cursor,['priority','page']):null;
      if(decoded&&decoded.priority!==priority)failP2016('CURSOR_INVALID');
      if(decoded){
        const page=exactP2016(decoded.page,['priority_rank','created_at','id']);
        if(!Number.isInteger(page.priority_rank)||page.priority_rank<1||page.priority_rank>4)failP2016('CURSOR_INVALID');
        uuidP2016(page.id);localP2016(page.created_at);
      }
      const result=await store.list({transaction:pool,principal,priority,cursor:decoded?.page??null,limit:limitP2016(limit)});
      return publicP2016({items:result.items,next_cursor:result.next_cursor?cursorP2016({priority,page:result.next_cursor}):null});
    },
    async getManualReviewDetail(input) {const {review}=await detail(input);const report=await webReportForIntake(pool,review.service_intake_id);return publicP2016({...review,...(report?{web_report:report}:{}),allowed_resolutions:Object.keys(ACTIONS),unsupported_resolutions:['LINK_EXISTING_JOURNEY']});},
    async journey({authContext,journeyId,part=null}) {
      const principal=await query.principal(authContext),predicate=ticketPredicateP2016(principal,2);
      const q=await pool.query(`SELECT j.* FROM intake.contact_journey j LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
        WHERE j.id=$1::uuid AND ${predicate.sql}`,[uuidP2016(journeyId),...predicate.values]);
      if(q.rowCount!==1)failP2016('NOT_FOUND',404);
      if(part===null)return projectContactJourney(q.rows[0]);
      if(part==='legs')return publicP2016((await pool.query(`SELECT id::text,journey_id::text,leg_ordinal,leg_type,source_intake_id::text,
        conversation_session_id::text,status,row_version::text,opened_at,closed_at FROM intake.channel_leg WHERE journey_id=$1::uuid ORDER BY leg_ordinal LIMIT 100`,[journeyId])).rows);
      if(part==='decisions')return publicP2016((await pool.query('SELECT * FROM intake.deterministic_decision WHERE journey_id=$1::uuid ORDER BY decision_ordinal LIMIT 100',[journeyId])).rows.map(projectDecision));
      failP2016();
    },
    async resolveManualReview({authContext,reviewId,body}) {
      guardP2016(enabled);const v=exactP2016(body,['client_command_id','expected_row_version','resolution_code','resolution_reason_code','target_journey_id'],
        ['client_command_id','expected_row_version','resolution_code','resolution_reason_code']);
      if(!Object.hasOwn(ACTIONS,v.resolution_code)||v.target_journey_id!==undefined)failP2016('RESOLUTION_NOT_PERMITTED',403);
      if(typeof v.expected_row_version!=='string')failP2016();
      const expected=String(v.expected_row_version);
      if(!/^[1-9][0-9]{0,18}$/u.test(expected)||BigInt(expected)>9223372036854775807n)failP2016();
      const command={...v,expected_row_version:expected,client_command_id:uuidP2016(v.client_command_id),review_id:uuidP2016(reviewId),action:'MANUAL_REVIEW',
        resolution_reason_code:codeP2016(v.resolution_reason_code)};
      return ledger.execute({command,authorize:async transaction=>{
        const c=await detail({authContext,reviewId,transaction});return {...c,ticket:null};
      },run:async(transaction,{principal,review,store})=>{
        await realtimeProjector?.lock?.(transaction);
        await transaction.query('SELECT id FROM intake.contact_journey WHERE id=$1::uuid FOR UPDATE',[review.journey_id]);
        const resolution=await store.resolve({transaction,principal,command:{...command,resolved_at:stampP2016(now).local}});
        if(!resolution.resolution_decision_id)failP2016('REVIEW_ALREADY_RESOLVED',409);
        const source=(await transaction.query(`SELECT i.source_provider,i.source_bot_id,i.reporter_wecom_userid,i.source_chat_type,i.source_chat_id,i.summary,
          i.retention_until,i.retention_until_epoch_ms::text,s.id::text AS session_id,s.row_version::integer
          FROM intake.service_intake i LEFT JOIN conversation.session s ON s.service_intake_id=i.id AND s.status<>'ENDED'
          WHERE i.id=$1::uuid`,[review.service_intake_id])).rows[0];
        const webSource=source?.source_provider==='YIXIAOXIU_WEB';
        const actionTypes=(webSource?WEB_ACTIONS:ACTIONS)[v.resolution_code];
        const suggestions=actionTypes.map((type,index)=>{
          const payload={service_intake_id:review.service_intake_id,journey_ref:review.journey_id};
          return {action_type:type,action_ordinal:index+1,execution_policy:'HUMAN_CONFIRM_REQUIRED',safe_payload:payload,payload_hash:safeHash(payload)};
        });
        const decision=await decisions.ensureHumanActions({transaction,decisionId:resolution.resolution_decision_id,suggestions});
        const fixed=webSource?null:createP2004FixedCommunicationPort({append:async input=>{
          const group=source.source_chat_type==='group';
          const guided=group&&v.resolution_code==='REQUEST_DESCRIPTION';
          const personAllowed=guided&&(personDestinationAuthorizer===null||await personDestinationAuthorizer({transaction,bot_id:source.source_bot_id,reporter_user_id:source.reporter_wecom_userid})===true);
          const primary={...input.command,...(source.session_id?{expected_row_version:source.row_version}:{}),
            content:guided?{text:'已收到您的消息。可直接在群里补充故障情况，也可选择机器人单聊。请勿在群内提供患者、账号或联系方式等敏感信息。'}:input.command.content};
          const result=await communicationAppend({...input,command:primary});
          if(result.error)failP2016('ACTION_FAILED',503);
          if(personAllowed) {
            const direct=await communicationAppend({...input,command:{...primary,client_command_id:derivedCommand(primary.client_command_id),
              content:input.command.content},resolvedDestinations:[{provider:'WECOM_AIBOT',channel_account_id:source.source_bot_id,target_type:'PERSON',target_id:source.reporter_wecom_userid}]});
            if(direct.error)failP2016('ACTION_FAILED',503);
          }return result;
        }});
        const executor=createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),manualReviewStore:store,decisionStore:decisions,communicationPort:fixed,
          ticketCommandPort:{createMinimalTicket:async({transaction:tx,intake_id,occurred_at,trace_id})=>{
            const intakeId=await p2016TicketSourceIntake({transaction:tx,intakeId:intake_id});
            const result=await core.createForIntakeInTransaction({transaction:tx,intakeId,occurredAt:occurred_at,traceId:trace_id,title:boundedTicketTitle(source.summary)});
            if(result.created){const event=await appendTicketEvent({transaction:tx,ticket:result.ticket,eventType:'ticket.created',
              actor:{type:'PILOT_USER',id:principal.principal_id},traceId:trace_id});
              if(!webSource&&notificationProjector)await notificationProjector.project({transaction:tx,ticket:result.ticket,event});
              if(realtimeProjector)await realtimeProjector.ticket({transaction:tx,ticket:result.ticket,event});}
            return result;
          }}});
        const actionContext={trace_id:'p2-016:'+command.client_command_id,session_id:source.session_id??null,
          privacy_class:webSource?'PERSONAL':'INTERNAL',retention_until:source.retention_until,
          retention_until_epoch_ms:source.retention_until_epoch_ms,
          ...(!webSource?{destination:{provider:'WECOM_AIBOT',channel_account_id:source.source_bot_id,
            target_type:source.source_chat_type==='group'?'GROUP':'PERSON',target_id:source.source_chat_type==='group'?source.source_chat_id:source.reporter_wecom_userid}}:{})};
        const actions=await executor.execute({transaction,decision,context:actionContext});
        if(actions.some(a=>a.failed_safe))failP2016('REVIEW_ACTION_FAILED',409);
        if(realtimeProjector)await realtimeProjector.review({transaction,reviewId});
        return {ok:true,review_id:reviewId,status:resolution.status,resolution_decision_id:resolution.resolution_decision_id,action_count:actions.length};
      }});
    },
  });
}
