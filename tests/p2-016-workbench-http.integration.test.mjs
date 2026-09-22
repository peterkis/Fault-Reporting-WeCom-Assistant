import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createP2016Runtime } from '../src/p2-016-runtime.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
import { withP2016IsolatedDatabase,applyThrough030 } from './helpers/p2-016-postgres-harness.mjs';
import { migrateP2016 } from '../scripts/p2-016-migrate.mjs';
async function port(){const p=createServer();await new Promise(r=>p.listen(0,'127.0.0.1',r));const n=p.address().port;await new Promise(r=>p.close(r));return n;}
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
      const bootstrap=await (await get('/api/lifecycle/bootstrap')).json();assert.equal(bootstrap.ai_enabled,false);
      assert.equal((await get('/api/tickets?token=forbidden')).status,401);
      assert.equal((await get('/api/tickets?limit=101')).status,400);
      assert.equal((await get('/api/reporter/bootstrap')).status,503);
      const page=await get('/workbench/lifecycle');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/u);
      const command={client_command_id:randomUUID(),expected_version:1,reason_code:'HTTP_TEST'};
      const post=(headers,body=command)=>fetch(origin+'/api/tickets/'+ticket.id+'/accept',{method:'POST',headers:{cookie,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"1"',origin,...headers},body:JSON.stringify(body)});
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
  }});
});
