import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery,P2016TicketRow} from './p2-016-ticket-query.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {TicketAction,TicketActionAfterHook,PublicTicketEvent} from './p1-006-ticket-state-actions.mjs';
import type {PublicPilotTicket} from './p1-005-pilot-ticket-core.mjs';
import {createTicketActionService} from './p1-006-ticket-state-actions.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016,publicP2016} from './p2-016-domain-contracts.mjs';

export const SELF_HANDLING_MIGRATION_ID='039_ticket_self_handling_cycles';
export type SelfHandlingAction='take-and-start'|'accept-for-later';
export interface HandlingCycle {id:string;cycle_no:number;first_responsibility_event_id:string|null}
export interface SelfHandlingCommand {action:SelfHandlingAction;ticket_id:string;client_command_id:string;expected_version:number;reason_code:string;resolver_team_id:string}
type ProjectInput={transaction:PostgresTransaction;ticket:P2016TicketRow|PublicPilotTicket;event:PublicTicketEvent;command?:unknown};
type Projector=((input:ProjectInput)=>Promise<unknown>)&{lock?:(tx:PostgresTransaction)=>Promise<unknown>};
export async function selfHandlingSchemaReady(tx:PostgresTransaction){
  try{return (await tx.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1',[SELF_HANDLING_MIGRATION_ID])).rowCount===1;}catch{return false;}
}
export function normalizeSelfHandlingCommand(input:unknown):SelfHandlingCommand {
  const v=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','resolver_team_id']);
  if(v.action!=='take-and-start'&&v.action!=='accept-for-later')failP2016();
  return {action:v.action,ticket_id:uuidP2016(v.ticket_id),client_command_id:uuidP2016(v.client_command_id),expected_version:versionP2016(v.expected_version),reason_code:codeP2016(v.reason_code),resolver_team_id:codeP2016(v.resolver_team_id)};
}
// Called by both the query projection and the locked write path. No truncated conversation list proves absence.
export async function selfHandlingResponsibilityEligibility(tx:PostgresTransaction,principal:WorkbenchPrincipal,ticket:P2016TicketRow,lock=false){
  if(!await selfHandlingSchemaReady(tx))failP2016('SELF_HANDLING_UNAVAILABLE',503);
  const member=await tx.query(`SELECT p.id FROM pilot_ticket.pilot_principal p
    JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id
    JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
    JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
    WHERE p.id=$1::uuid AND p.is_active AND rt.is_active AND m.team_id=$2
      AND r.role IN ('ADMIN','DISPATCHER','HANDLER') ORDER BY r.role${lock?' FOR SHARE OF p,m,rt,r':''}`,[principal.principal_id,ticket.resolver_team_id]);
  const cycleQuery=await tx.query<HandlingCycle>(`SELECT c.id::text,c.cycle_no,c.first_responsibility_event_id::text
    FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_handling_cycle c ON c.id=t.current_handling_cycle_id AND c.ticket_id=t.id WHERE t.id=$1::uuid`,[ticket.id]);
  const cycle=cycleQuery.rows[0]??null;
  let rejection:string|null=null;
  if(!member.rowCount)rejection='FORBIDDEN';
  else if(ticket.assignee_id!==null&&ticket.assignee_id!==principal.principal_id)rejection='SELF_HANDLING_OWNER_CONFLICT';
  const initial=['NEW','QUEUED'].includes(ticket.status);
  const accepted=ticket.status==='ACCEPTED'&&ticket.assignee_id===principal.principal_id&&cycle?.first_responsibility_event_id!=null;
  if(!rejection&&!initial&&!accepted)rejection='SELF_HANDLING_STATE_CONFLICT';
  const actions:SelfHandlingAction[]=rejection?[]:initial?['take-and-start','accept-for-later']:['take-and-start'];
  return publicP2016({actions,cycle,rejection});
}
export interface SelfHandlingHooks {realtimeProjector?:Projector|null;closure?:{afterTicketAction:TicketActionAfterHook}|null;notificationProjector?:{project:(input:ProjectInput)=>Promise<unknown>}|null}
export async function performFirstTicketResponsibilityInTransaction({transaction:tx,ticket,principal,command,initialCycle,realtimeProjector=null,closure=null,notificationProjector=null,tracePrefix='t04:'}:{transaction:PostgresTransaction;ticket:P2016TicketRow;principal:WorkbenchPrincipal;command:SelfHandlingCommand;initialCycle:HandlingCycle|null;tracePrefix?:string}&SelfHandlingHooks){
        const actions=createTicketActionService({authorize:async()=>true,afterAction:closure?.afterTicketAction??null});
        const chain:TicketAction[]=ticket.status==='NEW'?['queue','accept']:ticket.status==='QUEUED'?['accept']:[];
        if(command.action==='take-and-start')chain.push('start');
        let current:P2016TicketRow|PublicPilotTicket=ticket,cycle=initialCycle;
        const results:{ticket:PublicPilotTicket;event:PublicTicketEvent}[]=[];
        for(const action of chain){
          const result=await actions.performInTransaction({ticketId:ticket.id,action,actor:{type:'PILOT_USER',id:principal.principal_id},expectedVersion:current.version,reasonCode:command.reason_code,traceId:tracePrefix+command.client_command_id},tx);
          current=result.ticket;results.push(result);
          if(action==='accept'&&!cycle){
            // No hidden history backfill: the currently committed accept is the first responsibility basis.
            const existing=await tx.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid LIMIT 1',[ticket.id]);
            if(existing.rowCount)failP2016('SELF_HANDLING_STATE_CONFLICT',409);
            const inserted=await tx.query<HandlingCycle>(`INSERT INTO pilot_ticket.ticket_handling_cycle(ticket_id,cycle_no,source_intake_id,cycle_start_event_id,first_responsibility_event_id,first_responsibility_principal_id,first_responsibility_team_id,client_command_id)
              VALUES($1::uuid,1,$2::uuid,$3::uuid,$3::uuid,$4::uuid,$5,$6::uuid) RETURNING id::text,cycle_no,first_responsibility_event_id::text`,[ticket.id,ticket.intake_id,result.event.event_id,principal.principal_id,ticket.resolver_team_id,command.client_command_id]);
            cycle=inserted.rows[0]??null;if(!cycle)failP2016('ACTION_FAILED',503);
            await tx.query('UPDATE pilot_ticket.ticket SET current_handling_cycle_id=$2::uuid WHERE id=$1::uuid',[ticket.id,cycle.id]);
          }
          if(action==='accept'&&cycle?.first_responsibility_event_id===null){
            // A future explicit reopen can establish a round before it has a first assignee.
            const basis=await tx.query<HandlingCycle>(`UPDATE pilot_ticket.ticket_handling_cycle
              SET first_responsibility_event_id=$2::uuid,first_responsibility_principal_id=$3::uuid,first_responsibility_team_id=$4
              WHERE id=$1::uuid AND ticket_id=$5::uuid AND first_responsibility_event_id IS NULL
              RETURNING id::text,cycle_no,first_responsibility_event_id::text`,[cycle.id,result.event.event_id,principal.principal_id,ticket.resolver_team_id,ticket.id]);
            cycle=basis.rows[0]??null;if(!cycle)failP2016('ACTION_FAILED',503);
          }
          if(notificationProjector&&!closure)await notificationProjector.project({transaction:tx,...result});
          if(realtimeProjector)await realtimeProjector({transaction:tx,...result,command});
        }
        const last=results.at(-1);if(!cycle||!cycle.first_responsibility_event_id||!last)failP2016('ACTION_FAILED',503);
        for(const result of results)await tx.query('INSERT INTO pilot_ticket.ticket_handling_cycle_event(ticket_id,cycle_id,ticket_event_id) VALUES($1::uuid,$2::uuid,$3::uuid)',[ticket.id,cycle.id,result.event.event_id]);
        return {ok:true as const,ticket_id:ticket.id,ticket_version:current.version,ticket_event_id:last.event.event_id,control_event_id:null,handling_cycle:{...cycle,first_responsibility_event_id:cycle.first_responsibility_event_id}};
}
export async function selfHandlingEligibility(tx:PostgresTransaction,principal:WorkbenchPrincipal,ticket:P2016TicketRow,lock=false){
  const eligibility=await selfHandlingResponsibilityEligibility(tx,principal,ticket,lock);
  const session=await tx.query(`SELECT s.id FROM conversation.session s
    WHERE s.status<>'ENDED' AND (s.service_intake_id=$1::uuid OR s.id IN (
      SELECT related.conversation_session_id FROM intake.channel_leg own JOIN intake.channel_leg related ON related.journey_id=own.journey_id
      WHERE own.source_intake_id=$1::uuid)) LIMIT 1${lock?' FOR SHARE OF s':''}`,[ticket.intake_id]);
  return session.rowCount?publicP2016({...eligibility,actions:[],rejection:eligibility.rejection??'SELF_HANDLING_CONVERSATION_REQUIRED'}):eligibility;
}
export function createTicketSelfHandlingService({pool,query,enabled=false,realtimeProjector=null,closure=null,notificationProjector=null}:{pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean;realtimeProjector?:Projector|null;closure?:{afterTicketAction:TicketActionAfterHook}|null;notificationProjector?:{project:(input:ProjectInput)=>Promise<unknown>}|null}){
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({async perform({authContext,command:input}:{authContext:unknown;command:unknown}){
    guardP2016(enabled);const command=normalizeSelfHandlingCommand(input);
    if(!await selfHandlingSchemaReady(pool))failP2016('SELF_HANDLING_UNAVAILABLE',503);
    return ledger.execute({command,authorize:tx=>query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction:tx}),
      run:async(tx)=>{
        await realtimeProjector?.lock?.(tx);
        const {ticket,principal}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction:tx,lock:true});
        if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
        if(ticket.resolver_team_id!==command.resolver_team_id)failP2016('FORBIDDEN',403);
        const eligibility=await selfHandlingEligibility(tx,principal,ticket,true);
        if(!eligibility.actions.includes(command.action))failP2016(eligibility.rejection??'SELF_HANDLING_STATE_CONFLICT',eligibility.rejection==='FORBIDDEN'?403:409);
        return performFirstTicketResponsibilityInTransaction({transaction:tx,ticket,principal,command,initialCycle:eligibility.cycle,realtimeProjector,closure,notificationProjector});
      }});
  }});
}
