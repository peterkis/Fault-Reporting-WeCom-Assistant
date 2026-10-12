import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {acceptedSetup,acceptedOptions,object,rows,version} from './helpers/t07-public-fixture.mjs';
import type {T07Fixture} from './helpers/t07-public-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
test('one public accepted takeover-and-start command atomically changes self responsibility and starts in the original handling round without duplicating its first promise',async()=>{
 await withWeb01Fixture(async(f:T07Fixture)=>{
  const s=await acceptedSetup(f),command={client_command_id:randomUUID(),expected_version:version(s.before.version),reason_code:'WORKBENCH_TAKEOVER',resolver_team_id:'T07_NETWORK',communication_choice:'RETAIN_CURRENT',sessions:[]};
  const result=await s.b.post(s.path+'/takeover-and-start',command);assert.equal(result.status,200,JSON.stringify(result.value));await assertP2016Schema('p2_016_takeover_result',result.value);
  const after=await s.b.get(s.path);assert.equal(after.status,200);assert.equal(after.value.status,'IN_PROGRESS');assert.equal(after.value.assignee_id,s.actor.id);assert.equal(after.value.resolver_team_id,'T07_NETWORK');assert.equal(after.value.version,version(s.before.version)+2);assert.equal(after.value.intake_id,s.before.intake_id);assert.deepEqual(after.value.handling_cycle,s.before.handling_cycle);assert.deepEqual(result.value.handling_cycle,s.before.handling_cycle);assert.equal(typeof object(result.value.handling_cycle).first_responsibility_event_id,'string');
  const events=await s.a.get(s.path+'/events'),prior=rows(s.events.items),current=rows(events.value.items);assert.equal(events.status,200);assert.deepEqual(current.slice(0,prior.length),prior);assert.deepEqual(current.slice(prior.length).map(row=>row.event_type),['ticket.assignment_transferred','ticket.started']);assert.equal(result.value.ticket_event_id,current.at(-1)?.event_id);assert.equal(result.value.ticket_version,after.value.version);
  assert.deepEqual((await s.a.get(s.path+'/deliveries')).value,s.notices);assert.deepEqual((await s.a.get(s.path+'/responsibility')).value.conversations,s.communication.conversations);
  const replay=await s.b.post(s.path+'/takeover-and-start',command);assert.equal(replay.status,200);assert.deepEqual(replay.value,{...result.value,replayed:true});assert.deepEqual((await s.b.get(s.path)).value,after.value);assert.deepEqual((await s.a.get(s.path+'/events')).value,events.value);
 },acceptedOptions);
});
