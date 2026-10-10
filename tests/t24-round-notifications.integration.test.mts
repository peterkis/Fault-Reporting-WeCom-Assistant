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

test('committed staff completion yields a second independent safe personal node without undoing the closed Ticket',async()=>{
  await withT24Fixture(async context=>{
    const http=await t11Http(context),started=await http.start(context.ticketId);
    await context.runtime.roundNotifications.runOnce();
    const command={...http.command(started),internal_process:'INTERNAL_T24_CANARY：仅内部的合成排查过程',external_summary:'打印服务已恢复，请重新尝试。'};
    const completion=await http.post(context.ticketId,'complete',command);assert.equal(completion.status,200);
    const completed=await http.detail(context.ticketId);assert.equal(completed.status,'CLOSED');
    await context.runtime.roundNotifications.runOnce();
    const result=await (await http.get('/api/tickets/'+context.ticketId+'/deliveries')).json() as {items:{node:string;cycle_no:number;destination_type:string;status:string}[]};
    assert.deepEqual(result.items.map(row=>({node:row.node,cycle_no:row.cycle_no,route:row.destination_type,status:row.status})).sort((a,b)=>a.node.localeCompare(b.node)),[
      {node:'FIRST_RESPONSIBILITY',cycle_no:1,route:'PERSON',status:'PENDING'},
      {node:'STAFF_COMPLETED',cycle_no:1,route:'PERSON',status:'PENDING'},
    ]);
    const facts=(await context.pool.query<{messages:number;outboxes:number;deliveries:number;grants:number;unsafe:boolean}>(`SELECT
      (SELECT count(*)::int FROM communication.message) AS messages,(SELECT count(*)::int FROM communication.outbox) AS outboxes,
      (SELECT count(*)::int FROM communication.delivery) AS deliveries,(SELECT count(*)::int FROM pilot_ticket.reporter_access_grant) AS grants,
      EXISTS(SELECT 1 FROM communication.message WHERE content::text LIKE '%INTERNAL_T24_CANARY%' OR content::text LIKE '%user-test%' OR content::text LIKE '%bot-test%') AS unsafe`)).rows[0];
    assert.deepEqual(facts,{messages:2,outboxes:2,deliveries:2,grants:0,unsafe:false});
    assert.equal(JSON.stringify(result).includes('INTERNAL_T24_CANARY'),false);
  });
});
