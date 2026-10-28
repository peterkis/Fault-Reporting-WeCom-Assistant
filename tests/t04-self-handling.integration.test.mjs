import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {createP2016TicketQuery} from '../app/server/src/p2-016-ticket-query.mjs';
import {migrateTicketSelfHandling} from '../app/server/scripts/ticket-self-handling-migrate.mjs';
import {normalizeSelfHandlingCommand} from '../app/server/src/workbench-ticket-self-handling.mjs';
import {migrateWorkbenchAuth} from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {createWeComWorkbenchAuthentication} from '../app/server/src/p2-016-workbench-wecom-auth.mjs';

test('bounded public command normalization rejects private fields and active objects without invoking hooks',()=>{
  const input={action:'take-and-start',ticket_id:randomUUID(),client_command_id:randomUUID(),expected_version:1,reason_code:'TEST',resolver_team_id:'PILOT_IT'};
  assert.equal(normalizeSelfHandlingCommand({...input,ticket_id:input.ticket_id.toUpperCase()}).ticket_id,input.ticket_id);
  for(const patch of [{action:'start'},{expected_version:'1'},{expected_version:0},{expected_version:2147483648},{expected_version:NaN},{expected_version:1.5},{actor_id:randomUUID()},{target_principal_id:randomUUID()},{session_id:randomUUID()},{reason_code:'lower-case'},{resolver_team_id:'x'.repeat(65)},{note:'private'}])assert.throws(()=>normalizeSelfHandlingCommand({...input,...patch}),{code:'P2_016_INPUT_INVALID'});
  let invoked=0;const accessor=Object.defineProperty({...input},'actor',{enumerable:true,get(){invoked++;return null;}});
  assert.throws(()=>normalizeSelfHandlingCommand(accessor),{code:'P2_016_INPUT_INVALID'});assert.equal(invoked,0);
});

async function httpCommands({origin,cookies},index=0){
  const get=async path=>{const response=await fetch(origin+path,{headers:{cookie:cookies[index]}});return {status:response.status,value:await response.json()};};
  const bootstrap=(await get('/api/lifecycle/bootstrap')).value;
  const post=async(id,action,body,headers={})=>{const response=await fetch(origin+'/api/tickets/'+id+'/'+action,{method:'POST',headers:{cookie:cookies[index],origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"','x-csrf-token':bootstrap.csrf_token,...headers},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
  const command=(version=2)=>({client_command_id:randomUUID(),expected_version:version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT'});
  return {get,post,command};
}

test('Ticket-only self handling atomically accepts and starts in one identified HTTP command',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,principals,pool,databaseUrl})=>{
    const get=path=>fetch(origin+path,{headers:{cookie:cookies[0]}});
    const bootstrap=await (await get('/api/lifecycle/bootstrap')).json();
    assert.equal(bootstrap.ticket_self_handling_enabled,true);
    const ticketId=tickets[0].ticket.id,before=await (await get('/api/tickets/'+ticketId)).json();
    const readable=await get('/api/workbench/items/ticket/'+ticketId);
    assert.equal(readable.status,200,'a real no-session Web Ticket must be readable through the production detail HTTP contract');
    assert.ok((await readable.json()).records.some(record=>record.audience==='REPORT'&&record.text.includes('打印机')));
    assert.ok(before.allowed_actions.includes('take-and-start'));
    const body={client_command_id:randomUUID(),expected_version:before.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:before.resolver_team_id};
    const post=()=>fetch(origin+'/api/tickets/'+ticketId+'/take-and-start',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(body)});
    const response=await post();assert.equal(response.status,200);const receipt=await response.json();
    const after=await (await get('/api/tickets/'+ticketId)).json();
    assert.equal(after.status,'IN_PROGRESS');assert.equal(after.assignee_id,principals[0].id);assert.equal(after.version,4);
    assert.equal(after.intake_id,before.intake_id);assert.equal(after.handling_cycle.cycle_no,1);
    assert.deepEqual(after.handling_cycle,receipt.handling_cycle);
    assert.deepEqual(await (await post()).json(),{...receipt,replayed:true});
    const events=await (await get('/api/tickets/'+ticketId+'/events')).json();
    assert.deepEqual(events.items.slice(-2).map(e=>e.event_type),['ticket.accepted','ticket.started']);
    assert.deepEqual((await (await get('/api/tickets/'+ticketId+'/responsibility')).json()).conversations,[]);
    const basis=(await pool.query(`SELECT c.source_intake_id::text,c.first_responsibility_principal_id::text,c.first_responsibility_team_id,c.client_command_id::text,e.event_type,(SELECT count(*)::int FROM pilot_ticket.ticket_handling_cycle_event ce WHERE ce.cycle_id=c.id) AS links FROM pilot_ticket.ticket_handling_cycle c JOIN pilot_ticket.ticket_event e ON e.event_id=c.first_responsibility_event_id WHERE c.id=$1::uuid`,[after.handling_cycle.id])).rows[0];
    assert.deepEqual(basis,{source_intake_id:before.intake_id,first_responsibility_principal_id:principals[0].id,first_responsibility_team_id:'PILOT_IT',client_command_id:body.client_command_id,event_type:'ticket.accepted',links:2});
    const disabled=createP2016TicketQuery({pool,enabled:true});
    const oldView=await disabled.detail({authContext:{principal_id:principals[0].id},ticketId});
    assert.equal(Object.hasOwn(oldView,'handling_cycle'),false);assert.equal(oldView.assignee_id,after.assignee_id);assert.equal(oldView.version,after.version);
    assert.equal((await migrateTicketSelfHandling({databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
  },{ticketSelfHandlingEnabled:true});
});

test('competing actors and repeated original UUID produce one owner, cycle, and event chain',async()=>{
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context),b=await httpCommands(context,2),id=context.tickets[0].ticket.id;
    const contenders=await Promise.all([a.post(id,'take-and-start',a.command()),b.post(id,'take-and-start',b.command())]);
    assert.deepEqual(contenders.map(r=>r.status).sort(),[200,409]);
    const after=(await a.get('/api/tickets/'+id)).value;
    assert.equal(after.version,4);assert.ok([context.principals[0].id,context.principals[1].id].includes(after.assignee_id));
    const other=context.tickets[1].ticket.id,command=a.command();
    const repeated=await Promise.all(Array.from({length:12},()=>a.post(other,'take-and-start',command)));
    assert.ok(repeated.every(r=>r.status===200));assert.equal(repeated.filter(r=>!r.value.replayed).length,1);
    assert.equal(new Set(repeated.map(r=>r.value.handling_cycle.id)).size,1);
    for(const [action,body] of [['accept-for-later',command],['take-and-start',{...command,reason_code:'OTHER_REASON'}],['take-and-start',{...command,resolver_team_id:'OTHER_TEAM'}],['take-and-start',{...command,expected_version:3}]])assert.equal((await a.post(other,action,body)).status,409);
    assert.equal((await a.get('/api/tickets/'+other)).value.version,5);
    const cycles=await context.pool.query('SELECT ticket_id::text,count(*)::int FROM pilot_ticket.ticket_handling_cycle GROUP BY ticket_id');
    assert.equal(cycles.rows.length,2);assert.ok(cycles.rows.every(row=>row.count===1));
  },{ticketSelfHandlingEnabled:true});
});

test('current owner, membership, role and active team are enforced by query and locked HTTP write',async()=>{
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context),id=context.tickets[0].ticket.id;
    const verify=async code=>{assert.equal((await a.get('/api/tickets/'+id)).value.allowed_actions.includes('take-and-start'),false);const result=await a.post(id,'take-and-start',a.command());assert.equal(result.value.error.code,code);assert.equal((await a.get('/api/tickets/'+id)).value.version,2);};
    await context.pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$2::uuid WHERE id=$1::uuid',[id,context.principals[1].id]);
    await verify('P2_016_SELF_HANDLING_OWNER_CONFLICT');
    await context.pool.query("UPDATE pilot_ticket.ticket SET status='ACCEPTED' WHERE id=$1::uuid",[id]);await verify('P2_016_SELF_HANDLING_OWNER_CONFLICT');
    await context.pool.query("UPDATE pilot_ticket.ticket SET status='QUEUED' WHERE id=$1::uuid",[id]);
    await context.pool.query('UPDATE pilot_ticket.ticket SET assignee_id=NULL WHERE id=$1::uuid',[id]);
    await context.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid',[context.principals[0].id]);
    await verify('P2_016_FORBIDDEN');
    await context.pool.query('INSERT INTO pilot_ticket.pilot_team_member(principal_id,team_id) VALUES($1::uuid,$2)',[context.principals[0].id,'PILOT_IT']);
    await context.pool.query("UPDATE pilot_ticket.resolver_team SET is_active=false WHERE team_id='PILOT_IT'");await verify('P2_016_FORBIDDEN');
    await context.pool.query("UPDATE pilot_ticket.resolver_team SET is_active=true WHERE team_id='PILOT_IT'");
    assert.equal((await a.post(id,'take-and-start',{...a.command(),resolver_team_id:'OTHER_TEAM'})).status,403);
    const handler=await httpCommands(context,2),handlerId=context.tickets[1].ticket.id;
    await context.pool.query('DELETE FROM pilot_ticket.pilot_principal_role WHERE principal_id=$1::uuid',[context.principals[1].id]);
    assert.equal((await handler.post(handlerId,'take-and-start',handler.command())).status,401);
    await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[context.principals[0].id]);
    assert.equal((await a.post(id,'take-and-start',a.command())).status,401);
  },{ticketSelfHandlingEnabled:true});
});

test('unsupported and historical ACCEPTED states cannot invent a cycle or overwrite events',async()=>{
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context);
    for(const index of [2,3,5,6,7,9,12]){
      const id=context.tickets[index].ticket.id;
      await context.pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$2::uuid WHERE id=$1::uuid',[id,context.principals[0].id]);
      const before=(await a.get('/api/tickets/'+id)).value;
      assert.equal(before.handling_cycle,null);assert.equal(before.allowed_actions.includes('take-and-start'),false);
      const events=(await a.get('/api/tickets/'+id+'/events')).value;
      assert.equal((await a.post(id,'take-and-start',a.command())).status,409);
      assert.deepEqual((await a.get('/api/tickets/'+id)).value,before);assert.deepEqual((await a.get('/api/tickets/'+id+'/events')).value,events);
    }
    assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_handling_cycle')).rows[0].n,0);
  },{ticketSelfHandlingEnabled:true});
});

test('an actually projected Session newly bound through the canonical Journey closes Ticket-only eligibility',async()=>{
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context),id=context.tickets[0].ticket.id;
    assert.ok((await a.get('/api/tickets/'+id)).value.allowed_actions.includes('take-and-start'));
    await context.runtime.coordinator.runOnce();
    const session=(await context.pool.query('SELECT id,thread_id FROM conversation.session WHERE service_intake_id=$1::uuid',[context.waiting.intakeId])).rows[0];assert.ok(session);
    const journey=(await context.pool.query('SELECT journey_id,reporter_identity_hash FROM intake.channel_leg WHERE source_intake_id=$1::uuid',[context.tickets[0].intake.intakeId])).rows[0];assert.ok(journey);
    await context.pool.query(`INSERT INTO intake.channel_leg(journey_id,leg_ordinal,leg_type,source_intake_id,conversation_thread_id,conversation_session_id,provider_context_hash,channel_identity_hash,reporter_identity_hash,opened_at)
      VALUES($1::uuid,2,'DIRECT_ORGANIC',$2::uuid,$3::uuid,$4::uuid,$5,$5,$5,platform.local_now())`,[journey.journey_id,context.waiting.intakeId,session.thread_id,session.id,journey.reporter_identity_hash]);
    const result=await a.post(id,'take-and-start',a.command());assert.equal(result.status,409);assert.equal(result.value.error.code,'P2_016_SELF_HANDLING_CONVERSATION_REQUIRED');
    const after=(await a.get('/api/tickets/'+id)).value;assert.equal(after.version,2);assert.equal(after.handling_cycle,null);assert.equal(after.allowed_actions.includes('take-and-start'),false);
  },{ticketSelfHandlingEnabled:true});
});

test('DB failures after accept, cycle, event association and committed receipt roll back every business fact',async()=>{
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context),id=context.tickets[0].ticket.id;
    await context.runtime.coordinator.runOnce();
    await context.runtime.realtimeProjector.runOnce();
    const snapshot=async()=>({detail:(await a.get('/api/tickets/'+id)).value,events:(await a.get('/api/tickets/'+id+'/events')).value,deliveries:(await a.get('/api/tickets/'+id+'/deliveries')).value,
      counts:(await context.pool.query(`SELECT (SELECT count(*) FROM pilot_ticket.ticket_handling_cycle)::int AS cycles,(SELECT count(*) FROM pilot_ticket.ticket_handling_cycle_event)::int AS links,(SELECT count(*) FROM conversation.realtime_event WHERE aggregate_type='TICKET' AND aggregate_id::text=$1::text)::int AS realtime`,[id])).rows[0]});
    for(const [table,event,when] of [['pilot_ticket.ticket_handling_cycle','INSERT','true'],['pilot_ticket.ticket_event','INSERT',"NEW.event_type='ticket.started'"],['pilot_ticket.ticket_handling_cycle_event','INSERT','true'],['conversation.realtime_event','INSERT',"NEW.event_type='ticket.command.committed'"],['pilot_ticket.ticket_command_receipt','UPDATE',"NEW.state='COMMITTED'"]]){
      const before=await snapshot();
      await context.pool.query(`CREATE FUNCTION platform.t04_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'T04_TEST_FAILURE'; END $$`);
      await context.pool.query(`CREATE TRIGGER t04_failure BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION platform.t04_fail()`);
      const body=a.command(),failed=await a.post(id,'take-and-start',body);assert.equal(failed.status,503);assert.equal(failed.value.error.code,'P2_016_ACTION_FAILED');
      assert.deepEqual(await snapshot(),before);
      await context.pool.query(`DROP TRIGGER t04_failure ON ${table}`);await context.pool.query('DROP FUNCTION platform.t04_fail()');
      const replay=await a.post(id,'take-and-start',body);assert.equal(replay.status,503);assert.equal(replay.value.replayed,true);assert.deepEqual(await snapshot(),before);
      const receipt=(await context.pool.query('SELECT state,result_ticket_event_id FROM pilot_ticket.ticket_command_receipt WHERE client_command_id=$1::uuid',[body.client_command_id])).rows[0];assert.equal(receipt.state,'FAILED');assert.equal(receipt.result_ticket_event_id,null);
    }
    assert.equal((await a.post(id,'take-and-start',a.command())).status,200);
  },{ticketSelfHandlingEnabled:true});
});

test('default false never reads migration039 and missing039 enabled fails closed',async()=>{
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context),id=context.tickets[0].ticket.id;
    assert.equal((await a.get('/api/lifecycle/bootstrap')).value.ticket_self_handling_enabled,false);
    assert.equal((await context.pool.query("SELECT to_regclass('pilot_ticket.ticket_handling_cycle') AS t")).rows[0].t,null);
    assert.equal(Object.hasOwn((await a.get('/api/tickets/'+id)).value,'handling_cycle'),false);
    assert.equal((await a.post(id,'take-and-start',a.command())).status,503);
    assert.equal((await a.post(id,'accept',{client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_LEGACY'})).status,200);
    assert.equal((await a.post(id,'start',{client_command_id:randomUUID(),expected_version:3,reason_code:'WORKBENCH_LEGACY'})).status,200);
  });
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context),id=context.tickets[0].ticket.id;
    const readiness=await a.get('/health/ready');assert.equal(readiness.status,503);assert.equal(readiness.value.checks.ticket_self_handling_schema,false);
    assert.equal((await a.post(id,'take-and-start',a.command())).status,503);
    assert.equal((await context.pool.query('SELECT version,assignee_id FROM pilot_ticket.ticket WHERE id=$1::uuid',[id])).rows[0].version,2);
    assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows[0].n,0);
  },{ticketSelfHandlingEnabled:true,installTicketSelfHandlingSchema:false});
});

test('HTTP trust headers and exact numeric command validation precede all business writes',async()=>{
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context),id=context.tickets[0].ticket.id;
    for(const body of [{...a.command(),actor_id:randomUUID()},{...a.command(),target_principal_id:randomUUID()},{...a.command(),session_id:randomUUID()},{...a.command(),note:'private'},{...a.command(),expected_version:'2'},{...a.command(),expected_version:2.5},{...a.command(),client_command_id:'no-uuid'},{...a.command(),reason_code:'lowercase'}])assert.ok([400,409].includes((await a.post(id,'take-and-start',body)).status));
    for(const headers of [{origin:'https://not-authorized.invalid'},{'x-csrf-token':'wrong'},{'idempotency-key':randomUUID()},{'if-match':'"3"'}])assert.ok([400,403,409].includes((await a.post(id,'take-and-start',a.command(),headers)).status));
    assert.equal((await a.get('/api/tickets/'+id)).value.version,2);assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_handling_cycle')).rows[0].n,0);
  },{ticketSelfHandlingEnabled:true});
});

test('cycle schema separates a real round start from future empty responsibility and preserves first basis',async()=>{
  await withWeb01Fixture(async context=>{
    const a=await httpCommands(context),id=context.tickets[2].ticket.id;
    const cycle=(await context.pool.query(`INSERT INTO pilot_ticket.ticket_handling_cycle(ticket_id,cycle_no,source_intake_id,cycle_start_event_id,client_command_id)
      VALUES($1::uuid,2,$2::uuid,$3::uuid,$4::uuid) RETURNING id::text`,[id,context.tickets[2].intake.intakeId,context.tickets[2].event.event_id,randomUUID()])).rows[0];
    await context.pool.query('UPDATE pilot_ticket.ticket SET current_handling_cycle_id=$2::uuid WHERE id=$1::uuid',[id,cycle.id]);
    const reopened=(await a.get('/api/tickets/'+id)).value;assert.equal(reopened.handling_cycle.first_responsibility_event_id,null);assert.equal(reopened.allowed_actions.includes('take-and-start'),false);
    await assert.rejects(context.pool.query('UPDATE pilot_ticket.ticket_handling_cycle SET first_responsibility_principal_id=$2::uuid WHERE id=$1::uuid',[cycle.id,context.principals[0].id]),{code:'23514'});
    await assert.rejects(context.pool.query('UPDATE pilot_ticket.ticket SET current_handling_cycle_id=$2::uuid WHERE id=$1::uuid',[context.tickets[0].ticket.id,cycle.id]),{code:'23503'});
    // Only prepare the future lawful queued state in this isolated fixture; this test does not expose reopen/return commands.
    await context.pool.query("UPDATE pilot_ticket.ticket SET status='QUEUED',assignee_id=NULL WHERE id=$1::uuid",[id]);
    assert.equal((await a.post(id,'accept-for-later',a.command())).status,200);
    const accepted=(await a.get('/api/tickets/'+id)).value;assert.equal(accepted.handling_cycle.id,cycle.id);assert.equal(accepted.handling_cycle.cycle_no,2);assert.ok(accepted.handling_cycle.first_responsibility_event_id);
    await context.pool.query("UPDATE pilot_ticket.ticket SET status='QUEUED',assignee_id=NULL WHERE id=$1::uuid",[id]);
    assert.equal((await a.post(id,'take-and-start',a.command(3))).status,200);
    const again=(await a.get('/api/tickets/'+id)).value;assert.deepEqual(again.handling_cycle,accepted.handling_cycle);
    assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_handling_cycle WHERE ticket_id=$1::uuid',[id])).rows[0].n,1);
  },{ticketSelfHandlingEnabled:true});
});

test('a real Bot intake projected into an unassigned Session cannot be treated as Ticket-only',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,runtime})=>{
    await runtime.coordinator.runOnce();
    const get=path=>fetch(origin+path,{headers:{cookie:cookies[0]}});
    const id=tickets[0].ticket.id,bootstrap=await (await get('/api/lifecycle/bootstrap')).json();
    const responsibility=await (await get('/api/tickets/'+id+'/responsibility')).json();
    assert.ok(responsibility.conversations.some(s=>s.conversation_principal_id===null));
    const context=await (await get('/api/tickets/'+id)).json();assert.equal(context.allowed_actions.includes('take-and-start'),false);
    const body={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT'};
    const response=await fetch(origin+'/api/tickets/'+id+'/take-and-start',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"2"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(body)});
    assert.equal(response.status,409);assert.equal((await response.json()).error.code,'P2_016_SELF_HANDLING_CONVERSATION_REQUIRED');
    const after=await (await get('/api/tickets/'+id)).json();assert.equal(after.version,2);assert.equal(after.assignee_id,null);assert.equal(after.handling_cycle,null);
  },{ticketSelfHandlingEnabled:true,ticketSelfHandlingWebSource:false});
});

test('self-handling HTTP does not silently replace caller-supplied action or Ticket identity',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets})=>{
    const bootstrap=await (await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie:cookies[0]}})).json();
    const body={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT',action:'start',ticket_id:randomUUID()};
    const response=await fetch(origin+'/api/tickets/'+tickets[0].ticket.id+'/take-and-start',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"2"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(body)});
    assert.equal(response.status,400);
    const detail=await (await fetch(origin+'/api/tickets/'+tickets[0].ticket.id,{headers:{cookie:cookies[0]}})).json();
    assert.equal(detail.version,2);assert.equal(detail.status,'QUEUED');assert.equal(detail.handling_cycle,null);
  },{ticketSelfHandlingEnabled:true});
});


test('verified current employee name is the shared assignee label after real take-and-start HTTP',async()=>{
const origin='https://synthetic.test';
const recorder=()=>({status:null,headers:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(){}});
await withWeb01Fixture(async f=>{
 await migrateWorkbenchAuth({databaseUrl:f.databaseUrl,mode:'apply'});
 const principal=f.principals[0],id=f.tickets[0].ticket.id;
 await f.pool.query("UPDATE pilot_ticket.pilot_principal SET display_name='信息科工作人员' WHERE id=$1",[principal.id]);
 const others=(await f.pool.query('SELECT id,wecom_user_id,display_name,is_active FROM pilot_ticket.pilot_principal WHERE id<>$1 ORDER BY id',[principal.id])).rows;
 const raw=(await f.pool.query('SELECT wecom_user_id FROM pilot_ticket.pilot_principal WHERE id=$1',[principal.id])).rows[0].wecom_user_id;
 const auth=createWeComWorkbenchAuthentication({pool:f.pool,publicOrigin:origin,corpId:'synthetic-corp',agentId:'1000001',identityHashKey:'synthetic-assignee-identity-key',accessTokenProvider:async()=> 'synthetic-token',
  profileReader:async id=>({openUserId:id,displayName:'合成实际接单人',departmentName:'合成信息科',checkedEpochMs:String(Date.now())}),
  fetchImpl:async(url,init)=>url.pathname.endsWith('userid_to_openuserid')?Response.json({errcode:0,open_userid_list:JSON.parse(init.body).userid_list.map(userid=>({userid,open_userid:'open-'+userid}))}):Response.json({errcode:0,userid:'open-'+raw})});
 try{
  await auth.initialize();const start=recorder();await auth.unauthenticatedHandler({request:{method:'GET',headers:{}},response:start,url:new URL(origin+'/workbench/login')});
  const callback=recorder();await auth.unauthenticatedHandler({request:{method:'GET',headers:{cookie:start.headers['set-cookie'].map(v=>v.split(';')[0]).join('; ')}},response:callback,url:new URL(origin+'/workbench/callback?code=synthetic&state='+new URL(start.headers.location).searchParams.get('state'))});
  const context=await auth.authenticate({headers:{cookie:callback.headers['set-cookie'].map(v=>v.split(';')[0]).join('; ')}});assert.equal(context.principal_id,principal.id);
  const profile=await auth.currentDisplay(context);assert.equal(profile.name,'合成实际接单人');
  const get=async p=>{const r=await fetch(f.origin+p,{headers:{cookie:f.cookies[0]}});assert.equal(r.status,200);return r.json();};
  const boot=await get('/api/lifecycle/bootstrap'),before=await get('/api/tickets/'+id),command={client_command_id:randomUUID(),expected_version:before.version,reason_code:'WORKBENCH_SELF_HANDLING',resolver_team_id:'PILOT_IT'};
  const result=await fetch(f.origin+'/api/tickets/'+id+'/take-and-start',{method:'POST',headers:{cookie:f.cookies[0],origin:f.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"'+command.expected_version+'"','x-csrf-token':boot.csrf_token},body:JSON.stringify(command)});assert.equal(result.status,200);await result.arrayBuffer();
  const ticket=await get('/api/tickets/'+id),card=await get('/api/workbench/items/ticket/'+id);
  assert.equal(ticket.assignee_id,principal.id);assert.equal(card.item.assignee_name,profile.name);
  assert.deepEqual((await f.pool.query('SELECT id,wecom_user_id,display_name,is_active FROM pilot_ticket.pilot_principal WHERE id<>$1 ORDER BY id',[principal.id])).rows,others);
  assert.equal((await get('/api/tickets/'+id+'/responsibility')).ticket_assignee_name,profile.name);
 }finally{await auth.close();}
},{ticketSelfHandlingEnabled:true});

});
