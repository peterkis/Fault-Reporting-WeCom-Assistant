import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { TicketAction, TicketActionAfterHook, PublicTicketEvent } from './p1-006-ticket-state-actions.mjs';
import type { PublicPilotTicket } from './p1-005-pilot-ticket-core.mjs';
import type { P2016TicketQuery, P2016TicketRow } from './p2-016-ticket-query.mjs';
import type { createConversationControlService, ControlResult } from './p2-005-conversation-control.mjs';
type CommandBase = { ticket_id: string; client_command_id: string; expected_version: number; reason_code: string; note?: string; external_visible?: boolean };
export type TicketCommand = CommandBase & (
  { action: Exclude<TicketAction, 'auto-close'>; target_principal_id?: never; resolver_team_id?: never; session_id?: never; expected_session_row_version?: never }
  | { action: 'transfer-assignment'; target_principal_id: string; resolver_team_id?: string; session_id?: never; expected_session_row_version?: never }
  | { action: 'takeover-and-accept-ticket'; session_id: string; expected_session_row_version: number; target_principal_id?: never; resolver_team_id?: never });
export interface TicketProjectionInput { transaction: PostgresTransaction; ticket: P2016TicketRow | PublicPilotTicket; event: PublicTicketEvent; command?: TicketCommand | null }
export type TicketRealtimeProjector = ((input: TicketProjectionInput) => Promise<unknown>) & { lock?: (transaction: PostgresTransaction) => Promise<unknown> };
interface FacadeOptions { pool: PostgresPool; enabled?: boolean; query?: P2016TicketQuery; controlService?: Pick<ReturnType<typeof createConversationControlService>, 'takeoverSessionInTransaction'>; notificationProjector?: { project: (input: TicketProjectionInput) => Promise<unknown> } | null; realtimeProjector?: TicketRealtimeProjector | null; closure?: { afterTicketAction: TicketActionAfterHook } | null }

import { createTicketActionService } from './p1-006-ticket-state-actions.mjs';
import { createP2016TicketQuery,ticketActionAllowedP2016 } from './p2-016-ticket-query.mjs';
import { createP2016CommandLedger } from './p2-016-ticket-command-ledger.mjs';
import { transferTicketAssignmentP2016 } from './p2-016-ticket-assignment.mjs';
import { exactP2016,uuidP2016,versionP2016,codeP2016,failP2016,guardP2016 } from './p2-016-domain-contracts.mjs';

const ACTIONS=['queue','accept','start','request-information','wait-vendor','resume','resolve','confirm','reopen','cancel','add-note','transfer-assignment','takeover-and-accept-ticket'];
export function normalizeP2016TicketCommand(input: unknown): TicketCommand {
  const v=exactP2016(input,['action','ticket_id','client_command_id','expected_version','reason_code','note','external_visible','target_principal_id','resolver_team_id','session_id','expected_session_row_version'],
    ['action','ticket_id','client_command_id','expected_version','reason_code']);
  if(!ACTIONS.includes(v.action as string))failP2016();
  const result: Record<string, unknown> & CommandBase={...v,ticket_id:uuidP2016(v.ticket_id),client_command_id:uuidP2016(v.client_command_id),
    expected_version:versionP2016(v.expected_version),reason_code:codeP2016(v.reason_code)};
  if(v.note!==undefined&&(typeof v.note!=='string'||!v.note.length||v.note.length>2000))failP2016();
  if(v.external_visible!==undefined&&typeof v.external_visible!=='boolean')failP2016();
  if(v.action==='transfer-assignment'){
    result.target_principal_id=uuidP2016(v.target_principal_id);
    if(v.resolver_team_id!==undefined)result.resolver_team_id=codeP2016(v.resolver_team_id);
  }else if(v.target_principal_id!==undefined||v.resolver_team_id!==undefined)failP2016();
  if(v.action==='takeover-and-accept-ticket'){
    result.session_id=uuidP2016(v.session_id);result.expected_session_row_version=versionP2016(v.expected_session_row_version);
  }else if(v.session_id!==undefined||v.expected_session_row_version!==undefined)failP2016();
  // The existing exact-key, action-specific and scalar guards above establish this union.
  return result as TicketCommand;
}
export function createP2016TicketCommandFacade({pool,enabled=false,query=createP2016TicketQuery({pool,enabled}),controlService,
  notificationProjector=null,realtimeProjector=null,closure=null}: FacadeOptions) {
  const ledger=createP2016CommandLedger({pool});
  return Object.freeze({
    async perform({authContext,command:input}: { authContext: unknown; command: unknown }) {
      guardP2016(enabled);const command=normalizeP2016TicketCommand(input);
      return ledger.execute({command,
        authorize:async transaction=>{
          const context=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction});
          if(command.session_id){
            const q=await transaction.query('SELECT service_intake_id::text FROM conversation.session WHERE id=$1::uuid',[command.session_id]);
            if(q.rowCount!==1||(q.rows[0] as (typeof q.rows)[number]).service_intake_id!==context.ticket.intake_id)failP2016('NOT_FOUND',404);
          }return context;
        },
        run:async(transaction,{principal,ticket:authorizedTicket})=>{
          await realtimeProjector?.lock?.(transaction);
          const action=command.action==='takeover-and-accept-ticket'?'accept':command.action;
          if(!ticketActionAllowedP2016(principal,authorizedTicket,action))failP2016('FORBIDDEN',403);
          let control: ControlResult | null=null;
          if(command.action==='takeover-and-accept-ticket'){
            if(!controlService?.takeoverSessionInTransaction)failP2016('CONTROL_UNAVAILABLE',503);
            control=await controlService.takeoverSessionInTransaction({transaction,command:{
              command_type:'TAKEOVER',session_id:command.session_id,client_command_id:command.client_command_id,
              idempotency_scope:'P2_016_TAKEOVER',expected_row_version:command.expected_session_row_version,
              actor_principal_id:principal.principal_id,target_principal_id:principal.principal_id,reason_code:command.reason_code,
            }});
            if(!control?.ok||control.no_op)failP2016('CONTROL_CONFLICT',409);
          }
          const {ticket}=await query.authorizedTicket({authContext,ticketId:command.ticket_id,transaction,lock:true});
          let result: { ticket: P2016TicketRow | PublicPilotTicket; event: PublicTicketEvent };
          if(command.action==='transfer-assignment')result=await transferTicketAssignmentP2016({transaction,principal,ticket,command});
          else {
            const actions=createTicketActionService({authorize:async({ticket:current,action})=>ticketActionAllowedP2016(principal,current,action),
              afterAction:closure?.afterTicketAction??null});
            result=await actions.performInTransaction({ticketId:ticket.id,action:command.action==='takeover-and-accept-ticket'?'accept':command.action,
              actor:{type:'PILOT_USER',id:principal.principal_id},expectedVersion:command.expected_version,
              note:command.note??null,externalVisible:command.external_visible??false,reasonCode:command.reason_code,
              traceId:'p2-016:'+command.client_command_id},transaction);
          }
          if(notificationProjector&&!closure)await notificationProjector.project({transaction,ticket:result.ticket,event:result.event});
          if(realtimeProjector)await realtimeProjector({transaction,ticket:result.ticket,event:result.event,command});
          return {ok:true,ticket_id:ticket.id,ticket_version:result.ticket.version,ticket_event_id:result.event.event_id,control_event_id:control?.event?.id??null};
        },
      });
    },
  });
}
