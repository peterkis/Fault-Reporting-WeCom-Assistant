import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import {
  createWeComDeliverySender,
  parseP1_012LiveArgs,
  runP1_012GroupIdCapture,
  runP1_012LiveE2E,
  validateP1_012LiveConfig,
} from '../scripts/p1-012-live-e2e.mjs';

const root = resolve(import.meta.dirname, '..');
const script = resolve(root, 'scripts', 'p1-012-live-e2e.mjs');

function liveEnvironment(overrides = {}) {
  return {
    ARCHITECTURE_BASELINE: 'V1.2',
    APP_PHASE: 'P1',
    PILOT_ENV: 'development',
    PILOT_LISTEN_HOST: '127.0.0.1',
    PILOT_LISTEN_PORT: '3100',
    PILOT_PUBLIC_EDGE_APPROVED: 'false',
    PILOT_SECURITY_BOUNDARY_APPROVED: 'false',
    PILOT_OWNER_ID: 'p1-012-owner',
    PILOT_TEST_GROUP_ID: 'p1-012-test-group',
    PILOT_TEST_ACCOUNT_USER_ID: 'p1-012-test-account',
    PILOT_DATABASE_URL: 'postgresql://pilot-user:database-secret@127.0.0.1:5432/pilot_ticket_core',
    WECOM_BOT_ID: 'p1-012-bot',
    WECOM_BOT_SECRET: 'wecom-secret-for-p1-012-test',
    WECOM_WS_URL: 'wss://openws.work.weixin.qq.com',
    PILOT_LOG_IDENTITY_HASH_KEY: 'p1-012-log-hash-key',
    AI_TRIAGE_ENABLED: 'false',
    OCR_ENABLED: 'false',
    HOSPITAL_TICKETS_ENABLED: 'false',
    ...overrides,
  };
}

class FakeReconnectClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
  }

  connect() {
    queueMicrotask(() => this.emit('authenticated'));
  }

  disconnect() {
    queueMicrotask(() => this.emit('disconnected'));
  }
}

class FakeTransientReconnectClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      queueMicrotask(() => {
        this.emit('disconnected', 'test_transient_disconnect');
        this.emit('reconnecting', 1);
        queueMicrotask(() => {
          this.emit('authenticated');
          queueMicrotask(() => this.emit('message', {
            cmd: 'aibot_msg_callback',
            body: {
              chattype: 'group',
              chatid: 'p1-012-test-group',
              from: { userid: 'p1-012-test-account' },
              msgid: 'p1-012-transient-message',
              msgtype: 'text',
              text: { content: 'p1-012-transient-token' },
            },
          }));
        });
      });
    });
  }

  disconnect() {}
}

class FakeGroupCaptureClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      queueMicrotask(() => this.emit('message', {
        cmd: 'aibot_msg_callback',
        body: {
          chattype: 'group',
          chatid: 'captured-p1-012-test-group',
          from: { userid: 'p1-012-test-account' },
          msgid: 'p1-012-capture-message',
          msgtype: 'text',
          text: { content: 'p1-012-capture-token' },
        },
      }));
    });
  }

  disconnect() {}
}

class FakePool {
  constructor(options) {
    this.options = options;
    this.ended = false;
  }

  async end() {
    this.ended = true;
  }
}

test('P1-012 accepts only an explicit check or approved live scenario', () => {
  assert.deepEqual(parseP1_012LiveArgs([]), { mode: 'check' });
  assert.deepEqual(parseP1_012LiveArgs(['--check']), { mode: 'check' });
  assert.deepEqual(
    parseP1_012LiveArgs(['--live', '--scenario=group-text', '--trigger-token=p1-012-run', '--timeout-ms=120000']),
    { mode: 'live', scenario: 'GROUP_TEXT', triggerToken: 'p1-012-run', timeoutMs: 120_000 },
  );
  assert.deepEqual(
    parseP1_012LiveArgs(['--capture-test-group-id', '--apply', '--trigger-token=p1-012-capture-token']),
    { mode: 'capture_group_id', triggerToken: 'p1-012-capture-token', timeoutMs: 120_000 },
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--live', '--scenario=group-text']),
    /P1_012_LIVE_ARGS/u,
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--live', '--scenario=group-image-degraded', '--trigger-token=p1-012-run', '--verbose']),
    /P1_012_LIVE_ARGS/u,
  );
});

test('P1-012 validates WSS and Pilot configuration without requiring a public listener', () => {
  const config = validateP1_012LiveConfig(liveEnvironment());

  assert.deepEqual(config.public_summary, {
    phase: 'P1',
    environment: 'development',
    public_listener_required: false,
    ai_triage_enabled: false,
    ocr_enabled: false,
    hospital_tickets_enabled: false,
  });
  assert.equal(JSON.stringify(config.public_summary).includes('database-secret'), false);
  assert.equal(JSON.stringify(config.public_summary).includes('wecom-secret-for-p1-012-test'), false);
  assert.equal(JSON.stringify(config.public_summary).includes('p1-012-test-account'), false);
  assert.throws(
    () => validateP1_012LiveConfig(liveEnvironment({ PILOT_LOG_IDENTITY_HASH_KEY: '' })),
    /P1_012_LOG_HASH_KEY_MISSING/u,
  );
  assert.throws(
    () => validateP1_012LiveConfig(liveEnvironment({ PILOT_TEST_ACCOUNT_USER_ID: '' })),
    /P1_012_TEST_ACCOUNT_REQUIRED/u,
  );
});

test('P1-012 check emits a redacted readiness record with no public-IP prerequisite', () => {
  const environment = liveEnvironment();
  const result = spawnSync(process.execPath, [script, '--check'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });

  assert.equal(result.status, 0, result.stderr);
  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /p1_012_live_e2e_ready/u);
  assert.match(output, /"public_listener_required":false/u);
  assert.equal(output.includes('database-secret'), false);
  assert.equal(output.includes('wecom-secret-for-p1-012-test'), false);
});

test('P1-012 marks an active delivery without an explicit provider ACK as retryable', async () => {
  const sender = createWeComDeliverySender({
    async sendMessage() {
      return undefined;
    },
  });

  assert.deepEqual(
    await sender({ channel: 'WECOM_DIRECT', targetKey: 'p1-012-test-account' }),
    { ok: false, code: 'WECOM_DELIVERY_ACK_MISSING' },
  );
});

test('P1-012 waits through a transient SDK disconnect and records only safe reconnect evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-live-e2e-'));
  const outputPath = join(directory, 'evidence.jsonl');
  try {
    const result = await runP1_012LiveE2E({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--live',
        '--scenario=group-text',
        '--trigger-token=p1-012-transient-token',
      ]),
      Client: FakeTransientReconnectClient,
      PoolClass: FakePool,
      outputPath,
      createHandler: () => ({
        async handleFrame() {
          return {
            outcome: 'processed',
            scenario: 'GROUP_TEXT',
            core: { accepted: true },
            passive_reply: { acknowledged: true },
          };
        },
      }),
    });
    assert.deepEqual(result, { ok: true, scenario: 'GROUP_TEXT' });
    const evidence = await readFile(outputPath, 'utf8');
    assert.match(evidence, /p1_012_wss_disconnected/u);
    assert.match(evidence, /p1_012_wss_reconnecting/u);
    assert.match(evidence, /p1_012_wss_reauthenticated/u);
    assert.equal(evidence.includes('p1-012-test-group'), false);
    assert.equal(evidence.includes('p1-012-test-account'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 captures a scoped test-group id only into the local config and hashes its evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-group-id-capture-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const envFilePath = join(directory, '.env.pilot');
  await writeFile(envFilePath, 'PILOT_TEST_GROUP_ID=stale-p1-012-group\nPRESERVED_VALUE=1\n', 'utf8');
  try {
    const result = await runP1_012GroupIdCapture({
      env: liveEnvironment({
        PILOT_TEST_GROUP_ID: 'stale-p1-012-group',
        P1_012_GROUP_ID_CAPTURE_APPROVED: 'true',
      }),
      options: parseP1_012LiveArgs([
        '--capture-test-group-id',
        '--apply',
        '--trigger-token=p1-012-capture-token',
      ]),
      Client: FakeGroupCaptureClient,
      envFilePath,
      outputPath,
    });
    assert.deepEqual(result, { ok: true, configuration_updated: true });
    const updatedConfig = await readFile(envFilePath, 'utf8');
    assert.match(updatedConfig, /^PILOT_TEST_GROUP_ID=captured-p1-012-test-group$/mu);
    assert.match(updatedConfig, /^PRESERVED_VALUE=1$/mu);
    const evidence = await readFile(outputPath, 'utf8');
    assert.match(evidence, /p1_012_group_id_capture_applied/u);
    assert.match(evidence, /group_id_hash/u);
    assert.equal(evidence.includes('captured-p1-012-test-group'), false);
    assert.equal(evidence.includes('p1-012-test-account'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 requires one-process approval and records an outbound-WSS reconnect without a public listener', async () => {
  const options = parseP1_012LiveArgs([
    '--live',
    '--scenario=reconnect',
    '--trigger-token=p1-012-reconnect',
    '--timeout-ms=10000',
  ]);
  await assert.rejects(
    () => runP1_012LiveE2E({
      env: liveEnvironment(),
      options,
      Client: FakeReconnectClient,
      PoolClass: FakePool,
    }),
    /P1_012_LIVE_APPROVAL_REQUIRED/u,
  );

  const directory = await mkdtemp(join(tmpdir(), 'p1-012-live-e2e-'));
  const outputPath = join(directory, 'evidence.jsonl');
  try {
    const result = await runP1_012LiveE2E({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options,
      Client: FakeReconnectClient,
      PoolClass: FakePool,
      outputPath,
    });
    assert.deepEqual(result, { ok: true, scenario: 'RECONNECT' });
    const evidence = await readFile(outputPath, 'utf8');
    assert.match(evidence, /p1_012_wss_connect_requested/u);
    assert.match(evidence, /p1_012_live_e2e_ready/u);
    assert.match(evidence, /p1_012_wss_reauthenticated/u);
    assert.match(evidence, /"public_listener_required":false/u);
    assert.equal(evidence.includes('database-secret'), false);
    assert.equal(evidence.includes('wecom-secret-for-p1-012-test'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
