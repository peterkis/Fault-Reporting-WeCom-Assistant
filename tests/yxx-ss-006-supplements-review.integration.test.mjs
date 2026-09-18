import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createYxxSelfServiceStore } from '../src/yxx-self-service-store.mjs';
import { createYxxMemberCommandContext } from '../src/yxx-self-service-command.mjs';
import { createYxxSelfServiceSupplement } from '../src/yxx-self-service-supplement.mjs';
import { createYxxSelfServiceOrchestrator } from '../src/yxx-self-service-orchestrator.mjs';
import { createP2016ManualReviewFacade } from '../src/p2-016-manual-review-facade.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { migrateCurrentBaselineWithYxx } from '../scripts/migrate-current-baseline.mjs';
import { withP2016IsolatedDatabase, assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const FLAGS = Object.freeze({ YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true });
const SECRET = 'synthetic-yxx-ss006-secret-at-least-32';

function scope(label) {
  return Object.freeze({
    scopeHash: createHash('sha256').update(`yxx-ss006-${label}`).digest('hex'),
    sourceCorpScope: 'synthetic-corp', sourceAppScope: 'synthetic-app', proofRef: 'tests/yxx-ss-006',
  });
}

function auth(scopeValue) {
  return {
    profile: 'MEMBER_SELF_SERVICE', flags: FLAGS, write_flag: true, csrf_token: 'synthetic-ss006-csrf',
    session_generation: 'generation-1', canonical_reporter_binding: scopeValue.scopeHash,
    source_corp_scope: scopeValue.sourceCorpScope, source_app_scope: scopeValue.sourceAppScope,
    proof_ref: scopeValue.proofRef,
  };
}

function commandFor(store, scopeValue) {
  const context = auth(scopeValue);
  const recheck = Object.assign(async () => context, { localOnly: true });
  const quota = Object.assign(async () => true, { localOnly: true });
  const command = createYxxMemberCommandContext({ store, profile: 'MEMBER_SELF_SERVICE', flags: FLAGS,
    authenticate: async () => context, recheck, quota });
  return { command, supplement: createYxxSelfServiceSupplement({ command }), request: (id) => ({
    headers: { 'x-csrf-token': context.csrf_token, 'idempotency-key': id },
  }) };
}

function submit(description, clientCommandId = randomUUID(), location = { text: '本部住院楼8层护士站', unknown: false }) {
  return { schema_version: 1, client_command_id: clientCommandId, description, location,
    service_code: null, impact_scope: 'SINGLE_WORKSTATION', reported_department_text: null, extension: null };
}

function supplement(text, expectedInputRevision, clientCommandId = randomUUID()) {
  return { schema_version: 1, client_command_id: clientCommandId,
    expected_input_revision: String(expectedInputRevision), text };
}

async function pendingReview(pool, requestRef) {
  return (await pool.query(`SELECT r.id::text,r.row_version::text FROM intake.manual_review_item r
    JOIN intake.web_request_binding b ON b.intake_id=r.service_intake_id
    WHERE b.request_ref=$1 AND r.status='PENDING' ORDER BY r.created_at DESC LIMIT 1`, [requestRef])).rows[0];
}

test('SS-006 accepts ordered supplements, replays idempotently, and fences concurrent stale versions', { skip: !databaseUrl, timeout: 180_000 }, async () => {
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'yxx006acc', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const memberA = scope('a');
    const memberB = scope('b');
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const a = commandFor(store, memberA);
    const b = commandFor(store, memberB);
    const initial = submit('原始报修内容');
    const accepted = await a.command.accept({ request: a.request(initial.client_command_id), input: initial });
    const first = supplement('第一条补充', 1);
    const firstAccepted = await a.supplement.accept({ request: a.request(first.client_command_id), input: first,
      requestRef: accepted.receipt.request_ref });
    const replay = await a.supplement.accept({ request: a.request(first.client_command_id), input: first,
      requestRef: accepted.receipt.request_ref });
    assert.equal(firstAccepted.receipt.accepted_revision, '2');
    assert.equal(replay.replayed, true);
    const second = supplement('第二条补充', 2);
    assert.equal((await a.supplement.accept({ request: a.request(second.client_command_id), input: second,
      requestRef: accepted.receipt.request_ref })).receipt.accepted_revision, '3');
    const facts = (await pool.query(`SELECT b.input_revision,b.processed_revision,
      (SELECT count(*)::integer FROM intake.web_submission s WHERE s.intake_id=b.intake_id) AS submissions,
      (SELECT count(*)::integer FROM intake.web_command_receipt r WHERE r.result_intake_id=b.intake_id) AS receipts,
      (SELECT count(*)::integer FROM intake.service_intake_event e WHERE e.intake_id=b.intake_id AND e.event_type='intake.web_supplement_added') AS supplement_events
      FROM intake.web_request_binding b WHERE b.request_ref=$1`, [accepted.receipt.request_ref])).rows[0];
    assert.deepEqual(facts, { input_revision: '3', processed_revision: '0', submissions: 3, receipts: 3, supplement_events: 2 });
    const original = (await pool.query(`SELECT safe_content->>'description' AS description FROM intake.web_submission
      WHERE intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1) AND kind='SUBMIT'`, [accepted.receipt.request_ref])).rows[0];
    assert.equal(original.description, '原始报修内容');
    const beforeCross = await pool.query(`SELECT input_revision,processed_revision FROM intake.web_request_binding WHERE request_ref=$1`, [accepted.receipt.request_ref]);
    const cross = supplement('越权补充', 3);
    await assert.rejects(b.supplement.accept({ request: b.request(cross.client_command_id), input: cross,
      requestRef: accepted.receipt.request_ref }), { code: 'YXX_NOT_FOUND' });
    assert.deepEqual((await pool.query(`SELECT input_revision,processed_revision FROM intake.web_request_binding WHERE request_ref=$1`, [accepted.receipt.request_ref])).rows,
      beforeCross.rows);

    const concurrentRoot = submit('并发根报修');
    const concurrentAccepted = await a.command.accept({ request: a.request(concurrentRoot.client_command_id), input: concurrentRoot });
    const one = supplement('并发补充一', 1);
    const two = supplement('并发补充二', 1);
    const results = await Promise.allSettled([
      a.supplement.accept({ request: a.request(one.client_command_id), input: one, requestRef: concurrentAccepted.receipt.request_ref }),
      a.supplement.accept({ request: a.request(two.client_command_id), input: two, requestRef: concurrentAccepted.receipt.request_ref }),
    ]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter((item) => item.status === 'rejected' && item.reason?.code === 'YXX_VERSION_CONFLICT').length, 1);
    assert.deepEqual((await pool.query(`SELECT input_revision,processed_revision,
      (SELECT count(*)::integer FROM intake.web_submission s WHERE s.intake_id=b.intake_id) AS submissions
      FROM intake.web_request_binding b WHERE b.request_ref=$1`, [concurrentAccepted.receipt.request_ref])).rows[0],
      { input_revision: '2', processed_revision: '0', submissions: 2 });
  } });
  await assertNoP2016Residual({ databaseUrl });
});

test('SS-006 preserves review history across both resolution orders and keeps one Ticket', { skip: !databaseUrl, timeout: 240_000 }, async () => {
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'yxx006rce', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const memberScope = scope('review');
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const member = commandFor(store, memberScope);
    const failingOrchestrator = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: FLAGS,
      ruleEngine: { catalog_version: 'SS006', rule_set_version: 'SS006', evaluate() { throw new Error('synthetic rule outage'); } } });
    const principal = await createPilotAccessService({ pool }).upsertPrincipal({
      wecomUserId: 'yxx-ss006-reviewer', displayName: 'YXX SS006 审核', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT'],
    });
    const facade = createP2016ManualReviewFacade({ pool, enabled: true });

    const reviewFirstBody = submit('审核先于补充', randomUUID(), { text: null, unknown: true });
    const reviewFirst = await member.command.accept({ request: member.request(reviewFirstBody.client_command_id), input: reviewFirstBody });
    assert.equal((await failingOrchestrator.processOne({ requestRef: reviewFirst.receipt.request_ref })).processed, true);
    const reviewFirstRow = await pendingReview(pool, reviewFirst.receipt.request_ref);
    const confirmed = await facade.resolveManualReview({ authContext: { principal_id: principal.id }, reviewId: reviewFirstRow.id,
      body: { client_command_id: randomUUID(), expected_row_version: reviewFirstRow.row_version,
        resolution_code: 'CONFIRM_TICKET_ELIGIBLE', resolution_reason_code: 'SS006_REVIEW_FIRST' } });
    assert.equal(confirmed.ok, true);
    const reviewFirstSupplement = supplement('审核后的新增事实', 1);
    await member.supplement.accept({ request: member.request(reviewFirstSupplement.client_command_id), input: reviewFirstSupplement,
      requestRef: reviewFirst.receipt.request_ref });
    assert.equal((await failingOrchestrator.processOne({ requestRef: reviewFirst.receipt.request_ref })).processed, true);
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM pilot_ticket.ticket
      WHERE source_intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1)`, [reviewFirst.receipt.request_ref])).rows[0].n, 1);

    const supplementFirstBody = submit('补充先于审核', randomUUID(), { text: null, unknown: true });
    const supplementFirst = await member.command.accept({ request: member.request(supplementFirstBody.client_command_id), input: supplementFirstBody });
    assert.equal((await failingOrchestrator.processOne({ requestRef: supplementFirst.receipt.request_ref })).processed, true);
    const staleReview = await pendingReview(pool, supplementFirst.receipt.request_ref);
    const supplementBeforeReview = supplement('先到的新证据', 1);
    await member.supplement.accept({ request: member.request(supplementBeforeReview.client_command_id), input: supplementBeforeReview,
      requestRef: supplementFirst.receipt.request_ref });
    assert.equal((await failingOrchestrator.processOne({ requestRef: supplementFirst.receipt.request_ref })).processed, true);
    const staleResolution = await facade.resolveManualReview({ authContext: { principal_id: principal.id }, reviewId: staleReview.id,
      body: { client_command_id: randomUUID(), expected_row_version: staleReview.row_version,
        resolution_code: 'CONFIRM_TICKET_ELIGIBLE', resolution_reason_code: 'SS006_STALE_BASIS' } });
    assert.equal(staleResolution.ok, false);
    assert.equal(staleResolution.error.code, 'P2_016_VERSION_CONFLICT');
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM pilot_ticket.ticket
      WHERE source_intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1)`, [supplementFirst.receipt.request_ref])).rows[0].n, 0);
    assert.ok((await pool.query(`SELECT count(*)::integer AS n FROM intake.manual_review_item
      WHERE service_intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1) AND status='PENDING'`, [supplementFirst.receipt.request_ref])).rows[0].n >= 1);
  } });
  await assertNoP2016Residual({ databaseUrl });
});

test('SS-006 reuses Ticket supplements, rejects closed or revoked roots, and survives processing restart', { skip: !databaseUrl, timeout: 240_000 }, async () => {
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'yxx006life', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const memberScope = scope('lifecycle');
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const member = commandFor(store, memberScope);
    const process = () => createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: FLAGS });
    const root = submit('处方提交不了');
    const accepted = await member.command.accept({ request: member.request(root.client_command_id), input: root });
    const firstProcess = await process().processOne({ requestRef: accepted.receipt.request_ref });
    assert.equal(firstProcess.processed, true);
    const ticketId = firstProcess.ticket_id;
    const added = supplement('已有工单的新事实', 1);
    await member.supplement.accept({ request: member.request(added.client_command_id), input: added, requestRef: accepted.receipt.request_ref });
    assert.equal((await process().processOne({ requestRef: accepted.receipt.request_ref })).processed, true);
    assert.equal((await process().processOne({ requestRef: accepted.receipt.request_ref })).replayed, true);
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM pilot_ticket.ticket WHERE source_intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1)`, [accepted.receipt.request_ref])).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.information_added'`, [ticketId])).rows[0].n, 1);

    const actions = createTicketActionService({ pool });
    const current = async () => (await pool.query('SELECT status,version FROM pilot_ticket.ticket WHERE id=$1::uuid', [ticketId])).rows[0];
    for (const [action, reason] of [['accept', 'SS006_CLOSE_ACCEPT'], ['start', 'SS006_CLOSE_START'], ['resolve', 'SS006_CLOSE_RESOLVE'], ['confirm', 'SS006_CLOSE_CONFIRM']]) {
      const row = await current();
      const result = await actions.perform({ ticketId, action, expectedVersion: row.version,
        actor: { type: 'SYSTEM', id: null }, reasonCode: reason, traceId: `yxx:ss006:${action}` });
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    const closed = supplement('关闭后不得补充', 2);
    await assert.rejects(member.supplement.accept({ request: member.request(closed.client_command_id), input: closed,
      requestRef: accepted.receipt.request_ref }), { code: 'YXX_NOT_FOUND' });

    const cancelledRoot = submit('打印机打印不了');
    const cancelledAccepted = await member.command.accept({ request: member.request(cancelledRoot.client_command_id), input: cancelledRoot });
    const cancelledResult = await process().processOne({ requestRef: cancelledAccepted.receipt.request_ref });
    const cancelledState = (await pool.query('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid', [cancelledResult.ticket_id])).rows[0];
    assert.equal((await actions.perform({ ticketId: cancelledResult.ticket_id, action: 'cancel', expectedVersion: cancelledState.version,
      actor: { type: 'SYSTEM', id: null }, reasonCode: 'SS006_CANCEL', traceId: 'yxx:ss006:cancel' })).ok, true);
    const cancelledSupplement = supplement('取消后补充', 1);
    await assert.rejects(member.supplement.accept({ request: member.request(cancelledSupplement.client_command_id), input: cancelledSupplement,
      requestRef: cancelledAccepted.receipt.request_ref }), { code: 'YXX_NOT_FOUND' });

    const resolvedRoot = submit('打印机打印不了');
    const resolvedAccepted = await member.command.accept({ request: member.request(resolvedRoot.client_command_id), input: resolvedRoot });
    const resolvedResult = await process().processOne({ requestRef: resolvedAccepted.receipt.request_ref });
    const resolvedId = resolvedResult.ticket_id;
    for (const [action, reason] of [['accept', 'SS006_RES_ACCEPT'], ['start', 'SS006_RES_START'], ['resolve', 'SS006_RES_RESOLVE']]) {
      const row = (await pool.query('SELECT version FROM pilot_ticket.ticket WHERE id=$1::uuid', [resolvedId])).rows[0];
      assert.equal((await actions.perform({ ticketId: resolvedId, action, expectedVersion: row.version,
        actor: { type: 'SYSTEM', id: null }, reasonCode: reason, traceId: `yxx:ss006:${action}` })).ok, true);
    }
    const resolvedSupplement = supplement('已解决仍追加说明', 1);
    await member.supplement.accept({ request: member.request(resolvedSupplement.client_command_id), input: resolvedSupplement,
      requestRef: resolvedAccepted.receipt.request_ref });
    assert.equal((await process().processOne({ requestRef: resolvedAccepted.receipt.request_ref })).processed, true);
    assert.equal((await pool.query('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid', [resolvedId])).rows[0].status, 'RESOLVED');
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.information_added'", [resolvedId])).rows[0].n, 1);

    const revokedRoot = submit('撤销后不得补充');
    const revokedAccepted = await member.command.accept({ request: member.request(revokedRoot.client_command_id), input: revokedRoot });
    await pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1', [revokedAccepted.receipt.request_ref]);
    const revokedSupplement = supplement('撤销根补充', 1);
    await assert.rejects(member.supplement.accept({ request: member.request(revokedSupplement.client_command_id), input: revokedSupplement,
      requestRef: revokedAccepted.receipt.request_ref }), { code: 'YXX_NOT_FOUND' });
  } });
  await assertNoP2016Residual({ databaseUrl });
});
