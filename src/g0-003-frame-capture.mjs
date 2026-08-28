import { appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';
import {
  SDK_VERSION,
  classifyError,
  createSafeSdkLogger,
  validateRuntimeConfig,
} from './g0-002-sdk-lifecycle.mjs';

const TEST_ID = 'G0-003';
const SCENARIOS = new Set([
  'direct_text',
  'group_mentioned_text',
  'group_unmentioned_text',
  'quoted_text',
]);
const DEFAULT_OUTPUT = 'evidence/g0-003-frame-captures.jsonl';

function hashValue(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function byteLength(value) {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
}

function quoteShape(quote) {
  if (!quote || typeof quote !== 'object') {
    return { present: false };
  }
  return {
    present: true,
    msg_type: typeof quote.msgtype === 'string' ? quote.msgtype : null,
    field_names: Object.keys(quote).sort(),
    text_present: typeof quote.text?.content === 'string',
    text_length_bytes: byteLength(quote.text?.content),
    image_present: Boolean(quote.image),
    mixed_item_count: Array.isArray(quote.mixed?.msg_item) ? quote.mixed.msg_item.length : 0,
    voice_present: Boolean(quote.voice),
    file_present: Boolean(quote.file),
  };
}

export function sanitizeTextFrame(frame, scenario) {
  const body = frame?.body ?? {};
  const textContent = body.text?.content;
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
      message_type: typeof body.msgtype === 'string' ? body.msgtype : null,
      create_time_present: Number.isFinite(body.create_time),
      text_length_bytes: byteLength(textContent),
      quote: quoteShape(body.quote),
    },
    privacy: {
      original_text_recorded: false,
      original_identifier_recorded: false,
      response_url_recorded: false,
    },
  };
}

export function parseCaptureArgs(argv) {
  const readValue = (name, fallback) => {
    const argument = argv.find((item) => item.startsWith(`${name}=`));
    return argument ? argument.slice(name.length + 1) : fallback;
  };
  const scenario = readValue('--scenario', null);
  const maxMessages = Number(readValue('--max-messages', '1'));
  const timeoutMs = Number(readValue('--timeout-ms', '120000'));
  const output = readValue('--output', DEFAULT_OUTPUT);

  if (!SCENARIOS.has(scenario)) {
    throw new Error('G0_CAPTURE_INVALID_SCENARIO');
  }
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 20) {
    throw new Error('G0_CAPTURE_INVALID_MAX_MESSAGES');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 900_000) {
    throw new Error('G0_CAPTURE_INVALID_TIMEOUT');
  }

  const evidenceRoot = resolve(process.cwd(), 'evidence');
  const outputPath = resolve(process.cwd(), output);
  const isInsideEvidence = relative(evidenceRoot, outputPath) && !relative(evidenceRoot, outputPath).startsWith('..');
  if (!isInsideEvidence || !outputPath.endsWith('.jsonl')) {
    throw new Error('G0_CAPTURE_INVALID_OUTPUT');
  }
  return { scenario, maxMessages, timeoutMs, outputPath };
}

export async function appendCapture(outputPath, capture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, `${JSON.stringify(capture)}\n`, { encoding: 'utf8' });
}

async function main() {
  let options;
  let config;
  try {
    options = parseCaptureArgs(process.argv.slice(2));
    config = validateRuntimeConfig(process.env);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'G0_CAPTURE_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }

  let stopping = false;
  let capturedCount = 0;
  let timeout;
  let heartbeatTimerStarted = false;
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
    writeEvent('disconnect_requested', { reason, captured_count: capturedCount, heartbeat_timer_started: heartbeatTimerStarted });
    client.disconnect();
    process.exitCode = exitCode;
    setTimeout(() => process.exit(), 1_000).unref();
  }

  client.on('authenticated', () => {
    writeEvent('capture_ready', { output: 'evidence/jsonl', max_messages: options.maxMessages });
  });
  client.on('message.text', async (frame) => {
    if (stopping || capturedCount >= options.maxMessages) return;
    try {
      const capture = sanitizeTextFrame(frame, options.scenario);
      await appendCapture(options.outputPath, capture);
      capturedCount += 1;
      writeEvent('text_frame_captured', {
        capture_number: capturedCount,
        chat_type: capture.message.chat_type,
        quote_present: capture.message.quote.present,
      });
      if (capturedCount >= options.maxMessages) {
        stop('CAPTURE_LIMIT_REACHED', 0);
      }
    } catch {
      stop('CAPTURE_WRITE_FAILED', 2);
    }
  });
  client.on('error', (error) => {
    writeEvent('capture_error', { error_code: classifyError(error) });
    stop('SDK_ERROR', 2);
  });
  client.on('disconnected', () => {
    writeEvent('disconnected', { captured_count: capturedCount });
  });
  process.once('SIGINT', () => stop('SIGINT', 0));
  process.once('SIGTERM', () => stop('SIGTERM', 0));

  timeout = setTimeout(() => stop('CAPTURE_TIMEOUT', 3), options.timeoutMs);
  writeEvent('connect_requested', { max_messages: options.maxMessages, timeout_ms: options.timeoutMs });
  client.connect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
