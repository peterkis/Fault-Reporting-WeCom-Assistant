import {
  P2_015_ERROR_CODES,
  failP2015,
  freezePublic,
  safeHash,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

function publicDecision(row, actions, replayed) {
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
    observed_at: row.observed_at, actions, replayed,
  });
}

async function readActions(transaction, decisionId) {
  const result = await transaction.query(
    `SELECT id::text,decision_id::text,action_ordinal,action_key,action_type,execution_policy,
            safe_payload,payload_hash,state,row_version::text,execution_command_id::text,
            execution_command_hash,result_ref_type,result_ref_id,error_code,retryable,executed_at
       FROM intake.safe_action_suggestion WHERE decision_id=$1::uuid ORDER BY action_ordinal`, [decisionId],
  );
  return result.rows;
}
async function insertActions(transaction, row, decisionKey, suggestions) {
  const actions = [];
  for (const suggestion of suggestions) {
    const actionKey = `action_v1_${safeHash({ decision_key: decisionKey, ordinal: suggestion.action_ordinal, type: suggestion.action_type, payload_hash: suggestion.payload_hash })}`;
    const action = await transaction.query(
      `INSERT INTO intake.safe_action_suggestion (
         decision_id,action_ordinal,action_key,action_type,execution_policy,safe_payload,payload_hash
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6::jsonb,$7)
       RETURNING id::text,decision_id::text,action_ordinal,action_key,action_type,execution_policy,
         safe_payload,payload_hash,state,row_version::text`,
      [row.id, suggestion.action_ordinal, actionKey, suggestion.action_type,
        suggestion.execution_policy, JSON.stringify(suggestion.safe_payload), suggestion.payload_hash],
    );
    actions.push(action.rows[0]);
  }
  return actions;
}

export function createDecisionStore({sourceWindowScope='JOURNEY'}={}) {
  if(!['JOURNEY','CHANNEL_LEG'].includes(sourceWindowScope))failP2015(P2_015_ERROR_CODES.inputInvalid);
  return Object.freeze({
    async ensureHumanActions({ transaction, decisionId, suggestions }) {
      const value = snapshotP2015Json(suggestions);
      if (!Array.isArray(value) || value.length > 4) failP2015(P2_015_ERROR_CODES.inputInvalid);
      const selected = await transaction.query('SELECT * FROM intake.deterministic_decision WHERE id=$1::uuid FOR UPDATE', [decisionId]);
      const row = selected.rows[0];
      if (!row || row.status !== 'HUMAN_OVERRIDDEN') failP2015(P2_015_ERROR_CODES.authorizationDenied);
      let actions = await readActions(transaction, decisionId);
      if (actions.length) {
        if (actions.length !== value.length || actions.some((action, i) =>
          action.action_type !== value[i].action_type || action.payload_hash !== value[i].payload_hash)) {
          failP2015(P2_015_ERROR_CODES.commandConflict);
        }
      } else actions = await insertActions(transaction, row, row.decision_key, value);
      return publicDecision(row, actions, false);
    },

    async record({ transaction, input }) {
      if (!transaction?.query) failP2015(P2_015_ERROR_CODES.storageFailed);
      const value = snapshotP2015Json(input);
      const identity = {
        journey_id: value.journey_id,
        source_window_start_sequence: value.source_window_start_sequence,
        source_window_end_sequence: value.source_window_end_sequence,
        catalog_version: value.catalog_version,
        rule_set_version: value.rule_set_version,
        engine_version: value.engine_version,
        decision_policy_version: value.decision_policy_version,
      };
      let keyVersion='v1';
      if(sourceWindowScope==='CHANNEL_LEG'){
        const leg=await transaction.query('SELECT leg_ordinal FROM intake.channel_leg WHERE id=$1::uuid AND journey_id=$2::uuid',[value.channel_leg_id,value.journey_id]);
        if(leg.rowCount!==1)failP2015(P2_015_ERROR_CODES.inputInvalid);
        // Retain every historical/origin-leg key. Only additional channel legs use a new scoped identity.
        if(leg.rows[0].leg_ordinal>1){identity.channel_leg_id=value.channel_leg_id;keyVersion='v2';}
      }
      const decisionKey = `decision_${keyVersion}_${safeHash(identity)}`;
      const existing = await transaction.query(
        `SELECT id::text,journey_id::text,channel_leg_id::text,service_intake_id::text,
                conversation_session_id::text,linked_ticket_id::text,decision_ordinal,decision_key,
                source_window_start_sequence,source_window_end_sequence,source_message_count,source_hash,
                catalog_version,rule_set_version,engine_version,decision_policy_version,result_code,
                reason_code,input_hash,result_hash,safe_result,requires_manual_review,
                ticket_creation_recommended,incident_review_candidate,status,observed_at
           FROM intake.deterministic_decision WHERE decision_key=$1 FOR UPDATE`, [decisionKey],
      );
      if (existing.rowCount === 1) {
        const row = existing.rows[0];
        if (row.input_hash !== value.input_hash || row.result_hash !== value.result_hash || row.source_hash !== value.source_hash) {
          failP2015(P2_015_ERROR_CODES.decisionConflict);
        }
        return publicDecision(row, await readActions(transaction, row.id), true);
      }
      const ordinalResult = await transaction.query(
        'SELECT COALESCE(max(decision_ordinal),0)::integer + 1 AS ordinal FROM intake.deterministic_decision WHERE journey_id=$1::uuid',
        [value.journey_id],
      );
      const inserted = await transaction.query(
        `INSERT INTO intake.deterministic_decision (
           journey_id,channel_leg_id,service_intake_id,conversation_session_id,linked_ticket_id,
           decision_ordinal,decision_key,source_window_start_sequence,source_window_end_sequence,
           source_message_count,source_hash,catalog_version,rule_set_version,engine_version,
           decision_policy_version,result_code,reason_code,input_hash,result_hash,safe_result,
           requires_manual_review,ticket_creation_recommended,incident_review_candidate,status,observed_at
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
           $16,$17,$18,$19,$20::jsonb,$21,$22,$23,'RECORDED',$24::timestamp without time zone)
         RETURNING id::text,journey_id::text,channel_leg_id::text,service_intake_id::text,
           conversation_session_id::text,linked_ticket_id::text,decision_ordinal,decision_key,
           source_window_start_sequence,source_window_end_sequence,source_message_count,source_hash,
           catalog_version,rule_set_version,engine_version,decision_policy_version,result_code,
           reason_code,input_hash,result_hash,safe_result,requires_manual_review,
           ticket_creation_recommended,incident_review_candidate,status,observed_at`,
        [value.journey_id, value.channel_leg_id, value.service_intake_id, value.conversation_session_id ?? null,
          value.linked_ticket_id ?? null, ordinalResult.rows[0].ordinal, decisionKey,
          value.source_window_start_sequence, value.source_window_end_sequence, value.source_message_count,
          value.source_hash, value.catalog_version, value.rule_set_version, value.engine_version,
          value.decision_policy_version, value.result_code, value.reason_code, value.input_hash,
          value.result_hash, JSON.stringify(value.safe_result), value.requires_manual_review,
          value.ticket_creation_recommended, value.incident_review_candidate, value.observed_at],
      );
      const row = inserted.rows[0];
      const actions = await insertActions(transaction, row, decisionKey, value.safe_action_suggestions ?? []);
      return publicDecision(row, actions, false);
    },

    async markAction({ transaction, action_id: actionId, state, command_id: commandId,
      command_hash: commandHash, result_ref_type: resultRefType = null,
      result_ref_id: resultRefId = null, error_code: errorCode = null,
      retryable = null, executed_at: executedAt }) {
      const result = await transaction.query(
        `UPDATE intake.safe_action_suggestion SET state=$2,execution_command_id=$3::uuid,
           execution_command_hash=$4,result_ref_type=$5,result_ref_id=$6,error_code=$7,retryable=$8,
           executed_at=$9::timestamp without time zone,row_version=row_version+1,
           updated_at=$9::timestamp without time zone WHERE id=$1::uuid
         RETURNING id::text,state,row_version::text,result_ref_type,result_ref_id,error_code,retryable`,
        [actionId, state, commandId, commandHash, resultRefType, resultRefId, errorCode, retryable, executedAt],
      );
      if (result.rowCount !== 1) failP2015(P2_015_ERROR_CODES.storageFailed);
      return freezePublic(result.rows[0]);
    },
  });
}
