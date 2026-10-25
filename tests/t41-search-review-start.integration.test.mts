import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import type {ReviewResolveAndStartCommand} from '../contracts/workbench_review_start_contracts.js';
import {object,rows} from './helpers/t41-search-risk-fixture.mjs';

interface Fixture {pool:PostgresPool;origin:string;runtime:P2016EnabledRuntime;
 principals:{id:string}[];outsider:{id:string};tickets:{ticket:{id:string}}[]}
function text(value:unknown):string {assert.ok(typeof value==='string');return value;}
function version(value:unknown):number {assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function material(runtime:P2016EnabledRuntime){
 const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;
 for(let step=0;step<bound;step++){
  const inbound=await runtime.coordinator.runOnce(),projected=await runtime.realtimeProjector.runOnce({limit:100});
  assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
  if(inbound.processed===0&&projected.processed===0&&(await runtime.coordinator.backlog()).total===0)return;
 }
 assert.fail('the finite T41/T15 fixture material did not finish projection');
}

test('T41 searches the same canonical Ticket once after the real T15 command moves its linked Review to active work',async()=>{
 await withWeb01Fixture(async(f:Fixture)=>{
  await material(f.runtime);await f.runtime.stop();
  const actor=f.principals[0],staff=f.principals[1],known=f.tickets[0];assert.ok(actor&&staff&&known);
  const runtime=createP2016Runtime({pool:f.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.origin,
   listenPort:Number(new URL(f.origin).port),principalIds:[actor.id,staff.id,f.outsider.id],externalSendEnabled:false,
   workbenchSearchEnabled:true,workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,
   ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true});
  try{
   const started=await runtime.start(),cookie=started.cookies?.[0],outsider=started.cookies?.[2];assert.ok(cookie&&outsider);
   const headers={cookie:cookie.name+'='+cookie.value};
   const get=async(path:string)=>{
    const response=await fetch(f.origin+path,{headers,signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200,await response.clone().text());return object(await response.json());
   };
   const bootstrap=await get('/api/lifecycle/bootstrap');
   assert.equal(bootstrap.workbench_search_enabled,true);assert.equal(bootstrap.manual_review_resolve_and_start_enabled,true);
   const detail=await get('/api/workbench/items/ticket/'+known.ticket.id),reference=rows(detail.review_refs)[0];assert.ok(reference);
   const reviewId=text(reference.id),review=await get('/api/manual-reviews/'+reviewId),ticket=await get('/api/tickets/'+known.ticket.id);
   assert.equal(review.status,'PENDING');assert.equal(ticket.status,'QUEUED');
   const query='q='+encodeURIComponent(text(ticket.ticket_no)),pending=await get('/api/workbench/search?column=pending&'+query);
   const before=rows(pending.items);assert.equal(before.length,1);assert.equal(before[0]?.kind,'ticket');assert.equal(before[0]?.id,known.ticket.id);
   const command:ReviewResolveAndStartCommand={client_command_id:randomUUID(),expected_row_version:text(review.row_version),
    expected_material_basis:text(object(review.material_basis).current_hash),resolution_code:'CONFIRM_TICKET_ELIGIBLE',
    resolution_reason_code:'CLEAR_FAULT_HUMAN_CONFIRMED',expected_ticket:{ticket_id:known.ticket.id,expected_version:version(ticket.version)},
    resolver_team_id:text(ticket.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]};
   const response=await fetch(f.origin+'/api/manual-reviews/'+reviewId+'/resolve-and-start',{
    method:'POST',headers:{...headers,origin:f.origin,'content-type':'application/json','idempotency-key':command.client_command_id,
     'if-match':'"'+command.expected_row_version+'"','x-csrf-token':text(bootstrap.csrf_token)},body:JSON.stringify(command),signal:AbortSignal.timeout(10000)});
   assert.equal(response.status,200,await response.clone().text());const committed=object(await response.json());
   assert.equal(committed.ok,true);assert.equal(committed.ticket_id,known.ticket.id);
   const resolved=await get('/api/manual-reviews/'+reviewId);assert.equal(resolved.status,'RESOLVED');
   assert.deepEqual(resolved.canonical_item,{kind:'ticket',id:known.ticket.id});
   assert.deepEqual(rows((await get('/api/workbench/search?column=pending&'+query)).items),[]);
   for(const column of ['active','all']){
    const page=await get('/api/workbench/search?column='+column+'&'+query),found=rows(page.items);
    assert.equal(found.length,1);assert.equal(found[0]?.kind,'ticket');assert.equal(found[0]?.id,known.ticket.id);
    assert.equal(found[0]?.status,'IN_PROGRESS');assert.equal(Object.hasOwn(page,'total'),false);assert.equal(page.next_cursor,null);
   }
   const denied=await fetch(f.origin+'/api/workbench/search?'+query,{headers:{cookie:outsider.name+'='+outsider.value},signal:AbortSignal.timeout(10000)});
   assert.equal(denied.status,200,await denied.clone().text());const hidden=object(await denied.json());
   assert.deepEqual(rows(hidden.items),[]);assert.equal(Object.hasOwn(hidden,'total'),false);assert.equal(hidden.next_cursor,null);
  }finally{
   await runtime.stop();assert.equal(runtime.server.listening,false);
   assert.equal(await new Promise<number>((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),0);
  }
 },{manualProjection:true,chronologicalTicketEvents:true,workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,
  ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false});
});
