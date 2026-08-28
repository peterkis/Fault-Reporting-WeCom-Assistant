import { appendFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';
import {
  createAmrNbFixture,
  createFileFixture,
  createImageFixture,
} from './g0-webhook-message-capability.mjs';
import { downloadFileWithTimeout } from './g0-004-media-capture.mjs';
import {
  SDK_VERSION,
  classifyError,
  createSafeSdkLogger,
  validateRuntimeConfig,
} from './g0-002-sdk-lifecycle.mjs';

const TEST_ID = 'G0-006A';
const DEFAULT_OUTPUT = 'evidence/g0-006a-reply-captures.jsonl';
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_STREAM_REFRESH_DELAY_MS = 800;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15_000;
const FIVE_SECONDS_MS = 5_000;
const MAX_REPLY_VIDEO_BYTES = 10 * 1024 * 1024;
const VERIFIED_CARD_ACTION = { type: 1, url: 'https://work.weixin.qq.com' };

const SCENARIOS = Object.freeze({
  welcome_text: { trigger: 'enter_chat', reply_kind: 'welcome_text' },
  welcome_template_card: { trigger: 'enter_chat', reply_kind: 'welcome_template_card' },
  stream_refresh_feedback: { trigger: 'text', reply_kind: 'stream', trigger_token: 'G0-006A-STREAM' },
  markdown: { trigger: 'text', reply_kind: 'markdown', trigger_token: 'G0-006A-MARKDOWN' },
  file: { trigger: 'text', reply_kind: 'media', media_type: 'file', trigger_token: 'G0-006A-FILE' },
  image: { trigger: 'text', reply_kind: 'media', media_type: 'image', trigger_token: 'G0-006A-IMAGE' },
  voice: { trigger: 'text', reply_kind: 'media', media_type: 'voice', trigger_token: 'G0-006A-VOICE' },
  video_echo: { trigger: 'video', reply_kind: 'video_echo', media_type: 'video' },
});

function hashValue(value, length = 16) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function hashBuffer(value) {
  return Buffer.isBuffer(value) ? createHash('sha256').update(value).digest('hex') : null;
}

function byteLength(value) {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
}

function readArgument(argv, name, fallback) {
  const argument = argv.find((item) => item.startsWith(`${name}=`));
  return argument ? argument.slice(name.length + 1) : fallback;
}

function assertIntegerRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`G0_REPLY_INVALID_${name}`);
  }
}

function isOutputInsideEvidence(outputPath) {
  const evidenceRoot = resolve(process.cwd(), 'evidence');
  const outputRelativePath = relative(evidenceRoot, outputPath);
  return outputRelativePath.length > 0 && !outputRelativePath.startsWith('..') && !isAbsolute(outputRelativePath);
}

export function parseReplyArgs(argv) {
  const scenario = readArgument(argv, '--scenario', null);
  const timeoutMs = Number(readArgument(argv, '--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
  const streamRefreshDelayMs = Number(readArgument(argv, '--stream-refresh-delay-ms', String(DEFAULT_STREAM_REFRESH_DELAY_MS)));
  const downloadTimeoutMs = Number(readArgument(argv, '--download-timeout-ms', String(DEFAULT_DOWNLOAD_TIMEOUT_MS)));
  const output = readArgument(argv, '--output', DEFAULT_OUTPUT);

  if (!Object.hasOwn(SCENARIOS, scenario)) throw new Error('G0_REPLY_INVALID_SCENARIO');
  assertIntegerRange(timeoutMs, 'TIMEOUT', 30_000, 900_000);
  assertIntegerRange(streamRefreshDelayMs, 'STREAM_REFRESH_DELAY', 100, 5_000);
  assertIntegerRange(downloadTimeoutMs, 'DOWNLOAD_TIMEOUT', 100, 60_000);

  const outputPath = resolve(process.cwd(), output);
  if (!isOutputInsideEvidence(outputPath) || !outputPath.endsWith('.jsonl')) {
    throw new Error('G0_REPLY_INVALID_OUTPUT');
  }

  return {
    scenario,
    expected: SCENARIOS[scenario],
    timeoutMs,
    streamRefreshDelayMs,
    downloadTimeoutMs,
    outputPath,
  };
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

export function classifyReplyError(error) {
  if (error?.code === 'G0_REPLY_VIDEO_REFERENCE_INVALID') return 'WECOM_REPLY_MEDIA_REFERENCE_INVALID';
  if (error?.code === 'G0_REPLY_VIDEO_TOO_LARGE') return 'WECOM_REPLY_MEDIA_SIZE_EXCEEDED';
  if (error?.code === 'G0_MEDIA_DOWNLOAD_TIMEOUT') return 'WECOM_REPLY_MEDIA_DOWNLOAD_TIMEOUT';
  if (Number.isInteger(error?.errcode)) return 'WECOM_REPLY_REJECTED';
  const message = String(error?.message ?? error?.errmsg ?? error ?? '');
  if (/timeout|timed out/i.test(message)) return 'WECOM_REPLY_TIMEOUT';
  if (/auth|secret|credential|WS_AUTH_FAILURE/i.test(message)) return 'WECOM_AUTH_FAILED';
  if (/decrypt|aes|padding|cipher|invalid key length/i.test(message)) return 'WECOM_REPLY_MEDIA_DECRYPT_FAILED';
  if (/not connected|connection|socket|send/i.test(message)) return 'WECOM_REPLY_TRANSPORT_FAILED';
  return 'WECOM_REPLY_FAILED';
}

function callbackShape(frame) {
  const body = frame?.body ?? {};
  return {
    cmd: typeof frame?.cmd === 'string' ? frame.cmd : null,
    header_field_names: Object.keys(frame?.headers ?? {}).sort(),
    callback_req_id_hash: hashValue(frame?.headers?.req_id),
    body_field_names: Object.keys(body).sort(),
    chat_type: typeof body.chattype === 'string' ? body.chattype : null,
    user_identifier_hash: hashValue(body.from?.userid),
    raw_callback_req_id_recorded: false,
    raw_user_identifier_recorded: false,
  };
}

function baseCapture({ scenario, kind, frame }) {
  return {
    test_id: TEST_ID,
    schema_version: 1,
    observed_at_utc: new Date().toISOString(),
    scenario,
    kind,
    inbound: callbackShape(frame),
    privacy: {
      original_message_recorded: false,
      original_identifier_recorded: false,
      callback_req_id_recorded: false,
      feedback_content_recorded: false,
      media_id_recorded: false,
      media_url_recorded: false,
      aeskey_recorded: false,
      original_filename_recorded: false,
      media_file_persisted: false,
      sdk_error_text_recorded: false,
    },
  };
}

export function buildWelcomeReply(scenario) {
  if (scenario === 'welcome_text') {
    return {
      msgtype: 'text',
      text: { content: '您好，这是 G0-006A 欢迎语回复验证。' },
    };
  }
  if (scenario === 'welcome_template_card') {
    return {
      msgtype: 'template_card',
      template_card: {
        card_type: 'text_notice',
        main_title: { title: 'G0-006A 欢迎语卡片验证', desc: '企业微信长连接欢迎语' },
        sub_title_text: '请确认模板卡片正常显示。',
        card_action: VERIFIED_CARD_ACTION,
      },
    };
  }
  throw new Error('G0_REPLY_INVALID_WELCOME_SCENARIO');
}

export function buildMarkdownReply() {
  return {
    msgtype: 'markdown',
    markdown: {
      content: '# G0-006A Markdown 回复验证\n\n**企业微信长连接回调绑定回复** 已发送。',
    },
  };
}

export function buildStreamStages(feedbackId) {
  if (typeof feedbackId !== 'string' || feedbackId.length === 0 || feedbackId.length > 256) {
    throw new Error('G0_REPLY_INVALID_FEEDBACK_ID');
  }
  return [
    {
      stage: 'initial',
      content: 'G0-006A 流式回复验证：正在开始。',
      finish: false,
      feedback: { id: feedbackId },
    },
    {
      stage: 'refresh',
      content: 'G0-006A 流式回复验证：内容已刷新。',
      finish: false,
    },
    {
      stage: 'final',
      content: 'G0-006A 流式回复验证：已结束，请提交反馈。',
      finish: true,
    },
  ];
}

export function createReplyFixture(scenario) {
  if (scenario === 'file') {
    const fixture = createFileFixture();
    return {
      type: 'file',
      filename: 'g0-006a-reply-file.txt',
      extension: '.txt',
      bytes: fixture.bytes,
      duration_ms: null,
    };
  }
  if (scenario === 'image') {
    const fixture = createImageFixture();
    return {
      type: 'image',
      filename: 'g0-006a-reply-image.png',
      extension: '.png',
      bytes: fixture.bytes,
      duration_ms: null,
    };
  }
  if (scenario === 'voice') {
    const fixture = createAmrNbFixture();
    return {
      type: 'voice',
      filename: 'g0-006a-reply-voice.amr',
      extension: '.amr',
      bytes: fixture.bytes,
      duration_ms: fixture.durationMs,
    };
  }
  throw new Error('G0_REPLY_INVALID_MEDIA_SCENARIO');
}

function mediaMetadata(fixture) {
  return {
    media_type: fixture.type,
    byte_size: Buffer.isBuffer(fixture.bytes) ? fixture.bytes.length : null,
    sha256: hashBuffer(fixture.bytes),
    filename_extension: fixture.extension,
    filename_recorded: false,
    ...(Number.isInteger(fixture.duration_ms) ? { duration_ms: fixture.duration_ms } : {}),
  };
}

function mediaReplyOptions(mediaType) {
  if (mediaType !== 'video') return undefined;
  return {
    title: 'G0-006A 视频回复验证',
    description: '无敏感测试视频回显',
  };
}

function createWelcomeCapture({ scenario, frame, replyBody, invokedAfterEventMs, result, receipt, error }) {
  return {
    ...baseCapture({ scenario, kind: 'welcome_reply', frame }),
    outbound: {
      command: 'aibot_respond_welcome_msg',
      msgtype: replyBody.msgtype,
      callback_req_id_reused: true,
      invoked_after_event_ms: invokedAfterEventMs,
      within_five_seconds: invokedAfterEventMs <= FIVE_SECONDS_MS,
      content_length_bytes: byteLength(replyBody.text?.content),
      card_type: replyBody.template_card?.card_type ?? null,
      raw_content_recorded: false,
    },
    result: {
      status: result,
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? { error_code: classifyReplyError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function createStreamCapture({ scenario, frame, streamId, feedbackId, stage, result, receipt, error }) {
  return {
    ...baseCapture({ scenario, kind: 'stream_reply', frame }),
    outbound: {
      command: 'aibot_respond_msg',
      msgtype: 'stream',
      callback_req_id_reused: true,
      stream_id_hash: hashValue(streamId),
      raw_stream_id_recorded: false,
      stage: stage.stage,
      finish: stage.finish,
      content_length_bytes: byteLength(stage.content),
      feedback_configured: Boolean(stage.feedback),
      feedback_id_hash: stage.feedback ? hashValue(feedbackId) : null,
      raw_content_recorded: false,
    },
    result: {
      status: result,
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? { error_code: classifyReplyError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function createMarkdownCapture({ scenario, frame, replyBody, result, receipt, error }) {
  return {
    ...baseCapture({ scenario, kind: 'markdown_reply', frame }),
    outbound: {
      command: 'aibot_respond_msg',
      msgtype: 'markdown',
      callback_req_id_reused: true,
      content_length_bytes: byteLength(replyBody.markdown?.content),
      raw_content_recorded: false,
    },
    result: {
      status: result,
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? { error_code: classifyReplyError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function createMediaUploadCapture({ scenario, frame, fixture, result, upload, error, source }) {
  return {
    ...baseCapture({ scenario, kind: 'media_upload', frame }),
    ...(source ? { source } : {}),
    media: mediaMetadata(fixture),
    upload: {
      media_id_received: typeof upload?.media_id === 'string' && upload.media_id.length > 0,
      media_id_hash: hashValue(upload?.media_id),
      raw_media_id_recorded: false,
    },
    result: {
      status: result,
      ...(upload ? { uploaded_type: typeof upload.type === 'string' ? upload.type : null } : {}),
      ...(error ? { error_code: classifyReplyError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function createMediaReplyCapture({ scenario, frame, fixture, mediaId, result, receipt, error, source }) {
  const videoOptions = mediaReplyOptions(fixture.type);
  return {
    ...baseCapture({ scenario, kind: 'media_reply', frame }),
    ...(source ? { source } : {}),
    media: mediaMetadata(fixture),
    outbound: {
      command: 'aibot_respond_msg',
      msgtype: fixture.type,
      callback_req_id_reused: true,
      media_id_hash: hashValue(mediaId),
      raw_media_id_recorded: false,
      video_title_length_bytes: byteLength(videoOptions?.title),
      video_description_length_bytes: byteLength(videoOptions?.description),
    },
    result: {
      status: result,
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? { error_code: classifyReplyError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function feedbackEventData(body) {
  const envelope = body?.event;
  if (!envelope || typeof envelope !== 'object') {
    return { data: {}, field_path: null, envelope_field_names: [], payload_field_names: [] };
  }
  if (envelope.feedback_event && typeof envelope.feedback_event === 'object') {
    return {
      data: envelope.feedback_event,
      field_path: 'event.feedback_event',
      envelope_field_names: Object.keys(envelope).sort(),
      payload_field_names: Object.keys(envelope.feedback_event).sort(),
    };
  }
  return {
    data: envelope,
    field_path: 'event',
    envelope_field_names: Object.keys(envelope).sort(),
    payload_field_names: Object.keys(envelope).sort(),
  };
}

function createFeedbackCapture({ scenario, frame, expectedFeedbackId, bodyOmitted, result, receipt, error }) {
  const extracted = feedbackEventData(frame?.body ?? {});
  const feedback = extracted.data;
  const feedbackType = [1, 2, 3].includes(feedback.type) ? feedback.type : null;
  const reasons = Array.isArray(feedback.inaccurate_reason_list) ? feedback.inaccurate_reason_list : [];
  return {
    ...baseCapture({ scenario, kind: 'feedback_event', frame }),
    feedback: {
      event_field_path: extracted.field_path,
      event_envelope_field_names: extracted.envelope_field_names,
      payload_field_names: extracted.payload_field_names,
      feedback_id_hash: hashValue(feedback.id),
      expected_feedback_id_hash: hashValue(expectedFeedbackId),
      feedback_id_matches_expected: feedback.id === expectedFeedbackId,
      feedback_type: feedbackType,
      content_present: typeof feedback.content === 'string',
      content_length_bytes: byteLength(feedback.content),
      inaccurate_reason_count: reasons.length,
      raw_feedback_content_recorded: false,
    },
    outbound: {
      command: 'aibot_respond_msg',
      callback_req_id_reused: true,
      empty_body: true,
      body_omitted: bodyOmitted === true,
      body_field_names: [],
    },
    result: {
      status: result,
      ...(receipt ? { receipt: receiptShape(receipt) } : {}),
      ...(error ? { error_code: classifyReplyError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function createVideoDownloadCapture({ scenario, frame, fixture, result, error }) {
  const video = frame?.body?.video ?? {};
  return {
    ...baseCapture({ scenario, kind: 'video_download', frame }),
    source: {
      url_present: typeof video.url === 'string',
      aeskey_present: typeof video.aeskey === 'string',
      original_filename_recorded: false,
    },
    ...(fixture ? { media: mediaMetadata(fixture) } : {}),
    result: {
      status: result,
      ...(error ? { error_code: classifyReplyError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

export async function appendReplyCapture(outputPath, capture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(capture)}\n`, { encoding: 'utf8' });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function makeReplyId(prefix, createId) {
  return `${prefix}-${createId()}`;
}

function eventTypeOf(frame) {
  const value = frame?.body?.event?.eventtype;
  return typeof value === 'string' ? value : null;
}

function isSingleChat(frame) {
  return frame?.body?.chattype === 'single';
}

function isSingleOrUnspecifiedEnterChat(frame) {
  const chatType = frame?.body?.chattype;
  return chatType === undefined || chatType === null || chatType === 'single';
}

function localFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function createVideoEchoFixture({ frame, downloadFile, downloadTimeoutMs }) {
  const video = frame?.body?.video ?? {};
  if (typeof video.url !== 'string' || video.url.length === 0 || typeof video.aeskey !== 'string' || video.aeskey.length === 0) {
    throw localFailure('G0_REPLY_VIDEO_REFERENCE_INVALID');
  }
  const { buffer } = await downloadFileWithTimeout(downloadFile, video.url, video.aeskey, downloadTimeoutMs);
  if (!Buffer.isBuffer(buffer)) throw localFailure('G0_REPLY_VIDEO_REFERENCE_INVALID');
  if (buffer.length > MAX_REPLY_VIDEO_BYTES) throw localFailure('G0_REPLY_VIDEO_TOO_LARGE');
  return {
    type: 'video',
    filename: 'g0-006a-reply-video.mp4',
    extension: '.mp4',
    bytes: buffer,
    duration_ms: null,
  };
}

export function runReplyProbe({
  client,
  options,
  writeCapture,
  writeEvent,
  wait = sleep,
  now = Date.now,
  createId = randomUUID,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let stopping = false;
  let actionStarted = false;
  let feedbackHandling = false;
  let awaitingFeedback = false;
  let expectedFeedbackId = null;
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
      // 已有结论不因断开失败被覆盖。
    }
    completionResolve({ ok, exit_code: exitCode, reason, ...(errorCode ? { error_code: errorCode } : {}) });
  }

  async function dispatchWelcome(frame) {
    const startedAtMs = now();
    const replyBody = buildWelcomeReply(options.scenario);
    const invokedAfterEventMs = Math.max(0, now() - startedAtMs);
    writeEvent('welcome_reply_attempted', { msgtype: replyBody.msgtype, invoked_after_event_ms: invokedAfterEventMs });
    try {
      const receipt = await client.replyWelcome(frame, replyBody);
      await writeCapture(createWelcomeCapture({
        scenario: options.scenario,
        frame,
        replyBody,
        invokedAfterEventMs,
        result: 'acknowledged',
        receipt,
      }));
      finish({ ok: true, exitCode: 0, reason: 'WELCOME_REPLY_ACKNOWLEDGED' });
    } catch (error) {
      const capture = createWelcomeCapture({
        scenario: options.scenario,
        frame,
        replyBody,
        invokedAfterEventMs,
        result: 'rejected',
        error,
      });
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'WELCOME_REPLY_REJECTED', errorCode: capture.result.error_code });
    }
  }

  async function dispatchStream(frame) {
    const streamId = makeReplyId('g0-006a-stream', createId);
    expectedFeedbackId = makeReplyId('g0-006a-feedback', createId);
    const stages = buildStreamStages(expectedFeedbackId);
    for (const stage of stages) {
      writeEvent('stream_reply_attempted', { stage: stage.stage, finish: stage.finish, feedback_configured: Boolean(stage.feedback) });
      try {
        const receipt = await client.replyStream(
          frame,
          streamId,
          stage.content,
          stage.finish,
          undefined,
          stage.feedback,
        );
        await writeCapture(createStreamCapture({
          scenario: options.scenario,
          frame,
          streamId,
          feedbackId: expectedFeedbackId,
          stage,
          result: 'acknowledged',
          receipt,
        }));
      } catch (error) {
        const capture = createStreamCapture({
          scenario: options.scenario,
          frame,
          streamId,
          feedbackId: expectedFeedbackId,
          stage,
          result: 'rejected',
          error,
        });
        await writeCapture(capture);
        finish({ ok: false, exitCode: 2, reason: 'STREAM_REPLY_REJECTED', errorCode: capture.result.error_code });
        return;
      }
      if (!stage.finish) await wait(options.streamRefreshDelayMs);
    }
    awaitingFeedback = true;
    writeEvent('feedback_awaited', { feedback_id_hash: hashValue(expectedFeedbackId) });
  }

  async function dispatchMarkdown(frame) {
    const replyBody = buildMarkdownReply();
    writeEvent('markdown_reply_attempted');
    try {
      const receipt = await client.reply(frame, replyBody);
      await writeCapture(createMarkdownCapture({
        scenario: options.scenario,
        frame,
        replyBody,
        result: 'acknowledged',
        receipt,
      }));
      finish({ ok: true, exitCode: 0, reason: 'MARKDOWN_REPLY_ACKNOWLEDGED' });
    } catch (error) {
      const capture = createMarkdownCapture({
        scenario: options.scenario,
        frame,
        replyBody,
        result: 'rejected',
        error,
      });
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'MARKDOWN_REPLY_REJECTED', errorCode: capture.result.error_code });
    }
  }

  async function dispatchMedia(frame, fixture, source) {
    if (!Buffer.isBuffer(fixture.bytes) || fixture.bytes.length === 0) {
      finish({ ok: false, exitCode: 2, reason: 'MEDIA_FIXTURE_INVALID', errorCode: 'G0_REPLY_MEDIA_FIXTURE_INVALID' });
      return;
    }
    writeEvent('media_upload_attempted', { media_type: fixture.type, byte_size: fixture.bytes.length });
    let upload;
    try {
      upload = await client.uploadMedia(fixture.bytes, { type: fixture.type, filename: fixture.filename });
      if (typeof upload?.media_id !== 'string' || upload.media_id.length === 0) {
        throw localFailure('G0_REPLY_MEDIA_REFERENCE_INVALID');
      }
      await writeCapture(createMediaUploadCapture({
        scenario: options.scenario,
        frame,
        fixture,
        result: 'acknowledged',
        upload,
        source,
      }));
    } catch (error) {
      const capture = createMediaUploadCapture({
        scenario: options.scenario,
        frame,
        fixture,
        result: 'rejected',
        error,
        source,
      });
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'MEDIA_UPLOAD_REJECTED', errorCode: capture.result.error_code });
      return;
    }

    writeEvent('media_reply_attempted', { media_type: fixture.type });
    try {
      const receipt = await client.replyMedia(frame, fixture.type, upload.media_id, mediaReplyOptions(fixture.type));
      await writeCapture(createMediaReplyCapture({
        scenario: options.scenario,
        frame,
        fixture,
        mediaId: upload.media_id,
        result: 'acknowledged',
        receipt,
        source,
      }));
      finish({ ok: true, exitCode: 0, reason: 'MEDIA_REPLY_ACKNOWLEDGED' });
    } catch (error) {
      const capture = createMediaReplyCapture({
        scenario: options.scenario,
        frame,
        fixture,
        mediaId: upload.media_id,
        result: 'rejected',
        error,
        source,
      });
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'MEDIA_REPLY_REJECTED', errorCode: capture.result.error_code });
    }
  }

  async function dispatchVideoEcho(frame) {
    let fixture;
    try {
      fixture = await createVideoEchoFixture({
        frame,
        downloadFile: client.downloadFile.bind(client),
        downloadTimeoutMs: options.downloadTimeoutMs,
      });
      await writeCapture(createVideoDownloadCapture({
        scenario: options.scenario,
        frame,
        fixture,
        result: 'success',
      }));
    } catch (error) {
      const capture = createVideoDownloadCapture({
        scenario: options.scenario,
        frame,
        result: 'failed',
        error,
      });
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'VIDEO_DOWNLOAD_FAILED', errorCode: capture.result.error_code });
      return;
    }
    await dispatchMedia(frame, fixture, { source: 'inbound_video', reuploaded_in_memory: true });
  }

  async function handleWelcome(frame) {
    if (stopping || actionStarted || options.expected.trigger !== 'enter_chat') return;
    if (eventTypeOf(frame) !== 'enter_chat' || !isSingleOrUnspecifiedEnterChat(frame)) return;
    actionStarted = true;
    await dispatchWelcome(frame);
  }

  async function handleText(frame) {
    if (stopping || actionStarted || options.expected.trigger !== 'text') return;
    const content = frame?.body?.text?.content;
    if (!isSingleChat(frame) || content !== options.expected.trigger_token) {
      writeEvent('message_ignored', { reason: !isSingleChat(frame) ? 'CHAT_TYPE_MISMATCH' : 'TRIGGER_TOKEN_MISMATCH' });
      return;
    }
    actionStarted = true;
    if (options.expected.reply_kind === 'stream') {
      await dispatchStream(frame);
      return;
    }
    if (options.expected.reply_kind === 'markdown') {
      await dispatchMarkdown(frame);
      return;
    }
    if (options.expected.reply_kind === 'media') {
      await dispatchMedia(frame, createReplyFixture(options.scenario));
    }
  }

  async function handleVideo(frame) {
    if (stopping || actionStarted || options.expected.trigger !== 'video') return;
    if (!isSingleChat(frame)) {
      writeEvent('message_ignored', { reason: 'CHAT_TYPE_MISMATCH' });
      return;
    }
    actionStarted = true;
    await dispatchVideoEcho(frame);
  }

  async function handleFeedback(frame) {
    if (stopping || !awaitingFeedback || feedbackHandling || eventTypeOf(frame) !== 'feedback_event') return;
    const extracted = feedbackEventData(frame?.body ?? {});
    if (extracted.data.id !== expectedFeedbackId) {
      writeEvent('feedback_ignored', { reason: 'FEEDBACK_ID_MISMATCH' });
      return;
    }
    feedbackHandling = true;
    writeEvent('feedback_empty_reply_attempted');
    try {
      // 101835 所称“空包”用省略 body 字段表示；SDK 会在 JSON 序列化时省略 undefined。
      const receipt = await client.reply(frame, undefined);
      await writeCapture(createFeedbackCapture({
        scenario: options.scenario,
        frame,
        expectedFeedbackId,
        bodyOmitted: true,
        result: 'acknowledged',
        receipt,
      }));
      finish({ ok: true, exitCode: 0, reason: 'STREAM_AND_FEEDBACK_ACKNOWLEDGED' });
    } catch (error) {
      const capture = createFeedbackCapture({
        scenario: options.scenario,
        frame,
        expectedFeedbackId,
        bodyOmitted: true,
        result: 'rejected',
        error,
      });
      await writeCapture(capture);
      // 平台拒绝也是本 G0 场景的明确能力结论，不把它伪装成连接或探针故障。
      finish({ ok: true, exitCode: 0, reason: 'FEEDBACK_EMPTY_REPLY_REJECTED', errorCode: capture.result.error_code });
    }
  }

  client.on('authenticated', () => {
    writeEvent('reply_ready', {
      trigger: options.expected.trigger,
      reply_kind: options.expected.reply_kind,
      timeout_ms: options.timeoutMs,
    });
  });
  client.on('message.text', (frame) => {
    void handleText(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'TEXT_HANDLER_FAILED', errorCode: 'WECOM_REPLY_FAILED' }));
  });
  client.on('message.video', (frame) => {
    void handleVideo(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'VIDEO_HANDLER_FAILED', errorCode: 'WECOM_REPLY_FAILED' }));
  });
  client.on('event.enter_chat', (frame) => {
    void handleWelcome(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'WELCOME_HANDLER_FAILED', errorCode: 'WECOM_REPLY_FAILED' }));
  });
  client.on('event.feedback_event', (frame) => {
    void handleFeedback(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'FEEDBACK_HANDLER_FAILED', errorCode: 'WECOM_REPLY_FAILED' }));
  });
  client.on('event', (frame) => {
    if (eventTypeOf(frame) === 'enter_chat') {
      void handleWelcome(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'WELCOME_HANDLER_FAILED', errorCode: 'WECOM_REPLY_FAILED' }));
    }
    if (eventTypeOf(frame) === 'feedback_event') {
      void handleFeedback(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'FEEDBACK_HANDLER_FAILED', errorCode: 'WECOM_REPLY_FAILED' }));
    }
  });
  client.on('error', (error) => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'SDK_ERROR', errorCode: classifyError(error) });
  });
  client.on('disconnected', () => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'DISCONNECTED_BEFORE_RESULT', errorCode: 'WECOM_REPLY_DISCONNECTED' });
  });

  timeout = setTimeoutFn(() => {
    finish({ ok: false, exitCode: 3, reason: 'REPLY_TIMEOUT', errorCode: 'WECOM_REPLY_TIMEOUT' });
  }, options.timeoutMs);
  writeEvent('connect_requested', { timeout_ms: options.timeoutMs });
  try {
    client.connect();
  } catch {
    finish({ ok: false, exitCode: 2, reason: 'CONNECT_THROWN', errorCode: 'WECOM_CONNECT_FAILED' });
  }

  return {
    completion,
    stop: (reason = 'MANUAL_STOP') => finish({ ok: true, exitCode: 0, reason }),
  };
}

async function main() {
  let options;
  let config;
  try {
    options = parseReplyArgs(process.argv.slice(2));
    config = validateRuntimeConfig(process.env);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'G0_REPLY_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }

  const writeEvent = (event, extra = {}) => {
    console.log(JSON.stringify({
      test_id: TEST_ID,
      at_utc: new Date().toISOString(),
      sdk_version: SDK_VERSION,
      scenario: options.scenario,
      event,
      ...extra,
    }));
  };
  const client = new AiBot.WSClient({
    botId: config.botId,
    secret: config.secret,
    wsUrl: config.wsUrl,
    logger: createSafeSdkLogger({ onHeartbeatTimerStarted: () => {} }),
  });
  const probe = runReplyProbe({
    client,
    options,
    writeCapture: (capture) => appendReplyCapture(options.outputPath, capture),
    writeEvent,
  });
  process.once('SIGINT', () => probe.stop('SIGINT'));
  process.once('SIGTERM', () => probe.stop('SIGTERM'));
  const result = await probe.completion;
  writeEvent('probe_finished', result);
  process.exitCode = result.exit_code;
  setTimeout(() => process.exit(), 1_000).unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
