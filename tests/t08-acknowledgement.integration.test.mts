import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,rows,text} from './helpers/t08-fixture.mjs';

test('a real selected withdrawal has a minimal purpose-and-principal-bound GET acknowledgement without enabling sensitive draft storage',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),dispatcher=await fixture.http(1),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  assert.equal((await admin.get('/api/lifecycle/bootstrap')).value.ticket_unassign_draft_recovery_enabled,false);
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_REAL_ACCEPT'})).status,200);await fixture.runtime.coordinator.runOnce();
  const source=rows((await handler.get(path+'/responsibility')).value.conversations)[0];assert.ok(source);const sessionId=text(source.session_id);assert.equal((await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(source.session_row_version),reason_code:'T08_REAL_COMMUNICATOR'})).status,200);
  const current=rows((await admin.get(path+'/related-conversations')).value.items)[0];assert.ok(current);const body={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_UNASSIGN',reason:'此原因只在内部保留；最小ACK不得含有正文或Session。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:fixture.otherHandler,sessions:[{session_id:sessionId,expected_row_version:Number(current.session_row_version)}]};
  const committed=await admin.post(path+'/unassign',body);assert.equal(committed.status,200,JSON.stringify(committed.value));assert.equal(rows(committed.value.conversations)[0]?.changed,true);
  const before=(await admin.get(path+'/events')).value,deliveries=(await admin.get(path+'/deliveries')).value,responsibility=(await admin.get(path+'/responsibility')).value,ackPath=path+'/unassign/commands/'+body.client_command_id;
  const ack=await admin.get(ackPath);assert.equal(ack.status,200,JSON.stringify(ack.value));assert.deepEqual(ack.value,{state:'COMMITTED',ticket_id:ticketId,ticket_version:3,ticket_event_id:committed.value.ticket_event_id});
  assert.deepEqual((await dispatcher.get(ackPath)).value,{state:'UNKNOWN'});assert.deepEqual((await admin.get(path+'/unassign/commands/'+randomUUID())).value,{state:'UNKNOWN'});
  const otherTicket=await fixture.createTicket(),other='/api/tickets/'+otherTicket,oldId=randomUUID();assert.equal((await admin.post(other+'/accept',{client_command_id:oldId,expected_version:1,reason_code:'T08_OTHER_RECEIPT_PURPOSE'})).status,200);assert.deepEqual((await admin.get(other+'/unassign/commands/'+oldId)).value,{state:'UNKNOWN'});assert.deepEqual((await admin.get(other+'/unassign/commands/'+body.client_command_id)).value,{state:'UNKNOWN'});
  assert.equal((await admin.get(ackPath+'?body=forbidden')).status,400);
  assert.deepEqual((await admin.get(path+'/events')).value,before);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);assert.deepEqual((await admin.get(path+'/responsibility')).value,responsibility);
 });
});
