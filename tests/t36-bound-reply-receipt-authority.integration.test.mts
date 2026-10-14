import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT36BoundReplyFixture} from './helpers/t36-bound-reply-fixture.mjs';
test('T36 same-actor bound reply receipt requires exact material READ even when an assigned Session remains readable',{timeout:240000},()=>withT36BoundReplyFixture(async f=>{
 const command={client_command_id:randomUUID(),expected_row_version:f.rowVersion,text:'T36明确绑定的当前READ核对',follow_up_target:{ticket_id:f.ticketId,...f.r2}};
 const sent=await f.postReply(command);assert.equal(sent.status,202);await sent.arrayBuffer();const takeover=await f.takeoverSelf();assert.equal(takeover.status,200);await takeover.arrayBuffer();
 await f.setActorRoles(['HANDLER']);const session=await f.get('/api/workbench/conversations/'+f.sessionId),ticket=await f.get('/api/tickets/'+f.ticketId);assert.equal(session.status,200,'original assigned Session VIEW remains valid');await session.arrayBuffer();assert.equal(ticket.status,404,'exact current material parent READ is actually lost');await ticket.arrayBuffer();
 const ack=await f.get('/api/workbench/conversations/'+f.sessionId+'/messages/commands/'+command.client_command_id);const body=await ack.text();console.log('T36_BOUND_RECEIPT_CURRENT_READ '+JSON.stringify({session_status:200,ticket_status:404,receipt_status:ack.status}));assert.equal(ack.status,404,'a principal-bound reply ACK must not bypass its current exact material purpose');assert.doesNotMatch(body,/message_id|outbox_id|delivery_ids/u);
}));
