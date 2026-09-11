// Source/spec adjudication only: this module never imports the implementation under test.
// Multichannel/context/mechanical rows have separate adapters; this oracle is for one Reporter text turn.
export function adjudicateG2SingleText(source) {
  const e = source.expected, id = source.case_id;
  if (id === 'P2-007-C090') return { surface: 'CORPUS_BUILD_PRIVACY', reason: 'Source note explicitly identifies a corpus-build assertion, not an inbound user request.' };
  if (id === 'P2-007-C047') return { surface: 'NORMAL_FRAME', results: ['NEEDS_DESCRIPTION', 'MANUAL_REVIEW_REQUIRED'],
    ticket: false, review: false, explicit_fault: false, reason: 'The text supplies conflicting asset/location metadata without an observed malfunction. Request the missing symptom or human review; do not invent a fault from the source intent label.' };
  if (['HOW_TO_QUESTION', 'CONFIG_CHANGE_REQUEST', 'POLICY_QUESTION'].includes(e.domain_intent)) return {
    surface: 'NORMAL_FRAME', results: ['BUSINESS_CONSULTATION', 'MANUAL_REVIEW_REQUIRED'], ticket: false, review: true,
    explicit_fault: false, reason: 'docs51: policy or business guidance without established authority goes to a reachable human queue. Questions do not authorize clinical advice or an invented fault.' };
  if (e.domain_intent === 'STATUS_QUERY') return { surface: 'NORMAL_FRAME', results: ['STATUS_QUERY', 'MANUAL_REVIEW_REQUIRED'],
    ticket: false, review: true, explicit_fault: false, reason: 'No authorized existing Ticket reference is supplied; docs51 requires human resolution of the association.' };
  if (e.domain_intent === 'ESCALATION_COMPLAINT') return { surface: 'NORMAL_FRAME', results: ['MANUAL_REVIEW_REQUIRED'],
    ticket: false, review: true, explicit_fault: false, reason: 'A service-response complaint requires human follow-up, not a guessed telephone equipment fault or automatic closure.' };
  if (['RECOVERY_UPDATE', 'ACKNOWLEDGEMENT'].includes(e.domain_intent)) return { surface: 'NORMAL_FRAME', results: ['ACKNOWLEDGEMENT', 'MANUAL_REVIEW_REQUIRED'],
    ticket: false, review: false, explicit_fault: false, reason: 'Standalone recovery/thanks has no authorized prior Ticket here. Preserve the message without inventing or closing a Ticket.' };
  if (e.domain_intent === 'NON_IT_REQUEST') return { surface: 'NORMAL_FRAME', results: ['OUT_OF_SCOPE'],
    ticket: false, review: false, explicit_fault: false, reason: 'Water, furniture and air conditioning are outside this IT service scope.' };
  if (e.domain_intent === 'INCIDENT_REPORT') return { surface: 'NORMAL_FRAME',
    results: e.result_state === 'REQUIRES_HUMAN_REVIEW' ? ['MANUAL_REVIEW_REQUIRED']
      : ['TICKET_ELIGIBLE', ...(e.incident_candidate ? ['INCIDENT_REVIEW_CANDIDATE'] : [])],
    ticket: true, review: e.result_state === 'REQUIRES_HUMAN_REVIEW', explicit_fault: true,
    reason: e.result_state === 'REQUIRES_HUMAN_REVIEW'
      ? 'Source risk expectation and docs51 require both durable minimal acceptance and actual human review.'
      : 'The ordinary clear-fault case requires minimal Ticket acceptance; an Incident candidate is allowed only when the source explicitly supplies a wide/correlated signal. Rule-failure human fallback is evaluated in separate fault-injection cases, not used to raise this normal-case score.' };
  return { surface: 'NORMAL_FRAME', results: ['NEEDS_DESCRIPTION', 'MANUAL_REVIEW_REQUIRED'], ticket: false, review: false,
    explicit_fault: false, reason: 'The supplied text lacks an explicit new malfunction; preserve it and ask for the missing description or human clarification.' };
}

export function adjudicateG2MultiText(source) {
  if (source.turns.length <= 1 || !source.turns.every(t => t.speaker === 'REPORTER')) throw Error('G2_MULTI_REPORTER_ADAPTER_REQUIRED');
  if (source.expected.result_state === 'NEEDS_DESCRIPTION') return { ticket: false, review: false,
    results: ['NEEDS_DESCRIPTION', 'BUSINESS_CONSULTATION', 'MANUAL_REVIEW_REQUIRED'],
    reason: 'Media without OCR and incomplete text do not establish a visible fault. Ask for the missing description; genuine business questions may enter the existing human queue.' };
  if (source.case_id === 'P2-007-C033') return { ticket: true, review: false, first_turn_ticket_required: true,
    results: ['RELATED_FOLLOW_UP', 'ACKNOWLEDGEMENT', 'TICKET_ELIGIBLE'],
    reason: 'The first explicit malfunction must already be accepted. Subsequent recovery must retain that same Ticket without automatic closure; a repeated classification may only replay existing facts.' };
  return { ticket: true, review: source.expected.result_state === 'REQUIRES_HUMAN_REVIEW',
    results: source.expected.result_state === 'REQUIRES_HUMAN_REVIEW' ? ['MANUAL_REVIEW_REQUIRED']
      : ['TICKET_ELIGIBLE', 'RELATED_FOLLOW_UP', ...(source.expected.incident_candidate ? ['INCIDENT_REVIEW_CANDIDATE'] : [])],
    reason: source.case_id === 'P2-007-C087'
      ? 'The original P2-007 source explicitly requires human review of self-reported patient-result media. Its P2-015 TICKET_ELIGIBLE/manual=false reference conflicts with that safety requirement. Preserve minimal acceptance plus an actual human queue, based only on text and persisted media metadata, never OCR.'
      : 'Same-Reporter fragments retain one Intake/Journey and one minimal Ticket. Follow-up classification is idempotent; source-authorized risk/candidate review must be visible and handleable.' };
}
