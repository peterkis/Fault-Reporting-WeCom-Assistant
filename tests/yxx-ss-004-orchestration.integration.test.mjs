import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createYxxSelfServiceStore } from '../src/yxx-self-service-store.mjs';
import { createYxxSelfServiceOrchestrator, createYxxSelfServiceWorker } from '../src/yxx-self-service-orchestrator.mjs';
import { createYxxMemberCommandContext } from '../src/yxx-self-service-command.mjs';
import { routeP2007Decision } from '../src/p2-015-decision-router.mjs';
import { createP2016ManualReviewFacade } from '../src/p2-016-manual-review-facade.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { migrateCurrentBaselineWithYxx } from '../scripts/migrate-current-baseline.mjs';
import { withP2015IsolatedDatabase } from './helpers/p2-015-postgres-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const SECRET = 'yxx-self-service-test-secret-32-bytes';
const localQuota = Object.assign(async () => true, { localOnly: true });

function scope() {
  return {
    scopeHash: createHash('sha256').update(randomUUID()).digest('hex'),
    sourceCorpScope: 'synthetic-corp', sourceAppScope: 'synthetic-app', proofRef: 'tests/yxx-ss-004',
  };
}

function input(description, location = { text: '本部8层', unknown: false }) {
  return { schema_version: 1, client_command_id: randomUUID(), description, location,
    service_code: null, impact_scope: 'SINGLE_WORKSTATION', reported_department_text: null, extension: null };
}

function commandFor(store, currentScope, profile = 'MEMBER_SELF_SERVICE', quota = localQuota) {
  const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };
  const auth = { profile, write_flag: true, flags, csrf_token: 'synthetic-csrf-token',
    canonical_reporter_binding: currentScope.scopeHash, source_corp_scope: currentScope.sourceCorpScope,
    source_app_scope: currentScope.sourceAppScope, proof_ref: currentScope.proofRef };
  const recheck = Object.assign(async () => auth, { localOnly: true });
  const command = createYxxMemberCommandContext({ store, profile, flags, authenticate: async () => auth, recheck, quota });
  return { command, request: (clientCommandId) => ({ headers: { 'x-csrf-token': auth.csrf_token, 'idempotency-key': clientCommandId } }) };
}

function commitFaultPool(base, { afterCommit = false } = {}) {
  let armed = true;
  return {
    query: base.query.bind(base),
    async connect() {
      const client = await base.connect();
      const query = client.query.bind(client);
      client.query = async (first, ...rest) => {
        const sql = typeof first === 'string' ? first : first?.text;
        const isCommit = typeof sql === 'string' && sql.trim().toUpperCase() === 'COMMIT';
        if (isCommit && armed && !afterCommit) {
          armed = false;
          const error = new Error('YXX_TEST_KILL_BEFORE_COMMIT'); error.code = error.message;
          throw error;
        }
        const result = await query(first, ...rest);
        if (isCommit && armed && afterCommit) {
          armed = false;
          const error = new Error('YXX_TEST_KILL_AFTER_COMMIT'); error.code = error.message;
          throw error;
        }
        return result;
      };
      return client;
    },
  };
}

async function facts(pool, requestRef) {
  const result = await pool.query(`SELECT i.status,i.pilot_ticket_id::text,b.input_revision,b.processed_revision,
      d.source_kind,d.primary_web_submission_id::text,d.basis_input_revision,d.result_code,
      (SELECT count(*)::integer FROM pilot_ticket.ticket t WHERE t.source_intake_id=i.id) AS ticket_count,
      (SELECT count(*)::integer FROM communication.message) AS message_count,
      (SELECT count(*)::integer FROM communication.outbox) AS outbox_count,
      (SELECT count(*)::integer FROM communication.delivery) AS delivery_count,
      (SELECT count(*)::integer FROM pilot_ticket.reporter_access_grant) AS grant_count,
      (SELECT count(*)::integer FROM conversation.session) AS session_count,
      (SELECT count(*)::integer FROM intake.channel_leg WHERE leg_type IN ('DIRECT_GUIDED','DIRECT_ORGANIC','GROUP_CONTINUATION')) AS direct_leg_count,
      (SELECT count(*)::integer FROM intake.manual_review_item r WHERE r.service_intake_id=i.id AND r.status='PENDING') AS pending_reviews
    FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id
    LEFT JOIN LATERAL (SELECT * FROM intake.deterministic_decision x WHERE x.service_intake_id=i.id ORDER BY x.decision_ordinal DESC LIMIT 1) d ON true
   WHERE b.request_ref=$1`, [requestRef]);
  return result.rows[0];
}

test('SS-004 Web adapter is shared-rule, APP_ONLY, and never creates message-side facts', async () => {
  const source = await readFile('src/yxx-self-service-orchestrator.mjs', 'utf8');
  assert.match(source, /source_kind: 'WEB'/u);
  assert.match(source, /delivery_mode: 'APP_ONLY'/u);
  assert.match(source, /WEB_FORM/u);
  assert.doesNotMatch(source, /wecom-sdk|WECOM_SDK|appendCommunication|createP2004/u);
  const routed = routeP2007Decision({
    rule_output: { catalog_version: 'c', rule_set_version: 'r', result_hash: 'a'.repeat(64),
      domain_intent: 'ACKNOWLEDGEMENT_OR_CHATTER', facts: [], missing_fields: [], symptom_codes: [],
      privacy_flags: [], clinical_impact: 'UNKNOWN', clarification_needed: false, result_state: 'COMPLETE' },
    context: { delivery_mode: 'APP_ONLY', safe_normalized_text: '谢谢', source_refs: [], conflicts: [],
      input_hash: 'b'.repeat(64), message_sequence_window: { start: 1, end: 1, count: 1 } },
  });
  assert.equal(routed.result_code, 'ACKNOWLEDGEMENT');
  assert.equal(routed.safe_action_suggestions.some((item) => item.action_type.startsWith('SEND_FIXED_')), false);
  const readonly = createYxxMemberCommandContext({ store: { accept: async () => { throw new Error('must not write'); } },
    profile: 'MEMBER_TICKET_READONLY', flags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true },
    authenticate: async () => ({ profile: 'MEMBER_TICKET_READONLY', write_flag: true, csrf_token: 'csrf',
      canonical_reporter_binding: 'a'.repeat(64), source_corp_scope: 'corp', source_app_scope: 'app', proof_ref: 'test' }),
    recheck: Object.assign(async () => ({ profile: 'MEMBER_TICKET_READONLY' }), { localOnly: true }), quota: localQuota });
  await assert.rejects(readonly.accept({ request: { headers: { 'x-csrf-token': 'csrf', 'idempotency-key': '11111111-1111-4111-8111-111111111111' } },
    input: { client_command_id: '11111111-1111-4111-8111-111111111111' } }), { code: 'YXX_MEMBER_WRITE_DISABLED' });
  const fakePool = { connect() {}, query() {} };
  assert.equal((await createYxxSelfServiceOrchestrator({ pool: fakePool }).processOne({ requestRef: 'a'.repeat(32) })).reason, 'FEATURE_DISABLED');
  const full = createYxxSelfServiceOrchestrator({ pool: fakePool, profile: 'FULL_SERVICE_LOOP',
    featureFlags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true } });
  assert.equal((await full.processPending()).reason, 'WORKER_OWNER');
  assert.throws(() => createYxxSelfServiceWorker({ orchestrator: full, pollMilliseconds: 100 }), { code: 'YXX_SELF_SERVICE_WORKER_CONFIG_INVALID' });
  assert.throws(() => createYxxSelfServiceWorker({ orchestrator: createYxxSelfServiceOrchestrator({ pool: fakePool }), pollMilliseconds: 100 }), { code: 'YXX_SELF_SERVICE_WORKER_CONFIG_INVALID' });
  const memberPump = createYxxSelfServiceOrchestrator({ pool: fakePool, profile: 'MEMBER_SELF_SERVICE',
    featureFlags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true } });
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await memberPump.processPending({ signal: aborted.signal })).reason, 'ABORTED');
  const worker = createYxxSelfServiceWorker({ orchestrator: memberPump, pollMilliseconds: 100 });
  assert.equal(worker.start(), true); assert.equal(worker.start(), false); assert.deepEqual(await worker.stop(), { stopped: true, running: false });
});

test('SS-004 accepts, processes, replays, and creates one Web Ticket through the existing Core', { skip: !databaseUrl, timeout: 120_000 }, async () => {
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'yxx004', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const currentScope = scope();
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    let quotaCalls = 0; let quotaAllowed = true;
    const quota = Object.assign(async () => { quotaCalls += 1; return quotaAllowed; }, { localOnly: true });
    const { command, request } = commandFor(store, currentScope, 'MEMBER_SELF_SERVICE', quota);
    let recheckCalls = 0;
    const fenceAuth = { profile: 'MEMBER_SELF_SERVICE', write_flag: true,
      flags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true },
      csrf_token: 'fence-csrf', session_generation: 'generation-1',
      canonical_reporter_binding: currentScope.scopeHash, source_corp_scope: currentScope.sourceCorpScope,
      source_app_scope: currentScope.sourceAppScope, proof_ref: currentScope.proofRef };
    const fenced = createYxxMemberCommandContext({ store, profile: 'MEMBER_SELF_SERVICE', flags: fenceAuth.flags,
      authenticate: async () => fenceAuth,
      recheck: Object.assign(async () => { recheckCalls += 1; return { ...fenceAuth, session_generation: 'generation-2' }; }, { localOnly: true }),
      quota: localQuota });
    const fencedBody = input('提交前会话已换代');
    await assert.rejects(fenced.accept({ request: { headers: { 'x-csrf-token': fenceAuth.csrf_token, 'idempotency-key': fencedBody.client_command_id } }, input: fencedBody }), { code: 'YXX_AUTH_RECHECK_FAILED' });
    assert.equal(recheckCalls, 1);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM intake.web_command_receipt WHERE client_command_id=$1::uuid', [fencedBody.client_command_id])).rows[0].n, 0);
    const body = input('处方提交不了');
    const accepts = await Promise.all(Array.from({ length: 12 }, () => command.accept({ request: request(body.client_command_id), input: body })));
    assert.equal(accepts.filter((item) => item.replayed === false).length, 1);
    assert.equal(accepts.filter((item) => item.replayed === true).length, 11);
    assert.equal(quotaCalls, 1);
    await assert.rejects(command.accept({ request: request(body.client_command_id), input: { ...body, description: '另一正文' } }), { code: 'YXX_COMMAND_CONFLICT' });
    const independentBody = input('处方提交不了');
    const independent = await command.accept({ request: request(independentBody.client_command_id), input: independentBody });
    assert.notEqual(independent.receipt.request_ref, accepts[0].receipt.request_ref);
    quotaAllowed = false;
    const quotaReplay = await command.accept({ request: request(body.client_command_id), input: body });
    assert.equal(quotaReplay.replayed, true); assert.equal(quotaCalls, 2);
    const recovered = await command.commandStatus({ request: {}, clientCommandId: body.client_command_id });
    assert.equal(recovered.request_ref, accepts[0].receipt.request_ref);
    const orchestrator = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE',
      featureFlags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true } });
    const processed = await orchestrator.processOne({ requestRef: accepts[0].receipt.request_ref });
    assert.equal(processed.processed, true);
    const replayedProcess = await orchestrator.processOne({ requestRef: accepts[0].receipt.request_ref });
    assert.equal(replayedProcess.replayed, true);
    const row = await facts(pool, accepts[0].receipt.request_ref);
    assert.equal(row.status, 'TICKET_CREATED');
    assert.equal(row.input_revision, '1'); assert.equal(row.processed_revision, '1');
    assert.equal(row.source_kind, 'WEB'); assert.equal(String(row.basis_input_revision), '1');
    assert.equal(row.ticket_count, 1); assert.deepEqual([row.message_count, row.outbox_count, row.delivery_count, row.grant_count, row.session_count, row.direct_leg_count], [0, 0, 0, 0, 0, 0]);
    const source = (await pool.query(`SELECT i.source_channel,i.source_provider,i.source_bot_id,i.source_chat_type,i.primary_message_id,
        l.leg_type,l.conversation_session_id,l.conversation_thread_id,l.origin_channel_message_id
      FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id
      JOIN intake.channel_leg l ON l.source_intake_id=i.id WHERE b.request_ref=$1`, [accepts[0].receipt.request_ref])).rows[0];
    assert.deepEqual(source, { source_channel: 'PORTAL', source_provider: 'YIXIAOXIU_WEB', source_bot_id: null,
      source_chat_type: null, primary_message_id: null, leg_type: 'WEB_FORM', conversation_session_id: null,
      conversation_thread_id: null, origin_channel_message_id: null });
  } });
});

test('SS-004 keeps insufficient input pending for details and routes rule failure to shared review', { skip: !databaseUrl, timeout: 120_000 }, async () => {
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'yxx004r', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const currentScope = scope();
    const { command, request } = commandFor(store, currentScope);
    const needsBody = input('系统不行', { text: null, unknown: true });
    const needs = await command.accept({ request: request(needsBody.client_command_id), input: needsBody });
    const orchestrator = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE',
      featureFlags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true } });
    const processed = await orchestrator.processOne({ requestRef: needs.receipt.request_ref });
    assert.equal(processed.result_code, 'NEEDS_DESCRIPTION');
    const needsFacts = await facts(pool, needs.receipt.request_ref);
    assert.equal(needsFacts.status, 'WAITING_DESCRIPTION'); assert.equal(needsFacts.ticket_count, 0); assert.equal(needsFacts.pending_reviews, 0);

    const thanksBody = input('谢谢');
    const thanks = await command.accept({ request: request(thanksBody.client_command_id), input: thanksBody });
    const thanksResult = await orchestrator.processOne({ requestRef: thanks.receipt.request_ref });
    assert.equal(thanksResult.result_code, 'ACKNOWLEDGEMENT'); assert.equal((await facts(pool, thanks.receipt.request_ref)).ticket_count, 0);
    const thanksFaultBody = input('谢谢，但是处方提交不了');
    const thanksFault = await command.accept({ request: request(thanksFaultBody.client_command_id), input: thanksFaultBody });
    const thanksFaultResult = await orchestrator.processOne({ requestRef: thanksFault.receipt.request_ref });
    assert.equal(thanksFaultResult.result_code, 'TICKET_ELIGIBLE'); assert.equal((await facts(pool, thanksFault.receipt.request_ref)).ticket_count, 1);
    const riskBody = input('急诊患者等着做检查，但检查申请完全提交不了', { text: null, unknown: true });
    const risk = await command.accept({ request: request(riskBody.client_command_id), input: riskBody });
    const riskResult = await orchestrator.processOne({ requestRef: risk.receipt.request_ref });
    assert.equal(riskResult.result_code, 'MANUAL_REVIEW_REQUIRED'); assert.equal((await facts(pool, risk.receipt.request_ref)).pending_reviews, 1);

    const rollbackBody = input('事务回滚测试');
    const tx = await pool.connect();
    try { await tx.query('BEGIN'); await store.acceptInTransaction({ scope: currentScope, input: rollbackBody, transaction: tx }); await tx.query('ROLLBACK'); }
    finally { tx.release(); }
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM intake.web_command_receipt WHERE client_command_id=$1::uuid', [rollbackBody.client_command_id])).rows[0].n, 0);
    const afterRollback = await command.accept({ request: request(rollbackBody.client_command_id), input: rollbackBody });
    assert.equal(afterRollback.replayed, false);
    assert.equal((await orchestrator.processOne({ requestRef: afterRollback.receipt.request_ref })).processed, true);

    const brokenBody = input('无法安全判断', { text: null, unknown: true });
    const broken = await command.accept({ request: request(brokenBody.client_command_id), input: brokenBody });
    const failing = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE',
      featureFlags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true }, ruleEngine: {
      catalog_version: 'TEST', rule_set_version: 'TEST', evaluate() { throw new Error('private provider detail'); },
    } });
    const fallback = await failing.processOne({ requestRef: broken.receipt.request_ref });
    assert.equal(fallback.result_code, 'MANUAL_REVIEW_REQUIRED');
    const reviewFacts = await facts(pool, broken.receipt.request_ref);
    assert.equal(reviewFacts.status, 'WAITING_TRIAGE'); assert.equal(reviewFacts.pending_reviews, 1);
    assert.equal(String(reviewFacts.basis_input_revision), '1');
    const poisonBody = input('处方提交不了');
    const healthyBody = input('处方提交不了');
    const poison = await command.accept({ request: request(poisonBody.client_command_id), input: poisonBody });
    const healthy = await command.accept({ request: request(healthyBody.client_command_id), input: healthyBody });
    const core = createPilotTicketCore({ pool });
    const poisonIntake = (await pool.query('SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1', [poison.receipt.request_ref])).rows[0].intake_id;
    let poisonFails = true;
    const poisoned = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE',
      featureFlags: { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true }, ticketCore: {
        createForIntakeInTransaction: async (args) => { if (args.intakeId === poisonIntake && poisonFails) throw new Error('synthetic database outage'); return core.createForIntakeInTransaction(args); },
      } });
    const batch = await poisoned.processPending({ batchSize: 2 });
    assert.equal(batch.claimed, 2); assert.equal(batch.processed, 1);
    const poisonState = (await pool.query('SELECT processed_revision,retry_count,next_attempt_epoch_ms,last_safe_error_code FROM intake.web_request_binding WHERE request_ref=$1', [poison.receipt.request_ref])).rows[0];
    assert.equal(poisonState.processed_revision, '0'); assert.equal(poisonState.retry_count, 1); assert.ok(poisonState.next_attempt_epoch_ms); assert.equal(poisonState.last_safe_error_code, 'YXX_PROCESSING_FAILED');
    assert.equal((await facts(pool, healthy.receipt.request_ref)).ticket_count, 1);
    poisonFails = false;
    const recoveredBatch = await poisoned.processPending({ batchSize: 1, nowEpochMs: '9999999999999' });
    assert.equal(recoveredBatch.processed, 1);
    assert.equal((await facts(pool, poison.receipt.request_ref)).ticket_count, 1);
    const principal = await createPilotAccessService({ pool }).upsertPrincipal({ wecomUserId: 'yxx-reviewer', displayName: 'YXX审核', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT'] });
    const facade = createP2016ManualReviewFacade({ pool, enabled: true });
    const staleBody = input('另一条待审核故障', { text: null, unknown: true });
    const stale = await command.accept({ request: request(staleBody.client_command_id), input: staleBody });
    await failing.processOne({ requestRef: stale.receipt.request_ref });
    const staleDecision = await pool.query('SELECT id::text FROM intake.deterministic_decision WHERE service_intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1) ORDER BY decision_ordinal DESC LIMIT 1', [stale.receipt.request_ref]);
    const staleTarget = (await facade.listManualReviews({ authContext: { principal_id: principal.id } })).items.find((item) => item.decision_id === staleDecision.rows[0].id);
    const staleSupplementBody = { schema_version: 1, client_command_id: randomUUID(), expected_input_revision: '1', text: '补充后证据已变化' };
    await command.accept({ request: request(staleSupplementBody.client_command_id), input: staleSupplementBody, kind: 'SUPPLEMENT', requestRef: stale.receipt.request_ref });
    const staleResolution = await facade.resolveManualReview({ authContext: { principal_id: principal.id }, reviewId: staleTarget.id,
      body: { client_command_id: randomUUID(), expected_row_version: staleTarget.row_version,
        resolution_code: 'CONFIRM_TICKET_ELIGIBLE', resolution_reason_code: 'STALE_BASIS' } });
    assert.equal(staleResolution.ok, false);
    assert.deepEqual(staleResolution.error, { code: 'P2_016_VERSION_CONFLICT', retryable: false });
    const listed = await facade.listManualReviews({ authContext: { principal_id: principal.id } });
    const decision = await pool.query('SELECT id::text FROM intake.deterministic_decision WHERE service_intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1) ORDER BY decision_ordinal DESC LIMIT 1', [broken.receipt.request_ref]);
    const target = listed.items.find((item) => item.decision_id === decision.rows[0].id);
    assert.ok(target);
    const resolved = await facade.resolveManualReview({ authContext: { principal_id: principal.id }, reviewId: target.id,
      body: { client_command_id: randomUUID(), expected_row_version: target.row_version,
        resolution_code: 'CONFIRM_TICKET_ELIGIBLE', resolution_reason_code: 'WEB_HUMAN_CONFIRMED' } });
    assert.equal(resolved.ok, true);
    const resolvedFacts = await facts(pool, broken.receipt.request_ref);
    assert.equal(resolvedFacts.ticket_count, 1); assert.deepEqual([resolvedFacts.message_count, resolvedFacts.outbox_count, resolvedFacts.delivery_count, resolvedFacts.grant_count, resolvedFacts.session_count, resolvedFacts.direct_leg_count], [0, 0, 0, 0, 0, 0]);
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM intake.deterministic_decision d
      WHERE d.service_intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1) AND d.status='HUMAN_OVERRIDDEN' AND d.source_kind='WEB'`, [broken.receipt.request_ref])).rows[0].n, 1);

  } });
});

test('SS-004 AC-037/038 recover accept and process commit boundaries after restart', { skip: !databaseUrl, timeout: 120_000 }, async () => {
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'yxx004c', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const flags = { YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true };

    // AC-037: the COMMIT succeeds but its acknowledgement is lost. A fresh
    // command process recovers the same receipt and then processes the root once.
    const acceptScope = scope();
    const acceptBody = input('处方提交不了');
    const lostAckStore = createYxxSelfServiceStore({ pool: commitFaultPool(pool, { afterCommit: true }), scopeSecret: SECRET });
    const lostAck = commandFor(lostAckStore, acceptScope);
    await assert.rejects(lostAck.command.accept({ request: lostAck.request(acceptBody.client_command_id), input: acceptBody }), { code: 'YXX_TEST_KILL_AFTER_COMMIT' });
    const restartedStore = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const restarted = commandFor(restartedStore, acceptScope);
    const recoveredReceipt = await restarted.command.commandStatus({ request: {}, clientCommandId: acceptBody.client_command_id });
    assert.equal(recoveredReceipt.status, 'ACCEPTED'); assert.ok(recoveredReceipt.request_ref);
    const restartedOrchestrator = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: flags });
    const recoveredProcess = await restartedOrchestrator.processOne({ requestRef: recoveredReceipt.request_ref });
    assert.equal(recoveredProcess.processed, true);
    assert.equal((await restartedOrchestrator.processOne({ requestRef: recoveredReceipt.request_ref })).replayed, true);
    assert.equal((await facts(pool, recoveredReceipt.request_ref)).ticket_count, 1);

    // AC-038 before COMMIT: all Decision/Ticket work rolls back; a restarted
    // processor can safely retry the still-pending root.
    const beforeScope = scope();
    const beforeStore = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const beforeCommand = commandFor(beforeStore, beforeScope);
    const beforeBody = input('处方提交不了');
    const beforeAccepted = await beforeCommand.command.accept({ request: beforeCommand.request(beforeBody.client_command_id), input: beforeBody });
    const beforeOrchestrator = createYxxSelfServiceOrchestrator({ pool: commitFaultPool(pool), profile: 'MEMBER_SELF_SERVICE', featureFlags: flags });
    const beforeKilled = await beforeOrchestrator.processOne({ requestRef: beforeAccepted.receipt.request_ref });
    assert.equal(beforeKilled.processed, false); assert.equal(beforeKilled.pending, true);
    const beforeFacts = await facts(pool, beforeAccepted.receipt.request_ref);
    assert.equal(beforeFacts.ticket_count, 0); assert.equal(beforeFacts.source_kind, null); assert.equal(beforeFacts.processed_revision, '0');
    const beforeRestart = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: flags });
    assert.equal((await beforeRestart.processOne({ requestRef: beforeAccepted.receipt.request_ref })).processed, true);
    assert.equal((await beforeRestart.processOne({ requestRef: beforeAccepted.receipt.request_ref })).replayed, true);
    assert.equal((await facts(pool, beforeAccepted.receipt.request_ref)).ticket_count, 1);

    // AC-038 after COMMIT: the Ticket and Decision are durable even when the
    // processor loses its acknowledgement; restart sees the processed cursor.
    const afterScope = scope();
    const afterStore = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const afterCommand = commandFor(afterStore, afterScope);
    const afterBody = input('处方提交不了');
    const afterAccepted = await afterCommand.command.accept({ request: afterCommand.request(afterBody.client_command_id), input: afterBody });
    const afterOrchestrator = createYxxSelfServiceOrchestrator({ pool: commitFaultPool(pool, { afterCommit: true }), profile: 'MEMBER_SELF_SERVICE', featureFlags: flags });
    const afterKilled = await afterOrchestrator.processOne({ requestRef: afterAccepted.receipt.request_ref });
    assert.equal(afterKilled.processed, false); assert.equal(afterKilled.pending, true);
    assert.equal((await facts(pool, afterAccepted.receipt.request_ref)).ticket_count, 1);
    const afterRestart = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: flags });
    assert.equal((await afterRestart.processOne({ requestRef: afterAccepted.receipt.request_ref })).replayed, true);
    assert.equal((await facts(pool, afterAccepted.receipt.request_ref)).ticket_count, 1);
  } });
});
