import type { PostgresTransaction, PostgresPool } from './platform/postgres-pool.mjs';
import type { LocalDateTime } from '../contracts/time_contracts.js';
import type { ReporterDirectoryPort, ReporterDirectoryResult, P2015OrchestrationInput, P2015EntryMode } from '../contracts/p2_015_contracts.js';
import type { RuleEvaluationInput, RuleResult } from './p2-007-rule-engine.mjs';
import type { SafeActionExecutor, SafeActionContext } from './p2-015-safe-action-executor.mjs';
import type { RouteContext, BoundarySafeRoute } from './p2-015-decision-router.mjs';
import type { OrchestrationJourney } from './p2-016-guided-journey.mjs';
import type { ContactJourneyInput, ChannelLegInput, ChannelLegRow } from './p2-015-contact-journey.mjs';
import type { DecisionStore } from './p2-015-decision-store.mjs';
import type { CommunicationCommand, CommunicationDestination } from './p2-004-communication-core.mjs';
export interface PersistedOrchestrationIntake { id: string; source_provider: string; source_bot_id: string; source_chat_type: 'single' | 'group'; source_chat_id: string | null; reporter_wecom_userid: string; privacy_class: CommunicationCommand['privacy_class']; retention_until: string; retention_until_epoch_ms: string; request_type: string; status: string; pilot_ticket_id: string | null; primary_message_id: string; last_message_at: LocalDateTime; version: number; created_at: string; origin_reported_at: string; recorded_entry_mode: P2015EntryMode | null; session_id: string | null; thread_id: string | null }
interface WindowRow { sequence_no: number; message_id: string; clean_text: string | null; msg_type: string; normalized_message: unknown; received_at: string; received_epoch_ms: string }
interface Window { rows: WindowRow[]; bounded: boolean; text: string; total: number }
export interface OrchestrationRuleEngine { evaluate(input: RuleEvaluationInput): unknown; catalog_version?: string; rule_set_version?: string }
export interface OrchestrationJourneyStore { ensureJourney(input: { transaction: PostgresTransaction; input: ContactJourneyInput }): Promise<OrchestrationJourney>; ensureLeg(input: { transaction: PostgresTransaction; input: ChannelLegInput }): Promise<ChannelLegRow & { replayed: boolean }> }
export interface OrchestrationOptions { pool: PostgresPool; identityHmacKey: string; directoryPort?: ReporterDirectoryPort; directorySource?: string; ruleEngine?: OrchestrationRuleEngine | null; journeyStore?: OrchestrationJourneyStore; continuationService?: Pick<ReturnType<typeof createContinuationRefService>, 'issue'>; decisionStore?: DecisionStore; safeActionExecutor: SafeActionExecutor; decisionOverride?: ((input: { transaction: PostgresTransaction; journey: OrchestrationJourney; routeContext: RouteContext }) => Promise<BoundarySafeRoute | null> | BoundarySafeRoute | null) | null }
export interface ProcessInTransactionInput { transaction: PostgresTransaction; intakeId: string; profile: ReporterDirectoryResult; reporterHash: string; flags: ReturnType<typeof normalizeP2015FeatureFlags>; traceId: string }
export type RuleFirstOrchestrator = ReturnType<typeof createRuleFirstOrchestrator>;
import { freezeReporterProfileEnvelope } from './p2-015-reporter-profile.mjs';
import { createRuleEngine } from './p2-007-rule-engine.mjs';
import { parseExplicitContinuation } from './p2-015-explicit-continuation.mjs';
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
import { routeP2007Decision, routeRuleFailure, P2_015_ENGINE_VERSION, P2_015_DECISION_POLICY_VERSION } from './p2-015-decision-router.mjs';
import { readGroupCorroboration, assessGroupCorroborationSafety } from './p2-015-group-corroboration.mjs';
import { createDecisionStore } from './p2-015-decision-store.mjs';

async function withTransaction<T>(pool: PostgresPool, operation: (transaction: PostgresTransaction) => Promise<T>) {
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

async function loadIntake(transaction: PostgresTransaction, intakeId: string, lock = false) {
  const result = await transaction.query<PersistedOrchestrationIntake>(
    `SELECT intake.id::text,intake.source_provider,intake.source_bot_id,intake.source_chat_type,
            intake.source_chat_id,intake.reporter_wecom_userid,intake.privacy_class,intake.retention_until,
            intake.retention_until_epoch_ms::text,intake.request_type,intake.status,intake.pilot_ticket_id::text,
            intake.primary_message_id::text,intake.last_message_at,intake.version,intake.created_at,
            CASE WHEN primary_message.provider_create_epoch_ms IS NOT NULL
              AND primary_message.provider_create_epoch_ms<=primary_message.received_epoch_ms
              THEN primary_message.create_time ELSE primary_message.received_at END AS origin_reported_at,
            journey.entry_mode AS recorded_entry_mode,
            session.id::text AS session_id,thread.id::text AS thread_id,thread.provider AS thread_provider,
            thread.channel_account_id,thread.chat_type AS thread_chat_type,thread.external_thread_key
       FROM intake.service_intake AS intake
       JOIN channel.message_inbox primary_message ON primary_message.id=intake.primary_message_id
       LEFT JOIN intake.contact_journey AS journey ON journey.origin_intake_id=intake.id
       LEFT JOIN conversation.session AS session ON session.service_intake_id=intake.id AND session.status<>'ENDED'
       LEFT JOIN conversation.thread AS thread ON thread.id=session.thread_id
      WHERE intake.id=$1::uuid ${lock ? 'FOR UPDATE OF intake' : ''}`,
    [intakeId],
  );
  if (result.rowCount !== 1) failP2015(P2_015_ERROR_CODES.storageFailed);
  return result.rows[0] as PersistedOrchestrationIntake;
}

async function loadWindow(transaction: PostgresTransaction, intakeId: string) {
  const result = await transaction.query<WindowRow>(
    `SELECT relation.sequence_no,message.id::text AS message_id,message.clean_text,message.msg_type,
            message.normalized_message,message.received_at,message.received_epoch_ms::text
       FROM intake.service_intake_message relation
       JOIN channel.message_inbox message ON message.id=relation.channel_message_id
      WHERE relation.intake_id=$1::uuid ORDER BY relation.sequence_no LIMIT $2`,
    [intakeId, P2_015_LIMITS.messageWindowTurns + 1],
  );
  if (result.rows.length === 0) failP2015(P2_015_ERROR_CODES.storageFailed);
  const texts = result.rows.map((row) => row.clean_text ?? '').filter((text) => text.length > 0);
  const joinedText = texts.join('\n');
  const total = joinedText.length;
  return {
    rows: result.rows,
    bounded: result.rows.length <= P2_015_LIMITS.messageWindowTurns && total <= P2_015_LIMITS.evaluatedTextCharacters,
    text: joinedText,
    total,
  };
}

function entryMode(intake: PersistedOrchestrationIntake, window: Window): P2015EntryMode {
  // Entry is a persisted origin fact, not a classification of each later message window.
  if (intake.recorded_entry_mode) return intake.recorded_entry_mode;
  if (intake.source_chat_type === 'single') return 'DIRECT_ORGANIC';
  // A real WeCom callback retains the bot's display-name mention. Only classify the
  // remaining description here; the persisted text and rule/provenance input stay intact.
  const description = window.text.replace(/^@[^\s@]+(?:\s+|$)/u, '').trim();
  const generic = description === '' || /^(在吗|@?bot|系统不行)[!.。！ ]*$/iu.test(description);
  return generic ? 'GROUP_MENTION_TO_DIRECT_GUIDED' : 'GROUP_MENTION_INLINE';
}

function legType(mode: P2015EntryMode) {
  return mode === 'DIRECT_ORGANIC' ? 'DIRECT_ORGANIC' : 'GROUP_ORIGIN';
}

function destinationFor(intake: PersistedOrchestrationIntake): CommunicationDestination | null {
  const group = intake.source_chat_type === 'group';
  const targetId = group ? intake.source_chat_id : intake.reporter_wecom_userid;
  if (!targetId) return null;
  return {
    provider: 'WECOM_AIBOT', channel_account_id: intake.source_bot_id,
    target_type: group ? 'GROUP' : 'PERSON', target_id: targetId,
  };
}

function orchestrationContext({ intake, journey, window, traceId }: { intake: PersistedOrchestrationIntake; journey: OrchestrationJourney; window: Window; traceId: string }) {
  const result: SafeActionContext = {
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

export function createRuleFirstOrchestrator({ pool, identityHmacKey, directoryPort = DeferredDirectory(), directorySource = 'WECOM_DIRECTORY',
  ruleEngine = null, journeyStore = createContactJourneyStore(), continuationService = createContinuationRefService(),
  decisionStore = createDecisionStore(), safeActionExecutor, decisionOverride = null }: OrchestrationOptions = {} as OrchestrationOptions) {
  if (!pool?.connect || typeof identityHmacKey !== 'string' || identityHmacKey.length < 16
    || !safeActionExecutor || (decisionOverride !== null && typeof decisionOverride !== 'function')) failP2015(P2_015_ERROR_CODES.inputInvalid);
  const engine: OrchestrationRuleEngine = ruleEngine ?? createRuleEngine();

  async function processInTransaction({ transaction, intakeId, profile, reporterHash, flags, traceId }: ProcessInTransactionInput) {
    const intake = await loadIntake(transaction, intakeId, true);
    const window = await loadWindow(transaction, intakeId);
    if(intake.source_chat_type==='group') {
      // A bot display-name mention is addressing metadata, not a fault claim.
      // Keep the original rows for source hashes and persisted provenance.
      window.text=window.rows.map(row=>(row.clean_text??'').replace(/^@[^\s@]+(?:\s+|$)/u,'')).filter(Boolean).join('\n');
    }
    const mode = entryMode(intake, window);
    if(intake.source_chat_type==='single')window.text=window.rows.map(row=>{
      const text=row.clean_text??'';return parseExplicitContinuation(text)?.description??text;
    }).filter(Boolean).join('\n');
    const observedAt = intake.last_message_at;
    const observedEpochMs = shanghaiLocalToEpochMs(observedAt);
    const dueEpochMs = String(BigInt(observedEpochMs) + (mode === 'GROUP_MENTION_TO_DIRECT_GUIDED' ? 3_000n : 0n));
    const journey = await journeyStore.ensureJourney({ transaction, input: {
      origin_intake_id: intake.id, session_id: intake.session_id, linked_ticket_id: intake.pilot_ticket_id,
      entry_mode: mode, reporter_identity_hash: reporterHash, profile_resolution_status: profile.status,
      profile_snapshot: profile.snapshot, evaluation_due_at: formatEpochMsToShanghaiLocal(dueEpochMs),
      evaluation_due_epoch_ms: dueEpochMs, reported_at: intake.origin_reported_at,last_activity_at:intake.last_message_at,
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
    const routeContext: RouteContext = {
      service_intake_id: intake.id, journey_ref: journey.id,
      ...(journey.association_reason?{journey_association:{method:journey.association_reason,
        journey_ref:journey.id,channel_leg_ref:leg.id}}:{}),
      source_refs: sourceRefs, message_sequence_window: {
        start: (window.rows[0] as WindowRow).sequence_no, end: (window.rows.at(-1) as WindowRow).sequence_no, count: window.rows.length,
      },
      // An oversized window goes to Review without evaluating a truncated prefix.
      safe_normalized_text: window.bounded ? window.text : '',
      reliable_follow_up: false,
      ...(profile.status === 'RESOLVED' && profile.snapshot?.source === 'WECOM_DIRECTORY'
        && typeof profile.snapshot.version === 'string' && profile.snapshot.version.length > 0
        && profile.snapshot.account_status === 'INACTIVE' ? {
          identity_review_required: true, directory_snapshot_hash: safeHash(profile.snapshot),
          directory_assertion: { source: 'WECOM_DIRECTORY', account_status: 'INACTIVE', version: profile.snapshot.version,
            valid_at: profile.snapshot.valid_at ?? null, fetched_at: profile.snapshot.fetched_at ?? null },
        } : {}),
      conflicts: [],
      input_hash: safeHash({ source_hash: sourceHash }),
    };
    let routed = decisionOverride ? await decisionOverride({ transaction, journey, routeContext }) : null;
    if (['MULTIPLE_GUIDED_JOURNEYS','EXPLICIT_REFERENCE_REJECTED'].includes((routed?.reason_code as string))) {
      // Association uncertainty does not suppress recognition of this Intake's own fault.
      routeContext.association_review_required = true;
      routeContext.association_review_reason = (routed as BoundarySafeRoute).reason_code;
      routed = null;
    }
    if (routed !== null) {
      routed = freezePublic(routed);
    } else if (!window.bounded) {
      routed = routeRuleFailure({ ...routeContext, catalog_version: engine.catalog_version ?? 'UNAVAILABLE', rule_set_version: engine.rule_set_version ?? 'UNAVAILABLE' });
      routed = freezePublic({ ...routed, reason_code: 'MESSAGE_WINDOW_LIMIT_EXCEEDED', result_hash: safeHash({ ...routed, reason_code: 'MESSAGE_WINDOW_LIMIT_EXCEEDED' }) });
    } else {
      try {
        let output = engine.evaluate({ text: window.text, source_ref: `intake:${intake.id}`, observed_at: observedAt,
          context: { existing_ticket: intake.pilot_ticket_id !== null } });
        const prior=await transaction.query<{ safe_result: BoundarySafeRoute; input_hash: string; result_hash: string; source_hash: string }>(`SELECT safe_result,input_hash,result_hash,source_hash FROM intake.deterministic_decision
          WHERE service_intake_id=$1::uuid AND source_window_start_sequence=$2 AND source_window_end_sequence=$3
            AND catalog_version=$4 AND rule_set_version=$5 AND engine_version=$6 AND decision_policy_version=$7
          ORDER BY decision_ordinal DESC LIMIT 1`,[intake.id,(window.rows[0] as WindowRow).sequence_no,(window.rows.at(-1) as WindowRow).sequence_no,
            (output as { catalog_version?: unknown }).catalog_version,(output as { rule_set_version?: unknown }).rule_set_version,P2_015_ENGINE_VERSION,P2_015_DECISION_POLICY_VERSION]);
        if(prior.rowCount){
          const p=prior.rows[0] as (typeof prior.rows)[number];if(p.source_hash!==sourceHash)failP2015(P2_015_ERROR_CODES.decisionConflict);
          routed=freezePublic({...p.safe_result,input_hash:p.input_hash,result_hash:p.result_hash});
        }else{
          const anchor=await readGroupCorroboration({transaction,intake,window,reporterHash,catalogVersion:(output as { catalog_version?: unknown }).catalog_version,ruleVersion:(output as { rule_set_version?: unknown }).rule_set_version});
          if(anchor)output=engine.evaluate({text:window.text,source_ref:`intake:${intake.id}`,observed_at:observedAt,
            context:{existing_ticket:intake.pilot_ticket_id!==null,anchor_compatible:true,
              anchor_age_ms:Number(BigInt(anchor.reply_received_epoch_ms)-BigInt(anchor.root_received_epoch_ms)),corroboration_anchor:anchor}});
          routeContext.group_corroboration_safety=assessGroupCorroborationSafety({intake,window,output});
          routed = routeP2007Decision({ rule_output: output, context: routeContext });
        }
      } catch (error) {
        if((error as { code?: unknown } | null)?.code===P2_015_ERROR_CODES.decisionConflict)throw error;
        routed = routeRuleFailure({ ...routeContext, catalog_version: engine.catalog_version ?? 'UNAVAILABLE', rule_set_version: engine.rule_set_version ?? 'UNAVAILABLE' });
      }
    }
    const decision = await decisionStore.record({ transaction, input: {
      journey_id: journey.id, channel_leg_id: leg.id, service_intake_id: intake.id,
      conversation_session_id: intake.session_id, linked_ticket_id: intake.pilot_ticket_id,
      source_window_start_sequence: (window.rows[0] as WindowRow).sequence_no,
      source_window_end_sequence: (window.rows.at(-1) as WindowRow).sequence_no,
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

  async function processPersistedIntake(input: P2015OrchestrationInput) {
    const value = snapshotP2015Json(input);
    const flags = normalizeP2015FeatureFlags(value.feature_flags ?? {});
    if (!flags.rule_first_orchestration_enabled) return freezePublic({ ok: true, processed: false, reason: 'FEATURE_DISABLED', model_provider_calls: 0 });
    const prepared = await preparePersistedIntake(value.service_intake_id);
    const operation = (transaction: PostgresTransaction) => processInTransaction({ transaction, intakeId: value.service_intake_id,
      profile: prepared.profile, reporterHash: prepared.reporter_hash, flags,
      traceId: value.trace_id ?? `p2-015-${prepared.primary_message_id}` });
    return withTransaction(pool, operation);
  }

  async function preparePersistedIntake(intakeId: string) {
    const preload = await loadIntake(pool, intakeId, false);
    const reporterHash = reporterIdentityHash({ provider: preload.source_provider, bot_id: preload.source_bot_id,
      reporter_external_id: preload.reporter_wecom_userid, hmac_key: identityHmacKey });
    const profile = await directoryPort.resolve({ reporter_identity_hash: reporterHash, source: directorySource,
      source_namespace: preload.source_provider, source_provider: preload.source_provider,
      bot_id:preload.source_bot_id,reporter_external_id:preload.reporter_wecom_userid });
    return Object.freeze({ ...freezePublic({ service_intake_id: preload.id, primary_message_id: preload.primary_message_id,
      reporter_hash: reporterHash }), profile: freezeReporterProfileEnvelope(profile, 'snapshot') });
  }

  return Object.freeze({ processPersistedIntake, preparePersistedIntake, processInTransaction });
}
