import {
  P2_015_ERROR_CODES,
  P2_015_LIMITS,
  failP2015,
  freezePublic,
  normalizeLimit,
  normalizeP2015FeatureFlags,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally { client.release(destroy); }
}

export function createP2015Worker({ pool, orchestrator,
  beforeClaim = null,
  afterBatch = null,
  pollMilliseconds = P2_015_LIMITS.recoveryPollMilliseconds } = {}) {
  if (!pool?.connect || !orchestrator?.preparePersistedIntake || !orchestrator?.processInTransaction
    || (beforeClaim !== null && typeof beforeClaim !== 'function') || (afterBatch !== null && typeof afterBatch !== 'function')
    || !Number.isInteger(pollMilliseconds) || pollMilliseconds < 100 || pollMilliseconds > 60_000) {
    failP2015(P2_015_ERROR_CODES.inputInvalid);
  }
  let timer = null;
  let stopped = true;
  let running = false;

  async function processDueBatch(input = {}) {
    const value = snapshotP2015Json(input);
    const flags = normalizeP2015FeatureFlags(value.feature_flags ?? {});
    if (!flags.rule_first_orchestration_enabled || !flags.manual_review_queue_enabled) {
      return freezePublic({ processed: 0, claimed: 0, disabled: true, model_provider_calls: 0 });
    }
    const batchSize = normalizeLimit(value.batch_size, P2_015_LIMITS.defaultBatch, P2_015_LIMITS.maximumBatch);
    const nowEpochMs = value.now_epoch_ms ?? String(Date.now());
    const candidates = await pool.query(
      `SELECT intake.id::text
         FROM intake.service_intake AS intake
         LEFT JOIN intake.channel_leg leg ON leg.source_intake_id=intake.id
         LEFT JOIN intake.contact_journey journey ON journey.id=leg.journey_id
           OR (leg.id IS NULL AND journey.origin_intake_id=intake.id)
         LEFT JOIN LATERAL (
           SELECT decision.source_window_end_sequence FROM intake.deterministic_decision decision
            WHERE decision.journey_id=journey.id AND decision.service_intake_id=intake.id
            ORDER BY decision.decision_ordinal DESC LIMIT 1
         ) latest ON true
        WHERE (journey.id IS NULL OR (journey.status IN ('OPEN','WAITING_DESCRIPTION','WAITING_REVIEW','TICKET_LINKED')
          AND journey.evaluation_due_epoch_ms <= $1::bigint
          AND COALESCE(latest.source_window_end_sequence,0) < intake.message_count))
        ORDER BY intake.last_message_at,intake.id LIMIT $2`, [nowEpochMs, batchSize],
    );
    let processed = 0;
    const results = [];
    for (const candidate of candidates.rows) {
      if (value.signal?.aborted) break;
      const prepared = await orchestrator.preparePersistedIntake(candidate.id);
      const result = await withTransaction(pool, async (transaction) => {
        if (beforeClaim) await beforeClaim(transaction);
        const claim = await transaction.query(
          `SELECT id::text FROM intake.service_intake WHERE id=$1::uuid FOR UPDATE SKIP LOCKED`, [candidate.id],
        );
        if (claim.rowCount !== 1) return null;
        return orchestrator.processInTransaction({ transaction, intakeId: candidate.id,
          profile: prepared.profile, reporterHash: prepared.reporter_hash, flags,
          traceId: `p2-015-worker-${prepared.primary_message_id}` });
      });
      if (result) {
        processed += 1;
        results.push({ service_intake_id: candidate.id, decision_id: result.decision.id,
          result_code: result.decision.result_code, replayed: result.decision.replayed });
      }
    }
    if(afterBatch)try{await afterBatch();}catch{
      // The intake transactions above have already committed. This maintenance
      // failure must never be represented as a rollback of accepted reports.
      const error=new Error('P2_015_POST_BATCH_MAINTENANCE_FAILED');error.code=error.message;
      error.accepted_batch_committed=true;error.processed=processed;throw error;
    }
    return freezePublic({ processed, claimed: processed, disabled: false, results,
      model_provider_calls: 0, batch_size: batchSize });
  }

  function schedule(featureFlags, signal) {
    if (stopped || signal?.aborted) return;
    timer = setTimeout(async () => {
      timer = null;
      if (running) return schedule(featureFlags, signal);
      running = true;
      try { await processDueBatch({ feature_flags: featureFlags, signal }); }
      finally { running = false; schedule(featureFlags, signal); }
    }, pollMilliseconds);
    timer.unref?.();
  }

  return Object.freeze({
    processDueBatch,
    start({ feature_flags: featureFlags = {}, signal } = {}) {
      if (!stopped) return false;
      stopped = false;
      schedule(featureFlags, signal);
      return true;
    },
    async stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      while (running) await new Promise((resolve) => setTimeout(resolve, 10));
      return freezePublic({ stopped: true, timer_active: false, running: false });
    },
    state() { return freezePublic({ stopped, running, timer_active: timer !== null, worker_count: 1 }); },
  });
}
