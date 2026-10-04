import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { WorkbenchPrincipal } from './p2-006-workbench-authorization.mjs';
import type { P2016TicketRow } from './p2-016-ticket-query.mjs';
import type { TicketCommand } from './p2-016-ticket-command-facade.mjs';

import { appendTicketEvent } from './p1-006-ticket-state-actions.mjs';
import { ticketActionAllowedP2016 } from './p2-016-ticket-query.mjs';
import { failP2016 } from './p2-016-domain-contracts.mjs';

export async function transferTicketAssignmentP2016({transaction,principal,ticket,command}: { transaction: PostgresTransaction; principal: WorkbenchPrincipal; ticket: P2016TicketRow; command: Extract<TicketCommand, { action: 'transfer-assignment' }> }) {
  if(!ticketActionAllowedP2016(principal,ticket,'transfer-assignment'))failP2016('FORBIDDEN',403);
  if(ticket.version!==command.expected_version)failP2016('VERSION_CONFLICT',409);
  const team=command.resolver_team_id??ticket.resolver_team_id;
  if(!principal.roles.some(r=>['ADMIN','DISPATCHER'].includes(r))&&team!==ticket.resolver_team_id)failP2016('FORBIDDEN',403);
  const target=await transaction.query(`SELECT p.id FROM pilot_ticket.pilot_principal p
    JOIN pilot_ticket.pilot_team_member m ON m.principal_id=p.id
    JOIN pilot_ticket.resolver_team rt ON rt.team_id=m.team_id
    WHERE p.id=$1::uuid AND p.is_active AND m.team_id=$2 AND rt.is_active
      AND EXISTS(SELECT 1 FROM pilot_ticket.pilot_principal_role r WHERE r.principal_id=p.id AND r.role IN ('ADMIN','DISPATCHER','HANDLER'))
    FOR SHARE OF p,rt`,[command.target_principal_id,team]);
  if(target.rowCount!==1)failP2016('TARGET_INVALID',403);
  const updated=await transaction.query<Pick<P2016TicketRow, 'id' | 'status' | 'version'>>(`UPDATE pilot_ticket.ticket SET assignee_id=$2::uuid,resolver_team_id=$3,
    version=version+1,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid AND version=$4
    RETURNING id::text,status,version`,[ticket.id,command.target_principal_id,team,command.expected_version]);
  if(updated.rowCount!==1)failP2016('VERSION_CONFLICT',409);
  const event=await appendTicketEvent({transaction,ticket:(updated.rows[0] as (typeof updated.rows)[number]),eventType:'ticket.assignment_transferred',
    oldStatus:ticket.status,actor:{type:'PILOT_USER',id:principal.principal_id},reasonCode:command.reason_code,traceId:'p2-016:'+command.client_command_id,
    assignmentMetadata:{old_assignee_id:ticket.assignee_id,new_assignee_id:command.target_principal_id,old_team_id:ticket.resolver_team_id,new_team_id:team}});
  return {ticket:{...ticket,...updated.rows[0],assignee_id:command.target_principal_id,resolver_team_id:team},event};
}
