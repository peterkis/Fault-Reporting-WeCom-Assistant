import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createAliasResolver } from '../../src/p2-007-alias-resolver.mjs';
import { P2007DomainError } from '../../src/p2-007-domain-utils.mjs';
import { createRuleEngine } from '../../src/p2-007-rule-engine.mjs';
import {createServiceCatalog,loadServiceCatalog} from '../../src/p2-007-service-catalog.mjs';

const OBSERVED_AT = '2026-09-03 15:30:00';
const dictionary = JSON.parse(readFileSync('config_examples/p2-007-alias-dictionary.example.json', 'utf8'));

test('validated Web catalog selection is an explicit service fact without a text alias', () => {
  const output=createRuleEngine().evaluate({text:'提交不了',source_ref:'web:catalog-selection',observed_at:OBSERVED_AT,
    source_kind:'WEB',service_code:'CLINICAL.OUTPATIENT_WORKSTATION'});
  assert.equal(output.selected_service_code,'CLINICAL.OUTPATIENT_WORKSTATION');
  assert.ok(output.service_candidates.includes('CLINICAL.OUTPATIENT_WORKSTATION'));
  const selected=output.facts.find(fact=>fact.field_path==='service.selected_service_code');
  assert.equal(selected.normalized_value,'CLINICAL.OUTPATIENT_WORKSTATION');
  assert.equal(selected.source_kind,'REPORTER_EXPLICIT');
  assert.equal(selected.reason_code,'WEB_SERVICE_SELECTION');
  assert.equal(selected.rule_id,null);
  assert.deepEqual(output.side_effects,[]);
});

test('Web catalog selection conflicting with resolved text retains both facts for human review', () => {
  const output=createRuleEngine().evaluate({text:'PACS 打不开',source_ref:'web:selection-conflict',observed_at:OBSERVED_AT,
    source_kind:'WEB',service_code:'CLINICAL.OUTPATIENT_WORKSTATION'});
  assert.equal(output.requires_human_review,true);
  assert.equal(output.result_state,'PARTIAL');
  assert.equal(output.selected_service_code,null);
  assert.equal(output.owner_suggestion,null);
  assert.deepEqual(output.facts.filter(fact=>fact.field_path==='service.selected_service_code').map(fact=>({value:fact.normalized_value,status:fact.status})).sort((a,b)=>a.value.localeCompare(b.value)),[
    {value:'CLINICAL.OUTPATIENT_WORKSTATION',status:'CONFLICTED'},
    {value:'DIAG.IMAGING_VIEWER',status:'CONFLICTED'},
  ]);
});

test('Web service facts reject cross-source input and retain text-only fallback for unavailable choices', () => {
  const engine=createRuleEngine(),base={text:'提交不了',source_ref:'web:selection-controls',observed_at:OBSERVED_AT,source_kind:'WEB'};
  const original=engine.evaluate(base);
  for(const service_code of [null,'UNKNOWN_SERVICE'])assert.deepEqual(engine.evaluate({...base,service_code}),original);
  const raw=structuredClone(loadServiceCatalog().raw);
  raw.domains.flatMap(domain=>domain.services).find(service=>service.service_code==='CLINICAL.OUTPATIENT_WORKSTATION').enabled=false;
  const disabled=createRuleEngine({catalog:createServiceCatalog(raw)});
  assert.equal(disabled.evaluate({...base,service_code:'CLINICAL.OUTPATIENT_WORKSTATION'}).selected_service_code,null);
  assert.throws(()=>engine.evaluate({...base,source_kind:'BOT',service_code:'CLINICAL.OUTPATIENT_WORKSTATION'}),P2007DomainError);
  assert.throws(()=>engine.evaluate({...base,service_code:['CLINICAL.OUTPATIENT_WORKSTATION']}),P2007DomainError);
  const unrelated=engine.evaluate({...base,text:'天气怎么样',service_code:'CLINICAL.OUTPATIENT_WORKSTATION'});
  assert.equal(unrelated.domain_intent,'HOW_TO_QUESTION');assert.equal(unrelated.p1_request_type,'UNKNOWN');
  assert.deepEqual(unrelated.side_effects,[]);
});

test('Web selection also defers conflicting rule-derived service facts to human review', () => {
  const output=createRuleEngine().evaluate({text:'预览正常，但是纸上不全',source_ref:'web:rule-selection-conflict',observed_at:OBSERVED_AT,
    source_kind:'WEB',service_code:'CLINICAL.OUTPATIENT_WORKSTATION'});
  assert.equal(output.requires_human_review,true);assert.equal(output.selected_service_code,null);
  assert.ok(output.facts.some(fact=>fact.field_path==='service.selected_service_code'&&fact.normalized_value==='PRINT.PRINTER_DEVICE'
    &&fact.source_kind==='DETERMINISTIC_RULE'&&fact.status==='CONFLICTED'));
});

test('duplicate aliases, duplicate rules and rule config drift fail closed', () => {
  const duplicateAliases = structuredClone(dictionary);
  duplicateAliases.service_aliases.push(structuredClone(duplicateAliases.service_aliases[0]));
  assert.throws(() => createAliasResolver({ dictionary: duplicateAliases }), P2007DomainError);
  const ruleSet = JSON.parse(readFileSync('config_examples/p2-007-deterministic-rules.example.json', 'utf8'));
  const duplicateRules = structuredClone(ruleSet);
  duplicateRules.rules.push(structuredClone(duplicateRules.rules[0]));
  assert.throws(() => createRuleEngine({ ruleSet: duplicateRules }), P2007DomainError);
  const drifted = structuredClone(ruleSet);
  drifted.execution_mode = 'SIDE_EFFECTS_ALLOWED';
  assert.throws(() => createRuleEngine({ ruleSet: drifted }), P2007DomainError);
});

test('at least 50 deterministic service cases return the same semantic result', () => {
  const engine = createRuleEngine();
  const cases = dictionary.service_aliases
    .filter((entry) => entry.selection_policy === 'AUTO_SELECT' && entry.candidate_service_codes.length === 1)
    .slice(0, 50);
  assert.equal(cases.length, 50);
  for (const [index, entry] of cases.entries()) {
    const input = {
      text: `${entry.alias} 打不开`, source_ref: `case-${String(index).padStart(3, '0')}`, observed_at: OBSERVED_AT,
    };
    const first = engine.evaluate(input);
    const second = engine.evaluate(input);
    assert.equal(first.selected_service_code, entry.candidate_service_codes[0], entry.alias);
    assert.ok(first.symptom_codes.includes('AVAILABILITY.UNAVAILABLE'), entry.alias);
    assert.equal(second.result_hash, first.result_hash, entry.alias);
    assert.deepEqual(second, first, entry.alias);
  }
});

test('the same input produces the same output hash for 100 executions', () => {
  const engine = createRuleEngine();
  const input = {
    text: '门诊系统打不开，所有电脑都不行', source_ref: 'determinism-100', observed_at: OBSERVED_AT,
    context: { distinct_reporters_120s: 5, compatible_fault_signals: true },
  };
  const outputs = Array.from({ length: 100 }, () => engine.evaluate(input));
  assert.equal(new Set(outputs.map((output) => output.result_hash)).size, 1);
  assert.ok(outputs.every((output) => JSON.stringify(output) === JSON.stringify(outputs[0])));
});

test('rule engine extracts service, taxonomy and explainable provenance without effects', () => {
  const output = createRuleEngine().evaluate({
    text: '门诊系统打不开', source_ref: 'message-ref', observed_at: OBSERVED_AT,
  });
  assert.equal(output.selected_service_code, 'CLINICAL.OUTPATIENT_WORKSTATION');
  assert.deepEqual(output.symptom_codes, ['AVAILABILITY.UNAVAILABLE']);
  assert.ok(output.matched_rules.some((rule) => rule.rule_id === 'INT-001'));
  assert.equal(output.side_effects.length, 0);
  assert.ok(output.forbidden_effects.includes('CREATE_INCIDENT'));
  assert.ok(output.forbidden_effects.includes('UPDATE_TICKET_STATUS'));
  assert.ok(output.forbidden_effects.includes('SEND_WECOM_MESSAGE'));
  for (const fact of output.facts) {
    assert.ok(fact.source_ref);
    assert.ok(Object.hasOwn(fact, 'rule_id'));
    assert.ok(Number.isInteger(fact.reliability_tier));
    assert.ok(fact.confidence_level);
  }
});

test('generic system failure asks only which system before lower-value questions', () => {
  const output = createRuleEngine().evaluate({
    text: '系统打不开', source_ref: 'generic-system', observed_at: OBSERVED_AT,
  });
  assert.equal(output.selected_service_code, null);
  assert.equal(output.clarification_needed, true);
  assert.equal(output.clarification.question_code, 'Q_WHICH_SYSTEM_OR_FUNCTION');
  assert.equal(output.clarification.question_count, 1);
});

test('rule config drives incident signals but cannot create an Incident or mutate Ticket', () => {
  const output = createRuleEngine().evaluate({
    text: '门诊系统所有电脑都打不开', source_ref: 'incident-signal', observed_at: OBSERVED_AT,
    context: { distinct_reporters_120s: 3, compatible_fault_signals: true },
  });
  assert.equal(output.incident_candidate, true);
  assert.ok(output.incident_reason_codes.includes('MULTI_REPORTER_BURST'));
  assert.equal(Object.hasOwn(output, 'incident_id'), false);
  assert.equal(Object.hasOwn(output, 'ticket_update'), false);
  assert.equal(output.side_effects.length, 0);
});

test('correction, scope, recovery and workaround rules remain advisory', () => {
  const engine = createRuleEngine();
  const correction = engine.evaluate({
    text: '前面说错了，不是影像系统，是检验报告', source_ref: 'correction', observed_at: OBSERVED_AT,
  });
  assert.ok(correction.matched_rules.some((rule) => rule.rule_id === 'NEG-002'));
  assert.equal(correction.selected_service_code, 'DIAG.LAB_RESULT_VIEW');
  const recovery = engine.evaluate({
    text: '已经恢复了', source_ref: 'recovery', observed_at: OBSERVED_AT,
    recovery_signal: 'REPORTER_OBSERVED_RECOVERED',
  });
  assert.ok(recovery.matched_rules.some((rule) => rule.rule_id === 'STATE-001'));
  assert.ok(recovery.forbidden_effects.includes('UPDATE_TICKET_STATUS'));
  const workaround = engine.evaluate({
    text: '重启了还是不行', source_ref: 'workaround', observed_at: OBSERVED_AT,
  });
  assert.equal(workaround.attempt_result, 'FAILED');
});

test('all generated result times are injected LocalDateTime and no Date is accepted', () => {
  const engine = createRuleEngine();
  const output = engine.evaluate({ text: 'PACS 打不开', source_ref: 'time-contract', observed_at: OBSERVED_AT });
  assert.equal(output.evaluated_at, OBSERVED_AT);
  for (const fact of output.facts) assert.equal(fact.observed_at, OBSERVED_AT);
  assert.doesNotMatch(JSON.stringify(output), /2026-09-03T|Z|\+08:00/u);
  for (const observed_at of ['2026-09-03T15:30:00Z', '2026-09-03 15:30:00+08:00', new Date()]) {
    assert.throws(() => engine.evaluate({ text: 'PACS 打不开', source_ref: 'bad-time', observed_at }));
  }
});

test('bounded batch handles 2,000 synthetic turns without queues or external seams', () => {
  const engine = createRuleEngine();
  let lastHash;
  for (let index = 0; index < 2_000; index += 1) {
    const output = engine.evaluate({
      text: index % 2 === 0 ? 'PACS 打不开' : '打印机卡纸',
      source_ref: `bounded-${index}`, observed_at: OBSERVED_AT,
    });
    assert.equal(output.side_effects.length, 0);
    lastHash = output.result_hash;
  }
  assert.match(lastHash, /^[a-f0-9]{64}$/u);
});
