import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { g2BusinessCounts, g2CountDelta, g2DecisionObservation } from './helpers/p2-g2-gold-observation.mjs';
import { adjudicateG2MultiText } from './helpers/p2-g2-text-gold-adjudication.mjs';

const sources = readFileSync('tests/fixtures/p2-007/hospital-it-evaluation-corpus.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
const cases = sources.filter(s => s.turns.length > 1 && s.turns.every(t => t.speaker === 'REPORTER'));

const written = readFileSync('tests/fixtures/p2-g2/gold-adjudications.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse);

test('original same-Reporter fragments use normal media/text Frames and one persistent Direct Session', { timeout: 120000 }, async t => {
  await withG2Runtime(async f => {
    for (const source of cases) await t.test(source.case_id, async sub => {
      const expected = adjudicateG2MultiText(source), reporter = 'synthetic-g2-multiturn-' + source.case_id;
      const adjudications = written.filter(r => r.source_case_id === source.case_id);
      assert.equal(adjudications.length, 1);
      assert.deepEqual(adjudications[0].acceptable_results, expected.results);
      assert.equal(adjudications[0].ticket_expected, expected.ticket);
      let firstTicketId;
      const before = await g2BusinessCounts(f.pool), decisions = [];
      for (const turn of source.turns) {
        const count = (await f.pool.query('SELECT count(*)::integer AS n FROM intake.deterministic_decision')).rows[0].n;
        await f.inbound(turn.text, { reporter, chatType: 'single', messageType: turn.text === '[图片]' ? 'image' : 'text' });
        assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM intake.deterministic_decision')).rows[0].n, count);
        const batch = await f.pump(); assert.equal(batch.processed, 1);
        if (expected.first_turn_ticket_required && decisions.length === 0) {
          assert.equal((await g2BusinessCounts(f.pool)).tickets - before.tickets, 1, 'P2_G2_FIRST_FAULT_MUST_ALREADY_BE_ACCEPTED');
          firstTicketId = (await f.pool.query(`SELECT t.id::text FROM pilot_ticket.ticket t JOIN intake.service_intake i ON i.id=t.source_intake_id
            WHERE i.reporter_wecom_userid=$1`, [reporter])).rows[0].id;
        }
        const decisionId = batch.results[0].decision_id;
        decisions.push({ decision_id: decisionId, ...await g2DecisionObservation({ pool: f.pool, decisionId }) });
      }
      const delta = g2CountDelta(before, await g2BusinessCounts(f.pool));
      sub.diagnostic(JSON.stringify({ case_id: source.case_id, source_fixture: 'hospital-it-evaluation-corpus.v1',
        expected, delta, actual: decisions, persist_before_route: true, provider_calls: f.providerCalls.length,
        seeded_business_facts: false, timing: 'ORIGINAL_ORDER_WITHIN_WINDOW_NOT_ELAPSED_TIME_ACCEPTANCE' }));
      assert.equal(delta.inbox, source.turns.length); assert.equal(delta.intakes, 1);
      assert.equal(delta.tickets, expected.ticket ? 1 : 0); assert.equal(delta.incidents, 0);
      assert.ok(expected.results.includes(decisions.at(-1).result_code), 'P2_G2_MULTI_TURN_ROUTE_MISMATCH');
      const rows = (await f.pool.query(`SELECT DISTINCT j.id::text,j.linked_ticket_id::text,t.status
        FROM intake.service_intake i JOIN intake.channel_leg l ON l.source_intake_id=i.id
        JOIN intake.contact_journey j ON j.id=l.journey_id LEFT JOIN pilot_ticket.ticket t ON t.id=j.linked_ticket_id
        WHERE i.reporter_wecom_userid=$1`, [reporter])).rows;
      assert.equal(rows.length, 1);
      if (expected.ticket) assert.ok(rows[0].linked_ticket_id);
      if (firstTicketId) assert.equal(rows[0].linked_ticket_id, firstTicketId);
      assert.ok(rows.every(r => !['CLOSED', 'RESOLVED'].includes(r.status)));
      for (const observation of decisions) {
        const reviews = (await f.pool.query('SELECT id::text FROM intake.manual_review_item WHERE decision_id=$1 AND status=\'PENDING\'', [observation.decision_id])).rows;
        if (['MANUAL_REVIEW_REQUIRED', 'INCIDENT_REVIEW_CANDIDATE', 'BUSINESS_CONSULTATION'].includes(observation.result_code)) assert.equal(reviews.length, 1);
        for (const review of reviews) {
          const detail = await f.get('/api/manual-reviews/' + review.id);
          const resolved = await f.post('/api/manual-reviews/' + review.id + '/resolve', { client_command_id: randomUUID(),
            expected_row_version: detail.row_version, resolution_code: 'REQUEST_DESCRIPTION', resolution_reason_code: 'OPERATOR_REVIEWED' });
          assert.equal(resolved.status, 200);
          assert.equal((await f.get('/api/manual-reviews/' + review.id)).status, 'RESOLVED');
        }
      }
      assert.equal(f.providerCalls.length, 0);
    });
  });
});
