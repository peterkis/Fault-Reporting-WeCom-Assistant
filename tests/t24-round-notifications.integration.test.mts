import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout} from 'node:timers/promises';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';

test('Bot single-chat first responsibility exposes one durable round node through authorized deliveries HTTP',async()=>{
  await withT24Fixture(async context=>{
    const http=await t11Http(context);await http.start(context.ticketId);
    await setTimeout(1500);
    const response=await http.get('/api/tickets/'+context.ticketId+'/deliveries');assert.equal(response.status,200);
    const result=await response.json() as {items:{node?:string;cycle_no?:number;destination_type:string;status:string}[]};
    assert.deepEqual(result.items.map(row=>({node:row.node,cycle_no:row.cycle_no,route:row.destination_type,status:row.status})),[
      {node:'FIRST_RESPONSIBILITY',cycle_no:1,route:'PERSON',status:'PENDING'},
    ]);
    const counts=(await context.pool.query<{messages:number;outboxes:number;deliveries:number}>(`SELECT
      (SELECT count(*)::int FROM communication.message) AS messages,
      (SELECT count(*)::int FROM communication.outbox) AS outboxes,
      (SELECT count(*)::int FROM communication.delivery) AS deliveries`)).rows[0];
    assert.deepEqual(counts,{messages:1,outboxes:1,deliveries:1},'the node must have one actual intent, including any legacy accept hook');
    const outsider=await t11Http(context,1);assert.equal((await outsider.get('/api/tickets/'+context.ticketId+'/deliveries')).status,404);
    assert.equal(JSON.stringify(result).includes('user-test'),false);assert.equal(JSON.stringify(result).includes('bot-test'),false);
  });
});
