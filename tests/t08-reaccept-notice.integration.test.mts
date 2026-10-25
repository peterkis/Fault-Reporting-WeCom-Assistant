import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,rows,object,text} from './helpers/t08-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';

test('real withdrawal and a different handler acceptance preserve the already acknowledged responsibility promise in the same handling round',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),nextHandler=await fixture.http(3),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const first=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(first.status,200,JSON.stringify(first.value));
  await fixture.runtime.coordinator.runOnce();const source=rows((await handler.get(path+'/responsibility')).value.conversations)[0];assert.ok(source);
  assert.equal((await handler.post('/api/conversations/'+source.session_id+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(source.session_row_version),reason_code:'T08_RETAIN_REAL_COMMUNICATOR'})).status,200);
  const accept=(version:number)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
  const initial=await handler.post(path+'/accept-for-later-with-conversations',accept(2));assert.equal(initial.status,200,JSON.stringify(initial.value));const cycle=object((await admin.get(path)).value.handling_cycle);assert.equal(cycle.first_responsibility_event_id,first.value.ticket_event_id);
  const promised=rows((await admin.get(path+'/deliveries')).value.items).filter(row=>row.notification_type==='TICKET_ACCEPTED');assert.equal(promised.length,1,'the original responsibility promise must actually exist');const notice=promised[0];assert.ok(notice);
  let calls=0;const sender=createCommunicationDeliveryWorker({pool:fixture.pool,enabled:true,sender:{send:async()=>{calls++;return {outcome:'ACKNOWLEDGED',provider_message_id:'T08_SYNTHETIC_RESPONSIBILITY_ACK',error_code:null,retryable:false};}}});
  const sent=await sender.deliver({deliveryId:text(notice.delivery_id)});assert.ok(sent&&'status' in sent);assert.equal(sent.status,'SENT');assert.equal(calls,1);
  const originalDeliveries=(await admin.get(path+'/deliveries')).value,originalResponsibility=(await admin.get(path+'/responsibility')).value,originalEvents=rows((await admin.get(path+'/events')).value.items);
  const withdrawal={client_command_id:randomUUID(),expected_version:3,reason_code:'WORKBENCH_UNASSIGN',reason:'尚未开始，当前处理责任交回重新安排；沟通人继续跟进。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]};
  assert.equal((await admin.post(path+'/unassign',withdrawal)).status,200);assert.deepEqual((await admin.get(path+'/deliveries')).value,originalDeliveries);assert.deepEqual((await admin.get(path)).value.handling_cycle,cycle);
  const resumed=await nextHandler.post(path+'/accept-for-later-with-conversations',accept(4));assert.equal(resumed.status,200,JSON.stringify(resumed.value));
  const current=(await admin.get(path)).value;assert.equal(current.status,'ACCEPTED');assert.equal(current.version,5);assert.equal(current.assignee_id,fixture.otherHandler);assert.deepEqual(current.handling_cycle,cycle);
  assert.deepEqual((await admin.get(path+'/responsibility')).value.conversations,originalResponsibility.conversations,'an explicit retain must preserve the original communication owner');
  const events=rows((await admin.get(path+'/events')).value.items);assert.deepEqual(events.slice(0,-2),originalEvents);assert.equal(events.at(-2)?.event_type,'ticket.unassigned');assert.equal(events.at(-1)?.event_type,'ticket.accepted');
  assert.deepEqual((await admin.get(path+'/deliveries')).value,originalDeliveries,'a later acceptance in the same round must not create a second Message/Outbox/Delivery promise');
  assert.equal(await sender.deliver({deliveryId:text(notice.delivery_id)}),null);assert.equal(calls,1);
  assert.equal((await admin.post(path+'/unassign',withdrawal)).value.replayed,true);assert.deepEqual((await admin.get(path+'/deliveries')).value,originalDeliveries);
 },{ticketAssignmentEnabled:true,ticketConversationSelfHandlingEnabled:true});
});
