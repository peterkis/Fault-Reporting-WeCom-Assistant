import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateG2Gate, G2_SCENARIO_IDS, G2_CLIENT_SCENARIOS } from '../src/p2-g2-gate-evaluator.mjs';
import { G2_METRIC_NAMES } from '../src/p2-g2-evidence.mjs';
import { g2Hash } from '../src/p2-g2-validation-config.mjs';
import { formatEpochMsToShanghaiLocal } from '../src/platform/time-contract.mjs';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';

// In-memory evaluator fixtures only. These are never written as actual Gate/owner evidence.
function fixture() {
  const { manifest, candidateFingerprint } = configurationFixture('live');
  Object.assign(manifest.approval, { approved: true, authority: 'PROJECT_OWNER',
    source_ref: 'evidence/p2-g2-live-start-approval.md', source_sha256: 'b'.repeat(64) });
  const records = [], start = BigInt(manifest.approval.valid_from_epoch_ms);
  const add = (scenario_id, evidence_type, details, offset = 0) => records.push({ schema_version: 1, gate: 'P2-G2',
    run_id: manifest.run_id, run_mode: 'live', candidate_fingerprint: candidateFingerprint, scenario_id, evidence_type,
    producer: ['CLIENT_OBSERVATION', 'PROJECT_OWNER_APPROVAL'].includes(evidence_type) ? 'MANUAL_ATTESTATION' : 'AUTOMATED',
    physical_epoch_ms: String(start + BigInt(offset)), occurred_at: formatEpochMsToShanghaiLocal(String(start + BigInt(offset))),
    result: 'PASS', source_refs: [{ kind: evidence_type === 'CLIENT_OBSERVATION' ? 'CLIENT_FILE' : evidence_type === 'PROJECT_OWNER_APPROVAL' ? 'OWNER_FILE' : 'TEST_OUTPUT',
      ref: 'test-only/evaluator-fixture', sha256: 'b'.repeat(64) }], details: { executed: true, ...details } });
  add('G2-START', 'POSTGRES_HTTP_INTEGRATION', { all_required_roles_ready: true, all_role_processes_distinct: true,
    data_layer_real_postgresql: true, model_provider_calls: 0, distinct_reporter_count: 3, distinct_principal_count: 3 });
  records.at(-1).source_refs.push({ kind: 'OWNER_FILE', ref: manifest.approval.source_ref, sha256: manifest.approval.source_sha256 });
  add('G2-ENV', 'POSTGRES_HTTP_INTEGRATION', { physical_profile_verified: true, whole_stack_inside_limits: true,
    postgres_included: true, proxy_included: true });
  add('G2-AUTOMATION', 'UNIT_CONTRACT', { tests: 600, pass: 600, fail: 0, skipped: 0, cancelled: 0, todo: 0,
    expose_gc: true, baseline_test_files_covered: true, deterministic_safe_route_coverage: 93,
    explicit_incident_report_missed: 0, clinical_high_risk_missed: 0, real_fault_auto_ignored: 0,
    unsupported_root_cause_confirmed: 0, determinism_mismatch: 0, manual_review_reachable: 100 });
  let liveOffset = 30000;
  for (const id of G2_SCENARIO_IDS.filter(id => id !== 'G2-O01')) {
    add(id, 'SYNTHETIC_PROCESS_BROWSER', { input_persisted_before_route: true, seeded_business_facts: false,
      manual_review_handled: true, incident_confirmed: true, model_provider_calls: 0, internal_note_leaks: 0,
      automatic_incident_creation: false });
    if (G2_CLIENT_SCENARIOS.includes(id)) {
      add(id, 'LIVE_WECOM_RECEIPT', { provider_ack_numeric: true, sent_count: 1, reconciled: true,
        unknown_pending: 0, seeded_business_facts: false,
        ...(id === 'G2-E04' ? { entry_mode: 'DIRECT_ORGANIC' } : {}) }, liveOffset);
      add(id, 'CLIENT_OBSERVATION', { client_display_confirmed: true, client_fragment_preserved: true }, liveOffset + 1000);
      liveOffset += 300000;
    }
  }
  add('G2-E07', 'CLIENT_OBSERVATION', { client_display_confirmed: true, client_fragment_preserved: true, manual_review_handled: true });
  add('G2-I01', 'CLIENT_OBSERVATION', { client_display_confirmed: true, client_fragment_preserved: true, incident_confirmed: true });
  for (let offset = 0; offset <= 3600000; offset += 15000) {
    const metrics = Object.fromEntries(G2_METRIC_NAMES.map(k => [k, 0]));
    Object.assign(metrics, { process_count: 3, gateway_authenticated: 1, rule_worker_ready: 1,
      host_cpu_count: 2, host_memory_bytes: 4 * 1024 ** 3, host_memory_available_bytes: 2 * 1024 ** 3,
      postgres_rss_bytes: 128 * 1024 ** 2, proxy_rss_bytes: 16 * 1024 ** 2, postgres_max_connections: 40,
      user_visible_latency_samples:1,user_visible_latency_p95_ms:80,
      total_rss_bytes: 96 * 1024 ** 2 });
    for (const [role, max] of [['app', 4], ['worker', 2], ['gateway', 1]]) {
      metrics[role + '_pool_max'] = max; metrics[role + '_rss_bytes'] = 32 * 1024 ** 2;
      metrics[role + '_uptime_seconds'] = offset / 1000 + 10;
    }
    add('G2-O01', 'RESOURCE_MEASUREMENT', { phase: 'STEADY', natural_gc: true, interrupted: false, sleep_detected: false,
      observer_instance_id: manifest.run_id, sample_monotonic_ms: offset, sample_gap_ms: offset ? 15000 : 0, metrics }, offset);
  }
  add('G2-END', 'POSTGRES_HTTP_INTEGRATION', { unknown_pending: 0, unexpected_dead_letters: 0, model_provider_calls: 0,
    internal_note_leaks: 0, automatic_incident_creation: false, assertions: [{ code: 'BOUNDED_QUEUES_NO_SUSTAINED_BACKLOG', passed: true }] }, 3600000);
  add('G2-CLEANUP', 'POSTGRES_HTTP_INTEGRATION', { handles_remaining: 0, pool_connections_remaining: 0, browser_profiles_removed: true }, 3601000);
  add('G2-AUTOMATION', 'UNIT_CONTRACT', { ...records.find(r => r.scenario_id === 'G2-AUTOMATION').details, phase: 'END' }, 3602000);
  add('G2-OWNER', 'PROJECT_OWNER_APPROVAL', { owner_approved: true }, 3603000);
  return { manifest, candidateFingerprint, streams: [records], verifySource: () => true };
}
function seal(f) {
  for (const stream of f.streams) {
    let previous = '0'.repeat(64);
    stream.forEach((r, i) => {
      delete r.record_hash; r.sequence = i + 1; r.previous_hash = previous;
      r.record_hash = g2Hash(JSON.stringify(r)); previous = r.record_hash;
    });
  }
  return f;
}
const find = (f, id, type) => f.streams.flat().find(r => r.scenario_id === id && (!type || r.evidence_type === type));
const retime = (r, stamp) => {
  r.physical_epoch_ms = String(stamp);
  r.occurred_at = formatEpochMsToShanghaiLocal(r.physical_epoch_ms);
};

test('P2-G2 independent per-scenario receipt and human streams fit the bounded evaluator without resealing combined chains',()=>{
  const f=fixture(),records=f.streams[0];
  f.streams=[records.filter(r=>r.evidence_type==='RESOURCE_MEASUREMENT'),
    records.filter(r=>r.evidence_type==='SYNTHETIC_PROCESS_BROWSER'),
    ...records.filter(r=>!['RESOURCE_MEASUREMENT','SYNTHETIC_PROCESS_BROWSER'].includes(r.evidence_type)).map(r=>[r])];
  assert.ok(f.streams.length>20&&f.streams.length<=64);
  assert.equal(evaluateG2Gate(seal(f)).status,'PASSED');
  const tooMany={...f,streams:[...f.streams,...Array.from({length:65-f.streams.length},()=>[])]};
  assert.equal(evaluateG2Gate(tooMany).status,'BLOCKED');
});

for (const [name, mutate] of [
  ['readiness recorded after observation', f => {
    for (const id of ['G2-START', 'G2-ENV']) retime(find(f, id), BigInt(find(f, 'G2-END').physical_epoch_ms) + 500n);
  }],
  ['owner approval before cleanup', f => { retime(find(f, 'G2-OWNER'), find(f, 'G2-END').physical_epoch_ms); }],
  ['an entire hour of unavailable worker declared as gateway fault', f => {
    for (const r of f.streams[0].filter(r => r.evidence_type === 'RESOURCE_MEASUREMENT')) {
      Object.assign(r.details, { phase: 'FAULT', expected_fault_id: 'G2-F01' });
      for (const k of G2_METRIC_NAMES.filter(k => k.startsWith('worker_'))) r.details.metrics[k] = null;
      Object.assign(r.details.metrics, { process_count: 2, rule_worker_ready: 0, total_rss_bytes: 64 * 1024 ** 2 });
    }
  }],
  ['undeclared worker restarts', f => {
    for (const r of f.streams[0].filter(r => r.evidence_type === 'RESOURCE_MEASUREMENT')) r.details.metrics.worker_uptime_seconds = 1;
  }],
  ['route before inbound persistence', f => {
    for (const r of f.streams[0].filter(r => r.evidence_type === 'SYNTHETIC_PROCESS_BROWSER')) r.details.input_persisted_before_route = false;
  }],
  ['missing finite sample gap', f => {
    for (const r of f.streams[0].filter(r => r.evidence_type === 'RESOURCE_MEASUREMENT')) delete r.details.sample_gap_ms;
  }],
  ['no verified start approval source', f => { find(f, 'G2-START').source_refs = [{ kind: 'TEST_OUTPUT', ref: 'test-only/unbound', sha256: 'b'.repeat(64) }]; }],
  ['one hour idle after business activity', f => {
    for (const r of f.streams[0].filter(r => r.evidence_type === 'LIVE_WECOM_RECEIPT')) retime(r, f.manifest.approval.valid_from_epoch_ms);
  }],
  ['no post-cleanup full regression', f => {
    f.streams[0] = f.streams[0].filter(r => r.scenario_id !== 'G2-AUTOMATION' || r.details.phase !== 'END');
  }],
  ...['G2-END', 'G2-CLEANUP'].map(id => ['split ' + id + ' content from timestamp', f => {
    const complete = find(f, id), empty = structuredClone(complete);
    empty.details = { executed: true }; f.streams[0].push(empty);
    retime(complete, f.manifest.approval.valid_from_epoch_ms);
  }]),
  ['DIRECT_ORGANIC outside observation', f => {
    retime(find(f, 'G2-E04', 'LIVE_WECOM_RECEIPT'), BigInt(find(f, 'G2-END').physical_epoch_ms) + 100n);
  }],
]) test('P2-G2 evaluator fails closed for review counterexample: ' + name, () => {
  const f = fixture(); mutate(f); const result = evaluateG2Gate(seal(f));
  assert.notEqual(result.status, 'PASSED'); assert.equal(result.task_done, false);
});

test('P2-G2 evaluator rejects invalid binding with stable typed errors before reading evidence', () => {
  const f = seal(fixture()); f.manifest.approval.valid_from_epoch_ms = 'bad';
  assert.throws(() => evaluateG2Gate(f), { code: 'P2_G2_MANIFEST_INVALID' });
  assert.throws(() => evaluateG2Gate(), { code: 'P2_G2_MANIFEST_INVALID' });
  assert.throws(() => evaluateG2Gate({ ...seal(fixture()), candidateFingerprint: null }), { code: 'P2_G2_CANDIDATE_INVALID' });
});

test('P2-G2 evaluator accepts a complete in-memory fixture only with independently verified sources', () => {
  const f = seal(fixture()), result = evaluateG2Gate(f);
  assert.equal(result.status, 'PASSED', result.reasons.join(',')); assert.equal(result.observation_ms, 3600000);
  assert.equal(result.task_done, true); assert.equal(result.checked_scenarios.length, 37);
  assert.notEqual(evaluateG2Gate({ ...f, verifySource: undefined }).status, 'PASSED');
});

test('P2-G2 has no latency percentile before a client observation, and requires a real measurement by the end',()=>{
  const early=fixture(),first=find(early,'G2-O01');
  first.details.metrics.user_visible_latency_samples=0;first.details.metrics.user_visible_latency_p95_ms=null;
  assert.equal(evaluateG2Gate(seal(early)).status,'PASSED');
  const missing=fixture();for(const r of missing.streams.flat().filter(r=>r.scenario_id==='G2-O01')){
    r.details.metrics.user_visible_latency_samples=0;r.details.metrics.user_visible_latency_p95_ms=null;
  }
  const result=evaluateG2Gate(seal(missing));assert.equal(result.status,'INCOMPLETE');
  assert.ok(result.reasons.includes('CLIENT_LATENCY_MEASUREMENT_MISSING'));
});

test('P2-G2 approved Gateway fault requires recovery and excludes both adjacent intervals from the steady hour', () => {
  const f = fixture(), records = f.streams[0];
  const fault = records.find(r => r.details.sample_monotonic_ms === 1800000);
  Object.assign(fault.details, { phase: 'FAULT', expected_fault_id: 'G2-F01' });
  for (const k of G2_METRIC_NAMES.filter(k => k.startsWith('gateway_'))) fault.details.metrics[k] = null;
  Object.assign(fault.details.metrics, { gateway_authenticated: 0, gateway_reconnect_total: 1,
    process_count: 2, total_rss_bytes: 64 * 1024 ** 2 });
  const short = evaluateG2Gate(seal(f));
  assert.equal(short.observation_ms, 3570000);
  assert.equal(short.status, 'INCOMPLETE', short.reasons.join(','));
  const last = records.filter(r => r.evidence_type === 'RESOURCE_MEASUREMENT').at(-1);
  for (const delta of [15000, 30000]) {
    const extra = structuredClone(last);
    extra.details.sample_monotonic_ms += delta;
    for (const role of ['app', 'worker', 'gateway']) extra.details.metrics[role + '_uptime_seconds'] += delta / 1000;
    retime(extra, BigInt(last.physical_epoch_ms) + BigInt(delta)); records.push(extra);
  }
  for (const r of records.filter(r => ['G2-END', 'G2-CLEANUP', 'G2-OWNER'].includes(r.scenario_id)
    || r.scenario_id === 'G2-AUTOMATION' && r.details.phase === 'END')) retime(r, BigInt(r.physical_epoch_ms) + 30000n);
  const complete = evaluateG2Gate(seal(f));
  assert.equal(complete.status, 'PASSED', complete.reasons.join(',')); assert.equal(complete.observation_ms, 3600000);
});

for (const [name, mutate] of [
  ['only historical 577 regression', f => { f.streams[0] = [find(f, 'G2-AUTOMATION')]; }],
  ['past P2-012 evidence', f => { f.streams[0][0].gate = 'P2-012'; }],
  ['59 minutes', f => { f.streams[0] = f.streams[0].filter(r => r.evidence_type !== 'RESOURCE_MEASUREMENT' || r.details.sample_monotonic_ms <= 3540000); }],
  ['sleep', f => { find(f, 'G2-O01').details.sleep_detected = true; }],
  ['missing metric', f => { delete find(f, 'G2-O01').details.metrics.worker_heap_used_bytes; }],
  ['missing 2C4G proof', f => { find(f, 'G2-ENV').details.physical_profile_verified = false; }],
  ['missing DIRECT_ORGANIC', f => { find(f, 'G2-E04', 'LIVE_WECOM_RECEIPT').details.entry_mode = 'GROUP_MENTION_INLINE'; }],
  ['missing human review', f => { find(f, 'G2-E07').details.manual_review_handled = false; }],
  ['missing confirmed incident', f => { find(f, 'G2-I01').details.incident_confirmed = false; }],
  ['only synthetic human review', f => { f.streams[0] = f.streams[0].filter(r => !(r.scenario_id === 'G2-E07' && r.evidence_type === 'CLIENT_OBSERVATION')); }],
  ['only synthetic incident confirmation', f => { f.streams[0] = f.streams[0].filter(r => !(r.scenario_id === 'G2-I01' && r.evidence_type === 'CLIENT_OBSERVATION')); }],
  ['seeded normal chain', f => { find(f, 'G2-E01').details.seeded_business_facts = true; }],
  ['missing numeric ACK', f => { find(f, 'G2-N02', 'LIVE_WECOM_RECEIPT').details.provider_ack_numeric = false; }],
  ['UNKNOWN unresolved', f => { find(f, 'G2-END').details.unknown_pending = 1; }],
  ['changed candidate', f => { f.candidateFingerprint = 'c'.repeat(64); }],
  ['NOOP', f => { find(f, 'G2-T01').details.executed = false; }],
  ['NOT_RUN', f => { find(f, 'G2-T01').result = 'NOT_RUN'; }],
  ['unexpected dead letter', f => { find(f, 'G2-END').details.unexpected_dead_letters = 1; }],
  ['no owner approval', f => { f.streams[0] = f.streams[0].filter(r => r.evidence_type !== 'PROJECT_OWNER_APPROVAL'); }],
  ['source not verified', f => { f.verifySource = () => false; }],
  ['source Promise not awaited', f => { f.verifySource = () => Promise.resolve(true); }],
  ['switched observer clock', f => { find(f, 'G2-O01').details.observer_instance_id = '10000000-0000-4000-8000-000000000009'; }],
  ['sampling gap', f => { f.streams[0] = f.streams[0].filter(r => r.evidence_type !== 'RESOURCE_MEASUREMENT' || r.details.sample_monotonic_ms !== 15000); }],
  ['roles disappeared', f => { find(f, 'G2-O01').details.metrics.process_count = 0; }],
  ['model was called', f => { find(f, 'G2-A01').details.model_provider_calls = 1; }],
  ['gold missed fault', f => { find(f, 'G2-AUTOMATION').details.explicit_incident_report_missed = 1; }],
]) test('P2-G2 evaluator rejects ' + name, () => {
  const f = fixture(); mutate(f); const result = evaluateG2Gate(seal(f));
  assert.notEqual(result.status, 'PASSED'); assert.equal(result.task_done, false);
});
