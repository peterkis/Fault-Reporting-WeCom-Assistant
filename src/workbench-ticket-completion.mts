import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery,P2016TicketRow} from './p2-016-ticket-query.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {P2016CompletionCommand,P2016CompletionReceipt} from '../contracts/p2_016_contracts.js';
import type {PublicPilotTicket} from './p1-005-pilot-ticket-core.mjs';
import type {PublicTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {createTicketActionService} from './p1-006-ticket-state-actions.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {lockP2016Realtime} from './p2-016-realtime-appender.mjs';
import {exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016,limitP2016,publicP2016,transactionP2016,localP2016} from './p2-016-domain-contracts.mjs';

export const STAFF_COMPLETION_MIGRATION_ID='040_ticket_staff_completion';
export interface CompletionCycle {id:string;cycle_no:number;first_responsibility_event_id:string|null;staff_completion_event_id:string|null;source_intake_id:string}
type ProjectInput={transaction:PostgresTransaction;ticket:P2016TicketRow|PublicPilotTicket;event:PublicTicketEvent;command?:unknown};
type Projector=((input:ProjectInput)=>Promise<unknown>)&{lock?:(tx:PostgresTransaction)=>Promise<unknown>};
export async function staffCompletionSchemaReady(tx:PostgresTransaction){
  try{return (await tx.query("SELECT 1 FROM platform.schema_migration WHERE migration_id IN ('039_ticket_self_handling_cycles','040_ticket_staff_completion')")).rowCount===2;}catch{return false;}
}
export function normalizeCompletionCommand(input:unknown):P2016CompletionCommand&{action:'complete';ticket_id:string}{
  const v=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','handling_cycle_id','internal_process','external_summary','external_summary_confirmed']);
  if(v.action!=='complete'||v.reason_code!=='STAFF_COMPLETED'||v.external_summary_confirmed!==true
    ||typeof v.internal_process!=='string'||!v.internal_process.trim()||v.internal_process.length>2000
    ||typeof v.external_summary!=='string'||!v.external_summary.trim()||v.external_summary.length>500)failP2016();
  return publicP2016({action:'complete',ticket_id:uuidP2016(v.ticket_id),client_command_id:uuidP2016(v.client_command_id),expected_version:versionP2016(v.expected_version),reason_code:'STAFF_COMPLETED',handling_cycle_id:uuidP2016(v.handling_cycle_id),internal_process:v.internal_process,external_summary:v.external_summary,external_summary_confirmed:true});
}
export async function staffCompletionEligibility(tx:PostgresTransaction,principal:WorkbenchPrincipal,ticket:P2016TicketRow,lock=false){
  if(!await staffCompletionSchemaReady(tx))failP2016('STAFF_COMPLETION_UNAVAILABLE',503);
  const member=await tx.query(`SELECT p.id FROM pilot_ticket.pilot_principal p
    JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
    JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
    WHERE p.id=$1::uuid AND p.is_active AND rt.is_active AND m.team_id=$2 AND r.role IN ('ADMIN','DISPATCHER','HANDLER')${lock?' FOR SHARE OF p,m,rt,r':''}`,[principal.principal_id,ticket.resolver_team_id]);
  const result=await tx.query<CompletionCycle>(`SELECT c.id::text,c.cycle_no,c.first_responsibility_event_id::text,c.staff_completion_event_id::text,c.source_intake_id::text
    FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_handling_cycle c ON c.id=t.current_handling_cycle_id AND c.ticket_id=t.id WHERE t.id=$1::uuid${lock?' FOR UPDATE OF c':''}`,[ticket.id]);
  const cycle=result.rows[0]??null;
  const authorized=Boolean(member.rowCount)&&ticket.assignee_id===principal.principal_id;
  const allowed=authorized&&['IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR'].includes(ticket.status)&&cycle?.first_responsibility_event_id!=null&&cycle.staff_completion_event_id===null&&cycle.source_intake_id===ticket.intake_id;
  return {allowed,authorized,cycle};
}
export interface StaffCompletionCommitment {cycle_id:string;cycle_no:number;node:'STAFF_COMPLETED';ticket_id:string;ticket_event_id:string;source_intake_id:string;external_summary:string;occurred_at:string}
export function createTicketStaffCompletionService({pool,query,enabled=false,realtimeProjector=null}:{pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean;realtimeProjector?:Projector|null}){
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({
    async readCommittedStaffCompletions({afterCycleId=null,limit=20}:{afterCycleId?:string|null;limit?:number}={}){
      guardP2016(enabled);if(!await staffCompletionSchemaReady(pool))failP2016('STAFF_COMPLETION_UNAVAILABLE',503);
      const n=limitP2016(limit,100),after=afterCycleId===null?null:uuidP2016(afterCycleId);
      const q=await pool.query<Omit<StaffCompletionCommitment,'node'>>(`SELECT p.cycle_id::text,c.cycle_no,p.ticket_id::text,p.ticket_event_id::text,p.source_intake_id::text,e.external_note AS external_summary,e.created_at AS occurred_at
        FROM pilot_ticket.staff_completion_notification_commitment p JOIN pilot_ticket.ticket_handling_cycle c ON c.id=p.cycle_id AND c.ticket_id=p.ticket_id AND c.staff_completion_event_id=p.ticket_event_id
        JOIN pilot_ticket.ticket_event e ON e.event_id=p.ticket_event_id AND e.ticket_id=p.ticket_id
        WHERE ($1::uuid IS NULL OR p.cycle_id>$1::uuid) ORDER BY p.cycle_id LIMIT $2`,[after,n+1]);
      const rows=q.rows.slice(0,n);return publicP2016({items:rows.map(row=>{if(typeof row.external_summary!=='string'||!row.external_summary.trim()||row.external_summary.length>500)failP2016('NOTIFICATION_EVENT_INVALID');return {...row,node:'STAFF_COMPLETED' as const,occurred_at:localP2016(row.occurred_at)};}),next_cursor:q.rows.length>n?rows.at(-1)?.cycle_id??null:null});
    },
    async receipt({authContext,ticketId:inputTicket,commandId:inputCommand}:{authContext:unknown;ticketId:unknown;commandId:unknown}):Promise<P2016CompletionReceipt>{
      guardP2016(enabled);const ticketId=uuidP2016(inputTicket),commandId=uuidP2016(inputCommand);
      if(!await staffCompletionSchemaReady(pool))failP2016('STAFF_COMPLETION_UNAVAILABLE',503);
      return transactionP2016(pool,async tx=>{
        await tx.query('SET TRANSACTION READ ONLY');const {principal}=await query.authorizedTicket({authContext,ticketId,transaction:tx});
        const q=await tx.query<{state:string;version:unknown;event:unknown;control:unknown;error:unknown;retryable:unknown;cycle_id:unknown;cycle_no:unknown}>(`SELECT r.state,r.result_ticket_version AS version,r.result_ticket_event_id::text AS event,r.result_control_event_id::text AS control,r.error_code AS error,r.retryable,
          c.id::text AS cycle_id,c.cycle_no FROM pilot_ticket.ticket_command_receipt r LEFT JOIN pilot_ticket.ticket_handling_cycle c ON c.staff_completion_event_id=r.result_ticket_event_id AND c.ticket_id=r.ticket_id
          WHERE r.command_scope=$1 AND r.client_command_id=$2::uuid AND r.ticket_id=$3::uuid AND r.command_type='WORKBENCH_STAFF_COMPLETION' LIMIT 1`,['P2_016:'+principal.principal_id,commandId,ticketId]);
        const row=q.rows[0],base={client_command_id:commandId,ticket_id:ticketId};
        if(!row||row.state==='STARTED')return {...base,state:'UNKNOWN'};
        if(row.state==='FAILED'&&row.retryable===false)return {...base,state:'FAILED',error:{code:codeP2016(row.error),retryable:false}};
        if(row.state==='COMMITTED'&&row.control===null)return {...base,state:'COMMITTED',result:{ok:true,ticket_id:ticketId,ticket_version:versionP2016(row.version),ticket_event_id:uuidP2016(row.event),control_event_id:null,replayed:true,completion:{cycle_id:uuidP2016(row.cycle_id),cycle_no:versionP2016(row.cycle_no),event_id:uuidP2016(row.event),basis:'STAFF_COMPLETED'}}};
        failP2016('ACTION_FAILED',503);
      });
    },
    async perform({authContext,command:input}:{authContext:unknown;command:unknown}){
      guardP2016(enabled);const command=normalizeCompletionCommand(input);
      if(!await staffCompletionSchemaReady(pool))failP2016('STAFF_COMPLETION_UNAVAILABLE',503);
      return ledger.execute({command,receiptType:'WORKBENCH_STAFF_COMPLETION',authorize:async tx=>{
        await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction:tx});
        // Acquire the existing stream mutex before the receipt FK takes Ticket KEY SHARE.
        // Waiting until run() can deadlock with a second UUID upgrading its own FK lock.
        if(realtimeProjector?.lock)await realtimeProjector.lock(tx);else await lockP2016Realtime(tx);
        return query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction:tx});
      },run:tx=>completeTicketInTransaction({transaction:tx,authContext,command,query,realtimeProjector})});
    },
  });
}


/** Existing T11 legal completion, cycle and commitment writes in one caller transaction. */
export async function completeTicketInTransaction({transaction:tx,authContext,command,query,realtimeProjector=null}:{transaction:PostgresTransaction;authContext:unknown;command:ReturnType<typeof normalizeCompletionCommand>;query:P2016TicketQuery;realtimeProjector?:Projector|null}){
        const {principal,ticket}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction:tx,lock:true});
        if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
        const eligibility=await staffCompletionEligibility(tx,principal,ticket,true),cycle=eligibility.cycle;
        if(!eligibility.authorized)failP2016('FORBIDDEN',403);
        if(!eligibility.allowed||!cycle||cycle.id!==command.handling_cycle_id)failP2016('STAFF_COMPLETION_STATE_CONFLICT',409);
        const core=createTicketActionService({authorize:async()=>true,staffCompletionEnabled:true}),actor={type:'PILOT_USER' as const,id:principal.principal_id};
        let version=ticket.version;const results:{ticket:PublicPilotTicket;event:PublicTicketEvent}[]=[];
        if(ticket.status!=='IN_PROGRESS'){const resumed=await core.performInTransaction({ticketId:ticket.id,action:'resume',actor,expectedVersion:version,reasonCode:'STAFF_COMPLETION_RESUME',traceId:'t11:'+command.client_command_id},tx);results.push(resumed);version=resumed.ticket.version;}
        const result=await core.performInTransaction({ticketId:ticket.id,action:'complete',actor,expectedVersion:version,internalProcess:command.internal_process,externalSummary:command.external_summary,externalSummaryConfirmed:true,reasonCode:'STAFF_COMPLETED',traceId:'t11:'+command.client_command_id},tx);results.push(result);
        for(const entry of results)await tx.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[ticket.id,cycle.id,entry.event.event_id]);
        const ended=await tx.query('UPDATE pilot_ticket.ticket_handling_cycle SET staff_completion_event_id=$3::uuid WHERE ticket_id=$1::uuid AND id=$2::uuid AND staff_completion_event_id IS NULL',[ticket.id,cycle.id,result.event.event_id]);
        if(ended.rowCount!==1)failP2016('STAFF_COMPLETION_STATE_CONFLICT',409);
        await tx.query('INSERT INTO pilot_ticket.staff_completion_notification_commitment(ticket_id,cycle_id,ticket_event_id,source_intake_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)',[ticket.id,cycle.id,result.event.event_id,cycle.source_intake_id]);
        for(const entry of results)await realtimeProjector?.({transaction:tx,...entry,command});
        return {ok:true as const,ticket_id:ticket.id,ticket_version:result.ticket.version,ticket_event_id:result.event.event_id,control_event_id:null,completion:{cycle_id:cycle.id,cycle_no:cycle.cycle_no,event_id:result.event.event_id,basis:'STAFF_COMPLETED' as const}};
}
