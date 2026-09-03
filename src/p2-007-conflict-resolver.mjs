import {
  P2_007_ERROR_CODES,
  assertPlainJson,
  deepFreeze,
  failP2007,
  sha256Canonical,
} from './p2-007-domain-utils.mjs';

function sameValue(left, right) {
  return sha256Canonical(left) === sha256Canonical(right);
}

function conflictType(fieldPath) {
  if (fieldPath.includes('location')) return 'LOCATION_CONFLICT';
  if (fieldPath.includes('service')) return 'SERVICE_CONFLICT';
  if (fieldPath.includes('scope')) return 'SCOPE_CONFLICT';
  return 'VALUE_CONFLICT';
}

export function resolveFactConflicts(input) {
  const safe = assertPlainJson(input);
  if (!Array.isArray(safe.facts) || safe.facts.length < 2) failP2007(P2_007_ERROR_CODES.inputInvalid);
  const facts = safe.facts.map((fact) => assertPlainJson(fact));
  const fieldPath = safe.field_path ?? facts.at(-1)?.field_path;
  const candidates = facts.filter((fact) => fact.field_path === fieldPath && fact.status === 'ACTIVE');
  if (candidates.length < 2 || candidates.every((fact) => sameValue(fact.normalized_value, candidates[0].normalized_value))) {
    return deepFreeze({ facts, conflict: null });
  }

  const correction = [...candidates].reverse().find((fact) => fact.source_kind === 'REPORTER_CORRECTION');
  if (correction) {
    const updated = facts.map((fact) => {
      if (fact.fact_id === correction.fact_id) return { ...fact, status: 'ACTIVE', reason_code: 'USER_CORRECTION' };
      if (fact.field_path === fieldPath && fact.status === 'ACTIVE') return { ...fact, status: 'SUPERSEDED', reason_code: 'USER_CORRECTION' };
      return fact;
    });
    const semantic = { field_path: fieldPath, candidate_fact_ids: candidates.map((fact) => fact.fact_id).sort() };
    return deepFreeze({
      facts: updated,
      previous_fact: updated.find((fact) => fact.fact_id !== correction.fact_id && fact.field_path === fieldPath),
      current_fact: updated.find((fact) => fact.fact_id === correction.fact_id),
      reason: 'USER_CORRECTION',
      conflict: {
        conflict_id: `conflict_${sha256Canonical(semantic).slice(0, 32)}`,
        field_path: fieldPath,
        candidate_fact_ids: semantic.candidate_fact_ids,
        conflict_type: conflictType(fieldPath),
        resolution_status: 'RESOLVED',
        strategy: 'LATEST_EXPLICIT_CORRECTION',
        selected_fact_id: correction.fact_id,
        requires_human: false,
        explanation_code: 'USER_CORRECTION_SUPERSEDES_PRIOR_FACT',
      },
    });
  }

  const updated = facts.map((fact) => fact.field_path === fieldPath && fact.status === 'ACTIVE'
    ? { ...fact, status: 'CONFLICTED', reason_code: 'UNRESOLVED_CONFLICT' }
    : fact);
  const semantic = { field_path: fieldPath, candidate_fact_ids: candidates.map((fact) => fact.fact_id).sort() };
  return deepFreeze({
    facts: updated,
    previous_fact: null,
    current_fact: null,
    reason: 'CONTRADICTORY_FACTS',
    conflict: {
      conflict_id: `conflict_${sha256Canonical(semantic).slice(0, 32)}`,
      field_path: fieldPath,
      candidate_fact_ids: semantic.candidate_fact_ids,
      conflict_type: conflictType(fieldPath),
      resolution_status: 'DEFERRED_TO_HUMAN',
      strategy: 'DO_NOT_RESOLVE_ASK_USER',
      selected_fact_id: null,
      requires_human: true,
      question_code: fieldPath.includes('service') ? 'Q_WHICH_SYSTEM_OR_FUNCTION' : 'Q_CONFIRM_CONFLICTING_FACT',
      explanation_code: 'CONTRADICTORY_ACTIVE_FACTS_REQUIRE_CLARIFICATION',
    },
  });
}

export const resolveConflict = resolveFactConflicts;
