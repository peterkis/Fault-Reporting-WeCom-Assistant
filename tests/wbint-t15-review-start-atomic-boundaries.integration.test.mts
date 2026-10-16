import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {appendReviewMaterial} from './helpers/wbint-t14-review-material.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import type {ReviewResolveAndStartCommand} from '../contracts/workbench_review_start_contracts.js';

interface Fixture {pool:PostgresPool;runtime:P2016EnabledRuntime;origin:string;cookies:string[];principals:{id:string}[];tickets:{ticket:{id:string};intake:{intakeId:string}}[];processReviewIntake:(id:string)=>Promise<unknown>}
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown):Record<string,unknown>[]{assert.ok(Array.isArray(value));return value.map(object);}
function text(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
function version(value:unknown):number{assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>0);return value;}
async function project(f:Fixture){const initial=await f.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/f.runtime.coordinator.batchSize)+3;for(let n=0;n<bound;n++){const inbound=await f.runtime.coordinator.runOnce(),material=await f.runtime.realtimeProjector.runOnce({limit:100});assert.ok(inbound.streams.every(stream=>stream.failures.length===0));if(!inbound.processed&&!material.processed&&(await f.runtime.coordinator.backlog()).total===0)return;}assert.fail('bounded fixture projection did not settle');}
async function http(f:Fixture,index=0){const cookie=f.cookies[index];assert.ok(cookie);const get=async(path:string)=>{const response=await fetch(f.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};const session=await get('/api/lifecycle/bootstrap');assert.equal(session.status,200);const post=async(path:string,body:ReviewResolveAndStartCommand)=>{const response=await fetch(f.origin+path,{method:'POST',headers:{cookie,origin:f.origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_row_version+'"','x-csrf-token':text(session.value.csrf_token)},body:JSON.stringify(body)});return {status:response.status,value:object(await response.json())};};return {get,post,session};}
async function capture(f:Fixture,reviewId?:string){const a=await http(f),known=f.tickets[0];assert.ok(known);const item=await a.get('/api/workbench/items/ticket/'+known.ticket.id);assert.equal(item.status,200);const id=reviewId??text(rows(item.value.review_refs)[0]?.id),path='/api/manual-reviews/'+id;const review=await a.get(path),context=await a.get(path+'/resolve-and-start-context');assert.equal(review.status,200);assert.equal(context.status,200);const basis=object(review.value.material_basis);assert.equal(basis.stale,false);const command:ReviewResolveAndStartCommand={client_command_id:randomUUID(),expected_row_version:text(review.value.row_version),expected_material_basis:text(basis.current_hash),resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'HUMAN_CONFIRMED',expected_ticket:context.value.expected_ticket===null?null:{ticket_id:text(object(context.value.expected_ticket).ticket_id),expected_version:version(object(context.value.expected_ticket).expected_version)},resolver_team_id:context.value.resolver_team_id===null?'PILOT_IT':text(context.value.resolver_team_id),communication_choice:'RETAIN_CURRENT',sessions:[]};return {a,id,path,command,review:review.value,context:context.value};}
async function snapshot(f:Fixture,ticketId:string,reviewId:string){return {ticket:(await f.pool.query('SELECT status,version,assignee_id::text,resolver_team_id FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticketId])).rows,events:(await f.pool.query('SELECT event_id::text,event_type,aggregate_version FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid ORDER BY event_ordinal',[ticketId])).rows,review:(await f.pool.query('SELECT status,row_version::text,resolution_command_id::text FROM intake.manual_review_item WHERE id=$1::uuid',[reviewId])).rows,assignments:(await f.pool.query('SELECT session_id::text,assigned_principal_id::text,assignment_version::text FROM conversation.assignment ORDER BY session_id')).rows};}
const profile={workbenchManualReviewEnabled:true,workbenchReviewResolveAndStartEnabled:true,ticketSelfHandlingEnabled:true,ticketConversationSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false};

test('T15 rejects stale selected Session capture atomically and does not leak a partial Review or Ticket start',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{await project(f);const c=await capture(f),known=f.tickets[0];assert.ok(known);const related=await c.a.get('/api/tickets/'+known.ticket.id+'/related-conversations'),session=rows(related.value.items)[0];assert.ok(session);
    const command={...c.command,communication_choice:'TAKE_SELECTED' as const,sessions:[{session_id:text(session.session_id),expected_row_version:Number(session.session_row_version)}]};
    assert.equal((await f.pool.query('UPDATE conversation.session SET row_version=row_version+1 WHERE id=$1::uuid',[session.session_id])).rowCount,1);
    const before=await snapshot(f,known.ticket.id,c.id),result=await c.a.post(c.path+'/resolve-and-start',command);console.log('T15_ATOMIC_BOUNDARY '+JSON.stringify({kind:'SESSION_CAS',status:result.status,body:result.value}));assert.equal(result.status,409);assert.deepEqual(await snapshot(f,known.ticket.id,c.id),before);
  },profile);
});
test('T15 rejects new material, changed original UUID body and wrong captured Ticket without changing business facts',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{await project(f);const c=await capture(f),known=f.tickets[0],other=f.tickets[1];assert.ok(known&&other);const before=await snapshot(f,known.ticket.id,c.id);
    const wrong=await c.a.post(c.path+'/resolve-and-start',{...c.command,expected_ticket:{ticket_id:other.ticket.id,expected_version:2}});assert.equal(wrong.status,409);assert.deepEqual(await snapshot(f,known.ticket.id,c.id),before);
    const changed=await c.a.post(c.path+'/resolve-and-start',{...c.command,resolution_reason_code:'CHANGED_BODY_SAME_UUID'});assert.equal(changed.status,409);assert.deepEqual(await snapshot(f,known.ticket.id,c.id),before);
    await appendReviewMaterial(f.pool,known.intake.intakeId,'T15 new actual fault evidence after the operator captured its earlier basis');await project(f);
    const prior=await snapshot(f,known.ticket.id,c.id),stale=await c.a.post(c.path+'/resolve-and-start',{...c.command,client_command_id:randomUUID()});assert.equal(stale.status,409);assert.deepEqual(await snapshot(f,known.ticket.id,c.id),prior);
  },profile);
});
test('T15 competing actors and different UUIDs create exactly one Review resolution and one first responsibility',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{await project(f);const access=createPilotAccessService({pool:f.pool});await access.upsertPrincipal({wecomUserId:'web01-synthetic-1',displayName:'陈悦',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});const c=await capture(f),b=await http(f,2),known=f.tickets[0];assert.ok(known);
    const results=await Promise.all([c.a.post(c.path+'/resolve-and-start',c.command),b.post(c.path+'/resolve-and-start',{...c.command,client_command_id:randomUUID()})]);console.log('T15_ATOMIC_BOUNDARY '+JSON.stringify({kind:'DIFFERENT_ACTOR_UUID',results}));assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
    const resolutions=await f.pool.query<{n:number}>('SELECT count(*)::int AS n FROM intake.manual_review_item WHERE id=$1::uuid AND status=\'RESOLVED\' AND resolution_command_id IS NOT NULL',[c.id]);assert.equal(resolutions.rows[0]?.n,1);
    const cycles=await f.pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid',[known.ticket.id]);assert.equal(cycles.rows[0]?.n,1);
    const commit=await f.pool.query<{n:number}>(`SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt WHERE review_id=$1::uuid AND command_type='MANUAL_REVIEW_START' AND state='COMMITTED'`,[c.id]);assert.equal(commit.rows[0]?.n,1);
  },profile);
});
test('T15 new confirmed fault creates a unique minimum Ticket in the explicitly selected effective nondefault group',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{await project(f);await f.pool.query("INSERT INTO pilot_ticket.resolver_team(team_id,display_name) VALUES('T15_NETWORK','合成网络组')");await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['ADMIN'],resolverTeamIds:['PILOT_IT','T15_NETWORK']});
    const intake=object(await seedPersistedIntake({pool:f.pool,text:'网络交换机故障，整个合成病区网络已中断。人工已经核实为明确故障。',requestType:'INCIDENT',status:'RECEIVED'}));await project(f);await f.processReviewIntake(text(intake.intakeId));await project(f);
    const review=(await f.pool.query<{id:string}>('SELECT id::text FROM intake.manual_review_item WHERE service_intake_id=$1::uuid AND status=\'PENDING\' ORDER BY created_at DESC,id DESC LIMIT 1',[intake.intakeId])).rows[0];assert.ok(review);const c=await capture(f,review.id);assert.equal(c.context.expected_ticket,null);assert.ok(rows(c.context.resolver_teams).some(team=>team.team_id==='T15_NETWORK'));
    const command={...c.command,resolver_team_id:'T15_NETWORK'},result=await c.a.post(c.path+'/resolve-and-start',command);console.log('T15_ATOMIC_BOUNDARY '+JSON.stringify({kind:'NEW_NONDEFAULT_TEAM',status:result.status,body:result.value}));assert.equal(result.status,200);
    const ticketId=text(result.value.ticket_id),current=await c.a.get('/api/tickets/'+ticketId);assert.equal(current.status,200);assert.equal(current.value.resolver_team_id,'T15_NETWORK');assert.equal(current.value.status,'IN_PROGRESS');assert.equal(current.value.assignee_id,f.principals[0]?.id);
    const replay=await c.a.post(c.path+'/resolve-and-start',command);assert.equal(replay.status,200);assert.equal(replay.value.replayed,true);assert.equal(replay.value.ticket_id,ticketId);
    assert.equal((await f.pool.query<{n:number}>('SELECT count(*)::int AS n FROM pilot_ticket.ticket WHERE source_intake_id=$1::uuid',[intake.intakeId])).rows[0]?.n,1);
  },profile);
});
test('T15 original COMMITTED ACK and explicit replay both require current original-purpose authority',async()=>{
  await withWeb01Fixture(async(f:Fixture)=>{await project(f);const c=await capture(f);assert.equal((await c.a.post(c.path+'/resolve-and-start',c.command)).status,200);const receiptPath=c.path+'/resolve-and-start/commands/'+c.command.client_command_id;assert.equal((await c.a.get(receiptPath)).value.state,'COMMITTED');
    const known=f.tickets[0];assert.ok(known);const before=await snapshot(f,known.ticket.id,c.id);await createPilotAccessService({pool:f.pool}).upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['REPORTER'],resolverTeamIds:['PILOT_IT']});
    // REPORTER has lost the existing Workbench session boundary itself: the
    // official HTTP layer returns 401 before this purpose's domain handler.
    assert.equal((await c.a.get(receiptPath)).status,401);assert.equal((await c.a.post(c.path+'/resolve-and-start',c.command)).status,401);assert.deepEqual(await snapshot(f,known.ticket.id,c.id),before);
  },profile);
});
test('T15 default-off and missing self-handling schema close only the new public capability',async()=>{
  for(const missing of [false,true])await withWeb01Fixture(async(f:Fixture)=>{await project(f);const a=await http(f),known=f.tickets[0];assert.ok(known);const item=await a.get('/api/workbench/items/ticket/'+known.ticket.id),id=text(rows(item.value.review_refs)[0]?.id);assert.equal((await a.get('/api/manual-reviews/'+id)).status,200);assert.equal((await a.get('/api/tickets/'+known.ticket.id)).status,200);assert.equal((await a.get('/api/manual-reviews/'+id+'/resolve-and-start-context')).status,503);assert.equal(a.session.value.manual_review_resolve_and_start_enabled,missing);}, {...profile,chronologicalTicketEvents:true,workbenchReviewResolveAndStartEnabled:missing,ticketSelfHandlingEnabled:!missing,ticketConversationSelfHandlingEnabled:false,installTicketSelfHandlingSchema:!missing});
});
