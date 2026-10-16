import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,rows,text} from './helpers/t08-fixture.mjs';
test('a JSON array communication choice is refused before changing the authorized Ticket or its genuinely selected Session',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_PUBLIC_ACCEPT'})).status,200);
  await fixture.runtime.coordinator.runOnce();const first=rows((await handler.get(path+'/responsibility')).value.conversations)[0];assert.ok(first);
  const sessionId=text(first.session_id);assert.equal((await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(first.session_row_version),reason_code:'T08_REAL_COMMUNICATION_OWNER'})).status,200);
  const before=(await admin.get(path)).value,responsibility=(await admin.get(path+'/responsibility')).value,source=rows(responsibility.conversations)[0];assert.ok(source);assert.equal(source.conversation_principal_id,fixture.handler);
  const events=(await admin.get(path+'/events')).value,deliveries=(await admin.get(path+'/deliveries')).value;
  const valid={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_UNASSIGN',reason:'闭合类型验证，同一合法选择保持不变。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:fixture.otherHandler,sessions:[{session_id:sessionId,expected_row_version:Number(source.session_row_version)}]};
  const refused=await admin.post(path+'/unassign',{...valid,communication_choice:['TRANSFER_SELECTED']});assert.equal(refused.status,400,JSON.stringify(refused.value));
  assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual((await admin.get(path+'/responsibility')).value,responsibility);assert.deepEqual((await admin.get(path+'/events')).value,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
 });
});
