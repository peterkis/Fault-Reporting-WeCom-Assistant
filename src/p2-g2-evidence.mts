import type { G2Manifest, CandidateFingerprint, EvidenceSHA256, SourceSHA256 } from './p2-g2-validation-config.mjs';
export type G2EvidenceType = typeof G2_EVIDENCE_TYPES[number];
export type G2ResultValue = typeof G2_RESULT_VALUES[number];
export type G2MetricName = typeof G2_METRIC_NAMES[number];
export type G2BooleanFact = typeof G2_BOOLEAN_FACTS[number];
export type G2NumberFact = typeof G2_NUMBER_FACTS[number];
export type G2Metrics = Partial<Record<G2MetricName,number|null>>;
export interface G2EvidenceSource {kind:'MODULE'|'TEST_OUTPUT'|'PROCESS_IPC'|'DB_QUERY'|'CLIENT_FILE'|'OWNER_FILE'|'ENVIRONMENT_FILE';ref:string;sha256:SourceSHA256}
export type G2EvidenceDetails = {executed:boolean;entry_mode?:'GROUP_MENTION_INLINE'|'GROUP_MENTION_TO_DIRECT_GUIDED'|'DIRECT_ORGANIC';
 phase?:'STARTUP'|'STEADY'|'FAULT'|'RECOVERY'|'END';observer_instance_id?:string;expected_fault_id?:string;
 metrics?:G2Metrics;assertions?:{code:string;passed:boolean}[]} & Partial<Record<Exclude<G2BooleanFact,'executed'>,boolean>> & Partial<Record<G2NumberFact,number>>;
export interface G2EvidenceRecord {schema_version:1;gate:'P2-G2';run_id:string;run_mode:G2Manifest['mode'];candidate_fingerprint:CandidateFingerprint;
 scenario_id:string;evidence_type:G2EvidenceType;producer:'AUTOMATED'|'MANUAL_ATTESTATION';occurred_at:string;physical_epoch_ms:string;
 sequence:number;result:G2ResultValue;source_refs:G2EvidenceSource[];details:G2EvidenceDetails;previous_hash:EvidenceSHA256;record_hash:EvidenceSHA256}
export type G2AutomatedEntry = Pick<G2EvidenceRecord,'scenario_id'|'evidence_type'|'result'|'source_refs'|'details'>;
type InputObject = Record<string,unknown>;
import { openSync, appendFileSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { assertPlainJson, deepFreeze } from './p2-007-domain-utils.mjs';
import { assertLocalDateTime, assertEpochMsString, formatEpochMsToShanghaiLocal } from './platform/time-contract.mjs';
import { failG2, g2Hash } from './p2-g2-validation-config.mjs';

export const G2_EVIDENCE_TYPES = Object.freeze(['UNIT_CONTRACT', 'POSTGRES_HTTP_INTEGRATION', 'SYNTHETIC_PROCESS_BROWSER',
  'LIVE_WECOM_RECEIPT', 'CLIENT_OBSERVATION', 'RESOURCE_MEASUREMENT', 'PROJECT_OWNER_APPROVAL'] as const);
export const G2_RESULT_VALUES = Object.freeze(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'INCOMPLETE'] as const);
const roleFields = ['rss_bytes', 'heap_used_bytes', 'heap_total_bytes', 'external_bytes', 'cpu_percent', 'event_loop_delay_p95_ms',
  'active_resources', 'active_timers', 'active_sockets', 'active_file_handles', 'active_handles', 'uptime_seconds',
  'pool_total', 'pool_idle', 'pool_waiting', 'pool_max'] as const;
export const G2_METRIC_NAMES = Object.freeze([
  ...(['app', 'worker', 'gateway'] as const).flatMap(role => roleFields.map(field => (role + '_' + field) as `${'app'|'worker'|'gateway'}_${typeof roleFields[number]}`)),
  'process_count', 'gateway_authenticated', 'gateway_reconnect_total', 'total_rss_bytes', 'total_heap_used_bytes', 'total_cpu_percent',
  'sse_clients', 'projection_backlog', 'projection_failures', 'communication_pending', 'dead_letter', 'reconciliation_required',
  'postgres_active_connections', 'postgres_idle_connections', 'postgres_other_connections', 'postgres_max_connections',
  'postgres_connection_utilization_percent', 'postgres_locks_waiting', 'postgres_transactions', 'safe_actions_pending',
  'manual_review_pending', 'manual_review_oldest_age_ms', 'candidate_due', 'candidate_expired',
  'user_visible_latency_p95_ms', 'user_visible_latency_samples', 'postgres_rss_bytes', 'proxy_rss_bytes',
  'host_cpu_count', 'host_memory_bytes', 'host_memory_available_bytes', 'host_swap_used_bytes', 'oom_events_delta',
  'rule_worker_ready', 'rule_worker_failure_count', 'scope_unexpected_inputs', 'scope_unexpected_deliveries',
] as const);
export const G2_BOOLEAN_FACTS = Object.freeze(['executed', 'manual_review_handled', 'incident_confirmed', 'provider_ack_numeric',
  'client_display_confirmed', 'client_fragment_preserved', 'reconciled', 'seeded_business_facts', 'all_role_processes_distinct',
  'data_layer_real_postgresql', 'physical_profile_verified', 'whole_stack_inside_limits', 'postgres_included', 'proxy_included',
  'all_required_roles_ready', 'natural_gc', 'browser_profiles_removed', 'owner_approved', 'baseline_test_files_covered',
  'expose_gc', 'interrupted', 'sleep_detected', 'automatic_incident_creation', 'input_persisted_before_route'] as const);
export const G2_NUMBER_FACTS = Object.freeze(['unexpected_dead_letters', 'unknown_pending', 'model_provider_calls', 'internal_note_leaks',
  'handles_remaining', 'pool_connections_remaining', 'sent_count', 'tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo',
  'elapsed_ms', 'sample_monotonic_ms', 'sample_gap_ms', 'deterministic_safe_route_coverage', 'explicit_incident_report_missed',
  'clinical_high_risk_missed', 'real_fault_auto_ignored', 'unsupported_root_cause_confirmed', 'manual_review_reachable',
  'determinism_mismatch', 'distinct_reporter_count', 'distinct_principal_count'] as const);
export const G2_FRACTIONAL_FACTS = Object.freeze(['elapsed_ms', 'sample_monotonic_ms', 'sample_gap_ms',
  'deterministic_safe_route_coverage', 'manual_review_reachable'] as const);
const SHA = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const scenario = /^G2-(?:[EJTNICRFAO][0-9]{2}|START|END|CLEANUP|OWNER|ENV|AUTOMATION)$/u;
const manualTypes = new Set(['CLIENT_OBSERVATION', 'PROJECT_OWNER_APPROVAL']);
const own = (v: object, k: string) => Object.hasOwn(v, k);
function closed(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): asserts value is InputObject {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(k => !allowed.includes(k))
    || required.some(k => !own(value, k))) failG2('EVIDENCE_INVALID');
}
export function validateG2EvidenceRecord(input: unknown): G2EvidenceRecord {
  let r: unknown; try { r = assertPlainJson(input, { maxNodes: 3000, maxArrayLength: 150, maxStringLength: 1024 }); }
  catch { failG2('EVIDENCE_INVALID'); }
  closed(r, ['schema_version', 'gate', 'run_id', 'run_mode', 'candidate_fingerprint', 'scenario_id', 'evidence_type',
    'producer', 'occurred_at', 'physical_epoch_ms', 'sequence', 'result', 'source_refs', 'details', 'previous_hash', 'record_hash']);
  if (r.schema_version !== 1 || r.gate !== 'P2-G2' || !UUID.test(r.run_id as string) || !['synthetic', 'live'].includes(r.run_mode as string)
    || !SHA.test(r.candidate_fingerprint as string) || !scenario.test(r.scenario_id as string) || !(G2_EVIDENCE_TYPES as readonly unknown[]).includes(r.evidence_type as string)
    || !(G2_RESULT_VALUES as readonly unknown[]).includes(r.result) || !Number.isSafeInteger(r.sequence) || (r.sequence as number) < 1
    || !['AUTOMATED', 'MANUAL_ATTESTATION'].includes(r.producer as string)) failG2('EVIDENCE_INVALID');
  try { assertLocalDateTime(r.occurred_at); assertEpochMsString(r.physical_epoch_ms); }
  catch { failG2('EVIDENCE_TIME_INVALID'); }
  if (formatEpochMsToShanghaiLocal(r.physical_epoch_ms) !== r.occurred_at) failG2('EVIDENCE_TIME_INVALID');
  if (manualTypes.has(r.evidence_type as string) && r.producer !== 'MANUAL_ATTESTATION') failG2('MANUAL_EVIDENCE_REQUIRED');
  if (r.run_mode !== 'live' && ['LIVE_WECOM_RECEIPT', 'CLIENT_OBSERVATION', 'RESOURCE_MEASUREMENT', 'PROJECT_OWNER_APPROVAL'].includes(r.evidence_type as string)) failG2('SYNTHETIC_IS_NOT_LIVE_EVIDENCE');
  if (!Array.isArray(r.source_refs) || r.source_refs.length < 1 || r.source_refs.length > 16) failG2('EVIDENCE_SOURCE_REQUIRED');
  for (const source of r.source_refs) {
    closed(source, ['kind', 'ref', 'sha256']);
    if (!['MODULE', 'TEST_OUTPUT', 'PROCESS_IPC', 'DB_QUERY', 'CLIENT_FILE', 'OWNER_FILE', 'ENVIRONMENT_FILE'].includes(source.kind as string)
      || typeof source.ref !== 'string' || !/^[A-Za-z0-9_./:-]{1,256}$/u.test(source.ref) || source.ref.includes('..')
      || source.ref.includes('://') || !SHA.test(source.sha256 as string)) failG2('EVIDENCE_SOURCE_INVALID');
  }
  if (r.evidence_type === 'PROJECT_OWNER_APPROVAL' && !r.source_refs.some((s: InputObject) => s.kind === 'OWNER_FILE')
    || r.evidence_type === 'CLIENT_OBSERVATION' && !r.source_refs.some((s: InputObject) => s.kind === 'CLIENT_FILE')) failG2('MANUAL_EVIDENCE_SOURCE_REQUIRED');
  const d = r.details;
  closed(d, [...G2_BOOLEAN_FACTS, ...G2_NUMBER_FACTS, 'entry_mode', 'phase', 'observer_instance_id', 'expected_fault_id', 'metrics', 'assertions'], ['executed']);
  for (const k of G2_BOOLEAN_FACTS) if (own(d, k) && typeof d[k] !== 'boolean') failG2('EVIDENCE_INVALID');
  for (const k of G2_NUMBER_FACTS) if (own(d, k) && (!Number.isFinite(d[k]) || (d[k] as number) < 0
    || (!(G2_FRACTIONAL_FACTS as readonly unknown[]).includes(k) && !Number.isSafeInteger(d[k])))) failG2('EVIDENCE_INVALID');
  if (own(d, 'entry_mode') && !['GROUP_MENTION_INLINE', 'GROUP_MENTION_TO_DIRECT_GUIDED', 'DIRECT_ORGANIC'].includes(d.entry_mode as string)) failG2('EVIDENCE_INVALID');
  if (own(d, 'phase') && !['STARTUP', 'STEADY', 'FAULT', 'RECOVERY', 'END'].includes(d.phase as string)) failG2('EVIDENCE_INVALID');
  if (own(d, 'observer_instance_id') && !UUID.test(d.observer_instance_id as string)) failG2('EVIDENCE_INVALID');
  if (own(d, 'expected_fault_id') && !/^G2-(?:F0[1-4]|N03|R02)$/u.test(d.expected_fault_id as string)) failG2('EVIDENCE_INVALID');
  if (own(d, 'metrics')) {
    closed(d.metrics, G2_METRIC_NAMES, []);
    if (Object.values(d.metrics).some(v => v !== null && (!Number.isFinite(v) || (v as number) < 0))) failG2('EVIDENCE_METRIC_INVALID');
  }
  if (own(d, 'assertions') && (!Array.isArray(d.assertions) || d.assertions.length > 100 || d.assertions.some(a => {
    closed(a, ['code', 'passed']); return !/^[A-Z][A-Z0-9_]{1,80}$/u.test(a.code as string) || typeof a.passed !== 'boolean';
  }))) failG2('EVIDENCE_INVALID');
  if (r.result === 'PASS' && (!d.executed || (d.assertions as {passed:unknown}[] | undefined)?.some(a => !a.passed))) failG2('NOOP_IS_NOT_PASS');
  if (!SHA.test(r.previous_hash as string) || !SHA.test(r.record_hash as string)) failG2('EVIDENCE_HASH_INVALID');
  const { record_hash, ...body } = r;
  if (g2Hash(JSON.stringify(body)) !== record_hash) failG2('EVIDENCE_HASH_INVALID');
  return deepFreeze(r) as InputObject & G2EvidenceRecord;
}

export function readG2Evidence(file: string) {
  const text = readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > 64 * 1024 * 1024) failG2('EVIDENCE_LIMIT');
  const lines = text.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length > 50000) failG2('EVIDENCE_LIMIT');
  let previous = '0'.repeat(64), context: string|null = null;
  return lines.map((line, index) => {
    let raw: unknown; try { raw = JSON.parse(line); } catch { failG2('EVIDENCE_INVALID'); }
    const r = validateG2EvidenceRecord(raw);
    const binding = JSON.stringify([r.run_id, r.run_mode, r.candidate_fingerprint]);
    if (r.sequence !== index + 1 || r.previous_hash !== previous || (context !== null && context !== binding)) failG2('EVIDENCE_CHAIN_INVALID');
    previous = r.record_hash; context = binding; return r;
  });
}

export function buildG2AutomatedEvidence({manifest,entries}: {manifest:G2Manifest;entries:(G2AutomatedEntry & {physical_epoch_ms:string})[]}){
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

export function createG2EvidenceWriter({ file, manifest, nowEpochMs = () => String(Date.now()) }: {file:string;manifest:G2Manifest;nowEpochMs?:()=>string}) {
  if (existsSync(file)) failG2('EVIDENCE_ALREADY_EXISTS');
  const fd = openSync(file, 'ax', 0o600); let sequence = 0, previous = '0'.repeat(64), closedFile = false;
  return Object.freeze({
    append({ scenario_id, evidence_type, result, details, source_refs }: G2AutomatedEntry) {
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
