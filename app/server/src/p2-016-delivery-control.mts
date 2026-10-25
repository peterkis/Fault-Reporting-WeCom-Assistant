import type { PostgresPool } from './platform/postgres-pool.mjs';
import type { P2016TicketQuery } from './p2-016-ticket-query.mjs';
interface DeliveryOptions { pool: PostgresPool; query: Pick<P2016TicketQuery, 'authorizedTicket'>; enabled?: boolean; externalSendEnabled?: boolean }
type DeliveryOperatorResult = { ok?: never; status: string } | { ok: false; status?: never };

import { createCommunicationDeliveryOperatorPort,createCommunicationReconciliationPort } from './p2-004-communication-delivery-worker.mjs';
import { createP2016CommandLedger } from './p2-016-ticket-command-ledger.mjs';
import { exactP2016,uuidP2016,codeP2016,failP2016,guardP2016 } from './p2-016-domain-contracts.mjs';
import { WorkbenchError, WORKBENCH_ERROR_CODES } from './p2-006-workbench-query.mjs';

export function createP2016DeliveryControl({pool,query,enabled=false,externalSendEnabled=true}: DeliveryOptions) {
  if(typeof externalSendEnabled!=='boolean')throw new TypeError('WORKBENCH_EXTERNAL_SEND_CONFIGURATION_INVALID');
  const ledger=createP2016CommandLedger({pool}),operator=createCommunicationDeliveryOperatorPort({pool}),reconciliation=createCommunicationReconciliationPort({pool});
  return Object.freeze({
    async perform({authContext,ticketId,deliveryId,action,body}: { authContext: unknown; ticketId: string; deliveryId: string; action: string; body: unknown }) {
      guardP2016(enabled);
      if(!externalSendEnabled)throw new WorkbenchError(WORKBENCH_ERROR_CODES.externalSendDisabled,403);
      const v=exactP2016(body,['client_command_id','reason_code','resolution'],['client_command_id','reason_code']);
      if(!['retry','reconcile'].includes(action)||action==='retry'&&v.resolution!==undefined
        ||action==='reconcile'&&!['CONFIRMED_SENT','CONFIRMED_NOT_SENT_REQUEUE','CANCEL'].includes(v.resolution as string))failP2016();
      const command: { client_command_id: string; reason_code: string; ticket_id: string; delivery_id: string; action: string; resolution?: unknown }={...v,client_command_id:uuidP2016(v.client_command_id),reason_code:codeP2016(v.reason_code),
        ticket_id:uuidP2016(ticketId),delivery_id:uuidP2016(deliveryId),action:'DELIVERY_'+action.toUpperCase()};
      return ledger.execute({command,authorize:async transaction=>{
        const c=await query.authorizedTicket({authContext,ticketId,transaction});
        const binding=await transaction.query('SELECT 1 FROM communication.ticket_notification_binding WHERE ticket_id=$1::uuid AND delivery_id=$2::uuid',[command.ticket_id,command.delivery_id]);
        if(!binding.rowCount)failP2016('NOT_FOUND',404);
        if(action==='reconcile'?!c.principal.roles.includes('ADMIN'):!c.principal.roles.some(r=>['ADMIN','DISPATCHER'].includes(r))&&c.ticket.assignee_id!==c.principal.principal_id)failP2016('FORBIDDEN',403);
        return c;
      },run:async transaction=>{
        const input={transaction,deliveryId:command.delivery_id,authorized:true,reasonCode:command.reason_code};
        const result: DeliveryOperatorResult=action==='retry'?await operator.scheduleRetry(input):await reconciliation.reconcileUnknownDelivery({...input,expectedStatus:'RECONCILIATION_REQUIRED',resolution:command.resolution as 'CONFIRMED_SENT' | 'CONFIRMED_NOT_SENT_REQUEUE' | 'CANCEL'});
        if(result.ok===false)failP2016('DELIVERY_STATE_CONFLICT',409);
        return {ok:true,delivery_id:command.delivery_id,status:result.status};
      }});
    },
  });
}
