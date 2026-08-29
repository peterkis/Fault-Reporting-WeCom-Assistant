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
  applyNotificationOutboxMigration,
  createNotificationOutbox,
} from '../src/p1-007-notification-outbox.mjs';
import {
  applyPilotAccessMigration,
  createPilotAccessService,
} from '../src/p1-009-pilot-access-workbench.mjs';
import {
  applyTicketClosureMigration,
  createTicketClosureService,
  createTicketLifecycleProcessor,
} from '../src/p1-010-ticket-closure.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const messageIds = new Set();
const intakeIds = new Set();
const ticketIds = new Set();
const principalIds = new Set();
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 2_000 })
  : null;

function normalizedMessage(msgId, {
  text = 'HIS 登录失败，提示权限错误',
  chatId = `group-${msgId}`,
  reporterWeComUserId = `reporter-${msgId}`,
} = {}) {
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-010-test',
      chattype: 'group',
      chatid: chatId,
      from: { userid: reporterWeComUserId },
      msgtype: 'text',
      text: { content: text },
    },
  }, { receivedAt: new Date().toISOString() });
  assert.equal(adapted.ok, true);
  messageIds.add(msgId);
  return adapted.message;
}

function request(message) {
  return {
    message,
    traceId: `trace-${message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: new Date(Date.parse(message.received_at) + 86_400_000).toISOString(),
  };
}

async function seedTicket({ chatId, reporterWeComUserId }) {
  const message = normalizedMessage(`p1-010-seed-${randomUUID()}`, { chatId, reporterWeComUserId });
  const processor = createPilotTicketProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
  });
  const result = await createChannelMessageInbox({ pool }).accept(request(message), processor);
  assert.equal(result.ok, true);
  intakeIds.add(result.result.intake.id);
  ticketIds.add(result.result.ticket.id);
  return result.result.ticket;
}

async function createActors(reporterWeComUserId) {
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
  [reporter, handler].forEach((principal) => principalIds.add(principal.id));
  return { access, reporter, handler };
}

before(async () => {
  if (!pool) {
    return;
  }
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyNotificationOutboxMigration({ pool });
  await applyPilotAccessMigration({ pool });
  await applyTicketClosureMigration({ pool });
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

integrationTest('supplement, card confirmation, duplicate card protection, close, and reopen preserve a real Ticket lifecycle', async () => {
  let clock = Date.now() + 1_000;
  const reporterWeComUserId = `reporter-p1-010-${randomUUID()}-${'x'.repeat(140)}`;
  const chatId = `group-p1-010-${randomUUID()}`;
  const ticket = await seedTicket({ chatId, reporterWeComUserId });
  const { access, reporter, handler } = await createActors(reporterWeComUserId);
  const closure = createTicketClosureService({
    pool,
    outbox: createNotificationOutbox(),
    resolveReporterActor: access.resolveReporterActor,
    now: () => new Date(clock),
    cardTtlMs: 10_000,
    autoCloseAfterMs: 20_000,
    autoCloseReminderLeadMs: 5_000,
  });
  const actions = createTicketActionService({
    pool,
    authorize: access.authorizeAction,
    afterAction: closure.afterTicketAction,
  });
  const started = await actions.perform({
    ticketId: ticket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: ticket.version,
    traceId: 'trace-p1-010-accept',
  }).then((accepted) => actions.perform({
    ticketId: ticket.id,
    action: 'start',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: accepted.ticket.version,
    traceId: 'trace-p1-010-start',
  }));
  const waiting = await actions.perform({
    ticketId: ticket.id,
    action: 'request-information',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: started.ticket.version,
    note: '请补充终端编号',
    externalVisible: true,
    traceId: 'trace-p1-010-request',
  });
  assert.equal(waiting.ticket.status, 'WAITING_REQUESTER');

  const lifecycleProcessor = createTicketLifecycleProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
    closure,
  });
  const supplemental = normalizedMessage(`p1-010-supplement-${randomUUID()}`, {
    text: '终端编号 NURSE-01，其他终端正常',
    chatId,
    reporterWeComUserId,
  });
  const supplementaryResult = await createChannelMessageInbox({ pool }).accept(
    request(supplemental),
    lifecycleProcessor,
  );
  assert.equal(supplementaryResult.ok, true);
  assert.equal(supplementaryResult.result.ticket.status, 'IN_PROGRESS');
  assert.equal(supplementaryResult.result.ticket_event.event_type, 'ticket.information_added');

  const resolved = await actions.perform({
    ticketId: ticket.id,
    action: 'resolve',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: supplementaryResult.result.ticket.version,
    note: '已重新同步账号权限',
    externalVisible: true,
    traceId: 'trace-p1-010-resolve',
  });
  const cards = await pool.query(
    `SELECT task_id::text, action_key
       FROM notification.card_action_task
      WHERE ticket_event_id = $1::uuid
      ORDER BY action_key`,
    [resolved.event.event_id],
  );
  assert.deepEqual(cards.rows.map((row) => row.action_key), ['confirm_resolved', 'still_broken']);
  const stillBroken = cards.rows.find((card) => card.action_key === 'still_broken');
  const wrongActor = await closure.handleCardAction({
    taskId: stillBroken.task_id,
    actionKey: 'still_broken',
    actorWecomUserId: 'wrong-user',
    eventReqId: 'card-wrong-user',
    traceId: 'trace-p1-010-wrong-card',
    actionService: actions,
  });
  assert.deepEqual(wrongActor, {
    ok: false,
    error: { code: 'CARD_ACTION_FORBIDDEN', retryable: false },
  });

  const reopened = await closure.handleCardAction({
    taskId: stillBroken.task_id,
    actionKey: 'still_broken',
    actorWecomUserId: reporterWeComUserId,
    eventReqId: 'card-still-broken',
    traceId: 'trace-p1-010-reopen',
    actionService: actions,
  });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.ticket.status, 'REOPENED');
  const duplicatedCard = await closure.handleCardAction({
    taskId: stillBroken.task_id,
    actionKey: 'still_broken',
    actorWecomUserId: reporterWeComUserId,
    eventReqId: 'card-still-broken',
    traceId: 'trace-p1-010-reopen-replay',
    actionService: actions,
  });
  assert.equal(duplicatedCard.ok, true);
  assert.equal(duplicatedCard.duplicate, true);

  const restarted = await actions.perform({
    ticketId: ticket.id,
    action: 'start',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: reopened.ticket.version,
    traceId: 'trace-p1-010-restart',
  });
  const resolvedAgain = await actions.perform({
    ticketId: ticket.id,
    action: 'resolve',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: restarted.ticket.version,
    note: '第二次处理完成',
    externalVisible: true,
    traceId: 'trace-p1-010-resolve-again',
  });
  const confirmTask = await pool.query(
    `SELECT task_id::text
       FROM notification.card_action_task
      WHERE ticket_event_id = $1::uuid AND action_key = 'confirm_resolved'`,
    [resolvedAgain.event.event_id],
  );
  const closed = await closure.handleCardAction({
    taskId: confirmTask.rows[0].task_id,
    actionKey: 'confirm_resolved',
    actorWecomUserId: reporterWeComUserId,
    eventReqId: 'card-confirm-resolved',
    traceId: 'trace-p1-010-confirm',
    actionService: actions,
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.ticket.status, 'CLOSED');
  assert.equal(closed.ticket.closure_reason, 'REQUESTER_CONFIRMED');
  assert.equal(reporter.id.length, 36);
});

integrationTest('the complete lifecycle processor exposes created delivery ids for post-commit acknowledgement', async () => {
  const reporterWeComUserId = `reporter-p1-010-created-${randomUUID()}`;
  const { access } = await createActors(reporterWeComUserId);
  const closure = createTicketClosureService({
    pool,
    outbox: createNotificationOutbox(),
    resolveReporterActor: access.resolveReporterActor,
  });
  const lifecycleProcessor = createTicketLifecycleProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
    closure,
  });
  const message = normalizedMessage(`p1-010-created-${randomUUID()}`, {
    reporterWeComUserId,
  });

  const accepted = await createChannelMessageInbox({ pool }).accept(request(message), lifecycleProcessor);
  intakeIds.add(accepted.result.intake.id);
  ticketIds.add(accepted.result.ticket.id);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.result.lifecycle.created, true);
  assert.equal(accepted.result.lifecycle.delivery_ids.length, 2);
});

integrationTest('expired cards do not mutate Tickets and resolved Tickets close automatically with an explicit non-user reason', async () => {
  let clock = Date.now() + 1_000;
  const reporterWeComUserId = `reporter-p1-010-auto-${randomUUID()}`;
  const ticket = await seedTicket({ chatId: `group-p1-010-auto-${randomUUID()}`, reporterWeComUserId });
  const { access, handler } = await createActors(reporterWeComUserId);
  const closure = createTicketClosureService({
    pool,
    outbox: createNotificationOutbox(),
    resolveReporterActor: access.resolveReporterActor,
    now: () => new Date(clock),
    cardTtlMs: 10,
    autoCloseAfterMs: 20,
    autoCloseReminderLeadMs: 10,
  });
  const actions = createTicketActionService({
    pool,
    authorize: access.authorizeAction,
    afterAction: closure.afterTicketAction,
  });
  const accepted = await actions.perform({
    ticketId: ticket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: ticket.version,
    traceId: 'trace-p1-010-auto-accept',
  });
  const started = await actions.perform({
    ticketId: ticket.id,
    action: 'start',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: accepted.ticket.version,
    traceId: 'trace-p1-010-auto-start',
  });
  const resolved = await actions.perform({
    ticketId: ticket.id,
    action: 'resolve',
    actor: { type: 'PILOT_USER', id: handler.id },
    expectedVersion: started.ticket.version,
    note: '已完成处理',
    externalVisible: true,
    traceId: 'trace-p1-010-auto-resolve',
  });
  const confirmTask = await pool.query(
    `SELECT task_id::text
       FROM notification.card_action_task
      WHERE ticket_event_id = $1::uuid AND action_key = 'confirm_resolved'`,
    [resolved.event.event_id],
  );
  const beforeReminder = await closure.runAutoClose({ actionService: actions, limit: 5 });
  assert.deepEqual(beforeReminder.closed_ticket_ids, []);
  clock += 15;
  const reminder = await closure.runAutoCloseReminders({ limit: 5 });
  assert.deepEqual(reminder.reminded_ticket_ids, [ticket.id]);
  const repeatedReminder = await closure.runAutoCloseReminders({ limit: 5 });
  assert.deepEqual(repeatedReminder.reminded_ticket_ids, []);
  const reminderFacts = await pool.query(
    `SELECT count(event.event_id)::integer AS event_count,
            count(outbox.id)::integer AS outbox_count
       FROM pilot_ticket.ticket_event AS event
       JOIN notification.outbox AS outbox ON outbox.ticket_event_id = event.event_id
      WHERE event.ticket_id = $1::uuid
        AND event.event_type = 'ticket.auto_close_reminder'`,
    [ticket.id],
  );
  assert.deepEqual(reminderFacts.rows, [{ event_count: 1, outbox_count: 1 }]);
  const expired = await closure.handleCardAction({
    taskId: confirmTask.rows[0].task_id,
    actionKey: 'confirm_resolved',
    actorWecomUserId: reporterWeComUserId,
    eventReqId: 'card-expired',
    traceId: 'trace-p1-010-expired',
    actionService: actions,
  });
  assert.deepEqual(expired, {
    ok: false,
    error: { code: 'CARD_ACTION_EXPIRED', retryable: false },
  });

  clock += 10;
  const automatic = await closure.runAutoClose({ actionService: actions, limit: 5 });
  assert.deepEqual(automatic.closed_ticket_ids, [ticket.id]);
  const persisted = await pool.query(
    'SELECT status, closure_reason FROM pilot_ticket.ticket WHERE id = $1::uuid',
    [ticket.id],
  );
  assert.deepEqual(persisted.rows, [{ status: 'CLOSED', closure_reason: 'AUTO_TIMEOUT' }]);
});
