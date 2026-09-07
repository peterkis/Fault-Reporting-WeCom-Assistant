import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { withP2012Database,applyThrough031,fixtureP2012 } from './helpers/p2-012-postgres-harness.mjs';
export async function freeP2012Port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
test('P2-012 actual HTTP inherits authentication, CSRF, command fence and durable realtime',async()=>{
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2012http',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:3}),candidate=await f.newCandidate(),port=await freeP2012Port(),origin='http://127.0.0.1:'+port;
    const runtime=createP2012Runtime({pool,principalId:f.admin.id,publicOrigin:origin,listenPort:port,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true}});
    let reader;const abort=new AbortController();
    try{
      const started=await runtime.start(),cookie=started.cookie.name+'='+started.cookie.value;
      const get=path=>fetch(origin+path,{headers:{cookie}});
      assert.equal((await fetch(origin+'/api/incident-candidates')).status,401);
      assert.equal((await get('/api/incidents?token=bad')).status,401);
      assert.equal((await get('/api/incident-candidates?limit=101')).status,400);
      assert.equal((await get('/workbench/incidents')).status,200);
      const bootstrap=await (await get('/api/lifecycle/bootstrap')).json();
      const candidateDetail=await (await get('/api/incident-candidates/'+candidate.id)).json();assert.equal(candidateDetail.source_decision.result_code,'INCIDENT_REVIEW_CANDIDATE');assert.equal(candidateDetail.report_sources.length,3);assert.ok(candidateDetail.report_sources.every(r=>r.journey_id));
      assert.equal(/reporter_identity_hash|reporter_wecom_userid|source_chat_id|clean_text/u.test(JSON.stringify(candidateDetail)),false);
      const command={client_command_id:randomUUID(),expected_row_version:'1',reason_code:'OPERATOR_REVIEWED'};
      const post=(headers={},body=command)=>fetch(origin+'/api/incident-candidates/'+candidate.id+'/start-review',{method:'POST',headers:{cookie,origin,'content-type':'application/json','idempotency-key':body.client_command_id,'if-match':'"1"',...headers},body:JSON.stringify(body)});
      assert.equal((await post()).status,403);
      assert.equal((await post({'x-csrf-token':bootstrap.csrf_token,origin:'https://attacker.invalid'})).status,403);
      const success=await post({'x-csrf-token':bootstrap.csrf_token});assert.equal(success.status,200,JSON.stringify(await success.clone().json()));
      assert.equal((await (await post({'x-csrf-token':bootstrap.csrf_token})).json()).replayed,true);
      assert.equal((await post({'x-csrf-token':bootstrap.csrf_token},{...command,raw_target:'forbidden'})).status,400);
      const events=(await pool.query("SELECT event_type,aggregate_version::text,payload FROM conversation.realtime_event WHERE publisher_name='P2_012_WORKBENCH'")).rows;
      assert.ok(events.some(e=>e.event_type==='incident.candidate.review_started'&&e.aggregate_version==='2'));
      assert.doesNotMatch(JSON.stringify(events),/reporter_identity_hash|target_id|reason_code|patient/u);
      const sse=await fetch(origin+'/api/realtime/events',{headers:{cookie},signal:abort.signal});assert.equal(sse.status,200);reader=sse.body.getReader();assert.equal((await reader.read()).done,false);
      const projected=await runtime.coordinator.runOnce();assert.equal(projected.failures,0,JSON.stringify(projected));
      const ready=await (await get('/health/ready')).json();assert.equal(ready.base_service_ready,true,JSON.stringify(ready));assert.equal(ready.ai_enhancement_ready,false);
    }finally{abort.abort();await reader?.cancel().catch(()=>{});await runtime.stop();}
    assert.equal(runtime.server.listening,false);
  }});
});
