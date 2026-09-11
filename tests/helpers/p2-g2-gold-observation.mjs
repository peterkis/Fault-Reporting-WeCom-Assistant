import assert from 'node:assert/strict';
import { g2Hash } from '../../src/p2-g2-validation-config.mjs';

// Contract assertions, independent of the router's implementation/configuration.
const requiredActions = Object.freeze({
  TICKET_ELIGIBLE: ['APPLY_INTAKE_CLASSIFICATION', 'CREATE_MINIMAL_TICKET'],
  NEEDS_DESCRIPTION: ['APPLY_INTAKE_CLASSIFICATION', 'REQUEST_ONE_DESCRIPTION'],
  MANUAL_REVIEW_REQUIRED: ['APPLY_INTAKE_CLASSIFICATION', 'ENQUEUE_MANUAL_REVIEW'],
  RELATED_FOLLOW_UP: ['APPEND_RELATED_FOLLOW_UP'], STATUS_QUERY: ['QUERY_AUTHORIZED_STATUS'],
  SERVICE_REQUEST: ['APPLY_INTAKE_CLASSIFICATION', 'ROUTE_SERVICE_REQUEST', 'CREATE_MINIMAL_TICKET'],
  BUSINESS_CONSULTATION: ['ROUTE_BUSINESS_CONSULTATION'], ACKNOWLEDGEMENT: ['SEND_FIXED_ACKNOWLEDGEMENT'],
  OUT_OF_SCOPE: ['SEND_FIXED_SCOPE_NOTICE'],
  INCIDENT_REVIEW_CANDIDATE: ['APPLY_INTAKE_CLASSIFICATION', 'CREATE_MINIMAL_TICKET', 'ENQUEUE_INCIDENT_REVIEW'],
});
export async function g2BusinessCounts(pool) {
  return (await pool.query(`SELECT
    (SELECT count(*)::integer FROM channel.message_inbox) AS inbox,
    (SELECT count(*)::integer FROM intake.service_intake) AS intakes,
    (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets,
    (SELECT count(*)::integer FROM intake.manual_review_item) AS reviews,
    (SELECT count(*)::integer FROM communication.message) AS messages,
    (SELECT count(*)::integer FROM communication.outbox) AS outboxes,
    (SELECT count(*)::integer FROM communication.delivery) AS deliveries,
    (SELECT count(*)::integer FROM incident.incident) AS incidents`)).rows[0];
}
export const g2CountDelta = (before, after) => Object.fromEntries(Object.keys(before).map(k => [k, after[k] - before[k]]));
export async function g2DecisionObservation({ pool, decisionId }) {
  const decision = (await pool.query('SELECT result_code,reason_code,safe_result FROM intake.deterministic_decision WHERE id=$1::uuid', [decisionId])).rows[0];
  const actions = (await pool.query(`SELECT action_type,state,result_ref_type FROM intake.safe_action_suggestion
    WHERE decision_id=$1::uuid ORDER BY action_type,id`, [decisionId])).rows;
  for (const action of requiredActions[decision.result_code] ?? [])
    assert.ok(actions.some(a => a.action_type === action && ['EXECUTED', 'REPLAYED'].includes(a.state)
      && a.result_ref_type !== null), 'P2_G2_REQUIRED_SAFE_ACTION_NOT_EXECUTED:' + action);
  assert.match(decision.reason_code, /^[A-Z][A-Z0-9_]+$/u);
  const provenance = decision.safe_result.fact_provenance;
  assert.ok(Array.isArray(provenance));
  return { result_code: decision.result_code, reason_code: decision.reason_code, actual_actions: actions,
    safe_result_sha256: g2Hash(JSON.stringify(decision.safe_result)),
    // Hash the values as a whole; retain only non-identifying rule/source metadata.
    provenance: provenance.map(p => ({ field_path: p.field_path, rule_id: p.rule_id,
      source_kind: p.source_kind, source_hash: p.source_hash, status: p.status })) };
}
