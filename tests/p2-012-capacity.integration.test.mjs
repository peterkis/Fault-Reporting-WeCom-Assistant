import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { generateIncidentCandidate } from '../src/p2-007-incident-candidate.mjs';
import { createP2012IncidentCommandService } from '../src/p2-012-incident-command-service.mjs';
import { createP2012IncidentQuery } from '../src/p2-012-incident-query.mjs';
import { createP2012NotificationPolicy } from '../src/p2-012-notification-policy.mjs';
import { createP2012Runtime } from '../src/p2-012-workbench-assembly.mjs';
import { createCommunicationDeliveryWorker } from '../src/p2-004-communication-delivery-worker.mjs';
import { formatEpochMsToShanghaiLocal } from '../src/platform/time-contract.mjs';
import { migrateP2012 } from '../scripts/p2-012-migrate.mjs';
import { withP2012Database,applyThrough031,fixtureP2012,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
const make=(action,id,version,extra={})=>({action,client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',
  ...(['START_REVIEW','CONFIRM_INCIDENT'].includes(action)?{candidate_review_id:id}:{incident_id:id}),
  ...(action==='CONFIRM_INCIDENT'?{expected_candidate_version:version}:{expected_row_version:version}),...extra});

test('P2-012 real command capacity 500 candidates, 200 incidents, 2000 reports, 1000 subscriptions, 5000 events, 500 bindings and 32 SSE',{timeout:300000},async t=>{
  const samples=[process.memoryUsage().heapUsed],sample=()=>samples.push(process.memoryUsage().heapUsed);
  await withP2012Database({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'p2012cap',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await migrateP2012({databaseUrl});
    const f=await fixtureP2012(pool,{reporters:10,reporterGroupSize:2}),authContext={principal_id:f.admin.id};
    const notify=createP2012NotificationPolicy({enabled:true,publicEnabled:true,privateEnabled:true});
    const services=[createP2012IncidentCommandService({pool,enabled:true,notifications:notify}),createP2012IncidentCommandService({pool,enabled:true})];
    for(let i=0;i<500;i++){
      const at=formatEpochMsToShanghaiLocal(String(1788490800000n+BigInt(i)*1000n));
      const candidate=generateIncidentCandidate({service_family:'HIS',symptom_family:'LOGIN_FAILURE',reports:f.reports.map((r,n)=>({reporter_ref:r.reporterRef,department_ref:'department-'+n,location_ref:'location-'+n,observed_at:at,evidence_fact_ids:['fact_capacity_'+n]}))});
      const source=await f.sourceAdapter.record({sourceDecisionId:f.reports[0].decisionId,candidate,reportDecisionIds:f.reports.map(r=>r.decisionId)});
      const c=await f.store.importDecision({decisionId:source.id});
      if(i<200){
        const service=services[i<25?0:1],run=command=>service.perform({authContext,command});
        assert.equal((await run(make('START_REVIEW',c.id,'1'))).ok,true);
        const confirmed=await run(make('CONFIRM_INCIDENT',c.id,'2',{confirmed_scope:'LOCAL',owner_principal_id:f.admin.id,selected_report_refs:f.reports.map(r=>r.decisionId)}));
        assert.equal(confirmed.ok,true,JSON.stringify(confirmed));let version='1';
        for(const action of ['START_INVESTIGATING','RESOLVE_INCIDENT','CLOSE_INCIDENT']){const r=await run(make(action,confirmed.result_ref_id,version));assert.equal(r.ok,true,JSON.stringify(r));version=r.result_row_version;}
      }
      if(i%50===49)sample();
    }
    const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM incident.candidate_review) AS candidates,(SELECT count(*)::int FROM incident.incident) AS incidents,
      (SELECT count(*)::int FROM incident.incident_report) AS reports,(SELECT count(*)::int FROM incident.reporter_subscription) AS subscriptions,
      (SELECT count(*)::int FROM incident.incident_event) AS events,(SELECT count(*)::int FROM communication.incident_notification_binding) AS bindings`)).rows[0];
    t.diagnostic(JSON.stringify({capacity_counts:counts}));
    assert.equal(counts.candidates,500);assert.equal(counts.incidents,200);assert.equal(counts.reports,2000);assert.equal(counts.subscriptions,1000);assert.ok(counts.events>=5000);assert.ok(counts.bindings>=500);
    const query=createP2012IncidentQuery({pool,enabled:true});
    for(const [kind,total]of [['candidate',500],['incident',200]]){let after=null;const ids=new Set();do{const p=await query.list({authContext,kind,after});assert.ok(p.items.length<=30);for(const r of p.items){assert.equal(ids.has(r.id),false);ids.add(r.id);}after=p.next_cursor;}while(after);assert.equal(ids.size,total);}
    const epoch=(await pool.query('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0].epoch;let clock=BigInt(epoch);
    const delivery=createCommunicationDeliveryWorker({pool,enabled:true,nowEpochMs:()=>String(clock),sender:{send:async()=>({outcome:'ACKNOWLEDGED',provider_message_id:null,error_code:null,retryable:false})}});
    let sent=0;for(let n=0;n<100;n++){clock+=60000n;const r=await delivery.runOnce();sent+=r.processed;if(!r.processed)break;}assert.equal(sent,counts.bindings);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM communication.delivery WHERE status<>'SENT'")).rows[0].n,0);
    const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const listenPort=probe.address().port;await new Promise(r=>probe.close(r));
    const origin='http://127.0.0.1:'+listenPort,runtime=createP2012Runtime({pool,principalId:f.admin.id,publicOrigin:origin,listenPort,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true}}),streams=[];
    try{const started=await runtime.start(),cookie=started.cookie.name+'='+started.cookie.value;
      for(let n=0;n<32;n++){const controller=new AbortController(),response=await fetch(origin+'/api/realtime/events',{headers:{cookie},signal:controller.signal});assert.equal(response.status,200);const reader=response.body.getReader(),stream={controller,reader,bytes:0,endedUnexpectedly:false,error:null};
        // Capacity clients consume replay like EventSource; a non-reader tests the separate slow-client policy.
        stream.draining=(async()=>{try{for(;;){const part=await reader.read();if(part.done){if(!controller.signal.aborted)stream.endedUnexpectedly=true;break;}stream.bytes+=part.value.byteLength;}}catch(e){if(!controller.signal.aborted)stream.error=e.name;}})();streams.push(stream);}
      const extra=await fetch(origin+'/api/realtime/events',{headers:{cookie}});assert.equal(extra.status,503);assert.equal((await extra.json()).fallback.reason,'CAPACITY_REACHED');sample();
    }finally{for(const s of streams){s.controller.abort();await s.reader.cancel().catch(()=>{});await s.draining;}await runtime.stop();}
    assert.ok(streams.every(s=>!s.endedUnexpectedly&&!s.error),JSON.stringify(streams.map(s=>({ended:s.endedUnexpectedly,error:s.error,bytes:s.bytes}))));
    assert.equal(runtime.server.listening,false);assert.equal((await runtime.observability.metrics()).sse_clients,0);assert.equal(pool.options.max,4);
    global.gc?.();sample();const peak=Math.max(...samples),last=samples.at(-1);assert.ok(peak<256*1024*1024);assert.ok(peak>last||peak-samples[0]<16*1024*1024);
    t.diagnostic(JSON.stringify({...counts,notification_sent:sent,pool_max:4,sse_max:32,sse_after_stop:0,heap_samples_bytes:samples,heap_peak_bytes:peak,heap_final_bytes:last,real_sdk_calls:0,model_calls:0}));
  }});t.diagnostic(JSON.stringify({cleanup:await assertNoP2012Residual({databaseUrl:process.env.PILOT_DATABASE_URL})}));
});
