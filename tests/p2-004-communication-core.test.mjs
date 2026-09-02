import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  COMMUNICATION_ATTEMPT_OUTCOMES,
  COMMUNICATION_DELIVERY_STATUSES,
  COMMUNICATION_ERROR_CODES,
  COMMUNICATION_MESSAGE_TYPES,
  COMMUNICATION_PURPOSES,
  COMMUNICATION_SENDER_KINDS,
  COMMUNICATION_SIDE_EFFECT_STATES,
  COMMUNICATION_VISIBILITIES,
  computeCommunicationCommandHash,
  computeCommunicationContentHash,
  createCommunicationService,
  normalizeCommunicationCommand,
  resolveCommunicationDestination,
  snapshotCommunicationJson,
} from '../src/p2-004-communication-core.mjs';
import {
  createCommunicationSenderPort,
  createMockCommunicationSender,
  validateCommunicationSenderResult,
} from '../src/p2-004-communication-sender-port.mjs';
import { createCommunicationDeliveryWorker } from '../src/p2-004-communication-delivery-worker.mjs';
import {
  mapCommunicationDeliveryChangedRealtimeEvent,
  mapCommunicationDeliveryToTimelineSourceRecord,
  mapCommunicationMessageToTimelineSourceRecord,
  mapLegacyNotificationDeliveryToCommunicationView,
} from '../src/p2-004-communication-projections.mjs';

const sessionId = '018f6f15-7a11-7cc0-9e40-111111111111';
const actorId = '018f6f15-7a11-7cc0-9e40-222222222222';

function externalCommand(overrides = {}) {
  return {
    session_id: sessionId,
    expected_row_version: 3,
    client_command_id: randomUUID(),
    sender_kind: 'AGENT',
    message_type: 'text',
    visibility: 'EXTERNAL',
    text: 'synthetic communication message',
    privacy_class: 'INTERNAL',
    retention_until: '2027-08-31T00:00:00.000Z',
    ...overrides,
  };
}

test('P2-004 JSON Schemas use draft 2020-12 and close object shapes', async () => {
  for (const file of [
    'communication_message.schema.json',
    'communication_delivery.schema.json',
    'communication_internal_note_command.schema.json',
    'communication_system_notification.schema.json',
    'conversation_reply_command.schema.json',
  ]) {
    const schema = JSON.parse(await readFile(new URL(`../contracts/${file}`, import.meta.url), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
  }
});

test('Reply Command schema and future OpenAPI bind session and idempotency without exposing a target', async () => {
  const schema = JSON.parse(await readFile(new URL('../contracts/conversation_reply_command.schema.json', import.meta.url), 'utf8'));
  const openapi = await readFile(new URL('../contracts/conversation_center.openapi.yaml', import.meta.url), 'utf8');
  assert.equal(schema.required.includes('session_id'), true);
  assert.equal(schema.required.includes('client_command_id'), true);
  assert.equal(Object.hasOwn(schema.properties, 'target'), false);
  assert.match(openapi, /Idempotency-Key/u);
  assert.match(openapi, /Idempotency-Key MUST equal body\.client_command_id/u);
  assert.match(openapi, /body\.session_id\s+MUST equal the sessionId path parameter/u);
  assert.match(openapi, /CommunicationCommandResult/u);
  assert.doesNotMatch(openapi, /^\s+target(?:_id)?:/mu);
});

test('frozen Communication vocabularies are exact', () => {
  assert.deepEqual(COMMUNICATION_SENDER_KINDS, ['AGENT', 'AI', 'SYSTEM']);
  assert.deepEqual(COMMUNICATION_PURPOSES, ['HUMAN_REPLY', 'AI_REPLY', 'SYSTEM_NOTIFICATION', 'INTERNAL_NOTE']);
  assert.deepEqual(COMMUNICATION_MESSAGE_TYPES, ['text', 'markdown', 'image', 'file', 'mixed', 'template_card']);
  assert.deepEqual(COMMUNICATION_VISIBILITIES, ['EXTERNAL', 'INTERNAL', 'RESTRICTED']);
  assert.deepEqual(COMMUNICATION_DELIVERY_STATUSES, ['PENDING', 'LEASED', 'SENDING', 'SENT', 'RECONCILIATION_REQUIRED', 'DEAD_LETTER', 'CANCELLED']);
  assert.deepEqual(COMMUNICATION_ATTEMPT_OUTCOMES, ['STARTED', 'SENT', 'RETRY_SCHEDULED', 'RECONCILIATION_REQUIRED', 'DEAD_LETTER', 'CANCELLED']);
  assert.deepEqual(COMMUNICATION_SIDE_EFFECT_STATES, ['NOT_ATTEMPTED', 'ACKNOWLEDGED', 'UNKNOWN']);
});

test('normalization freezes Agent, AI, System, internal note and media contracts', () => {
  const human = normalizeCommunicationCommand(externalCommand());
  assert.equal(human.purpose, 'HUMAN_REPLY');
  assert.equal(human.idempotency_scope, 'AGENT');
  const ai = normalizeCommunicationCommand(externalCommand({ sender_kind: 'AI', sender_system_code: 'AI_SYNTHETIC' }));
  assert.equal(ai.purpose, 'AI_REPLY');
  assert.equal(ai.idempotency_scope, 'AI');
  const note = normalizeCommunicationCommand(externalCommand({ purpose: 'INTERNAL_NOTE', visibility: 'INTERNAL' }));
  assert.equal(note.purpose, 'INTERNAL_NOTE');
  const system = normalizeCommunicationCommand({
    client_command_id: randomUUID(), sender_kind: 'SYSTEM', sender_system_code: 'SYNTHETIC_SYSTEM',
    purpose: 'SYSTEM_NOTIFICATION', message_type: 'markdown', visibility: 'EXTERNAL',
    content: { text: 'synthetic' }, privacy_class: 'INTERNAL', retention_until: '2027-08-31T00:00:00.000Z',
  });
  assert.equal(system.session_id, null);
  assert.equal(normalizeCommunicationCommand(externalCommand({ message_type: 'image', attachment_ids: [randomUUID()], text: 'descriptor' })).message_type, 'image');
});

test('invalid UUID, row version, privacy, retention, message type, and browser authority are rejected', () => {
  for (const command of [
    externalCommand({ session_id: 'bad' }), externalCommand({ client_command_id: 'bad' }),
    externalCommand({ expected_row_version: 0 }), externalCommand({ privacy_class: 'PUBLICISH' }),
    externalCommand({ retention_until: 'not-an-instant' }), externalCommand({ message_type: 'video' }),
    externalCommand({ target_id: 'client-controlled' }), externalCommand({ provider: 'client-controlled' }),
  ]) assert.throws(() => normalizeCommunicationCommand(command), { code: COMMUNICATION_ERROR_CODES.commandInvalid });
});

test('plain JSON fence rejects Proxy, accessor, symbol, toJSON, prototype and pollution keys', () => {
  const throwingProxy = new Proxy({}, { ownKeys() { throw new Error('raw provider detail'); } });
  const accessor = {};
  Object.defineProperty(accessor, 'text', { enumerable: true, get() { return 'leak'; } });
  const symbolic = { text: 'safe', [Symbol('unsafe')]: true };
  const withToJson = { text: 'safe', toJSON() { return {}; } };
  const unusual = Object.create({ inherited: true });
  unusual.text = 'safe';
  const polluted = Object.create(null);
  polluted.__proto__ = 'unsafe';
  for (const value of [throwingProxy, accessor, symbolic, withToJson, unusual, polluted]) {
    assert.throws(() => snapshotCommunicationJson(value), { code: COMMUNICATION_ERROR_CODES.commandInvalid });
  }
});

test('plain JSON fence enforces depth, node, string and array bounds', () => {
  assert.throws(() => snapshotCommunicationJson({ a: { b: { c: 1 } } }, { maximumDepth: 1 }));
  assert.throws(() => snapshotCommunicationJson({ a: [1, 2, 3] }, { maximumNodes: 2 }));
  assert.throws(() => snapshotCommunicationJson({ a: '1234' }, { maximumStringLength: 3 }));
  assert.throws(() => snapshotCommunicationJson({ a: [1, 2] }, { maximumArrayLength: 1 }));
});

test('content and command hashes are stable, key-order independent and cover row version', () => {
  assert.equal(computeCommunicationContentHash({ a: 1, b: 2 }), computeCommunicationContentHash({ b: 2, a: 1 }));
  const command = externalCommand({ client_command_id: '018f6f15-7a11-7cc0-9e40-333333333333' });
  const first = computeCommunicationCommandHash(command);
  assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(first, computeCommunicationCommandHash({ ...command }));
  assert.equal(first, computeCommunicationCommandHash({ ...command, retention_until: '2027-09-01T00:00:00.000Z' }));
  assert.notEqual(first, computeCommunicationCommandHash({ ...command, expected_row_version: 4 }));
  assert.notEqual(first, computeCommunicationCommandHash({ ...command, sender_kind: 'AI', sender_system_code: 'AI_SYNTHETIC' }));
});

test('destination resolution uses authoritative Thread fields for single and group', () => {
  const base = { provider: 'WECOM_AIBOT', channel_account_id: 'synthetic-account', external_thread_key: 'opaque-thread' };
  assert.deepEqual(resolveCommunicationDestination({ thread: { ...base, chat_type: 'single' } })[0], {
    provider: 'WECOM_AIBOT', channel_account_id: 'synthetic-account', target_type: 'PERSON', target_id: 'opaque-thread',
  });
  assert.equal(resolveCommunicationDestination({ thread: { ...base, chat_type: 'group' } })[0].target_type, 'GROUP');
  assert.throws(() => resolveCommunicationDestination({ thread: { ...base, chat_type: 'room' } }), { code: COMMUNICATION_ERROR_CODES.destinationInvalid });
});

test('disabled service performs zero database and authorization work', async () => {
  let calls = 0;
  const service = createCommunicationService({
    pool: { connect() { calls += 1; } }, enabled: false,
    authorizeCommand: async () => { calls += 1; return true; },
  });
  assert.deepEqual(await service.commitExternalMessage({ command: externalCommand(), actor: { principal_id: actorId } }), {
    ok: false, error: { code: COMMUNICATION_ERROR_CODES.disabled, retryable: false },
  });
  assert.equal(calls, 0);
});

test('disabled Worker performs zero database and Sender calls', async () => {
  let databaseCalls = 0;
  let senderCalls = 0;
  const worker = createCommunicationDeliveryWorker({
    pool: { connect() { databaseCalls += 1; } },
    sender: { async send() { senderCalls += 1; } },
    enabled: false,
  });
  assert.deepEqual(await worker.runOnce(), { processed: 0, results: [], disabled: true });
  assert.equal(databaseCalls, 0);
  assert.equal(senderCalls, 0);
});

test('Sender Port validates ACK, rejected, unknown and rejects malformed results', async () => {
  const controller = new AbortController();
  const request = {
    provider: 'WECOM_AIBOT', channel_account_id: 'synthetic-account', target_type: 'GROUP', target_id: 'internal-target',
    delivery_id: sessionId, idempotency_key: 'communication-idempotency', message: { message_type: 'text', content: { text: 'synthetic' } }, signal: controller.signal,
  };
  const port = createCommunicationSenderPort(async () => ({ outcome: 'ACKNOWLEDGED', provider_message_id: 'mock-id', error_code: null }));
  assert.equal((await port.send(request)).outcome, 'ACKNOWLEDGED');
  assert.equal(validateCommunicationSenderResult({ outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: 'GATEWAY_UNAVAILABLE' }).retryable, true);
  assert.equal(validateCommunicationSenderResult({ outcome: 'UNKNOWN', provider_message_id: null, error_code: 'TIMEOUT' }).outcome, 'UNKNOWN');
  assert.throws(() => validateCommunicationSenderResult({ outcome: 'SENT' }));
});

test('Mock Sender records only safe call metadata', async () => {
  const sender = createMockCommunicationSender();
  const controller = new AbortController();
  await sender.send({
    provider: 'WECOM_AIBOT', channel_account_id: 'synthetic-account', target_type: 'PERSON', target_id: 'secret-target',
    delivery_id: sessionId, idempotency_key: 'communication-idempotency', message: { message_type: 'text', content: { text: 'private-body' } }, signal: controller.signal,
  });
  assert.equal(sender.callCount, 1);
  assert.equal(JSON.stringify(sender.calls).includes('secret-target'), false);
  assert.equal(JSON.stringify(sender.calls).includes('private-body'), false);
});

test('message projection maps Agent, AI, Internal and System without changing ownership', () => {
  const base = { id: randomUUID(), session_id: sessionId, visibility: 'EXTERNAL', content: { text: 'synthetic' }, privacy_class: 'INTERNAL', retention_until: '2027-08-31T00:00:00Z', created_at: '2026-08-31T00:00:00Z' };
  assert.equal(mapCommunicationMessageToTimelineSourceRecord({ ...base, sender_kind: 'AGENT', purpose: 'HUMAN_REPLY' }).item_type, 'AGENT_MESSAGE');
  assert.equal(mapCommunicationMessageToTimelineSourceRecord({ ...base, sender_kind: 'AI', purpose: 'AI_REPLY' }).item_type, 'AI_MESSAGE');
  assert.equal(mapCommunicationMessageToTimelineSourceRecord({ ...base, sender_kind: 'AGENT', purpose: 'INTERNAL_NOTE', visibility: 'INTERNAL' }).item_type, 'INTERNAL_NOTE');
  assert.equal(mapCommunicationMessageToTimelineSourceRecord({ ...base, sender_kind: 'SYSTEM', purpose: 'SYSTEM_NOTIFICATION' }).item_type, 'SYSTEM_EVENT');
});

test('delivery timeline and realtime mappers expose only safe delivery fields', () => {
  const delivery = {
    id: randomUUID(), session_id: sessionId, status: 'PENDING', attempt_count: 1, last_error_code: null,
    side_effect_state: 'NOT_ATTEMPTED', privacy_class: 'INTERNAL', retention_until: '2027-08-31T00:00:00Z', updated_at: '2026-08-31T00:00:00Z',
    target_id: 'must-not-leak', target_hash: 'must-not-leak', provider_message_id: 'must-not-leak', content: 'must-not-leak',
  };
  const timeline = mapCommunicationDeliveryToTimelineSourceRecord(delivery);
  assert.equal(timeline.item_type, 'DELIVERY_STATUS');
  assert.equal(timeline.source_type, 'DELIVERY');
  const realtime = mapCommunicationDeliveryChangedRealtimeEvent(delivery);
  assert.deepEqual(Object.keys(realtime.payload), ['status', 'attempt_count', 'last_error_code', 'side_effect_state']);
  assert.equal(JSON.stringify(realtime).includes('must-not-leak'), false);
});

test('legacy notification mapping is safe and exact', () => {
  const mapped = mapLegacyNotificationDeliveryToCommunicationView({
    id: randomUUID(), outbox_id: randomUUID(), status: 'SENDING', channel: 'WECOM_DIRECT',
    attempt_count: 2, last_error_code: null, sent_at: null, target_key: 'must-not-leak', provider_message_id: 'must-not-leak',
  });
  assert.equal(mapped.source_kind, 'P1_NOTIFICATION');
  assert.equal(mapped.status, 'SENDING');
  assert.equal(JSON.stringify(mapped).includes('must-not-leak'), false);
});

test('public stable error inventory excludes raw provider and storage details', () => {
  assert.deepEqual(Object.values(COMMUNICATION_ERROR_CODES).sort(), [
    'COMMUNICATION_COMMAND_CONFLICT', 'COMMUNICATION_COMMAND_INVALID', 'COMMUNICATION_DELIVERY_LEASE_CONFLICT',
    'COMMUNICATION_DELIVERY_NOT_FOUND', 'COMMUNICATION_DELIVERY_RECONCILIATION_REQUIRED', 'COMMUNICATION_DELIVERY_STORAGE_FAILED',
    'COMMUNICATION_DESTINATION_INVALID', 'COMMUNICATION_DISABLED', 'COMMUNICATION_INTERNAL_OUTBOX_FORBIDDEN',
    'COMMUNICATION_MEDIA_NOT_AUTHORIZED', 'COMMUNICATION_RECONCILIATION_NOT_AUTHORIZED', 'COMMUNICATION_SENDER_UNAUTHORIZED',
    'COMMUNICATION_SEND_REJECTED', 'COMMUNICATION_SEND_TIMEOUT', 'COMMUNICATION_SESSION_ENDED',
    'COMMUNICATION_SESSION_NOT_FOUND', 'COMMUNICATION_SESSION_VERSION_CONFLICT', 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
  ].sort());
});
