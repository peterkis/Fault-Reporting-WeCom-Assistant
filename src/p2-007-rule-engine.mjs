import { fileURLToPath } from 'node:url';

import { createAliasResolver } from './p2-007-alias-resolver.mjs';
import { planClarification } from './p2-007-clarification-planner.mjs';
import {
  P2_007_ERROR_CODES,
  assertPlainJson,
  deepFreeze,
  failP2007,
  normalizeHospitalText,
  readJsonConfig,
  sha256Canonical,
  uniqueSorted,
} from './p2-007-domain-utils.mjs';
import { buildFactProvenance } from './p2-007-fact-provenance.mjs';
import { createFaultTaxonomyResolver } from './p2-007-fault-taxonomy.mjs';
import { loadServiceCatalog } from './p2-007-service-catalog.mjs';

export const DEFAULT_DETERMINISTIC_RULES_PATH = fileURLToPath(new URL(
  '../config_examples/p2-007-deterministic-rules.example.json',
  import.meta.url,
));

const SCOPE_ORDER = Object.freeze([
  'UNKNOWN', 'SINGLE_PATIENT', 'SINGLE_USER', 'SINGLE_ENDPOINT', 'SINGLE_ROOM',
  'MULTIPLE_ENDPOINTS', 'DEPARTMENT', 'BUILDING_FLOOR', 'MULTIPLE_DEPARTMENTS',
  'OUTPATIENT_WIDE', 'HOSPITAL_WIDE',
]);
const IMPACT_ORDER = Object.freeze(['UNKNOWN', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL_REVIEW_REQUIRED']);

function validateRuleSet(input) {
  const ruleSet = assertPlainJson(input, {
    errorCode: P2_007_ERROR_CODES.configInvalid,
    maxDepth: 20,
    maxNodes: 100_000,
    maxArrayLength: 20_000,
    maxStringLength: 100_000,
  });
  if (
    ruleSet.schema_version !== '1.0.0'
    || ruleSet.execution_mode !== 'PURE_FUNCTION_NO_SIDE_EFFECT'
    || typeof ruleSet.rule_set_id !== 'string'
    || typeof ruleSet.rule_set_version !== 'string'
    || !Array.isArray(ruleSet.rules)
    || ruleSet.rules.length === 0
  ) failP2007(P2_007_ERROR_CODES.configInvalid);
  const ids = new Set();
  for (const rule of ruleSet.rules) {
    if (
      !rule || typeof rule !== 'object'
      || typeof rule.rule_id !== 'string' || !/^[A-Z]+-[0-9]{3}$/u.test(rule.rule_id)
      || typeof rule.version !== 'string'
      || !Number.isInteger(rule.priority)
      || !rule.when || typeof rule.when !== 'object'
      || !Array.isArray(rule.actions) || rule.actions.length === 0
      || ids.has(rule.rule_id)
    ) failP2007(P2_007_ERROR_CODES.configInvalid);
    ids.add(rule.rule_id);
    for (const action of rule.actions) if (typeof action?.action !== 'string') failP2007(P2_007_ERROR_CODES.configInvalid);
    for (const condition of flattenConditions(rule.when)) {
      if (condition.regex !== undefined || condition.full_match_regex !== undefined) {
        try { new RegExp(condition.regex ?? condition.full_match_regex, 'u'); } catch { failP2007(P2_007_ERROR_CODES.configInvalid); }
      }
    }
  }
  return deepFreeze(ruleSet);
}

function flattenConditions(condition) {
  if (Array.isArray(condition?.all)) return condition.all.flatMap(flattenConditions);
  if (Array.isArray(condition?.any)) return condition.any.flatMap(flattenConditions);
  return [condition];
}

function pathValue(root, path) {
  if (typeof path !== 'string') return undefined;
  let current = root;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function contains(container, needle) {
  if (Array.isArray(container)) return container.includes(needle);
  return typeof container === 'string' && container.includes(String(needle));
}

function conditionMatches(condition, state) {
  if (Array.isArray(condition.all)) return condition.all.every((item) => conditionMatches(item, state));
  if (Array.isArray(condition.any)) return condition.any.some((item) => conditionMatches(item, state));
  const value = pathValue(state, condition.field);
  if (Object.hasOwn(condition, 'eq') && value !== condition.eq) return false;
  if (Object.hasOwn(condition, 'lte') && !(typeof value === 'number' && value <= condition.lte)) return false;
  if (Object.hasOwn(condition, 'gte')) {
    const comparable = Array.isArray(value) ? value.length : value;
    if (!(typeof comparable === 'number' && comparable >= condition.gte)) return false;
  }
  if (Object.hasOwn(condition, 'missing') && condition.missing !== (value === undefined || value === null || value === 'UNKNOWN')) return false;
  if (Object.hasOwn(condition, 'exists') && condition.exists !== (value !== undefined && value !== null)) return false;
  if (Object.hasOwn(condition, 'contains') && !contains(value, condition.contains)) return false;
  if (Array.isArray(condition.contains_any) && !condition.contains_any.some((item) => contains(value, item))) return false;
  if (Array.isArray(condition.in) && !condition.in.includes(value)) return false;
  if (Array.isArray(condition.full_match_any) && !condition.full_match_any.map(normalizeHospitalText).includes(value)) return false;
  if (condition.regex !== undefined && !(typeof value === 'string' && new RegExp(condition.regex, 'u').test(value))) return false;
  if (condition.full_match_regex !== undefined && !(typeof value === 'string' && new RegExp(condition.full_match_regex, 'u').test(value))) return false;
  if (condition.token_only_or_generic !== undefined) {
    const generic = normalizeHospitalText(condition.token_only_or_generic);
    if (!(value === generic || value === `${generic}.` || value === `${generic}!` || value === `${generic}?`)) return false;
  }
  return true;
}

function raiseAtLeast(current, requested, order) {
  const currentIndex = Math.max(0, order.indexOf(current));
  const requestedIndex = Math.max(0, order.indexOf(requested));
  return order[Math.max(currentIndex, requestedIndex)];
}

function inferTransactionStage(text, service) {
  const mappings = [
    [['登录', '登不', 'login'], 'LOGIN'],
    [['保存', '写病历'], 'SAVE_RECORD'],
    [['最后', '提交', '开药'], 'FINAL_SUBMIT'],
    [['合理用药'], 'RATIONAL_MEDICATION_CHECK'],
    [['审方', '审核'], 'REVIEW'],
    [['预约'], 'APPOINTMENT'],
    [['打印', '卡纸'], 'PRINT'],
    [['叫号', '呼叫'], 'QUEUE_CALL'],
  ];
  for (const [terms, stage] of mappings) if (terms.some((term) => text.includes(term))) return stage;
  return service?.transaction_stages?.length === 1 ? service.transaction_stages[0] : 'UNKNOWN';
}

function applyAction(action, state) {
  state.action_log.push(action.action);
  switch (action.action) {
    case 'SET_SELECTED_SERVICE': state.selected_service_code = action.value; break;
    case 'SELECT_SERVICE': state.selected_service_code = action.service_code; break;
    case 'SET_DOMAIN_INTENT': state.domain_intent = action.value; break;
    case 'SET_DOMAIN_INTENT_IF_NO_NEW_FAULT': if (state.symptom_codes.length === 0) state.domain_intent = action.value; break;
    case 'ADD_INTENT_SIGNAL': state.intent_signals.push(action.value); break;
    case 'SET_RECOVERY_SIGNAL': state.recovery_signal = action.value; break;
    case 'SET_SCOPE': state.scope = action.value; break;
    case 'SET_SCOPE_AT_LEAST': state.scope = raiseAtLeast(state.scope, action.value, SCOPE_ORDER); break;
    case 'NEGATE_SCOPE': if (state.scope === action.value) state.scope = 'UNKNOWN'; break;
    case 'ADD_SYMPTOM': state.symptom_codes.push(action.symptom_code); break;
    case 'ADD_CAUSE_CANDIDATE': state.cause_candidates.push({ cause_code: action.cause_code, status: action.status }); break;
    case 'NEGATE_CAUSE_CANDIDATE': state.cause_candidates = state.cause_candidates.filter((item) => item.cause_code !== action.cause_code); break;
    case 'ROUTE_SUGGESTION': state.owner_suggestion = action.owner; break;
    case 'MARK_INCIDENT_CANDIDATE': state.incident_reasons.push(action.reason); break;
    case 'SET_CLINICAL_IMPACT_AT_LEAST': state.clinical_impact = raiseAtLeast(state.clinical_impact, action.value, IMPACT_ORDER); break;
    case 'ASK': case 'ASK_SECURELY': case 'ASK_ONCE_PER_INCIDENT': state.question_codes.push(action.question_code); break;
    case 'SUPPRESS_QUESTION': state.suppressed_question_codes.push(action.question_code); break;
    case 'REQUIRE_FIELD': state.required_fields.push(action.field); break;
    case 'ADD_PRIVACY_FLAG': state.privacy_flags.push(action.value); break;
    case 'SET_RESULT_STATE': state.result_state = action.value; break;
    case 'START_NEW_ANALYSIS_WINDOW': state.analysis_window = 'NEW'; break;
    case 'MERGE_TURN': state.analysis_window = 'MERGED'; break;
    case 'MARK_WORKAROUND_RESULT': state.attempt_result = action.value; break;
    case 'CREATE_CONFLICT': state.conflict = true; break;
    case 'REQUIRE_HUMAN_REVIEW': state.requires_human_review = true; break;
    case 'ADD_REQUIRED_CONFIRMATION': state.required_confirmations.push(action.value); break;
    case 'FORBID_EFFECT': state.forbidden_effects.push(action.effect); break;
    case 'SET_REQUIRES_POLICY_REVIEW': state.requires_policy_review = action.value; break;
    default: break;
  }
}

function fieldPresent(field, state) {
  if (field === 'symptom_codes') return state.symptom_codes.length > 0;
  if (field === 'scope' || field === 'patient_scope') return state.scope !== 'UNKNOWN';
  if (field === 'transaction_stage') return state.transaction_stage !== 'UNKNOWN';
  if (field === 'occurrence_location_or_asset_hint') return Boolean(state.occurrence_location || state.asset_hint);
  return pathValue(state, field) !== undefined && pathValue(state, field) !== null;
}

function factInput(state, overrides) {
  return {
    source_ref: state.source_ref,
    source_text: state.original_text,
    observed_at: state.observed_at,
    catalog_version: state.catalog_version,
    rule_set_version: state.rule_set_version,
    ...overrides,
  };
}

export function createRuleEngine({ ruleSet, catalog, aliasDictionary } = {}) {
  const serviceCatalog = catalog ?? loadServiceCatalog();
  const safeRuleSet = validateRuleSet(ruleSet === undefined ? readJsonConfig(DEFAULT_DETERMINISTIC_RULES_PATH) : ruleSet);
  const aliasResolver = createAliasResolver({ dictionary: aliasDictionary, catalog: serviceCatalog });
  const taxonomyResolver = createFaultTaxonomyResolver({ dictionary: aliasDictionary });
  const orderedRules = [...safeRuleSet.rules].sort((left, right) => right.priority - left.priority
    || left.rule_id.localeCompare(right.rule_id, 'en'));

  return deepFreeze({
    rule_set_id: safeRuleSet.rule_set_id,
    rule_set_version: safeRuleSet.rule_set_version,
    rule_set_hash: sha256Canonical(safeRuleSet),
    evaluate(input) {
      const safe = assertPlainJson(input, { maxNodes: 50_000, maxArrayLength: 5_000, maxStringLength: 20_000 });
      if (typeof safe.text !== 'string' || typeof safe.source_ref !== 'string' || typeof safe.observed_at !== 'string') {
        failP2007(P2_007_ERROR_CODES.inputInvalid);
      }
      const alias = aliasResolver.resolve(safe.text);
      const taxonomy = taxonomyResolver.resolve(safe.text);
      const state = {
        ...safe,
        input: { exists: true },
        original_text: safe.text,
        normalized_text: alias.normalized_text,
        normalized_context: normalizeHospitalText(safe.normalized_context ?? safe.text),
        context: safe.context ?? {},
        turn: safe.turn ?? {},
        source_kind: safe.source_kind ?? 'REPORTER_EXPLICIT',
        reporter_directory: safe.reporter_directory ?? {},
        extracted: safe.extracted ?? {},
        impact: safe.impact ?? {},
        privacy_detector: safe.privacy_detector ?? {},
        execution_context: safe.execution_context ?? 'RUNTIME',
        asset_hint: safe.asset_hint ?? null,
        occurrence_location: safe.occurrence_location ?? safe.extracted?.occurrence_location ?? null,
        selected_service_code: alias.selected_service_code,
        symptom_codes: [...taxonomy.symptom_codes],
        symptom_facts: { count: taxonomy.symptom_codes.length },
        domain_intent: 'UNKNOWN',
        scope: safe.scope ?? 'UNKNOWN',
        clinical_impact: safe.clinical_impact ?? 'UNKNOWN',
        transaction_stage: 'UNKNOWN',
        owner_suggestion: null,
        cause_candidates: [],
        incident_reasons: [],
        question_codes: [],
        suppressed_question_codes: [],
        privacy_flags: [],
        intent_signals: [],
        required_fields: [],
        required_confirmations: [],
        forbidden_effects: ['CREATE_TICKET', 'UPDATE_TICKET_STATUS', 'CREATE_INCIDENT', 'SEND_WECOM_MESSAGE', 'CALL_LLM_PROVIDER'],
        action_log: [],
        result_state: null,
        analysis_window: 'STANDALONE',
        attempt_result: null,
        conflict: false,
        requires_human_review: false,
        requires_policy_review: false,
        recovery_signal: safe.recovery_signal ?? null,
        emotion_signal: safe.emotion_signal ?? false,
        clinical_or_scope_evidence: safe.clinical_or_scope_evidence ?? false,
        catalog_version: serviceCatalog.catalog_version,
        rule_set_version: safeRuleSet.rule_set_version,
        observed_at: safe.observed_at,
        source_ref: safe.source_ref,
      };

      const matchedRules = [];
      for (const rule of orderedRules) {
        if (!conditionMatches(rule.when, state)) continue;
        matchedRules.push({
          rule_id: rule.rule_id,
          version: rule.version,
          priority: rule.priority,
          explanation: rule.explanation_template_zh,
        });
        for (const action of rule.actions) applyAction(action, state);
        state.symptom_codes = uniqueSorted(state.symptom_codes);
        state.symptom_facts.count = state.symptom_codes.length;
      }

      const selectedService = serviceCatalog.lookupService(state.selected_service_code);
      state.transaction_stage = safe.transaction_stage ?? inferTransactionStage(state.normalized_context, selectedService);
      state.owner_suggestion ??= selectedService?.default_owner_team ?? null;
      const requiredFields = uniqueSorted([...(selectedService?.required_fields ?? []), ...state.required_fields]);
      const missingFields = requiredFields.filter((field) => !fieldPresent(field, state));
      const filteredQuestions = uniqueSorted(state.question_codes)
        .filter((code) => !state.suppressed_question_codes.includes(code));
      const clarification = planClarification({
        question_codes: filteredQuestions,
        missing_fields: missingFields,
        selected_service_code: state.selected_service_code,
        service_required: true,
        conflict: state.conflict,
      });

      const facts = [];
      if (state.selected_service_code) facts.push(buildFactProvenance(factInput(state, {
        field_path: 'service.selected_service_code', value: state.selected_service_code,
        normalized_value: state.selected_service_code, source_kind: 'REPORTER_EXPLICIT',
        rule_id: alias.rule_id, confidence: 0.92,
      })));
      for (const match of taxonomy.matches.filter((item) => item.assertion !== 'NEGATED')) facts.push(buildFactProvenance(factInput(state, {
        field_path: 'fault.symptom_codes', value: match.matched_alias,
        normalized_value: match.symptom_code, source_kind: 'REPORTER_EXPLICIT',
        assertion: match.assertion, rule_id: match.rule_id, confidence: 0.9,
      })));
      const ruleFactValues = [
        ['classification.domain_intent', state.domain_intent],
        ['classification.scope', state.scope],
        ['classification.transaction_stage', state.transaction_stage],
      ];
      for (const [fieldPath, value] of ruleFactValues) {
        if (value === 'UNKNOWN') continue;
        const rule = matchedRules.find((item) => item.rule_id.startsWith(fieldPath.includes('domain_intent') ? 'INT-' : fieldPath.includes('scope') ? 'SCOPE-' : 'NORM-'));
        facts.push(buildFactProvenance(factInput(state, {
          field_path: fieldPath, value, normalized_value: value,
          source_kind: 'DETERMINISTIC_RULE', rule_id: rule?.rule_id ?? null,
          confidence: rule ? 0.85 : 0.75,
        })));
      }
      const distinctFacts = [...new Map(facts.map((fact) => [fact.fact_id, fact])).values()]
        .sort((left, right) => left.fact_id.localeCompare(right.fact_id, 'en'));
      const resultState = state.result_state ?? (
        state.selected_service_code && state.symptom_codes.length > 0 && missingFields.length === 0 ? 'COMPLETE' : 'PARTIAL'
      );
      const confidence = state.selected_service_code && state.symptom_codes.length > 0 ? 0.9
        : state.selected_service_code || state.symptom_codes.length > 0 ? 0.65 : 0;
      const output = {
        schema_version: '1.0.0',
        catalog_version: serviceCatalog.catalog_version,
        rule_set_version: safeRuleSet.rule_set_version,
        evaluated_at: state.observed_at,
        original_text: state.original_text,
        normalized_text: state.normalized_text,
        matched_rules: matchedRules,
        facts: distinctFacts,
        selected_service_code: state.selected_service_code,
        service_candidates: alias.candidate_service_codes,
        symptom_codes: state.symptom_codes,
        fault_types: taxonomy.fault_types,
        domain_intent: state.domain_intent,
        p1_request_type: state.domain_intent === 'INCIDENT_REPORT' ? 'INCIDENT' : 'UNKNOWN',
        transaction_stage: state.transaction_stage,
        scope: state.scope,
        clinical_impact: state.clinical_impact,
        owner_suggestion: state.owner_suggestion,
        cause_candidates: state.cause_candidates,
        privacy_flags: uniqueSorted(state.privacy_flags),
        missing_fields: missingFields,
        confidence,
        clarification_needed: clarification !== null,
        clarification,
        incident_candidate: state.incident_reasons.length > 0,
        incident_reason_codes: uniqueSorted(state.incident_reasons),
        requires_human_review: state.requires_human_review,
        result_state: resultState,
        analysis_window: state.analysis_window,
        attempt_result: state.attempt_result,
        forbidden_effects: uniqueSorted(state.forbidden_effects),
        side_effects: [],
      };
      return deepFreeze({ ...output, result_hash: sha256Canonical(output) });
    },
  });
}

export function evaluateDeterministicRules(input, options) {
  return createRuleEngine(options).evaluate(input);
}
