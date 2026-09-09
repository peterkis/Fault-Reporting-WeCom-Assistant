import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withG2Runtime} from './helpers/p2-g2-runtime-harness.mjs';
import {generateIncidentCandidate} from '../src/p2-007-incident-candidate.mjs';
import {g2BusinessCounts} from './helpers/p2-g2-gold-observation.mjs';

test('X033/D12-046 trusted monitor mechanism is recommendation only; Reporter prose is not monitoring authority',async t=>{
  await withG2Runtime(async f=>{
    const before=await g2BusinessCounts(f.pool);
    const candidate=generateIncidentCandidate({authoritative_monitoring:true,service_family:'SYNTHETIC_CORE_SERVICE',
      symptom_family:'SERVICE_UNAVAILABLE',evidence_fact_ids:['fact_synthetic_monitor_reference'],reports:[]});
    assert.equal(candidate.is_candidate,true);assert.equal(candidate.distinct_reporters,0);
    assert.ok(candidate.reason_codes.includes('MONITORING_CORROBORATED'));
    assert.equal(candidate.human_confirmation_required,true);assert.equal(candidate.creates_incident,false);
    assert.deepEqual(await g2BusinessCounts(f.pool),before);
    await f.inbound('安全监控引用：核心服务不可用。',{chatType:'single'});await f.pump();await f.runtime.incidentExtension.runOnce();
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM incident.candidate_review')).rows[0].count),0);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM incident.incident')).rows[0].count),0);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_ids:['P2-007-X033','D12-046'],surface:'PURE_TRUSTED_MONITOR_SIMULATOR_WITH_NORMAL_PROSE_NEGATIVE',
      normal_monitor_ingress_implemented:false,monitor_business_delta:0,model_provider_calls:0,live_provider_calls:0}));
  });
});

test('X036 known Incident needs an explicit human link while new personal fault remains independently admitted',async t=>{
  await withG2Runtime(async f=>{
    for(const reporter of f.reporters){await f.inbound('测试诊室断网。',{chatType:'single',reporter});await f.pump();}
    await f.runtime.incidentExtension.runOnce();const candidate=(await f.get('/api/incident-candidates')).items[0];
    const base='/api/incident-candidates/'+candidate.id,command=version=>({client_command_id:randomUUID(),
      expected_row_version:String(version),reason_code:'OPERATOR_REVIEWED'});
    assert.equal((await f.post(base+'/start-review',command(candidate.row_version))).status,200);
    const detail=await f.get(base),confirmed=await f.post(base+'/confirm',{client_command_id:randomUUID(),
      expected_candidate_version:detail.row_version,reason_code:'OPERATOR_REVIEWED',confirmed_scope:'LOCAL',
      owner_principal_id:f.admin.id,selected_report_refs:detail.report_sources.map(r=>r.source_decision_id)},detail.row_version);
    assert.equal(confirmed.status,200);const id=confirmed.body.result_ref_id;
    const tickets=(await f.pool.query('SELECT id,status FROM pilot_ticket.ticket ORDER BY id')).rows;
    await f.inbound('当前已知公共故障仍在发生，我这里也受影响。',{chatType:'single',reporter:'synthetic-new-affected-reporter'});
    const batch=await f.pump();assert.equal(batch.processed,1);await f.runtime.incidentExtension.runOnce();
    const newDecision=batch.results[0].decision_id;
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM pilot_ticket.ticket')).rows[0].count),4);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM incident.incident')).rows[0].count),1);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM incident.candidate_review')).rows[0].count),1);
    assert.equal((await f.pool.query('SELECT 1 FROM incident.incident_report WHERE source_decision_id=$1',[newDecision])).rowCount,0);
    const current=await f.get('/api/incidents/'+id),link={...command(current.row_version),source_decision_id:newDecision};
    const linked=await f.post('/api/incidents/'+id+'/reports/link',link);assert.equal(linked.status,200);
    assert.equal((await f.post('/api/incidents/'+id+'/reports/link',link)).body.replayed,true);
    assert.equal((await f.pool.query('SELECT 1 FROM incident.incident_report WHERE source_decision_id=$1',[newDecision])).rowCount,1);
    assert.deepEqual((await f.pool.query('SELECT id,status FROM pilot_ticket.ticket WHERE id=ANY($1::uuid[]) ORDER BY id',[tickets.map(x=>x.id)])).rows,tickets);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:'P2-007-X036',surface:'NORMAL_WITH_CONFIRMED_INCIDENT_AND_HUMAN_COMMAND',
      personal_ticket_delta:1,automatic_link_count:0,human_link_count:1,new_candidate_count:0,provider_calls:0}));
  });
});
