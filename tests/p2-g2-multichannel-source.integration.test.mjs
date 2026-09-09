import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { g2BusinessCounts, g2CountDelta, g2DecisionObservation } from './helpers/p2-g2-gold-observation.mjs';

const oracle = JSON.parse(readFileSync('tests/fixtures/p2-g2/multichannel-adjudications.v1.json','utf8'));
const cases = oracle.records.filter(r => ['NORMAL_INGRESS','NORMAL_MULTI_REPORTER','NORMAL_MULTI_REPORTER_PLUS_PRIVACY_MECHANISM'].includes(r.execution_surface));
for (const source of cases) test('independent multichannel source: '+source.case_id, async t => {
  await withG2Runtime(async f => {
    const before = await g2BusinessCounts(f.pool), speakers=[...new Set(source.source_turns.map(turn=>turn.speaker))], observations=[];
    for(const [index,turn] of source.source_turns.entries()) {
      const reporter='synthetic-g2-source-'+speakers.indexOf(turn.speaker);
      await f.inbound(turn.text,{reporter,chatType:turn.channel==='WECOM_GROUP'?'group':'single',
        messageType:turn.text.includes('[图片]')?'image':'text'});
      const batch=await f.pump();assert.equal(batch.processed,1);
      const d=await g2DecisionObservation({pool:f.pool,decisionId:batch.results[0].decision_id});
      observations.push(d);
      if(source.case_id==='P2-007-X010'&&index===0)assert.equal((await g2BusinessCounts(f.pool)).tickets-before.tickets,0);
      if(source.case_id==='P2-007-X010'&&index===1)assert.equal((await g2BusinessCounts(f.pool)).tickets-before.tickets,1);
    }
    await f.runtime.incidentExtension.runOnce();
    const delta=g2CountDelta(before,await g2BusinessCounts(f.pool));
    if(source.expected_ticket_delta!==null)assert.equal(delta.tickets,source.expected_ticket_delta);
    if(source.case_id==='P2-007-X032') {
      for(const index of [0,1,3,4,5]) assert.ok(['TICKET_ELIGIBLE','MANUAL_REVIEW_REQUIRED'].includes(observations[index].result_code),'observable fault must be accepted');
      for(const index of [2,7])assert.ok(['NEEDS_DESCRIPTION','MANUAL_REVIEW_REQUIRED'].includes(observations[index].result_code),'vague object still needs clarification');
    } else assert.ok(source.allowed_normal_result_codes.includes(observations.at(-1).result_code));
    const candidates=(await f.pool.query('SELECT distinct_reporters,distinct_departments,distinct_locations FROM incident.candidate_review')).rows;
    assert.equal(candidates.length,source.incident_candidate_expected?1:0);
    if(candidates.length)assert.deepEqual(candidates[0],{distinct_reporters:3,distinct_departments:0,distinct_locations:0});
    if(source.review_requirement==='REQUIRED')assert.ok(delta.reviews>=1);
    const reviews=(await f.pool.query("SELECT id::text FROM intake.manual_review_item WHERE status='PENDING'")).rows;
    for(const review of reviews){
      const detail=await f.get('/api/manual-reviews/'+review.id);
      const result=await f.post('/api/manual-reviews/'+review.id+'/resolve',{client_command_id:randomUUID(),
        expected_row_version:detail.row_version,resolution_code:'REQUEST_DESCRIPTION',resolution_reason_code:'OPERATOR_REVIEWED'});
      assert.equal(result.status,200);assert.equal((await f.get('/api/manual-reviews/'+review.id)).status,'RESOLVED');
    }
    assert.equal(delta.incidents,0);assert.equal(f.providerCalls.length,0);
    t.diagnostic(JSON.stringify({source_case_id:source.case_id,surface:source.execution_surface,delta,observations,
      seeded_business_facts:false,timing:'SOURCE_ORDER_WITHIN_WINDOW_NOT_ORIGINAL_ELAPSED_OFFSETS',
      actual_review_handled:reviews.length,provider_calls:0,candidate_count:candidates.length}));
  });
});
