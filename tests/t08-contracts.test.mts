// Registered original T08 contract/defaults tracer; initially NOT_RUN.
// Keep the public helper's original failure visible before extending its existing vocabulary.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeTicketUnassignCommand} from '../app/server/src/workbench-ticket-unassign.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import {withT08Fixture,object,rows,text} from './helpers/t08-fixture.mjs';

const retain=(version:number,reason='仅内部保存的合成撤派原因')=>({client_command_id:randomUUID(),expected_version:version,
 reason_code:'WORKBENCH_UNASSIGN',reason,communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});

test('the published closed unassign command uses the public schema helper for local refs and conditional selection bounds',async()=>{
 const body=retain(2),session={session_id:randomUUID(),expected_row_version:1};
 // Existing helper tries to load #/$defs/uuid as a filename. First observe that native helper layer;
 // do not skip, flatten the schema, suppress the error or substitute another validator.
 await assertP2016Schema('p2_016_unassign_command',body);
 const selected={...body,communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:randomUUID(),sessions:[session]};
 await assertP2016Schema('p2_016_unassign_command',selected);
 await assertP2016Schema('p2_016_unassign_command',{...selected,sessions:Array.from({length:8},()=>({session_id:randomUUID(),expected_row_version:1}))});
 for(const invalid of [
  {...body,external_visible:true},{...body,actor:randomUUID()},{...body,expected_version:'2'},
  {...body,reason:'   '},{...body,communication_target_principal_id:randomUUID()},{...body,sessions:[session]},
  {...selected,communication_target_principal_id:null},{...selected,sessions:[]},
  {...selected,sessions:Array.from({length:9},()=>({session_id:randomUUID(),expected_row_version:1}))},
 ])await assert.rejects(assertP2016Schema('p2_016_unassign_command',invalid));
 // Canonical uniqueness is a runtime contract; its x-annotation is not a JSON Schema keyword.
});

test('unassign normalization keeps the explicit selected intent, checks original reason length and returns a detached frozen snapshot',()=>{
 const ticket=randomUUID(),command=randomUUID(),target=randomUUID(),session=randomUUID();
 const input={...retain(2147483647,'  明确内部原因  '),action:'unassign',ticket_id:ticket.toUpperCase(),client_command_id:command.toUpperCase(),
  communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:target.toUpperCase(),sessions:[{session_id:session.toUpperCase(),expected_row_version:2147483647}]};
 const normalized=normalizeTicketUnassignCommand(input);
 assert.equal(normalized.ticket_id,ticket);assert.equal(normalized.client_command_id,command);assert.equal(normalized.communication_target_principal_id,target);
 assert.equal(normalized.reason,'明确内部原因');assert.equal(input.reason,'  明确内部原因  ');
 assert.deepEqual(normalized.sessions,[{session_id:session,expected_row_version:2147483647}]);
 assert.equal(Object.isFrozen(normalized),true);assert.equal(Object.isFrozen(normalized.sessions),true);assert.equal(Object.isFrozen(normalized.sessions[0]),true);
 const original=input.sessions[0];assert.ok(original);original.expected_row_version=9;input.reason='后来输入';
 assert.equal(normalized.sessions[0]?.expected_row_version,2147483647);assert.equal(normalized.reason,'明确内部原因');
 const bounded=normalizeTicketUnassignCommand({...input,reason:'a'.repeat(2000),sessions:Array.from({length:8},()=>({session_id:randomUUID(),expected_row_version:1}))});
 assert.equal(bounded.reason.length,2000);assert.equal(bounded.sessions.length,8);
 const retained=normalizeTicketUnassignCommand({...retain(1),action:'unassign',ticket_id:ticket});
 assert.equal(retained.communication_choice,'RETAIN_CURRENT');assert.equal(retained.communication_target_principal_id,null);assert.deepEqual(retained.sessions,[]);
});

test('unassign normalization refuses implicit communication, canonical duplicates and extra external or identity fields',()=>{
 const input={...retain(2),action:'unassign',ticket_id:randomUUID()},session=randomUUID();
 const selected={...input,communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:randomUUID(),sessions:[{session_id:session,expected_row_version:1}]};
 for(const invalid of [
  {...input,reason:''},{...input,reason:' \t\n '},{...input,reason:' '+ 'a'.repeat(1999)+' '},
  {...input,expected_version:0},{...input,expected_version:2147483648},{...input,expected_version:'2'},
  {...input,external_note:'不能外发'},{...input,external_visible:true},{...input,operator_id:randomUUID()},
  {...input,communication_target_principal_id:randomUUID()},{...input,sessions:selected.sessions},
  {...selected,communication_target_principal_id:null},{...selected,sessions:[]},
  {...selected,sessions:[{session_id:session,expected_row_version:1},{session_id:session.toUpperCase(),expected_row_version:1}]},
  {...selected,sessions:[{session_id:session,expected_row_version:'1'}]},
  {...selected,sessions:Array.from({length:9},()=>({session_id:randomUUID(),expected_row_version:1}))},
 ])assert.throws(()=>normalizeTicketUnassignCommand(invalid),{code:'P2_016_INPUT_INVALID'});
});

test('real legacy Ticket detail, retained POST, all safe ACK states and the private event obey their published contracts',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),dispatcher=await fixture.http(1),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const bootstrap=await admin.get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
  assert.equal(bootstrap.value.ticket_unassign_enabled,true);assert.equal(bootstrap.value.ticket_unassign_draft_recovery_enabled,false);
  assert.equal(bootstrap.value.ticket_assignment_enabled,false);assert.equal(bootstrap.value.ticket_conversation_self_handling_enabled,false);
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_CONTRACT_REAL_ACCEPT'})).status,200);
  const before=await admin.get(path);assert.equal(before.status,200);await assertP2016Schema('p2_016_ticket_detail',before.value);
  assert.equal(before.value.status,'ACCEPTED');assert.equal(before.value.assignee_id,fixture.handler);assert.equal(before.value.version,2);
  assert.ok(Array.isArray(before.value.allowed_actions)&&before.value.allowed_actions.includes('unassign'));
  const history=rows((await admin.get(path+'/events?limit=200')).value.items),delivery=(await admin.get(path+'/deliveries')).value;
  const body=retain(2,'  T08 契约私有原因 '+randomUUID()+'  '),reply=await admin.post(path+'/unassign',body);
  assert.equal(reply.status,200,JSON.stringify(reply.value));await assertP2016Schema('p2_016_unassign_result',reply.value);
  assert.equal(reply.value.ticket_id,ticketId);assert.equal(reply.value.ticket_version,3);assert.equal(reply.value.handling_cycle,null);assert.deepEqual(reply.value.conversations,[]);
  assert.equal(reply.value.communication_choice,'RETAIN_CURRENT');assert.equal(reply.value.control_event_id,null);assert.equal(reply.value.replayed,false);
  const after=await admin.get(path);assert.equal(after.status,200);await assertP2016Schema('p2_016_ticket_detail',after.value);
  assert.equal(after.value.status,'QUEUED');assert.equal(after.value.assignee_id,null);assert.equal(after.value.version,3);assert.equal(after.value.resolver_team_id,before.value.resolver_team_id);
  assert.equal(after.value.intake_id,before.value.intake_id);assert.equal(after.value.handling_cycle??null,null);
  const ackPath=path+'/unassign/commands/'+body.client_command_id,ack=await admin.get(ackPath);assert.equal(ack.status,200);
  await assertP2016Schema('p2_016_assignment_receipt',ack.value);
  assert.deepEqual(ack.value,{state:'COMMITTED',ticket_id:ticketId,ticket_version:3,ticket_event_id:reply.value.ticket_event_id});
  for(const response of [await dispatcher.get(ackPath),await admin.get(path+'/unassign/commands/'+randomUUID())]){
   assert.equal(response.status,200);await assertP2016Schema('p2_016_assignment_receipt',response.value);assert.deepEqual(response.value,{state:'UNKNOWN'});
  }
  const refused=retain(3),failure=await admin.post(path+'/unassign',refused);assert.equal(failure.status,409);
  const failedAck=await admin.get(path+'/unassign/commands/'+refused.client_command_id);assert.equal(failedAck.status,200);
  await assertP2016Schema('p2_016_assignment_receipt',failedAck.value);assert.deepEqual(failedAck.value,{state:'FAILED',error:{code:'P2_016_UNASSIGN_STATE_CONFLICT',retryable:false}});
  const events=rows((await admin.get(path+'/events?limit=200')).value.items);assert.deepEqual(events.slice(0,-1),history);assert.equal(events.at(-1)?.event_type,'ticket.unassigned');
  assert.equal(events.at(-1)?.has_internal_note,true);assert.equal(events.at(-1)?.has_external_note,false);assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);
  // Explicit private readback only in the fresh synthetic fixture. It does not perform a business command.
  const persisted=await fixture.pool.query(`SELECT event_id::text,ticket_id::text,event_type,old_status,new_status,aggregate_version,event_ordinal,
   operator_type,operator_id,internal_note,external_note,reason_code,assignment_metadata,trace_id,created_at::text AS created_at
   FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_id=$2::uuid`,[ticketId,text(reply.value.ticket_event_id)]);
  assert.equal(persisted.rowCount,1);const fact=object(persisted.rows[0]);await assertP2016Schema('p2_016_unassign_event',fact);
  assert.equal(fact.internal_note,body.reason.trim());assert.equal(fact.external_note,null);assert.equal(fact.operator_id,fixture.admin);
  assert.deepEqual(fact.assignment_metadata,{old_assignee_id:fixture.handler,new_assignee_id:null,old_team_id:before.value.resolver_team_id,new_team_id:before.value.resolver_team_id});
  const web=await admin.get('/api/workbench/items/ticket/'+ticketId+'?limit=100');assert.equal(web.status,200);
  assert.ok(rows(web.value.records).some(record=>record.audience==='INTERNAL'&&record.text===body.reason.trim()));
  assert.equal(JSON.stringify(rows(web.value.records).filter(record=>record.audience==='EXTERNAL')).includes(body.reason.trim()),false);
  assert.equal(JSON.stringify({reply:reply.value,ack:ack.value,events,delivery}).includes(body.reason.trim()),false);
  for(const invalid of [{...reply.value,reason:body.reason},{...reply.value,communication_choice:'TRANSFER_SELECTED'},
   {...reply.value,conversations:[{session_id:randomUUID(),session_row_version:1,control_event_id:null,changed:false}]}])await assert.rejects(assertP2016Schema('p2_016_unassign_result',invalid));
  await assert.rejects(assertP2016Schema('p2_016_assignment_receipt',{...ack.value,sessions:[]}));
  await assert.rejects(assertP2016Schema('p2_016_unassign_event',{...fact,external_note:'禁止外发'}));
  await assert.rejects(assertP2016Schema('p2_016_unassign_event',{...fact,assignment_metadata:{...object(fact.assignment_metadata),new_assignee_id:fixture.otherHandler}}));
 });
});

test('the selected result contract covers only the explicitly submitted canonical Session and its real Control event',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_CONTRACT_SELECTED_ACCEPT'})).status,200);
  await fixture.runtime.coordinator.runOnce();const source=rows((await handler.get(path+'/responsibility')).value.conversations)[0];assert.ok(source);
  const sessionId=text(source.session_id);assert.equal((await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(source.session_row_version),reason_code:'T08_CONTRACT_CONTROL'})).status,200);
  const row=rows((await admin.get(path+'/related-conversations')).value.items).find(row=>row.session_id===sessionId);assert.ok(row);
  const body={...retain(2),communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:fixture.otherHandler,sessions:[{session_id:sessionId,expected_row_version:Number(row.session_row_version)}]};
  await assertP2016Schema('p2_016_unassign_command',body);const reply=await admin.post(path+'/unassign',body);assert.equal(reply.status,200,JSON.stringify(reply.value));
  await assertP2016Schema('p2_016_unassign_result',reply.value);const changed=rows(reply.value.conversations);assert.equal(changed.length,1);
  assert.equal(changed[0]?.session_id,sessionId);assert.equal(changed[0]?.changed,true);assert.equal(changed[0]?.session_row_version,Number(row.session_row_version)+1);assert.match(text(changed[0]?.control_event_id),/^[0-9a-f-]{36}$/u);
  const responsibility=await admin.get(path+'/responsibility');assert.equal(responsibility.status,200);
  assert.equal(rows(responsibility.value.conversations).find(row=>row.session_id===sessionId)?.conversation_principal_id,fixture.otherHandler);
  const ack=await admin.get(path+'/unassign/commands/'+body.client_command_id);assert.equal(ack.status,200);await assertP2016Schema('p2_016_assignment_receipt',ack.value);
  assert.deepEqual(Object.keys(ack.value).sort(),['state','ticket_event_id','ticket_id','ticket_version']);
  await assert.rejects(assertP2016Schema('p2_016_unassign_result',{...reply.value,conversations:[]}));
 });
});
