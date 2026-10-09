import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
type Fixture={pool:PostgresPool;runtime:P2016EnabledRuntime;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}

test('the independently authorized communicator explicitly transfers the real source Session and Ticket responsibility together to a selected colleague',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();
    const first=context.tickets[0],oldOwner=context.principals[2],actor=context.principals[1],adminCookie=context.cookies[0],actorCookie=context.cookies[2];assert.ok(first&&oldOwner&&actor&&adminCookie&&actorCookie);
    const path='/api/tickets/'+first.ticket.id,team='T06_NETWORK';
    await context.pool.query('INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES($1,$2)',[team,'T06 原子交接网络组']);
    const target=await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'t06-atomic-target-'+randomUUID(),displayName:'T06 沟通承接同事',roles:['HANDLER'],resolverTeamIds:[team]});
    const http=async(cookie:string)=>{
      const get=async(url:string)=>{const response=await fetch(context.origin+url,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
      const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=string(bootstrap.value.csrf_token);
      const post=async(url:string,command:Record<string,unknown>,version:unknown=command.expected_version??command.expected_row_version)=>{const response=await fetch(context.origin+url,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','idempotency-key':string(command.client_command_id),'if-match':'"'+version+'"','x-csrf-token':csrf},body:JSON.stringify(command)});return {status:response.status,value:object(await response.json())};};
      return {get,post};
    };
    const admin=await http(adminCookie),worker=await http(actorCookie);
    const assigned=await admin.post(path+'/assign',{client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_ASSIGN',target_principal_id:oldOwner.id,resolver_team_id:'PILOT_IT',communication_choice:'RETAIN_CURRENT',sessions:[]});assert.equal(assigned.status,200);
    const before=await worker.get(path);assert.equal(before.status,200);assert.equal(before.value.status,'QUEUED');assert.equal(before.value.assignee_id,oldOwner.id);const cycle=before.value.handling_cycle;
    const related=rows((await worker.get(path+'/responsibility')).value.conversations);assert.equal(related.length,1);const source=related[0];assert.ok(source);const sessionId=string(source.session_id);
    assert.equal((await worker.get('/api/conversations/'+sessionId)).status,200,'the canonical source Session must have independent current read authority');
    const taken=await worker.post('/api/conversations/'+sessionId+'/takeover',{client_command_id:randomUUID(),expected_row_version:Number(source.session_row_version),reason_code:'T06_CURRENT_COMMUNICATOR'});assert.equal(taken.status,200);
    const selected=rows((await worker.get(path+'/responsibility')).value.conversations)[0];assert.ok(selected);assert.equal(selected.session_id,sessionId);assert.equal(selected.conversation_principal_id,actor.id);
    assert.equal((await worker.get(path+'/assignment-targets?resolver_team_id='+team)).status,200);
    const transferred=await worker.post(path+'/transfer-assignment',{client_command_id:randomUUID(),expected_version:3,reason_code:'WORKBENCH_TRANSFER',target_principal_id:target.id,resolver_team_id:team,communication_choice:'TRANSFER_SELECTED',sessions:[{session_id:sessionId,expected_row_version:Number(selected.session_row_version)}]});
    assert.equal(transferred.status,200,JSON.stringify(transferred.value));
    const after=(await admin.get(path)).value;assert.equal(after.status,'QUEUED');assert.equal(after.assignee_id,target.id);assert.equal(after.resolver_team_id,team);assert.equal(after.version,4);assert.deepEqual(after.handling_cycle,cycle);assert.equal(after.intake_id,before.value.intake_id);
    const communication=rows((await admin.get(path+'/responsibility')).value.conversations);assert.equal(communication.length,1);assert.equal(communication[0]?.session_id,sessionId);assert.equal(communication[0]?.conversation_principal_id,target.id);assert.equal(Number(communication[0]?.session_row_version),Number(selected.session_row_version)+1);
    const committed=rows(transferred.value.conversations);assert.equal(committed.length,1);assert.equal(committed[0]?.session_id,sessionId);assert.equal(committed[0]?.changed,true);assert.equal(committed[0]?.session_row_version,Number(selected.session_row_version)+1);assert.match(string(committed[0]?.control_event_id),/^[0-9a-f-]{36}$/u);
    const events=rows((await admin.get(path+'/events')).value.items),last=events.at(-1);assert.ok(last);assert.equal(last.event_type,'ticket.assignment_transferred');assert.equal(events.some(event=>['ticket.accepted','ticket.started'].includes(String(event.event_type))),false);
    assert.equal((await worker.get(path)).status,404,'Ticket transfer must not extend the original communicator\'s read scope');
  },{ticketAssignmentEnabled:true,ticketSelfHandlingWebSource:false});
});
