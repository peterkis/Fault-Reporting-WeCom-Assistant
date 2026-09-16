import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createYxxSelfServiceStore } from '../src/yxx-self-service-store.mjs';
import { createYxxSelfServiceAuthorization } from '../src/yxx-self-service-authorization.mjs';
import { createYxxSelfServiceQuery } from '../src/yxx-self-service-query.mjs';
import { createYxxSelfServiceOrchestrator } from '../src/yxx-self-service-orchestrator.mjs';
import { createYxxMemberCommandContext } from '../src/yxx-self-service-command.mjs';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { createTicketClosureService } from '../src/p1-010-ticket-closure.mjs';
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
    const orchestrator = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: FLAGS });
    const processed = await orchestrator.processOne({ requestRef: secondA.receipt.request_ref });
    assert.equal(processed.processed, true);
    const processedTicketNo = (await pool.query('SELECT ticket_no FROM pilot_ticket.ticket WHERE id=$1::uuid', [processed.ticket_id])).rows[0].ticket_no;
    const fallbackOrchestrator = createYxxSelfServiceOrchestrator({ pool, profile: 'MEMBER_SELF_SERVICE', featureFlags: FLAGS,
      ruleEngine: { catalog_version: 'SS005', rule_set_version: 'SS005', evaluate() { throw new Error('synthetic rule failure'); } } });
    const reviewed = await fallbackOrchestrator.processOne({ requestRef: reviewA.receipt.request_ref });
    assert.equal(reviewed.processed, true);
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
    assert.deepEqual((await pool.query('SELECT (SELECT count(*)::integer FROM pilot_ticket.reporter_access_grant) AS grants,(SELECT count(*)::integer FROM communication.delivery) AS deliveries')).rows[0], baselineCounts);

    current.value = 'A';
    const page = await query.list({ request: 'A', limit: 2 });
    assert.equal(page.items.length, 2);
    assert.equal(new Set(page.items.map((item) => item.ref)).size, page.items.length);
    assert.equal(page.items.some((item) => item.ref === firstB.receipt.request_ref), false);
    const reviewItem = (await query.list({ request: 'A', source: 'WEB' })).items.find((item) => item.ref === reviewA.receipt.request_ref);
    assert.equal(reviewItem.display_status, 'UNDER_REVIEW');
    assert.ok(page.next_cursor);
    const rest = await query.list({ request: 'A', limit: 2, cursor: page.next_cursor });
    const allA = [...page.items, ...rest.items];
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
    const firstIntake = (await pool.query('SELECT b.intake_id::text AS intake_id,i.version,COALESCE(max(e.event_ordinal),0)::integer+1 AS next_ordinal FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id LEFT JOIN intake.service_intake_event e ON e.intake_id=i.id WHERE b.request_ref=$1 GROUP BY b.intake_id,i.version', [firstA.receipt.request_ref])).rows[0];
    await pool.query(`INSERT INTO intake.service_intake_event(event_type,aggregate_type,intake_id,aggregate_version,event_ordinal,occurred_at,trace_id,payload)
      VALUES('intake.rule_decision_applied','intake',$1::uuid,$2,$3,'2020-01-01 00:00:00',$4,'{}'::jsonb)`, [firstIntake.intake_id, firstIntake.version, firstIntake.next_ordinal, 'yxx:ss005:late']);
    const latePage = await store.timeline({ scope: scopeA, requestRef: firstA.receipt.request_ref, cursor: timelineAnchor.next_cursor, limit: 1 });
    assert.equal(latePage.items[0].occurred_at, '2020-01-01 00:00:00');
    const afterLate = await store.timeline({ scope: scopeA, requestRef: firstA.receipt.request_ref, cursor: latePage.next_cursor, limit: 1 });
    assert.notEqual(afterLate.items[0]?.occurred_at, '2020-01-01 00:00:00');

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
    const refs = new Set();
    let page = await query.list({ request: 'A', limit: 50 });
    while (true) {
      for (const item of page.items) {
        assert.equal(refs.has(item.ref), false, `duplicate ref ${item.ref}`);
        refs.add(item.ref);
      }
      if (!page.next_cursor) break;
      page = await query.list({ request: 'A', limit: 50, cursor: page.next_cursor });
    }
    assert.equal(web.length, 250);
    assert.equal(bot.length, 250);
    assert.equal(refs.size, 500);
    assert.equal([...refs].filter((ref) => web.some((item) => item.receipt.request_ref === ref)).length, 250);
    assert.equal([...refs].filter((ref) => bot.some((item) => item.public_ref === ref)).length, 250);
  } });
  await assertNoP2016Residual({ databaseUrl });
});
