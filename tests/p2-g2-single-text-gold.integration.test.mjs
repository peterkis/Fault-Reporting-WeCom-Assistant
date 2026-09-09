import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { adjudicateG2SingleText } from './helpers/p2-g2-text-gold-adjudication.mjs';
import { g2BusinessCounts, g2CountDelta, g2DecisionObservation } from './helpers/p2-g2-gold-observation.mjs';

const sources = readFileSync('tests/fixtures/p2-007/hospital-it-evaluation-corpus.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
const cases = sources.filter(s => s.turns.length === 1 && s.turns[0].speaker === 'REPORTER' && s.turns[0].text !== '[图片]'
  && adjudicateG2SingleText(s).surface === 'NORMAL_FRAME');
const adjudications = readFileSync('tests/fixtures/p2-g2/gold-adjudications.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
test('P2-G2 original single-Reporter texts reach their independently adjudicated safe route via real Inbox and Worker', { timeout: 120000 }, async t => {
  await withG2Runtime(async f => {
    for (const source of cases) await t.test(source.case_id, async sub => {
      const written = adjudications.filter(row => row.source_case_id === source.case_id);
      assert.equal(written.length, 1, 'P2_G2_ADJUDICATION_UNIQUE_REQUIRED');
      const expected = adjudicateG2SingleText(source), row = written[0];
      assert.deepEqual(row.acceptable_results, expected.results, 'P2_G2_ADJUDICATION_DRIFT');
      assert.equal(row.ticket_expected, expected.ticket); assert.equal(row.manual_review_expected, expected.review);
      const oracle = { results: row.acceptable_results, ticket: row.ticket_expected, review: row.manual_review_expected };
      const reporter = 'synthetic-g2-gold-' + source.case_id;
      const baseline = await g2BusinessCounts(f.pool);
      // Other Reporters may produce candidate-source decisions in the running extension.
      // Admission order is measured for this source Intake, not a global decision counter.
      const decisionsForReporter=async()=>(await f.pool.query(`SELECT count(*)::integer AS n
        FROM intake.deterministic_decision d JOIN intake.service_intake i ON i.id=d.service_intake_id
        WHERE i.reporter_wecom_userid=$1`,[reporter])).rows[0].n;
      assert.equal(await decisionsForReporter(),0);
      await f.inbound(source.turns[0].text, { reporter });
      assert.equal(await decisionsForReporter(),0);
      await f.pump();
      const facts = (await f.pool.query(`SELECT d.id,d.result_code,d.safe_result,
        (SELECT count(*)::integer FROM pilot_ticket.ticket t WHERE t.source_intake_id=i.id) AS tickets,
        (SELECT count(*)::integer FROM intake.manual_review_item r WHERE r.decision_id=d.id) AS reviews,
        (SELECT count(*)::integer FROM intake.safe_action_suggestion a WHERE a.decision_id=d.id AND a.state='EXECUTED') AS actions,
        (SELECT count(*)::integer FROM incident.incident) AS incidents
        FROM intake.service_intake i JOIN intake.deterministic_decision d ON d.service_intake_id=i.id
        WHERE i.reporter_wecom_userid=$1 AND d.engine_version<>'p2-012-candidate-source/1' ORDER BY d.decision_ordinal DESC LIMIT 1`, [reporter])).rows[0];
      assert.ok(facts);
      const observation = await g2DecisionObservation({ pool: f.pool, decisionId: facts.id });
      sub.diagnostic(JSON.stringify({ case_id: source.case_id, expected: oracle.results, result_code: facts.result_code,
        tickets: facts.tickets, reviews: facts.reviews, executed_actions: facts.actions, persist_before_route: true,
        seeded_business_facts: false, provider_calls: f.providerCalls.length, ...observation,
        delta: g2CountDelta(baseline, await g2BusinessCounts(f.pool)) }));
      assert.ok(oracle.results.includes(facts.result_code), 'P2_G2_ADJUDICATED_ROUTE_MISMATCH');
      assert.equal(facts.tickets, oracle.ticket ? 1 : 0, 'P2_G2_ACCEPTANCE_MISMATCH');
      if (oracle.review || ['MANUAL_REVIEW_REQUIRED', 'INCIDENT_REVIEW_CANDIDATE'].includes(facts.result_code))
        assert.equal(facts.reviews, 1, 'P2_G2_REQUIRED_REVIEW_MISSING');
      assert.ok(facts.actions > 0);
      assert.equal(facts.incidents, 0); assert.equal(f.providerCalls.length, 0);
      if (facts.reviews) {
        const review = (await f.pool.query('SELECT id FROM intake.manual_review_item WHERE decision_id=$1', [facts.id])).rows[0];
        const detail = await f.get('/api/manual-reviews/' + review.id);
        assert.equal(detail.status, 'PENDING');
        const resolved = await f.post('/api/manual-reviews/' + review.id + '/resolve', {
          client_command_id: randomUUID(), expected_row_version: detail.row_version,
          resolution_code: 'REQUEST_DESCRIPTION', resolution_reason_code: 'OPERATOR_REVIEWED',
        });
        assert.equal(resolved.status, 200); assert.equal(resolved.body.ok, true);
        const handled = await f.get('/api/manual-reviews/' + review.id);
        assert.equal(handled.status, 'RESOLVED'); assert.deepEqual(handled.safe_result, detail.safe_result);
        sub.diagnostic(JSON.stringify({ case_id: source.case_id, review_handled_via_http: true,
          resolution: 'REQUEST_DESCRIPTION', original_decision_preserved: true }));
      }
    });
  });
});
