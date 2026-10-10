import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT08Fixture,rows,object,text} from './helpers/t08-fixture.mjs';

test('a genuine current unstarted assignment remains withdrawable after 200 real QUEUED person transfers without scanning older history',async()=>{
 await withT08Fixture(async fixture=>{
  const admin=await fixture.http(0),ticketId=await fixture.createTicket(),path='/api/tickets/'+ticketId;
  const assignment=(target:string,version:number)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'T08_REAL_CURRENT_SEGMENT',target_principal_id:target,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
  const first=await admin.post(path+'/assign',assignment(fixture.handler,1));assert.equal(first.status,200,JSON.stringify(first.value));assert.equal(first.value.ticket_version,2);
  const basis=object((await admin.get(path)).value.handling_cycle);assert.equal(basis.cycle_no,1);assert.equal(basis.first_responsibility_event_id,first.value.ticket_event_id);
  let owner=fixture.handler,version=2;
  for(let index=0;index<200;index++){
   owner=owner===fixture.handler?fixture.otherHandler:fixture.handler;
   const transferred=await admin.post(path+'/transfer-assignment',assignment(owner,version));assert.equal(transferred.status,200,'real transfer '+index+': '+JSON.stringify(transferred.value));version++;
   assert.equal(transferred.value.ticket_version,version);assert.deepEqual(transferred.value.handling_cycle,basis);
  }
  const before=(await admin.get(path)).value;assert.equal(before.status,'QUEUED');assert.equal(before.assignee_id,owner);assert.equal(before.version,202);assert.deepEqual(before.handling_cycle,basis);
  const history=async()=>{const firstPage=await admin.get(path+'/events?limit=200');assert.equal(firstPage.status,200);const next=text(firstPage.value.next_cursor);const secondPage=await admin.get(path+'/events?limit=200&cursor='+encodeURIComponent(next));assert.equal(secondPage.status,200);assert.equal(secondPage.value.next_cursor,null);return [...rows(firstPage.value.items),...rows(secondPage.value.items)];};
  const events=await history();assert.equal(events.filter(event=>event.event_type==='ticket.assignment_transferred').length,201);assert.equal(events.some(event=>['ticket.started','ticket.waiting_requester','ticket.waiting_vendor','ticket.resumed'].includes(text(event.event_type))),false);
  const delivery=(await admin.get(path+'/deliveries')).value,responsibility=(await admin.get(path+'/responsibility')).value;
  const withdrawn=await admin.post(path+'/unassign',{client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_UNASSIGN',reason:'当前最新处理责任尚未开始，交回重新安排。',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]});
  assert.equal(withdrawn.status,200,JSON.stringify(withdrawn.value));assert.equal(withdrawn.value.ticket_version,203);
  const after=(await admin.get(path)).value;assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,null);assert.equal(after.resolver_team_id,before.resolver_team_id);assert.equal(after.intake_id,before.intake_id);assert.deepEqual(after.handling_cycle,basis);
  const all=await history();assert.deepEqual(all.slice(0,-1),events);assert.equal(all.at(-1)?.event_type,'ticket.unassigned');assert.equal(all.at(-1)?.event_id,withdrawn.value.ticket_event_id);
  assert.deepEqual((await admin.get(path+'/deliveries')).value,delivery);const current=(await admin.get(path+'/responsibility')).value;assert.deepEqual(current.conversations,responsibility.conversations);
 },{ticketAssignmentEnabled:true});
});
