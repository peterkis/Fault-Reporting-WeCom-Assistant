import {failP2016,exactP2016,uuidP2016,versionP2016,codeP2016,publicP2016} from './p2-016-domain-contracts.mjs';
import type {PostgresPool} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {createConversationControlService} from './p2-005-conversation-control.mjs';
import {ConversationControlError} from './p2-005-conversation-control.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {guardP2016} from './p2-016-domain-contracts.mjs';
import {selfHandlingSchemaReady,selfHandlingResponsibilityEligibility,performFirstTicketResponsibilityInTransaction} from './workbench-ticket-self-handling.mjs';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
export interface ConversationHandlingCommand {
  action:'take-and-start-with-conversations'|'accept-for-later-with-conversations';
  ticket_id:string;client_command_id:string;expected_version:number;reason_code:string;resolver_team_id:string;
  communication_choice:'TAKE_SELECTED'|'RETAIN_CURRENT';
  sessions:{session_id:string;expected_row_version:number}[];
}
export function normalizeConversationHandlingCommand(input:unknown):ConversationHandlingCommand {
  const v=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','resolver_team_id','communication_choice','sessions']);
  if(v.action!=='take-and-start-with-conversations'&&v.action!=='accept-for-later-with-conversations')failP2016();
  if(v.communication_choice!=='TAKE_SELECTED'&&v.communication_choice!=='RETAIN_CURRENT')failP2016();
  if(!Array.isArray(v.sessions)||v.sessions.length>8)failP2016();
  const sessions=v.sessions.map(input=>{const s=exactP2016(input,['session_id','expected_row_version']);return {session_id:uuidP2016(s.session_id),expected_row_version:versionP2016(s.expected_row_version)};});
  if(new Set(sessions.map(s=>s.session_id)).size!==sessions.length||(v.communication_choice==='TAKE_SELECTED'?sessions.length===0:sessions.length!==0))failP2016();
  return publicP2016({action:v.action,ticket_id:uuidP2016(v.ticket_id),client_command_id:uuidP2016(v.client_command_id),expected_version:versionP2016(v.expected_version),reason_code:codeP2016(v.reason_code),resolver_team_id:codeP2016(v.resolver_team_id),communication_choice:v.communication_choice,sessions});
}
export function createTicketConversationHandlingService({pool,query,controlService,enabled=false,...hooks}:{pool:PostgresPool;query:P2016TicketQuery;controlService:Pick<ReturnType<typeof createConversationControlService>,'takeResponsibilityInTransaction'>;enabled?:boolean}&SelfHandlingHooks){
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({
    async acknowledgement({authContext,ticketId,commandId}:{authContext:unknown;ticketId:unknown;commandId:unknown}){
      guardP2016(enabled);const id=uuidP2016(ticketId),command=uuidP2016(commandId);
      if(!await selfHandlingSchemaReady(pool))failP2016('SELF_HANDLING_UNAVAILABLE',503);
      return ledger.conversationHandlingAcknowledgement({ticketId:id,commandId:command,authorize:transaction=>query.authorizedTicket({authContext,ticketId:id,transaction})});
    },
    async perform({authContext,command:input}:{authContext:unknown;command:unknown}){
    guardP2016(enabled);const command=normalizeConversationHandlingCommand(input);
    if(!await selfHandlingSchemaReady(pool))failP2016('SELF_HANDLING_UNAVAILABLE',503);
    return ledger.execute({command,authorize:async transaction=>{
      const context=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      for(const session of command.sessions)await query.authorizedRelatedConversation({authContext,ticketId:command.ticket_id,sessionId:session.session_id,transaction});
      return context;
    },run:async transaction=>{
      await hooks.realtimeProjector?.lock?.(transaction);
      const {ticket,principal}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction,lock:true});
      if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
      if(ticket.resolver_team_id!==command.resolver_team_id)failP2016('FORBIDDEN',403);
      const eligibility=await selfHandlingResponsibilityEligibility(transaction,principal,ticket,true);
      const action=command.action==='take-and-start-with-conversations'?'take-and-start':'accept-for-later';
      if(!eligibility.actions.includes(action))failP2016(eligibility.rejection??'SELF_HANDLING_STATE_CONFLICT',eligibility.rejection==='FORBIDDEN'?403:409);
      const selectedSessions=[...command.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id));
      for(const selected of selectedSessions){
        const {session,principal:currentPrincipal}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:selected.session_id,transaction,lock:true});
        if(session.session_row_version!==String(selected.expected_row_version))failP2016('VERSION_CONFLICT',409);
        if(!await query.conversationTakeAllowed({principal:currentPrincipal,session,transaction}))failP2016('FORBIDDEN',403);
      }
      const ticketResult=await performFirstTicketResponsibilityInTransaction({transaction,ticket,principal,command:{...command,action},initialCycle:eligibility.cycle,tracePrefix:'t05:',...hooks});
      const conversations:{session_id:string;session_row_version:number;control_event_id:string|null;changed:boolean}[]=[];
      for(const selected of selectedSessions){
        try{
          const result=await controlService.takeResponsibilityInTransaction({transaction,command:{command_type:'TAKEOVER',session_id:selected.session_id,
            client_command_id:command.client_command_id,idempotency_scope:'T05_SELF:'+selected.session_id.toUpperCase(),expected_row_version:selected.expected_row_version,
            actor_principal_id:principal.principal_id,target_principal_id:principal.principal_id,reason_code:command.reason_code}});
          if(!result.ok||!result.session)failP2016('CONTROL_CONFLICT',409);
          conversations.push({session_id:selected.session_id,session_row_version:result.session.row_version,control_event_id:result.event?.id??null,changed:!result.no_op});
        }catch(error){
          if(error instanceof ConversationControlError){
            if(error.code==='CONVERSATION_CONTROL_SESSION_VERSION_CONFLICT')failP2016('VERSION_CONFLICT',409);
            if(error.code==='CONVERSATION_CONTROL_UNAUTHORIZED'||error.code==='CONVERSATION_CONTROL_FORCE_TRANSFER_FORBIDDEN')failP2016('FORBIDDEN',403);
            if(error.code==='CONVERSATION_CONTROL_STORAGE_FAILED')throw error;
            failP2016('CONTROL_CONFLICT',409);
          }
          throw error;
        }
      }
      return {...ticketResult,communication_choice:command.communication_choice,conversations};
    }});
  }});
}
