import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {withT08Fixture,rows,text} from './helpers/t08-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';

test('independent bounded communication targets pin a permitted out-of-group recipient and still require a real explicit Control transfer',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),handler=await fixture.http(2),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId,access=createPilotAccessService({pool:fixture.pool});assert.equal((await handler.post(path+'/accept',{client_command_id:randomUUID(),expected_version:1,reason_code:'T08_REAL_ACCEPT'})).status,200);
  const target=await access.upsertPrincipal({wecomUserId:'t08-outside-group-'+randomUUID(),displayName:'ZZZ T08 独立沟通人',roles:['HANDLER'],resolverTeamIds:[]});assert.deepEqual(target.resolver_team_ids,[]);
  // Synthetic internal directory setup; no SQL responsibility command or target privilege is created.
  for(let index=0;index<100;index++)await access.upsertPrincipal({wecomUserId:'t08-bounded-'+randomUUID(),displayName:'AAA T08 '+String(index).padStart(3,'0'),roles:['HANDLER'],resolverTeamIds:[]});
  const before=(await admin.get(path)).value,events=(await admin.get(path+'/events')).value,deliveries=(await admin.get(path+'/deliveries')).value;
  const endpoint=path+'/unassign/communication-targets',base=await admin.get(endpoint);assert.equal(base.status,200,JSON.stringify(base.value));await assertP2016Schema('p2_016_unassign_targets',base.value);assert.equal(rows(base.value.items).length,100);assert.equal(rows(base.value.items).some(row=>row.principal_id===target.id),false);
  const selected=await admin.get(endpoint+'?target_principal_id='+target.id);assert.equal(selected.status,200,JSON.stringify(selected.value));await assertP2016Schema('p2_016_unassign_targets',selected.value);assert.equal(rows(selected.value.items).length,100);assert.deepEqual(rows(selected.value.items).find(row=>row.principal_id===target.id),{principal_id:target.id,display_name:target.display_name});
  assert.equal((await handler.get(endpoint)).status,403);assert.equal((await admin.get(endpoint+'?resolver_team_id=PILOT_IT')).status,400);assert.equal((await admin.get(endpoint+'?target_principal_id=invalid')).status,400);
  const reporter=await access.upsertPrincipal({wecomUserId:'t08-no-control-role-'+randomUUID(),displayName:'T08 合成报修人',roles:['REPORTER'],resolverTeamIds:[]});assert.equal((await admin.get(endpoint+'?target_principal_id='+reporter.id)).status,403);
  await fixture.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[target.id]);assert.equal((await admin.get(endpoint+'?target_principal_id='+target.id)).status,403);await fixture.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[target.id]);
  assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual((await admin.get(path+'/events')).value,events);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
  await fixture.runtime.coordinator.runOnce();const source=rows((await handler.get(path+'/responsibility')).value.conversations)[0];assert.ok(source);const sessionId=text(source.session_id);assert.equal((await handler.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(source.session_row_version),reason_code:'T08_REAL_COMMUNICATOR'})).status,200);
  const current=rows((await admin.get(path+'/related-conversations')).value.items)[0];assert.ok(current);assert.equal(current.take_allowed,true);
  const result=await admin.post(path+'/unassign',{client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_UNASSIGN',reason:'未开始的处理责任退回；明确交接沟通给获准人员。',communication_choice:'TRANSFER_SELECTED',communication_target_principal_id:target.id,sessions:[{session_id:sessionId,expected_row_version:Number(current.session_row_version)}]});assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(rows(result.value.conversations)[0]?.changed,true);
  const after=(await admin.get(path)).value;assert.equal(after.resolver_team_id,before.resolver_team_id);assert.equal(after.assignee_id,null);assert.equal(rows((await admin.get(path+'/responsibility')).value.conversations)[0]?.conversation_principal_id,target.id);assert.deepEqual((await admin.get(path+'/deliveries')).value,deliveries);
 });
});
