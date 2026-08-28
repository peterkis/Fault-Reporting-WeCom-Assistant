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
const REPLY_MODES = new Set(['text', 'stream']);
const DEFAULT_OUTPUT = 'evidence/g0-006-group-reply-mention-captures.jsonl';
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_TRIGGER_TOKEN = 'G0-006-REPLY-AT';

function hashValue(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function readArgument(argv, name, fallback) {
  const argument = argv.find((item) => item.startsWith(`${name}=`));
  return argument ? argument.slice(name.length + 1) : fallback;
}

function isOutputInsideEvidence(outputPath) {
  const evidenceRoot = resolve(process.cwd(), 'evidence');
  const outputRelativePath = relative(evidenceRoot, outputPath);
  return outputRelativePath.length > 0 && !outputRelativePath.startsWith('..') && !isAbsolute(outputRelativePath);
}

export function parseGroupMentionArgs(argv) {
  const timeoutMs = Number(readArgument(argv, '--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
  const triggerToken = readArgument(argv, '--trigger-token', DEFAULT_TRIGGER_TOKEN);
  const replyMode = readArgument(argv, '--reply-mode', 'text');
  const outputPath = resolve(process.cwd(), readArgument(argv, '--output', DEFAULT_OUTPUT));

  if (!Number.isInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) {
    throw new Error('G0_GROUP_REPLY_INVALID_TIMEOUT');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(triggerToken)) {
    throw new Error('G0_GROUP_REPLY_INVALID_TRIGGER_TOKEN');
  }
  if (!REPLY_MODES.has(replyMode)) {
    throw new Error('G0_GROUP_REPLY_INVALID_REPLY_MODE');
  }
  if (!isOutputInsideEvidence(outputPath) || !outputPath.endsWith('.jsonl')) {
    throw new Error('G0_GROUP_REPLY_INVALID_OUTPUT');
  }

  return { timeoutMs, triggerToken, replyMode, outputPath };
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

export function classifyGroupMentionError(error) {
  const message = String(error?.message ?? error?.errmsg ?? error ?? '');
  if (Number.isInteger(error?.errcode)) return 'WECOM_GROUP_REPLY_REJECTED';
  if (/timeout|timed out/i.test(message)) return 'WECOM_GROUP_REPLY_TIMEOUT';
  if (/auth|secret|credential|WS_AUTH_FAILURE/i.test(message)) return 'WECOM_AUTH_FAILED';
  if (/not connected|connection|socket|send/i.test(message)) return 'WECOM_GROUP_REPLY_TRANSPORT_FAILED';
  return 'WECOM_GROUP_REPLY_FAILED';
}

export function buildGroupMentionReply(userId, { replyMode = 'text', streamId } = {}) {
  if (typeof userId !== 'string' || userId.length === 0 || userId.length > 256 || /[<>\r\n]/.test(userId)) {
    throw new Error('G0_GROUP_REPLY_INVALID_USERID');
  }
  if (!REPLY_MODES.has(replyMode)) throw new Error('G0_GROUP_REPLY_INVALID_REPLY_MODE');
  const content = `<@${userId}> G0-006 群内被动回复能力复测`;
  if (replyMode === 'stream') {
    if (typeof streamId !== 'string' || streamId.length === 0 || streamId.length > 128) {
      throw new Error('G0_GROUP_REPLY_INVALID_STREAM_ID');
    }
    return {
      msgtype: 'stream',
      stream: {
        id: streamId,
        finish: true,
        content,
      },
    };
  }
  return {
    msgtype: 'text',
    text: {
      content,
    },
  };
}

export function createGroupMentionCapture({ frame, replyBody, startedAtMs, result, receipt, error }) {
  const body = frame?.body ?? {};
  const userId = body.from?.userid;
  const chatId = body.chatid;
  const reqId = frame?.headers?.req_id;
  const content = replyBody?.text?.content ?? replyBody?.stream?.content ?? '';
  const streamId = replyBody?.stream?.id;
  return {
    test_id: TEST_ID,
    schema_version: 1,
    observed_at_utc: new Date().toISOString(),
    kind: 'group_reply_mention',
    scenario: `group_passive_${replyBody?.msgtype ?? 'unknown'}_mention`,
    inbound: {
      chat_type: typeof body.chattype === 'string' ? body.chattype : null,
      chat_id_hash: hashValue(chatId),
      user_identifier_hash: hashValue(userId),
      callback_req_id_hash: hashValue(reqId),
      callback_header_field_names: Object.keys(frame?.headers ?? {}).sort(),
      body_field_names: Object.keys(body).sort(),
      raw_chat_id_recorded: false,
      raw_user_identifier_recorded: false,
      raw_req_id_recorded: false,
      original_message_recorded: false,
    },
    outbound: {
      command: 'aibot_respond_msg',
      msgtype: replyBody?.msgtype ?? null,
      callback_req_id_reused: true,
      mention_attempted: true,
      mention_syntax: '<@from.userid>',
      mention_target_source: 'current_callback.from.userid',
      mention_target_hash: hashValue(userId),
      mention_target_matches_sender: true,
      content_hash: hashValue(content),
      content_length_bytes: Buffer.byteLength(content, 'utf8'),
      raw_content_recorded: false,
      ...(streamId ? {
        stream_id_hash: hashValue(streamId),
        raw_stream_id_recorded: false,
        stream_finish: replyBody.stream.finish === true,
      } : {}),
    },
    result: {
      status: result,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? {
        error_code: classifyGroupMentionError(error),
        provider_errcode: providerErrorCode(error),
      } : {}),
    },
    privacy: {
      original_message_recorded: false,
      original_identifier_recorded: false,
      response_url_recorded: false,
      sdk_error_text_recorded: false,
    },
  };
}

export async function appendGroupMentionCapture(outputPath, capture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(capture)}\n`, { encoding: 'utf8' });
}

export function runGroupMentionProbe({
  client,
  options,
  writeCapture,
  writeEvent,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let stopping = false;
  let replyStarted = false;
  let timeout;
  let completionResolve;
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
      // 已记录的回复结论不能被断开失败覆盖。
    }
    completionResolve({ ok, exit_code: exitCode, reason, ...(errorCode ? { error_code: errorCode } : {}) });
  }

  async function persistAndFinish(capture, result) {
    try {
      await writeCapture(capture);
    } catch {
      finish({ ok: false, exitCode: 2, reason: 'EVIDENCE_WRITE_FAILED', errorCode: 'G0_GROUP_REPLY_EVIDENCE_WRITE_FAILED' });
      return;
    }
    finish(result);
  }

  async function replyToGroup(frame) {
    const body = frame?.body ?? {};
    const userId = body.from?.userid;
    const chatId = body.chatid;
    const reqId = frame?.headers?.req_id;
    if (typeof userId !== 'string' || userId.length === 0) {
      finish({ ok: false, exitCode: 2, reason: 'USERID_MISSING', errorCode: 'WECOM_GROUP_REPLY_USERID_MISSING' });
      return;
    }
    if (typeof chatId !== 'string' || chatId.length === 0) {
      finish({ ok: false, exitCode: 2, reason: 'CHATID_MISSING', errorCode: 'WECOM_GROUP_REPLY_CHATID_MISSING' });
      return;
    }
    if (typeof reqId !== 'string' || reqId.length === 0) {
      finish({ ok: false, exitCode: 2, reason: 'REQ_ID_MISSING', errorCode: 'WECOM_GROUP_REPLY_REQ_ID_MISSING' });
      return;
    }

    const replyBody = buildGroupMentionReply(userId, {
      replyMode: options.replyMode,
      streamId: options.replyMode === 'stream' ? `g0-006-${randomUUID()}` : undefined,
    });
    const startedAtMs = Date.now();
    writeEvent('group_reply_mention_attempted', {
      command: 'aibot_respond_msg',
      msgtype: replyBody.msgtype,
      mention_syntax: '<@from.userid>',
    });
    try {
      const receipt = await client.reply(frame, replyBody);
      const capture = createGroupMentionCapture({
        frame,
        replyBody,
        startedAtMs,
        result: 'acknowledged',
        receipt,
      });
      writeEvent('group_reply_mention_acknowledged', { provider_errcode: capture.result.receipt.provider_errcode });
      await persistAndFinish(capture, { ok: true, exitCode: 0, reason: 'GROUP_REPLY_MENTION_ACKNOWLEDGED' });
    } catch (error) {
      const capture = createGroupMentionCapture({
        frame,
        replyBody,
        startedAtMs,
        result: 'rejected',
        error,
      });
      writeEvent('group_reply_mention_rejected', {
        error_code: capture.result.error_code,
        provider_errcode: capture.result.provider_errcode,
      });
      const providerRejected = capture.result.provider_errcode !== null;
      await persistAndFinish(capture, providerRejected
        ? {
          ok: true,
          exitCode: 0,
          reason: 'GROUP_REPLY_MENTION_PROVIDER_REJECTED',
          errorCode: capture.result.error_code,
        }
        : {
          ok: false,
          exitCode: 2,
          reason: 'GROUP_REPLY_MENTION_FAILED',
          errorCode: capture.result.error_code,
        });
    }
  }

  client.on('authenticated', () => {
    writeEvent('group_reply_mention_ready', {
      trigger_token: options.triggerToken,
      reply_mode: options.replyMode,
      timeout_ms: options.timeoutMs,
    });
  });
  client.on('message.text', (frame) => {
    if (stopping || replyStarted) return;
    const body = frame?.body ?? {};
    if (body.chattype !== 'group') {
      writeEvent('message_ignored', { reason: 'CHAT_TYPE_MISMATCH' });
      return;
    }
    const content = body.text?.content;
    if (typeof content !== 'string' || !content.includes(options.triggerToken)) {
      writeEvent('message_ignored', { reason: 'TRIGGER_TOKEN_MISMATCH' });
      return;
    }
    replyStarted = true;
    void replyToGroup(frame).catch(() => finish({
      ok: false,
      exitCode: 2,
      reason: 'GROUP_REPLY_HANDLER_FAILED',
      errorCode: 'WECOM_GROUP_REPLY_FAILED',
    }));
  });
  client.on('error', (error) => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'SDK_ERROR', errorCode: classifyError(error) });
  });
  client.on('disconnected', () => {
    if (!stopping) finish({
      ok: false,
      exitCode: 2,
      reason: 'DISCONNECTED_BEFORE_RESULT',
      errorCode: 'WECOM_GROUP_REPLY_DISCONNECTED',
    });
  });

  timeout = setTimeoutFn(() => {
    finish({ ok: false, exitCode: 3, reason: 'GROUP_REPLY_TIMEOUT', errorCode: 'WECOM_GROUP_REPLY_TIMEOUT' });
  }, options.timeoutMs);
  writeEvent('connect_requested', {
    scenario: `group_passive_${options.replyMode}_mention`,
    timeout_ms: options.timeoutMs,
  });
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
    options = parseGroupMentionArgs(process.argv.slice(2));
    config = validateRuntimeConfig(process.env);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'G0_GROUP_REPLY_CONFIG_INVALID' }));
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
  const probe = runGroupMentionProbe({
    client,
    options,
    writeCapture: (capture) => appendGroupMentionCapture(options.outputPath, capture),
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
