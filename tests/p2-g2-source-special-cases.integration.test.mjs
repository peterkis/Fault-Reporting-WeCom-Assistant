import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createRuleEngine } from '../src/p2-007-rule-engine.mjs';
import { buildFactProvenance } from '../src/p2-007-fact-provenance.mjs';
import { resolveFactConflicts } from '../src/p2-007-conflict-resolver.mjs';
import { validateG2SyntheticCorpus } from '../src/p2-g2-corpus-privacy.mjs';
import {g2DecisionObservation} from './helpers/p2-g2-gold-observation.mjs';
const corpus=readFileSync('tests/fixtures/p2-007/hospital-it-evaluation-corpus.v1.jsonl','utf8').trim().split(/\r?\n/u).map(JSON.parse);
const source=id=>corpus.find(c=>c.case_id===id);

test('C029 actual image without OCR asks for description, with no fabricated text or Ticket',async t=>{
  await withG2Runtime(async f=>{
    await f.inbound(source('P2-007-C029').turns[0].text,{chatType:'single',messageType:'image'});const batch=await f.pump();
    assert.equal(batch.results[0].result_code,'NEEDS_DESCRIPTION');
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,0);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM channel.message_inbox WHERE msg_type='image'")).rows[0].n,1);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:'P2-007-C029',surface:'NORMAL_IMAGE_WITHOUT_OCR',
      observation:await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id})}));
  });
});
test('C044 source has two trusted people, not three; each fault retains its own Ticket',async t=>{
  await withG2Runtime(async f=>{
    const c=source('P2-007-C044');
    const observations=[];
    for(const turn of c.turns){await f.inbound(turn.text,{reporter:turn.speaker==='REPORTER'?f.reporters[0]:f.reporters[1]});const batch=await f.pump();
      assert.equal(batch.processed,1);observations.push(await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id}));}
    await f.runtime.incidentExtension.runOnce();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,2);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.candidate_review')).rows[0].n,0);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:'P2-007-C044',surface:'NORMAL_TWO_REPORTER_CONTEXT',observations,distinct_reporters:2,tickets:2,candidates:0}));
  });
});
test('C054 real prior Ticket survives an authorized internal recovery note and Reporter still-failing reply',async t=>{
  await withG2Runtime(async f=>{
    // Explicit prerequisite, absent from original two-turn source. Setup is normal ingress, not a seeded Ticket.
    await f.inbound('门诊系统提交不了。',{chatType:'single'});await f.pump();
    const ticket=(await f.pool.query('SELECT id::text,status FROM pilot_ticket.ticket')).rows[0];
    const id=(await f.pool.query('SELECT id::text FROM conversation.session')).rows[0].id;
    let detail=await f.get('/api/conversations/'+id);
    const takeover=await f.post('/api/conversations/'+id+'/takeover',{client_command_id:randomUUID(),
      expected_row_version:detail.session.row_version,reason_code:'WORKBENCH_TAKEOVER',target_principal_id:f.admin.id});
    assert.equal(takeover.status,200);
    detail=await f.get('/api/conversations/'+id);
    const outboundBefore=(await f.pool.query('SELECT count(*)::integer AS n FROM communication.outbox')).rows[0].n;
    const note=await f.post('/api/conversations/'+id+'/internal-notes',{client_command_id:randomUUID(),
      expected_row_version:detail.session.row_version,text:source('P2-007-C054').turns[0].text});
    assert.equal(note.status,201);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM communication.outbox')).rows[0].n,outboundBefore);
    await f.inbound(source('P2-007-C054').turns[1].text,{chatType:'single'});const batch=await f.pump();assert.equal(batch.processed,1);
    const decisionId=batch.results[0].decision_id;
    const current=(await f.pool.query(`SELECT d.source_window_end_sequence,m.raw_text FROM intake.deterministic_decision d
      JOIN intake.service_intake_message rel ON rel.intake_id=d.service_intake_id AND rel.sequence_no=d.source_window_end_sequence
      JOIN channel.message_inbox m ON m.id=rel.channel_message_id WHERE d.id=$1`,[decisionId])).rows[0];
    assert.equal(current.raw_text,source('P2-007-C054').turns[1].text);assert.equal(Number(current.source_window_end_sequence),2);
    assert.equal(Number((await f.pool.query('SELECT count(*) FROM channel.message_inbox')).rows[0].count),2);
    const observation=await g2DecisionObservation({pool:f.pool,decisionId});assert.equal(observation.result_code,'TICKET_ELIGIBLE');
    assert.equal((await f.pool.query("SELECT result_ref_id=$2::text AS matches FROM intake.safe_action_suggestion WHERE decision_id=$1 AND action_type='CREATE_MINIMAL_TICKET'",[decisionId,ticket.id])).rows[0].matches,true);
    assert.deepEqual((await f.pool.query('SELECT id::text,status FROM pilot_ticket.ticket')).rows,[ticket]);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:'P2-007-C054',surface:'NORMAL_REPLY_WITH_AUTHENTICATED_INTERNAL_NOTE_PREREQUISITE',
      current_message_persisted:true,current_decision_covers_reply:true,existing_ticket_action_verified:true,observation}));
  });
});
test('C034 role-qualified conflicting service facts remain separate; no scope or Ticket is invented by the pure mechanism',()=>{
  const c=source('P2-007-C034'),engine=createRuleEngine(),at='2026-09-08 12:00:00';
  const reporter=engine.evaluate({text:c.turns[0].text,source_ref:'synthetic:reporter-question',observed_at:at});
  const operator=engine.evaluate({text:c.turns[1].text,source_ref:'synthetic:authorized-operator-observation',observed_at:at});
  const make=(kind,ref,value)=>buildFactProvenance({field_path:'service.selected_service_code',value,normalized_value:value,
    source_kind:kind,source_ref:ref,actor_ref:ref,observed_at:at,catalog_version:reporter.catalog_version,
    rule_set_version:reporter.rule_set_version,confidence:0.9});
  const facts=[make('REPORTER_EXPLICIT','reporter:synthetic',reporter.selected_service_code),
    make('HUMAN_OPERATOR_CONFIRMED','principal:synthetic','UNKNOWN')];
  const resolved=resolveFactConflicts({facts});
  assert.equal(resolved.conflict.requires_human,true);assert.equal(resolved.current_fact,null);assert.equal(resolved.facts.length,2);
  assert.ok(operator.symptom_codes.length>0);assert.equal(operator.incident_candidate,false);
  assert.deepEqual(operator.side_effects,[]);
});
test('C090 build-time corpus privacy executes provenance and identifier rejection, not a fake runtime Review',()=>{
  assert.match(source('P2-007-C090').notes,/构建期/u);
  const files=['hospital-it-evaluation-corpus.v1','hospital-it-multichannel-evaluation-corpus.v1','multichannel_decision_cases.v1.2'];
  const rows=files.flatMap(name=>readFileSync('tests/fixtures/p2-007/'+name+'.jsonl','utf8').trim().split(/\r?\n/u).map(JSON.parse));
  assert.equal(validateG2SyntheticCorpus(rows).checked,202);
  for(const text of ['联系13812345678','患者姓名张三','账号 user@example.org','内部服务10.23.45.67','https://hospital.example/patient'])
    assert.throws(()=>validateG2SyntheticCorpus([{case_id:'SYNTHETIC-REJECTION',source_kind:'PRODUCT_DECISION_SYNTHETIC',input:{text}}]),{code:'P2_G2_CORPUS_IDENTIFIER_REJECTED'});
  assert.throws(()=>validateG2SyntheticCorpus([{case_id:'MISSING-SOURCE',input:{text:'处方提交不了'}}]),{code:'P2_G2_CORPUS_PROVENANCE_REQUIRED'});
});
