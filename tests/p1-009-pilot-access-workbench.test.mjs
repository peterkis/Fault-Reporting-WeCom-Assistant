import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { formatEpochMsToShanghaiLocal } from '../src/platform/time-contract.mjs';
import { adaptWeComSdkFrame } from '../src/p1-002-wecom-sdk-adapter.mjs';
import {
  applyChannelMessageInboxMigration,
  createChannelMessageInbox,
} from '../src/p1-003-channel-message-inbox.mjs';
import {
  applyServiceIntakeMigration,
  createServiceIntakeProcessor,
} from '../src/p1-004-service-intake.mjs';
import {
  applyPilotTicketCoreMigration,
  createPilotTicketCore,
  createPilotTicketProcessor,
} from '../src/p1-005-pilot-ticket-core.mjs';
import {
  applyTicketStateActionMigration,
  createTicketActionService,
} from '../src/p1-006-ticket-state-actions.mjs';
import {
  applyPilotAccessMigration,
  closePilotWorkbenchServer,
  createPilotAccessService,
  createPilotWorkbenchServer,
  listenPilotWorkbenchServer,
} from '../src/p1-009-pilot-access-workbench.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const messageIds = new Set();
const intakeIds = new Set();
const ticketIds = new Set();
const principalIds = new Set();
const pool = databaseUrl
  ? createPostgresPool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 2_000 })
  : null;

function createMessage(msgId) {
  const reporterWeComUserId = `reporter-${msgId}`;
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-009-test',
      chattype: 'group',
      chatid: `group-${msgId}`,
      from: { userid: reporterWeComUserId },
      msgtype: 'text',
      text: { content: 'HIS 登录失败，提示权限错误' },
    },
  }, { receivedAt: new Date().toISOString() });
  assert.equal(adapted.ok, true);
  messageIds.add(msgId);
  return { message: adapted.message, reporterWeComUserId };
}

async function seedTicket() {
  const source = createMessage(`p1-009-${randomUUID()}`);
  const retentionUntilEpochMs = String(BigInt(source.message.received_epoch_ms) + 86_400_000n);
  const processor = createPilotTicketProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
  });
  const result = await createChannelMessageInbox({ pool }).accept({
    message: source.message,
    traceId: `trace-${source.message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: formatEpochMsToShanghaiLocal(retentionUntilEpochMs),
    retentionUntilEpochMs,
  }, processor);
  assert.equal(result.ok, true);
  intakeIds.add(result.result.intake.id);
  ticketIds.add(result.result.ticket.id);
  return { ticket: result.result.ticket, reporterWeComUserId: source.reporterWeComUserId };
}

before(async () => {
  if (!pool) {
    return;
  }
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyPilotAccessMigration({ pool });
});

after(async () => {
  if (!pool) {
    return;
  }
  if (ticketIds.size > 0) {
    await pool.query(
      `UPDATE intake.service_intake
          SET pilot_ticket_id = NULL,
              status = CASE WHEN status = 'TICKET_CREATED' THEN 'RECEIVED' ELSE status END
        WHERE pilot_ticket_id = ANY($1::uuid[])`,
      [[...ticketIds]],
    );
    await pool.query('DELETE FROM pilot_ticket.ticket WHERE id = ANY($1::uuid[])', [[...ticketIds]]);
  }
  if (principalIds.size > 0) {
    await pool.query('DELETE FROM pilot_ticket.pilot_principal WHERE id = ANY($1::uuid[])', [[...principalIds]]);
  }
  if (intakeIds.size > 0) {
    await pool.query('DELETE FROM intake.service_intake WHERE id = ANY($1::uuid[])', [[...intakeIds]]);
  }
  if (messageIds.size > 0) {
    await pool.query(
      'DELETE FROM channel.message_inbox WHERE provider = $1 AND msg_id = ANY($2::text[])',
      ['WECOM_AIBOT', [...messageIds]],
    );
  }
  await pool.end();
});

integrationTest('Pilot roles isolate teams, enable audited handling, and keep internal notes out of reporter views', async () => {
  const { ticket, reporterWeComUserId } = await seedTicket();
  const access = createPilotAccessService({ pool });
  const reporter = await access.upsertPrincipal({
    wecomUserId: reporterWeComUserId,
    displayName: '申报人',
    roles: ['REPORTER'],
  });
  const handler = await access.upsertPrincipal({
    wecomUserId: `handler-${randomUUID()}`,
    displayName: '处理工程师',
    roles: ['HANDLER'],
    resolverTeamIds: ['PILOT_IT'],
  });
  const outsider = await access.upsertPrincipal({
    wecomUserId: `outsider-${randomUUID()}`,
    displayName: '跨组工程师',
    roles: ['HANDLER'],
  });
  [reporter, handler, outsider].forEach((principal) => principalIds.add(principal.id));

  const actions = createTicketActionService({ pool, authorize: access.authorizeAction });
  const unauthorized = await actions.perform({
    ticketId: ticket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: outsider.id },
    expectedVersion: ticket.version,
    traceId: 'trace-p1-009-forbidden',
  });
  assert.deepEqual(unauthorized, {
    ok: false,
    error: { code: 'FORBIDDEN', retryable: false },
  });

  const accepted = await actions.perform({
    ticketId: ticket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: ticket.version,
    traceId: 'trace-p1-009-accept',
  });
  const note = await actions.perform({
    ticketId: ticket.id,
    action: 'add-note',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: accepted.ticket.version,
    note: 'internal-only-p1-009-note',
    traceId: 'trace-p1-009-note',
  });
  assert.equal(note.ok, true);

  const queue = await access.listWorkQueue({ actorId: handler.id });
  const queuedTicket = queue.items.find((item) => item.id === ticket.id);
  assert.ok(queuedTicket);
  assert.equal(queuedTicket.mobile_summary.includes('internal-only-p1-009-note'), false);

  const reporterView = await access.getTicketView({ ticketId: ticket.id, actorId: reporter.id });
  assert.equal(reporterView.ok, true);
  assert.equal(JSON.stringify(reporterView).includes('internal-only-p1-009-note'), false);
  assert.equal(reporterView.events.some((event) => Object.hasOwn(event, 'internal_note')), false);

  const started = await actions.perform({
    ticketId: ticket.id,
    action: 'start',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: note.ticket.version,
    traceId: 'trace-p1-009-start',
  });
  const resolved = await actions.perform({
    ticketId: ticket.id,
    action: 'resolve',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: started.ticket.version,
    note: '已重新同步账号权限',
    externalVisible: true,
    traceId: 'trace-p1-009-resolve',
  });
  const handlerAutoClose = await createTicketActionService({ pool }).perform({
    ticketId: ticket.id,
    action: 'auto-close',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: resolved.ticket.version,
    traceId: 'trace-p1-009-handler-auto-close',
  });
  assert.deepEqual(handlerAutoClose, {
    ok: false,
    error: { code: 'FORBIDDEN', retryable: false },
  });
  const confirmed = await actions.perform({
    ticketId: ticket.id,
    action: 'confirm',
    actor: { type: 'REPORTER', id: reporter.id },
    expectedVersion: resolved.ticket.version,
    traceId: 'trace-p1-009-confirm',
  });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.ticket.status, 'CLOSED');
});

integrationTest('the minimum local Pilot workbench exposes an injected authenticated mobile-friendly work view', async () => {
  const { ticket, reporterWeComUserId } = await seedTicket();
  const access = createPilotAccessService({ pool });
  const handler = await access.upsertPrincipal({
    wecomUserId: `handler-ui-${randomUUID()}`,
    displayName: '处理工程师',
    roles: ['HANDLER'],
    resolverTeamIds: ['PILOT_IT'],
  });
  const reporter = await access.upsertPrincipal({
    wecomUserId: reporterWeComUserId,
    displayName: '申报人',
    roles: ['REPORTER'],
  });
  [handler, reporter].forEach((principal) => principalIds.add(principal.id));
  let actionCalls = 0;
  const server = createPilotWorkbenchServer({
    access,
    actions: {
      perform: async () => {
        actionCalls += 1;
        return { ok: true };
      },
    },
    authenticate: async () => ({ type: 'PILOT_USER', id: handler.id }),
  });
  const address = await listenPilotWorkbenchServer(server, { host: '127.0.0.1', port: 0 });
  try {
    const page = await fetch(`http://127.0.0.1:${address.port}/`);
    const work = await fetch(`http://127.0.0.1:${address.port}/api/pilot/work`);
    const automaticClose = await fetch(
      `http://127.0.0.1:${address.port}/api/pilot/tickets/${ticket.id}/actions/auto-close`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );

    assert.equal(page.status, 200);
    assert.match(await page.text(), /name="viewport"/u);
    assert.equal(work.status, 200);
    assert.equal((await work.json()).items.some((item) => item.id === ticket.id), true);
    assert.equal(automaticClose.status, 403);
    assert.deepEqual(await automaticClose.json(), {
      ok: false,
      error: { code: 'FORBIDDEN', retryable: false },
    });
    assert.equal(actionCalls, 0);
  } finally {
    await closePilotWorkbenchServer(server);
  }
});

integrationTest('Pilot HTTP actions preserve authenticated ownership and reject malformed request bodies', async () => {
  const { ticket } = await seedTicket();
  const access = createPilotAccessService({ pool });
  const handler = await access.upsertPrincipal({ wecomUserId: `handler-json-${randomUUID()}`, displayName: 'Synthetic handler', roles: ['HANDLER'], resolverTeamIds: ['PILOT_IT'] });
  principalIds.add(handler.id);
  const actions = createTicketActionService({ pool, authorize: access.authorizeAction });
  const server = createPilotWorkbenchServer({ access, actions: { perform: actions.performRaw }, authenticate: async () => ({ type: 'PILOT_USER', id: handler.id }) });
  const address = await listenPilotWorkbenchServer(server);
  const url = `http://127.0.0.1:${address.port}/api/pilot/tickets/${ticket.id}/actions/accept`;
  const send = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  try {
    for (const body of ['{', '"' + 'a'.repeat(32_768) + '"']) {
      const response = await send(body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { ok: false, error: { code: 'VALIDATION_FAILED', retryable: false } });
    }
    for (const body of ['null', '1', '[]']) {
      const response = await send(body);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { ok: false, error: { code: 'VALIDATION_FAILED', retryable: false } });
    }
    const accepted = await send(JSON.stringify({ ticketId: randomUUID(), action: 'auto-close', actor: { type: 'SYSTEM', id: null }, expectedVersion: ticket.version, traceId: 'synthetic-http-owner' }));
    assert.equal(accepted.status, 200);
    const result = await accepted.json();
    assert.equal(result.ticket.id, ticket.id);
    assert.equal(result.ticket.status, 'ACCEPTED');
    assert.equal(result.ticket.assignee_id, handler.id);
  } finally {
    await closePilotWorkbenchServer(server);
  }
});

integrationTest('Pilot raw HTTP Action validation preserves rejection, permissions, and atomic rollback', async () => {
  const { ticket } = await seedTicket();
  const access = createPilotAccessService({ pool });
  const handler = await access.upsertPrincipal({ wecomUserId: `handler-raw-${randomUUID()}`, displayName: 'Synthetic handler', roles: ['HANDLER'], resolverTeamIds: ['PILOT_IT'] });
  const outsider = await access.upsertPrincipal({ wecomUserId: `outsider-raw-${randomUUID()}`, displayName: 'Synthetic outsider', roles: ['HANDLER'] });
  [handler, outsider].forEach(principal => principalIds.add(principal.id));
  const actions = createTicketActionService({ pool, authorize: access.authorizeAction });
  const rollbackActions = createTicketActionService({ pool, authorize: access.authorizeAction, afterAction: async () => { throw new Error('SYNTHETIC_AFTER_ACTION_FAILURE'); } });
  let actorId = handler.id;
  const server = createPilotWorkbenchServer({ access, actions: { perform: actions.performRaw }, authenticate: async () => ({ type: 'PILOT_USER', id: actorId }) });
  const address = await listenPilotWorkbenchServer(server, { host: '127.0.0.1', port: 0 });
  const initial = await access.getTicketView({ ticketId: ticket.id, actorId: handler.id });
  assert.equal(initial.ok, true);
  const input = { expectedVersion: ticket.version, traceId: 'synthetic-raw-http' };
  const send = (action, body) => fetch(`http://127.0.0.1:${address.port}/api/pilot/tickets/${ticket.id}/actions/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const assertUnchanged = async () => assert.deepEqual(await access.getTicketView({ ticketId: ticket.id, actorId: handler.id }), initial);
  try {
    for (const body of [
      { ...input, expectedVersion: String(ticket.version) },
      { ...input, expectedVersion: null },
      { ...input, expectedVersion: 1.5 },
      { ...input, note: 2 },
      { ...input, note: {} },
      { ...input, traceId: null },
      { ...input, externalVisible: 'true' },
      { ...input, reasonCode: 2 },
      { ...input, attachmentIds: {} },
    ]) {
      const response = await send('accept', body);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { ok: false, error: { code: 'VALIDATION_FAILED', retryable: false } });
      await assertUnchanged();
    }
    const unknownAction = await send('unrecognized', input);
    assert.equal(unknownAction.status, 409);
    assert.deepEqual(await unknownAction.json(), { ok: false, error: { code: 'INVALID_STATE_TRANSITION', retryable: false } });
    await assertUnchanged();
    actorId = outsider.id;
    const forbidden = await send('accept', input);
    assert.equal(forbidden.status, 403);
    assert.deepEqual(await forbidden.json(), { ok: false, error: { code: 'FORBIDDEN', retryable: false } });
    await assertUnchanged();

    const rawInput = { ...input, ticketId: ticket.id, action: 'accept', actor: { type: 'PILOT_USER', id: handler.id } };
    assert.deepEqual(await actions.performRaw({ ...rawInput, action: 'unrecognized' }), { ok: false, error: { code: 'INVALID_STATE_TRANSITION', retryable: false } });
    // Malformed version validation must still occur before a UUID SQL lookup.
    assert.deepEqual(await actions.performRaw({ ...rawInput, ticketId: 'not-a-uuid', expectedVersion: '2' }), { ok: false, error: { code: 'VALIDATION_FAILED', retryable: false } });
    // The owning transaction is opened before raw validation, as for the typed entry.
    await assert.rejects(createTicketActionService().performRaw(null), /A PostgreSQL pool is required/u);
    await assert.rejects(rollbackActions.performRaw(rawInput), /SYNTHETIC_AFTER_ACTION_FAILURE/u);
    await assertUnchanged();

    actorId = handler.id;
    const accepted = await send('accept', { ...input, note: null });
    assert.equal(accepted.status, 200);
    const result = await accepted.json();
    assert.equal(result.ticket.status, 'ACCEPTED');
    assert.equal(result.ticket.version, ticket.version + 1);
    assert.equal(result.ticket.assignee_id, handler.id);
    const final = await access.getTicketView({ ticketId: ticket.id, actorId: handler.id });
    assert.equal(final.ok, true);
    assert.equal(final.events.length, initial.events.length + 1);
  } finally {
    await closePilotWorkbenchServer(server);
  }
});
