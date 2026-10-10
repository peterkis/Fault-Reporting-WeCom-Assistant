import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery,P2016TicketRow} from './p2-016-ticket-query.mjs';
import {ticketActionAllowedP2016} from './p2-016-ticket-query.mjs';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import {assignmentCycle} from './workbench-ticket-assignment.mjs';
import {appendTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016,publicP2016} from './p2-016-domain-contracts.mjs';

const startedStates=['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'];
export interface ReturnToDispatchCommand {
 action:'return-to-dispatch';ticket_id:string;client_command_id:string;expected_version:number;reason_code:string;
 reason:string;unfinished_work:string;communication_choice:'RETAIN_CURRENT'|'TRANSFER_SELECTED';communication_target_principal_id:string|null;
 sessions:{session_id:string;expected_row_version:number}[];
}
export function normalizeReturnToDispatchCommand(input:unknown):ReturnToDispatchCommand {
 const value=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','reason','unfinished_work','communication_choice','communication_target_principal_id','sessions']);
 if(value.action!=='return-to-dispatch'||typeof value.reason!=='string'||value.reason.length>500||!value.reason.trim()
   ||typeof value.unfinished_work!=='string'||value.unfinished_work.length>1400||!value.unfinished_work.trim()
   ||(value.communication_choice!=='RETAIN_CURRENT'&&value.communication_choice!=='TRANSFER_SELECTED')||!Array.isArray(value.sessions)||value.sessions.length>8)failP2016();
 const sessions=value.sessions.map(item=>{const row=exactP2016(item,['session_id','expected_row_version']);return {session_id:uuidP2016(row.session_id),expected_row_version:versionP2016(row.expected_row_version)};});
 if(new Set(sessions.map(row=>row.session_id)).size!==sessions.length)failP2016();
 const target=value.communication_target_principal_id===null?null:uuidP2016(value.communication_target_principal_id);
 if(value.communication_choice==='RETAIN_CURRENT'?(target!==null||sessions.length!==0):(target===null||sessions.length===0))failP2016();
 return publicP2016({action:'return-to-dispatch' as const,ticket_id:uuidP2016(value.ticket_id),client_command_id:uuidP2016(value.client_command_id),expected_version:versionP2016(value.expected_version),reason_code:codeP2016(value.reason_code),
   reason:value.reason.trim(),unfinished_work:value.unfinished_work.trim(),communication_choice:value.communication_choice,communication_target_principal_id:target,sessions});
}
export async function returnToDispatchSchemaReady(tx:PostgresTransaction) {
 try{return (await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('039_ticket_self_handling_cycles','046_ticket_unassign','048_ticket_return_to_dispatch')")).rowCount===3;}catch{return false;}
}
interface ResponsibilityEvent {
 event_type:string;event_ordinal:number;aggregate_version:number;old_status:string|null;new_status:string;operator_id:string|null;
 assignment_metadata:{old_assignee_id:string|null;new_assignee_id:string|null;old_team_id:string;new_team_id:string}|null;
}
async function currentSegmentStarted(tx:PostgresTransaction,ticket:P2016TicketRow) {
 if(!ticket.assignee_id||!startedStates.includes(ticket.status))return false;
 const events=await tx.query<ResponsibilityEvent>(`SELECT event_type,event_ordinal,aggregate_version,old_status,new_status,operator_id,assignment_metadata
   FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type IN (
   'ticket.assignment_transferred','ticket.accepted','ticket.started','ticket.waiting_requester','ticket.waiting_vendor','ticket.resumed',
   'ticket.unassigned','ticket.returned_to_dispatch','ticket.reopened','ticket.resolved','ticket.closed','ticket.cancelled','ticket.queued','ticket.created')
   ORDER BY event_ordinal DESC LIMIT 201`,[ticket.id]);
 let status:string=ticket.status,owner=ticket.assignee_id,team=ticket.resolver_team_id,ordinal=Number.MAX_SAFE_INTEGER,version=ticket.version;
 for(const event of events.rows.slice(0,200)) {
  if(!Number.isSafeInteger(event.event_ordinal)||event.event_ordinal<1||event.event_ordinal>=ordinal
    ||!Number.isInteger(event.aggregate_version)||event.aggregate_version<1||event.aggregate_version>version||event.new_status!==status)return false;
  ordinal=event.event_ordinal;version=event.aggregate_version;
  if(event.event_type==='ticket.assignment_transferred') {
   const metadata=event.assignment_metadata;
   if(!metadata||typeof metadata.old_assignee_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(metadata.old_assignee_id)
     ||typeof metadata.old_team_id!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/u.test(metadata.old_team_id)||metadata.new_assignee_id!==owner||metadata.new_team_id!==team||event.old_status!==status)return false;
   owner=metadata.old_assignee_id;team=metadata.old_team_id;continue;
  }
  if(event.event_type==='ticket.started')return event.old_status==='ACCEPTED'&&event.new_status==='IN_PROGRESS'&&event.operator_id!==null;
  if(event.event_type==='ticket.waiting_requester'||event.event_type==='ticket.waiting_vendor') {
   if(event.old_status!=='IN_PROGRESS'||event.new_status!==(event.event_type==='ticket.waiting_vendor'?'WAITING_VENDOR':'WAITING_REQUESTER')||event.operator_id===null)return false;
   status=event.old_status;continue;
  }
  if(event.event_type==='ticket.resumed') {
   const previous=event.old_status;
   if(previous===null||!['WAITING_REQUESTER','WAITING_VENDOR'].includes(previous)||event.new_status!=='IN_PROGRESS'||event.operator_id===null)return false;
   status=previous;continue;
  }
  // A release/round boundary or unknown chain cannot borrow an older segment's start.
  return false;
 }
 return false;
}
export function createTicketReturnToDispatchService({pool,query,enabled=false,...hooks}:{pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean}&Pick<SelfHandlingHooks,'realtimeProjector'>) {
 const ledger=createP2016CommandLedger({pool});
 return Object.freeze({async perform({authContext,command:input}:{authContext:unknown;command:unknown}) {
  guardP2016(enabled);const command=normalizeReturnToDispatchCommand(input);
  if(!await returnToDispatchSchemaReady(pool))failP2016('RETURN_TO_DISPATCH_UNAVAILABLE',503);
  // Only the original retain slice has reached a real public RED; selected transfer is still unavailable.
  if(command.communication_choice!=='RETAIN_CURRENT')failP2016('CONTROL_UNAVAILABLE',503);
  return ledger.execute({command,receiptType:'WORKBENCH_TICKET_RETURN_TO_DISPATCH',authorize:async transaction=>{
   await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});await lockP2016Realtime(transaction);
   return query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
  },run:async transaction=>{
   const {ticket,principal:visible}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction,lock:true});
   const roles=await transaction.query(`SELECT r.role FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
     WHERE p.id=$1::uuid AND p.is_active AND r.role IN ('ADMIN','DISPATCHER','HANDLER') ORDER BY r.role FOR SHARE OF p,r`,[visible.principal_id]);
   if(!roles.rowCount)failP2016('FORBIDDEN',403);
   const membership=await transaction.query(`SELECT m.principal_id FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
     WHERE m.principal_id=$1::uuid AND m.team_id=$2 AND rt.is_active FOR SHARE OF m,rt`,[visible.principal_id,ticket.resolver_team_id]);
   const {principal}=await query.authorizedTicket({authContext,ticketId:ticket.id,transaction});
   if(!ticketActionAllowedP2016(principal,ticket,'wait-vendor'))failP2016('FORBIDDEN',403);
   if(!principal.roles.some(role=>['ADMIN','DISPATCHER'].includes(role))&&!membership.rowCount)failP2016('FORBIDDEN',403);
   if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
   if(!await currentSegmentStarted(transaction,ticket))failP2016('RETURN_TO_DISPATCH_STATE_CONFLICT',409);
   const cycle=await assignmentCycle(transaction,ticket.id);
   if(cycle?.first_responsibility_event_id===null||!cycle&&(await transaction.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid LIMIT 1',[ticket.id])).rowCount)failP2016('RETURN_TO_DISPATCH_STATE_CONFLICT',409);
   const updated=await transaction.query<Pick<P2016TicketRow,'id'|'status'|'version'>>(`UPDATE pilot_ticket.ticket SET assignee_id=NULL,status='QUEUED',version=version+1,
     updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid AND version=$2 RETURNING id::text,status,version`,[ticket.id,command.expected_version]);
   const changed=updated.rows[0];if(!changed)failP2016('VERSION_CONFLICT',409);
   const result={ticket:{...ticket,...changed,assignee_id:null},event:await appendTicketEvent({transaction,ticket:changed,eventType:'ticket.returned_to_dispatch',oldStatus:ticket.status,
     actor:{type:'PILOT_USER',id:principal.principal_id},reasonCode:command.reason_code,internalNote:'停止原因：'+command.reason+'\n未完成工作：'+command.unfinished_work,traceId:'t09:'+command.client_command_id,
     assignmentMetadata:{old_assignee_id:ticket.assignee_id,new_assignee_id:null,old_team_id:ticket.resolver_team_id,new_team_id:ticket.resolver_team_id}})};
   if(cycle)await transaction.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[ticket.id,cycle.id,result.event.event_id]);
   await hooks.realtimeProjector?.({transaction,...result,command});
   return {ok:true as const,ticket_id:ticket.id,ticket_version:changed.version,ticket_event_id:result.event.event_id,control_event_id:null,handling_cycle:cycle,communication_choice:command.communication_choice,conversations:[]};
  }});
 }});
}
