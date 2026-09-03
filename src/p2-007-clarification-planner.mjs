import { P2_007_ERROR_CODES, assertPlainJson, deepFreeze, failP2007 } from './p2-007-domain-utils.mjs';

const QUESTIONS = Object.freeze({
  Q_WHICH_SYSTEM_OR_FUNCTION: { field_path: 'service', priority: 100, question: '请问无法使用的是哪个系统或功能？' },
  Q_PATIENT_REFERENCE_PRIVATE_CHANNEL: { field_path: 'patient_ref_secure', priority: 95, question: '请在安全的单聊渠道提供患者引用信息。' },
  Q_SELECT_PENDING_INTAKE: { field_path: 'journey_ref', priority: 92, question: '您有多个待补充问题，请选择这条消息对应的问题。' },
  Q_LOCATION_AND_ASSET_HINT: { field_path: 'occurrence_location_or_asset_hint', priority: 90, question: '请问故障发生在哪个位置，或可否提供设备标识？' },
  Q_WHICH_STEP_FAILED: { field_path: 'transaction_stage', priority: 80, question: '请问操作到哪一步时出现问题？' },
  Q_AFFECTED_SCOPE: { field_path: 'scope', priority: 70, question: '请问是单台设备、单个用户，还是多人都受影响？' },
  Q_CLINICAL_IMPACT: { field_path: 'impact', priority: 60, question: '这个问题目前是否已经影响患者诊疗？' },
  Q_CONFIRM_CONFLICTING_FACT: { field_path: 'conflict', priority: 98, question: '前后信息不一致，请确认当前正确的信息。' },
});

const FIELD_TO_QUESTION = Object.freeze({
  service: 'Q_WHICH_SYSTEM_OR_FUNCTION',
  system: 'Q_WHICH_SYSTEM_OR_FUNCTION',
  patient_ref_secure: 'Q_PATIENT_REFERENCE_PRIVATE_CHANNEL',
  occurrence_location: 'Q_LOCATION_AND_ASSET_HINT',
  location: 'Q_LOCATION_AND_ASSET_HINT',
  occurrence_location_or_asset_hint: 'Q_LOCATION_AND_ASSET_HINT',
  asset_hint: 'Q_LOCATION_AND_ASSET_HINT',
  transaction_stage: 'Q_WHICH_STEP_FAILED',
  scope: 'Q_AFFECTED_SCOPE',
  impact: 'Q_CLINICAL_IMPACT',
});

export function planClarification(input) {
  const safe = assertPlainJson(input);
  const requestedCodes = Array.isArray(safe.question_codes) ? safe.question_codes : [];
  const missing = Array.isArray(safe.missing_fields) ? safe.missing_fields : [];
  const candidates = [];
  for (const code of requestedCodes) {
    if (QUESTIONS[code]) candidates.push({ question_code: code, ...QUESTIONS[code] });
  }
  for (const field of missing) {
    const code = FIELD_TO_QUESTION[field];
    if (code) candidates.push({ question_code: code, ...QUESTIONS[code] });
  }
  if (safe.conflict === true) candidates.push({ question_code: 'Q_CONFIRM_CONFLICTING_FACT', ...QUESTIONS.Q_CONFIRM_CONFLICTING_FACT });
  if ((safe.selected_service_code ?? null) === null && safe.service_required !== false) {
    candidates.push({ question_code: 'Q_WHICH_SYSTEM_OR_FUNCTION', ...QUESTIONS.Q_WHICH_SYSTEM_OR_FUNCTION });
  }
  const unique = [...new Map(candidates.map((candidate) => [candidate.question_code, candidate])).values()]
    .sort((left, right) => right.priority - left.priority || left.question_code.localeCompare(right.question_code, 'en'));
  if (unique.length === 0) return null;
  const selected = unique[0];
  if (!selected) failP2007(P2_007_ERROR_CODES.inputInvalid);
  return deepFreeze({
    question_code: selected.question_code,
    field_path: selected.field_path,
    question: selected.question,
    priority: selected.priority,
    question_count: 1,
  });
}

export const createClarificationPlan = planClarification;
