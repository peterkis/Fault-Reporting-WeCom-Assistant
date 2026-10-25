import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {P2016EnabledRuntime} from '../app/server/src/p2-016-runtime.mjs';

type Fixture={runtime:P2016EnabledRuntime;tickets:{ticket:{id:string};intake:{intakeId:string}}[];principals:{id:string}[];origin:string;cookies:string[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function version(value:unknown):number{assert.equal(typeof value,'string');const number=Number(value);assert.ok(Number.isSafeInteger(number)&&number>=1);return number;}

async function projectFixtureMaterial(runtime:P2016EnabledRuntime){
  const initial=await runtime.coordinator.backlog(),bound=Math.ceil(initial.total/runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const result=await runtime.coordinator.runOnce();
    assert.ok(result.streams.every(stream=>stream.failures.length===0),'the real fixture projection must succeed before the related query is exercised');
    const remaining=await runtime.coordinator.backlog();
    if(result.processed===0&&remaining.total===0)return;
  }
  assert.fail('the finite source fixture material did not finish its configured projection batches');
}

test('related-to-me includes a currently authorized communicator once without making that person the handler',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await projectFixtureMaterial(context.runtime);
    const first=context.tickets[0],unrelated=context.tickets[1],communicator=context.principals[1],cookie=context.cookies[2];
    assert.ok(first&&unrelated&&communicator&&cookie);
    const get=async(path:string)=>{const response=await fetch(context.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
    const ticket=await get('/api/tickets/'+first.ticket.id);
    assert.equal(ticket.status,200);assert.equal(ticket.value.assignee_id,null);
    const related=await get('/api/tickets/'+first.ticket.id+'/related-conversations');
    assert.equal(related.status,200);
    const sessions=rows(related.value.items);assert.equal(sessions.length,1);
    const session=sessions[0];assert.ok(session);
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
    assert.equal(bootstrap.value.principal_id,communicator.id);
    const command={client_command_id:randomUUID(),expected_row_version:version(session.session_row_version),reason_code:'T34_EXPLICIT_COMMUNICATION_RESPONSIBILITY'};
    const takeover=await fetch(context.origin+'/api/conversations/'+text(session.session_id)+'/takeover',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':text(bootstrap.value.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"'+command.expected_row_version+'"'},body:JSON.stringify(command)});
    assert.equal(takeover.status,200,await takeover.clone().text());
    const responsibility=await get('/api/tickets/'+first.ticket.id+'/responsibility');assert.equal(responsibility.status,200);
    const actual=rows(responsibility.value.conversations);assert.equal(actual.length,1);
    assert.equal(actual[0]?.conversation_principal_id,communicator.id);
    assert.equal((await get('/api/tickets/'+first.ticket.id)).value.assignee_id,null);
    // The existing mine profile stays a handling query; communication must not silently create a Ticket owner.
    const mine=await get('/api/tickets?state=mine');assert.equal(mine.status,200);
    assert.ok(rows(mine.value.items).every(item=>item.id!==first.ticket.id));
    const team=await get('/api/workbench/board?column=pending');assert.equal(team.status,200);
    assert.equal(rows(team.value.items).filter(item=>item.intake_id===first.intake.intakeId).length,1);
    assert.ok(rows(team.value.items).some(item=>item.id===unrelated.ticket.id),'the separate unassigned team-visible Ticket is available in the ordinary team query');
    // Prepared public RED: the current board query has no related scope.
    const personal=await get('/api/workbench/board?column=pending&scope=related');
    assert.equal(personal.status,200,JSON.stringify(personal.value));
    const personalItems=rows(personal.value.items);
    assert.equal(personalItems.filter(item=>item.intake_id===first.intake.intakeId).length,1);
    assert.equal(personalItems.find(item=>item.id===first.ticket.id)?.kind,'ticket');
    assert.ok(personalItems.every(item=>item.kind!=='review'||item.intake_id!==first.intake.intakeId));
    assert.equal(personalItems.length,1,'team visibility alone is insufficient to put a separate unassigned Ticket into the personal union');
    assert.equal((await get('/api/tickets/'+first.ticket.id)).value.assignee_id,null);
  },{ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true,chronologicalTicketEvents:true,manualProjection:true,workbenchFollowEnabled:true});
});
