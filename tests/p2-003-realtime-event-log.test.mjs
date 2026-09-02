import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  REALTIME_AGGREGATE_TYPES,
  REALTIME_AUTHORIZATION_SCOPE_TYPES,
  REALTIME_ERROR_CODES,
  REALTIME_EVENT_TYPES,
  REALTIME_SAFE_JSON_LIMITS,
  REALTIME_SOURCE_TYPES,
  REALTIME_VISIBILITY_SCOPES,
  RealtimeEventLogError,
  computeRealtimeEventHash,
  computeRealtimeEventKey,
  createRealtimeEventStore,
  listAuthorizedRealtimeEvents,
  mapConversationItemCreatedEvent,
  mapConversationSessionEvent,
  mapTimelineRebuiltEvent,
  normalizeRealtimeAuthorization as normalizeEventAuthorization,
  normalizeRealtimeEventCommand,
  publicRealtimeEventFromRow,
} from '../src/p2-003-realtime-event-log.mjs';
import {
  REALTIME_SSE_DEFAULTS,
  REALTIME_SSE_ERROR_CODES,
  RealtimeSseError,
  buildRealtimeFallback,
  createRealtimeSseHandler,
  createRealtimeWakeupHub,
  encodeRealtimeHeartbeat,
  encodeRealtimeSseEvent,
  normalizeRealtimeAuthorization as normalizeSseAuthorization,
  parseRealtimeLastEventId,
} from '../src/p2-003-realtime-sse.mjs';

const SESSION_ID = '01990c80-0000-7000-8000-000000000001';
const THREAD_ID = '01990c80-0000-7000-8000-000000000002';
const ITEM_ID = '01990c80-0000-7000-8000-000000000003';
const OCCURRED_AT = '2026-08-30T09:00:00.000Z';
const CREATED_AT = '2026-08-30T09:00:01.000Z';
const EXPIRES_AT = '2026-09-06T09:00:00.000Z';
const PRIVATE_SENTINEL = 'PRIVATE_SENTINEL_DO_NOT_LEAK';
const MAX_POSTGRES_BIGINT = '9223372036854775807';

const EXPECTED_EVENT_TYPES = [
  'conversation.session.created',
  'conversation.session.updated',
  'conversation.item.created',
  'conversation.timeline.rebuilt',
  'conversation.mode.changed',
  'conversation.assigned',
  'conversation.handoff.requested',
  'conversation.handoff.accepted',
  'conversation.read_cursor.changed',
  'communication.delivery.changed',
  'ticket.updated',
  'incident.updated',
  'gateway.connection.changed',
];

const EXPECTED_SOURCE_TYPES = [
  'CONVERSATION_SESSION',
  'CONVERSATION_ITEM',
  'TIMELINE_REBUILD',
  'COMMUNICATION_DELIVERY',
  'TICKET_EVENT',
  'HANDOFF_EVENT',
  'READ_CURSOR',
  'INCIDENT_EVENT',
  'GATEWAY_EVENT',
];

const EXPECTED_AGGREGATE_TYPES = [
  'CONVERSATION_SESSION',
  'CONVERSATION_ITEM',
  'CONVERSATION_TIMELINE',
  'COMMUNICATION_DELIVERY',
  'TICKET',
  'CONVERSATION_HANDOFF',
  'CONVERSATION_READ_CURSOR',
  'INCIDENT',
  'GATEWAY_CONNECTION',
];

function validCommand(overrides = {}) {
  return normalizeRealtimeEventCommand({
    schema_version: 1,
    publisher_name: 'CONVERSATION_FIXTURE',
    publisher_version: '1',
    source_type: 'CONVERSATION_SESSION',
    source_id: `${SESSION_ID}:1`,
    event_variant: 'CONVERSATION_SESSION_CREATED_V1',
    event_type: 'conversation.session.created',
    aggregate_type: 'CONVERSATION_SESSION',
    aggregate_id: SESSION_ID,
    aggregate_version: '1',
    authorization_scope_type: 'SESSION',
    authorization_scope_id: SESSION_ID,
    visibility_scope: 'WORKBENCH',
    payload: {
      session_id: SESSION_ID,
      status: 'OPEN',
      row_version: '1',
    },
    occurred_at: OCCURRED_AT,
    expires_at: EXPIRES_AT,
    ...overrides,
  });
}

function publicEvent(overrides = {}) {
  const command = validCommand();
  return {
    event_id: '1',
    event_type: command.event_type,
    aggregate_type: command.aggregate_type,
    aggregate_id: command.aggregate_id,
    aggregate_version: command.aggregate_version,
    visibility_scope: command.visibility_scope,
    payload: command.payload,
    occurred_at: command.occurred_at,
    created_at: CREATED_AT,
    ...overrides,
  };
}

function assertStableFailure(operation, code, ErrorType) {
  let caught;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ErrorType);
  assert.equal(caught.code, code);
  assert.equal(caught.message, code);
  assert.doesNotMatch(String(caught), new RegExp(PRIVATE_SENTINEL, 'u'));
}

async function assertStableAsyncFailure(operation, code, ErrorType) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ErrorType);
  assert.equal(caught.code, code);
  assert.equal(caught.message, code);
  assert.doesNotMatch(String(caught), new RegExp(PRIVATE_SENTINEL, 'u'));
}

class FakeRequest extends EventEmitter {
  constructor({ headers = {}, method = 'GET', url = '/api/realtime/events?scope=workbench' } = {}) {
    super();
    this.headers = headers;
    this.method = method;
    this.url = url;
  }
}

class FakeResponse extends EventEmitter {
  constructor({ writeResult = true, writableLength = 0, onWrite = null } = {}) {
    super();
    this.body = '';
    this.destroyed = false;
    this.headers = null;
    this.headersSent = false;
    this.statusCode = null;
    this.writableEnded = false;
    this.writableLength = writableLength;
    this.writeResult = writeResult;
    this.onWrite = onWrite;
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
  }

  flushHeaders() {}

  write(chunk) {
    this.body += String(chunk);
    this.onWrite?.(this, String(chunk));
    return this.writeResult;
  }

  end(chunk = '') {
    this.body += String(chunk);
    this.writableEnded = true;
  }

  destroy() {
    if (!this.destroyed) {
      this.destroyed = true;
      this.emit('close');
    }
  }
}

function fakeEventStore(events = []) {
  return {
    async getRealtimeReplayWindow() {
      return {
        retention_floor_event_id: '0',
        high_watermark_event_id: events.at(-1)?.event_id ?? '0',
      };
    },
    async listAuthorizedRealtimeEvents({ afterEventId }) {
      const page = events.filter((event) => BigInt(event.event_id) > BigInt(afterEventId));
      return {
        events: page,
        next_after_event_id: page.at(-1)?.event_id ?? afterEventId,
        retention_floor_event_id: '0',
      };
    },
  };
}

function declaredStringUnion(source, typeName) {
  const match = source.match(new RegExp(
    `export type ${typeName} =([\\s\\S]*?);`,
    'u',
  ));
  assert.ok(match, `${typeName} declaration should exist`);
  return [...match[1].matchAll(/'([^']+)'/gu)].map((entry) => entry[1]);
}

function assertExplicitStringBounds(schema, path = '#') {
  if (schema === null || typeof schema !== 'object') {
    return;
  }
  const includesString = schema.type === 'string'
    || (Array.isArray(schema.type) && schema.type.includes('string'));
  if (includesString) {
    assert.ok(Object.hasOwn(schema, 'minLength'), `${path} must declare minLength`);
    assert.ok(Object.hasOwn(schema, 'maxLength'), `${path} must declare maxLength`);
  }
  for (const [key, value] of Object.entries(schema)) {
    assertExplicitStringBounds(value, `${path}/${key}`);
  }
}

test('Realtime Event and Fallback Schemas parse as draft 2020-12 closed contracts', async () => {
  const [eventText, fallbackText] = await Promise.all([
    readFile(new URL('../contracts/conversation_realtime_event.schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../contracts/conversation_realtime_fallback.schema.json', import.meta.url), 'utf8'),
  ]);
  const eventSchema = JSON.parse(eventText);
  const fallbackSchema = JSON.parse(fallbackText);
  assert.equal(eventSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(eventSchema.additionalProperties, false);
  assert.equal(eventSchema.$defs.public_event_view.additionalProperties, false);
  assert.equal(fallbackSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(fallbackSchema.additionalProperties, false);
  assert.deepEqual(eventSchema.required, Object.keys(eventSchema.properties));
  assert.deepEqual(fallbackSchema.required, Object.keys(fallbackSchema.properties));
  assertExplicitStringBounds(eventSchema);
  assertExplicitStringBounds(fallbackSchema);
});

test('Realtime vocabularies freeze all event, source, aggregate, scope and visibility values', async () => {
  const schema = JSON.parse(await readFile(
    new URL('../contracts/conversation_realtime_event.schema.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(REALTIME_EVENT_TYPES, EXPECTED_EVENT_TYPES);
  assert.deepEqual(REALTIME_SOURCE_TYPES, EXPECTED_SOURCE_TYPES);
  assert.deepEqual(REALTIME_AGGREGATE_TYPES, EXPECTED_AGGREGATE_TYPES);
  assert.deepEqual(REALTIME_AUTHORIZATION_SCOPE_TYPES, ['SESSION', 'THREAD', 'SYSTEM']);
  assert.deepEqual(REALTIME_VISIBILITY_SCOPES, ['WORKBENCH', 'RESTRICTED_ADMIN']);
  assert.deepEqual(schema.$defs.event_type.enum, EXPECTED_EVENT_TYPES);
  assert.deepEqual(schema.$defs.source_type.enum, EXPECTED_SOURCE_TYPES);
  assert.deepEqual(schema.$defs.aggregate_type.enum, EXPECTED_AGGREGATE_TYPES);
  assert.deepEqual(schema.$defs.authorization_scope_type.enum, ['SESSION', 'THREAD', 'SYSTEM']);
  assert.deepEqual(schema.$defs.visibility_scope.enum, ['WORKBENCH', 'RESTRICTED_ADMIN']);
  assert.equal(new Set(EXPECTED_EVENT_TYPES).size, 13);
  assert.equal(new Set(EXPECTED_SOURCE_TYPES).size, 9);
  assert.equal(new Set(EXPECTED_AGGREGATE_TYPES).size, 9);
  assert.deepEqual(REALTIME_SAFE_JSON_LIMITS, {
    maximum_depth: 6,
    maximum_nodes: 4096,
    maximum_properties_per_object: 64,
    maximum_array_items: 100,
    maximum_string_length: 4096,
    maximum_canonical_bytes: 65536,
  });
  assert.equal(schema['x-maximum-payload-depth'], REALTIME_SAFE_JSON_LIMITS.maximum_depth);
  assert.equal(schema['x-maximum-payload-nodes'], REALTIME_SAFE_JSON_LIMITS.maximum_nodes);
  assert.equal(
    schema['x-maximum-payload-properties-per-object'],
    REALTIME_SAFE_JSON_LIMITS.maximum_properties_per_object,
  );
  assert.equal(schema['x-maximum-payload-array-items'], REALTIME_SAFE_JSON_LIMITS.maximum_array_items);
  assert.equal(schema['x-maximum-payload-string-length'], REALTIME_SAFE_JSON_LIMITS.maximum_string_length);
  assert.equal(
    schema['x-maximum-canonical-payload-bytes'],
    REALTIME_SAFE_JSON_LIMITS.maximum_canonical_bytes,
  );
});

test('TypeScript declarations mirror every frozen Schema and runtime vocabulary', async () => {
  const declarations = await readFile(
    new URL('../contracts/conversation_realtime_contracts.d.ts', import.meta.url),
    'utf8',
  );
  assert.deepEqual(declaredStringUnion(declarations, 'RealtimeEventType'), EXPECTED_EVENT_TYPES);
  assert.deepEqual(declaredStringUnion(declarations, 'RealtimeSourceType'), EXPECTED_SOURCE_TYPES);
  assert.deepEqual(declaredStringUnion(declarations, 'RealtimeAggregateType'), EXPECTED_AGGREGATE_TYPES);
  assert.deepEqual(
    declaredStringUnion(declarations, 'RealtimeAuthorizationScopeType'),
    ['SESSION', 'THREAD', 'SYSTEM'],
  );
  assert.deepEqual(
    declaredStringUnion(declarations, 'RealtimeVisibilityScope'),
    ['WORKBENCH', 'RESTRICTED_ADMIN'],
  );
  assert.deepEqual(
    declaredStringUnion(declarations, 'RealtimeFallbackReason'),
    ['SSE_DISABLED', 'CAPACITY_REACHED', 'REPLAY_GAP', 'TEMPORARY_UNAVAILABLE'],
  );
  assert.deepEqual(
    declaredStringUnion(declarations, 'RealtimeFallbackStrategy'),
    ['REFETCH_CONVERSATION_LIST_AND_TIMELINE', 'POLL_UNTIL_SSE_AVAILABLE'],
  );
  assert.match(declarations, /interface RealtimeEventCommand[\s\S]*aggregate_version: RealtimeBigIntString \| null;/u);
  assert.match(declarations, /interface RealtimePublicEventView[\s\S]*event_id: RealtimeBigIntString;/u);
  assert.match(declarations, /interface RealtimeFallbackContract[\s\S]*fallback_required: true;/u);
  assert.match(
    declarations,
    /interface RealtimeListEventsRequest \{[\s\S]*afterEventId\?: RealtimeBigIntString;[\s\S]*\}/u,
  );
  assert.doesNotMatch(
    declarations,
    /interface RealtimeListEventsRequest \{[\s\S]*afterEventId\?: RealtimeBigIntInput;[\s\S]*\}/u,
  );
  assert.match(
    declarations,
    /function buildRealtimeFallback\(input: \{[\s\S]*latestEventId\?: RealtimeBigIntString \| null;[\s\S]*retentionFloorEventId\?: RealtimeBigIntString \| null;[\s\S]*\}\): RealtimeFallbackContract;/u,
  );
  assert.match(
    declarations,
    /function parseRealtimeLastEventId\([\s\S]*input: RealtimeBigIntString \| null \| undefined,[\s\S]*\): RealtimeBigIntString \| null;/u,
  );
});

test('authorized replay SQL clips scope and visibility before LIMIT and payload materialization', async () => {
  const source = await readFile(
    new URL('../src/p2-003-realtime-event-log.mjs', import.meta.url),
    'utf8',
  );
  const authorizedIdsStart = source.indexOf('authorized_ids AS MATERIALIZED');
  const authorizationPredicate = source.indexOf('event.authorization_scope_type', authorizedIdsStart);
  const visibilityPredicate = source.indexOf('event.visibility_scope', authorizedIdsStart);
  const limit = source.indexOf('LIMIT $7', authorizedIdsStart);
  const fullRowFetch = source.indexOf('authorized AS MATERIALIZED', limit);
  const payloadFetch = source.indexOf('event.payload', fullRowFetch);
  assert.ok(authorizedIdsStart >= 0);
  assert.ok(authorizationPredicate > authorizedIdsStart && authorizationPredicate < limit);
  assert.ok(visibilityPredicate > authorizedIdsStart && visibilityPredicate < limit);
  assert.ok(fullRowFetch > limit);
  assert.ok(payloadFetch > fullRowFetch);
  assert.equal(source.slice(authorizedIdsStart, limit).includes('event.payload'), false);
});

test('Fallback Schema freezes the six safe fields, four reasons and two strategies', async () => {
  const schema = JSON.parse(await readFile(
    new URL('../contracts/conversation_realtime_fallback.schema.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(schema.required, [
    'fallback_required',
    'reason',
    'poll_after_ms',
    'strategy',
    'latest_event_id',
    'retention_floor_event_id',
  ]);
  assert.equal(schema.properties.fallback_required.const, true);
  assert.deepEqual(schema.properties.reason.enum, [
    'SSE_DISABLED',
    'CAPACITY_REACHED',
    'REPLAY_GAP',
    'TEMPORARY_UNAVAILABLE',
  ]);
  assert.deepEqual(schema.properties.strategy.enum, [
    'REFETCH_CONVERSATION_LIST_AND_TIMELINE',
    'POLL_UNTIL_SSE_AVAILABLE',
  ]);
  assert.equal(schema.properties.poll_after_ms.minimum, 1_000);
  assert.equal(schema.properties.poll_after_ms.maximum, 300_000);
  assert.equal(schema.$defs.nullable_bigint_string['x-maximum-decimal'], MAX_POSTGRES_BIGINT);
});

test('normalization rejects invalid event, source, aggregate and scope vocabularies', () => {
  for (const overrides of [
    { event_type: 'conversation.session.created\nretry: 0' },
    { event_type: 'conversation.unknown' },
    { source_type: 'UNKNOWN_SOURCE' },
    { aggregate_type: 'UNKNOWN_AGGREGATE' },
    { authorization_scope_type: 'EVERYTHING' },
    { visibility_scope: 'PUBLIC' },
  ]) {
    assertStableFailure(
      () => validCommand(overrides),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
});

test('SESSION and THREAD require a UUID scope while SYSTEM requires null', () => {
  for (const overrides of [
    { authorization_scope_type: 'SESSION', authorization_scope_id: null },
    { authorization_scope_type: 'THREAD', authorization_scope_id: null },
    { authorization_scope_type: 'SESSION', authorization_scope_id: 'not-a-uuid' },
    { authorization_scope_type: 'SYSTEM', authorization_scope_id: SESSION_ID },
  ]) {
    assertStableFailure(
      () => validCommand(overrides),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
  assert.equal(validCommand({
    authorization_scope_type: 'THREAD',
    authorization_scope_id: THREAD_ID,
  }).authorization_scope_id, THREAD_ID);
  assert.equal(validCommand({
    authorization_scope_type: 'SYSTEM',
    authorization_scope_id: null,
  }).authorization_scope_id, null);
});

test('normalization rejects invalid timestamps and requires expires_at after occurred_at', () => {
  for (const overrides of [
    { occurred_at: '2026-02-30T09:00:00.000Z' },
    { occurred_at: 'not-a-date' },
    { expires_at: 'not-a-date' },
    { expires_at: OCCURRED_AT },
    { expires_at: '2026-08-30T08:59:59.999Z' },
  ]) {
    assertStableFailure(
      () => validCommand(overrides),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
});

test('aggregate versions use nullable canonical PostgreSQL BIGINT strings', () => {
  assert.equal(validCommand({ aggregate_version: null }).aggregate_version, null);
  assert.equal(validCommand({ aggregate_version: '0' }).aggregate_version, '0');
  assert.equal(validCommand({ aggregate_version: MAX_POSTGRES_BIGINT }).aggregate_version, MAX_POSTGRES_BIGINT);
  for (const aggregateVersion of [
    '-1',
    '01',
    '+1',
    '1.0',
    '1e3',
    '9223372036854775808',
    ' 1',
  ]) {
    assertStableFailure(
      () => validCommand({ aggregate_version: aggregateVersion }),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
});

test('Last-Event-ID accepts zero and the BIGINT maximum without Number conversion', () => {
  assert.equal(parseRealtimeLastEventId(undefined), null);
  assert.equal(parseRealtimeLastEventId('0'), '0');
  assert.equal(parseRealtimeLastEventId('9007199254740993'), '9007199254740993');
  assert.equal(parseRealtimeLastEventId(MAX_POSTGRES_BIGINT), MAX_POSTGRES_BIGINT);
});

test('Last-Event-ID rejects negative, decimal, scientific, signed, spaced and overflow forms', () => {
  for (const value of [
    '-1',
    '01',
    '+1',
    '1.0',
    '1e3',
    '9223372036854775808',
    ' 1',
    '',
  ]) {
    assertStableFailure(
      () => parseRealtimeLastEventId(value),
      REALTIME_SSE_ERROR_CODES.cursorInvalid,
      RealtimeSseError,
    );
  }
});

test('payload accepts only bounded plain finite JSON data', () => {
  for (const payload of [
    [],
    new Date(),
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: 1n },
    { value: undefined },
    Object.assign(Object.create({ inherited: true }), { value: 1 }),
  ]) {
    assertStableFailure(
      () => validCommand({ payload }),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
});

test('payload enforces depth, node, object, array, string and canonical-byte limits', () => {
  let depthAtLimit = 'leaf';
  for (let index = 0; index < 5; index += 1) depthAtLimit = { level: depthAtLimit };
  assert.equal(validCommand({ payload: { root: depthAtLimit } }).payload.root.level !== undefined, true);

  const tooDeep = { level: depthAtLimit };
  const tooManyNodes = Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => [`bucket_${index}`, Array(64).fill(0)]),
  );
  const tooManyProperties = Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`key_${index}`, index]),
  );
  const tooManyArrayItems = { values: Array(101).fill(0) };
  const tooLongString = { value: 'x'.repeat(4097) };
  const tooManyBytes = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`blob_${index}`, 'x'.repeat(4096)]),
  );
  for (const payload of [
    { root: tooDeep },
    tooManyNodes,
    tooManyProperties,
    tooManyArrayItems,
    tooLongString,
    tooManyBytes,
  ]) {
    assertStableFailure(
      () => validCommand({ payload }),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
});

test('payload rejects Proxy and accessor paths without invoking hostile code', () => {
  let invoked = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'status', {
    enumerable: true,
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  const proxy = new Proxy({ status: 'OPEN' }, {
    ownKeys: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  for (const payload of [accessor, proxy]) {
    assertStableFailure(
      () => validCommand({ payload }),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
  assert.equal(invoked, 0);
});

test('payload rejects toJSON, symbols and prototype-pollution keys', () => {
  const symbolKey = { status: 'OPEN' };
  symbolKey[Symbol('secret')] = PRIVATE_SENTINEL;
  for (const payload of [
    { toJSON: () => ({ status: 'OPEN' }) },
    symbolKey,
    { value: Symbol('secret') },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    { constructor: { prototype: { polluted: true } } },
  ]) {
    assertStableFailure(
      () => validCommand({ payload }),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
  assert.equal({}.polluted, undefined);
});

test('payload rejects message content and sensitive identifier property names', () => {
  for (const key of [
    'text',
    'message',
    'safe_content',
    'internal_note',
    'raw_payload',
    'media_url',
    'bot_secret',
    'database_url',
    'provider_message_id',
    'userid',
    'chatid',
    'operator_id',
  ]) {
    assertStableFailure(
      () => validCommand({ payload: { [key]: PRIVATE_SENTINEL } }),
      REALTIME_ERROR_CODES.eventInvalid,
      RealtimeEventLogError,
    );
  }
});

test('event key is stable, opaque and changes with its frozen identity tuple', () => {
  const first = validCommand({ payload: { beta: [2, 3], alpha: 1 } });
  const reordered = validCommand({ payload: { alpha: 1, beta: [2, 3] } });
  assert.equal(computeRealtimeEventKey(first), computeRealtimeEventKey(reordered));
  assert.match(computeRealtimeEventKey(first), /^rte_v1_[a-f0-9]{64}$/u);
  assert.notEqual(
    computeRealtimeEventKey(first),
    computeRealtimeEventKey(validCommand({ event_variant: 'CONVERSATION_SESSION_UPDATED_V1' })),
  );
});

test('event hash is canonical across payload key order and changes on semantic mutation', () => {
  const first = validCommand({ payload: { beta: [2, 3], alpha: 1 } });
  const reordered = validCommand({ payload: { alpha: 1, beta: [2, 3] } });
  assert.equal(computeRealtimeEventHash(first), computeRealtimeEventHash(reordered));
  assert.match(computeRealtimeEventHash(first), /^[a-f0-9]{64}$/u);
  assert.notEqual(
    computeRealtimeEventHash(first),
    computeRealtimeEventHash(validCommand({ payload: { alpha: 2, beta: [2, 3] } })),
  );
});

test('event hash excludes expires_at, event_id and created_at', () => {
  const command = validCommand();
  const tightened = validCommand({ expires_at: '2026-09-01T09:00:00.000Z' });
  assert.equal(computeRealtimeEventHash(command), computeRealtimeEventHash(tightened));
  assert.equal(
    computeRealtimeEventHash(command),
    computeRealtimeEventHash({
      ...command,
      event_id: '99',
      created_at: CREATED_AT,
    }),
  );
});

test('Conversation Item mapper exposes only the seven safe projection fields plus occurred_at', () => {
  const command = mapConversationItemCreatedEvent({
    id: ITEM_ID,
    session_id: SESSION_ID,
    sequence_no: '9007199254740993',
    item_type: 'AGENT_MESSAGE',
    sender_kind: 'AGENT',
    visibility: 'EXTERNAL',
    text: PRIVATE_SENTINEL,
    safe_content: { text: PRIVATE_SENTINEL },
    source_id: PRIVATE_SENTINEL,
    source_hash: PRIVATE_SENTINEL,
    content_hash: PRIVATE_SENTINEL,
    provider_message_id: PRIVATE_SENTINEL,
    occurred_at: OCCURRED_AT,
    retention_until: EXPIRES_AT,
  });
  assert.equal(command.event_type, 'conversation.item.created');
  assert.equal(command.aggregate_type, 'CONVERSATION_ITEM');
  assert.deepEqual(Object.keys(command.payload), [
    'item_id',
    'session_id',
    'sequence_no',
    'item_type',
    'sender_kind',
    'visibility',
    'occurred_at',
  ]);
  assert.equal(command.payload.sequence_no, '9007199254740993');
  assert.doesNotMatch(JSON.stringify(command), new RegExp(PRIVATE_SENTINEL, 'u'));
});

test('Session fixture mapper freezes created and updated event variants with safe payloads', () => {
  for (const eventType of ['conversation.session.created', 'conversation.session.updated']) {
    const command = mapConversationSessionEvent({
      session_id: SESSION_ID,
      thread_id: THREAD_ID,
      status: 'OPEN',
      control_mode: 'HUMAN',
      generation_version: '2',
      row_version: '3',
      occurred_at: OCCURRED_AT,
      expires_at: EXPIRES_AT,
      event_type: eventType,
    });
    assert.equal(command.event_type, eventType);
    assert.equal(command.aggregate_type, 'CONVERSATION_SESSION');
    assert.deepEqual(Object.keys(command.payload), [
      'session_id',
      'thread_id',
      'status',
      'control_mode',
      'generation_version',
      'row_version',
      'occurred_at',
    ]);
    assert.equal(command.payload.row_version, '3');
  }
});

test('Timeline rebuilt fixture mapper exposes only count and canonical hash metadata', () => {
  const command = mapTimelineRebuiltEvent({
    session_id: SESSION_ID,
    item_count: 17,
    canonical_timeline_hash: 'a'.repeat(64),
    aggregate_version: '17',
    occurred_at: OCCURRED_AT,
    expires_at: EXPIRES_AT,
  });
  assert.equal(command.event_type, 'conversation.timeline.rebuilt');
  assert.equal(command.aggregate_type, 'CONVERSATION_TIMELINE');
  assert.deepEqual(Object.keys(command.payload), [
    'session_id',
    'item_count',
    'canonical_timeline_hash',
    'occurred_at',
  ]);
});

test('public event view contains exactly nine safe fields and no publisher, source, hash or scope IDs', () => {
  const command = validCommand();
  const view = publicRealtimeEventFromRow({
    ...command,
    event_id: '1',
    event_key: `rte_v1_${'a'.repeat(64)}`,
    stream_name: 'CONVERSATION_WORKBENCH',
    payload_hash: 'b'.repeat(64),
    event_hash: 'c'.repeat(64),
    created_at: CREATED_AT,
    provider_error: PRIVATE_SENTINEL,
  });
  assert.deepEqual(Object.keys(view), [
    'event_id',
    'event_type',
    'aggregate_type',
    'aggregate_id',
    'aggregate_version',
    'visibility_scope',
    'payload',
    'occurred_at',
    'created_at',
  ]);
  assert.doesNotMatch(
    JSON.stringify(view),
    /publisher|source_id|event_key|payload_hash|event_hash|authorization_scope_id|PRIVATE_SENTINEL/iu,
  );
});

test('SSE event encoding uses id/type/single-line JSON and supports every frozen event type', () => {
  for (const eventType of EXPECTED_EVENT_TYPES) {
    const frame = encodeRealtimeSseEvent(publicEvent({ event_type: eventType }));
    assert.match(frame, /^id: 1\nevent: [a-z0-9_.]+\ndata: \{[^\r\n]+\}\n\n$/u);
    assert.equal(frame.includes(`event: ${eventType}\n`), true);
  }
});

test('SSE encoding rejects CR/LF event injection and never emits raw payload newlines', () => {
  assertStableFailure(
    () => encodeRealtimeSseEvent(publicEvent({ event_type: 'ticket.updated\nretry: 0' })),
    REALTIME_SSE_ERROR_CODES.eventInvalid,
    RealtimeSseError,
  );
  const frame = encodeRealtimeSseEvent(publicEvent({ payload: { status: 'OPEN\nCLOSED' } }));
  assert.equal(frame.includes('OPEN\\nCLOSED'), true);
  assert.equal(frame.includes('OPEN\nCLOSED'), false);
});

test('heartbeat is a comment frame and consumes no event id', () => {
  const heartbeat = encodeRealtimeHeartbeat();
  assert.equal(heartbeat, ': heartbeat\n\n');
  assert.doesNotMatch(heartbeat, /^(?:id|event|data):/mu);
});

test('authorization defaults to deny-all and rejects absent or malformed contexts', () => {
  for (const normalize of [normalizeEventAuthorization, normalizeSseAuthorization]) {
    assertStableFailure(
      () => normalize(undefined),
      normalize === normalizeSseAuthorization
        ? REALTIME_SSE_ERROR_CODES.forbidden
        : REALTIME_ERROR_CODES.forbidden,
      normalize === normalizeSseAuthorization ? RealtimeSseError : RealtimeEventLogError,
    );
    assert.deepEqual(normalize({}), {
      allowed_session_ids: [],
      allowed_thread_ids: [],
      allow_system_events: false,
      allow_restricted_admin: false,
    });
  }
});

test('authorization normalizes bounded UUID sets without wildcard access', () => {
  const authorization = normalizeSseAuthorization({
    allowed_session_ids: [SESSION_ID.toUpperCase(), SESSION_ID],
    allowed_thread_ids: [THREAD_ID],
    allow_system_events: false,
    allow_restricted_admin: false,
  });
  assert.deepEqual(authorization.allowed_session_ids, [SESSION_ID]);
  assert.deepEqual(authorization.allowed_thread_ids, [THREAD_ID]);
  assert.equal(authorization.allow_system_events, false);
  assert.equal(authorization.allow_restricted_admin, false);
  assertStableFailure(
    () => normalizeSseAuthorization({ allowed_session_ids: ['*'] }),
    REALTIME_SSE_ERROR_CODES.forbidden,
    RealtimeSseError,
  );
});

test('restricted-admin defense-in-depth closes a malicious replay without delivering it', async () => {
  const response = new FakeResponse();
  const handler = createRealtimeSseHandler({
    enabled: true,
    eventStore: fakeEventStore([publicEvent({ visibility_scope: 'RESTRICTED_ADMIN' })]),
    authenticate: async () => ({ principal: 'synthetic' }),
    authorize: async () => ({
      allowed_session_ids: [SESSION_ID],
      allowed_thread_ids: [],
      allow_system_events: false,
      allow_restricted_admin: false,
    }),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
    queueMicrotaskFn: (callback) => queueMicrotask(callback),
  });
  await handler(new FakeRequest(), response);
  assert.equal(response.destroyed, true);
  assert.equal(response.body, '');
  assert.equal(handler.getMetrics().storage_disconnect_count, 1);
  await handler.close();
});

test('controlled principal disconnect closes only the selected SSE client', async () => {
  const principalA = '01990c80-0000-7000-8000-000000000011';
  const principalB = '01990c80-0000-7000-8000-000000000012';
  const handler = createRealtimeSseHandler({
    enabled: true,
    eventStore: fakeEventStore(),
    authenticate: async (request) => ({ principal_id: request.headers.principal_id }),
    authorize: async () => ({ allowed_session_ids: [SESSION_ID] }),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });
  const responseA = new FakeResponse();
  const responseB = new FakeResponse();
  const servingA = handler(new FakeRequest({ headers: { principal_id: principalA } }), responseA);
  const servingB = handler(new FakeRequest({ headers: { principal_id: principalB } }), responseB);
  while (handler.getMetrics().active_clients < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(handler.disconnectPrincipal(principalA), { disconnected_count: 1 });
  await servingA;
  assert.equal(responseA.destroyed, true);
  assert.equal(responseB.destroyed, false);
  assert.equal(handler.getMetrics().active_clients, 1);
  assert.deepEqual(handler.disconnectPrincipal(principalA), { disconnected_count: 0 });
  await handler.close();
  await servingB;
  assert.equal(handler.getMetrics().active_clients, 0);
});

test('disabled handler returns safe polling fallback with zero database calls and no timers', async () => {
  let queryCount = 0;
  const pool = {
    async query() {
      queryCount += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  };
  const response = new FakeResponse();
  const handler = createRealtimeSseHandler({
    pool,
    enabled: false,
    authenticate: async () => ({ principal: 'synthetic' }),
    authorize: async () => ({}),
  });
  await handler(new FakeRequest(), response);
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 503);
  assert.equal(body.error.code, REALTIME_SSE_ERROR_CODES.disabled);
  assert.deepEqual(body.fallback, buildRealtimeFallback({
    reason: 'SSE_DISABLED',
    strategy: 'POLL_UNTIL_SSE_AVAILABLE',
    pollAfterMs: REALTIME_SSE_DEFAULTS.recoveryPollMs,
  }));
  assert.equal(queryCount, 0);
  assert.equal(handler.getMetrics().active_clients, 0);
  assert.equal(handler.getMetrics().active_heartbeat_timers, 0);
  assert.equal(handler.getMetrics().active_recovery_timers, 0);
});

test('disabled event store fails before acquiring a database connection', async () => {
  let queryCount = 0;
  const store = createRealtimeEventStore({
    enabled: false,
    pool: {
      async query() {
        queryCount += 1;
        throw new Error(PRIVATE_SENTINEL);
      },
    },
    defaultRetentionMs: 7 * 24 * 60 * 60 * 1000,
  });
  await assertStableAsyncFailure(
    () => store.append(validCommand()),
    REALTIME_ERROR_CODES.disabled,
    RealtimeEventLogError,
  );
  assert.equal(queryCount, 0);
});

test('disconnect during authentication never acquires replay, Hub, or timer resources', async () => {
  let resolveAuthentication;
  let replayQueryCount = 0;
  const handler = createRealtimeSseHandler({
    enabled: true,
    authenticate: () => new Promise((resolve) => {
      resolveAuthentication = resolve;
    }),
    authorize: async () => ({
      allowed_session_ids: [SESSION_ID],
      allowed_thread_ids: [],
      allow_system_events: false,
      allow_restricted_admin: false,
    }),
    eventStore: {
      async getRealtimeReplayWindow() {
        replayQueryCount += 1;
        return { retention_floor_event_id: '0', high_watermark_event_id: '0' };
      },
      async listAuthorizedRealtimeEvents() {
        replayQueryCount += 1;
        return { events: [], next_after_event_id: '0' };
      },
    },
  });
  const request = new FakeRequest();
  const response = new FakeResponse();
  const pending = handler(request, response);
  assert.equal(typeof resolveAuthentication, 'function');
  request.aborted = true;
  request.emit('aborted');
  resolveAuthentication({ principal: 'synthetic' });
  await pending;

  const metrics = handler.getMetrics();
  assert.equal(replayQueryCount, 0);
  assert.equal(metrics.active_clients, 0);
  assert.equal(metrics.open_streams, 0);
  assert.equal(metrics.active_heartbeat_timers, 0);
  assert.equal(metrics.active_recovery_timers, 0);
  assert.equal(metrics.active_drain_waiters, 0);
  assert.equal(handler.hubSnapshot().active_clients, 0);
  assert.equal(response.headersSent, false);
  await handler.close();
});

test('disconnect during authorization never acquires replay, Hub, or timer resources', async () => {
  let resolveAuthorization;
  let replayQueryCount = 0;
  const handler = createRealtimeSseHandler({
    enabled: true,
    authenticate: async () => ({ principal: 'synthetic' }),
    authorize: () => new Promise((resolve) => {
      resolveAuthorization = resolve;
    }),
    eventStore: {
      async getRealtimeReplayWindow() {
        replayQueryCount += 1;
        return { retention_floor_event_id: '0', high_watermark_event_id: '0' };
      },
      async listAuthorizedRealtimeEvents() {
        replayQueryCount += 1;
        return { events: [], next_after_event_id: '0' };
      },
    },
  });
  const request = new FakeRequest();
  const response = new FakeResponse();
  const pending = handler(request, response);
  await Promise.resolve();
  assert.equal(typeof resolveAuthorization, 'function');
  request.aborted = true;
  request.emit('aborted');
  resolveAuthorization({
    allowed_session_ids: [SESSION_ID],
    allowed_thread_ids: [],
    allow_system_events: false,
    allow_restricted_admin: false,
  });
  await pending;

  const metrics = handler.getMetrics();
  assert.equal(replayQueryCount, 0);
  assert.equal(metrics.active_clients, 0);
  assert.equal(metrics.open_streams, 0);
  assert.equal(metrics.active_heartbeat_timers, 0);
  assert.equal(metrics.active_recovery_timers, 0);
  assert.equal(metrics.active_drain_waiters, 0);
  assert.equal(handler.hubSnapshot().active_clients, 0);
  assert.equal(response.headersSent, false);
  await handler.close();
});

test('Wakeup Hub admits 32 clients, rejects the 33rd, and releases capacity', () => {
  const hub = createRealtimeWakeupHub({ maxClients: 32 });
  const leases = Array.from({ length: 32 }, () => hub.subscribe(() => {}));
  assert.equal(hub.snapshot().active_clients, 32);
  assertStableFailure(
    () => hub.subscribe(() => {}),
    REALTIME_SSE_ERROR_CODES.capacityReached,
    RealtimeSseError,
  );
  leases[0].release();
  const replacement = hub.subscribe(() => {});
  assert.equal(hub.snapshot().active_clients, 32);
  replacement.release();
  for (const lease of leases.slice(1)) lease.release();
  assert.equal(hub.snapshot().active_clients, 0);
});

test('replay batch configuration accepts 200 and rejects 201', async () => {
  const store = fakeEventStore();
  const handler = createRealtimeSseHandler({
    enabled: true,
    replayBatchSize: 200,
    eventStore: store,
  });
  await handler.close();
  assertStableFailure(
    () => createRealtimeSseHandler({
      enabled: true,
      replayBatchSize: 201,
      eventStore: store,
    }),
    REALTIME_SSE_ERROR_CODES.eventInvalid,
    RealtimeSseError,
  );
});

test('list replay rejects limits above 200 before querying storage', async () => {
  let queryCount = 0;
  await assertStableAsyncFailure(
    () => listAuthorizedRealtimeEvents({
      pool: {
        async query() {
          queryCount += 1;
          return { rows: [] };
        },
      },
      streamName: 'CONVERSATION_WORKBENCH',
      afterEventId: '0',
      limit: 201,
      authorization: {
        allowed_session_ids: [SESSION_ID],
        allowed_thread_ids: [],
        allow_system_events: false,
        allow_restricted_admin: false,
      },
    }),
    REALTIME_ERROR_CODES.eventInvalid,
    RealtimeEventLogError,
  );
  assert.equal(queryCount, 0);
});

test('backpressure waits for drain and releases only the affected stream', async () => {
  const response = new FakeResponse({
    writeResult: false,
    writableLength: 1,
    onWrite(target) {
      queueMicrotask(() => target.emit('drain'));
      queueMicrotask(() => target.emit('close'));
    },
  });
  const handler = createRealtimeSseHandler({
    enabled: true,
    eventStore: fakeEventStore([publicEvent()]),
    authenticate: async () => ({ principal: 'synthetic' }),
    authorize: async () => ({ allowed_session_ids: [SESSION_ID] }),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });
  await handler(new FakeRequest(), response);
  assert.equal(handler.getMetrics().active_drain_waiters, 0);
  assert.equal(handler.getMetrics().active_clients, 0);
  assert.equal(handler.getMetrics().slow_client_disconnect_count, 0);
  await handler.close();
});

test('drain timeout disconnects only the slow client with bounded metrics', async () => {
  const response = new FakeResponse({ writeResult: false, writableLength: 1 });
  const handler = createRealtimeSseHandler({
    enabled: true,
    eventStore: fakeEventStore([publicEvent()]),
    authenticate: async () => ({ principal: 'synthetic' }),
    authorize: async () => ({ allowed_session_ids: [SESSION_ID] }),
    drainTimeoutMs: 1,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
    setTimeoutFn: (callback) => setTimeout(callback, 1),
    clearTimeoutFn: (timer) => clearTimeout(timer),
  });
  await handler(new FakeRequest(), response);
  assert.equal(response.destroyed, true);
  assert.equal(handler.getMetrics().slow_client_disconnect_count, 1);
  assert.equal(handler.getMetrics().active_drain_waiters, 0);
  assert.equal(handler.getMetrics().active_clients, 0);
  await handler.close();
});

test('retention gap after SSE headers closes the stream and reconnect returns 410 fallback', async () => {
  const establishedResponse = new FakeResponse();
  const establishedHandler = createRealtimeSseHandler({
    enabled: true,
    eventStore: {
      async getRealtimeReplayWindow() {
        return { retention_floor_event_id: '0', high_watermark_event_id: '1' };
      },
      async listAuthorizedRealtimeEvents() {
        throw new RealtimeEventLogError(REALTIME_ERROR_CODES.replayGap);
      },
    },
    authenticate: async () => ({ principal: 'synthetic' }),
    authorize: async () => ({ allowed_session_ids: [SESSION_ID] }),
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });
  await establishedHandler(new FakeRequest({ headers: { 'last-event-id': '0' } }), establishedResponse);
  assert.equal(establishedResponse.statusCode, 200);
  assert.equal(establishedResponse.headersSent, true);
  assert.equal(establishedResponse.destroyed, true);
  assert.equal(establishedHandler.getMetrics().active_clients, 0);
  assert.equal(establishedHandler.getMetrics().active_heartbeat_timers, 0);
  assert.equal(establishedHandler.getMetrics().active_recovery_timers, 0);
  await establishedHandler.close();

  const reconnectResponse = new FakeResponse();
  const reconnectHandler = createRealtimeSseHandler({
    enabled: true,
    eventStore: {
      async getRealtimeReplayWindow() {
        return { retention_floor_event_id: '1', high_watermark_event_id: '1' };
      },
      async listAuthorizedRealtimeEvents() {
        assert.fail('pre-header replay gap must not query event payloads');
      },
    },
    authenticate: async () => ({ principal: 'synthetic' }),
    authorize: async () => ({ allowed_session_ids: [SESSION_ID] }),
  });
  await reconnectHandler(
    new FakeRequest({ headers: { 'last-event-id': '0' } }),
    reconnectResponse,
  );
  assert.equal(reconnectResponse.statusCode, 410);
  const reconnectBody = JSON.parse(reconnectResponse.body);
  assert.equal(reconnectBody.error.code, REALTIME_SSE_ERROR_CODES.replayGap);
  assert.equal(reconnectBody.fallback.reason, 'REPLAY_GAP');
  assert.equal(reconnectBody.fallback.latest_event_id, '1');
  assert.equal(reconnectBody.fallback.retention_floor_event_id, '1');
  assert.equal(reconnectHandler.getMetrics().active_clients, 0);
  await reconnectHandler.close();
});

test('polling fallback normalizes canonical IDs and rejects unsafe forms', () => {
  const fallback = buildRealtimeFallback({
    reason: 'REPLAY_GAP',
    strategy: 'REFETCH_CONVERSATION_LIST_AND_TIMELINE',
    pollAfterMs: 5_000,
    latestEventId: MAX_POSTGRES_BIGINT,
    retentionFloorEventId: '7',
  });
  assert.deepEqual(fallback, {
    fallback_required: true,
    reason: 'REPLAY_GAP',
    poll_after_ms: 5_000,
    strategy: 'REFETCH_CONVERSATION_LIST_AND_TIMELINE',
    latest_event_id: MAX_POSTGRES_BIGINT,
    retention_floor_event_id: '7',
  });
  assertStableFailure(
    () => buildRealtimeFallback({
      reason: 'REPLAY_GAP',
      strategy: 'REFETCH_CONVERSATION_LIST_AND_TIMELINE',
      latestEventId: '1e3',
    }),
    REALTIME_SSE_ERROR_CODES.cursorInvalid,
    RealtimeSseError,
  );
});

test('public HTTP errors expose only stable codes and never raw authentication failures', async () => {
  const response = new FakeResponse();
  const handler = createRealtimeSseHandler({
    enabled: true,
    eventStore: fakeEventStore(),
    authenticate: async () => {
      throw new Error(`${PRIVATE_SENTINEL} postgresql://secret`);
    },
  });
  await handler(new FakeRequest(), response);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    error: {
      code: REALTIME_SSE_ERROR_CODES.unauthenticated,
      retryable: false,
    },
  });
  assert.doesNotMatch(response.body, /PRIVATE_SENTINEL|postgresql:\/\//u);
  await handler.close();
});
