import { freezePublic, snapshotP2015Json } from './p2-015-domain-contracts.mjs';

export function projectContactJourney(row, { restricted = false } = {}) {
  const value = snapshotP2015Json(row);
  const result = {
    id: value.id, origin_intake_id: value.origin_intake_id, linked_ticket_id: value.linked_ticket_id,
    entry_mode: value.entry_mode, origin_channel: value.origin_channel, current_channel: value.current_channel,
    profile_resolution_status: value.profile_resolution_status, status: value.status,
    row_version: String(value.row_version), reported_at: value.reported_at,
    last_activity_at: value.last_activity_at, ended_at: value.ended_at,
  };
  if (restricted) result.profile_snapshot = value.profile_snapshot;
  return freezePublic(result);
}

export function projectDecision(row) {
  const value = snapshotP2015Json(row);
  // Directory version/time assertions are restricted to the authorized review detail.
  if (value.safe_result?.identity_review) delete value.safe_result.identity_review.directory_assertion;
  return freezePublic({ id: value.id, journey_id: value.journey_id, decision_ordinal: value.decision_ordinal,
    result_code: value.result_code, reason_code: value.reason_code, safe_result: value.safe_result,
    requires_manual_review: value.requires_manual_review,
    ticket_creation_recommended: value.ticket_creation_recommended,
    incident_review_candidate: value.incident_review_candidate, status: value.status,
    observed_at: value.observed_at });
}
