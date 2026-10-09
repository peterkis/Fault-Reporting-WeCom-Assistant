import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery,P2016TicketRow} from './p2-016-ticket-query.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {HandlingCycle,SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import {selfHandlingSchemaReady} from './workbench-ticket-self-handling.mjs';
import {createTicketActionService} from './p1-006-ticket-state-actions.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {transferTicketAssignmentP2016} from './p2-016-ticket-assignment.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016,publicP2016,transactionP2016,P2016_ERROR_CODES} from './p2-016-domain-contracts.mjs';
import type {P2016AssignmentAcknowledgement} from '../contracts/p2_016_contracts.js';
import {ConversationControlError} from './p2-005-conversation-control.mjs';
import type {createConversationControlService} from './p2-005-conversation-control.mjs';

export interface TicketAssignmentCommand {
  action:'assign'|'transfer-assignment';ticket_id:string;client_command_id:string;expected_version:number;reason_code:string;
  target_principal_id:string;resolver_team_id:string;communication_choice:'RETAIN_CURRENT'|'TRANSFER_SELECTED';
  sessions:{session_id:string;expected_row_version:number}[];
}
export function normalizeTicketAssignmentCommand(input:unknown):TicketAssignmentCommand{
  const v=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','target_principal_id','resolver_team_id','communication_choice','sessions']);
  if(v.action!=='assign'&&v.action!=='transfer-assignment'||v.communication_choice!=='RETAIN_CURRENT'&&v.communication_choice!=='TRANSFER_SELECTED'||!Array.isArray(v.sessions)||v.sessions.length>8)failP2016();
  const sessions=v.sessions.map(value=>{const row=exactP2016(value,['session_id','expected_row_version']);return {session_id:uuidP2016(row.session_id),expected_row_version:versionP2016(row.expected_row_version)};});
  if(new Set(sessions.map(row=>row.session_id)).size!==sessions.length||(v.communication_choice==='RETAIN_CURRENT'?sessions.length!==0:sessions.length===0))failP2016();
  return publicP2016({action:v.action,ticket_id:uuidP2016(v.ticket_id),client_command_id:uuidP2016(v.client_command_id),expected_version:versionP2016(v.expected_version),reason_code:codeP2016(v.reason_code),target_principal_id:uuidP2016(v.target_principal_id),resolver_team_id:codeP2016(v.resolver_team_id),communication_choice:v.communication_choice,sessions});
}
export function assignmentActions(principal:WorkbenchPrincipal,ticket:P2016TicketRow):TicketAssignmentCommand['action'][]{
  if(!principal.is_active||!principal.roles.some(role=>['ADMIN','DISPATCHER','HANDLER'].includes(role)))return [];
  if(ticket.assignee_id===null&&['NEW','QUEUED'].includes(ticket.status))return ['assign'];
  return ticket.assignee_id!==null&&['QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'].includes(ticket.status)?['transfer-assignment']:[];
}
export async function assignmentCycle(transaction:PostgresTransaction,ticketId:string):Promise<HandlingCycle|null>{
  const result=await transaction.query<HandlingCycle>(`SELECT c.id::text,c.cycle_no,c.first_responsibility_event_id::text
    FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_handling_cycle c ON c.id=t.current_handling_cycle_id AND c.ticket_id=t.id WHERE t.id=$1::uuid`,[ticketId]);
  return result.rows[0]??null;
}
export function createTicketAssignmentService({pool,query,controlService=null,enabled=false,...hooks}:{pool:PostgresPool;query:P2016TicketQuery;controlService?:Pick<ReturnType<typeof createConversationControlService>,'takeoverSessionInTransaction'|'transferAssignmentInTransaction'>|null;enabled?:boolean}&SelfHandlingHooks){
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({
    async acknowledgement({authContext,ticketId:inputTicket,commandId:inputCommand}:{authContext:unknown;ticketId:unknown;commandId:unknown}):Promise<P2016AssignmentAcknowledgement>{
      guardP2016(enabled);const ticketId=uuidP2016(inputTicket),commandId=uuidP2016(inputCommand);if(!await selfHandlingSchemaReady(pool))failP2016('ASSIGNMENT_UNAVAILABLE',503);
      return transactionP2016(pool,async transaction=>{await transaction.query('SET TRANSACTION READ ONLY');const {principal}=await query.authorizedTicket({authContext,ticketId,transaction});
        const selected=await transaction.query<{state:unknown;version:unknown;event:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_ticket_version AS version,result_ticket_event_id::text AS event,error_code AS error,retryable FROM pilot_ticket.ticket_command_receipt
          WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid AND command_type='WORKBENCH_TICKET_ASSIGNMENT' LIMIT 1`,['P2_016:'+principal.principal_id,commandId,ticketId]);
        const row=selected.rows[0];if(!row||row.state==='STARTED')return {state:'UNKNOWN'};
        if(row.state==='COMMITTED')return {state:'COMMITTED',ticket_id:ticketId,ticket_version:versionP2016(row.version),ticket_event_id:uuidP2016(row.event)};
        if(row.state==='FAILED'&&row.retryable===false&&typeof row.error==='string'&&P2016_ERROR_CODES.includes(row.error))return {state:'FAILED',error:{code:row.error,retryable:false}};
        failP2016('ACTION_FAILED',503);
      });
    },async perform({authContext,command:input}:{authContext:unknown;command:unknown}){
    guardP2016(enabled);const command=normalizeTicketAssignmentCommand(input);
    if(!await selfHandlingSchemaReady(pool))failP2016('ASSIGNMENT_UNAVAILABLE',503);
    return ledger.execute({command,receiptType:'WORKBENCH_TICKET_ASSIGNMENT',authorize:async transaction=>{
      await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      // Follow the integrated stream mutex order before receipt foreign-key locks.
      await lockP2016Realtime(transaction);
      const current=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      // A committed reply still contains selected Session references. Reauthorize READ before every receipt lookup;
      // replay does not reacquire the TRANSFER write authority that the original command handed off.
      for(const selected of [...command.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id)))await query.authorizedRelatedConversation({authContext,ticketId:command.ticket_id,sessionId:selected.session_id,transaction});
      return current;
    },run:async transaction=>{
      const {ticket,principal:visiblePrincipal}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction,lock:true});
      // These are authority rows, not a second ownership fact. Hold the current operator's role and scope until commit.
      const worker=await transaction.query<{role:string}>(`SELECT r.role FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
        WHERE p.id=$1::uuid AND p.is_active AND r.role IN ('ADMIN','DISPATCHER','HANDLER') ORDER BY r.role FOR SHARE OF p,r`,[visiblePrincipal.principal_id]);
      if(!worker.rowCount)failP2016('FORBIDDEN',403);
      const membership=await transaction.query(`SELECT m.principal_id FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
        WHERE m.principal_id=$1::uuid AND m.team_id=$2 FOR SHARE OF m,rt`,[visiblePrincipal.principal_id,ticket.resolver_team_id]);
      if(!worker.rows.some(row=>['ADMIN','DISPATCHER'].includes(row.role))&&ticket.assignee_id!==visiblePrincipal.principal_id&&!membership.rowCount)failP2016('FORBIDDEN',403);
      const {principal}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
      if(!assignmentActions(principal,ticket).includes(command.action))failP2016('ASSIGNMENT_STATE_CONFLICT',409);
      if(command.action==='transfer-assignment'&&ticket.assignee_id===command.target_principal_id&&ticket.resolver_team_id===command.resolver_team_id)failP2016('ASSIGNMENT_STATE_CONFLICT',409);
      if(command.communication_choice==='TRANSFER_SELECTED'&&!controlService)failP2016('CONTROL_UNAVAILABLE',503);
      const selectedSessions=[...command.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id));
      for(const selected of selectedSessions){
        const {session,principal:currentPrincipal}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:selected.session_id,transaction,lock:true});
        if(session.session_row_version!==String(selected.expected_row_version))failP2016('VERSION_CONFLICT',409);
        if(!await query.conversationTakeAllowed({principal:currentPrincipal,session,transaction}))failP2016('FORBIDDEN',403);
      }
      const conversations:{session_id:string;session_row_version:number;control_event_id:string|null;changed:boolean}[]=[];
      // Independent Control authorization sees the original Ticket group. All writes still share this caller transaction.
      for(const selected of selectedSessions){
        const {session}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:selected.session_id,transaction});
        try{
          if(!controlService)failP2016('CONTROL_UNAVAILABLE',503);
          const controlCommand={session_id:selected.session_id,client_command_id:command.client_command_id,idempotency_scope:'T06_ASSIGNMENT:'+selected.session_id.toUpperCase(),expected_row_version:selected.expected_row_version,actor_principal_id:principal.principal_id,target_principal_id:command.target_principal_id,reason_code:command.reason_code};
          const transferred=session.assignment_status==='ASSIGNED'
            ?await controlService.transferAssignmentInTransaction({transaction,command:{...controlCommand,command_type:'TRANSFER'}})
            :await controlService.takeoverSessionInTransaction({transaction,command:{...controlCommand,command_type:'TAKEOVER'}});
          if(!transferred.ok||!transferred.session)failP2016('CONTROL_CONFLICT',409);
          conversations.push({session_id:selected.session_id,session_row_version:transferred.session.row_version,control_event_id:transferred.event?.id??null,changed:!transferred.no_op});
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
      let current=ticket,queuedEvent:string|null=null,cycle=await assignmentCycle(transaction,ticket.id);
      if(!cycle&&(await transaction.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid LIMIT 1',[ticket.id])).rowCount)failP2016('ASSIGNMENT_STATE_CONFLICT',409);
      if(ticket.status==='NEW'){
        const queued=await createTicketActionService({authorize:async()=>true,afterAction:hooks.closure?.afterTicketAction??null}).performInTransaction({ticketId:ticket.id,action:'queue',actor:{type:'PILOT_USER',id:principal.principal_id},expectedVersion:ticket.version,reasonCode:command.reason_code,traceId:'t06:'+command.client_command_id},transaction);
        current={...ticket,...queued.ticket};queuedEvent=queued.event.event_id;
        if(hooks.notificationProjector&&!hooks.closure)await hooks.notificationProjector.project({transaction,...queued});
        await hooks.realtimeProjector?.({transaction,...queued,command});
      }
      const result=await transferTicketAssignmentP2016({transaction,principal,ticket:current,command:{...command,action:'transfer-assignment',expected_version:current.version},workbenchBusinessAssignment:true});
      if(!cycle&&command.action==='assign'){
        const inserted=await transaction.query<HandlingCycle>(`INSERT INTO pilot_ticket.ticket_handling_cycle(ticket_id,cycle_no,source_intake_id,cycle_start_event_id,first_responsibility_event_id,first_responsibility_principal_id,first_responsibility_team_id,client_command_id)
          VALUES($1::uuid,1,$2::uuid,$3::uuid,$3::uuid,$4::uuid,$5,$6::uuid) RETURNING id::text,cycle_no,first_responsibility_event_id::text`,[ticket.id,ticket.intake_id,result.event.event_id,command.target_principal_id,command.resolver_team_id,command.client_command_id]);
        cycle=inserted.rows[0]??null;if(!cycle)failP2016('ACTION_FAILED',503);
        await transaction.query('UPDATE pilot_ticket.ticket SET current_handling_cycle_id=$2::uuid WHERE id=$1::uuid',[ticket.id,cycle.id]);
      }else if(cycle&&cycle.first_responsibility_event_id===null&&command.action==='assign'){
        const updated=await transaction.query<HandlingCycle>(`UPDATE pilot_ticket.ticket_handling_cycle SET first_responsibility_event_id=$2::uuid,first_responsibility_principal_id=$3::uuid,first_responsibility_team_id=$4
          WHERE id=$1::uuid AND ticket_id=$5::uuid AND first_responsibility_event_id IS NULL RETURNING id::text,cycle_no,first_responsibility_event_id::text`,[cycle.id,result.event.event_id,command.target_principal_id,command.resolver_team_id,ticket.id]);
        cycle=updated.rows[0]??null;
      }
      if(command.action==='assign'&&!cycle?.first_responsibility_event_id)failP2016('ACTION_FAILED',503);
      if(cycle)for(const eventId of [queuedEvent,result.event.event_id])if(eventId)await transaction.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[ticket.id,cycle.id,eventId]);
      await hooks.notificationProjector?.project({transaction,...result});
      await hooks.realtimeProjector?.({transaction,...result,command});
      return {ok:true as const,ticket_id:ticket.id,ticket_version:result.ticket.version,ticket_event_id:result.event.event_id,control_event_id:null,handling_cycle:cycle,communication_choice:command.communication_choice,conversations};
    }});
  }});
}
