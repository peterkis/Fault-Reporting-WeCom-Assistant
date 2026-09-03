import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import {
  addEpochMilliseconds,
  assertEpochMsString,
  assertLocalDateTime,
  formatEpochMsToShanghaiLocal,
  shanghaiLocalToEpochMs,
} from './platform/time-contract.mjs';

const MIGRATION_URL = new URL(
  '../database/migrations/012_p2_003_realtime_event_log.sql',
  import.meta.url,
);

const MAX_BIGINT_TEXT = '9223372036854775807';
const SAFE_JSON_MAX_DEPTH = 6;
const SAFE_JSON_MAX_NODES = 4_096;
const SAFE_JSON_MAX_KEYS = 64;
const SAFE_JSON_MAX_ARRAY = 100;
const SAFE_JSON_MAX_STRING = 4_096;
const SAFE_JSON_MAX_BYTES = 65_536;
const MAX_AUTHORIZATION_IDS = 256;
const STREAM_LOCK_IDENTITY = 'P2_003_REALTIME_STREAM:CONVERSATION_WORKBENCH';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const EVENT_KEY_PATTERN = /^rte_v1_[a-f0-9]{64}$/u;

export const REALTIME_STREAM_NAME = 'CONVERSATION_WORKBENCH';
export const REALTIME_DEFAULT_RETENTION_MS = 168 * 60 * 60 * 1_000;
export const REALTIME_DEFAULT_REPLAY_LIMIT = 50;
export const REALTIME_MAX_REPLAY_LIMIT = 200;
export const REALTIME_DEFAULT_CLEANUP_LIMIT = 200;
export const REALTIME_MAX_CLEANUP_LIMIT = 200;
export const REALTIME_SAFE_JSON_LIMITS = Object.freeze({
  maximum_depth: SAFE_JSON_MAX_DEPTH,
  maximum_nodes: SAFE_JSON_MAX_NODES,
  maximum_properties_per_object: SAFE_JSON_MAX_KEYS,
  maximum_array_items: SAFE_JSON_MAX_ARRAY,
  maximum_string_length: SAFE_JSON_MAX_STRING,
  maximum_canonical_bytes: SAFE_JSON_MAX_BYTES,
});

export const REALTIME_EVENT_TYPES = Object.freeze([
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
]);

export const REALTIME_SOURCE_TYPES = Object.freeze([
  'CONVERSATION_SESSION',
  'CONVERSATION_ITEM',
  'TIMELINE_REBUILD',
  'COMMUNICATION_DELIVERY',
  'TICKET_EVENT',
  'HANDOFF_EVENT',
  'READ_CURSOR',
  'INCIDENT_EVENT',
  'GATEWAY_EVENT',
]);

export const REALTIME_AGGREGATE_TYPES = Object.freeze([
  'CONVERSATION_SESSION',
  'CONVERSATION_ITEM',
  'CONVERSATION_TIMELINE',
  'COMMUNICATION_DELIVERY',
  'TICKET',
  'CONVERSATION_HANDOFF',
  'CONVERSATION_READ_CURSOR',
  'INCIDENT',
  'GATEWAY_CONNECTION',
]);

export const REALTIME_AUTHORIZATION_SCOPE_TYPES = Object.freeze([
  'SESSION',
  'THREAD',
  'SYSTEM',
]);

export const REALTIME_VISIBILITY_SCOPES = Object.freeze([
  'WORKBENCH',
  'RESTRICTED_ADMIN',
]);

export const REALTIME_ERROR_CODES = Object.freeze({
  disabled: 'CONVERSATION_REALTIME_DISABLED',
  eventInvalid: 'CONVERSATION_REALTIME_EVENT_INVALID',
  eventConflict: 'CONVERSATION_REALTIME_EVENT_CONFLICT',
  cursorInvalid: 'CONVERSATION_REALTIME_CURSOR_INVALID',
  cursorAhead: 'CONVERSATION_REALTIME_CURSOR_AHEAD',
  replayGap: 'CONVERSATION_REALTIME_REPLAY_GAP',
  unauthenticated: 'CONVERSATION_REALTIME_UNAUTHENTICATED',
  forbidden: 'CONVERSATION_REALTIME_FORBIDDEN',
  capacityReached: 'CONVERSATION_REALTIME_CAPACITY_REACHED',
  slowClient: 'CONVERSATION_REALTIME_SLOW_CLIENT',
  storageFailed: 'CONVERSATION_REALTIME_STORAGE_FAILED',
  retentionNotAuthorized: 'CONVERSATION_REALTIME_RETENTION_NOT_AUTHORIZED',
  retentionFailed: 'CONVERSATION_REALTIME_RETENTION_FAILED',
  schemaDrift: 'P2_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
});

const ERROR_CODE_SET = new Set(Object.values(REALTIME_ERROR_CODES));
const EVENT_TYPE_SET = new Set(REALTIME_EVENT_TYPES);
const SOURCE_TYPE_SET = new Set(REALTIME_SOURCE_TYPES);
const AGGREGATE_TYPE_SET = new Set(REALTIME_AGGREGATE_TYPES);
const AUTHORIZATION_SCOPE_TYPE_SET = new Set(REALTIME_AUTHORIZATION_SCOPE_TYPES);
const VISIBILITY_SCOPE_SET = new Set(REALTIME_VISIBILITY_SCOPES);
const COMMAND_KEYS = Object.freeze([
  'schema_version',
  'publisher_name',
  'publisher_version',
  'source_type',
  'source_id',
  'event_variant',
  'event_type',
  'aggregate_type',
  'aggregate_id',
  'aggregate_version',
  'authorization_scope_type',
  'authorization_scope_id',
  'visibility_scope',
  'payload',
  'occurred_at',
  'expires_at',
  'expires_epoch_ms',
]);
const COMMAND_KEY_SET = new Set(COMMAND_KEYS);
const REQUIRED_COMMAND_KEYS = Object.freeze(COMMAND_KEYS.filter((key) => key !== 'expires_epoch_ms'));
const AUTHORIZATION_KEYS = new Set([
  'allowed_session_ids',
  'allowed_thread_ids',
  'allow_system_events',
  'allow_restricted_admin',
]);
const FORBIDDEN_JSON_KEYS = new Set([
  '__proto__',
  'proto',
  'prototype',
  'constructor',
  'tojson',
  'rawpayload',
  'rawpayloadencrypted',
  'rawtext',
  'cleantext',
  'text',
  'message',
  'body',
  'content',
  'note',
  'externalnote',
  'messagebody',
  'messagetext',
  'safecontent',
  'aeskey',
  'mediaurl',
  'responseurl',
  'botsecret',
  'databaseurl',
  'databaseconnectionstring',
  'providererror',
  'providererrortext',
  'rawprovidererror',
  'providererrorraw',
  'providermessageid',
  'deliverytarget',
  'targetkey',
  'userid',
  'chatid',
  'operatorid',
  'patientid',
  'internalnote',
  'secret',
]);

export class RealtimeEventLogError extends Error {
  constructor(code) {
    const stableCode = typeof code === 'string' && ERROR_CODE_SET.has(code)
      ? code
      : REALTIME_ERROR_CODES.eventInvalid;
    super(stableCode);
    this.name = 'RealtimeEventLogError';
    this.code = stableCode;
  }
}

function fail(code) {
  throw new RealtimeEventLogError(code);
}

function isStableError(error) {
  try {
    if (
      error === null
      || typeof error !== 'object'
      || utilTypes.isProxy(error)
      || Object.getPrototypeOf(error) !== RealtimeEventLogError.prototype
    ) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor !== undefined
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      && ERROR_CODE_SET.has(descriptor.value);
  } catch {
    return false;
  }
}

function safeErrorDataProperty(error, key) {
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) {
      return undefined;
    }
    let current = error;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (utilTypes.isProxy(current)) {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function mapStorageError(error, fallback = REALTIME_ERROR_CODES.storageFailed) {
  if (isStableError(error)) {
    return error;
  }
  const code = safeErrorDataProperty(error, 'code');
  const message = safeErrorDataProperty(error, 'message');
  if (
    message === REALTIME_ERROR_CODES.schemaDrift
    || (code === '23514' && message === REALTIME_ERROR_CODES.schemaDrift)
  ) {
    return new RealtimeEventLogError(REALTIME_ERROR_CODES.schemaDrift);
  }
  return new RealtimeEventLogError(fallback);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || utilTypes.isProxy(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(value, code = REALTIME_ERROR_CODES.eventInvalid) {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      fail(code);
    }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
        fail(code);
      }
    }
  } catch (error) {
    if (isStableError(error)) {
      throw error;
    }
    fail(code);
  }
}

function plainRecordSnapshot(value, code = REALTIME_ERROR_CODES.eventInvalid) {
  assertPlainRecord(value, code);
  const snapshot = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function dataPropertyFromPrototypeChain(target, key, code) {
  try {
    if (
      target === null
      || (typeof target !== 'object' && typeof target !== 'function')
      || utilTypes.isProxy(target)
    ) {
      fail(code);
    }
    let current = target;
    for (let depth = 0; current !== null && depth < 16; depth += 1) {
      if (utilTypes.isProxy(current)) {
        fail(code);
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!Object.hasOwn(descriptor, 'value')) {
          fail(code);
        }
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch (error) {
    if (isStableError(error)) {
      throw error;
    }
    fail(code);
  }
  fail(code);
}

function assertExactKeys(snapshot, allowedKeys, requiredKeys, code) {
  const keys = Object.keys(snapshot);
  if (
    keys.some((key) => !allowedKeys.has(key))
    || requiredKeys.some((key) => !Object.hasOwn(snapshot, key))
  ) {
    fail(code);
  }
}

function normalizeKeyForDenyList(key) {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
}

function clonePlainJson(
  value,
  code = REALTIME_ERROR_CODES.eventInvalid,
  state = { seen: new Set(), nodes: 0 },
  depth = 0,
) {
  if (state.nodes >= SAFE_JSON_MAX_NODES) {
    fail(code);
  }
  state.nodes += 1;

  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (!value.isWellFormed() || value.length > SAFE_JSON_MAX_STRING || value.includes('\u0000')) {
      fail(code);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(code);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail(code);
  }
  if (depth >= SAFE_JSON_MAX_DEPTH) {
    fail(code);
  }
  if (state.seen.has(value)) {
    fail(code);
  }
  state.seen.add(value);

  try {
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      fail(code);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > SAFE_JSON_MAX_ARRAY) {
        fail(code);
      }
      const descriptorKeys = Object.keys(descriptors).filter((key) => key !== 'length');
      if (descriptorKeys.length !== value.length) {
        fail(code);
      }
      const copy = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined
          || !Object.hasOwn(descriptor, 'value')
          || descriptor.enumerable !== true
        ) {
          fail(code);
        }
        copy.push(clonePlainJson(descriptor.value, code, state, depth + 1));
      }
      return Object.freeze(copy);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(code);
    }
    const keys = Object.keys(descriptors);
    if (keys.length > SAFE_JSON_MAX_KEYS) {
      fail(code);
    }
    const copy = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true
        || !key.isWellFormed()
        || key.length < 1
        || key.length > 128
        || FORBIDDEN_JSON_KEYS.has(normalizeKeyForDenyList(key))
      ) {
        fail(code);
      }
      copy[key] = clonePlainJson(descriptor.value, code, state, depth + 1);
    }
    return Object.freeze(copy);
  } catch (error) {
    if (isStableError(error)) {
      throw error;
    }
    fail(code);
  } finally {
    state.seen.delete(value);
  }
}

function canonicalJson(value) {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(',')}}`;
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function boundedString(value, maximum, {
  minimum = 1,
  pattern = null,
  code = REALTIME_ERROR_CODES.eventInvalid,
} = {}) {
  if (
    typeof value !== 'string'
    || !value.isWellFormed()
    || value.length < minimum
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
    || (pattern !== null && !pattern.test(value))
  ) {
    fail(code);
  }
  return value;
}

function requiredUuid(value, code = REALTIME_ERROR_CODES.eventInvalid) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    fail(code);
  }
  return value.toLowerCase();
}

function canonicalBigint(value, {
  minimum = 0n,
  nullable = false,
  allowNumeric = false,
  code = REALTIME_ERROR_CODES.eventInvalid,
} = {}) {
  if (value === null && nullable) {
    return null;
  }
  let text;
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value)) {
    text = value;
  } else if (allowNumeric && typeof value === 'bigint') {
    text = value.toString();
  } else if (allowNumeric && typeof value === 'number' && Number.isSafeInteger(value)) {
    text = String(value);
  } else {
    fail(code);
  }
  if (
    text.length > MAX_BIGINT_TEXT.length
    || (text.length === MAX_BIGINT_TEXT.length && text > MAX_BIGINT_TEXT)
    || BigInt(text) < minimum
  ) {
    fail(code);
  }
  return text;
}

function boundedInteger(value, fallback, maximum, code = REALTIME_ERROR_CODES.eventInvalid) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    fail(code);
  }
  return candidate;
}

function isoDateTime(value, code = REALTIME_ERROR_CODES.eventInvalid) {
  try { return assertLocalDateTime(value); }
  catch { fail(code); }
}

function normalizeStreamName(value, code = REALTIME_ERROR_CODES.eventInvalid) {
  const candidate = value === undefined ? REALTIME_STREAM_NAME : value;
  if (candidate !== REALTIME_STREAM_NAME) {
    fail(code);
  }
  return candidate;
}

function enumValue(value, values, code = REALTIME_ERROR_CODES.eventInvalid) {
  if (typeof value !== 'string' || !values.has(value)) {
    fail(code);
  }
  return value;
}

function eventIdentifier(value, maximum = 256, code = REALTIME_ERROR_CODES.eventInvalid) {
  return boundedString(value, maximum, {
    code,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:\-]*$/u,
  });
}

function resultRows(result, code = REALTIME_ERROR_CODES.storageFailed) {
  const rows = dataPropertyFromPrototypeChain(result, 'rows', code);
  if (
    !Array.isArray(rows)
    || utilTypes.isProxy(rows)
    || Object.getPrototypeOf(rows) !== Array.prototype
    || rows.length > 10_000
  ) {
    fail(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(rows);
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== rows.length) {
    fail(code);
  }
  const snapshots = [];
  for (let index = 0; index < rows.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true
    ) {
      fail(code);
    }
    snapshots.push(plainRecordSnapshot(descriptor.value, code));
  }
  return Object.freeze(snapshots);
}

async function query(queryable, sql, values, code = REALTIME_ERROR_CODES.storageFailed) {
  const queryMethod = dataPropertyFromPrototypeChain(queryable, 'query', code);
  if (typeof queryMethod !== 'function') {
    fail(code);
  }
  return queryMethod.call(queryable, sql, values);
}

async function connectPool(pool, code = REALTIME_ERROR_CODES.storageFailed) {
  const connect = dataPropertyFromPrototypeChain(pool, 'connect', code);
  if (typeof connect !== 'function') {
    fail(code);
  }
  try {
    return await connect.call(pool);
  } catch {
    fail(code);
  }
}

async function rollbackQuietly(client) {
  try {
    await query(client, 'ROLLBACK', undefined, REALTIME_ERROR_CODES.storageFailed);
    return false;
  } catch {
    return true;
  }
}

function releaseQuietly(client, destroy = false) {
  try {
    const release = dataPropertyFromPrototypeChain(
      client,
      'release',
      REALTIME_ERROR_CODES.storageFailed,
    );
    if (typeof release === 'function') {
      release.call(client, destroy);
    }
  } catch {
    // Cleanup must not replace the stable public result or error.
  }
}

async function acquireStreamLock(transaction, code = REALTIME_ERROR_CODES.storageFailed) {
  await query(
    transaction,
    'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
    [STREAM_LOCK_IDENTITY],
    code,
  );
}

export function normalizeRealtimeEventCommand(input) {
  const snapshot = plainRecordSnapshot(input);
  assertExactKeys(snapshot, COMMAND_KEY_SET, REQUIRED_COMMAND_KEYS, REALTIME_ERROR_CODES.eventInvalid);
  if (snapshot.schema_version !== 1) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }

  const publisherName = boundedString(snapshot.publisher_name, 64, {
    pattern: /^[A-Z][A-Z0-9_.\-]*$/u,
  });
  const publisherVersion = boundedString(snapshot.publisher_version, 64, {
    pattern: /^[A-Za-z0-9][A-Za-z0-9._+\-]*$/u,
  });
  const sourceType = enumValue(snapshot.source_type, SOURCE_TYPE_SET);
  const sourceId = eventIdentifier(snapshot.source_id, 256);
  const eventVariant = boundedString(snapshot.event_variant, 64, {
    pattern: /^[A-Z][A-Z0-9_]*$/u,
  });
  const eventType = enumValue(snapshot.event_type, EVENT_TYPE_SET);
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/u.test(eventType)) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  const aggregateType = enumValue(snapshot.aggregate_type, AGGREGATE_TYPE_SET);
  const aggregateId = eventIdentifier(snapshot.aggregate_id, 256);
  const aggregateVersion = canonicalBigint(snapshot.aggregate_version, { nullable: true });
  const authorizationScopeType = enumValue(
    snapshot.authorization_scope_type,
    AUTHORIZATION_SCOPE_TYPE_SET,
  );
  const authorizationScopeId = snapshot.authorization_scope_id === null
    ? null
    : requiredUuid(snapshot.authorization_scope_id);
  if (
    (authorizationScopeType === 'SYSTEM' && authorizationScopeId !== null)
    || (authorizationScopeType !== 'SYSTEM' && authorizationScopeId === null)
  ) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  const visibilityScope = enumValue(snapshot.visibility_scope, VISIBILITY_SCOPE_SET);
  const payload = clonePlainJson(snapshot.payload);
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  if (Buffer.byteLength(canonicalJson(payload), 'utf8') > SAFE_JSON_MAX_BYTES) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  const occurredAt = isoDateTime(snapshot.occurred_at);
  const expiresAt = isoDateTime(snapshot.expires_at);
  const occurredEpochMs = shanghaiLocalToEpochMs(occurredAt);
  let expiresEpochMs;
  try {
    expiresEpochMs = snapshot.expires_epoch_ms === undefined
      ? shanghaiLocalToEpochMs(expiresAt)
      : assertEpochMsString(snapshot.expires_epoch_ms);
  } catch { fail(REALTIME_ERROR_CODES.eventInvalid); }
  if (formatEpochMsToShanghaiLocal(expiresEpochMs) !== expiresAt) fail(REALTIME_ERROR_CODES.eventInvalid);
  if (BigInt(expiresEpochMs) <= BigInt(occurredEpochMs)) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }

  return Object.freeze({
    schema_version: 1,
    publisher_name: publisherName,
    publisher_version: publisherVersion,
    source_type: sourceType,
    source_id: sourceId,
    event_variant: eventVariant,
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
    authorization_scope_type: authorizationScopeType,
    authorization_scope_id: authorizationScopeId,
    visibility_scope: visibilityScope,
    payload,
    occurred_at: occurredAt,
    expires_at: expiresAt,
    expires_epoch_ms: expiresEpochMs,
  });
}

function realtimeEventKeyFromNormalized(command) {
  return `rte_v1_${sha256Canonical([
    'conversation-realtime-event-key-v1',
    command.publisher_name,
    command.source_type,
    command.source_id,
    command.event_variant,
    command.event_type,
    command.authorization_scope_type,
    command.authorization_scope_id,
  ])}`;
}

function realtimePayloadHashFromNormalized(command) {
  return sha256Canonical(command.payload);
}

function realtimeEventHashFromNormalized(command) {
  return sha256Canonical([
    'conversation-realtime-event-hash-v1',
    command.schema_version,
    REALTIME_STREAM_NAME,
    command.publisher_name,
    command.publisher_version,
    command.source_type,
    command.source_id,
    command.event_variant,
    command.event_type,
    command.aggregate_type,
    command.aggregate_id,
    command.aggregate_version,
    command.authorization_scope_type,
    command.authorization_scope_id,
    command.visibility_scope,
    command.payload,
    command.occurred_at,
  ]);
}

function normalizeRealtimeHashInput(input) {
  const snapshot = plainRecordSnapshot(input);
  const allowedRuntimeKeys = new Set([
    ...COMMAND_KEYS,
    'event_id',
    'created_at',
    'event_key',
    'payload_hash',
    'event_hash',
  ]);
  if (Object.keys(snapshot).some((key) => !allowedRuntimeKeys.has(key))) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  const command = Object.create(null);
  for (const key of COMMAND_KEYS) {
    if (!Object.hasOwn(snapshot, key) && key !== 'expires_epoch_ms') {
      fail(REALTIME_ERROR_CODES.eventInvalid);
    }
    if (Object.hasOwn(snapshot, key)) command[key] = snapshot[key];
  }
  return normalizeRealtimeEventCommand(command);
}

export function computeRealtimeEventKey(command) {
  return realtimeEventKeyFromNormalized(normalizeRealtimeHashInput(command));
}

export function computeRealtimeEventHash(command) {
  return realtimeEventHashFromNormalized(normalizeRealtimeHashInput(command));
}

function appendResult(eventId, status) {
  const normalizedEventId = canonicalBigint(eventId, {
    minimum: 1n,
    code: REALTIME_ERROR_CODES.storageFailed,
  });
  return Object.freeze({
    event_id: normalizedEventId,
    status,
    inserted_count: status === 'INSERTED' ? 1 : 0,
    replayed_count: status === 'REPLAYED' ? 1 : 0,
    conflict_count: 0,
  });
}

export async function appendRealtimeEvent(input) {
  input = plainRecordSnapshot(input);
  assertExactKeys(
    input,
    new Set(['transaction', 'command']),
    ['transaction', 'command'],
    REALTIME_ERROR_CODES.eventInvalid,
  );
  const command = normalizeRealtimeEventCommand(input.command);
  const eventKey = realtimeEventKeyFromNormalized(command);
  const payloadHash = realtimePayloadHashFromNormalized(command);
  const eventHash = realtimeEventHashFromNormalized(command);
  const transaction = input.transaction;

  try {
    await acquireStreamLock(transaction);
    await query(
      transaction,
      `INSERT INTO conversation.realtime_stream_state (stream_name)
       VALUES ($1)
       ON CONFLICT (stream_name) DO NOTHING`,
      [REALTIME_STREAM_NAME],
    );
    const inserted = resultRows(await query(
      transaction,
      `INSERT INTO conversation.realtime_event (
         event_key, stream_name, publisher_name, publisher_version,
         source_type, source_id, event_variant, event_type,
         aggregate_type, aggregate_id, aggregate_version,
         authorization_scope_type, authorization_scope_id,
         visibility_scope, payload, payload_hash, event_hash,
         occurred_at, expires_at, expires_epoch_ms
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11::bigint, $12, $13::uuid,
         $14, $15::jsonb, $16, $17, $18::timestamp without time zone, $19::timestamp without time zone, $20::bigint
       )
       ON CONFLICT (event_key) DO NOTHING
       RETURNING event_id::text`,
      [
        eventKey,
        REALTIME_STREAM_NAME,
        command.publisher_name,
        command.publisher_version,
        command.source_type,
        command.source_id,
        command.event_variant,
        command.event_type,
        command.aggregate_type,
        command.aggregate_id,
        command.aggregate_version,
        command.authorization_scope_type,
        command.authorization_scope_id,
        command.visibility_scope,
        canonicalJson(command.payload),
        payloadHash,
        eventHash,
        command.occurred_at,
        command.expires_at,
        command.expires_epoch_ms,
      ],
    ));

    if (inserted.length === 1) {
      return appendResult(inserted[0].event_id, 'INSERTED');
    }
    if (inserted.length !== 0) {
      fail(REALTIME_ERROR_CODES.storageFailed);
    }

    const existingRows = resultRows(await query(
      transaction,
      `SELECT event_id::text, payload_hash, event_hash, expires_at, expires_epoch_ms::text
         FROM conversation.realtime_event
        WHERE event_key = $1
          AND stream_name = $2
        FOR UPDATE`,
      [eventKey, REALTIME_STREAM_NAME],
    ));
    if (existingRows.length !== 1) {
      fail(REALTIME_ERROR_CODES.storageFailed);
    }
    const existing = existingRows[0];
    if (existing.event_hash !== eventHash || existing.payload_hash !== payloadHash) {
      fail(REALTIME_ERROR_CODES.eventConflict);
    }
    const existingExpiry = isoDateTime(existing.expires_at, REALTIME_ERROR_CODES.storageFailed);
    if (BigInt(command.expires_epoch_ms) < BigInt(assertEpochMsString(existing.expires_epoch_ms))) {
      const tightened = resultRows(await query(
        transaction,
        `UPDATE conversation.realtime_event
            SET expires_at = $2::timestamp without time zone,
                expires_epoch_ms = $5::bigint
          WHERE event_key = $1
            AND stream_name = $3
            AND event_hash = $4
            AND expires_epoch_ms > $5::bigint
          RETURNING event_id::text`,
        [eventKey, command.expires_at, REALTIME_STREAM_NAME, eventHash, command.expires_epoch_ms],
      ));
      if (tightened.length !== 1) {
        fail(REALTIME_ERROR_CODES.storageFailed);
      }
    }
    return appendResult(existing.event_id, 'REPLAYED');
  } catch (error) {
    throw mapStorageError(error);
  }
}

export async function applyRealtimeEventLogMigration(input) {
  input = plainRecordSnapshot(input);
  const pool = input.pool;
  try {
    const sql = await readFile(MIGRATION_URL, 'utf8');
    await query(pool, sql, undefined, REALTIME_ERROR_CODES.storageFailed);
  } catch (error) {
    throw mapStorageError(error);
  }
}

function normalizeUuidArray(value, code) {
  const candidate = value === undefined ? [] : value;
  if (
    !Array.isArray(candidate)
    || utilTypes.isProxy(candidate)
    || Object.getPrototypeOf(candidate) !== Array.prototype
    || candidate.length > MAX_AUTHORIZATION_IDS
  ) {
    fail(code);
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const keys = Object.keys(descriptors).filter((key) => key !== 'length');
  if (keys.length !== candidate.length) {
    fail(code);
  }
  const normalized = [];
  for (let index = 0; index < candidate.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.enumerable !== true
    ) {
      fail(code);
    }
    normalized.push(requiredUuid(descriptor.value, code));
  }
  return Object.freeze([...new Set(normalized)].sort());
}

export function normalizeRealtimeAuthorization(input) {
  if (input === null || input === undefined) {
    fail(REALTIME_ERROR_CODES.forbidden);
  }
  const snapshot = plainRecordSnapshot(input, REALTIME_ERROR_CODES.forbidden);
  if (Object.keys(snapshot).some((key) => !AUTHORIZATION_KEYS.has(key))) {
    fail(REALTIME_ERROR_CODES.forbidden);
  }
  const allowedSessionIds = normalizeUuidArray(
    snapshot.allowed_session_ids,
    REALTIME_ERROR_CODES.forbidden,
  );
  const allowedThreadIds = normalizeUuidArray(
    snapshot.allowed_thread_ids,
    REALTIME_ERROR_CODES.forbidden,
  );
  if (allowedSessionIds.length + allowedThreadIds.length > MAX_AUTHORIZATION_IDS) {
    fail(REALTIME_ERROR_CODES.forbidden);
  }
  const allowSystemEvents = snapshot.allow_system_events ?? false;
  const allowRestrictedAdmin = snapshot.allow_restricted_admin ?? false;
  if (typeof allowSystemEvents !== 'boolean' || typeof allowRestrictedAdmin !== 'boolean') {
    fail(REALTIME_ERROR_CODES.forbidden);
  }
  return Object.freeze({
    allowed_session_ids: allowedSessionIds,
    allowed_thread_ids: allowedThreadIds,
    allow_system_events: allowSystemEvents,
    allow_restricted_admin: allowRestrictedAdmin,
  });
}

async function readReplayWindow(pool, streamName) {
  const rows = resultRows(await query(
    pool,
    `WITH requested_stream(stream_name) AS (
       VALUES ($1::text)
     )
     SELECT requested_stream.stream_name,
            COALESCE(state.retention_floor_event_id, 0::bigint)::text
              AS retention_floor_event_id,
            GREATEST(
              COALESCE(state.retention_floor_event_id, 0::bigint),
              COALESCE((
                SELECT MAX(event.event_id)
                  FROM conversation.realtime_event AS event
                 WHERE event.stream_name = requested_stream.stream_name
              ), 0::bigint)
            )::text AS high_watermark_event_id
       FROM requested_stream
       LEFT JOIN conversation.realtime_stream_state AS state
         ON state.stream_name = requested_stream.stream_name`,
    [streamName],
  ));
  if (rows.length !== 1) {
    fail(REALTIME_ERROR_CODES.storageFailed);
  }
  const row = rows[0];
  return Object.freeze({
    stream_name: normalizeStreamName(row.stream_name, REALTIME_ERROR_CODES.storageFailed),
    retention_floor_event_id: canonicalBigint(row.retention_floor_event_id, {
      code: REALTIME_ERROR_CODES.storageFailed,
    }),
    high_watermark_event_id: canonicalBigint(row.high_watermark_event_id, {
      code: REALTIME_ERROR_CODES.storageFailed,
    }),
  });
}

export async function getRealtimeReplayWindow(input) {
  input = plainRecordSnapshot(input);
  const streamName = normalizeStreamName(input.streamName ?? input.stream_name);
  try {
    return await readReplayWindow(input.pool, streamName);
  } catch (error) {
    throw mapStorageError(error);
  }
}

export async function getRealtimeHighWatermark(input) {
  const window = await getRealtimeReplayWindow(input);
  return Object.freeze({
    stream_name: window.stream_name,
    high_watermark_event_id: window.high_watermark_event_id,
  });
}

function isAuthorizedPersistedRow(row, authorization) {
  const visibilityAllowed = row.visibility_scope === 'WORKBENCH'
    || (row.visibility_scope === 'RESTRICTED_ADMIN'
      && authorization.allow_restricted_admin);
  if (!visibilityAllowed) {
    return false;
  }
  if (row.authorization_scope_type === 'SYSTEM') {
    return row.authorization_scope_id === null && authorization.allow_system_events;
  }
  if (typeof row.authorization_scope_id !== 'string') {
    return false;
  }
  const normalizedScopeId = requiredUuid(
    row.authorization_scope_id,
    REALTIME_ERROR_CODES.storageFailed,
  );
  if (row.authorization_scope_type === 'SESSION') {
    return authorization.allowed_session_ids.includes(normalizedScopeId);
  }
  if (row.authorization_scope_type === 'THREAD') {
    return authorization.allowed_thread_ids.includes(normalizedScopeId);
  }
  return false;
}

function persistedCommandFromRow(row) {
  if (normalizeStreamName(row.stream_name, REALTIME_ERROR_CODES.storageFailed) !== REALTIME_STREAM_NAME) {
    fail(REALTIME_ERROR_CODES.storageFailed);
  }
  return normalizeRealtimeEventCommand({
    schema_version: 1,
    publisher_name: row.publisher_name,
    publisher_version: row.publisher_version,
    source_type: row.source_type,
    source_id: row.source_id,
    event_variant: row.event_variant,
    event_type: row.event_type,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    authorization_scope_type: row.authorization_scope_type,
    authorization_scope_id: row.authorization_scope_id,
    visibility_scope: row.visibility_scope,
    payload: row.payload,
    occurred_at: row.occurred_at,
    expires_at: row.expires_at,
  });
}

export function publicRealtimeEventFromRow(input) {
  const row = plainRecordSnapshot(input, REALTIME_ERROR_CODES.storageFailed);
  const payload = clonePlainJson(
    row.payload,
    REALTIME_ERROR_CODES.storageFailed,
  );
  if (payload === null || Array.isArray(payload) || typeof payload !== 'object') {
    fail(REALTIME_ERROR_CODES.storageFailed);
  }
  const aggregateVersion = canonicalBigint(row.aggregate_version, {
    nullable: true,
    code: REALTIME_ERROR_CODES.storageFailed,
  });
  return Object.freeze({
    event_id: canonicalBigint(row.event_id, {
      minimum: 1n,
      code: REALTIME_ERROR_CODES.storageFailed,
    }),
    event_type: enumValue(row.event_type, EVENT_TYPE_SET, REALTIME_ERROR_CODES.storageFailed),
    aggregate_type: enumValue(
      row.aggregate_type,
      AGGREGATE_TYPE_SET,
      REALTIME_ERROR_CODES.storageFailed,
    ),
    aggregate_id: eventIdentifier(
      row.aggregate_id,
      256,
      REALTIME_ERROR_CODES.storageFailed,
    ),
    aggregate_version: aggregateVersion,
    visibility_scope: enumValue(
      row.visibility_scope,
      VISIBILITY_SCOPE_SET,
      REALTIME_ERROR_CODES.storageFailed,
    ),
    payload,
    occurred_at: isoDateTime(row.occurred_at, REALTIME_ERROR_CODES.storageFailed),
    created_at: isoDateTime(row.created_at, REALTIME_ERROR_CODES.storageFailed),
  });
}

function validatePersistedEventRow(row, authorization) {
  try {
    const command = persistedCommandFromRow(row);
    if (
      typeof row.event_key !== 'string'
      || !EVENT_KEY_PATTERN.test(row.event_key)
      || typeof row.payload_hash !== 'string'
      || !SHA256_PATTERN.test(row.payload_hash)
      || typeof row.event_hash !== 'string'
      || !SHA256_PATTERN.test(row.event_hash)
      || !isAuthorizedPersistedRow(row, authorization)
    ) {
      fail(REALTIME_ERROR_CODES.storageFailed);
    }
    return publicRealtimeEventFromRow({
      event_id: row.event_id,
      event_type: command.event_type,
      aggregate_type: command.aggregate_type,
      aggregate_id: command.aggregate_id,
      aggregate_version: command.aggregate_version,
      visibility_scope: command.visibility_scope,
      payload: command.payload,
      occurred_at: command.occurred_at,
      created_at: row.created_at,
    });
  } catch {
    fail(REALTIME_ERROR_CODES.storageFailed);
  }
}

export async function listAuthorizedRealtimeEvents(input) {
  input = plainRecordSnapshot(input);
  const pool = input.pool;
  const streamName = normalizeStreamName(input.streamName ?? input.stream_name);
  const authorization = normalizeRealtimeAuthorization(input.authorization);
  const limit = boundedInteger(
    input.limit,
    REALTIME_DEFAULT_REPLAY_LIMIT,
    REALTIME_MAX_REPLAY_LIMIT,
    REALTIME_ERROR_CODES.eventInvalid,
  );
  const explicitCursor = input.afterEventId ?? input.after_event_id;
  const afterEventId = explicitCursor === undefined || explicitCursor === null
    ? null
    : canonicalBigint(explicitCursor, { code: REALTIME_ERROR_CODES.cursorInvalid });

  try {
    const rows = resultRows(await query(
      pool,
      `WITH requested_stream(stream_name) AS (
         VALUES ($1::text)
       ), replay_window AS MATERIALIZED (
         SELECT requested_stream.stream_name,
                COALESCE(state.retention_floor_event_id, 0::bigint)
                  AS retention_floor_event_id,
                GREATEST(
                  COALESCE(state.retention_floor_event_id, 0::bigint),
                  COALESCE((
                    SELECT MAX(event.event_id)
                      FROM conversation.realtime_event AS event
                     WHERE event.stream_name = requested_stream.stream_name
                  ), 0::bigint)
                ) AS high_watermark_event_id
           FROM requested_stream
           LEFT JOIN conversation.realtime_stream_state AS state
             ON state.stream_name = requested_stream.stream_name
       ), cursor_state AS MATERIALIZED (
         SELECT replay_window.*,
                COALESCE($2::bigint, retention_floor_event_id) AS effective_cursor
           FROM replay_window
       ), authorized_ids AS MATERIALIZED (
          SELECT event.event_id
            FROM conversation.realtime_event AS event
            CROSS JOIN cursor_state
          WHERE cursor_state.effective_cursor >= cursor_state.retention_floor_event_id
            AND cursor_state.effective_cursor <= cursor_state.high_watermark_event_id
             AND event.stream_name = cursor_state.stream_name
             AND event.event_id > cursor_state.effective_cursor
             AND event.event_id <= cursor_state.high_watermark_event_id
             AND (
               (event.authorization_scope_type = 'SESSION'
                 AND event.authorization_scope_id = ANY($3::uuid[]))
               OR (event.authorization_scope_type = 'THREAD'
                 AND event.authorization_scope_id = ANY($4::uuid[]))
               OR (event.authorization_scope_type = 'SYSTEM'
                 AND event.authorization_scope_id IS NULL
                 AND $5::boolean)
             )
             AND (
               event.visibility_scope = 'WORKBENCH'
               OR (event.visibility_scope = 'RESTRICTED_ADMIN' AND $6::boolean)
             )
           ORDER BY event.event_id
           LIMIT $7
       ), scan_state AS MATERIALIZED (
          SELECT CASE
                   WHEN COUNT(*) < $7::integer
                     THEN (SELECT high_watermark_event_id FROM cursor_state)
                   ELSE COALESCE(
                     MAX(authorized_ids.event_id),
                     (SELECT effective_cursor FROM cursor_state)
                   )
                 END AS next_after_event_id
            FROM authorized_ids
       ), authorized AS MATERIALIZED (
          SELECT event.event_id, event.event_key, event.stream_name,
                 event.publisher_name, event.publisher_version,
                 event.source_type, event.source_id, event.event_variant,
                 event.event_type, event.aggregate_type, event.aggregate_id,
                 event.aggregate_version, event.authorization_scope_type,
                 event.authorization_scope_id, event.visibility_scope,
                 event.payload, event.payload_hash, event.event_hash,
                 event.occurred_at, event.expires_at, event.created_at
            FROM authorized_ids
            JOIN conversation.realtime_event AS event
              ON event.event_id = authorized_ids.event_id
             AND event.stream_name = $1::text
       )
       SELECT cursor_state.stream_name,
              cursor_state.retention_floor_event_id::text AS retention_floor_event_id,
              cursor_state.high_watermark_event_id::text AS high_watermark_event_id,
              cursor_state.effective_cursor::text AS effective_cursor,
              scan_state.next_after_event_id::text AS next_after_event_id,
              authorized.event_id::text AS event_id,
              authorized.event_key, authorized.publisher_name,
              authorized.publisher_version, authorized.source_type,
              authorized.source_id, authorized.event_variant,
              authorized.event_type, authorized.aggregate_type,
              authorized.aggregate_id,
              authorized.aggregate_version::text AS aggregate_version,
              authorized.authorization_scope_type,
              authorized.authorization_scope_id::text AS authorization_scope_id,
              authorized.visibility_scope, authorized.payload,
              authorized.payload_hash, authorized.event_hash,
              authorized.occurred_at, authorized.expires_at,
              authorized.created_at
         FROM cursor_state
         CROSS JOIN scan_state
         LEFT JOIN authorized ON TRUE
        ORDER BY authorized.event_id NULLS LAST`,
      [
        streamName,
        afterEventId,
        authorization.allowed_session_ids,
        authorization.allowed_thread_ids,
        authorization.allow_system_events,
        authorization.allow_restricted_admin,
        limit,
      ],
    ));
    if (rows.length === 0) {
      fail(REALTIME_ERROR_CODES.storageFailed);
    }

    const metadata = rows[0];
    const floor = canonicalBigint(metadata.retention_floor_event_id, {
      code: REALTIME_ERROR_CODES.storageFailed,
    });
    const high = canonicalBigint(metadata.high_watermark_event_id, {
      code: REALTIME_ERROR_CODES.storageFailed,
    });
    const effective = canonicalBigint(metadata.effective_cursor, {
      code: REALTIME_ERROR_CODES.storageFailed,
    });
    const nextAfter = canonicalBigint(metadata.next_after_event_id, {
      code: REALTIME_ERROR_CODES.storageFailed,
    });
    if (BigInt(effective) < BigInt(floor)) {
      fail(REALTIME_ERROR_CODES.replayGap);
    }
    if (BigInt(effective) > BigInt(high)) {
      fail(REALTIME_ERROR_CODES.cursorAhead);
    }
    if (BigInt(nextAfter) < BigInt(effective) || BigInt(nextAfter) > BigInt(high)) {
      fail(REALTIME_ERROR_CODES.storageFailed);
    }

    const events = [];
    for (const row of rows) {
      if (
        row.stream_name !== metadata.stream_name
        || row.retention_floor_event_id !== metadata.retention_floor_event_id
        || row.high_watermark_event_id !== metadata.high_watermark_event_id
        || row.effective_cursor !== metadata.effective_cursor
        || row.next_after_event_id !== metadata.next_after_event_id
      ) {
        fail(REALTIME_ERROR_CODES.storageFailed);
      }
      if (row.event_id === null) {
        continue;
      }
      events.push(validatePersistedEventRow(row, authorization));
    }
    return Object.freeze({
      stream_name: normalizeStreamName(
        metadata.stream_name,
        REALTIME_ERROR_CODES.storageFailed,
      ),
      after_event_id: effective,
      retention_floor_event_id: floor,
      high_watermark_event_id: high,
      next_after_event_id: nextAfter,
      events: Object.freeze(events),
    });
  } catch (error) {
    throw mapStorageError(error);
  }
}

function retentionExpiry(value) {
  return isoDateTime(value, REALTIME_ERROR_CODES.retentionFailed);
}

function retentionResult({
  mode,
  checkedCount,
  expiredPrefixCount,
  deletedCount,
  previousFloor,
  newFloor,
  candidateFloor,
  limit,
}) {
  return Object.freeze({
    mode,
    checked_count: checkedCount,
    expired_prefix_count: expiredPrefixCount,
    deleted_count: deletedCount,
    previous_floor_event_id: previousFloor,
    new_floor_event_id: newFloor,
    candidate_floor_event_id: candidateFloor,
    batch_limit: limit,
    write_performed: deletedCount > 0,
  });
}

function expiredPrefix(rows, nowEpochMs) {
  const cutoff = BigInt(assertEpochMsString(nowEpochMs));
  const prefix = [];
  for (const row of rows) {
    const eventId = canonicalBigint(row.event_id, {
      minimum: 1n,
      code: REALTIME_ERROR_CODES.retentionFailed,
    });
    const expiresAt = BigInt(assertEpochMsString(row.expires_epoch_ms));
    if (expiresAt > cutoff) {
      break;
    }
    prefix.push(eventId);
  }
  return Object.freeze(prefix);
}

function normalizeRetentionInput(input, { apply }) {
  const snapshot = plainRecordSnapshot(input, REALTIME_ERROR_CODES.retentionFailed);
  if (apply && snapshot.authorized !== true) {
    fail(REALTIME_ERROR_CODES.retentionNotAuthorized);
  }
  const streamName = normalizeStreamName(
    snapshot.streamName ?? snapshot.stream_name,
    REALTIME_ERROR_CODES.retentionFailed,
  );
  const limit = boundedInteger(
    snapshot.limit,
    REALTIME_DEFAULT_CLEANUP_LIMIT,
    REALTIME_MAX_CLEANUP_LIMIT,
    REALTIME_ERROR_CODES.retentionFailed,
  );
  let nowEpochMs;
  try {
    nowEpochMs = snapshot.now_epoch_ms === undefined
      ? String(Date.now())
      : assertEpochMsString(snapshot.now_epoch_ms);
  } catch {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  let afterDeleteBeforeFloor = null;
  if (snapshot.faultInjection !== undefined && snapshot.faultInjection !== null) {
    const fault = plainRecordSnapshot(
      snapshot.faultInjection,
      REALTIME_ERROR_CODES.retentionFailed,
    );
    if (
      Object.keys(fault).some((key) => key !== 'afterDeleteBeforeFloor')
      || (fault.afterDeleteBeforeFloor !== undefined
        && typeof fault.afterDeleteBeforeFloor !== 'function')
    ) {
      fail(REALTIME_ERROR_CODES.retentionFailed);
    }
    afterDeleteBeforeFloor = fault.afterDeleteBeforeFloor ?? null;
  }
  return Object.freeze({
    pool: snapshot.pool,
    streamName,
    limit,
    now_epoch_ms: nowEpochMs,
    afterDeleteBeforeFloor,
  });
}

async function readRetentionCandidates(queryable, streamName, floor, limit, { lock }) {
  const rows = resultRows(await query(
    queryable,
    `SELECT event.event_id::text, event.expires_at, event.expires_epoch_ms::text
       FROM conversation.realtime_event AS event
      WHERE event.stream_name = $1
        AND event.event_id > $2::bigint
      ORDER BY event.event_id
      LIMIT $3${lock ? ' FOR UPDATE' : ''}`,
    [streamName, floor, limit],
    REALTIME_ERROR_CODES.retentionFailed,
  ), REALTIME_ERROR_CODES.retentionFailed);
  return rows;
}

export async function checkRealtimeRetention(input) {
  const normalized = normalizeRetentionInput(input, { apply: false });
  try {
    const window = await readReplayWindow(normalized.pool, normalized.streamName);
    const rows = await readRetentionCandidates(
      normalized.pool,
      normalized.streamName,
      window.retention_floor_event_id,
      normalized.limit,
      { lock: false },
    );
    const prefix = expiredPrefix(rows, normalized.now_epoch_ms);
    const candidateFloor = prefix.at(-1) ?? window.retention_floor_event_id;
    return retentionResult({
      mode: 'CHECK',
      checkedCount: rows.length,
      expiredPrefixCount: prefix.length,
      deletedCount: 0,
      previousFloor: window.retention_floor_event_id,
      newFloor: window.retention_floor_event_id,
      candidateFloor,
      limit: normalized.limit,
    });
  } catch (error) {
    throw mapStorageError(error, REALTIME_ERROR_CODES.retentionFailed);
  }
}

export async function cleanupRealtimeRetention(input) {
  const normalized = normalizeRetentionInput(input, { apply: true });
  let client;
  let transactionOpen = false;
  let destroyClient = false;
  try {
    client = await connectPool(normalized.pool, REALTIME_ERROR_CODES.retentionFailed);
    await query(client, 'BEGIN', undefined, REALTIME_ERROR_CODES.retentionFailed);
    transactionOpen = true;
    await query(
      client,
      "SET LOCAL lock_timeout = '5s'",
      undefined,
      REALTIME_ERROR_CODES.retentionFailed,
    );
    await query(
      client,
      "SET LOCAL statement_timeout = '60s'",
      undefined,
      REALTIME_ERROR_CODES.retentionFailed,
    );
    await acquireStreamLock(client, REALTIME_ERROR_CODES.retentionFailed);
    await query(
      client,
      `INSERT INTO conversation.realtime_stream_state (stream_name)
       VALUES ($1)
       ON CONFLICT (stream_name) DO NOTHING`,
      [normalized.streamName],
      REALTIME_ERROR_CODES.retentionFailed,
    );
    const stateRows = resultRows(await query(
      client,
      `SELECT retention_floor_event_id::text
         FROM conversation.realtime_stream_state
        WHERE stream_name = $1
        FOR UPDATE`,
      [normalized.streamName],
      REALTIME_ERROR_CODES.retentionFailed,
    ), REALTIME_ERROR_CODES.retentionFailed);
    if (stateRows.length !== 1) {
      fail(REALTIME_ERROR_CODES.retentionFailed);
    }
    const previousFloor = canonicalBigint(stateRows[0].retention_floor_event_id, {
      code: REALTIME_ERROR_CODES.retentionFailed,
    });
    const rows = await readRetentionCandidates(
      client,
      normalized.streamName,
      previousFloor,
      normalized.limit,
      { lock: true },
    );
    const prefix = expiredPrefix(rows, normalized.now_epoch_ms);
    const candidateFloor = prefix.at(-1) ?? previousFloor;
    let deletedCount = 0;
    let newFloor = previousFloor;

    if (prefix.length > 0) {
      const deletedRows = resultRows(await query(
        client,
        `DELETE FROM conversation.realtime_event
          WHERE stream_name = $1
            AND event_id = ANY($2::bigint[])
          RETURNING event_id::text`,
        [normalized.streamName, prefix],
        REALTIME_ERROR_CODES.retentionFailed,
      ), REALTIME_ERROR_CODES.retentionFailed);
      const deletedIds = deletedRows.map((row) => canonicalBigint(row.event_id, {
        minimum: 1n,
        code: REALTIME_ERROR_CODES.retentionFailed,
      })).sort((left, right) => (
        BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0
      ));
      if (
        deletedIds.length !== prefix.length
        || deletedIds.some((eventId, index) => eventId !== prefix[index])
      ) {
        fail(REALTIME_ERROR_CODES.retentionFailed);
      }
      deletedCount = deletedIds.length;
      if (normalized.afterDeleteBeforeFloor !== null) {
        await normalized.afterDeleteBeforeFloor();
      }
      const advanced = resultRows(await query(
        client,
        `UPDATE conversation.realtime_stream_state
            SET retention_floor_event_id = $2::bigint,
                row_version = row_version + 1,
                updated_at = date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
          WHERE stream_name = $1
            AND retention_floor_event_id = $3::bigint
            AND retention_floor_event_id < $2::bigint
          RETURNING retention_floor_event_id::text`,
        [normalized.streamName, candidateFloor, previousFloor],
        REALTIME_ERROR_CODES.retentionFailed,
      ), REALTIME_ERROR_CODES.retentionFailed);
      if (advanced.length !== 1) {
        fail(REALTIME_ERROR_CODES.retentionFailed);
      }
      newFloor = canonicalBigint(advanced[0].retention_floor_event_id, {
        code: REALTIME_ERROR_CODES.retentionFailed,
      });
      if (newFloor !== candidateFloor) {
        fail(REALTIME_ERROR_CODES.retentionFailed);
      }
    }

    await query(client, 'COMMIT', undefined, REALTIME_ERROR_CODES.retentionFailed);
    transactionOpen = false;
    return retentionResult({
      mode: 'APPLY',
      checkedCount: rows.length,
      expiredPrefixCount: prefix.length,
      deletedCount,
      previousFloor,
      newFloor,
      candidateFloor,
      limit: normalized.limit,
    });
  } catch (error) {
    if (client !== undefined && transactionOpen) {
      destroyClient = await rollbackQuietly(client);
      transactionOpen = false;
    }
    throw mapStorageError(error, REALTIME_ERROR_CODES.retentionFailed);
  } finally {
    if (client !== undefined) {
      releaseQuietly(client, destroyClient);
    }
  }
}

function defaultExpiry(occurredAt, defaultRetentionMs) {
  const occurred = isoDateTime(occurredAt);
  try {
    return formatEpochMsToShanghaiLocal(addEpochMilliseconds(
      shanghaiLocalToEpochMs(occurred),
      defaultRetentionMs,
    ));
  } catch { fail(REALTIME_ERROR_CODES.eventInvalid); }
}

function earlierExpiry(first, second) {
  if (first === undefined || first === null) {
    return second;
  }
  const normalized = isoDateTime(first);
  return normalized < second ? normalized : second;
}

function withDefaultRetention(command, defaultRetentionMs) {
  const snapshot = plainRecordSnapshot(command);
  if (Object.hasOwn(snapshot, 'expires_at')) {
    return snapshot;
  }
  return Object.freeze({
    ...snapshot,
    expires_at: defaultExpiry(snapshot.occurred_at, defaultRetentionMs),
  });
}

function assertEnabled(enabled) {
  if (enabled !== true) {
    fail(REALTIME_ERROR_CODES.disabled);
  }
}

async function appendStandalone(pool, command) {
  let client;
  let transactionOpen = false;
  let destroyClient = false;
  try {
    client = await connectPool(pool);
    await query(client, 'BEGIN');
    transactionOpen = true;
    const result = await appendRealtimeEvent({ transaction: client, command });
    await query(client, 'COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (client !== undefined && transactionOpen) {
      destroyClient = await rollbackQuietly(client);
      transactionOpen = false;
    }
    throw mapStorageError(error);
  } finally {
    if (client !== undefined) {
      releaseQuietly(client, destroyClient);
    }
  }
}

export function createRealtimeEventStore(input = {}) {
  input = plainRecordSnapshot(input);
  const pool = input.pool;
  const enabled = input.enabled ?? false;
  if (enabled !== true && enabled !== false) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  const defaultRetentionMs = input.defaultRetentionMs
    ?? input.default_retention_ms
    ?? REALTIME_DEFAULT_RETENTION_MS;
  if (
    !Number.isSafeInteger(defaultRetentionMs)
    || defaultRetentionMs < 1
    || defaultRetentionMs > 365 * 24 * 60 * 60 * 1_000
  ) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }

  async function appendInTransaction(options) {
    assertEnabled(enabled);
    options = plainRecordSnapshot(options);
    return appendRealtimeEvent({
      transaction: options.transaction,
      command: withDefaultRetention(options.command, defaultRetentionMs),
    });
  }

  async function append(commandOrOptions) {
    assertEnabled(enabled);
    const possibleOptions = plainRecordSnapshot(commandOrOptions);
    const command = Object.hasOwn(possibleOptions, 'command')
      ? possibleOptions.command
      : commandOrOptions;
    return appendStandalone(pool, withDefaultRetention(command, defaultRetentionMs));
  }

  async function getHighWatermark(options = {}) {
    assertEnabled(enabled);
    options = plainRecordSnapshot(options);
    return getRealtimeHighWatermark({ ...options, pool });
  }

  async function getReplayWindow(options = {}) {
    assertEnabled(enabled);
    options = plainRecordSnapshot(options);
    return getRealtimeReplayWindow({ ...options, pool });
  }

  async function listAuthorizedEvents(options) {
    assertEnabled(enabled);
    options = plainRecordSnapshot(options);
    return listAuthorizedRealtimeEvents({ ...options, pool });
  }

  async function checkRetention(options = {}) {
    assertEnabled(enabled);
    options = plainRecordSnapshot(options);
    return checkRealtimeRetention({ ...options, pool });
  }

  async function cleanupRetention(options) {
    assertEnabled(enabled);
    options = plainRecordSnapshot(options);
    return cleanupRealtimeRetention({ ...options, pool });
  }

  return Object.freeze({
    enabled,
    defaultRetentionMs,
    append,
    appendStandalone: append,
    appendInTransaction,
    appendRealtimeEvent: appendInTransaction,
    getHighWatermark,
    getRealtimeHighWatermark: getHighWatermark,
    getReplayWindow,
    getRealtimeReplayWindow: getReplayWindow,
    listAuthorizedEvents,
    listAuthorizedRealtimeEvents: listAuthorizedEvents,
    checkRetention,
    cleanupRetention,
  });
}

function mapperExpiry(snapshot, occurredAt) {
  const defaultExpires = defaultExpiry(occurredAt, REALTIME_DEFAULT_RETENTION_MS);
  if (snapshot.expires_at !== undefined && snapshot.expires_at !== null) {
    return isoDateTime(snapshot.expires_at);
  }
  return earlierExpiry(snapshot.retention_until, defaultExpires);
}

function mapperVisibility(value) {
  if (!['EXTERNAL', 'INTERNAL', 'RESTRICTED'].includes(value)) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  return value === 'RESTRICTED' ? 'RESTRICTED_ADMIN' : 'WORKBENCH';
}

export function mapConversationItemCreatedEvent(input) {
  const item = plainRecordSnapshot(input);
  const itemId = requiredUuid(item.id ?? item.item_id);
  const sessionId = requiredUuid(item.session_id);
  const sequenceNo = canonicalBigint(item.sequence_no, {
    minimum: 1n,
    allowNumeric: true,
  });
  const itemType = boundedString(item.item_type, 64, {
    pattern: /^[A-Z][A-Z0-9_]*$/u,
  });
  const senderKind = boundedString(item.sender_kind, 32, {
    pattern: /^[A-Z][A-Z0-9_]*$/u,
  });
  const visibility = boundedString(item.visibility, 32, {
    pattern: /^[A-Z][A-Z0-9_]*$/u,
  });
  const occurredAt = isoDateTime(item.occurred_at);
  return normalizeRealtimeEventCommand({
    schema_version: 1,
    publisher_name: 'CONVERSATION_TIMELINE_PROJECTOR',
    publisher_version: '1',
    source_type: 'CONVERSATION_ITEM',
    source_id: itemId,
    event_variant: 'CONVERSATION_ITEM_CREATED_V1',
    event_type: 'conversation.item.created',
    aggregate_type: 'CONVERSATION_ITEM',
    aggregate_id: itemId,
    aggregate_version: null,
    authorization_scope_type: 'SESSION',
    authorization_scope_id: sessionId,
    visibility_scope: mapperVisibility(visibility),
    payload: {
      item_id: itemId,
      session_id: sessionId,
      sequence_no: sequenceNo,
      item_type: itemType,
      sender_kind: senderKind,
      visibility,
      occurred_at: occurredAt,
    },
    occurred_at: occurredAt,
    expires_at: mapperExpiry(item, occurredAt),
  });
}

export function mapConversationSessionEvent(input) {
  const fixture = plainRecordSnapshot(input);
  const sessionId = requiredUuid(fixture.session_id ?? fixture.id);
  const threadId = requiredUuid(fixture.thread_id);
  const rowVersion = canonicalBigint(fixture.row_version, {
    minimum: 1n,
    allowNumeric: true,
  });
  const generationVersion = canonicalBigint(fixture.generation_version, {
    minimum: 1n,
    allowNumeric: true,
  });
  const eventType = fixture.event_type ?? fixture.eventType;
  if (!['conversation.session.created', 'conversation.session.updated'].includes(eventType)) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  const occurredAt = isoDateTime(
    fixture.occurred_at ?? fixture.updated_at ?? fixture.created_at,
  );
  const status = boundedString(fixture.status, 32, {
    pattern: /^[A-Z][A-Z0-9_]*$/u,
  });
  const controlMode = boundedString(fixture.control_mode, 32, {
    pattern: /^[A-Z][A-Z0-9_]*$/u,
  });
  return normalizeRealtimeEventCommand({
    schema_version: 1,
    publisher_name: 'CONVERSATION_SESSION_STORE',
    publisher_version: '1',
    source_type: 'CONVERSATION_SESSION',
    source_id: fixture.source_id ?? `${sessionId}:${rowVersion}`,
    event_variant: eventType === 'conversation.session.created'
      ? 'CONVERSATION_SESSION_CREATED_V1'
      : 'CONVERSATION_SESSION_UPDATED_V1',
    event_type: eventType,
    aggregate_type: 'CONVERSATION_SESSION',
    aggregate_id: sessionId,
    aggregate_version: rowVersion,
    authorization_scope_type: 'SESSION',
    authorization_scope_id: sessionId,
    visibility_scope: fixture.visibility_scope ?? 'WORKBENCH',
    payload: {
      session_id: sessionId,
      thread_id: threadId,
      status,
      control_mode: controlMode,
      generation_version: generationVersion,
      row_version: rowVersion,
      occurred_at: occurredAt,
    },
    occurred_at: occurredAt,
    expires_at: mapperExpiry(fixture, occurredAt),
  });
}

export function mapTimelineRebuiltEvent(input) {
  const fixture = plainRecordSnapshot(input);
  const sessionId = requiredUuid(fixture.session_id);
  const itemCount = fixture.item_count ?? fixture.itemCount;
  if (!Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > 1_000_000) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  const canonicalTimelineHash = fixture.canonical_timeline_hash ?? fixture.canonical_hash;
  if (typeof canonicalTimelineHash !== 'string' || !SHA256_PATTERN.test(canonicalTimelineHash)) {
    fail(REALTIME_ERROR_CODES.eventInvalid);
  }
  const occurredAt = isoDateTime(fixture.occurred_at);
  const aggregateVersion = fixture.aggregate_version === undefined
    ? null
    : canonicalBigint(fixture.aggregate_version, { nullable: true, allowNumeric: true });
  return normalizeRealtimeEventCommand({
    schema_version: 1,
    publisher_name: 'CONVERSATION_TIMELINE_PROJECTOR',
    publisher_version: '1',
    source_type: 'TIMELINE_REBUILD',
    source_id: fixture.source_id ?? `${sessionId}:${canonicalTimelineHash}`,
    event_variant: 'CONVERSATION_TIMELINE_REBUILT_V1',
    event_type: 'conversation.timeline.rebuilt',
    aggregate_type: 'CONVERSATION_TIMELINE',
    aggregate_id: sessionId,
    aggregate_version: aggregateVersion,
    authorization_scope_type: 'SESSION',
    authorization_scope_id: sessionId,
    visibility_scope: fixture.visibility_scope ?? 'WORKBENCH',
    payload: {
      session_id: sessionId,
      item_count: itemCount,
      canonical_timeline_hash: canonicalTimelineHash,
      occurred_at: occurredAt,
    },
    occurred_at: occurredAt,
    expires_at: mapperExpiry(fixture, occurredAt),
  });
}
