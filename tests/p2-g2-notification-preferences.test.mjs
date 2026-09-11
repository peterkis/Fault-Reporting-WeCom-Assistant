import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketNotificationP2016 } from '../src/p2-016-ticket-notification-policy.mjs';

test('default private progress policy sends accepted and final closed only',()=>{
  const events=[['ticket.created','NEW'],['ticket.accepted','ACCEPTED'],['ticket.started','IN_PROGRESS'],
    ['ticket.waiting_requester','WAITING_REQUESTER'],['ticket.waiting_vendor','WAITING_VENDOR'],
    ['ticket.resumed','IN_PROGRESS'],['ticket.resolved','RESOLVED'],['ticket.closed','CLOSED'],
    ['ticket.reopened','ACCEPTED'],['ticket.cancelled','CANCELLED'],['ticket.auto_close_reminder','RESOLVED']];
  assert.deepEqual(events.filter(([event_type,new_status])=>ticketNotificationP2016({event_type,new_status})).map(([type])=>type),
    ['ticket.accepted','ticket.closed']);
});

test('previous lifecycle events remain explicitly configurable',()=>{
  const event={event_type:'ticket.resolved',new_status:'RESOLVED'};
  assert.equal(ticketNotificationP2016(event,{additionalEventTypes:['ticket.resolved']}).notification_type,'TICKET_RESOLVED');
  assert.equal(ticketNotificationP2016(event),null);
  assert.throws(()=>ticketNotificationP2016(event,{additionalEventTypes:['ticket.unknown']}));
});
