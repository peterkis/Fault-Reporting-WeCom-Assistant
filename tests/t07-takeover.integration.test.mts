import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {P2016TakeoverCommand} from '../contracts/p2_016_takeover_contracts.js';

type Fixture={pool:PostgresPool;origin:string;cookies:string[];tickets:{ticket:{id:string}}[];principals:{id:string}[];runtime:{coordinator:{runOnce:()=>Promise<unknown>}}};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function version(value:unknown):number{assert.equal(typeof value,'number');assert.ok(Number.isInteger(value)&&Number(value)>0);return value as number;}
async function http(context:Fixture,index:number){
  const cookie=context.cookies[index];assert.ok(cookie);
  const get=async(path:string)=>{const response=await fetch(context.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
  const bootstrap=await get('/api/lifecycle/bootstrap');assert.equal(bootstrap.status,200);const csrf=string(bootstrap.value.csrf_token);
  const post=async(path:string,command:Readonly<Record<string,unknown>>)=>{
    const response=await fetch(context.origin+path,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':string(command.client_command_id),'if-match':'"'+version(command.expected_version)+'"'},body:JSON.stringify(command)});
    return {status:response.status,value:object(await response.json())};
  };
  return {get,post};
}

// SOURCE preparation only: this tracer has not run and is not yet observed RED.
test('a visible non-owner HANDLER takes the accepted Ticket into their actual active team while explicitly retaining communication and the first responsibility notice',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    const first=context.tickets[0],originalOwner=context.principals[0],actor=context.principals[1];assert.ok(first&&originalOwner&&actor);
    const targetTeam='T07_NETWORK';
    // Fixture authority only. Ticket, Conversation, cycle and notification changes below use public HTTP.
    await context.pool.query('INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES($1,$2)',[targetTeam,'T07 合成网络处理组']);
    const currentActor=await createPilotAccessService({pool:context.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['HANDLER'],resolverTeamIds:['PILOT_IT',targetTeam]});
    assert.equal(currentActor.id,actor.id);
    await context.runtime.coordinator.runOnce();
    const a=await http(context,0),b=await http(context,2),path='/api/tickets/'+first.ticket.id;
    const related=await a.get(path+'/related-conversations');assert.equal(related.status,200);
    const sessions=rows(related.value.items);assert.equal(sessions.length,1);const session=sessions[0];assert.ok(session);
    const initial=await a.get(path);assert.equal(initial.status,200);
    const accepted=await a.post(path+'/accept-for-later-with-conversations',{
      client_command_id:randomUUID(),expected_version:version(initial.value.version),reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',
      communication_choice:'TAKE_SELECTED',sessions:[{session_id:string(session.session_id),expected_row_version:Number(string(session.session_row_version))}]
    });
    assert.equal(accepted.status,200,JSON.stringify(accepted.value));
    const beforeRead=await b.get(path);assert.equal(beforeRead.status,200,'the non-owner already has current Ticket read scope');const before=beforeRead.value;
    assert.equal(before.status,'ACCEPTED');assert.equal(before.assignee_id,originalOwner.id);assert.equal(before.resolver_team_id,'PILOT_IT');
    const cycle=object(before.handling_cycle);assert.equal(cycle.cycle_no,1);assert.equal(typeof cycle.first_responsibility_event_id,'string');
    const responsibilityBefore=await a.get(path+'/responsibility');assert.equal(responsibilityBefore.status,200);
    const communications=rows(responsibilityBefore.value.conversations);assert.equal(communications.length,1);assert.equal(communications[0]?.conversation_principal_id,originalOwner.id);
    const eventsBefore=await a.get(path+'/events');assert.equal(eventsBefore.status,200);const priorEvents=rows(eventsBefore.value.items);
    const deliveriesBefore=await a.get(path+'/deliveries');assert.equal(deliveriesBefore.status,200);
    const notices=rows(deliveriesBefore.value.items);assert.equal(notices.filter(row=>row.notification_type==='TICKET_ACCEPTED').length,1,'an actual first responsibility promise must precede takeover');
    const command:P2016TakeoverCommand={client_command_id:randomUUID(),expected_version:version(before.version),reason_code:'WORKBENCH_TAKEOVER',resolver_team_id:targetTeam,communication_choice:'RETAIN_CURRENT',sessions:[]};
    const takeover=await b.post(path+'/takeover',command);
    assert.equal(takeover.status,200,JSON.stringify(takeover.value));assert.equal(takeover.value.ok,true);assert.equal(takeover.value.replayed,false);
    assert.equal(takeover.value.communication_choice,'RETAIN_CURRENT');assert.deepEqual(takeover.value.conversations,[]);assert.deepEqual(takeover.value.handling_cycle,cycle);
    const afterRead=await b.get(path);assert.equal(afterRead.status,200);const after=afterRead.value;
    assert.equal(after.status,'ACCEPTED');assert.equal(after.assignee_id,actor.id);assert.equal(after.resolver_team_id,targetTeam);assert.equal(after.version,version(before.version)+1);
    assert.equal(after.intake_id,before.intake_id);assert.deepEqual(after.handling_cycle,cycle);assert.equal(takeover.value.ticket_version,after.version);
    const eventsAfter=await a.get(path+'/events');assert.equal(eventsAfter.status,200);const events=rows(eventsAfter.value.items);
    assert.deepEqual(events.slice(0,priorEvents.length),priorEvents);assert.equal(events.length,priorEvents.length+1);
    const transferred=events.at(-1);assert.ok(transferred);assert.equal(transferred.event_type,'ticket.assignment_transferred');assert.equal(transferred.event_id,takeover.value.ticket_event_id);
    assert.equal(transferred.old_status,'ACCEPTED');assert.equal(transferred.new_status,'ACCEPTED');assert.equal(transferred.aggregate_version,after.version);
    assert.notEqual(transferred.event_id,cycle.first_responsibility_event_id);
    assert.deepEqual((await a.get(path+'/responsibility')).value.conversations,communications);
    assert.deepEqual((await a.get(path+'/deliveries')).value.items,notices,'same-cycle takeover creates no extra source notification promise');
    const replay=await b.post(path+'/takeover',command);assert.equal(replay.status,200,JSON.stringify(replay.value));assert.deepEqual(replay.value,{...takeover.value,replayed:true});
    assert.deepEqual((await b.get(path)).value,after);assert.deepEqual((await a.get(path+'/events')).value,eventsAfter.value);
    assert.deepEqual((await a.get(path+'/responsibility')).value.conversations,communications);assert.deepEqual((await a.get(path+'/deliveries')).value.items,notices);
  },{ticketTakeoverEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,chronologicalTicketEvents:true});
});
