import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {P2016ReturnToDispatchCommand} from '../contracts/workbench_return_to_dispatch_contracts.js';
import {withT09Fixture,rows,object,text,version} from './helpers/t09-fixture.mjs';

// One necessary public ACK tracer after the selected original GREEN; no ACK implementation before actual RED.
test('the original actor reads only the minimal committed return acknowledgement with sensitive draft recovery disabled and no new business writes',async()=>{
 await withT09Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),target=await fixture.http(3),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const get=async(url:string)=>{const response=await handler.get(url);assert.equal(response.status,200,JSON.stringify(response.value));return response.value;};
  assert.equal((await get('/api/lifecycle/bootstrap')).draft_recovery_enabled,false);
  const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:1,reason_code:'WORKBENCH_ASSIGN',target_principal_id:fixture.handler,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));
  await fixture.runtime.coordinator.runOnce();
  const related=rows((await get(path+'/responsibility')).conversations);assert.equal(related.length,1);const initial=related[0];assert.ok(initial);const sessionId=text(initial.session_id);
  const taken=await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:version(Number(text(initial.session_row_version))),reason_code:'T09_ACK_REAL_COMMUNICATOR'});assert.equal(taken.status,200,JSON.stringify(taken.value));
  for(const[action,reason]of[['accept','T09_ACK_REAL_ACCEPT'],['start','T09_ACK_REAL_START'],['wait-vendor','T09_ACK_REAL_WAIT']]as const){const response=await handler.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version((await get(path)).version),reason_code:reason});assert.equal(response.status,200,JSON.stringify(response.value));}
  const before=await get(path);assert.equal(before.status,'WAITING_VENDOR');assert.equal(before.assignee_id,fixture.handler);assert.equal(object(before.handling_cycle).first_responsibility_event_id,assigned.value.ticket_event_id);
  const session=rows((await get(path+'/responsibility')).conversations).find(item=>item.session_id===sessionId);assert.ok(session);assert.equal(session.conversation_principal_id,fixture.handler);
  const targetBootstrap=await target.get('/api/lifecycle/bootstrap');assert.equal(targetBootstrap.status,200,JSON.stringify(targetBootstrap.value));const targetId=text(targetBootstrap.value.principal_id);assert.equal(targetId,fixture.otherHandler);assert.ok(Array.isArray(targetBootstrap.value.roles)&&targetBootstrap.value.roles.includes('HANDLER'));
  const eligible=rows((await get('/api/conversations/'+sessionId+'/eligible-principals')).items).find(item=>item.principal_id===targetId);assert.ok(eligible);assert.ok(Array.isArray(eligible.actions)&&eligible.actions.includes('TRANSFER_TARGET'));
  const targetRead=await target.get('/api/conversations/'+sessionId);assert.equal(targetRead.status,200,JSON.stringify(targetRead.value));assert.equal(object(targetRead.value.session).session_id,sessionId);
  const command:P2016ReturnToDispatchCommand={client_command_id:randomUUID(),expected_version:version(before.version),reason_code:'WORKBENCH_RETURN_TO_DISPATCH',reason:'T09 ACK 合成内部停止原因，不属于ACK展示内容。',unfinished_work:'T09 ACK 合成内部未完成工作，原命令和所选会话均不应出现在ACK。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:targetId,sessions:[{session_id:sessionId,expected_row_version:version(Number(text(session.session_row_version)))}]};
  const returned=await handler.post(path+'/return-to-dispatch',command);assert.equal(returned.status,200,JSON.stringify(returned.value));assert.equal(returned.value.ok,true);assert.equal(returned.value.replayed,false);assert.equal(returned.value.ticket_version,command.expected_version+1);assert.equal(rows(returned.value.conversations).length,1);
  const after=await get(path),responsibility=await get(path+'/responsibility'),events=await get(path+'/events?limit=200'),deliveries=await get(path+'/deliveries');assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(rows(responsibility.conversations).find(item=>item.session_id===sessionId)?.conversation_principal_id,targetId);
  const ack=await handler.get(path+'/return-to-dispatch/commands/'+command.client_command_id);assert.equal(ack.status,200,JSON.stringify(ack.value));
  assert.deepEqual(ack.value,{state:'COMMITTED',ticket_id:ticketId,ticket_version:command.expected_version+1,ticket_event_id:text(returned.value.ticket_event_id)});
  assert.deepEqual(await get(path),after);assert.deepEqual(await get(path+'/responsibility'),responsibility);assert.deepEqual(await get(path+'/events?limit=200'),events);assert.deepEqual(await get(path+'/deliveries'),deliveries);
 },{ticketReturnToDispatchEnabled:true});
});
