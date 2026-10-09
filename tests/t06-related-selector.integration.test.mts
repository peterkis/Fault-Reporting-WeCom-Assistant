import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
type Fixture={runtime:P2016EnabledRuntime;origin:string;cookies:string[];tickets:{ticket:{id:string}}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}

test('assignment alone discovers only the currently readable canonical communication choices while T05 writes stay disabled',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0],cookie=context.cookies[2],outsider=context.cookies[1];assert.ok(ticket&&cookie&&outsider);const path='/api/tickets/'+ticket.ticket.id;
    const get=async(url:string,currentCookie=cookie)=>{const response=await fetch(context.origin+url,{headers:{cookie:currentCookie}});return {status:response.status,value:object(await response.json())};};
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.value.ticket_assignment_enabled,true);assert.equal(bootstrap.value.ticket_conversation_self_handling_enabled,false);
    const before=await get(path);assert.equal(before.status,200);assert.equal(before.value.version,2);assert.ok(Array.isArray(before.value.allowed_actions));assert.equal(before.value.allowed_actions.includes('take-and-start-with-conversations'),false);
    const canonical=rows((await get(path+'/responsibility')).value.conversations);assert.equal(canonical.length,1);
    const selected=await get(path+'/related-conversations?limit=20');assert.equal(selected.status,200,JSON.stringify(selected.value));
    const choices=rows(selected.value.items);assert.equal(choices.length,1);assert.equal(selected.value.next_cursor,null);
    assert.deepEqual(Object.keys(choices[0]??{}).sort(),['assignment_status','conversation_principal_id','conversation_principal_name','session_id','session_row_version','take_allowed']);
    assert.equal(choices[0]?.session_id,canonical[0]?.session_id);assert.equal(choices[0]?.session_row_version,canonical[0]?.session_row_version);assert.equal(choices[0]?.take_allowed,true);
    assert.equal((await get(path+'/related-conversations?limit=20',outsider)).status,404);
    const command={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]};
    const write=await fetch(context.origin+path+'/take-and-start-with-conversations',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':string(bootstrap.value.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"2"'},body:JSON.stringify(command)});assert.equal(write.status,503,'discovering T06 choices must not enable the independently disabled T05 write capability');
    const after=(await get(path)).value;for(const key of ['id','version','status','assignee_id','resolver_team_id','intake_id','handling_cycle'])assert.deepEqual(after[key],before.value[key]);
  },{ticketAssignmentEnabled:true,ticketSelfHandlingWebSource:false});
});
