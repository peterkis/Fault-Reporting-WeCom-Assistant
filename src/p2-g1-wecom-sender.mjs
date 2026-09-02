import { createHash } from 'node:crypto';

import { createCommunicationSenderPort } from './p2-004-communication-sender-port.mjs';

export const P2_G1_SENDER_ERROR_CODES = Object.freeze({
  disabled: 'P2_G1_SENDER_DISABLED',
  scopeForbidden: 'P2_G1_SEND_SCOPE_FORBIDDEN',
  requestInvalid: 'P2_G1_SEND_REQUEST_INVALID',
  providerRejected: 'P2_G1_PROVIDER_REJECTED',
  providerUnknown: 'P2_G1_PROVIDER_RESULT_UNKNOWN',
});

function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }

function sdkBody(message) {
  const text = message?.content?.text;
  if (typeof text !== 'string' || text.length < 1 || text.length > 20_480) {
    throw new TypeError(P2_G1_SENDER_ERROR_CODES.requestInvalid);
  }
  // The active-push SDK contract does not support a `text` body. Preserve the
  // Workbench plain-text command as plain Markdown so the Provider receives a
  // supported body without changing the stored Communication Message.
  if (message.message_type === 'text') return Object.freeze({ msgtype: 'markdown', markdown: Object.freeze({ content: text }) });
  if (message.message_type === 'markdown') return Object.freeze({ msgtype: 'markdown', markdown: Object.freeze({ content: text }) });
  throw new TypeError(P2_G1_SENDER_ERROR_CODES.requestInvalid);
}

function normalizeAllowlist(value) {
  const entries = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  if (entries.some((entry) => typeof entry !== 'string' || !/^[a-f0-9]{64}$/u.test(entry))) {
    throw new TypeError(P2_G1_SENDER_ERROR_CODES.requestInvalid);
  }
  return new Set(entries);
}

function acknowledgedId(receipt) {
  const requestId = receipt?.headers?.req_id;
  return typeof requestId === 'string' && requestId.length > 0
    ? `wecom_ack_${sha256(requestId).slice(0, 32)}`
    : null;
}

export function createP2G1WeComCommunicationSender({ gateway, allowedTargetHashes, enabled } = {}) {
  if (typeof enabled !== 'boolean' || !gateway || typeof gateway.getAuthenticatedClient !== 'function') {
    throw new TypeError(P2_G1_SENDER_ERROR_CODES.requestInvalid);
  }
  const allowlist = normalizeAllowlist(allowedTargetHashes);
  return createCommunicationSenderPort(async (request) => {
    if (!enabled) return { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: P2_G1_SENDER_ERROR_CODES.disabled, retryable: false };
    if (request.provider !== 'WECOM_AIBOT' || !['PERSON', 'GROUP'].includes(request.target_type)) {
      return { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: P2_G1_SENDER_ERROR_CODES.requestInvalid, retryable: false };
    }
    const targetHash = sha256(request.target_id);
    if (!allowlist.has(targetHash)) {
      return { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: P2_G1_SENDER_ERROR_CODES.scopeForbidden, retryable: false };
    }
    if (request.signal.aborted) {
      return { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: 'P2_G1_SEND_ABORTED_BEFORE_PROVIDER', retryable: true };
    }
    let client;
    try { client = gateway.getAuthenticatedClient(); }
    catch (error) {
      const unavailable = new Error('GATEWAY_UNAVAILABLE_BEFORE_SEND');
      unavailable.code = 'GATEWAY_UNAVAILABLE_BEFORE_SEND';
      throw unavailable;
    }
    let body;
    try { body = sdkBody(request.message); }
    catch { return { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: P2_G1_SENDER_ERROR_CODES.requestInvalid, retryable: false }; }
    let providerCalled = false;
    try {
      providerCalled = true;
      const receipt = await client.sendMessage(request.target_id, body);
      const errcode = receipt?.errcode ?? receipt?.body?.errcode;
      if (errcode === 0) {
        return { outcome: 'ACKNOWLEDGED', provider_message_id: acknowledgedId(receipt), error_code: null, retryable: false };
      }
      if (errcode === undefined || errcode === null) {
        return { outcome: 'UNKNOWN', provider_message_id: null, error_code: P2_G1_SENDER_ERROR_CODES.providerUnknown, retryable: false };
      }
      return { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: P2_G1_SENDER_ERROR_CODES.providerRejected, retryable: false };
    } catch (error) {
      if (!providerCalled) throw error;
      if (Number.isInteger(error?.errcode)) {
        return { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: P2_G1_SENDER_ERROR_CODES.providerRejected, retryable: false };
      }
      return { outcome: 'UNKNOWN', provider_message_id: null, error_code: P2_G1_SENDER_ERROR_CODES.providerUnknown, retryable: false };
    }
  });
}
