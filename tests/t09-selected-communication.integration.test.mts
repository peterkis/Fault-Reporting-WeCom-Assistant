import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {P2016ReturnToDispatchCommand} from '../contracts/workbench_return_to_dispatch_contracts.js';
import {withT09Fixture,rows,object,text,version} from './helpers/t09-fixture.mjs';

// Second single public tracer. No selected production implementation is added before its actual RED.
test('the current handler stops a real waiting responsibility and explicitly transfers the selected conversation they own in the same command',async()=>{
 await withT09Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),target=await fixture.http(3),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const get=async(url:string)=>{const response=await handler.get(url);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;};
  const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));
  await fixture.runtime.coordinator.runOnce();
  const related=rows((await get(path+'/responsibility')).conversations);assert.equal(related.length,1);const initial=related[0];assert.ok(initial);
  const sessionId=text(initial.session_id),taken=await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(Number(text(initial.session_row_version))),reason_code:'T09_EXPLICIT_SELECTED_ORIGINAL_OWNER'});assert.equal(taken.status,200,JSON.stringify(taken.value));
  const accepted=await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:version((await get(path)).version),reason_code:'T09_SELECTED_REAL_ACCEPT'});assert.equal(accepted.status,200,JSON.stringify(accepted.value));
  const started=await handler.post(path+'/start',{client_command_id:randomUUID(),expected_version:version((await get(path)).version),reason_code:'T09_SELECTED_REAL_START'});assert.equal(started.status,200,JSON.stringify(started.value));
  const waiting=await handler.post(path+'/wait-vendor',{client_command_id:randomUUID(),expected_version:version((await get(path)).version),reason_code:'T09_SELECTED_REAL_WAIT_VENDOR'});assert.equal(waiting.status,200,JSON.stringify(waiting.value));
  const before=await get(path),responsibility=await get(path+'/responsibility'),events=rows((await get(path+'/events?limit=200')).items),deliveries=await get(path+'/deliveries');
  assert.equal(before.status,'WAITING_VENDOR');assert.equal(before.assignee_id,fixture.handler);assert.equal(before.resolver_team_id,'PILOT_IT');
  const cycle=object(before.handling_cycle);assert.equal(cycle.cycle_no,1);assert.equal(cycle.first_responsibility_event_id,assigned.value.ticket_event_id);
  assert.ok(events.some(event=>event.event_type==='ticket.started'));assert.ok(events.some(event=>event.event_type==='ticket.waiting_vendor'));
  const source=rows(responsibility.conversations).find(item=>item.session_id===sessionId);assert.ok(source);assert.equal(source.conversation_principal_id,fixture.handler);
  const sessionVersion=version(Number(text(source.session_row_version)));assert.equal(rows(deliveries.items).filter(item=>item.notification_type==='TICKET_ACCEPTED').length,1);
  const actorSession=await get('/api/conversations/'+sessionId);assert.equal(object(actorSession.assignment).status,'ASSIGNED');assert.equal(object(actorSession.assignment).assigned_to_me,true);assert.equal(object(actorSession.session).row_version,sessionVersion);
  const targetBootstrap=await target.get('/api/lifecycle/bootstrap');assert.equal(targetBootstrap.status,200,JSON.stringify(targetBootstrap.value));assert.ok(Array.isArray(targetBootstrap.value.roles)&&targetBootstrap.value.roles.includes('HANDLER'));
  const targetId=text(targetBootstrap.value.principal_id);assert.equal(targetId,fixture.otherHandler);assert.notEqual(targetId,fixture.handler);
  const eligible=rows((await get('/api/conversations/'+sessionId+'/eligible-principals')).items).find(item=>item.principal_id===targetId);assert.ok(eligible);assert.ok(Array.isArray(eligible.actions)&&eligible.actions.includes('TRANSFER_TARGET'));
  const targetRead=await target.get('/api/conversations/'+sessionId);assert.equal(targetRead.status,200,JSON.stringify(targetRead.value));assert.equal(object(targetRead.value.session).session_id,sessionId);assert.equal(object(targetRead.value.session).row_version,sessionVersion);
  const command:P2016ReturnToDispatchCommand={client_command_id:randomUUID(),expected_version:version(before.version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'厂商维修条件不足，需要重新安排处理。',unfinished_work:'打印设备仍未恢复，明确将此服务主题沟通交给另一位内部同事。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:targetId,sessions:[{session_id:sessionId,expected_row_version:sessionVersion}]};
  const returned=await handler.post(path+'/return-to-dispatch',command);assert.equal(returned.status,200,JSON.stringify(returned.value));
  assert.equal(returned.value.ok,true);assert.equal(returned.value.ticket_id,ticketId);assert.equal(returned.value.ticket_version,command.expected_version+1);assert.equal(returned.value.replayed,false);assert.equal(returned.value.communication_choice,'TRANSFER_SELECTED');assert.deepEqual(returned.value.handling_cycle,cycle);
  const controlled=rows(returned.value.conversations);assert.equal(controlled.length,1);assert.equal(controlled[0]?.session_id,sessionId);assert.equal(controlled[0]?.session_row_version,sessionVersion+1);assert.equal(controlled[0]?.changed,true);assert.equal(typeof controlled[0]?.control_event_id,'string');
  assert.equal(Object.hasOwn(returned.value,'reason'),false);assert.equal(Object.hasOwn(returned.value,'unfinished_work'),false);
  const after=await get(path);assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.equal(after.intake_id,before.intake_id);assert.deepEqual(after.handling_cycle,cycle);assert.equal(after.version,command.expected_version+1);
  const afterResponsibility=await get(path+'/responsibility'),current=rows(afterResponsibility.conversations).find(item=>item.session_id===sessionId);assert.ok(current);assert.equal(current.conversation_principal_id,targetId);assert.equal(current.session_row_version,String(sessionVersion+1));
  const afterEvents=rows((await get(path+'/events?limit=200')).items);assert.deepEqual(afterEvents.slice(0,-1),events);assert.equal(afterEvents.at(-1)?.event_type,'ticket.returned_to_dispatch');assert.equal(afterEvents.at(-1)?.event_id,returned.value.ticket_event_id);assert.equal(afterEvents.at(-1)?.old_status,'WAITING_VENDOR');assert.equal(afterEvents.at(-1)?.new_status,'QUEUED');assert.equal(afterEvents.at(-1)?.has_internal_note,true);assert.equal(afterEvents.at(-1)?.has_external_note,false);
  assert.deepEqual(await get(path+'/deliveries'),deliveries);
 },{ticketReturnToDispatchEnabled:true});
});
