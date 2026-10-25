import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import {http,rows,version} from './helpers/t07-public-fixture.mjs';
import type {T07Fixture} from './helpers/t07-public-fixture.mjs';
test('self takeover preserves lawful active states and nullable historical cycles while rejecting ownerless, reopened, terminal, no-op and illegal starts',async()=>{
 await withWeb01Fixture(async(f:T07Fixture)=>{
  const actor=f.principals[1];assert.ok(actor);
  await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T07_NETWORK','合成网络处理组')");
  assert.equal((await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['HANDLER'],resolverTeamIds:['PILOT_IT','T07_NETWORK']})).id,actor.id);
  const a=await http(f,0),b=await http(f,2);
  for(const index of [0,1,2,9,12]){
   const ticket=f.tickets[index];assert.ok(ticket);const path='/api/tickets/'+ticket.ticket.id,before=await b.get(path),events=await a.get(path+'/events');assert.equal(before.status,200);
   for(const action of ['takeover','takeover-and-start']){const rejected=await b.post(path+'/'+action,{client_command_id:randomUUID(),expected_version:version(before.value.version),reason_code:'WORKBENCH_TAKEOVER',resolver_team_id:'T07_NETWORK',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(rejected.status,409);}
   assert.deepEqual((await b.get(path)).value,before.value);assert.deepEqual((await a.get(path+'/events')).value,events.value);
  }
  for(const index of [3,5,6,7,8]){
   const ticket=f.tickets[index];assert.ok(ticket);const path='/api/tickets/'+ticket.ticket.id,before=await b.get(path),events=await a.get(path+'/events'),notices=await a.get(path+'/deliveries');assert.equal(before.status,200);
   const command={client_command_id:randomUUID(),expected_version:version(before.value.version),reason_code:'WORKBENCH_TAKEOVER',resolver_team_id:'T07_NETWORK',communication_choice:'RETAIN_CURRENT',sessions:[]};
   const invalidStart=await b.post(path+'/takeover-and-start',command);assert.equal(invalidStart.status,409);assert.deepEqual((await b.get(path)).value,before.value);
   const result=await b.post(path+'/takeover',{...command,client_command_id:randomUUID()});assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.handling_cycle,null);
   const after=await b.get(path);assert.equal(after.value.status,before.value.status);assert.equal(after.value.version,version(before.value.version)+1);assert.equal(after.value.assignee_id,actor.id);assert.equal(after.value.resolver_team_id,'T07_NETWORK');assert.equal(after.value.intake_id,before.value.intake_id);
   const current=await a.get(path+'/events'),prior=rows(events.value.items),all=rows(current.value.items);assert.deepEqual(all.slice(0,prior.length),prior);assert.equal(all.length,prior.length+1);assert.equal(all.at(-1)?.event_type,'ticket.assignment_transferred');assert.equal(all.at(-1)?.old_status,before.value.status);assert.equal(all.at(-1)?.new_status,before.value.status);assert.deepEqual((await a.get(path+'/deliveries')).value,notices.value);
   const physical=await f.pool.query<{old_assignee:string|null;new_assignee:string;old_team:string;new_team:string}>(`SELECT assignment_metadata->>'old_assignee_id' AS old_assignee,assignment_metadata->>'new_assignee_id' AS new_assignee,assignment_metadata->>'old_team_id' AS old_team,assignment_metadata->>'new_team_id' AS new_team FROM pilot_ticket.ticket_event WHERE event_id=$1::uuid`,[result.value.ticket_event_id]);assert.deepEqual(physical.rows,[{old_assignee:before.value.assignee_id,new_assignee:actor.id,old_team:'PILOT_IT',new_team:'T07_NETWORK'}]);
   assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid',[ticket.ticket.id])).rowCount,0,'nullable historical cycle is preserved, never backfilled');
   const noop=await b.post(path+'/takeover',{...command,client_command_id:randomUUID(),expected_version:version(after.value.version)});assert.equal(noop.status,409);assert.deepEqual((await b.get(path)).value,after.value);assert.deepEqual((await a.get(path+'/events')).value,current.value);
  }
 },{ticketTakeoverEnabled:true,chronologicalTicketEvents:true});
});
