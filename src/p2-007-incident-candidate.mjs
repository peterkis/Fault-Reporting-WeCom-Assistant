import { assertLocalDateTime } from './platform/time-contract.mjs';
import {
  P2_007_ERROR_CODES,
  assertPlainJson,
  deepFreeze,
  failP2007,
  sha256Canonical,
  uniqueSorted,
} from './p2-007-domain-utils.mjs';

const DEFAULT_THRESHOLDS = Object.freeze({
  candidate_reporters: 3,
  candidate_evidence: 3,
  local_reporters: 3,
  local_locations: 2,
  campus_reporters: 5,
  campus_departments: 2,
  hospital_reporters: 8,
  hospital_departments: 3,
  hospital_locations: 2,
  correlation_window_ms: 120_000,
});

function localOrNull(value) {
  if (value === null || value === undefined) return null;
  try { return assertLocalDateTime(value); } catch { failP2007(P2_007_ERROR_CODES.localDateTimeInvalid); }
}

function severity(value) {
  const map = {
    CRITICAL_REVIEW_REQUIRED: 'CRITICAL', CRITICAL: 'CRITICAL', HIGH: 'HIGH',
    MODERATE: 'MEDIUM', MEDIUM: 'MEDIUM', LOW: 'LOW', UNKNOWN: 'UNKNOWN',
  };
  return map[value] ?? 'UNKNOWN';
}

export function generateIncidentCandidate(input) {
  const safe = assertPlainJson(input);
  const reports = Array.isArray(safe.reports) ? safe.reports : [];
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(safe.thresholds ?? {}) };
  for (const value of Object.values(thresholds)) {
    if (!Number.isInteger(value) || value < 0) failP2007(P2_007_ERROR_CODES.inputInvalid);
  }
  const reporterKeys = uniqueSorted(reports.map((report) => report.reporter_ref).filter((value) => typeof value === 'string'));
  const departmentKeys = uniqueSorted(reports.map((report) => report.department_ref).filter((value) => typeof value === 'string'));
  const locationKeys = uniqueSorted(reports.map((report) => report.location_ref).filter((value) => typeof value === 'string'));
  const evidenceFactIds = uniqueSorted([
    ...(Array.isArray(safe.evidence_fact_ids) ? safe.evidence_fact_ids : []),
    ...reports.flatMap((report) => Array.isArray(report.evidence_fact_ids) ? report.evidence_fact_ids : []),
  ]);
  if (evidenceFactIds.some((id) => typeof id !== 'string' || !/^fact_[A-Za-z0-9_-]{8,96}$/u.test(id))) {
    failP2007(P2_007_ERROR_CODES.inputInvalid);
  }

  const serviceFamily = safe.service_family ?? reports.find((report) => report.service_family)?.service_family ?? null;
  const symptomFamily = safe.symptom_family ?? reports.find((report) => report.symptom_family)?.symptom_family ?? null;
  const compatible = safe.compatible_fault_signals !== false && serviceFamily !== null && symptomFamily !== null;
  const monitoring = safe.authoritative_monitoring === true;
  const activeIncident = safe.active_incident === true;
  const enoughEvidence = evidenceFactIds.length >= thresholds.candidate_evidence;
  const isCandidate = compatible && (activeIncident || monitoring
    || (reporterKeys.length >= thresholds.candidate_reporters && enoughEvidence));

  let scopeCandidate = 'NONE';
  let promotion = 'NONE';
  if (isCandidate) {
    scopeCandidate = 'ROOM';
    promotion = 'REVIEW_LOCAL_INCIDENT';
    if (activeIncident) promotion = 'LINK_TO_ACTIVE_INCIDENT';
    else if (
      reporterKeys.length >= thresholds.hospital_reporters
      && departmentKeys.length >= thresholds.hospital_departments
      && locationKeys.length >= thresholds.hospital_locations
    ) {
      scopeCandidate = 'HOSPITAL_WIDE';
      promotion = 'REVIEW_HOSPITAL_INCIDENT';
    } else if (reporterKeys.length >= thresholds.campus_reporters && departmentKeys.length >= thresholds.campus_departments) {
      scopeCandidate = 'CAMPUS';
      promotion = 'REVIEW_CAMPUS_INCIDENT';
    } else if (departmentKeys.length >= 1) scopeCandidate = 'DEPARTMENT';
  }

  const times = reports.map((report) => localOrNull(report.observed_at)).filter(Boolean).sort();
  const reasonCodes = [];
  if (reporterKeys.length >= thresholds.candidate_reporters) reasonCodes.push('MULTI_REPORTER_BURST');
  if (monitoring) reasonCodes.push('MONITORING_CORROBORATED');
  if (activeIncident) reasonCodes.push('ACTIVE_INCIDENT_MATCH');
  if (scopeCandidate === 'HOSPITAL_WIDE') reasonCodes.push('HOSPITAL_WIDE_PATTERN');
  const cluster = { service_family: serviceFamily, symptom_family: symptomFamily, scope_candidate: scopeCandidate };
  const clusterHash = isCandidate ? sha256Canonical(cluster) : null;
  return deepFreeze({
    schema_version: '1.0.0',
    is_candidate: isCandidate,
    candidate_ref: isCandidate ? `candidate:${clusterHash.slice(0, 32)}` : null,
    cluster_key_hash: clusterHash,
    service_family: serviceFamily,
    symptom_family: symptomFamily,
    scope_candidate: scopeCandidate,
    clinical_severity_candidate: severity(safe.clinical_severity_candidate),
    distinct_reporters: reporterKeys.length,
    distinct_departments: departmentKeys.length,
    distinct_locations: locationKeys.length,
    correlation_window_ms: thresholds.correlation_window_ms,
    first_seen_at: times[0] ?? null,
    last_seen_at: times.at(-1) ?? null,
    reason_codes: uniqueSorted(reasonCodes),
    evidence_fact_ids: evidenceFactIds,
    same_reporter_cross_channel_deduplicated: reports.length > reporterKeys.length,
    promotion_recommendation: promotion,
    human_confirmation_required: true,
    creates_incident: false,
  });
}

export const createIncidentCandidate = generateIncidentCandidate;
