import { P2_015_ERROR_CODES, failP2015, freezePublic, snapshotP2015Json } from './p2-015-domain-contracts.mjs';
import { projectContactJourney, projectDecision } from './p2-015-projections.mjs';

export function createP2015QueryService({ pool, authorizer, manualReviewStore, orchestrator, worker }) {
  if (!pool?.query || !authorizer || !manualReviewStore || !orchestrator) failP2015(P2_015_ERROR_CODES.inputInvalid);
  const withAuthorizedJourney = async (principal, journeyId, operation) => {
    const ids = await authorizer.authorizedJourneyIds(snapshotP2015Json({ principal, operation, journey_id: journeyId }));
    if (!Array.isArray(ids) || !ids.includes(journeyId)) failP2015(P2_015_ERROR_CODES.authorizationDenied);
  };
  const inTransaction = async (operation) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const value = await operation(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  };
  return Object.freeze({
    listManualReviews: (input) => manualReviewStore.list({ transaction: pool, ...input }),
    getManualReviewDetail: (input) => manualReviewStore.get({ transaction: pool, ...input }),
    resolveManualReview: (input) => inTransaction((transaction) => manualReviewStore.resolve({ transaction, ...input })),
    async getContactJourney({ principal, journey_id: journeyId, restricted = false }) {
      await withAuthorizedJourney(principal, journeyId, 'GET_CONTACT_JOURNEY');
      const result = await pool.query(`SELECT id::text,origin_intake_id::text,linked_ticket_id::text,entry_mode,
        origin_channel,current_channel,profile_resolution_status,profile_snapshot,status,row_version::text,
        reported_at,last_activity_at,ended_at FROM intake.contact_journey WHERE id=$1::uuid`, [journeyId]);
      if (result.rowCount !== 1) failP2015(P2_015_ERROR_CODES.authorizationDenied);
      return projectContactJourney(result.rows[0], { restricted });
    },
    async listJourneyLegs({ principal, journey_id: journeyId }) {
      await withAuthorizedJourney(principal, journeyId, 'LIST_JOURNEY_LEGS');
      const result = await pool.query(`SELECT id::text,journey_id::text,leg_ordinal,leg_type,source_intake_id::text,
        conversation_thread_id::text,conversation_session_id::text,origin_channel_message_id::text,status,
        row_version::text,opened_at,closed_at FROM intake.channel_leg WHERE journey_id=$1::uuid ORDER BY leg_ordinal`, [journeyId]);
      return freezePublic(result.rows);
    },
    async listJourneyDecisions({ principal, journey_id: journeyId }) {
      await withAuthorizedJourney(principal, journeyId, 'LIST_JOURNEY_DECISIONS');
      const result = await pool.query(`SELECT id::text,journey_id::text,decision_ordinal,result_code,reason_code,
        safe_result,requires_manual_review,ticket_creation_recommended,incident_review_candidate,status,observed_at
        FROM intake.deterministic_decision WHERE journey_id=$1::uuid ORDER BY decision_ordinal`, [journeyId]);
      return freezePublic(result.rows.map(projectDecision));
    },
    processPersistedIntake: orchestrator.processPersistedIntake,
    processDueBatch: worker ? worker.processDueBatch : async () => freezePublic({ processed: 0, disabled: true }),
    async replayDecision({ principal, decision_id: decisionId }) {
      const result = await pool.query('SELECT journey_id::text FROM intake.deterministic_decision WHERE id=$1::uuid', [decisionId]);
      if (result.rowCount !== 1) failP2015(P2_015_ERROR_CODES.authorizationDenied);
      await withAuthorizedJourney(principal, result.rows[0].journey_id, 'REPLAY_DECISION');
      return freezePublic({ decision_id: decisionId, replay_requested: true });
    },
  });
}
