// Registered original current-segment boundary tracer; initially NOT_RUN. Real same-person group changes do not prove a new responsibility segment.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,object,rows,text} from './helpers/t08-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';

test('a truncated same-person responsibility chain fails closed rather than treating a group-only transfer as a new unstarted segment',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),ticket=await fixture.createTicket(),path='/api/tickets/'+ticket,secondGroup='T08_SYNTH_OTHER';
  // Synthetic directory fixture only; subsequent Ticket ownership/group/history are all real public commands.
  await fixture.pool.query('INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES($1,$2)',[secondGroup,'T08 合成第二处理组']);
  const identity=(await fixture.pool.query<{wecom_user_id:string;display_name:string}>('SELECT wecom_user_id,display_name FROM pilot_ticket.pilot_principal WHERE id=$1::uuid',[fixture.handler])).rows[0];assert.ok(identity);
  const member=await createPilotAccessService({pool:fixture.pool}).upsertPrincipal({wecomUserId:identity.wecom_user_id,displayName:identity.display_name,roles:['HANDLER'],resolverTeamIds:['PILOT_IT',secondGroup]});assert.equal(member.id,fixture.handler);
  const assignment=(version:number,group:string)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'T08_REAL_GROUP_CHAIN',target_principal_id:fixture.handler,
   resolver_team_id:group,communication_choice:'RETAIN_CURRENT',sessions:[]});
  const initial=await admin.post(path+'/assign',assignment(1,'PILOT_IT'));assert.equal(initial.status,200,JSON.stringify(initial.value));
  const cycle=object((await admin.get(path)).value.handling_cycle);assert.equal(cycle.first_responsibility_event_id,initial.value.ticket_event_id);
  let version=2,group='PILOT_IT';for(let index=0;index<200;index++){group=group==='PILOT_IT'?secondGroup:'PILOT_IT';
   const changed=await admin.post(path+'/transfer-assignment',assignment(version,group));assert.equal(changed.status,200,'real group-only transfer '+index+': '+JSON.stringify(changed.value));version++;
   assert.equal(changed.value.ticket_version,version);assert.deepEqual(changed.value.handling_cycle,cycle);}
  const before=(await admin.get(path)).value;assert.equal(before.status,'QUEUED');assert.equal(before.assignee_id,fixture.handler);assert.equal(before.version,202);assert.equal(before.resolver_team_id,group);
  assert.ok(Array.isArray(before.allowed_actions));assert.equal(before.allowed_actions.includes('unassign'),false);
  const history=async()=>{const first=await admin.get(path+'/events?limit=200');assert.equal(first.status,200);const cursor=text(first.value.next_cursor),last=await admin.get(path+'/events?limit=200&cursor='+encodeURIComponent(cursor));assert.equal(last.status,200);assert.equal(last.value.next_cursor,null);return [...rows(first.value.items),...rows(last.value.items)];};
  const events=await history();assert.equal(events.filter(event=>event.event_type==='ticket.assignment_transferred').length,201);
  assert.equal(events.some(event=>['ticket.started','ticket.waiting_requester','ticket.waiting_vendor','ticket.resumed'].includes(text(event.event_type))),false);
  const delivery=(await admin.get(path+'/deliveries')).value,responsibility=(await admin.get(path+'/responsibility')).value;
  const body={client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_UNASSIGN',reason:'历史截断不能推测责任段未开始',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]};
  const rejected=await admin.post(path+'/unassign',body);assert.equal(rejected.status,409);assert.equal(object(rejected.value.error).code,'P2_016_UNASSIGN_STATE_CONFLICT');
  assert.deepEqual((await admin.get(path)).value,before);assert.deepEqual(await history(),events);assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);assert.deepEqual((await admin.get(path+'/responsibility')).value,responsibility);
  const replay=await admin.post(path+'/unassign',body);assert.equal(replay.status,409);assert.deepEqual(replay.value,rejected.value);assert.deepEqual(await history(),events);
 },{ticketAssignmentEnabled:true});
});
