import type {PostgresTransaction} from './platform/postgres-pool.mjs';
import type {TicketActor} from './p1-006-ticket-state-actions.mjs';
import {createTicketActionService} from './p1-006-ticket-state-actions.mjs';
import {failP2016} from './p2-016-domain-contracts.mjs';
export interface CompletedTicketRound {id:string;ticket_id:string;source_intake_id:string;cycle_no:number;staff_completion_event_id:string;completed_by:string;resolver_team_id:string;ticket_no:string;version:number;status:string}
export async function reopenRoundsSchemaReady(tx:PostgresTransaction){
 try{return (await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='043_ticket_reopen_rounds'")).rowCount===1;}catch{return false;}
}
export async function completedTicketRound(tx:PostgresTransaction,ticketId:string):Promise<CompletedTicketRound|null>{
 const selected=await tx.query<CompletedTicketRound>(`SELECT c.id::text,c.ticket_id::text,c.source_intake_id::text,c.cycle_no,
   c.staff_completion_event_id::text,e.operator_id AS completed_by,t.resolver_team_id,t.ticket_no,t.version,t.status
   FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_handling_cycle c ON c.id=t.current_handling_cycle_id AND c.ticket_id=t.id
   JOIN pilot_ticket.ticket_event e ON e.event_id=c.staff_completion_event_id AND e.ticket_id=t.id
   JOIN pilot_ticket.staff_completion_notification_commitment n ON n.cycle_id=c.id AND n.ticket_id=t.id
     AND n.ticket_event_id=e.event_id AND n.source_intake_id=t.source_intake_id
   WHERE t.id=$1::uuid AND c.source_intake_id=t.source_intake_id AND t.status='CLOSED'
     AND e.event_type='ticket.closed' AND e.reason_code='STAFF_COMPLETED' AND e.operator_type='PILOT_USER'
     AND e.old_status='IN_PROGRESS' AND e.new_status='CLOSED'
     AND NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket_cycle_reopen r WHERE r.completed_cycle_id=c.id)`,[ticketId]);
 return selected.rows[0]??null;
}
// Caller owns transaction, authorization and stream-before-receipt lock. No network or transaction boundary here.
export async function reopenCompletedRound({transaction:tx,round,actor,commandId,origin,reasonCode,note=null}:{transaction:PostgresTransaction;round:CompletedTicketRound;actor:TicketActor;commandId:string;origin:'WEB_REPORTER'|'STAFF';reasonCode:string;note?:string|null}){
 const latest=await completedTicketRound(tx,round.ticket_id);if(!latest||latest.id!==round.id||latest.version!==round.version)failP2016('VERSION_CONFLICT',409);
 const result=await createTicketActionService({authorize:async()=>true,reopenClearAssignee:true}).performInTransaction({ticketId:round.ticket_id,action:'reopen',actor,expectedVersion:round.version,reasonCode,note,traceId:'t20:'+commandId},tx);
 const inserted=await tx.query<{id:string;cycle_no:number}>(`INSERT INTO pilot_ticket.ticket_handling_cycle(ticket_id,cycle_no,source_intake_id,cycle_start_event_id,client_command_id)
   VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid) RETURNING id::text,cycle_no`,[round.ticket_id,round.cycle_no+1,round.source_intake_id,result.event.event_id,commandId]);
 const next=inserted.rows[0];if(!next)failP2016('ACTION_FAILED',503);
 await tx.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[round.ticket_id,next.id,result.event.event_id]);
 await tx.query(`INSERT INTO pilot_ticket.ticket_cycle_reopen(completed_cycle_id,ticket_id,completion_event_id,source_intake_id,reopen_event_id,new_cycle_id,origin,client_command_id)
   VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8::uuid)`,[round.id,round.ticket_id,round.staff_completion_event_id,round.source_intake_id,result.event.event_id,next.id,origin,commandId]);
 await tx.query('UPDATE pilot_ticket.ticket SET current_handling_cycle_id=$2::uuid WHERE id=$1::uuid',[round.ticket_id,next.id]);
 return {...result,handling_cycle:{...next,first_responsibility_event_id:null,staff_completion_event_id:null}};
}
