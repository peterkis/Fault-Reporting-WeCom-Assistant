import {
  P2_015_ACTION_TYPES,
  P2_015_ERROR_CODES,
  P2_015_RESULT_CODES,
  failP2015,
  freezePublic,
  safeHash,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

export const P2_015_ENGINE_VERSION = 'p2-007-adapter/1.0.0';
export const P2_015_DECISION_POLICY_VERSION = 'p2-015-safe-route/1.0.9-g2';

const ACTION_BY_RESULT = Object.freeze({
  TICKET_ELIGIBLE: ['APPLY_INTAKE_CLASSIFICATION', 'CREATE_MINIMAL_TICKET'],
  NEEDS_DESCRIPTION: ['APPLY_INTAKE_CLASSIFICATION', 'REQUEST_ONE_DESCRIPTION'],
  MANUAL_REVIEW_REQUIRED: ['APPLY_INTAKE_CLASSIFICATION', 'ENQUEUE_MANUAL_REVIEW'],
  RELATED_FOLLOW_UP: ['APPEND_RELATED_FOLLOW_UP'],
  STATUS_QUERY: ['QUERY_AUTHORIZED_STATUS'],
  SERVICE_REQUEST: ['APPLY_INTAKE_CLASSIFICATION', 'ROUTE_SERVICE_REQUEST', 'CREATE_MINIMAL_TICKET'],
  BUSINESS_CONSULTATION: ['ROUTE_BUSINESS_CONSULTATION'],
  ACKNOWLEDGEMENT: ['SEND_FIXED_ACKNOWLEDGEMENT'],
  OUT_OF_SCOPE: ['SEND_FIXED_SCOPE_NOTICE'],
  INCIDENT_REVIEW_CANDIDATE: ['APPLY_INTAKE_CLASSIFICATION', 'CREATE_MINIMAL_TICKET', 'ENQUEUE_INCIDENT_REVIEW'],
});

function safeFacts(facts) {
  return (Array.isArray(facts) ? facts : []).map((fact) => ({
    fact_id: fact.fact_id,
    field_path: fact.field_path,
    normalized_value: fact.normalized_value,
    assertion: fact.assertion,
    source_kind: fact.source_kind,
    source_ref: fact.source_ref,
    source_hash: fact.source_hash,
    observed_at: fact.observed_at,
    confidence_level: fact.confidence_level,
    reliability_tier: fact.reliability_tier,
    status: fact.status,
    sensitivity: fact.sensitivity,
    catalog_version: fact.catalog_version,
    rule_set_version: fact.rule_set_version,
    rule_id: fact.rule_id,
  }));
}

function trustedReviewContext(context) {
  return {
    ...(['UNIQUE_GUIDED_JOURNEY','EXISTING_DIRECT_CHANNEL_BINDING','EXPLICIT_TICKET_REFERENCE','EXPLICIT_USER_NEW_TOPIC'].includes(context.journey_association?.method)
      ?{journey_association:context.journey_association}:{}),
    ...(context.identity_review_required === true ? { identity_review: { reason_code: 'DIRECTORY_ACCOUNT_INACTIVE',
      directory_snapshot_hash: context.directory_snapshot_hash, directory_assertion: context.directory_assertion } } : {}),
    ...(context.association_review_required === true ? { association_review: { reason_code: 'MULTIPLE_GUIDED_JOURNEYS' } } : {}),
  };
}

function routeCode(output, context) {
  if (context.association_review_required === true) return ['MANUAL_REVIEW_REQUIRED', context.association_review_reason === 'EXPLICIT_REFERENCE_REJECTED' ? 'EXPLICIT_REFERENCE_REJECTED' : 'MULTIPLE_GUIDED_JOURNEYS'];
  if (context.identity_review_required === true) return ['MANUAL_REVIEW_REQUIRED', 'DIRECTORY_ACCOUNT_INACTIVE'];
  const text = (context.safe_normalized_text ?? '').toLocaleLowerCase('zh-CN');
  const hasFault = output.domain_intent === 'INCIDENT_REPORT' || (output.symptom_codes?.length ?? 0) > 0;
  if (hasFault && (output.requires_human_review || output.clinical_impact === 'CRITICAL_REVIEW_REQUIRED' || context.conflicts?.length > 0)) {
    return ['MANUAL_REVIEW_REQUIRED', 'FAULT_REQUIRES_SAFE_REVIEW'];
  }
  if (hasFault && output.incident_candidate) return ['INCIDENT_REVIEW_CANDIDATE', 'DETERMINISTIC_INCIDENT_CANDIDATE'];
  if (hasFault && output.clinical_impact === 'HIGH') return ['MANUAL_REVIEW_REQUIRED', 'FAULT_REQUIRES_SAFE_REVIEW'];
  if (hasFault) return ['TICKET_ELIGIBLE', 'EXPLICIT_TECHNICAL_FAULT'];
  if (context.reliable_follow_up === true && (output.domain_intent === 'RECOVERY_UPDATE' || /还是不行|仍然不行|又不行/u.test(text))) {
    return ['RELATED_FOLLOW_UP', 'RELIABLE_EXISTING_JOURNEY'];
  }
  if (output.domain_intent === 'STATUS_QUERY' || /工单.*(哪|到|进度|状态)/u.test(text)) return ['STATUS_QUERY', 'AUTHORIZED_STATUS_QUERY_REQUIRED'];
  if (output.domain_intent === 'SERVICE_REQUEST' || /重置密码|开通|权限申请/u.test(text)) return ['SERVICE_REQUEST', 'DETERMINISTIC_SERVICE_REQUEST'];
  if (output.domain_intent === 'NON_IT_REQUEST' || /天气|闲聊/u.test(text)) return ['OUT_OF_SCOPE', 'DETERMINISTIC_NON_IT_SCOPE'];
  if (output.domain_intent === 'HOW_TO_QUESTION' || output.domain_intent === 'CONFIG_CHANGE_REQUEST' || /规则.*(怎么|如何|理解)/u.test(text)) {
    return ['BUSINESS_CONSULTATION', 'BUSINESS_POLICY_NOT_GUESSED'];
  }
  if (output.domain_intent === 'ACKNOWLEDGEMENT_OR_CHATTER' || /^(谢谢|收到|好了|好的)[!.。！ ]*$/u.test(text)) return ['ACKNOWLEDGEMENT', 'ACK_WITHOUT_NEW_FAULT'];
  if (output.domain_intent === 'RECOVERY_UPDATE') return ['ACKNOWLEDGEMENT', 'RECOVERY_WITHOUT_AUTHORIZED_TICKET'];
  if (output.domain_intent === 'ESCALATION_COMPLAINT' || output.requires_human_review) return ['MANUAL_REVIEW_REQUIRED', 'HUMAN_FOLLOW_UP_REQUIRED'];
  if (output.clarification_needed || output.result_state === 'PARTIAL' || text === '' || /^(在吗|系统不行|@?bot)$/iu.test(text)) return ['NEEDS_DESCRIPTION', 'ONE_DESCRIPTION_REQUIRED'];
  return ['MANUAL_REVIEW_REQUIRED', 'SAFE_FALLBACK_UNKNOWN'];
}

function actionSuggestions(resultCode, context, output) {
  const manualReview = resultCode === 'MANUAL_REVIEW_REQUIRED';
  const actions = [...(ACTION_BY_RESULT[resultCode] ?? [])];
  if (manualReview && (output.domain_intent === 'INCIDENT_REPORT' || (output.symptom_codes?.length ?? 0) > 0)) {
    actions.unshift('APPLY_INTAKE_CLASSIFICATION', 'CREATE_MINIMAL_TICKET');
  }
  return actions.map((actionType, index) => {
    if (!P2_015_ACTION_TYPES.includes(actionType)) failP2015(P2_015_ERROR_CODES.inputInvalid);
    const safePayload = {
      service_intake_id: context.service_intake_id,
      journey_ref: context.journey_ref,
      clarification_code: actionType === 'REQUEST_ONE_DESCRIPTION'
        ? (output.clarification?.question_code ?? 'DESCRIBE_OBSERVED_BEHAVIOR') : null,
      template_code: actionType.startsWith('SEND_FIXED_') ? `P2_015_${actionType}` : null,
    };
    return {
      action_ordinal: index + 1,
      action_type: actionType,
      execution_policy: ['ENQUEUE_INCIDENT_REVIEW', 'QUERY_AUTHORIZED_STATUS', 'ROUTE_BUSINESS_CONSULTATION'].includes(actionType)
        ? 'HUMAN_CONFIRM_REQUIRED' : 'AUTO_SAFE_DB_ONLY',
      safe_payload: safePayload,
      payload_hash: safeHash(safePayload),
    };
  });
}

export function routeP2007Decision({ rule_output: ruleOutput, context = {} }) {
  const output = snapshotP2015Json(ruleOutput);
  const safeContext = snapshotP2015Json(context);
  if (typeof output.catalog_version !== 'string' || typeof output.rule_set_version !== 'string'
    || typeof output.result_hash !== 'string') failP2015(P2_015_ERROR_CODES.inputInvalid);
  const [resultCode, reasonCode] = routeCode(output, safeContext);
  if (!P2_015_RESULT_CODES.includes(resultCode)) failP2015(P2_015_ERROR_CODES.inputInvalid);
  const safeResult = {
    result_code: resultCode,
    reason_code: reasonCode,
    catalog_version: output.catalog_version,
    rule_set_version: output.rule_set_version,
    engine_version: P2_015_ENGINE_VERSION,
    decision_policy_version: P2_015_DECISION_POLICY_VERSION,
    source_refs: [...(safeContext.source_refs ?? [])],
    message_sequence_window: safeContext.message_sequence_window,
    fact_provenance: safeFacts(output.facts),
    ...(output.corroboration_anchor?{corroboration_anchor:output.corroboration_anchor}:{}),
    privacy_flags:output.privacy_flags??[],
    ...trustedReviewContext(safeContext),
    ...(safeContext.group_corroboration_safety?{group_corroboration_safety:safeContext.group_corroboration_safety}:{}),
    known_fields: {
      selected_service_code: output.selected_service_code ?? null,
      symptom_codes: output.symptom_codes ?? [],
      domain_intent: output.domain_intent ?? 'UNKNOWN',
      transaction_stage: output.transaction_stage ?? 'UNKNOWN',
      scope: output.scope ?? 'UNKNOWN',
    },
    unknown_fields: [...new Set([...(output.missing_fields ?? []), ...(safeContext.association_review_required ? ['journey_selection'] : [])])],
    conflicts: safeContext.conflicts ?? [],
    clinical_safety_risk: output.clinical_impact ?? 'UNKNOWN',
    manual_review_required: resultCode === 'MANUAL_REVIEW_REQUIRED',
    ticket_creation_recommended: ['TICKET_ELIGIBLE', 'SERVICE_REQUEST', 'INCIDENT_REVIEW_CANDIDATE'].includes(resultCode)
      || (resultCode === 'MANUAL_REVIEW_REQUIRED'
        && (output.domain_intent === 'INCIDENT_REPORT' || (output.symptom_codes?.length ?? 0) > 0)),
    incident_review_candidate: resultCode === 'INCIDENT_REVIEW_CANDIDATE',
    safe_action_suggestions: [],
  };
  safeResult.safe_action_suggestions = actionSuggestions(resultCode, safeContext, output);
  const inputHash = safeContext.input_hash ?? safeHash({ source_refs: safeResult.source_refs, window: safeResult.message_sequence_window, p2_007_result_hash: output.result_hash });
  const resultHash = safeHash(safeResult);
  return freezePublic({ ...safeResult, input_hash: inputHash, result_hash: resultHash });
}

export function routeRuleFailure(context = {}) {
  const safeContext = snapshotP2015Json(context);
  const safeResult = {
    result_code: 'MANUAL_REVIEW_REQUIRED',
    reason_code: 'RULE_ENGINE_UNAVAILABLE',
    catalog_version: safeContext.catalog_version ?? 'UNAVAILABLE',
    rule_set_version: safeContext.rule_set_version ?? 'UNAVAILABLE',
    engine_version: P2_015_ENGINE_VERSION,
    decision_policy_version: P2_015_DECISION_POLICY_VERSION,
    source_refs: safeContext.source_refs ?? [],
    message_sequence_window: safeContext.message_sequence_window,
    fact_provenance: [], known_fields: {}, unknown_fields: ['rule_result', ...(safeContext.association_review_required ? ['journey_selection'] : [])], conflicts: [],
    ...trustedReviewContext(safeContext),
    clinical_safety_risk: 'UNKNOWN', manual_review_required: true,
    ticket_creation_recommended: false, incident_review_candidate: false,
    safe_action_suggestions: actionSuggestions('MANUAL_REVIEW_REQUIRED', safeContext, {}),
  };
  return freezePublic({ ...safeResult, input_hash: safeHash(safeContext), result_hash: safeHash(safeResult) });
}
