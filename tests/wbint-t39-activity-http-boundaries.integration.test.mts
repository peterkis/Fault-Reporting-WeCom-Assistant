import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {WorkbenchActivityCommand,WorkbenchActivityView} from '../contracts/workbench_activity_contracts.js';
interface Fixture {origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[];pool:PostgresPool;runtime:{observability:{metrics:()=>Promise<{sse_clients:number}>}}}
const target=(id:string)=>({kind:'ticket' as const,id});
const renew=(id:string):WorkbenchActivityCommand=>({schema_version:1,browser_id:randomUUID(),action:'RENEW',target:target(id),visible:true,active:true,mode:'VIEWING',field:null});
async function http(f:Fixture){
  const actor=f.cookies[0],viewer=f.cookies[2],hidden=f.cookies[1];assert.ok(actor&&viewer&&hidden);
  const get=(path:string,cookie=actor)=>fetch(f.origin+path,{headers:{cookie}});
  const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
  const capability=await bootstrap.json() as {csrf_token:string;activity_enabled:boolean;activity_limits:Record<string,number>};
  const post=(body:unknown,cookie=actor,csrf=capability.csrf_token,origin=f.origin,path='/api/workbench/activity')=>fetch(f.origin+path,{method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)});
  return {actor,viewer,hidden,get,post,capability};
}
test('activity default off and independent realtime prerequisite allocate no usable presence capability',async()=>{
  for(const options of [{workbenchRealtimeEnabled:true},{workbenchActivityEnabled:true}])await withWeb01Fixture(async(f:Fixture)=>{
    const h=await http(f),ticket=f.tickets[0]?.ticket;assert.ok(ticket);assert.ok(h.capability.activity_enabled===undefined||h.capability.activity_enabled===false);
    for(const response of [await h.post(renew(ticket.id)),await h.get('/api/workbench/items/ticket/'+ticket.id+'/activity')]){assert.equal(response.status,503);await response.arrayBuffer();}
    const detail=await h.get('/api/workbench/items/ticket/'+ticket.id);assert.equal(detail.status,200);await detail.arrayBuffer();
  },{...options,manualProjection:true});
});
test('real activity HTTP enforces closed inputs, CSRF, current READ and independent field authority',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const h=await http(f),ticket=f.tickets[0]?.ticket,actor=f.principals[0];assert.ok(ticket&&actor);
    const path='/api/workbench/items/ticket/'+ticket.id+'/activity',body=renew(ticket.id);
    await assertP2016Schema('workbench_activity_command',body);
    assert.equal(h.capability.activity_enabled,true);
    assert.deepEqual(h.capability.activity_limits,{lease_ttl_ms:15000,heartbeat_ms:5000,viewing_idle_ms:60000,editing_idle_ms:10000,max_objects_per_browser:2,max_browsers_per_principal:4,max_browsers:64,max_leases:128,max_leases_per_object:16});
    for(const [response,status] of [[await h.post(body,h.actor,'wrong-csrf'),403],[await h.post(body,h.actor,h.capability.csrf_token,'https://foreign.invalid'),403],
      [await h.post(body,h.actor,h.capability.csrf_token,f.origin,'/api/workbench/activity?hidden=1'),400],[await h.post({...body,principal_id:randomUUID()}),400],
      [await h.post({...body,visible:false}),400],[await h.post({...body,mode:'EDITING',field:'external-reply'}),400],
      [await h.post({...body,mode:'EDITING',field:'internal-note'}),403],[await h.get(path+'?all=true'),400],[await h.get(path,h.hidden),404]] as const){assert.equal(response.status,status);await response.arrayBuffer();}
    const accepted=await h.post(body);assert.equal(accepted.status,200);const receipt=await accepted.json();
    const view=await h.get(path,h.viewer);assert.equal(view.status,200);const projection=await view.json() as WorkbenchActivityView;
    await assertP2016Schema('workbench_activity_view',projection);assert.equal(projection.people[0]?.display_name,'林舟');assert.equal(projection.people[0]?.mode,'VIEWING');
    assert.deepEqual(await(await h.get(path)).json(),{schema_version:1,people:[]},'self activity is omitted');
    assert.ok(receipt&&typeof receipt==='object'&&'expires_epoch_ms'in receipt);
    await f.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[actor.id]);
    await f.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[actor.id]);
    await f.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[actor.id]);
    const currentRead=await h.get('/api/workbench/items/ticket/'+ticket.id);assert.equal(currentRead.status,404);await currentRead.arrayBuffer();
    const stillReadable=await h.get('/api/workbench/items/ticket/'+ticket.id,h.viewer);assert.equal(stillReadable.status,200);await stillReadable.arrayBuffer();
    assert.deepEqual(await(await h.get(path,h.viewer)).json(),{schema_version:1,people:[]},'the colleague is removed before current authorized projection');
    const rejected=await h.post(body);assert.equal(rejected.status,404);await rejected.arrayBuffer();
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,manualProjection:true});
});
test('a real shared SSE activity frame has no durable id or private fields, TTL expires and business facts do not change',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{
    const h=await http(f),ticket=f.tickets[0]?.ticket;assert.ok(ticket);
    const path='/api/workbench/items/ticket/'+ticket.id+'/activity';
    const viewerBootstrap=await h.get('/api/lifecycle/bootstrap',h.viewer);assert.equal(viewerBootstrap.status,200);
    const viewer=await viewerBootstrap.json() as {csrf_token:string};
    const facts=async()=>{
      const {rows}=await f.pool.query<Record<string,string>>(`SELECT
        (SELECT count(*)::text FROM pilot_ticket.ticket_event) AS ticket_events,
        (SELECT count(*)::text FROM pilot_ticket.ticket_command_receipt) AS receipts,
        (SELECT string_agg(id::text||':'||version::text||':'||status||':'||COALESCE(assignee_id::text,''),',' ORDER BY id) FROM pilot_ticket.ticket) AS ticket_facts,
        (SELECT count(*)::text FROM conversation.assignment) AS assignments,
        (SELECT count(*)::text FROM conversation.control_event) AS controls,
        (SELECT count(*)::text FROM conversation.read_cursor) AS reads,
        (SELECT count(*)::text FROM communication.message) AS messages,
        (SELECT count(*)::text FROM communication.outbox) AS outboxes,
        (SELECT count(*)::text FROM communication.delivery) AS deliveries,
        (SELECT count(*)::text FROM conversation.realtime_event) AS realtime_events`);
      assert.ok(rows[0]);return rows[0];
    };
    const before=await facts();
    const own=await h.post(renew(ticket.id),h.viewer,viewer.csrf_token);assert.equal(own.status,200);await own.arrayBuffer();
    const abort=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    try{
      const stream=await fetch(f.origin+'/api/realtime/events?scope=workbench',{headers:{cookie:h.viewer},signal:abort.signal});assert.equal(stream.status,200);assert.ok(stream.body);reader=stream.body.getReader();
      const accepted=await h.post(renew(ticket.id));assert.equal(accepted.status,200);await accepted.arrayBuffer();
      const timer=setTimeout(()=>abort.abort(),20000);let pending='',frame='';
      try{
        while(!frame){const next=await reader.read();assert.equal(next.done,false);pending+=new TextDecoder().decode(next.value);pending=pending.replaceAll('\r\n','\n');
          let end:number;while((end=pending.indexOf('\n\n'))>=0){const block=pending.slice(0,end);pending=pending.slice(end+2);if(block.split('\n').includes('event: workbench.activity.changed')){frame=block;break;}}}
      }finally{clearTimeout(timer);}
      assert.deepEqual(frame.split('\n'),['event: workbench.activity.changed','data: {"schema_version":1}']);
      const response=await h.get(path,h.viewer);assert.equal(response.status,200);const projection=await response.json() as WorkbenchActivityView;
      assert.equal(projection.people.length,1);assert.equal(projection.people[0]?.display_name,'林舟');await assertP2016Schema('workbench_activity_view',projection);
      assert.equal((await f.runtime.observability.metrics()).sse_clients,1);
      await new Promise(resolve=>setTimeout(resolve,15500));
      assert.deepEqual(await(await h.get(path,h.viewer)).json(),{schema_version:1,people:[]});
      assert.deepEqual(await facts(),before,'presence must not allocate business events, receipts, read cursors, messages, delivery or durable realtime events');
    }finally{await reader?.cancel();abort.abort();}
  },{workbenchRealtimeEnabled:true,workbenchActivityEnabled:true,manualProjection:true});
});
