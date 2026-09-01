import { createHash } from 'node:crypto';

import {
  buildConversationSessionScope,
  buildConversationThreadIdentity,
} from './p2-001-conversation-contracts.mjs';
import {
  TIMELINE_ERROR_CODES,
  createTimelineProjector,
  mapChannelMessageTimelineSource,
  mapTicketEventTimelineSources,
  normalizeTimelineSourceRecord,
} from './p2-002-timeline-projector.mjs';
import {
  appendRealtimeEvent,
  mapConversationItemCreatedEvent,
} from './p2-003-realtime-event-log.mjs';
import {
  mapCommunicationDeliveryToTimelineSourceRecord,
  mapCommunicationMessageToTimelineSourceRecord,
} from './p2-004-communication-projections.mjs';
import { mapControlEventToTimelineSourceRecord } from './p2-005-conversation-control-projections.mjs';

export const P2_G1_PROJECTION_STREAMS = Object.freeze({
  channelMessage: 'CHANNEL_MESSAGE_INBOX',
  ticketEvent: 'PILOT_TICKET_EVENT',
  communicationMessage: 'COMMUNICATION_MESSAGE',
  communicationDelivery: 'COMMUNICATION_DELIVERY',
  controlEvent: 'CONVERSATION_CONTROL_EVENT',
});

export const P2_G1_PROJECTION_ERROR_CODES = Object.freeze({
  disabled: 'P2_G1_PROJECTION_DISABLED',
  invalidConfiguration: 'P2_G1_PROJECTION_CONFIGURATION_INVALID',
  storageFailed: 'P2_G1_PROJECTION_STORAGE_FAILED',
  rebuildRequired: 'P2_G1_SESSION_REBUILD_REQUIRED',
});

const PROJECTOR_NAME = 'CONVERSATION_TIMELINE';
const PROJECTOR_VERSION = 'P2-G1.1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(P2_G1_PROJECTION_ERROR_CODES.storageFailed);
  return date.toISOString();
}

function ordinalFromDate(value) {
  return String(BigInt(new Date(value).getTime()) * 1000n);
}

function boundedBatchSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new TypeError(P2_G1_PROJECTION_ERROR_CODES.invalidConfiguration);
  }
  return value;
}

function assertPool(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError(P2_G1_PROJECTION_ERROR_CODES.invalidConfiguration);
  }
}

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the primary failure */ }
    throw error;
  } finally {
    client.release();
  }
}

function creationKey(sourceId) {
  return `P2-G1:CHANNEL_MESSAGE:${sourceId}`;
}

function mappedRecord(base, overrides) {
  const safeContent = base.content && typeof base.content === 'object' && !Array.isArray(base.content)
    ? base.content
    : {};
  return normalizeTimelineSourceRecord({
    schema_version: 1,
    projector_name: PROJECTOR_NAME,
    projector_version: PROJECTOR_VERSION,
    source_stream: base.source_stream,
    source_type: base.source_type,
    source_id: base.source_id,
    projection_variant: base.projection_variant,
    session_id: base.session_id,
    item_type: base.item_type,
    sender_kind: base.sender_kind,
    visibility: base.visibility,
    text: typeof safeContent.text === 'string' ? safeContent.text : null,
    safe_content: overrides.safe_content ?? {},
    occurred_at: base.occurred_at,
    source_ordinal: overrides.source_ordinal,
    privacy_class: base.privacy_class,
    retention_until: base.retention_until,
  });
}

export function createP2G1TimelineProjector({
  pool,
  enabled = false,
  batchSize = 20,
  realtimeAppender = appendRealtimeEvent,
  wakeup = null,
} = {}) {
  assertPool(pool);
  boundedBatchSize(batchSize);
  if (typeof enabled !== 'boolean' || typeof realtimeAppender !== 'function' || (wakeup !== null && typeof wakeup !== 'function')) {
    throw new TypeError(P2_G1_PROJECTION_ERROR_CODES.invalidConfiguration);
  }
  return createTimelineProjector({
    pool,
    enabled,
    batchSize,
    async itemTransactionHook({ transaction, item, source_record: sourceRecord }) {
      if (sourceRecord.source_type === 'CHANNEL_MESSAGE') {
        const session = await transaction.query(
          `SELECT creation_idempotency_key,thread_id::text
             FROM conversation.session WHERE id=$1::uuid FOR UPDATE`,
          [item.session_id],
        );
        if (session.rowCount !== 1) throw new Error(P2_G1_PROJECTION_ERROR_CODES.storageFailed);
        const firstMessage = session.rows[0].creation_idempotency_key === creationKey(sourceRecord.source_id);
        await transaction.query(
          `UPDATE conversation.session
              SET generation_version=generation_version+CASE WHEN $2::boolean THEN 0 ELSE 1 END,
                  row_version=row_version+CASE WHEN $2::boolean THEN 0 ELSE 1 END,
                  last_activity_at=GREATEST(last_activity_at,$3::timestamptz),
                  updated_at=CURRENT_TIMESTAMP
            WHERE id=$1::uuid`,
          [item.session_id, firstMessage, sourceRecord.occurred_at],
        );
        await transaction.query(
          `UPDATE conversation.thread
              SET last_activity_at=GREATEST(last_activity_at,$2::timestamptz),updated_at=CURRENT_TIMESTAMP
            WHERE id=$1::uuid`,
          [session.rows[0].thread_id, sourceRecord.occurred_at],
        );
      }
      await realtimeAppender({
        transaction,
        command: mapConversationItemCreatedEvent(item),
      });
    },
    faultInjection: wakeup === null ? null : {
      afterCommit: async () => {
        try { await wakeup(); }
        catch { /* Realtime wakeup is advisory; durable facts already committed. */ }
      },
    },
  });
}

async function resolveChannelSession(pool, row) {
  return withTransaction(pool, async (transaction) => {
    const identity = buildConversationThreadIdentity({
      provider: row.provider,
      botId: row.bot_id,
      chatType: row.chat_type,
      chatId: row.chat_id,
      senderUserId: row.sender_user_id,
    });
    const thread = await transaction.query(
      `INSERT INTO conversation.thread(
         provider,channel_account_id,chat_type,external_thread_key,thread_key,last_activity_at
       ) VALUES($1,$2,$3,$4,$5,$6::timestamptz)
       ON CONFLICT(provider,channel_account_id,chat_type,external_thread_key)
       DO UPDATE SET last_activity_at=GREATEST(conversation.thread.last_activity_at,EXCLUDED.last_activity_at),
                     updated_at=CURRENT_TIMESTAMP
       RETURNING id::text`,
      [identity.provider, identity.channel_account_id, identity.chat_type,
        identity.external_thread_key, identity.thread_key, row.received_at],
    );
    const current = await transaction.query(
      `SELECT id::text,status,service_intake_id::text,last_activity_at
         FROM conversation.session
        WHERE thread_id=$1::uuid AND participant_key=$2
          AND status<>'ENDED'
        ORDER BY last_activity_at DESC,id DESC LIMIT 1 FOR UPDATE`,
      [thread.rows[0].id, identity.participant_key],
    );
    const active = current.rows[0] ?? null;
    const sameIntake = active !== null
      && (active.service_intake_id ?? null) === (row.service_intake_id ?? null);
    if (sameIntake) return active.id;
    const scope = buildConversationSessionScope({
      threadKey: identity.thread_key,
      participantKey: identity.participant_key,
      serviceIntakeId: row.service_intake_id,
      creationIdempotencyKey: creationKey(row.id),
    });
    const inserted = await transaction.query(
      `INSERT INTO conversation.session(
         thread_id,participant_key,service_intake_id,session_scope_key,
         creation_idempotency_key,status,control_mode,last_activity_at
       ) VALUES($1::uuid,$2,$3::uuid,$4,$5,'OPEN','HUMAN',$6::timestamptz)
       ON CONFLICT(creation_idempotency_key) DO UPDATE
         SET creation_idempotency_key=EXCLUDED.creation_idempotency_key
       RETURNING id::text`,
      [thread.rows[0].id, scope.participant_key, scope.service_intake_id,
        scope.session_scope_key, scope.creation_idempotency_key, row.received_at],
    );
    return inserted.rows[0].id;
  });
}

function streamContext(stream, sessionId, row) {
  return {
    projectorName: PROJECTOR_NAME,
    projectorVersion: PROJECTOR_VERSION,
    sourceStream: stream,
    sessionId,
    privacyClass: row.privacy_class ?? 'INTERNAL',
    retentionUntil: row.retention_until,
  };
}

function publicFailure(stream, error, sessionId = null) {
  const rebuild = error?.code === TIMELINE_ERROR_CODES.rebuildRequired;
  return Object.freeze({
    source_stream: stream,
    code: rebuild ? P2_G1_PROJECTION_ERROR_CODES.rebuildRequired : P2_G1_PROJECTION_ERROR_CODES.storageFailed,
    session_id: sessionId,
    isolated: rebuild,
    maintenance: rebuild ? 'RUN_AUTHORIZED_SINGLE_SESSION_REBUILD' : 'RETRY_FROM_PERSISTED_FACTS',
  });
}

export function createP2G1InboundProjectionCoordinator({
  pool,
  projector = null,
  enabled = false,
  batchSize = 20,
  wakeup = null,
} = {}) {
  assertPool(pool);
  const size = boundedBatchSize(batchSize);
  if (typeof enabled !== 'boolean') throw new TypeError(P2_G1_PROJECTION_ERROR_CODES.invalidConfiguration);
  const timeline = projector ?? createP2G1TimelineProjector({ pool, enabled, batchSize: size, wakeup });
  if (!timeline || typeof timeline.projectBatch !== 'function') throw new TypeError(P2_G1_PROJECTION_ERROR_CODES.invalidConfiguration);

  async function projectGroups(stream, groups) {
    const failures = [];
    let inserted = 0;
    let replayed = 0;
    for (const group of groups) {
      try {
        const result = await timeline.projectBatch({
          projectorName: PROJECTOR_NAME,
          projectorVersion: PROJECTOR_VERSION,
          sourceStream: stream,
          records: group.records,
          cursorValue: group.cursor,
        });
        inserted += result.inserted_count;
        replayed += result.replayed_count;
      } catch (error) {
        failures.push(publicFailure(stream, error, group.session_id));
      }
    }
    return Object.freeze({
      source_stream: stream,
      scanned: groups.length,
      inserted,
      replayed,
      failures: Object.freeze(failures),
    });
  }

  async function channelMessages() {
    const rows = await pool.query(
      `SELECT mi.id::text,mi.provider,mi.bot_id,mi.chat_type,mi.chat_id,mi.sender_user_id,
              mi.msg_type,mi.clean_text,mi.received_at,mi.privacy_class,mi.retention_until,
              COALESCE(sim.intake_id,si.id)::text AS service_intake_id,
              sim.relation_type,COALESCE(sim.sequence_no,1) AS source_ordinal
         FROM channel.message_inbox mi
         LEFT JOIN intake.service_intake_message sim ON sim.channel_message_id=mi.id
         LEFT JOIN intake.service_intake si ON si.primary_message_id=mi.id
        WHERE mi.processing_status='COMPLETED'
          AND NOT EXISTS(
            SELECT 1 FROM conversation.item_source_binding b
             WHERE b.projector_name=$1 AND b.source_stream=$2
               AND b.source_type='CHANNEL_MESSAGE' AND b.source_id=mi.id::text
               AND b.projection_variant='MESSAGE')
        ORDER BY mi.id LIMIT $3::integer`,
      [PROJECTOR_NAME, P2_G1_PROJECTION_STREAMS.channelMessage, size],
    );
    const groups = [];
    for (const row of rows.rows) {
      const sessionId = await resolveChannelSession(pool, row);
      groups.push({
        cursor: row.id,
        session_id: sessionId,
        records: [mapChannelMessageTimelineSource(row, streamContext(P2_G1_PROJECTION_STREAMS.channelMessage, sessionId, row))],
      });
    }
    return projectGroups(P2_G1_PROJECTION_STREAMS.channelMessage, groups);
  }

  async function ticketEvents() {
    const rows = await pool.query(
      `SELECT te.event_id::text,te.ticket_id::text,te.event_type,te.old_status,te.new_status,
              te.aggregate_version,te.event_ordinal,te.internal_note,te.external_note,te.reason_code,
              te.created_at,s.id::text AS session_id,si.privacy_class,si.retention_until
         FROM pilot_ticket.ticket_event te
         JOIN pilot_ticket.ticket t ON t.id=te.ticket_id
         JOIN intake.service_intake si ON si.id=t.source_intake_id
         JOIN conversation.session s ON s.service_intake_id=si.id
        WHERE NOT EXISTS(
          SELECT 1 FROM conversation.item_source_binding b
           WHERE b.projector_name=$1 AND b.source_stream=$2 AND b.source_type='TICKET_EVENT'
             AND b.source_id=te.event_id::text AND b.projection_variant='STATUS'
             AND b.session_id=s.id)
        ORDER BY te.created_at,te.event_id,s.id LIMIT $3::integer`,
      [PROJECTOR_NAME, P2_G1_PROJECTION_STREAMS.ticketEvent, size],
    );
    const groups = rows.rows.map((row) => ({
      cursor: `${iso(row.created_at)}|${row.event_id}`,
      session_id: row.session_id,
      records: mapTicketEventTimelineSources(row, streamContext(P2_G1_PROJECTION_STREAMS.ticketEvent, row.session_id, row)),
    }));
    return projectGroups(P2_G1_PROJECTION_STREAMS.ticketEvent, groups);
  }

  async function communicationMessages() {
    const rows = await pool.query(
      `SELECT m.id::text,m.session_id::text,m.sender_kind,m.purpose,m.message_type,m.visibility,
              m.content,m.privacy_class,m.retention_until,m.created_at
         FROM communication.message m
        WHERE m.session_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM conversation.item_source_binding b
           WHERE b.projector_name=$1 AND b.source_stream=$2 AND b.source_type='COMMUNICATION_MESSAGE'
             AND b.source_id=m.id::text AND b.projection_variant=m.purpose AND b.session_id=m.session_id)
        ORDER BY m.created_at,m.id LIMIT $3::integer`,
      [PROJECTOR_NAME, P2_G1_PROJECTION_STREAMS.communicationMessage, size],
    );
    const groups = rows.rows.map((row) => {
      const base = mapCommunicationMessageToTimelineSourceRecord(row);
      return {
        cursor: `${iso(row.created_at)}|${row.id}`,
        session_id: row.session_id,
        records: [mappedRecord(base, { source_ordinal: ordinalFromDate(row.created_at) })],
      };
    });
    return projectGroups(P2_G1_PROJECTION_STREAMS.communicationMessage, groups);
  }

  async function communicationDeliveries() {
    const rows = await pool.query(
      `SELECT d.id::text,d.status,d.attempt_count,d.last_error_code,d.side_effect_state,d.updated_at,
              m.session_id::text,m.privacy_class,m.retention_until
         FROM communication.delivery d
         JOIN communication.outbox o ON o.id=d.outbox_id
         JOIN communication.message m ON m.id=o.message_id
        WHERE m.session_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM conversation.item_source_binding b
           WHERE b.projector_name=$1 AND b.source_stream=$2 AND b.source_type='COMMUNICATION_DELIVERY'
             AND b.source_id=d.id::text
             AND b.projection_variant=(d.status||'_ATTEMPT_'||d.attempt_count::text)
             AND b.session_id=m.session_id)
        ORDER BY d.updated_at,d.id LIMIT $3::integer`,
      [PROJECTOR_NAME, P2_G1_PROJECTION_STREAMS.communicationDelivery, size],
    );
    const groups = rows.rows.map((row) => {
      const base = mapCommunicationDeliveryToTimelineSourceRecord(row);
      return {
        cursor: `${iso(row.updated_at)}|${row.id}`,
        session_id: row.session_id,
        records: [mappedRecord({ ...base, projection_variant: `${row.status}_ATTEMPT_${row.attempt_count}` }, {
          source_ordinal: ordinalFromDate(row.updated_at),
          safe_content: base.content,
        })],
      };
    });
    return projectGroups(P2_G1_PROJECTION_STREAMS.communicationDelivery, groups);
  }

  async function controlEvents() {
    const rows = await pool.query(
      `SELECT ce.id::text,ce.session_id::text,ce.event_type,ce.event_ordinal,
              ce.new_assignment_status,ce.new_control_mode,ce.reason_code,ce.occurred_at,
              'INTERNAL'::text AS privacy_class,
              ce.occurred_at+interval '365 days' AS retention_until
         FROM conversation.control_event ce
        WHERE ce.event_type IN(
          'HANDOFF_REQUESTED','HANDOFF_ACCEPTED','HANDOFF_RELEASED','HANDOFF_CANCELLED',
          'ASSIGNMENT_ASSIGNED','ASSIGNMENT_TRANSFERRED','ASSIGNMENT_RELEASED')
          AND NOT EXISTS(
            SELECT 1 FROM conversation.item_source_binding b
             WHERE b.projector_name=$1 AND b.source_stream=$2 AND b.source_type='HANDOFF_EVENT'
               AND b.source_id=ce.id::text AND b.projection_variant=ce.event_type
               AND b.session_id=ce.session_id)
        ORDER BY ce.occurred_at,ce.id LIMIT $3::integer`,
      [PROJECTOR_NAME, P2_G1_PROJECTION_STREAMS.controlEvent, size],
    );
    const groups = rows.rows.map((row) => {
      const mapped = mapControlEventToTimelineSourceRecord(row);
      const record = normalizeTimelineSourceRecord({
        projector_name: PROJECTOR_NAME,
        projector_version: PROJECTOR_VERSION,
        source_stream: P2_G1_PROJECTION_STREAMS.controlEvent,
        ...mapped,
      });
      return { cursor: `${iso(row.occurred_at)}|${row.id}`, session_id: row.session_id, records: [record] };
    });
    return projectGroups(P2_G1_PROJECTION_STREAMS.controlEvent, groups);
  }

  async function runOnce() {
    if (!enabled) return Object.freeze({ disabled: true, processed: 0, streams: Object.freeze([]) });
    const streams = [];
    for (const operation of [channelMessages, ticketEvents, communicationMessages, communicationDeliveries, controlEvents]) {
      try { streams.push(await operation()); }
      catch (error) { streams.push(Object.freeze({ source_stream: 'UNKNOWN', scanned: 0, inserted: 0, replayed: 0, failures: Object.freeze([publicFailure('UNKNOWN', error)]) })); }
    }
    return Object.freeze({
      disabled: false,
      processed: streams.reduce((sum, stream) => sum + stream.inserted, 0),
      failures: streams.reduce((sum, stream) => sum + stream.failures.length, 0),
      streams: Object.freeze(streams),
    });
  }

  async function backlog() {
    if (!enabled) return Object.freeze({ total: 0, disabled: true });
    const result = await pool.query(`SELECT
      (SELECT count(*) FROM channel.message_inbox mi WHERE mi.processing_status='COMPLETED' AND NOT EXISTS(
        SELECT 1 FROM conversation.item_source_binding b WHERE b.projector_name=$1 AND b.source_stream=$2 AND b.source_type='CHANNEL_MESSAGE' AND b.source_id=mi.id::text))::integer AS channel_messages,
      (SELECT count(*) FROM communication.message m WHERE m.session_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM conversation.item_source_binding b WHERE b.projector_name=$1 AND b.source_stream=$3 AND b.source_type='COMMUNICATION_MESSAGE' AND b.source_id=m.id::text))::integer AS communication_messages,
      (SELECT count(*) FROM communication.delivery d JOIN communication.outbox o ON o.id=d.outbox_id JOIN communication.message m ON m.id=o.message_id WHERE m.session_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM conversation.item_source_binding b WHERE b.projector_name=$1 AND b.source_stream=$4 AND b.source_type='COMMUNICATION_DELIVERY' AND b.source_id=d.id::text AND b.projection_variant=(d.status||'_ATTEMPT_'||d.attempt_count::text)))::integer AS communication_deliveries`,
    [PROJECTOR_NAME, P2_G1_PROJECTION_STREAMS.channelMessage, P2_G1_PROJECTION_STREAMS.communicationMessage, P2_G1_PROJECTION_STREAMS.communicationDelivery]);
    const counts = result.rows[0];
    return Object.freeze({ ...counts, total: counts.channel_messages + counts.communication_messages + counts.communication_deliveries, disabled: false });
  }

  return Object.freeze({ batchSize: size, runOnce, backlog, projector: timeline });
}
