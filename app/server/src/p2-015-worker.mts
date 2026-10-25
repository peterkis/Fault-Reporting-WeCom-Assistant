import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { RuleFirstOrchestrator } from './p2-015-rule-first-orchestrator.mjs';
export interface WorkerInput { feature_flags?: unknown; batch_size?: number; now_epoch_ms?: string; signal?: AbortSignal | undefined }
export interface WebWorkerResult { processed?: number; claimed?: number; pending?: boolean; error_code?: string; results?: unknown[] }
export interface WebWorkerPort { processPendingFromWorker(input: { batchSize: number; nowEpochMs: string; signal?: AbortSignal | undefined }): Promise<WebWorkerResult> }
export interface DirectorySyncPort { runIfDue(input: { signal?: AbortSignal | undefined }): Promise<{ status: string; [key: string]: unknown }> }
export interface WorkerOptions { pool: PostgresPool; orchestrator: Pick<RuleFirstOrchestrator, 'preparePersistedIntake' | 'processInTransaction'>; webOrchestrator?: WebWorkerPort | null; directorySyncJob?: DirectorySyncPort | null; beforeClaim?: ((transaction: PostgresTransaction) => Promise<unknown>) | null; afterBatch?: (() => Promise<unknown>) | null; pollMilliseconds?: number }
export type WorkerBatchResult = { processed: 0; claimed: 0; disabled: true; model_provider_calls: 0; directory_sync?: { status: string; [key: string]: unknown } | null } | { processed: number; claimed: number; disabled: false; results: unknown[]; web_result: WebWorkerResult | null; model_provider_calls: 0; batch_size: number; directory_sync?: { status: string; [key: string]: unknown } | null };
export type PostBatchMaintenanceError = Error & { code: 'P2_015_POST_BATCH_MAINTENANCE_FAILED'; accepted_batch_committed: true; processed: number };
export type P2015Worker = ReturnType<typeof createP2015Worker>;
import {
  P2_015_ERROR_CODES,
  P2_015_LIMITS,
  failP2015,
  freezePublic,
  normalizeLimit,
  normalizeP2015FeatureFlags,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';

async function withTransaction<T>(pool: PostgresPool, operation: (transaction: PostgresTransaction) => Promise<T>) {
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

export function createP2015Worker({ pool, orchestrator, webOrchestrator = null,
  directorySyncJob = null,
  beforeClaim = null,
  afterBatch = null,
  pollMilliseconds = P2_015_LIMITS.recoveryPollMilliseconds }: WorkerOptions = {} as WorkerOptions) {
  if (!pool?.connect || !orchestrator?.preparePersistedIntake || !orchestrator?.processInTransaction
    || (webOrchestrator !== null && typeof webOrchestrator.processPendingFromWorker !== 'function')
    || (directorySyncJob !== null && typeof directorySyncJob.runIfDue !== 'function')
    || (beforeClaim !== null && typeof beforeClaim !== 'function') || (afterBatch !== null && typeof afterBatch !== 'function')
    || !Number.isInteger(pollMilliseconds) || pollMilliseconds < 100 || pollMilliseconds > 60_000) {
    failP2015(P2_015_ERROR_CODES.inputInvalid);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let running = false;

  async function processDueBatch(input: WorkerInput = {}): Promise<WorkerBatchResult> {
    const value = snapshotP2015Json(input);
    const flags = normalizeP2015FeatureFlags(value.feature_flags ?? {});
    let directorySync: { status: string; [key: string]: unknown } | null = null;
    if (directorySyncJob && !value.signal?.aborted) {
      try { directorySync = await directorySyncJob.runIfDue({ signal: value.signal }); }
      catch { directorySync = { status: 'FAILED', error_code: 'THIRD_STAFF_DIRECTORY_MAINTENANCE_FAILED' }; }
    }
    if (!flags.rule_first_orchestration_enabled || !flags.manual_review_queue_enabled) {
      return freezePublic({ processed: 0, claimed: 0, disabled: true, model_provider_calls: 0,
        ...(directorySyncJob ? { directory_sync: directorySync } : {}) });
    }
    const batchSize = normalizeLimit(value.batch_size, P2_015_LIMITS.defaultBatch, P2_015_LIMITS.maximumBatch);
    const nowEpochMs = value.now_epoch_ms ?? String(Date.now());
    let processed = 0;
    let claimed = 0;
    const results: unknown[] = [];
    let webResult: WebWorkerResult | null = null;
    const webClaimedFor = (result: WebWorkerResult | null) => result?.claimed ?? result?.processed ?? 0;
    if (webOrchestrator && !value.signal?.aborted) {
      // Reserve one slot for Web on every batch. If no Web root is due, the
      // zero-result response lets the Bot query use the full batch instead.
      try {
        webResult = await webOrchestrator.processPendingFromWorker({ batchSize: 1, nowEpochMs, signal: value.signal });
      } catch {
        // A broken optional Web lane must not starve the existing Bot batch.
        // Treat the reserved slot as claimed and expose only a stable code.
        webResult = { processed: 0, claimed: 0, pending: true, error_code: 'WEB_PROCESSOR_UNAVAILABLE', results: [] };
      }
      processed += webResult.processed ?? 0;
      claimed += webClaimedFor(webResult);
      results.push(...(webResult.results ?? []));
    }
    const webClaimed = webClaimedFor(webResult);
    const botBatchSize = value.signal?.aborted ? 0 : webOrchestrator
      ? webClaimed > 0 ? Math.max(0, batchSize - webClaimed) : batchSize
      : batchSize;
    const candidates = await pool.query<{ id: string }>(
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
        WHERE intake.source_provider <> 'YIXIAOXIU_WEB'
          AND (journey.id IS NULL OR (journey.status IN ('OPEN','WAITING_DESCRIPTION','WAITING_REVIEW','TICKET_LINKED')
          AND journey.evaluation_due_epoch_ms <= $1::bigint
          AND COALESCE(latest.source_window_end_sequence,0) < intake.message_count))
        ORDER BY intake.last_message_at,intake.id LIMIT $2`, [nowEpochMs, botBatchSize],
    );
    for (const candidate of candidates.rows) {
      if (value.signal?.aborted) break;
      claimed += 1;
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
      const error=new Error('P2_015_POST_BATCH_MAINTENANCE_FAILED') as PostBatchMaintenanceError;error.code=error.message as PostBatchMaintenanceError['code'];
      error.accepted_batch_committed=true;error.processed=processed;throw error;
    }
    return freezePublic({ processed, claimed, disabled: false, results, web_result: webResult,
      model_provider_calls: 0, batch_size: batchSize,
      ...(directorySyncJob ? { directory_sync: directorySync } : {}) });
  }

  function schedule(featureFlags: unknown, signal?: AbortSignal) {
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
    start({ feature_flags: featureFlags = {}, signal }: WorkerInput = {}) {
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
