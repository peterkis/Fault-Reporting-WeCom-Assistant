import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRuleEngine } from '../src/p2-007-rule-engine.mjs';
import { P2_015_RESULT_CODES, normalizeP2015FeatureFlags, safeHash, snapshotP2015Json } from '../src/p2-015-domain-contracts.mjs';
import { routeP2007Decision, routeRuleFailure } from '../src/p2-015-decision-router.mjs';

const context = (text, extra = {}) => ({ service_intake_id: '00000000-0000-0000-0000-000000000001',
  journey_ref: '00000000-0000-0000-0000-000000000002', source_refs: ['channel:1'],
  message_sequence_window: { start: 1, end: 1, count: 1 }, safe_normalized_text: text, ...extra });

test('strict feature flags default false and reject non-canonical values', () => {
  assert.deepEqual(normalizeP2015FeatureFlags(), { rule_first_orchestration_enabled: false, manual_review_queue_enabled: false });
  assert.deepEqual(normalizeP2015FeatureFlags({ RULE_FIRST_ORCHESTRATION_ENABLED: 'true' }), { rule_first_orchestration_enabled: true, manual_review_queue_enabled: false });
  assert.throws(() => normalizeP2015FeatureFlags({ RULE_FIRST_ORCHESTRATION_ENABLED: 'yes' }), { code: 'P2_015_FEATURE_FLAG_INVALID' });
});

test('ordinary JSON boundary rejects proxy, accessor, symbol, toJSON, cycles and pollution keys', () => {
  assert.throws(() => snapshotP2015Json(new Proxy({}, {})), { code: 'P2_015_INPUT_INVALID' });
  const accessor = {}; Object.defineProperty(accessor, 'value', { get: () => 1, enumerable: true });
  assert.throws(() => snapshotP2015Json(accessor), { code: 'P2_015_INPUT_INVALID' });
  assert.throws(() => snapshotP2015Json({ [Symbol('x')]: 1 }), { code: 'P2_015_INPUT_INVALID' });
  assert.throws(() => snapshotP2015Json({ toJSON() { return {}; } }), { code: 'P2_015_INPUT_INVALID' });
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => snapshotP2015Json(cycle), { code: 'P2_015_INPUT_INVALID' });
  assert.throws(() => snapshotP2015Json(JSON.parse('{"__proto__":1}')), { code: 'P2_015_INPUT_INVALID' });
});

test('router protects faults from acknowledgement and maps required examples', () => {
  const engine = createRuleEngine();
  const cases = [
    ['谢谢，但是处方还是提交不了', 'TICKET_ELIGIBLE', {}],
    ['天气怎么样', 'OUT_OF_SCOPE', {}],
    ['系统不行', 'NEEDS_DESCRIPTION', {}],
    ['处方提交不了', 'TICKET_ELIGIBLE', {}],
    ['重置密码', 'SERVICE_REQUEST', {}],
    ['医保这个规则怎么理解', 'BUSINESS_CONSULTATION', {}],
    ['工单到哪一步了', 'STATUS_QUERY', {}],
    ['还是不行', 'RELATED_FOLLOW_UP', { reliable_follow_up: true }],
  ];
  for (const [text, expected, extra] of cases) {
    const output = engine.evaluate({ text, source_ref: 'test:route', observed_at: '2026-09-03 12:00:00' });
    const routed = routeP2007Decision({ rule_output: output, context: context(text, extra) });
    assert.equal(routed.result_code, expected, text);
    assert.equal(Object.hasOwn(routed, 'original_text'), false);
    assert.equal(routed.safe_action_suggestions.every((item) => !JSON.stringify(item).includes(text)), true);
  }
});

test('ten result codes are reachable and deterministic', () => {
  const engine = createRuleEngine();
  const results = new Set();
  const samples = [
    ['处方提交不了', {}], ['系统不行', {}], ['还是不行', { reliable_follow_up: true }],
    ['工单到哪一步了', {}], ['重置密码', {}], ['医保规则怎么理解', {}], ['谢谢', {}], ['天气怎么样', {}],
  ];
  for (const [text, extra] of samples) results.add(routeP2007Decision({ rule_output: engine.evaluate({ text, source_ref: 'test:all', observed_at: '2026-09-03 12:00:00' }), context: context(text, extra) }).result_code);
  const incidentOutput = engine.evaluate({ text: '门诊系统多科室都无法提交', source_ref: 'test:incident', observed_at: '2026-09-03 12:00:00', scope: 'MULTIPLE_DEPARTMENTS' });
  results.add(routeP2007Decision({ rule_output: { ...incidentOutput, incident_candidate: true }, context: context('incident') }).result_code);
  results.add(routeRuleFailure(context('failure')).result_code);
  assert.deepEqual([...results].sort(), [...P2_015_RESULT_CODES].sort());
  const output = engine.evaluate({ text: '处方提交不了', source_ref: 'test:stable', observed_at: '2026-09-03 12:00:00' });
  const hashes = new Set(Array.from({ length: 100 }, () => routeP2007Decision({ rule_output: output, context: context('处方提交不了') }).result_hash));
  assert.equal(hashes.size, 1);
  assert.equal(safeHash({ a: 1, b: 2 }), safeHash({ b: 2, a: 1 }));
});

test('clinical high risk reaches review and unsupported root cause is never confirmed', () => {
  const engine = createRuleEngine();
  const output = engine.evaluate({ text: '处方提交不了', source_ref: 'test:risk', observed_at: '2026-09-03 12:00:00' });
  const routed = routeP2007Decision({ rule_output: { ...output, clinical_impact: 'CRITICAL_REVIEW_REQUIRED',
    cause_candidates: [{ cause_code: 'UNSUPPORTED', status: 'SUSPECTED' }] }, context: context('处方提交不了') });
  assert.equal(routed.result_code, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(routed.ticket_creation_recommended, true);
  assert.equal(JSON.stringify(routed).includes('UNSUPPORTED'), false);
  assert.equal(JSON.stringify(routed).includes('CONFIRMED'), false);
});

test('gold manifest references all 96 + 42 + 64 frozen cases with ten routes', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const lines = fs.readFileSync(path.join(root, 'tests/fixtures/p2-015/rule-first-safe-route-gold.v1.jsonl'), 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(lines.length, 202);
  assert.equal(new Set(lines.map((item) => `${item.source_fixture}:${item.source_case_id}`)).size, 202);
  assert.deepEqual([...new Set(lines.map((item) => item.expected_result_code))].sort(), [...P2_015_RESULT_CODES].sort());
  assert.equal(lines.every((item) => item.prohibited_effects.includes('CALL_LLM_PROVIDER') && !JSON.stringify(item).match(/(?:https?:\/\/|10\.\d+\.\d+\.\d+)/u)), true);
});
