
import type { CommunicationPurpose, CommunicationSenderKind, CommunicationVisibility } from '../contracts/communication_contracts.js';
interface MessageProjectionInput { id: string; session_id: string | null; purpose: CommunicationPurpose; sender_kind: CommunicationSenderKind; visibility: CommunicationVisibility; content: unknown; privacy_class: string; retention_until: unknown; created_at: unknown }
interface DeliveryProjectionInput { id: string; session_id?: string | null; status: string; attempt_count: string | number; last_error_code?: string | null; side_effect_state: string; privacy_class?: string; retention_until: unknown; updated_at: unknown }
interface LegacyProjectionInput { id?: string; delivery_id?: string; outbox_id: string; status: string; channel: string; attempt_count: string | number; last_error_code?: string | null; sent_at?: unknown }

import { createHash } from 'node:crypto';
import { assertLocalDateTime } from './platform/time-contract.mjs';

function iso(value: unknown) {
  return assertLocalDateTime(value);
}

function stableOrdinal(value: unknown) {
  const digest = createHash('sha256').update(String(value)).digest('hex').slice(0, 15);
  return BigInt(`0x${digest}`).toString();
}

function boundedString(value: unknown, maximum = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) throw new TypeError('COMMUNICATION_PROJECTION_INPUT_INVALID');
  return value;
}

export function mapCommunicationMessageToTimelineSourceRecord(message: MessageProjectionInput) {
  if (!message || typeof message !== 'object' || message.session_id == null) throw new TypeError('COMMUNICATION_PROJECTION_INPUT_INVALID');
  const purpose = boundedString(message.purpose, 64);
  const senderKind = boundedString(message.sender_kind, 16);
  const visibility = boundedString(message.visibility, 16);
  const itemType = purpose === 'INTERNAL_NOTE'
    ? 'INTERNAL_NOTE'
    : senderKind === 'AGENT'
      ? 'AGENT_MESSAGE'
      : senderKind === 'AI'
        ? 'AI_MESSAGE'
        : 'SYSTEM_EVENT';
  return Object.freeze({
    source_type: 'COMMUNICATION_MESSAGE',
    source_id: boundedString(message.id, 64),
    source_stream: 'COMMUNICATION_MESSAGE',
    source_ordinal: stableOrdinal(message.id),
    projection_variant: purpose,
    session_id: boundedString(message.session_id, 64),
    item_type: itemType,
    sender_kind: senderKind,
    visibility,
    content: message.content,
    privacy_class: boundedString(message.privacy_class, 32),
    retention_until: iso(message.retention_until),
    occurred_at: iso(message.created_at),
  });
}

export function mapCommunicationDeliveryToTimelineSourceRecord(delivery: DeliveryProjectionInput) {
  if (!delivery || typeof delivery !== 'object' || delivery.session_id == null) throw new TypeError('COMMUNICATION_PROJECTION_INPUT_INVALID');
  return Object.freeze({
    source_type: 'DELIVERY',
    source_id: boundedString(delivery.id, 64),
    source_stream: 'COMMUNICATION_DELIVERY',
    source_ordinal: stableOrdinal(delivery.id),
    projection_variant: boundedString(delivery.status, 32),
    session_id: boundedString(delivery.session_id, 64),
    item_type: 'DELIVERY_STATUS',
    sender_kind: 'SYSTEM',
    visibility: 'INTERNAL',
    content: Object.freeze({
      status: boundedString(delivery.status, 32),
      attempt_count: Number(delivery.attempt_count),
      last_error_code: delivery.last_error_code ?? null,
      side_effect_state: boundedString(delivery.side_effect_state, 32),
    }),
    privacy_class: boundedString(delivery.privacy_class ?? 'INTERNAL', 32),
    retention_until: iso(delivery.retention_until),
    occurred_at: iso(delivery.updated_at),
  });
}

export function mapCommunicationDeliveryChangedRealtimeEvent(delivery: DeliveryProjectionInput) {
  if (!delivery || typeof delivery !== 'object') throw new TypeError('COMMUNICATION_PROJECTION_INPUT_INVALID');
  return Object.freeze({
    event_type: 'communication.delivery.changed',
    source_type: 'COMMUNICATION_DELIVERY',
    source_id: boundedString(delivery.id, 64),
    aggregate_type: 'COMMUNICATION_DELIVERY',
    aggregate_id: boundedString(delivery.id, 64),
    aggregate_version: String(Number(delivery.attempt_count)),
    visibility: 'INTERNAL',
    payload: Object.freeze({
      status: boundedString(delivery.status, 32),
      attempt_count: Number(delivery.attempt_count),
      last_error_code: delivery.last_error_code ?? null,
      side_effect_state: boundedString(delivery.side_effect_state, 32),
    }),
    occurred_at: iso(delivery.updated_at),
  });
}

export function mapLegacyNotificationDeliveryToCommunicationView(row: LegacyProjectionInput) {
  if (!row || typeof row !== 'object') throw new TypeError('COMMUNICATION_PROJECTION_INPUT_INVALID');
  const status = boundedString(row.status, 32);
  if (!['PENDING', 'SENDING', 'SENT', 'DEAD_LETTER'].includes(status)) throw new TypeError('COMMUNICATION_PROJECTION_INPUT_INVALID');
  return Object.freeze({
    source_kind: 'P1_NOTIFICATION',
    delivery_id: boundedString(row.id ?? row.delivery_id, 64),
    outbox_id: boundedString(row.outbox_id, 64),
    status,
    channel: boundedString(row.channel, 64),
    attempt_count: Number(row.attempt_count),
    last_error_code: row.last_error_code ?? null,
    sent_at: row.sent_at == null ? null : iso(row.sent_at),
  });
}
