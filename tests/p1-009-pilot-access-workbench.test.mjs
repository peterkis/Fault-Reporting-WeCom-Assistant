import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
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
  ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 2_000 })
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
  const processor = createPilotTicketProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
  });
  const result = await createChannelMessageInbox({ pool }).accept({
    message: source.message,
    traceId: `trace-${source.message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: new Date(Date.parse(source.message.received_at) + 86_400_000).toISOString(),
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
