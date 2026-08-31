const OUTCOMES = new Set(['ACKNOWLEDGED', 'REJECTED_NOT_APPLIED', 'UNKNOWN']);
const TARGET_TYPES = new Set(['PERSON', 'GROUP']);

function bounded(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

export function validateCommunicationSenderRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('COMMUNICATION_SENDER_REQUEST_INVALID');
  if (!bounded(request.provider, 64)
    || !bounded(request.channel_account_id, 256)
    || !TARGET_TYPES.has(request.target_type)
    || !bounded(request.target_id, 512)
    || !bounded(request.delivery_id, 36)
    || !bounded(request.idempotency_key, 256)
    || !request.message
    || !bounded(request.message.message_type, 32)
    || !request.message.content
    || !(request.signal instanceof AbortSignal)) {
    throw new TypeError('COMMUNICATION_SENDER_REQUEST_INVALID');
  }
  return request;
}

export function validateCommunicationSenderResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !OUTCOMES.has(result.outcome)) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if (result.provider_message_id !== null && result.provider_message_id !== undefined && !bounded(result.provider_message_id, 256)) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if (result.error_code !== null && result.error_code !== undefined && !bounded(result.error_code, 128)) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if (result.outcome === 'ACKNOWLEDGED' && result.error_code != null) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if (result.outcome !== 'ACKNOWLEDGED' && result.provider_message_id != null) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if (result.retryable !== undefined && typeof result.retryable !== 'boolean') throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  return Object.freeze({
    outcome: result.outcome,
    provider_message_id: result.provider_message_id ?? null,
    error_code: result.error_code ?? null,
    retryable: result.retryable ?? result.outcome === 'REJECTED_NOT_APPLIED',
  });
}

export function createCommunicationSenderPort(send) {
  if (typeof send !== 'function') throw new TypeError('A Communication sender function is required.');
  return Object.freeze({
    async send(request) {
      return validateCommunicationSenderResult(await send(validateCommunicationSenderRequest(request)));
    },
  });
}

export function createMockCommunicationSender({ behavior = async () => ({
  outcome: 'ACKNOWLEDGED',
  provider_message_id: 'mock-ack',
  error_code: null,
}) } = {}) {
  if (typeof behavior !== 'function') throw new TypeError('Mock sender behavior must be a function.');
  let callCount = 0;
  const calls = [];
  const port = createCommunicationSenderPort(async (request) => {
    callCount += 1;
    calls.push(Object.freeze({
      delivery_id: request.delivery_id,
      provider: request.provider,
      target_type: request.target_type,
      idempotency_key: request.idempotency_key,
    }));
    return behavior(request, callCount);
  });
  return Object.freeze({
    send: port.send,
    get callCount() { return callCount; },
    get calls() { return Object.freeze([...calls]); },
  });
}
