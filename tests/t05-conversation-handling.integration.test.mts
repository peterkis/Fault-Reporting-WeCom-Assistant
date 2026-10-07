import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
type Fixture={pool:PostgresPool;runtime:P2016EnabledRuntime;tickets:{ticket:{id:string};intake:{intakeId:string}}[];waiting:{intakeId:string};origin:string;cookies:string[];principals:{id:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown){assert.ok(Array.isArray(value));return value.map(object);}
async function http(context:Fixture,index=0){
  const cookie=context.cookies[index];assert.ok(cookie);
  const get=async(path:string)=>{const response=await fetch(context.origin+path,{headers:{cookie}});return {status:response.status,value:object(await response.json())};};
  const bootstrap=(await get('/api/lifecycle/bootstrap')).value;assert.equal(typeof bootstrap.csrf_token,'string');
  const post=async(path:string,body:Record<string,unknown>,version=body.expected_version)=>{
    const response=await fetch(context.origin+path,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','idempotency-key':String(body.client_command_id),'if-match':'"'+version+'"','x-csrf-token':String(bootstrap.csrf_token)},body:JSON.stringify(body)});
    return {status:response.status,value:object(await response.json())};
  };
  return {get,post};
}

test('the real source Session can be explicitly selected for one atomic HTTP accept and start',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();
    const first=context.tickets[0],principal=context.principals[0];assert.ok(first&&principal);
    const id=first.ticket.id;
    const headers={cookie:context.cookies[0]};
    const get=async(path:string)=>{const response=await fetch(context.origin+path,{headers});return {status:response.status,value:object(await response.json())};};
    const related=await get('/api/tickets/'+id+'/related-conversations');
    assert.equal(related.status,200);
    assert.equal(rows(related.value.items).length,1);
    const session=rows(related.value.items)[0];assert.ok(session);
    assert.equal(typeof session.session_row_version,'string');
    assert.equal(session.take_allowed,true);
    const ticket=(await get('/api/tickets/'+id)).value;
    assert.ok(Array.isArray(ticket.allowed_actions)&&ticket.allowed_actions.includes('take-and-start-with-conversations'));
    const bootstrap=(await get('/api/lifecycle/bootstrap')).value;
    const command={client_command_id:randomUUID(),expected_version:ticket.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:ticket.resolver_team_id,communication_choice:'TAKE_SELECTED',sessions:[{session_id:session.session_id,expected_row_version:Number(session.session_row_version)}]};
    assert.equal(typeof bootstrap.csrf_token,'string');
    const response=await fetch(context.origin+'/api/tickets/'+id+'/take-and-start-with-conversations',{method:'POST',headers:{...headers,origin:context.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_version+'"','x-csrf-token':String(bootstrap.csrf_token)},body:JSON.stringify(command)});
    const receipt=object(await response.json());assert.equal(response.status,200,JSON.stringify(receipt));
    const after=(await get('/api/tickets/'+id)).value;
    assert.equal(after.status,'IN_PROGRESS');assert.equal(after.assignee_id,principal.id);
    assert.equal(object(after.handling_cycle).cycle_no,1);assert.deepEqual(receipt.handling_cycle,after.handling_cycle);
    const responsibility=(await get('/api/tickets/'+id+'/responsibility')).value;
    const assignment=rows(responsibility.conversations)[0],result=rows(receipt.conversations)[0];assert.ok(assignment&&result);
    assert.equal(assignment.conversation_principal_id,principal.id);
    assert.equal(result.changed,true);
  },{ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true});
});

test('current independent transfer authority can accept an assigned communicator directly to self',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();
    const ticket=context.tickets[0],communicator=context.principals[1],actor=context.principals[0];assert.ok(ticket&&communicator&&actor);
    const id=ticket.ticket.id,a=await http(context),b=await http(context,2);
    const initial=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(initial);
    const takeover={client_command_id:randomUUID(),expected_row_version:Number(initial.session_row_version),reason_code:'T05_PRIOR_COMMUNICATOR'};
    assert.equal((await b.post('/api/conversations/'+initial.session_id+'/takeover',takeover,takeover.expected_row_version)).status,200);
    const session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);
    assert.equal(session.conversation_principal_id,communicator.id);assert.equal(session.take_allowed,true);
    const body={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:session.session_id,expected_row_version:Number(session.session_row_version)}]};
    const accepted=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body);
    assert.equal(accepted.status,200,JSON.stringify(accepted.value));
    const assignment=rows((await a.get('/api/tickets/'+id+'/responsibility')).value.conversations)[0];assert.ok(assignment);
    assert.equal(assignment.conversation_principal_id,actor.id);
    assert.equal((await a.get('/api/tickets/'+id)).value.status,'IN_PROGRESS');
  },{ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true});
});

test('a standalone Conversation command competing with composite responsibility returns a domain conflict without a storage failure',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();
    const ticket=context.tickets[0];assert.ok(ticket);const id=ticket.ticket.id,a=await http(context),b=await http(context,2);
    const session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);
    assert.match(String(session.session_id),/^[a-f0-9-]{36}$/u);
    const gate=await context.pool.connect(),inflight:Promise<{status:number;value:Record<string,unknown>}>[]=[];
    let installed=false;
    try{
      await gate.query('SELECT pg_advisory_lock(9050605)');
      await context.pool.query(`CREATE FUNCTION platform.t05_control_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(9050605); RETURN NEW; END $$`);
      await context.pool.query(`CREATE TRIGGER t05_control_barrier BEFORE INSERT ON conversation.control_event FOR EACH ROW WHEN (NEW.session_id='${session.session_id}'::uuid AND NEW.event_type='ASSIGNMENT_ASSIGNED') EXECUTE FUNCTION platform.t05_control_barrier()`);installed=true;
      const waitForLocks=async(count:number)=>{
        const until=Date.now()+5000;
        while(Date.now()<until){
          const observed=await context.pool.query<{n:number}>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock'`);
          if((observed.rows[0]?.n??0)>=count)return;
          await new Promise(resolve=>setTimeout(resolve,20));
        }
        assert.fail('the bounded PG boundary barrier was not reached');
      };
      const takeover={client_command_id:randomUUID(),expected_row_version:Number(session.session_row_version),reason_code:'T05_COMPETING_COMMUNICATOR'};
      inflight.push(b.post('/api/conversations/'+session.session_id+'/takeover',takeover,takeover.expected_row_version));
      await waitForLocks(1);
      const body={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:session.session_id,expected_row_version:Number(session.session_row_version)}]};
      inflight.push(a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body));
      await waitForLocks(2);await gate.query('SELECT pg_advisory_unlock(9050605)');
      const results=await Promise.all(inflight);
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409],JSON.stringify(results));
    }finally{
      await gate.query('SELECT pg_advisory_unlock(9050605)');gate.release();
      await Promise.allSettled(inflight);
      if(installed)await context.pool.query('DROP TRIGGER t05_control_barrier ON conversation.control_event');
      await context.pool.query('DROP FUNCTION IF EXISTS platform.t05_control_barrier()');
    }
  },{ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true});
});
