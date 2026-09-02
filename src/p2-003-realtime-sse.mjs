import { types as utilTypes } from 'node:util';

import * as realtimeEventLog from './p2-003-realtime-event-log.mjs';

const MAX_POSTGRES_BIGINT = '9223372036854775807';
const REALTIME_PATH = '/api/realtime/events';
const REALTIME_SCOPE = 'workbench';
const REALTIME_STREAM_NAME = 'CONVERSATION_WORKBENCH';
const SAFE_JSON_MAX_BYTES = realtimeEventLog.REALTIME_SAFE_JSON_LIMITS.maximum_canonical_bytes;

export const REALTIME_SSE_EVENT_TYPES = realtimeEventLog.REALTIME_EVENT_TYPES;

export const REALTIME_SSE_AGGREGATE_TYPES = realtimeEventLog.REALTIME_AGGREGATE_TYPES;

export const REALTIME_SSE_DEFAULTS = Object.freeze({
  maxClients: 32,
  heartbeatMs: 20_000,
  recoveryPollMs: 5_000,
  replayBatchSize: 50,
  maxWritableBufferBytes: 65_536,
  drainTimeoutMs: 5_000,
});

export const REALTIME_SSE_ERROR_CODES = Object.freeze({
  disabled: 'CONVERSATION_REALTIME_DISABLED',
  eventInvalid: 'CONVERSATION_REALTIME_EVENT_INVALID',
  cursorInvalid: 'CONVERSATION_REALTIME_CURSOR_INVALID',
  cursorAhead: 'CONVERSATION_REALTIME_CURSOR_AHEAD',
  replayGap: 'CONVERSATION_REALTIME_REPLAY_GAP',
  unauthenticated: 'CONVERSATION_REALTIME_UNAUTHENTICATED',
  forbidden: 'CONVERSATION_REALTIME_FORBIDDEN',
  capacityReached: 'CONVERSATION_REALTIME_CAPACITY_REACHED',
  slowClient: 'CONVERSATION_REALTIME_SLOW_CLIENT',
  storageFailed: 'CONVERSATION_REALTIME_STORAGE_FAILED',
});

const ERROR_CODE_SET = new Set(Object.values(REALTIME_SSE_ERROR_CODES));
const FALLBACK_REASONS = new Set([
  'SSE_DISABLED',
  'CAPACITY_REACHED',
  'REPLAY_GAP',
  'TEMPORARY_UNAVAILABLE',
]);
const FALLBACK_STRATEGIES = new Set([
  'REFETCH_CONVERSATION_LIST_AND_TIMELINE',
  'POLL_UNTIL_SSE_AVAILABLE',
]);

export class RealtimeSseError extends Error {
  constructor(code) {
    const stableCode = ERROR_CODE_SET.has(code)
      ? code
      : REALTIME_SSE_ERROR_CODES.eventInvalid;
    super(stableCode);
    this.name = 'RealtimeSseError';
    this.code = stableCode;
  }
}

function fail(code) {
  throw new RealtimeSseError(code);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  try {
    if (utilTypes.isProxy(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownData(value, key) {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function methodOf(value, names) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return null;
  }
  for (const name of names) {
    try {
      let current = value;
      for (let depth = 0; current !== null && depth < 8; depth += 1) {
        if (utilTypes.isProxy(current)) {
          return null;
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (descriptor !== undefined) {
          return Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function'
            ? descriptor.value
            : null;
        }
        current = Object.getPrototypeOf(current);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function boundedInteger(value, fallback, { minimum = 1, maximum } = {}) {
  const candidate = value === undefined ? fallback : value;
  if (
    !Number.isSafeInteger(candidate)
    || candidate < minimum
    || candidate > maximum
  ) {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  return candidate;
}

function compareCanonicalBigints(left, right) {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalEventId(value, code = REALTIME_SSE_ERROR_CODES.cursorInvalid) {
  if (
    typeof value !== 'string'
    || !/^(0|[1-9][0-9]*)$/u.test(value)
    || value.length > MAX_POSTGRES_BIGINT.length
    || (value.length === MAX_POSTGRES_BIGINT.length && value > MAX_POSTGRES_BIGINT)
  ) {
    fail(code);
  }
  return value;
}

export function parseRealtimeLastEventId(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    fail(REALTIME_SSE_ERROR_CODES.cursorInvalid);
  }
  return canonicalEventId(value);
}

export const parseLastEventId = parseRealtimeLastEventId;

export function normalizeRealtimeAuthorization(value) {
  if (!isPlainRecord(value)) {
    fail(REALTIME_SSE_ERROR_CODES.forbidden);
  }
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowedKeys = new Set([
      'allowed_session_ids',
      'allowedSessionIds',
      'allowed_thread_ids',
      'allowedThreadIds',
      'allow_system_events',
      'allowSystemEvents',
      'allow_restricted_admin',
      'allowRestrictedAdmin',
    ]);
    if (
      keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))
      || keys.some((key) => {
        const descriptor = descriptors[key];
        return !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true;
      })
    ) {
      fail(REALTIME_SSE_ERROR_CODES.forbidden);
    }
  } catch (error) {
    if (error instanceof RealtimeSseError) {
      throw error;
    }
    fail(REALTIME_SSE_ERROR_CODES.forbidden);
  }

  function aliasedValue(snakeName, camelName) {
    const hasSnake = Object.hasOwn(descriptors, snakeName);
    const hasCamel = Object.hasOwn(descriptors, camelName);
    if (hasSnake && hasCamel) {
      fail(REALTIME_SSE_ERROR_CODES.forbidden);
    }
    return hasSnake
      ? descriptors[snakeName].value
      : hasCamel
        ? descriptors[camelName].value
        : undefined;
  }

  try {
    return realtimeEventLog.normalizeRealtimeAuthorization({
      allowed_session_ids: aliasedValue('allowed_session_ids', 'allowedSessionIds'),
      allowed_thread_ids: aliasedValue('allowed_thread_ids', 'allowedThreadIds'),
      allow_system_events: aliasedValue('allow_system_events', 'allowSystemEvents'),
      allow_restricted_admin: aliasedValue('allow_restricted_admin', 'allowRestrictedAdmin'),
    });
  } catch {
    fail(REALTIME_SSE_ERROR_CODES.forbidden);
  }
}

export function buildRealtimeFallback({
  reason,
  pollAfterMs,
  strategy,
  latestEventId = null,
  retentionFloorEventId = null,
} = {}) {
  if (!FALLBACK_REASONS.has(reason) || !FALLBACK_STRATEGIES.has(strategy)) {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  const normalizedPollAfterMs = boundedInteger(
    pollAfterMs,
    REALTIME_SSE_DEFAULTS.recoveryPollMs,
    { minimum: 1_000, maximum: 300_000 },
  );
  return Object.freeze({
    fallback_required: true,
    reason,
    poll_after_ms: normalizedPollAfterMs,
    strategy,
    latest_event_id: latestEventId === null ? null : canonicalEventId(latestEventId),
    retention_floor_event_id: retentionFloorEventId === null
      ? null
      : canonicalEventId(retentionFloorEventId),
  });
}

function publicEventView(value) {
  if (!isPlainRecord(value)) {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  let event;
  try {
    event = realtimeEventLog.publicRealtimeEventFromRow({
      event_id: ownData(value, 'event_id') ?? ownData(value, 'eventId'),
      event_type: ownData(value, 'event_type') ?? ownData(value, 'eventType'),
      aggregate_type: ownData(value, 'aggregate_type') ?? ownData(value, 'aggregateType'),
      aggregate_id: ownData(value, 'aggregate_id') ?? ownData(value, 'aggregateId'),
      aggregate_version: ownData(value, 'aggregate_version')
        ?? ownData(value, 'aggregateVersion')
        ?? null,
      visibility_scope: ownData(value, 'visibility_scope')
        ?? ownData(value, 'visibilityScope'),
      payload: ownData(value, 'payload'),
      occurred_at: ownData(value, 'occurred_at') ?? ownData(value, 'occurredAt'),
      created_at: ownData(value, 'created_at') ?? ownData(value, 'createdAt'),
    });
  } catch {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  const canonicalPayload = JSON.stringify(event.payload);
  if (Buffer.byteLength(canonicalPayload, 'utf8') > SAFE_JSON_MAX_BYTES) {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  return event;
}

export function encodeRealtimeSseEvent(value) {
  const event = publicEventView(value);
  const data = JSON.stringify(event);
  if (/[\r\n]/u.test(data)) {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  return `id: ${event.event_id}\nevent: ${event.event_type}\ndata: ${data}\n\n`;
}

export const encodeRealtimeSseFrame = encodeRealtimeSseEvent;

export function encodeRealtimeHeartbeat() {
  return ': heartbeat\n\n';
}

export const encodeRealtimeSseHeartbeat = encodeRealtimeHeartbeat;

export function createRealtimeWakeupHub({ maxClients = REALTIME_SSE_DEFAULTS.maxClients } = {}) {
  const configuredMaxClients = boundedInteger(
    maxClients,
    REALTIME_SSE_DEFAULTS.maxClients,
    { maximum: REALTIME_SSE_DEFAULTS.maxClients },
  );
  const subscribers = new Map();
  let nextSubscriberId = 1;
  let peakClients = 0;
  let closed = false;

  function trySubscribe(onWakeup) {
    if (closed || typeof onWakeup !== 'function' || subscribers.size >= configuredMaxClients) {
      return null;
    }
    const subscriberId = nextSubscriberId;
    nextSubscriberId += 1;
    subscribers.set(subscriberId, onWakeup);
    peakClients = Math.max(peakClients, subscribers.size);
    let released = false;
    return Object.freeze({
      release() {
        if (!released) {
          released = true;
          subscribers.delete(subscriberId);
        }
      },
    });
  }

  function subscribe(onWakeup) {
    const lease = trySubscribe(onWakeup);
    if (lease === null) {
      fail(REALTIME_SSE_ERROR_CODES.capacityReached);
    }
    return lease;
  }

  function wakeup() {
    if (closed) {
      return Object.freeze({ notified_count: 0, active_clients: 0 });
    }
    let notified = 0;
    for (const listener of [...subscribers.values()]) {
      try {
        listener();
        notified += 1;
      } catch {
        // A wakeup is an optimization. One faulty subscriber cannot block peers.
      }
    }
    return Object.freeze({ notified_count: notified, active_clients: subscribers.size });
  }

  function snapshot() {
    return Object.freeze({
      max_clients: configuredMaxClients,
      active_clients: subscribers.size,
      peak_clients: peakClients,
      closed,
    });
  }

  function close() {
    closed = true;
    subscribers.clear();
    return snapshot();
  }

  return Object.freeze({
    maxClients: configuredMaxClients,
    trySubscribe,
    subscribe,
    wakeup,
    notify: wakeup,
    publish: wakeup,
    snapshot,
    close,
  });
}

function stableErrorCode(error, fallback = REALTIME_SSE_ERROR_CODES.storageFailed) {
  if (error instanceof RealtimeSseError && ERROR_CODE_SET.has(error.code)) {
    return error.code;
  }
  try {
    if (
      error === null
      || (typeof error !== 'object' && typeof error !== 'function')
      || utilTypes.isProxy(error)
    ) {
      return fallback;
    }
    let current = error;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (utilTypes.isProxy(current)) {
        return fallback;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, 'code');
      if (descriptor !== undefined) {
        const code = Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
        return typeof code === 'string' && ERROR_CODE_SET.has(code) ? code : fallback;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function errorEnvelope(code, { retryable = false, fallback = undefined } = {}) {
  const body = {
    ok: false,
    error: Object.freeze({ code, retryable }),
  };
  if (fallback !== undefined) {
    body.fallback = fallback;
  }
  return Object.freeze(body);
}

function writeJsonResponse(response, status, body, headers = {}) {
  try {
    if (response.destroyed || response.writableEnded || response.headersSent) {
      return false;
    }
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    });
    response.end(JSON.stringify(body));
    return true;
  } catch {
    try {
      response.destroy();
    } catch {
      // The peer is already gone.
    }
    return false;
  }
}

function writeErrorResponse(response, status, code, retryable = false, headers = {}) {
  return writeJsonResponse(response, status, errorEnvelope(code, { retryable }), headers);
}

function writeFallbackResponse(response, {
  status,
  code,
  reason,
  strategy,
  pollAfterMs,
  latestEventId = null,
  retentionFloorEventId = null,
}) {
  const fallback = buildRealtimeFallback({
    reason,
    pollAfterMs,
    strategy,
    latestEventId,
    retentionFloorEventId,
  });
  return writeJsonResponse(
    response,
    status,
    errorEnvelope(code, { retryable: status >= 500, fallback }),
  );
}

function normalizeReplayWindow(value) {
  if (!isPlainRecord(value)) {
    fail(REALTIME_SSE_ERROR_CODES.storageFailed);
  }
  const retentionFloorEventId = canonicalEventId(
    ownData(value, 'retention_floor_event_id')
      ?? ownData(value, 'retentionFloorEventId')
      ?? '0',
    REALTIME_SSE_ERROR_CODES.storageFailed,
  );
  const highWatermarkEventId = canonicalEventId(
    ownData(value, 'high_watermark_event_id')
      ?? ownData(value, 'highWatermarkEventId')
      ?? ownData(value, 'event_id')
      ?? retentionFloorEventId,
    REALTIME_SSE_ERROR_CODES.storageFailed,
  );
  if (compareCanonicalBigints(highWatermarkEventId, retentionFloorEventId) < 0) {
    fail(REALTIME_SSE_ERROR_CODES.storageFailed);
  }
  return Object.freeze({
    retention_floor_event_id: retentionFloorEventId,
    high_watermark_event_id: highWatermarkEventId,
  });
}

function normalizeReplayPage(value, afterEventId, limit) {
  if (!isPlainRecord(value)) {
    fail(REALTIME_SSE_ERROR_CODES.storageFailed);
  }
  const rawEvents = ownData(value, 'events');
  if (!Array.isArray(rawEvents) || rawEvents.length > limit) {
    fail(REALTIME_SSE_ERROR_CODES.storageFailed);
  }
  const events = [];
  let previousEventId = afterEventId;
  for (const rawEvent of rawEvents) {
    const event = publicEventView(rawEvent);
    if (compareCanonicalBigints(event.event_id, previousEventId) <= 0) {
      fail(REALTIME_SSE_ERROR_CODES.storageFailed);
    }
    previousEventId = event.event_id;
    events.push(event);
  }
  let nextAfterEventId = ownData(value, 'next_after_event_id')
    ?? ownData(value, 'nextAfterEventId')
    ?? (events.at(-1)?.event_id ?? afterEventId);
  nextAfterEventId = canonicalEventId(
    nextAfterEventId,
    REALTIME_SSE_ERROR_CODES.storageFailed,
  );
  if (
    compareCanonicalBigints(nextAfterEventId, afterEventId) < 0
    || (events.length > 0 && compareCanonicalBigints(nextAfterEventId, events.at(-1).event_id) < 0)
  ) {
    fail(REALTIME_SSE_ERROR_CODES.storageFailed);
  }
  const floor = ownData(value, 'retention_floor_event_id')
    ?? ownData(value, 'retentionFloorEventId')
    ?? null;
  if (
    floor !== null
    && compareCanonicalBigints(
      afterEventId,
      canonicalEventId(floor, REALTIME_SSE_ERROR_CODES.storageFailed),
    ) < 0
  ) {
    fail(REALTIME_SSE_ERROR_CODES.replayGap);
  }
  return Object.freeze({
    events: Object.freeze(events),
    next_after_event_id: nextAfterEventId,
  });
}

function createReplayReader({ eventStore, pool }) {
  const store = eventStore ?? realtimeEventLog;
  const getWindow = methodOf(store, [
    'getRealtimeReplayWindow',
    'getReplayWindow',
    'replayWindow',
  ]) ?? methodOf(realtimeEventLog, ['getRealtimeReplayWindow']);
  const listEvents = methodOf(store, [
    'listAuthorizedRealtimeEvents',
    'listAuthorizedEvents',
    'listRealtimeEvents',
  ]) ?? methodOf(realtimeEventLog, ['listAuthorizedRealtimeEvents']);
  if (typeof getWindow !== 'function' || typeof listEvents !== 'function') {
    fail(REALTIME_SSE_ERROR_CODES.storageFailed);
  }
  return Object.freeze({
    async getWindow({ streamName, signal }) {
      try {
        const value = await getWindow.call(store, { pool, streamName, signal });
        return normalizeReplayWindow(value);
      } catch (error) {
        throw new RealtimeSseError(stableErrorCode(error));
      }
    },
    async listEvents({ streamName, afterEventId, limit, authorization, signal }) {
      try {
        const value = await listEvents.call(store, {
          pool,
          streamName,
          afterEventId,
          limit,
          authorization,
          signal,
        });
        return normalizeReplayPage(value, afterEventId, limit);
      } catch (error) {
        throw new RealtimeSseError(stableErrorCode(error));
      }
    },
  });
}

function safeWritableLength(response) {
  try {
    const length = response.writableLength;
    return Number.isSafeInteger(length) && length >= 0 ? length : 0;
  } catch {
    return 0;
  }
}

function listenerMethod(target, name) {
  const method = methodOf(target, [name]);
  return typeof method === 'function' ? method.bind(target) : null;
}

function connectionIsClosed(request, response) {
  try {
    return request?.aborted === true
      || request?.destroyed === true
      || response?.destroyed === true
      || response?.writableEnded === true;
  } catch {
    return true;
  }
}

function ignoreFailure(operation) {
  try {
    operation();
  } catch {
    // Cleanup and observability paths must remain failure-isolated.
  }
}

function waitForDrain(state) {
  const { response, configuration, metrics } = state;
  const once = listenerMethod(response, 'once');
  const off = listenerMethod(response, 'off') ?? listenerMethod(response, 'removeListener');
  if (once === null || off === null) {
    return Promise.reject(new RealtimeSseError(REALTIME_SSE_ERROR_CODES.slowClient));
  }
  metrics.active_drain_waiters += 1;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let timerActive = false;
    const settle = (outcome, error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timerActive) {
        timerActive = false;
        ignoreFailure(() => configuration.clearTimeoutFn(timer));
      }
      ignoreFailure(() => off('drain', onDrain));
      ignoreFailure(() => off('close', onClose));
      ignoreFailure(() => off('error', onClose));
      metrics.active_drain_waiters -= 1;
      state.cancelDrain = null;
      if (error) {
        reject(error);
      } else {
        resolve(outcome);
      }
    };
    const onDrain = () => settle(true);
    const onClose = () => settle(false);
    state.cancelDrain = () => settle(false);
    try {
      once('drain', onDrain);
      if (settled) return;
      once('close', onClose);
      if (settled) return;
      once('error', onClose);
      if (settled) return;
      timer = configuration.setTimeoutFn(
        () => settle(false, new RealtimeSseError(REALTIME_SSE_ERROR_CODES.slowClient)),
        configuration.drainTimeoutMs,
      );
      timerActive = true;
      if (settled) {
        timerActive = false;
        ignoreFailure(() => configuration.clearTimeoutFn(timer));
        return;
      }
      const unref = methodOf(timer, ['unref']);
      if (unref) {
        ignoreFailure(() => unref.call(timer));
      }
    } catch {
      settle(false, new RealtimeSseError(REALTIME_SSE_ERROR_CODES.slowClient));
    }
  });
}

async function writeSseFrame(state, frame) {
  if (
    state.closed
    || state.response.destroyed
    || state.response.writableEnded
  ) {
    return false;
  }
  let accepted;
  try {
    accepted = state.response.write(frame);
  } catch {
    return false;
  }
  const writableLength = safeWritableLength(state.response);
  state.metrics.max_writable_length = Math.max(
    state.metrics.max_writable_length,
    writableLength,
  );
  if (writableLength > state.configuration.maxWritableBufferBytes) {
    throw new RealtimeSseError(REALTIME_SSE_ERROR_CODES.slowClient);
  }
  if (accepted !== false) {
    return true;
  }
  const drained = await waitForDrain(state);
  if (!drained || state.closed) {
    return false;
  }
  const afterDrainLength = safeWritableLength(state.response);
  state.metrics.max_writable_length = Math.max(
    state.metrics.max_writable_length,
    afterDrainLength,
  );
  if (afterDrainLength > state.configuration.maxWritableBufferBytes) {
    throw new RealtimeSseError(REALTIME_SSE_ERROR_CODES.slowClient);
  }
  return true;
}

function createMetrics(maxClients) {
  return {
    max_clients: maxClients,
    active_clients: 0,
    peak_clients: 0,
    accepted_client_count: 0,
    capacity_rejection_count: 0,
    replay_query_batch_count: 0,
    delivered_event_count: 0,
    heartbeat_count: 0,
    max_writable_length: 0,
    slow_client_disconnect_count: 0,
    storage_disconnect_count: 0,
    active_heartbeat_timers: 0,
    active_recovery_timers: 0,
    active_drain_waiters: 0,
    open_streams: 0,
  };
}

function frozenMetrics(metrics) {
  return Object.freeze({
    max_clients: metrics.max_clients,
    active_clients: metrics.active_clients,
    peak_clients: metrics.peak_clients,
    accepted_client_count: metrics.accepted_client_count,
    capacity_rejection_count: metrics.capacity_rejection_count,
    replay_query_batch_count: metrics.replay_query_batch_count,
    delivered_event_count: metrics.delivered_event_count,
    heartbeat_count: metrics.heartbeat_count,
    max_writable_length: metrics.max_writable_length,
    slow_client_disconnect_count: metrics.slow_client_disconnect_count,
    storage_disconnect_count: metrics.storage_disconnect_count,
    active_heartbeat_timers: metrics.active_heartbeat_timers,
    active_recovery_timers: metrics.active_recovery_timers,
    active_drain_waiters: metrics.active_drain_waiters,
    open_streams: metrics.open_streams,
  });
}

function safeMetric(onMetric, event, metrics, errorCode = null) {
  if (typeof onMetric !== 'function') {
    return;
  }
  try {
    onMetric(Object.freeze({
      event,
      error_code: errorCode,
      ...frozenMetrics(metrics),
    }));
  } catch {
    // Operational metrics cannot affect a realtime stream.
  }
}

function timerFunction(options, key, fallback) {
  const candidate = ownData(options, key);
  if (candidate === undefined) {
    return fallback;
  }
  if (typeof candidate !== 'function') {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  return candidate;
}

function normalizeHandlerConfiguration(options) {
  if (!isPlainRecord(options)) {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  const enabled = ownData(options, 'enabled') ?? false;
  const refreshAuthorization = ownData(options, 'refreshAuthorization') ?? false;
  if (typeof enabled !== 'boolean' || typeof refreshAuthorization !== 'boolean') {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  return Object.freeze({
    enabled,
    refreshAuthorization,
    maxClients: boundedInteger(
      ownData(options, 'maxClients'),
      REALTIME_SSE_DEFAULTS.maxClients,
      { maximum: REALTIME_SSE_DEFAULTS.maxClients },
    ),
    heartbeatMs: boundedInteger(
      ownData(options, 'heartbeatMs'),
      REALTIME_SSE_DEFAULTS.heartbeatMs,
      { maximum: 300_000 },
    ),
    recoveryPollMs: boundedInteger(
      ownData(options, 'recoveryPollMs'),
      REALTIME_SSE_DEFAULTS.recoveryPollMs,
      { maximum: 300_000 },
    ),
    replayBatchSize: boundedInteger(
      ownData(options, 'replayBatchSize'),
      REALTIME_SSE_DEFAULTS.replayBatchSize,
      { maximum: 200 },
    ),
    maxWritableBufferBytes: boundedInteger(
      ownData(options, 'maxWritableBufferBytes'),
      REALTIME_SSE_DEFAULTS.maxWritableBufferBytes,
      { maximum: 1_048_576 },
    ),
    drainTimeoutMs: boundedInteger(
      ownData(options, 'drainTimeoutMs'),
      REALTIME_SSE_DEFAULTS.drainTimeoutMs,
      { maximum: 300_000 },
    ),
    setIntervalFn: timerFunction(options, 'setIntervalFn', setInterval),
    clearIntervalFn: timerFunction(options, 'clearIntervalFn', clearInterval),
    setTimeoutFn: timerFunction(options, 'setTimeoutFn', setTimeout),
    clearTimeoutFn: timerFunction(options, 'clearTimeoutFn', clearTimeout),
    queueMicrotaskFn: timerFunction(options, 'queueMicrotaskFn', queueMicrotask),
  });
}

function requestHeader(request, name) {
  try {
    const headers = request.headers;
    if (headers === null || typeof headers !== 'object' || utilTypes.isProxy(headers)) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(headers, name);
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function principalIsPresent(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !utilTypes.isProxy(value);
}

function configureSseHeaders(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  if (typeof response.flushHeaders === 'function') {
    response.flushHeaders();
  }
}

export function createRealtimeSseHandler(options = {}) {
  const configuration = normalizeHandlerConfiguration(options);
  const pool = ownData(options, 'pool');
  const eventStore = ownData(options, 'eventStore');
  const authenticate = ownData(options, 'authenticate');
  const authorize = ownData(options, 'authorize');
  const suppliedHub = ownData(options, 'wakeupHub');
  const onMetric = ownData(options, 'onMetric') ?? ownData(options, 'recordMetric') ?? null;
  if (
    authenticate !== undefined && typeof authenticate !== 'function'
    || authorize !== undefined && typeof authorize !== 'function'
    || onMetric !== null && typeof onMetric !== 'function'
  ) {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  const authenticateRequest = authenticate ?? (async () => null);
  const authorizePrincipal = authorize ?? (async () => null);
  const wakeupHub = suppliedHub ?? createRealtimeWakeupHub({
    maxClients: configuration.maxClients,
  });
  const ownsWakeupHub = suppliedHub === undefined;
  const hubTrySubscribe = methodOf(wakeupHub, ['trySubscribe']);
  const hubWakeup = methodOf(wakeupHub, ['wakeup', 'notify', 'publish']);
  const hubSnapshot = methodOf(wakeupHub, ['snapshot']);
  const hubClose = methodOf(wakeupHub, ['close']);
  const hubMaximum = ownData(wakeupHub, 'maxClients')
    ?? ownData(wakeupHub, 'max_clients')
    ?? methodOf(wakeupHub, ['getMaxClients'])?.call(wakeupHub);
  if (
    typeof hubTrySubscribe !== 'function'
    || typeof hubWakeup !== 'function'
    || hubMaximum !== configuration.maxClients
  ) {
    fail(REALTIME_SSE_ERROR_CODES.eventInvalid);
  }
  const replayReader = configuration.enabled
    ? createReplayReader({ eventStore, pool })
    : null;
  const metrics = createMetrics(configuration.maxClients);
  const streams = new Set();
  let handlerClosed = false;

  function getMetrics() {
    return frozenMetrics(metrics);
  }

  function emitMetric(event, errorCode = null) {
    safeMetric(onMetric, event, metrics, errorCode);
  }

  function cleanupStream(state, { destroy = false, errorCode = null } = {}) {
    if (state.closed) {
      return;
    }
    state.closed = true;
    state.streaming = false;
    ignoreFailure(() => state.abortController.abort());
    if (state.cancelDrain) {
      ignoreFailure(() => state.cancelDrain());
    }
    if (state.heartbeatTimerActive) {
      state.heartbeatTimerActive = false;
      metrics.active_heartbeat_timers -= 1;
      ignoreFailure(() => configuration.clearIntervalFn(state.heartbeatTimer));
    }
    if (state.recoveryTimerActive) {
      state.recoveryTimerActive = false;
      metrics.active_recovery_timers -= 1;
      ignoreFailure(() => configuration.clearIntervalFn(state.recoveryTimer));
    }
    if (state.responseOff) {
      ignoreFailure(() => state.responseOff('close', state.onResponseClose));
      ignoreFailure(() => state.responseOff('error', state.onResponseClose));
    }
    if (state.requestOff) {
      ignoreFailure(() => state.requestOff('aborted', state.onRequestAborted));
    }
    const release = methodOf(state.lease, ['release']);
    if (release) {
      ignoreFailure(() => release.call(state.lease));
    }
    streams.delete(state);
    metrics.active_clients -= 1;
    metrics.open_streams -= 1;
    if (destroy) {
      ignoreFailure(() => {
        if (!state.response.destroyed) {
          state.response.destroy();
        }
      });
    }
    ignoreFailure(() => state.resolveClosed());
    emitMetric('realtime_client_closed', errorCode);
  }

  async function replayAvailable(state) {
    if (state.configuration.refreshAuthorization) {
      try {
        state.authorization = normalizeRealtimeAuthorization(await authorizePrincipal(state.principal, {
          request: state.request,
          scope: REALTIME_SCOPE,
        }));
      } catch (error) {
        if (error instanceof RealtimeSseError) throw error;
        throw new RealtimeSseError(REALTIME_SSE_ERROR_CODES.storageFailed);
      }
    }
    while (!state.closed) {
      const afterEventId = state.scanCursor;
      const page = await replayReader.listEvents({
        streamName: REALTIME_STREAM_NAME,
        afterEventId,
        limit: configuration.replayBatchSize,
        authorization: state.authorization,
        signal: state.abortController.signal,
      });
      metrics.replay_query_batch_count += 1;
      if (state.closed) {
        return;
      }
      for (const event of page.events) {
        if (
          event.visibility_scope === 'RESTRICTED_ADMIN'
          && state.authorization.allow_restricted_admin !== true
        ) {
          throw new RealtimeSseError(REALTIME_SSE_ERROR_CODES.storageFailed);
        }
        const written = await writeSseFrame(state, encodeRealtimeSseEvent(event));
        if (!written) {
          cleanupStream(state);
          return;
        }
        metrics.delivered_event_count += 1;
      }
      if (compareCanonicalBigints(page.next_after_event_id, afterEventId) <= 0) {
        return;
      }
      state.scanCursor = page.next_after_event_id;
    }
  }

  async function pump(state) {
    if (state.running || state.closed) {
      return;
    }
    state.running = true;
    try {
      while (!state.closed && (state.eventsDue || state.heartbeatDue)) {
        if (state.eventsDue) {
          state.eventsDue = false;
          await replayAvailable(state);
        }
        if (!state.closed && state.heartbeatDue) {
          state.heartbeatDue = false;
          const written = await writeSseFrame(state, encodeRealtimeHeartbeat());
          if (!written) {
            cleanupStream(state);
            return;
          }
          metrics.heartbeat_count += 1;
        }
      }
    } finally {
      state.running = false;
    }
  }

  function handlePumpFailure(state, error) {
    if (state.closed) {
      return;
    }
    const code = stableErrorCode(error);
    if (code === REALTIME_SSE_ERROR_CODES.slowClient) {
      metrics.slow_client_disconnect_count += 1;
    } else {
      metrics.storage_disconnect_count += 1;
    }
    cleanupStream(state, { destroy: true, errorCode: code });
  }

  function schedulePump(state) {
    if (state.closed || !state.streaming || state.scheduled || state.running) {
      return;
    }
    state.scheduled = true;
    try {
      configuration.queueMicrotaskFn(() => {
        state.scheduled = false;
        void pump(state).catch((error) => handlePumpFailure(state, error));
      });
    } catch (error) {
      state.scheduled = false;
      handlePumpFailure(state, error);
    }
  }

  function startStreamTimers(state) {
    state.heartbeatTimer = configuration.setIntervalFn(() => {
      if (!state.closed) {
        state.heartbeatDue = true;
        schedulePump(state);
      }
    }, configuration.heartbeatMs);
    state.heartbeatTimerActive = true;
    metrics.active_heartbeat_timers += 1;
    const heartbeatUnref = methodOf(state.heartbeatTimer, ['unref']);
    if (heartbeatUnref) {
      ignoreFailure(() => heartbeatUnref.call(state.heartbeatTimer));
    }
    state.recoveryTimer = configuration.setIntervalFn(() => {
      if (!state.closed) {
        state.eventsDue = true;
        schedulePump(state);
      }
    }, configuration.recoveryPollMs);
    state.recoveryTimerActive = true;
    metrics.active_recovery_timers += 1;
    const recoveryUnref = methodOf(state.recoveryTimer, ['unref']);
    if (recoveryUnref) {
      ignoreFailure(() => recoveryUnref.call(state.recoveryTimer));
    }
  }

  async function serveRealtime(request, response, url) {
    let disconnectedDuringAuthorization = connectionIsClosed(request, response);
    const onEarlyDisconnect = () => {
      disconnectedDuringAuthorization = true;
    };
    const earlyResponseOff = listenerMethod(response, 'off')
      ?? listenerMethod(response, 'removeListener');
    const earlyRequestOff = listenerMethod(request, 'off')
      ?? listenerMethod(request, 'removeListener');
    listenerMethod(response, 'once')?.('close', onEarlyDisconnect);
    listenerMethod(response, 'once')?.('error', onEarlyDisconnect);
    listenerMethod(request, 'once')?.('aborted', onEarlyDisconnect);
    const stopEarlyDisconnectWatch = () => {
      if (earlyResponseOff) {
        ignoreFailure(() => earlyResponseOff('close', onEarlyDisconnect));
        ignoreFailure(() => earlyResponseOff('error', onEarlyDisconnect));
      }
      if (earlyRequestOff) {
        ignoreFailure(() => earlyRequestOff('aborted', onEarlyDisconnect));
      }
    };
    const authorizationConnectionClosed = () => (
      disconnectedDuringAuthorization || connectionIsClosed(request, response)
    );

    let principal;
    try {
      principal = await authenticateRequest(request);
    } catch {
      principal = null;
    }
    if (authorizationConnectionClosed()) {
      stopEarlyDisconnectWatch();
      return;
    }
    if (!principalIsPresent(principal)) {
      stopEarlyDisconnectWatch();
      writeErrorResponse(response, 401, REALTIME_SSE_ERROR_CODES.unauthenticated);
      return;
    }
    const scopes = url.searchParams.getAll('scope');
    if (scopes.length > 1 || (scopes.length === 1 && scopes[0] !== REALTIME_SCOPE)) {
      stopEarlyDisconnectWatch();
      writeErrorResponse(response, 400, REALTIME_SSE_ERROR_CODES.eventInvalid);
      return;
    }
    let authorization;
    try {
      authorization = normalizeRealtimeAuthorization(await authorizePrincipal(principal, {
        request,
        scope: REALTIME_SCOPE,
      }));
    } catch {
      if (authorizationConnectionClosed()) {
        stopEarlyDisconnectWatch();
        return;
      }
      stopEarlyDisconnectWatch();
      writeErrorResponse(response, 403, REALTIME_SSE_ERROR_CODES.forbidden);
      return;
    }
    if (authorizationConnectionClosed()) {
      stopEarlyDisconnectWatch();
      return;
    }
    stopEarlyDisconnectWatch();
    let requestedCursor;
    try {
      requestedCursor = parseRealtimeLastEventId(requestHeader(request, 'last-event-id'));
    } catch {
      writeErrorResponse(response, 400, REALTIME_SSE_ERROR_CODES.cursorInvalid);
      return;
    }
    const fallbackPollMs = Math.max(1_000, configuration.recoveryPollMs);
    if (!configuration.enabled || handlerClosed) {
      writeFallbackResponse(response, {
        status: 503,
        code: REALTIME_SSE_ERROR_CODES.disabled,
        reason: 'SSE_DISABLED',
        strategy: 'POLL_UNTIL_SSE_AVAILABLE',
        pollAfterMs: fallbackPollMs,
      });
      return;
    }

    if (connectionIsClosed(request, response)) {
      return;
    }

    let state;
    const lease = hubTrySubscribe.call(wakeupHub, () => {
      if (state && !state.closed) {
        state.eventsDue = true;
        schedulePump(state);
      }
    });
    if (lease === null) {
      metrics.capacity_rejection_count += 1;
      emitMetric('realtime_capacity_reached', REALTIME_SSE_ERROR_CODES.capacityReached);
      writeFallbackResponse(response, {
        status: 503,
        code: REALTIME_SSE_ERROR_CODES.capacityReached,
        reason: 'CAPACITY_REACHED',
        strategy: 'POLL_UNTIL_SSE_AVAILABLE',
        pollAfterMs: fallbackPollMs,
      });
      return;
    }
    let resolveClosed;
    const closedPromise = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    const responseOff = listenerMethod(response, 'off')
      ?? listenerMethod(response, 'removeListener');
    const requestOff = listenerMethod(request, 'off')
      ?? listenerMethod(request, 'removeListener');
    state = {
      request,
      response,
      principal,
      authorization,
      configuration,
      metrics,
      lease,
      resolveClosed,
      responseOff,
      requestOff,
      abortController: new AbortController(),
      scanCursor: requestedCursor,
      closed: false,
      streaming: false,
      running: false,
      scheduled: false,
      eventsDue: true,
      heartbeatDue: false,
      heartbeatTimer: null,
      recoveryTimer: null,
      heartbeatTimerActive: false,
      recoveryTimerActive: false,
      onResponseClose: null,
      onRequestAborted: null,
      cancelDrain: null,
    };
    state.onResponseClose = () => cleanupStream(state);
    state.onRequestAborted = () => cleanupStream(state, { destroy: true });
    listenerMethod(response, 'once')?.('close', state.onResponseClose);
    listenerMethod(response, 'once')?.('error', state.onResponseClose);
    listenerMethod(request, 'once')?.('aborted', state.onRequestAborted);
    streams.add(state);
    metrics.active_clients += 1;
    metrics.open_streams += 1;
    metrics.accepted_client_count += 1;
    metrics.peak_clients = Math.max(metrics.peak_clients, metrics.active_clients);

    let window;
    try {
      window = await replayReader.getWindow({
        streamName: REALTIME_STREAM_NAME,
        signal: state.abortController.signal,
      });
    } catch {
      writeFallbackResponse(response, {
        status: 503,
        code: REALTIME_SSE_ERROR_CODES.storageFailed,
        reason: 'TEMPORARY_UNAVAILABLE',
        strategy: 'POLL_UNTIL_SSE_AVAILABLE',
        pollAfterMs: fallbackPollMs,
      });
      cleanupStream(state, { errorCode: REALTIME_SSE_ERROR_CODES.storageFailed });
      return;
    }
    if (state.closed) {
      return;
    }
    const cursor = requestedCursor ?? window.retention_floor_event_id;
    if (compareCanonicalBigints(cursor, window.high_watermark_event_id) > 0) {
      writeErrorResponse(response, 409, REALTIME_SSE_ERROR_CODES.cursorAhead);
      cleanupStream(state, { errorCode: REALTIME_SSE_ERROR_CODES.cursorAhead });
      return;
    }
    if (compareCanonicalBigints(cursor, window.retention_floor_event_id) < 0) {
      writeFallbackResponse(response, {
        status: 410,
        code: REALTIME_SSE_ERROR_CODES.replayGap,
        reason: 'REPLAY_GAP',
        strategy: 'REFETCH_CONVERSATION_LIST_AND_TIMELINE',
        pollAfterMs: fallbackPollMs,
        latestEventId: window.high_watermark_event_id,
        retentionFloorEventId: window.retention_floor_event_id,
      });
      cleanupStream(state, { errorCode: REALTIME_SSE_ERROR_CODES.replayGap });
      return;
    }
    state.scanCursor = cursor;
    try {
      configureSseHeaders(response);
      state.streaming = true;
      startStreamTimers(state);
      emitMetric('realtime_client_opened');
      schedulePump(state);
    } catch {
      cleanupStream(state, { destroy: true, errorCode: REALTIME_SSE_ERROR_CODES.storageFailed });
      return;
    }
    await closedPromise;
  }

  async function handler(request, response) {
    let url;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      writeErrorResponse(response, 400, REALTIME_SSE_ERROR_CODES.eventInvalid);
      return;
    }
    if (url.pathname !== REALTIME_PATH) {
      writeJsonResponse(response, 404, errorEnvelope('NOT_FOUND'));
      return;
    }
    if (request.method !== 'GET') {
      writeErrorResponse(
        response,
        405,
        REALTIME_SSE_ERROR_CODES.eventInvalid,
        false,
        { allow: 'GET' },
      );
      return;
    }
    try {
      await serveRealtime(request, response, url);
    } catch {
      if (!response.headersSent) {
        writeFallbackResponse(response, {
          status: 503,
          code: REALTIME_SSE_ERROR_CODES.storageFailed,
          reason: 'TEMPORARY_UNAVAILABLE',
          strategy: 'POLL_UNTIL_SSE_AVAILABLE',
          pollAfterMs: Math.max(1_000, configuration.recoveryPollMs),
        });
      } else {
        try {
          response.destroy();
        } catch {
          // The connection already ended.
        }
      }
    }
  }

  async function close() {
    handlerClosed = true;
    for (const state of [...streams]) {
      cleanupStream(state, { destroy: true });
    }
    if (ownsWakeupHub && hubClose) {
      ignoreFailure(() => hubClose.call(wakeupHub));
    }
    return getMetrics();
  }

  function wakeup() {
    return hubWakeup.call(wakeupHub);
  }

  function disconnectPrincipal(principalId) {
    if (typeof principalId !== 'string' || principalId.length < 1 || principalId.length > 128) {
      throw new TypeError('Realtime SSE principal disconnect configuration is invalid.');
    }
    let disconnectedCount = 0;
    for (const state of [...streams]) {
      let candidate = null;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(state.principal, 'principal_id');
        candidate = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
      } catch { candidate = null; }
      if (candidate !== principalId) continue;
      cleanupStream(state, { destroy: true });
      disconnectedCount += 1;
    }
    return Object.freeze({ disconnected_count: disconnectedCount });
  }

  Object.defineProperties(handler, {
    handle: { value: handler, enumerable: true },
    close: { value: close, enumerable: true },
    getMetrics: { value: getMetrics, enumerable: true },
    metrics: { value: getMetrics, enumerable: true },
    wakeup: { value: wakeup, enumerable: true },
    notify: { value: wakeup, enumerable: true },
    disconnectPrincipal: { value: disconnectPrincipal, enumerable: true },
    wakeupHub: { value: wakeupHub, enumerable: true },
    hubSnapshot: {
      value: () => (hubSnapshot ? hubSnapshot.call(wakeupHub) : null),
      enumerable: true,
    },
  });
  return Object.freeze(handler);
}
