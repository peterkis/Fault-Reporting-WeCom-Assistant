import { assertLocalDateTime } from './platform/time-contract.mjs';
import {
  P2_007_ERROR_CODES,
  assertPlainJson,
  deepFreeze,
  failP2007,
  sha256Canonical,
  sha256Text,
} from './p2-007-domain-utils.mjs';

const SOURCE_KINDS = new Set([
  'HUMAN_OPERATOR_CONFIRMED', 'REPORTER_CORRECTION', 'AUTHORITATIVE_DIRECTORY',
  'SYSTEM_OBSERVATION', 'REPORTER_EXPLICIT', 'DETERMINISTIC_RULE', 'CONTEXT_INHERITANCE',
  'MEDIA_METADATA', 'OCR_EXTRACTED_FUTURE', 'LLM_SUGGESTED_FUTURE', 'DEFAULT_UNKNOWN',
  'TRUSTED_CHANNEL_METADATA', 'DIRECTORY_PROFILE_SNAPSHOT', 'CHANNEL_TRANSITION',
  'CONVERSATION_CONTROL_EVENT', 'COMMUNICATION_MESSAGE_EVENT', 'DELIVERY_RECEIPT',
  'INCIDENT_CORRELATION_RULE', 'MONITORING_CORROBORATION',
]);
const ASSERTIONS = new Set(['AFFIRMED', 'NEGATED', 'UNCERTAIN']);
const STATUSES = new Set(['ACTIVE', 'SUPERSEDED', 'CONFLICTED', 'REJECTED']);
const SENSITIVITIES = new Set(['INTERNAL', 'SENSITIVE_INTERNAL', 'PERSONAL', 'PATIENT_SENSITIVE', 'SECRET']);
const CONFIDENCE_LEVELS = new Set(['EXACT', 'STRONG', 'WEAK', 'UNKNOWN']);

function sourceKind(value) {
  const mapped = {
    USER_MESSAGE: 'REPORTER_EXPLICIT',
    RULE: 'DETERMINISTIC_RULE',
    USER_CORRECTION: 'REPORTER_CORRECTION',
  }[value] ?? value;
  if (!SOURCE_KINDS.has(mapped)) failP2007(P2_007_ERROR_CODES.inputInvalid);
  return mapped;
}

function confidenceParts(confidence, confidenceLevel, reliabilityTier) {
  let tier = reliabilityTier;
  let level = confidenceLevel;
  if (confidence !== undefined) {
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) failP2007(P2_007_ERROR_CODES.inputInvalid);
    tier ??= Math.round(confidence * 100);
    level ??= confidence >= 0.95 ? 'EXACT' : confidence >= 0.75 ? 'STRONG' : confidence > 0 ? 'WEAK' : 'UNKNOWN';
  }
  tier ??= 0;
  level ??= 'UNKNOWN';
  if (!Number.isInteger(tier) || tier < 0 || tier > 100 || !CONFIDENCE_LEVELS.has(level)) {
    failP2007(P2_007_ERROR_CODES.inputInvalid);
  }
  return { confidence_level: level, reliability_tier: tier };
}

function nullableRef(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/u.test(value)) failP2007(P2_007_ERROR_CODES.inputInvalid);
  return value;
}

export function buildFactProvenance(input) {
  const safe = assertPlainJson(input);
  const fieldPath = safe.field_path ?? safe.field;
  const sourceRef = safe.source_ref;
  const observedAt = safe.observed_at ?? safe.created_at;
  const ruleId = safe.rule_id ?? null;
  if (
    typeof fieldPath !== 'string' || !/^[a-z][a-z0-9_.\[\]-]{1,127}$/u.test(fieldPath)
    || typeof sourceRef !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/u.test(sourceRef)
    || (ruleId !== null && (typeof ruleId !== 'string' || !/^[A-Z]+-[0-9]{3}$/u.test(ruleId)))
  ) failP2007(P2_007_ERROR_CODES.inputInvalid);
  let localDateTime;
  try { localDateTime = assertLocalDateTime(observedAt); } catch { failP2007(P2_007_ERROR_CODES.localDateTimeInvalid); }

  const assertion = safe.assertion ?? 'AFFIRMED';
  const status = safe.status ?? 'ACTIVE';
  const sensitivity = safe.sensitivity ?? 'INTERNAL';
  if (!ASSERTIONS.has(assertion) || !STATUSES.has(status) || !SENSITIVITIES.has(sensitivity)) {
    failP2007(P2_007_ERROR_CODES.inputInvalid);
  }
  const normalizedValue = safe.normalized_value ?? safe.value;
  const confidence = confidenceParts(safe.confidence, safe.confidence_level, safe.reliability_tier);
  const sourceHash = safe.source_hash ?? sha256Text(safe.source_text ?? sourceRef);
  if (!/^[a-f0-9]{64}$/u.test(sourceHash)) failP2007(P2_007_ERROR_CODES.inputInvalid);
  const semantic = {
    field_path: fieldPath,
    value: safe.value,
    normalized_value: normalizedValue,
    assertion,
    source_kind: sourceKind(safe.source_kind ?? safe.source_type ?? 'DETERMINISTIC_RULE'),
    source_ref: sourceRef,
    source_hash: sourceHash,
    observed_at: localDateTime,
    ...confidence,
    status,
    sensitivity,
    catalog_version: safe.catalog_version,
    rule_set_version: safe.rule_set_version,
    rule_id: ruleId,
    replaces_fact_id: safe.replaces_fact_id ?? null,
    reason_code: safe.reason_code ?? null,
    journey_ref: nullableRef(safe.journey_ref),
    channel_leg_ref: nullableRef(safe.channel_leg_ref),
    actor_ref: nullableRef(safe.actor_ref),
  };
  if (typeof semantic.catalog_version !== 'string' || typeof semantic.rule_set_version !== 'string') {
    failP2007(P2_007_ERROR_CODES.inputInvalid);
  }
  const factId = safe.fact_id ?? `fact_${sha256Canonical(semantic).slice(0, 32)}`;
  if (!/^fact_[A-Za-z0-9_-]{8,96}$/u.test(factId)) failP2007(P2_007_ERROR_CODES.inputInvalid);
  return deepFreeze({ fact_id: factId, ...semantic });
}

export function factResultHash(facts) {
  return sha256Canonical([...facts].sort((left, right) => left.fact_id.localeCompare(right.fact_id, 'en')));
}
