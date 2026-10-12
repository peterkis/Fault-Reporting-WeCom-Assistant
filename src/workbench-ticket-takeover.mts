import type {PostgresPool} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery} from './p2-016-ticket-query.mjs';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import {selfHandlingSchemaReady} from './workbench-ticket-self-handling.mjs';
import {assignmentCycle} from './workbench-ticket-assignment.mjs';
import {transferTicketAssignmentP2016} from './p2-016-ticket-assignment.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016,publicP2016} from './p2-016-domain-contracts.mjs';

export interface TicketTakeoverCommand {
  action:'takeover';ticket_id:string;client_command_id:string;expected_version:number;reason_code:string;
  resolver_team_id:string;communication_choice:'RETAIN_CURRENT';sessions:[];
}
export function normalizeTicketTakeoverCommand(input:unknown):TicketTakeoverCommand {
  const v=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','resolver_team_id','communication_choice','sessions']);
  if(v.action!=='takeover'||v.communication_choice!=='RETAIN_CURRENT'||!Array.isArray(v.sessions)||v.sessions.length!==0)failP2016();
  return publicP2016({action:v.action,ticket_id:uuidP2016(v.ticket_id),client_command_id:uuidP2016(v.client_command_id),expected_version:versionP2016(v.expected_version),reason_code:codeP2016(v.reason_code),resolver_team_id:codeP2016(v.resolver_team_id),communication_choice:v.communication_choice,sessions:[]});
}
export function createTicketTakeoverService({pool,query,enabled=false,...hooks}:{pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean}&SelfHandlingHooks){
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({async perform({authContext,command:input}:{authContext:unknown;command:unknown}){
    guardP2016(enabled);const command=normalizeTicketTakeoverCommand(input);
    if(!await selfHandlingSchemaReady(pool))failP2016('ASSIGNMENT_UNAVAILABLE',503);
    return ledger.execute({command,receiptType:'WORKBENCH_TICKET_TAKEOVER',authorize:async transaction=>{
      await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      await lockP2016Realtime(transaction);
      return query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
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
      if(ticket.status!=='ACCEPTED'||ticket.assignee_id===null||ticket.assignee_id===principal.principal_id&&ticket.resolver_team_id===command.resolver_team_id)failP2016('ASSIGNMENT_STATE_CONFLICT',409);
      const cycle=await assignmentCycle(transaction,ticket.id);
      if(!cycle&&(await transaction.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid LIMIT 1',[ticket.id])).rowCount)failP2016('ASSIGNMENT_STATE_CONFLICT',409);
      const result=await transferTicketAssignmentP2016({transaction,principal,ticket,command:{action:'transfer-assignment',ticket_id:ticket.id,client_command_id:command.client_command_id,expected_version:command.expected_version,reason_code:command.reason_code,target_principal_id:principal.principal_id,resolver_team_id:command.resolver_team_id},workbenchBusinessAssignment:true});
      if(cycle)await transaction.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[ticket.id,cycle.id,result.event.event_id]);
      await hooks.notificationProjector?.project({transaction,...result});
      await hooks.realtimeProjector?.({transaction,...result,command});
      return {ok:true as const,ticket_id:ticket.id,ticket_version:result.ticket.version,ticket_event_id:result.event.event_id,control_event_id:null,handling_cycle:cycle,communication_choice:command.communication_choice,conversations:[]};
    }});
  }});
}
