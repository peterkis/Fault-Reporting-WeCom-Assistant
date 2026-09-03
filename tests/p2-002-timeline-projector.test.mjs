import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TIMELINE_ERROR_CODES,
  TIMELINE_ITEM_TYPES,
  TIMELINE_PROJECTOR_NAME,
  TIMELINE_PROJECTOR_VERSION,
  TIMELINE_SENDER_KINDS,
  TIMELINE_SOURCE_RANKS,
  TIMELINE_SOURCE_TYPES,
  TIMELINE_VISIBILITIES,
  TimelineProjectionError,
  applyTimelineProjectionMigration,
  compareTimelineSourceRecords,
  computeTimelineCanonicalHash,
  computeTimelineCanonicalOrderKey,
  createP1TimelineSourceAdapter,
  createTimelineProjector,
  createTimelineProjectorWorker,
  createTimelineSourceAdapter,
  mapChannelMessageTimelineSource,
  mapCommunicationMessageFixtureTimelineSource,
  mapHandoffEventFixtureTimelineSource,
  mapNotificationDeliveryTimelineSource,
  mapTicketEventTimelineSources,
  normalizeTimelineSourceRecord,
} from '../src/p2-002-timeline-projector.mjs';

const SESSION_ID = '01990c80-0000-7000-8000-000000000001';
const SOURCE_ID = '01990c80-0000-7000-8000-000000000002';
const SECOND_SOURCE_ID = '01990c80-0000-7000-8000-000000000003';
const OCCURRED_AT = '2026-08-30 17:00:00';
const RETENTION_UNTIL = '2027-08-30 17:00:00';
const PRIVATE_SENTINEL = 'PRIVATE_SENTINEL_DO_NOT_LEAK';

function assertStableSyncFailure(operation, code = TIMELINE_ERROR_CODES.sourceInvalid) {
  let caught;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TimelineProjectionError);
  assert.equal(caught.code, code);
  assert.equal(caught.message, code);
  assert.doesNotMatch(String(caught), /PRIVATE_SENTINEL_DO_NOT_LEAK/u);
}

async function assertStableAsyncFailure(operation, code = TIMELINE_ERROR_CODES.sourceInvalid) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TimelineProjectionError);
  assert.equal(caught.code, code);
  assert.equal(caught.message, code);
  assert.doesNotMatch(String(caught), /PRIVATE_SENTINEL_DO_NOT_LEAK/u);
}

function sourceRecord(overrides = {}) {
  return normalizeTimelineSourceRecord({
    schema_version: 1,
    projector_name: TIMELINE_PROJECTOR_NAME,
    projector_version: TIMELINE_PROJECTOR_VERSION,
    source_stream: 'fixture.timeline',
    source_type: 'COMMUNICATION_MESSAGE',
    source_id: SOURCE_ID,
    projection_variant: 'MESSAGE',
    session_id: SESSION_ID,
    item_type: 'AGENT_MESSAGE',
    sender_kind: 'AGENT',
    visibility: 'EXTERNAL',
    text: 'synthetic message',
    safe_content: { delivery_kind: 'REPLY', ordinal: 1 },
    occurred_at: OCCURRED_AT,
    source_ordinal: '1',
    privacy_class: 'INTERNAL',
    retention_until: RETENTION_UNTIL,
    ...overrides,
  });
}

function rehash(record, overrides) {
  const { source_hash: ignored, ...withoutHash } = record;
  return normalizeTimelineSourceRecord({ ...withoutHash, ...overrides });
}

function channelRow(overrides = {}) {
  return {
    id: '41',
    msg_type: 'mixed',
    clean_text: '打印机无法使用',
    raw_text: 'never-copy-this',
    raw_payload: { secret: 'never-copy-this' },
    normalized_message: { media_url: 'https://invalid.example/private' },
    received_at: OCCURRED_AT,
    privacy_class: 'PERSONAL',
    retention_until: RETENTION_UNTIL,
    relation_type: 'PRIMARY',
    sequence_no: '1',
    ...overrides,
  };
}

function ticketRow(overrides = {}) {
  return {
    event_id: SOURCE_ID,
    event_type: 'ticket.started',
    old_status: 'ACCEPTED',
    new_status: 'IN_PROGRESS',
    aggregate_version: '3',
    event_ordinal: '3',
    operator_type: 'PILOT_USER',
    operator_id: 'opaque-operator-never-copy',
    external_note: '工程师正在处理',
    internal_note: '内部诊断细节',
    reason_code: 'WORK_STARTED',
    created_at: OCCURRED_AT,
    privacy_class: 'SENSITIVE_INTERNAL',
    retention_until: RETENTION_UNTIL,
    ...overrides,
  };
}

function mapperContext(overrides = {}) {
  return {
    projectorName: TIMELINE_PROJECTOR_NAME,
    projectorVersion: TIMELINE_PROJECTOR_VERSION,
    sessionId: SESSION_ID,
    ...overrides,
  };
}

function itemRow(overrides = {}) {
  return {
    id: SECOND_SOURCE_ID,
    session_id: SESSION_ID,
    sequence_no: '1',
    item_type: 'AGENT_MESSAGE',
    sender_kind: 'AGENT',
    visibility: 'EXTERNAL',
    text: 'safe projected text',
    safe_content: { kind: 'REPLY' },
    source_type: 'COMMUNICATION_MESSAGE',
    source_id: SOURCE_ID,
    projection_variant: 'MESSAGE',
    canonical_order_key: '2026-08-30 17:00:00|20|0000000000000000001|aa|bb|cc',
    content_hash: 'a'.repeat(64),
    privacy_class: 'INTERNAL',
    retention_until: RETENTION_UNTIL,
    occurred_at: OCCURRED_AT,
    projected_at: '2026-08-30 18:00:00',
    ...overrides,
  };
}

test('P2-002 uses the frozen P2-001 Conversation Item enums', async () => {
  const schema = JSON.parse(await readFile(
    new URL('../contracts/conversation_item.schema.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(TIMELINE_ITEM_TYPES, schema.properties.item_type.enum);
  assert.deepEqual(TIMELINE_SENDER_KINDS, schema.properties.sender_kind.enum);
  assert.deepEqual(TIMELINE_VISIBILITIES, schema.properties.visibility.enum);
});

test('projection source schema parses and freezes the five source types', async () => {
  const schema = JSON.parse(await readFile(
    new URL('../contracts/conversation_projection_source.schema.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(schema.properties.source_type.enum, TIMELINE_SOURCE_TYPES);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.text.maxLength, 20_000);
});

test('normalization rejects invalid source type, session UUID, date, ordinal and additions', () => {
  const valid = sourceRecord();
  for (const overrides of [
    { source_type: 'UNKNOWN' },
    { session_id: 'not-a-uuid' },
    { occurred_at: '2026-02-30 17:00:00' },
    { source_ordinal: '01' },
    { source_ordinal: '9223372036854775808' },
    { unexpected: true },
  ]) {
    const { source_hash: ignored, ...plain } = valid;
    assert.throws(
      () => normalizeTimelineSourceRecord({ ...plain, ...overrides }),
      { code: TIMELINE_ERROR_CODES.sourceInvalid },
    );
  }
});

test('date normalization rejects hostile Date/object paths without invoking or leaking them', () => {
  const { source_hash: ignored, ...raw } = sourceRecord();
  let invoked = 0;
  const hostileDate = new Date(OCCURRED_AT);
  for (const name of ['getTime', 'toISOString', 'valueOf']) {
    Object.defineProperty(hostileDate, name, {
      configurable: true,
      enumerable: true,
      get: () => {
        invoked += 1;
        throw new Error(PRIVATE_SENTINEL);
      },
    });
  }
  assertStableSyncFailure(() => normalizeTimelineSourceRecord({
    ...raw,
    occurred_at: hostileDate,
  }));

  const fakeDate = {};
  Object.defineProperty(fakeDate, 'toISOString', {
    enumerable: true,
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  assertStableSyncFailure(() => normalizeTimelineSourceRecord({
    ...raw,
    occurred_at: fakeDate,
  }));

  const proxiedDate = new Proxy(new Date(OCCURRED_AT), {
    getPrototypeOf: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  assertStableSyncFailure(() => normalizeTimelineSourceRecord({
    ...raw,
    occurred_at: proxiedDate,
  }));
  assert.equal(invoked, 0);
});

test('safe_content accepts only bounded plain JSON data properties', () => {
  for (const safeContent of [
    new Date(),
    { value: Number.NaN },
    { value: 1n },
    { value: undefined },
    Object.assign(Object.create({ inherited: true }), { value: 1 }),
  ]) {
    assert.throws(
      () => sourceRecord({ safe_content: safeContent }),
      { code: TIMELINE_ERROR_CODES.sourceInvalid },
    );
  }
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 'hidden' });
  assert.throws(
    () => sourceRecord({ safe_content: accessor }),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
});

test('toJSON, Proxy and prototype-pollution keys cannot bypass pure JSON checks', () => {
  assert.throws(
    () => sourceRecord({ safe_content: { toJSON: () => ({}) } }),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
  assert.throws(
    () => sourceRecord({ safe_content: new Proxy({ safe: true }, {}) }),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
  assert.throws(
    () => normalizeTimelineSourceRecord(new Proxy(sourceRecord(), {})),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
  assert.throws(
    () => sourceRecord({ safe_content: JSON.parse('{"__proto__":{"polluted":true}}') }),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
  assert.equal({}.polluted, undefined);
});

test('source_hash is stable across key order and detects semantic mutation', () => {
  const first = sourceRecord({ safe_content: { beta: [2, 3], alpha: 1 } });
  const second = sourceRecord({ safe_content: { alpha: 1, beta: [2, 3] } });
  assert.equal(first.source_hash, second.source_hash);
  assert.match(first.source_hash, /^[a-f0-9]{64}$/u);
  assert.throws(
    () => normalizeTimelineSourceRecord({ ...first, text: 'changed but stale hash' }),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
});

test('privacy and retention controls can tighten without changing semantic source_hash', () => {
  const initial = sourceRecord({ privacy_class: 'INTERNAL' });
  const tightened = rehash(initial, {
    privacy_class: 'SECRET',
    retention_until: '2026-12-01 08:00:00',
  });
  assert.equal(initial.source_hash, tightened.source_hash);
});

test('canonical order uses the frozen rank and exact deterministic tie-break tuple', () => {
  assert.deepEqual(TIMELINE_SOURCE_RANKS, {
    CHANNEL_MESSAGE: 10,
    COMMUNICATION_MESSAGE: 20,
    TICKET_EVENT: 30,
    DELIVERY: 40,
    HANDOFF_EVENT: 50,
  });
  const channel = rehash(sourceRecord(), {
    source_type: 'CHANNEL_MESSAGE',
    source_id: '41',
    source_ordinal: '9',
    item_type: 'USER_MESSAGE',
    sender_kind: 'USER',
  });
  const communication = rehash(sourceRecord(), { source_ordinal: '1' });
  assert.equal(compareTimelineSourceRecords(channel, communication), -1);
  assert.notEqual(
    computeTimelineCanonicalOrderKey(channel),
    computeTimelineCanonicalOrderKey(communication),
  );
});

test('canonical order compares BIGINT ordinals numerically without Number conversion', () => {
  const ordinal2 = rehash(sourceRecord(), { source_ordinal: '2' });
  const ordinal10 = rehash(sourceRecord(), { source_ordinal: '10' });
  const veryLarge = rehash(sourceRecord(), { source_ordinal: '9007199254740993' });
  assert.equal(compareTimelineSourceRecords(ordinal2, ordinal10), -1);
  assert.equal(compareTimelineSourceRecords(ordinal10, veryLarge), -1);
});

test('source id and variant break otherwise identical timestamp/rank/ordinal ties', () => {
  const alpha = sourceRecord({ source_id: SOURCE_ID, projection_variant: 'ALPHA' });
  const beta = sourceRecord({ source_id: SOURCE_ID, projection_variant: 'BETA' });
  const nextId = sourceRecord({ source_id: SECOND_SOURCE_ID, projection_variant: 'ALPHA' });
  assert.equal(compareTimelineSourceRecords(alpha, beta), -1);
  assert.equal(compareTimelineSourceRecords(alpha, nextId), -1);
});

test('CHANNEL_MESSAGE maps only clean_text and four safe flags', () => {
  const record = mapChannelMessageTimelineSource(channelRow(), mapperContext());
  assert.equal(record.text, '打印机无法使用');
  assert.equal(record.item_type, 'USER_MESSAGE');
  assert.equal(record.sender_kind, 'USER');
  assert.equal(record.visibility, 'EXTERNAL');
  assert.deepEqual(Object.keys(record.safe_content), [
    'has_media',
    'has_text',
    'msg_type',
    'relation_type',
  ]);
  assert.equal(record.safe_content.has_media, true);
  assert.doesNotMatch(JSON.stringify(record), /never-copy|media_url/iu);
});

test('TICKET_EVENT splits STATUS, EXTERNAL_NOTE and INTERNAL_NOTE variants', () => {
  const records = mapTicketEventTimelineSources(ticketRow(), mapperContext());
  assert.deepEqual(records.map((record) => record.projection_variant), [
    'STATUS',
    'EXTERNAL_NOTE',
    'INTERNAL_NOTE',
  ]);
  assert.equal(records[1].visibility, 'EXTERNAL');
  assert.equal(records[1].text, '工程师正在处理');
  assert.equal(records[2].visibility, 'INTERNAL');
  assert.equal(records[2].text, '内部诊断细节');
  assert.equal(records[0].text, null);
});

test('TICKET_EVENT external variant cannot contain internal note or operator identity', () => {
  const records = mapTicketEventTimelineSources(ticketRow(), mapperContext());
  const external = records.find((record) => record.visibility === 'EXTERNAL');
  const serialized = JSON.stringify(external);
  assert.doesNotMatch(serialized, /内部诊断|opaque-operator-never-copy/u);
  assert.equal(external.safe_content.operator_id, undefined);
});

test('TICKET_EVENT omits absent note variants', () => {
  const records = mapTicketEventTimelineSources(ticketRow({
    external_note: null,
    internal_note: null,
  }), mapperContext());
  assert.deepEqual(records.map((record) => record.projection_variant), ['STATUS']);
});

test('DELIVERY is INTERNAL and excludes target/provider/raw error data', () => {
  const record = mapNotificationDeliveryTimelineSource({
    delivery_id: SOURCE_ID,
    channel: 'WECOM_DIRECT',
    outcome: 'RETRY_SCHEDULED',
    attempt_no: '2',
    error_code: 'PROVIDER_TEMPORARY',
    target_key: 'raw-user-id',
    provider_message_id: 'provider-id',
    raw_error: 'sensitive provider response',
    occurred_at: OCCURRED_AT,
    privacy_class: 'PERSONAL',
    retention_until: RETENTION_UNTIL,
  }, mapperContext());
  assert.equal(record.visibility, 'INTERNAL');
  assert.equal(record.projection_variant, 'ATTEMPT_2');
  assert.deepEqual(Object.keys(record.safe_content), [
    'attempt_count',
    'channel',
    'error_code',
    'status',
  ]);
  assert.doesNotMatch(JSON.stringify(record), /raw-user-id|provider-id|sensitive provider/u);
});

test('Communication Message fixture mapper requires an explicit fixture marker', () => {
  const fixture = {
    fixture: true,
    id: SOURCE_ID,
    text: 'synthetic agent reply',
    safe_content: { kind: 'REPLY' },
    occurred_at: OCCURRED_AT,
    source_ordinal: '4',
    privacy_class: 'INTERNAL',
    retention_until: RETENTION_UNTIL,
  };
  const record = mapCommunicationMessageFixtureTimelineSource(fixture, mapperContext());
  assert.equal(record.source_type, 'COMMUNICATION_MESSAGE');
  assert.equal(record.item_type, 'AGENT_MESSAGE');
  assert.throws(
    () => mapCommunicationMessageFixtureTimelineSource({ ...fixture, fixture: false }, mapperContext()),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
});

test('Handoff fixture defaults to INTERNAL and never creates a future table dependency', () => {
  const record = mapHandoffEventFixtureTimelineSource({
    fixture_kind: 'HANDOFF_EVENT',
    event_id: SOURCE_ID,
    safe_content: { reason_code: 'SHIFT_CHANGE' },
    occurred_at: OCCURRED_AT,
    source_ordinal: '5',
    privacy_class: 'INTERNAL',
    retention_until: RETENTION_UNTIL,
  }, mapperContext());
  assert.equal(record.source_type, 'HANDOFF_EVENT');
  assert.equal(record.item_type, 'HANDOFF_EVENT');
  assert.equal(record.visibility, 'INTERNAL');
});

test('normalized safe_content deny-list blocks privacy and provider leakage fields', () => {
  for (const key of [
    'raw_payload',
    'AESKey',
    'mediaUrl',
    'response_url',
    'database_url',
    'provider_message_id',
    'userid',
    'chatid',
    'target_key',
    'operator_id',
  ]) {
    assert.throws(
      () => sourceRecord({ safe_content: { [key]: 'not-allowed' } }),
      { code: TIMELINE_ERROR_CODES.sourceInvalid },
    );
  }
});

test('feature flag is fail-closed before any database call', async () => {
  let calls = 0;
  const projector = createTimelineProjector({
    pool: {
      query: async () => { calls += 1; },
      connect: async () => { calls += 1; },
    },
  });
  await assert.rejects(
    projector.projectBatch({}),
    { code: TIMELINE_ERROR_CODES.disabled },
  );
  await assert.rejects(
    projector.listTimelineItems({}),
    { code: TIMELINE_ERROR_CODES.disabled },
  );
  assert.equal(calls, 0);
});

test('batchSize defaults to 20 and is bounded at construction and invocation', async () => {
  const defaultProjector = createTimelineProjector();
  assert.equal(defaultProjector.batchSize, 20);
  assert.throws(
    () => createTimelineProjector({ batchSize: 201 }),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
  const projector = createTimelineProjector({
    enabled: true,
    batchSize: 1,
    pool: { query: async () => {}, connect: async () => ({}) },
  });
  await assert.rejects(
    projector.projectBatch({
      projectorName: TIMELINE_PROJECTOR_NAME,
      projectorVersion: TIMELINE_PROJECTOR_VERSION,
      sourceStream: 'fixture.timeline',
      records: [sourceRecord(), sourceRecord({ source_id: SECOND_SOURCE_ID })],
    }),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
});

test('runtime freezes every source and operation to the single timeline projector name', async () => {
  const { source_hash: ignored, ...raw } = sourceRecord();
  assertStableSyncFailure(() => normalizeTimelineSourceRecord({
    ...raw,
    projector_name: 'OTHER_PROJECTOR',
  }));
  assertStableSyncFailure(() => createP1TimelineSourceAdapter({
    pool: { query: async () => {}, connect: async () => ({}) },
    projectorName: 'OTHER_PROJECTOR',
  }));

  let calls = 0;
  const projector = createTimelineProjector({
    enabled: true,
    pool: {
      query: async () => { calls += 1; return { rowCount: 0, rows: [] }; },
      connect: async () => { calls += 1; throw new Error(PRIVATE_SENTINEL); },
    },
  });
  await assertStableAsyncFailure(() => projector.getProjectionCheckpoint({
    projectorName: 'OTHER_PROJECTOR',
    sourceStream: 'fixture.timeline',
  }));
  assertStableSyncFailure(() => projector.checkRebuildSession({
    sessionId: SESSION_ID,
    projectorName: 'OTHER_PROJECTOR',
    projectorVersion: TIMELINE_PROJECTOR_VERSION,
    records: [],
  }));

  const worker = createTimelineProjectorWorker({
    sourceAdapter: {
      sourceStream: 'fixture.timeline',
      readBatch: async () => {
        calls += 1;
        return { records: [] };
      },
    },
    projector: { projectBatch: async () => ({}) },
  });
  await assertStableAsyncFailure(() => worker.runOnce({ projectorName: 'OTHER_PROJECTOR' }));
  assert.equal(calls, 0);
});

test('public storage failures contain only the stable code', async () => {
  const projector = createTimelineProjector({
    enabled: true,
    pool: {
      query: async () => { throw new Error('postgresql://user:secret@host/db SELECT private'); },
      connect: async () => { throw new Error('postgresql://user:secret@host/db'); },
    },
  });
  let caught;
  try {
    await projector.listTimelineItems({
      sessionId: SESSION_ID,
      audience: 'EXTERNAL',
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof TimelineProjectionError);
  assert.equal(caught.code, TIMELINE_ERROR_CODES.storageFailed);
  assert.equal(caught.message, TIMELINE_ERROR_CODES.storageFailed);
  assert.doesNotMatch(String(caught), /postgresql|secret|SELECT/u);
});

test('database sequence uniqueness is deterministically mapped to the frozen sequence error', async () => {
  const client = {
    query: async (sql) => {
      if (/FROM conversation\.projection_checkpoint/iu.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (/FROM conversation\.item_source_binding AS binding/iu.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (/FROM conversation\.session/iu.test(sql)) {
        return { rowCount: 1, rows: [{ id: SESSION_ID }] };
      }
      if (/ORDER BY item\.sequence_no DESC/iu.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (/INSERT INTO conversation\.item\s*\(/iu.test(sql)) {
        const error = new Error('private duplicate detail');
        error.code = '23505';
        error.constraint = 'conversation_item_session_sequence_unique';
        throw error;
      }
      return { rowCount: 1, rows: [{}] };
    },
    release: () => {},
  };
  const projector = createTimelineProjector({
    enabled: true,
    pool: { query: async () => {}, connect: async () => client },
  });
  await assert.rejects(
    projector.projectOne(sourceRecord()),
    {
      code: TIMELINE_ERROR_CODES.sequenceConflict,
      message: TIMELINE_ERROR_CODES.sequenceConflict,
    },
  );
});

test('rebuild authorization and wrapper accessor validation fail before storage', async () => {
  const projector = createTimelineProjector({ enabled: true });
  await assert.rejects(
    projector.rebuildSession({
      sessionId: SESSION_ID,
      projectorName: TIMELINE_PROJECTOR_NAME,
      projectorVersion: TIMELINE_PROJECTOR_VERSION,
      records: [sourceRecord()],
    }),
    { code: TIMELINE_ERROR_CODES.rebuildNotAuthorized },
  );
  const accessorInput = {};
  Object.defineProperty(accessorInput, 'projectorName', {
    enumerable: true,
    get: () => { throw new Error('private getter detail'); },
  });
  await assert.rejects(
    projector.projectBatch(accessorInput),
    {
      code: TIMELINE_ERROR_CODES.sourceInvalid,
      message: TIMELINE_ERROR_CODES.sourceInvalid,
    },
  );
});

test('rebuild stale-snapshot fence fails before DELETE for extra or foreign bindings', async () => {
  for (const rowOverrides of [
    { source_id: 'newly-committed-source' },
    { projector_name: 'OTHER_PROJECTOR' },
  ]) {
    const statements = [];
    const client = {
      query: async (sql) => {
        statements.push(sql);
        if (/FROM conversation\.session/iu.test(sql)) {
          return { rowCount: 1, rows: [{ id: SESSION_ID }] };
        }
        if (/LEFT JOIN conversation\.item_source_binding/iu.test(sql)) {
          return {
            rowCount: 1,
            rows: [{
              item_id: SECOND_SOURCE_ID,
              privacy_class: 'INTERNAL',
              retention_until: RETENTION_UNTIL,
              projector_name: TIMELINE_PROJECTOR_NAME,
              source_stream: 'fixture.timeline',
              source_type: 'COMMUNICATION_MESSAGE',
              source_id: SOURCE_ID,
              projection_variant: 'MESSAGE',
              session_id: SESSION_ID,
              source_hash: sourceRecord().source_hash,
              ...rowOverrides,
            }],
          };
        }
        return { rowCount: null, rows: [] };
      },
      release: () => {},
    };
    const projector = createTimelineProjector({
      enabled: true,
      pool: { query: async () => {}, connect: async () => client },
    });
    await assertStableAsyncFailure(
      () => projector.rebuildSession({
        sessionId: SESSION_ID,
        projectorName: TIMELINE_PROJECTOR_NAME,
        projectorVersion: TIMELINE_PROJECTOR_VERSION,
        records: [sourceRecord()],
        authorized: true,
      }),
      TIMELINE_ERROR_CODES.rebuildFailed,
    );
    assert.equal(statements.some((sql) => /^DELETE FROM conversation\.item/u.test(sql)), false);
    assert.equal(statements.includes('COMMIT'), false);
    assert.equal(statements.includes('ROLLBACK'), true);
  }
});

test('Canonical Timeline Hash excludes projected_at and physical input order', () => {
  const first = itemRow({ sequence_no: '1', projected_at: '2026-08-30 18:00:00' });
  const second = itemRow({
    id: '01990c80-0000-7000-8000-000000000004',
    sequence_no: '2',
    source_id: SECOND_SOURCE_ID,
    content_hash: 'b'.repeat(64),
    occurred_at: '2026-08-30 17:00:01',
    projected_at: '2026-08-30 18:00:01',
  });
  const expected = computeTimelineCanonicalHash([first, second]);
  assert.equal(computeTimelineCanonicalHash([
    { ...second, projected_at: '2030-01-01 08:00:00' },
    { ...first, projected_at: '2040-01-01 08:00:00' },
  ]), expected);
});

test('Canonical Timeline Hash validates arrays and items before any caller property access', () => {
  let invoked = 0;
  const accessorItem = itemRow();
  Object.defineProperty(accessorItem, 'sequence_no', {
    configurable: true,
    enumerable: true,
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  assertStableSyncFailure(() => computeTimelineCanonicalHash([accessorItem]));

  const accessorArray = [];
  Object.defineProperty(accessorArray, '0', {
    enumerable: true,
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  assertStableSyncFailure(() => computeTimelineCanonicalHash(accessorArray));

  const customMethodArray = [itemRow()];
  Object.defineProperty(customMethodArray, 'every', {
    enumerable: false,
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  assertStableSyncFailure(() => computeTimelineCanonicalHash(customMethodArray));

  assertStableSyncFailure(() => computeTimelineCanonicalHash([
    new Proxy(itemRow(), {
      get: () => {
        invoked += 1;
        throw new Error(PRIVATE_SENTINEL);
      },
    }),
  ]));

  class CustomArray extends Array {}
  assertStableSyncFailure(() => computeTimelineCanonicalHash(new CustomArray(itemRow())));

  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'sequence_no');
  try {
    Object.defineProperty(Object.prototype, 'sequence_no', {
      configurable: true,
      get: () => {
        invoked += 1;
        throw new Error(PRIVATE_SENTINEL);
      },
    });
    assert.match(computeTimelineCanonicalHash([sourceRecord()]), /^[a-f0-9]{64}$/u);
  } finally {
    if (prior === undefined) {
      delete Object.prototype.sequence_no;
    } else {
      Object.defineProperty(Object.prototype, 'sequence_no', prior);
    }
  }
  assert.equal(invoked, 0);
});

test('EXTERNAL audience uses SQL visibility filtering and defense-in-depth filtering', async () => {
  let params;
  let sql;
  const projector = createTimelineProjector({
    enabled: true,
    pool: {
      query: async (statement, values) => {
        sql = statement;
        params = values;
        return {
          rowCount: 2,
          rows: [
            itemRow(),
            itemRow({
              id: '01990c80-0000-7000-8000-000000000004',
              visibility: 'INTERNAL',
              sequence_no: '2',
            }),
          ],
        };
      },
    },
  });
  const result = await projector.listTimelineItems({
    sessionId: SESSION_ID,
    audience: 'EXTERNAL',
  });
  assert.match(sql, /visibility = ANY/u);
  assert.deepEqual(params[2], ['EXTERNAL']);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].visibility, 'EXTERNAL');
});

test('WORKBENCH excludes RESTRICTED and RESTRICTED_ADMIN requires explicit authorization', async () => {
  const seen = [];
  const projector = createTimelineProjector({
    enabled: true,
    pool: {
      query: async (_sql, values) => {
        seen.push(values[2]);
        return { rowCount: 0, rows: [] };
      },
    },
  });
  await projector.listTimelineItems({ sessionId: SESSION_ID, audience: 'WORKBENCH' });
  assert.deepEqual(seen[0], ['EXTERNAL', 'INTERNAL']);
  await assert.rejects(
    projector.listTimelineItems({ sessionId: SESSION_ID, audience: 'RESTRICTED_ADMIN' }),
    { code: TIMELINE_ERROR_CODES.rebuildNotAuthorized },
  );
  await projector.listTimelineItems({
    sessionId: SESSION_ID,
    audience: 'RESTRICTED_ADMIN',
    restrictedAuthorized: true,
  });
  assert.deepEqual(seen[1], ['EXTERNAL', 'INTERNAL', 'RESTRICTED']);
});

test('generic TimelineSourceAdapter maps rows outside projector transactions', async () => {
  let read = false;
  const adapter = createTimelineSourceAdapter({
    sourceStream: 'fixture.timeline',
    readBatch: async () => {
      read = true;
      return { records: [sourceRecord()], cursor_value: '1', done: true };
    },
  });
  const batch = await adapter.readBatch({ limit: 20 });
  assert.equal(read, true);
  assert.equal(batch.records.length, 1);
  assert.equal(batch.cursor_value, '1');
});

test('public wrapper APIs reject Proxy/accessor arguments before invoking dependencies', async () => {
  let invoked = 0;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, 'batchSize', {
    enumerable: true,
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  assertStableSyncFailure(() => createTimelineProjector(accessorOptions));
  assertStableSyncFailure(() => createTimelineSourceAdapter(accessorOptions));
  assertStableSyncFailure(() => createTimelineProjectorWorker(accessorOptions));
  assertStableSyncFailure(() => createP1TimelineSourceAdapter(accessorOptions));
  await assertStableAsyncFailure(() => applyTimelineProjectionMigration(accessorOptions));

  const accessorPool = {};
  Object.defineProperty(accessorPool, 'query', {
    enumerable: true,
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  await assertStableAsyncFailure(() => applyTimelineProjectionMigration({ pool: accessorPool }));

  const proxyOptions = new Proxy({}, {
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
    getPrototypeOf: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  assertStableSyncFailure(() => createTimelineProjector(proxyOptions));

  const adapter = createTimelineSourceAdapter({
    sourceStream: 'fixture.timeline',
    readBatch: async () => {
      invoked += 1;
      return { records: [] };
    },
  });
  await assertStableAsyncFailure(() => adapter.readBatch(accessorOptions));

  const worker = createTimelineProjectorWorker({
    sourceAdapter: {
      sourceStream: 'fixture.timeline',
      readBatch: async () => {
        invoked += 1;
        return { records: [] };
      },
    },
    projector: { projectBatch: async () => ({}) },
  });
  await assertStableAsyncFailure(() => worker.runOnce(accessorOptions));
  await assertStableAsyncFailure(() => worker.run(accessorOptions));

  const p1Adapter = createP1TimelineSourceAdapter({
    pool: {
      query: async () => {},
      connect: async () => {
        invoked += 1;
        return {};
      },
    },
  });
  await assertStableAsyncFailure(() => p1Adapter.readSessionRecords(accessorOptions));
  assert.equal(invoked, 0);
});

test('unknown Proxy/accessor error objects are sanitized without a second trap', async () => {
  let invoked = 0;
  const proxyError = new Proxy({}, {
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
    getPrototypeOf: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  const proxyAdapter = createTimelineSourceAdapter({
    sourceStream: 'fixture.timeline',
    readBatch: async () => { throw proxyError; },
  });
  await assertStableAsyncFailure(
    () => proxyAdapter.readBatch(),
    TIMELINE_ERROR_CODES.storageFailed,
  );

  const accessorError = {};
  Object.defineProperty(accessorError, 'code', {
    enumerable: true,
    get: () => {
      invoked += 1;
      throw new Error(PRIVATE_SENTINEL);
    },
  });
  const accessorAdapter = createTimelineSourceAdapter({
    sourceStream: 'fixture.timeline',
    readBatch: async () => { throw accessorError; },
  });
  await assertStableAsyncFailure(
    () => accessorAdapter.readBatch(),
    TIMELINE_ERROR_CODES.storageFailed,
  );
  assert.equal(invoked, 0);
});

test('worker reads a bounded batch before invoking the projector and preserves AbortSignal', async () => {
  const order = [];
  const adapter = {
    sourceStream: 'fixture.timeline',
    readBatch: async ({ signal }) => {
      assert.equal(signal.aborted, false);
      order.push('read');
      return { records: [sourceRecord()], cursor_value: '1', done: true };
    },
  };
  const projector = {
    projectBatch: async ({ signal, records }) => {
      assert.equal(signal.aborted, false);
      assert.equal(records.length, 1);
      order.push('project');
      return {
        received_count: 1,
        inserted_count: 1,
        replayed_count: 0,
      };
    },
  };
  const worker = createTimelineProjectorWorker({ sourceAdapter: adapter, projector });
  const controller = new AbortController();
  const result = await worker.runOnce({ signal: controller.signal });
  assert.deepEqual(order, ['read', 'project']);
  assert.equal(result.done, true);
  controller.abort();
  await assert.rejects(
    worker.runOnce({ signal: controller.signal }),
    { code: TIMELINE_ERROR_CODES.storageFailed },
  );
});

test('worker maps unknown adapter failures to the stable storage error', async () => {
  const worker = createTimelineProjectorWorker({
    sourceAdapter: {
      sourceStream: 'fixture.timeline',
      readBatch: async () => { throw new Error('private adapter URL and token'); },
    },
    projector: { projectBatch: async () => ({}) },
  });
  await assert.rejects(
    worker.runOnce(),
    {
      code: TIMELINE_ERROR_CODES.storageFailed,
      message: TIMELINE_ERROR_CODES.storageFailed,
    },
  );
});

test('checkpoint cursor accepts nullable expected values and enforces the shared 512 bound', async () => {
  let connections = 0;
  const projector = createTimelineProjector({
    enabled: true,
    pool: {
      query: async () => {},
      connect: async () => {
        connections += 1;
        throw new Error('stop after validation');
      },
    },
  });
  await assert.rejects(
    projector.projectBatch({
      projectorName: TIMELINE_PROJECTOR_NAME,
      projectorVersion: TIMELINE_PROJECTOR_VERSION,
      sourceStream: 'fixture.timeline',
      records: [sourceRecord()],
      expectedCheckpoint: { cursor_value: null, row_version: '1' },
    }),
    { code: TIMELINE_ERROR_CODES.storageFailed },
  );
  assert.equal(connections, 1);
  await assert.rejects(
    projector.projectBatch({
      projectorName: TIMELINE_PROJECTOR_NAME,
      projectorVersion: TIMELINE_PROJECTOR_VERSION,
      sourceStream: 'fixture.timeline',
      records: [sourceRecord()],
      expectedCheckpoint: 'x'.repeat(513),
    }),
    { code: TIMELINE_ERROR_CODES.sourceInvalid },
  );
  assert.equal(connections, 1);
});

test('migration runner executes only migration 011 and sanitizes raw failures', async () => {
  let migrationSql;
  await applyTimelineProjectionMigration({
    pool: {
      query: async (sql) => {
        if (/FROM pg_catalog\.pg_class AS relation/u.test(sql)) {
          return { rows: [{ applied: false }] };
        }
        migrationSql = sql;
        return { rows: [] };
      },
    },
  });
  assert.match(migrationSql, /conversation\.item_source_binding/u);
  assert.doesNotMatch(migrationSql, /CREATE TABLE[^;]+conversation\.realtime_event/isu);

  let supersededQueryCount = 0;
  const superseded = await applyTimelineProjectionMigration({
    pool: {
      query: async () => {
        supersededQueryCount += 1;
        return supersededQueryCount === 1
          ? { rows: [{ marker_table_exists: true }] }
          : { rows: [{ applied: true }] };
      },
    },
  });
  assert.deepEqual(superseded, { status: 'LEGACY_MIGRATION_SUPERSEDED' });
  assert.equal(supersededQueryCount, 2);

  await assert.rejects(
    applyTimelineProjectionMigration({
      pool: {
        query: async (sql) => {
          if (/FROM pg_catalog\.pg_class AS relation/u.test(sql)) {
            return { rows: [{ applied: false }] };
          }
          throw new Error('raw SQL and password');
        },
      },
    }),
    { code: TIMELINE_ERROR_CODES.storageFailed },
  );
  await assert.rejects(
    applyTimelineProjectionMigration({
      pool: {
        query: async (sql) => {
          if (/FROM pg_catalog\.pg_class AS relation/u.test(sql)) {
            return { rows: [{ applied: false }] };
          }
          const error = new Error(TIMELINE_ERROR_CODES.schemaDrift);
          error.code = '23514';
          throw error;
        },
      },
    }),
    {
      code: TIMELINE_ERROR_CODES.schemaDrift,
      message: TIMELINE_ERROR_CODES.schemaDrift,
    },
  );
});

test('the public error vocabulary contains exactly the eleven frozen stable codes', () => {
  assert.deepEqual(new Set(Object.values(TIMELINE_ERROR_CODES)), new Set([
    'CONVERSATION_TIMELINE_DISABLED',
    'CONVERSATION_TIMELINE_SOURCE_INVALID',
    'CONVERSATION_TIMELINE_SESSION_NOT_FOUND',
    'CONVERSATION_TIMELINE_SOURCE_CONFLICT',
    'CONVERSATION_TIMELINE_SEQUENCE_CONFLICT',
    'CONVERSATION_TIMELINE_REBUILD_REQUIRED',
    'CONVERSATION_TIMELINE_REBUILD_NOT_AUTHORIZED',
    'CONVERSATION_TIMELINE_REBUILD_FAILED',
    'CONVERSATION_TIMELINE_CHECKPOINT_CONFLICT',
    'CONVERSATION_TIMELINE_STORAGE_FAILED',
    'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
  ]));
});

test('P1 source adapter reads current sources in one repeatable-read read-only transaction', async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(sql);
      if (/SELECT id::text, service_intake_id::text/u.test(sql)) {
        return {
          rowCount: 1,
          rows: [{ id: SESSION_ID, service_intake_id: SECOND_SOURCE_ID }],
        };
      }
      if (/FROM intake\.service_intake_message/u.test(sql)) {
        return { rowCount: 1, rows: [channelRow()] };
      }
      if (/FROM pilot_ticket\.ticket_event/u.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (/FROM notification\.delivery_attempt/u.test(sql)) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: null, rows: [] };
    },
    release: () => {},
  };
  const adapter = createP1TimelineSourceAdapter({
    pool: { query: async () => {}, connect: async () => client },
  });
  const records = await adapter.readSessionRecords({ sessionId: SESSION_ID });
  assert.equal(statements[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(statements.at(-1), 'COMMIT');
  assert.equal(records.length, 1);
  assert.equal(records[0].source_type, 'CHANNEL_MESSAGE');
  assert.equal(records[0].session_id, SESSION_ID);
});
