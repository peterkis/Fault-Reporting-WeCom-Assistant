import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createAliasResolver, resolveAlias } from '../../src/p2-007-alias-resolver.mjs';
import { planClarification } from '../../src/p2-007-clarification-planner.mjs';
import { resolveFactConflicts } from '../../src/p2-007-conflict-resolver.mjs';
import { P2007DomainError, canonicalJson } from '../../src/p2-007-domain-utils.mjs';
import { buildFactProvenance } from '../../src/p2-007-fact-provenance.mjs';
import { resolveFaultTaxonomy } from '../../src/p2-007-fault-taxonomy.mjs';
import { generateIncidentCandidate } from '../../src/p2-007-incident-candidate.mjs';
import { generateNotificationRecommendation } from '../../src/p2-007-notification-recommendation.mjs';
import { createServiceCatalog, loadServiceCatalog } from '../../src/p2-007-service-catalog.mjs';

const LOCAL_TIME = '2026-09-03 15:30:00';
const aliasDictionary = JSON.parse(readFileSync('config_examples/p2-007-alias-dictionary.example.json', 'utf8'));

function fact(overrides = {}) {
  return buildFactProvenance({
    field_path: 'service.selected_service_code',
    value: 'DIAG.IMAGING_VIEWER',
    normalized_value: 'DIAG.IMAGING_VIEWER',
    source_kind: 'REPORTER_EXPLICIT',
    source_ref: 'message-ref',
    rule_id: 'ALIAS-001',
    confidence: 0.92,
    observed_at: LOCAL_TIME,
    catalog_version: '0.1.0-draft',
    rule_set_version: '0.1.0-draft',
    ...overrides,
  });
}

test('service catalog loads all services, categories, version and a stable catalog hash', () => {
  const catalog = loadServiceCatalog();
  assert.equal(catalog.catalog_version, '0.1.0-draft');
  assert.equal(catalog.category_count, 11);
  assert.equal(catalog.service_count, 55);
  assert.equal(catalog.lookupService('CLINICAL.OUTPATIENT_WORKSTATION').category, 'CLINICAL_CORE');
  assert.equal(catalog.lookupCategory('CLINICAL.OUTPATIENT_WORKSTATION').category, 'CLINICAL_CORE');
  assert.match(catalog.catalog_hash, /^[a-f0-9]{64}$/u);
  assert.equal(loadServiceCatalog().catalog_hash, catalog.catalog_hash);
});

test('invalid catalogs reject duplicate services, duplicate aliases and malformed roots', () => {
  const source = JSON.parse(readFileSync('config_examples/p2-007-service-catalog.example.json', 'utf8'));
  const duplicateService = structuredClone(source);
  duplicateService.domains[1].services.push(structuredClone(duplicateService.domains[0].services[0]));
  assert.throws(() => createServiceCatalog(duplicateService), P2007DomainError);
  const duplicateAlias = structuredClone(source);
  duplicateAlias.domains[0].services[0].aliases.push(duplicateAlias.domains[0].services[0].aliases[0]);
  assert.throws(() => createServiceCatalog(duplicateAlias), P2007DomainError);
  assert.throws(() => createServiceCatalog({}), P2007DomainError);
});

test('at least 50 catalog-backed aliases resolve deterministically and preserve original text', () => {
  const resolver = createAliasResolver();
  const cases = aliasDictionary.service_aliases
    .filter((entry) => entry.selection_policy === 'AUTO_SELECT' && entry.candidate_service_codes.length === 1)
    .slice(0, 50);
  assert.equal(cases.length, 50);
  for (const entry of cases) {
    const decorated = `请看 ${entry.alias} 出问题了`;
    const result = resolver.resolve(decorated);
    assert.equal(result.original_text, decorated);
    assert.equal(result.selected_service_code, entry.candidate_service_codes[0], entry.alias);
    assert.equal(result.matched_alias, entry.alias);
    assert.match(result.rule_id, /^ALIAS-[0-9]{3}$/u);
  }
});

test('required hospital aliases cover English case folding, Chinese terms and ambiguity', () => {
  const expectations = [
    ['pacs 打不开', 'DIAG.IMAGING_VIEWER'],
    ['LIS 报告打不开', 'DIAG.LAB_RESULT_VIEW'],
    ['挂号系统打不开', 'ACCESS.REGISTRATION'],
    ['打印机坏了', 'PRINT.PRINTER_DEVICE'],
    ['网络不通', 'NETWORK.ENDPOINT_ACCESS'],
    ['门诊系统打不开', 'CLINICAL.OUTPATIENT_WORKSTATION'],
    ['检验报告打不开', 'DIAG.LAB_RESULT_VIEW'],
  ];
  for (const [text, expected] of expectations) assert.equal(resolveAlias(text).selected_service_code, expected, text);
  assert.equal(resolveAlias('HIS 打不开').selected_service_code, null);
  assert.deepEqual(resolveAlias('HIS 打不开').candidate_service_codes, [
    'CLINICAL.INPATIENT_WORKSTATION', 'CLINICAL.OUTPATIENT_WORKSTATION',
  ]);
  assert.equal(resolveAlias('医生站打不开').clarification_needed, true);
});

test('fault taxonomy resolves requested failure families', () => {
  const cases = [
    ['登录失败', 'AUTHENTICATION_FAILURE'],
    ['打不开', 'ACCESS_FAILURE'],
    ['系统卡顿', 'PERFORMANCE_DEGRADATION'],
    ['打印失败', 'OUTPUT_FAILURE'],
    ['网络不通', 'CONNECTIVITY_FAILURE'],
  ];
  for (const [text, expected] of cases) assert.ok(resolveFaultTaxonomy(text).fault_types.includes(expected), text);
});

test('fact provenance is deterministic, complete and LocalDateTime-only', () => {
  const result = fact();
  assert.deepEqual(fact(), result);
  assert.match(result.fact_id, /^fact_[a-f0-9]{32}$/u);
  assert.equal(result.source_ref, 'message-ref');
  assert.equal(result.rule_id, 'ALIAS-001');
  assert.equal(result.reliability_tier, 92);
  assert.equal(result.confidence_level, 'STRONG');
  assert.equal(result.observed_at, LOCAL_TIME);
  assert.doesNotMatch(JSON.stringify(result), /T15:30:00|Z|\+08:00/u);
  for (const invalid of ['2026-09-03T15:30:00Z', '2026-09-03 15:30:00+08:00', new Date()]) {
    assert.throws(() => fact({ observed_at: invalid }), P2007DomainError);
  }
});

test('reporter correction supersedes service and location facts without deleting history', () => {
  for (const [fieldPath, oldValue, newValue] of [
    ['service.selected_service_code', 'DIAG.IMAGING_VIEWER', 'DIAG.LAB_RESULT_VIEW'],
    ['location.occurrence_location', 'TEST_BUILDING_A', 'TEST_BUILDING_B'],
  ]) {
    const previous = fact({ field_path: fieldPath, value: oldValue, normalized_value: oldValue });
    const correction = fact({
      field_path: fieldPath, value: newValue, normalized_value: newValue,
      source_kind: 'REPORTER_CORRECTION', source_ref: 'message-correction', rule_id: 'NEG-002',
    });
    const resolved = resolveFactConflicts({ facts: [previous, correction] });
    assert.equal(resolved.facts.length, 2);
    assert.equal(resolved.previous_fact.status, 'SUPERSEDED');
    assert.equal(resolved.current_fact.status, 'ACTIVE');
    assert.equal(resolved.reason, 'USER_CORRECTION');
    assert.equal(resolved.conflict.requires_human, false);
  }
});

test('contradictory active facts remain append-only and defer to a human', () => {
  const first = fact({ field_path: 'classification.scope', value: 'ROOM', normalized_value: 'ROOM' });
  const second = fact({ field_path: 'classification.scope', value: 'DEPARTMENT', normalized_value: 'DEPARTMENT', source_ref: 'message-2' });
  const resolved = resolveFactConflicts({ facts: [first, second] });
  assert.equal(resolved.conflict.resolution_status, 'DEFERRED_TO_HUMAN');
  assert.equal(resolved.conflict.requires_human, true);
  assert.ok(resolved.facts.every((item) => item.status === 'CONFLICTED'));
});

test('clarification planner returns only the single highest-value question', () => {
  const plan = planClarification({
    selected_service_code: null,
    missing_fields: ['impact', 'scope', 'location', 'system'],
  });
  assert.equal(plan.question_code, 'Q_WHICH_SYSTEM_OR_FUNCTION');
  assert.equal(plan.question, '请问无法使用的是哪个系统或功能？');
  assert.equal(plan.question_count, 1);
  assert.equal(Object.hasOwn(plan, 'questions'), false);
});

test('incident generation deduplicates reporters, creates only a candidate and requires confirmation', () => {
  const reports = [
    ['person-a', 'dept-a', 'room-a'], ['person-a', 'dept-a', 'room-a'],
    ['person-b', 'dept-a', 'room-b'], ['person-c', 'dept-a', 'room-c'],
  ].map(([reporter_ref, department_ref, location_ref], index) => ({
    reporter_ref, department_ref, location_ref,
    observed_at: `2026-09-03 15:30:0${index}`,
    service_family: 'CLINICAL.OUTPATIENT_WORKSTATION', symptom_family: 'AVAILABILITY',
    evidence_fact_ids: [`fact_evidence${String(index).padStart(8, '0')}`],
  }));
  const candidate = generateIncidentCandidate({ reports });
  assert.equal(candidate.is_candidate, true);
  assert.equal(candidate.distinct_reporters, 3);
  assert.equal(candidate.same_reporter_cross_channel_deduplicated, true);
  assert.equal(candidate.human_confirmation_required, true);
  assert.equal(candidate.creates_incident, false);
  assert.equal(Object.hasOwn(candidate, 'incident_id'), false);
});

test('notification output is a recommendation only and never authorizes sending', () => {
  const direct = generateNotificationRecommendation({
    type: 'DIRECT_GUIDANCE_REQUIRED', source_ref: 'journey-1', provenance_fact_ids: [fact().fact_id],
  });
  assert.equal(direct.preferred_channel, 'WECOM_DIRECT');
  assert.equal(direct.purpose, 'PRIVATE_GUIDANCE');
  assert.equal(direct.send_authorized, false);
  assert.equal(direct.execution_owner, 'P2_004_COMMUNICATION_OUTBOX_DELIVERY');
  const internal = generateNotificationRecommendation({ trigger: 'INCIDENT_CANDIDATE_DETECTED', candidate_ref: 'candidate-1' });
  assert.equal(internal.preferred_channel, 'WORKBENCH_INTERNAL');
  assert.equal(internal.requires_outbox, false);
  assert.equal(internal.send_authorized, false);
});

test('unsafe JSON, proxies, accessors, pollution keys, cycles and order drift fail closed', () => {
  assert.throws(() => createServiceCatalog(new Proxy({}, {})), P2007DomainError);
  assert.throws(() => canonicalJson({ get text() { return 'secret'; } }), P2007DomainError);
  const polluted = JSON.parse('{"__proto__":{"admin":true}}');
  assert.throws(() => canonicalJson(polluted), P2007DomainError);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), P2007DomainError);
  assert.throws(() => canonicalJson(new Array(2)), P2007DomainError);
  const extendedArray = [1]; extendedArray.extra = 2;
  assert.throws(() => canonicalJson(extendedArray), P2007DomainError);
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});
