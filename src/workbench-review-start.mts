import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createP2016ManualReviewFacade} from './p2-016-manual-review-facade.mjs';
import type {createConversationControlService} from './p2-005-conversation-control.mjs';
import type {ReviewResolveAndStartCommand,ReviewResolveAndStartResult} from '../contracts/workbench_review_start_contracts.js';
import type {ReviewStartReceipt} from '../contracts/workbench_review_start_receipt_contracts.js';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import {ConversationControlError} from './p2-005-conversation-control.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {selfHandlingSchemaReady,selfHandlingResponsibilityEligibility,performFirstTicketResponsibilityInTransaction} from './workbench-ticket-self-handling.mjs';
import {exactP2016,uuidP2016,codeP2016,failP2016,guardP2016,publicP2016,transactionP2016} from './p2-016-domain-contracts.mjs';

function capturedVersion(value:unknown):number{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)failP2016();
  return value;
}

export function normalizeReviewStartCommand(input:unknown):ReviewResolveAndStartCommand{
  const v=exactP2016(input,['client_command_id','expected_row_version','expected_material_basis','resolution_code','resolution_reason_code','expected_ticket','resolver_team_id','communication_choice','sessions']);
  if(typeof v.expected_row_version!=='string'||!/^[1-9][0-9]{0,18}$/u.test(v.expected_row_version)||BigInt(v.expected_row_version)>9223372036854775807n
    ||typeof v.expected_material_basis!=='string'||!/^[a-f0-9]{64}$/u.test(v.expected_material_basis)||v.resolution_code!=='CONFIRM_TICKET_ELIGIBLE')failP2016();
  const ticket=v.expected_ticket===null?null:exactP2016(v.expected_ticket,['ticket_id','expected_version']);
  if(v.communication_choice!=='TAKE_SELECTED'&&v.communication_choice!=='RETAIN_CURRENT'||!Array.isArray(v.sessions)||v.sessions.length>8)failP2016();
  const sessions=v.sessions.map(value=>{const s=exactP2016(value,['session_id','expected_row_version']);return {session_id:uuidP2016(s.session_id),expected_row_version:capturedVersion(s.expected_row_version)};});
  if(new Set(sessions.map(s=>s.session_id)).size!==sessions.length||(v.communication_choice==='TAKE_SELECTED'?sessions.length===0:sessions.length!==0))failP2016();
  return publicP2016({client_command_id:uuidP2016(v.client_command_id),expected_row_version:v.expected_row_version,expected_material_basis:v.expected_material_basis,
    resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:codeP2016(v.resolution_reason_code),expected_ticket:ticket===null?null:{ticket_id:uuidP2016(ticket.ticket_id),expected_version:capturedVersion(ticket.expected_version)},
    resolver_team_id:codeP2016(v.resolver_team_id),communication_choice:v.communication_choice,sessions});
}

type Reviews=ReturnType<typeof createP2016ManualReviewFacade>;
type StartSuccess=Omit<ReviewResolveAndStartResult,'replayed'>;
export function createWorkbenchReviewStart({pool,query,reviews,controlService,enabled=false,...hooks}:{pool:PostgresPool;query:P2016TicketQuery;reviews:Reviews;
  controlService:Pick<ReturnType<typeof createConversationControlService>,'takeResponsibilityInTransaction'>;enabled?:boolean}&SelfHandlingHooks){
  const ledger=createP2016CommandLedger({pool});
  async function authorize(authContext:unknown,reviewId:string,command:ReviewResolveAndStartCommand,transaction:PostgresTransaction,lock=false){
    const review=await reviews.getManualReviewDetail({authContext,reviewId,transaction});
    const principal=await query.principal(authContext,transaction);
    if(!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))failP2016('FORBIDDEN',403);
    const member=await transaction.query(`SELECT p.id FROM pilot_ticket.pilot_principal p
      JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id
      JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id WHERE p.id=$1::uuid AND p.is_active AND rt.is_active
        AND m.team_id=$2 AND r.role IN ('ADMIN','DISPATCHER','HANDLER')${lock?' FOR SHARE OF p,r,m,rt':''}`,[principal.principal_id,command.resolver_team_id]);
    if(!member.rowCount)failP2016('FORBIDDEN',403);
    // Re-read scope after the authority rows were acquired; waiting is not authorization.
    const current=lock?await query.principal(authContext,transaction):principal;
    if(lock)await reviews.getManualReviewDetail({authContext,reviewId,transaction});
    if(command.expected_ticket){
      await query.authorizedTicket({authContext,ticketId:command.expected_ticket.ticket_id,transaction});
      for(const s of command.sessions)await query.authorizedRelatedConversation({authContext,ticketId:command.expected_ticket.ticket_id,sessionId:s.session_id,transaction});
    }
    return {principal:current,review};
  }
  return Object.freeze({
    async relatedSession({authContext,reviewId:inputReview,sessionId:inputSession}:{authContext:unknown;reviewId:unknown;sessionId:unknown}){
      guardP2016(enabled);if(!await selfHandlingSchemaReady(pool))failP2016('SELF_HANDLING_UNAVAILABLE',503);
      const reviewId=uuidP2016(inputReview),sessionId=uuidP2016(inputSession);
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION READ ONLY');
        await reviews.getManualReviewDetail({authContext,reviewId,transaction});
        const principal=await query.principal(authContext,transaction);
        if(!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))failP2016('FORBIDDEN',403);
        const canonical=await reviews.canonicalItem({authContext,reviewId,transaction});
        if(canonical.kind!=='ticket')failP2016('NOT_FOUND',404);
        await query.authorizedRelatedConversation({authContext,ticketId:canonical.id,sessionId,transaction});
        return publicP2016({review_id:reviewId,ticket_id:canonical.id,session_id:sessionId});
      });
    },
    async receipt({authContext,reviewId:inputReview,commandId:inputCommand}:{authContext:unknown;reviewId:unknown;commandId:unknown}):Promise<ReviewStartReceipt>{
      guardP2016(enabled);if(!await selfHandlingSchemaReady(pool))failP2016('SELF_HANDLING_UNAVAILABLE',503);
      const reviewId=uuidP2016(inputReview),commandId=uuidP2016(inputCommand);
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION READ ONLY');
        await reviews.getManualReviewDetail({authContext,reviewId,transaction});
        const principal=await query.principal(authContext,transaction);
        if(!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))failP2016('FORBIDDEN',403);
        const selected=await transaction.query<{state:string;snapshot:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_snapshot AS snapshot,error_code AS error,retryable
          FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND review_id=$3::uuid
          AND actor_principal_id=$4::uuid AND command_type='MANUAL_REVIEW_START' LIMIT 1`,['P2_016:'+principal.principal_id,commandId,reviewId,principal.principal_id]);
        const row=selected.rows[0],base={client_command_id:commandId,review_id:reviewId};
        if(!row||row.state==='STARTED')return publicP2016({...base,state:'UNKNOWN'});
        if(row.state==='FAILED'&&row.retryable===false)return publicP2016({...base,state:'FAILED',error:{code:codeP2016(row.error),retryable:false}});
        if(row.state==='COMMITTED'){
          const result=exactP2016(row.snapshot,['ok','review_id','status','resolution_decision_id','action_count','ticket_id','ticket_version','ticket_event_id','handling_cycle','communication_choice','conversations','canonical_item']);
          if(result.ok!==true||result.review_id!==reviewId||result.status!=='RESOLVED'||!Array.isArray(result.conversations)||result.conversations.length>8)failP2016('ACTION_FAILED',503);
          const ticketId=uuidP2016(result.ticket_id);
          await query.authorizedTicket({authContext,ticketId,transaction});
          for(const value of result.conversations){const session=exactP2016(value,['session_id','session_row_version','control_event_id','changed']);await query.authorizedRelatedConversation({authContext,ticketId,sessionId:uuidP2016(session.session_id),transaction});}
          return publicP2016({...base,state:'COMMITTED',ticket_id:ticketId,ticket_version:capturedVersion(result.ticket_version),ticket_event_id:uuidP2016(result.ticket_event_id)});
        }
        failP2016('ACTION_FAILED',503);
      });
    },
    async context({authContext,reviewId:inputReview}:{authContext:unknown;reviewId:unknown}){
      guardP2016(enabled);if(!await selfHandlingSchemaReady(pool))failP2016('SELF_HANDLING_UNAVAILABLE',503);
      const reviewId=uuidP2016(inputReview);
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION READ ONLY');
        const review=await reviews.getManualReviewDetail({authContext,reviewId,transaction}),principal=await query.principal(authContext,transaction);
        if(!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))failP2016('FORBIDDEN',403);
        const teams=await transaction.query<{team_id:string;display_name:string}>(`SELECT rt.team_id,rt.display_name FROM pilot_ticket.resolver_team rt
          JOIN pilot_ticket.pilot_team_member m ON m.team_id=rt.team_id WHERE m.principal_id=$1::uuid AND rt.is_active ORDER BY rt.team_id LIMIT 100`,[principal.principal_id]);
        const canonical=await reviews.canonicalItem({authContext,reviewId,transaction});
        const ticket=canonical.kind==='ticket'?(await query.authorizedTicket({authContext,ticketId:canonical.id,transaction})).ticket:null;
        const eligible=ticket?await selfHandlingResponsibilityEligibility(transaction,principal,ticket):null;
        return publicP2016({review_id:reviewId,expected_ticket:ticket?{ticket_id:ticket.id,expected_version:ticket.version}:null,
          resolver_team_id:ticket?.resolver_team_id??null,resolver_teams:teams.rows,
          allowed:review.status==='PENDING'&&review.allowed_resolutions.includes('CONFIRM_TICKET_ELIGIBLE')&&(!eligible||eligible.actions.includes('take-and-start'))});
      });
    },
    async perform({authContext,reviewId:inputReview,body}:{authContext:unknown;reviewId:unknown;body:unknown}){
    guardP2016(enabled);if(!await selfHandlingSchemaReady(pool))failP2016('SELF_HANDLING_UNAVAILABLE',503);
    const reviewId=uuidP2016(inputReview),input=normalizeReviewStartCommand(body),command={...input,review_id:reviewId,action:'MANUAL_REVIEW_START'};
    return ledger.execute({command,authorize:tx=>authorize(authContext,reviewId,input,tx),afterReceiptLock:async tx=>{await authorize(authContext,reviewId,input,tx);},run:async tx=>{
      await hooks.realtimeProjector?.lock?.(tx);
      const prior=await reviews.canonicalItem({authContext,reviewId,transaction:tx});
      if(input.expected_ticket?(prior.kind!=='ticket'||prior.id!==input.expected_ticket.ticket_id):prior.kind==='ticket')failP2016('VERSION_CONFLICT',409);
      let result:StartSuccess|undefined;
      await reviews.resolveManualReviewInTransaction({authContext,reviewId,transaction:tx,body:{client_command_id:input.client_command_id,
        expected_row_version:input.expected_row_version,expected_material_basis:input.expected_material_basis,resolution_code:input.resolution_code,resolution_reason_code:input.resolution_reason_code},afterResolution:async resolution=>{
        const canonical=await reviews.canonicalItem({authContext,reviewId,transaction:tx});if(canonical.kind!=='ticket')failP2016('ACTION_FAILED',503);
        if(input.expected_ticket&&canonical.id!==input.expected_ticket.ticket_id)failP2016('VERSION_CONFLICT',409);
        const {ticket}=await query.authorizedTicket({authContext,ticketId:canonical.id,transaction:tx,lock:true});
        if(input.expected_ticket&&ticket.version!==input.expected_ticket.expected_version)failP2016('VERSION_CONFLICT',409);
        if(ticket.resolver_team_id!==input.resolver_team_id)failP2016('FORBIDDEN',403);
        const selected=[...input.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id));
        for(const s of selected){
          const {session}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:s.session_id,transaction:tx,lock:true});
          if(session.session_row_version!==String(s.expected_row_version))failP2016('VERSION_CONFLICT',409);
        }
        const {principal}=await authorize(authContext,reviewId,input,tx,true);
        const eligibility=await selfHandlingResponsibilityEligibility(tx,principal,ticket,true);
        if(!eligibility.actions.includes('take-and-start'))failP2016(eligibility.rejection??'SELF_HANDLING_STATE_CONFLICT',eligibility.rejection==='FORBIDDEN'?403:409);
        for(const s of selected){const {session}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:s.session_id,transaction:tx});
          if(!await query.conversationTakeAllowed({principal,session,transaction:tx}))failP2016('FORBIDDEN',403);}
        const started=await performFirstTicketResponsibilityInTransaction({transaction:tx,ticket,principal,command:{action:'take-and-start',ticket_id:ticket.id,client_command_id:input.client_command_id,
          expected_version:ticket.version,reason_code:input.resolution_reason_code,resolver_team_id:input.resolver_team_id},initialCycle:eligibility.cycle,tracePrefix:'t15:',...hooks});
        const conversations:ReviewResolveAndStartResult['conversations'][number][]=[];
        for(const s of selected){
          try{
            const changed=await controlService.takeResponsibilityInTransaction({transaction:tx,command:{command_type:'TAKEOVER',session_id:s.session_id,client_command_id:input.client_command_id,
              idempotency_scope:'T15_REVIEW_START:'+s.session_id.toUpperCase(),expected_row_version:s.expected_row_version,actor_principal_id:principal.principal_id,target_principal_id:principal.principal_id,reason_code:input.resolution_reason_code}});
            if(!changed.ok||!changed.session)failP2016('CONTROL_CONFLICT',409);
            conversations.push({session_id:s.session_id,session_row_version:changed.session.row_version,control_event_id:changed.event?.id??null,changed:!changed.no_op});
          }catch(error){
            if(error instanceof ConversationControlError){if(error.code==='CONVERSATION_CONTROL_SESSION_VERSION_CONFLICT')failP2016('VERSION_CONFLICT',409);
              if(error.code==='CONVERSATION_CONTROL_UNAUTHORIZED'||error.code==='CONVERSATION_CONTROL_FORCE_TRANSFER_FORBIDDEN')failP2016('FORBIDDEN',403);
              if(error.code!=='CONVERSATION_CONTROL_STORAGE_FAILED')failP2016('CONTROL_CONFLICT',409);}
            throw error;
          }
        }
        const linked=await tx.query('UPDATE intake.manual_review_item SET linked_ticket_id=$2::uuid WHERE id=$1::uuid AND status=\'RESOLVED\' AND (linked_ticket_id IS NULL OR linked_ticket_id=$2::uuid)',[reviewId,ticket.id]);
        if(linked.rowCount!==1||resolution.status!=='RESOLVED')failP2016('ACTION_FAILED',503);
        result={ok:true,review_id:reviewId,status:'RESOLVED',resolution_decision_id:resolution.resolution_decision_id,action_count:resolution.action_count,ticket_id:ticket.id,
          ticket_version:started.ticket_version,ticket_event_id:started.ticket_event_id,handling_cycle:started.handling_cycle,communication_choice:input.communication_choice,conversations,canonical_item:{kind:'ticket',id:ticket.id}};
      }});
      if(!result)failP2016('ACTION_FAILED',503);return result;
    }});
  }});
}
