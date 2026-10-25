import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery,P2016TicketRow} from './p2-016-ticket-query.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {P2016UnassignAcknowledgement,P2016UnassignTargets} from '../../../contracts/workbench_unassign_contracts.js';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import {assignmentCycle} from './workbench-ticket-assignment.mjs';
import {appendTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {ConversationControlError} from './p2-005-conversation-control.mjs';
import type {createConversationControlService} from './p2-005-conversation-control.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016,publicP2016,transactionP2016,P2016_ERROR_CODES} from './p2-016-domain-contracts.mjs';

export interface UnassignCommand {action:'unassign';ticket_id:string;client_command_id:string;expected_version:number;reason_code:string;reason:string;communication_choice:'RETAIN_CURRENT'|'TRANSFER_SELECTED';communication_target_principal_id:string|null;sessions:{session_id:string;expected_row_version:number}[]}
export function normalizeTicketUnassignCommand(input:unknown):UnassignCommand{
  const value=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','reason','communication_choice','communication_target_principal_id','sessions']);
  if(value.action!=='unassign'||typeof value.reason!=='string'||value.reason.length>2000||!value.reason.trim()
    ||(value.communication_choice!=='RETAIN_CURRENT'&&value.communication_choice!=='TRANSFER_SELECTED')||!Array.isArray(value.sessions)||value.sessions.length>8)failP2016();
  const sessions=value.sessions.map(item=>{const row=exactP2016(item,['session_id','expected_row_version']);return {session_id:uuidP2016(row.session_id),expected_row_version:versionP2016(row.expected_row_version)};});
  if(new Set(sessions.map(row=>row.session_id)).size!==sessions.length)failP2016();
  const target=value.communication_target_principal_id===null?null:uuidP2016(value.communication_target_principal_id);
  if(value.communication_choice==='RETAIN_CURRENT'?(target!==null||sessions.length!==0):(target===null||sessions.length===0))failP2016();
  return publicP2016({action:'unassign' as const,ticket_id:uuidP2016(value.ticket_id),client_command_id:uuidP2016(value.client_command_id),expected_version:versionP2016(value.expected_version),reason_code:codeP2016(value.reason_code),reason:value.reason.trim(),communication_choice:value.communication_choice,communication_target_principal_id:target,sessions});
}
export async function unassignSchemaReady(tx:PostgresTransaction){
  try{return (await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('039_ticket_self_handling_cycles','046_ticket_unassign')")).rowCount===2;}catch{return false;}
}
export async function unassignEligible(tx:PostgresTransaction,principal:WorkbenchPrincipal,ticket:P2016TicketRow){
  if(!principal.is_active||!principal.roles.some(role=>['ADMIN','DISPATCHER'].includes(role))||!ticket.assignee_id||!['QUEUED','ACCEPTED'].includes(ticket.status))return false;
  // A bounded current responsibility chain is a proof, never a projection or a timestamp heuristic.
  const events=await tx.query<{event_type:string;event_ordinal:number;aggregate_version:number;old_status:string|null;new_status:string;operator_id:string|null;assignment_metadata:{old_assignee_id:string|null;new_assignee_id:string|null;old_team_id:string;new_team_id:string}|null}>(`SELECT event_type,event_ordinal,aggregate_version,old_status,new_status,operator_id,assignment_metadata
    FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type IN (
      'ticket.assignment_transferred','ticket.accepted','ticket.started','ticket.waiting_requester','ticket.waiting_vendor','ticket.resumed',
      'ticket.unassigned','ticket.reopened','ticket.closed','ticket.cancelled') ORDER BY event_ordinal DESC LIMIT 201`,[ticket.id]);
  let owner=ticket.assignee_id,team=ticket.resolver_team_id,freshAcceptance=false;
  for(const event of events.rows.slice(0,200)){
    if(!Number.isSafeInteger(event.event_ordinal)||event.event_ordinal<1||!Number.isInteger(event.aggregate_version)||event.aggregate_version>ticket.version)return false;
    if(event.event_type==='ticket.unassigned'){
      const metadata=event.assignment_metadata;
      // A genuine later accept starts a new unstarted segment inside the same handling round.
      // The old segment must end with the existing exact owner-release fact, not just any status change.
      return freshAcceptance&&event.operator_id!==null&&['QUEUED','ACCEPTED'].includes(event.old_status??'')&&event.new_status==='QUEUED'
        &&metadata!==null&&metadata.old_assignee_id!==null&&metadata.new_assignee_id===null&&metadata.old_team_id===team&&metadata.new_team_id===team;
    }
    if(['ticket.started','ticket.waiting_requester','ticket.waiting_vendor','ticket.resumed','ticket.reopened','ticket.closed','ticket.cancelled'].includes(event.event_type))return false;
    if(event.event_type==='ticket.accepted'){
      if(event.operator_id!==owner||event.old_status!=='QUEUED'||event.new_status!=='ACCEPTED')return false;
      // An explicit accept after assignment does not erase an earlier started segment.
      freshAcceptance=true;
      continue;
    }
    const metadata=event.assignment_metadata;
    if(!metadata||metadata.new_assignee_id!==owner||metadata.new_team_id!==team||event.old_status!==event.new_status||!['QUEUED','ACCEPTED'].includes(event.new_status))return false;
    if(metadata.old_assignee_id===null||metadata.old_assignee_id!==owner)return true;
    owner=metadata.old_assignee_id;team=metadata.old_team_id;
  }
  // The extra row only proves truncation if the bounded current segment has not already supplied a valid basis.
  if(events.rows.length>200)return false;
  // Legacy accept alone is only a basis when there is no earlier contradictory responsibility fact.
  return events.rows.some(event=>event.event_type==='ticket.accepted'&&event.operator_id===owner);
}
export function createTicketUnassignService({pool,query,controlService=null,enabled=false,...hooks}:{pool:PostgresPool;query:P2016TicketQuery;controlService?:Pick<ReturnType<typeof createConversationControlService>,'takeoverSessionInTransaction'|'transferAssignmentInTransaction'>|null;enabled?:boolean}&SelfHandlingHooks){
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({
  async acknowledgement({authContext,ticketId:inputTicket,commandId:inputCommand}:{authContext:unknown;ticketId:unknown;commandId:unknown}):Promise<P2016UnassignAcknowledgement>{
    guardP2016(enabled);const ticketId=uuidP2016(inputTicket),commandId=uuidP2016(inputCommand);
    if(!await unassignSchemaReady(pool))failP2016('UNASSIGN_UNAVAILABLE',503);
    return transactionP2016(pool,async transaction=>{
      await transaction.query('SET TRANSACTION READ ONLY');const {principal}=await query.authorizedTicket({authContext,ticketId,transaction});
      const selected=await transaction.query<{state:unknown;version:unknown;event:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_ticket_version AS version,result_ticket_event_id::text AS event,error_code AS error,retryable
        FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid
        AND command_type='WORKBENCH_TICKET_UNASSIGN' LIMIT 1`,['P2_016:'+principal.principal_id,commandId,ticketId]);
      const row=selected.rows[0];if(!row||row.state==='STARTED')return {state:'UNKNOWN'};
      if(row.state==='COMMITTED')return {state:'COMMITTED',ticket_id:ticketId,ticket_version:versionP2016(row.version),ticket_event_id:uuidP2016(row.event)};
      if(row.state==='FAILED'&&row.retryable===false&&typeof row.error==='string'&&P2016_ERROR_CODES.includes(row.error))return {state:'FAILED',error:{code:row.error,retryable:false}};
      failP2016('ACTION_FAILED',503);
    });
  },async communicationTargets({authContext,ticketId:inputTicket,targetPrincipalId=null}:{authContext:unknown;ticketId:unknown;targetPrincipalId?:unknown}):Promise<P2016UnassignTargets>{
    guardP2016(enabled);const ticketId=uuidP2016(inputTicket),target=targetPrincipalId===null?null:uuidP2016(targetPrincipalId);
    if(!await unassignSchemaReady(pool))failP2016('UNASSIGN_UNAVAILABLE',503);
    return transactionP2016(pool,async transaction=>{
      await transaction.query('SET TRANSACTION READ ONLY');const {principal,ticket}=await query.authorizedTicket({authContext,ticketId,transaction});
      if(!await unassignEligible(transaction,principal,ticket))failP2016('FORBIDDEN',403);
      const candidates=`SELECT p.id::text AS principal_id,p.display_name FROM pilot_ticket.pilot_principal p WHERE p.is_active
        AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER'))`;
      if(target&&!(await transaction.query(candidates+' AND p.id=$1::uuid',[target])).rowCount)failP2016('FORBIDDEN',403);
      const listed=await transaction.query<{principal_id:string;display_name:string}>(target
        ?'SELECT principal_id,display_name FROM ('+candidates+' ORDER BY (p.id=$1::uuid) DESC,p.display_name,p.id LIMIT 100) bounded ORDER BY display_name,principal_id'
        :candidates+' ORDER BY p.display_name,p.id LIMIT 100',target?[target]:[]);
      return publicP2016({items:listed.rows});
    });
  },async perform({authContext,command:input}:{authContext:unknown;command:unknown}){
    guardP2016(enabled);const command=normalizeTicketUnassignCommand(input);
    if(!await unassignSchemaReady(pool))failP2016('UNASSIGN_UNAVAILABLE',503);
    return ledger.execute({command,receiptType:'WORKBENCH_TICKET_UNASSIGN',authorize:async transaction=>{
      await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});await lockP2016Realtime(transaction);
      const current=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      for(const selected of [...command.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id)))await query.authorizedRelatedConversation({authContext,ticketId:command.ticket_id,sessionId:selected.session_id,transaction});
      return current;
    },run:async transaction=>{
      const {ticket,principal:visible}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction,lock:true});
      const roles=await transaction.query(`SELECT r.role FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
        WHERE p.id=$1::uuid AND p.is_active AND r.role IN ('ADMIN','DISPATCHER') ORDER BY r.role FOR SHARE OF p,r`,[visible.principal_id]);
      if(!roles.rowCount)failP2016('FORBIDDEN',403);
      const {principal}=await query.authorizedTicket({authContext,ticketId:ticket.id,transaction});
      if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
      if(!await unassignEligible(transaction,principal,ticket))failP2016('UNASSIGN_STATE_CONFLICT',409);
      if(command.communication_choice==='TRANSFER_SELECTED'&&!controlService)failP2016('CONTROL_UNAVAILABLE',503);
      const cycle=await assignmentCycle(transaction,ticket.id);
      if(cycle?.first_responsibility_event_id===null||!cycle&&(await transaction.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid LIMIT 1',[ticket.id])).rowCount)failP2016('UNASSIGN_STATE_CONFLICT',409);
      const selectedSessions=[...command.sessions].sort((a,b)=>a.session_id.localeCompare(b.session_id));
      for(const selected of selectedSessions){
        const {session,principal:current}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:selected.session_id,transaction,lock:true});
        if(session.session_row_version!==String(selected.expected_row_version))failP2016('VERSION_CONFLICT',409);
        if(!await query.conversationTakeAllowed({principal:current,session,transaction}))failP2016('FORBIDDEN',403);
      }
      const conversations:{session_id:string;session_row_version:number;control_event_id:string|null;changed:boolean}[]=[];
      // Control authorization sees the original Ticket facts; its writes share this ledger savepoint.
      for(const selected of selectedSessions){
        const {session}=await query.authorizedRelatedConversation({authContext,ticketId:ticket.id,sessionId:selected.session_id,transaction});
        try{
          if(!controlService||!command.communication_target_principal_id)failP2016('CONTROL_UNAVAILABLE',503);
          const controlCommand={session_id:selected.session_id,client_command_id:command.client_command_id,idempotency_scope:'T08_UNASSIGN:'+selected.session_id.toUpperCase(),expected_row_version:selected.expected_row_version,
            actor_principal_id:principal.principal_id,target_principal_id:command.communication_target_principal_id,reason_code:command.reason_code};
          const controlled=session.assignment_status==='ASSIGNED'
            ?await controlService.transferAssignmentInTransaction({transaction,command:{...controlCommand,command_type:'TRANSFER'}})
            :await controlService.takeoverSessionInTransaction({transaction,command:{...controlCommand,command_type:'TAKEOVER'}});
          if(!controlled.ok||!controlled.session)failP2016('CONTROL_CONFLICT',409);
          conversations.push({session_id:selected.session_id,session_row_version:controlled.session.row_version,control_event_id:controlled.event?.id??null,changed:!controlled.no_op});
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
      const updated=await transaction.query<Pick<P2016TicketRow,'id'|'status'|'version'>>(`UPDATE pilot_ticket.ticket SET assignee_id=NULL,status='QUEUED',version=version+1,
        updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid AND version=$2 RETURNING id::text,status,version`,[ticket.id,command.expected_version]);
      const changed=updated.rows[0];if(!changed)failP2016('VERSION_CONFLICT',409);
      const result={ticket:{...ticket,...changed,assignee_id:null},event:await appendTicketEvent({transaction,ticket:changed,eventType:'ticket.unassigned',oldStatus:ticket.status,
        actor:{type:'PILOT_USER',id:principal.principal_id},reasonCode:command.reason_code,internalNote:command.reason,traceId:'t08:'+command.client_command_id,
        assignmentMetadata:{old_assignee_id:ticket.assignee_id,new_assignee_id:null,old_team_id:ticket.resolver_team_id,new_team_id:ticket.resolver_team_id}})};
      if(cycle)await transaction.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[ticket.id,cycle.id,result.event.event_id]);
      await hooks.realtimeProjector?.({transaction,...result,command});
      return {ok:true as const,ticket_id:ticket.id,ticket_version:changed.version,ticket_event_id:result.event.event_id,control_event_id:null,handling_cycle:cycle,communication_choice:command.communication_choice,conversations};
    }});
  }});
}
