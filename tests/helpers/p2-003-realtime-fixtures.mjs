import assert from 'node:assert/strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function p2003Authorization({
  sessionIds = [],
  threadIds = [],
  allowSystemEvents = false,
  allowRestrictedAdmin = false,
} = {}) {
  for (const value of [...sessionIds, ...threadIds]) {
    assert.match(value, UUID_PATTERN);
  }
  return Object.freeze({
    allowed_session_ids: Object.freeze([...sessionIds]),
    allowed_thread_ids: Object.freeze([...threadIds]),
    allow_system_events: allowSystemEvents,
    allow_restricted_admin: allowRestrictedAdmin,
  });
}

export function p2003EventCommand({
  ordinal,
  sessionId,
  threadId = sessionId,
  sourceId = `fixture.session.${ordinal}`,
  eventType = 'conversation.session.updated',
  sourceType = 'CONVERSATION_SESSION',
  aggregateType = 'CONVERSATION_SESSION',
  scopeType = 'SESSION',
  visibilityScope = 'WORKBENCH',
  payload = { state: 'OPEN', ordinal },
  occurredAt = '2026-08-31T01:00:00.000Z',
  expiresAt = '2026-09-07T01:00:00.000Z',
} = {}) {
  assert.ok(Number.isSafeInteger(ordinal) && ordinal >= 1);
  assert.match(sessionId, UUID_PATTERN);
  assert.match(threadId, UUID_PATTERN);
  const scopeId = scopeType === 'SESSION'
    ? sessionId
    : scopeType === 'THREAD'
      ? threadId
      : null;
  return {
    schema_version: 1,
    publisher_name: 'P2_003_TEST',
    publisher_version: '1',
    source_type: sourceType,
    source_id: sourceId,
    event_variant: 'PRIMARY',
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: scopeType === 'THREAD' ? threadId : sessionId,
    aggregate_version: String(ordinal),
    authorization_scope_type: scopeType,
    authorization_scope_id: scopeId,
    visibility_scope: visibilityScope,
    payload,
    occurred_at: occurredAt,
    expires_at: expiresAt,
  };
}

export async function ensureP2003StreamState(pool, floor = '0') {
  assert.match(floor, /^(?:0|[1-9][0-9]*)$/u);
  await pool.query(
    `INSERT INTO conversation.realtime_stream_state (
       stream_name, retention_floor_event_id
     ) VALUES ('CONVERSATION_WORKBENCH', $1::bigint)
     ON CONFLICT (stream_name) DO NOTHING`,
    [floor],
  );
}

export async function insertP2003MinimalEvents({
  pool,
  count,
  sessionId,
  expired = false,
  sourceOffset = 0,
}) {
  assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 10_000);
  assert.ok(Number.isSafeInteger(sourceOffset) && sourceOffset >= 0);
  assert.match(sessionId, UUID_PATTERN);
  await ensureP2003StreamState(pool);
  const result = await pool.query(
    `INSERT INTO conversation.realtime_event (
       event_key, stream_name, publisher_name, publisher_version,
       source_type, source_id, event_variant, event_type,
       aggregate_type, aggregate_id, aggregate_version,
       authorization_scope_type, authorization_scope_id, visibility_scope,
       payload, payload_hash, event_hash, occurred_at, expires_at
     )
     SELECT 'rte_v1_' || lpad(to_hex($2::bigint + ordinal), 64, '0'),
            'CONVERSATION_WORKBENCH',
            'P2_003_TEST',
            '1',
            'CONVERSATION_SESSION',
            'fixture.bulk.' || ($2::bigint + ordinal)::text,
            'PRIMARY',
            'conversation.session.updated',
            'CONVERSATION_SESSION',
            $3::text,
            ($2::bigint + ordinal),
            'SESSION',
            $3::uuid,
            'WORKBENCH',
            jsonb_build_object('ordinal', $2::bigint + ordinal),
            lpad(to_hex(100000::bigint + $2::bigint + ordinal), 64, '0'),
            lpad(to_hex(200000::bigint + $2::bigint + ordinal), 64, '0'),
            TIMESTAMPTZ '2026-08-31 01:00:00+00'
              + ordinal * INTERVAL '1 millisecond',
            CASE WHEN $4::boolean
              THEN TIMESTAMPTZ '2026-08-31 01:00:01+00'
                + ordinal * INTERVAL '1 millisecond'
              ELSE TIMESTAMPTZ '2026-09-07 01:00:00+00'
                + ordinal * INTERVAL '1 millisecond'
            END
       FROM generate_series(1, $1::integer) AS ordinal
      RETURNING event_id::text`,
    [count, sourceOffset, sessionId, expired],
  );
  const ids = result.rows.map((row) => row.event_id);
  return Object.freeze({
    inserted_count: ids.length,
    first_event_id: ids[0],
    last_event_id: ids.at(-1),
  });
}
