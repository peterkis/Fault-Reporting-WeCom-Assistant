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

const TEST_ID = 'G0-005';
const SCENARIOS = new Set(['userid_from_message', 'chatid_from_message', 'invalid_chatid']);
const MENTION_MODES = new Set(['none', 'markdown_tag', 'text_mentioned_list', 'markdown_then_text_tag']);
const DEFAULT_OUTPUT = 'evidence/g0-005-active-push-captures.jsonl';
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_DELAY_MS = 3_000;
const DEFAULT_REPEAT_INTERVAL_MS = 1_000;

function hashIdentifier(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function readArgument(argv, name, fallback) {
  const argument = argv.find((item) => item.startsWith(`${name}=`));
  return argument ? argument.slice(name.length + 1) : fallback;
}

function assertIntegerRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`G0_PUSH_INVALID_${name}`);
  }
}

function isOutputInsideEvidence(outputPath) {
  const evidenceRoot = resolve(process.cwd(), 'evidence');
  const outputRelativePath = relative(evidenceRoot, outputPath);
  return outputRelativePath.length > 0 && !outputRelativePath.startsWith('..') && !isAbsolute(outputRelativePath);
}

export function parsePushArgs(argv) {
  const scenario = readArgument(argv, '--scenario', null);
  const timeoutMs = Number(readArgument(argv, '--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
  const delayMs = Number(readArgument(argv, '--delay-ms', String(DEFAULT_DELAY_MS)));
  const repeatCount = Number(readArgument(argv, '--repeat-count', '1'));
  const repeatIntervalMs = Number(readArgument(argv, '--repeat-interval-ms', String(DEFAULT_REPEAT_INTERVAL_MS)));
  const output = readArgument(argv, '--output', DEFAULT_OUTPUT);
  const mentionMode = readArgument(argv, '--mention-mode', argv.includes('--mention-sender') ? 'markdown_tag' : 'none');

  if (!SCENARIOS.has(scenario)) throw new Error('G0_PUSH_INVALID_SCENARIO');
  assertIntegerRange(timeoutMs, 'TIMEOUT', 30_000, 900_000);
  assertIntegerRange(delayMs, 'DELAY', 1_000, 60_000);
  assertIntegerRange(repeatCount, 'REPEAT_COUNT', 1, 3);
  assertIntegerRange(repeatIntervalMs, 'REPEAT_INTERVAL', 500, 60_000);
  if (!MENTION_MODES.has(mentionMode)) throw new Error('G0_PUSH_INVALID_MENTION_MODE');
  if (scenario === 'invalid_chatid' && (repeatCount !== 1 || mentionMode !== 'none')) {
    throw new Error('G0_PUSH_INVALID_ERROR_SCENARIO_OPTIONS');
  }
  if (mentionMode !== 'none' && scenario !== 'chatid_from_message') {
    throw new Error('G0_PUSH_INVALID_MENTION_SCENARIO');
  }

  const outputPath = resolve(process.cwd(), output);
  if (!isOutputInsideEvidence(outputPath) || !outputPath.endsWith('.jsonl')) {
    throw new Error('G0_PUSH_INVALID_OUTPUT');
  }

  return {
    scenario,
    timeoutMs,
    delayMs,
    repeatCount,
    repeatIntervalMs,
    mentionMode,
    outputPath,
  };
}

export function classifyPushError(error) {
  const message = String(error?.message ?? error?.errmsg ?? error ?? '');
  if (Number.isInteger(error?.errcode)) return 'WECOM_PUSH_REJECTED';
  if (/timeout|timed out/i.test(message)) return 'WECOM_PUSH_TIMEOUT';
  if (/auth|secret|credential|WS_AUTH_FAILURE/i.test(message)) return 'WECOM_AUTH_FAILED';
  if (/not connected|connection|socket|send/i.test(message)) return 'WECOM_PUSH_TRANSPORT_FAILED';
  return 'WECOM_PUSH_FAILED';
}

function providerErrorCode(error) {
  return Number.isInteger(error?.errcode) ? error.errcode : null;
}

function receiptShape(receipt) {
  return {
    cmd: typeof receipt?.cmd === 'string' ? receipt.cmd : null,
    header_field_names: Object.keys(receipt?.headers ?? {}).sort(),
    body_field_names: Object.keys(receipt?.body ?? {}).sort(),
    provider_errcode: providerErrorCode(receipt),
  };
}

export function buildOutboundMessage({ scenario, sequence, mentionMode, senderUserId }) {
  const targetLabel = scenario === 'userid_from_message' ? '单聊' : '群聊';
  const heading = '# G0-005 主动推送验证';
  const detail = `${targetLabel}主动 Markdown 推送，第 ${sequence} 条。`;
  if (mentionMode === 'markdown_tag') {
    // 此格式是 Markdown 标记实验，不等同于企业微信智能机器人协议已支持的 @ 语义。
    return {
      msgtype: 'markdown',
      content: `${heading}\n\n${detail}\n\n<@${senderUserId}>`,
    };
  }
  if (mentionMode === 'text_mentioned_list') {
    return {
      msgtype: 'text',
      content: `G0-005 群聊主动推送验证，第 ${sequence} 条。`,
      mentionedList: [senderUserId],
    };
  }
  return {
    msgtype: 'markdown',
    content: `${heading}\n\n${detail}`,
  };
}

export function buildOutboundMessages({ scenario, sequence, mentionMode, senderUserId }) {
  if (mentionMode !== 'markdown_then_text_tag') {
    return [{
      ...buildOutboundMessage({ scenario, sequence, mentionMode, senderUserId }),
      deliveryStep: 'single_message',
      mentionAttempted: mentionMode !== 'none',
    }];
  }

  const targetLabel = scenario === 'userid_from_message' ? '单聊' : '群聊';
  return [
    {
      msgtype: 'markdown',
      content: `# G0-005 主动推送验证\n\n${targetLabel}主动 Markdown 推送，第 ${sequence} 条。`,
      deliveryStep: 'markdown_without_mention',
      mentionAttempted: false,
    },
    {
      // 仅发送标签本身：验证长连接主动文本是否会将它渲染为企业微信原生 @。
      msgtype: 'text',
      content: `<@${senderUserId}>`,
      deliveryStep: 'plain_text_mention_tag',
      mentionAttempted: true,
    },
  ];
}

function createEvidence({ scenario, targetKind, target, targetSource, sequence, outboundMessage, mentionMode, startedAtMs, result, receipt, error }) {
  return {
    test_id: TEST_ID,
    schema_version: 1,
    observed_at_utc: new Date().toISOString(),
    scenario,
    target: {
      kind: targetKind,
      source: targetSource,
      identifier_hash: hashIdentifier(target),
      raw_identifier_recorded: false,
    },
    outbound: {
      msgtype: outboundMessage.msgtype,
      content_hash: hashIdentifier(outboundMessage.content),
      content_length_bytes: byteLength(outboundMessage.content),
      delivery_step: outboundMessage.deliveryStep,
      mention_attempted: outboundMessage.mentionAttempted,
      mention_mode: mentionMode,
      mention_target_count: outboundMessage.mentionedList?.length ?? 0,
      sequence,
    },
    result: {
      status: result,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? {
        error_code: classifyPushError(error),
        provider_errcode: providerErrorCode(error),
      } : {}),
    },
    privacy: {
      original_identifier_recorded: false,
      original_content_recorded: false,
      response_url_recorded: false,
      sdk_error_text_recorded: false,
    },
  };
}

function toSdkBody(outboundMessage) {
  if (outboundMessage.msgtype === 'text') {
    return {
      msgtype: 'text',
      text: {
        content: outboundMessage.content,
        ...(outboundMessage.mentionedList ? { mentioned_list: outboundMessage.mentionedList } : {}),
      },
    };
  }
  return { msgtype: 'markdown', markdown: { content: outboundMessage.content } };
}

function isExpectedMentionProbeRejection(options, outboundMessage) {
  return options.mentionMode === 'markdown_then_text_tag'
    && outboundMessage.deliveryStep === 'plain_text_mention_tag';
}

export async function appendPushCapture(outputPath, capture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(capture)}\n`, { encoding: 'utf8' });
}

export function runPushProbe({
  client,
  options,
  writeCapture,
  writeEvent,
  wait = sleep,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let stopping = false;
  let timeout;
  let targetAccepted = false;
  let resolveCompletion;
  const completion = new Promise((resolveCompletionPromise) => {
    resolveCompletion = resolveCompletionPromise;
  });

  function finish({ ok, exitCode, reason, errorCode }) {
    if (stopping) return;
    stopping = true;
    clearTimeoutFn(timeout);
    writeEvent('disconnect_requested', { reason, ...(errorCode ? { error_code: errorCode } : {}) });
    try {
      client.disconnect();
    } catch {
      // 断开失败不允许覆盖已经记录的主动推送结果。
    }
    resolveCompletion({ ok, exit_code: exitCode, reason, ...(errorCode ? { error_code: errorCode } : {}) });
  }

  async function sendSeries({ target, targetKind, targetSource, senderUserId }) {
    const expectedFailure = options.scenario === 'invalid_chatid';
    let rejected = false;
    let mentionProbeRejected = false;
    for (let sequence = 1; sequence <= options.repeatCount; sequence += 1) {
      if (stopping) return;
      const outboundMessages = buildOutboundMessages({
        scenario: options.scenario,
        sequence,
        mentionMode: options.mentionMode,
        senderUserId,
      });
      for (const outboundMessage of outboundMessages) {
        const startedAtMs = Date.now();
        writeEvent('push_attempted', {
          target_kind: targetKind,
          target_source: targetSource,
          sequence,
          delivery_step: outboundMessage.deliveryStep,
        });
        try {
          const receipt = await client.sendMessage(target, toSdkBody(outboundMessage));
          const capture = createEvidence({
            scenario: options.scenario,
            targetKind,
            target,
            targetSource,
            sequence,
            outboundMessage,
            mentionMode: options.mentionMode,
            startedAtMs,
            result: 'acknowledged',
            receipt,
          });
          await writeCapture(capture);
          writeEvent('push_acknowledged', { target_kind: targetKind, sequence, delivery_step: outboundMessage.deliveryStep });
          if (expectedFailure) {
            finish({ ok: false, exitCode: 2, reason: 'INVALID_TARGET_UNEXPECTEDLY_ACKNOWLEDGED', errorCode: 'G0_PUSH_UNEXPECTED_SUCCESS' });
            return;
          }
        } catch (error) {
          rejected = true;
          const capture = createEvidence({
            scenario: options.scenario,
            targetKind,
            target,
            targetSource,
            sequence,
            outboundMessage,
            mentionMode: options.mentionMode,
            startedAtMs,
            result: 'rejected',
            error,
          });
          await writeCapture(capture);
          writeEvent('push_rejected', {
            target_kind: targetKind,
            sequence,
            delivery_step: outboundMessage.deliveryStep,
            error_code: capture.result.error_code,
          });
          if (isExpectedMentionProbeRejection(options, outboundMessage)) {
            mentionProbeRejected = true;
            continue;
          }
          if (!expectedFailure) {
            finish({ ok: false, exitCode: 2, reason: 'PUSH_REJECTED', errorCode: capture.result.error_code });
            return;
          }
        }
      }
      if (sequence < options.repeatCount) await wait(options.repeatIntervalMs);
    }
    finish(expectedFailure
      ? { ok: rejected, exitCode: rejected ? 0 : 2, reason: rejected ? 'EXPECTED_INVALID_TARGET_REJECTION' : 'INVALID_TARGET_RESULT_UNKNOWN', ...(rejected ? {} : { errorCode: 'G0_PUSH_INVALID_TARGET_NOT_REJECTED' }) }
      : {
        ok: true,
        exitCode: 0,
        reason: mentionProbeRejected
          ? 'PUSH_SERIES_COMPLETED_WITH_MENTION_PROBE_REJECTION'
          : 'PUSH_SERIES_ACKNOWLEDGED',
      });
  }

  async function startSend(targetInput) {
    if (stopping || targetAccepted) return;
    targetAccepted = true;
    await wait(options.delayMs);
    if (!stopping) await sendSeries(targetInput);
  }

  client.on('authenticated', () => {
    writeEvent('push_ready', {
      scenario: options.scenario,
      delay_ms: options.delayMs,
      repeat_count: options.repeatCount,
      mention_mode: options.mentionMode,
    });
    if (options.scenario === 'invalid_chatid') {
      void startSend({
        target: `g0-005-invalid-chatid-${randomUUID()}`,
        targetKind: 'chatid',
        targetSource: 'generated_invalid_value',
        senderUserId: null,
      });
    }
  });
  client.on('message.text', (frame) => {
    const body = frame?.body ?? {};
    const expectedChatType = options.scenario === 'userid_from_message' ? 'single' : 'group';
    if (options.scenario === 'invalid_chatid' || body.chattype !== expectedChatType) {
      writeEvent('message_ignored', { expected_chat_type: expectedChatType, observed_chat_type: typeof body.chattype === 'string' ? body.chattype : null });
      return;
    }
    const target = options.scenario === 'userid_from_message' ? body.from?.userid : body.chatid;
    if (typeof target !== 'string' || target.length === 0) {
      finish({ ok: false, exitCode: 2, reason: 'TARGET_MISSING', errorCode: 'WECOM_PUSH_TARGET_MISSING' });
      return;
    }
    if (options.mentionMode !== 'none' && (typeof body.from?.userid !== 'string' || body.from.userid.length === 0)) {
      finish({ ok: false, exitCode: 2, reason: 'MENTION_TARGET_MISSING', errorCode: 'WECOM_PUSH_MENTION_TARGET_MISSING' });
      return;
    }
    void startSend({
      target,
      targetKind: options.scenario === 'userid_from_message' ? 'userid' : 'chatid',
      targetSource: 'inbound_message',
      senderUserId: body.from?.userid,
    });
  });
  client.on('error', (error) => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'SDK_ERROR', errorCode: classifyError(error) });
  });
  client.on('disconnected', () => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'DISCONNECTED_BEFORE_RESULT', errorCode: 'WECOM_PUSH_DISCONNECTED' });
  });

  timeout = setTimeoutFn(() => {
    finish({ ok: false, exitCode: 3, reason: 'PUSH_TIMEOUT', errorCode: 'WECOM_PUSH_TIMEOUT' });
  }, options.timeoutMs);
  writeEvent('connect_requested', { scenario: options.scenario, timeout_ms: options.timeoutMs });
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
    options = parsePushArgs(process.argv.slice(2));
    config = validateRuntimeConfig(process.env);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'G0_PUSH_CONFIG_INVALID' }));
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
  const probe = runPushProbe({
    client,
    options,
    writeCapture: (capture) => appendPushCapture(options.outputPath, capture),
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
