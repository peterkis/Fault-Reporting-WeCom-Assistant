import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { LocalDateTime } from '../contracts/time_contracts.js';
import type { P2015ResultCode } from '../contracts/p2_015_contracts.js';
import type { SafeActionSuggestion, SafeActionType, BoundarySafeRoute } from './p2-015-decision-router.mjs';
export interface DecisionRow { id: string; journey_id: string; channel_leg_id: string; service_intake_id: string; conversation_session_id: string | null; linked_ticket_id: string | null; decision_ordinal: number; decision_key: string; source_window_start_sequence: number; source_window_end_sequence: number; source_message_count: number; source_hash: string; catalog_version: string; rule_set_version: string; engine_version: string; decision_policy_version: string; result_code: P2015ResultCode; reason_code: string; input_hash: string; result_hash: string; safe_result: BoundarySafeRoute; requires_manual_review: boolean; ticket_creation_recommended: boolean; incident_review_candidate: boolean; status: 'RECORDED' | 'HUMAN_OVERRIDDEN'; observed_at: LocalDateTime; source_kind?: 'BOT' | 'WEB'; primary_web_submission_id?: string | null; basis_input_revision?: string | number | null }
export interface ActionRow extends SafeActionSuggestion { id: string; decision_id: string; action_key: string; state: 'PROPOSED' | 'EXECUTED' | 'REPLAYED' | 'FAILED' | 'CANCELLED'; row_version: string; execution_command_id?: string | null; execution_command_hash?: string | null; result_ref_type?: string | null; result_ref_id?: string | null; error_code?: string | null; retryable?: boolean | null; executed_at?: string | null }
export type DecisionRecord = ReturnType<typeof publicDecision>;
type DecisionInputBase = Omit<DecisionRow, 'id' | 'decision_ordinal' | 'decision_key' | 'status' | 'source_kind' | 'primary_web_submission_id' | 'basis_input_revision' | 'conversation_session_id' | 'linked_ticket_id'> & { conversation_session_id?: string | null; linked_ticket_id?: string | null; safe_action_suggestions?: SafeActionSuggestion[] };
export type DecisionInput = DecisionInputBase & ({ source_kind?: 'BOT'; primary_web_submission_id?: null; basis_input_revision?: null } | { source_kind: 'WEB'; primary_web_submission_id: string; basis_input_revision: number });
export type MarkActionRow = Pick<ActionRow, 'id' | 'state' | 'row_version'> & { result_ref_type: string | null; result_ref_id: string | null; error_code: string | null; retryable: boolean | null };
export interface MarkActionInput { transaction: PostgresTransaction; action_id: string; state: ActionRow['state']; command_id: string; command_hash: string; result_ref_type?: string | null; result_ref_id?: string | null; error_code?: string | null; retryable?: boolean | null; executed_at: string }
export type DecisionStore = ReturnType<typeof createDecisionStore>;
import {
  P2_015_ERROR_CODES,
  failP2015,
  freezePublic,
  safeHash,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

function publicDecision(row: DecisionRow, actions: ActionRow[], replayed: boolean) {
  return freezePublic({
    id: row.id, journey_id: row.journey_id, channel_leg_id: row.channel_leg_id,
    service_intake_id: row.service_intake_id, conversation_session_id: row.conversation_session_id,
    linked_ticket_id: row.linked_ticket_id, decision_ordinal: row.decision_ordinal,
    decision_key: row.decision_key, source_window_start_sequence: row.source_window_start_sequence,
    source_window_end_sequence: row.source_window_end_sequence, source_message_count: row.source_message_count,
    source_hash: row.source_hash, catalog_version: row.catalog_version,
    rule_set_version: row.rule_set_version, engine_version: row.engine_version,
    decision_policy_version: row.decision_policy_version, result_code: row.result_code,
    reason_code: row.reason_code, input_hash: row.input_hash, result_hash: row.result_hash,
    safe_result: row.safe_result, requires_manual_review: row.requires_manual_review,
    ticket_creation_recommended: row.ticket_creation_recommended,
    incident_review_candidate: row.incident_review_candidate, status: row.status,
    observed_at: row.observed_at, source_kind: row.source_kind ?? 'BOT',
    primary_web_submission_id: row.primary_web_submission_id ?? null,
    basis_input_revision: row.basis_input_revision === null || row.basis_input_revision === undefined
      ? null : String(row.basis_input_revision), actions, replayed,
  });
}

async function readActions(transaction: PostgresTransaction, decisionId: string) {
  const result = await transaction.query<ActionRow>(
    `SELECT id::text,decision_id::text,action_ordinal,action_key,action_type,execution_policy,
            safe_payload,payload_hash,state,row_version::text,execution_command_id::text,
            execution_command_hash,result_ref_type,result_ref_id,error_code,retryable,executed_at
       FROM intake.safe_action_suggestion WHERE decision_id=$1::uuid ORDER BY action_ordinal`, [decisionId],
  );
  return result.rows;
}
async function insertActions(transaction: PostgresTransaction, row: DecisionRow, decisionKey: string, suggestions: SafeActionSuggestion[]) {
  const actions: ActionRow[] = [];
  for (const suggestion of suggestions) {
    const actionKey = `action_v1_${safeHash({ decision_key: decisionKey, ordinal: suggestion.action_ordinal, type: suggestion.action_type, payload_hash: suggestion.payload_hash })}`;
    const action = await transaction.query<ActionRow>(
      `INSERT INTO intake.safe_action_suggestion (
         decision_id,action_ordinal,action_key,action_type,execution_policy,safe_payload,payload_hash
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7)
       RETURNING id::text,decision_id::text,action_ordinal,action_key,action_type,execution_policy,
         safe_payload,payload_hash,state,row_version::text`,
      [row.id, suggestion.action_ordinal, actionKey, suggestion.action_type,
        suggestion.execution_policy, JSON.stringify(suggestion.safe_payload), suggestion.payload_hash],
    );
    actions.push((action.rows[0] as ActionRow));
  }
  return actions;
}

export function createDecisionStore({sourceWindowScope='JOURNEY',webSource=false}: { sourceWindowScope?: 'JOURNEY' | 'CHANNEL_LEG'; webSource?: boolean }={}) {
  if(!['JOURNEY','CHANNEL_LEG'].includes(sourceWindowScope))failP2015(P2_015_ERROR_CODES.inputInvalid);
  if(typeof webSource!=='boolean')failP2015(P2_015_ERROR_CODES.inputInvalid);
  return Object.freeze({
    async ensureHumanActions({ transaction, decisionId, suggestions }: { transaction: PostgresTransaction; decisionId: string; suggestions: SafeActionSuggestion[] }) {
      const value = snapshotP2015Json(suggestions);
      if (!Array.isArray(value) || value.length > 4) failP2015(P2_015_ERROR_CODES.inputInvalid);
      const selected = await transaction.query<DecisionRow>('SELECT * FROM intake.deterministic_decision WHERE id=$1::uuid FOR UPDATE', [decisionId]);
      const row = selected.rows[0];
      if (!row || row.status !== 'HUMAN_OVERRIDDEN') failP2015(P2_015_ERROR_CODES.authorizationDenied);
      let actions = await readActions(transaction, decisionId);
      if (actions.length) {
        if (actions.length !== value.length || actions.some((action, i) =>
          action.action_type !== (value[i] as SafeActionSuggestion).action_type || action.payload_hash !== (value[i] as SafeActionSuggestion).payload_hash)) {
          failP2015(P2_015_ERROR_CODES.commandConflict);
        }
      } else actions = await insertActions(transaction, row, row.decision_key, value);
      return publicDecision(row, actions, false);
    },

    async record({ transaction, input }: { transaction: PostgresTransaction; input: DecisionInput }) {
      if (!transaction?.query) failP2015(P2_015_ERROR_CODES.storageFailed);
      const value = snapshotP2015Json(input);
      const sourceKind = value.source_kind ?? 'BOT';
      if (!webSource && sourceKind !== 'BOT') failP2015(P2_015_ERROR_CODES.inputInvalid);
      if (!['BOT', 'WEB'].includes(sourceKind)
        || (sourceKind === 'WEB' && (typeof value.primary_web_submission_id !== 'string'
          || !Number.isInteger(value.basis_input_revision) || value.basis_input_revision < 1))
        || (sourceKind === 'BOT' && ((value.primary_web_submission_id !== undefined && value.primary_web_submission_id !== null)
          || (value.basis_input_revision !== undefined && value.basis_input_revision !== null)))) {
        failP2015(P2_015_ERROR_CODES.inputInvalid);
      }
      const identity: { journey_id: string; source_window_start_sequence: number; source_window_end_sequence: number; catalog_version: string; rule_set_version: string; engine_version: string; decision_policy_version: string; source_kind?: 'WEB'; primary_web_submission_id?: string; basis_input_revision?: number; channel_leg_id?: string } = {
        journey_id: value.journey_id,
        source_window_start_sequence: value.source_window_start_sequence,
        source_window_end_sequence: value.source_window_end_sequence,
        catalog_version: value.catalog_version,
        rule_set_version: value.rule_set_version,
        engine_version: value.engine_version,
        decision_policy_version: value.decision_policy_version,
      };
      if (sourceKind === 'WEB') {
        identity.source_kind = sourceKind;
        identity.primary_web_submission_id = (value.primary_web_submission_id as string);
        identity.basis_input_revision = (value.basis_input_revision as number);
      }
      let keyVersion='v1';
      if(sourceWindowScope==='CHANNEL_LEG'){
        const leg=await transaction.query<{ leg_ordinal: number }>('SELECT leg_ordinal FROM intake.channel_leg WHERE id=$1::uuid AND journey_id=$2::uuid',[value.channel_leg_id,value.journey_id]);
        if(leg.rowCount!==1)failP2015(P2_015_ERROR_CODES.inputInvalid);
        // Retain every historical/origin-leg key. Only additional channel legs use a new scoped identity.
        if((leg.rows[0] as { leg_ordinal: number }).leg_ordinal>1){identity.channel_leg_id=value.channel_leg_id;keyVersion='v2';}
      }
      const decisionKey = `decision_${keyVersion}_${safeHash(identity)}`;
      const existing = await transaction.query<DecisionRow>(
        `SELECT id::text,journey_id::text,channel_leg_id::text,service_intake_id::text,
                conversation_session_id::text,linked_ticket_id::text,${webSource ? 'source_kind,primary_web_submission_id::text,basis_input_revision,' : ''}
                decision_ordinal,decision_key,
                source_window_start_sequence,source_window_end_sequence,source_message_count,source_hash,
                catalog_version,rule_set_version,engine_version,decision_policy_version,result_code,
                reason_code,input_hash,result_hash,safe_result,requires_manual_review,
                ticket_creation_recommended,incident_review_candidate,status,to_char(observed_at,'YYYY-MM-DD HH24:MI:SS') AS observed_at
           FROM intake.deterministic_decision WHERE decision_key=$1 FOR UPDATE`, [decisionKey],
      );
      if (existing.rowCount === 1) {
        const row = (existing.rows[0] as DecisionRow);
        if (row.input_hash !== value.input_hash || row.result_hash !== value.result_hash || row.source_hash !== value.source_hash) {
          failP2015(P2_015_ERROR_CODES.decisionConflict);
        }
        return publicDecision(row, await readActions(transaction, row.id), true);
      }
      const ordinalResult = await transaction.query<{ ordinal: number }>(
        'SELECT COALESCE(max(decision_ordinal),0)::integer + 1 AS ordinal FROM intake.deterministic_decision WHERE journey_id=$1::uuid',
        [value.journey_id],
      );
      const sourceColumns = webSource ? 'source_kind,primary_web_submission_id,basis_input_revision,' : '';
      const sourceValues = webSource ? '$6,$7::uuid,$8,' : '';
      const parameter = (number: number) => `$${number + (webSource ? 3 : 0)}`;
      const inserted = await transaction.query<DecisionRow>(
        `INSERT INTO intake.deterministic_decision (
           journey_id,channel_leg_id,service_intake_id,conversation_session_id,linked_ticket_id,
           ${sourceColumns}
           decision_ordinal,decision_key,source_window_start_sequence,source_window_end_sequence,
           source_message_count,source_hash,catalog_version,rule_set_version,engine_version,
           decision_policy_version,result_code,reason_code,input_hash,result_hash,safe_result,
           requires_manual_review,ticket_creation_recommended,incident_review_candidate,status,observed_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,${sourceValues}${parameter(6)},${parameter(7)},${parameter(8)},${parameter(9)},${parameter(10)},${parameter(11)},${parameter(12)},${parameter(13)},${parameter(14)},${parameter(15)},${parameter(16)},${parameter(17)},${parameter(18)},${parameter(19)},${parameter(20)}::jsonb,${parameter(21)},${parameter(22)},${parameter(23)},'RECORDED',${parameter(24)}::timestamp without time zone)
         RETURNING id::text,journey_id::text,channel_leg_id::text,service_intake_id::text,
           conversation_session_id::text,linked_ticket_id::text,${webSource ? 'source_kind,primary_web_submission_id::text,basis_input_revision,' : ''}
           decision_ordinal,decision_key,
           source_window_start_sequence,source_window_end_sequence,source_message_count,source_hash,
           catalog_version,rule_set_version,engine_version,decision_policy_version,result_code,
           reason_code,input_hash,result_hash,safe_result,requires_manual_review,
           ticket_creation_recommended,incident_review_candidate,status,to_char(observed_at,'YYYY-MM-DD HH24:MI:SS') AS observed_at`,
        [value.journey_id, value.channel_leg_id, value.service_intake_id, value.conversation_session_id ?? null,
          value.linked_ticket_id ?? null, ...(webSource ? [sourceKind, sourceKind === 'WEB' ? value.primary_web_submission_id : null,
            sourceKind === 'WEB' ? value.basis_input_revision : null] : []), (ordinalResult.rows[0] as { ordinal: number }).ordinal, decisionKey,
          value.source_window_start_sequence, value.source_window_end_sequence, value.source_message_count,
          value.source_hash, value.catalog_version, value.rule_set_version, value.engine_version,
          value.decision_policy_version, value.result_code, value.reason_code, value.input_hash,
          value.result_hash, JSON.stringify(value.safe_result), value.requires_manual_review,
          value.ticket_creation_recommended, value.incident_review_candidate, value.observed_at],
      );
      const row = (inserted.rows[0] as DecisionRow);
      const actions = await insertActions(transaction, row, decisionKey, value.safe_action_suggestions ?? []);
      return publicDecision(row, actions, false);
    },

    async markAction({ transaction, action_id: actionId, state, command_id: commandId,
      command_hash: commandHash, result_ref_type: resultRefType = null,
      result_ref_id: resultRefId = null, error_code: errorCode = null,
      retryable = null, executed_at: executedAt }: MarkActionInput) {
      const result = await transaction.query<MarkActionRow>(
        `UPDATE intake.safe_action_suggestion SET state=$2,execution_command_id=$3::uuid,
           execution_command_hash=$4,result_ref_type=$5,result_ref_id=$6,error_code=$7,retryable=$8,
           executed_at=$9::timestamp without time zone,row_version=row_version+1,
           updated_at=$9::timestamp without time zone WHERE id=$1::uuid
         RETURNING id::text,state,row_version::text,result_ref_type,result_ref_id,error_code,retryable`,
        [actionId, state, commandId, commandHash, resultRefType, resultRefId, errorCode, retryable, executedAt],
      );
      if (result.rowCount !== 1) failP2015(P2_015_ERROR_CODES.storageFailed);
      return freezePublic(result.rows[0] as MarkActionRow);
    },
  });
}
