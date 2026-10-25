import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createTicketRoundNotifications} from '../app/server/src/workbench-ticket-round-notifications.mjs';
import {createP2016ReporterAccess} from '../app/server/src/p2-016-reporter-access.mjs';
import {createPostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';

test('same-round handoffs, command replay and a fresh consumer with a new template preserve both original personal Delivery identities',async()=>{
  await withT24Fixture(async context=>{
    const http=await t11Http(context),id=context.ticketId,initial=await http.detail(id);
    const startCommand={client_command_id:randomUUID(),expected_version:initial.version,reason_code:'T24_IDENTITY_START',resolver_team_id:initial.resolver_team_id};
    assert.equal((await http.post(id,'take-and-start',startCommand)).status,200);
    const started=await http.detail(id),cycle=started.handling_cycle;assert.ok(cycle);
    await context.runtime.roundNotifications.runOnce();
    const readDeliveries=async()=>{
      const response=await http.get('/api/tickets/'+id+'/deliveries');assert.equal(response.status,200);
      return await response.json() as {items:{delivery_id:string;node:string;cycle_no:number;destination_type:string;status:string}[]};
    };
    const before=await readDeliveries();assert.equal(before.items.length,1);
    assert.deepEqual(before.items.map(row=>({node:row.node,cycle:row.cycle_no,route:row.destination_type,status:row.status})),[
      {node:'FIRST_RESPONSIBILITY',cycle:1,route:'PERSON',status:'PENDING'},
    ]);
    const originalFirstDelivery=before.items[0]?.delivery_id;assert.ok(originalFirstDelivery);
    const originalPrincipal=context.principals[0]?.id,targetPrincipal=context.principals[1]?.id;assert.ok(originalPrincipal);assert.ok(targetPrincipal);
    for(const target of [targetPrincipal,originalPrincipal]){
      const current=await http.detail(id);
      assert.equal((await http.post(id,'transfer',{client_command_id:randomUUID(),expected_version:current.version,reason_code:'T24_HANDOFF',target_principal_id:target})).status,200);
      const after=await http.detail(id);assert.equal(after.assignee_id,target);assert.deepEqual(after.handling_cycle,cycle);
    }
    assert.equal((await http.post(id,'take-and-start',startCommand)).status,200);
    const useFreshConsumer=async(templateVersion:string)=>{
      const pool=createPostgresPool({connectionString:context.databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'t24_identity_new_consumer'});
      try{
        const consumer=createTicketRoundNotifications({pool,enabled:true,botId:'bot-test',templateVersion,
          reporterAccess:createP2016ReporterAccess({pool,enabled:true,hmacSecret:entryKey})});
        await consumer.runOnce();await consumer.runOnce();
      }finally{await pool.end();}
    };
    await useFreshConsumer('wbint-round-notification/2');
    const handedOff=await readDeliveries();assert.deepEqual(handedOff.items,before.items);
    const one=(await context.pool.query<{messages:number;outboxes:number;deliveries:number}>(`SELECT
      (SELECT count(*)::int FROM communication.message) AS messages,(SELECT count(*)::int FROM communication.outbox) AS outboxes,
      (SELECT count(*)::int FROM communication.delivery) AS deliveries`)).rows[0];
    assert.deepEqual(one,{messages:1,outboxes:1,deliveries:1},'handoff, replay and template upgrade cannot create a second actual FIRST intent');
    const current=await http.detail(id),completionCommand=http.command(current);
    assert.equal((await http.post(id,'complete',completionCommand)).status,200);
    await context.runtime.roundNotifications.runOnce();
    const completed=await http.detail(id);assert.equal(completed.status,'CLOSED');
    const both=await readDeliveries();
    assert.deepEqual(both.items.map(row=>({node:row.node,cycle:row.cycle_no,route:row.destination_type,status:row.status})).sort((a,b)=>a.node.localeCompare(b.node)),[
      {node:'FIRST_RESPONSIBILITY',cycle:1,route:'PERSON',status:'PENDING'},
      {node:'STAFF_COMPLETED',cycle:1,route:'PERSON',status:'PENDING'},
    ]);
    assert.equal(both.items.find(row=>row.node==='FIRST_RESPONSIBILITY')?.delivery_id,originalFirstDelivery);
    assert.equal((await http.post(id,'complete',completionCommand)).status,200);
    await useFreshConsumer('wbint-round-notification/3');
    const replayed=await readDeliveries();assert.deepEqual(replayed.items,both.items);
    const afterReplay=await http.detail(id);assert.equal(afterReplay.status,'CLOSED');assert.equal(afterReplay.version,completed.version);
    const two=(await context.pool.query<{messages:number;outboxes:number;deliveries:number;grants:number;unsafe:boolean}>(`SELECT
      (SELECT count(*)::int FROM communication.message) AS messages,(SELECT count(*)::int FROM communication.outbox) AS outboxes,
      (SELECT count(*)::int FROM communication.delivery) AS deliveries,(SELECT count(*)::int FROM pilot_ticket.reporter_access_grant) AS grants,
      EXISTS(SELECT 1 FROM communication.message WHERE content::text LIKE '%INTERNAL_T11_CANARY%' OR content::text LIKE '%user-test%' OR content::text LIKE '%bot-test%') AS unsafe`)).rows[0];
    assert.deepEqual(two,{messages:2,outboxes:2,deliveries:2,grants:0,unsafe:false});
    for(const marker of ['INTERNAL_T11_CANARY','user-test','bot-test'])assert.equal(JSON.stringify(replayed).includes(marker),false);
  });
});
