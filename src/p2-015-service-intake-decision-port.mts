import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import type { P2015ResultCode } from '../contracts/p2_015_contracts.js';
export interface IntakeDecisionInput { result_code: P2015ResultCode; intake_id: string; expected_version?: number; occurred_at: string; trace_id: string; decision_id: string; reason_code?: string; catalog_version: string; rule_set_version: string }
export interface DecisionIntakeRow { id: string; request_type: string; status: string; version: number; pilot_ticket_id: string | null }
import { P2_015_ERROR_CODES, failP2015, freezePublic, snapshotP2015Json } from './p2-015-domain-contracts.mjs';

const TARGETS = Object.freeze({
  TICKET_ELIGIBLE: { request_type: 'INCIDENT', status: 'RECEIVED' },
  SERVICE_REQUEST: { request_type: 'SERVICE_REQUEST', status: 'RECEIVED' },
  NEEDS_DESCRIPTION: { request_type: null, status: 'WAITING_DESCRIPTION' },
  MANUAL_REVIEW_REQUIRED: { request_type: null, status: 'WAITING_TRIAGE' },
  BUSINESS_CONSULTATION: { request_type: 'QUESTION', status: 'COMPLETED' },
  ACKNOWLEDGEMENT: { request_type: 'CHATTER', status: 'COMPLETED' },
  OUT_OF_SCOPE: { request_type: 'UNKNOWN', status: 'IGNORED' },
});

export function createServiceIntakeDecisionPort() {
  return Object.freeze({
    async apply({ transaction, input }: { transaction: PostgresTransaction; input: IntakeDecisionInput }) {
      if (!transaction?.query) failP2015(P2_015_ERROR_CODES.storageFailed);
      const value = snapshotP2015Json(input);
      const target = (TARGETS as Partial<Record<P2015ResultCode, { request_type: string | null; status: string }>>)[value.result_code];
      if (!target) return freezePublic({ applied: false, replayed: true, reason: 'NO_INTAKE_STATE_CHANGE' });
      const selected = await transaction.query<DecisionIntakeRow>(
        `SELECT id::text,request_type,status,version,pilot_ticket_id::text
           FROM intake.service_intake WHERE id=$1::uuid FOR UPDATE`, [value.intake_id],
      );
      if (selected.rowCount !== 1) failP2015(P2_015_ERROR_CODES.storageFailed);
      const current = selected.rows[0] as DecisionIntakeRow;
      if (value.expected_version !== undefined && current.version !== value.expected_version) failP2015(P2_015_ERROR_CODES.versionConflict);
      if (current.pilot_ticket_id !== null || current.status === 'TICKET_CREATED') {
        return freezePublic({ applied: false, replayed: true, intake: current, reason: 'TICKET_ALREADY_LINKED' });
      }
      const nextRequestType = target.request_type ?? current.request_type;
      const nextStatus = target.status;
      if (current.request_type === nextRequestType && current.status === nextStatus) {
        return freezePublic({ applied: false, replayed: true, intake: current, reason: 'ALREADY_APPLIED' });
      }
      const updated = await transaction.query<DecisionIntakeRow>(
        `UPDATE intake.service_intake SET request_type=$2,status=$3,version=version+1,
           updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid
         RETURNING id::text,request_type,status,version,pilot_ticket_id::text`,
        [value.intake_id, nextRequestType, nextStatus],
      );
      const ordinal = await transaction.query<{ ordinal: number }>(
        'SELECT COALESCE(max(event_ordinal),0)::integer + 1 AS ordinal FROM intake.service_intake_event WHERE intake_id=$1::uuid',
        [value.intake_id],
      );
      const eventType = value.result_code === 'NEEDS_DESCRIPTION' ? 'intake.description_requested'
        : value.result_code === 'MANUAL_REVIEW_REQUIRED' ? 'intake.manual_review_required' : 'intake.rule_decision_applied';
      await transaction.query(
        `INSERT INTO intake.service_intake_event (
           event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload
         ) VALUES ($1,'intake',$2::uuid,$3,$4,$5::timestamp without time zone,$6,$7::jsonb)`,
        [eventType, value.intake_id, (updated.rows[0] as DecisionIntakeRow).version, (ordinal.rows[0] as { ordinal: number }).ordinal,
          value.occurred_at, value.trace_id,
          JSON.stringify({ intake_id: value.intake_id, decision_id: value.decision_id,
            old_request_type: current.request_type, new_request_type: nextRequestType,
            old_status: current.status, new_status: nextStatus, reason_code: value.reason_code,
            catalog_version: value.catalog_version, rule_set_version: value.rule_set_version })],
      );
      return freezePublic({ applied: true, replayed: false, intake: updated.rows[0] as DecisionIntakeRow });
    },
  });
}
