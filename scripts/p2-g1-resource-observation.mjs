import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SAMPLE_FIELDS = Object.freeze([
  'rss_bytes','heap_used_bytes','cpu_percent','event_loop_delay_p95_ms',
  'pool_total','pool_in_use','pool_idle','pool_max','sse_clients',
  'projection_backlog','communication_pending','dead_letter','reconciliation_required',
  'active_resources','active_sockets',
]);

function maximum(samples, field) { return Math.max(...samples.map((sample) => sample[field])); }

function observationOrigin() {
  const value = process.env.P2_G1_OBSERVATION_ORIGIN;
  if (typeof value !== 'string' || !/^https?:\/\/127\.0\.0\.1(?::[0-9]{1,5})?$/u.test(value)) {
    throw new Error('P2_G1_RESOURCE_ORIGIN_REQUIRED');
  }
  return value;
}

async function sample(origin) {
  const response = await fetch(`${origin}/health/metrics`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error('P2_G1_RESOURCE_METRICS_UNAVAILABLE');
  const value = await response.json();
  const safe = { elapsed_ms: 0 };
  for (const field of SAMPLE_FIELDS) {
    if (!Number.isFinite(value[field]) || value[field] < 0) throw new Error('P2_G1_RESOURCE_METRICS_INVALID');
    safe[field] = value[field];
  }
  return safe;
}

async function main() {
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ ok: true, mode: 'check', minimum_observation_ms: 3_600_000, observation_performed: false, metric_fields: SAMPLE_FIELDS.length })); return;
  }
  const argument = process.argv.find((value) => value.startsWith('--duration-ms='));
  const durationMs = Number(argument?.slice('--duration-ms='.length) ?? 3_600_000);
  if (!Number.isInteger(durationMs) || durationMs < 3_600_000 || durationMs > 7_200_000) throw new Error('P2_G1_RESOURCE_DURATION_INVALID');
  const origin = observationOrigin();
  const started = Date.now(); const samples = [];
  while (Date.now() - started < durationMs) {
    const value = await sample(origin);
    value.elapsed_ms = Date.now() - started;
    samples.push(value);
    await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, durationMs - (Date.now() - started))));
  }
  const maxima = Object.fromEntries(SAMPLE_FIELDS.map((field) => [`max_${field}`, maximum(samples, field)]));
  const record = { schema_version: 1, gate: 'P2-G1', duration_ms: Date.now() - started, sample_count: samples.length, ...maxima, oom: 0, claim_24h_soak: false };
  await appendFile('evidence/p2-g1-resource-observation.jsonl', JSON.stringify(record) + '\n');
  console.log(JSON.stringify({ ok: true, ...record }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main().catch((error) => { console.error(JSON.stringify({ ok: false, error_code: error.message })); process.exitCode = 1; });
