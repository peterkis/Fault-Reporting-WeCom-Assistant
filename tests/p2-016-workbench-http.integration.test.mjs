import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createPilotAccessService } from '../app/server/src/p1-009-pilot-access-workbench.mjs';
import { createPilotTicketCore } from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import { createP2016Runtime } from '../app/server/src/p2-016-runtime.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../app/server/scripts/p2-016-migrate.mjs';
import { migrateWorkbenchAuth } from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import { migrateThirdPartyStaffDirectory } from '../app/server/scripts/p2-007-migrate.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
async function port(){const p=createServer();await new Promise(r=>p.listen(0,'127.0.0.1',r));const n=p.address().port;await new Promise(r=>p.close(r));return n;}
test('internal notes have an explicit internal-only HTTP contract and one durable receipt',async()=>{
  await withWeb01Fixture(async({origin,cookies,tickets,pool})=>{
    const ticketId=tickets[5].ticket.id;
    const get=path=>fetch(origin+path,{headers:{cookie:cookies[0]}});
    const bootstrap=await (await get('/api/lifecycle/bootstrap')).json();
    assert.equal(bootstrap.internal_notes_enabled,true);
    const before=await (await get('/api/tickets/'+ticketId)).json();
    assert.equal(before.version,2);assert.ok(before.allowed_actions.includes('add-note'));
    const command={client_command_id:randomUUID(),expected_version:2,reason_code:'WORKBENCH_INTERNAL_NOTE',note:'T02 internal synthetic canary',external_visible:false};
    const post=(body=command,headers={})=>fetch(origin+'/api/tickets/'+ticketId+'/internal-notes',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"'+body.expected_version+'"','x-csrf-token':bootstrap.csrf_token,...headers},body:JSON.stringify(body)});
    assert.equal((await post({...command,external_visible:true})).status,400);
    assert.equal((await post({...command,note:'  \n\t'})).status,400);
    assert.equal((await post({...command,note:'x'.repeat(2001)})).status,400);
    const {external_visible,...withoutAudience}=command;assert.equal((await post(withoutAudience)).status,400);
    assert.equal((await post({...command,extra:true})).status,400);
    assert.equal((await post(command,{'idempotency-key':randomUUID()})).status,400);
    assert.equal((await post(command,{'if-match':'"1"'})).status,409);
    assert.equal((await post(command,{'x-csrf-token':'invalid'})).status,403);
    assert.equal((await post(command,{origin:'https://attacker.invalid'})).status,403);
    const success=await post();assert.equal(success.status,200);const receipt=await success.json();assert.equal(receipt.ok,true);assert.equal(receipt.ticket_version,3);
    const replay=await (await post()).json();assert.deepEqual(replay,{...receipt,replayed:true});
    assert.equal((await post({...command,note:'changed payload'})).status,409);
    const after=await (await get('/api/tickets/'+ticketId)).json();assert.equal(after.version,3);assert.equal(after.status,before.status);assert.equal(after.assignee_id,before.assignee_id);
    const records=await (await get('/api/workbench/items/ticket/'+ticketId)).json();
    assert.equal(records.records.filter(r=>r.text===command.note&&r.audience==='INTERNAL').length,1);
    assert.deepEqual((await (await get('/api/tickets/'+ticketId+'/deliveries')).json()).items,[]);
    // The existing compatibility route is intentionally separate from the forced internal route.
    const legacy={...command,client_command_id:randomUUID(),expected_version:3,note:'T02 legacy external compatibility',external_visible:true};
    const compatibility=await fetch(origin+'/api/tickets/'+ticketId+'/notes',{method:'POST',headers:{cookie:cookies[0],origin,'content-type':'application/json','idempotency-key':legacy.client_command_id,'if-match':'"3"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(legacy)});
    assert.equal(compatibility.status,200);
    const access=createPilotAccessService({pool});
    await access.upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
    const readOnly=await (await get('/api/tickets/'+ticketId)).json();assert.equal(readOnly.version,4);assert.equal(readOnly.allowed_actions.includes('add-note'),false);
    assert.deepEqual(await (await post()).json(),{...receipt,replayed:true},'a currently readable receipt is read-only after loss of write permission');
    assert.equal((await post({...command,client_command_id:randomUUID(),expected_version:4})).status,403);
    await access.upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['HANDLER'],resolverTeamIds:[]});
    assert.equal((await post()).status,404,'object readability is rechecked before a stored receipt');
    await access.upsertPrincipal({wecomUserId:'web01-synthetic-0',displayName:'林舟',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    await pool.query("UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE wecom_user_id='web01-synthetic-0'");
    assert.ok([401,403].includes((await post()).status),'active identity is rechecked before a stored receipt');
  },{workbenchInternalNotesEnabled:true});
});
test('P2-016 actual HTTP assembly: fail-closed flags, auth, CSRF, Ticket actions and durable SSE',async()=>{
  assert.deepEqual(await createP2016Runtime().start(),{disabled:true});
  assert.throws(()=>createP2016Runtime({flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},gatewayEnabled:true}),{code:'P2_016_LIVE_APPROVAL_REQUIRED'});
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2016http',run:async({pool,databaseUrl})=>{
    await applyThrough030({pool,databaseUrl});await migrateP2016({databaseUrl});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'synthetic-p2016-http',displayName:'合成测试坐席',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const intake=await seedPersistedIntake({pool,text:'合成故障',requestType:'INCIDENT',status:'RECEIVED'});
    const ticket=(await createPilotTicketCore({pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'synthetic-http'})).ticket;
    const listenPort=await port(),origin='http://127.0.0.1:'+listenPort;
    const runtime=createP2016Runtime({pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,principalId:principal.id,listenPort,externalSendEnabled:false});
    let streamReader;const abort=new AbortController();
    try{
      const started=await runtime.start(),cookie=started.cookie.name+'='+started.cookie.value;
      const get=(path,headers={})=>fetch(origin+path,{headers:{cookie,...headers}});
      assert.equal((await fetch(origin+'/api/tickets')).status,401);
      const bootstrap=await (await get('/api/lifecycle/bootstrap')).json();assert.equal(bootstrap.ai_enabled,false);assert.equal(bootstrap.internal_notes_enabled,false);
      assert.equal((await get('/api/tickets?token=forbidden')).status,401);
      assert.equal((await get('/api/tickets?limit=101')).status,400);
      assert.equal((await get('/api/reporter/bootstrap')).status,503);
      const page=await get('/workbench/lifecycle');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/u);
      const command={client_command_id:randomUUID(),expected_version:1,reason_code:'HTTP_TEST'};
      const post=(headers,body=command)=>fetch(origin+'/api/tickets/'+ticket.id+'/accept',{method:'POST',headers:{cookie,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"1"',origin,...headers},body:JSON.stringify(body)});
      const disabledBody={...command,note:'T02 disabled synthetic note',external_visible:false};
      assert.equal((await fetch(origin+'/api/tickets/'+ticket.id+'/internal-notes',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':command.client_command_id,'if-match':'"1"','x-csrf-token':bootstrap.csrf_token},body:JSON.stringify(disabledBody)})).status,503);
      assert.equal((await post({})).status,403);
      assert.equal((await post({'x-csrf-token':bootstrap.csrf_token,origin:'https://attacker.invalid'})).status,403);
      assert.equal((await post({'x-csrf-token':bootstrap.csrf_token},{...command,extra:true})).status,400);
      const success=await post({'x-csrf-token':bootstrap.csrf_token});assert.equal(success.status,200,JSON.stringify(await success.clone().json()));
      const replay=await post({'x-csrf-token':bootstrap.csrf_token});assert.equal((await replay.json()).replayed,true);
      const detail=await (await get('/api/tickets/'+ticket.id)).json();assert.equal(detail.status,'ACCEPTED');assert.equal(typeof detail.updated_at,'string');
      const notifications=await (await get('/api/tickets/'+ticket.id+'/deliveries')).json();assert.equal(notifications.items.length,1);
      for(const action of ['retry','reconcile']){
        const body={client_command_id:randomUUID(),reason_code:'OPERATOR_VERIFIED',...(action==='reconcile'?{resolution:'CANCEL'}:{})};
        const denied=await fetch(`${origin}/api/tickets/${ticket.id}/deliveries/${notifications.items[0].delivery_id}/${action}`,{
          method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':body.client_command_id},body:JSON.stringify(body)});
        assert.equal(denied.status,403);
        assert.equal((await denied.json()).error.code,'WORKBENCH_EXTERNAL_SEND_DISABLED');
      }
      assert.deepEqual(await (await get('/api/tickets/'+ticket.id+'/deliveries')).json(),notifications);
      const events=(await pool.query("SELECT event_type,payload FROM conversation.realtime_event WHERE publisher_name='P2_016_WORKBENCH' ORDER BY event_id")).rows;
      assert.ok(events.some(e=>e.event_type==='ticket.command.committed'));assert.ok(events.some(e=>e.event_type==='ticket.notification.created'));
      assert.doesNotMatch(JSON.stringify(events),/synthetic-p2016-http|reporter_wecom_userid|target_id/u);
      const sse=await fetch(origin+'/api/realtime/events',{headers:{cookie},signal:abort.signal});assert.equal(sse.status,200);
      streamReader=sse.body.getReader();const chunk=await streamReader.read();assert.equal(chunk.done,false);
      const projected=await runtime.coordinator.runOnce();assert.equal(projected.failures,0,JSON.stringify(projected));
      const ready=await (await get('/health/ready')).json();assert.equal(ready.base_service_ready,true,JSON.stringify(ready));
      await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[principal.id]);
      assert.ok([401,403].includes((await get('/api/tickets')).status));
    }finally{abort.abort();await streamReader?.cancel().catch(()=>{});await runtime.stop();}
    assert.equal(runtime.server.listening,false);
    const directoryRuntime=createP2016Runtime({pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,principalId:principal.id,listenPort,externalSendEnabled:false,directoryStore:{}});
    try {
      await directoryRuntime.start();
      const missing=await (await fetch(origin+'/health/ready')).json();
      assert.equal(missing.base_service_ready,false);
      assert.equal(missing.checks.third_staff_directory_schema,false);
      await migrateWorkbenchAuth({databaseUrl});
      await migrateThirdPartyStaffDirectory({databaseUrl});
      const applied=await (await fetch(origin+'/health/ready')).json();
      assert.equal(applied.checks.third_staff_directory_schema,true);
    } finally { await directoryRuntime.stop(); }
  }});
});
