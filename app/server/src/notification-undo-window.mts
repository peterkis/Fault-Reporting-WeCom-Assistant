import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import { failP2016 } from './p2-016-domain-contracts.mjs';
import { assertEpochMsString } from './platform/time-contract.mjs';

export const DEFAULT_CLOSURE_NOTIFICATION_UNDO_WINDOW_MS = 10_000;
export const DEFAULT_CLAIM_NOTIFICATION_UNDO_WINDOW_MS = 10_000;
export const MAX_NOTIFICATION_UNDO_WINDOW_MS = 3_600_000;
export const CLAIM_UNDONE_BEFORE_NOTIFICATION_REASON = 'CLAIM_UNDONE_BEFORE_NOTIFICATION';

// Both projection and cancellation use the same half-open interval and persisted events.
export const CLAIM_RETURN_WINDOW_SQL = `
  (returned.aggregate_version, returned.event_ordinal) > (claimed.aggregate_version, claimed.event_ordinal)
  AND returned.created_at >= claimed.created_at
  AND returned.created_at < claimed.created_at + $3::integer * interval '1 millisecond'`;

export function normalizeNotificationUndoWindowMs(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_NOTIFICATION_UNDO_WINDOW_MS) {
    failP2016('FLAG_INVALID', 503);
  }
  return value;
}

/** Schedules an unattempted PENDING delivery for future execution in compliance with ARCH-005 time pair checks. */
export async function delayDeliveryInTransaction({
  transaction,
  deliveryId,
  nextAttemptEpochMs,
}: {
  transaction: PostgresTransaction;
  deliveryId: string;
  nextAttemptEpochMs: string;
}): Promise<void> {
  const epoch = assertEpochMsString(nextAttemptEpochMs);
  await transaction.query(
    `UPDATE communication.delivery
        SET next_attempt_epoch_ms = $2::bigint,
            next_attempt_at = platform.local_from_epoch_ms($2::bigint)
      WHERE id = $1::uuid AND status = 'PENDING' AND attempt_count = 0`,
    [deliveryId, epoch],
  );
}
