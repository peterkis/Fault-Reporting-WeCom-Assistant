import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';

import {
  SDK_VERSION,
  classifyError,
  createSafeSdkLogger,
  validateRuntimeConfig,
} from './g0-002-sdk-lifecycle.mjs';

export const TEST_ID = 'G0-007';
export const DEFAULT_DURATION_MS = 4 * 60 * 60 * 1_000 + 30 * 60 * 1_000;
export const DEFAULT_SAMPLE_INTERVAL_MS = 30_000;
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 26 * 60 * 60 * 1_000;
const MIN_SAMPLE_INTERVAL_MS = 1_000;
const MAX_SAMPLE_INTERVAL_MS = 60 * 60 * 1_000;

function hashIdentifier(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function requireIntegerInRange(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`G0_CONFIG_INVALID:${name}`);
  }
  return value;
}

function summarizeSamples(samples) {
  if (samples.length === 0) {
    return { sample_count: 0, memory_growth_bytes: null, max_rss_bytes: null, max_heap_used_bytes: null, max_cpu_percent: null };
  }
  const first = samples[0];
  const last = samples.at(-1);
  return {
    sample_count: samples.length,
    memory_growth_bytes: last.memory_rss_bytes - first.memory_rss_bytes,
    max_rss_bytes: Math.max(...samples.map((sample) => sample.memory_rss_bytes)),
    max_heap_used_bytes: Math.max(...samples.map((sample) => sample.heap_used_bytes)),
    max_cpu_percent: Math.max(...samples.map((sample) => sample.cpu_percent)),
  };
}

export function parseCliArgs(argv) {
  const valueOf = (name, fallback) => {
    const argument = argv.find((value) => value.startsWith(`${name}=`));
    return argument ? Number(argument.slice(name.length + 1)) : fallback;
  };
  const outputArgument = argv.find((value) => value.startsWith('--output-path='));
  const stateArgument = argv.find((value) => value.startsWith('--state-path='));
  const durationMs = requireIntegerInRange(valueOf('--duration-ms', DEFAULT_DURATION_MS), 'DURATION_MS', MIN_DURATION_MS, MAX_DURATION_MS);
  const sampleIntervalMs = requireIntegerInRange(valueOf('--sample-interval-ms', DEFAULT_SAMPLE_INTERVAL_MS), 'SAMPLE_INTERVAL_MS', MIN_SAMPLE_INTERVAL_MS, MAX_SAMPLE_INTERVAL_MS);
  if (sampleIntervalMs > durationMs) {
    throw new Error('G0_CONFIG_INVALID:SAMPLE_INTERVAL_EXCEEDS_DURATION');
  }
  return {
    durationMs,
    sampleIntervalMs,
    outputPath: resolve(outputArgument ? outputArgument.slice('--output-path='.length) : 'evidence/g0-007-stability-captures.jsonl'),
    statePath: resolve(stateArgument ? stateArgument.slice('--state-path='.length) : 'evidence/g0-007-stability-live-status.json'),
  };
}

export function validateStabilityConfig(env) {
  return validateRuntimeConfig(env, 'valid');
}

export function createRunId(now = () => Date.now(), pid = process.pid) {
  return hashIdentifier(`${now()}:${pid}:G0-007`);
}

export function runStabilitySoak({
  client,
  writeCapture,
  writeState,
  durationMs,
  sampleIntervalMs,
  runId,
  now = () => Date.now(),
  memoryUsage = () => process.memoryUsage(),
  cpuUsage = (previous) => process.cpuUsage(previous),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let state = 'CREATED';
  let stopping = false;
  let finished = false;
  let startedAtMs;
  let reconnectStartedAtMs = null;
  let previousSampleAtMs = null;
  let previousCpuUsage;
  let authenticated = false;
  let durationTimer;
  let sampleTimer;
  let sequence = 0;
  let completionResolve;
  const seenMessageIds = new Set();
  const samples = [];
  const counters = {
    connected_total: 0,
    authenticated_total: 0,
    disconnected_total: 0,
    reconnect_attempt_total: 0,
    reconnect_recovered_total: 0,
    sdk_error_total: 0,
    message_received_total: 0,
    message_replay_total: 0,
    server_single_active_event_total: 0,
  };
  const recoveryDurationsMs = [];

  const completion = new Promise((resolveCompletion) => {
    completionResolve = resolveCompletion;
  });

  function snapshot(outcome = 'RUNNING') {
    const summary = summarizeSamples(samples);
    return {
      test_id: TEST_ID,
      run_id: runId,
      outcome,
      state,
      started_at_utc: startedAtMs ? new Date(startedAtMs).toISOString() : null,
      elapsed_ms: startedAtMs ? Math.max(0, now() - startedAtMs) : 0,
      authenticated,
      ...counters,
      recovery_count: recoveryDurationsMs.length,
      max_recovery_ms: recoveryDurationsMs.length > 0 ? Math.max(...recoveryDurationsMs) : null,
      ...summary,
    };
  }

  function publishState(outcome) {
    writeState(snapshot(outcome));
  }

  function emit(event, details = {}) {
    sequence += 1;
    writeCapture({
      test_id: TEST_ID,
      run_id: runId,
      sequence,
      at_utc: new Date(now()).toISOString(),
      event,
      state,
      ...details,
    });
    publishState('RUNNING');
  }

  function sample() {
    const atMs = now();
    const memory = memoryUsage();
    const cpu = cpuUsage();
    const cpuDelta = previousCpuUsage === undefined
      ? { user: 0, system: 0 }
      : {
        user: Math.max(0, cpu.user - previousCpuUsage.user),
        system: Math.max(0, cpu.system - previousCpuUsage.system),
      };
    const elapsedSinceLastSampleMs = previousSampleAtMs === null ? null : Math.max(1, atMs - previousSampleAtMs);
    const cpuPercent = elapsedSinceLastSampleMs === null
      ? 0
      : Number((((cpuDelta.user + cpuDelta.system) / (elapsedSinceLastSampleMs * 1_000)) * 100).toFixed(3));
    previousCpuUsage = cpu;
    previousSampleAtMs = atMs;
    const sampleRecord = {
      memory_rss_bytes: Number(memory.rss),
      heap_used_bytes: Number(memory.heapUsed),
      cpu_percent: cpuPercent,
    };
    samples.push(sampleRecord);
    emit('resource_sample', sampleRecord);
  }

  function finish(reason) {
    if (finished) return;
    finished = true;
    stopping = true;
    clearTimeoutFn(durationTimer);
    clearIntervalFn(sampleTimer);
    state = 'STOPPING';
    emit('disconnect_requested', { reason });
    try {
      client.disconnect();
    } catch {
      // 监测证据已经写入；断开失败不能抹去本次浸泡结果。
    }
    const finalState = snapshot(reason === 'SOAK_DURATION_REACHED' ? 'COMPLETED' : 'STOPPED');
    finalState.stop_reason = reason;
    finalState.duration_reached = reason === 'SOAK_DURATION_REACHED';
    finalState.soak_completed = Boolean(finalState.duration_reached && authenticated && counters.authenticated_total > 0 && reconnectStartedAtMs === null);
    finalState.gate_duration_satisfied = durationMs >= DEFAULT_DURATION_MS;
    finalState.acceptance_ready = Boolean(finalState.soak_completed && finalState.gate_duration_satisfied);
    writeCapture({
      test_id: TEST_ID,
      run_id: runId,
      sequence: sequence + 1,
      at_utc: new Date(now()).toISOString(),
      event: 'monitor_finished',
      ...finalState,
    });
    publishState(finalState.outcome);
    completionResolve(finalState);
  }

  client.on('connected', () => {
    if (stopping) return;
    counters.connected_total += 1;
    state = 'CONNECTED';
    emit('connected');
  });
  client.on('authenticated', () => {
    if (stopping) return;
    counters.authenticated_total += 1;
    authenticated = true;
    state = 'AUTHENTICATED';
    if (reconnectStartedAtMs !== null) {
      const recoveryMs = Math.max(0, now() - reconnectStartedAtMs);
      recoveryDurationsMs.push(recoveryMs);
      counters.reconnect_recovered_total += 1;
      reconnectStartedAtMs = null;
      emit('reconnected_authenticated', { recovery_ms: recoveryMs });
      return;
    }
    emit('authenticated');
  });
  client.on('disconnected', () => {
    if (finished) return;
    counters.disconnected_total += 1;
    authenticated = false;
    if (!stopping && reconnectStartedAtMs === null) reconnectStartedAtMs = now();
    state = stopping ? 'STOPPING' : 'DISCONNECTED';
    emit('disconnected');
  });
  client.on('reconnecting', (attempt) => {
    if (stopping) return;
    if (reconnectStartedAtMs === null) reconnectStartedAtMs = now();
    counters.reconnect_attempt_total += 1;
    state = 'RECONNECTING';
    emit('reconnecting', { attempt: Number(attempt) || 0 });
  });
  client.on('error', (error) => {
    if (stopping) return;
    counters.sdk_error_total += 1;
    emit('sdk_error', { error_code: classifyError(error) });
  });
  client.on('event.disconnected_event', () => {
    if (stopping) return;
    counters.server_single_active_event_total += 1;
    emit('server_single_active_disconnect_event');
  });
  client.on('message', (frame) => {
    if (stopping) return;
    const body = frame?.body ?? {};
    const messageIdHash = body.msgid ? hashIdentifier(body.msgid) : null;
    const replayed = messageIdHash !== null && seenMessageIds.has(messageIdHash);
    if (messageIdHash !== null) seenMessageIds.add(messageIdHash);
    counters.message_received_total += 1;
    if (replayed) counters.message_replay_total += 1;
    emit('message_observed', { msg_type: String(body.msgtype ?? 'unknown'), replayed });
  });

  startedAtMs = now();
  state = 'CONNECTING';
  emit('monitor_started', { duration_ms: durationMs, sample_interval_ms: sampleIntervalMs });
  sample();
  sampleTimer = setIntervalFn(sample, sampleIntervalMs);
  durationTimer = setTimeoutFn(() => finish('SOAK_DURATION_REACHED'), durationMs);
  try {
    client.connect();
  } catch {
    counters.sdk_error_total += 1;
    emit('connect_thrown', { error_code: 'WECOM_CONNECT_FAILED' });
  }

  return { completion, stop: (reason = 'MANUAL_STOP') => finish(reason), snapshot: () => snapshot('RUNNING') };
}

function appendCapture(outputPath, capture) {
  mkdirSync(dirname(outputPath), { recursive: true });
  appendFileSync(outputPath, `${JSON.stringify(capture)}\n`, { encoding: 'utf8' });
}

function writeLiveState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8' });
}

async function main() {
  let options;
  let config;
  try {
    options = parseCliArgs(process.argv.slice(2));
    config = validateStabilityConfig(process.env);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'WECOM_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }

  const runId = createRunId();
  const writeCapture = (capture) => appendCapture(options.outputPath, capture);
  const client = new AiBot.WSClient({
    botId: config.botId,
    secret: config.secret,
    wsUrl: config.wsUrl,
    maxReconnectAttempts: -1,
    logger: createSafeSdkLogger({
      onHeartbeatTimerStarted: () => writeCapture({
        test_id: TEST_ID,
        run_id: runId,
        at_utc: new Date().toISOString(),
        event: 'heartbeat_timer_started',
      }),
    }),
  });
  const monitor = runStabilitySoak({
    client,
    writeCapture,
    writeState: (state) => writeLiveState(options.statePath, state),
    durationMs: options.durationMs,
    sampleIntervalMs: options.sampleIntervalMs,
    runId,
  });
  process.once('SIGINT', () => monitor.stop('SIGINT'));
  process.once('SIGTERM', () => monitor.stop('SIGTERM'));
  const result = await monitor.completion;
  console.log(JSON.stringify({
    test_id: TEST_ID,
    run_id: runId,
    event: 'monitor_result',
    soak_completed: result.soak_completed,
    gate_duration_satisfied: result.gate_duration_satisfied,
    acceptance_ready: result.acceptance_ready,
    stop_reason: result.stop_reason,
  }));
  process.exitCode = result.soak_completed ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
