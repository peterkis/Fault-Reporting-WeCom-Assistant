import { appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';
import {
  SDK_VERSION,
  classifyError,
  createSafeSdkLogger,
  validateRuntimeConfig,
} from './g0-002-sdk-lifecycle.mjs';

const TEST_ID = 'G0-004';
const DEFAULT_OUTPUT = 'evidence/g0-004-media-captures.jsonl';
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const MAX_CONFIGURABLE_MEDIA_BYTES = 100 * 1024 * 1024;

const SCENARIOS = Object.freeze({
  image_direct: { eventType: 'image', chatType: 'single' },
  image_group: { eventType: 'image', chatType: 'group' },
  mixed_direct: { eventType: 'mixed', chatType: 'single' },
  mixed_group: { eventType: 'mixed', chatType: 'group' },
  voice_direct: { eventType: 'voice', chatType: 'single' },
  file_direct: { eventType: 'file', chatType: 'single' },
  file_group: { eventType: 'file', chatType: 'group' },
  video_direct: { eventType: 'video', chatType: 'single' },
});

export const INBOUND_MEDIA_EVENT_TYPES = Object.freeze(['image', 'mixed', 'voice', 'file', 'video']);

function hashValue(value, length = 16) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function hashBuffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

function byteLength(value) {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
}

function safeExtension(filename) {
  if (typeof filename !== 'string') return null;
  const extension = extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : null;
}

function filenameShape(filename) {
  return {
    present: typeof filename === 'string' && filename.length > 0,
    hash: hashValue(filename),
    extension: safeExtension(filename),
  };
}

function detectMediaMagic(buffer) {
  const mp4Brands = ['isom', 'iso2', 'avc1', 'mp41', 'mp42', 'mp71', 'M4V '];
  if (
    buffer.length >= 12
    && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    && mp4Brands.includes(buffer.subarray(8, 12).toString('ascii'))
  ) {
    return { kind: 'mp4', mime_type: 'video/mp4' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'png', mime_type: 'image/png' };
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { kind: 'jpeg', mime_type: 'image/jpeg' };
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
    return { kind: 'gif', mime_type: 'image/gif' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { kind: 'webp', mime_type: 'image/webp' };
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { kind: 'pdf', mime_type: 'application/pdf' };
  }
  return { kind: 'unknown', mime_type: 'application/octet-stream' };
}

function mediaReferences(body, eventType) {
  if (eventType === 'image') {
    return [{ source: 'image', content: body?.image }];
  }
  if (eventType === 'file' || eventType === 'video') {
    return [{ source: eventType, content: body?.[eventType] }];
  }
  if (eventType === 'mixed') {
    return (Array.isArray(body?.mixed?.msg_item) ? body.mixed.msg_item : [])
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item?.msgtype === 'image')
      .map(({ item, index }) => ({ source: `mixed_image_${index}`, content: item.image }));
  }
  return [];
}

function mixedShape(mixed) {
  const items = Array.isArray(mixed?.msg_item) ? mixed.msg_item : [];
  return {
    item_count: items.length,
    text_item_count: items.filter((item) => item?.msgtype === 'text').length,
    image_item_count: items.filter((item) => item?.msgtype === 'image').length,
    text_length_bytes: items.reduce((total, item) => total + byteLength(item?.text?.content), 0),
  };
}

function voiceTranscriptShape(voice) {
  return {
    content_present: typeof voice?.content === 'string',
    content_length_bytes: byteLength(voice?.content),
  };
}

export function sanitizeMediaFrame(frame, scenario) {
  const body = frame?.body ?? {};
  const eventType = typeof body.msgtype === 'string' ? body.msgtype : null;
  const references = mediaReferences(body, eventType).map((reference) => ({
    source: reference.source,
    url_present: typeof reference.content?.url === 'string',
    aeskey_present: typeof reference.content?.aeskey === 'string',
  }));

  return {
    test_id: TEST_ID,
    schema_version: 1,
    observed_at_utc: new Date().toISOString(),
    scenario,
    frame: {
      cmd: typeof frame?.cmd === 'string' ? frame.cmd : null,
      header_field_names: Object.keys(frame?.headers ?? {}).sort(),
      req_id_hash: hashValue(frame?.headers?.req_id),
    },
    message: {
      field_names: Object.keys(body).sort(),
      msg_id_hash: hashValue(body.msgid),
      bot_id_hash: hashValue(body.aibotid),
      chat_type: typeof body.chattype === 'string' ? body.chattype : null,
      chat_id_present: typeof body.chatid === 'string',
      chat_id_hash: hashValue(body.chatid),
      sender_user_id_hash: hashValue(body.from?.userid),
      message_type: eventType,
      create_time_present: Number.isFinite(body.create_time),
      voice_transcript: eventType === 'voice' ? voiceTranscriptShape(body.voice) : null,
    },
    media: {
      mixed: eventType === 'mixed' ? mixedShape(body.mixed) : null,
      references,
      downloads: [],
    },
    privacy: {
      original_text_recorded: false,
      original_voice_transcript_recorded: false,
      original_identifier_recorded: false,
      media_url_recorded: false,
      aeskey_recorded: false,
      original_filename_recorded: false,
      media_file_persisted: false,
    },
  };
}

function failure(code, stage) {
  const error = new Error(code);
  error.code = code;
  error.stage = stage;
  return error;
}

export async function downloadFileWithTimeout(downloadFile, url, aesKey, timeoutMs) {
  const downloadPromise = Promise.resolve().then(() => downloadFile(url, aesKey));
  // The SDK's axios request cannot accept an AbortSignal. Consume a late rejection after our
  // evidence deadline so it cannot emit an unhandled rejection or leak its message.
  downloadPromise.catch(() => {});
  let timeout;
  try {
    return await Promise.race([
      downloadPromise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(failure('G0_MEDIA_DOWNLOAD_TIMEOUT', 'timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function classifyMediaError(error) {
  if (error?.code === 'G0_MEDIA_DOWNLOAD_TIMEOUT' || error?.stage === 'timeout') {
    return { error_code: 'WECOM_MEDIA_DOWNLOAD_FAILED', failure_stage: 'timeout' };
  }
  if (error?.code === 'G0_MEDIA_REFERENCE_INVALID') {
    return { error_code: 'WECOM_INVALID_FRAME', failure_stage: 'reference' };
  }
  const text = String(error?.message ?? error ?? '');
  if (/decrypt|aes|padding|cipher|invalid key length/i.test(text)) {
    return { error_code: 'WECOM_MEDIA_DECRYPT_FAILED', failure_stage: 'decrypt' };
  }
  return { error_code: 'WECOM_MEDIA_DOWNLOAD_FAILED', failure_stage: 'download' };
}

function selectAesKey(aesKey, mode) {
  return mode === 'invalid' ? 'AQ==' : aesKey;
}

export async function downloadReference({ reference, downloadFile, aeskeyMode, downloadTimeoutMs, maxMediaBytes }) {
  const url = reference?.content?.url;
  const aesKey = reference?.content?.aeskey;
  const startedAt = Date.now();
  if (typeof url !== 'string' || url.length === 0 || typeof aesKey !== 'string' || aesKey.length === 0) {
    const details = classifyMediaError(failure('G0_MEDIA_REFERENCE_INVALID', 'reference'));
    return { source: reference?.source ?? 'unknown', status: 'failed', duration_ms: Date.now() - startedAt, ...details };
  }

  try {
    const { buffer, filename } = await downloadFileWithTimeout(
      downloadFile,
      url,
      selectAesKey(aesKey, aeskeyMode),
      downloadTimeoutMs,
    );
    if (!Buffer.isBuffer(buffer)) {
      throw failure('G0_MEDIA_DOWNLOAD_INVALID_BUFFER', 'download');
    }
    const magic = detectMediaMagic(buffer);
    return {
      source: reference.source,
      status: 'success',
      duration_ms: Date.now() - startedAt,
      byte_size: buffer.length,
      sha256: hashBuffer(buffer),
      filename: filenameShape(filename),
      magic,
      size_within_limit: buffer.length <= maxMediaBytes,
    };
  } catch (error) {
    return {
      source: reference.source,
      status: 'failed',
      duration_ms: Date.now() - startedAt,
      ...classifyMediaError(error),
    };
  }
}

export async function buildMediaCapture({ frame, scenario, downloadFile, aeskeyMode, downloadTimeoutMs, maxMediaBytes }) {
  const capture = sanitizeMediaFrame(frame, scenario);
  const references = mediaReferences(frame?.body ?? {}, capture.message.message_type);
  capture.media.downloads = await Promise.all(references.map((reference) => downloadReference({
    reference,
    downloadFile,
    aeskeyMode,
    downloadTimeoutMs,
    maxMediaBytes,
  })));
  capture.media.download_success_count = capture.media.downloads.filter((item) => item.status === 'success').length;
  capture.media.download_failure_count = capture.media.downloads.filter((item) => item.status === 'failed').length;
  return capture;
}

export function parseMediaCaptureArgs(argv) {
  const readValue = (name, fallback) => {
    const argument = argv.find((item) => item.startsWith(`${name}=`));
    return argument ? argument.slice(name.length + 1) : fallback;
  };
  const scenario = readValue('--scenario', null);
  const timeoutMs = Number(readValue('--timeout-ms', String(DEFAULT_TIMEOUT_MS)));
  const downloadTimeoutMs = Number(readValue('--download-timeout-ms', String(DEFAULT_DOWNLOAD_TIMEOUT_MS)));
  const maxMediaBytes = Number(readValue('--max-media-bytes', String(DEFAULT_MAX_MEDIA_BYTES)));
  const aeskeyMode = readValue('--aeskey-mode', 'actual');
  const output = readValue('--output', DEFAULT_OUTPUT);

  if (!Object.hasOwn(SCENARIOS, scenario)) {
    throw new Error('G0_MEDIA_INVALID_SCENARIO');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000) {
    throw new Error('G0_MEDIA_INVALID_TIMEOUT');
  }
  if (!Number.isInteger(downloadTimeoutMs) || downloadTimeoutMs < 100 || downloadTimeoutMs > 60_000) {
    throw new Error('G0_MEDIA_INVALID_DOWNLOAD_TIMEOUT');
  }
  if (!Number.isInteger(maxMediaBytes) || maxMediaBytes < 1_024 || maxMediaBytes > MAX_CONFIGURABLE_MEDIA_BYTES) {
    throw new Error('G0_MEDIA_INVALID_MAX_BYTES');
  }
  if (!['actual', 'invalid'].includes(aeskeyMode)) {
    throw new Error('G0_MEDIA_INVALID_AESKEY_MODE');
  }

  const evidenceRoot = resolve(process.cwd(), 'evidence');
  const outputPath = resolve(process.cwd(), output);
  const outputRelative = relative(evidenceRoot, outputPath);
  if (!outputRelative || outputRelative.startsWith('..') || !outputPath.endsWith('.jsonl')) {
    throw new Error('G0_MEDIA_INVALID_OUTPUT');
  }
  return {
    scenario,
    expected: SCENARIOS[scenario],
    timeoutMs,
    downloadTimeoutMs,
    maxMediaBytes,
    aeskeyMode,
    outputPath,
  };
}

export async function appendMediaCapture(outputPath, capture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(capture)}\n`, { encoding: 'utf8' });
}

export function captureExitCode(capture, aeskeyMode) {
  if (capture.message.message_type === 'voice') {
    return capture.message.voice_transcript?.content_present ? 0 : 2;
  }
  const successfulDownloads = capture.media.download_success_count;
  const decryptFailures = capture.media.downloads.filter((item) => item.error_code === 'WECOM_MEDIA_DECRYPT_FAILED').length;
  if (aeskeyMode === 'invalid') return decryptFailures > 0 ? 0 : 2;
  return successfulDownloads > 0 ? 0 : 2;
}

async function main() {
  let options;
  let config;
  try {
    options = parseMediaCaptureArgs(process.argv.slice(2));
    config = validateRuntimeConfig(process.env);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'G0_MEDIA_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }

  let stopping = false;
  let heartbeatTimerStarted = false;
  let timeout;
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
    logger: createSafeSdkLogger({
      onHeartbeatTimerStarted: () => {
        heartbeatTimerStarted = true;
      },
    }),
  });

  function stop(reason, exitCode) {
    if (stopping) return;
    stopping = true;
    clearTimeout(timeout);
    writeEvent('disconnect_requested', { reason, heartbeat_timer_started: heartbeatTimerStarted });
    client.disconnect();
    process.exitCode = exitCode;
    setTimeout(() => process.exit(), 1_000).unref();
  }

  async function handleMediaFrame(eventType, frame) {
    if (stopping) return;
    const actualChatType = frame?.body?.chattype;
    if (eventType !== options.expected.eventType || actualChatType !== options.expected.chatType) {
      writeEvent('media_frame_ignored', { event_type: eventType, chat_type: typeof actualChatType === 'string' ? actualChatType : null });
      return;
    }
    stopping = true;
    clearTimeout(timeout);
    try {
      const capture = await buildMediaCapture({
        frame,
        scenario: options.scenario,
        downloadFile: client.downloadFile.bind(client),
        aeskeyMode: options.aeskeyMode,
        downloadTimeoutMs: options.downloadTimeoutMs,
        maxMediaBytes: options.maxMediaBytes,
      });
      await appendMediaCapture(options.outputPath, capture);
      const exitCode = captureExitCode(capture, options.aeskeyMode);
      writeEvent('media_frame_captured', {
        event_type: eventType,
        chat_type: capture.message.chat_type,
        download_success_count: capture.media.download_success_count,
        download_failure_count: capture.media.download_failure_count,
        exit_code: exitCode,
      });
      client.disconnect();
      process.exitCode = exitCode;
      setTimeout(() => process.exit(), 1_000).unref();
    } catch {
      writeEvent('capture_error', { error_code: 'WECOM_MEDIA_DOWNLOAD_FAILED' });
      client.disconnect();
      process.exitCode = 2;
      setTimeout(() => process.exit(), 1_000).unref();
    }
  }

  client.on('authenticated', () => {
    writeEvent('capture_ready', {
      expected_event_type: options.expected.eventType,
      expected_chat_type: options.expected.chatType,
      aeskey_mode: options.aeskeyMode,
    });
  });
  for (const eventType of INBOUND_MEDIA_EVENT_TYPES) {
    client.on(`message.${eventType}`, (frame) => {
      void handleMediaFrame(eventType, frame);
    });
  }
  client.on('error', (error) => {
    if (stopping) return;
    writeEvent('capture_error', { error_code: classifyError(error) });
    stop('SDK_ERROR', 2);
  });
  client.on('disconnected', () => {
    writeEvent('disconnected');
  });
  process.once('SIGINT', () => stop('SIGINT', 0));
  process.once('SIGTERM', () => stop('SIGTERM', 0));

  timeout = setTimeout(() => stop('CAPTURE_TIMEOUT', 3), options.timeoutMs);
  writeEvent('connect_requested', {
    timeout_ms: options.timeoutMs,
    download_timeout_ms: options.downloadTimeoutMs,
    max_media_bytes: options.maxMediaBytes,
  });
  client.connect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
