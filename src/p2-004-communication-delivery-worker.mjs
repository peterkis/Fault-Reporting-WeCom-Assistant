import { randomUUID } from 'node:crypto';

import { COMMUNICATION_ERROR_CODES } from './p2-004-communication-core.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RESOLUTIONS = new Set(['CONFIRMED_SENT', 'CONFIRMED_NOT_SENT_REQUEUE', 'CANCEL']);

function publicError(code, retryable = false) {
  return Object.freeze({ ok: false, error: Object.freeze({ code, retryable }) });
}

function safeCode(value, fallback) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,128}$/u.test(value) ? value : fallback;
}

function validDate(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError('now must return a valid Date.');
  return value;
}

function deliveryView(row) {
  return Object.freeze({
    source_kind: 'COMMUNICATION',
    delivery_id: row.id,
    outbox_id: row.outbox_id,
    status: row.status,
    channel: row.provider,
    attempt_count: Number(row.attempt_count),
    last_error_code: row.last_error_code,
    side_effect_state: row.side_effect_state,
    sent_at: row.sent_at === null ? null : new Date(row.sent_at).toISOString(),
  });
}

async function withTransaction(pool, operation) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required.');
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally {
    client.release(destroy);
  }
}

function validatePositiveIntegers(values) {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer.`);
  }
}

export function createCommunicationDeliveryWorker({
  pool,
  sender,
  enabled = false,
  now = () => new Date(),
  batchSize = 20,
  leaseMs = 30_000,
  sendTimeoutMs = 5_000,
  retryBaseMs = 1_000,
  maxAttempts = 5,
  maxDeliveriesPerTargetWindow = 20,
  rateLimitWindowMs = 60_000,
} = {}) {
  if (typeof enabled !== 'boolean' || !sender || typeof sender.send !== 'function' || typeof now !== 'function') throw new TypeError('Communication worker configuration is invalid.');
  validatePositiveIntegers({ batchSize, leaseMs, sendTimeoutMs, retryBaseMs, maxAttempts, maxDeliveriesPerTargetWindow, rateLimitWindowMs });
  if (batchSize > 20 || sendTimeoutMs > leaseMs) throw new TypeError('Communication worker limits are invalid.');

  async function recoverExpiredSending(limit = batchSize) {
    if (!enabled) return Object.freeze({ recovered: 0, delivery_ids: Object.freeze([]) });
    const recoveredAt = validDate(now);
    return withTransaction(pool, async (transaction) => {
      const selected = await transaction.query(
        `SELECT id::text, outbox_id::text, attempt_count
           FROM communication.delivery
          WHERE status = 'SENDING' AND lease_expires_at <= $1::timestamptz
          ORDER BY lease_expires_at, id
          FOR UPDATE SKIP LOCKED LIMIT $2::integer`,
        [recoveredAt, limit],
      );
      for (const delivery of selected.rows) {
        await transaction.query(
          `UPDATE communication.delivery
              SET status = 'RECONCILIATION_REQUIRED', side_effect_state = 'UNKNOWN',
                  lease_token = NULL, lease_expires_at = NULL,
                  last_error_code = $2, updated_at = $3::timestamptz
            WHERE id = $1::uuid`,
          [delivery.id, COMMUNICATION_ERROR_CODES.reconciliationRequired, recoveredAt],
        );
        await transaction.query(
          `UPDATE communication.delivery_attempt
              SET outcome = 'RECONCILIATION_REQUIRED', side_effect_state = 'UNKNOWN',
                  error_code = $3, completed_at = $4::timestamptz
            WHERE delivery_id = $1::uuid AND attempt_no = $2 AND outcome = 'STARTED'`,
          [delivery.id, Number(delivery.attempt_count), COMMUNICATION_ERROR_CODES.reconciliationRequired, recoveredAt],
        );
      }
      return Object.freeze({ recovered: selected.rowCount, delivery_ids: Object.freeze(selected.rows.map((row) => row.id)) });
    });
  }

  async function claimOne(deliveryId = null) {
    const claimedAt = validDate(now);
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(claimedAt.getTime() + leaseMs);
    const rateLimitStart = new Date(claimedAt.getTime() - rateLimitWindowMs);
    return withTransaction(pool, async (transaction) => {
      const parameters = deliveryId === null
        ? [claimedAt, rateLimitStart, maxDeliveriesPerTargetWindow]
        : [claimedAt, rateLimitStart, maxDeliveriesPerTargetWindow, deliveryId];
      const selected = await transaction.query(
        `SELECT delivery.id::text, delivery.outbox_id::text, delivery.provider,
                delivery.channel_account_id, delivery.target_type, delivery.target_id,
                delivery.target_hash, delivery.idempotency_key, delivery.attempt_count,
                message.message_type, message.content
           FROM communication.delivery AS delivery
           JOIN communication.outbox AS outbox ON outbox.id = delivery.outbox_id
           JOIN communication.message AS message ON message.id = outbox.message_id
          WHERE (($4::uuid IS NULL) OR delivery.id = $4::uuid)
            AND ((delivery.status = 'PENDING' AND delivery.next_attempt_at <= $1::timestamptz)
              OR (delivery.status = 'LEASED' AND delivery.lease_expires_at <= $1::timestamptz))
            AND pg_try_advisory_xact_lock(hashtext(delivery.provider), hashtext(delivery.target_hash))
            AND (SELECT count(*) FROM communication.delivery AS rate_delivery
                  WHERE rate_delivery.provider = delivery.provider
                    AND rate_delivery.target_hash = delivery.target_hash
                    AND ((rate_delivery.status = 'SENT' AND rate_delivery.sent_at > $2::timestamptz)
                      OR (rate_delivery.status = 'SENDING' AND rate_delivery.lease_expires_at > $1::timestamptz))) < $3::integer
          ORDER BY delivery.priority, delivery.next_attempt_at, delivery.created_at, delivery.id
          FOR UPDATE OF delivery SKIP LOCKED LIMIT 1`,
        deliveryId === null ? [...parameters, null] : parameters,
      );
      if (selected.rowCount !== 1) return null;
      const claim = selected.rows[0];
      const updated = await transaction.query(
        `UPDATE communication.delivery
            SET status = 'LEASED', lease_token = $2::uuid, lease_expires_at = $3::timestamptz,
                send_started_at = NULL, side_effect_state = 'NOT_ATTEMPTED', updated_at = $4::timestamptz
          WHERE id = $1::uuid AND status IN ('PENDING','LEASED')
          RETURNING id::text`,
        [claim.id, leaseToken, leaseExpiresAt, claimedAt],
      );
      if (updated.rowCount !== 1) return null;
      return Object.freeze({ ...claim, lease_token: leaseToken, lease_expires_at: leaseExpiresAt });
    });
  }

  async function startClaim(claim) {
    const startedAt = validDate(now);
    return withTransaction(pool, async (transaction) => {
      const updated = await transaction.query(
        `UPDATE communication.delivery
            SET status = 'SENDING', attempt_count = attempt_count + 1,
                send_started_at = $3::timestamptz, updated_at = $3::timestamptz
          WHERE id = $1::uuid AND status = 'LEASED' AND lease_token = $2::uuid
            AND lease_expires_at > $3::timestamptz
          RETURNING attempt_count`,
        [claim.id, claim.lease_token, startedAt],
      );
      if (updated.rowCount !== 1) return null;
      const attemptNo = Number(updated.rows[0].attempt_count);
      await transaction.query(
        `INSERT INTO communication.delivery_attempt (
           delivery_id, attempt_no, outcome, side_effect_state, lease_token, request_id, started_at
         ) VALUES ($1::uuid,$2,'STARTED','NOT_ATTEMPTED',$3::uuid,$4,$5::timestamptz)`,
        [claim.id, attemptNo, claim.lease_token, `comm-attempt-${claim.lease_token}`, startedAt],
      );
      return Object.freeze({ ...claim, attempt_no: attemptNo, started_at: startedAt });
    });
  }

  async function finalize(started, result) {
    const completedAt = validDate(now);
    return withTransaction(pool, async (transaction) => {
      const locked = await transaction.query(
        `SELECT id::text, outbox_id::text, status, attempt_count, side_effect_state,
                last_error_code, sent_at
           FROM communication.delivery
          WHERE id = $1::uuid AND status = 'SENDING' AND lease_token = $2::uuid
          FOR UPDATE`,
        [started.id, started.lease_token],
      );
      if (locked.rowCount !== 1 || Number(locked.rows[0].attempt_count) !== started.attempt_no) return null;
      let status;
      let sideEffectState;
      let attemptOutcome;
      let errorCode = null;
      let sentAt = null;
      let nextAttemptAt = completedAt;
      let providerMessageId = null;
      if (result.outcome === 'ACKNOWLEDGED') {
        status = 'SENT';
        sideEffectState = 'ACKNOWLEDGED';
        attemptOutcome = 'SENT';
        sentAt = completedAt;
        providerMessageId = result.provider_message_id;
      } else if (result.outcome === 'UNKNOWN') {
        status = 'RECONCILIATION_REQUIRED';
        sideEffectState = 'UNKNOWN';
        attemptOutcome = 'RECONCILIATION_REQUIRED';
        errorCode = safeCode(result.error_code, COMMUNICATION_ERROR_CODES.reconciliationRequired);
      } else {
        sideEffectState = 'NOT_ATTEMPTED';
        errorCode = safeCode(result.error_code, COMMUNICATION_ERROR_CODES.sendRejected);
        const terminal = result.retryable === false || started.attempt_no >= maxAttempts;
        status = terminal ? 'DEAD_LETTER' : 'PENDING';
        attemptOutcome = terminal ? 'DEAD_LETTER' : 'RETRY_SCHEDULED';
        nextAttemptAt = new Date(completedAt.getTime() + retryBaseMs * (2 ** Math.max(0, started.attempt_no - 1)));
      }
      const updated = await transaction.query(
          `UPDATE communication.delivery
            SET status = $3, side_effect_state = $4, next_attempt_at = $5::timestamptz,
                lease_token = NULL, lease_expires_at = NULL,
                send_started_at = CASE WHEN $3 = 'PENDING' THEN NULL ELSE send_started_at END,
                last_error_code = $6, provider_message_id = $7,
                sent_at = $8::timestamptz, updated_at = $9::timestamptz
          WHERE id = $1::uuid AND lease_token = $2::uuid AND status = 'SENDING'
          RETURNING id::text, outbox_id::text, status, provider, attempt_count,
                    last_error_code, side_effect_state, sent_at`,
        [started.id, started.lease_token, status, sideEffectState, nextAttemptAt,
          errorCode, providerMessageId, sentAt, completedAt],
      );
      await transaction.query(
        `UPDATE communication.delivery_attempt
            SET outcome = $3, side_effect_state = $4, error_code = $5,
                provider_message_id = $6, completed_at = $7::timestamptz
          WHERE delivery_id = $1::uuid AND attempt_no = $2 AND outcome = 'STARTED'`,
        [started.id, started.attempt_no, attemptOutcome, sideEffectState, errorCode, providerMessageId, completedAt],
      );
      return deliveryView(updated.rows[0]);
    });
  }

  async function sendOutsideTransaction(started) {
    const controller = new AbortController();
    let timer;
    const timeoutResult = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ outcome: 'UNKNOWN', provider_message_id: null, error_code: COMMUNICATION_ERROR_CODES.sendTimeout, retryable: false });
      }, sendTimeoutMs);
    });
    let result;
    try {
      result = await Promise.race([
        Promise.resolve(sender.send({
          provider: started.provider,
          channel_account_id: started.channel_account_id,
          target_type: started.target_type,
          target_id: started.target_id,
          delivery_id: started.id,
          idempotency_key: started.idempotency_key,
          message: Object.freeze({ message_type: started.message_type, content: started.content }),
          signal: controller.signal,
        })),
        timeoutResult,
      ]);
    } catch (error) {
      result = error?.code === 'GATEWAY_UNAVAILABLE_BEFORE_SEND'
        ? { outcome: 'REJECTED_NOT_APPLIED', provider_message_id: null, error_code: 'GATEWAY_UNAVAILABLE', retryable: true }
        : { outcome: 'UNKNOWN', provider_message_id: null, error_code: COMMUNICATION_ERROR_CODES.reconciliationRequired, retryable: false };
    } finally {
      clearTimeout(timer);
    }
    if (!result || !['ACKNOWLEDGED', 'REJECTED_NOT_APPLIED', 'UNKNOWN'].includes(result.outcome)) {
      result = { outcome: 'UNKNOWN', provider_message_id: null, error_code: COMMUNICATION_ERROR_CODES.reconciliationRequired, retryable: false };
    }
    return finalize(started, result);
  }

  async function deliverClaim(claim) {
    const started = await startClaim(claim);
    return started === null ? null : sendOutsideTransaction(started);
  }

  async function deliver({ deliveryId }) {
    if (!enabled) return publicError(COMMUNICATION_ERROR_CODES.disabled);
    if (typeof deliveryId !== 'string' || !UUID_PATTERN.test(deliveryId)) return publicError(COMMUNICATION_ERROR_CODES.deliveryNotFound);
    await recoverExpiredSending();
    const claim = await claimOne(deliveryId);
    return claim === null ? null : deliverClaim(claim);
  }

  async function getDelivery({ deliveryId }) {
    if (!enabled) return publicError(COMMUNICATION_ERROR_CODES.disabled);
    if (typeof deliveryId !== 'string' || !UUID_PATTERN.test(deliveryId)) return publicError(COMMUNICATION_ERROR_CODES.deliveryNotFound);
    const result = await pool.query(
      `SELECT id::text, outbox_id::text, status, provider, attempt_count,
              last_error_code, side_effect_state, sent_at
         FROM communication.delivery WHERE id = $1::uuid`, [deliveryId],
    );
    return result.rowCount === 1 ? deliveryView(result.rows[0]) : null;
  }

  async function runOnce({ limit = batchSize } = {}) {
    if (!enabled) return Object.freeze({ processed: 0, results: Object.freeze([]), disabled: true });
    if (!Number.isInteger(limit) || limit < 1 || limit > batchSize) throw new TypeError('Worker limit exceeds bounded batch size.');
    await recoverExpiredSending(limit);
    const results = [];
    for (let index = 0; index < limit; index += 1) {
      const claim = await claimOne();
      if (claim === null) break;
      const result = await deliverClaim(claim);
      if (result !== null) results.push(result);
    }
    return Object.freeze({ processed: results.length, results: Object.freeze(results), disabled: false });
  }

  return Object.freeze({ runOnce, deliver, getDelivery, recoverExpiredSending });
}

export function createCommunicationReconciliationPort({ pool, now = () => new Date() } = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof now !== 'function') throw new TypeError('Reconciliation port configuration is invalid.');
  return Object.freeze({
    async reconcileUnknownDelivery({ deliveryId, expectedStatus, resolution, reasonCode, authorized = false }) {
      if (authorized !== true) return publicError(COMMUNICATION_ERROR_CODES.reconciliationUnauthorized);
      if (expectedStatus !== 'RECONCILIATION_REQUIRED' || !RESOLUTIONS.has(resolution)
        || typeof deliveryId !== 'string' || !UUID_PATTERN.test(deliveryId)
        || typeof reasonCode !== 'string' || !/^[A-Z0-9_]{1,128}$/u.test(reasonCode)) {
        return publicError(COMMUNICATION_ERROR_CODES.commandInvalid);
      }
      const reconciledAt = validDate(now);
      return withTransaction(pool, async (transaction) => {
        const selected = await transaction.query(
          `SELECT id::text, outbox_id::text, status, provider, attempt_count,
                  last_error_code, side_effect_state, sent_at
             FROM communication.delivery WHERE id = $1::uuid FOR UPDATE`,
          [deliveryId],
        );
        if (selected.rowCount !== 1) return publicError(COMMUNICATION_ERROR_CODES.deliveryNotFound);
        if (selected.rows[0].status !== expectedStatus) return publicError(COMMUNICATION_ERROR_CODES.leaseConflict);
        const attemptNo = Number(selected.rows[0].attempt_count) + 1;
        const target = resolution === 'CONFIRMED_SENT'
          ? { status: 'SENT', side: 'ACKNOWLEDGED', outcome: 'SENT', sentAt: reconciledAt, sendStarted: 'KEEP' }
          : resolution === 'CONFIRMED_NOT_SENT_REQUEUE'
            ? { status: 'PENDING', side: 'NOT_ATTEMPTED', outcome: 'RETRY_SCHEDULED', sentAt: null, sendStarted: null }
            : { status: 'CANCELLED', side: 'UNKNOWN', outcome: 'CANCELLED', sentAt: null, sendStarted: 'KEEP' };
        const updated = await transaction.query(
          `UPDATE communication.delivery
              SET status = $2, side_effect_state = $3, attempt_count = $4,
                  next_attempt_at = $5::timestamptz, lease_token = NULL, lease_expires_at = NULL,
                  send_started_at = CASE WHEN $6::boolean THEN send_started_at ELSE NULL END,
                  last_error_code = $7, sent_at = $8::timestamptz, updated_at = $5::timestamptz
            WHERE id = $1::uuid
            RETURNING id::text, outbox_id::text, status, provider, attempt_count,
                      last_error_code, side_effect_state, sent_at`,
          [deliveryId, target.status, target.side, attemptNo, reconciledAt,
            target.sendStarted === 'KEEP', reasonCode, target.sentAt],
        );
        await transaction.query(
          `INSERT INTO communication.delivery_attempt (
             delivery_id, attempt_no, outcome, side_effect_state, error_code, started_at, completed_at
           ) VALUES ($1::uuid,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz)`,
          [deliveryId, attemptNo, target.outcome, target.side, reasonCode, reconciledAt],
        );
        return deliveryView(updated.rows[0]);
      });
    },
  });
}

export function createCommunicationDeliveryOperatorPort({ pool, now = () => new Date() } = {}) {
  if (!pool || typeof pool.connect !== 'function' || typeof now !== 'function') throw new TypeError('Delivery operator port configuration is invalid.');
  return Object.freeze({
    async scheduleRetry({ deliveryId, authorized = false, reasonCode = 'OPERATOR_RETRY' }) {
      if (authorized !== true) return publicError(COMMUNICATION_ERROR_CODES.senderUnauthorized);
      if (typeof deliveryId !== 'string' || !UUID_PATTERN.test(deliveryId)
        || typeof reasonCode !== 'string' || !/^[A-Z0-9_]{1,128}$/u.test(reasonCode)) {
        return publicError(COMMUNICATION_ERROR_CODES.commandInvalid);
      }
      const occurredAt = validDate(now);
      return withTransaction(pool, async (transaction) => {
        const selected = await transaction.query(
          `SELECT id::text,outbox_id::text,status,provider,attempt_count,last_error_code,side_effect_state,sent_at
             FROM communication.delivery WHERE id=$1::uuid FOR UPDATE`, [deliveryId]);
        if (selected.rowCount !== 1) return publicError(COMMUNICATION_ERROR_CODES.deliveryNotFound);
        const row = selected.rows[0];
        if (row.status === 'PENDING') return deliveryView(row);
        if (row.status === 'RECONCILIATION_REQUIRED') return publicError(COMMUNICATION_ERROR_CODES.reconciliationRequired);
        if (row.status !== 'DEAD_LETTER' || row.side_effect_state !== 'NOT_ATTEMPTED') {
          return publicError(COMMUNICATION_ERROR_CODES.leaseConflict);
        }
        const attemptNo = Number(row.attempt_count) + 1;
        const updated = await transaction.query(
          `UPDATE communication.delivery
              SET status='PENDING',side_effect_state='NOT_ATTEMPTED',attempt_count=$2,
                  next_attempt_at=$3::timestamptz,lease_token=NULL,lease_expires_at=NULL,
                  send_started_at=NULL,last_error_code=$4,updated_at=$3::timestamptz
            WHERE id=$1::uuid
            RETURNING id::text,outbox_id::text,status,provider,attempt_count,last_error_code,side_effect_state,sent_at`,
          [deliveryId, attemptNo, occurredAt, reasonCode],
        );
        await transaction.query(
          `INSERT INTO communication.delivery_attempt
             (delivery_id,attempt_no,outcome,side_effect_state,error_code,started_at,completed_at)
           VALUES ($1::uuid,$2,'RETRY_SCHEDULED','NOT_ATTEMPTED',$3,$4::timestamptz,$4::timestamptz)`,
          [deliveryId, attemptNo, reasonCode, occurredAt],
        );
        return deliveryView(updated.rows[0]);
      });
    },
  });
}
