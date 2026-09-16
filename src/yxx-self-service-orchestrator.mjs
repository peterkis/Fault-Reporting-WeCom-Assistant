import { createPilotTicketCore } from './p1-005-pilot-ticket-core.mjs';
import { createRuleEngine } from './p2-007-rule-engine.mjs';
import { routeP2007Decision, routeRuleFailure } from './p2-015-decision-router.mjs';
import { createDecisionStore } from './p2-015-decision-store.mjs';
import { createManualReviewStore } from './p2-015-manual-review.mjs';
import { createServiceIntakeDecisionPort } from './p2-015-service-intake-decision-port.mjs';
import { safeHash } from './p2-015-domain-contracts.mjs';
import { shanghaiLocalToEpochMs } from './platform/time-contract.mjs';

const MAX_BATCH = 20;
const DEFAULT_BATCH = 10;
const MAX_RULE_TEXT = 20_000;
const WEB_REF = /^[A-Za-z0-9_-]{32}$/u;
const COMMUNICATION_ACTIONS = new Set(['REQUEST_ONE_DESCRIPTION', 'SEND_FIXED_ACKNOWLEDGEMENT', 'SEND_FIXED_SCOPE_NOTICE']);
const PROFILES = new Set(['OAUTH_ONLY', 'MEMBER_TICKET_READONLY', 'MEMBER_SELF_SERVICE', 'FULL_SERVICE_LOOP']);

function inputError(code = 'YXX_SELF_SERVICE_INPUT_INVALID') {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertPool(pool) {
  if (!pool?.connect || typeof pool.query !== 'function') throw inputError('YXX_SELF_SERVICE_POOL_REQUIRED');
}

function assertRef(value) {
  if (typeof value !== 'string' || !WEB_REF.test(value)) throw inputError('YXX_REQUEST_REF_INVALID');
  return value;
}

function sourceText(submissions) {
  const first = submissions.find((row) => row.kind === 'SUBMIT');
  const parts = [];
  if (first?.safe_content?.description) parts.push(first.safe_content.description);
  for (const row of submissions.filter((item) => item.kind === 'SUPPLEMENT')) {
    if (row.safe_content?.text) parts.push(row.safe_content.text);
  }
  return parts.join('\n');
}

function codeForFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : 'YXX_PROCESSING_FAILED';
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : 'YXX_PROCESSING_FAILED';
}

function configFlag(value) {
  if (value === undefined || value === null || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw inputError('YXX_SELF_SERVICE_CONFIG_INVALID');
}

async function withTransaction(pool, operation) {
  const transaction = await pool.connect();
  let destroy = false;
  try {
    await transaction.query('BEGIN');
    const result = await operation(transaction);
    await transaction.query('COMMIT');
    return result;
  } catch (error) {
    try { await transaction.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally {
    transaction.release(destroy);
  }
}

async function loadWebRoot(transaction, requestRef) {
  const root = await transaction.query(
    `SELECT b.intake_id::text,b.request_ref,b.source_app_scope,b.canonical_reporter_binding,
            b.input_revision,b.processed_revision,b.retry_count,b.retention_until,
            i.intake_no,i.status,i.pilot_ticket_id::text,i.version,
            to_char(i.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at,
            to_char(i.updated_at,'YYYY-MM-DD HH24:MI:SS') AS updated_at,
            to_char(i.retention_until,'YYYY-MM-DD HH24:MI:SS') AS intake_retention_until
       FROM intake.web_request_binding b
       JOIN intake.service_intake i ON i.id=b.intake_id
      WHERE b.request_ref=$1 AND b.revoked_at IS NULL
        AND b.retention_until>platform.local_now() AND i.retention_until>platform.local_now()
      FOR UPDATE OF b,i`, [requestRef],
  );
  if (root.rowCount !== 1) throw inputError('YXX_NOT_FOUND');
  const row = root.rows[0];
  const submissions = await transaction.query(
    `SELECT id::text,kind,input_revision,canonical_content_hash,safe_content,
            to_char(received_at,'YYYY-MM-DD HH24:MI:SS') AS received_at
       FROM intake.web_submission
      WHERE intake_id=$1::uuid ORDER BY input_revision`, [row.intake_id],
  );
  if (submissions.rows.length === 0 || Number(submissions.rows.at(-1).input_revision) !== Number(row.input_revision)) {
    throw inputError('YXX_WEB_INPUT_SNAPSHOT_MISSING');
  }
  return { row, submissions: submissions.rows };
}

async function ensureWebJourney(transaction, root) {
  const existing = await transaction.query(
    `SELECT id::text,reporter_identity_hash,source_app_scope,status,row_version::text
       FROM intake.contact_journey WHERE origin_intake_id=$1::uuid FOR UPDATE`, [root.intake_id],
  );
  if (existing.rowCount === 1) {
    if (existing.rows[0].reporter_identity_hash !== root.canonical_reporter_binding
      || existing.rows[0].source_app_scope !== root.source_app_scope) throw inputError('YXX_SCOPE_CONFLICT');
    return existing.rows[0];
  }
  const epoch = shanghaiLocalToEpochMs(root.created_at);
  const profile = { source: 'YIXIAOXIU_WEB', version: 'v1', account_status: 'ACTIVE' };
  const inserted = await transaction.query(
    `INSERT INTO intake.contact_journey (
       creation_key,origin_intake_id,entry_mode,origin_channel,current_channel,source_app_scope,
       reporter_identity_hash,profile_resolution_status,profile_snapshot,profile_snapshot_hash,status,
       evaluation_due_at,evaluation_due_epoch_ms,reported_at,last_activity_at,privacy_class,
       retention_until,retention_until_epoch_ms
     ) VALUES ($1,$2::uuid,'APP_WEB_SELF_SERVICE','PORTAL','PORTAL',$3,$4,'NOT_REQUIRED',$5::jsonb,$6,
       'OPEN',$7::timestamp without time zone,$8::bigint,$7::timestamp without time zone,
       $7::timestamp without time zone,'PERSONAL',$9::timestamp without time zone,$10::bigint)
     RETURNING id::text,reporter_identity_hash,source_app_scope,status,row_version::text`,
    [`web:${root.intake_id}`, root.intake_id, root.source_app_scope, root.canonical_reporter_binding,
      JSON.stringify(profile), safeHash(profile), root.created_at, epoch, root.intake_retention_until,
      shanghaiLocalToEpochMs(root.intake_retention_until)],
  );
  return inserted.rows[0];
}

async function ensureWebLeg(transaction, root, journey, submissionId) {
  const existing = await transaction.query(
    `SELECT id::text,journey_id::text,leg_ordinal,leg_type,web_submission_id::text,status,row_version::text
       FROM intake.channel_leg WHERE source_intake_id=$1::uuid FOR UPDATE`, [root.intake_id],
  );
  if (existing.rowCount === 1) {
    if (existing.rows[0].journey_id !== journey.id || existing.rows[0].leg_type !== 'WEB_FORM') throw inputError('YXX_WEB_LEG_CONFLICT');
    return existing.rows[0];
  }
  const inserted = await transaction.query(
    `INSERT INTO intake.channel_leg (
       journey_id,leg_ordinal,leg_type,source_intake_id,web_submission_id,
       provider_context_hash,channel_identity_hash,reporter_identity_hash,status,opened_at
     ) VALUES ($1::uuid,1,'WEB_FORM',$2::uuid,$3::uuid,$4,$5,$6,'OPEN',$7::timestamp without time zone)
     RETURNING id::text,journey_id::text,leg_ordinal,leg_type,web_submission_id::text,status,row_version::text`,
    [journey.id, root.intake_id, submissionId, safeHash({ provider: 'YIXIAOXIU_WEB' }),
      safeHash({ source_app_scope: root.source_app_scope }), root.canonical_reporter_binding, root.created_at],
  );
  return inserted.rows[0];
}

function classificationCode(decision) {
  if (decision.result_code === 'INCIDENT_REVIEW_CANDIDATE'
    || (decision.result_code === 'MANUAL_REVIEW_REQUIRED' && decision.ticket_creation_recommended)) return 'TICKET_ELIGIBLE';
  return decision.result_code;
}

function ticketId(result) {
  return result?.ticket?.id ?? result?.ticket_id ?? result?.id ?? null;
}

async function processActions({ transaction, decision, root, journey, observedAt, decisionStore, manualReviewStore, ticketCore, intakeDecisionPort }) {
  let linkedTicketId = decision.linked_ticket_id ?? null;
  const results = [];
  for (const action of decision.actions) {
    if (action.state !== 'PROPOSED') {
      results.push({ action_id: action.id, replayed: true });
      continue;
    }
    const commandHash = safeHash({ action_key: action.action_key, payload_hash: action.payload_hash });
    let resultRefType = 'INTAKE';
    let resultRefId = root.intake_id;
    if (action.action_type === 'APPLY_INTAKE_CLASSIFICATION') {
      await intakeDecisionPort.apply({ transaction, input: {
        intake_id: root.intake_id, decision_id: decision.id, result_code: classificationCode(decision),
        catalog_version: decision.catalog_version, rule_set_version: decision.rule_set_version,
        occurred_at: observedAt, trace_id: `yxx:${root.request_ref}`,
      } });
    } else if (action.action_type === 'CREATE_MINIMAL_TICKET' || action.action_type === 'ROUTE_SERVICE_REQUEST') {
      const created = await ticketCore.createForIntakeInTransaction({
        intakeId: root.intake_id, transaction, occurredAt: observedAt, traceId: `yxx:${root.request_ref}`,
      });
      linkedTicketId = ticketId(created);
      if (!linkedTicketId) throw inputError('YXX_TICKET_CORE_NO_RESULT');
      resultRefType = 'TICKET'; resultRefId = linkedTicketId;
      await transaction.query(
        `UPDATE intake.contact_journey SET linked_ticket_id=$2::uuid,status='TICKET_LINKED',
           row_version=row_version+1,updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid`,
        [journey.id, linkedTicketId],
      );
      await transaction.query('UPDATE intake.deterministic_decision SET linked_ticket_id=$2::uuid WHERE id=$1::uuid', [decision.id, linkedTicketId]);
    } else if (['ENQUEUE_MANUAL_REVIEW', 'ENQUEUE_INCIDENT_REVIEW', 'QUERY_AUTHORIZED_STATUS', 'ROUTE_BUSINESS_CONSULTATION'].includes(action.action_type)) {
      const review = await manualReviewStore.enqueue({ transaction, input: {
        journey_id: journey.id, decision_id: decision.id, service_intake_id: root.intake_id,
        linked_ticket_id: linkedTicketId, basis_input_revision: Number(decision.basis_input_revision),
        review_reason_code: action.action_type === 'ENQUEUE_INCIDENT_REVIEW' ? 'INCIDENT_CANDIDATE_HUMAN_CONFIRMATION' : decision.reason_code,
        priority: decision.safe_result?.clinical_safety_risk === 'CRITICAL_REVIEW_REQUIRED' ? 'URGENT' : 'NORMAL',
      } });
      resultRefType = 'MANUAL_REVIEW'; resultRefId = review.id;
      await transaction.query(
        `UPDATE intake.contact_journey SET status='WAITING_REVIEW',row_version=row_version+1,
           updated_at=GREATEST(created_at,platform.local_now()) WHERE id=$1::uuid`, [journey.id],
      );
    } else if (action.action_type === 'APPEND_RELATED_FOLLOW_UP') {
      resultRefType = 'JOURNEY'; resultRefId = journey.id;
    } else if (COMMUNICATION_ACTIONS.has(action.action_type)) {
      // APP_ONLY is a hard boundary. A future route must never turn this into a
      // Message/Outbox/Delivery call by accident.
      await decisionStore.markAction({ transaction, action_id: action.id, state: 'CANCELLED',
        command_id: action.id, command_hash: commandHash, error_code: 'APP_ONLY', executed_at: observedAt });
      results.push({ action_id: action.id, cancelled: true, reason: 'APP_ONLY' });
      continue;
    } else {
      throw inputError('YXX_ACTION_UNSUPPORTED');
    }
    await decisionStore.markAction({ transaction, action_id: action.id, state: 'EXECUTED',
      command_id: action.id, command_hash: commandHash, result_ref_type: resultRefType,
      result_ref_id: String(resultRefId), executed_at: observedAt });
    results.push({ action_id: action.id, action_type: action.action_type, result_ref_type: resultRefType, result_ref_id: String(resultRefId) });
  }
  return { results, linkedTicketId };
}

export function createYxxSelfServiceOrchestrator({ pool, ruleEngine = null, ticketCore = null,
  decisionStore = createDecisionStore({ webSource: true }), manualReviewStore = createManualReviewStore({ webSource: true }),
  intakeDecisionPort = createServiceIntakeDecisionPort(), profile = 'OAUTH_ONLY', featureFlags = {} } = {}) {
  assertPool(pool);
  if (!PROFILES.has(profile) || !featureFlags || typeof featureFlags !== 'object' || Array.isArray(featureFlags)
    || Object.keys(featureFlags).some((key) => !['YIXIAOXIU_SELF_SERVICE_ENABLED', 'YIXIAOXIU_MY_REPORTS_ENABLED'].includes(key))) {
    throw inputError('YXX_SELF_SERVICE_CONFIG_INVALID');
  }
  const configuredFlags = Object.freeze({
    YIXIAOXIU_SELF_SERVICE_ENABLED: configFlag(featureFlags.YIXIAOXIU_SELF_SERVICE_ENABLED),
    YIXIAOXIU_MY_REPORTS_ENABLED: configFlag(featureFlags.YIXIAOXIU_MY_REPORTS_ENABLED),
  });
  const canProcess = profile === 'FULL_SERVICE_LOOP'
    ? configuredFlags.YIXIAOXIU_SELF_SERVICE_ENABLED === true
    : profile === 'MEMBER_SELF_SERVICE'
      && configuredFlags.YIXIAOXIU_SELF_SERVICE_ENABLED === true
      && configuredFlags.YIXIAOXIU_MY_REPORTS_ENABLED === true;
  const engine = ruleEngine ?? createRuleEngine();
  const core = ticketCore ?? createPilotTicketCore({ pool });
  let pumpRunning = false;

  async function processOne({ requestRef } = {}) {
    assertRef(requestRef);
    if (!canProcess) return Object.freeze({ processed: false, reason: 'FEATURE_DISABLED', profile, flags: configuredFlags });
    try {
      return await withTransaction(pool, async (transaction) => {
        const { row: root, submissions } = await loadWebRoot(transaction, requestRef);
        if (Number(root.processed_revision) >= Number(root.input_revision)) return { processed: false, replayed: true, request_ref: requestRef };
        const latest = submissions.at(-1);
        const text = sourceText(submissions);
        const sourceHash = safeHash(submissions.map((item) => ({ id: item.id, revision: item.input_revision, hash: item.canonical_content_hash })));
        const revision = Number(root.input_revision);
        const windowStart = Number(submissions[0].input_revision);
        const windowCount = submissions.length;
        const initial = submissions.find((item) => item.kind === 'SUBMIT')?.safe_content ?? {};
        const webFields = { service_code: initial.service_code ?? null, impact_scope: initial.impact_scope ?? 'UNKNOWN',
          location_unknown: initial.location?.unknown === true, reported_department_present: Boolean(initial.reported_department_text) };
        const journey = await ensureWebJourney(transaction, root);
        const leg = await ensureWebLeg(transaction, root, journey, latest.id);
        const sourceRefs = submissions.map((item) => `web:${item.id}`);
        const routeContext = {
          service_intake_id: root.intake_id, journey_ref: journey.id, delivery_mode: 'APP_ONLY',
          source_refs: sourceRefs, message_sequence_window: { start: windowStart, end: revision, count: windowCount },
          safe_normalized_text: text.length <= MAX_RULE_TEXT ? text : '',
          input_hash: safeHash({ source_hash: sourceHash, input_revision: revision, web_fields: webFields }), web_fields: webFields,
          conflicts: [], reliable_follow_up: false,
        };
        let routed;
        await transaction.query('SAVEPOINT yxx_rule_evaluation');
        try {
          if (text.length > MAX_RULE_TEXT) throw inputError('YXX_RULE_WINDOW_LIMIT_EXCEEDED');
          const output = engine.evaluate({ text, source_ref: `web:${root.intake_id}:${revision}`, observed_at: latest.received_at,
            source_kind: 'WEB', context: { existing_ticket: root.pilot_ticket_id !== null, web_fields: webFields } });
          routed = routeP2007Decision({ rule_output: output, context: routeContext });
          await transaction.query('RELEASE SAVEPOINT yxx_rule_evaluation');
        } catch (error) {
          await transaction.query('ROLLBACK TO SAVEPOINT yxx_rule_evaluation');
          await transaction.query('RELEASE SAVEPOINT yxx_rule_evaluation');
          routed = routeRuleFailure({ ...routeContext, catalog_version: engine.catalog_version ?? 'UNAVAILABLE', rule_set_version: engine.rule_set_version ?? 'UNAVAILABLE' });
        }
        const decision = await decisionStore.record({ transaction, input: {
          journey_id: journey.id, channel_leg_id: leg.id, service_intake_id: root.intake_id,
          conversation_session_id: null, linked_ticket_id: root.pilot_ticket_id,
          source_window_start_sequence: windowStart, source_window_end_sequence: revision, source_message_count: windowCount,
          source_hash: sourceHash, catalog_version: routed.catalog_version, rule_set_version: routed.rule_set_version,
          engine_version: routed.engine_version, decision_policy_version: routed.decision_policy_version,
          result_code: routed.result_code, reason_code: routed.reason_code, input_hash: routed.input_hash,
          result_hash: routed.result_hash, safe_result: routed, requires_manual_review: routed.manual_review_required,
          ticket_creation_recommended: routed.ticket_creation_recommended, incident_review_candidate: routed.incident_review_candidate,
          observed_at: latest.received_at, safe_action_suggestions: routed.safe_action_suggestions,
          source_kind: 'WEB', primary_web_submission_id: leg.web_submission_id, basis_input_revision: revision,
        } });
        const actions = await processActions({ transaction, decision, root, journey, observedAt: latest.received_at,
          decisionStore, manualReviewStore, ticketCore: core, intakeDecisionPort });
        if (decision.result_code === 'OUT_OF_SCOPE') {
          await transaction.query(
            `UPDATE intake.service_intake SET status='IGNORED',updated_at=GREATEST(created_at,platform.local_now())
              WHERE id=$1::uuid AND pilot_ticket_id IS NULL`, [root.intake_id],
          );
        }
        const cursor = await transaction.query(
          `UPDATE intake.web_request_binding
              SET processed_revision=$2,next_attempt_epoch_ms=NULL,last_safe_error_code=NULL,updated_at=platform.local_now()
            WHERE intake_id=$1::uuid AND input_revision=$3
            RETURNING processed_revision`, [root.intake_id, revision, revision],
        );
        if (cursor.rowCount !== 1) throw inputError('YXX_INPUT_CHANGED');
        return { processed: true, replayed: decision.replayed === true, request_ref: requestRef,
          intake_no: root.intake_no, input_revision: String(revision), result_code: decision.result_code,
          decision_id: decision.id, ticket_id: actions.linkedTicketId, action_results: actions.results };
      });
    } catch (error) {
      const safeCode = codeForFailure(error);
      try {
        await withTransaction(pool, async (transaction) => {
          await transaction.query(
            `UPDATE intake.web_request_binding
                SET retry_count=LEAST(retry_count+1,1000),last_safe_error_code=$2,
                    next_attempt_epoch_ms=platform.physical_epoch_ms()+LEAST(300000,1000*(retry_count+1)),updated_at=platform.local_now()
              WHERE request_ref=$1 AND revoked_at IS NULL AND processed_revision<input_revision`, [requestRef, safeCode],
          );
        });
      } catch { /* preserve the original failure; the committed input remains pending */ }
      return { processed: false, pending: true, request_ref: requestRef, error_code: safeCode };
    }
  }

  async function runPending({ batchSize = DEFAULT_BATCH, nowEpochMs = String(Date.now()), signal = null } = {}) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH) throw inputError('YXX_BATCH_INVALID');
    if (signal?.aborted) return Object.freeze({ processed: 0, claimed: 0, reason: 'ABORTED', profile, flags: configuredFlags });
    if (pumpRunning) return Object.freeze({ processed: 0, claimed: 0, reason: 'BUSY', profile, flags: configuredFlags });
    pumpRunning = true;
    try {
      const candidates = await pool.query(
        `SELECT request_ref FROM intake.web_request_binding
          WHERE input_revision>processed_revision AND revoked_at IS NULL
            AND retention_until>platform.local_now()
            AND (next_attempt_epoch_ms IS NULL OR next_attempt_epoch_ms<=$1::bigint)
          ORDER BY COALESCE(next_attempt_epoch_ms,0),intake_id LIMIT $2`, [nowEpochMs, batchSize],
      );
      const results = [];
      for (const candidate of candidates.rows) {
        if (signal?.aborted) break;
        results.push(await processOne({ requestRef: candidate.request_ref }));
      }
      return Object.freeze({ processed: results.filter((item) => item.processed).length, claimed: results.length, results, profile, flags: configuredFlags });
    } finally { pumpRunning = false; }
  }

  async function processPending(options = {}) {
    if (!canProcess) return Object.freeze({ processed: 0, claimed: 0, reason: 'FEATURE_DISABLED', profile, flags: configuredFlags });
    if (profile === 'FULL_SERVICE_LOOP') return Object.freeze({ processed: 0, claimed: 0, reason: 'WORKER_OWNER', profile, flags: configuredFlags });
    return runPending(options);
  }

  async function processPendingFromWorker(options = {}) {
    if (!canProcess) return Object.freeze({ processed: 0, claimed: 0, reason: 'FEATURE_DISABLED', profile, flags: configuredFlags });
    if (profile !== 'FULL_SERVICE_LOOP') return Object.freeze({ processed: 0, claimed: 0, reason: 'PROFILE_NOT_WORKER', profile, flags: configuredFlags });
    return runPending(options);
  }

  return Object.freeze({ profile, flags: configuredFlags, processOne, processPending, processPendingFromWorker });
}

export function createYxxSelfServiceWorker({ orchestrator, pollMilliseconds = 5_000 } = {}) {
  if (!orchestrator?.processPending || orchestrator.profile !== 'MEMBER_SELF_SERVICE'
    || !Number.isInteger(pollMilliseconds) || pollMilliseconds < 100 || pollMilliseconds > 60_000) {
    throw inputError('YXX_SELF_SERVICE_WORKER_CONFIG_INVALID');
  }
  let stopped = true;
  let running = false;
  let timer = null;
  const schedule = (signal) => {
    if (stopped || signal?.aborted) return;
    timer = setTimeout(async () => {
      timer = null;
      if (running) return schedule(signal);
      running = true;
      try { await orchestrator.processPending({ signal }); } finally { running = false; schedule(signal); }
    }, pollMilliseconds);
    timer.unref?.();
  };
  return Object.freeze({
    runOnce(input = {}) { return orchestrator.processPending(input); },
    start({ signal } = {}) { if (!stopped) return false; stopped = false; schedule(signal); return true; },
    async stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null; } while (running) await new Promise((resolve) => setTimeout(resolve, 10)); return Object.freeze({ stopped: true, running: false }); },
  });
}
