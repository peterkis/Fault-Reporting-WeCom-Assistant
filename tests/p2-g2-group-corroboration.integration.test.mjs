import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';

const corpus=readFileSync('tests/fixtures/p2-007/hospital-it-evaluation-corpus.v1.jsonl','utf8').trim().split(/\r?\n/u).map(JSON.parse);
for(const id of ['P2-007-C030','P2-007-C031'])test('normal group corroboration keeps independent Ticket and source: '+id,async t=>{
  const source=corpus.find(c=>c.case_id===id);
  await withG2Runtime(async f=>{
    await f.inbound(source.turns[0].text,{reporter:f.reporters[0]});await f.pump();
    const short=await f.inbound(source.turns[1].text,{reporter:f.reporters[1]});const result=await f.pump();
    const d=(await f.pool.query('SELECT safe_result FROM intake.deterministic_decision WHERE id=$1',[result.results[0].decision_id])).rows[0].safe_result;
    assert.equal(d.result_code,'TICKET_ELIGIBLE');
    assert.equal(d.known_fields.selected_service_code,source.expected.selected_service_code);
    assert.ok(d.fact_provenance.some(f=>f.source_kind==='CONTEXT_INHERITANCE'));
    assert.equal(d.known_fields.scope,'UNKNOWN');
    assert.equal(d.corroboration_anchor.source_privacy_class,'PATIENT_SENSITIVE');
    assert.equal(d.group_corroboration_safety.eligible,false,'corroboration must not become a new root');
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,2);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,2);
    await f.runtime.assembly.handleFrame(short.frame);await f.pump();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,2);
    assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({case_id:id,source_intact:true,independent_tickets:2,independent_journeys:2,
      inherited_fields:['service.selected_service_code','fault.symptom_codes'],scope:'UNKNOWN',source_class_preserved:true,provider_calls:0}));
  });
});

test('group anchor isolation: none, private, incompatible, sensitive and negative context never inherit',async()=>{
  for(const scenario of [
    {roots:[]},
    {roots:[['门诊系统提交不了。','single']]},
    {roots:[['门诊系统提交不了。','group'],['测试诊室断网。','group']]},
    {roots:[['患者姓名测试占位符：门诊系统提交不了。','group']]},
    {roots:[['秘密测试内容：门诊系统提交不了。','group']]},
    {roots:[['门诊系统提交不了。','group']],reply:'不是同上'},
  ])await withG2Runtime(async f=>{
    for(const [i,[text,chatType]] of scenario.roots.entries()){await f.inbound(text,{chatType,reporter:'synthetic-root-'+i});await f.pump();}
    const before=(await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n;
    await f.inbound(scenario.reply??'+1',{reporter:'synthetic-new-reporter'});const batch=await f.pump();
    const d=(await f.pool.query('SELECT safe_result FROM intake.deterministic_decision WHERE id=$1',[batch.results[0].decision_id])).rows[0].safe_result;
    assert.equal(d.corroboration_anchor,undefined);assert.equal(d.ticket_creation_recommended,false);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,before);
    assert.equal(f.providerCalls.length,0);
  });
});

test('a corroborating Reporter never becomes a root for the next Reporter',async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('门诊系统提交不了。',{reporter:f.reporters[0]});const root=(await f.pump()).results[0].decision_id;
    await f.inbound('+1',{reporter:f.reporters[1]});await f.pump();
    await f.inbound('同上',{reporter:f.reporters[2]});const latest=(await f.pump()).results[0].decision_id;
    const d=(await f.pool.query('SELECT safe_result FROM intake.deterministic_decision WHERE id=$1',[latest])).rows[0].safe_result;
    assert.equal(d.corroboration_anchor.source_decision_id,root);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n,3);
  });
});
