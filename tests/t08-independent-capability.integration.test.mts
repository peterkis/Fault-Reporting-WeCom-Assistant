import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,rows} from './helpers/t08-fixture.mjs';
test('unassign is an independent current capability and permits a proven legacy acceptance without inventing a handling round',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const bootstrap=(await admin.get('/api/lifecycle/bootstrap')).value;
  assert.equal(bootstrap.ticket_assignment_enabled,false);assert.equal(bootstrap.ticket_conversation_self_handling_enabled,false);assert.equal(bootstrap.ticket_unassign_enabled,true);assert.equal(bootstrap.ticket_unassign_draft_recovery_enabled,false);
  assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_LEGACY_PUBLIC_ACCEPT'})).status,200);
  const before=(await admin.get(path)).value;assert.equal(before.status,'ACCEPTED');assert.equal(before.assignee_id,fixture.handler);assert.ok(Array.isArray(before.allowed_actions));assert.ok(before.allowed_actions.includes('unassign'));assert.equal((await handler.get(path)).value.allowed_actions instanceof Array,true);assert.equal(((await handler.get(path)).value.allowed_actions as unknown[]).includes('unassign'),false);
  const history=rows((await admin.get(path+'/events')).value.items),deliveries=(await admin.get(path+'/deliveries')).value;
  const withdrawn=await admin.post(path+'/unassign',{client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_UNASSIGN',reason:'保留真实旧接单历史，重新安排。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});assert.equal(withdrawn.status,200,JSON.stringify(withdrawn.value));assert.equal(withdrawn.value.handling_cycle,null);
  const after=(await admin.get(path)).value;assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.equal(after.version,3);assert.equal(after.handling_cycle??null,null);
  const events=rows((await admin.get(path+'/events')).value.items);assert.deepEqual(events.slice(0,-1),history);assert.equal(events.at(-1)?.event_type,'ticket.unassigned');assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
 });
});
