import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';

test('vendor wait and resume bind both real Actions to the same current cycle and responsibility',async()=>{
  await withT10Fixture(async context=>{
    const http=await t11Http(context,2),target=context.tickets[0];assert.ok(target);
    const original=await http.start(target.ticket.id);assert.ok(original.handling_cycle);
    const responsibility=await (await http.get('/api/tickets/'+target.ticket.id+'/responsibility')).json() as unknown;
    const deliveries=await (await http.get('/api/tickets/'+target.ticket.id+'/deliveries')).json() as unknown;
    for(const [action,state,eventType] of [['wait-vendor','WAITING_VENDOR','ticket.waiting_vendor'],['resume','IN_PROGRESS','ticket.resumed']] as const){
      const before=await http.detail(target.ticket.id);
      const command={client_command_id:randomUUID(),expected_version:before.version,reason_code:action==='resume'?'RESUME':'WAITING_VENDOR',note:'INTERNAL_T10_VENDOR_CANARY：供应商待核实、恢复处理。',external_visible:false};
      const response=await http.post(target.ticket.id,action,command);assert.equal(response.status,200);
      const result=await response.json() as {ticket_event_id:string;handling_cycle_id:string|null};
      assert.equal(result.handling_cycle_id,original.handling_cycle.id,'each waiting Action must return the authoritative existing cycle');
      const after=await http.detail(target.ticket.id);assert.equal(after.status,state);assert.equal(after.version,before.version+1);
      assert.equal(after.assignee_id,original.assignee_id);assert.equal(after.resolver_team_id,original.resolver_team_id);assert.deepEqual(after.handling_cycle,original.handling_cycle);
      assert.deepEqual(await (await http.get('/api/tickets/'+target.ticket.id+'/responsibility')).json(),responsibility);
      const events=await (await http.get('/api/tickets/'+target.ticket.id+'/events')).json() as {items:{event_id:string;event_type:string;handling_cycle_id:string|null}[]};
      assert.deepEqual(events.items.filter(event=>event.event_id===result.ticket_event_id).map(event=>({type:event.event_type,cycle:event.handling_cycle_id})),[{type:eventType,cycle:original.handling_cycle.id}]);
      assert.ok(!JSON.stringify({result,after,events}).includes('INTERNAL_T10_VENDOR_CANARY'));
      const replay=await http.post(target.ticket.id,action,command);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),{...result,replayed:true});
    }
    assert.deepEqual(await (await http.get('/api/tickets/'+target.ticket.id+'/deliveries')).json(),deliveries,'internal waiting reasons create no new external delivery');
  });
});
