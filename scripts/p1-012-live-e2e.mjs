import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';
import { Pool } from 'pg';
import { validatePilotConfig } from '../src/p1-001-pilot-foundation.mjs';
import { createServiceIntakeProcessor } from '../src/p1-004-service-intake.mjs';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createNotificationDeliveryWorker, createNotificationOutbox } from '../src/p1-007-notification-outbox.mjs';
import { createTicketClosureService } from '../src/p1-010-ticket-closure.mjs';
import { createPilotOperationalIntake } from '../src/p1-011-pilot-operations-baseline.mjs';
import { createPilotE2EHandler } from '../src/p1-012-pilot-e2e.mjs';

const TEST_ID = 'P1-012';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_EVIDENCE_PATH = 'evidence/p1-012-live-e2e.jsonl';
const SCENARIOS = Object.freeze({
  'group-text': 'GROUP_TEXT',
  'group-image-degraded': 'GROUP_IMAGE_DEGRADED',
  reconnect: 'RECONNECT',
});

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function nonEmpty(value, code, maximum = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw failure(code);
  }
  return value;
}

function positiveInteger(value, code, minimum, maximum) {
  if (!/^\d+$/u.test(String(value ?? ''))) {
    throw failure(code);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw failure(code);
  }
  return parsed;
}

function safeTriggerToken(value) {
  const token = nonEmpty(value, 'P1_012_LIVE_ARGS', 128);
  if (!/^[A-Za-z0-9_.:-]{6,128}$/u.test(token)) {
    throw failure('P1_012_LIVE_ARGS');
  }
  return token;
}

export function parseP1_012LiveArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--check')) {
    return Object.freeze({ mode: 'check' });
  }
  const captureGroupId = argv.includes('--capture-test-group-id');
  if (captureGroupId) {
    const triggerArgument = argv.find((argument) => argument.startsWith('--trigger-token='));
    const timeoutArgument = argv.find((argument) => argument.startsWith('--timeout-ms='));
    const expectedCount = timeoutArgument ? 4 : 3;
    if (argv.includes('--live') || !argv.includes('--apply') || argv.length !== expectedCount || !triggerArgument) {
      throw failure('P1_012_LIVE_ARGS');
    }
    return Object.freeze({
      mode: 'capture_group_id',
      triggerToken: safeTriggerToken(triggerArgument.slice('--trigger-token='.length)),
      timeoutMs: timeoutArgument
        ? positiveInteger(timeoutArgument.slice('--timeout-ms='.length), 'P1_012_LIVE_ARGS', 10_000, 900_000)
        : DEFAULT_TIMEOUT_MS,
    });
  }
  const live = argv.includes('--live');
  const scenarioArgument = argv.find((argument) => argument.startsWith('--scenario='));
  const triggerArgument = argv.find((argument) => argument.startsWith('--trigger-token='));
  const timeoutArgument = argv.find((argument) => argument.startsWith('--timeout-ms='));
  const expectedCount = timeoutArgument ? 4 : 3;
  if (!live || argv.length !== expectedCount || !scenarioArgument || !triggerArgument) {
    throw failure('P1_012_LIVE_ARGS');
  }
  const scenario = SCENARIOS[scenarioArgument.slice('--scenario='.length)];
  if (!scenario) {
    throw failure('P1_012_LIVE_ARGS');
  }
  const timeoutMs = timeoutArgument
    ? positiveInteger(timeoutArgument.slice('--timeout-ms='.length), 'P1_012_LIVE_ARGS', 10_000, 900_000)
    : DEFAULT_TIMEOUT_MS;
  return Object.freeze({
    mode: 'live',
    scenario,
    triggerToken: safeTriggerToken(triggerArgument.slice('--trigger-token='.length)),
    timeoutMs,
  });
}

function publicSummaryFor(pilot) {
  return Object.freeze({
    phase: 'P1',
    environment: pilot.environment,
    public_listener_required: false,
    ai_triage_enabled: false,
    ocr_enabled: false,
    hospital_tickets_enabled: false,
  });
}

/**
 * Validates only the outbound-WSS Pilot prerequisites. A public inbound HTTP
 * listener is deliberately not a P1-012 requirement.
 */
export function validateP1_012LiveConfig(env = process.env) {
  let pilot;
  try {
    pilot = validatePilotConfig(env);
  } catch {
    throw failure('P1_012_PILOT_CONFIG_INVALID');
  }
  const logIdentityHashKey = nonEmpty(env.PILOT_LOG_IDENTITY_HASH_KEY, 'P1_012_LOG_HASH_KEY_MISSING', 4_096);
  const testAccountUserId = nonEmpty(env.PILOT_TEST_ACCOUNT_USER_ID, 'P1_012_TEST_ACCOUNT_REQUIRED', 128);
  return Object.freeze({
    pilot,
    logIdentityHashKey,
    testAccountUserId,
    public_summary: publicSummaryFor(pilot),
  });
}

/**
 * A wrong or absent group id must not prevent an operator from safely
 * capturing the callback-provided value into the local Pilot configuration.
 */
export function validateP1_012GroupIdCaptureConfig(env = process.env) {
  let pilot;
  try {
    pilot = validatePilotConfig({ ...env, PILOT_TEST_GROUP_ID: 'p1-012-capture-pending' });
  } catch {
    throw failure('P1_012_PILOT_CONFIG_INVALID');
  }
  const logIdentityHashKey = nonEmpty(env.PILOT_LOG_IDENTITY_HASH_KEY, 'P1_012_LOG_HASH_KEY_MISSING', 4_096);
  const testAccountUserId = nonEmpty(env.PILOT_TEST_ACCOUNT_USER_ID, 'P1_012_TEST_ACCOUNT_REQUIRED', 128);
  return Object.freeze({
    pilot,
    logIdentityHashKey,
    testAccountUserId,
    public_summary: publicSummaryFor(pilot),
  });
}

function evidencePath() {
  const root = resolve(process.cwd(), 'evidence');
  const output = resolve(process.cwd(), DEFAULT_EVIDENCE_PATH);
  const relation = relative(root, output);
  if (relation === '' || relation.startsWith('..') || !output.endsWith('.jsonl')) {
    throw failure('P1_012_EVIDENCE_PATH_INVALID');
  }
  return output;
}

async function appendEvidence(output, record) {
  await mkdir(dirname(output), { recursive: true });
  await appendFile(output, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
}

function safeWssErrorCode(error) {
  if (Number.isInteger(error?.errcode)) return 'WECOM_REPLY_REJECTED';
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(error.code)) {
    return error.code;
  }
  return 'WECOM_WSS_FAILED';
}

function safeClientLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function callbackContainsTrigger(frame, triggerToken) {
  const body = frame?.body;
  if (!isRecord(body)) return false;
  if (body.msgtype === 'text') {
    return typeof body.text?.content === 'string' && body.text.content.includes(triggerToken);
  }
  if (body.msgtype === 'mixed') {
    return Array.isArray(body.mixed?.msg_item) && body.mixed.msg_item.some((item) => (
      item?.msgtype === 'text'
      && typeof item.text?.content === 'string'
      && item.text.content.includes(triggerToken)
    ));
  }
  return false;
}

function capturedGroupId(frame, { testAccountUserId, triggerToken }) {
  const body = frame?.body;
  if (frame?.cmd !== 'aibot_msg_callback' || !isRecord(body) || body.chattype !== 'group') return null;
  if (body.from?.userid !== testAccountUserId || !callbackContainsTrigger(frame, triggerToken)) return null;
  if (typeof body.chatid !== 'string' || !/^[^\s#=]{1,128}$/u.test(body.chatid)) return null;
  return body.chatid;
}

function groupIdHash(groupId, logIdentityHashKey) {
  return createHmac('sha256', logIdentityHashKey).update(groupId).digest('hex').slice(0, 32);
}

async function updatePilotTestGroupId(envFilePath, groupId) {
  const current = await readFile(envFilePath, 'utf8');
  const linePattern = /^PILOT_TEST_GROUP_ID=.*$/mu;
  if (!linePattern.test(current)) {
    throw failure('P1_012_GROUP_ID_CONFIG_LINE_MISSING');
  }
  const next = current.replace(linePattern, `PILOT_TEST_GROUP_ID=${groupId}`);
  if (next === current) return false;
  await writeFile(envFilePath, next, { encoding: 'utf8' });
  return true;
}

function createWssClient(Client, config) {
  return new Client({
    botId: config.pilot.wecom.botId,
    secret: config.pilot.wecom.botSecret,
    wsUrl: config.pilot.wecom.wsUrl,
    reconnectInterval: 1_000,
    maxReconnectAttempts: -1,
    logger: safeClientLogger(),
  });
}

export function createWeComDeliverySender(client) {
  return async ({ channel, targetKey }) => {
    if (channel !== 'WECOM_DIRECT') {
      return { ok: false, code: 'P1_012_DELIVERY_CHANNEL_UNMAPPED' };
    }
    try {
      const receipt = await client.sendMessage(targetKey, {
        msgtype: 'text',
        text: { content: 'P1-012 验收通知已提交，请以当前会话中的工单回执为准。' },
      });
      if (receipt?.errcode !== 0) {
        if (!Number.isInteger(receipt?.errcode)) {
          return { ok: false, code: 'WECOM_DELIVERY_ACK_MISSING' };
        }
        return { ok: false, code: 'WECOM_DELIVERY_REJECTED' };
      }
      return { ok: true, providerMessageId: null };
    } catch {
      return { ok: false, code: 'WECOM_DELIVERY_FAILED' };
    }
  };
}

function relationCheck(pool, relations) {
  return async () => {
    const result = await pool.query(
      `SELECT bool_and(to_regclass(required_relation) IS NOT NULL) AS ready
         FROM unnest($1::text[]) AS required(required_relation)`,
      [relations],
    );
    return { ok: result.rows[0]?.ready === true };
  };
}

function createLiveComposition({ pool, client, config, options, writeEvent }) {
  const outbox = createNotificationOutbox();
  const closure = createTicketClosureService({
    pool,
    outbox,
    resolveReporterActor: async () => null,
  });
  const deliveryWorker = createNotificationDeliveryWorker({
    pool,
    sender: createWeComDeliverySender(client),
  });
  const operationalIntake = createPilotOperationalIntake({
    pool,
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
    closure,
    coreChecks: {
      postgres: async () => {
        await pool.query('SELECT 1');
        return { ok: true };
      },
      intake: relationCheck(pool, ['channel.message_inbox', 'intake.service_intake', 'pilot_ticket.ticket']),
      outbox: relationCheck(pool, ['notification.outbox', 'notification.delivery']),
    },
    identityHashKey: config.logIdentityHashKey,
    writeLogRecord: async (record) => writeEvent('security_log_recorded', { record }),
  });
  return createPilotE2EHandler({
    testGroupId: config.pilot.testGroupId,
    testAccountUserIds: [config.testAccountUserId],
    triggerToken: options.triggerToken,
    scenario: options.scenario,
    accept: operationalIntake.accept,
    reply: client.reply.bind(client),
    deliver: deliveryWorker.deliver,
  });
}

function liveApproved(env) {
  return String(env.P1_012_LIVE_TEST_APPROVED ?? '').toLowerCase() === 'true';
}

function groupIdCaptureApproved(env) {
  return String(env.P1_012_GROUP_ID_CAPTURE_APPROVED ?? '').toLowerCase() === 'true';
}

export async function runP1_012LiveE2E({
  env = process.env,
  options,
  Client = AiBot.WSClient,
  PoolClass = Pool,
  outputPath = evidencePath(),
  createHandler = createLiveComposition,
} = {}) {
  if (!options || options.mode !== 'live') {
    throw failure('P1_012_LIVE_ARGS');
  }
  if (!liveApproved(env)) {
    throw failure('P1_012_LIVE_APPROVAL_REQUIRED');
  }
  const config = validateP1_012LiveConfig(env);
  const pool = new PoolClass({
    connectionString: config.pilot.pilotDatabaseUrl,
    max: 4,
    connectionTimeoutMillis: 5_000,
  });
  let client;
  let timer;
  let stopping = false;
  let reconnectExpected = options.scenario === 'RECONNECT';
  let authenticatedCount = 0;
  const completion = new Promise((resolveCompletion) => {
    const finish = async (result) => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      try { client?.disconnect(); } catch {}
      try { await pool.end(); } catch {}
      resolveCompletion(result);
    };
    const writeEvent = async (event, extra = {}) => {
      const record = Object.freeze({ test_id: TEST_ID, event, ...extra });
      await appendEvidence(outputPath, record);
      console.log(JSON.stringify(record));
      return record;
    };
    const fail = async (errorCode) => {
      try {
        await writeEvent('p1_012_live_e2e_failed', {
          ...config.public_summary,
          scenario: options.scenario,
          error_code: errorCode,
        });
      } catch {}
      await finish({ ok: false, error_code: errorCode });
    };
    client = createWssClient(Client, config);
    const handler = options.scenario === 'RECONNECT'
      ? null
      : createHandler({ pool, client, config, options, writeEvent });

    client.on('authenticated', () => {
      void (async () => {
        authenticatedCount += 1;
        await writeEvent(authenticatedCount === 1 ? 'p1_012_live_e2e_ready' : 'p1_012_wss_reauthenticated', {
          ...config.public_summary,
          scenario: options.scenario,
        });
        if (options.scenario !== 'RECONNECT') return;
        if (authenticatedCount === 1) {
          try { client.disconnect(); } catch { await fail('WECOM_DISCONNECT_FAILED'); }
          return;
        }
        await finish({ ok: true, scenario: 'RECONNECT' });
      })().catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('message', (frame) => {
      if (handler === null || stopping) return;
      void (async () => {
        const result = await handler.handleFrame(frame);
        if (result.outcome === 'ignored') return;
        await writeEvent('p1_012_live_message_result', result);
        await finish({
          ok: result.outcome === 'processed' && result.core.accepted === true && result.passive_reply.acknowledged === true,
          scenario: result.scenario,
        });
      })().catch(() => { void fail('P1_012_LIVE_HANDLER_FAILED'); });
    });
    client.on('disconnected', () => {
      if (stopping) return;
      void (async () => {
        await writeEvent('p1_012_wss_disconnected', {
          ...config.public_summary,
          scenario: options.scenario,
        });
        if (reconnectExpected && authenticatedCount === 1) {
          reconnectExpected = false;
          setTimeout(() => {
            try { client.connect(); } catch { void fail('WECOM_RECONNECT_FAILED'); }
          }, 250);
        }
      })().catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('reconnecting', () => {
      if (stopping) return;
      void writeEvent('p1_012_wss_reconnecting', {
        ...config.public_summary,
        scenario: options.scenario,
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('error', (error) => { void fail(safeWssErrorCode(error)); });
    timer = setTimeout(() => { void fail('P1_012_LIVE_TIMEOUT'); }, options.timeoutMs);
    void writeEvent('p1_012_wss_connect_requested', {
      ...config.public_summary,
      scenario: options.scenario,
      timeout_ms: options.timeoutMs,
    }).then(() => {
      try { client.connect(); } catch { void fail('WECOM_CONNECT_THROWN'); }
    }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
  });
  return completion;
}

/**
 * Captures a callback's group id only after an operator has supplied the
 * configured test account and a one-time token. The raw id is written only to
 * the local .env.pilot line; all evidence keeps a keyed hash instead.
 */
export async function runP1_012GroupIdCapture({
  env = process.env,
  options,
  Client = AiBot.WSClient,
  envFilePath = resolve(process.cwd(), '.env.pilot'),
  outputPath = evidencePath(),
} = {}) {
  if (!options || options.mode !== 'capture_group_id') {
    throw failure('P1_012_LIVE_ARGS');
  }
  if (!groupIdCaptureApproved(env)) {
    throw failure('P1_012_GROUP_ID_CAPTURE_APPROVAL_REQUIRED');
  }
  const config = validateP1_012GroupIdCaptureConfig(env);
  let client;
  let timer;
  let stopping = false;
  let authenticatedCount = 0;
  const completion = new Promise((resolveCompletion) => {
    const finish = (result) => {
      if (stopping) return;
      stopping = true;
      clearTimeout(timer);
      try { client?.disconnect(); } catch {}
      resolveCompletion(result);
    };
    const writeEvent = async (event, extra = {}) => {
      const record = Object.freeze({ test_id: TEST_ID, event, ...extra });
      await appendEvidence(outputPath, record);
      console.log(JSON.stringify(record));
      return record;
    };
    const fail = async (errorCode) => {
      try {
        await writeEvent('p1_012_group_id_capture_failed', {
          ...config.public_summary,
          error_code: errorCode,
        });
      } catch {}
      finish({ ok: false, error_code: errorCode });
    };
    client = createWssClient(Client, config);
    client.on('authenticated', () => {
      void writeEvent(authenticatedCount++ === 0 ? 'p1_012_group_id_capture_ready' : 'p1_012_wss_reauthenticated', {
        ...config.public_summary,
        mode: 'capture_group_id',
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('message', (frame) => {
      if (stopping) return;
      void (async () => {
        const groupId = capturedGroupId(frame, {
          testAccountUserId: config.testAccountUserId,
          triggerToken: options.triggerToken,
        });
        if (groupId === null) return;
        const configurationUpdated = await updatePilotTestGroupId(envFilePath, groupId);
        await writeEvent('p1_012_group_id_capture_applied', {
          ...config.public_summary,
          configuration_updated: configurationUpdated,
          group_id_hash: groupIdHash(groupId, config.logIdentityHashKey),
        });
        finish({ ok: true, configuration_updated: configurationUpdated });
      })().catch((error) => { void fail(error?.code ?? 'P1_012_GROUP_ID_CAPTURE_FAILED'); });
    });
    client.on('disconnected', () => {
      if (stopping) return;
      void writeEvent('p1_012_wss_disconnected', {
        ...config.public_summary,
        mode: 'capture_group_id',
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('reconnecting', () => {
      if (stopping) return;
      void writeEvent('p1_012_wss_reconnecting', {
        ...config.public_summary,
        mode: 'capture_group_id',
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('error', (error) => { void fail(safeWssErrorCode(error)); });
    timer = setTimeout(() => { void fail('P1_012_GROUP_ID_CAPTURE_TIMEOUT'); }, options.timeoutMs);
    void writeEvent('p1_012_group_id_capture_connect_requested', {
      ...config.public_summary,
      timeout_ms: options.timeoutMs,
    }).then(() => {
      try { client.connect(); } catch { void fail('WECOM_CONNECT_THROWN'); }
    }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
  });
  return completion;
}

async function main() {
  let options;
  try {
    options = parseP1_012LiveArgs(process.argv.slice(2));
    const config = options.mode === 'capture_group_id'
      ? validateP1_012GroupIdCaptureConfig(process.env)
      : validateP1_012LiveConfig(process.env);
    if (options.mode === 'check') {
      console.log(JSON.stringify({
        test_id: TEST_ID,
        event: 'p1_012_live_e2e_ready',
        mode: 'check',
        ...config.public_summary,
      }));
      return;
    }
  } catch (error) {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'p1_012_live_e2e_configuration_failed', error_code: error?.code ?? 'P1_012_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }
  try {
    const result = options.mode === 'capture_group_id'
      ? await runP1_012GroupIdCapture({ options })
      : await runP1_012LiveE2E({ options });
    if (!result.ok) {
      console.log(JSON.stringify({
        test_id: TEST_ID,
        event: options.mode === 'capture_group_id' ? 'p1_012_group_id_capture_failed' : 'p1_012_live_e2e_failed',
        error_code: result.error_code ?? 'P1_012_LIVE_FAILED',
      }));
      process.exitCode = 2;
    }
  } catch (error) {
    console.log(JSON.stringify({
      test_id: TEST_ID,
      event: options?.mode === 'capture_group_id' ? 'p1_012_group_id_capture_failed' : 'p1_012_live_e2e_failed',
      error_code: error?.code ?? 'P1_012_LIVE_FAILED',
    }));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
