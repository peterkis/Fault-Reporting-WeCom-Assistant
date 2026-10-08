import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import type {P2016EnabledRuntime} from '../src/p2-016-runtime.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {createContactJourneyStore} from '../src/p2-015-contact-journey.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
type Fixture={pool:PostgresPool;runtime:P2016EnabledRuntime;tickets:{ticket:{id:string};intake:{intakeId:string}}[];waiting:{intakeId:string};origin:string;cookies:string[];principals:{id:string}[]};
function object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function rows(value:unknown){assert.ok(Array.isArray(value));return value.map(object);}
function string(value:unknown):string{assert.equal(typeof value,'string');return value as string;}
async function drainKnownFixtureMaterial(context:Fixture){
  const initial=await context.runtime.coordinator.backlog(),bound=Math.ceil(initial.total/context.runtime.coordinator.batchSize)+3;
  for(let step=0;step<bound;step++){
    const inbound=await context.runtime.coordinator.runOnce(),material=await context.runtime.realtimeProjector.runOnce({limit:100});
    assert.ok(inbound.streams.every(stream=>stream.failures.length===0),'fixture material must not contain an isolated projection failure');
    const remaining=await context.runtime.coordinator.backlog();
    if(inbound.processed===0&&material.processed===0&&remaining.total===0){console.log('T05_FIXTURE_BASELINE '+JSON.stringify({initial_material:initial.total,batch_size:context.runtime.coordinator.batchSize,bounded_steps:step+1,inbound_remaining:remaining.total,realtime_remaining:material.processed}));return;}
  }
  assert.fail('the finite known fixture material did not complete its configured projection batches');
}
async function addRealRelatedSessions(context:Fixture,count=1){
  const ticket=context.tickets[0];assert.ok(ticket);
  const leg=(await context.pool.query<{journey_id:string;reporter_identity_hash:string;provider_context_hash:string;channel_identity_hash:string}>(`SELECT journey_id::text,reporter_identity_hash,provider_context_hash,channel_identity_hash FROM intake.channel_leg WHERE source_intake_id=$1::uuid`,[ticket.intake.intakeId])).rows[0];assert.ok(leg);
  const inputs=[];
  for(let n=0;n<count;n++)inputs.push(object(await seedPersistedIntake({pool:context.pool,text:'T05 true related synthetic continuation '+n,requestType:'INCIDENT',status:'RECEIVED'})));
  await drainKnownFixtureMaterial(context);
  const store=createContactJourneyStore(),sessions=[];
  for(const input of inputs){const session=(await context.pool.query<{id:string;thread_id:string;row_version:string}>(`SELECT id::text,thread_id::text,row_version::text FROM conversation.session WHERE service_intake_id=$1::uuid`,[input.intakeId])).rows[0];assert.ok(session);
    await store.ensureLeg({transaction:context.pool,input:{journey_id:leg.journey_id,leg_type:'GROUP_CONTINUATION',source_intake_id:string(input.intakeId),conversation_thread_id:session.thread_id,conversation_session_id:session.id,origin_channel_message_id:string(input.messageId),provider_context_hash:leg.provider_context_hash,channel_identity_hash:leg.channel_identity_hash,reporter_identity_hash:leg.reporter_identity_hash,opened_at:string(input.receivedAt)}});
    sessions.push({session_id:session.id,expected_row_version:Number(session.row_version)});
  }
  return sessions;
}
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
  },{ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true});
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

test('an expired opaque operation can read only its safe Ticket acknowledgement without the old session payload',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0];assert.ok(ticket);
    const id=ticket.ticket.id,a=await http(context),session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);
    const body={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:'TAKE_SELECTED',sessions:[{session_id:session.session_id,expected_row_version:Number(session.session_row_version)}]};
    const committed=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body);assert.equal(committed.status,200,JSON.stringify(committed.value));
    // Only the opaque operation identity survives the browser's sensitive-copy TTL.
    const ack=await a.get('/api/tickets/'+id+'/conversation-handling-commands/'+body.client_command_id);
    assert.equal(ack.status,200);
    assert.deepEqual(ack.value,{state:'COMMITTED',ticket_id:id,ticket_version:4,ticket_event_id:committed.value.ticket_event_id});
  },{ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true,workbenchDraftRecoveryEnabled:true});
});

test('an enabled related query fails closed when the required first responsibility schema is absent',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0];assert.ok(ticket);const a=await http(context);
    const response=await a.get('/api/tickets/'+ticket.ticket.id+'/related-conversations');
    assert.equal(response.status,503);assert.equal(object(response.value.error).code,'P2_016_SELF_HANDLING_UNAVAILABLE');
  },{ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true,installTicketSelfHandlingSchema:false});
});

const options={ticketSelfHandlingWebSource:false,ticketConversationSelfHandlingEnabled:true};
const completeProjectionOptions={...options,chronologicalTicketEvents:true};
const manualProjectionOptions={...completeProjectionOptions,manualProjection:true};
const body=(sessions:{session_id:string;expected_row_version:number}[]=[],choice='TAKE_SELECTED')=>({client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',communication_choice:choice,sessions});
test('real Journey legs list several identities and only the explicit subset changes while retain leaves the prior communicator',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0],other=context.tickets[1],actor=context.principals[0],communicator=context.principals[1];assert.ok(ticket&&other&&actor&&communicator);
    const a=await http(context),b=await http(context,2),extra=await addRealRelatedSessions(context,2),chosen=extra[0];assert.ok(chosen);
    const related=rows((await a.get('/api/tickets/'+ticket.ticket.id+'/related-conversations')).value.items);assert.equal(related.length,3);
    const result=await a.post('/api/tickets/'+ticket.ticket.id+'/take-and-start-with-conversations',body([chosen]));assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(rows(result.value.conversations).length,1);
    const truth=rows((await a.get('/api/tickets/'+ticket.ticket.id+'/responsibility')).value.conversations);assert.equal(truth.find(row=>row.session_id===chosen.session_id)?.conversation_principal_id,actor.id);assert.ok(truth.filter(row=>row.session_id!==chosen.session_id).every(row=>row.conversation_principal_id===null));
    const session=rows((await a.get('/api/tickets/'+other.ticket.id+'/related-conversations')).value.items)[0];assert.ok(session);
    const take={client_command_id:randomUUID(),expected_row_version:Number(session.session_row_version),reason_code:'T05_PRIOR_COMMUNICATOR'};assert.equal((await b.post('/api/conversations/'+session.session_id+'/takeover',take,take.expected_row_version)).status,200);
    const before=rows((await a.get('/api/tickets/'+other.ticket.id+'/related-conversations')).value.items);
    const retain=await a.post('/api/tickets/'+other.ticket.id+'/take-and-start-with-conversations',body([],'RETAIN_CURRENT'));assert.equal(retain.status,200,JSON.stringify(retain.value));assert.deepEqual(retain.value.conversations,[]);
    assert.deepEqual(rows((await a.get('/api/tickets/'+other.ticket.id+'/related-conversations')).value.items),before);assert.equal(before[0]?.conversation_principal_id,communicator.id);
  },manualProjectionOptions);
});

test('same communicator is a lawful no-op and exact BIGINT values remain non-operable above the write bridge',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0],other=context.tickets[1];assert.ok(ticket&&other);const a=await http(context),id=ticket.ticket.id;
    let session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);
    const take={client_command_id:randomUUID(),expected_row_version:Number(session.session_row_version),reason_code:'T05_SAME_COMMUNICATOR'};assert.equal((await a.post('/api/conversations/'+session.session_id+'/takeover',take,take.expected_row_version)).status,200);
    session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);
    const before=(await context.pool.query<{n:number}>('SELECT count(*)::int AS n FROM conversation.control_event WHERE session_id=$1::uuid',[session.session_id])).rows[0];
    const accepted=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body([{session_id:string(session.session_id),expected_row_version:Number(session.session_row_version)}]));assert.equal(accepted.status,200,JSON.stringify(accepted.value));assert.deepEqual(rows(accepted.value.conversations),[{session_id:session.session_id,session_row_version:Number(session.session_row_version),control_event_id:null,changed:false}]);
    assert.deepEqual((await context.pool.query('SELECT count(*)::int AS n FROM conversation.control_event WHERE session_id=$1::uuid',[session.session_id])).rows[0],before);
    const otherSession=rows((await a.get('/api/tickets/'+other.ticket.id+'/related-conversations')).value.items)[0];assert.ok(otherSession);
    for(const exact of ['2147483648','9007199254740993']){await context.pool.query('UPDATE conversation.session SET row_version=$2::bigint WHERE id=$1::uuid',[otherSession.session_id,exact]);const current:Record<string,unknown>|undefined=rows((await a.get('/api/tickets/'+other.ticket.id+'/related-conversations')).value.items)[0];assert.ok(current);assert.equal(current.session_row_version,exact);assert.equal(current.take_allowed,false);assert.equal((await a.post('/api/tickets/'+other.ticket.id+'/take-and-start-with-conversations',body([{session_id:string(current.session_id),expected_row_version:1}]))).status,409);}
    assert.equal((await a.get('/api/tickets/'+other.ticket.id)).value.version,2);
    await context.pool.query('UPDATE conversation.session SET row_version=2147483647 WHERE id=$1::uuid',[otherSession.session_id]);const boundary=await a.post('/api/tickets/'+other.ticket.id+'/accept-for-later-with-conversations',body([{session_id:string(otherSession.session_id),expected_row_version:2147483647}]));assert.equal(boundary.status,200,JSON.stringify(boundary.value));assert.equal(rows(boundary.value.conversations)[0]?.session_row_version,2147483648);
  },options);
});

test('a Ticket-readable handler cannot bypass independent assigned Conversation transfer authority and fresh versions',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0];assert.ok(ticket);const a=await http(context),handler=await http(context,2),id=ticket.ticket.id;
    const session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);
    const take={client_command_id:randomUUID(),expected_row_version:Number(session.session_row_version),reason_code:'T05_ADMIN_COMMUNICATOR'};assert.equal((await a.post('/api/conversations/'+session.session_id+'/takeover',take,take.expected_row_version)).status,200);
    const visible=await handler.get('/api/tickets/'+id);assert.equal(visible.status,200);const assigned=rows((await handler.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(assigned);assert.equal(assigned.take_allowed,false);
    const denied=await handler.post('/api/tickets/'+id+'/take-and-start-with-conversations',body([{session_id:string(assigned.session_id),expected_row_version:Number(assigned.session_row_version)}]));assert.equal(denied.status,403);assert.equal(object(denied.value.error).code,'P2_016_FORBIDDEN');
    assert.equal((await a.get('/api/tickets/'+id)).value.version,2);
    const stale=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body([{session_id:string(assigned.session_id),expected_row_version:1}]));assert.equal(stale.status,409);
    const foreign=context.tickets[1];assert.ok(foreign);const foreignSession=rows((await a.get('/api/tickets/'+foreign.ticket.id+'/related-conversations')).value.items)[0];assert.ok(foreignSession);assert.equal((await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body([{session_id:string(foreignSession.session_id),expected_row_version:Number(foreignSession.session_row_version)}]))).status,404);
    const retain=body([],'RETAIN_CURRENT');retain.expected_version=3;assert.equal((await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',retain)).status,409);assert.equal((await a.get('/api/tickets/'+id)).value.version,2);
  },options);
});

test('a failure after Ticket or the first selected Session or COMMITTED receipt rolls every business fact back',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0];assert.ok(ticket);const a=await http(context),id=ticket.ticket.id,selected=(await addRealRelatedSessions(context,2)).sort((x,y)=>x.session_id.localeCompare(y.session_id)),last=selected.at(-1);assert.ok(last);assert.match(last.session_id,/^[a-f0-9-]{36}$/u);
    await drainKnownFixtureMaterial(context);
    const ownSession=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items).map(row=>string(row.session_id));
    const snapshot=async()=>({ticket:(await a.get('/api/tickets/'+id)).value,events:(await a.get('/api/tickets/'+id+'/events')).value,responsibility:(await a.get('/api/tickets/'+id+'/responsibility')).value,deliveries:(await a.get('/api/tickets/'+id+'/deliveries')).value,
      sessions:(await context.pool.query('SELECT id::text,row_version::text,generation_version::text,control_mode FROM conversation.session WHERE id=ANY($1::uuid[]) ORDER BY id',[selected.map(row=>row.session_id)])).rows,
      targetRealtime:(await context.pool.query(`SELECT event_id::text,publisher_name,source_type,source_id,event_type,aggregate_type,aggregate_id::text,authorization_scope_id::text FROM conversation.realtime_event WHERE aggregate_id::text=$1::text OR authorization_scope_id=ANY($2::uuid[]) ORDER BY event_id`,[id,ownSession])).rows,
      counts:(await context.pool.query(`SELECT (SELECT count(*) FROM pilot_ticket.ticket_handling_cycle)::int AS cycles,(SELECT count(*) FROM pilot_ticket.ticket_handling_cycle_event)::int AS links,(SELECT count(*) FROM conversation.control_event)::int AS control,(SELECT count(*) FROM conversation.realtime_event)::int AS realtime`)).rows});
    for(const [table,operation,when] of [['pilot_ticket.ticket_handling_cycle','INSERT','true'],['conversation.control_event','INSERT',"NEW.session_id='"+last.session_id+"'::uuid"],['pilot_ticket.ticket_command_receipt','UPDATE',"NEW.state='COMMITTED'"]]){
      const before=await snapshot(),command=body(selected);let installed=false;
      try{await context.pool.query(`CREATE FUNCTION platform.t05_fail_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'T05_TEST_BOUNDARY_FAILURE'; END $$`);await context.pool.query(`CREATE TRIGGER t05_fail_boundary BEFORE ${operation} ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION platform.t05_fail_boundary()`);installed=true;
        const failed=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',command);assert.equal(failed.status,503);assert.equal(object(failed.value.error).code,'P2_016_ACTION_FAILED');assert.deepEqual(await snapshot(),before);
      }finally{if(installed)await context.pool.query(`DROP TRIGGER t05_fail_boundary ON ${table}`);await context.pool.query('DROP FUNCTION IF EXISTS platform.t05_fail_boundary()');}
      const replay=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',command);assert.equal(replay.status,503);assert.equal(replay.value.replayed,true);assert.deepEqual(await snapshot(),before);
      const audit=(await context.pool.query<{state:string;result_ticket_event_id:string|null;result_control_event_id:string|null}>('SELECT state,result_ticket_event_id::text,result_control_event_id::text FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[command.client_command_id])).rows[0];assert.deepEqual(audit,{state:'FAILED',result_ticket_event_id:null,result_control_event_id:null});
    }
    assert.equal((await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body(selected))).status,200);
  },manualProjectionOptions);
});

test('parallel same UUID commits once while other intents conflict and a safe Ack cannot disclose other scopes or command types',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0],other=context.tickets[1];assert.ok(ticket&&other);const a=await http(context),b=await http(context,2),id=ticket.ticket.id;
    const session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);const command=body([{session_id:string(session.session_id),expected_row_version:Number(session.session_row_version)}]);
    const repeats=await Promise.all(Array.from({length:3},()=>a.post('/api/tickets/'+id+'/take-and-start-with-conversations',command)));assert.ok(repeats.every(r=>r.status===200));assert.equal(repeats.filter(r=>r.value.replayed===false).length,1);assert.equal(new Set(repeats.map(r=>object(r.value.handling_cycle).id)).size,1);
    assert.equal((await a.post('/api/tickets/'+id+'/accept-for-later-with-conversations',command)).status,409);
    assert.equal((await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',{...command,reason_code:'DIFFERENT_INTENT'})).status,409);
    assert.equal((await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body(command.sessions))).status,409);
    const ackPath='/conversation-handling-commands/'+command.client_command_id;
    assert.deepEqual((await b.get('/api/tickets/'+id+ackPath)).value,{state:'UNKNOWN'});assert.deepEqual((await a.get('/api/tickets/'+other.ticket.id+ackPath)).value,{state:'UNKNOWN'});assert.deepEqual((await a.get('/api/tickets/'+id+'/conversation-handling-commands/'+randomUUID())).value,{state:'UNKNOWN'});
    const ackBefore=(await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows;assert.equal((await a.get('/api/tickets/'+id+ackPath)).value.state,'COMMITTED');assert.deepEqual((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows,ackBefore);
    const note={client_command_id:randomUUID(),expected_version:4,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T05 synthetic other-type privacy canary',external_visible:false};assert.equal((await a.post('/api/tickets/'+id+'/internal-notes',note)).status,200);assert.deepEqual((await a.get('/api/tickets/'+id+'/conversation-handling-commands/'+note.client_command_id)).value,{state:'UNKNOWN'});
    const failed=body([],'RETAIN_CURRENT');assert.equal((await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',failed)).status,409);const ack=(await a.get('/api/tickets/'+id+'/conversation-handling-commands/'+failed.client_command_id)).value;assert.deepEqual(ack,{state:'FAILED',error:{code:'P2_016_VERSION_CONFLICT',retryable:false}});
    await context.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[context.principals[0]?.id]);await context.pool.query("DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid AND role='ADMIN'",[context.principals[0]?.id]);
    assert.ok([401,404].includes((await a.get('/api/tickets/'+other.ticket.id+ackPath)).status));
  },{...options,workbenchDraftRecoveryEnabled:true,workbenchInternalNotesEnabled:true});
});

test('keyset pages cover more than the legacy hundred without guessing absence and cursor cannot cross Ticket scope',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0],other=context.tickets[1];assert.ok(ticket&&other);const a=await http(context),extra=await addRealRelatedSessions(context,101),seen=new Set<string>();let cursor:string|null=null;
    const first=await a.get('/api/tickets/'+ticket.ticket.id+'/related-conversations?limit=20');assert.equal(rows(first.value.items).length,20);assert.equal(typeof first.value.next_cursor,'string');assert.equal((await a.get('/api/tickets/'+other.ticket.id+'/related-conversations?cursor='+first.value.next_cursor)).status,400);
    do{const response=await a.get('/api/tickets/'+ticket.ticket.id+'/related-conversations?limit=20'+(cursor?'&cursor='+cursor:''));assert.equal(response.status,200);const page=rows(response.value.items);assert.ok(page.length<=20);for(const row of page){assert.ok(!seen.has(string(row.session_id)));seen.add(string(row.session_id));}cursor=response.value.next_cursor===null?null:string(response.value.next_cursor);}while(cursor);
    assert.equal(seen.size,102);assert.ok(extra.every(row=>seen.has(row.session_id)));assert.equal((await a.get('/api/tickets/'+ticket.ticket.id+'/related-conversations?limit=21')).status,400);
  },manualProjectionOptions);
});

test('default false avoids new schema queries and the original legacy accept route still works without039',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    const ticket=context.tickets[0];assert.ok(ticket);const a=await http(context),id=ticket.ticket.id,bootstrap=(await a.get('/api/lifecycle/bootstrap')).value;
    assert.equal(bootstrap.ticket_conversation_self_handling_enabled,false);assert.equal(bootstrap.ticket_conversation_draft_recovery_enabled,false);assert.equal((await a.get('/api/tickets/'+id+'/related-conversations')).status,503);
    assert.equal((await context.pool.query("SELECT to_regclass('pilot_ticket.ticket_handling_cycle') AS t")).rows[0]?.t,null);assert.equal(Object.hasOwn((await a.get('/api/tickets/'+id)).value,'handling_cycle'),false);
    assert.equal((await a.post('/api/tickets/'+id+'/accept',{client_command_id:randomUUID(),expected_version:2,reason_code:'T05_LEGACY_PROFILE'})).status,200);
  });
});

test('an ended canonical Session disappears from choices and a stale explicit reference changes no business fact',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0];assert.ok(ticket);const a=await http(context),id=ticket.ticket.id;
    const session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);
    await context.pool.query("UPDATE conversation.session SET status='ENDED',ended_at=platform.local_now(),close_reason='T05_SYNTHETIC_ENDED' WHERE id=$1::uuid",[session.session_id]);
    assert.deepEqual((await a.get('/api/tickets/'+id+'/related-conversations')).value,{items:[],next_cursor:null});
    const before={ticket:(await a.get('/api/tickets/'+id)).value,events:(await a.get('/api/tickets/'+id+'/events')).value,responsibility:(await a.get('/api/tickets/'+id+'/responsibility')).value};
    const denied=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body([{session_id:string(session.session_id),expected_row_version:Number(session.session_row_version)}]));assert.equal(denied.status,403);assert.equal(object(denied.value.error).code,'P2_016_FORBIDDEN');
    assert.deepEqual({ticket:(await a.get('/api/tickets/'+id)).value,events:(await a.get('/api/tickets/'+id+'/events')).value,responsibility:(await a.get('/api/tickets/'+id+'/responsibility')).value},before);
  },options);
});

test('a true Journey leg cannot borrow Ticket readability or a mismatched reporter identity',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0];assert.ok(ticket);const a=await http(context),handler=await http(context,2),id=ticket.ticket.id,extra=(await addRealRelatedSessions(context))[0];assert.ok(extra);
    assert.equal(rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items).length,2);assert.equal((await handler.get('/api/tickets/'+id)).status,200);
    assert.equal(rows((await handler.get('/api/tickets/'+id+'/related-conversations')).value.items).some(row=>row.session_id===extra.session_id),false);
    assert.equal((await handler.post('/api/tickets/'+id+'/take-and-start-with-conversations',body([extra]))).status,404);
    await context.pool.query('UPDATE intake.channel_leg SET reporter_identity_hash=$2 WHERE conversation_session_id=$1::uuid',[extra.session_id,'f'.repeat(64)]);
    assert.equal(rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items).length,1);
    assert.equal((await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body([extra]))).status,404);
    assert.equal((await a.get('/api/tickets/'+id)).value.version,2);assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_handling_cycle')).rows[0]?.n,0);
  },manualProjectionOptions);
});

test('fresh membership team role and principal govern composite writes while a safe Ticket Ack gives no lost Session read permission',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0],actor=context.principals[0],other=context.principals[1];assert.ok(ticket&&actor&&other);const a=await http(context),id=ticket.ticket.id;
    const session=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(session);const selected=[{session_id:string(session.session_id),expected_row_version:Number(session.session_row_version)}];
    const verify=async(status:number)=>{const denied=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',body(selected));assert.equal(denied.status,status);assert.equal((await context.pool.query('SELECT version,assignee_id FROM pilot_ticket.ticket WHERE id=$1::uuid',[id])).rows[0]?.version,2);assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_handling_cycle')).rows[0]?.n,0);};
    await context.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[actor.id]);await verify(403);
    await context.pool.query("INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES($1::uuid,'PILOT_IT')",[actor.id]);
    await context.pool.query("UPDATE pilot_ticket.resolver_team SET is_active=false WHERE team_id='PILOT_IT'");await verify(403);
    await context.pool.query("UPDATE pilot_ticket.resolver_team SET is_active=true WHERE team_id='PILOT_IT'");
    await context.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[actor.id]);await verify(401);
    await context.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'ADMIN')",[actor.id]);
    await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[actor.id]);await verify(401);
    await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=true WHERE id=$1::uuid',[actor.id]);
    const command=body(selected),committed=await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',command);assert.equal(committed.status,200);
    await context.pool.query('UPDATE conversation.assignment SET assigned_principal_id=$2::uuid WHERE session_id=$1::uuid',[session.session_id,other.id]);
    await context.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[actor.id]);await context.pool.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[actor.id]);await context.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[actor.id]);
    assert.equal((await a.get('/api/tickets/'+id)).status,200);assert.equal((await a.get('/api/conversations/'+session.session_id)).status,404);assert.equal((await a.post('/api/tickets/'+id+'/take-and-start-with-conversations',command)).status,404);
    const before=(await context.pool.query('SELECT count(*)::int AS n FROM conversation.control_event')).rows;
    assert.deepEqual((await a.get('/api/tickets/'+id+'/conversation-handling-commands/'+command.client_command_id)).value,{state:'COMMITTED',ticket_id:id,ticket_version:committed.value.ticket_version,ticket_event_id:committed.value.ticket_event_id});
    assert.deepEqual((await context.pool.query('SELECT count(*)::int AS n FROM conversation.control_event')).rows,before);
  },{...options,workbenchDraftRecoveryEnabled:true});
});

test('an Admin losing assigned-other transfer authority while the public command waits on its Ticket lock cannot keep the old privilege',async()=>{
  await withWeb01Fixture(async(context:Fixture)=>{
    await context.runtime.coordinator.runOnce();const ticket=context.tickets[0],actor=context.principals[0];assert.ok(ticket&&actor);const a=await http(context),b=await http(context,2),id=ticket.ticket.id;
    const source=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(source);
    const take={client_command_id:randomUUID(),expected_row_version:Number(source.session_row_version),reason_code:'T05_OTHER_COMMUNICATOR'};assert.equal((await b.post('/api/conversations/'+source.session_id+'/takeover',take,take.expected_row_version)).status,200);
    const assigned=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(assigned);assert.equal(assigned.take_allowed,true);
    const command=body([{session_id:string(assigned.session_id),expected_row_version:Number(assigned.session_row_version)}]),gate=await context.pool.connect();let pending:ReturnType<typeof a.post>|null=null;
    const snapshot=async()=>{const {allowed_actions,...ticketFacts}=(await a.get('/api/tickets/'+id)).value;assert.ok(Array.isArray(allowed_actions));return {ticket:ticketFacts,events:(await a.get('/api/tickets/'+id+'/events')).value,responsibility:(await a.get('/api/tickets/'+id+'/responsibility')).value};};
    const before=await snapshot();
    try{
      await gate.query('BEGIN');const gatePid=(await gate.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(gatePid);
      await gate.query('SELECT id FROM pilot_ticket.ticket WHERE id=$1::uuid FOR NO KEY UPDATE',[id]);pending=a.post('/api/tickets/'+id+'/take-and-start-with-conversations',command);
      let waitingPid:number|null=null;const until=Date.now()+5000;
      while(Date.now()<until){const observed=await context.pool.query<{pid:number;wait_event:string;query:string;blocking_pids:number[]}>("SELECT pid,wait_event,query,pg_blocking_pids(pid) AS blocking_pids FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF t%'");if(observed.rows.length===1){const trace=observed.rows[0];assert.ok(trace);waitingPid=trace.pid;assert.ok(trace.blocking_pids.includes(gatePid));console.log('T05_AUTHORITY_TICKET_LOCK_TRACE '+JSON.stringify({gate_pid:gatePid,...trace}));break;}await new Promise(resolve=>setTimeout(resolve,20));}
      assert.ok(waitingPid!==null,'the public composite must actually wait at the Ticket row lock');
      const role=await context.pool.connect();try{await role.query('BEGIN');await role.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[actor.id]);await role.query("INSERT INTO pilot_ticket.pilot_principal_role(principal_id,role) VALUES($1::uuid,'HANDLER')",[actor.id]);await role.query('COMMIT');}finally{await role.query('ROLLBACK');role.release();}
      assert.equal((await a.get('/api/tickets/'+id)).status,200);const current=rows((await a.get('/api/tickets/'+id+'/related-conversations')).value.items)[0];assert.ok(current);assert.equal(current.take_allowed,false);
      await gate.query('COMMIT');const denied=await pending;
      console.log('T05_AUTHORITY_RACE_DIAGNOSTIC '+JSON.stringify({blocked_http_pid:waitingPid,current_ticket_readable:true,current_transfer_allowed:current.take_allowed,status:denied.status,result:denied.value}));
      assert.equal(denied.status,403);assert.equal(object(denied.value.error).code,'P2_016_FORBIDDEN');
      assert.deepEqual(await snapshot(),before);
    }finally{await gate.query('ROLLBACK');gate.release();if(pending)await pending;}
  },completeProjectionOptions);
});
