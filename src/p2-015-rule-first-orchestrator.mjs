import { createRuleEngine } from './p2-007-rule-engine.mjs';
import { formatEpochMsToShanghaiLocal, shanghaiLocalToEpochMs } from './platform/time-contract.mjs';
import {
  P2_015_ERROR_CODES,
  P2_015_LIMITS,
  failP2015,
  freezePublic,
  hmacIdentity,
  normalizeP2015FeatureFlags,
  safeHash,
  snapshotP2015Json,
} from './p2-015-domain-contracts.mjs';
import { createContactJourneyStore, DeferredDirectory, reporterIdentityHash } from './p2-015-contact-journey.mjs';
import { createContinuationRefService } from './p2-015-continuation-ref.mjs';
import { routeP2007Decision, routeRuleFailure } from './p2-015-decision-router.mjs';
import { createDecisionStore } from './p2-015-decision-store.mjs';

async function withTransaction(pool, operation) {
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally {
    client.release(destroy);
  }
}

async function loadIntake(transaction, intakeId, lock = false) {
  const result = await transaction.query(
    `SELECT intake.id::text,intake.source_provider,intake.source_bot_id,intake.source_chat_type,
            intake.source_chat_id,intake.reporter_wecom_userid,intake.privacy_class,intake.retention_until,
            intake.retention_until_epoch_ms::text,intake.request_type,intake.status,intake.pilot_ticket_id::text,
            intake.primary_message_id::text,intake.last_message_at,intake.version,intake.created_at,
            session.id::text AS session_id,thread.id::text AS thread_id,thread.provider AS thread_provider,
            thread.channel_account_id,thread.chat_type AS thread_chat_type,thread.external_thread_key
       FROM intake.service_intake AS intake
       LEFT JOIN conversation.session AS session ON session.service_intake_id=intake.id AND session.status<>'ENDED'
       LEFT JOIN conversation.thread AS thread ON thread.id=session.thread_id
      WHERE intake.id=$1::uuid ${lock ? 'FOR UPDATE OF intake' : ''}`,
    [intakeId],
  );
  if (result.rowCount !== 1) failP2015(P2_015_ERROR_CODES.storageFailed);
  return result.rows[0];
}

async function loadWindow(transaction, intakeId) {
  const result = await transaction.query(
    `SELECT relation.sequence_no,message.id::text AS message_id,message.clean_text,message.msg_type,
            message.normalized_message,message.received_at
       FROM intake.service_intake_message relation
       JOIN channel.message_inbox message ON message.id=relation.channel_message_id
      WHERE relation.intake_id=$1::uuid ORDER BY relation.sequence_no LIMIT $2`,
    [intakeId, P2_015_LIMITS.messageWindowTurns + 1],
  );
  if (result.rows.length === 0) failP2015(P2_015_ERROR_CODES.storageFailed);
  const texts = result.rows.map((row) => row.clean_text ?? '').filter((text) => text.length > 0);
  const total = texts.reduce((sum, text) => sum + text.length, 0);
  return {
    rows: result.rows,
    bounded: result.rows.length <= P2_015_LIMITS.messageWindowTurns && total <= P2_015_LIMITS.evaluatedTextCharacters,
    text: texts.join('\n'),
    total,
  };
}

function entryMode(intake, window) {
  if (intake.source_chat_type === 'single') return 'DIRECT_ORGANIC';
  const generic = window.text.trim() === '' || /^(在吗|@?bot|系统不行)[!.。！ ]*$/iu.test(window.text.trim());
  return generic ? 'GROUP_MENTION_TO_DIRECT_GUIDED' : 'GROUP_MENTION_INLINE';
}

function legType(mode) {
  return mode === 'DIRECT_ORGANIC' ? 'DIRECT_ORGANIC' : 'GROUP_ORIGIN';
}

function destinationFor(intake) {
  const group = intake.source_chat_type === 'group';
  const targetId = group ? intake.source_chat_id : intake.reporter_wecom_userid;
  if (!targetId) return null;
  return {
    provider: 'WECOM_AIBOT', channel_account_id: intake.source_bot_id,
    target_type: group ? 'GROUP' : 'PERSON', target_id: targetId,
  };
}

function orchestrationContext({ intake, journey, window, traceId }) {
  const result = {
    trace_id: traceId,
    session_id: intake.session_id,
    privacy_class: intake.privacy_class,
    retention_until: intake.retention_until,
    retention_until_epoch_ms: intake.retention_until_epoch_ms,
    destination: destinationFor(intake),
  };
  if (journey.entry_mode === 'GROUP_MENTION_TO_DIRECT_GUIDED') {
    result.fixed_text = '为保护信息安全，请关注机器人单聊并在那里补充故障现象。';
  }
  return result;
}

export function createRuleFirstOrchestrator({ pool, identityHmacKey, directoryPort = DeferredDirectory(),
  ruleEngine = null, journeyStore = createContactJourneyStore(), continuationService = createContinuationRefService(),
  decisionStore = createDecisionStore(), safeActionExecutor } = {}) {
  if (!pool?.connect || typeof identityHmacKey !== 'string' || identityHmacKey.length < 16
    || !safeActionExecutor) failP2015(P2_015_ERROR_CODES.inputInvalid);
  const engine = ruleEngine ?? createRuleEngine();

  async function processInTransaction({ transaction, intakeId, profile, reporterHash, flags, traceId }) {
    const intake = await loadIntake(transaction, intakeId, true);
    const window = await loadWindow(transaction, intakeId);
    const mode = entryMode(intake, window);
    const observedAt = intake.last_message_at;
    const observedEpochMs = shanghaiLocalToEpochMs(observedAt);
    const dueEpochMs = String(BigInt(observedEpochMs) + (mode === 'GROUP_MENTION_TO_DIRECT_GUIDED' ? 3_000n : 0n));
    const journey = await journeyStore.ensureJourney({ transaction, input: {
      origin_intake_id: intake.id, session_id: intake.session_id, linked_ticket_id: intake.pilot_ticket_id,
      entry_mode: mode, reporter_identity_hash: reporterHash, profile_resolution_status: profile.status,
      profile_snapshot: profile.snapshot, evaluation_due_at: formatEpochMsToShanghaiLocal(dueEpochMs),
      evaluation_due_epoch_ms: dueEpochMs, reported_at: intake.created_at,
      privacy_class: intake.privacy_class, retention_until: intake.retention_until,
      retention_until_epoch_ms: intake.retention_until_epoch_ms,
    } });
    const leg = await journeyStore.ensureLeg({ transaction, input: {
      journey_id: journey.id, leg_type: legType(mode), source_intake_id: intake.id,
      conversation_thread_id: intake.thread_id, conversation_session_id: intake.session_id,
      origin_channel_message_id: intake.primary_message_id,
      provider_context_hash: safeHash({ provider: intake.source_provider, message: intake.primary_message_id }),
      channel_identity_hash: hmacIdentity(`${intake.source_bot_id}\u0000${intake.source_chat_type}\u0000${intake.source_chat_id ?? reporterHash}`, identityHmacKey),
      reporter_identity_hash: reporterHash, opened_at: intake.created_at,
    } });
    let continuation = null;
    if (mode === 'GROUP_MENTION_TO_DIRECT_GUIDED') {
      continuation = await continuationService.issue({ transaction, input: {
        journey_id: journey.id, origin_leg_id: leg.id, purpose: 'GROUP_TO_DIRECT_GUIDANCE',
        reporter_binding_hash: reporterHash, bot_binding_hash: hmacIdentity(intake.source_bot_id, identityHmacKey),
        issue_idempotency_key: `continue_v1_${safeHash({ journey: journey.id, purpose: 'GROUP_TO_DIRECT_GUIDANCE' })}`,
        issued_at: observedAt, issued_epoch_ms: observedEpochMs,
      } });
    }
    const sourceRefs = window.rows.map((row) => `channel:${row.message_id}`);
    const sourceHash = safeHash(window.rows.map((row) => ({ sequence_no: row.sequence_no, message_id: row.message_id, clean_text_hash: safeHash({ text: row.clean_text ?? '', type: row.msg_type }) })));
    const routeContext = {
      service_intake_id: intake.id, journey_ref: journey.id,
      source_refs: sourceRefs, message_sequence_window: {
        start: window.rows[0].sequence_no, end: window.rows.at(-1).sequence_no, count: window.rows.length,
      },
      safe_normalized_text: window.text,
      reliable_follow_up: false,
      conflicts: [],
      input_hash: safeHash({ source_hash: sourceHash }),
    };
    let routed;
    if (!window.bounded) {
      routed = routeRuleFailure({ ...routeContext, catalog_version: engine.catalog_version ?? 'UNAVAILABLE', rule_set_version: engine.rule_set_version ?? 'UNAVAILABLE' });
      routed = freezePublic({ ...routed, reason_code: 'MESSAGE_WINDOW_LIMIT_EXCEEDED', result_hash: safeHash({ ...routed, reason_code: 'MESSAGE_WINDOW_LIMIT_EXCEEDED' }) });
    } else {
      try {
        const output = engine.evaluate({ text: window.text, source_ref: `intake:${intake.id}`, observed_at: observedAt,
          context: { existing_ticket: intake.pilot_ticket_id !== null } });
        routed = routeP2007Decision({ rule_output: output, context: routeContext });
      } catch {
        routed = routeRuleFailure({ ...routeContext, catalog_version: engine.catalog_version ?? 'UNAVAILABLE', rule_set_version: engine.rule_set_version ?? 'UNAVAILABLE' });
      }
    }
    const decision = await decisionStore.record({ transaction, input: {
      journey_id: journey.id, channel_leg_id: leg.id, service_intake_id: intake.id,
      conversation_session_id: intake.session_id, linked_ticket_id: intake.pilot_ticket_id,
      source_window_start_sequence: window.rows[0].sequence_no,
      source_window_end_sequence: window.rows.at(-1).sequence_no,
      source_message_count: window.rows.length, source_hash: sourceHash,
      catalog_version: routed.catalog_version, rule_set_version: routed.rule_set_version,
      engine_version: routed.engine_version, decision_policy_version: routed.decision_policy_version,
      result_code: routed.result_code, reason_code: routed.reason_code, input_hash: routed.input_hash,
      result_hash: routed.result_hash, safe_result: routed,
      requires_manual_review: routed.manual_review_required,
      ticket_creation_recommended: routed.ticket_creation_recommended,
      incident_review_candidate: routed.incident_review_candidate,
      observed_at: observedAt, safe_action_suggestions: routed.safe_action_suggestions,
    } });
    const actionResults = await safeActionExecutor.execute({ transaction, decision,
      context: orchestrationContext({ intake, journey, window, traceId }) });
    return freezePublic({ ok: true, flags, journey, leg, continuation, decision, action_results: actionResults,
      model_provider_calls: 0, sender_calls: 0, incident_writes: 0 });
  }

  async function processPersistedIntake(input) {
    const value = snapshotP2015Json(input);
    const flags = normalizeP2015FeatureFlags(value.feature_flags ?? {});
    if (!flags.rule_first_orchestration_enabled) return freezePublic({ ok: true, processed: false, reason: 'FEATURE_DISABLED', model_provider_calls: 0 });
    const prepared = await preparePersistedIntake(value.service_intake_id);
    const operation = (transaction) => processInTransaction({ transaction, intakeId: value.service_intake_id,
      profile: prepared.profile, reporterHash: prepared.reporter_hash, flags,
      traceId: value.trace_id ?? `p2-015-${prepared.primary_message_id}` });
    return withTransaction(pool, operation);
  }

  async function preparePersistedIntake(intakeId) {
    const preload = await loadIntake(pool, intakeId, false);
    const reporterHash = reporterIdentityHash({ provider: preload.source_provider, bot_id: preload.source_bot_id,
      reporter_external_id: preload.reporter_wecom_userid, hmac_key: identityHmacKey });
    const profile = await directoryPort.resolve({ reporter_identity_hash: reporterHash, source: 'WECOM_DIRECTORY' });
    return freezePublic({ service_intake_id: preload.id, primary_message_id: preload.primary_message_id,
      reporter_hash: reporterHash, profile });
  }

  return Object.freeze({ processPersistedIntake, preparePersistedIntake, processInTransaction });
}
