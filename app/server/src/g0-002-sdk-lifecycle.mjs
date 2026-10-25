import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';

export const SDK_VERSION = '1.0.6';
const TEST_ID = 'G0-002';
const AUTH_TIMEOUT_MS = 20_000;
const STABLE_CONNECTION_MS = 2_500;
const DISCONNECT_WAIT_MS = 1_000;

function hashIdentifier(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function requireBooleanOff(value, name) {
  if (String(value).toLowerCase() !== 'false') {
    throw new Error(`G0_CONFIG_INVALID:${name}_MUST_BE_FALSE`);
  }
}

export function validateRuntimeConfig(env, mode = 'valid') {
  const required = ['ARCHITECTURE_BASELINE', 'APP_PHASE', 'WECOM_BOT_ID', 'WECOM_BOT_SECRET', 'WECOM_WS_URL'];
  const missing = required.filter((key) => !String(env[key] ?? '').trim());
  if (missing.length > 0) {
    throw new Error(`G0_CONFIG_INVALID:MISSING_${missing.join('_')}`);
  }
  if (env.ARCHITECTURE_BASELINE !== 'V1.2') {
    throw new Error('G0_CONFIG_INVALID:ARCHITECTURE_BASELINE');
  }
  if (env.APP_PHASE !== 'G0') {
    throw new Error('G0_CONFIG_INVALID:APP_PHASE');
  }
  requireBooleanOff(env.AI_TRIAGE_ENABLED, 'AI_TRIAGE_ENABLED');
  requireBooleanOff(env.OCR_ENABLED, 'OCR_ENABLED');
  requireBooleanOff(env.HOSPITAL_TICKETS_ENABLED, 'HOSPITAL_TICKETS_ENABLED');

  let wsUrl;
  try {
    wsUrl = new URL(env.WECOM_WS_URL);
  } catch {
    throw new Error('G0_CONFIG_INVALID:WECOM_WS_URL');
  }
  if (wsUrl.protocol !== 'wss:') {
    throw new Error('G0_CONFIG_INVALID:WECOM_WS_URL_MUST_USE_WSS');
  }
  if (!['valid', 'invalid-secret'].includes(mode)) {
    throw new Error('G0_CONFIG_INVALID:UNSUPPORTED_MODE');
  }

  return {
    botId: env.WECOM_BOT_ID,
    botIdHash: hashIdentifier(env.WECOM_BOT_ID),
    secret: mode === 'invalid-secret' ? 'g0-002-intentionally-invalid-secret' : env.WECOM_BOT_SECRET,
    wsUrl: wsUrl.toString(),
  };
}

export function redact(value, sensitiveValues = []) {
  let text = String(value ?? '');
  for (const sensitiveValue of sensitiveValues.filter(Boolean)) {
    text = text.replaceAll(String(sensitiveValue), '[redacted]');
  }
  return text.replace(/((?:secret|token|password|key)=)([^\s&]+)/gi, '$1[redacted]');
}

export function createSafeSdkLogger({ onHeartbeatTimerStarted }) {
  return {
    debug(message) {
      if (String(message).startsWith('Heartbeat timer started')) {
        onHeartbeatTimerStarted();
      }
    },
    info() {},
    warn() {},
    error() {},
  };
}

export function classifyError(error) {
  const message = String(error?.message ?? error ?? '');
  if (/auth|secret|credential|WS_AUTH_FAILURE/i.test(message)) {
    return 'WECOM_AUTH_FAILED';
  }
  return 'WECOM_CONNECT_FAILED';
}

export function runLifecycleProbe({
  client,
  writeEvent,
  authTimeoutMs = AUTH_TIMEOUT_MS,
  stableConnectionMs = STABLE_CONNECTION_MS,
  disconnectWaitMs = DISCONNECT_WAIT_MS,
  selfSigtermAfterAuth = false,
  signalEmitter = process,
  // Windows 无法向自身可靠投递可捕获的 SIGTERM；测试模式显式触发相同处理器。
  triggerSigterm = () => process.emit('SIGTERM'),
  getHeartbeatTimerStarted = () => false,
}) {
  let state = 'DISCONNECTED';
  let authenticated = false;
  let stopping = false;
  let finished = false;
  let authTimeout;
  let stableConnectionTimer;
  let disconnectTimer;
  let resolveCompletion;
  let requestedExitCode = 0;
  let requestedErrorCode;
  let requestedShutdownReason;

  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });

  function emit(event, details = {}) {
    writeEvent({ event, state, ...details });
  }

  function clearTimers() {
    clearTimeout(authTimeout);
    clearTimeout(stableConnectionTimer);
    clearTimeout(disconnectTimer);
  }

  function finish({ ok, exitCode, errorCode, shutdownReason }) {
    if (finished) return;
    finished = true;
    clearTimers();
    signalEmitter.removeListener?.('SIGINT', onSigint);
    signalEmitter.removeListener?.('SIGTERM', onSigterm);
    const heartbeatTimerStarted = getHeartbeatTimerStarted();
    const result = {
      ok: Boolean(ok && authenticated && heartbeatTimerStarted),
      exit_code: exitCode,
      authenticated,
      heartbeat_timer_started: heartbeatTimerStarted,
      disconnect_requested: stopping,
      shutdown_reason: shutdownReason,
    };
    if (errorCode) result.error_code = errorCode;
    emit('probe_finished', {
      ok: result.ok,
      exit_code: result.exit_code,
      ...(result.error_code ? { error_code: result.error_code } : {}),
    });
    resolveCompletion(result);
  }

  function requestShutdown(shutdownReason, exitCode = 0, errorCode) {
    if (stopping || finished) return;
    stopping = true;
    requestedExitCode = exitCode;
    requestedErrorCode = errorCode;
    requestedShutdownReason = shutdownReason;
    state = 'STOPPING';
    emit('disconnect_requested', { shutdown_reason: shutdownReason });
    try {
      client.disconnect();
    } catch {
      finish({ ok: false, exitCode: 2, errorCode: 'WECOM_DISCONNECT_FAILED', shutdownReason });
      return;
    }
    disconnectTimer = setTimeout(() => {
      finish({ ok: exitCode === 0, exitCode, errorCode, shutdownReason });
    }, disconnectWaitMs);
  }

  function onSigint() {
    requestShutdown('SIGINT');
  }

  function onSigterm() {
    requestShutdown('SIGTERM');
  }

  client.on('connected', () => {
    if (finished || stopping) return;
    state = 'CONNECTED';
    emit('connected');
  });
  client.on('authenticated', () => {
    if (finished || stopping) return;
    authenticated = true;
    state = 'AUTHENTICATED';
    emit('authenticated');
    stableConnectionTimer = setTimeout(() => {
      if (selfSigtermAfterAuth) {
        triggerSigterm();
      } else {
        requestShutdown('AUTHENTICATED_STABILITY_WINDOW');
      }
    }, stableConnectionMs);
  });
  client.on('reconnecting', (attempt) => {
    if (finished || stopping) return;
    state = 'RECONNECTING';
    emit('reconnecting', { attempt: Number(attempt) || 0 });
  });
  client.on('error', (error) => {
    if (finished || stopping) return;
    requestShutdown('SDK_ERROR', 2, classifyError(error));
  });
  client.on('disconnected', () => {
    if (finished) return;
    emit('disconnected');
    if (stopping) {
      finish({
        ok: requestedExitCode === 0,
        exitCode: requestedExitCode,
        errorCode: requestedErrorCode,
        shutdownReason: requestedShutdownReason,
      });
      return;
    }
    requestShutdown('DISCONNECTED_BEFORE_AUTH', 2, authenticated ? 'WECOM_UNEXPECTED_DISCONNECT' : 'WECOM_AUTH_FAILED');
  });

  signalEmitter.once('SIGINT', onSigint);
  signalEmitter.once('SIGTERM', onSigterm);
  state = 'CONNECTING';
  emit('connect_requested');
  try {
    client.connect();
  } catch {
    requestShutdown('CONNECT_THROWN', 2, 'WECOM_CONNECT_FAILED');
  }
  authTimeout = setTimeout(() => {
    requestShutdown('AUTH_TIMEOUT', 2, 'WECOM_AUTH_TIMEOUT');
  }, authTimeoutMs);

  return { completion, requestShutdown };
}

export function parseCliArgs(argv) {
  const modeArgument = argv.find((argument) => argument.startsWith('--mode='));
  const stableConnectionArgument = argv.find((argument) => argument.startsWith('--stable-connection-ms='));
  const stableConnectionMs = stableConnectionArgument
    ? Number(stableConnectionArgument.split('=', 2)[1])
    : STABLE_CONNECTION_MS;
  if (!Number.isInteger(stableConnectionMs) || stableConnectionMs < 1_000 || stableConnectionMs > 60_000) {
    throw new Error('G0_CONFIG_INVALID:STABLE_CONNECTION_MS');
  }
  return {
    mode: modeArgument ? modeArgument.split('=', 2)[1] : 'valid',
    selfSigtermAfterAuth: argv.includes('--self-sigterm-after-auth'),
    stableConnectionMs,
  };
}

async function main() {
  let options;
  let config;
  try {
    options = parseCliArgs(process.argv.slice(2));
    config = validateRuntimeConfig(process.env, options.mode);
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'configuration_failed', error_code: 'WECOM_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }

  let heartbeatTimerStarted = false;
  const writeEvent = (details) => {
    console.log(JSON.stringify({
      test_id: TEST_ID,
      at_utc: new Date().toISOString(),
      sdk_version: SDK_VERSION,
      bot_id_hash: config.botIdHash,
      ...details,
    }));
  };
  const client = new AiBot.WSClient({
    botId: config.botId,
    secret: config.secret,
    wsUrl: config.wsUrl,
    heartbeatInterval: 1_000,
    maxReconnectAttempts: 0,
    maxAuthFailureAttempts: 0,
    logger: createSafeSdkLogger({
      onHeartbeatTimerStarted: () => {
        heartbeatTimerStarted = true;
        writeEvent({ event: 'heartbeat_timer_started', state: 'AUTHENTICATED' });
      },
    }),
  });

  const probe = runLifecycleProbe({
    client,
    writeEvent,
    selfSigtermAfterAuth: options.selfSigtermAfterAuth,
    stableConnectionMs: options.stableConnectionMs,
    getHeartbeatTimerStarted: () => heartbeatTimerStarted,
  });
  const result = await probe.completion;
  process.exitCode = result.ok ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
