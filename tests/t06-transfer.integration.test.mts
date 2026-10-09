import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';

type Fixture={pool:PostgresPool;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
async function http(context:Fixture,cookie:string){
  const get=async(path:string)=>{const response=await fetch(context.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
  const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=string(bootstrap.value.csrf_token);
  const post=async(path:string,command:Record<string,unknown>)=>{const response=await fetch(context.origin+path,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':string(command.client_command_id),'if-match':'"'+command.expected_version+'"'},body:JSON.stringify(command)});return {status:response.status,value:object(await response.json())};};
  return {get,post};
}

test('a currently authorized internal colleague explicitly transfers the queued Ticket and target group in the same handling cycle',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    const first=context.tickets[0],originalOwner=context.principals[2],actor=context.principals[1];assert.ok(first&&originalOwner&&actor);
    const adminCookie=context.cookies[0],actorCookie=context.cookies[2];assert.ok(adminCookie&&actorCookie);
    // Only directory configuration is seeded. Both Ticket responsibility writes use authenticated public HTTP.
    const targetTeam='T06_NETWORK';
    await context.pool.query('INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES($1,$2)',[targetTeam,'T06 合成网络处理组']);
    const target=await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'t06-transfer-target-'+randomUUID(),displayName:'T06 合成承接同事',roles:['HANDLER'],resolverTeamIds:[targetTeam]});
    assert.equal((await context.pool.query('SELECT 1 FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[actor.id,targetTeam])).rowCount,0);
    const admin=await http(context,adminCookie),path='/api/tickets/'+first.ticket.id;
    const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:originalOwner.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(assigned.status,200,JSON.stringify(assigned.value));
    const before=(await admin.get(path)).value,cycle=object(before.handling_cycle);
    assert.equal(before.status,'QUEUED');assert.equal(before.assignee_id,originalOwner.id);assert.equal(before.resolver_team_id,'PILOT_IT');assert.equal(before.version,3);
    const colleague=await http(context,actorCookie);assert.equal((await colleague.get(path)).status,200);
    const transferred=await colleague.post(path+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:3,reason_code:'WORKBENCH_TRANSFER',target_principal_id:target.id,resolver_team_id:targetTeam,communication_choice:'RETAIN_CURRENT',sessions:[]});
    assert.equal(transferred.status,200,JSON.stringify(transferred.value));
    const after=(await admin.get(path)).value;
    assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,target.id);assert.equal(after.resolver_team_id,targetTeam);assert.equal(after.version,4);assert.equal(after.intake_id,before.intake_id);
    assert.deepEqual(after.handling_cycle,cycle);
    const events=rows((await admin.get(path+'/events')).value.items),last=events.at(-1);assert.ok(last);
    assert.equal(events.some(event=>['ticket.accepted','ticket.started'].includes(String(event.event_type))),false);
    assert.equal(last.event_type,'ticket.assignment_transferred');assert.notEqual(last.event_id,cycle.first_responsibility_event_id);
    const persisted=(await context.pool.query('SELECT assignee_id::text,resolver_team_id,status,version,current_handling_cycle_id::text FROM pilot_ticket.ticket WHERE id=$1::uuid',[first.ticket.id])).rows[0];assert.ok(persisted);
    assert.deepEqual(persisted,{assignee_id:target.id,resolver_team_id:targetTeam,status:'QUEUED',version:4,current_handling_cycle_id:cycle.id});
    const event=(await context.pool.query('SELECT assignment_metadata,operator_type,operator_id FROM pilot_ticket.ticket_event WHERE event_id=$1::uuid',[string(last.event_id)])).rows[0];assert.ok(event);
    assert.deepEqual(event,{assignment_metadata:{old_assignee_id:originalOwner.id,new_assignee_id:target.id,old_team_id:'PILOT_IT',new_team_id:targetTeam},operator_type:'PILOT_USER',operator_id:actor.id});
    const links=(await context.pool.query('SELECT cycle_id::text FROM pilot_ticket.ticket_handling_cycle_event WHERE ticket_event_id=$1::uuid',[string(last.event_id)])).rows;
    assert.deepEqual(links,[{cycle_id:cycle.id}]);
    assert.equal((await colleague.get(path)).status,404,'transfer does not expand the actor\'s existing Ticket read scope');
  },{ticketSelfHandlingEnabled:true,...{ticketAssignmentEnabled:true}});
});
