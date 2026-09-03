import {
  P2_015_ENTRY_MODES,
  P2_015_ERROR_CODES,
  failP2015,
  freezePublic,
  hmacIdentity,
  safeHash,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

const ENTRY_CHANNEL = Object.freeze({
  GROUP_MENTION_INLINE: 'WECOM_GROUP',
  GROUP_MENTION_TO_DIRECT_GUIDED: 'WECOM_GROUP',
  DIRECT_ORGANIC: 'WECOM_DIRECT',
});

export function createReporterDirectoryPort({ resolveProfile } = {}) {
  return Object.freeze({
    async resolve(input) {
      if (typeof resolveProfile !== 'function') return freezePublic({ status: 'DEFERRED', snapshot: {} });
      try {
        const result = snapshotP2015Json(await resolveProfile(snapshotP2015Json(input)));
        if (!['RESOLVED', 'DEFERRED', 'NOT_FOUND', 'NOT_REQUIRED'].includes(result.status)) failP2015(P2_015_ERROR_CODES.inputInvalid);
        const snapshot = result.status === 'RESOLVED' ? snapshotP2015Json(result.snapshot ?? {}) : {};
        return freezePublic({ status: result.status, snapshot });
      } catch (error) {
        if (error?.code === P2_015_ERROR_CODES.inputInvalid) throw error;
        return freezePublic({ status: 'DEFERRED', snapshot: {} });
      }
    },
  });
}

export const MockResolvedDirectory = (snapshot = {}) => createReporterDirectoryPort({
  resolveProfile: async () => ({ status: 'RESOLVED', snapshot: { source: 'WECOM_DIRECTORY', version: 'mock-v1', departments: [], ...snapshot } }),
});
export const DeferredDirectory = () => createReporterDirectoryPort({ resolveProfile: async () => ({ status: 'DEFERRED' }) });
export const NotFoundDirectory = () => createReporterDirectoryPort({ resolveProfile: async () => ({ status: 'NOT_FOUND' }) });
export const FaultingDirectory = () => createReporterDirectoryPort({ resolveProfile: async () => { throw new Error('directory unavailable'); } });

export function reporterIdentityHash({ provider, bot_id: botId, reporter_external_id: reporterExternalId, hmac_key: hmacKey }) {
  return hmacIdentity(`${provider}\u0000${botId}\u0000${reporterExternalId}`, hmacKey);
}

function publicJourney(row, replayed = false) {
  return freezePublic({
    id: row.id,
    origin_intake_id: row.origin_intake_id,
    origin_session_id: row.origin_session_id,
    current_session_id: row.current_session_id,
    linked_ticket_id: row.linked_ticket_id,
    entry_mode: row.entry_mode,
    origin_channel: row.origin_channel,
    current_channel: row.current_channel,
    profile_resolution_status: row.profile_resolution_status,
    status: row.status,
    row_version: String(row.row_version),
    evaluation_due_at: row.evaluation_due_at,
    evaluation_due_epoch_ms: String(row.evaluation_due_epoch_ms),
    reported_at: row.reported_at,
    last_activity_at: row.last_activity_at,
    retention_until: row.retention_until,
    retention_until_epoch_ms: String(row.retention_until_epoch_ms),
    replayed,
  });
}

export function createContactJourneyStore() {
  return Object.freeze({
    async ensureJourney({ transaction, input }) {
      if (!transaction?.query) failP2015(P2_015_ERROR_CODES.storageFailed);
      const value = snapshotP2015Json(input);
      if (!P2_015_ENTRY_MODES.includes(value.entry_mode)) failP2015(P2_015_ERROR_CODES.inputInvalid);
      const originChannel = ENTRY_CHANNEL[value.entry_mode];
      const creationKey = `journey_v1_${safeHash({ intake: value.origin_intake_id, entry_mode: value.entry_mode })}`;
      const existing = await transaction.query(
        `SELECT id::text, origin_intake_id::text, origin_session_id::text, current_session_id::text,
                linked_ticket_id::text, entry_mode, origin_channel, current_channel,
                profile_resolution_status, status, row_version::text, evaluation_due_at,
                evaluation_due_epoch_ms::text, reported_at, last_activity_at, retention_until,
                retention_until_epoch_ms::text, reporter_identity_hash, profile_snapshot_hash
           FROM intake.contact_journey WHERE origin_intake_id = $1::uuid FOR UPDATE`,
        [value.origin_intake_id],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0];
        if (row.reporter_identity_hash !== value.reporter_identity_hash || row.entry_mode !== value.entry_mode) {
          failP2015(P2_015_ERROR_CODES.decisionConflict);
        }
        return publicJourney(row, true);
      }
      const profileSnapshot = snapshotP2015Json(value.profile_snapshot ?? {});
      const profileHash = safeHash(profileSnapshot);
      const inserted = await transaction.query(
        `INSERT INTO intake.contact_journey (
           creation_key, origin_intake_id, origin_session_id, current_session_id, linked_ticket_id,
           entry_mode, origin_channel, current_channel, reporter_identity_hash,
           profile_resolution_status, profile_snapshot, profile_snapshot_hash, status,
           evaluation_due_at, evaluation_due_epoch_ms, reported_at, last_activity_at,
           privacy_class, retention_until, retention_until_epoch_ms
         ) VALUES ($1,$2::uuid,$3::uuid,$3::uuid,$4::uuid,$5,$6,$6,$7,$8,$9::jsonb,$10,'OPEN',
           $11::timestamp without time zone,$12::bigint,$13::timestamp without time zone,
           $13::timestamp without time zone,$14,$15::timestamp without time zone,$16::bigint)
         RETURNING id::text, origin_intake_id::text, origin_session_id::text, current_session_id::text,
           linked_ticket_id::text, entry_mode, origin_channel, current_channel,
           profile_resolution_status, status, row_version::text, evaluation_due_at,
           evaluation_due_epoch_ms::text, reported_at, last_activity_at, retention_until,
           retention_until_epoch_ms::text`,
        [creationKey, value.origin_intake_id, value.session_id ?? null, value.linked_ticket_id ?? null,
          value.entry_mode, originChannel, value.reporter_identity_hash, value.profile_resolution_status,
          JSON.stringify(profileSnapshot), profileHash, value.evaluation_due_at, value.evaluation_due_epoch_ms,
          value.reported_at, value.privacy_class, value.retention_until, value.retention_until_epoch_ms],
      );
      return publicJourney(inserted.rows[0], false);
    },

    async ensureLeg({ transaction, input }) {
      if (!transaction?.query) failP2015(P2_015_ERROR_CODES.storageFailed);
      const value = snapshotP2015Json(input);
      const existing = await transaction.query(
        `SELECT id::text, journey_id::text, leg_ordinal, leg_type, source_intake_id::text,
                conversation_thread_id::text, conversation_session_id::text,
                origin_channel_message_id::text, status, row_version::text, opened_at, closed_at
           FROM intake.channel_leg WHERE source_intake_id = $1::uuid FOR UPDATE`,
        [value.source_intake_id],
      );
      if (existing.rowCount === 1) {
        if (existing.rows[0].journey_id !== value.journey_id) failP2015(P2_015_ERROR_CODES.decisionConflict);
        return freezePublic({ ...existing.rows[0], replayed: true });
      }
      const nextOrdinal = await transaction.query(
        'SELECT COALESCE(max(leg_ordinal),0)::integer + 1 AS ordinal FROM intake.channel_leg WHERE journey_id = $1::uuid',
        [value.journey_id],
      );
      const inserted = await transaction.query(
        `INSERT INTO intake.channel_leg (
           journey_id, leg_ordinal, leg_type, source_intake_id, conversation_thread_id,
           conversation_session_id, origin_channel_message_id, provider_context_hash,
           channel_identity_hash, reporter_identity_hash, status, opened_at
         ) VALUES ($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::bigint,$8,$9,$10,'OPEN',$11::timestamp without time zone)
         RETURNING id::text, journey_id::text, leg_ordinal, leg_type, source_intake_id::text,
           conversation_thread_id::text, conversation_session_id::text,
           origin_channel_message_id::text, status, row_version::text, opened_at, closed_at`,
        [value.journey_id, nextOrdinal.rows[0].ordinal, value.leg_type, value.source_intake_id,
          value.conversation_thread_id ?? null, value.conversation_session_id ?? null,
          value.origin_channel_message_id ?? null, value.provider_context_hash,
          value.channel_identity_hash, value.reporter_identity_hash, value.opened_at],
      );
      if (value.leg_type === 'DIRECT_GUIDED') {
        await transaction.query(
          `UPDATE intake.contact_journey SET current_channel='WECOM_DIRECT', current_session_id=$2::uuid,
             last_activity_at=GREATEST(last_activity_at,$3::timestamp without time zone), row_version=row_version+1, updated_at=GREATEST(created_at,platform.local_now())
           WHERE id=$1::uuid`, [value.journey_id, value.conversation_session_id ?? null, value.opened_at],
        );
      }
      return freezePublic({ ...inserted.rows[0], replayed: false });
    },

    async listEligibleGuided({ transaction, reporter_identity_hash: reporterHash, now_epoch_ms: nowEpochMs, limit = 10 }) {
      const result = await transaction.query(
        `SELECT DISTINCT journey.id::text, journey.entry_mode, journey.status,
                journey.reported_at, journey.linked_ticket_id::text
           FROM intake.contact_journey AS journey
           JOIN intake.continuation_ref AS continuation ON continuation.journey_id = journey.id
          WHERE journey.reporter_identity_hash=$1 AND journey.status IN ('OPEN','WAITING_DESCRIPTION')
            AND continuation.purpose='GROUP_TO_DIRECT_GUIDANCE'
            AND continuation.state IN ('ISSUED','BOUND') AND continuation.expires_epoch_ms >= $2::bigint
          ORDER BY journey.reported_at, journey.id LIMIT $3`,
        [reporterHash, nowEpochMs, limit],
      );
      return freezePublic(result.rows);
    },
  });
}

export function resolveDirectJourneyAssociation(input) {
  const value = snapshotP2015Json(input);
  const ordered = [
    ['PROVIDER_CONTEXT', value.provider_context_journey_id],
    ['EXISTING_DIRECT_BINDING', value.direct_binding_journey_id],
    ['CONTINUATION_REF', value.continuation_journey_id],
    ['EXPLICIT_REFERENCE', value.explicit_reference_journey_id],
  ];
  for (const [reason, journeyId] of ordered) if (typeof journeyId === 'string') return freezePublic({ outcome: 'LINK', reason, journey_id: journeyId });
  const candidates = Array.isArray(value.guided_candidates) ? value.guided_candidates : [];
  if (candidates.length === 1) return freezePublic({ outcome: 'LINK', reason: 'UNIQUE_GUIDED_JOURNEY', journey_id: candidates[0].id });
  if (candidates.length > 1) return freezePublic({ outcome: 'ASK_USER_TO_SELECT', reason: 'MULTIPLE_OPEN_JOURNEYS', candidates: candidates.slice(0, 10).map((item) => ({ id: item.id, service_code: item.service_code ?? null, ticket_suffix: item.ticket_suffix ?? null, reported_at: item.reported_at ?? null, safe_status: item.safe_status ?? item.status ?? null })) });
  return freezePublic({ outcome: 'DIRECT_ORGANIC', reason: 'NO_RELIABLE_ASSOCIATION' });
}
