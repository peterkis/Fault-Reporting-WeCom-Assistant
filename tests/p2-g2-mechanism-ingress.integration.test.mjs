import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createRuleEngine } from '../src/p2-007-rule-engine.mjs';
import { g2BusinessCounts,g2CountDelta,g2DecisionObservation } from './helpers/p2-g2-gold-observation.mjs';
const corpus=readFileSync('tests/fixtures/p2-007/multichannel_decision_cases.v1.2.jsonl','utf8').trim().split(/\r?\n/u).map(JSON.parse);
const ids=[1,2,3,4,6,27,28,29,31,32,33,34].map(n=>'D12-'+String(n).padStart(3,'0'));
for(const id of ids)test('source mechanism via actual ingress: '+id,async t=>{
  const c=corpus.find(c=>c.case_id===id),input=c.input;
  await withG2Runtime(async f=>{
    const before=await g2BusinessCounts(f.pool);
    const texts=input.turns??(id==='D12-031'?[input.active_journey,input.new_turn]:[input.text??'']);
    const wireTexts=texts.map(text=>text||'@故障助手');
    const chatType=input.channel==='GROUP'?'group':'single',observations=[];
    let previous=null;
    for(const text of wireTexts){
      previous=await f.inbound(text,{chatType,messageType:text==='[图片]'?'image':'text'});
      if(id!=='D12-029'){
        const batch=await f.pump();assert.equal(batch.processed,1);
        observations.push(await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id}));
      }
    }
    if(id==='D12-004'){await f.runtime.assembly.handleFrame(previous.frame);await f.pump();}
    if(id==='D12-029'){const batch=await f.pump();assert.equal(batch.processed,1);
      observations.push(await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id}));}
    const delta=g2CountDelta(before,await g2BusinessCounts(f.pool));
    const expectedTickets=['D12-002','D12-004','D12-027'].includes(id)?0:id==='D12-031'?2:1;
    assert.equal(delta.tickets,expectedTickets);assert.equal(delta.inbox,texts.length);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.contact_journey')).rows[0].n,id==='D12-031'?2:1);
    if(['D12-001','D12-002','D12-003','D12-006'].includes(id)){
      const j=(await f.pool.query('SELECT entry_mode,origin_channel,current_channel FROM intake.contact_journey')).rows[0];
      assert.equal(j.entry_mode,c.expected.entry_mode);if(c.expected.origin_channel)assert.equal(j.origin_channel,c.expected.origin_channel);
    }
    if(id==='D12-002'||id==='D12-004')assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE target_type='PERSON'")).rows[0].n,0);
    if(id==='D12-029'){
      assert.equal(observations.length,1);assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM intake.safe_action_suggestion WHERE action_type='REQUEST_ONE_DESCRIPTION'")).rows[0].n<=1,true);
    }
    if(id==='D12-032'){
      const outbound=JSON.stringify((await f.pool.query('SELECT content FROM communication.message')).rows);
      assert.equal(outbound.includes('<PATIENT_REF>'),false);
      assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM channel.message_inbox WHERE privacy_class='PATIENT_SENSITIVE'")).rows[0].n,1);
    }
    if(id==='D12-033'){
      const versions=(await f.pool.query('SELECT safe_result FROM intake.deterministic_decision ORDER BY decision_ordinal')).rows;
      assert.equal(versions.length,2);assert.ok(versions[0].safe_result.known_fields.selected_service_code);
      assert.notEqual(versions[1].safe_result.known_fields.selected_service_code,versions[0].safe_result.known_fields.selected_service_code);
    }
    if(id==='D12-034'||id==='D12-006'){
      const evaluated=createRuleEngine().evaluate({text:texts.join('\n'),source_ref:'synthetic:'+id,observed_at:'2026-09-08 12:00:00'});
      assert.equal(evaluated.attempt_result,'FAILED');
      const outbound=JSON.stringify((await f.pool.query('SELECT content FROM communication.message')).rows);
      assert.equal(outbound.includes('重启'),false);
    }
    assert.equal(delta.incidents,0);assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:id,surface:'NORMAL_FRAME_FROM_SOURCE_INPUT',delta,observations,
      timing:'ORIGINAL_ORDER_NOT_FORMAL_ELAPSED_TIME',seeded_business_facts:false,provider_calls:0}));
  });
});
