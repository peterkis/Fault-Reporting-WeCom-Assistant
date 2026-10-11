import type {PostgresPool,PostgresTransaction} from './platform/postgres-pool.mjs';
import type {P2016TicketQuery,P2016TicketRow} from './p2-016-ticket-query.mjs';
import type {WorkbenchPrincipal} from './p2-006-workbench-authorization.mjs';
import type {SharedFollowUpCommand,SharedFollowUpView,SharedFollowUpHistoryEntry,SharedFollowUpReceipt} from '../contracts/workbench_follow_up_schedule_contracts.js';
import type {SelfHandlingHooks} from './workbench-ticket-self-handling.mjs';
import {createP2016CommandLedger} from './p2-016-ticket-command-ledger.mjs';
import {appendTicketEvent} from './p1-006-ticket-state-actions.mjs';
import {lockP2016Realtime,appendP2016Realtime} from './p2-016-realtime-appender.mjs';
import {REALTIME_STREAM_NAME} from './p2-003-realtime-event-log.mjs';
import {assertLocalDateTime,assertEpochMsString,shanghaiLocalToEpochMs} from './platform/time-contract.mjs';
import {exactP2016,uuidP2016,versionP2016,failP2016,guardP2016,transactionP2016,publicP2016,P2016_ERROR_CODES} from './p2-016-domain-contracts.mjs';
import {followUpSchemaReady} from '../scripts/workbench-follow-up-schedules-migrate.mjs';
import {followUpDueSchemaReady} from '../scripts/workbench-follow-up-due-migrate.mjs';

const OPEN_STATES=['NEW','QUEUED','ACCEPTED','IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR','REOPENED'];
const purpose='WORKBENCH_FOLLOW_UP_SCHEDULE';
interface CurrentRow {schedule_version:string;due_at:string|null;due_epoch_ms:string|null;scheduled_event_id:string|null;active:boolean}
interface HistoryRow {schedule_version:string;action:'SET'|'CANCEL'|'ENDED';due_at:string;occurred_at:string;ticket_event_id:string;end_reason:'CLOSED'|'CANCELLED'|null}
export function followUpRevision(value:unknown,allowZero=true):string{
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/u.test(value)||BigInt(value)>9223372036854775807n||(!allowZero&&value==='0'))failP2016();return value;
}
export function normalizeFollowUpCommand(ticketId:unknown,input:unknown):SharedFollowUpCommand&{ticket_id:string;purpose:typeof purpose}{
  const value=exactP2016(input,['client_command_id','expected_version','expected_schedule_version','reason_code','action','due_at']);
  if(value.reason_code!==purpose||(value.action!=='SET'&&value.action!=='CANCEL')||(value.action==='CANCEL'&&value.due_at!==null))failP2016();
  const base={client_command_id:uuidP2016(value.client_command_id),expected_version:versionP2016(value.expected_version),expected_schedule_version:followUpRevision(value.expected_schedule_version),
    reason_code:purpose,ticket_id:uuidP2016(ticketId),purpose} as const;
  if(value.action==='CANCEL')return {...base,action:'CANCEL',due_at:null};
  try{const due=assertLocalDateTime(value.due_at);shanghaiLocalToEpochMs(due);return {...base,action:'SET',due_at:due};}catch{failP2016();}
}
async function maintainable(principal:WorkbenchPrincipal,ticket:P2016TicketRow,currentCommunicator:()=>Promise<boolean>):Promise<boolean>{
  if(!OPEN_STATES.includes(ticket.status))return false;
  if(principal.roles.some(role=>role==='ADMIN'||role==='DISPATCHER')||ticket.assignee_id===principal.principal_id)return true;
  return currentCommunicator();
}
async function readCurrent(transaction:PostgresTransaction,ticketId:string,lock=false):Promise<CurrentRow|null>{
  const result=await transaction.query<CurrentRow>(`SELECT s.schedule_version::text,s.due_at,s.due_epoch_ms::text,s.scheduled_event_id::text,
    (s.scheduled_event_id IS NOT NULL AND t.status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED') AND NOT EXISTS(
      SELECT 1 FROM pilot_ticket.ticket_event end_event WHERE end_event.ticket_id=t.id AND end_event.event_ordinal>start_event.event_ordinal
        AND (end_event.new_status IN ('CLOSED','CANCELLED') OR end_event.event_type='ticket.reopened'))) AS active
    FROM pilot_ticket.follow_up_schedule s JOIN pilot_ticket.ticket t ON t.id=s.ticket_id
    LEFT JOIN pilot_ticket.ticket_event start_event ON start_event.ticket_id=s.ticket_id AND start_event.event_id=s.scheduled_event_id
    WHERE s.ticket_id=$1::uuid${lock?' FOR UPDATE OF s':'}`,[ticketId]);
  return result.rows[0]??null;
}
async function readHistory(transaction:PostgresTransaction,ticketId:string):Promise<{items:SharedFollowUpHistoryEntry[];hasMore:boolean}>{
  const result=await transaction.query<HistoryRow>(`SELECT schedule_version::text,action,due_at,occurred_at,ticket_event_id::text,end_reason FROM (
    SELECT r.schedule_version,r.action,r.due_at,r.occurred_at,r.ticket_event_id,NULL::text AS end_reason,e.event_ordinal
      FROM pilot_ticket.follow_up_schedule_revision r JOIN pilot_ticket.ticket_event e ON e.ticket_id=r.ticket_id AND e.event_id=r.ticket_event_id WHERE r.ticket_id=$1::uuid
    UNION ALL
    SELECT r.schedule_version,'ENDED',r.due_at,ended.created_at,ended.event_id,ended.new_status,ended.event_ordinal
      FROM pilot_ticket.follow_up_schedule_revision r JOIN pilot_ticket.ticket_event start_event ON start_event.ticket_id=r.ticket_id AND start_event.event_id=r.ticket_event_id
      JOIN LATERAL (SELECT e.event_id,e.created_at,e.new_status,e.event_ordinal FROM pilot_ticket.ticket_event e
        WHERE e.ticket_id=r.ticket_id AND e.event_ordinal>start_event.event_ordinal AND e.new_status IN ('CLOSED','CANCELLED')
          AND NOT EXISTS(SELECT 1 FROM pilot_ticket.follow_up_schedule_revision later JOIN pilot_ticket.ticket_event later_event ON later_event.ticket_id=later.ticket_id AND later_event.event_id=later.ticket_event_id
            WHERE later.ticket_id=r.ticket_id AND later_event.event_ordinal>start_event.event_ordinal AND later_event.event_ordinal<e.event_ordinal)
        ORDER BY e.event_ordinal LIMIT 1) ended ON TRUE WHERE r.ticket_id=$1::uuid AND r.action='SET'
  ) history ORDER BY history.schedule_version DESC,history.event_ordinal DESC LIMIT 21`,[ticketId]);
  return {items:result.rows.slice(0,20).map(row=>({schedule_version:followUpRevision(row.schedule_version,false),action:row.action,due_at:assertLocalDateTime(row.due_at),
    occurred_at:assertLocalDateTime(row.occurred_at),ticket_event_id:uuidP2016(row.ticket_event_id),end_reason:row.end_reason})),hasMore:result.rows.length>20};
}
export function createWorkbenchFollowUpSchedules({pool,query,enabled=false,realtimeProjector,wakeup}:{pool:PostgresPool;query:P2016TicketQuery;enabled?:boolean;wakeup?:()=>unknown|Promise<unknown>}&Pick<SelfHandlingHooks,'realtimeProjector'>){
  const ledger=createP2016CommandLedger({pool});let dueBusy=false;
  async function ready(transaction:PostgresTransaction){guardP2016(enabled);if(!await followUpSchemaReady(transaction))failP2016('FOLLOW_UP_UNAVAILABLE',503);}
  return Object.freeze({
    async runDueBatch({limit=20}:{limit?:unknown}={}){
      if(typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>20)failP2016();
      if(!enabled||dueBusy)return {scanned:0,emitted:0,skipped:0};
      dueBusy=true;
      try{
        if(!await followUpDueSchemaReady(pool))failP2016('FOLLOW_UP_UNAVAILABLE',503);
        const candidates=await pool.query<{ticket_id:string;schedule_version:string}>(`SELECT s.ticket_id::text,s.schedule_version::text
          FROM pilot_ticket.follow_up_schedule s JOIN pilot_ticket.ticket t ON t.id=s.ticket_id
          JOIN pilot_ticket.ticket_event start_event ON start_event.ticket_id=s.ticket_id AND start_event.event_id=s.scheduled_event_id
          WHERE s.due_epoch_ms<=platform.physical_epoch_ms() AND t.status NOT IN ('CLOSED','CANCELLED','DUPLICATE_LINKED')
            AND NOT EXISTS(SELECT 1 FROM pilot_ticket.ticket_event ended WHERE ended.ticket_id=t.id AND ended.event_ordinal>start_event.event_ordinal
              AND (ended.new_status IN ('CLOSED','CANCELLED') OR ended.event_type='ticket.reopened'))
            AND NOT EXISTS(SELECT 1 FROM pilot_ticket.follow_up_due_signal signal WHERE signal.ticket_id=s.ticket_id AND signal.schedule_version=s.schedule_version)
          ORDER BY s.due_epoch_ms,s.ticket_id LIMIT $1`,[limit]);
        let emitted=0;
        for(const candidate of candidates.rows){
          const published=await transactionP2016(pool,async transaction=>{
            // Same order as human commands: stream, Ticket, then its current arrangement.
            await lockP2016Realtime(transaction);
            const ticket=(await transaction.query<{id:string;version:number}>('SELECT id::text,version FROM pilot_ticket.ticket WHERE id=$1::uuid FOR UPDATE',[candidate.ticket_id])).rows[0];if(!ticket)return false;
            const current=await readCurrent(transaction,ticket.id,true);
            if(!current?.active||current.schedule_version!==candidate.schedule_version||current.due_epoch_ms===null||current.scheduled_event_id===null)return false;
            const now=(await transaction.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0];if(!now||BigInt(current.due_epoch_ms)>BigInt(now.epoch))return false;
            const stamp=(await transaction.query<{at:string;expires:string}>(`WITH clock AS (SELECT GREATEST(platform.local_now(),COALESCE(max(occurred_at),platform.local_now())) AS at
              FROM conversation.realtime_event WHERE stream_name=$1) SELECT at,at+interval '7 days' AS expires FROM clock`,[REALTIME_STREAM_NAME])).rows[0];if(!stamp)failP2016('FOLLOW_UP_UNAVAILABLE',503);
            const marker=await transaction.query(`INSERT INTO pilot_ticket.follow_up_due_signal(ticket_id,schedule_version,published_at)
              VALUES($1::uuid,$2::bigint,$3::timestamp) ON CONFLICT(ticket_id,schedule_version) DO NOTHING RETURNING ticket_id`,[ticket.id,current.schedule_version,stamp.at]);
            if(marker.rowCount!==1)return false;
            const result=await appendP2016Realtime({transaction,command:{schema_version:1,publisher_name:'P2_016_FOLLOW_UP',publisher_version:'1',
              source_type:'TICKET_EVENT',source_id:current.scheduled_event_id,event_variant:'FOLLOW_UP_DUE',event_type:'ticket.updated',aggregate_type:'TICKET',aggregate_id:ticket.id,aggregate_version:String(ticket.version),
              authorization_scope_type:'SYSTEM',authorization_scope_id:null,visibility_scope:'WORKBENCH',
              payload:{ticket_id:ticket.id,follow_up_schedule_version:current.schedule_version,reason:'FOLLOW_UP_DUE'},occurred_at:stamp.at,expires_at:stamp.expires}});
            if(result.status==='EXPIRED_SOURCE')failP2016('FOLLOW_UP_UNAVAILABLE',503);
            return true;
          });
          if(published)emitted++;
        }
        if(emitted>0){try{await wakeup?.();}catch{/* A wake hint cannot undo the committed marker and replay event. */}}
        return {scanned:candidates.rows.length,emitted,skipped:candidates.rows.length-emitted};
      }finally{dueBusy=false;}
    },
    async view({authContext,ticketId:input}:{authContext:unknown;ticketId:unknown}):Promise<SharedFollowUpView>{
      guardP2016(enabled);const ticketId=uuidP2016(input);
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        const {principal,ticket}=await query.authorizedTicket({authContext,ticketId,transaction});await ready(transaction);
        const current=await readCurrent(transaction,ticketId),history=await readHistory(transaction,ticketId),canMaintain=await maintainable(principal,ticket,
          ()=>query.isCurrentCommunicator({authContext,ticketId,transaction}));
        const active=current?.active&&current.due_at!==null&&current.due_epoch_ms!==null?{
          schedule_version:followUpRevision(current.schedule_version,false),due_at:assertLocalDateTime(current.due_at),due_epoch_ms:assertEpochMsString(current.due_epoch_ms),
          is_due:BigInt(current.due_epoch_ms)<=BigInt(assertEpochMsString(String(Date.now())))}:null;
        return publicP2016({ticket_id:ticketId,ticket_version:ticket.version,schedule_version:current?followUpRevision(current.schedule_version,false):'0',active,
          allowed_actions:canMaintain?(active?['SET','CANCEL'] as const:['SET'] as const):[],history:history.items,history_has_more:history.hasMore});
      });
    },
    async acknowledgement({authContext,ticketId:input,commandId:inputCommand}:{authContext:unknown;ticketId:unknown;commandId:unknown}):Promise<SharedFollowUpReceipt>{
      // Always uses existing ledger/current Ticket READ; no 049/new-write/raw flag dependency.
      const ticketId=uuidP2016(input),commandId=uuidP2016(inputCommand);
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION READ ONLY');const {principal}=await query.authorizedTicket({authContext,ticketId,transaction});
        const result=await transaction.query<{state:unknown;version:unknown;event:unknown;control:unknown;schedule:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_ticket_version AS version,result_ticket_event_id::text AS event,result_control_event_id AS control,
          result_snapshot->>'schedule_version' AS schedule,error_code AS error,retryable FROM pilot_ticket.ticket_command_receipt
          WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid AND actor_principal_id=$4::uuid AND command_type=$5 LIMIT 1`,
          ['P2_016:'+principal.principal_id,commandId,ticketId,principal.principal_id,purpose]);
        const row=result.rows[0],base={client_command_id:commandId,ticket_id:ticketId};if(!row||row.state==='STARTED')return {...base,state:'UNKNOWN'};
        if(row.state==='FAILED'&&row.retryable===false&&typeof row.error==='string'&&P2016_ERROR_CODES.includes(row.error))return {...base,state:'FAILED',error:{code:row.error,retryable:false}};
        if(row.state==='COMMITTED'&&row.control===null)return {...base,state:'COMMITTED',result:{ok:true,ticket_id:ticketId,ticket_version:versionP2016(row.version),
          ticket_event_id:uuidP2016(row.event),control_event_id:null,schedule_version:followUpRevision(row.schedule,false),replayed:true}};
        failP2016('ACTION_FAILED',503);
      });
    },
    async perform({authContext,ticketId,input}:{authContext:unknown;ticketId:unknown;input:unknown}){
      guardP2016(enabled);const command=normalizeFollowUpCommand(ticketId,input);
      return ledger.execute({command,receiptType:purpose,authorize:async transaction=>{
        await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});await ready(transaction);
        // Stream mutex precedes receipt FK acquisition, as in T06/T11; it also serializes Control.
        await lockP2016Realtime(transaction);return query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
      },run:async transaction=>{
        await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction,lock:true});
        await transaction.query(`SELECT p.id,r.role FROM pilot_ticket.pilot_principal p JOIN pilot_ticket.pilot_principal_role r ON r.principal_id=p.id
          WHERE p.id=$1::uuid FOR SHARE OF p,r`,[(await query.principal(authContext,transaction)).principal_id]);
        const authority=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
        await transaction.query(`SELECT m.principal_id,rt.team_id FROM pilot_ticket.pilot_team_member m JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
          WHERE m.principal_id=$1::uuid ORDER BY m.team_id FOR SHARE OF m,rt`,[authority.principal.principal_id]);
        const {ticket,principal}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
        if(!await maintainable(principal,ticket,()=>query.isCurrentCommunicator({authContext,ticketId:ticket.id,transaction,lock:true})))failP2016('FORBIDDEN',403);
        if(ticket.version!==command.expected_version||ticket.version===2147483647)failP2016('VERSION_CONFLICT',409);
        const current=await readCurrent(transaction,ticket.id),previous=current?followUpRevision(current.schedule_version,false):'0';
        if(previous!==command.expected_schedule_version||BigInt(previous)===9223372036854775807n)failP2016('VERSION_CONFLICT',409);
        if(command.action==='CANCEL'&&(!current?.active||!current.due_at||!current.due_epoch_ms))failP2016('FOLLOW_UP_STATE_CONFLICT',409);
        const next=String(BigInt(previous)+1n),dueAt=command.action==='SET'?command.due_at:assertLocalDateTime(current?.due_at),
          dueEpoch=command.action==='SET'?shanghaiLocalToEpochMs(dueAt):assertEpochMsString(current?.due_epoch_ms);
        const updated=(await transaction.query<Pick<P2016TicketRow,'id'|'status'|'version'>>(`UPDATE pilot_ticket.ticket SET version=version+1,updated_at=GREATEST(created_at,platform.local_now())
          WHERE id=$1::uuid AND version=$2 RETURNING id::text,status,version`,[ticket.id,command.expected_version])).rows[0];if(!updated)failP2016('VERSION_CONFLICT',409);
        const event=await appendTicketEvent({transaction,ticket:updated,eventType:command.action==='SET'?'ticket.follow_up_scheduled':'ticket.follow_up_cancelled',
          oldStatus:ticket.status,actor:{type:'PILOT_USER',id:principal.principal_id},reasonCode:command.reason_code,traceId:'t37:'+command.client_command_id});
        await transaction.query(`INSERT INTO pilot_ticket.follow_up_schedule_revision(ticket_id,schedule_version,action,due_at,due_epoch_ms,ticket_event_id,occurred_at)
          VALUES($1::uuid,$2::bigint,$3,$4::timestamp,$5::bigint,$6::uuid,$7::timestamp)`,[ticket.id,next,command.action,dueAt,dueEpoch,event.event_id,event.created_at]);
        await transaction.query(`INSERT INTO pilot_ticket.follow_up_schedule(ticket_id,schedule_version,due_at,due_epoch_ms,scheduled_event_id)
          VALUES($1::uuid,$2::bigint,$3::timestamp,$4::bigint,$5::uuid) ON CONFLICT(ticket_id) DO UPDATE SET
          schedule_version=EXCLUDED.schedule_version,due_at=EXCLUDED.due_at,due_epoch_ms=EXCLUDED.due_epoch_ms,scheduled_event_id=EXCLUDED.scheduled_event_id`,
          [ticket.id,next,command.action==='SET'?dueAt:null,command.action==='SET'?dueEpoch:null,command.action==='SET'?event.event_id:null]);
        await realtimeProjector?.({transaction,ticket:{...ticket,...updated},event,command});
        return {ok:true as const,ticket_id:ticket.id,ticket_version:updated.version,ticket_event_id:event.event_id,control_event_id:null,schedule_version:next};
      }});
    }
  });
}
