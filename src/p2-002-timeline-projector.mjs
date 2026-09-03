import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { types as utilTypes } from 'node:util';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import { assertLocalDateTime, shanghaiLocalToEpochMs } from './platform/time-contract.mjs';
import { postgresTimestampToLocalDateTime } from './platform/postgres-types.mjs';

const MIGRATION_URL = new URL(
  '../database/migrations/011_p2_002_timeline_projector.sql',
  import.meta.url,
);

const MAX_BIGINT_TEXT = '9223372036854775807';
const MAX_BATCH_SIZE = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 200;
const DEFAULT_PROJECTOR_NAME = 'CONVERSATION_TIMELINE';
const DEFAULT_PROJECTOR_VERSION = '1';
const SAFE_JSON_MAX_DEPTH = 16;
const SAFE_JSON_MAX_NODES = 4_096;
const SAFE_JSON_MAX_KEYS = 64;
const SAFE_JSON_MAX_ARRAY = 100;
const SAFE_JSON_MAX_STRING = 20_000;

export const TIMELINE_SOURCE_TYPES = Object.freeze([
  'CHANNEL_MESSAGE',
  'COMMUNICATION_MESSAGE',
  'TICKET_EVENT',
  'DELIVERY',
  'HANDOFF_EVENT',
]);

export const TIMELINE_PROJECTOR_NAME = DEFAULT_PROJECTOR_NAME;
export const TIMELINE_PROJECTOR_VERSION = DEFAULT_PROJECTOR_VERSION;
export const TIMELINE_DEFAULT_BATCH_SIZE = DEFAULT_BATCH_SIZE;
export const TIMELINE_MAX_BATCH_SIZE = MAX_BATCH_SIZE;

export const TIMELINE_SOURCE_RANKS = Object.freeze({
  CHANNEL_MESSAGE: 10,
  COMMUNICATION_MESSAGE: 20,
  TICKET_EVENT: 30,
  DELIVERY: 40,
  HANDOFF_EVENT: 50,
});

export const TIMELINE_ITEM_TYPES = Object.freeze([
  'USER_MESSAGE',
  'AI_MESSAGE',
  'AGENT_MESSAGE',
  'INTERNAL_NOTE',
  'SYSTEM_EVENT',
  'TICKET_EVENT',
  'DELIVERY_STATUS',
  'HANDOFF_EVENT',
]);

export const TIMELINE_SENDER_KINDS = Object.freeze([
  'USER',
  'AI',
  'AGENT',
  'SYSTEM',
  'TOOL',
]);

export const TIMELINE_VISIBILITIES = Object.freeze([
  'EXTERNAL',
  'INTERNAL',
  'RESTRICTED',
]);

export const TIMELINE_PRIVACY_CLASSES = Object.freeze([
  'PUBLIC',
  'INTERNAL',
  'SENSITIVE_INTERNAL',
  'PERSONAL',
  'PATIENT_SENSITIVE',
  'SECRET',
]);

export const TIMELINE_AUDIENCES = Object.freeze([
  'EXTERNAL',
  'WORKBENCH',
  'RESTRICTED_ADMIN',
]);

export const TIMELINE_ERROR_CODES = Object.freeze({
  disabled: 'CONVERSATION_TIMELINE_DISABLED',
  sourceInvalid: 'CONVERSATION_TIMELINE_SOURCE_INVALID',
  sessionNotFound: 'CONVERSATION_TIMELINE_SESSION_NOT_FOUND',
  sourceConflict: 'CONVERSATION_TIMELINE_SOURCE_CONFLICT',
  sequenceConflict: 'CONVERSATION_TIMELINE_SEQUENCE_CONFLICT',
  rebuildRequired: 'CONVERSATION_TIMELINE_REBUILD_REQUIRED',
  rebuildNotAuthorized: 'CONVERSATION_TIMELINE_REBUILD_NOT_AUTHORIZED',
  rebuildFailed: 'CONVERSATION_TIMELINE_REBUILD_FAILED',
  checkpointConflict: 'CONVERSATION_TIMELINE_CHECKPOINT_CONFLICT',
  storageFailed: 'CONVERSATION_TIMELINE_STORAGE_FAILED',
  schemaDrift: 'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
});

const TIMELINE_ERROR_CODE_SET = new Set(Object.values(TIMELINE_ERROR_CODES));

const SOURCE_RECORD_KEYS = Object.freeze([
  'schema_version',
  'projector_name',
  'projector_version',
  'source_stream',
  'source_type',
  'source_id',
  'projection_variant',
  'session_id',
  'item_type',
  'sender_kind',
  'visibility',
  'text',
  'safe_content',
  'occurred_at',
  'source_ordinal',
  'source_hash',
  'privacy_class',
  'retention_until',
]);

const SOURCE_RECORD_KEY_SET = new Set(SOURCE_RECORD_KEYS);
const SOURCE_TYPES = new Set(TIMELINE_SOURCE_TYPES);
const ITEM_TYPES = new Set(TIMELINE_ITEM_TYPES);
const SENDER_KINDS = new Set(TIMELINE_SENDER_KINDS);
const VISIBILITIES = new Set(TIMELINE_VISIBILITIES);
const PRIVACY_CLASSES = new Set(TIMELINE_PRIVACY_CLASSES);
const PRIVACY_RANK = Object.freeze(Object.fromEntries(
  TIMELINE_PRIVACY_CLASSES.map((value, index) => [value, index]),
));
const FORBIDDEN_JSON_KEYS = new Set([
  '__proto__',
  'proto',
  'prototype',
  'constructor',
  'tojson',
  'rawpayload',
  'rawpayloadencrypted',
  'rawtext',
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
  'targetkey',
  'userid',
  'chatid',
  'operatorid',
  'patientid',
  'secret',
]);

export class TimelineProjectionError extends Error {
  constructor(code) {
    const stableCode = typeof code === 'string' && TIMELINE_ERROR_CODE_SET.has(code)
      ? code
      : TIMELINE_ERROR_CODES.sourceInvalid;
    super(stableCode);
    this.name = 'TimelineProjectionError';
    this.code = stableCode;
  }
}

function fail(code) {
  throw new TimelineProjectionError(code);
}

function isStableTimelineProjectionError(error) {
  try {
    if (
      error === null
      || typeof error !== 'object'
      || utilTypes.isProxy(error)
      || Object.getPrototypeOf(error) !== TimelineProjectionError.prototype
    ) {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor !== undefined
      && Object.hasOwn(descriptor, 'value')
      && typeof descriptor.value === 'string'
      && TIMELINE_ERROR_CODE_SET.has(descriptor.value);
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

function throwIfAborted(signal, fallbackCode = TIMELINE_ERROR_CODES.storageFailed) {
  if (signal !== undefined && signal !== null) {
    if (
      (typeof signal !== 'object' && typeof signal !== 'function')
      || utilTypes.isProxy(signal)
    ) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    let aborted;
    try {
      aborted = signal.aborted;
    } catch {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    if (typeof aborted !== 'boolean') {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    if (aborted) {
      fail(fallbackCode);
    }
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (utilTypes.isProxy(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(value) {
  try {
    if (!isPlainRecord(value)) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
        fail(TIMELINE_ERROR_CODES.sourceInvalid);
      }
    }
  } catch (error) {
    if (isStableTimelineProjectionError(error)) {
      throw error;
    }
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
}

function plainRecordSnapshot(value) {
  assertPlainRecord(value);
  const snapshot = Object.create(null);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function dataPropertyFromPrototypeChain(target, key, errorCode) {
  try {
    if (
      target === null
      || (typeof target !== 'object' && typeof target !== 'function')
      || utilTypes.isProxy(target)
    ) {
      fail(errorCode);
    }
    let current = target;
    for (let depth = 0; current !== null && depth < 16; depth += 1) {
      if (utilTypes.isProxy(current)) {
        fail(errorCode);
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!Object.hasOwn(descriptor, 'value')) {
          fail(errorCode);
        }
        return descriptor.value;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch (error) {
    if (isStableTimelineProjectionError(error)) {
      throw error;
    }
    fail(errorCode);
  }
  fail(errorCode);
}

function normalizeKeyForDenyList(key) {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
}

function clonePlainJson(value, state = { seen: new Set(), nodes: 0 }, depth = 0) {
  if (depth > SAFE_JSON_MAX_DEPTH || state.nodes >= SAFE_JSON_MAX_NODES) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  state.nodes += 1;

  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (!value.isWellFormed() || value.length > SAFE_JSON_MAX_STRING || value.includes('\u0000')) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  if (state.seen.has(value)) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  state.seen.add(value);

  try {
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length !== 0) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > SAFE_JSON_MAX_ARRAY) {
        fail(TIMELINE_ERROR_CODES.sourceInvalid);
      }
      const descriptorKeys = Object.keys(descriptors).filter((key) => key !== 'length');
      if (descriptorKeys.length !== value.length) {
        fail(TIMELINE_ERROR_CODES.sourceInvalid);
      }
      const copy = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined
          || !Object.hasOwn(descriptor, 'value')
          || descriptor.enumerable !== true
        ) {
          fail(TIMELINE_ERROR_CODES.sourceInvalid);
        }
        copy.push(clonePlainJson(descriptor.value, state, depth + 1));
      }
      return Object.freeze(copy);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    const keys = Object.keys(descriptors);
    if (keys.length > SAFE_JSON_MAX_KEYS) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    const copy = Object.create(null);
    for (const key of keys.sort()) {
      const descriptor = descriptors[key];
      if (
        !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true
        || !key.isWellFormed()
        || key.length < 1
        || key.length > 128
        || FORBIDDEN_JSON_KEYS.has(normalizeKeyForDenyList(key))
      ) {
        fail(TIMELINE_ERROR_CODES.sourceInvalid);
      }
      copy[key] = clonePlainJson(descriptor.value, state, depth + 1);
    }
    return Object.freeze(copy);
  } catch (error) {
    if (isStableTimelineProjectionError(error)) {
      throw error;
    }
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  } finally {
    state.seen.delete(value);
  }
}

function canonicalJson(value) {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
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

function boundedString(value, maximum, { minimum = 1, token = false } = {}) {
  if (
    typeof value !== 'string'
    || !value.isWellFormed()
    || value.length < minimum
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
    || (token && !/^[A-Z][A-Z0-9_]*$/u.test(value))
  ) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return value;
}

function contractIdentifier(value, maximum, pattern) {
  const normalized = boundedString(value, maximum);
  if (!pattern.test(normalized)) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return normalized;
}

function timelineProjectorName(value) {
  const normalized = contractIdentifier(
    value,
    128,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
  );
  if (normalized !== DEFAULT_PROJECTOR_NAME) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return normalized;
}

function nullableText(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== 'string'
    || !value.isWellFormed()
    || value.length > 20_000
    || value.includes('\u0000')
  ) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return value;
}

function requiredUuid(value) {
  if (
    typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return value.toLowerCase();
}

function isoDateTime(value) {
  try { return assertLocalDateTime(value); }
  catch { fail(TIMELINE_ERROR_CODES.sourceInvalid); }
}

function canonicalBigint(value, { minimum = 0n } = {}) {
  let text;
  if (typeof value === 'bigint') {
    text = value.toString();
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    text = String(value);
  } else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value)) {
    text = value;
  } else {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  if (
    text.length > MAX_BIGINT_TEXT.length
    || (text.length === MAX_BIGINT_TEXT.length && text > MAX_BIGINT_TEXT)
    || BigInt(text) < minimum
  ) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return text;
}

function boundedInteger(value, fallback, maximum) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return candidate;
}

function semanticSourceShape(record) {
  const semantic = Object.create(null);
  for (const key of SOURCE_RECORD_KEYS) {
    if (key !== 'source_hash' && key !== 'privacy_class' && key !== 'retention_until') {
      semantic[key] = record[key];
    }
  }
  return semantic;
}

function computeSourceHash(record) {
  return sha256Canonical(semanticSourceShape(record));
}

export function normalizeTimelineSourceRecord(input) {
  assertPlainRecord(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !SOURCE_RECORD_KEY_SET.has(key)) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
  }
  for (const key of SOURCE_RECORD_KEYS) {
    if (key !== 'source_hash' && !Object.hasOwn(descriptors, key)) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
  }

  if (descriptors.schema_version.value !== 1) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  const sourceType = descriptors.source_type.value;
  const itemType = descriptors.item_type.value;
  const senderKind = descriptors.sender_kind.value;
  const visibility = descriptors.visibility.value;
  const privacyClass = descriptors.privacy_class.value;
  if (
    !SOURCE_TYPES.has(sourceType)
    || !ITEM_TYPES.has(itemType)
    || !SENDER_KINDS.has(senderKind)
    || !VISIBILITIES.has(visibility)
    || !PRIVACY_CLASSES.has(privacyClass)
  ) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }

  const projectorName = timelineProjectorName(descriptors.projector_name.value);

  const safeContent = clonePlainJson(descriptors.safe_content.value);
  if (Array.isArray(safeContent) || safeContent === null) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  const normalized = Object.freeze({
    schema_version: 1,
    projector_name: projectorName,
    projector_version: contractIdentifier(
      descriptors.projector_version.value,
      64,
      /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u,
    ),
    source_stream: contractIdentifier(
      descriptors.source_stream.value,
      128,
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
    ),
    source_type: sourceType,
    source_id: boundedString(descriptors.source_id.value, 256),
    projection_variant: boundedString(
      descriptors.projection_variant.value,
      64,
      { token: true },
    ),
    session_id: requiredUuid(descriptors.session_id.value),
    item_type: itemType,
    sender_kind: senderKind,
    visibility,
    text: nullableText(descriptors.text.value),
    safe_content: safeContent,
    occurred_at: isoDateTime(descriptors.occurred_at.value),
    source_ordinal: canonicalBigint(descriptors.source_ordinal.value),
    source_hash: '',
    privacy_class: privacyClass,
    retention_until: isoDateTime(descriptors.retention_until.value),
  });
  const sourceHash = computeSourceHash(normalized);
  if (Object.hasOwn(descriptors, 'source_hash')) {
    const supplied = descriptors.source_hash.value;
    if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/u.test(supplied) || supplied !== sourceHash) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
  }
  return Object.freeze({ ...normalized, source_hash: sourceHash });
}

export const normalizeConversationTimelineSourceRecord = normalizeTimelineSourceRecord;

function utf8Hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

export function computeTimelineCanonicalOrderKey(input) {
  const record = normalizeTimelineSourceRecord(input);
  const rank = TIMELINE_SOURCE_RANKS[record.source_type];
  return [
    record.occurred_at,
    String(rank).padStart(2, '0'),
    record.source_ordinal.padStart(MAX_BIGINT_TEXT.length, '0'),
    utf8Hex(record.source_type),
    utf8Hex(record.source_id),
    utf8Hex(record.projection_variant),
  ].join('|');
}

export function compareTimelineSourceRecords(leftInput, rightInput) {
  const left = computeTimelineCanonicalOrderKey(leftInput);
  const right = computeTimelineCanonicalOrderKey(rightInput);
  return left < right ? -1 : left > right ? 1 : 0;
}

export const compareConversationTimelineSourceRecords = compareTimelineSourceRecords;

function canonicalSequence(value, fallback) {
  if (value === undefined || value === null) {
    return String(fallback);
  }
  return canonicalBigint(value, { minimum: 1n });
}

function canonicalTimelineItem(item, fallbackSequence) {
  const snapshot = plainRecordSnapshot(item);
  const sequence = canonicalSequence(snapshot.sequence_no, fallbackSequence);
  const sourceHash = snapshot.content_hash ?? snapshot.source_hash;
  if (typeof sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(sourceHash)) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return Object.freeze({
    session_id: requiredUuid(snapshot.session_id),
    sequence_no: sequence,
    item_type: ITEM_TYPES.has(snapshot.item_type)
      ? snapshot.item_type
      : fail(TIMELINE_ERROR_CODES.sourceInvalid),
    sender_kind: SENDER_KINDS.has(snapshot.sender_kind)
      ? snapshot.sender_kind
      : fail(TIMELINE_ERROR_CODES.sourceInvalid),
    visibility: VISIBILITIES.has(snapshot.visibility)
      ? snapshot.visibility
      : fail(TIMELINE_ERROR_CODES.sourceInvalid),
    content_hash: sourceHash,
    source_type: SOURCE_TYPES.has(snapshot.source_type)
      ? snapshot.source_type
      : fail(TIMELINE_ERROR_CODES.sourceInvalid),
    source_id: boundedString(snapshot.source_id, 256),
    projection_variant: boundedString(snapshot.projection_variant, 64, { token: true }),
    occurred_at: isoDateTime(snapshot.occurred_at),
  });
}

function plainArrayValues(value, maximumLength = 100_000) {
  try {
    if (
      value === null
      || typeof value !== 'object'
      || utilTypes.isProxy(value)
      || !Array.isArray(value)
      || Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length !== 0
    ) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors.length;
    if (
      lengthDescriptor === undefined
      || !Object.hasOwn(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0
      || lengthDescriptor.value > maximumLength
    ) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    const length = lengthDescriptor.value;
    const keys = Object.keys(descriptors).filter((key) => key !== 'length');
    if (keys.length !== length) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true
      ) {
        fail(TIMELINE_ERROR_CODES.sourceInvalid);
      }
      result.push(descriptor.value);
    }
    return result;
  } catch (error) {
    if (isStableTimelineProjectionError(error)) {
      throw error;
    }
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
}

export function computeTimelineCanonicalHash(items) {
  const values = plainArrayValues(items);
  const hasSequences = [];
  for (const item of values) {
    assertPlainRecord(item);
    const descriptor = Object.getOwnPropertyDescriptor(item, 'sequence_no');
    hasSequences.push(descriptor !== undefined && descriptor.value !== undefined);
  }
  let prepared;
  if (hasSequences.every((present) => present === false)) {
    prepared = values
      .map((item) => normalizeTimelineSourceRecord(item))
      .sort(compareTimelineSourceRecords)
      .map((item, index) => canonicalTimelineItem(item, index + 1));
  } else {
    if (hasSequences.some((present) => present === false)) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    prepared = values.map((item, index) => canonicalTimelineItem(item, index + 1));
    prepared.sort((left, right) => {
      const leftSequence = BigInt(left.sequence_no);
      const rightSequence = BigInt(right.sequence_no);
      return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
    });
    for (let index = 0; index < prepared.length; index += 1) {
      if (prepared[index].sequence_no !== String(index + 1)) {
        fail(TIMELINE_ERROR_CODES.sourceInvalid);
      }
    }
  }
  return sha256Canonical(prepared);
}

export const canonicalConversationTimelineHash = computeTimelineCanonicalHash;

function mapperContext(context, defaults) {
  const snapshot = plainRecordSnapshot(context);
  return Object.freeze({
    projector_name: snapshot.projectorName ?? snapshot.projector_name ?? DEFAULT_PROJECTOR_NAME,
    projector_version: snapshot.projectorVersion ?? snapshot.projector_version ?? DEFAULT_PROJECTOR_VERSION,
    source_stream: snapshot.sourceStream ?? snapshot.source_stream ?? defaults.sourceStream,
    session_id: snapshot.sessionId ?? snapshot.session_id,
    privacy_class: snapshot.privacyClass ?? snapshot.privacy_class,
    retention_until: snapshot.retentionUntil ?? snapshot.retention_until,
  });
}

function inheritedControl(row, context, key) {
  return row[key] ?? context[key];
}

function createMappedRecord(fields) {
  const withoutHash = { ...fields };
  return normalizeTimelineSourceRecord(withoutHash);
}

export function mapChannelMessageTimelineSource(row, context = {}) {
  row = plainRecordSnapshot(row);
  const scope = mapperContext(context, { sourceStream: 'channel.message_inbox' });
  const cleanText = row.clean_text ?? null;
  const msgType = boundedString(row.msg_type, 32);
  const relationType = row.relation_type ?? null;
  if (relationType !== null && !['PRIMARY', 'SUPPLEMENT', 'CLARIFICATION'].includes(relationType)) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  const hasText = typeof cleanText === 'string' && cleanText.length > 0;
  const hasMedia = typeof row.has_media === 'boolean'
    ? row.has_media
    : ['image', 'mixed', 'voice', 'file', 'video'].includes(msgType);
  return createMappedRecord({
    schema_version: 1,
    projector_name: scope.projector_name,
    projector_version: scope.projector_version,
    source_stream: scope.source_stream,
    source_type: 'CHANNEL_MESSAGE',
    source_id: canonicalBigint(row.id ?? row.channel_message_id),
    projection_variant: 'MESSAGE',
    session_id: scope.session_id,
    item_type: 'USER_MESSAGE',
    sender_kind: 'USER',
    visibility: 'EXTERNAL',
    text: cleanText,
    safe_content: {
      msg_type: msgType,
      relation_type: relationType,
      has_text: hasText,
      has_media: hasMedia,
    },
    occurred_at: row.received_at ?? row.occurred_at,
    source_ordinal: row.source_ordinal ?? row.sequence_no ?? row.id ?? row.channel_message_id,
    privacy_class: inheritedControl(row, scope, 'privacy_class'),
    retention_until: inheritedControl(row, scope, 'retention_until'),
  });
}

export const mapChannelMessageTimelineSources = (row, context = {}) => Object.freeze([
  mapChannelMessageTimelineSource(row, context),
]);
export const mapChannelMessageSourceRecord = mapChannelMessageTimelineSource;

function ticketSafeContent(row) {
  const content = {
    event_type: row.event_type,
    old_status: row.old_status ?? null,
    new_status: row.new_status,
    aggregate_version: canonicalBigint(row.aggregate_version, { minimum: 1n }),
    event_ordinal: canonicalBigint(row.event_ordinal, { minimum: 1n }),
    reason_code: row.reason_code ?? null,
  };
  boundedString(content.event_type, 128);
  if (content.old_status !== null) {
    boundedString(content.old_status, 64);
  }
  boundedString(content.new_status, 64);
  if (content.reason_code !== null) {
    boundedString(content.reason_code, 128);
  }
  return content;
}

export function mapTicketEventTimelineSources(row, context = {}) {
  row = plainRecordSnapshot(row);
  const scope = mapperContext(context, { sourceStream: 'pilot_ticket.ticket_event' });
  const base = {
    schema_version: 1,
    projector_name: scope.projector_name,
    projector_version: scope.projector_version,
    source_stream: scope.source_stream,
    source_type: 'TICKET_EVENT',
    source_id: requiredUuid(row.event_id ?? row.id),
    session_id: scope.session_id,
    item_type: 'TICKET_EVENT',
    sender_kind: 'SYSTEM',
    safe_content: ticketSafeContent(row),
    occurred_at: row.created_at ?? row.occurred_at,
    source_ordinal: row.event_ordinal,
    privacy_class: inheritedControl(row, scope, 'privacy_class'),
    retention_until: inheritedControl(row, scope, 'retention_until'),
  };
  const records = [createMappedRecord({
    ...base,
    projection_variant: 'STATUS',
    visibility: 'INTERNAL',
    text: null,
  })];
  if (row.external_note !== null && row.external_note !== undefined) {
    records.push(createMappedRecord({
      ...base,
      projection_variant: 'EXTERNAL_NOTE',
      visibility: 'EXTERNAL',
      text: row.external_note,
    }));
  }
  if (row.internal_note !== null && row.internal_note !== undefined) {
    records.push(createMappedRecord({
      ...base,
      projection_variant: 'INTERNAL_NOTE',
      visibility: 'INTERNAL',
      text: row.internal_note,
    }));
  }
  return Object.freeze(records);
}

export const mapTicketEventSourceRecords = mapTicketEventTimelineSources;

export function mapNotificationDeliveryTimelineSource(row, context = {}) {
  row = plainRecordSnapshot(row);
  const scope = mapperContext(context, { sourceStream: 'notification.delivery_attempt' });
  const attemptCount = row.attempt_count ?? row.attempt_no;
  const normalizedAttempt = canonicalBigint(attemptCount, { minimum: 0n });
  const status = row.status ?? row.outcome;
  boundedString(row.channel, 64);
  boundedString(status, 64);
  const errorCode = row.error_code ?? row.last_error_code ?? null;
  if (errorCode !== null) {
    boundedString(errorCode, 128);
  }
  return createMappedRecord({
    schema_version: 1,
    projector_name: scope.projector_name,
    projector_version: scope.projector_version,
    source_stream: scope.source_stream,
    source_type: 'DELIVERY',
    source_id: requiredUuid(row.delivery_id ?? row.id),
    projection_variant: normalizedAttempt === '0' ? 'STATE_0' : `ATTEMPT_${normalizedAttempt}`,
    session_id: scope.session_id,
    item_type: 'DELIVERY_STATUS',
    sender_kind: 'SYSTEM',
    visibility: 'INTERNAL',
    text: null,
    safe_content: {
      channel: row.channel,
      status,
      attempt_count: normalizedAttempt,
      error_code: errorCode,
    },
    occurred_at: row.occurred_at ?? row.updated_at ?? row.created_at,
    source_ordinal: row.source_ordinal ?? attemptCount,
    privacy_class: inheritedControl(row, scope, 'privacy_class'),
    retention_until: inheritedControl(row, scope, 'retention_until'),
  });
}

export const mapNotificationDeliveryTimelineSources = (row, context = {}) => Object.freeze([
  mapNotificationDeliveryTimelineSource(row, context),
]);
export const mapDeliveryTimelineSource = mapNotificationDeliveryTimelineSource;
export const mapNotificationDeliverySourceRecord = mapNotificationDeliveryTimelineSource;

function requireFixture(row, expected) {
  if (row.fixture !== true && row.fixture_kind !== expected && row.__fixture !== true) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
}

export function mapCommunicationMessageFixtureTimelineSource(row, context = {}) {
  row = plainRecordSnapshot(row);
  requireFixture(row, 'COMMUNICATION_MESSAGE');
  const scope = mapperContext(context, { sourceStream: 'fixture.communication_message' });
  const senderKind = row.sender_kind ?? 'AGENT';
  const visibility = row.visibility ?? 'EXTERNAL';
  return createMappedRecord({
    schema_version: 1,
    projector_name: scope.projector_name,
    projector_version: scope.projector_version,
    source_stream: scope.source_stream,
    source_type: 'COMMUNICATION_MESSAGE',
    source_id: requiredUuid(row.id ?? row.message_id),
    projection_variant: row.projection_variant ?? 'MESSAGE',
    session_id: scope.session_id,
    item_type: row.item_type ?? (senderKind === 'AGENT' ? 'AGENT_MESSAGE' : 'SYSTEM_EVENT'),
    sender_kind: senderKind,
    visibility,
    text: row.text ?? null,
    safe_content: row.safe_content ?? {},
    occurred_at: row.occurred_at,
    source_ordinal: row.source_ordinal ?? 0,
    privacy_class: inheritedControl(row, scope, 'privacy_class'),
    retention_until: inheritedControl(row, scope, 'retention_until'),
  });
}

export const mapCommunicationMessageFixtureTimelineSources = (row, context = {}) => Object.freeze([
  mapCommunicationMessageFixtureTimelineSource(row, context),
]);
export const mapCommunicationMessageFixtureSourceRecord = mapCommunicationMessageFixtureTimelineSource;

export function mapHandoffEventFixtureTimelineSource(row, context = {}) {
  row = plainRecordSnapshot(row);
  requireFixture(row, 'HANDOFF_EVENT');
  if (row.visibility !== undefined && row.visibility !== 'INTERNAL') {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  const scope = mapperContext(context, { sourceStream: 'fixture.handoff_event' });
  return createMappedRecord({
    schema_version: 1,
    projector_name: scope.projector_name,
    projector_version: scope.projector_version,
    source_stream: scope.source_stream,
    source_type: 'HANDOFF_EVENT',
    source_id: requiredUuid(row.id ?? row.event_id),
    projection_variant: row.projection_variant ?? 'HANDOFF',
    session_id: scope.session_id,
    item_type: 'HANDOFF_EVENT',
    sender_kind: 'SYSTEM',
    visibility: 'INTERNAL',
    text: row.text ?? null,
    safe_content: row.safe_content ?? {},
    occurred_at: row.occurred_at,
    source_ordinal: row.source_ordinal ?? 0,
    privacy_class: inheritedControl(row, scope, 'privacy_class'),
    retention_until: inheritedControl(row, scope, 'retention_until'),
  });
}

export const mapHandoffEventFixtureTimelineSources = (row, context = {}) => Object.freeze([
  mapHandoffEventFixtureTimelineSource(row, context),
]);
export const mapHandoffEventFixtureSourceRecord = mapHandoffEventFixtureTimelineSource;

export class TimelineSourceAdapter {
  constructor(options) {
    options = plainRecordSnapshot(options);
    const {
      sourceStream,
      readBatch,
      mapRow = (row) => row,
      readSessionRecords = null,
    } = options;
    this.sourceStream = contractIdentifier(
      sourceStream,
      128,
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
    );
    if (typeof readBatch !== 'function' || typeof mapRow !== 'function') {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    if (readSessionRecords !== null && typeof readSessionRecords !== 'function') {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    this.readBatchOperation = readBatch;
    this.mapRow = mapRow;
    this.readSessionRecordsOperation = readSessionRecords;
    Object.freeze(this);
  }

  async readBatch(options = {}) {
    options = plainRecordSnapshot(options);
    try {
      const raw = await this.readBatchOperation(options);
      const envelope = Array.isArray(raw)
        ? { records: plainArrayValues(raw) }
        : raw;
      const envelopeSnapshot = plainRecordSnapshot(envelope);
      const rows = plainArrayValues(envelopeSnapshot.records);
      const mappedRows = [];
      for (const row of rows) {
        const mapped = this.mapRow(row, options);
        if (Array.isArray(mapped)) {
          mappedRows.push(...plainArrayValues(mapped));
        } else {
          mappedRows.push(mapped);
        }
      }
      const records = mappedRows.map(normalizeTimelineSourceRecord);
      return Object.freeze({
        records: Object.freeze(records),
        next_cursor_value: envelopeSnapshot.next_cursor_value
          ?? envelopeSnapshot.cursor_value
          ?? envelopeSnapshot.cursorValue
          ?? null,
        exhausted: envelopeSnapshot.exhausted === true || envelopeSnapshot.done === true,
        cursor_value: envelopeSnapshot.next_cursor_value
          ?? envelopeSnapshot.cursor_value
          ?? envelopeSnapshot.cursorValue
          ?? null,
        done: envelopeSnapshot.exhausted === true || envelopeSnapshot.done === true,
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async readSessionRecords(options = {}) {
    options = plainRecordSnapshot(options);
    if (this.readSessionRecordsOperation === null) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    try {
      const rows = await this.readSessionRecordsOperation(options);
      return Object.freeze(plainArrayValues(rows).map(normalizeTimelineSourceRecord));
    } catch (error) {
      throw mapStorageError(error);
    }
  }
}

export function createTimelineSourceAdapter(options) {
  return new TimelineSourceAdapter(options);
}

export async function applyTimelineProjectionMigration(options) {
  options = plainRecordSnapshot(options);
  const pool = options.pool;
  try {
    const query = dataPropertyFromPrototypeChain(
      pool,
      'query',
      TIMELINE_ERROR_CODES.sourceInvalid,
    );
    if (typeof query !== 'function') {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
    const sql = await readFile(MIGRATION_URL, 'utf8');
    await query.call(pool, sql);
  } catch (error) {
    throw mapStorageError(error);
  }
}

function mapStorageError(error, { rebuilding = false } = {}) {
  if (isStableTimelineProjectionError(error)) {
    return error;
  }
  const code = safeErrorDataProperty(error, 'code');
  const message = safeErrorDataProperty(error, 'message');
  const constraint = safeErrorDataProperty(error, 'constraint');
  if (code === '23514' && message === TIMELINE_ERROR_CODES.schemaDrift) {
    return new TimelineProjectionError(TIMELINE_ERROR_CODES.schemaDrift);
  }
  if (code === '23503' && constraint === 'conversation_item_session_fk') {
    return new TimelineProjectionError(TIMELINE_ERROR_CODES.sessionNotFound);
  }
  if (code === '23505') {
    if (
      constraint === 'conversation_item_session_sequence_unique'
      || constraint === 'conversation_item_session_sequence_key'
    ) {
      return new TimelineProjectionError(TIMELINE_ERROR_CODES.sequenceConflict);
    }
    if (
      constraint === 'conversation_item_source_binding_pkey'
      || constraint === 'conversation_item_source_binding_identity_unique'
      || constraint === 'conversation_item_source_binding_item_unique'
      || constraint === 'conversation_item_source_binding_item_id_key'
    ) {
      return new TimelineProjectionError(TIMELINE_ERROR_CODES.sourceConflict);
    }
  }
  return new TimelineProjectionError(
    rebuilding ? TIMELINE_ERROR_CODES.rebuildFailed : TIMELINE_ERROR_CODES.storageFailed,
  );
}

function assertProjectorEnabled(enabled) {
  if (enabled !== true) {
    fail(TIMELINE_ERROR_CODES.disabled);
  }
}

function assertPool(pool, { transaction = false } = {}) {
  let valid = false;
  try {
    valid = typeof dataPropertyFromPrototypeChain(
      pool,
      'query',
      TIMELINE_ERROR_CODES.storageFailed,
    ) === 'function'
      && (!transaction || typeof dataPropertyFromPrototypeChain(
        pool,
        'connect',
        TIMELINE_ERROR_CODES.storageFailed,
      ) === 'function');
  } catch {
    valid = false;
  }
  if (!valid) {
    fail(TIMELINE_ERROR_CODES.storageFailed);
  }
}

function normalizeProjectInput(input, configuredBatchSize) {
  input = plainRecordSnapshot(input);
  const projectorName = timelineProjectorName(input.projectorName ?? input.projector_name);
  const projectorVersion = contractIdentifier(
    input.projectorVersion ?? input.projector_version,
    64,
    /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u,
  );
  const inputRecords = input.records ?? input.sourceRecords ?? input.source_records;
  const records = plainArrayValues(inputRecords, configuredBatchSize)
    .map(normalizeTimelineSourceRecord);
  const explicitStream = input.sourceStream ?? input.source_stream ?? null;
  const streams = new Set(records.map((record) => record.source_stream));
  const sourceStream = explicitStream === null
    ? (streams.size === 1 ? records[0]?.source_stream : null)
    : contractIdentifier(explicitStream, 128, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
  if (sourceStream === null || records.some(
    (record) => record.projector_name !== projectorName
      || record.projector_version !== projectorVersion
      || record.source_stream !== sourceStream,
  )) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return Object.freeze({
    projectorName,
    projectorVersion,
    sourceStream,
    records: Object.freeze(records),
    expectedCheckpoint: input.expectedCheckpoint ?? input.expected_checkpoint ?? undefined,
    cursorValue: input.cursorValue ?? input.cursor_value ?? null,
    signal: input.signal,
  });
}

function normalizeExpectedCheckpoint(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Object.freeze({ absent: true });
  }
  if (typeof value === 'string') {
    return Object.freeze({ cursor_value: boundedString(value, 512) });
  }
  value = plainRecordSnapshot(value);
  const normalized = Object.create(null);
  if (value.cursorValue !== undefined || value.cursor_value !== undefined) {
    const cursorValue = value.cursorValue !== undefined
      ? value.cursorValue
      : value.cursor_value;
    normalized.cursor_value = cursorValue === null ? null : boundedString(cursorValue, 512);
  }
  if (value.rowVersion !== undefined || value.row_version !== undefined) {
    normalized.row_version = canonicalBigint(value.rowVersion ?? value.row_version, { minimum: 1n });
  }
  if (Object.keys(normalized).length === 0) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return Object.freeze(normalized);
}

function checkpointMatches(row, expected) {
  if (expected === undefined) {
    return true;
  }
  if (expected.absent === true) {
    return row === null;
  }
  if (row === null) {
    return false;
  }
  return (
    (expected.cursor_value === undefined || row.cursor_value === expected.cursor_value)
    && (
      expected.row_version === undefined
      || canonicalBigint(row.row_version, { minimum: 1n }) === expected.row_version
    )
  );
}

function chooseCursorValue(records, explicit) {
  if (explicit !== null && explicit !== undefined) {
    return boundedString(String(explicit), 512);
  }
  if (records.length === 0) {
    return null;
  }
  return records.reduce(
    (maximum, record) => BigInt(record.source_ordinal) > BigInt(maximum)
      ? record.source_ordinal
      : maximum,
    '0',
  );
}

function lastOccurredAt(records) {
  if (records.length === 0) {
    return null;
  }
  return records.reduce(
    (latest, record) => record.occurred_at > latest ? record.occurred_at : latest,
    records[0].occurred_at,
  );
}

function safeStats({ received, inserted, replayed, sessions, checkpointUpdated, batchHash }) {
  return Object.freeze({
    received_count: received,
    inserted_count: inserted,
    replayed_count: replayed,
    conflict_count: 0,
    session_count: sessions,
    checkpoint_updated: checkpointUpdated,
    batch_hash: batchHash,
  });
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The public error remains a stable code; rollback errors are intentionally not exposed.
  }
}

function releaseQuietly(client) {
  try {
    const release = dataPropertyFromPrototypeChain(
      client,
      'release',
      TIMELINE_ERROR_CODES.storageFailed,
    );
    if (typeof release === 'function') {
      release.call(client);
    }
  } catch {
    // Release failures must not replace the stable public operation result.
  }
}

async function connectPool(pool, errorCode) {
  try {
    const connect = dataPropertyFromPrototypeChain(pool, 'connect', errorCode);
    if (typeof connect !== 'function') {
      fail(errorCode);
    }
    return await connect.call(pool);
  } catch {
    fail(errorCode);
  }
}

async function setProjectionTransactionBounds(client) {
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '60s'");
}

async function acquireAdvisoryLock(client, identity) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [identity],
  );
}

async function requireSession(client, sessionId) {
  const result = await client.query(
    'SELECT id::text FROM conversation.session WHERE id = $1::uuid',
    [sessionId],
  );
  if (result.rowCount !== 1) {
    fail(TIMELINE_ERROR_CODES.sessionNotFound);
  }
}

async function getBinding(client, record) {
  const result = await client.query(
    `SELECT binding.item_id::text, binding.source_hash, binding.canonical_order_key,
            item.privacy_class, item.retention_until
       FROM conversation.item_source_binding AS binding
       JOIN conversation.item AS item ON item.id = binding.item_id
      WHERE binding.projector_name = $1
        AND binding.source_stream = $2
        AND binding.source_type = $3
        AND binding.source_id = $4
        AND binding.projection_variant = $5
        AND binding.session_id = $6::uuid`,
    [
      record.projector_name,
      record.source_stream,
      record.source_type,
      record.source_id,
      record.projection_variant,
      record.session_id,
    ],
  );
  if (result.rowCount > 1) {
    fail(TIMELINE_ERROR_CODES.sourceConflict);
  }
  return result.rowCount === 0 ? null : result.rows[0];
}

function tighterPrivacy(current, candidate) {
  if (!PRIVACY_CLASSES.has(current) || !PRIVACY_CLASSES.has(candidate)) {
    fail(TIMELINE_ERROR_CODES.storageFailed);
  }
  return PRIVACY_RANK[candidate] > PRIVACY_RANK[current] ? candidate : current;
}

function earlierRetention(current, candidate) {
  const currentIso = postgresTimestampToLocalDateTime(current);
  const candidateIso = isoDateTime(candidate);
  return candidateIso < currentIso ? candidateIso : currentIso;
}

async function replayExistingBinding(client, binding, record) {
  if (
    binding.source_hash !== record.source_hash
    || binding.canonical_order_key !== computeTimelineCanonicalOrderKey(record)
  ) {
    fail(TIMELINE_ERROR_CODES.sourceConflict);
  }
  const privacyClass = tighterPrivacy(binding.privacy_class, record.privacy_class);
  const retentionUntil = earlierRetention(binding.retention_until, record.retention_until);
  if (
    privacyClass !== binding.privacy_class
    || retentionUntil !== postgresTimestampToLocalDateTime(binding.retention_until)
  ) {
    await client.query(
      `UPDATE conversation.item
          SET privacy_class = $2,
              retention_until = $3::timestamp without time zone
        WHERE id = $1::uuid`,
      [binding.item_id, privacyClass, retentionUntil],
    );
  }
  await client.query(
    `UPDATE conversation.item_source_binding
        SET projector_version = $2,
            last_seen_at = GREATEST(
              created_at,
              date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
            )
      WHERE item_id = $1::uuid`,
    [binding.item_id, record.projector_version],
  );
}

async function sessionTail(client, sessionId) {
  const result = await client.query(
    `SELECT sequence_no::text, canonical_order_key
       FROM conversation.item AS item
      WHERE item.session_id = $1::uuid
      ORDER BY item.sequence_no DESC
      LIMIT 1`,
    [sessionId],
  );
  if (result.rowCount === 0) {
    return Object.freeze({ sequence: 0n, canonicalOrderKey: null });
  }
  if (result.rowCount !== 1) {
    fail(TIMELINE_ERROR_CODES.storageFailed);
  }
  return Object.freeze({
    sequence: BigInt(canonicalBigint(result.rows[0].sequence_no, { minimum: 1n })),
    canonicalOrderKey: boundedString(result.rows[0].canonical_order_key, 1024),
  });
}

async function insertProjectedItem(client, record, sequenceNo, canonicalOrderKey) {
  if (sequenceNo > BigInt(MAX_BIGINT_TEXT)) {
    fail(TIMELINE_ERROR_CODES.sequenceConflict);
  }
  const inserted = await client.query(
    `INSERT INTO conversation.item (
       session_id, sequence_no, item_type, sender_kind, visibility,
       text, safe_content, source_type, source_id, projection_variant,
        canonical_order_key, content_hash, privacy_class, retention_until,
        occurred_at
     ) VALUES (
       $1::uuid, $2::bigint, $3, $4, $5,
       $6, $7::jsonb, $8, $9, $10,
        $11, $12, $13, $14::timestamp without time zone,
        $15::timestamp without time zone
     ) RETURNING id::text, session_id::text, sequence_no::text, item_type,
                 sender_kind, visibility, occurred_at, retention_until`,
    [
      record.session_id,
      sequenceNo.toString(),
      record.item_type,
      record.sender_kind,
      record.visibility,
      record.text,
      canonicalJson(record.safe_content),
      record.source_type,
      record.source_id,
      record.projection_variant,
      canonicalOrderKey,
      record.source_hash,
      record.privacy_class,
      record.retention_until,
      record.occurred_at,
    ],
  );
  if (inserted.rowCount !== 1) {
    fail(TIMELINE_ERROR_CODES.storageFailed);
  }
  const itemId = requiredUuid(inserted.rows[0].id);
  await client.query(
    `INSERT INTO conversation.item_source_binding (
       projector_name, projector_version, source_stream, source_type,
       source_id, projection_variant, session_id, item_id, source_hash,
       canonical_order_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9, $10)`,
    [
      record.projector_name,
      record.projector_version,
      record.source_stream,
      record.source_type,
      record.source_id,
      record.projection_variant,
      record.session_id,
      itemId,
      record.source_hash,
      canonicalOrderKey,
    ],
  );
  return Object.freeze({
    id: itemId,
    session_id: requiredUuid(inserted.rows[0].session_id),
    sequence_no: canonicalBigint(inserted.rows[0].sequence_no, { minimum: 1n }),
    item_type: inserted.rows[0].item_type,
    sender_kind: inserted.rows[0].sender_kind,
    visibility: inserted.rows[0].visibility,
    occurred_at: postgresTimestampToLocalDateTime(inserted.rows[0].occurred_at),
    retention_until: postgresTimestampToLocalDateTime(inserted.rows[0].retention_until),
  });
}

async function persistedCanonicalTimeline(client, sessionId) {
  const result = await client.query(
    `SELECT item.session_id::text, item.sequence_no::text,
            item.item_type, item.sender_kind, item.visibility,
            item.content_hash, item.source_type, item.source_id,
            item.projection_variant, item.occurred_at
       FROM conversation.item AS item
       JOIN conversation.item_source_binding AS binding
         ON binding.item_id = item.id
        AND binding.session_id = item.session_id
      WHERE item.session_id = $1::uuid
      ORDER BY item.occurred_at, item.sequence_no`,
    [sessionId],
  );
  const canonicalRows = result.rows.map((row) => ({
    ...row,
    occurred_at: postgresTimestampToLocalDateTime(row.occurred_at),
  }));
  const canonicalHash = computeTimelineCanonicalHash(canonicalRows);
  return Object.freeze({
    itemCount: canonicalRows.length,
    canonicalHash,
  });
}

async function readCheckpointForUpdate(client, projectorName, sourceStream) {
  const result = await client.query(
    `SELECT projector_version, cursor_value,
            last_source_occurred_at, last_batch_hash,
            row_version::text, updated_at
       FROM conversation.projection_checkpoint
      WHERE projector_name = $1 AND source_stream = $2
      FOR UPDATE`,
    [projectorName, sourceStream],
  );
  if (result.rowCount > 1) {
    fail(TIMELINE_ERROR_CODES.checkpointConflict);
  }
  return result.rowCount === 0 ? null : result.rows[0];
}

async function writeCheckpoint(client, {
  projectorName,
  projectorVersion,
  sourceStream,
  cursorValue,
  occurredAt,
  batchHash,
  current,
}) {
  if (cursorValue === null) {
    return false;
  }
  if (current === null) {
    await client.query(
      `INSERT INTO conversation.projection_checkpoint (
         projector_name, projector_version, source_stream, cursor_value,
         last_source_occurred_at, last_batch_hash
       ) VALUES ($1, $2, $3, $4, $5::timestamp without time zone, $6)`,
      [projectorName, projectorVersion, sourceStream, cursorValue, occurredAt, batchHash],
    );
    return true;
  }
  if (current.cursor_value === cursorValue && current.last_batch_hash === batchHash) {
    return false;
  }
  if (current.cursor_value === cursorValue && current.last_batch_hash !== batchHash) {
    fail(TIMELINE_ERROR_CODES.checkpointConflict);
  }
  if (
    /^(0|[1-9][0-9]*)$/u.test(current.cursor_value)
    && /^(0|[1-9][0-9]*)$/u.test(cursorValue)
    && BigInt(current.cursor_value) > BigInt(cursorValue)
  ) {
    return false;
  }
  const result = await client.query(
    `UPDATE conversation.projection_checkpoint
        SET projector_version = $3,
            cursor_value = $4,
            last_source_occurred_at = $5::timestamp without time zone,
            last_batch_hash = $6,
            row_version = row_version + 1,
            updated_at = date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
      WHERE projector_name = $1
        AND source_stream = $2
        AND row_version = $7::bigint`,
    [
      projectorName,
      sourceStream,
      projectorVersion,
      cursorValue,
      occurredAt,
      batchHash,
      canonicalBigint(current.row_version, { minimum: 1n }),
    ],
  );
  if (result.rowCount !== 1) {
    fail(TIMELINE_ERROR_CODES.checkpointConflict);
  }
  return true;
}

function recordsBatchHash(records) {
  return sha256Canonical([...records]
    .sort(compareTimelineSourceRecords)
    .map((record) => ({
      source_stream: record.source_stream,
      source_type: record.source_type,
      source_id: record.source_id,
      projection_variant: record.projection_variant,
      session_id: record.session_id,
      source_hash: record.source_hash,
    })));
}

function publicItemFromRow(row) {
  const safeContent = clonePlainJson(row.safe_content);
  if (safeContent === null || Array.isArray(safeContent)) {
    fail(TIMELINE_ERROR_CODES.storageFailed);
  }
  return Object.freeze({
    id: requiredUuid(row.id),
    session_id: requiredUuid(row.session_id),
    sequence_no: canonicalBigint(row.sequence_no, { minimum: 1n }),
    item_type: row.item_type,
    sender_kind: row.sender_kind,
    visibility: row.visibility,
    text: nullableText(row.text),
    safe_content: safeContent,
    source_type: row.source_type,
    source_id: row.source_id,
    projection_variant: row.projection_variant,
    canonical_order_key: boundedString(row.canonical_order_key, 1024),
    content_hash: row.content_hash,
    privacy_class: row.privacy_class,
    retention_until: postgresTimestampToLocalDateTime(row.retention_until),
    retention_until_epoch_ms: shanghaiLocalToEpochMs(postgresTimestampToLocalDateTime(row.retention_until)),
    occurred_at: postgresTimestampToLocalDateTime(row.occurred_at),
    projected_at: postgresTimestampToLocalDateTime(row.projected_at),
  });
}

function validateRebuildInput(input) {
  input = plainRecordSnapshot(input);
  const sessionId = requiredUuid(input.sessionId ?? input.session_id);
  const projectorName = timelineProjectorName(input.projectorName ?? input.projector_name);
  const projectorVersion = contractIdentifier(
    input.projectorVersion ?? input.projector_version,
    64,
    /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u,
  );
  const inputRecords = input.records ?? input.sourceRecords ?? input.source_records;
  const records = plainArrayValues(inputRecords).map(normalizeTimelineSourceRecord);
  if (records.some(
    (record) => record.session_id !== sessionId
      || record.projector_name !== projectorName
      || record.projector_version !== projectorVersion,
  )) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  return Object.freeze({
    sessionId,
    projectorName,
    projectorVersion,
    records: Object.freeze(records),
    authorized: input.authorized === true || input.rebuildAuthorized === true,
    signal: input.signal,
  });
}

function sourceBindingIdentity(record) {
  return canonicalJson([
    record.projector_name,
    record.source_stream,
    record.source_type,
    record.source_id,
    record.projection_variant,
    record.session_id,
  ]);
}

function prepareRebuildRecords(input) {
  const normalized = validateRebuildInput(input);
  const sorted = [...normalized.records].sort(compareTimelineSourceRecords);
  const identities = new Set();
  let priorKey = null;
  for (const record of sorted) {
    const identity = sourceBindingIdentity(record);
    const key = computeTimelineCanonicalOrderKey(record);
    if (identities.has(identity)) {
      fail(TIMELINE_ERROR_CODES.sourceConflict);
    }
    if (key === priorKey) {
      fail(TIMELINE_ERROR_CODES.sequenceConflict);
    }
    identities.add(identity);
    priorKey = key;
  }
  const hash = computeTimelineCanonicalHash(sorted);
  return Object.freeze({ ...normalized, sorted: Object.freeze(sorted), canonicalHash: hash });
}

async function assertRebuildSnapshotCurrent(client, prepared) {
  const result = await client.query(
    `SELECT item.id::text AS item_id, item.privacy_class, item.retention_until,
            binding.projector_name, binding.source_stream, binding.source_type,
            binding.source_id, binding.projection_variant,
            binding.session_id::text, binding.source_hash
       FROM conversation.item AS item
       LEFT JOIN conversation.item_source_binding AS binding
         ON binding.item_id = item.id
      WHERE item.session_id = $1::uuid
      ORDER BY item.occurred_at, item.sequence_no`,
    [prepared.sessionId],
  );
  if (!Number.isSafeInteger(result.rowCount) || result.rowCount !== result.rows.length) {
    fail(TIMELINE_ERROR_CODES.rebuildFailed);
  }
  const authorized = new Map(prepared.sorted.map(
    (record) => [sourceBindingIdentity(record), record],
  ));
  const seenItems = new Set();
  const seenIdentities = new Set();
  for (const row of result.rows) {
    if (
      typeof row.item_id !== 'string'
      || seenItems.has(row.item_id)
      || row.projector_name !== DEFAULT_PROJECTOR_NAME
      || row.session_id !== prepared.sessionId
      || typeof row.source_hash !== 'string'
    ) {
      fail(TIMELINE_ERROR_CODES.rebuildFailed);
    }
    const identity = sourceBindingIdentity(row);
    const expected = authorized.get(identity);
    if (
      expected === undefined
      || seenIdentities.has(identity)
      || row.source_hash !== expected.source_hash
      || !PRIVACY_CLASSES.has(row.privacy_class)
      || PRIVACY_RANK[row.privacy_class] > PRIVACY_RANK[expected.privacy_class]
      || postgresTimestampToLocalDateTime(row.retention_until) < isoDateTime(expected.retention_until)
    ) {
      fail(TIMELINE_ERROR_CODES.rebuildFailed);
    }
    seenItems.add(row.item_id);
    seenIdentities.add(identity);
  }
}

export function createTimelineProjector(options = {}) {
  options = plainRecordSnapshot(options);
  const {
    pool,
    enabled = false,
    batchSize = DEFAULT_BATCH_SIZE,
    restrictedAuthorizer = null,
    faultInjection = null,
    itemTransactionHook = null,
  } = options;
  const configuredBatchSize = boundedInteger(batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  if (enabled !== true && enabled !== false) {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  if (restrictedAuthorizer !== null && typeof restrictedAuthorizer !== 'function') {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  if (itemTransactionHook !== null && typeof itemTransactionHook !== 'function') {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  let beforeCommit = null;
  let afterCommit = null;
  if (faultInjection !== null) {
    const snapshot = plainRecordSnapshot(faultInjection);
    beforeCommit = snapshot.beforeCommit ?? null;
    afterCommit = snapshot.afterCommit ?? null;
    if (
      (beforeCommit !== null && typeof beforeCommit !== 'function')
      || (afterCommit !== null && typeof afterCommit !== 'function')
    ) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
  }

  async function executeProjectBatch(normalized) {
    throwIfAborted(normalized.signal);
    assertPool(pool, { transaction: true });
    const expectedCheckpoint = normalizeExpectedCheckpoint(normalized.expectedCheckpoint);
    const batchHash = recordsBatchHash(normalized.records);
    const grouped = new Map();
    for (const record of normalized.records) {
      const group = grouped.get(record.session_id) ?? [];
      group.push(record);
      grouped.set(record.session_id, group);
    }
    const sessionIds = [...grouped.keys()].sort();
    const client = await connectPool(pool, TIMELINE_ERROR_CODES.storageFailed);
    let committed = false;
    try {
      await client.query('BEGIN');
      await setProjectionTransactionBounds(client);
      await acquireAdvisoryLock(
        client,
        `P2_002_CHECKPOINT:${normalized.projectorName}:${normalized.sourceStream}`,
      );
      const checkpoint = await readCheckpointForUpdate(
        client,
        normalized.projectorName,
        normalized.sourceStream,
      );
      if (!checkpointMatches(checkpoint, expectedCheckpoint)) {
        fail(TIMELINE_ERROR_CODES.checkpointConflict);
      }

      let inserted = 0;
      let replayed = 0;
      for (const sessionId of sessionIds) {
        throwIfAborted(normalized.signal);
        await acquireAdvisoryLock(client, `P2_002_SESSION:${sessionId}`);
        await requireSession(client, sessionId);
        const records = grouped.get(sessionId).sort(compareTimelineSourceRecords);
        const tail = await sessionTail(client, sessionId);
        let sequence = tail.sequence;
        let tailKey = tail.canonicalOrderKey;
        for (const record of records) {
          throwIfAborted(normalized.signal);
          const binding = await getBinding(client, record);
          if (binding !== null) {
            await replayExistingBinding(client, binding, record);
            replayed += 1;
            continue;
          }
          const canonicalOrderKey = computeTimelineCanonicalOrderKey(record);
          const tailOccurredAt = tailKey === null ? null : tailKey.slice(0, 19);
          // ARCH-005: local business time has second precision.  Once a fact is
          // appended, sequence_no is the authoritative deterministic tie-break
          // for later facts in that same local second, even across source streams.
          if (tailOccurredAt !== null && record.occurred_at < tailOccurredAt) {
            fail(TIMELINE_ERROR_CODES.rebuildRequired);
          }
          if (tailKey !== null && canonicalOrderKey === tailKey) {
            fail(TIMELINE_ERROR_CODES.sequenceConflict);
          }
          sequence += 1n;
          const item = await insertProjectedItem(client, record, sequence, canonicalOrderKey);
          if (itemTransactionHook !== null) {
            await itemTransactionHook(Object.freeze({
              transaction: client,
              item,
              source_record: record,
            }));
          }
          tailKey = canonicalOrderKey;
          inserted += 1;
        }
      }

      const checkpointUpdated = await writeCheckpoint(client, {
        projectorName: normalized.projectorName,
        projectorVersion: normalized.projectorVersion,
        sourceStream: normalized.sourceStream,
        cursorValue: chooseCursorValue(normalized.records, normalized.cursorValue),
        occurredAt: lastOccurredAt(normalized.records),
        batchHash,
        current: checkpoint,
      });
      if (beforeCommit !== null) {
        await beforeCommit();
      }
      throwIfAborted(normalized.signal);
      await client.query('COMMIT');
      committed = true;
      const result = safeStats({
        received: normalized.records.length,
        inserted,
        replayed,
        sessions: sessionIds.length,
        checkpointUpdated,
        batchHash,
      });
      if (afterCommit !== null) {
        try {
          await afterCommit();
        } catch {
          fail(TIMELINE_ERROR_CODES.storageFailed);
        }
      }
      return result;
    } catch (error) {
      if (!committed) {
        await rollbackQuietly(client);
      }
      throw mapStorageError(error);
    } finally {
      releaseQuietly(client);
    }
  }

  const pendingProjectionOperations = [];
  let projectionDrainActive = false;
  let nextProjectionOperation = 0;

  function projectionOperationKey(normalized) {
    const keys = normalized.records.map(computeTimelineCanonicalOrderKey).sort();
    return [
      keys[0] ?? '',
      normalized.projectorName,
      normalized.sourceStream,
    ].join('|');
  }

  async function drainProjectionOperations() {
    try {
      while (pendingProjectionOperations.length > 0) {
        pendingProjectionOperations.sort((left, right) => (
          left.key < right.key ? -1 : left.key > right.key ? 1 : left.ordinal - right.ordinal
        ));
        const operation = pendingProjectionOperations.shift();
        try {
          operation.resolve(await executeProjectBatch(operation.normalized));
        } catch (error) {
          operation.reject(error);
        }
      }
    } finally {
      projectionDrainActive = false;
      if (pendingProjectionOperations.length > 0) {
        projectionDrainActive = true;
        setImmediate(() => { void drainProjectionOperations(); });
      }
    }
  }

  async function projectBatch(input) {
    assertProjectorEnabled(enabled);
    const normalized = normalizeProjectInput(input, configuredBatchSize);
    throwIfAborted(normalized.signal);
    const ordinal = nextProjectionOperation;
    nextProjectionOperation += 1;
    return new Promise((resolve, reject) => {
      pendingProjectionOperations.push({
        normalized,
        ordinal,
        key: projectionOperationKey(normalized),
        resolve,
        reject,
      });
      if (!projectionDrainActive) {
        projectionDrainActive = true;
        // One event-loop turn forms a bounded micro-batch for the configured
        // single worker. DB advisory transaction locks remain authoritative.
        setImmediate(() => { void drainProjectionOperations(); });
      }
    });
  }

  async function projectOne(input, options = {}) {
    input = plainRecordSnapshot(input);
    options = plainRecordSnapshot(options);
    if (input.schema_version === 1) {
      const record = normalizeTimelineSourceRecord(input);
      return projectBatch({
        ...options,
        projectorName: record.projector_name,
        projectorVersion: record.projector_version,
        sourceStream: record.source_stream,
        records: [record],
      });
    }
    const record = input.record ?? input.sourceRecord ?? input.source_record;
    return projectBatch({ ...input, records: [record] });
  }

  async function listTimelineItems(input) {
    assertProjectorEnabled(enabled);
    input = plainRecordSnapshot(input);
    assertPool(pool);
    const sessionId = requiredUuid(input.sessionId ?? input.session_id);
    const afterSequence = canonicalBigint(
      input.afterSequence ?? input.after_sequence ?? 0,
    );
    const limit = boundedInteger(input.limit, DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const audience = input.audience;
    if (!TIMELINE_AUDIENCES.includes(audience)) {
      fail(TIMELINE_ERROR_CODES.sourceInvalid);
    }
    if (audience === 'RESTRICTED_ADMIN') {
      const explicit = input.restrictedAuthorized === true
        || input.restricted_authorized === true
        || input.authorized === true;
      if (!explicit) {
        fail(TIMELINE_ERROR_CODES.rebuildNotAuthorized);
      }
      if (restrictedAuthorizer !== null) {
        let authorized = false;
        try {
          authorized = await restrictedAuthorizer({ sessionId, audience, signal: input.signal });
        } catch {
          authorized = false;
        }
        if (authorized !== true) {
          fail(TIMELINE_ERROR_CODES.rebuildNotAuthorized);
        }
      }
    }
    throwIfAborted(input.signal);
    const visibility = audience === 'EXTERNAL'
      ? ['EXTERNAL']
      : audience === 'WORKBENCH'
        ? ['EXTERNAL', 'INTERNAL']
        : ['EXTERNAL', 'INTERNAL', 'RESTRICTED'];
    try {
      const result = await pool.query(
        `SELECT id::text, session_id::text, sequence_no::text,
                item_type, sender_kind, visibility, text, safe_content,
                source_type, source_id, projection_variant,
                canonical_order_key, content_hash, privacy_class,
                retention_until, occurred_at, projected_at
           FROM conversation.item AS item
          WHERE item.session_id = $1::uuid
            AND item.sequence_no > $2::bigint
            AND item.visibility = ANY($3::text[])
          ORDER BY item.occurred_at, item.sequence_no
          LIMIT $4`,
        [sessionId, afterSequence, visibility, limit],
      );
      const items = result.rows
        .filter((row) => visibility.includes(row.visibility))
        .map(publicItemFromRow);
      return Object.freeze({
        session_id: sessionId,
        items: Object.freeze(items),
        next_after_sequence: items.length === 0 ? null : items.at(-1).sequence_no,
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async function getProjectionCheckpoint(input) {
    assertProjectorEnabled(enabled);
    input = plainRecordSnapshot(input);
    assertPool(pool);
    const projectorName = timelineProjectorName(input.projectorName ?? input.projector_name);
    const sourceStream = contractIdentifier(
      input.sourceStream ?? input.source_stream,
      128,
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
    );
    throwIfAborted(input.signal);
    try {
      const result = await pool.query(
        `SELECT projector_name, projector_version, source_stream,
                cursor_value, last_source_occurred_at, last_batch_hash,
                row_version::text, updated_at
           FROM conversation.projection_checkpoint
          WHERE projector_name = $1 AND source_stream = $2`,
        [projectorName, sourceStream],
      );
      if (result.rowCount === 0) {
        return null;
      }
      if (result.rowCount !== 1) {
        fail(TIMELINE_ERROR_CODES.checkpointConflict);
      }
      const row = result.rows[0];
      return Object.freeze({
        schema_version: 1,
        projector_name: row.projector_name,
        projector_version: row.projector_version,
        source_stream: row.source_stream,
        cursor_value: row.cursor_value === null
          ? null
          : boundedString(row.cursor_value, 512),
        last_source_occurred_at: row.last_source_occurred_at === null
          ? null
          : postgresTimestampToLocalDateTime(row.last_source_occurred_at),
        last_batch_hash: row.last_batch_hash,
        row_version: canonicalBigint(row.row_version, { minimum: 1n }),
        updated_at: postgresTimestampToLocalDateTime(row.updated_at),
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  function checkRebuildSession(input) {
    assertProjectorEnabled(enabled);
    const prepared = prepareRebuildRecords(input);
    return Object.freeze({
      session_id: prepared.sessionId,
      record_count: prepared.sorted.length,
      session_count: 1,
      canonical_hash: prepared.canonicalHash,
      source_stream_count: new Set(prepared.sorted.map((record) => record.source_stream)).size,
      write_required: true,
    });
  }

  async function rebuildSession(input) {
    assertProjectorEnabled(enabled);
    const prepared = prepareRebuildRecords(input);
    if (!prepared.authorized) {
      fail(TIMELINE_ERROR_CODES.rebuildNotAuthorized);
    }
    throwIfAborted(prepared.signal, TIMELINE_ERROR_CODES.rebuildFailed);
    assertPool(pool, { transaction: true });
    const sourceStreams = [...new Set(
      prepared.sorted.map((record) => record.source_stream),
    )].sort();
    const client = await connectPool(pool, TIMELINE_ERROR_CODES.rebuildFailed);
    let committed = false;
    try {
      await client.query('BEGIN');
      await setProjectionTransactionBounds(client);
      for (const sourceStream of sourceStreams) {
        await acquireAdvisoryLock(
          client,
          `P2_002_CHECKPOINT:${prepared.projectorName}:${sourceStream}`,
        );
      }
      await acquireAdvisoryLock(client, `P2_002_SESSION:${prepared.sessionId}`);
      await requireSession(client, prepared.sessionId);
      await assertRebuildSnapshotCurrent(client, prepared);
      await client.query(
        'DELETE FROM conversation.item WHERE session_id = $1::uuid',
        [prepared.sessionId],
      );
      let sequence = 0n;
      for (const record of prepared.sorted) {
        throwIfAborted(prepared.signal, TIMELINE_ERROR_CODES.rebuildFailed);
        sequence += 1n;
        await insertProjectedItem(
          client,
          record,
          sequence,
          computeTimelineCanonicalOrderKey(record),
        );
      }
      const persisted = await persistedCanonicalTimeline(client, prepared.sessionId);
      if (
        persisted.itemCount !== prepared.sorted.length
        || persisted.canonicalHash !== prepared.canonicalHash
      ) {
        fail(TIMELINE_ERROR_CODES.rebuildFailed);
      }
      if (beforeCommit !== null) {
        await beforeCommit();
      }
      throwIfAborted(prepared.signal, TIMELINE_ERROR_CODES.rebuildFailed);
      await client.query('COMMIT');
      committed = true;
      const result = Object.freeze({
        session_id: prepared.sessionId,
        received_count: prepared.sorted.length,
        inserted_count: prepared.sorted.length,
        replayed_count: 0,
        conflict_count: 0,
        session_count: 1,
        checkpoint_updated: false,
        batch_hash: recordsBatchHash(prepared.sorted),
        canonical_hash: persisted.canonicalHash,
        source_count: prepared.sorted.length,
        item_count: persisted.itemCount,
        canonical_timeline_hash: persisted.canonicalHash,
      });
      if (afterCommit !== null) {
        try {
          await afterCommit();
        } catch {
          fail(TIMELINE_ERROR_CODES.rebuildFailed);
        }
      }
      return result;
    } catch (error) {
      if (!committed) {
        await rollbackQuietly(client);
      }
      throw mapStorageError(error, { rebuilding: true });
    } finally {
      releaseQuietly(client);
    }
  }

  return Object.freeze({
    enabled,
    batchSize: configuredBatchSize,
    projectBatch,
    projectOne,
    listTimelineItems,
    getProjectionCheckpoint,
    checkRebuildSession,
    rebuildSession,
  });
}

export const createConversationTimelineProjector = createTimelineProjector;

export function createTimelineProjectorWorker(options = {}) {
  options = plainRecordSnapshot(options);
  const {
    sourceAdapter,
    projector,
    batchSize = DEFAULT_BATCH_SIZE,
  } = options;
  const configuredBatchSize = boundedInteger(batchSize, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  let adapterReadBatch;
  let adapterSourceStream;
  let projectorProjectBatch;
  try {
    adapterReadBatch = dataPropertyFromPrototypeChain(
      sourceAdapter,
      'readBatch',
      TIMELINE_ERROR_CODES.sourceInvalid,
    );
    adapterSourceStream = dataPropertyFromPrototypeChain(
      sourceAdapter,
      'sourceStream',
      TIMELINE_ERROR_CODES.sourceInvalid,
    );
    projectorProjectBatch = dataPropertyFromPrototypeChain(
      projector,
      'projectBatch',
      TIMELINE_ERROR_CODES.sourceInvalid,
    );
  } catch {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  if (typeof adapterReadBatch !== 'function' || typeof projectorProjectBatch !== 'function') {
    fail(TIMELINE_ERROR_CODES.sourceInvalid);
  }
  adapterSourceStream = contractIdentifier(
    adapterSourceStream,
    128,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
  );

  async function runOnce(runOptions = {}) {
    runOptions = plainRecordSnapshot(runOptions);
    const projectorName = timelineProjectorName(
      runOptions.projectorName ?? DEFAULT_PROJECTOR_NAME,
    );
    const projectorVersion = contractIdentifier(
      runOptions.projectorVersion ?? DEFAULT_PROJECTOR_VERSION,
      64,
      /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u,
    );
    const sourceStream = contractIdentifier(
      runOptions.sourceStream ?? adapterSourceStream,
      128,
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u,
    );
    const cursorValue = runOptions.cursorValue ?? null;
    const expectedCheckpoint = runOptions.expectedCheckpoint;
    const signal = runOptions.signal;
    throwIfAborted(signal);
    let batch;
    try {
      batch = await adapterReadBatch.call(sourceAdapter, {
        cursorValue,
        limit: configuredBatchSize,
        batchSize: configuredBatchSize,
        signal,
        projectorName,
        projectorVersion,
        sourceStream,
      });
    } catch (error) {
      throw mapStorageError(error);
    }
    throwIfAborted(signal);
    batch = plainRecordSnapshot(batch);
    const records = plainArrayValues(batch.records, configuredBatchSize);
    if (records.length === 0) {
      const nextCursor = batch.next_cursor_value ?? batch.cursor_value ?? cursorValue;
      return Object.freeze({
        done: true,
        exhausted: true,
        cursor_value: nextCursor,
        next_cursor_value: nextCursor,
        stats: null,
      });
    }
    const nextCursor = batch.next_cursor_value ?? batch.cursor_value ?? null;
    const exhausted = batch.exhausted === true || batch.done === true;
    let stats;
    try {
      stats = await projectorProjectBatch.call(projector, {
        projectorName,
        projectorVersion,
        sourceStream,
        records,
        cursorValue: nextCursor,
        expectedCheckpoint,
        signal,
      });
    } catch (error) {
      throw mapStorageError(error);
    }
    stats = plainRecordSnapshot(stats);
    return Object.freeze({
      done: exhausted,
      exhausted,
      cursor_value: nextCursor,
      next_cursor_value: nextCursor,
      stats,
    });
  }

  async function run(options = {}) {
    options = plainRecordSnapshot(options);
    let cursorValue = options.cursorValue ?? null;
    let batches = 0;
    let received = 0;
    let inserted = 0;
    let replayed = 0;
    while (true) {
      throwIfAborted(options.signal);
      const outcome = await runOnce({ ...options, cursorValue });
      batches += outcome.stats === null ? 0 : 1;
      received += outcome.stats?.received_count ?? 0;
      inserted += outcome.stats?.inserted_count ?? 0;
      replayed += outcome.stats?.replayed_count ?? 0;
      cursorValue = outcome.cursor_value;
      if (outcome.done || outcome.stats === null) {
        return Object.freeze({
          batch_count: batches,
          received_count: received,
          inserted_count: inserted,
          replayed_count: replayed,
          cursor_value: cursorValue,
          exhausted: true,
          checkpoint: null,
        });
      }
    }
  }

  return Object.freeze({ batchSize: configuredBatchSize, runOnce, run });
}

export const createConversationTimelineProjectorWorker = createTimelineProjectorWorker;

async function queryReadOnlySession(client, sessionId, signal) {
  throwIfAborted(signal);
  const result = await client.query(
    'SELECT id::text, service_intake_id::text FROM conversation.session WHERE id = $1::uuid',
    [sessionId],
  );
  if (result.rowCount !== 1) {
    fail(TIMELINE_ERROR_CODES.sessionNotFound);
  }
  return result.rows[0];
}

export function createP1TimelineSourceAdapter(options = {}) {
  options = plainRecordSnapshot(options);
  const {
    pool,
    projectorName = DEFAULT_PROJECTOR_NAME,
    projectorVersion = DEFAULT_PROJECTOR_VERSION,
  } = options;
  assertPool(pool, { transaction: true });
  const normalizedProjectorName = timelineProjectorName(projectorName);
  const normalizedProjectorVersion = contractIdentifier(
    projectorVersion,
    64,
    /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u,
  );

  async function readSessionRecords(readOptions = {}) {
    readOptions = plainRecordSnapshot(readOptions);
    const { sessionId, session_id, signal } = readOptions;
    const normalizedSessionId = requiredUuid(sessionId ?? session_id);
    throwIfAborted(signal);
    const client = await connectPool(pool, TIMELINE_ERROR_CODES.storageFailed);
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '60s'");
      const session = await queryReadOnlySession(client, normalizedSessionId, signal);
      if (session.service_intake_id === null) {
        await client.query('COMMIT');
        return Object.freeze([]);
      }
      const context = {
        projectorName: normalizedProjectorName,
        projectorVersion: normalizedProjectorVersion,
        sessionId: normalizedSessionId,
      };
      const channelRows = await client.query(
        `SELECT message.id::text, message.msg_type, message.clean_text,
                message.received_at, message.privacy_class,
                message.retention_until, relation.relation_type,
                relation.sequence_no
           FROM intake.service_intake_message AS relation
           JOIN channel.message_inbox AS message
             ON message.id = relation.channel_message_id
          WHERE relation.intake_id = $1::uuid
          ORDER BY relation.sequence_no, message.id`,
        [session.service_intake_id],
      );
      throwIfAborted(signal);
      const ticketRows = await client.query(
        `SELECT event.event_id::text, event.event_type, event.old_status,
                event.new_status, event.aggregate_version::text,
                event.event_ordinal::text, event.internal_note,
                event.external_note, event.reason_code, event.created_at,
                intake.privacy_class, intake.retention_until
           FROM pilot_ticket.ticket_event AS event
           JOIN pilot_ticket.ticket AS ticket ON ticket.id = event.ticket_id
           JOIN intake.service_intake AS intake ON intake.id = ticket.source_intake_id
          WHERE ticket.source_intake_id = $1::uuid
          ORDER BY event.event_ordinal, event.event_id`,
        [session.service_intake_id],
      );
      throwIfAborted(signal);
      const deliveryRows = await client.query(
        `SELECT delivery.id::text AS delivery_id, delivery.channel,
                attempt.attempt_no::text, attempt.outcome,
                attempt.error_code, attempt.occurred_at,
                intake.privacy_class, intake.retention_until
           FROM notification.delivery_attempt AS attempt
           JOIN notification.delivery AS delivery ON delivery.id = attempt.delivery_id
           JOIN notification.outbox AS outbox ON outbox.id = delivery.outbox_id
           JOIN pilot_ticket.ticket AS ticket ON ticket.id = outbox.ticket_id
           JOIN intake.service_intake AS intake ON intake.id = ticket.source_intake_id
          WHERE ticket.source_intake_id = $1::uuid
          ORDER BY attempt.occurred_at, delivery.id, attempt.attempt_no`,
        [session.service_intake_id],
      );
      const records = [
        ...channelRows.rows.map((row) => mapChannelMessageTimelineSource(row, {
          ...context,
          sourceStream: 'channel.message_inbox',
        })),
        ...ticketRows.rows.flatMap((row) => mapTicketEventTimelineSources(row, {
          ...context,
          sourceStream: 'pilot_ticket.ticket_event',
        })),
        ...deliveryRows.rows.map((row) => mapNotificationDeliveryTimelineSource(row, {
          ...context,
          sourceStream: 'notification.delivery_attempt',
        })),
      ].sort(compareTimelineSourceRecords);
      throwIfAborted(signal);
      await client.query('COMMIT');
      return Object.freeze(records);
    } catch (error) {
      await rollbackQuietly(client);
      throw mapStorageError(error);
    } finally {
      releaseQuietly(client);
    }
  }

  return Object.freeze({
    sourceStream: 'P1_SESSION_TIMELINE',
    readSessionRecords,
  });
}
