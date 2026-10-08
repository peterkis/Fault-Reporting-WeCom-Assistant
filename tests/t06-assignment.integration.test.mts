import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';

test('explicitly assigning an effective internal colleague keeps the Ticket queued without accepting or starting it',async()=>{
  await withWeb01Fixture(async context=>{
    const ticket=context.tickets[0],target=context.principals[1];assert.ok(ticket&&target);
    const cookie=context.cookies[0];assert.ok(cookie);
    const get=async(path:string)=>{const response=await fetch(context.origin+path,{headers:{cookie}});return {status:response.status,value:await response.json()};};
    const bootstrap=(await get('/api/lifecycle/bootstrap')).value;
    const command={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:target.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
    const response=await fetch(context.origin+'/api/tickets/'+ticket.ticket.id+'/assign',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':command.client_command_id,'if-match':'"2"'},body:JSON.stringify(command)});
    assert.equal(response.status,200);
    const detail=(await get('/api/tickets/'+ticket.ticket.id)).value;
    assert.equal(detail.status,'QUEUED');assert.equal(detail.assignee_id,target.id);assert.equal(detail.version,3);
    const events=(await get('/api/tickets/'+ticket.ticket.id+'/events')).value.items;
    assert.equal(events.some((event:{event_type:string})=>['ticket.accepted','ticket.started'].includes(event.event_type)),false);
    assert.equal(events.at(-1).event_type,'ticket.assignment_transferred');
    assert.equal(detail.handling_cycle.cycle_no,1);
    assert.equal(detail.handling_cycle.first_responsibility_event_id,events.at(-1).event_id);
  },{ticketSelfHandlingEnabled:true,...{ticketAssignmentEnabled:true}});
});
