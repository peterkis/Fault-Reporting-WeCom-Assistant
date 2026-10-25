import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';
import type {ReviewResolveAndStartCommand} from '../contracts/workbench_review_start_contracts.js';

interface Fixture {
  origin:string;
  cookies:string[];
  principals:{id:string}[];
  tickets:{ticket:{id:string}}[];
  runtime:P2016EnabledRuntime;
}
function object(value:unknown):Record<string,unknown>{
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}
function list(value:unknown):Record<string,unknown>[] {
  assert.ok(Array.isArray(value));return value.map(object);
}
function text(value:unknown):string {assert.equal(typeof value,'string');return value as string;}
function version(value:unknown):number {
  assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;
}
function sessionVersion(value:unknown):number {
  const captured=text(value);assert.match(captured,/^[1-9][0-9]*$/u);
  const result=Number(captured);return version(result);
}
async function projectFixtureMaterial(runtime:P2016EnabledRuntime){
  const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await runtime.coordinator.runOnce(),material=await runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0));
    const remaining=await runtime.coordinator.backlog();
    if(inbound.processed===0&&material.processed===0&&remaining.total===0)return;
  }
  assert.fail('the finite synthetic source material did not finish projection');
}

test('T15 confirms captured clear fault material, reuses its queued Ticket and atomically starts with explicit communication responsibility',async()=>{
  await withWeb01Fixture(async(fixture:Fixture)=>{
    await projectFixtureMaterial(fixture.runtime);
    const cookie=fixture.cookies[0],actor=fixture.principals[0],known=fixture.tickets[0];assert.ok(cookie&&actor&&known);
    const get=async(path:string)=>{
      const response=await fetch(fixture.origin+path,{headers:{cookie}});
      assert.equal(response.status,200,await response.clone().text());return object(await response.json());
    };
    const bootstrap=await get('/api/lifecycle/bootstrap'),item=await get('/api/workbench/items/ticket/'+known.ticket.id);
    const reference=list(item.review_refs)[0];assert.ok(reference);
    const reviewId=text(reference.id),review=await get('/api/manual-reviews/'+reviewId),basis=object(review.material_basis);
    assert.equal(review.status,'PENDING');assert.equal(basis.stale,false);
    assert.ok(list(review.materials).some(material=>typeof material.text==='string'&&material.text.includes('打印机无法打印处方')));
    const ticket=await get('/api/tickets/'+known.ticket.id);assert.equal(ticket.status,'QUEUED');
    const related=list((await get('/api/tickets/'+known.ticket.id+'/related-conversations')).items);assert.equal(related.length,1);
    const session=related[0];assert.ok(session);assert.equal(session.take_allowed,true);
    const command:ReviewResolveAndStartCommand={
      client_command_id:randomUUID(),expected_row_version:text(review.row_version),expected_material_basis:text(basis.current_hash),
      resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'CLEAR_FAULT_HUMAN_CONFIRMED',
      expected_ticket:{ticket_id:known.ticket.id,expected_version:version(ticket.version)},resolver_team_id:text(ticket.resolver_team_id),
      communication_choice:'TAKE_SELECTED',sessions:[{session_id:text(session.session_id),expected_row_version:sessionVersion(session.session_row_version)}]
    };
    const response=await fetch(fixture.origin+'/api/manual-reviews/'+reviewId+'/resolve-and-start',{
      method:'POST',headers:{cookie,origin:fixture.origin,'content-type':'application/json','idempotency-key':command.client_command_id,
        'if-match':'"'+command.expected_row_version+'"','x-csrf-token':text(bootstrap.csrf_token)},body:JSON.stringify(command)
    });
    assert.equal(response.status,200,await response.clone().text());
    const receipt=object(await response.json());assert.equal(receipt.ok,true);assert.equal(receipt.ticket_id,known.ticket.id);
    const currentTicket=await get('/api/tickets/'+known.ticket.id),currentReview=await get('/api/manual-reviews/'+reviewId);
    assert.equal(currentTicket.status,'IN_PROGRESS');assert.equal(currentTicket.assignee_id,actor.id);
    assert.equal(currentTicket.resolver_team_id,command.resolver_team_id);assert.deepEqual(receipt.handling_cycle,currentTicket.handling_cycle);
    assert.equal(currentReview.status,'RESOLVED');assert.equal(currentReview.linked_ticket_id,known.ticket.id);
    assert.deepEqual(currentReview.safe_result,review.safe_result);assert.deepEqual(currentReview.allowed_resolutions,[]);
    assert.deepEqual(currentReview.canonical_item,{kind:'ticket',id:known.ticket.id});
    const responsibility=list((await get('/api/tickets/'+known.ticket.id+'/responsibility')).conversations);
    assert.equal(responsibility.find(value=>value.session_id===session.session_id)?.conversation_principal_id,actor.id);
    const alias=await get('/api/workbench/items/review/'+reviewId);assert.equal(object(alias.item).id,known.ticket.id);
    const active=list((await get('/api/workbench/board?column=active')).items),pending=list((await get('/api/workbench/board?column=pending')).items);
    assert.equal(active.filter(value=>value.id===known.ticket.id).length,1);
    assert.ok(![...active,...pending].some(value=>value.kind==='review'&&value.id===reviewId));
  },{workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,
    ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false});
});
