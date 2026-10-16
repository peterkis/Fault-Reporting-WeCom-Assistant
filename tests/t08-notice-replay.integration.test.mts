import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,rows,text} from './helpers/t08-fixture.mjs';
import {transactionP2016} from '../src/p2-016-domain-contracts.mjs';
import {createP2016TicketNotificationProjector} from '../src/p2-016-ticket-notification-projector.mjs';

test('the existing public notification projector still reports an exact accepted-event replay inside a real handling round',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  assert.equal((await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]})).status,200);
  const accepted=await handler.post(path+'/accept-for-later-with-conversations',{client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(accepted.status,200,JSON.stringify(accepted.value));
  const before=(await admin.get(path+'/deliveries')).value,notices=rows(before.items);assert.equal(notices.length,1);const notice=notices[0];assert.ok(notice);assert.equal(notice.notification_type,'TICKET_ACCEPTED');
  const history=(await admin.get(path+'/events')).value,detail=(await admin.get(path)).value;
  const projector=createP2016TicketNotificationProjector({enabled:true});
  const replay=await transactionP2016(fixture.pool,transaction=>projector.project({transaction,ticket:{id:ticketId},event:{event_id:text(accepted.value.ticket_event_id)}}));
  assert.equal(replay.created,false);assert.equal(replay.replayed,true,'same-event replay must keep the existing replay acknowledgement rather than be reclassified as a later round acceptance');assert.equal(replay.delivery_id,notice.delivery_id);assert.equal(typeof replay.message_id,'string');assert.equal(typeof replay.outbox_id,'string');
  assert.deepEqual((await admin.get(path+'/deliveries')).value,before);assert.deepEqual((await admin.get(path+'/events')).value,history);assert.deepEqual((await admin.get(path)).value,detail);
 },{ticketAssignmentEnabled:true,ticketConversationSelfHandlingEnabled:true});
});
