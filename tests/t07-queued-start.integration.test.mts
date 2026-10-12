import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {acceptedSetup,acceptedOptions,rows,version} from './helpers/t07-public-fixture.mjs';
import type {T07Fixture} from './helpers/t07-public-fixture.mjs';
import {migrateTicketUnassign} from '../scripts/ticket-unassign-migrate.mjs';
import {createTicketUnassignService} from '../src/workbench-ticket-unassign.mjs';
import {createP2016TicketQuery} from '../src/p2-016-ticket-query.mjs';
test('a queued ticket with existing round and first promise uses one self takeover accept-start command without inventing another round or first notice',async()=>{
 await withWeb01Fixture(async(f:T07Fixture)=>{
  const s=await acceptedSetup(f);await migrateTicketUnassign({databaseUrl:f.databaseUrl,mode:'apply'});
  const query=createP2016TicketQuery({pool:f.pool,enabled:true,ticketUnassignEnabled:true}),unassign=createTicketUnassignService({pool:f.pool,query,enabled:true});
  const returned=await unassign.perform({authContext:{principal_id:s.owner.id},command:{action:'unassign',ticket_id:s.first.ticket.id,client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'WORKBENCH_UNASSIGN',reason:'合成暂缓安排',communication_choice:'RETAIN_CURRENT',communication_target_principal_id:null,sessions:[]}});assert.equal(returned.ok,true,JSON.stringify(returned));
  const released=await s.a.get(s.path);assert.equal(released.status,200);assert.equal(released.value.status,'QUEUED');assert.equal(released.value.assignee_id,null);
  const assigned=await s.a.post(s.path+'/assign',{client_command_id:randomUUID(),expected_version:version(released.value.version),reason_code:'WORKBENCH_ASSIGN',target_principal_id:s.owner.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200,JSON.stringify(assigned.value));
  const before=await s.b.get(s.path);assert.equal(before.status,200);assert.equal(before.value.status,'QUEUED');assert.deepEqual(before.value.handling_cycle,s.before.handling_cycle);const eventsBefore=await s.a.get(s.path+'/events'),prior=rows(eventsBefore.value.items);
  const command={client_command_id:randomUUID(),expected_version:version(before.value.version),reason_code:'WORKBENCH_TAKEOVER',resolver_team_id:'T07_NETWORK',communication_choice:'RETAIN_CURRENT',sessions:[]};
  const result=await s.b.post(s.path+'/takeover-and-start',command);assert.equal(result.status,200,JSON.stringify(result.value));
  const after=await s.b.get(s.path);assert.equal(after.status,200);assert.equal(after.value.status,'IN_PROGRESS');assert.equal(after.value.assignee_id,s.actor.id);assert.equal(after.value.resolver_team_id,'T07_NETWORK');assert.equal(after.value.version,version(before.value.version)+3);assert.deepEqual(after.value.handling_cycle,s.before.handling_cycle);assert.equal(after.value.intake_id,s.before.intake_id);
  const eventsAfter=await s.a.get(s.path+'/events'),events=rows(eventsAfter.value.items);assert.deepEqual(events.slice(0,prior.length),prior);assert.deepEqual(events.slice(prior.length).map(row=>[row.event_type,row.old_status,row.new_status]),[['ticket.assignment_transferred','QUEUED','QUEUED'],['ticket.accepted','QUEUED','ACCEPTED'],['ticket.started','ACCEPTED','IN_PROGRESS']]);assert.equal(result.value.ticket_event_id,events.at(-1)?.event_id);assert.deepEqual((await s.a.get(s.path+'/deliveries')).value,s.notices);assert.deepEqual((await s.a.get(s.path+'/responsibility')).value.conversations,s.communication.conversations);
  const replay=await s.b.post(s.path+'/takeover-and-start',command);assert.equal(replay.status,200);assert.deepEqual(replay.value,{...result.value,replayed:true});assert.deepEqual((await s.a.get(s.path+'/events')).value,eventsAfter.value);
 },{...acceptedOptions,ticketAssignmentEnabled:true});
});
