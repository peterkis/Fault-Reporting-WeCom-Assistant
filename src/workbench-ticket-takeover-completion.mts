import type {PostgresPool} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import type {createConversationControlService} from './p2-005-conversation-control.mjs';
import type {P2016TakeoverCompletionCommand} from '../contracts/p2_016_takeover_completion_contracts.js';
import {takeoverTicketInTransaction,takeoverAllowedActions} from './workbench-ticket-takeover.mjs';
import {completeTicketInTransaction,staffCompletionEligibility,staffCompletionSchemaReady} from './workbench-ticket-completion.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016,publicP2016,transactionP2016} from './p2-016-domain-contracts.mjs';

type TakeoverCompletionCommand=Omit<P2016TakeoverCompletionCommand,'communication_choice'|'sessions'>&{
  action:'takeover-and-complete';ticket_id:string;communication_choice:'RETAIN_CURRENT'|'TAKE_SELECTED';
  sessions:{session_id:string;expected_row_version:number}[];
};
export function normalizeTakeoverCompletionCommand(input:unknown):TakeoverCompletionCommand{
  const v=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','resolver_team_id','handling_cycle_id','communication_choice','sessions','internal_process','external_summary','external_summary_confirmed']);
  if(v.action!=='takeover-and-complete'||v.reason_code!=='STAFF_COMPLETED'||v.external_summary_confirmed!==true
    ||v.communication_choice!=='RETAIN_CURRENT'&&v.communication_choice!=='TAKE_SELECTED'
    ||!Array.isArray(v.sessions)||v.sessions.length>8
    ||typeof v.internal_process!=='string'||!v.internal_process.trim()||v.internal_process.length>2000
    ||typeof v.external_summary!=='string'||!v.external_summary.trim()||v.external_summary.length>500)failP2016();
  const sessions=v.sessions.map(value=>{const row=exactP2016(value,['session_id','expected_row_version']);return {session_id:uuidP2016(row.session_id),expected_row_version:versionP2016(row.expected_row_version)};});
  if(new Set(sessions.map(row=>row.session_id)).size!==sessions.length
    ||(v.communication_choice==='RETAIN_CURRENT'?sessions.length!==0:sessions.length===0))failP2016();
  return publicP2016({action:'takeover-and-complete',ticket_id:uuidP2016(v.ticket_id),client_command_id:uuidP2016(v.client_command_id),
    expected_version:versionP2016(v.expected_version),reason_code:'STAFF_COMPLETED',resolver_team_id:codeP2016(v.resolver_team_id),
    handling_cycle_id:uuidP2016(v.handling_cycle_id),communication_choice:v.communication_choice,sessions,
    internal_process:v.internal_process,external_summary:v.external_summary,external_summary_confirmed:true});
}

export function createTicketTakeoverCompletionService({pool,query,controlService=null,enabled=false,...hooks}:{
  pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean;
  controlService?:Pick<ReturnType<typeof createConversationControlService>,'takeResponsibilityInTransaction'>|null;
}&SelfHandlingHooks){
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({
  async targets({authContext,ticketId,resolverTeamId=null}:{authContext:unknown;ticketId:unknown;resolverTeamId?:unknown}){
    guardP2016(enabled);if(!await staffCompletionSchemaReady(pool))failP2016('STAFF_COMPLETION_UNAVAILABLE',503);
    const selected=resolverTeamId===null?null:codeP2016(resolverTeamId);
    return transactionP2016(pool,async transaction=>{
      await transaction.query('SET TRANSACTION READ ONLY');
      const {ticket,principal}=await query.authorizedTicket({authContext,ticketId,transaction});
      if(!principal.is_active||!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))failP2016('FORBIDDEN',403);
      const own=`FROM pilot_ticket.resolver_team rt WHERE rt.is_active AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_team_member m WHERE m.team_id=rt.team_id AND m.principal_id=$1::uuid)`;
      const groups=await transaction.query<{team_id:string;display_name:string}>(`SELECT rt.team_id,rt.display_name ${own} ORDER BY rt.team_id LIMIT 100`,[principal.principal_id]);
      const chosen=selected===null?null:(await transaction.query<{team_id:string;display_name:string}>(`SELECT rt.team_id,rt.display_name ${own} AND rt.team_id=$2`,[principal.principal_id,selected])).rows[0];
      if(selected!==null&&!chosen)failP2016('TARGET_INVALID',403);
      const teams=chosen&&!groups.rows.some(team=>team.team_id===chosen.team_id)?[...groups.rows.slice(0,99),chosen].sort((a,b)=>a.team_id.localeCompare(b.team_id)):groups.rows;
      const originalGroup=await transaction.query('SELECT 1 FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2 LIMIT 1',[principal.principal_id,ticket.resolver_team_id]);
      const operational=principal.roles.some(role=>['ADMIN','DISPATCHER'].includes(role))||ticket.assignee_id===principal.principal_id||Boolean(originalGroup.rowCount);
      const {cycle}=await staffCompletionEligibility(transaction,principal,ticket);
      const canTransfer=(await takeoverAllowedActions(transaction,principal,ticket,selected)).includes('takeover');
      const permitted=operational&&canTransfer&&['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'].includes(ticket.status)
        &&cycle!==null&&cycle.first_responsibility_event_id!==null&&cycle.staff_completion_event_id===null&&cycle.source_intake_id===ticket.intake_id;
      return publicP2016({resolver_teams:teams,resolver_team_id:selected,allowed_actions:permitted?['takeover-and-complete' as const]:[]});
    });
  },async perform({authContext,command:input}:{authContext:unknown;command:unknown}){
    guardP2016(enabled);const command=normalizeTakeoverCompletionCommand(input);
    if(!await staffCompletionSchemaReady(pool))failP2016('STAFF_COMPLETION_UNAVAILABLE',503);
    return ledger.execute({command,receiptType:'WORKBENCH_TICKET_TAKEOVER_COMPLETION',authorize:async transaction=>{
      const visible=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      if(!visible.principal.is_active||!visible.principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))failP2016('FORBIDDEN',403);
      await lockP2016Realtime(transaction);
      const current=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      for(const session of [...command.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id)))
        await query.authorizedRelatedConversation({authContext,ticketId:command.ticket_id,sessionId:session.session_id,transaction});
      return current;
    },run:async transaction=>{
      const {ticket,principal}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction,lock:true});
      if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
      // Check the existing current cycle before either independent responsibility moves.
      // The actor is intentionally not the owner yet; closing authority is checked again after transfer.
      const {cycle}=await staffCompletionEligibility(transaction,principal,ticket,true);
      if(!['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'].includes(ticket.status)||!cycle
        ||cycle.id!==command.handling_cycle_id||cycle.source_intake_id!==ticket.intake_id
        ||cycle.first_responsibility_event_id===null||cycle.staff_completion_event_id!==null)failP2016('STAFF_COMPLETION_STATE_CONFLICT',409);
      const transferred=await takeoverTicketInTransaction({transaction,authContext,query,controlService,...hooks,
        command:{action:'takeover',ticket_id:command.ticket_id,client_command_id:command.client_command_id,expected_version:command.expected_version,
          reason_code:command.reason_code,resolver_team_id:command.resolver_team_id,communication_choice:command.communication_choice,sessions:command.sessions}});
      const completed=await completeTicketInTransaction({transaction,authContext,query,realtimeProjector:hooks.realtimeProjector??null,
        command:{action:'complete',ticket_id:command.ticket_id,client_command_id:command.client_command_id,expected_version:transferred.ticket_version,
          reason_code:'STAFF_COMPLETED',handling_cycle_id:command.handling_cycle_id,internal_process:command.internal_process,
          external_summary:command.external_summary,external_summary_confirmed:true}});
      return {...completed,communication_choice:command.communication_choice,conversations:transferred.conversations};
    }});
  }});
}
