import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import type {ReviewResolveAndStartCommand} from '../contracts/workbench_review_start_contracts.js';

interface Fixture {origin:string;cookies:string[];principals:{id:string}[];tickets:{ticket:{id:string}}[];runtime:P2016EnabledRuntime}
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function list(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
async function project(runtime:P2016EnabledRuntime){
  const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){const result=await runtime.coordinator.runOnce(),material=await runtime.realtimeProjector.runOnce({limit:100});assert.ok(result.streams.every(stream=>stream.failures.length===0));
    if(result.processed===0&&material.processed===0&&(await runtime.coordinator.backlog()).total===0)return;}
  assert.fail('finite synthetic material projection did not complete');
}
test('T15 original-purpose read-only receipt distinguishes unknown from committed without replaying a write or disclosing original selections',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    await project(fixture.runtime);const cookie=fixture.cookies[0],ticket=fixture.tickets[0];assert.ok(cookie&&ticket);
    const get=async(path:string,expected=200)=>{const response=await fetch(fixture.origin+path,{headers:{cookie}});assert.equal(response.status,expected,await response.clone().text());return object(await response.json());};
    const bootstrap=await get('/api/lifecycle/bootstrap'),reference=list((await get('/api/workbench/items/ticket/'+ticket.ticket.id)).review_refs)[0];assert.ok(reference);
    const reviewId=text(reference.id),review=await get('/api/manual-reviews/'+reviewId),currentTicket=await get('/api/tickets/'+ticket.ticket.id),basis=object(review.material_basis);
    const command:ReviewResolveAndStartCommand={client_command_id:randomUUID(),expected_row_version:text(review.row_version),expected_material_basis:text(basis.current_hash),resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'PRIVATE_RECEIPT_REASON',
      expected_ticket:{ticket_id:ticket.ticket.id,expected_version:Number(currentTicket.version)},resolver_team_id:text(currentTicket.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]};
    const path='/api/manual-reviews/'+reviewId+'/resolve-and-start',receiptPath=path+'/commands/'+command.client_command_id;
    assert.deepEqual(await get(receiptPath),{client_command_id:command.client_command_id,review_id:reviewId,state:'UNKNOWN'});
    const writes:string[]=[];fixture.runtime.server.on('request',request=>{if(request.method==='POST')writes.push(request.url??'');});
    const post=()=>fetch(fixture.origin+path,{method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"','x-csrf-token':text(bootstrap.csrf_token)},body:JSON.stringify(command)});
    const response=await post();assert.equal(response.status,200,await response.clone().text());const committed=object(await response.json());assert.equal(committed.ok,true);
    const receipt=await get(receiptPath);assert.deepEqual(receipt,{client_command_id:command.client_command_id,review_id:reviewId,state:'COMMITTED',ticket_id:ticket.ticket.id,ticket_version:committed.ticket_version,ticket_event_id:committed.ticket_event_id});
    assert.deepEqual(await get(receiptPath),receipt);assert.deepEqual(writes,[path]);
    const replay=await post();assert.equal(replay.status,200,await replay.clone().text());assert.equal(object(await replay.json()).replayed,true);assert.deepEqual(await get(receiptPath),receipt);
    const safe=JSON.stringify(receipt);for(const secret of ['PRIVATE_RECEIPT_REASON',command.expected_material_basis,'sessions','command_hash','resolver_team_id','assignee_id'])assert.ok(!safe.includes(secret));
    assert.equal((await get('/api/tickets/'+ticket.ticket.id)).version,committed.ticket_version);
  },{workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false});
});
