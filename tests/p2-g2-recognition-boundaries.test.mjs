import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuleEngine } from '../src/p2-007-rule-engine.mjs';
import { routeP2007Decision } from '../src/p2-015-decision-router.mjs';
const engine = createRuleEngine();
const route = text => {
  const output = engine.evaluate({ text, source_ref: 'synthetic:g2-boundary', observed_at: '2026-09-08 12:00:00' });
  return routeP2007Decision({ rule_output: output, context: { safe_normalized_text: text,
    service_intake_id: '10000000-0000-4000-8000-000000000001', journey_ref: '10000000-0000-4000-8000-000000000002',
    source_refs: ['synthetic:g2-boundary'], message_sequence_window: { start: 1, end: 1, count: 1 } } });
};

test('reported technical object with unspecified problem is admitted without inventing a symptom',()=>{
  for(const text of ['打印机有问题','系统有问题','HIS有问题','电脑好像有问题'])assert.equal(route(text).ticket_creation_recommended,true,text);
  for(const text of ['打印机没有问题','系统不是有问题','如果系统有问题怎么办','预算有问题','系统有问题吗','系统有问题，现在恢复正常了'])
    assert.equal(route(text).ticket_creation_recommended,false,text);
});

test('G2 original X008/X030 explicit unavailability is a fault while hypothetical and recovered variants are not',()=>{
  for(const text of ['网络断了。','诊间预约也不行。'])assert.equal(route(text).ticket_creation_recommended,true,text);
  for(const text of ['网络没有断。','如果网络断了该找谁？','之前网络断了，现在恢复正常了。',
    '诊间预约不是不行。','如果诊间预约也不行该找谁？','诊间预约之前不行，现在恢复正常了。'])
    assert.equal(route(text).ticket_creation_recommended,false,text);
});
test('P2-G2 source-grounded recognition keeps nonfaults and negated failures out of Ticket creation', () => {
  for (const text of ['谢谢老师，辛苦了。', '这次系统提交没有失败。', '系统不是断网。', '这份文学报告看不到。',
    '我考试失败了。', '套餐价格是单项的两倍。', '患者费用显示正常。', '我的密码应该怎么设置？',
    '系统没有保存失败。', '门诊工作站一直转发通知。', '打印没有多打空白页。', '姓名没有不一致。',
    '系统没有出现密码错误。', '请问密码错误时应该找谁？', '不是密码错误，是不知道如何修改密码。']) {
    assert.equal(route(text).ticket_creation_recommended, false, text);
  }
});
test('P2-G2 thanks with a current fault remains an accepted fault; recovery does not close or create a Ticket', () => {
  assert.equal(route('谢谢，还是打印不了。').ticket_creation_recommended, true);
  for (const text of ['刚才有问题，现在没有问题了。', '后面自己恢复正常了，谢谢。', '门诊工作站之前一直转圈，现在恢复了。']) {
    const result = route(text); assert.equal(result.result_code, 'ACKNOWLEDGEMENT');
    assert.ok(result.safe_action_suggestions.every(a => !a.action_type.includes('TICKET')));
  }
  for (const text of ['打印没有多打空白页，但是处方提交失败。', '门诊工作站之前一直转圈，现在恢复了，但保存失败。',
    '密码错误了，应该找谁？', '门诊工作站一直转，打印机恢复正常了。', '打印多打空白页没有办法用。',
    '开药走到最后一直转圈且没有任何提示。', '门诊工作站恢复正常后又一直转圈。',
    '门诊工作站一直转圈，打印恢复了。']) assert.equal(route(text).ticket_creation_recommended, true, text);
});

test('P2-G2 observed save failure retains the save symptom rather than a submission claim', () => {
  const output = engine.evaluate({ text: '手术记录保存失败。', source_ref: 'synthetic:g2-save', observed_at: '2026-09-08 12:00:00' });
  assert.ok(output.symptom_codes.includes('TRANSACTION.SAVE_FAILED'));
  assert.ok(!output.symptom_codes.includes('TRANSACTION.SUBMIT_FAILED'));
});

test('P2-G2 observed insurance review unavailability is accepted before any later recovery', () => {
  assert.equal(route('医保审核不了。').ticket_creation_recommended, true);
  for (const text of ['医保没有审核失败。', '如果医保审核不了怎么办？', '医保审核不了时应准备哪些材料？',
    '医保审核因为材料不齐被拒绝，请问补交哪些材料？']) assert.equal(route(text).ticket_creation_recommended, false, text);
});

test('P2-G2 an explicit patient-result image description requires human review without interpreting its media', () => {
  assert.equal(route('图里是患者检查结果，系统打不开。').result_code, 'MANUAL_REVIEW_REQUIRED');
  assert.notEqual(route('图里是系统检查结果，系统打不开。').result_code, 'MANUAL_REVIEW_REQUIRED');
  assert.notEqual(route('图里不是患者检查结果，是系统检查结果，系统打不开。').result_code, 'MANUAL_REVIEW_REQUIRED');
});

test('P2-G2 explicit critical fault without a taxonomy symptom keeps acceptance flag and planned Ticket Action consistent', () => {
  const result = route('急诊唯一叫号终端坏了。');
  assert.equal(result.result_code, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(result.ticket_creation_recommended, true);
  assert.ok(result.safe_action_suggestions.some(a => a.action_type === 'CREATE_MINIMAL_TICKET'));
});

test('P2-G2 blank software interface is an observed fault without guessing its service identity', () => {
  const result = route('工作台全空白。');
  assert.equal(result.ticket_creation_recommended, true);
  assert.ok(result.known_fields.symptom_codes.includes('UI.BLANK'));
  for (const text of ['工作台不是空白。', '如果工作台全空白怎么办？', '纸张全空白。', '桌面上的白纸全空白。'])
    assert.equal(route(text).ticket_creation_recommended, false, text);
});

test('P2-G2 inconsistent charge records reach existing data-risk Review without guessing a root cause', () => {
  const result=route('患者标识占位符的收费记录不一致。');
  assert.equal(result.ticket_creation_recommended,true);assert.equal(result.result_code,'MANUAL_REVIEW_REQUIRED');
  assert.ok(result.known_fields.symptom_codes.includes('DATA.MISMATCH'));
  for(const text of ['收费记录没有不一致。','如果收费记录不一致应该找谁？','另一个患者也有费用问题。'])
    assert.equal(route(text).ticket_creation_recommended,false,text);
});
