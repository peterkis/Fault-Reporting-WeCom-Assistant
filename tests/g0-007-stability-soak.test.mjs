import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  DEFAULT_DURATION_MS,
  createRunId,
  parseCliArgs,
  runStabilitySoak,
  validateStabilityConfig,
} from '../src/g0-007-stability-soak.mjs';

const baseEnv = {
  ARCHITECTURE_BASELINE: 'V1.2',
  APP_PHASE: 'G0',
  WECOM_BOT_ID: 'bot-for-test',
  WECOM_BOT_SECRET: 'secret-for-test',
  WECOM_WS_URL: 'wss://openws.work.weixin.qq.com',
  AI_TRIAGE_ENABLED: 'false',
  OCR_ENABLED: 'false',
  HOSPITAL_TICKETS_ENABLED: 'false',
};

class FakeClient extends EventEmitter {
  disconnectCount = 0;

  connect() {
    this.emit('connected');
    this.emit('authenticated');
    return this;
  }

  disconnect() {
    this.disconnectCount += 1;
  }
}

test('G0-007 defaults to a 4 hour 30 minute Windows-native soak and keeps Phase boundaries', () => {
  assert.equal(DEFAULT_DURATION_MS, 16_200_000);
  assert.equal(parseCliArgs([]).durationMs, DEFAULT_DURATION_MS);
  assert.throws(() => parseCliArgs(['--duration-ms=999']), /DURATION_MS/);
  assert.throws(() => parseCliArgs(['--duration-ms=1000', '--sample-interval-ms=2000']), /SAMPLE_INTERVAL_EXCEEDS_DURATION/);
  assert.equal(validateStabilityConfig(baseEnv).botId, 'bot-for-test');
  assert.throws(() => validateStabilityConfig({ ...baseEnv, HOSPITAL_TICKETS_ENABLED: 'true' }), /HOSPITAL_TICKETS_ENABLED_MUST_BE_FALSE/);
});

test('run id is opaque and deterministic under an injected clock', () => {
  assert.equal(createRunId(() => 1234, 5678), createRunId(() => 1234, 5678));
  assert.equal(createRunId(() => 1234, 5678).length, 12);
});

test('reconnect recovery, resource samples, and message replay stay content-free', async () => {
  const client = new FakeClient();
  const captures = [];
  const states = [];
  let clock = 1_000;
  let cpuCounter = 0;
  const monitor = runStabilitySoak({
    client,
    writeCapture: (capture) => captures.push(capture),
    writeState: (state) => states.push(state),
    durationMs: 10_000,
    sampleIntervalMs: 1_000,
    runId: 'test-run',
    now: () => clock,
    memoryUsage: () => ({ rss: 100 + clock, heapUsed: 50 + clock }),
    cpuUsage: () => ({ user: ++cpuCounter * 100, system: 0 }),
    setTimeoutFn: () => ({ timer: 'duration' }),
    clearTimeoutFn: () => {},
    setIntervalFn: () => ({ timer: 'sample' }),
    clearIntervalFn: () => {},
  });
  clock += 10;
  client.emit('disconnected');
  clock += 100;
  client.emit('reconnecting', 1);
  clock += 250;
  client.emit('authenticated');
  client.emit('message', { body: { msgid: 'message-1', msgtype: 'text', text: { content: 'must not persist' } } });
  client.emit('message', { body: { msgid: 'message-1', msgtype: 'text', text: { content: 'must not persist' } } });
  const resultPromise = monitor.completion;
  monitor.stop('TEST_STOP');
  const result = await resultPromise;

  assert.equal(result.reconnect_recovered_total, 1);
  assert.equal(result.max_recovery_ms, 350);
  assert.equal(result.message_received_total, 2);
  assert.equal(result.message_replay_total, 1);
  assert.equal(client.disconnectCount, 1);
  assert.equal(captures.some((capture) => JSON.stringify(capture).includes('must not persist')), false);
  assert.equal(states.length > 0, true);
});

test('a completed requested soak does not satisfy the 4 hour 30 minute Gate duration when shortened', async () => {
  const client = new FakeClient();
  const captures = [];
  let durationCallback;
  const monitor = runStabilitySoak({
    client,
    writeCapture: (capture) => captures.push(capture),
    writeState: () => {},
    durationMs: 1_000,
    sampleIntervalMs: 1_000,
    runId: 'test-run',
    setTimeoutFn: (callback) => { durationCallback = callback; return {}; },
    clearTimeoutFn: () => {},
    setIntervalFn: () => ({}),
    clearIntervalFn: () => {},
  });
  durationCallback();
  const result = await monitor.completion;
  assert.equal(result.stop_reason, 'SOAK_DURATION_REACHED');
  assert.equal(result.duration_reached, true);
  assert.equal(result.soak_completed, true);
  assert.equal(result.gate_duration_satisfied, false);
  assert.equal(result.acceptance_ready, false);
  assert.equal(captures.at(-1).event, 'monitor_finished');
});
