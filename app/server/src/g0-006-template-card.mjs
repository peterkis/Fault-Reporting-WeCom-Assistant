import { appendFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';
import {
  SDK_VERSION,
  classifyError,
  createSafeSdkLogger,
  validateRuntimeConfig,
} from './g0-002-sdk-lifecycle.mjs';

const TEST_ID = 'G0-006';
const MODES = new Set(['fast', 'duplicate', 'late']);
const CHAT_TYPES = new Set(['single', 'group']);
const ACTIONS = new Set(['confirm', 'still_unrecovered']);
const DEFAULT_OUTPUT = 'evidence/g0-006-template-card-captures.jsonl';
const DEFAULT_TIMEOUT_MS = 600_000;
const FIVE_SECONDS_MS = 5_000;
// 平台在真实 update 回执中拒绝 type:0；使用企业微信官方公开主页作为无业务语义的验证跳转。
const VERIFIED_CARD_ACTION = { type: 1, url: 'https://work.weixin.qq.com' };

function hashIdentifier(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function readArgument(argv, name, fallback) {
  const argument = argv.find((item) => item.startsWith(`${name}=`));
  return argument ? argument.slice(name.length + 1) : fallback;
}

function assertIntegerRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`G0_CARD_INVALID_${name}`);
  }
}

function isOutputInsideEvidence(outputPath) {
  const evidenceRoot = resolve(process.cwd(), 'evidence');
  const outputRelativePath = relative(evidenceRoot, outputPath);
  return outputRelativePath.length > 0 && !outputRelativePath.startsWith('..') && !isAbsolute(outputRelativePath);
}

export function parseCardArgs(argv) {
  const mode = readArgument(argv, '--mode', 'fast');
  const chatType = readArgument(argv, '--chat-type', 'single');
  const timeoutMs = Number(readArgument(argv, '--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
  const updateDelayMs = Number(readArgument(argv, '--update-delay-ms', mode === 'late' ? '6000' : '0'));
  const output = readArgument(argv, '--output', DEFAULT_OUTPUT);

  if (!MODES.has(mode)) throw new Error('G0_CARD_INVALID_MODE');
  if (!CHAT_TYPES.has(chatType)) throw new Error('G0_CARD_INVALID_CHAT_TYPE');
  assertIntegerRange(timeoutMs, 'TIMEOUT', 30_000, 900_000);
  assertIntegerRange(updateDelayMs, 'UPDATE_DELAY', 0, 60_000);
  if (mode === 'late' && updateDelayMs <= FIVE_SECONDS_MS) throw new Error('G0_CARD_LATE_DELAY_MUST_EXCEED_FIVE_SECONDS');
  if (mode !== 'late' && updateDelayMs !== 0) throw new Error('G0_CARD_NON_LATE_DELAY_MUST_BE_ZERO');

  const outputPath = resolve(process.cwd(), output);
  if (!isOutputInsideEvidence(outputPath) || !outputPath.endsWith('.jsonl')) {
    throw new Error('G0_CARD_INVALID_OUTPUT');
  }

  return { mode, chatType, timeoutMs, updateDelayMs, outputPath };
}

function providerErrorCode(receiptOrError) {
  return Number.isInteger(receiptOrError?.errcode) ? receiptOrError.errcode : null;
}

function receiptShape(receipt) {
  return {
    cmd: typeof receipt?.cmd === 'string' ? receipt.cmd : null,
    header_field_names: Object.keys(receipt?.headers ?? {}).sort(),
    body_field_names: Object.keys(receipt?.body ?? {}).sort(),
    provider_errcode: providerErrorCode(receipt),
  };
}

export function classifyCardError(error) {
  const message = String(error?.message ?? error?.errmsg ?? error ?? '');
  if (Number.isInteger(error?.errcode)) return 'WECOM_CARD_REJECTED';
  if (/timeout|timed out/i.test(message)) return 'WECOM_CARD_TIMEOUT';
  if (/auth|secret|credential|WS_AUTH_FAILURE/i.test(message)) return 'WECOM_AUTH_FAILED';
  if (/not connected|connection|socket|send/i.test(message)) return 'WECOM_CARD_TRANSPORT_FAILED';
  return 'WECOM_CARD_FAILED';
}

export function buildTemplateCard({ taskId, mode }) {
  return {
    card_type: 'button_interaction',
    main_title: {
      title: 'G0-006 卡片验证',
      desc: mode === 'late' ? '点击后验证超过 5 秒更新' : '请选择验证操作',
    },
    button_list: [
      { text: '确认', key: 'confirm', style: 1 },
      { text: '仍未恢复', key: 'still_unrecovered', style: 2 },
    ],
    task_id: taskId,
  };
}

export function buildUpdatedCard({ taskId, action, duplicate, preserveButtons }) {
  const title = duplicate
    ? '重复点击已识别'
    : action === 'confirm'
      ? '已确认'
      : action === 'still_unrecovered'
        ? '仍未恢复已记录'
        : '未识别操作';
  if (!preserveButtons) {
    return {
      card_type: 'text_notice',
      main_title: { title },
      card_action: VERIFIED_CARD_ACTION,
      task_id: taskId,
    };
  }
  return {
    ...buildTemplateCard({ taskId, mode: 'duplicate' }),
    main_title: { title, desc: '请再次点击相同按钮验证重复事件' },
    card_action: VERIFIED_CARD_ACTION,
  };
}

function safeAction(eventKey) {
  return ACTIONS.has(eventKey) ? eventKey : 'unknown';
}

function extractTemplateCardEvent(body) {
  const eventEnvelope = body?.event;
  if (eventEnvelope && typeof eventEnvelope === 'object'
    && eventEnvelope.template_card_event && typeof eventEnvelope.template_card_event === 'object') {
    return {
      data: eventEnvelope.template_card_event,
      field_path: 'event.template_card_event',
      event_envelope_field_names: Object.keys(eventEnvelope).sort(),
      payload_field_names: Object.keys(eventEnvelope.template_card_event).sort(),
    };
  }
  return {
    data: eventEnvelope && typeof eventEnvelope === 'object' ? eventEnvelope : {},
    field_path: 'event',
    event_envelope_field_names: eventEnvelope && typeof eventEnvelope === 'object' ? Object.keys(eventEnvelope).sort() : [],
    payload_field_names: eventEnvelope && typeof eventEnvelope === 'object' ? Object.keys(eventEnvelope).sort() : [],
  };
}

function baseCapture({ kind, mode, taskId, chatType, fromUserId }) {
  return {
    test_id: TEST_ID,
    schema_version: 1,
    observed_at_utc: new Date().toISOString(),
    kind,
    mode,
    card: {
      task_id_hash: hashIdentifier(taskId),
      raw_task_id_recorded: false,
      card_type: 'button_interaction',
      button_count: 2,
    },
    source: {
      chat_type: chatType ?? null,
      user_identifier_hash: hashIdentifier(fromUserId),
      raw_user_identifier_recorded: false,
    },
    privacy: {
      original_message_recorded: false,
      original_identifier_recorded: false,
      response_url_recorded: false,
      sdk_error_text_recorded: false,
    },
  };
}

function cardDispatchCapture({ mode, taskId, chatType, fromUserId, result, receipt, error }) {
  return {
    ...baseCapture({ kind: 'card_dispatch', mode, taskId, chatType, fromUserId }),
    result: {
      status: result,
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? { error_code: classifyCardError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function cardEventCapture({ mode, taskId, chatType, fromUserId, action, actionClickIndex, duplicate, frame }) {
  return {
    ...baseCapture({ kind: 'card_event', mode, taskId, chatType, fromUserId }),
    event: {
      action,
      action_click_index: actionClickIndex,
      duplicate,
      callback_header_field_names: Object.keys(frame?.headers ?? {}).sort(),
    },
    result: { status: 'received' },
  };
}

function ignoredCardEventCapture({ mode, expectedTaskId, frame }) {
  const body = frame?.body ?? {};
  const extractedEvent = extractTemplateCardEvent(body);
  const eventTaskId = typeof extractedEvent.data.task_id === 'string' ? extractedEvent.data.task_id : null;
  return {
    ...baseCapture({
      kind: 'card_event_ignored',
      mode,
      taskId: expectedTaskId,
      chatType: body.chattype,
      fromUserId: body.from?.userid,
    }),
    callback_shape: {
      body_field_names: Object.keys(body).sort(),
      event_field_path: extractedEvent.field_path,
      event_envelope_field_names: extractedEvent.event_envelope_field_names,
      event_payload_field_names: extractedEvent.payload_field_names,
      event_task_id_present: eventTaskId !== null,
      event_task_id_hash: hashIdentifier(eventTaskId),
      expected_task_id_hash: hashIdentifier(expectedTaskId),
      task_id_matches_expected: eventTaskId === expectedTaskId,
    },
    result: { status: 'ignored_task_id_mismatch_or_missing' },
  };
}

function cardUpdateCapture({ mode, taskId, chatType, fromUserId, action, actionClickIndex, duplicate, invokedAfterEventMs, result, receipt, error }) {
  return {
    ...baseCapture({ kind: 'card_update', mode, taskId, chatType, fromUserId }),
    update: {
      action,
      action_click_index: actionClickIndex,
      duplicate,
      invoked_after_event_ms: invokedAfterEventMs,
      within_five_seconds: invokedAfterEventMs <= FIVE_SECONDS_MS,
    },
    result: {
      status: result,
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? { error_code: classifyCardError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

export async function appendCardCapture(outputPath, capture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(capture)}\n`, { encoding: 'utf8' });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function runCardProbe({
  client,
  options,
  writeCapture,
  writeEvent,
  wait = sleep,
  now = Date.now,
  createTaskId = () => `g0-006-${randomUUID()}`,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let stopping = false;
  let timeout;
  let cardDispatchStarted = false;
  let taskId;
  let completionResolve;
  const clickCounts = new Map();
  const completion = new Promise((resolveCompletion) => {
    completionResolve = resolveCompletion;
  });

  function finish({ ok, exitCode, reason, errorCode }) {
    if (stopping) return;
    stopping = true;
    clearTimeoutFn(timeout);
    writeEvent('disconnect_requested', { reason, ...(errorCode ? { error_code: errorCode } : {}) });
    try {
      client.disconnect();
    } catch {
      // 已有卡片结论不能被断开失败覆盖。
    }
    completionResolve({ ok, exit_code: exitCode, reason, ...(errorCode ? { error_code: errorCode } : {}) });
  }

  async function dispatchCard(frame) {
    const body = frame?.body ?? {};
    const fromUserId = body.from?.userid;
    const chatType = body.chattype;
    taskId = createTaskId();
    const card = buildTemplateCard({ taskId, mode: options.mode });
    writeEvent('card_dispatch_attempted', { mode: options.mode, chat_type: chatType, task_id_hash: hashIdentifier(taskId) });
    try {
      const receipt = await client.replyTemplateCard(frame, card);
      await writeCapture(cardDispatchCapture({
        mode: options.mode,
        taskId,
        chatType,
        fromUserId,
        result: 'acknowledged',
        receipt,
      }));
      writeEvent('card_dispatch_acknowledged', { task_id_hash: hashIdentifier(taskId) });
    } catch (error) {
      const capture = cardDispatchCapture({
        mode: options.mode,
        taskId,
        chatType,
        fromUserId,
        result: 'rejected',
        error,
      });
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'CARD_DISPATCH_REJECTED', errorCode: capture.result.error_code });
    }
  }

  async function updateCard(frame) {
    const body = frame?.body ?? {};
    const extractedEvent = extractTemplateCardEvent(body);
    const event = extractedEvent.data;
    const eventTaskId = event.task_id;
    const fromUserId = body.from?.userid;
    const chatType = body.chattype;
    if (typeof eventTaskId !== 'string' || eventTaskId !== taskId) {
      const capture = ignoredCardEventCapture({ mode: options.mode, expectedTaskId: taskId, frame });
      await writeCapture(capture);
      writeEvent('card_event_ignored', {
        reason: 'TASK_ID_MISMATCH_OR_MISSING',
        body_field_names: capture.callback_shape.body_field_names,
        event_field_path: capture.callback_shape.event_field_path,
        event_envelope_field_names: capture.callback_shape.event_envelope_field_names,
        event_payload_field_names: capture.callback_shape.event_payload_field_names,
        event_task_id_present: capture.callback_shape.event_task_id_present,
        event_task_id_hash: capture.callback_shape.event_task_id_hash,
        expected_task_id_hash: capture.callback_shape.expected_task_id_hash,
      });
      return;
    }

    const action = safeAction(event.event_key);
    const clickFingerprint = `${eventTaskId}\u0000${fromUserId ?? ''}\u0000${action}`;
    const actionClickIndex = (clickCounts.get(clickFingerprint) ?? 0) + 1;
    const duplicate = actionClickIndex > 1;
    clickCounts.set(clickFingerprint, actionClickIndex);
    const eventReceivedAtMs = now();
    await writeCapture(cardEventCapture({
      mode: options.mode,
      taskId,
      chatType,
      fromUserId,
      action,
      actionClickIndex,
      duplicate,
      frame,
    }));
    writeEvent('card_event_received', { action, action_click_index: actionClickIndex, duplicate });

    if (options.updateDelayMs > 0) await wait(options.updateDelayMs);
    const invokedAfterEventMs = Math.max(0, now() - eventReceivedAtMs);
    if (options.mode !== 'late' && invokedAfterEventMs > FIVE_SECONDS_MS) {
      const capture = cardUpdateCapture({
        mode: options.mode,
        taskId,
        chatType,
        fromUserId,
        action,
        actionClickIndex,
        duplicate,
        invokedAfterEventMs,
        result: 'deadline_missed_before_call',
      });
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'FAST_UPDATE_DEADLINE_MISSED', errorCode: 'WECOM_CARD_UPDATE_DEADLINE_MISSED' });
      return;
    }

    const updatedCard = buildUpdatedCard({
      taskId,
      action,
      duplicate,
      preserveButtons: options.mode === 'duplicate',
    });
    writeEvent('card_update_attempted', {
      action,
      action_click_index: actionClickIndex,
      duplicate,
      invoked_after_event_ms: invokedAfterEventMs,
    });
    try {
      const receipt = await client.updateTemplateCard(frame, updatedCard);
      await writeCapture(cardUpdateCapture({
        mode: options.mode,
        taskId,
        chatType,
        fromUserId,
        action,
        actionClickIndex,
        duplicate,
        invokedAfterEventMs,
        result: 'acknowledged',
        receipt,
      }));
      writeEvent('card_update_acknowledged', { action, action_click_index: actionClickIndex, duplicate });
      if (options.mode === 'duplicate' && !duplicate) return;
      finish({
        ok: true,
        exitCode: 0,
        reason: options.mode === 'late' ? 'LATE_UPDATE_ACKNOWLEDGED' : options.mode === 'duplicate' ? 'DUPLICATE_CLICK_UPDATED' : 'FAST_UPDATE_ACKNOWLEDGED',
      });
    } catch (error) {
      const capture = cardUpdateCapture({
        mode: options.mode,
        taskId,
        chatType,
        fromUserId,
        action,
        actionClickIndex,
        duplicate,
        invokedAfterEventMs,
        result: 'rejected',
        error,
      });
      await writeCapture(capture);
      writeEvent('card_update_rejected', { action, action_click_index: actionClickIndex, duplicate, error_code: capture.result.error_code });
      if (options.mode === 'late') {
        finish({ ok: true, exitCode: 0, reason: 'LATE_UPDATE_REJECTED', errorCode: capture.result.error_code });
        return;
      }
      finish({ ok: false, exitCode: 2, reason: 'CARD_UPDATE_REJECTED', errorCode: capture.result.error_code });
    }
  }

  client.on('authenticated', () => {
    writeEvent('card_ready', {
      mode: options.mode,
      chat_type: options.chatType,
      update_delay_ms: options.updateDelayMs,
    });
  });
  client.on('message.text', (frame) => {
    const body = frame?.body ?? {};
    if (stopping || cardDispatchStarted) {
      writeEvent('message_ignored', { reason: stopping ? 'STOPPING' : 'CARD_ALREADY_DISPATCHED' });
      return;
    }
    if (body.chattype !== options.chatType) {
      writeEvent('message_ignored', { reason: 'CHAT_TYPE_MISMATCH', observed_chat_type: typeof body.chattype === 'string' ? body.chattype : null });
      return;
    }
    cardDispatchStarted = true;
    void dispatchCard(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'CARD_DISPATCH_FAILED', errorCode: 'WECOM_CARD_FAILED' }));
  });
  client.on('event.template_card_event', (frame) => {
    if (stopping) return;
    void updateCard(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'CARD_EVENT_HANDLING_FAILED', errorCode: 'WECOM_CARD_FAILED' }));
  });
  client.on('error', (error) => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'SDK_ERROR', errorCode: classifyError(error) });
  });
  client.on('disconnected', () => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'DISCONNECTED_BEFORE_RESULT', errorCode: 'WECOM_CARD_DISCONNECTED' });
  });

  timeout = setTimeoutFn(() => {
    finish({ ok: false, exitCode: 3, reason: 'CARD_TIMEOUT', errorCode: 'WECOM_CARD_TIMEOUT' });
  }, options.timeoutMs);
  writeEvent('connect_requested', { mode: options.mode, timeout_ms: options.timeoutMs });
  try {
    client.connect();
  } catch {
    finish({ ok: false, exitCode: 2, reason: 'CONNECT_THROWN', errorCode: 'WECOM_CONNECT_FAILED' });
  }

  return { completion, stop: () => finish({ ok: true, exitCode: 0, reason: 'MANUAL_STOP' }) };
}

async function main() {
  let options;
  let config;
  try {
    options = parseCardArgs(process.argv.slice(2));
    config = validateRuntimeConfig(process.env);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'G0_CARD_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }

  const writeEvent = (event, extra = {}) => {
    console.log(JSON.stringify({
      test_id: TEST_ID,
      at_utc: new Date().toISOString(),
      sdk_version: SDK_VERSION,
      event,
      ...extra,
    }));
  };
  const client = new AiBot.WSClient({
    botId: config.botId,
    secret: config.secret,
    wsUrl: config.wsUrl,
    maxReconnectAttempts: 0,
    maxAuthFailureAttempts: 0,
    logger: createSafeSdkLogger({ onHeartbeatTimerStarted: () => {} }),
  });
  const probe = runCardProbe({
    client,
    options,
    writeCapture: (capture) => appendCardCapture(options.outputPath, capture),
    writeEvent,
  });
  process.once('SIGINT', probe.stop);
  process.once('SIGTERM', probe.stop);
  const result = await probe.completion;
  process.exitCode = result.exit_code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
