import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';

const source = readFileSync('tests/fixtures/p2-007/hospital-it-evaluation-corpus.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
const gold = readFileSync('tests/fixtures/p2-015/rule-first-safe-route-gold.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
const adjudications = readFileSync('tests/fixtures/p2-g2/gold-adjudications.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
// Original references remain immutable; owner-authorized adjudication has source-grounded reasons.
for (const caseId of ['P2-007-C001', 'P2-007-C007']) test('P2-G2 frozen gold through normal ingress: ' + caseId, async t => {
  const example = source.find(row => row.case_id === caseId);
  const expected = gold.find(row => row.source_fixture === 'hospital-it-evaluation-corpus.v1' && row.source_case_id === caseId);
  const adjudicated = adjudications.find(row => row.source_fixture === 'hospital-it-evaluation-corpus.v1' && row.source_case_id === caseId);
  assert.equal(adjudicated.original_expected_result_code, expected.expected_result_code);
  assert.equal(example.expected.domain_intent, 'INCIDENT_REPORT');
  assert.equal(example.turns.length, 1); assert.equal(example.turns[0].speaker, 'REPORTER');
  await withG2Runtime(async f => {
    await f.inbound(example.turns[0].text); const batch = await f.pump(); assert.equal(batch.processed, 1);
    const observed = (await f.pool.query(`SELECT d.result_code,d.reason_code,i.request_type,i.status AS intake_status,
      (SELECT count(*)::integer FROM pilot_ticket.ticket t WHERE t.source_intake_id=i.id) AS tickets,
      (SELECT count(*)::integer FROM intake.manual_review_item r WHERE r.decision_id=d.id) AS reviews,
      (SELECT count(*)::integer FROM intake.safe_action_suggestion a WHERE a.decision_id=d.id AND a.state='EXECUTED') AS executed_actions
      FROM intake.deterministic_decision d JOIN intake.service_intake i ON i.id=d.service_intake_id WHERE d.id=$1::uuid`, [batch.results[0].decision_id])).rows[0];
    t.diagnostic(JSON.stringify({ case_id: caseId, source_domain_intent: example.expected.domain_intent,
      frozen_result_code: expected.expected_result_code, frozen_ticket_expected: expected.ticket_expected,
      observed, provider_calls: f.providerCalls.length, test_type: 'REAL_POSTGRES_NORMAL_FRAME_INGRESS' }));
    assert.equal(observed.result_code, adjudicated.adjudicated_result_code, 'P2_G2_ADJUDICATED_GOLD_RESULT_MISMATCH');
    assert.equal(observed.tickets, adjudicated.ticket_expected ? 1 : 0, 'P2_G2_ADJUDICATED_GOLD_TICKET_MISMATCH');
  });
});
