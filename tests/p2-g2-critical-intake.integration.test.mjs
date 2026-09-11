import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { g2BusinessCounts, g2CountDelta, g2DecisionObservation } from './helpers/p2-g2-gold-observation.mjs';

test('X035 explicit critical endpoint fault accepted from UNKNOWN Intake reaches a real human queue without a public Incident', async t => {
  const source = readFileSync('tests/fixtures/p2-007/hospital-it-multichannel-evaluation-corpus.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse).find(r => r.case_id === 'P2-007-X035');
  await withG2Runtime(async f => {
    const before = await g2BusinessCounts(f.pool);
    await f.inbound(source.turns[0].text, { chatType: 'single' });
    const intake = (await f.pool.query('SELECT request_type FROM intake.service_intake')).rows[0];
    assert.equal(intake.request_type, 'UNKNOWN');
    assert.equal((await g2BusinessCounts(f.pool)).tickets, 0);
    const batch = await f.pump(); assert.equal(batch.processed, 1);
    const observation = await g2DecisionObservation({ pool: f.pool, decisionId: batch.results[0].decision_id });
    assert.equal(observation.result_code, 'MANUAL_REVIEW_REQUIRED');
    const delta = g2CountDelta(before, await g2BusinessCounts(f.pool));
    assert.equal(delta.tickets, 1); assert.equal(delta.reviews, 1); assert.equal(delta.incidents, 0);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.candidate_review')).rows[0].n, 0);
    const review = (await f.pool.query('SELECT id::text,priority FROM intake.manual_review_item')).rows[0];
    assert.equal(review.priority, 'URGENT');
    const detail = await f.get('/api/manual-reviews/' + review.id);
    const resolved = await f.post('/api/manual-reviews/' + review.id + '/resolve', { client_command_id: randomUUID(),
      expected_row_version: detail.row_version, resolution_code: 'REQUEST_DESCRIPTION', resolution_reason_code: 'OPERATOR_REVIEWED' });
    assert.equal(resolved.status, 200); assert.equal((await f.get('/api/manual-reviews/' + review.id)).status, 'RESOLVED');
    assert.equal(f.providerCalls.length, 0);
    t.diagnostic(JSON.stringify({ case_id: source.case_id, declared_channel: 'DIRECT_FOR_SOURCE_WITHOUT_CHANNEL',
      persist_before_route: true, delta, observation, manual_review_handled: true, provider_calls: 0, seeded_business_facts: false }));
  });
});
