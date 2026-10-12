import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';

test('waiting for the Reporter preserves current responsibility and binds its real Action to the existing handling cycle',async()=>{
  await withT10Fixture(async context=>{
    const http=await t11Http(context),target=context.tickets[0];assert.ok(target);
    const current=await http.start(target.ticket.id);assert.ok(current.handling_cycle);
    const responsibility=await (await http.get('/api/tickets/'+target.ticket.id+'/responsibility')).json() as unknown;
    const command={client_command_id:randomUUID(),expected_version:current.version,reason_code:'WAITING_REPORTER',note:'INTERNAL_T10_CANARY：等待报修人补充故障现象。',external_visible:false};
    const response=await http.post(target.ticket.id,'request-information',command);assert.equal(response.status,200);
    const result=await response.json() as {ticket_event_id:string;handling_cycle_id:string|null};
    assert.equal(result.handling_cycle_id,current.handling_cycle.id,'the committed waiting Action must retain the actual T04 cycle');
    const after=await http.detail(target.ticket.id);assert.equal(after.status,'WAITING_REQUESTER');assert.equal(after.version,current.version+1);
    assert.equal(after.assignee_id,current.assignee_id);assert.equal(after.resolver_team_id,current.resolver_team_id);assert.deepEqual(after.handling_cycle,current.handling_cycle);
    assert.deepEqual(await (await http.get('/api/tickets/'+target.ticket.id+'/responsibility')).json(),responsibility);
    const events=await (await http.get('/api/tickets/'+target.ticket.id+'/events')).json() as {items:{event_id:string;event_type:string;handling_cycle_id:string|null}[]};
    assert.deepEqual(events.items.filter(event=>event.event_id===result.ticket_event_id).map(event=>({type:event.event_type,cycle:event.handling_cycle_id})),[{type:'ticket.waiting_requester',cycle:current.handling_cycle.id}]);
  });
});
