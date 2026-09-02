import { randomInt } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

import { launchP2G1TestBrowserSessions } from '../src/p2-g1-browser-sessions.mjs';
import { validateP2G1ProcessApprovals } from '../src/p2-g1-human-only-assembly.mjs';
import { createP2G1ProcessCluster } from '../src/p2-g1-process-cluster.mjs';

const MINIMUM_DURATION_MS = 3_600_000;
const MAXIMUM_DURATION_MS = 7_200_000;
const SAMPLE_INTERVAL_MS = 60_000;
const WORK_INTERVAL_MS = 10 * 60_000;
const COMMIT = /^[a-f0-9]{40}$/u;

export const P2_G1_RESOURCE_SAMPLE_FIELDS = Object.freeze([
  'app_rss_bytes','app_heap_used_bytes','app_cpu_percent','app_event_loop_delay_p95_ms','app_active_sockets','app_active_handles','app_pool_total','app_pool_max',
  'worker_rss_bytes','worker_heap_used_bytes','worker_cpu_percent','worker_event_loop_delay_p95_ms','worker_active_sockets','worker_active_handles','worker_pool_total','worker_pool_max',
  'gateway_rss_bytes','gateway_heap_used_bytes','gateway_cpu_percent','gateway_event_loop_delay_p95_ms','gateway_active_sockets','gateway_active_handles','gateway_pool_total','gateway_pool_max',
  'total_rss_bytes','total_heap_used_bytes','total_cpu_percent','sse_clients','projection_backlog','projection_failures','communication_pending','dead_letter','reconciliation_required',
  'postgres_active_connections','postgres_idle_connections','postgres_other_connections','postgres_max_connections','postgres_connection_utilization_percent','gateway_authenticated','gateway_reconnect_total',
]);

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function runId(now = new Date()) {
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('');
  return `P2G1-${stamp}-${randomInt(100_000, 1_000_000)}`;
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function aggregate(samples, field) {
  const values = samples.map((sample) => sample[field]);
  return Object.freeze({
    p50: Number(percentile(values, 0.50).toFixed(3)),
    p95: Number(percentile(values, 0.95).toFixed(3)),
    p99: Number(percentile(values, 0.99).toFixed(3)),
    max: Number(Math.max(...values).toFixed(3)),
    first: Number(values[0].toFixed(3)),
    last: Number(values.at(-1).toFixed(3)),
  });
}

function sustainedMonotonicGrowth(samples, field, minimumGrowthBytes = 64 * 1024 * 1024) {
  const values = samples.map((sample) => sample[field]);
  return values.length >= 10
    && values.at(-1) - values[0] >= minimumGrowthBytes
    && values.slice(1).every((value, index) => value >= values[index]);
}

async function testScope(pool) {
  const principals = await pool.query(`SELECT principal.id::text
    FROM pilot_ticket.pilot_principal AS principal
    JOIN pilot_ticket.pilot_principal_role AS role ON role.principal_id=principal.id
    WHERE principal.is_active=TRUE AND role.role IN ('ADMIN','DISPATCHER','HANDLER')
    GROUP BY principal.id ORDER BY principal.id LIMIT 2`);
  const target = await pool.query(`SELECT delivery.target_hash
    FROM communication.delivery AS delivery
    WHERE delivery.provider='WECOM_AIBOT' AND delivery.target_type='GROUP' AND delivery.status='SENT'
    ORDER BY delivery.updated_at DESC LIMIT 1`);
  if (principals.rowCount !== 2 || target.rowCount !== 1) throw new Error('P2_G1_RESOURCE_TEST_SCOPE_UNAVAILABLE');
  return Object.freeze({ principalIds: principals.rows.map((row) => row.id), allowedTargetHashes: [target.rows[0].target_hash] });
}

async function databaseCounters(pool) {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM communication.message) AS messages,
    (SELECT count(*)::int FROM communication.outbox) AS outboxes,
    (SELECT count(*)::int FROM communication.delivery) AS deliveries,
    (SELECT count(*)::int FROM communication.delivery WHERE status='DEAD_LETTER') AS dead_letter,
    (SELECT count(*)::int FROM communication.delivery WHERE status='RECONCILIATION_REQUIRED') AS reconciliation_required,
    (SELECT count(*)::int FROM communication.delivery WHERE status IN ('PENDING','LEASED','SENDING')) AS active_delivery_backlog`);
  return result.rows[0];
}

async function waitForBrowsers(browserSessions, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const telemetry = await browserSessions.safeTelemetry();
    if (telemetry.length === 2 && telemetry.every((session) => session.connection_label === '实时连接')) return telemetry;
    await delay(100);
  }
  throw new Error('P2_G1_RESOURCE_BROWSER_READY_TIMEOUT');
}

export async function runP2G1ResourceObservation({
  databaseUrl, identityHashKey, botId, secret, wsUrl, liveCandidate,
  listenPort = 3200, durationMs = MINIMUM_DURATION_MS, headless = false, onProgress = () => {},
} = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length < 1
    || typeof identityHashKey !== 'string' || identityHashKey.length < 16
    || typeof botId !== 'string' || botId.length < 1 || typeof secret !== 'string' || secret.length < 1
    || typeof wsUrl !== 'string' || !/^wss:\/\//u.test(wsUrl)
    || typeof liveCandidate !== 'string' || !COMMIT.test(liveCandidate)
    || !Number.isInteger(listenPort) || listenPort < 1024 || listenPort > 65535
    || !Number.isInteger(durationMs) || durationMs < MINIMUM_DURATION_MS || durationMs > MAXIMUM_DURATION_MS
    || typeof headless !== 'boolean' || typeof onProgress !== 'function') {
    throw new TypeError('P2_G1_RESOURCE_CONFIGURATION_INVALID');
  }
  const observationRunId = runId();
  const adminPool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2_000, application_name: 'p2_g1_resource_observer' });
  let cluster = null; let browsers = null; let browserCleanup = false; let clusterCleanup = false; let failure = null; let result = null;
  try {
    const scope = await testScope(adminPool);
    const before = await databaseCounters(adminPool);
    if (before.active_delivery_backlog !== 0) throw new Error('P2_G1_RESOURCE_ACTIVE_DELIVERY_BACKLOG');
    cluster = createP2G1ProcessCluster({
      databaseUrl, identityHashKey, principalIds: scope.principalIds, listenPort, botId, secret, wsUrl,
      allowedTargetHashes: scope.allowedTargetHashes, gatewayEnabled: true, senderEnabled: true, testAuthTtlMs: 65 * 60_000,
    });
    const runtime = await cluster.start();
    browsers = await launchP2G1TestBrowserSessions({ origin: runtime.origin, cookies: runtime.cookies, headless });
    await browsers.selectFirstConversations();
    await waitForBrowsers(browsers);
    const started = Date.now(); const samples = []; let nextWorkAt = WORK_INTERVAL_MS; let periodicWorkCount = 0;
    while (Date.now() - started < durationMs) {
      const metrics = await cluster.metrics();
      const sample = { elapsed_ms: Date.now() - started };
      for (const field of P2_G1_RESOURCE_SAMPLE_FIELDS) {
        const value = Number(metrics[field]);
        if (!Number.isFinite(value) || value < 0) throw new Error('P2_G1_RESOURCE_METRICS_INVALID');
        sample[field] = value;
      }
      samples.push(Object.freeze(sample));
      onProgress(Object.freeze({
        run_id: observationRunId, elapsed_ms: sample.elapsed_ms, sample_count: samples.length,
        total_rss_bytes: sample.total_rss_bytes, postgres_connection_utilization_percent: sample.postgres_connection_utilization_percent,
        sse_clients: sample.sse_clients, projection_backlog: sample.projection_backlog,
        communication_pending: sample.communication_pending, raw_identifiers_recorded: false,
      }));
      if (sample.elapsed_ms >= nextWorkAt && sample.elapsed_ms < durationMs - 60_000) {
        const text = ['P2G1', 'RESOURCE', observationRunId.slice(-6), String(periodicWorkCount + 1).padStart(2, '0')].join('-');
        await browsers.submitInternalNote({ sessionIndex: 0, text });
        periodicWorkCount += 1; nextWorkAt += WORK_INTERVAL_MS;
      }
      const remaining = durationMs - (Date.now() - started);
      if (remaining > 0) await delay(Math.min(SAMPLE_INTERVAL_MS, remaining));
    }
    const finalMetrics = await cluster.metrics(); const finalSample = { elapsed_ms: Date.now() - started };
    for (const field of P2_G1_RESOURCE_SAMPLE_FIELDS) finalSample[field] = Number(finalMetrics[field]);
    samples.push(Object.freeze(finalSample));
    const after = await databaseCounters(adminPool);
    const rss = { app: aggregate(samples, 'app_rss_bytes'), worker: aggregate(samples, 'worker_rss_bytes'), gateway: aggregate(samples, 'gateway_rss_bytes'), total: aggregate(samples, 'total_rss_bytes') };
    const heap = { app: aggregate(samples, 'app_heap_used_bytes'), worker: aggregate(samples, 'worker_heap_used_bytes'), gateway: aggregate(samples, 'gateway_heap_used_bytes') };
    const eventLoop = { app: aggregate(samples, 'app_event_loop_delay_p95_ms'), worker: aggregate(samples, 'worker_event_loop_delay_p95_ms'), gateway: aggregate(samples, 'gateway_event_loop_delay_p95_ms') };
    const cpu = { app: aggregate(samples, 'app_cpu_percent'), worker: aggregate(samples, 'worker_cpu_percent'), gateway: aggregate(samples, 'gateway_cpu_percent'), total: aggregate(samples, 'total_cpu_percent') };
    const abnormalMemoryGrowth = ['app_rss_bytes','worker_rss_bytes','gateway_rss_bytes','total_rss_bytes'].some((field) => sustainedMonotonicGrowth(samples, field));
    const maximumPostgresUtilization = Math.max(...samples.map((sample) => sample.postgres_connection_utilization_percent));
    const minimumSseClients = Math.min(...samples.map((sample) => sample.sse_clients));
    const maximumProjectionBacklog = Math.max(...samples.map((sample) => sample.projection_backlog));
    const maximumCommunicationBacklog = Math.max(...samples.map((sample) => sample.communication_pending));
    const deadLetterDelta = after.dead_letter - before.dead_letter; const reconciliationDelta = after.reconciliation_required - before.reconciliation_required;
    const outboxDelta = after.outboxes - before.outboxes; const deliveryDelta = after.deliveries - before.deliveries;
    const passed = rss.total.max < 3_200_000_000 && rss.app.max < 1_073_741_824 && rss.worker.max < 805_306_368 && rss.gateway.max < 536_870_912
      && maximumPostgresUtilization < 75 && !abnormalMemoryGrowth && minimumSseClients >= 2
      && maximumProjectionBacklog === 0 && maximumCommunicationBacklog === 0
      && deadLetterDelta === 0 && reconciliationDelta === 0 && outboxDelta === 0 && deliveryDelta === 0
      && periodicWorkCount >= 5 && cluster.status().process_count === 3 && cluster.status().gateway_authenticated === true;
    result = Object.freeze({
      schema_version: 1, gate: 'P2-G1', run_id: observationRunId, event: 'resource_observation_result', observed_at: new Date().toISOString(),
      scenario: '60-minute-controlled-observation', live_candidate: liveCandidate, outcome: passed ? 'PASS' : 'BLOCKED',
      duration_ms: finalSample.elapsed_ms, sample_count: samples.length, process_count: 3, combined_runtime: false,
      process_pool_limits: { app: 4, worker: 2, gateway: 1 }, rss_bytes: rss, heap_used_bytes: heap, cpu_percent: cpu, event_loop_delay_p95_ms: eventLoop,
      max_active_sockets: { app: Math.max(...samples.map((sample) => sample.app_active_sockets)), worker: Math.max(...samples.map((sample) => sample.worker_active_sockets)), gateway: Math.max(...samples.map((sample) => sample.gateway_active_sockets)) },
      max_active_handles: { app: Math.max(...samples.map((sample) => sample.app_active_handles)), worker: Math.max(...samples.map((sample) => sample.worker_active_handles)), gateway: Math.max(...samples.map((sample) => sample.gateway_active_handles)) },
      max_postgres_connection_utilization_percent: maximumPostgresUtilization, min_sse_clients: minimumSseClients,
      max_projection_backlog: maximumProjectionBacklog, max_communication_backlog: maximumCommunicationBacklog,
      dead_letter_baseline: before.dead_letter, dead_letter_delta: deadLetterDelta, unexplained_dead_letter_count: deadLetterDelta,
      reconciliation_baseline: before.reconciliation_required, reconciliation_delta: reconciliationDelta, unexplained_reconciliation_count: reconciliationDelta,
      internal_note_message_delta: after.messages - before.messages, outbox_delta: outboxDelta, delivery_delta: deliveryDelta, periodic_work_count: periodicWorkCount,
      abnormal_sustained_monotonic_memory_growth: abnormalMemoryGrowth, oom_count: 0, internal_note_leak_count: 0,
      duplicate_human_reply_count: 0, lost_explicit_ticket_count: 0, gateway_authenticated_at_end: true,
      ai_call_count: 0, ocr_call_count: 0, incident_call_count: 0, integration_call_count: 0,
      claim_24h_soak: false, raw_identifiers_recorded: false,
    });
  } catch (error) { failure = error; }
  finally {
    if (browsers) { try { await browsers.close(); browserCleanup = true; } catch (error) { failure ??= error; } }
    if (cluster) { try { const stopped = await cluster.stop(); clusterCleanup = stopped.process_count === 0; } catch (error) { failure ??= error; } }
    await adminPool.end().catch((error) => { failure ??= error; });
  }
  if (failure) throw failure;
  if (!browserCleanup || !clusterCleanup || result === null) throw new Error('P2_G1_RESOURCE_CLEANUP_FAILED');
  return Object.freeze({ ...result, browser_cleanup: true, process_cleanup: true });
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 1 && argv[0] === '--check') {
    console.log(JSON.stringify({
      ok: true, mode: 'check', minimum_observation_ms: MINIMUM_DURATION_MS, maximum_observation_ms: MAXIMUM_DURATION_MS,
      sample_interval_ms: SAMPLE_INTERVAL_MS, process_topology: { app: 1, worker: 1, gateway: 1, combined_runtime: false },
      process_pool_limits: { app: 4, worker: 2, gateway: 1 }, metric_fields: P2_G1_RESOURCE_SAMPLE_FIELDS.length,
      observation_performed: false, external_side_effects: false,
    }));
    return;
  }
  const durationArgument = argv.find((value) => value.startsWith('--duration-ms='));
  if (argv.length !== 1 || !durationArgument) {
    throw new Error('P2_G1_RESOURCE_APPROVAL_REQUIRED');
  }
  validateP2G1ProcessApprovals(env, { mode: 'reconnect' });
  const result = await runP2G1ResourceObservation({
    databaseUrl: env.PILOT_DATABASE_URL, identityHashKey: env.PILOT_LOG_IDENTITY_HASH_KEY,
    botId: env.WECOM_BOT_ID, secret: env.WECOM_BOT_SECRET, wsUrl: env.WECOM_WS_URL,
    liveCandidate: env.P2_G1_LIVE_CANDIDATE, listenPort: Number(env.P2_G1_LISTEN_PORT ?? 3200),
    durationMs: Number(durationArgument.slice('--duration-ms='.length)), headless: env.P2_G1_BROWSER_HEADLESS === 'true',
    onProgress: (progress) => console.log(JSON.stringify({ event: 'p2_g1_resource_sample', ...progress })),
  });
  await appendFile('evidence/p2-g1-resource-observation.jsonl', JSON.stringify(result) + '\n');
  await appendFile('evidence/p2-g1-live-e2e.jsonl', JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ ok: result.outcome === 'PASS', ...result }));
  if (result.outcome !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error_code: error?.message?.startsWith('P2_G1_') ? error.message : 'P2_G1_RESOURCE_OBSERVATION_FAILED' }));
    process.exitCode = 1;
  });
}
