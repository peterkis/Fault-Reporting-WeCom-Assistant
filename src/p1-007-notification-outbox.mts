import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { LocalDateTime, PhysicalEpochMs } from '../contracts/time_contracts.js';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import {
  addEpochMilliseconds,
  assertEpochMsString,
  assertLocalDateTime,
  formatEpochMsToShanghaiLocal,
} from './platform/time-contract.mjs';
import { postgresTimestampToLocalDateTime } from './platform/postgres-types.mjs';
import type { PostgresPool, PostgresPoolClient, PostgresTransaction } from './platform/postgres-pool.mjs';
import type { PublicPilotTicket } from './p1-005-pilot-ticket-core.mjs';
import type { PublicTicketEvent, TicketEventType } from './p1-006-ticket-state-actions.mjs';

const MIGRATION_URL = new URL('../database/migrations/005_p1_007_notification_outbox.sql', import.meta.url);
export type NotificationChannel = 'WECOM_DIRECT' | 'PILOT_TEAM';
export type NotificationEventType = Extract<TicketEventType,
  | 'ticket.created'
  | 'ticket.queued'
  | 'ticket.accepted'
  | 'ticket.started'
  | 'ticket.waiting_requester'
  | 'ticket.waiting_vendor'
  | 'ticket.resumed'
  | 'ticket.resolved'
  | 'ticket.closed'
  | 'ticket.reopened'
  | 'ticket.cancelled'
  | 'ticket.note_added'
  | 'ticket.information_added'
  | 'ticket.auto_close_reminder'>;
export type DeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'DEAD_LETTER';
export interface NotificationTarget {
  channel: NotificationChannel;
  targetKey: string;
}
export interface NotificationCardTask {
  task_id: string;
  action_key: string;
  expires_at: string;
}
export type NotificationTicket = Pick<PublicPilotTicket, 'id' | 'ticket_no' | 'external_status' | 'intake_id' | 'resolver_team_id'>;
export type NotificationEvent = Pick<PublicTicketEvent, 'event_id' | 'aggregate_version' | 'external_note'> & {
  event_type: NotificationEventType;
};
export interface NotificationSenderInput {
  channel: NotificationChannel;
  targetKey: string;
  idempotencyKey: string;
  payload: unknown;
  templateCode: string;
}
export type NotificationSender = (input: NotificationSenderInput) => unknown | Promise<unknown>;
export interface PublicDelivery {
  id: string;
  outbox_id: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempt_count: number;
  last_error_code: string | null;
  provider_message_id: string | null;
  sent_at: LocalDateTime | null;
}
export interface NotificationOutbox {
  enqueueTicketEvent(input: {
    transaction: PostgresTransaction;
    ticket: NotificationTicket;
    event: NotificationEvent;
    cardTasks?: NotificationCardTask[];
  }): Promise<{ outbox_id: string; delivery_ids: string[] }>;
}
export interface NotificationDeliveryWorker {
  deliver(input: { deliveryId: string }): Promise<PublicDelivery | null>;
  getDelivery(input: { deliveryId: string }): Promise<PublicDelivery | null>;
  runOnce(input?: { limit?: number }): Promise<{ processed: number; results: PublicDelivery[] }>;
}
export interface NotificationDeliveryWorkerOptions {
  pool: PostgresPool;
  sender: NotificationSender;
  now?: () => Date;
  nowEpochMs?: (() => PhysicalEpochMs) | null;
  retryBaseMs?: number;
  maxAttempts?: number;
  leaseMs?: number;
  sendTimeoutMs?: number;
  maxDeliveriesPerTargetWindow?: number;
  rateLimitWindowMs?: number;
}
export interface NotificationTargetInput {
  transaction: PostgresTransaction;
  ticket: NotificationTicket;
  event: NotificationEvent;
}
interface NotificationPlan {
  reporter: boolean;
  team: boolean;
}
interface DeliveryClaimRow {
  id: string;
  outbox_id: string;
  channel: NotificationChannel;
  target_key: string;
  idempotency_key: string;
  attempt_count: number;
  payload: unknown;
  template_code: string;
  event_type: NotificationEventType;
  ticket_priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
}
interface DeliveryClaim extends DeliveryClaimRow {
  leaseToken: string;
  claimedAt: { epoch_ms: PhysicalEpochMs; local_datetime: LocalDateTime };
}
interface DeliveryRow {
  id: string;
  outbox_id: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempt_count: number;
  lease_token: string | null;
  last_error_code: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  sent_epoch_ms: string | null;
}
type DeliveryOutcome =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorCode: string };

const CHANNELS = new Set<NotificationChannel>(['WECOM_DIRECT', 'PILOT_TEAM']);
const TEMPLATE_CODES: Readonly<Partial<Record<TicketEventType, string>>> = Object.freeze({
  'ticket.created': 'TICKET_CREATED',
  'ticket.accepted': 'TICKET_ACCEPTED',
  'ticket.started': 'TICKET_STARTED',
  'ticket.waiting_requester': 'TICKET_INFORMATION_REQUESTED',
  'ticket.waiting_vendor': 'TICKET_WAITING_VENDOR',
  'ticket.resolved': 'TICKET_RESOLVED',
  'ticket.closed': 'TICKET_CLOSED',
  'ticket.reopened': 'TICKET_REOPENED',
  'ticket.information_added': 'TICKET_INFORMATION_ADDED',
  'ticket.auto_close_reminder': 'TICKET_AUTO_CLOSE_REMINDER',
});
const NOTIFICATION_MATRIX: Readonly<Partial<Record<TicketEventType, NotificationPlan>>> = Object.freeze({
  'ticket.created': Object.freeze({ reporter: true, team: true }),
  'ticket.queued': Object.freeze({ reporter: false, team: true }),
  'ticket.accepted': Object.freeze({ reporter: true, team: true }),
  'ticket.started': Object.freeze({ reporter: true, team: true }),
  'ticket.waiting_requester': Object.freeze({ reporter: true, team: true }),
  'ticket.waiting_vendor': Object.freeze({ reporter: false, team: true }),
  'ticket.resumed': Object.freeze({ reporter: false, team: true }),
  'ticket.resolved': Object.freeze({ reporter: true, team: true }),
  'ticket.closed': Object.freeze({ reporter: true, team: true }),
  'ticket.reopened': Object.freeze({ reporter: true, team: true }),
  'ticket.cancelled': Object.freeze({ reporter: true, team: true }),
  'ticket.note_added': Object.freeze({ reporter: false, team: true }),
  'ticket.information_added': Object.freeze({ reporter: false, team: true }),
  'ticket.auto_close_reminder': Object.freeze({ reporter: true, team: true }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNotificationChannel(value: unknown): value is NotificationChannel {
  return typeof value === 'string' && CHANNELS.has(value as NotificationChannel);
}

function iso(value: unknown): LocalDateTime {
  return postgresTimestampToLocalDateTime(value);
}

function clock(
  nowEpochMs: (() => PhysicalEpochMs) | null | undefined,
  legacyNow: () => Date,
): { epoch_ms: PhysicalEpochMs; local_datetime: LocalDateTime } {
  let epochMs: PhysicalEpochMs;
  if (typeof nowEpochMs === 'function') epochMs = assertEpochMsString(nowEpochMs());
  else {
    const value = legacyNow();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < 0) {
      throw new TypeError('clock must return non-negative epoch milliseconds.');
    }
    epochMs = assertEpochMsString(String(Math.trunc(value.getTime())));
  }
  return Object.freeze({ epoch_ms: epochMs, local_datetime: formatEpochMsToShanghaiLocal(epochMs) });
}

function nonEmpty(value: unknown, code: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(code);
  }
  return value;
}

function hashTarget(targetKey: string): string {
  return createHash('sha256').update(targetKey).digest('hex');
}

function templateCodeFor(eventType: TicketEventType): string {
  return TEMPLATE_CODES[eventType] ?? 'TICKET_UPDATE';
}

function publicDelivery(row: DeliveryRow): PublicDelivery {
  return {
    id: row.id,
    outbox_id: row.outbox_id,
    channel: row.channel,
    status: row.status,
    attempt_count: row.attempt_count,
    last_error_code: row.last_error_code,
    provider_message_id: row.provider_message_id,
    sent_at: row.sent_at === null ? null : iso(row.sent_at),
  };
}

async function withTransaction<T>(
  pool: PostgresPool | undefined,
  operation: (transaction: PostgresPoolClient) => Promise<T>,
): Promise<T> {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  const client = await pool.connect();
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      destroyClient = true;
    }
    throw error;
  } finally {
    client.release(destroyClient);
  }
}

async function defaultTargetsForEvent({ transaction, ticket, event }: NotificationTargetInput): Promise<NotificationTarget[]> {
  const plan = NOTIFICATION_MATRIX[event.event_type];
  if (!plan) {
    throw new TypeError('Notification matrix entry is required.');
  }
  const targets: NotificationTarget[] = [];
  if (plan.reporter) {
    const reporter = await transaction.query<{ reporter_wecom_userid: string }>(
      `SELECT reporter_wecom_userid
         FROM intake.service_intake
        WHERE id = $1::uuid`,
      [ticket.intake_id],
    );
    if (reporter.rowCount !== 1) {
      throw new Error('NOTIFICATION_INTAKE_NOT_FOUND');
    }
    const reporterRow = reporter.rows[0];
    if (!reporterRow) throw new Error('NOTIFICATION_INTAKE_NOT_FOUND');
    targets.push({ channel: 'WECOM_DIRECT', targetKey: reporterRow.reporter_wecom_userid });
  }
  if (plan.team) {
    targets.push({ channel: 'PILOT_TEAM', targetKey: `TEAM:${ticket.resolver_team_id}` });
  }
  return targets;
}

function validateTargets(targets: unknown): NotificationTarget[] {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new TypeError('At least one notification target is required.');
  }
  const seen = new Set();
  return targets.map((target) => {
    if (!isRecord(target) || !isNotificationChannel(target.channel)) {
      throw new TypeError('Notification target channel is invalid.');
    }
    const targetKey = nonEmpty(target.targetKey, 'Notification target key is invalid.', 512);
    const identity = `${target.channel}\u0000${targetKey}`;
    if (seen.has(identity)) {
      throw new TypeError('Notification targets must be unique.');
    }
    seen.add(identity);
    return { channel: target.channel, targetKey };
  });
}

export async function applyNotificationOutboxMigration({ pool }: { pool: PostgresPool }): Promise<void | { status: 'LEGACY_MIGRATION_SUPERSEDED' }> {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export function createNotificationOutbox({
  targetsForEvent = defaultTargetsForEvent,
}: { targetsForEvent?: (input: NotificationTargetInput) => NotificationTarget[] | Promise<NotificationTarget[]> } = {}): NotificationOutbox {
  if (typeof targetsForEvent !== 'function') {
    throw new TypeError('targetsForEvent must be a function.');
  }
  return Object.freeze({
    enqueueTicketEvent: async ({ transaction, ticket, event, cardTasks = [] }: {
      transaction: PostgresTransaction;
      ticket: NotificationTicket;
      event: NotificationEvent;
      cardTasks?: NotificationCardTask[];
    }): Promise<{ outbox_id: string; delivery_ids: string[] }> => {
      if (!transaction || typeof transaction.query !== 'function' || !ticket || !event) {
        throw new TypeError('A transaction, Ticket, and Ticket Event are required.');
      }
      const templateCode = templateCodeFor(event.event_type);
      const payload = {
        ticket_no: ticket.ticket_no,
        external_status: ticket.external_status,
        external_note: event.external_note ?? null,
        card_tasks: cardTasks.map((task) => ({
          task_id: task.task_id,
          action_key: task.action_key,
          expires_at: task.expires_at,
        })),
      };
      const outbox = await transaction.query<{ id: string }>(
        `INSERT INTO notification.outbox (
            ticket_id, ticket_event_id, event_type, aggregate_version, template_code, payload
         ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
         ON CONFLICT (ticket_event_id, template_code)
         DO UPDATE SET id = notification.outbox.id
         RETURNING id::text`,
        [
          ticket.id,
          event.event_id,
          event.event_type,
          event.aggregate_version,
          templateCode,
          JSON.stringify(payload),
        ],
      );
      const outboxRow = outbox.rows[0];
      if (!outboxRow) throw new Error('NOTIFICATION_OUTBOX_NOT_RETURNED');
      const targets = validateTargets(await targetsForEvent({ transaction, ticket, event }));
      const deliveryIds = [];
      for (const target of targets) {
        const idempotencyKey = [
          event.event_type,
          ticket.id,
          event.aggregate_version,
          target.channel,
          hashTarget(target.targetKey),
          templateCode,
        ].join(':');
        const delivery = await transaction.query<{ id: string }>(
          `INSERT INTO notification.delivery (
              outbox_id, channel, target_key, idempotency_key
           ) VALUES ($1::uuid, $2, $3, $4)
           ON CONFLICT (idempotency_key)
           DO UPDATE SET id = notification.delivery.id
           RETURNING id::text`,
          [outboxRow.id, target.channel, target.targetKey, idempotencyKey],
        );
        const deliveryRow = delivery.rows[0];
        if (!deliveryRow) throw new Error('NOTIFICATION_DELIVERY_NOT_RETURNED');
        deliveryIds.push(deliveryRow.id);
      }
      return {
        outbox_id: outboxRow.id,
        delivery_ids: deliveryIds,
      };
    },
  });
}

function deliveryErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === 'string' && error.code.length > 0 && error.code.length <= 128) {
    return error.code;
  }
  return 'WECOM_SEND_FAILED';
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          const error = Object.assign(new Error('Notification delivery timed out.'), { code: 'WECOM_SEND_TIMEOUT' });
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function createNotificationDeliveryWorker(options: NotificationDeliveryWorkerOptions): NotificationDeliveryWorker;
export function createNotificationDeliveryWorker({
  pool,
  sender,
  now = () => new Date(),
  nowEpochMs = null,
  retryBaseMs = 1_000,
  maxAttempts = 5,
  leaseMs = 30_000,
  sendTimeoutMs = 5_000,
  maxDeliveriesPerTargetWindow = 20,
  rateLimitWindowMs = 60_000,
}: Partial<NotificationDeliveryWorkerOptions> = {}): NotificationDeliveryWorker {
  if (typeof sender !== 'function' || typeof now !== 'function'
    || (nowEpochMs !== null && typeof nowEpochMs !== 'function')) {
    throw new TypeError('A notification sender is required.');
  }
  const send = sender;
  for (const [name, value] of Object.entries({
    retryBaseMs,
    maxAttempts,
    leaseMs,
    sendTimeoutMs,
    maxDeliveriesPerTargetWindow,
    rateLimitWindowMs,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive integer.`);
    }
  }
  if (sendTimeoutMs > leaseMs) {
    throw new TypeError('sendTimeoutMs must not exceed leaseMs.');
  }

  async function claimOne(deliveryId: string | null = null): Promise<DeliveryClaim | null> {
    const claimedAt = clock(nowEpochMs, now);
    const rateLimitStart = BigInt(claimedAt.epoch_ms) > BigInt(rateLimitWindowMs)
      ? String(BigInt(claimedAt.epoch_ms) - BigInt(rateLimitWindowMs)) : '0';
    const leaseToken = randomUUID();
    return withTransaction(pool, async (transaction) => {
      const selected = deliveryId === null
          ? await transaction.query<DeliveryClaimRow>(
          `SELECT delivery.id::text, delivery.outbox_id::text, delivery.channel,
                  delivery.target_key, delivery.idempotency_key, delivery.attempt_count,
                  outbox.payload, outbox.template_code, outbox.event_type,
                  ticket.priority AS ticket_priority
             FROM notification.delivery AS delivery
             JOIN notification.outbox AS outbox ON outbox.id = delivery.outbox_id
             JOIN pilot_ticket.ticket AS ticket ON ticket.id = outbox.ticket_id
            WHERE (
                (delivery.status = 'PENDING' AND delivery.next_attempt_epoch_ms <= $1::bigint)
                OR (delivery.status = 'SENDING' AND delivery.lease_expires_epoch_ms <= $1::bigint)
            )
              AND pg_try_advisory_xact_lock(
                  hashtext(delivery.channel),
                  hashtext(delivery.target_key)
              )
              AND (
                  SELECT count(*)
                    FROM notification.delivery AS rate_delivery
                   WHERE rate_delivery.channel = delivery.channel
                     AND rate_delivery.target_key = delivery.target_key
                     AND (
                         (rate_delivery.status = 'SENT'
                          AND rate_delivery.sent_epoch_ms > $2::bigint)
                         OR (rate_delivery.status = 'SENDING'
                             AND rate_delivery.lease_expires_epoch_ms > $1::bigint)
                     )
              ) < $3::integer
            ORDER BY CASE
                       WHEN outbox.event_type = 'ticket.waiting_requester'
                         OR ticket.priority = 'URGENT' THEN 0
                       WHEN ticket.priority = 'HIGH' THEN 1
                       ELSE 2
                     END,
                     delivery.next_attempt_epoch_ms, delivery.created_at
            FOR UPDATE OF delivery SKIP LOCKED
            LIMIT 1`,
          [claimedAt.epoch_ms, rateLimitStart, maxDeliveriesPerTargetWindow],
        )
        : await transaction.query<DeliveryClaimRow>(
          `SELECT delivery.id::text, delivery.outbox_id::text, delivery.channel,
                  delivery.target_key, delivery.idempotency_key, delivery.attempt_count,
                  outbox.payload, outbox.template_code, outbox.event_type,
                  ticket.priority AS ticket_priority
             FROM notification.delivery AS delivery
             JOIN notification.outbox AS outbox ON outbox.id = delivery.outbox_id
             JOIN pilot_ticket.ticket AS ticket ON ticket.id = outbox.ticket_id
            WHERE delivery.id = $1::uuid
              AND (
                  (delivery.status = 'PENDING' AND delivery.next_attempt_epoch_ms <= $2::bigint)
                  OR (delivery.status = 'SENDING' AND delivery.lease_expires_epoch_ms <= $2::bigint)
              )
              AND pg_try_advisory_xact_lock(
                  hashtext(delivery.channel),
                  hashtext(delivery.target_key)
              )
              AND (
                  SELECT count(*)
                    FROM notification.delivery AS rate_delivery
                   WHERE rate_delivery.channel = delivery.channel
                     AND rate_delivery.target_key = delivery.target_key
                     AND (
                         (rate_delivery.status = 'SENT'
                          AND rate_delivery.sent_epoch_ms > $3::bigint)
                         OR (rate_delivery.status = 'SENDING'
                             AND rate_delivery.lease_expires_epoch_ms > $2::bigint)
                     )
              ) < $4::integer
            FOR UPDATE OF delivery SKIP LOCKED`,
          [deliveryId, claimedAt.epoch_ms, rateLimitStart, maxDeliveriesPerTargetWindow],
        );
      if (selected.rowCount !== 1) {
        return null;
      }
      const claimed = selected.rows[0];
      if (!claimed) return null;
      const leaseExpiresAt = addEpochMilliseconds(claimedAt.epoch_ms, leaseMs);
      await transaction.query(
        `UPDATE notification.delivery
            SET status = 'SENDING',
                lease_token = $2::uuid,
                lease_expires_epoch_ms = $3::bigint,
                updated_at = $1::timestamp without time zone
          WHERE id = $4::uuid`,
        [claimedAt.local_datetime, leaseToken, leaseExpiresAt, claimed.id],
      );
      return { ...claimed, leaseToken, claimedAt };
    });
  }

  async function finalize(claim: DeliveryClaim, outcome: DeliveryOutcome): Promise<PublicDelivery | null> {
    const completedAt = clock(nowEpochMs, now);
    return withTransaction(pool, async (transaction) => {
      const selected = await transaction.query<DeliveryRow>(
        `SELECT id::text, outbox_id::text, channel, status, attempt_count,
                lease_token::text, last_error_code, provider_message_id, sent_at, sent_epoch_ms::text
           FROM notification.delivery
          WHERE id = $1::uuid
          FOR UPDATE`,
        [claim.id],
      );
      const current = selected.rows[0];
      if (selected.rowCount !== 1 || !current || current.status !== 'SENDING'
        || current.lease_token !== claim.leaseToken) {
        return null;
      }
      const attemptNo = current.attempt_count + 1;
      if (outcome.ok) {
        const updated = await transaction.query<DeliveryRow>(
          `UPDATE notification.delivery
              SET status = 'SENT',
                   attempt_count = $2,
                   lease_token = NULL,
                   lease_expires_at = NULL,
                   lease_expires_epoch_ms = NULL,
                  last_error_code = NULL,
                  provider_message_id = $3,
                  sent_epoch_ms = $4::bigint,
                  updated_at = $5::timestamp without time zone
            WHERE id = $1::uuid
            RETURNING id::text, outbox_id::text, channel, status, attempt_count,
                      last_error_code, provider_message_id, sent_at, sent_epoch_ms::text`,
          [claim.id, attemptNo, outcome.providerMessageId ?? null,
            completedAt.epoch_ms, completedAt.local_datetime],
        );
        await transaction.query(
          `INSERT INTO notification.delivery_attempt (
              delivery_id, attempt_no, outcome, provider_message_id, occurred_at, occurred_epoch_ms
           ) VALUES ($1::uuid, $2, 'SENT', $3, $4::timestamp without time zone, $5::bigint)`,
          [claim.id, attemptNo, outcome.providerMessageId ?? null,
            completedAt.local_datetime, completedAt.epoch_ms],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) throw new Error('NOTIFICATION_DELIVERY_NOT_RETURNED');
        return publicDelivery(updatedRow);
      }
      const terminal = attemptNo >= maxAttempts;
      const nextAttemptAt = addEpochMilliseconds(
        completedAt.epoch_ms,
        retryBaseMs * (2 ** Math.max(0, attemptNo - 1)),
      );
      const updated = await transaction.query<DeliveryRow>(
        `UPDATE notification.delivery
            SET status = $2,
                attempt_count = $3,
                 next_attempt_epoch_ms = $4::bigint,
                 lease_token = NULL,
                 lease_expires_at = NULL,
                 lease_expires_epoch_ms = NULL,
                last_error_code = $5,
                updated_at = $6::timestamp without time zone
          WHERE id = $1::uuid
          RETURNING id::text, outbox_id::text, channel, status, attempt_count,
                    last_error_code, provider_message_id, sent_at, sent_epoch_ms::text`,
        [
          claim.id,
          terminal ? 'DEAD_LETTER' : 'PENDING',
          attemptNo,
          nextAttemptAt,
          outcome.errorCode,
          completedAt.local_datetime,
        ],
      );
      await transaction.query(
        `INSERT INTO notification.delivery_attempt (
            delivery_id, attempt_no, outcome, error_code, occurred_at, occurred_epoch_ms
         ) VALUES ($1::uuid, $2, $3, $4, $5::timestamp without time zone, $6::bigint)`,
        [
          claim.id,
          attemptNo,
          terminal ? 'DEAD_LETTER' : 'RETRY_SCHEDULED',
          outcome.errorCode,
          completedAt.local_datetime,
          completedAt.epoch_ms,
        ],
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new Error('NOTIFICATION_DELIVERY_NOT_RETURNED');
      return publicDelivery(updatedRow);
    });
  }

  async function deliverClaimed(claim: DeliveryClaim): Promise<PublicDelivery | null> {
    try {
      const response = await withTimeout(Promise.resolve(send({
        channel: claim.channel,
        targetKey: claim.target_key,
        idempotencyKey: claim.idempotency_key,
        payload: claim.payload,
        templateCode: claim.template_code,
      })), sendTimeoutMs);
      if (!isRecord(response) || response.ok !== true) {
        const code = isRecord(response) && typeof response.code === 'string'
          ? response.code : 'WECOM_SEND_REJECTED';
        const error = Object.assign(new Error('Notification sender rejected delivery.'), { code });
        throw error;
      }
      const providerMessageId = response.providerMessageId === null || typeof response.providerMessageId === 'string'
        ? response.providerMessageId : null;
      return finalize(claim, { ok: true, providerMessageId });
    } catch (error) {
      return finalize(claim, { ok: false, errorCode: deliveryErrorCode(error) });
    }
  }

  async function deliver({ deliveryId }: { deliveryId: string }): Promise<PublicDelivery | null> {
    nonEmpty(deliveryId, 'Delivery id is required.', 64);
    const claim = await claimOne(deliveryId);
    return claim === null ? null : deliverClaimed(claim);
  }

  async function getDelivery({ deliveryId }: { deliveryId: string }): Promise<PublicDelivery | null> {
    nonEmpty(deliveryId, 'Delivery id is required.', 64);
    if (!pool || typeof pool.query !== 'function') {
      throw new TypeError('A PostgreSQL pool is required.');
    }
    const selected = await pool.query<DeliveryRow>(
      `SELECT id::text, outbox_id::text, channel, status, attempt_count,
              last_error_code, provider_message_id, sent_at
         FROM notification.delivery
        WHERE id = $1::uuid`,
      [deliveryId],
    );
    const row = selected.rows[0];
    return selected.rowCount === 1 && row ? publicDelivery(row) : null;
  }

  async function runOnce({ limit = 10 }: { limit?: number } = {}): Promise<{ processed: number; results: PublicDelivery[] }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('limit must be an integer from 1 through 100.');
    }
    const results = [];
    for (let index = 0; index < limit; index += 1) {
      const claim = await claimOne();
      if (claim === null) {
        break;
      }
      const result = await deliverClaimed(claim);
      if (result !== null) {
        results.push(result);
      }
    }
    return { processed: results.length, results };
  }

  return Object.freeze({ deliver, getDelivery, runOnce });
}
