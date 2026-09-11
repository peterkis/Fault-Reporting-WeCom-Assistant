import { openSync, appendFileSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { assertPlainJson, deepFreeze } from './p2-007-domain-utils.mjs';
import { assertLocalDateTime, assertEpochMsString, formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';
import { failG2, g2Hash } from './p2-g2-validation-config.mjs';

export const G2_EVIDENCE_TYPES = Object.freeze(['UNIT_CONTRACT', 'POSTGRES_HTTP_INTEGRATION', 'SYNTHETIC_PROCESS_BROWSER',
  'LIVE_WECOM_RECEIPT', 'CLIENT_OBSERVATION', 'RESOURCE_MEASUREMENT', 'PROJECT_OWNER_APPROVAL']);
export const G2_RESULT_VALUES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'INCOMPLETE']);
const roleFields = ['rss_bytes', 'heap_used_bytes', 'heap_total_bytes', 'external_bytes', 'cpu_percent', 'event_loop_delay_p95_ms',
  'active_resources', 'active_timers', 'active_sockets', 'active_file_handles', 'active_handles', 'uptime_seconds',
  'pool_total', 'pool_idle', 'pool_waiting', 'pool_max'];
export const G2_METRIC_NAMES = Object.freeze([
  ...['app', 'worker', 'gateway'].flatMap(role => roleFields.map(field => role + '_' + field)),
  'process_count', 'gateway_authenticated', 'gateway_reconnect_total', 'total_rss_bytes', 'total_heap_used_bytes', 'total_cpu_percent',
  'sse_clients', 'projection_backlog', 'projection_failures', 'communication_pending', 'dead_letter', 'reconciliation_required',
  'postgres_active_connections', 'postgres_idle_connections', 'postgres_other_connections', 'postgres_max_connections',
  'postgres_connection_utilization_percent', 'postgres_locks_waiting', 'postgres_transactions', 'safe_actions_pending',
  'manual_review_pending', 'manual_review_oldest_age_ms', 'candidate_due', 'candidate_expired',
  'user_visible_latency_p95_ms', 'user_visible_latency_samples', 'postgres_rss_bytes', 'proxy_rss_bytes',
  'host_cpu_count', 'host_memory_bytes', 'host_memory_available_bytes', 'host_swap_used_bytes', 'oom_events_delta',
  'rule_worker_ready', 'rule_worker_failure_count', 'scope_unexpected_inputs', 'scope_unexpected_deliveries',
]);
export const G2_BOOLEAN_FACTS = Object.freeze(['executed', 'manual_review_handled', 'incident_confirmed', 'provider_ack_numeric',
  'client_display_confirmed', 'client_fragment_preserved', 'reconciled', 'seeded_business_facts', 'all_role_processes_distinct',
  'data_layer_real_postgresql', 'physical_profile_verified', 'whole_stack_inside_limits', 'postgres_included', 'proxy_included',
  'all_required_roles_ready', 'natural_gc', 'browser_profiles_removed', 'owner_approved', 'baseline_test_files_covered',
  'expose_gc', 'interrupted', 'sleep_detected', 'automatic_incident_creation', 'input_persisted_before_route']);
export const G2_NUMBER_FACTS = Object.freeze(['unexpected_dead_letters', 'unknown_pending', 'model_provider_calls', 'internal_note_leaks',
  'handles_remaining', 'pool_connections_remaining', 'sent_count', 'tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo',
  'elapsed_ms', 'sample_monotonic_ms', 'sample_gap_ms', 'deterministic_safe_route_coverage', 'explicit_incident_report_missed',
  'clinical_high_risk_missed', 'real_fault_auto_ignored', 'unsupported_root_cause_confirmed', 'manual_review_reachable',
  'determinism_mismatch', 'distinct_reporter_count', 'distinct_principal_count']);
export const G2_FRACTIONAL_FACTS = Object.freeze(['elapsed_ms', 'sample_monotonic_ms', 'sample_gap_ms',
  'deterministic_safe_route_coverage', 'manual_review_reachable']);
const SHA = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const scenario = /^G2-(?:[EJTNICRFAO][0-9]{2}|START|END|CLEANUP|OWNER|ENV|AUTOMATION)$/u;
const manualTypes = new Set(['CLIENT_OBSERVATION', 'PROJECT_OWNER_APPROVAL']);
const own = (v, k) => Object.hasOwn(v, k);
function closed(value, allowed, required = allowed) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !allowed.includes(k))
    || required.some(k => !own(value, k))) failG2('EVIDENCE_INVALID');
}
export function validateG2EvidenceRecord(input) {
  let r; try { r = assertPlainJson(input, { maxNodes: 3000, maxArrayLength: 150, maxStringLength: 1024 }); }
  catch { failG2('EVIDENCE_INVALID'); }
  closed(r, ['schema_version', 'gate', 'run_id', 'run_mode', 'candidate_fingerprint', 'scenario_id', 'evidence_type',
    'producer', 'occurred_at', 'physical_epoch_ms', 'sequence', 'result', 'source_refs', 'details', 'previous_hash', 'record_hash']);
  if (r.schema_version !== 1 || r.gate !== 'P2-G2' || !UUID.test(r.run_id) || !['synthetic', 'live'].includes(r.run_mode)
    || !SHA.test(r.candidate_fingerprint) || !scenario.test(r.scenario_id) || !G2_EVIDENCE_TYPES.includes(r.evidence_type)
    || !G2_RESULT_VALUES.includes(r.result) || !Number.isSafeInteger(r.sequence) || r.sequence < 1
    || !['AUTOMATED', 'MANUAL_ATTESTATION'].includes(r.producer)) failG2('EVIDENCE_INVALID');
  try { assertLocalDateTime(r.occurred_at); assertEpochMsString(r.physical_epoch_ms); }
  catch { failG2('EVIDENCE_TIME_INVALID'); }
  if (formatEpochMsToShanghaiLocal(r.physical_epoch_ms) !== r.occurred_at) failG2('EVIDENCE_TIME_INVALID');
  if (manualTypes.has(r.evidence_type) && r.producer !== 'MANUAL_ATTESTATION') failG2('MANUAL_EVIDENCE_REQUIRED');
  if (r.run_mode !== 'live' && ['LIVE_WECOM_RECEIPT', 'CLIENT_OBSERVATION', 'RESOURCE_MEASUREMENT', 'PROJECT_OWNER_APPROVAL'].includes(r.evidence_type)) failG2('SYNTHETIC_IS_NOT_LIVE_EVIDENCE');
  if (!Array.isArray(r.source_refs) || r.source_refs.length < 1 || r.source_refs.length > 16) failG2('EVIDENCE_SOURCE_REQUIRED');
  for (const source of r.source_refs) {
    closed(source, ['kind', 'ref', 'sha256']);
    if (!['MODULE', 'TEST_OUTPUT', 'PROCESS_IPC', 'DB_QUERY', 'CLIENT_FILE', 'OWNER_FILE', 'ENVIRONMENT_FILE'].includes(source.kind)
      || typeof source.ref !== 'string' || !/^[A-Za-z0-9_./:-]{1,256}$/u.test(source.ref) || source.ref.includes('..')
      || source.ref.includes('://') || !SHA.test(source.sha256)) failG2('EVIDENCE_SOURCE_INVALID');
  }
  if (r.evidence_type === 'PROJECT_OWNER_APPROVAL' && !r.source_refs.some(s => s.kind === 'OWNER_FILE')
    || r.evidence_type === 'CLIENT_OBSERVATION' && !r.source_refs.some(s => s.kind === 'CLIENT_FILE')) failG2('MANUAL_EVIDENCE_SOURCE_REQUIRED');
  const d = r.details;
  closed(d, [...G2_BOOLEAN_FACTS, ...G2_NUMBER_FACTS, 'entry_mode', 'phase', 'observer_instance_id', 'expected_fault_id', 'metrics', 'assertions'], ['executed']);
  for (const k of G2_BOOLEAN_FACTS) if (own(d, k) && typeof d[k] !== 'boolean') failG2('EVIDENCE_INVALID');
  for (const k of G2_NUMBER_FACTS) if (own(d, k) && (!Number.isFinite(d[k]) || d[k] < 0
    || (!G2_FRACTIONAL_FACTS.includes(k) && !Number.isSafeInteger(d[k])))) failG2('EVIDENCE_INVALID');
  if (own(d, 'entry_mode') && !['GROUP_MENTION_INLINE', 'GROUP_MENTION_TO_DIRECT_GUIDED', 'DIRECT_ORGANIC'].includes(d.entry_mode)) failG2('EVIDENCE_INVALID');
  if (own(d, 'phase') && !['STARTUP', 'STEADY', 'FAULT', 'RECOVERY', 'END'].includes(d.phase)) failG2('EVIDENCE_INVALID');
  if (own(d, 'observer_instance_id') && !UUID.test(d.observer_instance_id)) failG2('EVIDENCE_INVALID');
  if (own(d, 'expected_fault_id') && !/^G2-(?:F0[1-4]|N03|R02)$/u.test(d.expected_fault_id)) failG2('EVIDENCE_INVALID');
  if (own(d, 'metrics')) {
    closed(d.metrics, G2_METRIC_NAMES, []);
    if (Object.values(d.metrics).some(v => v !== null && (!Number.isFinite(v) || v < 0))) failG2('EVIDENCE_METRIC_INVALID');
  }
  if (own(d, 'assertions') && (!Array.isArray(d.assertions) || d.assertions.length > 100 || d.assertions.some(a => {
    closed(a, ['code', 'passed']); return !/^[A-Z][A-Z0-9_]{1,80}$/u.test(a.code) || typeof a.passed !== 'boolean';
  }))) failG2('EVIDENCE_INVALID');
  if (r.result === 'PASS' && (!d.executed || d.assertions?.some(a => !a.passed))) failG2('NOOP_IS_NOT_PASS');
  if (!SHA.test(r.previous_hash) || !SHA.test(r.record_hash)) failG2('EVIDENCE_HASH_INVALID');
  const { record_hash, ...body } = r;
  if (g2Hash(JSON.stringify(body)) !== record_hash) failG2('EVIDENCE_HASH_INVALID');
  return deepFreeze(r);
}

export function readG2Evidence(file) {
  const text = readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > 64 * 1024 * 1024) failG2('EVIDENCE_LIMIT');
  const lines = text.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length > 50000) failG2('EVIDENCE_LIMIT');
  let previous = '0'.repeat(64), context = null;
  return lines.map((line, index) => {
    let raw; try { raw = JSON.parse(line); } catch { failG2('EVIDENCE_INVALID'); }
    const r = validateG2EvidenceRecord(raw);
    const binding = JSON.stringify([r.run_id, r.run_mode, r.candidate_fingerprint]);
    if (r.sequence !== index + 1 || r.previous_hash !== previous || (context !== null && context !== binding)) failG2('EVIDENCE_CHAIN_INVALID');
    previous = r.record_hash; context = binding; return r;
  });
}

export function buildG2AutomatedEvidence({manifest,entries}){
  if(!Array.isArray(entries)||entries.length<1||entries.length>100)failG2('EVIDENCE_LIMIT');
  let previous='0'.repeat(64);
  return entries.map((entry,index)=>{
    if(manualTypes.has(entry.evidence_type))failG2('MANUAL_EVIDENCE_REQUIRED');
    const body={schema_version:1,gate:'P2-G2',run_id:manifest.run_id,run_mode:manifest.mode,candidate_fingerprint:manifest.candidate_fingerprint,
      scenario_id:entry.scenario_id,evidence_type:entry.evidence_type,producer:'AUTOMATED',
      occurred_at:formatEpochMsToShanghaiLocal(entry.physical_epoch_ms),physical_epoch_ms:entry.physical_epoch_ms,
      sequence:index+1,result:entry.result,source_refs:entry.source_refs,details:entry.details,previous_hash:previous};
    const record=validateG2EvidenceRecord({...body,record_hash:g2Hash(JSON.stringify(body))});previous=record.record_hash;return record;
  });
}

export function createG2EvidenceWriter({ file, manifest, nowEpochMs = () => String(Date.now()) }) {
  if (existsSync(file)) failG2('EVIDENCE_ALREADY_EXISTS');
  const fd = openSync(file, 'ax', 0o600); let sequence = 0, previous = '0'.repeat(64), closedFile = false;
  return Object.freeze({
    append({ scenario_id, evidence_type, result, details, source_refs }) {
      if (closedFile) failG2('EVIDENCE_CLOSED');
      if (manualTypes.has(evidence_type)) failG2('MANUAL_EVIDENCE_REQUIRED');
      const stamp = nowEpochMs();
      const body = { schema_version: 1, gate: 'P2-G2', run_id: manifest.run_id, run_mode: manifest.mode,
        candidate_fingerprint: manifest.candidate_fingerprint, scenario_id, evidence_type, producer: 'AUTOMATED',
        occurred_at: formatEpochMsToShanghaiLocal(stamp), physical_epoch_ms: stamp, sequence: sequence + 1,
        result, source_refs, details, previous_hash: previous };
      const record = validateG2EvidenceRecord({ ...body, record_hash: g2Hash(JSON.stringify(body)) });
      appendFileSync(fd, JSON.stringify(record) + '\n'); sequence++; previous = record.record_hash; return record;
    },
    close() { if (!closedFile) { closeSync(fd); closedFile = true; } },
  });
}
