import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createYxxSelfServiceStore } from '../src/yxx-self-service-store.mjs';
import { createYxxSelfServiceAuthorization } from '../src/yxx-self-service-authorization.mjs';
import { createYxxSelfServiceQuery } from '../src/yxx-self-service-query.mjs';
import { createYxxSelfServiceOrchestrator } from '../src/yxx-self-service-orchestrator.mjs';
import { createYxxMemberCommandContext } from '../src/yxx-self-service-command.mjs';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { createTicketClosureService } from '../src/p1-010-ticket-closure.mjs';
import { createP2016RealtimeProjector } from '../src/p2-016-realtime-projector.mjs';
import { createP2016ManualReviewFacade } from '../src/p2-016-manual-review-facade.mjs';
import { textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { migrateCurrentBaselineWithYxx } from '../scripts/migrate-current-baseline.mjs';
import { withP2016IsolatedDatabase, assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const FLAGS = Object.freeze({ YIXIAOXIU_SELF_SERVICE_ENABLED: true, YIXIAOXIU_MY_REPORTS_ENABLED: true });
const SECRET = 'synthetic-yxx-member-query-secret-at-least-32';

function scope(label) {
  return Object.freeze({
    scopeHash: createHash('sha256').update(`yxx-member-${label}`).digest('hex'),
    sourceCorpScope: 'synthetic-corp',
    sourceAppScope: 'synthetic-app',
    proofRef: 'tests/yxx-ss-005',
  });
}

function authContext(memberScope, profile = 'MEMBER_SELF_SERVICE', flags = FLAGS) {
  return {
    profile,
    flags,
    write_flag: profile === 'MEMBER_SELF_SERVICE' || profile === 'FULL_SERVICE_LOOP',
    csrf_token: 'synthetic-csrf',
    session_generation: 'generation-1',
    canonical_reporter_binding: memberScope.scopeHash,
    source_corp_scope: memberScope.sourceCorpScope,
    source_app_scope: memberScope.sourceAppScope,
    proof_ref: memberScope.proofRef,
    bot_owner: { botId: 'bot-test', userId: `member-${memberScope.scopeHash.slice(0, 8)}` },
  };
}

function requestInput(description, clientCommandId = randomUUID(), location = { text: '本部住院楼8层护士站', unknown: false }) {
  return { schema_version: 1, client_command_id: clientCommandId, description,
    location, service_code: null,
    impact_scope: 'SINGLE_WORKSTATION', reported_department_text: null, extension: null };
}

function localAuthorization(contexts, selectedProfile = 'MEMBER_SELF_SERVICE', selectedFlags = FLAGS) {
  const current = { value: 'A' };
  const get = (request) => contexts[request] ?? contexts[current.value];
  const recheck = Object.assign(async (request) => get(request), { localOnly: true });
  const authorization = createYxxSelfServiceAuthorization({
    profile: selectedProfile,
    flags: selectedFlags,
    authenticate: async (request) => get(request),
    recheck,
  });
  return { authorization, current };
}

async function createBotTicket(pool, userId, tag) {
  const seed = await seedPersistedIntake({ pool, text: `Bot 独立报修 ${tag}`, requestType: 'INCIDENT', status: 'RECEIVED', tag });
  await pool.query('UPDATE intake.service_intake SET reporter_wecom_userid=$2,source_bot_id=$3 WHERE id=$1::uuid', [seed.intakeId, userId, 'bot-test']);
  const ticket = (await createPilotTicketCore({ pool }).createForIntake({
    intakeId: seed.intakeId, occurredAt: seed.receivedAt, traceId: `yxx-ss-005-${tag}`,
  })).ticket;
  const publicRef = randomBytes(24).toString('base64url');
  const binding = textHashP2016(JSON.stringify(['WECOM_AIBOT', 'bot-test', userId]));
  await pool.query(`INSERT INTO pilot_ticket.reporter_public_ref(ticket_id,public_ref,reporter_binding_hash)
    VALUES($1::uuid,$2,$3)`, [ticket.id, publicRef, binding]);
  return { ...ticket, public_ref: publicRef, intake_id: seed.intakeId };
}

async function mapInBatches(values, batchSize, operation) {
  const output = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    output.push(...await Promise.all(values.slice(offset, offset + batchSize).map(operation)));
  }
  return output;
}

test('SS-005 authorization denies OAUTH_ONLY before touching the database and fences identity changes', async () => {
  let queries = 0;
  const fakePool = { connect: async () => { queries += 1; throw new Error('database must not be opened'); } };
  const a = scope('a');
  const oauthRecheck = Object.assign(async () => ({ profile: 'OAUTH_ONLY' }), { localOnly: true });
  const oauth = createYxxSelfServiceAuthorization({ authenticate: async () => ({ profile: 'OAUTH_ONLY' }), recheck: oauthRecheck });
  const query = createYxxSelfServiceQuery({ pool: fakePool, authorization: oauth });
  await assert.rejects(query.list({ request: 'oauth' }), { code: 'YXX_MEMBER_REQUIRED' });
  assert.equal(queries, 0);

  const contexts = { A: authContext(a) };
  let phase = 'A';
  const recheck = Object.assign(async () => contexts[phase], { localOnly: true });
  const authorization = createYxxSelfServiceAuthorization({ profile: 'MEMBER_SELF_SERVICE', flags: FLAGS,
    authenticate: async () => contexts.A, recheck });
  await assert.rejects(authorization.read({ request: 'member', run: async () => { phase = 'A'; contexts.A = { ...contexts.A, session_generation: 'generation-2' }; return { leaked: true }; } }), { code: 'YXX_MEMBER_AUTH_RECHECK_FAILED' });

  let writes = 0;
  const stale = createYxxMemberCommandContext({
    profile: 'OAUTH_ONLY', flags: {},
    authenticate: async () => ({ profile: 'MEMBER_SELF_SERVICE', flags: FLAGS, write_flag: true,
      csrf_token: 'csrf', canonical_reporter_binding: a.scopeHash, source_corp_scope: a.sourceCorpScope,
      source_app_scope: a.sourceAppScope, proof_ref: a.proofRef }),
    recheck: Object.assign(async () => ({}), { localOnly: true }),
    quota: Object.assign(async () => true, { localOnly: true }),
    store: { accept: async () => { writes += 1; } },
  });
  const body = requestInput('越过部署门禁');
  await assert.rejects(stale.accept({ request: { headers: { 'x-csrf-token': 'csrf', 'idempotency-key': body.client_command_id } }, input: body }), { code: 'YXX_MEMBER_WRITE_DISABLED' });
  assert.equal(writes, 0);
});

test('SS-005 accepts catalog service codes with the existing receipt and idempotency contract', { skip: !databaseUrl, timeout: 120_000 }, async () => {
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'yxxcatalog', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const memberScope = scope('catalog');
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const input = { ...requestInput('门诊医生工作站打不开'), service_code: 'CLINICAL.OUTPATIENT_WORKSTATION' };
    const accepted = await store.accept({ scope: memberScope, input });
    assert.equal(accepted.receipt.status, 'ACCEPTED');
    const replay = await store.accept({ scope: memberScope, input });
    assert.deepEqual(replay.receipt, accepted.receipt);
    await assert.rejects(store.accept({ scope: memberScope, input: { ...input, service_code: 'CLINICAL.INPATIENT_WORKSTATION' } }), { code: 'YXX_COMMAND_CONFLICT' });
    for(const code of ['CLINICAL..SERVICE','CLINICAL.','CLINICAL.1INVALID','A'.repeat(65)]) {
      await assert.rejects(store.accept({ scope: memberScope, input: { ...input, client_command_id: randomUUID(), service_code: code } }));
    }
    assert.equal((await store.accept({ scope: memberScope, input: { ...input, client_command_id: randomUUID(), service_code: null } })).receipt.status, 'ACCEPTED');
    assert.equal((await store.accept({ scope: memberScope, input: { ...input, client_command_id: randomUUID(), service_code: 'PRINTING' } })).receipt.status, 'ACCEPTED');
  } });
  await assertNoP2016Residual({ databaseUrl });
});

test('SS-005 member list previews only retained initial Web descriptions and locations', { skip: !databaseUrl, timeout: 120_000 }, async () => {
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'yxxpreview', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const a = scope('preview-a'), b = scope('preview-b');
    const contexts = { A: authContext(a), B: authContext(b) };
    const { authorization } = localAuthorization(contexts);
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const query = createYxxSelfServiceQuery({ pool, authorization, store, scopeSecret: SECRET });
    const original = await store.accept({ scope: a, input: requestInput('腕带无法打印') });
    await store.accept({ scope: a, kind: 'SUPPLEMENT', requestRef: original.receipt.request_ref,
      input: { schema_version: 1, client_command_id: randomUUID(), expected_input_revision: '1', text: '补充正文不得进入预览' } });
    const long = await store.accept({ scope: a, input: requestInput('😀'.repeat(130), randomUUID(), { text: '位'.repeat(100), unknown: false }) });
    const unknown = await store.accept({ scope: a, input: requestInput('未提供位置', randomUUID(), { text: null, unknown: true }) });
    await store.accept({ scope: b, input: requestInput('B 私有描述') });
    const bot = await createBotTicket(pool, contexts.A.bot_owner.userId, 'preview');
    const page = await query.list({ request: 'A' });
    const item = ref => page.items.find(value => value.ref === ref);
    assert.equal(item(original.receipt.request_ref).safe_summary, '腕带无法打印');
    assert.equal(item(original.receipt.request_ref).safe_location, '本部住院楼8层护士站');
    assert.equal(item(long.receipt.request_ref).safe_summary, '😀'.repeat(120));
    assert.equal(item(long.receipt.request_ref).safe_location, '位'.repeat(80));
    assert.equal(item(unknown.receipt.request_ref).safe_location, null);
    assert.equal(item(bot.public_ref).safe_summary, null);
    assert.equal(item(bot.public_ref).safe_location, null);
    assert.equal(JSON.stringify(page).includes('补充正文'), false);
    assert.equal(JSON.stringify(page).includes('B 私有描述'), false);
    assert.equal(JSON.stringify(await query.list({ request: 'B' })).includes('腕带无法打印'), false);
    await pool.query(`UPDATE intake.web_submission s
      SET retention_until=platform.local_from_epoch_ms(s.received_epoch_ms+1), retention_until_epoch_ms=s.received_epoch_ms+1
      FROM intake.web_request_binding b WHERE b.intake_id=s.intake_id AND b.request_ref=$1 AND s.kind='SUBMIT'`, [original.receipt.request_ref]);
    const expired = (await query.list({ request: 'A', source: 'WEB' })).items.find(value => value.ref === original.receipt.request_ref);
    assert.equal(expired.safe_summary, null);
    assert.equal(expired.safe_location, null);
    await pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1', [long.receipt.request_ref]);
    assert.equal((await query.list({ request: 'A' })).items.some(value => value.ref === long.receipt.request_ref), false);
  } });
  await assertNoP2016Residual({ databaseUrl });
});

test('SS-005 lists owned Web roots and legacy Bot Tickets with bound cursors and safe detail', { skip: !databaseUrl, timeout: 180_000 }, async () => {
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'yxx005', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const scopeA = scope('a');
    const scopeB = scope('b');
    const contexts = { A: authContext(scopeA), B: authContext(scopeB) };
    const { authorization, current } = localAuthorization(contexts);
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const query = createYxxSelfServiceQuery({ pool, authorization, store, scopeSecret: SECRET });
    const firstA = await store.accept({ scope: scopeA, input: requestInput('A 未建单') });
    const secondA = await store.accept({ scope: scopeA, input: requestInput('处方提交不了') });
    const reviewA = await store.accept({ scope: scopeA, input: requestInput('无法安全判断', randomUUID(), { text: null, unknown: true }) });
    const firstB = await store.accept({ scope: scopeB, input: requestInput('B 私有报修') });
    const realtime = createP2016RealtimeProjector({ pool, enabled: true });
    const orchestrator = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: FLAGS, realtimeProjector: realtime });
    const processed = await orchestrator.processOne({ requestRef: secondA.receipt.request_ref });
    assert.equal(processed.processed, true);
    const processedTicketNo = (await pool.query('SELECT ticket_no FROM pilot_ticket.ticket WHERE id=$1::uuid', [processed.ticket_id])).rows[0].ticket_no;
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM conversation.realtime_event
      WHERE publisher_name='P2_016_WORKBENCH' AND source_type='TICKET_EVENT' AND event_type='ticket.status.changed'
        AND aggregate_id=$1`, [processed.ticket_id])).rows[0].n, 1);
    const fallbackOrchestrator = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: FLAGS,
      realtimeProjector: realtime,
      ruleEngine: { catalog_version: 'SS005', rule_set_version: 'SS005', evaluate() { throw new Error('synthetic rule failure'); } } });
    const reviewed = await fallbackOrchestrator.processOne({ requestRef: reviewA.receipt.request_ref });
    assert.equal(reviewed.processed, true);
    const autoAcknowledgement = await store.accept({ scope: scopeA, input: requestInput('谢谢') });
    assert.equal((await orchestrator.processOne({ requestRef: autoAcknowledgement.receipt.request_ref })).result_code, 'ACKNOWLEDGEMENT');
    assert.equal((await pool.query(`SELECT j.status FROM intake.contact_journey j
      JOIN intake.web_request_binding b ON b.intake_id=j.origin_intake_id WHERE b.request_ref=$1`, [autoAcknowledgement.receipt.request_ref])).rows[0].status, 'ENDED');
    const autoOutOfScope = await store.accept({ scope: scopeA, input: requestInput('天气怎么样') });
    assert.equal((await orchestrator.processOne({ requestRef: autoOutOfScope.receipt.request_ref })).result_code, 'OUT_OF_SCOPE');
    assert.equal((await pool.query(`SELECT j.status FROM intake.contact_journey j
      JOIN intake.web_request_binding b ON b.intake_id=j.origin_intake_id WHERE b.request_ref=$1`, [autoOutOfScope.receipt.request_ref])).rows[0].status, 'ENDED');
    await store.accept({ scope: scopeA, kind: 'SUPPLEMENT', requestRef: autoOutOfScope.receipt.request_ref,
      input: { schema_version: 1, client_command_id: randomUUID(), expected_input_revision: '1', text: '处方提交不了' } });
    const reopened = await orchestrator.processOne({ requestRef: autoOutOfScope.receipt.request_ref });
    assert.equal(reopened.processed, true);
    assert.equal((await pool.query(`SELECT j.status,j.ended_at FROM intake.contact_journey j
      JOIN intake.web_request_binding b ON b.intake_id=j.origin_intake_id WHERE b.request_ref=$1`, [autoOutOfScope.receipt.request_ref])).rows[0].status, 'TICKET_LINKED');
    assert.equal((await pool.query(`SELECT j.ended_at FROM intake.contact_journey j
      JOIN intake.web_request_binding b ON b.intake_id=j.origin_intake_id WHERE b.request_ref=$1`, [autoOutOfScope.receipt.request_ref])).rows[0].ended_at, null);
    const clarification = await store.accept({ scope: scopeA, input: requestInput('系统不行', randomUUID(), { text: null, unknown: true }) });
    assert.equal((await orchestrator.processOne({ requestRef: clarification.receipt.request_ref })).result_code, 'NEEDS_DESCRIPTION');
    assert.equal((await pool.query(`SELECT j.status FROM intake.contact_journey j
      JOIN intake.web_request_binding b ON b.intake_id=j.origin_intake_id WHERE b.request_ref=$1`, [clarification.receipt.request_ref])).rows[0].status, 'WAITING_DESCRIPTION');
    const botA = await createBotTicket(pool, contexts.A.bot_owner.userId, 'a');
    const botB = await createBotTicket(pool, contexts.B.bot_owner.userId, 'b');
    const baselineCounts = (await pool.query('SELECT (SELECT count(*)::integer FROM pilot_ticket.reporter_access_grant) AS grants,(SELECT count(*)::integer FROM communication.delivery) AS deliveries')).rows[0];
    const closure = createTicketClosureService({ pool, resolveReporterActor: async () => null,
      outbox: { enqueueTicketEvent: async () => { throw new Error('Web actions must not enqueue notifications'); } } });
    const webActions = createTicketActionService({ pool, afterAction: closure.afterTicketAction });
    await webActions.perform({ ticketId: processed.ticket_id, action: 'accept', expectedVersion: 1,
      actor: { type: 'SYSTEM', id: null }, reasonCode: 'SS005_ACCEPT', traceId: 'yxx:ss005:accept' });
    await webActions.perform({ ticketId: processed.ticket_id, action: 'start', expectedVersion: 2,
      actor: { type: 'SYSTEM', id: null }, reasonCode: 'SS005_START', traceId: 'yxx:ss005:start' });
    await webActions.perform({ ticketId: processed.ticket_id, action: 'request-information', expectedVersion: 3,
      actor: { type: 'SYSTEM', id: null }, reasonCode: 'SS005_WAIT', traceId: 'yxx:ss005:wait' });
    await store.accept({ scope: scopeA, kind: 'SUPPLEMENT', requestRef: secondA.receipt.request_ref,
      input: { schema_version: 1, client_command_id: randomUUID(), expected_input_revision: '1', text: '等待中的网页补充' } });
    assert.equal((await orchestrator.processOne({ requestRef: secondA.receipt.request_ref })).processed, true);
    assert.equal((await pool.query('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid', [processed.ticket_id])).rows[0].status, 'IN_PROGRESS');
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.resumed'", [processed.ticket_id])).rows[0].n, 1);
    await store.accept({ scope: scopeA, kind: 'SUPPLEMENT', requestRef: secondA.receipt.request_ref,
      input: { schema_version: 1, client_command_id: randomUUID(), expected_input_revision: '2', text: '进行中的网页补充' } });
    assert.equal((await orchestrator.processOne({ requestRef: secondA.receipt.request_ref })).processed, true);
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM pilot_ticket.ticket_event WHERE ticket_id=$1::uuid AND event_type='ticket.information_added'", [processed.ticket_id])).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM conversation.realtime_event
      WHERE publisher_name='P2_016_WORKBENCH' AND source_type='TICKET_EVENT' AND event_type='ticket.updated'
        AND aggregate_id=$1`, [processed.ticket_id])).rows[0].n, 1);
    assert.deepEqual((await pool.query('SELECT (SELECT count(*)::integer FROM pilot_ticket.reporter_access_grant) AS grants,(SELECT count(*)::integer FROM communication.delivery) AS deliveries')).rows[0], baselineCounts);

    current.value = 'A';
    const page = await query.list({ request: 'A', limit: 2 });
    assert.equal(page.items.length, 2);
    assert.equal(new Set(page.items.map((item) => item.ref)).size, page.items.length);
    assert.equal(page.items.some((item) => item.ref === firstB.receipt.request_ref), false);
    const reviewItem = (await query.list({ request: 'A', source: 'WEB' })).items.find((item) => item.ref === reviewA.receipt.request_ref);
    assert.equal(reviewItem.display_status, 'UNDER_REVIEW');
    const principal = await createPilotAccessService({ pool }).upsertPrincipal({
      wecomUserId: 'yxx-ss005-reviewer', displayName: 'YXX SS005 审核', roles: ['ADMIN'], resolverTeamIds: ['PILOT_IT'],
    });
    const reviewRow = (await pool.query(`SELECT r.id::text,r.row_version::text FROM intake.manual_review_item r
      JOIN intake.web_request_binding b ON b.intake_id=r.service_intake_id
      WHERE b.request_ref=$1 AND r.status='PENDING'`, [reviewA.receipt.request_ref])).rows[0];
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM conversation.realtime_event
      WHERE publisher_name='P2_016_WORKBENCH' AND source_type='MANUAL_REVIEW'
        AND event_type='manual_review.created' AND aggregate_id=$1`, [reviewRow.id])).rows[0].n, 1);
    const facade = createP2016ManualReviewFacade({ pool, enabled: true, realtimeProjector: realtime });
    const reviewResolution = await facade.resolveManualReview({ authContext: { principal_id: principal.id }, reviewId: reviewRow.id,
      body: { client_command_id: randomUUID(), expected_row_version: reviewRow.row_version,
        resolution_code: 'REQUEST_DESCRIPTION', resolution_reason_code: 'SS005_NEEDS_DESCRIPTION' },
    });
    assert.equal(reviewResolution.ok, true);
    assert.equal((await pool.query(`SELECT j.status FROM intake.contact_journey j
      JOIN intake.manual_review_item r ON r.journey_id=j.id WHERE r.id=$1::uuid`, [reviewRow.id])).rows[0].status, 'WAITING_DESCRIPTION');
    const terminalReview = await store.accept({ scope: scopeA, input: requestInput('网页范围外', randomUUID(), { text: null, unknown: true }) });
    await fallbackOrchestrator.processOne({ requestRef: terminalReview.receipt.request_ref });
    const terminalRow = (await pool.query(`SELECT r.id::text,r.row_version::text FROM intake.manual_review_item r
      JOIN intake.web_request_binding b ON b.intake_id=r.service_intake_id
      WHERE b.request_ref=$1 AND r.status='PENDING'`, [terminalReview.receipt.request_ref])).rows[0];
    const terminalResolution = await facade.resolveManualReview({ authContext: { principal_id: principal.id }, reviewId: terminalRow.id,
      body: { client_command_id: randomUUID(), expected_row_version: terminalRow.row_version,
        resolution_code: 'MARK_OUT_OF_SCOPE', resolution_reason_code: 'SS005_OUT_OF_SCOPE' },
    });
    assert.equal(terminalResolution.ok, true);
    assert.equal((await pool.query(`SELECT j.status FROM intake.contact_journey j
      JOIN intake.manual_review_item r ON r.journey_id=j.id WHERE r.id=$1::uuid`, [terminalRow.id])).rows[0].status, 'ENDED');
    assert.ok(page.next_cursor);
    const allA = [...page.items];
    for (let next = page.next_cursor; next;) {
      const rest = await query.list({ request: 'A', limit: 2, cursor: next });
      allA.push(...rest.items);
      next = rest.next_cursor;
    }
    assert.equal(new Set(allA.map((item) => item.ref)).size, allA.length);
    assert.equal(allA.some((item) => item.ref === firstA.receipt.request_ref), true);
    assert.equal(allA.some((item) => item.ref === secondA.receipt.request_ref), true);
    assert.equal(allA.some((item) => item.ref === botA.public_ref), true);
    assert.equal(allA.some((item) => item.ref === botB.public_ref), false);
    const botOnly = await query.list({ request: 'A', source: 'BOT' });
    assert.deepEqual(botOnly.items.map((item) => item.ref), [botA.public_ref]);
    await assert.rejects(query.list({ request: 'B', cursor: page.next_cursor }), { code: 'YXX_CURSOR_INVALID' });
    const sameMemberOtherApp = { ...scopeA, sourceAppScope: 'another-app' };
    const otherAppAuth = localAuthorization({ C: authContext(sameMemberOtherApp) });
    const otherAppQuery = createYxxSelfServiceQuery({ pool, authorization: otherAppAuth.authorization, scopeSecret: SECRET });
    await assert.rejects(otherAppQuery.list({ request: 'C', cursor: page.next_cursor }), { code: 'YXX_CURSOR_INVALID' });

    const webDetail = await query.getWebRequest({ request: 'A', requestRef: secondA.receipt.request_ref });
    assert.equal(webDetail.source_kind, 'WEB_REQUEST');
    assert.equal(webDetail.ticket.ticket_no, processedTicketNo);
    assert.equal(JSON.stringify(webDetail).includes(scopeA.scopeHash), false);
    assert.equal(JSON.stringify(webDetail).includes(contexts.A.bot_owner.userId), false);
    const botDetail = await query.getBotTicket({ request: 'A', publicRef: botA.public_ref });
    assert.equal(botDetail.kind, 'BOT_TICKET');
    assert.equal(botDetail.ticket.ticket_no, botA.ticket_no);
    await assert.rejects(query.getWebRequest({ request: 'B', requestRef: secondA.receipt.request_ref }), { code: 'YXX_NOT_FOUND' });
    await assert.rejects(query.getBotTicket({ request: 'B', publicRef: botA.public_ref }), { code: 'YXX_NOT_FOUND' });

    const firstRepresentation = await query.detailWithEtag({ request: 'A', requestRef: firstA.receipt.request_ref });
    const unchanged = await query.detailWithEtag({ request: 'A', requestRef: firstA.receipt.request_ref, ifNoneMatch: firstRepresentation.etag });
    assert.equal(unchanged.status, 304);
    await store.accept({ scope: scopeA, kind: 'SUPPLEMENT', requestRef: firstA.receipt.request_ref,
      input: { schema_version: 1, client_command_id: randomUUID(), expected_input_revision: '1', text: '补充说明改变ETag' } });
    const changed = await query.detailWithEtag({ request: 'A', requestRef: firstA.receipt.request_ref, ifNoneMatch: firstRepresentation.etag });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.etag, firstRepresentation.etag);
    assert.equal(changed.body.needs_action, null);
    await assert.rejects(store.accept({ scope: { ...scopeA, sourceAppScope: 'another-app' }, kind: 'SUPPLEMENT',
      requestRef: firstA.receipt.request_ref, input: { schema_version: 1, client_command_id: randomUUID(), expected_input_revision: '2', text: '跨应用不得写入' } }), { code: 'YXX_NOT_FOUND' });

    const timelineAnchor = await store.timeline({ scope: scopeA, requestRef: firstA.receipt.request_ref, limit: 1 });
    assert.ok(timelineAnchor.next_cursor.length <= 2048);
    const firstIntake = (await pool.query('SELECT b.intake_id::text AS intake_id,i.version,COALESCE(max(e.event_ordinal),0)::integer+1 AS next_ordinal FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id LEFT JOIN intake.service_intake_event e ON e.intake_id=i.id WHERE b.request_ref=$1 GROUP BY b.intake_id,i.version', [firstA.receipt.request_ref])).rows[0];
    await pool.query(`INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
      VALUES('intake.rule_decision_applied','intake',$1::uuid,$2,$3,'2020-01-02 00:00:00',$4,'{}'::jsonb),
            ('intake.rule_decision_applied','intake',$1::uuid,$2,$3+1,'2020-01-01 00:00:00',$5,'{}'::jsonb)`, [firstIntake.intake_id, firstIntake.version, firstIntake.next_ordinal, 'yxx:ss005:late-a', 'yxx:ss005:late-b']);
    const latePage = await store.timeline({ scope: scopeA, requestRef: firstA.receipt.request_ref, cursor: timelineAnchor.next_cursor, limit: 1 });
    assert.ok(latePage.next_cursor.length <= 2048);
    assert.equal(latePage.items[0].occurred_at, '2020-01-01 00:00:00');
    const secondLate = await store.timeline({ scope: scopeA, requestRef: firstA.receipt.request_ref, cursor: latePage.next_cursor, limit: 1 });
    assert.equal(secondLate.items[0].occurred_at, '2020-01-02 00:00:00');

    await pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1', [firstA.receipt.request_ref]);
    const afterRevoke = await query.list({ request: 'A', source: 'WEB' });
    assert.equal(afterRevoke.items.some((item) => item.ref === firstA.receipt.request_ref), false);
    await assert.rejects(query.getWebRequest({ request: 'A', requestRef: firstA.receipt.request_ref }), { code: 'YXX_NOT_FOUND' });
    await pool.query("UPDATE pilot_ticket.reporter_public_ref SET status='REVOKED',revoked_at=platform.local_now() WHERE public_ref=$1", [botA.public_ref]);
    assert.equal((await query.list({ request: 'A', source: 'BOT' })).items.some((item) => item.ref === botA.public_ref), false);
    const afterCounts = (await pool.query('SELECT (SELECT count(*)::integer FROM pilot_ticket.reporter_access_grant) AS grants,(SELECT count(*)::integer FROM communication.delivery) AS deliveries')).rows[0];
    assert.deepEqual(afterCounts, baselineCounts);

    const readonlyContexts = { A: authContext(scopeA, 'MEMBER_TICKET_READONLY', { YIXIAOXIU_SELF_SERVICE_ENABLED: false, YIXIAOXIU_MY_REPORTS_ENABLED: false }) };
    const readonlyAuth = localAuthorization(readonlyContexts, 'MEMBER_TICKET_READONLY', { YIXIAOXIU_SELF_SERVICE_ENABLED: false, YIXIAOXIU_MY_REPORTS_ENABLED: false });
    const readonly = createYxxSelfServiceQuery({ pool, authorization: readonlyAuth.authorization, scopeSecret: SECRET });
    assert.equal((await readonly.list({ request: 'A', source: 'BOT' })).items.length, 0);
    await assert.rejects(readonly.getWebRequest({ request: 'A', requestRef: secondA.receipt.request_ref }), { code: 'YXX_MEMBER_READ_DISABLED' });
  } });
  await assertNoP2016Residual({ databaseUrl });
});

test('SS-005 traverses a 500-row mixed snapshot without loss or duplication', { skip: !databaseUrl, timeout: 240_000 }, async () => {
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'yxx005mix', max: 4, run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const memberScope = scope('mixed');
    const contexts = { A: authContext(memberScope) };
    const { authorization } = localAuthorization(contexts);
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET });
    const query = createYxxSelfServiceQuery({ pool, authorization, scopeSecret: SECRET });
    const web = await mapInBatches(Array.from({ length: 250 }, (_, index) => index), 16,
      (index) => store.accept({ scope: memberScope, input: requestInput(`批量网页报修 ${index}`) }));
    const bot = await mapInBatches(Array.from({ length: 250 }, (_, index) => index), 8,
      (index) => createBotTicket(pool, contexts.A.bot_owner.userId, `mix-${index}`));
    const eligible = (await pool.query(`SELECT kind,count(*)::integer AS count FROM (
      SELECT 'WEB_REQUEST'::text AS kind
        FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
       WHERE b.canonical_reporter_binding=$1 AND b.source_corp_scope=$2 AND b.source_app_scope=$3
         AND b.revoked_at IS NULL AND b.retention_until_epoch_ms>platform.physical_epoch_ms()
         AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
      UNION ALL
      SELECT 'BOT_TICKET'::text AS kind
        FROM pilot_ticket.reporter_public_ref r
        JOIN pilot_ticket.ticket t ON t.id=r.ticket_id
        JOIN intake.service_intake i ON i.id=t.source_intake_id
       WHERE r.status='ACTIVE' AND r.reporter_binding_hash=$4
         AND i.source_provider='WECOM_AIBOT' AND i.source_bot_id=$5 AND i.reporter_wecom_userid=$6
         AND i.retention_until_epoch_ms>platform.physical_epoch_ms()
         AND (r.journey_id IS NULL OR EXISTS (SELECT 1 FROM intake.contact_journey j
              WHERE j.id=r.journey_id AND j.retention_until_epoch_ms>platform.physical_epoch_ms()))
    ) expected GROUP BY kind ORDER BY kind`, [memberScope.scopeHash, memberScope.sourceCorpScope,
      memberScope.sourceAppScope, textHashP2016(JSON.stringify(['WECOM_AIBOT', contexts.A.bot_owner.botId,
        contexts.A.bot_owner.userId])), contexts.A.bot_owner.botId, contexts.A.bot_owner.userId])).rows;
    assert.deepEqual(eligible, [{ kind: 'BOT_TICKET', count: 250 }, { kind: 'WEB_REQUEST', count: 250 }]);
    const refs = new Set();
    const pageShape = [];
    let page = await query.list({ request: 'A', limit: 50 });
    while (true) {
      pageShape.push({ count: page.items.length,
        web: page.items.filter((item) => item.kind === 'WEB_REQUEST').length,
        bot: page.items.filter((item) => item.kind === 'BOT_TICKET').length });
      for (const item of page.items) {
        assert.equal(refs.has(item.ref), false, `duplicate ref ${item.ref}`);
        refs.add(item.ref);
      }
      if (!page.next_cursor) break;
      page = await query.list({ request: 'A', limit: 50, cursor: page.next_cursor });
    }
    assert.equal(web.length, 250);
    assert.equal(bot.length, 250);
    const missing = {
      web: web.map((item) => item.receipt.request_ref).filter((ref) => !refs.has(ref)),
      bot: bot.map((item) => item.public_ref).filter((ref) => !refs.has(ref)),
    };
    assert.equal(refs.size, 500, JSON.stringify({ eligible, pageShape, missing }));
    assert.equal([...refs].filter((ref) => web.some((item) => item.receipt.request_ref === ref)).length, 250);
    assert.equal([...refs].filter((ref) => bot.some((item) => item.public_ref === ref)).length, 250);

    const sharedSecond = '2026-09-03 12:00:00';
    await pool.query(`UPDATE intake.web_request_binding
      SET created_at=$4::timestamp without time zone
      WHERE canonical_reporter_binding=$1 AND source_corp_scope=$2 AND source_app_scope=$3`,
    [memberScope.scopeHash, memberScope.sourceCorpScope, memberScope.sourceAppScope, sharedSecond]);
    await pool.query(`UPDATE pilot_ticket.ticket t SET created_at=$3::timestamp without time zone
      FROM intake.service_intake i
      WHERE i.id=t.source_intake_id AND i.source_provider='WECOM_AIBOT'
        AND i.source_bot_id=$1 AND i.reporter_wecom_userid=$2`,
    [contexts.A.bot_owner.botId, contexts.A.bot_owner.userId, sharedSecond]);
    const tiedRefs = new Set();
    const tiedPageShape = [];
    let tiedPage = await query.list({ request: 'A', limit: 50 });
    while (true) {
      tiedPageShape.push({ count: tiedPage.items.length,
        web: tiedPage.items.filter((item) => item.kind === 'WEB_REQUEST').length,
        bot: tiedPage.items.filter((item) => item.kind === 'BOT_TICKET').length });
      for (const item of tiedPage.items) {
        assert.equal(tiedRefs.has(item.ref), false, `duplicate tied ref ${item.ref}`);
        tiedRefs.add(item.ref);
      }
      if (!tiedPage.next_cursor) break;
      tiedPage = await query.list({ request: 'A', limit: 50, cursor: tiedPage.next_cursor });
    }
    assert.equal(tiedRefs.size, 500, JSON.stringify({ eligible, tiedPageShape }));
    assert.deepEqual(tiedPageShape, [
      ...Array.from({ length: 5 }, () => ({ count: 50, web: 50, bot: 0 })),
      ...Array.from({ length: 5 }, () => ({ count: 50, web: 0, bot: 50 })),
    ]);
  } });
  await assertNoP2016Residual({ databaseUrl });
});

test('SS-005 extends aggregate retention for a late accepted supplement', { skip: !databaseUrl, timeout: 120_000 }, async () => {
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'yxx005ret', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaselineWithYxx({ databaseUrl: isolated });
    const memberScope = scope('retention');
    const store = createYxxSelfServiceStore({ pool, scopeSecret: SECRET, retentionMs: 60_000 });
    const root = await store.accept({ scope: memberScope, input: requestInput('处方提交不了') });
    await pool.query(`WITH target AS (SELECT platform.physical_epoch_ms()+5000 AS epoch)
      UPDATE intake.web_request_binding b SET retention_until_epoch_ms=target.epoch,
        retention_until=platform.local_from_epoch_ms(target.epoch) FROM target WHERE b.request_ref=$1`, [root.receipt.request_ref]);
    await pool.query(`WITH target AS (SELECT platform.physical_epoch_ms()+5000 AS epoch)
      UPDATE intake.service_intake i SET retention_until_epoch_ms=target.epoch,
        retention_until=platform.local_from_epoch_ms(target.epoch) FROM target, intake.web_request_binding b
      WHERE b.intake_id=i.id AND b.request_ref=$1`, [root.receipt.request_ref]);
    await pool.query(`WITH target AS (SELECT platform.physical_epoch_ms()+5000 AS epoch)
      UPDATE intake.contact_journey j SET retention_until_epoch_ms=target.epoch,
        retention_until=platform.local_from_epoch_ms(target.epoch) FROM target, intake.web_request_binding b
      WHERE b.intake_id=j.origin_intake_id AND b.request_ref=$1`, [root.receipt.request_ref]);
    const before = (await pool.query(`SELECT b.retention_until_epoch_ms::text AS binding_retention,
      i.retention_until_epoch_ms::text AS intake_retention,j.retention_until_epoch_ms::text AS journey_retention
      FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
      JOIN intake.contact_journey j ON j.origin_intake_id=i.id WHERE b.request_ref=$1`, [root.receipt.request_ref])).rows[0];
    const supplement = await store.accept({ scope: memberScope, kind: 'SUPPLEMENT', requestRef: root.receipt.request_ref,
      input: { schema_version: 1, client_command_id: randomUUID(), expected_input_revision: '1', text: '临近保留期补充' } });
    assert.equal(supplement.receipt.status, 'ACCEPTED');
    const after = (await pool.query(`SELECT b.retention_until_epoch_ms::text AS binding_retention,
      i.retention_until_epoch_ms::text AS intake_retention,j.retention_until_epoch_ms::text AS journey_retention
      FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id
      JOIN intake.contact_journey j ON j.origin_intake_id=i.id WHERE b.request_ref=$1`, [root.receipt.request_ref])).rows[0];
    assert.ok(BigInt(after.binding_retention) > BigInt(before.binding_retention));
    assert.equal(after.binding_retention, after.intake_retention);
    assert.equal(after.binding_retention, after.journey_retention);
    assert.equal((await pool.query(`SELECT count(DISTINCT retention_until_epoch_ms)::integer AS n,
      min(retention_until_epoch_ms)::text AS submission_retention FROM intake.web_submission
      WHERE intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1)`, [root.receipt.request_ref])).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT min(retention_until_epoch_ms)::text AS submission_retention FROM intake.web_submission
      WHERE intake_id=(SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1)`, [root.receipt.request_ref])).rows[0].submission_retention, after.binding_retention);
    assert.equal((await createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: FLAGS })
      .processOne({ requestRef: root.receipt.request_ref })).processed, true);
  } });
  await assertNoP2016Residual({ databaseUrl });
});
