import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {P2016ReturnToDispatchCommand} from '../contracts/workbench_return_to_dispatch_contracts.js';
import {withT09Fixture,rows,object,text,version} from './helpers/t09-fixture.mjs';

// Original first public tracer. The production route is absent; predicted failure is NOT_RUN.
test('the current handler stops a real WAITING_VENDOR responsibility in one command while retaining group, round, communicator and existing notice',async()=>{
 await withT09Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const get=async(url:string)=>{const response=await handler.get(url);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;};
  const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
  assert.equal(assigned.status,200,JSON.stringify(assigned.value));
  await fixture.runtime.coordinator.runOnce();
  const source=rows((await get(path+'/responsibility')).conversations)[0];assert.ok(source);
  const taken=await handler.post('/api/conversations/'+text(source.session_id)+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(text(source.session_row_version)),reason_code:'T09_EXPLICIT_COMMUNICATOR'});assert.equal(taken.status,200,JSON.stringify(taken.value));
  const accepted=await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:version((await get(path)).version),reason_code:'T09_CURRENT_HANDLER_ACCEPT'});assert.equal(accepted.status,200,JSON.stringify(accepted.value));
  const started=await handler.post(path+'/start',{client_command_id:randomUUID(),expected_version:version((await get(path)).version),reason_code:'T09_REAL_STARTED'});assert.equal(started.status,200,JSON.stringify(started.value));
  assert.equal((await get(path)).status,'IN_PROGRESS');
  const waiting=await handler.post(path+'/wait-vendor',{client_command_id:randomUUID(),expected_version:version((await get(path)).version),reason_code:'T09_REAL_WAIT_VENDOR'});assert.equal(waiting.status,200,JSON.stringify(waiting.value));
  const before=await get(path),responsibility=await get(path+'/responsibility'),events=rows((await get(path+'/events?limit=200')).items),deliveries=await get(path+'/deliveries');
  assert.equal(before.status,'WAITING_VENDOR');assert.equal(before.assignee_id,fixture.handler);assert.equal(before.resolver_team_id,'PILOT_IT');
  const cycle=object(before.handling_cycle);assert.equal(cycle.cycle_no,1);assert.equal(cycle.first_responsibility_event_id,assigned.value.ticket_event_id);
  assert.ok(events.some(event=>event.event_type==='ticket.started'));assert.ok(events.some(event=>event.event_type==='ticket.waiting_vendor'));
  assert.equal(rows(responsibility.conversations).find(item=>item.session_id===source.session_id)?.conversation_principal_id,fixture.handler);
  assert.equal(rows(deliveries.items).filter(item=>item.notification_type==='TICKET_ACCEPTED').length,1,'a real original responsibility promise must exist before the return');
  const command:P2016ReturnToDispatchCommand={client_command_id:randomUUID(),expected_version:version(before.version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'需要重新安排具备维修条件的内部同事。',unfinished_work:'厂商配件未到；打印设备仍不可用，原沟通人继续跟进。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]};
  const returned=await handler.post(path+'/return-to-dispatch',command);assert.equal(returned.status,200,JSON.stringify(returned.value));
  assert.equal(returned.value.ok,true);assert.equal(returned.value.ticket_id,ticketId);assert.equal(returned.value.ticket_version,command.expected_version+1);
  assert.equal(returned.value.replayed,false);assert.equal(returned.value.communication_choice,'RETAIN_CURRENT');assert.deepEqual(returned.value.conversations,[]);assert.deepEqual(returned.value.handling_cycle,cycle);
  assert.equal(Object.hasOwn(returned.value,'reason'),false);assert.equal(Object.hasOwn(returned.value,'unfinished_work'),false);
  const after=await get(path);assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.equal(after.intake_id,before.intake_id);assert.deepEqual(after.handling_cycle,cycle);assert.equal(after.version,command.expected_version+1);
  const afterEvents=rows((await get(path+'/events?limit=200')).items);assert.deepEqual(afterEvents.slice(0,-1),events);
  assert.equal(afterEvents.at(-1)?.event_type,'ticket.returned_to_dispatch');assert.equal(afterEvents.at(-1)?.event_id,returned.value.ticket_event_id);assert.equal(afterEvents.at(-1)?.old_status,'WAITING_VENDOR');assert.equal(afterEvents.at(-1)?.new_status,'QUEUED');assert.equal(afterEvents.at(-1)?.has_internal_note,true);assert.equal(afterEvents.at(-1)?.has_external_note,false);
  assert.deepEqual((await get(path+'/responsibility')).conversations,responsibility.conversations);assert.deepEqual(await get(path+'/deliveries'),deliveries);
 },{ticketReturnToDispatchEnabled:true});
});
