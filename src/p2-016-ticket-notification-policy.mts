import type { TicketStatus } from './p1-005-pilot-ticket-core.mjs';

import { EXTERNAL_TICKET_STATUS } from './p1-005-pilot-ticket-core.mjs';
import { exactP2016,publicP2016,failP2016 } from './p2-016-domain-contracts.mjs';
export const P2016_NOTIFICATION_VERSION='p2-016-ticket-notification/1';
const TYPES=Object.freeze({'ticket.created':'TICKET_CREATED','ticket.accepted':'TICKET_ACCEPTED',
  'ticket.started':'TICKET_IN_PROGRESS','ticket.resumed':'TICKET_IN_PROGRESS','ticket.waiting_requester':'WAITING_REQUESTER',
  'ticket.waiting_vendor':'WAITING_VENDOR','ticket.resolved':'TICKET_RESOLVED','ticket.closed':'TICKET_CLOSED',
  'ticket.reopened':'TICKET_REOPENED','ticket.cancelled':'TICKET_CANCELLED','ticket.auto_close_reminder':'TICKET_RESOLVED'} as const);
export function ticketNotificationP2016(event: unknown,{additionalEventTypes=[]}: { additionalEventTypes?: readonly string[] }={}) {
  if(!Array.isArray(additionalEventTypes)||additionalEventTypes.some(type=>!Object.hasOwn(TYPES,type)))failP2016('NOTIFICATION_POLICY_INVALID');
  const value=exactP2016(event,['event_type','new_status'],['event_type','new_status']);
  if(!Object.hasOwn(TYPES,value.event_type as string))return null;
  if(!['ticket.accepted','ticket.closed'].includes(value.event_type as string)&&!additionalEventTypes.includes(value.event_type as string))return null;
  if(!Object.hasOwn(EXTERNAL_TICKET_STATUS,value.new_status as string))failP2016();
  return publicP2016({notification_type:TYPES[value.event_type as keyof typeof TYPES],template_version:P2016_NOTIFICATION_VERSION,
    external_status:EXTERNAL_TICKET_STATUS[value.new_status as TicketStatus]});
}
