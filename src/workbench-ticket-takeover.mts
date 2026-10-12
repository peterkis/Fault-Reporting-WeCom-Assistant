import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery,P2016TicketRow} from './p2-016-ticket-query.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import {selfHandlingSchemaReady} from './workbench-ticket-self-handling.mjs';
import {assignmentCycle} from './workbench-ticket-assignment.mjs';
import {transferTicketAssignmentP2016} from './p2-016-ticket-assignment.mjs';
import {createTicketActionService} from './p1-006-ticket-state-actions.mjs';
import {ConversationControlError} from './p2-005-conversation-control.mjs';
import type {createConversationControlService} from './p2-005-conversation-control.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016,publicP2016,transactionP2016,P2016_ERROR_CODES} from './p2-016-domain-contracts.mjs';
import type {P2016TakeoverAcknowledgement} from '../contracts/p2_016_takeover_contracts.js';

export interface TicketTakeoverCommand {
  action:'takeover'|'takeover-and-start';ticket_id:string;client_command_id:string;expected_version:number;reason_code:string;
  resolver_team_id:string;communication_choice:'RETAIN_CURRENT'|'TAKE_SELECTED';sessions:{session_id:string;expected_row_version:number}[];
}
const TRANSFER_STATES=['QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'];
export async function takeoverAllowedActions(transaction:PostgresTransaction,principal:WorkbenchPrincipal,ticket:P2016TicketRow,selectedTeam:string|null=null):Promise<TicketTakeoverCommand['action'][]>{
  if(!principal.is_active||!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role))||!TRANSFER_STATES.includes(ticket.status)||ticket.assignee_id===null)return [];
  const changed=await transaction.query(`SELECT 1 FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id JOIN pilot_ticket.pilot_principal p ON p.id=m.principal_id
    WHERE p.id=$1::uuid AND p.is_active AND rt.is_active AND ($2::text IS NULL OR m.team_id=$2)
      AND ($3::uuid<>p.id OR m.team_id<>$4) AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER')) LIMIT 1`,[principal.principal_id,selectedTeam,ticket.assignee_id,ticket.resolver_team_id]);
  if(!changed.rowCount)return [];const cycle=await assignmentCycle(transaction,ticket.id);
  if(!cycle&&(await transaction.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid LIMIT 1',[ticket.id])).rowCount)return [];
  return ['takeover',...(['QUEUED','ACCEPTED'].includes(ticket.status)&&cycle?.first_responsibility_event_id?['takeover-and-start' as const]:[])];
}
export function normalizeTicketTakeoverCommand(input:unknown):TicketTakeoverCommand {
  const v=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','resolver_team_id','communication_choice','sessions']);
  if(v.action!=='takeover'&&v.action!=='takeover-and-start'||v.communication_choice!=='RETAIN_CURRENT'&&v.communication_choice!=='TAKE_SELECTED'||!Array.isArray(v.sessions)||v.sessions.length>8)failP2016();
  const sessions=v.sessions.map(input=>{const row=exactP2016(input,['session_id','expected_row_version']);return {session_id:uuidP2016(row.session_id),expected_row_version:versionP2016(row.expected_row_version)};});
  if(new Set(sessions.map(row=>row.session_id)).size!==sessions.length||(v.communication_choice==='RETAIN_CURRENT'?sessions.length!==0:sessions.length===0))failP2016();
  return publicP2016({action:v.action,ticket_id:uuidP2016(v.ticket_id),client_command_id:uuidP2016(v.client_command_id),expected_version:versionP2016(v.expected_version),reason_code:codeP2016(v.reason_code),resolver_team_id:codeP2016(v.resolver_team_id),communication_choice:v.communication_choice,sessions});
}
export function createTicketTakeoverService({pool,query,controlService=null,enabled=false,...hooks}:{pool:PostgresPool;query:P2016TicketQuery;controlService?:Pick<ReturnType<typeof createConversationControlService>,'takeResponsibilityInTransaction'>|null;enabled?:boolean}&SelfHandlingHooks){
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({
  async acknowledgement({authContext,ticketId:inputTicket,commandId:inputCommand}:{authContext:unknown;ticketId:unknown;commandId:unknown}):Promise<P2016TakeoverAcknowledgement>{
    guardP2016(enabled);const ticketId=uuidP2016(inputTicket),commandId=uuidP2016(inputCommand);if(!await selfHandlingSchemaReady(pool))failP2016('ASSIGNMENT_UNAVAILABLE',503);
    return transactionP2016(pool,async transaction=>{
      await transaction.query('SET TRANSACTION READ ONLY');const {principal}=await query.authorizedTicket({authContext,ticketId,transaction});
      // Current READ + original actor/Ticket/UUID/purpose only. Never load the private result snapshot.
      const selected=await transaction.query<{state:unknown;version:unknown;event:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_ticket_version AS version,result_ticket_event_id::text AS event,error_code AS error,retryable FROM pilot_ticket.ticket_command_receipt
        WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid AND actor_principal_id=$4::uuid AND command_type='WORKBENCH_TICKET_TAKEOVER' LIMIT 1`,['P2_016:'+principal.principal_id,commandId,ticketId,principal.principal_id]);
      const row=selected.rows[0];if(!row||row.state==='STARTED')return {state:'UNKNOWN'};
      if(row.state==='COMMITTED')return {state:'COMMITTED',ticket_id:ticketId,ticket_version:versionP2016(row.version),ticket_event_id:uuidP2016(row.event)};
      if(row.state==='FAILED'&&row.retryable===false&&typeof row.error==='string'&&P2016_ERROR_CODES.includes(row.error))return {state:'FAILED',error:{code:row.error,retryable:false}};
      failP2016('ACTION_FAILED',503);
    });
  },
  async targets({authContext,ticketId,resolverTeamId=null}:{authContext:unknown;ticketId:unknown;resolverTeamId?:unknown}){
    guardP2016(enabled);if(!await selfHandlingSchemaReady(pool))failP2016('ASSIGNMENT_UNAVAILABLE',503);
    const selected=resolverTeamId===null?null:codeP2016(resolverTeamId);
    return transactionP2016(pool,async transaction=>{
      await transaction.query('SET TRANSACTION READ ONLY');const {ticket,principal}=await query.authorizedTicket({authContext,ticketId,transaction});
      if(!principal.is_active||!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))failP2016('FORBIDDEN',403);
      const own=`FROM pilot_ticket.resolver_team rt WHERE rt.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_team_member m WHERE m.team_id=rt.team_id AND m.principal_id=$1::uuid)`;
      const groups=await transaction.query<{team_id:string;display_name:string}>(`SELECT rt.team_id,rt.display_name ${own} ORDER BY rt.team_id LIMIT 100`,[principal.principal_id]);
      const chosen=selected===null?null:(await transaction.query<{team_id:string;display_name:string}>(`SELECT rt.team_id,rt.display_name ${own} AND rt.team_id=$2`,[principal.principal_id,selected])).rows[0];
      if(selected!==null&&!chosen)failP2016('TARGET_INVALID',403);
      const teams=chosen&&!groups.rows.some(row=>row.team_id===chosen.team_id)?[...groups.rows.slice(0,99),chosen].sort((a,b)=>a.team_id.localeCompare(b.team_id)):groups.rows;
      const actions=await takeoverAllowedActions(transaction,principal,ticket,selected);
      return publicP2016({resolver_teams:teams,resolver_team_id:selected,allowed_actions:actions});
    });
  },async perform({authContext,command:input}:{authContext:unknown;command:unknown}){
    guardP2016(enabled);const command=normalizeTicketTakeoverCommand(input);
    if(!await selfHandlingSchemaReady(pool))failP2016('ASSIGNMENT_UNAVAILABLE',503);
    return ledger.execute({command,receiptType:'WORKBENCH_TICKET_TAKEOVER',authorize:async transaction=>{
      await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      await lockP2016Realtime(transaction);
      const current=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      for(const selected of [...command.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id)))await query.authorizedRelatedConversation({authContext,ticketId:command.ticket_id,sessionId:selected.session_id,transaction});
      return current;
    },run:async transaction=>{
      const {ticket,principal:visiblePrincipal}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction,lock:true});
      const worker=await transaction.query<{role:string}>(`SELECT r.role FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
        WHERE p.id=$1::uuid AND p.is_active AND r.role IN ('ADMIN','DISPATCHER','HANDLER') ORDER BY r.role FOR SHARE OF p,r`,[visiblePrincipal.principal_id]);
      if(!worker.rowCount)failP2016('FORBIDDEN',403);
      const membership=await transaction.query(`SELECT m.principal_id FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
        WHERE m.principal_id=$1::uuid AND m.team_id=$2 FOR SHARE OF m,rt`,[visiblePrincipal.principal_id,ticket.resolver_team_id]);
      if(!worker.rows.some(row=>['ADMIN','DISPATCHER'].includes(row.role))&&ticket.assignee_id!==visiblePrincipal.principal_id&&!membership.rowCount)failP2016('FORBIDDEN',403);
      const {principal}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
      if(!TRANSFER_STATES.includes(ticket.status)||ticket.assignee_id===null||ticket.assignee_id===principal.principal_id&&ticket.resolver_team_id===command.resolver_team_id)failP2016('ASSIGNMENT_STATE_CONFLICT',409);
      const cycle=await assignmentCycle(transaction,ticket.id);
      if(!cycle&&(await transaction.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid LIMIT 1',[ticket.id])).rowCount)failP2016('ASSIGNMENT_STATE_CONFLICT',409);
      if(command.action==='takeover-and-start'&&(!['QUEUED','ACCEPTED'].includes(ticket.status)||!cycle||cycle.first_responsibility_event_id===null))failP2016('ASSIGNMENT_STATE_CONFLICT',409);
      if(command.communication_choice==='TAKE_SELECTED'&&!controlService)failP2016('CONTROL_UNAVAILABLE',503);
      const selectedSessions=[...command.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id));
      for(const selected of selectedSessions){
        const {session}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:selected.session_id,transaction,lock:true});
        // A continuation may have its own source Ticket group. Hold that scope,
        // in addition to the current actor role, through the composite commit.
        const sources=await transaction.query<{resolver_team_id:string}>(`SELECT t.resolver_team_id FROM pilot_ticket.ticket t JOIN conversation.session s ON s.service_intake_id=t.source_intake_id WHERE s.id=$1::uuid FOR SHARE OF t`,[selected.session_id]);
        for(const source of sources.rows)await transaction.query(`SELECT m.principal_id FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id WHERE m.principal_id=$1::uuid AND m.team_id=$2 FOR SHARE OF m,rt`,[principal.principal_id,source.resolver_team_id]);
        const {principal:currentPrincipal}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:selected.session_id,transaction});
        if(session.session_row_version!==String(selected.expected_row_version))failP2016('VERSION_CONFLICT',409);
        if(!await query.conversationTakeAllowed({principal:currentPrincipal,session,transaction}))failP2016('FORBIDDEN',403);
      }
      const conversations:{session_id:string;session_row_version:number;control_event_id:string|null;changed:boolean}[]=[];
      // Existing caller-Tx Control sees the original group before Ticket moves.
      for(const selected of selectedSessions){
        try{
          if(!controlService)failP2016('CONTROL_UNAVAILABLE',503);
          const taken=await controlService.takeResponsibilityInTransaction({transaction,command:{command_type:'TAKEOVER',session_id:selected.session_id,client_command_id:command.client_command_id,idempotency_scope:'T07_SELF:'+selected.session_id.toUpperCase(),expected_row_version:selected.expected_row_version,actor_principal_id:principal.principal_id,target_principal_id:principal.principal_id,reason_code:command.reason_code}});
          if(!taken.ok||!taken.session)failP2016('CONTROL_CONFLICT',409);
          conversations.push({session_id:selected.session_id,session_row_version:taken.session.row_version,control_event_id:taken.event?.id??null,changed:!taken.no_op});
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
      const result=await transferTicketAssignmentP2016({transaction,principal,ticket,command:{action:'transfer-assignment',ticket_id:ticket.id,client_command_id:command.client_command_id,expected_version:command.expected_version,reason_code:command.reason_code,target_principal_id:principal.principal_id,resolver_team_id:command.resolver_team_id},workbenchBusinessAssignment:true});
      if(cycle)await transaction.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[ticket.id,cycle.id,result.event.event_id]);
      await hooks.notificationProjector?.project({transaction,...result});
      await hooks.realtimeProjector?.({transaction,...result,command});
      let finalVersion=result.ticket.version,finalEvent=result.event.event_id;
      if(command.action==='takeover-and-start'){
        if(!cycle||!cycle.first_responsibility_event_id)failP2016('ASSIGNMENT_STATE_CONFLICT',409);
        const actions=createTicketActionService({authorize:async()=>true,afterAction:hooks.closure?.afterTicketAction??null});
        const chain:('accept'|'start')[]=ticket.status==='QUEUED'?['accept','start']:['start'];
        for(const action of chain){
          const changed=await actions.performInTransaction({ticketId:ticket.id,action,actor:{type:'PILOT_USER',id:principal.principal_id},expectedVersion:finalVersion,reasonCode:command.reason_code,traceId:'t07:'+command.client_command_id},transaction);
          await transaction.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[ticket.id,cycle.id,changed.event.event_id]);
          if(hooks.notificationProjector&&!hooks.closure)await hooks.notificationProjector.project({transaction,...changed});
          await hooks.realtimeProjector?.({transaction,...changed,command});finalVersion=changed.ticket.version;finalEvent=changed.event.event_id;
        }
      }
      return {ok:true as const,ticket_id:ticket.id,ticket_version:finalVersion,ticket_event_id:finalEvent,control_event_id:null,handling_cycle:cycle,communication_choice:command.communication_choice,conversations};
    }});
  }});
}
