import { assertLocalDateTime, shanghaiLocalToEpochMs } from './platform/time-contract.mjs';

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function integer(value, minimum = 1) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError('Invalid conversation control projection input.'); return number; }
function date(value) { try { return assertLocalDateTime(value); } catch { throw new TypeError('Invalid conversation control projection input.'); } }
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('Invalid conversation control projection input.'); return value.toLowerCase(); }
function code(value) { if (typeof value !== 'string' || !CODE.test(value)) throw new TypeError('Invalid conversation control projection input.'); return value; }
function privacy(value) { if (!['INTERNAL', 'SENSITIVE_INTERNAL'].includes(value)) throw new TypeError('Invalid conversation control projection input.'); return value; }
function expiry(value, occurredAt) { const result = date(value); if (BigInt(shanghaiLocalToEpochMs(result)) <= BigInt(shanghaiLocalToEpochMs(occurredAt))) throw new TypeError('Invalid conversation control projection input.'); return result; }
function realtimeBase({ sourceId, variant, eventType, aggregateType, sessionId, occurredAt, expiresAt, payload, sessionRowVersion }) {
  return Object.freeze({ schema_version: 1, publisher_name: 'P2_005_CONVERSATION_CONTROL', publisher_version: '1.0.0', source_type: variant.startsWith('READ_CURSOR') ? 'READ_CURSOR' : 'HANDOFF_EVENT', source_id: sourceId, event_variant: variant, event_type: eventType, aggregate_type: aggregateType, aggregate_id: uuid(sessionId), aggregate_version: String(integer(sessionRowVersion)), authorization_scope_type: 'SESSION', authorization_scope_id: uuid(sessionId), visibility_scope: 'WORKBENCH', payload: Object.freeze(payload), occurred_at: date(occurredAt), expires_at: expiry(expiresAt, occurredAt) });
}

export function mapControlEventToTimelineSourceRecord(event) {
  const occurredAt = date(event.occurred_at);
  if (!['HANDOFF_REQUESTED','HANDOFF_ACCEPTED','HANDOFF_RELEASED','HANDOFF_CANCELLED','ASSIGNMENT_ASSIGNED','ASSIGNMENT_TRANSFERRED','ASSIGNMENT_RELEASED'].includes(event.event_type)) return null;
  return Object.freeze({ schema_version: 1, source_type: 'HANDOFF_EVENT', source_id: uuid(event.id), projection_variant: code(event.event_type), session_id: uuid(event.session_id), source_ordinal: String(integer(event.event_ordinal)), occurred_at: occurredAt, item_type: 'HANDOFF_EVENT', sender_kind: 'SYSTEM', visibility: 'INTERNAL', text: null, safe_content: Object.freeze({ event_type: event.event_type, assignment_status: event.new_assignment_status ?? null, control_mode: event.new_control_mode ?? null, reason_code: code(event.reason_code) }), privacy_class: privacy(event.privacy_class), retention_until: expiry(event.retention_until, occurredAt) });
}

export function mapAssignmentToRealtimeEvent({ eventId, sessionId, assignmentStatus, assignmentVersion, sessionRowVersion, generationVersion, occurredAt, expiresAt }) {
  return realtimeBase({ sourceId: uuid(eventId), variant: 'ASSIGNMENT_CHANGED', eventType: 'conversation.assigned', aggregateType: 'CONVERSATION_SESSION', sessionId, occurredAt, expiresAt, sessionRowVersion, payload: { assignment_status: assignmentStatus, assignment_version: integer(assignmentVersion), session_row_version: integer(sessionRowVersion), generation_version: integer(generationVersion) } });
}

export function mapHandoffToRealtimeEvent({ handoffId, sessionId, handoffStatus, handoffRowVersion, sessionRowVersion, generationVersion, occurredAt, expiresAt }) {
  const eventType = handoffStatus === 'ACCEPTED' ? 'conversation.handoff.accepted' : 'conversation.handoff.requested';
  return realtimeBase({ sourceId: uuid(handoffId), variant: `HANDOFF_${code(handoffStatus)}`, eventType, aggregateType: 'CONVERSATION_HANDOFF', sessionId, occurredAt, expiresAt, sessionRowVersion, payload: { handoff_status: handoffStatus, handoff_row_version: integer(handoffRowVersion), session_row_version: integer(sessionRowVersion), generation_version: integer(generationVersion) } });
}

export function mapReadCursorToRealtimeEvent({ eventId, sessionId, cursorRowVersion, lastReadSequence, sessionRowVersion, occurredAt, expiresAt }) {
  return realtimeBase({ sourceId: uuid(eventId), variant: 'READ_CURSOR_CHANGED', eventType: 'conversation.read_cursor.changed', aggregateType: 'CONVERSATION_READ_CURSOR', sessionId, occurredAt, expiresAt, sessionRowVersion, payload: { cursor_row_version: integer(cursorRowVersion), last_read_sequence: integer(lastReadSequence, 0) } });
}
