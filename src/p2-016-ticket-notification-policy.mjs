import { EXTERNAL_TICKET_STATUS } from './p1-005-pilot-ticket-core.mjs';
import { exactP2016,publicP2016,failP2016 } from './p2-016-domain-contracts.mjs';
export const P2016_NOTIFICATION_VERSION='p2-016-ticket-notification/1';
const TYPES=Object.freeze({'ticket.created':'TICKET_CREATED','ticket.accepted':'TICKET_ACCEPTED',
  'ticket.started':'TICKET_IN_PROGRESS','ticket.resumed':'TICKET_IN_PROGRESS','ticket.waiting_requester':'WAITING_REQUESTER',
  'ticket.waiting_vendor':'WAITING_VENDOR','ticket.resolved':'TICKET_RESOLVED','ticket.closed':'TICKET_CLOSED',
  'ticket.reopened':'TICKET_REOPENED','ticket.cancelled':'TICKET_CANCELLED','ticket.auto_close_reminder':'TICKET_RESOLVED'});
export function ticketNotificationP2016(event) {
  const value=exactP2016(event,['event_type','new_status'],['event_type','new_status']);
  if(!Object.hasOwn(TYPES,value.event_type))return null;
  if(!Object.hasOwn(EXTERNAL_TICKET_STATUS,value.new_status))failP2016();
  return publicP2016({notification_type:TYPES[value.event_type],template_version:P2016_NOTIFICATION_VERSION,
    external_status:EXTERNAL_TICKET_STATUS[value.new_status]});
}
