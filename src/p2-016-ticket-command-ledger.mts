import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
export interface LedgerCommand { client_command_id: string; action: string; ticket_id?: string | null; review_id?: string | null; session_id?: string | null; expected_version?: number | null; expected_session_row_version?: number | string | null }
export interface LedgerContext { principal: { principal_id: string } }
export interface LedgerSuccess { ok: true; ticket_version?: number; ticket_event_id?: string; control_event_id?: string | null }
export interface LedgerFailure { ok: false; error: { code: string; retryable: boolean }; replayed: boolean }
// A committed DB snapshot follows the ledger write contract, but its consumer-specific payload is unknown.
export type StoredLedgerSuccess = LedgerSuccess & Record<string, unknown>;
export type LedgerResult<R extends LedgerSuccess> = (R & { replayed: false }) | (StoredLedgerSuccess & { replayed: true }) | LedgerFailure;
export interface LedgerExecution<C extends LedgerContext, R extends LedgerSuccess, D extends LedgerCommand = LedgerCommand> { command: D; receiptType?:'WORKBENCH_INTERNAL_NOTE'|'WORKBENCH_STAFF_COMPLETION'|'WORKBENCH_TICKET_ASSIGNMENT'|'WORKBENCH_TICKET_UNASSIGN'|'WORKBENCH_TICKET_RETURN_TO_DISPATCH'|'WORKBENCH_MANUAL_REPORT'; authorize: (transaction: PostgresTransaction) => Promise<C>; run: (transaction: PostgresTransaction, context: C) => Promise<R> }
interface ReceiptRow { id: string; command_hash: string; state: string; result_snapshot: StoredLedgerSuccess; error_code: string; retryable: boolean }

import { failP2016,hashP2016,publicP2016,transactionP2016,P2016_ERROR_CODES,uuidP2016,versionP2016,codeP2016 } from './p2-016-domain-contracts.mjs';
import type {P2016InternalNoteReceipt} from '../contracts/p2_016_contracts.js';
import type {P2016ReopenReceipt} from '../contracts/p2_016_contracts.js';
import {reopenRoundsSchemaReady} from './ticket-reopen-rounds.mjs';
import type {P2016ConversationHandlingAcknowledgement} from '../contracts/p2_016_contracts.js';
import { WorkbenchError } from './p2-006-workbench-query.mjs';

export function createP2016CommandLedger({pool}: { pool: Pick<PostgresPool, 'connect'> }) {
  return Object.freeze({
    async reopenReceipt({ticketId,commandId,authorize}:{ticketId:string;commandId:string;authorize:(transaction:PostgresTransaction)=>Promise<LedgerContext>}):Promise<P2016ReopenReceipt>{
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION READ ONLY');const {principal}=await authorize(transaction);
        const base={client_command_id:commandId,ticket_id:ticketId};
        // Original actor + Ticket + dedicated action. Never read the command hash,
        // reason, raw body or private result snapshot, and never require write/raw flags.
        const selected=await transaction.query<{state:string;version:number|null;event:string|null;error:string|null;retryable:boolean|null}>(`SELECT state,result_ticket_version AS version,result_ticket_event_id::text AS event,error_code AS error,retryable
          FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid
          AND actor_principal_id=$4::uuid AND command_type='reopen' LIMIT 1`,['P2_016:'+principal.principal_id,commandId,ticketId,principal.principal_id]);
        const row=selected.rows[0];if(!row||row.state==='STARTED')return {...base,state:'UNKNOWN'};
        if(row.state==='FAILED'&&row.retryable===false&&row.error&&P2016_ERROR_CODES.includes(row.error))return {...base,state:'FAILED',error:{code:row.error,retryable:false}};
        if(row.state==='COMMITTED'&&await reopenRoundsSchemaReady(transaction)){
          const basis=await transaction.query<{id:string;cycle_no:number}>(`SELECT c.id::text,c.cycle_no FROM pilot_ticket.ticket_cycle_reopen r
            JOIN pilot_ticket.ticket_handling_cycle c ON c.id=r.new_cycle_id AND c.ticket_id=r.ticket_id AND c.source_intake_id=r.source_intake_id
            JOIN pilot_ticket.ticket_event e ON e.event_id=r.reopen_event_id AND e.ticket_id=r.ticket_id
            WHERE r.ticket_id=$1::uuid AND r.client_command_id=$2::uuid AND r.origin='STAFF' AND r.reopen_event_id=$3::uuid
             AND c.cycle_start_event_id=e.event_id AND e.event_type='ticket.reopened' AND e.operator_type='PILOT_USER'
             AND e.operator_id=$4 AND e.aggregate_version=$5 AND e.old_status='CLOSED' AND e.new_status='REOPENED'`,[ticketId,commandId,row.event,principal.principal_id,row.version]);
          const cycle=basis.rows[0];if(cycle)return {...base,state:'COMMITTED',result:{ok:true,ticket_id:ticketId,ticket_version:versionP2016(row.version),ticket_event_id:uuidP2016(row.event),control_event_id:null,replayed:true,
            handling_cycle:{id:uuidP2016(cycle.id),cycle_no:versionP2016(cycle.cycle_no),first_responsibility_event_id:null,staff_completion_event_id:null}}};
        }
        // A historical legacy reopen without the shared basis is not a T20 result.
        return {...base,state:'UNKNOWN'};
      });
    },
    async conversationHandlingAcknowledgement({ticketId,commandId,authorize}:{ticketId:string;commandId:string;authorize:(transaction:PostgresTransaction)=>Promise<LedgerContext>}):Promise<P2016ConversationHandlingAcknowledgement>{
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION READ ONLY');
        const {principal}=await authorize(transaction);
        const selected=await transaction.query<{state:unknown;version:unknown;event:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_ticket_version AS version,result_ticket_event_id::text AS event,error_code AS error,retryable
          FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid
          AND command_type IN ('take-and-start-with-conversations','accept-for-later-with-conversations') LIMIT 1`,['P2_016:'+principal.principal_id,commandId,ticketId]);
        const row=selected.rows[0];
        if(!row||row.state==='STARTED')return publicP2016({state:'UNKNOWN' as const});
        if(row.state==='FAILED'&&row.retryable===false&&typeof row.error==='string'&&P2016_ERROR_CODES.includes(row.error))return publicP2016({state:'FAILED' as const,error:{code:row.error,retryable:false as const}});
        if(row.state==='COMMITTED')return publicP2016({state:'COMMITTED' as const,ticket_id:ticketId,ticket_version:versionP2016(row.version),ticket_event_id:uuidP2016(row.event)});
        failP2016('ACTION_FAILED',503);
      });
    },
    async internalNoteReceipt({ticketId,commandId,authorize}:{ticketId:string;commandId:string;authorize:(transaction:PostgresTransaction)=>Promise<LedgerContext>}):Promise<P2016InternalNoteReceipt>{
      return transactionP2016(pool,async transaction=>{
        await transaction.query('SET TRANSACTION READ ONLY');
        const {principal}=await authorize(transaction);
        const selected=await transaction.query<{state:unknown;version:unknown;event:unknown;control:unknown;error:unknown;retryable:unknown}>(`SELECT state,result_ticket_version AS version,result_ticket_event_id::text AS event,
          result_control_event_id::text AS control,error_code AS error,retryable FROM pilot_ticket.ticket_command_receipt
          WHERE command_scope=$1 AND client_command_id=$2::uuid AND ticket_id=$3::uuid AND command_type='WORKBENCH_INTERNAL_NOTE' LIMIT 1`,
        ['P2_016:'+principal.principal_id,commandId,ticketId]);
        const row=selected.rows[0],base={client_command_id:commandId,ticket_id:ticketId};
        if(!row||row.state==='STARTED')return {...base,state:'UNKNOWN'};
        if(row.state==='FAILED'&&row.retryable===false)return {...base,state:'FAILED',error:{code:codeP2016(row.error),retryable:false}};
        if(row.state==='COMMITTED'&&row.control===null)return {...base,state:'COMMITTED',result:{ok:true,ticket_id:ticketId,ticket_version:versionP2016(row.version),ticket_event_id:uuidP2016(row.event),control_event_id:null,replayed:true}};
        failP2016('ACTION_FAILED',503);
      });
    },
    async execute<C extends LedgerContext, R extends LedgerSuccess, D extends LedgerCommand>({command,receiptType,authorize,run}: LedgerExecution<C, R, D>): Promise<LedgerResult<R>> {
      return transactionP2016(pool,async tx=>{
        // Authorization precedes every receipt lookup, including a replay.
        const context=await authorize(tx);
        const scope='P2_016:'+context.principal.principal_id;
        const hash=hashP2016(command);
        await tx.query(`INSERT INTO pilot_ticket.ticket_command_receipt(command_scope,client_command_id,command_hash,
          command_type,ticket_id,review_id,conversation_session_id,actor_principal_id,expected_ticket_version,expected_session_version)
          VALUES($1,$2::uuid,$3,$4,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9,$10::bigint)
          ON CONFLICT(command_scope,client_command_id) DO NOTHING`,
        [scope,command.client_command_id,hash,receiptType??command.action,command.ticket_id??null,command.review_id??null,
          command.session_id??null,context.principal.principal_id,command.expected_version??null,command.expected_session_row_version??null]);
        const selected=await tx.query<ReceiptRow>(`SELECT id::text,command_hash,state,result_snapshot,error_code,retryable
          FROM pilot_ticket.ticket_command_receipt WHERE command_scope=$1 AND client_command_id=$2::uuid FOR UPDATE`,[scope,command.client_command_id]);
        const receipt=(selected.rows[0] as (typeof selected.rows)[number]);
        if(receipt.command_hash!==hash)failP2016('COMMAND_CONFLICT',409);
        if(receipt.state==='COMMITTED')return publicP2016({...receipt.result_snapshot,replayed:true});
        if(receipt.state==='FAILED')return publicP2016({ok:false,error:{code:receipt.error_code,retryable:receipt.retryable},replayed:true});
        await tx.query('SAVEPOINT p2016_business');
        try {
          const result=publicP2016(await run(tx,context));
          if(result.ok!==true)failP2016('ACTION_FAILED',409);
          await tx.query(`UPDATE pilot_ticket.ticket_command_receipt SET state='COMMITTED',result_snapshot=$2::jsonb,
            result_ticket_version=$3,result_ticket_event_id=$4::uuid,result_control_event_id=$5::uuid,
            updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid`,
          [receipt.id,JSON.stringify(result),result.ticket_version??null,result.ticket_event_id??null,result.control_event_id??null]);
          await tx.query('RELEASE SAVEPOINT p2016_business');
          return publicP2016({...result,replayed:false});
        } catch(error) {
          await tx.query('ROLLBACK TO SAVEPOINT p2016_business');
          const known=(error instanceof WorkbenchError&&P2016_ERROR_CODES.includes(error.code)) || ['TICKET_VERSION_CONFLICT','INVALID_STATE_TRANSITION','FORBIDDEN'].includes((error as { code?: string } | null | undefined)?.code as string);
          const code=['P2_015_COMMAND_CONFLICT','P2_015_VERSION_CONFLICT'].includes((error as { code?: string } | null | undefined)?.code as string)
            ? 'P2_016_VERSION_CONFLICT' : known?(error as { code: string }).code:'P2_016_ACTION_FAILED';
          await tx.query(`UPDATE pilot_ticket.ticket_command_receipt SET state='FAILED',error_code=$2,retryable=false,
            updated_at=platform.local_now(),completed_at=platform.local_now() WHERE id=$1::uuid`,[receipt.id,code]);
          return publicP2016({ok:false,error:{code,retryable:false},replayed:false});
        }
      });
    },
  });
}
