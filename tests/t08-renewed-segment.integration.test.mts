import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,object,rows} from './helpers/t08-fixture.mjs';

test('a real fresh unstarted acceptance after withdrawal can itself be withdrawn in the same original round',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),dispatcher=await fixture.http(1),handler=await fixture.http(2),nextHandler=await fixture.http(3),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));
  const accept=(version:number)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
  assert.equal((await handler.post(path+'/accept-for-later-with-conversations',accept(2))).status,200);
  const cycle=object((await admin.get(path)).value.handling_cycle),originalDeliveries=(await admin.get(path+'/deliveries')).value,originalResponsibility=(await admin.get(path+'/responsibility')).value;
  assert.equal(cycle.first_responsibility_event_id,assigned.value.ticket_event_id);
  const release=(version:number)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_UNASSIGN',reason:'当前责任段尚未开始，交回调度安排。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
  assert.equal((await dispatcher.post(path+'/unassign',release(3))).status,200);
  assert.equal((await nextHandler.post(path+'/accept-for-later-with-conversations',accept(4))).status,200);
  const before=(await admin.get(path)).value,events=rows((await admin.get(path+'/events')).value.items);assert.equal(before.status,'ACCEPTED');assert.equal(before.assignee_id,fixture.otherHandler);assert.equal(before.version,5);assert.equal(events.some(event=>['ticket.started','ticket.waiting_requester','ticket.waiting_vendor','ticket.resumed'].includes(String(event.event_type))),false);
  const second=release(5),result=await admin.post(path+'/unassign',second);assert.equal(result.status,200,JSON.stringify(result.value));
  const after=(await admin.get(path)).value;assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.version,6);assert.equal(after.intake_id,before.intake_id);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.deepEqual(after.handling_cycle,cycle);
  const history=rows((await admin.get(path+'/events')).value.items);assert.deepEqual(history.slice(0,-1),events);assert.equal(history.at(-1)?.event_type,'ticket.unassigned');assert.equal(history.filter(event=>event.event_type==='ticket.unassigned').length,2);
  assert.deepEqual((await admin.get(path+'/deliveries')).value,originalDeliveries);assert.deepEqual((await admin.get(path+'/responsibility')).value.conversations,originalResponsibility.conversations);
  assert.equal((await admin.post(path+'/unassign',second)).value.replayed,true);assert.deepEqual((await admin.get(path+'/events')).value.items,history);assert.deepEqual((await admin.get(path+'/deliveries')).value,originalDeliveries);
 },{ticketAssignmentEnabled:true,ticketConversationSelfHandlingEnabled:true});
});
