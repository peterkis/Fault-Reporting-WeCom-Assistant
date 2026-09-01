import AiBot from '@wecom/aibot-node-sdk';

import { createSafeSdkLogger } from './g0-002-sdk-lifecycle.mjs';

export const P2_G1_GATEWAY_ERROR_CODES = Object.freeze({
  disabled: 'P2_G1_GATEWAY_DISABLED',
  alreadyActive: 'P2_G1_GATEWAY_ALREADY_ACTIVE',
  configurationInvalid: 'P2_G1_GATEWAY_CONFIGURATION_INVALID',
  authFailed: 'P2_G1_GATEWAY_AUTH_FAILED',
  unavailableBeforeSend: 'GATEWAY_UNAVAILABLE_BEFORE_SEND',
});

let activeGateway = null;

function safeError(error) {
  const message = String(error?.message ?? error ?? '');
  return /auth|secret|credential/iu.test(message)
    ? P2_G1_GATEWAY_ERROR_CODES.authFailed
    : 'P2_G1_GATEWAY_TRANSPORT_ERROR';
}

function configuration({ botId, secret, wsUrl }) {
  if (![botId, secret, wsUrl].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new TypeError(P2_G1_GATEWAY_ERROR_CODES.configurationInvalid);
  }
}

export function createP2G1WeComGateway({
  enabled = false,
  botId,
  secret,
  wsUrl = 'wss://openws.work.weixin.qq.com',
  onFrame = async () => {},
  clientFactory = (options) => new AiBot.WSClient(options),
  now = () => new Date(),
} = {}) {
  if (typeof enabled !== 'boolean' || typeof onFrame !== 'function' || typeof clientFactory !== 'function' || typeof now !== 'function') {
    throw new TypeError(P2_G1_GATEWAY_ERROR_CODES.configurationInvalid);
  }
  if (enabled) configuration({ botId, secret, wsUrl });
  let client = null;
  let authenticated = false;
  let started = false;
  let stopping = false;
  const metrics = {
    auth_success_total: 0,
    auth_failure_total: 0,
    reconnect_total: 0,
    inbound_frame_total: 0,
    inbound_failure_total: 0,
    last_error_code: null,
    last_state_change_at: null,
  };

  function transition() { metrics.last_state_change_at = now().toISOString(); }

  async function handleFrame(frame) {
    metrics.inbound_frame_total += 1;
    try { await onFrame(frame); }
    catch { metrics.inbound_failure_total += 1; metrics.last_error_code = 'P2_G1_INBOUND_HANDLER_FAILED'; }
  }

  async function start() {
    if (!enabled) return Object.freeze({ started: false, disabled: true });
    if (started) return Object.freeze({ started: true, disabled: false });
    if (activeGateway !== null && activeGateway !== gateway) {
      const error = new Error(P2_G1_GATEWAY_ERROR_CODES.alreadyActive); error.code = P2_G1_GATEWAY_ERROR_CODES.alreadyActive; throw error;
    }
    activeGateway = gateway;
    stopping = false;
    client = clientFactory({
      botId,
      secret,
      wsUrl,
      maxReconnectAttempts: 10,
      maxAuthFailureAttempts: 1,
      logger: createSafeSdkLogger({ onHeartbeatTimerStarted: () => {} }),
    });
    if (!client || typeof client.on !== 'function' || typeof client.connect !== 'function' || typeof client.disconnect !== 'function' || typeof client.sendMessage !== 'function') {
      activeGateway = null;
      throw new TypeError(P2_G1_GATEWAY_ERROR_CODES.configurationInvalid);
    }
    client.on('authenticated', () => {
      if (stopping) return;
      authenticated = true;
      metrics.auth_success_total += 1;
      metrics.last_error_code = null;
      transition();
    });
    client.on('message.text', (frame) => { if (!stopping) void handleFrame(frame); });
    client.on('disconnected', () => {
      if (authenticated && !stopping) metrics.reconnect_total += 1;
      authenticated = false;
      transition();
    });
    client.on('error', (error) => {
      const code = safeError(error);
      metrics.last_error_code = code;
      if (code === P2_G1_GATEWAY_ERROR_CODES.authFailed) metrics.auth_failure_total += 1;
      authenticated = false;
      transition();
    });
    started = true;
    transition();
    try { client.connect(); }
    catch {
      started = false;
      authenticated = false;
      activeGateway = null;
      metrics.last_error_code = 'P2_G1_GATEWAY_CONNECT_FAILED';
      throw Object.assign(new Error('P2_G1_GATEWAY_CONNECT_FAILED'), { code: 'P2_G1_GATEWAY_CONNECT_FAILED' });
    }
    return Object.freeze({ started: true, disabled: false });
  }

  async function stop() {
    stopping = true;
    authenticated = false;
    if (client !== null) {
      try { client.disconnect(); } catch { /* shutdown remains best effort */ }
    }
    client = null;
    started = false;
    if (activeGateway === gateway) activeGateway = null;
    transition();
    return Object.freeze({ stopped: true });
  }

  function getAuthenticatedClient() {
    if (!enabled || !started || !authenticated || client === null) {
      const error = new Error(P2_G1_GATEWAY_ERROR_CODES.unavailableBeforeSend);
      error.code = P2_G1_GATEWAY_ERROR_CODES.unavailableBeforeSend;
      throw error;
    }
    return client;
  }

  function getStatus() {
    return Object.freeze({
      enabled,
      started,
      authenticated,
      active_gateway_count: activeGateway === gateway ? 1 : 0,
      ...metrics,
    });
  }

  const gateway = Object.freeze({ start, stop, getAuthenticatedClient, getStatus });
  return gateway;
}
