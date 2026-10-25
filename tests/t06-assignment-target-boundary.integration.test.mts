import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {assertP2016Schema} from './helpers/p2-016-schema-assert.mjs';
type Fixture={pool:PostgresPool;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string;display_name:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}

test('display truncation does not deny a currently permitted effective target group beyond the first hundred',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    const ticket=context.tickets[0],target=context.principals[2],cookie=context.cookies[2],admin=context.cookies[0];assert.ok(ticket&&target&&cookie&&admin);
    const selected='Z_T06_ALLOWED',path='/api/tickets/'+ticket.ticket.id;
    // Bounded synthetic directory setup only: 99 earlier effective groups plus PILOT_IT put this real group at position 101.
    await context.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) SELECT 'A_T06_'||lpad(n::text,3,'0'),'T06 有界组 '||n FROM generate_series(1,99) n");
    await context.pool.query('INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES($1,$2)',[selected,'T06 第101项合法组']);
    await context.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) SELECT $1::uuid,team_id FROM pilot_ticket.resolver_team WHERE team_id LIKE 'A_T06_%' OR team_id=$2",[target.id,selected]);
    const get=async(url:string,current=cookie)=>{const response=await fetch(context.origin+url,{headers:{cookie:current}});return {status:response.status,value:object(await response.json())};};
    const before=await get(path);assert.equal(before.status,200);assert.equal(before.value.version,2);assert.equal(before.value.assignee_id,null);
    const result=await get(path+'/assignment-targets?resolver_team_id='+selected);assert.equal(result.status,200,JSON.stringify(result.value));
    await assertP2016Schema('p2_016_assignment_targets',result.value);
    assert.equal(result.value.resolver_team_id,selected);assert.ok(Array.isArray(result.value.resolver_teams));assert.equal(result.value.resolver_teams.length,100);
    assert.ok(result.value.resolver_teams.some(value=>object(value).team_id===selected),'the bounded selector must represent its lawful explicit selection');
    assert.deepEqual(result.value.items,[{principal_id:target.id,display_name:target.display_name}]);
    const after=(await get(path)).value;for(const key of ['id','version','status','assignee_id','resolver_team_id','intake_id','handling_cycle'])assert.deepEqual(after[key],before.value[key]);
    const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);
    const command={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:target.id,resolver_team_id:selected,communication_choice:'RETAIN_CURRENT',sessions:[]};
    const posted=await fetch(context.origin+path+'/assign',{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':string(bootstrap.value.csrf_token),'idempotency-key':command.client_command_id,'if-match':'"2"'},body:JSON.stringify(command)});assert.equal(posted.status,200);
    const authoritative=await get(path,admin);assert.equal(authoritative.status,200);assert.equal(authoritative.value.status,'QUEUED');assert.equal(authoritative.value.assignee_id,target.id);assert.equal(authoritative.value.resolver_team_id,selected);
  },{ticketSelfHandlingEnabled:true,...{ticketAssignmentEnabled:true}});
});
