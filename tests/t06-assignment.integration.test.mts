import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
type Fixture={origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}

test('explicitly assigning an effective internal colleague keeps the Ticket queued without accepting or starting it',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    const ticket=context.tickets[0],target=context.principals[1];assert.ok(ticket&&target);
    const cookie=context.cookies[0];assert.ok(cookie);
    const get=async(path:string)=>{const response=await fetch(context.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
    const bootstrap=(await get('/api/lifecycle/bootstrap')).value;
    assert.equal(typeof bootstrap.csrf_token,'string');
    const command={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:target.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
    const response=await fetch(context.origin+'/api/tickets/'+ticket.ticket.id+'/assign',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':String(bootstrap.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"2"'},body:JSON.stringify(command)});
    assert.equal(response.status,200);
    const detail=(await get('/api/tickets/'+ticket.ticket.id)).value;
    assert.equal(detail.status,'QUEUED');assert.equal(detail.assignee_id,target.id);assert.equal(detail.version,3);
    const events=rows((await get('/api/tickets/'+ticket.ticket.id+'/events')).value.items),last=events.at(-1);assert.ok(last);
    assert.equal(events.some(event=>['ticket.accepted','ticket.started'].includes(String(event.event_type))),false);
    assert.equal(last.event_type,'ticket.assignment_transferred');
    assert.equal(object(detail.handling_cycle).cycle_no,1);
    assert.equal(object(detail.handling_cycle).first_responsibility_event_id,last.event_id);
  },{ticketSelfHandlingEnabled:true,...{ticketAssignmentEnabled:true}});
});
