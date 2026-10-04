import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
export type ContinuationPurpose = 'GROUP_TO_DIRECT_GUIDANCE' | 'USER_SELECTION' | 'EXPLICIT_CONTINUATION';
export interface ContinuationRow { id: string; journey_id: string; origin_leg_id: string; target_leg_id: string | null; purpose: ContinuationPurpose; state: 'ISSUED' | 'BOUND' | 'CONSUMED' | 'REVOKED' | 'EXPIRED'; row_version: string; issued_at: string; issued_epoch_ms: string; expires_at: string; expires_epoch_ms: string; reporter_binding_hash: string; bot_binding_hash: string }
export interface ContinuationIssue { journey_id: string; origin_leg_id: string; purpose: ContinuationPurpose; reporter_binding_hash: string; bot_binding_hash: string; issue_idempotency_key: string; issued_at: string; issued_epoch_ms: string; ttl_minutes?: number }
export interface ContinuationConsume { token: string; purpose: ContinuationPurpose; reporter_binding_hash: string; bot_binding_hash: string; target_leg_id: string; consumed_at: string; consumed_epoch_ms: string }
import { createHash } from 'node:crypto';
import {
  P2_015_ERROR_CODES,
  P2_015_LIMITS,
  defaultTokenGenerator,
  failP2015,
  freezePublic,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

const PURPOSES = new Set(['GROUP_TO_DIRECT_GUIDANCE', 'USER_SELECTION', 'EXPLICIT_CONTINUATION']);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createContinuationRefService({ tokenGenerator = defaultTokenGenerator } = {}) {
  if (typeof tokenGenerator !== 'function') failP2015(P2_015_ERROR_CODES.inputInvalid);
  return Object.freeze({
    async issue({ transaction, input }: { transaction: PostgresTransaction; input: ContinuationIssue }) {
      if (!transaction?.query) failP2015(P2_015_ERROR_CODES.storageFailed);
      const value = snapshotP2015Json(input);
      if (!PURPOSES.has(value.purpose)) failP2015(P2_015_ERROR_CODES.inputInvalid);
      const ttlMinutes = value.ttl_minutes ?? P2_015_LIMITS.continuationTtlMinutes;
      if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > P2_015_LIMITS.continuationTtlMinutes) failP2015(P2_015_ERROR_CODES.limitExceeded);
      const existing = await transaction.query<ContinuationRow>(
        `SELECT id::text, journey_id::text, origin_leg_id::text, target_leg_id::text,
                purpose, state, row_version::text, issued_at, issued_epoch_ms::text,
                expires_at, expires_epoch_ms::text
           FROM intake.continuation_ref WHERE issue_idempotency_key=$1 FOR UPDATE`,
        [value.issue_idempotency_key],
      );
      if (existing.rowCount === 1) return freezePublic({ ...existing.rows[0], token: null, replayed: true });
      const token = tokenGenerator();
      if (typeof token !== 'string' || token.length < 32 || token.length > 256) failP2015(P2_015_ERROR_CODES.inputInvalid);
      const tokenHash = hashToken(token);
      const expiresEpochMs = String(BigInt(value.issued_epoch_ms) + BigInt(ttlMinutes * 60_000));
      const inserted = await transaction.query<ContinuationRow>(
        `INSERT INTO intake.continuation_ref (
           journey_id, origin_leg_id, token_hash, purpose, reporter_binding_hash,
           bot_binding_hash, state, issue_idempotency_key, issued_at, issued_epoch_ms,
           expires_at, expires_epoch_ms
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,'ISSUED',$7,
           $8::timestamp without time zone,$9::bigint,platform.local_from_epoch_ms($10::bigint),$10::bigint)
         RETURNING id::text, journey_id::text, origin_leg_id::text, target_leg_id::text,
           purpose, state, row_version::text, issued_at, issued_epoch_ms::text,
           expires_at, expires_epoch_ms::text`,
        [value.journey_id, value.origin_leg_id, tokenHash, value.purpose,
          value.reporter_binding_hash, value.bot_binding_hash, value.issue_idempotency_key,
          value.issued_at, value.issued_epoch_ms, expiresEpochMs],
      );
      return freezePublic({ ...inserted.rows[0], token, replayed: false });
    },

    async consume({ transaction, input }: { transaction: PostgresTransaction; input: ContinuationConsume }) {
      if (!transaction?.query) failP2015(P2_015_ERROR_CODES.storageFailed);
      const value = snapshotP2015Json(input);
      if (typeof value.token !== 'string' || !PURPOSES.has(value.purpose)) failP2015(P2_015_ERROR_CODES.inputInvalid);
      const found = await transaction.query<ContinuationRow>(
        `SELECT id::text, journey_id::text, state, purpose, reporter_binding_hash,
                bot_binding_hash, expires_epoch_ms::text, target_leg_id::text, row_version::text
           FROM intake.continuation_ref WHERE token_hash=$1 FOR UPDATE`, [hashToken(value.token)],
      );
      if (found.rowCount !== 1) failP2015(P2_015_ERROR_CODES.continuationInvalid);
      const row = (found.rows[0] as ContinuationRow);
      if (row.purpose !== value.purpose || row.reporter_binding_hash !== value.reporter_binding_hash
        || row.bot_binding_hash !== value.bot_binding_hash) failP2015(P2_015_ERROR_CODES.continuationBindingMismatch);
      if (['CONSUMED', 'REVOKED', 'EXPIRED'].includes(row.state)) {
        failP2015(row.state === 'CONSUMED' ? P2_015_ERROR_CODES.continuationConsumed : P2_015_ERROR_CODES.continuationExpired);
      }
      if (BigInt(row.expires_epoch_ms) < BigInt(value.consumed_epoch_ms)) {
        await transaction.query<ContinuationRow>(`UPDATE intake.continuation_ref SET state='EXPIRED',row_version=row_version+1,updated_at=$2::timestamp without time zone WHERE id=$1::uuid`, [row.id, value.consumed_at]);
        failP2015(P2_015_ERROR_CODES.continuationExpired);
      }
      const updated = await transaction.query<ContinuationRow>(
        `UPDATE intake.continuation_ref SET state='CONSUMED',target_leg_id=$2::uuid,
           consumed_at=$3::timestamp without time zone,consumed_epoch_ms=$4::bigint,
           row_version=row_version+1,updated_at=$3::timestamp without time zone
         WHERE id=$1::uuid RETURNING id::text,journey_id::text,target_leg_id::text,state,row_version::text,consumed_at,consumed_epoch_ms::text`,
        [row.id, value.target_leg_id, value.consumed_at, value.consumed_epoch_ms],
      );
      return freezePublic({ ...updated.rows[0], replayed: false });
    },

    async revoke({ transaction, id, revoked_at: revokedAt, revoked_epoch_ms: revokedEpochMs }: { transaction: PostgresTransaction; id: string; revoked_at: string; revoked_epoch_ms: string }) {
      const updated = await transaction.query<ContinuationRow>(
        `UPDATE intake.continuation_ref SET state='REVOKED',revoked_at=$2::timestamp without time zone,
           revoked_epoch_ms=$3::bigint,row_version=row_version+1,updated_at=$2::timestamp without time zone
         WHERE id=$1::uuid AND state IN ('ISSUED','BOUND') RETURNING id::text,state,row_version::text`,
        [id, revokedAt, revokedEpochMs],
      );
      if (updated.rowCount !== 1) failP2015(P2_015_ERROR_CODES.continuationInvalid);
      return freezePublic(updated.rows[0]);
    },
  });
}
