import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { DecisionRow } from './p2-015-decision-store.mjs';
import type { P2015ResultCode } from '../contracts/p2_015_contracts.js';
export type ReviewResolutionCode = 'CONFIRM_TICKET_ELIGIBLE' | 'REQUEST_DESCRIPTION' | 'CLASSIFY_SERVICE_REQUEST' | 'CLASSIFY_BUSINESS_CONSULTATION' | 'ACKNOWLEDGE' | 'MARK_OUT_OF_SCOPE' | 'LINK_EXISTING_JOURNEY' | 'KEEP_INCIDENT_REVIEW_CANDIDATE' | 'CANCEL_REVIEW';
export type ReviewStatus = 'PENDING' | 'RESOLVED' | 'CANCELLED';
export type ReviewPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export interface ReviewPrincipal { principal_id: string }
export interface ReviewAuthorizer { authorizedJourneyIds(input: { principal: ReviewPrincipal; operation: string; review_id?: string }): Promise<string[]> }
export interface ReviewEnqueue { decision_id: string; journey_id: string; service_intake_id: string; linked_ticket_id?: string | null; review_reason_code: string; basis_input_revision?: string | number | null; priority?: ReviewPriority }
export interface ReviewRow extends ReviewEnqueue { id: string; review_key: string; priority: ReviewPriority; status: ReviewStatus; row_version: string; created_at: string; safe_result?: unknown }
type ResolutionRow = ReviewRow & Omit<DecisionRow, 'id' | 'status' | 'safe_result'> & { safe_result: DecisionRow['safe_result']; resolution_command_id: string | null; resolution_command_hash: string | null };
export interface ReviewCommand { review_id: string; resolution_code: ReviewResolutionCode; resolution_reason_code: string; expected_row_version: string; client_command_id: string; resolved_at: string }
export type ReviewResolution = { review_id: string; status: ReviewStatus; replayed: true } | { id: string; status: 'RESOLVED' | 'CANCELLED'; row_version: string; resolution_decision_id: string; replayed: false };
export type ManualReviewStore = ReturnType<typeof createManualReviewStore>;
import {
  P2_015_ERROR_CODES,
  P2_015_LIMITS,
  failP2015,
  freezePublic,
  normalizeLimit,
  safeHash,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

const RESOLUTIONS = new Set(['CONFIRM_TICKET_ELIGIBLE','REQUEST_DESCRIPTION','CLASSIFY_SERVICE_REQUEST',
  'CLASSIFY_BUSINESS_CONSULTATION','ACKNOWLEDGE','MARK_OUT_OF_SCOPE','LINK_EXISTING_JOURNEY',
  'KEEP_INCIDENT_REVIEW_CANDIDATE','CANCEL_REVIEW']);
const RESULT_BY_RESOLUTION: Readonly<Record<ReviewResolutionCode, P2015ResultCode>> = Object.freeze({
  CONFIRM_TICKET_ELIGIBLE: 'TICKET_ELIGIBLE', REQUEST_DESCRIPTION: 'NEEDS_DESCRIPTION',
  CLASSIFY_SERVICE_REQUEST: 'SERVICE_REQUEST', CLASSIFY_BUSINESS_CONSULTATION: 'BUSINESS_CONSULTATION',
  ACKNOWLEDGE: 'ACKNOWLEDGEMENT', MARK_OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  LINK_EXISTING_JOURNEY: 'RELATED_FOLLOW_UP', KEEP_INCIDENT_REVIEW_CANDIDATE: 'INCIDENT_REVIEW_CANDIDATE',
  CANCEL_REVIEW: 'MANUAL_REVIEW_REQUIRED',
});

export function createManualReviewStore({ authorizer = null, webSource = null }: { authorizer?: ReviewAuthorizer | null; webSource?: boolean | null } = {}) {
  if (![true, false, null].includes(webSource)) failP2015(P2_015_ERROR_CODES.inputInvalid);
  async function supportsWebSource(transaction: PostgresTransaction) {
    if (webSource !== null) return webSource;
    const result = await transaction.query<{ count: number }>(`SELECT count(*)::integer AS count
      FROM information_schema.columns WHERE table_schema='intake' AND table_name='deterministic_decision'
        AND column_name IN ('source_kind','primary_web_submission_id','basis_input_revision')`);
    return result.rows[0]?.count === 3;
  }
  const allowedJourneyIds = async (input: Parameters<ReviewAuthorizer['authorizedJourneyIds']>[0]) => {
    if (!authorizer || typeof authorizer.authorizedJourneyIds !== 'function') failP2015(P2_015_ERROR_CODES.authorizationDenied);
    const ids = await authorizer.authorizedJourneyIds(snapshotP2015Json(input));
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) failP2015(P2_015_ERROR_CODES.authorizationDenied);
    return ids;
  };
  return Object.freeze({
    async enqueue({ transaction, input }: { transaction: PostgresTransaction; input: ReviewEnqueue }) {
      const value = snapshotP2015Json(input);
      const reviewKey = `review_v1_${safeHash({ decision_id: value.decision_id, reason: value.review_reason_code, basis_input_revision: value.basis_input_revision ?? null })}`;
      const useWebSource = await supportsWebSource(transaction);
      const basisColumns = useWebSource ? ',basis_input_revision' : '';
      const basisValues = useWebSource ? ',$8' : '';
      const result = await transaction.query<ReviewRow>(
        `INSERT INTO intake.manual_review_item (
           review_key,journey_id,decision_id,service_intake_id,linked_ticket_id,review_reason_code,priority${basisColumns}
         ) VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7${basisValues})
         ON CONFLICT (review_key) DO UPDATE SET review_key=EXCLUDED.review_key
         RETURNING id::text,review_key,journey_id::text,decision_id::text,service_intake_id::text,
           linked_ticket_id::text,review_reason_code,priority${useWebSource ? ',basis_input_revision' : ''},status,row_version::text,created_at`,
        [reviewKey, value.journey_id, value.decision_id, value.service_intake_id,
          value.linked_ticket_id ?? null, value.review_reason_code, value.priority ?? 'NORMAL',
          ...(useWebSource ? [value.basis_input_revision ?? null] : [])],
      );
      return freezePublic(result.rows[0] as ReviewRow);
    },

    async list({ transaction, principal, cursor = null, limit, priority = null }: { transaction: PostgresTransaction; principal: ReviewPrincipal; cursor?: { priority_rank: number; created_at: string; id: string } | null; limit?: number; priority?: ReviewPriority | null }) {
      if (priority !== null && !['LOW','NORMAL','HIGH','URGENT'].includes(priority)) failP2015(P2_015_ERROR_CODES.inputInvalid);
      const ids = await allowedJourneyIds({ principal, operation: 'LIST_MANUAL_REVIEWS' });
      const pageLimit = normalizeLimit(limit, P2_015_LIMITS.defaultReviewPage, P2_015_LIMITS.maximumReviewPage);
      if (ids.length === 0) return freezePublic({ items: [], next_cursor: null });
      const value = cursor === null ? null : snapshotP2015Json(cursor);
      const result = await transaction.query<ReviewRow>(
        `SELECT id::text,review_key,journey_id::text,decision_id::text,service_intake_id::text,
                linked_ticket_id::text,review_reason_code,priority,status,row_version::text,created_at
           FROM intake.manual_review_item
          WHERE journey_id=ANY($1::uuid[]) AND status='PENDING'
            AND ($6::text IS NULL OR priority=$6::text)
            AND ($2::integer IS NULL OR ((CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END),created_at,id)
              > ($2::integer,$3::timestamp without time zone,$4::uuid))
          ORDER BY (CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END),created_at,id LIMIT $5`,
        [ids, value?.priority_rank ?? null, value?.created_at ?? null, value?.id ?? null, pageLimit + 1, priority],
      );
      const rows = result.rows.slice(0, pageLimit);
      const last = rows.at(-1);
      const rank = (priority: ReviewPriority) => ({ URGENT: 1, HIGH: 2, NORMAL: 3, LOW: 4 })[priority];
      return freezePublic({ items: rows, next_cursor: result.rows.length > pageLimit ? { priority_rank: rank((last as ReviewRow).priority), created_at: (last as ReviewRow).created_at, id: (last as ReviewRow).id } : null });
    },

    async get({ transaction, principal, review_id: reviewId }: { transaction: PostgresTransaction; principal: ReviewPrincipal; review_id: string }) {
      const ids = await allowedJourneyIds({ principal, operation: 'GET_MANUAL_REVIEW', review_id: reviewId });
      const result = await transaction.query<ReviewRow>(
        `SELECT review.id::text,review.review_key,review.journey_id::text,review.decision_id::text,
                review.service_intake_id::text,review.linked_ticket_id::text,review.review_reason_code,
                review.priority,review.status,review.row_version::text,review.created_at,decision.safe_result
           FROM intake.manual_review_item review JOIN intake.deterministic_decision decision ON decision.id=review.decision_id
          WHERE review.id=$1::uuid AND review.journey_id=ANY($2::uuid[])`, [reviewId, ids],
      );
      if (result.rowCount !== 1) failP2015(P2_015_ERROR_CODES.authorizationDenied);
      return freezePublic(result.rows[0] as ReviewRow);
    },

    async resolve({ transaction, principal, command }: { transaction: PostgresTransaction; principal: ReviewPrincipal; command: ReviewCommand }): Promise<ReviewResolution> {
      const value = snapshotP2015Json(command);
      if (!RESOLUTIONS.has(value.resolution_code)) failP2015(P2_015_ERROR_CODES.inputInvalid);
      const ids = await allowedJourneyIds({ principal, operation: 'RESOLVE_MANUAL_REVIEW', review_id: value.review_id });
      const useWebSource = await supportsWebSource(transaction);
      const webRetentionJoin = useWebSource ? `LEFT JOIN intake.web_request_binding web_binding ON web_binding.intake_id=review.service_intake_id
          LEFT JOIN intake.service_intake web_intake ON web_intake.id=review.service_intake_id` : '';
      const activeWebPredicate = useWebSource && value.resolution_code !== 'CANCEL_REVIEW'
        ? ` AND (decision.source_kind <> 'WEB' OR (web_binding.revoked_at IS NULL
            AND web_binding.retention_until>platform.local_now() AND web_intake.retention_until>platform.local_now()))` : '';
      const selected = await transaction.query<ResolutionRow>(
        `SELECT review.*,decision.safe_result,decision.channel_leg_id,decision.conversation_session_id,
                decision.source_window_start_sequence,decision.source_window_end_sequence,
                decision.source_message_count,decision.source_hash,decision.catalog_version,
                decision.rule_set_version,decision.engine_version,decision.decision_policy_version,
                decision.input_hash,to_char(decision.observed_at,'YYYY-MM-DD HH24:MI:SS') AS observed_at${useWebSource ? ',decision.source_kind,decision.primary_web_submission_id,decision.basis_input_revision' : ''}
           FROM intake.manual_review_item review JOIN intake.deterministic_decision decision ON decision.id=review.decision_id
           ${webRetentionJoin}
          WHERE review.id=$1::uuid AND review.journey_id=ANY($2::uuid[])${activeWebPredicate} FOR UPDATE OF review`, [value.review_id, ids],
      );
      if (selected.rowCount !== 1) failP2015(P2_015_ERROR_CODES.authorizationDenied);
      const row = (selected.rows[0] as ResolutionRow);
      const commandHash = safeHash({ review_id: value.review_id, resolution_code: value.resolution_code,
        resolution_reason_code: value.resolution_reason_code, expected_row_version: value.expected_row_version });
      if (row.status !== 'PENDING') {
        if (row.resolution_command_id === value.client_command_id && row.resolution_command_hash === commandHash) return freezePublic({ review_id: value.review_id, status: row.status, replayed: true });
        failP2015(P2_015_ERROR_CODES.commandConflict);
      }
      if (String(row.row_version) !== String(value.expected_row_version)) failP2015(P2_015_ERROR_CODES.versionConflict);
      if (useWebSource && row.source_kind === 'WEB') {
        const current = await transaction.query<{ input_revision: string }>(
          `SELECT input_revision FROM intake.web_request_binding
            WHERE intake_id=$1::uuid AND revoked_at IS NULL FOR UPDATE`, [row.service_intake_id],
        );
        if ((current.rowCount !== 1 || String((current.rows[0] as { input_revision: string }).input_revision) !== String(row.basis_input_revision))
          && value.resolution_code !== 'CANCEL_REVIEW') {
          // A stale item cannot approve old evidence; an operator may still
          // explicitly retire it so the queue does not contain an
          // unresolvable review forever.
          failP2015(P2_015_ERROR_CODES.versionConflict);
        }
      }
      const overrideResultCode = value.resolution_code === 'CANCEL_REVIEW'
        ? 'MANUAL_REVIEW_REQUIRED' : RESULT_BY_RESOLUTION[value.resolution_code];
      const ordinal = await transaction.query<{ ordinal: number }>('SELECT COALESCE(max(decision_ordinal),0)::integer+1 AS ordinal FROM intake.deterministic_decision WHERE journey_id=$1::uuid', [row.journey_id]);
      const safeResult = { ...row.safe_result, result_code: overrideResultCode,
        reason_code: value.resolution_reason_code, manual_review_required: false,
        human_override: { resolution_code: value.resolution_code, principal_id: principal.principal_id } };
      const resultHash = safeHash(safeResult);
      const sourceColumns = useWebSource ? 'source_kind,primary_web_submission_id,basis_input_revision,' : '';
      const sourceValues = useWebSource ? '$6,$7::uuid,$8,' : '';
      const parameter = (number: number) => `$${number + (useWebSource ? 3 : 0)}`;
      const override = await transaction.query<{ id: string }>(
        `INSERT INTO intake.deterministic_decision (
           journey_id,channel_leg_id,service_intake_id,conversation_session_id,linked_ticket_id,
           ${sourceColumns}
           decision_ordinal,decision_key,source_window_start_sequence,source_window_end_sequence,
           source_message_count,source_hash,catalog_version,rule_set_version,engine_version,
           decision_policy_version,result_code,reason_code,input_hash,result_hash,safe_result,
           requires_manual_review,ticket_creation_recommended,incident_review_candidate,status,observed_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,${sourceValues}${parameter(6)},${parameter(7)},${parameter(8)},${parameter(9)},${parameter(10)},${parameter(11)},${parameter(12)},${parameter(13)},${parameter(14)},${parameter(15)},${parameter(16)},${parameter(17)},${parameter(18)},${parameter(19)},${parameter(20)}::jsonb,false,${parameter(21)},${parameter(22)},'HUMAN_OVERRIDDEN',${parameter(23)}::timestamp without time zone)
         RETURNING id::text`,
        [row.journey_id,row.channel_leg_id,row.service_intake_id,row.conversation_session_id,row.linked_ticket_id,
          ...(useWebSource ? [row.source_kind ?? 'BOT',row.source_kind === 'WEB' ? row.primary_web_submission_id : null,
            row.source_kind === 'WEB' ? row.basis_input_revision : null] : []),
          (ordinal.rows[0] as { ordinal: number }).ordinal,`human_v1_${safeHash({ review: value.review_id, command: value.client_command_id })}`,
          row.source_window_start_sequence,row.source_window_end_sequence,row.source_message_count,row.source_hash,
          row.catalog_version,row.rule_set_version,row.engine_version,row.decision_policy_version,
          overrideResultCode,value.resolution_reason_code,row.input_hash,resultHash,
          JSON.stringify(safeResult),['TICKET_ELIGIBLE','SERVICE_REQUEST','INCIDENT_REVIEW_CANDIDATE'].includes(overrideResultCode),
          overrideResultCode === 'INCIDENT_REVIEW_CANDIDATE',row.observed_at],
      );
      const status = value.resolution_code === 'CANCEL_REVIEW' ? 'CANCELLED' : 'RESOLVED';
      const updated = await transaction.query<{ id: string; status: 'RESOLVED' | 'CANCELLED'; row_version: string; resolution_decision_id: string }>(
        `UPDATE intake.manual_review_item SET status=$2,row_version=row_version+1,
           resolution_command_id=$3::uuid,resolution_command_hash=$4,resolution_code=$5,
           resolution_reason_code=$6,resolved_by_principal_id=$7::uuid,resolution_decision_id=$8::uuid,
           resolved_at=$9::timestamp without time zone,updated_at=$9::timestamp without time zone
         WHERE id=$1::uuid AND status='PENDING' AND row_version=$10
         RETURNING id::text,status,row_version::text,resolution_decision_id::text`,
        [value.review_id,status,value.client_command_id,commandHash,value.resolution_code,
          value.resolution_reason_code,principal.principal_id,(override.rows[0] as { id: string }).id,value.resolved_at,value.expected_row_version],
      );
      if (updated.rowCount !== 1) failP2015(P2_015_ERROR_CODES.versionConflict);
      return freezePublic({ ...(updated.rows[0] as { id: string; status: 'RESOLVED' | 'CANCELLED'; row_version: string; resolution_decision_id: string }), replayed: false });
    },
  });
}
