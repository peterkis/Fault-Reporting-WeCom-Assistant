import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import {
  createWeComGroupPassiveReplySender,
  createWeComDeliverySender,
  parseP1_012LiveArgs,
  runP1_012ReplyProbeEvidenceChainRecovery,
  runP1_012ClientObservation,
  runP1_012GroupIdCapture,
  runP1_012LiveE2E,
  runP1_012SharedDeliveryReconciliation,
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

class FakeReconnectGroupTextClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.connectCount = 0;
  }

  connect() {
    this.connectCount += 1;
    const connectCount = this.connectCount;
    queueMicrotask(() => {
      this.emit('authenticated');
      const emitMessage = () => this.emit('message', {
        cmd: 'aibot_msg_callback',
        body: {
          chattype: 'group',
          chatid: 'p1-012-test-group',
          from: { userid: 'p1-012-test-account' },
          msgid: connectCount === 1 ? 'p1-012-before-reconnect' : 'p1-012-after-reconnect',
          msgtype: 'text',
          text: { content: 'p1-012-reconnect-text-token' },
        },
      });
      if (connectCount === 1) queueMicrotask(emitMessage);
      else setTimeout(emitMessage, 10);
    });
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
        const transientError = new Error('transient socket error must not be recorded');
        transientError.code = 'ECONNRESET';
        this.emit('error', transientError);
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

class FakeGroupBurstClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      for (let index = 1; index <= 100; index += 1) {
        const sequence = String(index).padStart(3, '0');
        queueMicrotask(() => this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: `p1-012-burst-message-${sequence}`,
            msgtype: 'text',
            text: { content: `@test-bot P1012-BURST-TEST-${sequence}` },
          },
        }));
      }
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
      queueMicrotask(() => {
        const transientError = new Error('capture socket error must not be recorded');
        transientError.code = 'ECONNRESET';
        this.emit('error', transientError);
        this.emit('disconnected', 'test_transient_disconnect');
        this.emit('reconnecting', 1);
        queueMicrotask(() => {
          this.emit('authenticated');
          this.emit('message', {
            cmd: 'aibot_msg_callback',
            body: {
              chattype: 'group',
              chatid: 'captured-p1-012-test-group',
              from: { userid: 'p1-012-test-account' },
              msgid: 'p1-012-capture-message',
              msgtype: 'text',
              text: { content: 'p1-012-capture-token' },
            },
          });
        });
      });
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

class FakeReplyProbeClient extends EventEmitter {
  static latest = null;

  constructor(options) {
    super();
    this.options = options;
    this.replyCalls = [];
    FakeReplyProbeClient.latest = this;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      queueMicrotask(() => {
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-wrong-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-reply-probe-wrong-group',
            msgtype: 'text',
            text: { content: 'p12' },
          },
        });
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-wrong-account' },
            msgid: 'p1-012-reply-probe-wrong-account',
            msgtype: 'text',
            text: { content: 'p12' },
          },
        });
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-wrong-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-reply-probe-wrong-bot',
            msgtype: 'text',
            text: { content: '@robot p12' },
          },
        });
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-reply-probe-contains-only',
            msgtype: 'text',
            text: { content: '@robot p12 extra' },
          },
        });
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-reply-probe-double-space',
            msgtype: 'text',
            text: { content: '@robot  p12' },
          },
        });
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-reply-probe-tab',
            msgtype: 'text',
            text: { content: '@robot\tp12' },
          },
        });
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-reply-probe-line-break',
            msgtype: 'text',
            text: { content: '@robot\np12' },
          },
        });
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-reply-probe-exact',
            msgtype: 'text',
            text: { content: '@robot p12' },
          },
        });
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-reply-probe-replay',
            msgtype: 'text',
            text: { content: 'p12' },
          },
        });
      });
    });
  }

  disconnect() {}

  async replyStream(...args) {
    this.replyCalls.push(args);
    return { errcode: 0 };
  }
}

class ProhibitedPool {
  constructor() {
    throw new Error('reply probe must not allocate a database pool');
  }
}

class FakeCompetingEvidenceClient extends EventEmitter {
  static latest = null;

  constructor(options) {
    super();
    this.options = options;
    this.replyCalls = [];
    FakeCompetingEvidenceClient.latest = this;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      queueMicrotask(() => {
        const transientError = new Error('evidence failure must not leak this message');
        transientError.code = 'ECONNRESET';
        this.emit('error', transientError);
        setTimeout(() => this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-racing-probe',
            msgtype: 'text',
            text: { content: 'p12' },
          },
        }), 10);
      });
    });
  }

  disconnect() {}

  async replyStream() {
    this.replyCalls.push(true);
    return { errcode: 0 };
  }
}

class FakeInFlightEvidenceClient extends EventEmitter {
  static latest = null;

  constructor(options) {
    super();
    this.options = options;
    this.replyCalls = [];
    FakeInFlightEvidenceClient.latest = this;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      queueMicrotask(() => {
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            aibotid: 'p1-012-bot',
            chattype: 'group',
            chatid: 'p1-012-test-group',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-inflight-probe',
            msgtype: 'text',
            text: { content: 'p12' },
          },
        });
        queueMicrotask(() => {
          const transientError = new Error('in-flight evidence failure must not leak this message');
          transientError.code = 'ECONNRESET';
          this.emit('error', transientError);
        });
      });
    });
  }

  disconnect() {}

  async replyStream() {
    this.replyCalls.push(true);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    return { errcode: 0 };
  }
}

class FakePendingReplyProbeClient extends EventEmitter {
  static latest = null;

  constructor(options) {
    super();
    this.options = options;
    this.replyCalls = [];
    FakePendingReplyProbeClient.latest = this;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      queueMicrotask(() => this.emit('message', {
        cmd: 'aibot_msg_callback',
        body: {
          aibotid: 'p1-012-bot',
          chattype: 'group',
          chatid: 'p1-012-test-group',
          from: { userid: 'p1-012-test-account' },
          msgid: 'p1-012-pending-probe',
          msgtype: 'text',
          text: { content: 'p12' },
        },
      }));
    });
  }

  disconnect() {}

  replyStream() {
    this.replyCalls.push(true);
    return new Promise(() => {});
  }
}

class FakeLateReplyProbeClient extends EventEmitter {
  static latest = null;

  constructor(options) {
    super();
    this.options = options;
    this.replyCalls = [];
    FakeLateReplyProbeClient.latest = this;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      queueMicrotask(() => this.emit('message', {
        cmd: 'aibot_msg_callback',
        body: {
          aibotid: 'p1-012-bot',
          chattype: 'group',
          chatid: 'p1-012-test-group',
          from: { userid: 'p1-012-test-account' },
          msgid: 'p1-012-late-probe',
          msgtype: 'text',
          text: { content: 'p12' },
        },
      }));
    });
  }

  disconnect() {
    setTimeout(() => this.emit('authenticated'), 1);
  }

  async replyStream() {
    this.replyCalls.push(true);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    return { errcode: 0 };
  }
}

class FakeCompetingCaptureClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      const transientError = new Error('capture evidence failure must not leak this message');
      transientError.code = 'ECONNRESET';
      this.emit('error', transientError);
      setTimeout(() => this.emit('message', {
        cmd: 'aibot_msg_callback',
        body: {
          chattype: 'group',
          chatid: 'should-not-be-captured',
          from: { userid: 'p1-012-test-account' },
          msgid: 'p1-012-racing-capture',
          msgtype: 'text',
          text: { content: 'p1-012-capture-token' },
        },
      }), 10);
    });
  }

  disconnect() {}
}

class FakeInFlightCaptureClient extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
  }

  connect() {
    queueMicrotask(() => {
      this.emit('authenticated');
      queueMicrotask(() => {
        this.emit('message', {
          cmd: 'aibot_msg_callback',
          body: {
            chattype: 'group',
            chatid: 'captured-during-inflight-failure',
            from: { userid: 'p1-012-test-account' },
            msgid: 'p1-012-inflight-capture',
            msgtype: 'text',
            text: { content: 'p1-012-capture-token' },
          },
        });
        queueMicrotask(() => {
          const transientError = new Error('in-flight capture evidence failure must not leak this message');
          transientError.code = 'ECONNRESET';
          this.emit('error', transientError);
        });
      });
    });
  }

  disconnect() {}
}

class FakePendingCaptureClient extends EventEmitter {
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
          chatid: 'captured-pending-operation',
          from: { userid: 'p1-012-test-account' },
          msgid: 'p1-012-pending-capture',
          msgtype: 'text',
          text: { content: 'p1-012-capture-token' },
        },
      }));
    });
  }

  disconnect() {}
}

test('P1-012 accepts only an explicit check or approved live scenario', () => {
  assert.deepEqual(parseP1_012LiveArgs([]), { mode: 'check' });
  assert.deepEqual(parseP1_012LiveArgs(['--check']), { mode: 'check' });
  assert.deepEqual(
    parseP1_012LiveArgs(['--live', '--scenario=group-text', '--trigger-token=p1-012-run', '--timeout-ms=120000']),
    { mode: 'live', scenario: 'GROUP_TEXT', triggerToken: 'p1-012-run', timeoutMs: 120_000 },
  );
  assert.deepEqual(
    parseP1_012LiveArgs(['--live', '--scenario=group-reply-probe', '--trigger-token=p12']),
    { mode: 'live', scenario: 'GROUP_REPLY_PROBE', triggerToken: 'p12', timeoutMs: 120_000 },
  );
  assert.deepEqual(
    parseP1_012LiveArgs([
      '--live',
      '--scenario=reconnect-group-text',
      '--trigger-token=p1-012-reconnect-text-token',
    ]),
    {
      mode: 'live',
      scenario: 'RECONNECT_GROUP_TEXT',
      triggerToken: 'p1-012-reconnect-text-token',
      timeoutMs: 120_000,
    },
  );
  assert.deepEqual(
    parseP1_012LiveArgs(['--capture-test-group-id', '--apply', '--trigger-token=p1-012-capture-token']),
    { mode: 'capture_group_id', triggerToken: 'p1-012-capture-token', timeoutMs: 120_000 },
  );
  assert.deepEqual(
    parseP1_012LiveArgs(['--record-client-observation=VISIBLE', '--scenario=group-reply-probe']),
    { mode: 'client_observation', scenario: 'GROUP_REPLY_PROBE', observation: 'VISIBLE' },
  );
  assert.deepEqual(
    parseP1_012LiveArgs(['--record-client-observation=VISIBLE', '--scenario=group-text']),
    { mode: 'client_observation', scenario: 'GROUP_TEXT', observation: 'VISIBLE' },
  );
  assert.deepEqual(
    parseP1_012LiveArgs(['--record-shared-delivery-reconciliation']),
    { mode: 'shared_delivery_reconciliation' },
  );
  assert.deepEqual(
    parseP1_012LiveArgs(['--live', '--scenario=group-burst-100', '--trigger-token=P1012-BURST-TEST']),
    { mode: 'live', scenario: 'GROUP_BURST_100', triggerToken: 'P1012-BURST-TEST', timeoutMs: 120_000 },
  );
  assert.deepEqual(
    parseP1_012LiveArgs([
      '--recover-stale-reply-probe-claim',
      '--apply',
      '--stale-claim-min-age-ms=60000',
    ]),
    { mode: 'recover_reply_probe_evidence_claim', scenario: 'GROUP_REPLY_PROBE', staleClaimMinAgeMs: 60_000 },
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--live', '--scenario=group-text']),
    /P1_012_LIVE_ARGS/u,
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--live', '--scenario=group-image-degraded', '--trigger-token=p1-012-run', '--verbose']),
    /P1_012_LIVE_ARGS/u,
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--live', '--scenario=group-text', '--trigger-token=p12']),
    /P1_012_LIVE_ARGS/u,
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--capture-test-group-id', '--apply', '--trigger-token=p12']),
    /P1_012_LIVE_ARGS/u,
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--record-client-observation=VISIBLE', '--scenario=group-image-degraded']),
    /P1_012_LIVE_ARGS/u,
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--record-client-observation=NOT_VISIBLE', '--scenario=group-reply-probe']),
    /P1_012_LIVE_ARGS/u,
  );
  assert.throws(
    () => parseP1_012LiveArgs(['--recover-stale-reply-probe-claim', '--apply']),
    /P1_012_LIVE_ARGS/u,
  );
});

test('P1-012 recovers only an explicitly approved, stale, terminated-local reply-probe evidence claim and audits it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-recover-reply-probe-claim-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const now = 1_000_000;
  const claimKey = createHmac('sha256', 'p1-012-log-hash-key')
    .update(`GROUP_REPLY_PROBE:${resolve(outputPath)}`)
    .digest('hex')
    .slice(0, 32);
  const claimPath = join(claimDirectory, `${claimKey}.claim`);
  const staleClaim = {
    schema: 'P1_012_CLAIM_V1',
    claim_kind: 'REPLY_PROBE_EVIDENCE_CHAIN',
    owner_id: '123e4567-e89b-12d3-a456-426614174000',
    owner_pid: 54321,
    owner_hostname: 'p1-012-local-test-host',
    created_at_ms: now - 120_000,
  };
  const options = parseP1_012LiveArgs([
    '--recover-stale-reply-probe-claim',
    '--apply',
    '--stale-claim-min-age-ms=60000',
  ]);
  const lstatClaim = async () => ({ mtimeMs: now - 120_000, isSymbolicLink: () => false });
  try {
    await mkdir(claimDirectory, { recursive: true });
    await writeFile(claimPath, JSON.stringify(staleClaim), 'utf8');
    await assert.rejects(
      () => runP1_012ReplyProbeEvidenceChainRecovery({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
        now: () => now,
        hostnameForClaim: () => staleClaim.owner_hostname,
        isProcessAlive: () => false,
        lstatClaim,
      }),
      /P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_APPROVAL_REQUIRED/u,
    );
    assert.equal(await readFile(claimPath, 'utf8'), JSON.stringify(staleClaim));

    const records = [];
    assert.deepEqual(
      await runP1_012ReplyProbeEvidenceChainRecovery({
        env: liveEnvironment({
          P1_012_LIVE_TEST_APPROVED: 'true',
          P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED: 'true',
        }),
        options,
        outputPath,
        claimDirectory,
        now: () => now,
        hostnameForClaim: () => staleClaim.owner_hostname,
        isProcessAlive: () => false,
        lstatClaim,
        appendEvidenceRecord: async (_path, record) => { records.push(record); },
      }),
      { ok: true, scenario: 'GROUP_REPLY_PROBE', stale_claim_recovered: true },
    );
    await assert.rejects(() => readFile(claimPath, 'utf8'), { code: 'ENOENT' });
    assert.deepEqual(records, [
      {
        test_id: 'P1-012',
        event: 'p1_012_reply_probe_evidence_claim_quarantined',
        phase: 'P1',
        environment: 'development',
        public_listener_required: false,
        ai_triage_enabled: false,
        ocr_enabled: false,
        hospital_tickets_enabled: false,
        scenario: 'GROUP_REPLY_PROBE',
        recovery: {
          action: 'STALE_CLAIM_QUARANTINED',
          claim_key_hash: claimKey,
          stale_age_ms: 120_000,
          owner_state: 'LOCAL_PROCESS_NOT_RUNNING',
        },
      },
      {
        test_id: 'P1-012',
        event: 'p1_012_reply_probe_evidence_claim_recovered',
        phase: 'P1',
        environment: 'development',
        public_listener_required: false,
        ai_triage_enabled: false,
        ocr_enabled: false,
        hospital_tickets_enabled: false,
        scenario: 'GROUP_REPLY_PROBE',
        recovery: {
          action: 'STALE_CLAIM_REMOVED',
          claim_key_hash: claimKey,
          stale_age_ms: 120_000,
          owner_state: 'LOCAL_PROCESS_NOT_RUNNING',
        },
      },
    ]);

    await writeFile(claimPath, JSON.stringify(staleClaim), 'utf8');
    await assert.rejects(
      () => runP1_012ReplyProbeEvidenceChainRecovery({
        env: liveEnvironment({
          P1_012_LIVE_TEST_APPROVED: 'true',
          P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED: 'true',
        }),
        options,
        outputPath,
        claimDirectory,
        now: () => now,
        hostnameForClaim: () => staleClaim.owner_hostname,
        isProcessAlive: () => true,
        lstatClaim,
        appendEvidenceRecord: async () => assert.fail('an active claim must not be audited as recovered'),
      }),
      /P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_OWNER_ACTIVE/u,
    );
    assert.equal(await readFile(claimPath, 'utf8'), JSON.stringify(staleClaim));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 restores the stale claim and releases the recovery guard if its recovery audit cannot append', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-recovery-audit-failure-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const now = 2_000_000;
  const claimKey = createHmac('sha256', 'p1-012-log-hash-key')
    .update(`GROUP_REPLY_PROBE:${resolve(outputPath)}`)
    .digest('hex')
    .slice(0, 32);
  const claimPath = join(claimDirectory, `${claimKey}.claim`);
  const staleClaim = {
    schema: 'P1_012_CLAIM_V1',
    claim_kind: 'REPLY_PROBE_EVIDENCE_CHAIN',
    owner_id: '123e4567-e89b-12d3-a456-426614174001',
    owner_pid: 54322,
    owner_hostname: hostname(),
    created_at_ms: now - 120_000,
  };
  const options = parseP1_012LiveArgs([
    '--recover-stale-reply-probe-claim',
    '--apply',
    '--stale-claim-min-age-ms=60000',
  ]);
  try {
    await mkdir(claimDirectory, { recursive: true });
    await writeFile(claimPath, JSON.stringify(staleClaim), 'utf8');
    await assert.rejects(
      () => runP1_012ReplyProbeEvidenceChainRecovery({
        env: liveEnvironment({
          P1_012_LIVE_TEST_APPROVED: 'true',
          P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED: 'true',
        }),
        options,
        outputPath,
        claimDirectory,
        now: () => now,
        hostnameForClaim: () => staleClaim.owner_hostname,
        isProcessAlive: () => false,
        lstatClaim: async () => ({ mtimeMs: now - 120_000, isSymbolicLink: () => false }),
        appendEvidenceRecord: async () => { throw new Error('synthetic audit write failure'); },
      }),
      /P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_AUDIT_FAILED/u,
    );
    assert.equal(await readFile(claimPath, 'utf8'), JSON.stringify(staleClaim));
    assert.deepEqual(await readdir(claimDirectory), [`${claimKey}.claim`]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 retains a truthful quarantine audit and blocks replies when quarantine cleanup fails, then resumes safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-recovery-cleanup-failure-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const now = 4_000_000;
  const claimKey = createHmac('sha256', 'p1-012-log-hash-key')
    .update(`GROUP_REPLY_PROBE:${resolve(outputPath)}`)
    .digest('hex')
    .slice(0, 32);
  const claimPath = join(claimDirectory, `${claimKey}.claim`);
  const staleClaim = {
    schema: 'P1_012_CLAIM_V1',
    claim_kind: 'REPLY_PROBE_EVIDENCE_CHAIN',
    owner_id: '123e4567-e89b-12d3-a456-426614174003',
    owner_pid: 54324,
    owner_hostname: hostname(),
    created_at_ms: now - 120_000,
  };
  const recoveryOptions = parseP1_012LiveArgs([
    '--recover-stale-reply-probe-claim',
    '--apply',
    '--stale-claim-min-age-ms=60000',
  ]);
  const liveOptions = parseP1_012LiveArgs([
    '--live',
    '--scenario=group-reply-probe',
    '--trigger-token=p12',
  ]);
  const records = [];
  const approvedEnvironment = liveEnvironment({
    P1_012_LIVE_TEST_APPROVED: 'true',
    P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED: 'true',
  });
  try {
    await mkdir(claimDirectory, { recursive: true });
    await writeFile(claimPath, JSON.stringify(staleClaim), 'utf8');
    await assert.rejects(
      () => runP1_012ReplyProbeEvidenceChainRecovery({
        env: approvedEnvironment,
        options: recoveryOptions,
        outputPath,
        claimDirectory,
        now: () => now,
        hostnameForClaim: hostname,
        isProcessAlive: () => false,
        lstatClaim: async () => ({ mtimeMs: now - 120_000, isSymbolicLink: () => false }),
        appendEvidenceRecord: async (_path, record) => { records.push(record); },
        unlinkClaim: async () => { throw new Error('synthetic quarantine cleanup failure'); },
      }),
      /P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_QUARANTINE_CLEANUP_FAILED/u,
    );
    assert.deepEqual(records.map((record) => record.event), [
      'p1_012_reply_probe_evidence_claim_quarantined',
    ]);
    assert.equal(records.some((record) => record.event === 'p1_012_reply_probe_evidence_claim_recovered'), false);
    const retainedMarkers = await readdir(claimDirectory);
    assert.equal(retainedMarkers.some((fileName) => fileName.startsWith(`.${claimKey}.claim.quarantine-`)), true);
    assert.equal(retainedMarkers.includes(`.${claimKey}.claim.recovery`), true);

    assert.deepEqual(
      await runP1_012LiveE2E({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options: liveOptions,
        Client: FakeReplyProbeClient,
        PoolClass: ProhibitedPool,
        outputPath,
        claimDirectory,
      }),
      { ok: false, error_code: 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS' },
    );
    assert.equal(FakeReplyProbeClient.latest.replyCalls.length, 0);

    const futureNow = Date.now() + 120_000;
    await assert.deepEqual(
      await runP1_012ReplyProbeEvidenceChainRecovery({
        env: approvedEnvironment,
        options: recoveryOptions,
        outputPath,
        claimDirectory,
        now: () => futureNow,
        hostnameForClaim: hostname,
        isProcessAlive: () => false,
        lstatClaim: async (path) => {
          if (path === claimPath) {
            const error = new Error('active claim was already quarantined');
            error.code = 'ENOENT';
            throw error;
          }
          return { mtimeMs: futureNow - 120_000, isSymbolicLink: () => false };
        },
        lstatGuard: async (path) => {
          if (path.endsWith('.recovery')) {
            return { mtimeMs: futureNow - 120_000, isSymbolicLink: () => false };
          }
          const error = new Error('missing future takeover target');
          error.code = 'ENOENT';
          throw error;
        },
        appendEvidenceRecord: async (_path, record) => { records.push(record); },
      }),
      { ok: true, scenario: 'GROUP_REPLY_PROBE', stale_claim_recovered: true },
    );
    assert.deepEqual(records.map((record) => record.event), [
      'p1_012_reply_probe_evidence_claim_quarantined',
      'p1_012_reply_probe_evidence_claim_quarantined',
      'p1_012_reply_probe_evidence_claim_recovered',
    ]);
    assert.equal(records.at(-1).recovery.action, 'STALE_CLAIM_REMOVED');
    assert.equal(records.at(-1).recovery.resumed, true);
    assert.deepEqual(await readdir(claimDirectory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 atomically takes over a stale recovery guard while a live reply and second recovery remain blocked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-stale-recovery-guard-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const now = Date.now();
  const claimKey = createHmac('sha256', 'p1-012-log-hash-key')
    .update(`GROUP_REPLY_PROBE:${resolve(outputPath)}`)
    .digest('hex')
    .slice(0, 32);
  const claimPath = join(claimDirectory, `${claimKey}.claim`);
  const guardPath = join(claimDirectory, `.${claimKey}.claim.recovery`);
  const staleClaim = {
    schema: 'P1_012_CLAIM_V1',
    claim_kind: 'REPLY_PROBE_EVIDENCE_CHAIN',
    owner_id: '123e4567-e89b-12d3-a456-426614174004',
    owner_pid: 54325,
    owner_hostname: hostname(),
    created_at_ms: now - 120_000,
  };
  const staleRecoveryGuard = {
    schema: 'P1_012_CLAIM_V1',
    claim_kind: 'REPLY_PROBE_EVIDENCE_RECOVERY',
    owner_id: '123e4567-e89b-12d3-a456-426614174005',
    owner_pid: 54326,
    owner_hostname: hostname(),
    created_at_ms: now - 120_000,
  };
  const recoveryOptions = parseP1_012LiveArgs([
    '--recover-stale-reply-probe-claim',
    '--apply',
    '--stale-claim-min-age-ms=60000',
  ]);
  const liveOptions = parseP1_012LiveArgs([
    '--live',
    '--scenario=group-reply-probe',
    '--trigger-token=p12',
  ]);
  const approvedEnvironment = liveEnvironment({
    P1_012_LIVE_TEST_APPROVED: 'true',
    P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED: 'true',
  });
  let releaseAudit;
  const auditReleased = new Promise((resolveAudit) => { releaseAudit = resolveAudit; });
  let signalAuditStarted;
  const auditStarted = new Promise((resolveStarted) => { signalAuditStarted = resolveStarted; });
  const records = [];
  try {
    await mkdir(claimDirectory, { recursive: true });
    await writeFile(claimPath, JSON.stringify(staleClaim), 'utf8');
    await writeFile(guardPath, JSON.stringify(staleRecoveryGuard), 'utf8');
    const firstRecovery = runP1_012ReplyProbeEvidenceChainRecovery({
      env: approvedEnvironment,
      options: recoveryOptions,
      outputPath,
      claimDirectory,
      now: () => now,
      hostnameForClaim: hostname,
      isProcessAlive: () => false,
      lstatClaim: async () => ({ mtimeMs: now - 120_000, isSymbolicLink: () => false }),
      lstatGuard: async (path) => {
        if (path === guardPath) {
          return { mtimeMs: now - 120_000, isSymbolicLink: () => false };
        }
        const error = new Error('fresh dynamic target is absent');
        error.code = 'ENOENT';
        throw error;
      },
      appendEvidenceRecord: async (_path, record) => {
        records.push(record);
        signalAuditStarted();
        await auditReleased;
      },
    });
    await auditStarted;
    const activeMarkers = await readdir(claimDirectory);
    assert.equal(activeMarkers.includes(`.${claimKey}.claim.recovery`), false);
    assert.equal(
      activeMarkers.some((fileName) => (
        new RegExp(`^\\.${claimKey}\\.claim\\.recovery-takeover-${process.pid}-${now}-[A-Za-z0-9-]+$`, 'u').test(fileName)
      )),
      true,
    );
    await assert.rejects(
      () => runP1_012ReplyProbeEvidenceChainRecovery({
        env: approvedEnvironment,
        options: recoveryOptions,
        outputPath,
        claimDirectory,
        now: () => now,
        hostnameForClaim: hostname,
        isProcessAlive: (processId) => processId === process.pid,
      }),
      /P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS/u,
    );
    assert.deepEqual(
      await runP1_012LiveE2E({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options: liveOptions,
        Client: FakeReplyProbeClient,
        PoolClass: ProhibitedPool,
        outputPath,
        claimDirectory,
      }),
      { ok: false, error_code: 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS' },
    );
    assert.equal(FakeReplyProbeClient.latest.replyCalls.length, 0);
    releaseAudit();
    assert.deepEqual(
      await firstRecovery,
      { ok: true, scenario: 'GROUP_REPLY_PROBE', stale_claim_recovered: true },
    );
    assert.deepEqual(records.map((record) => record.event), [
      'p1_012_reply_probe_evidence_claim_quarantined',
      'p1_012_reply_probe_evidence_claim_recovered',
    ]);
    assert.deepEqual(await readdir(claimDirectory), []);
  } finally {
    releaseAudit?.();
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 leaves multiple quarantine markers fail-closed for operator reconciliation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-multiple-quarantines-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const now = Date.now();
  const claimKey = createHmac('sha256', 'p1-012-log-hash-key')
    .update(`GROUP_REPLY_PROBE:${resolve(outputPath)}`)
    .digest('hex')
    .slice(0, 32);
  const claimPath = join(claimDirectory, `${claimKey}.claim`);
  const guardPath = join(claimDirectory, `.${claimKey}.claim.recovery`);
  const guardOwnerId = '123e4567-e89b-12d3-a456-426614174006';
  const expectedQuarantinePath = join(claimDirectory, `.${claimKey}.claim.quarantine-${guardOwnerId}`);
  const unrelatedQuarantinePath = join(claimDirectory, `.${claimKey}.claim.quarantine-123e4567-e89b-12d3-a456-426614174007`);
  const staleClaim = {
    schema: 'P1_012_CLAIM_V1',
    claim_kind: 'REPLY_PROBE_EVIDENCE_CHAIN',
    owner_id: '123e4567-e89b-12d3-a456-426614174008',
    owner_pid: 54327,
    owner_hostname: hostname(),
    created_at_ms: now - 120_000,
  };
  const staleRecoveryGuard = {
    schema: 'P1_012_CLAIM_V1',
    claim_kind: 'REPLY_PROBE_EVIDENCE_RECOVERY',
    owner_id: guardOwnerId,
    owner_pid: 54328,
    owner_hostname: hostname(),
    created_at_ms: now - 120_000,
  };
  const recoveryOptions = parseP1_012LiveArgs([
    '--recover-stale-reply-probe-claim',
    '--apply',
    '--stale-claim-min-age-ms=60000',
  ]);
  const liveOptions = parseP1_012LiveArgs([
    '--live',
    '--scenario=group-reply-probe',
    '--trigger-token=p12',
  ]);
  try {
    await mkdir(claimDirectory, { recursive: true });
    await Promise.all([
      writeFile(claimPath, JSON.stringify(staleClaim), 'utf8'),
      writeFile(guardPath, JSON.stringify(staleRecoveryGuard), 'utf8'),
      writeFile(expectedQuarantinePath, JSON.stringify(staleClaim), 'utf8'),
      writeFile(unrelatedQuarantinePath, JSON.stringify(staleClaim), 'utf8'),
    ]);
    await assert.rejects(
      () => runP1_012ReplyProbeEvidenceChainRecovery({
        env: liveEnvironment({
          P1_012_LIVE_TEST_APPROVED: 'true',
          P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED: 'true',
        }),
        options: recoveryOptions,
        outputPath,
        claimDirectory,
        now: () => now,
        hostnameForClaim: hostname,
        isProcessAlive: () => false,
        lstatGuard: async (path) => {
          if (path === guardPath) {
            return { mtimeMs: now - 120_000, isSymbolicLink: () => false };
          }
          const error = new Error('fresh dynamic target is absent');
          error.code = 'ENOENT';
          throw error;
        },
        appendEvidenceRecord: async () => assert.fail('ambiguous quarantine state must not be audited as recovered'),
      }),
      /P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED/u,
    );
    assert.deepEqual(
      await runP1_012LiveE2E({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options: liveOptions,
        Client: FakeReplyProbeClient,
        PoolClass: ProhibitedPool,
        outputPath,
        claimDirectory,
      }),
      { ok: false, error_code: 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS' },
    );
    assert.equal(FakeReplyProbeClient.latest.replyCalls.length, 0);
    assert.equal((await readdir(claimDirectory)).length, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 recovery guard blocks concurrent recovery and live reply acquisition until recovery audit completes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-recovery-guard-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const now = 3_000_000;
  const claimKey = createHmac('sha256', 'p1-012-log-hash-key')
    .update(`GROUP_REPLY_PROBE:${resolve(outputPath)}`)
    .digest('hex')
    .slice(0, 32);
  const claimPath = join(claimDirectory, `${claimKey}.claim`);
  const staleClaim = {
    schema: 'P1_012_CLAIM_V1',
    claim_kind: 'REPLY_PROBE_EVIDENCE_CHAIN',
    owner_id: '123e4567-e89b-12d3-a456-426614174002',
    owner_pid: 54323,
    owner_hostname: hostname(),
    created_at_ms: now - 120_000,
  };
  const recoveryOptions = parseP1_012LiveArgs([
    '--recover-stale-reply-probe-claim',
    '--apply',
    '--stale-claim-min-age-ms=60000',
  ]);
  const liveOptions = parseP1_012LiveArgs([
    '--live',
    '--scenario=group-reply-probe',
    '--trigger-token=p12',
  ]);
  let releaseAudit;
  const auditReleased = new Promise((resolveAudit) => { releaseAudit = resolveAudit; });
  let signalAuditStarted;
  const auditStarted = new Promise((resolveStarted) => { signalAuditStarted = resolveStarted; });
  const recoveryConfig = {
    env: liveEnvironment({
      P1_012_LIVE_TEST_APPROVED: 'true',
      P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED: 'true',
    }),
    options: recoveryOptions,
    outputPath,
    claimDirectory,
    now: () => now,
    hostnameForClaim: hostname,
    isProcessAlive: (processId) => processId === staleClaim.owner_pid ? false : true,
    lstatClaim: async () => ({ mtimeMs: now - 120_000, isSymbolicLink: () => false }),
  };
  try {
    await mkdir(claimDirectory, { recursive: true });
    await writeFile(claimPath, JSON.stringify(staleClaim), 'utf8');
    const firstRecovery = runP1_012ReplyProbeEvidenceChainRecovery({
      ...recoveryConfig,
      appendEvidenceRecord: async () => {
        signalAuditStarted();
        await auditReleased;
      },
    });
    await auditStarted;
    await assert.rejects(
      () => runP1_012ReplyProbeEvidenceChainRecovery(recoveryConfig),
      /P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS/u,
    );
    assert.deepEqual(
      await runP1_012LiveE2E({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options: liveOptions,
        Client: FakeReplyProbeClient,
        PoolClass: ProhibitedPool,
        outputPath,
        claimDirectory,
      }),
      { ok: false, error_code: 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS' },
    );
    assert.equal(FakeReplyProbeClient.latest.replyCalls.length, 0);
    releaseAudit();
    assert.deepEqual(
      await firstRecovery,
      { ok: true, scenario: 'GROUP_REPLY_PROBE', stale_claim_recovered: true },
    );
    assert.deepEqual(await readdir(claimDirectory), []);
  } finally {
    releaseAudit?.();
    await rm(directory, { recursive: true, force: true });
  }
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

test('P1-012 uses the Gate-0-verified completed stream shape for a group passive reply', async () => {
  const calls = [];
  const sender = createWeComGroupPassiveReplySender({
    async replyStream(...args) {
      calls.push(args);
      return { errcode: 0 };
    },
  }, { createId: () => 'stream-test-id' });
  const frame = { headers: { req_id: 'p1-012-reply-frame' } };

  assert.deepEqual(
    await sender(frame, { msgtype: 'text', text: { content: 'P1-012 safe reply' } }),
    { errcode: 0 },
  );
  assert.deepEqual(calls, [[frame, 'p1-012-stream-test-id', 'P1-012 safe reply', true]]);
});

test('P1-012 keeps a short reply probe exact-scoped and out of the Pilot database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-reply-probe-'));
  const outputPath = join(directory, 'evidence.jsonl');
  try {
    const result = await runP1_012LiveE2E({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--live',
        '--scenario=group-reply-probe',
        '--trigger-token=p12',
      ]),
      Client: FakeReplyProbeClient,
      PoolClass: ProhibitedPool,
      outputPath,
    });
    assert.deepEqual(result, { ok: true, scenario: 'GROUP_REPLY_PROBE' });
    assert.equal(FakeReplyProbeClient.latest.replyCalls.length, 1);
    const [, streamId, content, finished] = FakeReplyProbeClient.latest.replyCalls[0];
    assert.match(streamId, /^p1-012-/u);
    assert.equal(content, 'P1-012 回执探针已收到。');
    assert.equal(finished, true);
    const evidence = await readFile(outputPath, 'utf8');
    assert.match(evidence, /"exact_token":true/u);
    assert.match(evidence, /"addressing":"WECOM_MENTION_PREFIX"/u);
    assert.match(evidence, /"run_id":"[a-f0-9]{32}"/u);
    assert.match(evidence, /"database_write":false/u);
    assert.equal((evidence.match(/"event":"p1_012_live_message_result"/gu) ?? []).length, 1);
    assert.equal((evidence.match(/"event":"p1_012_reply_probe_callback_observed"/gu) ?? []).length, 7);
    assert.match(evidence, /"bot_scope":"MISMATCHED"/u);
    assert.match(evidence, /"payload_token_match":"CONTAINS_ONLY"/u);
    assert.match(evidence, /"reply_attempted":false/u);
    assert.equal(evidence.includes('p1-012-test-group'), false);
    assert.equal(evidence.includes('p1-012-test-account'), false);
    assert.equal(evidence.includes('p1-012-bot'), false);
    assert.equal(evidence.includes('p1-012-wrong-group'), false);
    assert.equal(evidence.includes('p1-012-wrong-account'), false);
    assert.equal(evidence.includes('p1-012-wrong-bot'), false);
    assert.equal(evidence.includes('@robot p12'), false);
    assert.equal(evidence.includes('p12'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 records a visible client observation only for the latest successful mention reply probe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-client-observation-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const options = parseP1_012LiveArgs([
    '--record-client-observation=VISIBLE',
    '--scenario=group-reply-probe',
  ]);
  const liveOptions = parseP1_012LiveArgs([
    '--live',
    '--scenario=group-reply-probe',
    '--trigger-token=p12',
  ]);
  const legacySource = {
    test_id: 'P1-012',
    event: 'p1_012_live_message_result',
    scenario: 'GROUP_REPLY_PROBE',
    probe: {
      exact_token: true,
      addressing: 'WECOM_MENTION_PREFIX',
      database_write: false,
    },
    passive_reply: {
      operation: 'aibot_respond_msg_stream',
      acknowledged: true,
      outcome: 'ACKED',
    },
  };
  try {
    await assert.rejects(
      () => runP1_012ClientObservation({ env: liveEnvironment(), options, outputPath, claimDirectory }),
      /P1_012_LIVE_APPROVAL_REQUIRED/u,
    );
    await assert.rejects(
      () => runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      /P1_012_CLIENT_OBSERVATION_SOURCE_MISSING/u,
    );
    await writeFile(outputPath, `${JSON.stringify(legacySource)}\n`, 'utf8');
    await assert.rejects(
      () => runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      /P1_012_CLIENT_OBSERVATION_SOURCE_MISSING/u,
    );
    assert.deepEqual(
      await runP1_012LiveE2E({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options: liveOptions,
        Client: FakeReplyProbeClient,
        PoolClass: ProhibitedPool,
        outputPath,
        createRunId: () => 'probe-run-one',
      }),
      { ok: true, scenario: 'GROUP_REPLY_PROBE' },
    );

    assert.deepEqual(
      await runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      { ok: true, scenario: 'GROUP_REPLY_PROBE', observation: 'VISIBLE' },
    );
    const records = (await readFile(outputPath, 'utf8')).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    const observation = records.at(-1);
    assert.deepEqual(
      observation,
      {
        test_id: 'P1-012',
        event: 'p1_012_client_display_observed',
        phase: 'P1',
        environment: 'development',
        public_listener_required: false,
        ai_triage_enabled: false,
        ocr_enabled: false,
        hospital_tickets_enabled: false,
        scenario: 'GROUP_REPLY_PROBE',
        source_result_hash: observation.source_result_hash,
        source_addressing: 'WECOM_MENTION_PREFIX',
        provider_reply_acknowledged: true,
        database_write: false,
        observer: 'configured_test_account',
        observation: 'VISIBLE',
      },
    );
    assert.match(observation.source_result_hash, /^[a-f0-9]{32}$/u);
    const evidence = JSON.stringify(observation);
    assert.equal(evidence.includes('p1-012-test-group'), false);
    assert.equal(evidence.includes('p1-012-test-account'), false);
    assert.equal(evidence.includes('p1-012-bot'), false);
    assert.equal(evidence.includes('p12'), false);
    assert.deepEqual(
      await runP1_012LiveE2E({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options: liveOptions,
        Client: FakeReplyProbeClient,
        PoolClass: ProhibitedPool,
        outputPath,
        createRunId: () => 'probe-run-two',
      }),
      { ok: true, scenario: 'GROUP_REPLY_PROBE' },
    );
    assert.deepEqual(
      await runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      { ok: true, scenario: 'GROUP_REPLY_PROBE', observation: 'VISIBLE' },
    );
    const observedRecords = (await readFile(outputPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line))
      .filter((record) => record.event === 'p1_012_client_display_observed');
    assert.equal(observedRecords.length, 2);
    assert.notEqual(observedRecords[0].source_result_hash, observedRecords[1].source_result_hash);
    const sourceRunIds = (await readFile(outputPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line))
      .filter((record) => record.event === 'p1_012_live_message_result' && typeof record.probe?.run_id === 'string')
      .map((record) => record.probe.run_id);
    assert.equal(sourceRunIds.length, 2);
    assert.match(sourceRunIds[0], /^[a-f0-9]{32}$/u);
    assert.match(sourceRunIds[1], /^[a-f0-9]{32}$/u);
    assert.notEqual(sourceRunIds[0], sourceRunIds[1]);
    const totalBeforeDuplicate = (await readFile(outputPath, 'utf8')).trim().split(/\r?\n/u).length;
    await assert.rejects(
      () => runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      /P1_012_CLIENT_OBSERVATION_ALREADY_RECORDED/u,
    );
    assert.equal((await readFile(outputPath, 'utf8')).trim().split(/\r?\n/u).length, totalBeforeDuplicate);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 records one HMAC-linked client observation for a successful Ticket-creating group text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-group-text-observation-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const options = parseP1_012LiveArgs([
    '--record-client-observation=VISIBLE',
    '--scenario=group-text',
  ]);
  const source = {
    test_id: 'P1-012',
    event: 'p1_012_live_message_result',
    outcome: 'processed',
    scenario: 'GROUP_TEXT',
    run_id: 'a'.repeat(32),
    core: {
      accepted: true,
      ticket_created: true,
      intake_status: 'TICKET_CREATED',
      within_target: true,
    },
    passive_reply: {
      operation: 'aibot_respond_msg_stream',
      attempted: true,
      acknowledged: true,
      provider_errcode: 0,
      outcome: 'ACKED',
      within_target: true,
    },
    delivery: { attempted: true, status: 'SENT' },
  };
  try {
    await writeFile(outputPath, `${JSON.stringify(source)}\n`, 'utf8');
    assert.deepEqual(
      await runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      { ok: true, scenario: 'GROUP_TEXT', observation: 'VISIBLE' },
    );
    const records = (await readFile(outputPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const observation = records.at(-1);
    assert.deepEqual(observation, {
      test_id: 'P1-012',
      event: 'p1_012_client_display_observed',
      phase: 'P1',
      environment: 'development',
      public_listener_required: false,
      ai_triage_enabled: false,
      ocr_enabled: false,
      hospital_tickets_enabled: false,
      scenario: 'GROUP_TEXT',
      source_result_hash: observation.source_result_hash,
      provider_reply_acknowledged: true,
      database_write: true,
      ticket_created: true,
      intake_status: 'TICKET_CREATED',
      observer: 'configured_test_account',
      observation: 'VISIBLE',
    });
    assert.match(observation.source_result_hash, /^[a-f0-9]{32}$/u);
    assert.equal(JSON.stringify(observation).includes('a'.repeat(32)), false);
    await assert.rejects(
      () => runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      /P1_012_CLIENT_OBSERVATION_ALREADY_RECORDED/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 reconciles the exact synthetic shared Delivery footprint without mutating database facts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-delivery-reconciliation-'));
  const outputPath = join(directory, 'evidence.jsonl');
  class ReconciliationPool {
    constructor(options) {
      assert.equal(options.max, 1);
      this.ended = false;
    }

    async query(sql) {
      assert.match(sql, /delivery\.provider_message_id LIKE 'ack-%'/u);
      assert.match(sql, /inbox\.provider = 'WECOM_AIBOT'/u);
      return {
        rows: [{
          delivery_count: 2,
          ticket_count: 1,
          attempt_count: 3,
          retry_attempts: 1,
          synthetic_sent_attempts: 2,
          pilot_team_deliveries: 1,
          wecom_direct_deliveries: 1,
          sent_deliveries: 2,
        }],
      };
    }

    async end() {
      this.ended = true;
    }
  }
  try {
    assert.deepEqual(
      await runP1_012SharedDeliveryReconciliation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options: parseP1_012LiveArgs(['--record-shared-delivery-reconciliation']),
        PoolClass: ReconciliationPool,
        outputPath,
      }),
      { ok: true, reconciliation_status: 'IDENTIFIED_AND_EXCLUDED' },
    );
    const records = (await readFile(outputPath, 'utf8')).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      test_id: 'P1-012',
      event: 'p1_012_shared_delivery_reconciled',
      phase: 'P1',
      environment: 'development',
      public_listener_required: false,
      ai_triage_enabled: false,
      ocr_enabled: false,
      hospital_tickets_enabled: false,
      scenario: 'SHARED_DELIVERY_RECONCILIATION',
      database_mutation: false,
      synthetic_signature: 'ACK_PREFIX',
      delivery_count: 2,
      ticket_count: 1,
      attempt_count: 3,
      retry_attempts: 1,
      synthetic_sent_attempts: 2,
      channels: { pilot_team: 1, wecom_direct: 1 },
      audit_history_preserved: true,
      excluded_from_real_wecom_delivery_evidence: true,
      reconciliation_status: 'IDENTIFIED_AND_EXCLUDED',
    });
    assert.equal(JSON.stringify(records).includes('database-secret'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 serializes concurrent client observations for one reply-probe source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-client-observation-claim-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const options = parseP1_012LiveArgs([
    '--record-client-observation=VISIBLE',
    '--scenario=group-reply-probe',
  ]);
  const source = {
    test_id: 'P1-012',
    event: 'p1_012_live_message_result',
    scenario: 'GROUP_REPLY_PROBE',
    probe: {
      exact_token: true,
      addressing: 'WECOM_MENTION_PREFIX',
      run_id: 'c'.repeat(32),
      database_write: false,
    },
    passive_reply: {
      operation: 'aibot_respond_msg_stream',
      acknowledged: true,
      outcome: 'ACKED',
    },
  };
  let releaseAppend;
  const appendReleased = new Promise((resolveAppend) => { releaseAppend = resolveAppend; });
  let signalAppendStarted;
  const appendStarted = new Promise((resolveStarted) => { signalAppendStarted = resolveStarted; });
  try {
    await writeFile(outputPath, `${JSON.stringify(source)}\n`, 'utf8');
    const first = runP1_012ClientObservation({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options,
      outputPath,
      claimDirectory,
      appendEvidenceRecord: async (path, record) => {
        signalAppendStarted();
        await appendReleased;
        await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
      },
    });
    await appendStarted;
    const activeClaimMetadata = await Promise.all(
      (await readdir(claimDirectory)).map(async (fileName) => JSON.parse(await readFile(join(claimDirectory, fileName), 'utf8'))),
    );
    assert.deepEqual(
      activeClaimMetadata.map((metadata) => metadata.claim_kind).sort(),
      ['CLIENT_OBSERVATION', 'REPLY_PROBE_EVIDENCE_CHAIN'],
    );
    for (const metadata of activeClaimMetadata) {
      assert.equal(metadata.schema, 'P1_012_CLAIM_V1');
      assert.match(metadata.owner_id, /^.{1,128}$/u);
      assert.ok(Number.isSafeInteger(metadata.owner_pid));
      assert.match(metadata.owner_hostname, /^.{1,253}$/u);
      assert.ok(Number.isSafeInteger(metadata.created_at_ms));
    }
    await assert.rejects(
      () => runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      /P1_012_CLIENT_OBSERVATION_CLAIM_IN_PROGRESS/u,
    );
    releaseAppend();
    assert.deepEqual(
      await first,
      { ok: true, scenario: 'GROUP_REPLY_PROBE', observation: 'VISIBLE' },
    );
    assert.deepEqual(await readdir(claimDirectory), []);
    await assert.rejects(
      () => runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
      }),
      /P1_012_CLIENT_OBSERVATION_ALREADY_RECORDED/u,
    );
    const observations = (await readFile(outputPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line))
      .filter((record) => record.event === 'p1_012_client_display_observed');
    assert.equal(observations.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 rejects a client observation whose source becomes stale before it claims the evidence chain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-client-observation-stale-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const options = parseP1_012LiveArgs([
    '--record-client-observation=VISIBLE',
    '--scenario=group-reply-probe',
  ]);
  const source = {
    test_id: 'P1-012',
    event: 'p1_012_live_message_result',
    scenario: 'GROUP_REPLY_PROBE',
    probe: {
      exact_token: true,
      addressing: 'WECOM_MENTION_PREFIX',
      run_id: 'd'.repeat(32),
      database_write: false,
    },
    passive_reply: {
      operation: 'aibot_respond_msg_stream',
      acknowledged: true,
      outcome: 'ACKED',
    },
  };
  const laterSource = {
    ...source,
    probe: { ...source.probe, run_id: 'e'.repeat(32) },
  };
  let reads = 0;
  try {
    await assert.rejects(
      () => runP1_012ClientObservation({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options,
        outputPath,
        claimDirectory,
        readRecords: async () => {
          reads += 1;
          return reads === 1 ? [source] : [source, laterSource];
        },
        appendEvidenceRecord: async () => assert.fail('a stale source must never be appended'),
      }),
      /P1_012_CLIENT_OBSERVATION_SOURCE_STALE/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 rejects a later reply probe before passive reply while client observation holds the evidence chain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-reply-probe-evidence-chain-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const observationOptions = parseP1_012LiveArgs([
    '--record-client-observation=VISIBLE',
    '--scenario=group-reply-probe',
  ]);
  const liveOptions = parseP1_012LiveArgs([
    '--live',
    '--scenario=group-reply-probe',
    '--trigger-token=p12',
  ]);
  const source = {
    test_id: 'P1-012',
    event: 'p1_012_live_message_result',
    scenario: 'GROUP_REPLY_PROBE',
    probe: {
      exact_token: true,
      addressing: 'WECOM_MENTION_PREFIX',
      run_id: 'f'.repeat(32),
      database_write: false,
    },
    passive_reply: {
      operation: 'aibot_respond_msg_stream',
      acknowledged: true,
      outcome: 'ACKED',
    },
  };
  let releaseAppend;
  const appendReleased = new Promise((resolveAppend) => { releaseAppend = resolveAppend; });
  let signalAppendStarted;
  const appendStarted = new Promise((resolveStarted) => { signalAppendStarted = resolveStarted; });
  try {
    await writeFile(outputPath, `${JSON.stringify(source)}\n`, 'utf8');
    const observation = runP1_012ClientObservation({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options: observationOptions,
      outputPath,
      claimDirectory,
      appendEvidenceRecord: async (path, record) => {
        signalAppendStarted();
        await appendReleased;
        await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
      },
    });
    await appendStarted;
    assert.deepEqual(
      await runP1_012LiveE2E({
        env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
        options: liveOptions,
        Client: FakeReplyProbeClient,
        PoolClass: ProhibitedPool,
        outputPath,
        claimDirectory,
        createRunId: () => 'blocked-later-reply-probe',
      }),
      { ok: false, error_code: 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS' },
    );
    assert.equal(FakeReplyProbeClient.latest.replyCalls.length, 0);
    releaseAppend();
    assert.deepEqual(
      await observation,
      { ok: true, scenario: 'GROUP_REPLY_PROBE', observation: 'VISIBLE' },
    );
    const records = (await readFile(outputPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.equal(records.filter((record) => record.event === 'p1_012_live_message_result').length, 1);
    assert.equal(records.filter((record) => record.event === 'p1_012_client_display_observed').length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 prevents a reply probe from starting after an earlier evidence failure has won', async () => {
  const writtenEvents = [];
  const result = await runP1_012LiveE2E({
    env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
    options: parseP1_012LiveArgs([
      '--live',
      '--scenario=group-reply-probe',
      '--trigger-token=p12',
    ]),
    Client: FakeCompetingEvidenceClient,
    PoolClass: ProhibitedPool,
    appendEvidenceRecord: async (_outputPath, record) => {
      if (record.event === 'p1_012_wss_error') {
        throw new Error('synthetic evidence write failure must not be recorded');
      }
      writtenEvents.push(record.event);
    },
  });

  assert.deepEqual(result, { ok: false, error_code: 'P1_012_EVIDENCE_WRITE_FAILED' });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  assert.equal(FakeCompetingEvidenceClient.latest.replyCalls.length, 0);
  assert.equal(writtenEvents.includes('p1_012_live_message_result'), false);
  assert.equal(writtenEvents.filter((event) => event === 'p1_012_live_e2e_failed').length, 1);
  assert.equal(JSON.stringify(writtenEvents).includes('synthetic evidence write failure must not be recorded'), false);
});

test('P1-012 records an in-flight reply probe before its deferred terminal failure', async () => {
  const writtenEvents = [];
  const result = await runP1_012LiveE2E({
    env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
    options: parseP1_012LiveArgs([
      '--live',
      '--scenario=group-reply-probe',
      '--trigger-token=p12',
    ]),
    Client: FakeInFlightEvidenceClient,
    PoolClass: ProhibitedPool,
    appendEvidenceRecord: async (_outputPath, record) => {
      if (record.event === 'p1_012_wss_error') {
        throw new Error('synthetic in-flight evidence failure must not be recorded');
      }
      writtenEvents.push(record.event);
    },
  });

  assert.deepEqual(result, { ok: false, error_code: 'P1_012_EVIDENCE_WRITE_FAILED' });
  assert.equal(FakeInFlightEvidenceClient.latest.replyCalls.length, 1);
  assert.equal(writtenEvents.filter((event) => event === 'p1_012_live_message_result').length, 1);
  assert.equal(writtenEvents.filter((event) => event === 'p1_012_live_e2e_failed').length, 1);
  assert.ok(
    writtenEvents.indexOf('p1_012_live_message_result')
      < writtenEvents.indexOf('p1_012_live_e2e_failed'),
  );
  assert.equal(JSON.stringify(writtenEvents).includes('synthetic in-flight evidence failure must not be recorded'), false);
});

test('P1-012 hard-times-out a permanently pending reply probe with an explicit unknown side-effect state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-pending-reply-probe-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const writtenRecords = [];
  try {
    const result = await runP1_012LiveE2E({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--live',
        '--scenario=group-reply-probe',
        '--trigger-token=p12',
      ]),
      Client: FakePendingReplyProbeClient,
      PoolClass: ProhibitedPool,
      outputPath,
      claimDirectory,
      appendEvidenceRecord: async (_outputPath, record) => { writtenRecords.push(record); },
      scheduleTimeout: (callback) => {
        const timer = setInterval(() => {
          if (FakePendingReplyProbeClient.latest?.replyCalls.length === 1) {
            clearInterval(timer);
            callback();
          }
        }, 1);
        return timer;
      },
      cancelTimeout: clearInterval,
    });

    assert.deepEqual(result, { ok: false, error_code: 'P1_012_LIVE_TIMEOUT' });
    assert.equal(FakePendingReplyProbeClient.latest.replyCalls.length, 1);
    assert.deepEqual(
      writtenRecords.find((record) => record.event === 'p1_012_live_e2e_failed'),
      {
        test_id: 'P1-012',
        event: 'p1_012_live_e2e_failed',
        phase: 'P1',
        environment: 'development',
        public_listener_required: false,
        ai_triage_enabled: false,
        ocr_enabled: false,
        hospital_tickets_enabled: false,
        scenario: 'GROUP_REPLY_PROBE',
        error_code: 'P1_012_LIVE_TIMEOUT',
        side_effect_state: 'IN_FLIGHT_UNKNOWN',
      },
    );
    assert.deepEqual(await readdir(claimDirectory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 suppresses a late reply-probe success record after its hard timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-late-reply-probe-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const claimDirectory = join(directory, 'claims');
  const writtenRecords = [];
  try {
    const result = await runP1_012LiveE2E({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--live',
        '--scenario=group-reply-probe',
        '--trigger-token=p12',
      ]),
      Client: FakeLateReplyProbeClient,
      PoolClass: ProhibitedPool,
      outputPath,
      claimDirectory,
      appendEvidenceRecord: async (_outputPath, record) => { writtenRecords.push(record); },
      scheduleTimeout: (callback) => {
        const timer = setInterval(() => {
          if (FakeLateReplyProbeClient.latest?.replyCalls.length === 1) {
            clearInterval(timer);
            callback();
          }
        }, 1);
        return timer;
      },
      cancelTimeout: clearInterval,
    });

    assert.deepEqual(result, { ok: false, error_code: 'P1_012_LIVE_TIMEOUT' });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    assert.equal(FakeLateReplyProbeClient.latest.replyCalls.length, 1);
    assert.equal(writtenRecords.filter((record) => record.event === 'p1_012_live_message_result').length, 0);
    assert.equal(writtenRecords.filter((record) => record.event === 'p1_012_live_e2e_failed').length, 1);
    assert.equal(writtenRecords.filter((record) => record.event === 'p1_012_wss_reauthenticated').length, 0);
    assert.deepEqual(await readdir(claimDirectory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 prevents a failed group-id capture run from updating the local group id', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-failed-group-capture-'));
  const envFilePath = join(directory, '.env.pilot');
  await writeFile(envFilePath, 'PILOT_TEST_GROUP_ID=preserve-this-value\n', 'utf8');
  const writtenEvents = [];
  try {
    const result = await runP1_012GroupIdCapture({
      env: liveEnvironment({ P1_012_GROUP_ID_CAPTURE_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--capture-test-group-id',
        '--apply',
        '--trigger-token=p1-012-capture-token',
      ]),
      Client: FakeCompetingCaptureClient,
      envFilePath,
      appendEvidenceRecord: async (_outputPath, record) => {
        if (record.event === 'p1_012_wss_error') {
          throw new Error('synthetic capture evidence write failure must not be recorded');
        }
        writtenEvents.push(record.event);
      },
    });

    assert.deepEqual(result, { ok: false, error_code: 'P1_012_EVIDENCE_WRITE_FAILED' });
    assert.equal(await readFile(envFilePath, 'utf8'), 'PILOT_TEST_GROUP_ID=preserve-this-value\n');
    assert.equal(writtenEvents.includes('p1_012_group_id_capture_applied'), false);
    assert.equal(writtenEvents.filter((event) => event === 'p1_012_group_id_capture_failed').length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 records an in-flight group-id capture before its deferred terminal failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-inflight-group-capture-'));
  const envFilePath = join(directory, '.env.pilot');
  await writeFile(envFilePath, 'PILOT_TEST_GROUP_ID=preserve-this-value\n', 'utf8');
  const writtenRecords = [];
  try {
    const result = await runP1_012GroupIdCapture({
      env: liveEnvironment({ P1_012_GROUP_ID_CAPTURE_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--capture-test-group-id',
        '--apply',
        '--trigger-token=p1-012-capture-token',
      ]),
      Client: FakeInFlightCaptureClient,
      envFilePath,
      appendEvidenceRecord: async (_outputPath, record) => {
        if (record.event === 'p1_012_wss_error') {
          throw new Error('synthetic in-flight capture evidence failure must not be recorded');
        }
        writtenRecords.push(record);
      },
      updateGroupId: async (path, groupId) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        const current = await readFile(path, 'utf8');
        await writeFile(path, current.replace(/^PILOT_TEST_GROUP_ID=.*$/mu, `PILOT_TEST_GROUP_ID=${groupId}`), 'utf8');
        return true;
      },
    });

    assert.deepEqual(result, { ok: false, error_code: 'P1_012_EVIDENCE_WRITE_FAILED' });
    assert.match(await readFile(envFilePath, 'utf8'), /^PILOT_TEST_GROUP_ID=captured-during-inflight-failure$/mu);
    const writtenEvents = writtenRecords.map((record) => record.event);
    assert.equal(writtenEvents.filter((event) => event === 'p1_012_group_id_capture_applied').length, 1);
    assert.equal(writtenEvents.filter((event) => event === 'p1_012_group_id_capture_failed').length, 1);
    assert.ok(
      writtenEvents.indexOf('p1_012_group_id_capture_applied')
        < writtenEvents.indexOf('p1_012_group_id_capture_failed'),
    );
    assert.equal(JSON.stringify(writtenRecords).includes('captured-during-inflight-failure'), false);
    assert.equal(JSON.stringify(writtenRecords).includes('synthetic in-flight capture evidence failure must not be recorded'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 preserves a safe applied-capture audit when its applied evidence append fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-applied-evidence-failure-'));
  const envFilePath = join(directory, '.env.pilot');
  await writeFile(envFilePath, 'PILOT_TEST_GROUP_ID=preserve-this-value\n', 'utf8');
  const writtenRecords = [];
  try {
    const result = await runP1_012GroupIdCapture({
      env: liveEnvironment({ P1_012_GROUP_ID_CAPTURE_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--capture-test-group-id',
        '--apply',
        '--trigger-token=p1-012-capture-token',
      ]),
      Client: FakeGroupCaptureClient,
      envFilePath,
      appendEvidenceRecord: async (_outputPath, record) => {
        if (record.event === 'p1_012_group_id_capture_applied') {
          throw new Error('synthetic applied evidence failure must not be recorded');
        }
        writtenRecords.push(record);
      },
    });

    assert.deepEqual(result, { ok: false, error_code: 'P1_012_EVIDENCE_WRITE_FAILED' });
    assert.match(await readFile(envFilePath, 'utf8'), /^PILOT_TEST_GROUP_ID=captured-p1-012-test-group$/mu);
    assert.equal(writtenRecords.some((record) => record.event === 'p1_012_group_id_capture_applied'), false);
    const failed = writtenRecords.find((record) => record.event === 'p1_012_group_id_capture_failed');
    assert.equal(failed.side_effect_state, 'APPLIED');
    assert.equal(failed.configuration_updated, true);
    assert.match(failed.group_id_hash, /^[a-f0-9]{32}$/u);
    assert.equal(failed.reconciliation_required, undefined);
    assert.equal(JSON.stringify(writtenRecords).includes('captured-p1-012-test-group'), false);
    assert.equal(JSON.stringify(writtenRecords).includes('synthetic applied evidence failure must not be recorded'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 hard-times-out a pending group-id capture and aborts its local update seam', async () => {
  const writtenRecords = [];
  let aborted = false;
  const result = await runP1_012GroupIdCapture({
    env: liveEnvironment({ P1_012_GROUP_ID_CAPTURE_APPROVED: 'true' }),
    options: parseP1_012LiveArgs([
      '--capture-test-group-id',
      '--apply',
      '--trigger-token=p1-012-capture-token',
    ]),
    Client: FakePendingCaptureClient,
    appendEvidenceRecord: async (_outputPath, record) => { writtenRecords.push(record); },
    updateGroupId: async (_path, _groupId, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('synthetic pending update aborted'));
      }, { once: true });
    }),
    scheduleTimeout: (callback) => setTimeout(callback, 1),
    cancelTimeout: clearTimeout,
  });

  assert.deepEqual(result, { ok: false, error_code: 'P1_012_GROUP_ID_CAPTURE_TIMEOUT' });
  assert.equal(aborted, true);
  const failed = writtenRecords.find((record) => record.event === 'p1_012_group_id_capture_failed');
  assert.equal(failed.error_code, 'P1_012_GROUP_ID_CAPTURE_TIMEOUT');
  assert.equal(failed.side_effect_state, 'IN_FLIGHT_UNKNOWN');
  assert.equal(failed.reconciliation_required, true);
  assert.match(failed.group_id_hash, /^[a-f0-9]{32}$/u);
});

test('P1-012 leaves a late non-cooperative capture update as reconcilable unknown without a late applied record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-late-group-capture-'));
  const envFilePath = join(directory, '.env.pilot');
  await writeFile(envFilePath, 'PILOT_TEST_GROUP_ID=preserve-this-value\n', 'utf8');
  const writtenRecords = [];
  let finishLateUpdate;
  const lateUpdateFinished = new Promise((resolveFinished) => { finishLateUpdate = resolveFinished; });
  try {
    const result = await runP1_012GroupIdCapture({
      env: liveEnvironment({ P1_012_GROUP_ID_CAPTURE_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--capture-test-group-id',
        '--apply',
        '--trigger-token=p1-012-capture-token',
      ]),
      Client: FakePendingCaptureClient,
      envFilePath,
      appendEvidenceRecord: async (_outputPath, record) => { writtenRecords.push(record); },
      updateGroupId: async (path, groupId) => {
        try {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
          const current = await readFile(path, 'utf8');
          await writeFile(path, current.replace(/^PILOT_TEST_GROUP_ID=.*$/mu, `PILOT_TEST_GROUP_ID=${groupId}`), 'utf8');
          return true;
        } finally {
          finishLateUpdate();
        }
      },
      scheduleTimeout: (callback) => setTimeout(callback, 1),
      cancelTimeout: clearTimeout,
    });

    assert.deepEqual(result, { ok: false, error_code: 'P1_012_GROUP_ID_CAPTURE_TIMEOUT' });
    await lateUpdateFinished;
    assert.match(await readFile(envFilePath, 'utf8'), /^PILOT_TEST_GROUP_ID=captured-pending-operation$/mu);
    assert.equal(writtenRecords.some((record) => record.event === 'p1_012_group_id_capture_applied'), false);
    const failed = writtenRecords.find((record) => record.event === 'p1_012_group_id_capture_failed');
    assert.equal(failed.side_effect_state, 'IN_FLIGHT_UNKNOWN');
    assert.equal(failed.reconciliation_required, true);
    assert.match(failed.group_id_hash, /^[a-f0-9]{32}$/u);
    assert.equal(JSON.stringify(writtenRecords).includes('captured-pending-operation'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
    assert.match(evidence, /p1_012_wss_error/u);
    assert.match(evidence, /p1_012_wss_disconnected/u);
    assert.match(evidence, /p1_012_wss_reconnecting/u);
    assert.match(evidence, /p1_012_wss_reauthenticated/u);
    assert.equal(evidence.includes('p1-012-test-group'), false);
    assert.equal(evidence.includes('p1-012-test-account'), false);
    assert.equal(evidence.includes('transient socket error must not be recorded'), false);
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
    assert.match(evidence, /p1_012_wss_error/u);
    assert.match(evidence, /p1_012_group_id_capture_applied/u);
    assert.match(evidence, /group_id_hash/u);
    assert.equal(evidence.includes('captured-p1-012-test-group'), false);
    assert.equal(evidence.includes('p1-012-test-account'), false);
    assert.equal(evidence.includes('capture socket error must not be recorded'), false);
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

test('P1-012 forces reauthentication before accepting one scoped group-text callback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-reconnect-group-text-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const handledFrames = [];
  try {
    const result = await runP1_012LiveE2E({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--live',
        '--scenario=reconnect-group-text',
        '--trigger-token=p1-012-reconnect-text-token',
        '--timeout-ms=10000',
      ]),
      Client: FakeReconnectGroupTextClient,
      PoolClass: FakePool,
      outputPath,
      createHandler: ({ options }) => {
        assert.equal(options.scenario, 'GROUP_TEXT');
        return {
          async handleFrame(frame) {
            handledFrames.push(frame);
            return {
              outcome: 'processed',
              scenario: 'GROUP_TEXT',
              core: { accepted: true, ticket_created: true, intake_status: 'TICKET_CREATED', within_target: true },
              passive_reply: { acknowledged: true, outcome: 'ACKED', within_target: true },
              delivery: { attempted: true, status: 'SENT' },
            };
          },
        };
      },
    });

    assert.deepEqual(result, { ok: true, scenario: 'RECONNECT_GROUP_TEXT' });
    assert.equal(handledFrames.length, 1);
    assert.equal(handledFrames[0].body.msgid, 'p1-012-after-reconnect');
    const records = (await readFile(outputPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const events = records.map((record) => record.event);
    assert.ok(events.indexOf('p1_012_live_e2e_ready') < events.indexOf('p1_012_wss_disconnected'));
    assert.ok(events.indexOf('p1_012_wss_disconnected') < events.indexOf('p1_012_wss_reconnect_requested'));
    assert.ok(events.indexOf('p1_012_wss_reconnect_requested') < events.indexOf('p1_012_wss_reauthenticated'));
    assert.ok(events.indexOf('p1_012_wss_reauthenticated') < events.indexOf('p1_012_post_reconnect_message_ready'));
    assert.ok(events.indexOf('p1_012_post_reconnect_message_ready') < events.indexOf('p1_012_live_message_result'));
    const messageResult = records.find((record) => record.event === 'p1_012_live_message_result');
    assert.equal(messageResult.scenario, 'RECONNECT_GROUP_TEXT');
    assert.equal(messageResult.reconnect.reauthenticated_before_callback, true);
    assert.equal(JSON.stringify(records).includes('p1-012-before-reconnect'), false);
    assert.equal(JSON.stringify(records).includes('p1-012-after-reconnect'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 completes a strictly sequenced 100-message live burst only after database fact reconciliation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-group-burst-'));
  const outputPath = join(directory, 'evidence.jsonl');
  const handledMessageIds = new Set();
  try {
    const result = await runP1_012LiveE2E({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--live',
        '--scenario=group-burst-100',
        '--trigger-token=P1012-BURST-TEST',
      ]),
      Client: FakeGroupBurstClient,
      PoolClass: FakePool,
      outputPath,
      createRunId: () => 'group-burst-run-entropy',
      createHandler: ({ options }) => {
        assert.equal(options.scenario, 'GROUP_TEXT');
        return {
          async handleFrame(frame) {
            handledMessageIds.add(frame.body.msgid);
            return {
              outcome: 'processed',
              scenario: 'GROUP_TEXT',
              core: { accepted: true, ticket_created: true, intake_status: 'TICKET_CREATED', within_target: true },
              passive_reply: { acknowledged: true, outcome: 'ACKED', within_target: true },
              delivery: { attempted: true, status: 'PENDING' },
            };
          },
        };
      },
      verifyBurstFacts: async ({ messageIds }) => {
        assert.equal(messageIds.length, 100);
        assert.equal(new Set(messageIds).size, 100);
        return {
          inbox_count: 100,
          intake_count: 100,
          ticket_count: 100,
          outbox_count: 100,
          delivery_count: 200,
          tickets_with_invalid_outbox_count: 0,
          tickets_with_invalid_delivery_count: 0,
        };
      },
    });

    assert.deepEqual(result, { ok: true, scenario: 'GROUP_BURST_100' });
    assert.equal(handledMessageIds.size, 100);
    const records = (await readFile(outputPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const messageResults = records.filter((record) => (
      record.event === 'p1_012_live_message_result' && record.scenario === 'GROUP_BURST_100'
    ));
    assert.equal(messageResults.length, 100);
    assert.deepEqual(messageResults.map((record) => record.sequence_index).sort((left, right) => left - right),
      Array.from({ length: 100 }, (_, index) => index + 1));
    const burstResult = records.find((record) => record.event === 'p1_012_live_burst_result');
    assert.equal(burstResult.outcome, 'PASSED');
    assert.equal(burstResult.accepted_within_target_count, 100);
    assert.equal(burstResult.zero_lost_tickets, true);
    assert.equal(burstResult.zero_duplicate_tickets, true);
    assert.equal(burstResult.notifications_traceable, true);
    assert.match(burstResult.run_id, /^[a-f0-9]{32}$/u);
    const serialized = JSON.stringify(records);
    assert.equal(serialized.includes('p1-012-burst-message-'), false);
    assert.equal(serialized.includes('P1012-BURST-TEST'), false);
    assert.equal(serialized.includes('group-burst-run-entropy'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-012 burst fails closed when global notification totals mask per-ticket gaps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-012-group-burst-notification-gap-'));
  const outputPath = join(directory, 'evidence.jsonl');
  try {
    const result = await runP1_012LiveE2E({
      env: liveEnvironment({ P1_012_LIVE_TEST_APPROVED: 'true' }),
      options: parseP1_012LiveArgs([
        '--live',
        '--scenario=group-burst-100',
        '--trigger-token=P1012-BURST-TEST',
      ]),
      Client: FakeGroupBurstClient,
      PoolClass: FakePool,
      outputPath,
      createHandler: () => ({
        async handleFrame() {
          return {
            outcome: 'processed',
            scenario: 'GROUP_TEXT',
            core: { accepted: true, ticket_created: true, intake_status: 'TICKET_CREATED', within_target: true },
            passive_reply: { acknowledged: true, outcome: 'ACKED', within_target: true },
            delivery: { attempted: true, status: 'PENDING' },
          };
        },
      }),
      verifyBurstFacts: async () => ({
        inbox_count: 100,
        intake_count: 100,
        ticket_count: 100,
        outbox_count: 100,
        delivery_count: 200,
        // One Ticket has an extra notification while another is missing one, so totals alone look valid.
        tickets_with_invalid_outbox_count: 2,
        tickets_with_invalid_delivery_count: 2,
      }),
    });

    assert.deepEqual(result, { ok: false, error_code: 'P1_012_BURST_ACCEPTANCE_FAILED' });
    const records = (await readFile(outputPath, 'utf8'))
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    const burstResult = records.find((record) => record.event === 'p1_012_live_burst_result');
    assert.equal(burstResult.outcome, 'FAILED');
    assert.equal(burstResult.zero_lost_tickets, true);
    assert.equal(burstResult.zero_duplicate_tickets, true);
    assert.equal(burstResult.notifications_traceable, false);
    assert.equal(burstResult.database.outbox_count, 100);
    assert.equal(burstResult.database.delivery_count, 200);
    assert.equal(burstResult.database.tickets_with_invalid_outbox_count, 2);
    assert.equal(burstResult.database.tickets_with_invalid_delivery_count, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
