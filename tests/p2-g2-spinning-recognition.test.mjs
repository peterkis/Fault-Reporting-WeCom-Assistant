import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuleEngine } from '../src/p2-007-rule-engine.mjs';
const engine = createRuleEngine();
const evaluate = text => engine.evaluate({ text, source_ref: 'synthetic-g2-spinning', observed_at: '2026-09-08 12:00:00' });

test('P2-G2 persistent spinning in a known software service is an evidenced fault without a root-cause claim', () => {
  for (const text of ['开药走到最后一直转。', '门诊工作站一直转。', '合理用药页面一直转。', '谢谢，处方提交后一直转。']) {
    const output = evaluate(text);
    assert.equal(output.domain_intent, 'INCIDENT_REPORT', text);
    assert.ok(output.symptom_codes.includes('PERFORMANCE.HANG_SPINNING'), text);
    assert.ok(output.fault_types.includes('PERFORMANCE_DEGRADATION'), text);
    assert.ok(output.facts.some(f => f.field_path === 'fault.symptom_codes'
      && f.normalized_value === 'PERFORMANCE.HANG_SPINNING' && f.rule_id === 'SYM-001'), text);
    assert.equal(output.cause_candidates.length, 0);
    assert.deepEqual(output, evaluate(text));
  }
});

test('P2-G2 spinning repair does not convert thanks, rotation, forwarding or explicit recovery into this symptom', () => {
  for (const text of ['谢谢。', '风扇一直转。', '门诊工作站一直转发通知。', '开药页面不再一直转。', '开药页面没有一直转。', '天气怎么样']) {
    const output = evaluate(text);
    assert.ok(!output.symptom_codes.includes('PERFORMANCE.HANG_SPINNING'), text);
    assert.notEqual(output.domain_intent, 'INCIDENT_REPORT', text);
  }
});
