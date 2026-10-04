
import type { CommunicationSenderRequest } from '../contracts/communication_contracts.js';
export type ValidatedSenderRequest = Omit<CommunicationSenderRequest, 'message'> & { message: { message_type: string; content: unknown } };
export type CommunicationSenderResult = Readonly<(
  { outcome: 'ACKNOWLEDGED'; provider_message_id: string | null; error_code: null }
  | { outcome: 'REJECTED_NOT_APPLIED' | 'UNKNOWN'; provider_message_id: null; error_code: string | null }
) & { retryable: boolean }>;
export type CommunicationSend = (request: ValidatedSenderRequest) => unknown | Promise<unknown>;
type RawRequest = Partial<Omit<ValidatedSenderRequest, 'message' | 'target_type' | 'signal'>> & { message?: { message_type?: unknown; content?: unknown }; target_type?: string; signal?: unknown };
type RawResult = { outcome?: string; provider_message_id?: unknown; error_code?: unknown; retryable?: unknown };

const OUTCOMES = new Set(['ACKNOWLEDGED', 'REJECTED_NOT_APPLIED', 'UNKNOWN']);
const TARGET_TYPES = new Set(['PERSON', 'GROUP']);

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

export function validateCommunicationSenderRequest(request: unknown): ValidatedSenderRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('COMMUNICATION_SENDER_REQUEST_INVALID');
  if (!bounded((request as RawRequest).provider, 64)
    || !bounded((request as RawRequest).channel_account_id, 256)
    || !TARGET_TYPES.has((request as RawRequest).target_type as string)
    || !bounded((request as RawRequest).target_id, 512)
    || !bounded((request as RawRequest).delivery_id, 36)
    || !bounded((request as RawRequest).idempotency_key, 256)
    || !(request as RawRequest).message
    || !bounded((request as ValidatedSenderRequest).message.message_type, 32)
    || !(request as ValidatedSenderRequest).message.content
    || !((request as RawRequest).signal instanceof AbortSignal)) {
    throw new TypeError('COMMUNICATION_SENDER_REQUEST_INVALID');
  }
  return request as ValidatedSenderRequest;
}

export function validateCommunicationSenderResult(result: unknown): CommunicationSenderResult {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !OUTCOMES.has((result as RawResult).outcome as string)) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if ((result as RawResult).provider_message_id !== null && (result as RawResult).provider_message_id !== undefined && !bounded((result as RawResult).provider_message_id, 256)) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if ((result as RawResult).error_code !== null && (result as RawResult).error_code !== undefined && !bounded((result as RawResult).error_code, 128)) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if ((result as RawResult).outcome === 'ACKNOWLEDGED' && (result as RawResult).error_code != null) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if ((result as RawResult).outcome !== 'ACKNOWLEDGED' && (result as RawResult).provider_message_id != null) throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  if ((result as RawResult).retryable !== undefined && typeof (result as RawResult).retryable !== 'boolean') throw new TypeError('COMMUNICATION_SENDER_RESULT_INVALID');
  return Object.freeze({
    outcome: (result as RawResult).outcome,
    provider_message_id: (result as RawResult).provider_message_id ?? null,
    error_code: (result as RawResult).error_code ?? null,
    retryable: (result as RawResult).retryable ?? (result as RawResult).outcome === 'REJECTED_NOT_APPLIED',
  }) as CommunicationSenderResult;
}

export function createCommunicationSenderPort(send: CommunicationSend) {
  if (typeof send !== 'function') throw new TypeError('A Communication sender function is required.');
  return Object.freeze({
    async send(request: CommunicationSenderRequest) {
      return validateCommunicationSenderResult(await send(validateCommunicationSenderRequest(request)));
    },
  });
}

export function createMockCommunicationSender({ behavior = async () => ({
  outcome: 'ACKNOWLEDGED',
  provider_message_id: 'mock-ack',
  error_code: null,
}) } : { behavior?: (request: ValidatedSenderRequest, callCount: number) => unknown | Promise<unknown> } = {}) {
  if (typeof behavior !== 'function') throw new TypeError('Mock sender behavior must be a function.');
  let callCount = 0;
  const calls: { delivery_id: string; provider: string; target_type: 'PERSON' | 'GROUP'; idempotency_key: string }[] = [];
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
