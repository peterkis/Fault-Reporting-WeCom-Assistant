import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,rows,text,object} from './helpers/t08-fixture.mjs';
test('explicit unassign transfers a genuinely related communication responsibility in the same command without moving the processing group or creating notifications',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_PUBLIC_ACCEPT'})).status,200);
  await fixture.runtime.coordinator.runOnce();
  const related=rows((await handler.get(path+'/responsibility')).value.conversations);assert.equal(related.length,1);const original=related[0];assert.ok(original);
  const sessionId=text(original.session_id),initialVersion=Number(original.session_row_version);assert.ok(Number.isSafeInteger(initialVersion)&&initialVersion>0);
  assert.equal((await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:initialVersion,reason_code:'T08_REAL_COMMUNICATION_OWNER'})).status,200);
  const before=(await admin.get(path)).value,responsibility=(await admin.get(path+'/responsibility')).value,source=rows(responsibility.conversations)[0];assert.ok(source);assert.equal(source.conversation_principal_id,fixture.handler);
  const history=rows((await admin.get(path+'/events')).value.items),deliveries=(await admin.get(path+'/deliveries')).value;
  const command={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_UNASSIGN',reason:'处理未开始，明确交接此服务主题沟通。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:fixture.otherHandler,sessions:[{session_id:sessionId,expected_row_version:Number(source.session_row_version)}]};
  const result=await admin.post(path+'/unassign',command);assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.communication_choice,'TRANSFER_SELECTED');const changed=rows(result.value.conversations);assert.equal(changed.length,1);assert.equal(changed[0]?.session_id,sessionId);assert.equal(changed[0]?.session_row_version,Number(source.session_row_version)+1);assert.equal(changed[0]?.changed,true);assert.equal(typeof changed[0]?.control_event_id,'string');
  const after=(await admin.get(path)).value,afterResponsibility=(await admin.get(path+'/responsibility')).value;assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.equal(after.version,3);assert.equal(after.handling_cycle??null,null);
  const current=rows(afterResponsibility.conversations)[0];assert.ok(current);assert.equal(current.conversation_principal_id,fixture.otherHandler);assert.equal(current.session_row_version,String(Number(source.session_row_version)+1));
  const events=rows((await admin.get(path+'/events')).value.items);assert.deepEqual(events.slice(0,-1),history);assert.equal(events.at(-1)?.event_type,'ticket.unassigned');assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
  const replay=await admin.post(path+'/unassign',command);assert.equal(replay.status,200,JSON.stringify(replay.value));assert.equal(replay.value.replayed,true);assert.equal(replay.value.ticket_event_id,result.value.ticket_event_id);assert.deepEqual(replay.value.conversations,result.value.conversations);
  assert.deepEqual((await admin.get(path+'/responsibility')).value,afterResponsibility);assert.deepEqual((await admin.get(path+'/events')).value.items,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
  assert.equal(object(replay.value).ticket_version,3);
 });
});
