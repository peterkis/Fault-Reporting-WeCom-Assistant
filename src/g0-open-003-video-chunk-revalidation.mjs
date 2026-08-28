import { appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AiBot, { WsCmd, generateReqId } from '@wecom/aibot-node-sdk';
import { downloadFileWithTimeout } from './g0-004-media-capture.mjs';
import {
  SDK_VERSION,
  classifyError,
  createSafeSdkLogger,
  validateRuntimeConfig,
} from './g0-002-sdk-lifecycle.mjs';

const TEST_ID = 'G0-OPEN-003';
const SCENARIO = 'video_chunk_echo';
const DEFAULT_OUTPUT = 'evidence/g0-open-003-video-chunk-revalidation.jsonl';
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const CHUNK_BYTES = 512 * 1024;
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
const MAX_CHUNKS = 100;
const SAFE_FILENAME = 'g0-open-003-video-chunk.mp4';

function readArgument(argv, name, fallback) {
  const argument = argv.find((item) => item.startsWith(`${name}=`));
  return argument ? argument.slice(name.length + 1) : fallback;
}

function assertIntegerRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`G0_OPEN_003_INVALID_${name}`);
  }
}

function isOutputInsideEvidence(outputPath) {
  const evidenceRoot = resolve(process.cwd(), 'evidence');
  const outputRelativePath = relative(evidenceRoot, outputPath);
  return outputRelativePath.length > 0 && !outputRelativePath.startsWith('..') && !isAbsolute(outputRelativePath);
}

function localFailure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function providerErrorCode(error) {
  return Number.isInteger(error?.errcode) ? error.errcode : null;
}

function classifyProtocolError(error) {
  if (error?.code === 'G0_OPEN_003_VIDEO_REFERENCE_INVALID') return 'WECOM_VIDEO_REFERENCE_INVALID';
  if (error?.code === 'G0_OPEN_003_VIDEO_FORMAT_INVALID') return 'WECOM_VIDEO_FORMAT_INVALID';
  if (error?.code === 'G0_OPEN_003_VIDEO_TOO_LARGE') return 'WECOM_VIDEO_SIZE_EXCEEDED';
  if (error?.code === 'G0_OPEN_003_TARGET_TOO_SMALL') return 'WECOM_VIDEO_TARGET_TOO_SMALL';
  if (error?.code === 'G0_OPEN_003_TARGET_PADDING_INVALID') return 'WECOM_VIDEO_TARGET_PADDING_INVALID';
  if (error?.code === 'G0_OPEN_003_TRANSPORT_UNAVAILABLE') return 'WECOM_UPLOAD_TRANSPORT_UNAVAILABLE';
  if (error?.code === 'G0_MEDIA_DOWNLOAD_TIMEOUT') return 'WECOM_MEDIA_DOWNLOAD_TIMEOUT';
  if (Number.isInteger(error?.errcode)) return 'WECOM_UPLOAD_REJECTED';
  if (/timeout|timed out/i.test(String(error?.message ?? error ?? ''))) return 'WECOM_UPLOAD_ACK_TIMEOUT';
  return 'WECOM_UPLOAD_FAILED';
}

function hashBuffer(value) {
  return Buffer.isBuffer(value) ? createHash('sha256').update(value).digest('hex') : null;
}

function isSingleChat(frame) {
  return frame?.body?.chattype === 'single';
}

function callbackShape(frame) {
  const body = frame?.body ?? {};
  return {
    cmd: typeof frame?.cmd === 'string' ? frame.cmd : null,
    header_field_names: Object.keys(frame?.headers ?? {}).sort(),
    body_field_names: Object.keys(body).sort(),
    chat_type: typeof body.chattype === 'string' ? body.chattype : null,
    message_type: typeof body.msgtype === 'string' ? body.msgtype : null,
    callback_req_id_recorded: false,
    original_identifier_recorded: false,
  };
}

function privacy() {
  return {
    upload_id_recorded: false,
    media_id_recorded: false,
    callback_req_id_recorded: false,
    media_url_recorded: false,
    aeskey_recorded: false,
    original_filename_recorded: false,
    raw_base64_recorded: false,
    media_file_persisted: false,
    sdk_error_text_recorded: false,
  };
}

function baseCapture(kind, frame) {
  return {
    test_id: TEST_ID,
    schema_version: 1,
    observed_at_utc: new Date().toISOString(),
    scenario: SCENARIO,
    kind,
    inbound: callbackShape(frame),
    privacy: privacy(),
  };
}

function mediaMetadata(fixture) {
  return {
    media_type: 'video',
    original_byte_size: fixture.originalByteSize,
    byte_size: fixture.bytes.length,
    sha256: hashBuffer(fixture.bytes),
    filename_extension: '.mp4',
    safe_generated_filename_used: true,
    source_processed_in_memory: true,
    synthetic_padding_bytes: fixture.syntheticPaddingBytes,
    synthetic_padding_test_only: fixture.syntheticPaddingBytes > 0,
  };
}

function durationMs(now, startedAt) {
  return Math.max(0, now() - startedAt);
}

export function buildChunkPlan(totalSize) {
  assertIntegerRange(totalSize, 'TOTAL_SIZE', 1, MAX_VIDEO_BYTES);
  const totalChunks = Math.ceil(totalSize / CHUNK_BYTES);
  if (totalChunks > MAX_CHUNKS) throw localFailure('G0_OPEN_003_VIDEO_TOO_LARGE');
  return Array.from({ length: totalChunks }, (_, chunkIndex) => {
    const start = chunkIndex * CHUNK_BYTES;
    const end = Math.min(start + CHUNK_BYTES, totalSize);
    return {
      chunk_index: chunkIndex,
      start,
      end,
      byte_size: end - start,
      is_last: chunkIndex === totalChunks - 1,
    };
  });
}

export function isMp4Buffer(buffer) {
  const allowedBrands = new Set(['isom', 'iso2', 'avc1', 'mp41', 'mp42', 'mp71', 'M4V ']);
  return Buffer.isBuffer(buffer)
    && buffer.length >= 12
    && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    && allowedBrands.has(buffer.subarray(8, 12).toString('ascii'));
}

export function prepareVideoFixture(inputBytes, targetBytes = null) {
  if (!Buffer.isBuffer(inputBytes) || inputBytes.length === 0) {
    throw localFailure('G0_OPEN_003_VIDEO_REFERENCE_INVALID');
  }
  if (!isMp4Buffer(inputBytes)) throw localFailure('G0_OPEN_003_VIDEO_FORMAT_INVALID');
  if (inputBytes.length > MAX_VIDEO_BYTES) throw localFailure('G0_OPEN_003_VIDEO_TOO_LARGE');

  if (targetBytes === null || targetBytes === inputBytes.length) {
    return {
      bytes: inputBytes,
      originalByteSize: inputBytes.length,
      syntheticPaddingBytes: 0,
    };
  }
  if (targetBytes < inputBytes.length) throw localFailure('G0_OPEN_003_TARGET_TOO_SMALL');
  if (targetBytes > MAX_VIDEO_BYTES) throw localFailure('G0_OPEN_003_VIDEO_TOO_LARGE');

  const paddingBytes = targetBytes - inputBytes.length;
  if (paddingBytes < 8) throw localFailure('G0_OPEN_003_TARGET_PADDING_INVALID');

  // ISO BMFF permits a top-level free box. This is an explicit G0 test fixture only;
  // no production reply path may pad, transcode, or otherwise alter user media.
  const freeBox = Buffer.alloc(paddingBytes);
  freeBox.writeUInt32BE(paddingBytes, 0);
  freeBox.write('free', 4, 'ascii');
  return {
    bytes: Buffer.concat([inputBytes, freeBox]),
    originalByteSize: inputBytes.length,
    syntheticPaddingBytes: paddingBytes,
  };
}

function createPreparedCapture({ frame, fixture }) {
  return {
    ...baseCapture('video_prepared', frame),
    media: mediaMetadata(fixture),
    result: { status: 'ready' },
  };
}

function createStageCapture({ frame, fixture, kind, command, result, duration, details = {}, error }) {
  return {
    ...baseCapture(kind, frame),
    media: mediaMetadata(fixture),
    protocol: {
      command,
      sequence: 'init_then_serial_ascending_chunks_then_finish',
      chunk_size_limit_bytes: CHUNK_BYTES,
      total_chunks: buildChunkPlan(fixture.bytes.length).length,
      request_id_generated_for_command: true,
      raw_request_id_recorded: false,
      raw_upload_id_recorded: false,
      ...details,
    },
    result: {
      status: result,
      duration_ms: duration,
      ...(error ? { error_code: classifyProtocolError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function requireUploadTransport(client) {
  const transport = client?.wsManager;
  if (!transport || typeof transport.sendReply !== 'function') {
    throw localFailure('G0_OPEN_003_TRANSPORT_UNAVAILABLE');
  }
  return transport.sendReply.bind(transport);
}

export async function uploadVideoInDocumentedLayers({
  frame,
  fixture,
  sendReply,
  writeCapture,
  createRequestId = generateReqId,
  now = Date.now,
}) {
  if (typeof sendReply !== 'function') throw localFailure('G0_OPEN_003_TRANSPORT_UNAVAILABLE');
  const plan = buildChunkPlan(fixture.bytes.length);
  const usedRequestIds = new Set();
  const nextRequestId = (command) => {
    const requestId = createRequestId(command);
    if (typeof requestId !== 'string' || requestId.length === 0 || usedRequestIds.has(requestId)) {
      throw localFailure('G0_OPEN_003_TRANSPORT_UNAVAILABLE');
    }
    usedRequestIds.add(requestId);
    return requestId;
  };
  const md5 = createHash('md5').update(fixture.bytes).digest('hex');
  let uploadId;

  const initStartedAt = now();
  try {
    const initReceipt = await sendReply(
      nextRequestId(WsCmd.UPLOAD_MEDIA_INIT),
      {
        type: 'video',
        filename: SAFE_FILENAME,
        total_size: fixture.bytes.length,
        total_chunks: plan.length,
        md5,
      },
      WsCmd.UPLOAD_MEDIA_INIT,
    );
    uploadId = initReceipt?.body?.upload_id;
    if (typeof uploadId !== 'string' || uploadId.length === 0) {
      throw localFailure('G0_OPEN_003_TRANSPORT_UNAVAILABLE');
    }
    await writeCapture(createStageCapture({
      frame,
      fixture,
      kind: 'upload_init',
      command: WsCmd.UPLOAD_MEDIA_INIT,
      result: 'acknowledged',
      duration: durationMs(now, initStartedAt),
      details: {
        md5_supplied: true,
        total_size_matches_fixture: true,
        upload_id_received: true,
      },
    }));
  } catch (error) {
    await writeCapture(createStageCapture({
      frame,
      fixture,
      kind: 'upload_init',
      command: WsCmd.UPLOAD_MEDIA_INIT,
      result: 'rejected',
      duration: durationMs(now, initStartedAt),
      details: { md5_supplied: true, upload_id_received: false },
      error,
    }));
    return { ok: false, stage: 'init', errorCode: classifyProtocolError(error) };
  }

  for (const chunk of plan) {
    const rawChunk = fixture.bytes.subarray(chunk.start, chunk.end);
    const base64Data = rawChunk.toString('base64');
    const chunkStartedAt = now();
    try {
      await sendReply(
        nextRequestId(WsCmd.UPLOAD_MEDIA_CHUNK),
        { upload_id: uploadId, chunk_index: chunk.chunk_index, base64_data: base64Data },
        WsCmd.UPLOAD_MEDIA_CHUNK,
      );
      await writeCapture(createStageCapture({
        frame,
        fixture,
        kind: 'upload_chunk',
        command: WsCmd.UPLOAD_MEDIA_CHUNK,
        result: 'acknowledged',
        duration: durationMs(now, chunkStartedAt),
        details: {
          chunk_index: chunk.chunk_index,
          chunk_byte_size: rawChunk.length,
          chunk_base64_length: base64Data.length,
          chunk_within_512kb_limit: rawChunk.length <= CHUNK_BYTES,
          is_last_chunk: chunk.is_last,
          upload_id_reused_from_init: true,
          transmission_mode: 'serial',
          retry_attempt: 1,
        },
      }));
    } catch (error) {
      await writeCapture(createStageCapture({
        frame,
        fixture,
        kind: 'upload_chunk',
        command: WsCmd.UPLOAD_MEDIA_CHUNK,
        result: 'rejected',
        duration: durationMs(now, chunkStartedAt),
        details: {
          chunk_index: chunk.chunk_index,
          chunk_byte_size: rawChunk.length,
          chunk_base64_length: base64Data.length,
          chunk_within_512kb_limit: rawChunk.length <= CHUNK_BYTES,
          is_last_chunk: chunk.is_last,
          upload_id_reused_from_init: true,
          transmission_mode: 'serial',
          retry_attempt: 1,
        },
        error,
      }));
      return { ok: false, stage: 'chunk', chunkIndex: chunk.chunk_index, errorCode: classifyProtocolError(error) };
    }
  }

  const finishStartedAt = now();
  try {
    const finishReceipt = await sendReply(
      nextRequestId(WsCmd.UPLOAD_MEDIA_FINISH),
      { upload_id: uploadId },
      WsCmd.UPLOAD_MEDIA_FINISH,
    );
    const mediaId = finishReceipt?.body?.media_id;
    if (typeof mediaId !== 'string' || mediaId.length === 0) {
      throw localFailure('G0_OPEN_003_TRANSPORT_UNAVAILABLE');
    }
    await writeCapture(createStageCapture({
      frame,
      fixture,
      kind: 'upload_finish',
      command: WsCmd.UPLOAD_MEDIA_FINISH,
      result: 'acknowledged',
      duration: durationMs(now, finishStartedAt),
      details: {
        upload_id_reused_from_init: true,
        all_chunks_acknowledged_before_finish: true,
        media_id_received: true,
      },
    }));
    return { ok: true, mediaId };
  } catch (error) {
    await writeCapture(createStageCapture({
      frame,
      fixture,
      kind: 'upload_finish',
      command: WsCmd.UPLOAD_MEDIA_FINISH,
      result: 'rejected',
      duration: durationMs(now, finishStartedAt),
      details: {
        upload_id_reused_from_init: true,
        all_chunks_acknowledged_before_finish: true,
        media_id_received: false,
      },
      error,
    }));
    return { ok: false, stage: 'finish', errorCode: classifyProtocolError(error) };
  }
}

function createReplyCapture({ frame, fixture, result, duration, error }) {
  return {
    ...baseCapture('media_reply', frame),
    media: mediaMetadata(fixture),
    outbound: {
      command: WsCmd.RESPONSE,
      msgtype: 'video',
      callback_req_id_reused: true,
      raw_media_id_recorded: false,
      title_length_bytes: Buffer.byteLength('G0-OPEN-003 分片视频验证', 'utf8'),
      description_length_bytes: Buffer.byteLength('仅限 Gate 0 无敏感测试素材', 'utf8'),
      client_playback_observation: 'pending_manual_confirmation',
    },
    result: {
      status: result,
      duration_ms: duration,
      ...(error ? { error_code: classifyProtocolError(error), provider_errcode: providerErrorCode(error) } : {}),
    },
  };
}

function createDownloadFailureCapture(frame, error) {
  return {
    ...baseCapture('video_prepared', frame),
    result: {
      status: 'rejected',
      error_code: classifyProtocolError(error),
      provider_errcode: providerErrorCode(error),
    },
  };
}

export function parseVideoChunkArgs(argv) {
  const scenario = readArgument(argv, '--scenario', SCENARIO);
  const timeoutMs = Number(readArgument(argv, '--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
  const downloadTimeoutMs = Number(readArgument(argv, '--download-timeout-ms', String(DEFAULT_DOWNLOAD_TIMEOUT_MS)));
  const rawTargetBytes = readArgument(argv, '--target-bytes', null);
  const output = readArgument(argv, '--output', DEFAULT_OUTPUT);
  if (scenario !== SCENARIO) throw new Error('G0_OPEN_003_INVALID_SCENARIO');
  assertIntegerRange(timeoutMs, 'TIMEOUT', 30_000, 1_800_000);
  assertIntegerRange(downloadTimeoutMs, 'DOWNLOAD_TIMEOUT', 100, 120_000);
  const targetBytes = rawTargetBytes === null ? null : Number(rawTargetBytes);
  if (targetBytes !== null) assertIntegerRange(targetBytes, 'TARGET_BYTES', 1, MAX_VIDEO_BYTES);
  const outputPath = resolve(process.cwd(), output);
  if (!isOutputInsideEvidence(outputPath) || !outputPath.endsWith('.jsonl')) {
    throw new Error('G0_OPEN_003_INVALID_OUTPUT');
  }
  return { scenario, timeoutMs, downloadTimeoutMs, targetBytes, outputPath };
}

export async function appendVideoChunkCapture(outputPath, capture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(capture)}\n`, { encoding: 'utf8' });
}

export function runVideoChunkProbe({
  client,
  options,
  writeCapture,
  writeEvent,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  createRequestId = generateReqId,
}) {
  let stopping = false;
  let actionStarted = false;
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
      // The measured result must survive a later disconnect failure.
    }
    completionResolve({ ok, exit_code: exitCode, reason, ...(errorCode ? { error_code: errorCode } : {}) });
  }

  async function handleVideo(frame) {
    if (stopping || actionStarted) return;
    if (!isSingleChat(frame)) {
      writeEvent('message_ignored', { reason: 'CHAT_TYPE_MISMATCH' });
      return;
    }
    actionStarted = true;
    let fixture;
    try {
      const video = frame?.body?.video ?? {};
      if (typeof video.url !== 'string' || video.url.length === 0 || typeof video.aeskey !== 'string' || video.aeskey.length === 0) {
        throw localFailure('G0_OPEN_003_VIDEO_REFERENCE_INVALID');
      }
      const { buffer } = await downloadFileWithTimeout(
        client.downloadFile.bind(client),
        video.url,
        video.aeskey,
        options.downloadTimeoutMs,
      );
      fixture = prepareVideoFixture(buffer, options.targetBytes);
      await writeCapture(createPreparedCapture({ frame, fixture }));
    } catch (error) {
      const capture = createDownloadFailureCapture(frame, error);
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'VIDEO_PREPARATION_REJECTED', errorCode: capture.result.error_code });
      return;
    }

    let upload;
    try {
      upload = await uploadVideoInDocumentedLayers({
        frame,
        fixture,
        sendReply: requireUploadTransport(client),
        writeCapture,
        createRequestId,
        now,
      });
    } catch (error) {
      finish({ ok: false, exitCode: 2, reason: 'UPLOAD_TRANSPORT_FAILED', errorCode: classifyProtocolError(error) });
      return;
    }
    if (!upload.ok) {
      finish({ ok: false, exitCode: 2, reason: `UPLOAD_${upload.stage.toUpperCase()}_REJECTED`, errorCode: upload.errorCode });
      return;
    }

    const replyStartedAt = now();
    try {
      const receipt = await client.replyMedia(frame, 'video', upload.mediaId, {
        title: 'G0-OPEN-003 分片视频验证',
        description: '仅限 Gate 0 无敏感测试素材',
      });
      if (Number.isInteger(receipt?.errcode) && receipt.errcode !== 0) throw receipt;
      await writeCapture(createReplyCapture({
        frame,
        fixture,
        result: 'acknowledged',
        duration: durationMs(now, replyStartedAt),
      }));
      finish({ ok: true, exitCode: 0, reason: 'VIDEO_CHUNK_REPLY_ACKNOWLEDGED' });
    } catch (error) {
      const capture = createReplyCapture({
        frame,
        fixture,
        result: 'rejected',
        duration: durationMs(now, replyStartedAt),
        error,
      });
      await writeCapture(capture);
      finish({ ok: false, exitCode: 2, reason: 'VIDEO_REPLY_REJECTED', errorCode: capture.result.error_code });
    }
  }

  client.on('authenticated', () => {
    writeEvent('video_chunk_probe_ready', {
      timeout_ms: options.timeoutMs,
      target_bytes: options.targetBytes,
      chunk_size_limit_bytes: CHUNK_BYTES,
      transmission_mode: 'serial',
    });
  });
  client.on('message.video', (frame) => {
    void handleVideo(frame).catch(() => finish({ ok: false, exitCode: 2, reason: 'VIDEO_HANDLER_FAILED', errorCode: 'WECOM_UPLOAD_FAILED' }));
  });
  client.on('error', (error) => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'SDK_ERROR', errorCode: classifyError(error) });
  });
  client.on('disconnected', () => {
    if (!stopping) finish({ ok: false, exitCode: 2, reason: 'DISCONNECTED_BEFORE_RESULT', errorCode: 'WECOM_UPLOAD_DISCONNECTED' });
  });

  timeout = setTimeoutFn(() => {
    finish({ ok: false, exitCode: 3, reason: 'PROBE_TIMEOUT', errorCode: 'WECOM_UPLOAD_TIMEOUT' });
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
    options = parseVideoChunkArgs(process.argv.slice(2));
    config = validateRuntimeConfig(process.env);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'G0_OPEN_003_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }
  const writeEvent = (event, extra = {}) => {
    console.log(JSON.stringify({
      test_id: TEST_ID,
      at_utc: new Date().toISOString(),
      sdk_version: SDK_VERSION,
      scenario: SCENARIO,
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
  const probe = runVideoChunkProbe({
    client,
    options,
    writeCapture: (capture) => appendVideoChunkCapture(options.outputPath, capture),
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
