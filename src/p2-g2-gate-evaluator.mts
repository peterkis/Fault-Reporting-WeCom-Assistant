import type { G2Manifest, CandidateFingerprint } from './p2-g2-validation-config.mjs';
import type { G2EvidenceRecord, G2EvidenceDetails, G2EvidenceSource, G2EvidenceType, G2MetricName, G2NumberFact } from './p2-g2-evidence.mjs';
export type G2ScenarioId = `G2-E0${1|2|3|4|5|6|7|8}` | `G2-J0${1|2}` | `G2-T0${1|2|3|4}` | `G2-N0${1|2|3|4}` | `G2-I0${1|2|3|4|5|6|7}` | `G2-C0${1|2}` | `G2-R0${1|2|3}` | `G2-F0${1|2|3|4}` | `G2-A0${1|2}` | 'G2-O01';
export interface G2GateInput {manifest?:unknown;candidateFingerprint?:CandidateFingerprint;streams?:unknown[];
 verifySource?:(source:G2EvidenceSource,record:G2EvidenceRecord,manifest:G2Manifest)=>boolean}
import { validateG2Manifest, G2_LIMITS, failG2 } from './p2-g2-validation-config.mjs';
import { validateG2EvidenceRecord, G2_METRIC_NAMES } from './p2-g2-evidence.mjs';

export const G2_SCENARIO_IDS = Object.freeze(Object.entries({ E: 8, J: 2, T: 4, N: 4, I: 7, C: 2, R: 3, F: 4, A: 2, O: 1 })
  .flatMap(([prefix, count]) => Array.from({ length: count }, (_, i) => 'G2-' + prefix + String(i + 1).padStart(2, '0') as G2ScenarioId)));
export const G2_CLIENT_SCENARIOS = Object.freeze(['G2-E01', 'G2-E02', 'G2-E03', 'G2-E04', 'G2-E05', 'G2-T01',
  'G2-N02', 'G2-N03', 'G2-N04', 'G2-I02', 'G2-I03', 'G2-F01']);
const NORMAL = new Set(['G2-E01', 'G2-E02', 'G2-E03', 'G2-E04', 'G2-I01']);
const zeroFields = ['model_provider_calls', 'internal_note_leaks', 'explicit_incident_report_missed',
  'clinical_high_risk_missed', 'real_fault_auto_ignored', 'unsupported_root_cause_confirmed', 'determinism_mismatch'] as const;

// This pure evaluator never writes task state, creates human approval or infers a client's
// observation from an ACK. verifySource must synchronously verify a source and its binding
// to this record (including the underlying assertions); a hash-only check is insufficient.
// A missing verifier fails closed. CLI adapters must provide their actual source readers.
export function evaluateG2Gate({ manifest, candidateFingerprint, streams = [], verifySource }: G2GateInput = {}) {
  const reasons = new Set<string>(), incomplete = (code: string) => reasons.add(code), blocked = (code: string) => { hardFailure = true; reasons.add(code); };
  let hardFailure = false, records: G2EvidenceRecord[] = [], observationMs = 0;
  try { manifest = validateG2Manifest(manifest); } catch { failG2('MANIFEST_INVALID'); }
  if (typeof candidateFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(candidateFingerprint)) failG2('CANDIDATE_INVALID');
  if ((manifest as G2Manifest)?.mode !== 'live') blocked('LIVE_MANIFEST_REQUIRED');
  if (!(manifest as G2Manifest)?.approval?.approved) blocked('OWNER_START_APPROVAL_REQUIRED');
  if (candidateFingerprint !== (manifest as G2Manifest)?.candidate_fingerprint) blocked('CANDIDATE_CHANGED');
  if (typeof verifySource !== 'function') blocked('SOURCE_VERIFIER_REQUIRED');
  if (!Array.isArray(streams) || streams.length > 64) { blocked('EVIDENCE_STREAMS_INVALID'); streams = []; }
  const knownHashes = new Set();
  for (const stream of streams) {
    if (!Array.isArray(stream) || stream.length > 50000) { blocked('EVIDENCE_STREAMS_INVALID'); continue; }
    let previous = '0'.repeat(64), binding: string|null = null;
    for (const [index, raw] of stream.entries()) {
      let r;
      try { r = validateG2EvidenceRecord(raw); } catch { blocked('EVIDENCE_INVALID'); continue; }
      const context = JSON.stringify([r.run_id, r.run_mode, r.candidate_fingerprint]);
      if (r.sequence !== index + 1 || r.previous_hash !== previous || (binding !== null && binding !== context)) blocked('EVIDENCE_CHAIN_INVALID');
      previous = r.record_hash; binding = context;
      if (knownHashes.has(r.record_hash)) blocked('DUPLICATE_EVIDENCE');
      knownHashes.add(r.record_hash);
      if (r.candidate_fingerprint !== candidateFingerprint) blocked('CANDIDATE_CHANGED');
      if (r.run_mode === 'live') {
        if (r.run_id !== (manifest as G2Manifest)?.run_id) blocked('LIVE_RUN_MISMATCH');
        const stamp = BigInt(r.physical_epoch_ms);
        if (stamp < BigInt((manifest as G2Manifest)?.approval?.valid_from_epoch_ms ?? '0')
          || stamp >= BigInt((manifest as G2Manifest)?.approval?.expires_epoch_ms ?? '0')) blocked('LIVE_OUTSIDE_APPROVAL_WINDOW');
      }
      for (const source of r.source_refs) {
        try { if (verifySource?.(source, r, manifest as G2Manifest) !== true) blocked('SOURCE_NOT_VERIFIED'); }
        catch { blocked('SOURCE_NOT_VERIFIED'); }
      }
      if (r.result === 'FAIL' || r.result === 'BLOCKED') blocked('FAILED_EVIDENCE');
      else if (r.result !== 'PASS') incomplete('UNFINISHED_EVIDENCE');
      if (NORMAL.has(r.scenario_id) && r.producer === 'AUTOMATED' && r.details.seeded_business_facts !== false) blocked('NORMAL_CHAIN_SEEDED_OR_UNDECLARED');
      if (r.details.input_persisted_before_route === false) blocked('INBOUND_NOT_PERSISTED_FIRST');
      if (zeroFields.some(k => r.details[k] !== undefined && r.details[k] !== 0)
        || r.details.automatic_incident_creation === true) blocked('SAFETY_INVARIANT_FAILED');
      records.push(r);
    }
  }
  const samples = records.filter(r => r.scenario_id === 'G2-O01' && r.evidence_type === 'RESOURCE_MEASUREMENT');
  const time = (r: G2EvidenceRecord) => BigInt(r.physical_epoch_ms);
  const firstSample = samples[0], lastSample = samples.at(-1);
  const duringObservation = (r: G2EvidenceRecord) => firstSample && time(r) >= time((firstSample as G2EvidenceRecord)) && time(r) <= time((lastSample as G2EvidenceRecord));
  const pass = (id: string, type?: G2EvidenceType | null, predicate: (record:G2EvidenceRecord)=>unknown = () => true) => records.filter(r => r.scenario_id === id && r.result === 'PASS'
    && r.details.executed && (!type || r.evidence_type === type)
    && (!['LIVE_WECOM_RECEIPT', 'CLIENT_OBSERVATION'].includes(r.evidence_type) || duringObservation(r)) && predicate(r));
  const requireFact = (id: string, type: G2EvidenceType|null, predicate: (details:G2EvidenceDetails,record:G2EvidenceRecord)=>unknown, code: string) => { if (!pass(id, type, r => predicate(r.details, r)).length) incomplete(code); };
  const checked = G2_SCENARIO_IDS.filter(id => pass(id).length);
  if (checked.length !== G2_SCENARIO_IDS.length) incomplete('SCENARIOS_MISSING');
  requireFact('G2-START', null, (d, r) => d.all_required_roles_ready && d.all_role_processes_distinct
    && d.data_layer_real_postgresql && d.model_provider_calls === 0 && (d.distinct_reporter_count as number) >= 3 && (d.distinct_principal_count as number) >= 3
    && r.source_refs.some(s => s.kind === 'OWNER_FILE' && s.ref === (manifest as G2Manifest).approval.source_ref
      && s.sha256 === (manifest as G2Manifest).approval.source_sha256), 'START_READINESS_MISSING');
  requireFact('G2-ENV', null, d => d.physical_profile_verified && d.whole_stack_inside_limits
    && d.postgres_included && d.proxy_included, 'ENVIRONMENT_2C4G_MISSING');
  const regression = (d: G2EvidenceDetails) => (d.tests as number) >= 577 && d.pass === d.tests
    && ['fail', 'skipped', 'cancelled', 'todo'].every(k => d[k as G2NumberFact] === 0)
    && d.expose_gc && d.baseline_test_files_covered && (d.deterministic_safe_route_coverage as number) >= 90
    && d.manual_review_reachable === 100 && zeroFields.slice(2).every(k => d[k as G2NumberFact] === 0);
  requireFact('G2-AUTOMATION', 'UNIT_CONTRACT', regression, 'CURRENT_FULL_REGRESSION_OR_GOLD_MISSING');
  for (let i = 1; i <= 8; i++) requireFact('G2-E0' + i, null, (d, r) => r.producer === 'AUTOMATED'
    && ['POSTGRES_HTTP_INTEGRATION', 'SYNTHETIC_PROCESS_BROWSER'].includes(r.evidence_type)
    && d.input_persisted_before_route === true, 'INBOUND_PERSISTENCE_PROOF_MISSING');
  requireFact('G2-E07', null, (d, r) => r.producer === 'AUTOMATED' && d.manual_review_handled, 'HUMAN_REVIEW_MISSING');
  requireFact('G2-I01', null, (d, r) => r.producer === 'AUTOMATED' && d.incident_confirmed
    && d.seeded_business_facts === false, 'INCIDENT_CONFIRMATION_MISSING');
  requireFact('G2-E07', 'CLIENT_OBSERVATION', d => d.manual_review_handled && d.client_display_confirmed
    && d.client_fragment_preserved, 'LIVE_HUMAN_REVIEW_MISSING');
  requireFact('G2-I01', 'CLIENT_OBSERVATION', d => d.incident_confirmed && d.client_display_confirmed
    && d.client_fragment_preserved, 'LIVE_INCIDENT_CONFIRMATION_MISSING');
  requireFact('G2-E04', 'LIVE_WECOM_RECEIPT', d => d.entry_mode === 'DIRECT_ORGANIC' && d.seeded_business_facts === false, 'LIVE_DIRECT_ORGANIC_MISSING');
  for (const id of G2_CLIENT_SCENARIOS) {
    requireFact(id, 'LIVE_WECOM_RECEIPT', d => d.provider_ack_numeric && (d.sent_count as number) > 0 && d.reconciled
      && d.unknown_pending === 0, 'LIVE_RECEIPT_MISSING');
    requireFact(id, 'CLIENT_OBSERVATION', d => d.client_display_confirmed && d.client_fragment_preserved, 'CLIENT_OBSERVATION_MISSING');
  }
  const reconciled = (d: G2EvidenceDetails) => d.unknown_pending === 0 && d.unexpected_dead_letters === 0
    && d.model_provider_calls === 0 && d.internal_note_leaks === 0 && d.automatic_incident_creation === false
    && d.assertions?.some(a => a.code === 'BOUNDED_QUEUES_NO_SUSTAINED_BACKLOG' && a.passed);
  const cleaned = (d: G2EvidenceDetails) => d.handles_remaining === 0 && d.pool_connections_remaining === 0 && d.browser_profiles_removed;
  requireFact('G2-END', null, reconciled, 'FINAL_RECONCILIATION_MISSING');
  requireFact('G2-CLEANUP', null, cleaned, 'CLEANUP_MISSING');

  let prior: G2EvidenceRecord|null = null, observer: string|undefined|null = null;
  const roles = ['app', 'worker', 'gateway'] as const;
  const steady = (r: G2EvidenceRecord) => r.details.phase === 'STEADY' && r.details.metrics?.process_count === 3
    && r.details.metrics?.rule_worker_ready === 1 && r.details.metrics?.gateway_authenticated === 1
    && roles.every(role => (r.details.metrics?.[(role + '_rss_bytes') as G2MetricName] as number) > 0);
  for (const r of samples) {
    const d = r.details, m = d.metrics ?? {}, mono = d.sample_monotonic_ms;
    if (r.result !== 'PASS' || d.natural_gc !== true || d.sleep_detected !== false || d.interrupted !== false
      || !Number.isFinite(mono) || !Number.isFinite((d.sample_gap_ms as number)) || !d.observer_instance_id
      || !['STEADY', 'FAULT', 'RECOVERY'].includes(d.phase as string)) blocked('OBSERVATION_INVALID');
    if (observer !== null && observer !== d.observer_instance_id) blocked('OBSERVATION_CLOCK_CHANGED');
    observer = d.observer_instance_id;
    if (prior) {
      const gap = (mono as number) - (prior.details.sample_monotonic_ms as number);
      const wall = Number(BigInt(r.physical_epoch_ms) - BigInt(prior.physical_epoch_ms));
      if (gap <= 0 || gap >= G2_LIMITS.maximum_sample_gap_ms || Math.abs(gap - wall) > 1000
        || Math.abs(gap - (d.sample_gap_ms as number)) > 1) blocked('OBSERVATION_INTERRUPTED');
      if (steady(prior) && steady(r) && Number.isFinite(gap) && gap > 0 && gap < G2_LIMITS.maximum_sample_gap_ms) {
        observationMs += gap;
        for (const role of roles) {
          const uptimeDelta = (m[(role + '_uptime_seconds') as G2MetricName] as number) - ((prior.details.metrics as Partial<Record<"app_rss_bytes" | "app_heap_used_bytes" | "app_heap_total_bytes" | "app_external_bytes" | "app_cpu_percent" | "app_event_loop_delay_p95_ms" | "app_active_resources" | "app_active_timers" | "app_active_sockets" | "app_active_file_handles" | "app_active_handles" | "app_uptime_seconds" | "app_pool_total" | "app_pool_idle" | "app_pool_waiting" | "app_pool_max" | "worker_rss_bytes" | "worker_heap_used_bytes" | "worker_heap_total_bytes" | "worker_external_bytes" | "worker_cpu_percent" | "worker_event_loop_delay_p95_ms" | "worker_active_resources" | "worker_active_timers" | "worker_active_sockets" | "worker_active_file_handles" | "worker_active_handles" | "worker_uptime_seconds" | "worker_pool_total" | "worker_pool_idle" | "worker_pool_waiting" | "worker_pool_max" | "gateway_rss_bytes" | "gateway_heap_used_bytes" | "gateway_heap_total_bytes" | "gateway_external_bytes" | "gateway_cpu_percent" | "gateway_event_loop_delay_p95_ms" | "gateway_active_resources" | "gateway_active_timers" | "gateway_active_sockets" | "gateway_active_file_handles" | "gateway_active_handles" | "gateway_uptime_seconds" | "gateway_pool_total" | "gateway_pool_idle" | "gateway_pool_waiting" | "gateway_pool_max" | "process_count" | "gateway_authenticated" | "gateway_reconnect_total" | "total_rss_bytes" | "total_heap_used_bytes" | "total_cpu_percent" | "sse_clients" | "projection_backlog" | "projection_failures" | "communication_pending" | "dead_letter" | "reconciliation_required" | "postgres_active_connections" | "postgres_idle_connections" | "postgres_other_connections" | "postgres_max_connections" | "postgres_connection_utilization_percent" | "postgres_locks_waiting" | "postgres_transactions" | "safe_actions_pending" | "manual_review_pending" | "manual_review_oldest_age_ms" | "candidate_due" | "candidate_expired" | "user_visible_latency_p95_ms" | "user_visible_latency_samples" | "postgres_rss_bytes" | "proxy_rss_bytes" | "host_cpu_count" | "host_memory_bytes" | "host_memory_available_bytes" | "host_swap_used_bytes" | "oom_events_delta" | "rule_worker_ready" | "rule_worker_failure_count" | "scope_unexpected_inputs" | "scope_unexpected_deliveries", number | null>>)[(role + '_uptime_seconds') as G2MetricName] as number);
          if (!Number.isFinite(uptimeDelta) || Math.abs(uptimeDelta * 1000 - wall) > 2000) blocked('ROLE_UPTIME_DISCONTINUITY');
        }
      }
    }
    prior = r;
    const unavailable = roles.filter(role => m[(role + '_rss_bytes') as G2MetricName] === null);
    const fault = ['FAULT', 'RECOVERY'].includes(d.phase as string) && (manifest as G2Manifest).scope.allowed_faults.includes(d.expected_fault_id as never);
    const allowedMissing = fault && d.expected_fault_id === 'G2-F01' ? ['gateway']
      : fault && d.expected_fault_id === 'G2-F02' ? ['app', 'worker'] : [];
    if (d.phase !== 'STEADY' && !fault) blocked('FAULT_SCOPE_INVALID');
    if (unavailable.length > 1 || unavailable.some(role => !allowedMissing.includes(role))) blocked('ROLE_METRICS_MISSING');
    for (const key of G2_METRIC_NAMES) {
      if (!Object.hasOwn(m, key) || m[key] === null && !unavailable.some(role => key.startsWith(role + '_'))
        && !(key==='user_visible_latency_p95_ms'&&m.user_visible_latency_samples===0))
        blocked('REQUIRED_METRIC_MISSING');
    }
    if (m.process_count !== 3 - unavailable.length || (m.host_cpu_count as number) > 2 || (m.host_cpu_count as number) < 1
      || (m.host_memory_bytes as number) > 4 * 1024 ** 3 || (m.host_memory_bytes as number) <= 0 || m.oom_events_delta !== 0
      || (m.sse_clients as number) > G2_LIMITS.sse_clients || m.scope_unexpected_inputs !== 0 || m.scope_unexpected_deliveries !== 0)
      blocked('RESOURCE_LIMIT_VIOLATION');
    for (const [role, max] of [['app', 4], ['worker', 2], ['gateway', 1]] as const) {
      if (unavailable.includes(role)) continue;
      if (!((m[(role + '_rss_bytes') as G2MetricName] as number) > 0)) blocked('ROLE_METRICS_MISSING');
      if (m[(role + '_pool_max') as G2MetricName] !== max || (m[(role + '_pool_total') as G2MetricName] as number) > max) blocked('POOL_LIMIT_VIOLATION');
    }
    if (m.total_rss_bytes !== roles.reduce((sum, role) => sum + (m[(role + '_rss_bytes') as G2MetricName] ?? 0), 0)) blocked('RESOURCE_TOTAL_MISMATCH');
    const workerCanBeUnready = fault && ['G2-F02', 'G2-F03'].includes(d.expected_fault_id as never);
    const gatewayCanBeUnready = fault && d.expected_fault_id === 'G2-F01';
    if ((!workerCanBeUnready && m.rule_worker_ready !== 1) || (!gatewayCanBeUnready && m.gateway_authenticated !== 1)) blocked('ROLE_NOT_READY');
  }
  if (!Number.isFinite(observationMs)) { observationMs = 0; blocked('OBSERVATION_INVALID'); }
  if (observationMs < G2_LIMITS.observation_ms) incomplete('OBSERVATION_TOO_SHORT');
  if(samples.length&&!(((samples.at(-1) as G2EvidenceRecord).details.metrics?.user_visible_latency_samples as number)>0))incomplete('CLIENT_LATENCY_MEASUREMENT_MISSING');
  if (samples.length && (!steady((samples[0] as G2EvidenceRecord)) || !steady((samples.at(-1) as G2EvidenceRecord)))) blocked('OBSERVATION_NOT_RECOVERED');
  if (firstSample) {
    for (const id of ['G2-START', 'G2-ENV']) {
      const facts = pass(id);
      if (!facts.length || facts.some(r => time(r) > time((firstSample as G2EvidenceRecord)))) blocked('READINESS_ORDER_INVALID');
    }
    if (!pass('G2-AUTOMATION', 'UNIT_CONTRACT', r => regression(r.details) && time(r) <= time((firstSample as G2EvidenceRecord))).length)
      incomplete('PRE_OBSERVATION_REGRESSION_MISSING');
    const activity = records.filter(r => r.evidence_type === 'LIVE_WECOM_RECEIPT' && r.result === 'PASS'
      && r.details.executed && (r.details.sent_count as number) > 0 && time(r) >= time((firstSample as G2EvidenceRecord)) && time(r) <= time((lastSample as G2EvidenceRecord)));
    const times = [time((firstSample as G2EvidenceRecord)), ...activity.map(time).sort((a, b) => a < b ? -1 : a > b ? 1 : 0), time((lastSample as G2EvidenceRecord))];
    if (!activity.length || times.some((stamp, i) => i > 0 && stamp - (times[i - 1] as bigint) > BigInt(G2_LIMITS.business_activity_gap_ms)))
      incomplete('OBSERVATION_BUSINESS_ACTIVITY_MISSING');
  }
  const end = pass('G2-END', null, r => reconciled(r.details) && lastSample && time(r) >= time((lastSample as G2EvidenceRecord)));
  const cleanup = pass('G2-CLEANUP', null, r => cleaned(r.details) && end.length && end.every(e => time(r) >= time(e)));
  const finalRegression = pass('G2-AUTOMATION', 'UNIT_CONTRACT', r => regression(r.details) && r.details.phase === 'END'
    && cleanup.length && cleanup.every(c => time(r) >= time(c)));
  if (!end.length || !cleanup.length) incomplete('FINALIZATION_ORDER_INVALID');
  if (!finalRegression.length) incomplete('POST_CLEANUP_REGRESSION_MISSING');
  const owner = pass('G2-OWNER', 'PROJECT_OWNER_APPROVAL', r => r.details.owner_approved === true
    && finalRegression.length && finalRegression.every(v => time(r) >= time(v))).length > 0;
  if (!owner) incomplete('PROJECT_OWNER_APPROVAL_MISSING');
  const delivery = !reasons.has('LIVE_RECEIPT_MISSING') && !reasons.has('CLIENT_OBSERVATION_MISSING')
    && !reasons.has('FINAL_RECONCILIATION_MISSING') && !hardFailure;
  const status = hardFailure ? 'BLOCKED' : reasons.size ? 'INCOMPLETE' : 'PASSED';
  return Object.freeze({ schema_version: 1, gate: 'P2-G2', run_id: (manifest as G2Manifest)?.run_id ?? null,
    candidate_fingerprint: candidateFingerprint ?? null, status, reasons: [...reasons].sort(), checked_scenarios: checked,
    observation_ms: observationMs, owner_approval_present: owner, live_delivery_complete: delivery, task_done: status === 'PASSED' });
}
