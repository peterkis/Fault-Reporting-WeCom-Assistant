import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  classifyError,
  parseCliArgs,
  redact,
  runLifecycleProbe,
  validateRuntimeConfig,
} from '../src/g0-002-sdk-lifecycle.mjs';

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
    queueMicrotask(() => this.emit('connected'));
    queueMicrotask(() => this.emit('authenticated'));
    return this;
  }

  disconnect() {
    this.disconnectCount += 1;
    queueMicrotask(() => this.emit('disconnected', 'manual'));
  }
}

test('configuration preserves G0 boundaries and substitutes only the invalid test secret', () => {
  const valid = validateRuntimeConfig(baseEnv);
  const invalid = validateRuntimeConfig(baseEnv, 'invalid-secret');
  assert.equal(valid.secret, 'secret-for-test');
  assert.equal(invalid.secret, 'g0-002-intentionally-invalid-secret');
  assert.equal(valid.botIdHash.length, 12);
  assert.throws(
    () => validateRuntimeConfig({ ...baseEnv, HOSPITAL_TICKETS_ENABLED: 'true' }),
    /HOSPITAL_TICKETS_ENABLED_MUST_BE_FALSE/,
  );
});

test('redaction and error mapping do not expose a configured secret', () => {
  const secret = 'secret-for-test';
  const redacted = redact(`Authentication failed: secret=${secret}`, [secret]);
  assert.equal(redacted.includes(secret), false);
  assert.match(redacted, /\[redacted\]/);
  assert.equal(classifyError(new Error('Authentication failed')), 'WECOM_AUTH_FAILED');
});

test('the connection stability window is bounded and explicit', () => {
  assert.equal(parseCliArgs([]).stableConnectionMs, 2_500);
  assert.equal(parseCliArgs(['--stable-connection-ms=30000']).stableConnectionMs, 30_000);
  assert.throws(() => parseCliArgs(['--stable-connection-ms=0']), /STABLE_CONNECTION_MS/);
});

test('authenticated probe starts shutdown by SIGTERM and calls disconnect before completion', async () => {
  const client = new FakeClient();
  const signals = new EventEmitter();
  const events = [];
  let heartbeatTimerStarted = true;
  const probe = runLifecycleProbe({
    client,
    writeEvent: (event) => events.push(event),
    authTimeoutMs: 100,
    stableConnectionMs: 1,
    disconnectWaitMs: 20,
    selfSigtermAfterAuth: true,
    signalEmitter: signals,
    triggerSigterm: () => signals.emit('SIGTERM'),
    getHeartbeatTimerStarted: () => heartbeatTimerStarted,
  });
  const result = await probe.completion;
  assert.equal(result.ok, true);
  assert.equal(result.shutdown_reason, 'SIGTERM');
  assert.equal(client.disconnectCount, 1);
  assert.equal(events.some((event) => event.event === 'authenticated'), true);
  heartbeatTimerStarted = false;
});
