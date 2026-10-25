// SOURCE_ONLY_NOT_RUN. First public T26 tracer; preserve this original body and 240000 ms budget.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';

function record(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
async function deliveries(http:Awaited<ReturnType<typeof t11Http>>,ticketId:string){
  const response=await http.get('/api/tickets/'+ticketId+'/deliveries');
  assert.equal(response.status,200);
  const result:unknown=await response.json();assert.ok(record(result));
  const items:unknown=result.items;assert.ok(Array.isArray(items));
  return items.map((item:unknown)=>{assert.ok(record(item));return item;});
}

test('group-origin first responsibility exposes two independent original routes and replay preserves both Delivery identities',{timeout:240000},async()=>{
  await withT24Fixture(async context=>{
    // Only initial synthetic inbound/Intake facts use the existing fixture. Ticket, cycle,
    // event, notification intent and Delivery states must come from the public modules.
    const intake=await seedPersistedIntake({pool:context.pool,text:'T26_ORIGINAL_GROUP_PRIVATE_MATERIAL',chatType:'group',requestType:'INCIDENT',status:'RECEIVED',tag:'t26-first-original'});
    const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'t26-original-group'});
    assert.ok(created.ticket);const ticketId=created.ticket.id;
    const http=await t11Http(context);
    assert.deepEqual(await deliveries(http,ticketId),[]);
    const started=await http.start(ticketId);
    assert.equal(started.status,'IN_PROGRESS');
    assert.ok(started.handling_cycle?.first_responsibility_event_id);
    await context.runtime.roundNotifications.runOnce();
    const first=await deliveries(http,ticketId);
    assert.deepEqual(first.map(item=>({node:item.node,cycle_no:item.cycle_no,route:item.destination_type,status:item.status,side_effect_state:item.side_effect_state,attempt_count:item.attempt_count})).sort((a,b)=>String(a.route).localeCompare(String(b.route))),[
      {node:'FIRST_RESPONSIBILITY',cycle_no:1,route:'GROUP',status:'PENDING',side_effect_state:'NOT_ATTEMPTED',attempt_count:0},
      {node:'FIRST_RESPONSIBILITY',cycle_no:1,route:'PERSON',status:'PENDING',side_effect_state:'NOT_ATTEMPTED',attempt_count:0},
    ],'ADR-0023 requires original-group push and original-Bot personal intent independently');
    const ids=first.map(item=>{assert.equal(typeof item.delivery_id,'string');return item.delivery_id;});
    assert.equal(new Set(ids).size,2);
    await context.runtime.roundNotifications.runOnce();
    assert.deepEqual(await deliveries(http,ticketId),first,'replay must retain both existing route identities');
    assert.deepEqual(await http.detail(ticketId),started,'notification consumption cannot rewrite Ticket facts');
    const outsider=await t11Http(context,1);
    assert.equal((await outsider.get('/api/tickets/'+ticketId+'/deliveries')).status,404);
    const visible=JSON.stringify(first);
    for(const forbidden of ['T26_ORIGINAL_GROUP_PRIVATE_MATERIAL','bot-test','user-test','group-t26-first-original','target_id','recipient_binding_hash'])assert.equal(visible.includes(forbidden),false);
  },{manualRoundConsumption:true});
});