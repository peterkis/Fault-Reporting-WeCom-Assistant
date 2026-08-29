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
  createNotificationDeliveryWorker,
  createNotificationOutbox,
} from '../src/p1-007-notification-outbox.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const messageIds = new Set();
const intakeIds = new Set();
const ticketIds = new Set();
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 2_000 })
  : null;

function newMessage(msgId) {
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-007-test',
      chattype: 'group',
      chatid: `group-${msgId}`,
      from: { userid: `reporter-${msgId}` },
      msgtype: 'text',
      text: { content: 'HIS 登录失败，提示权限错误' },
    },
  }, { receivedAt: '2026-08-29T02:00:00.000Z' });
  assert.equal(adapted.ok, true);
  messageIds.add(msgId);
  return adapted.message;
}

async function seedTicket() {
  const message = newMessage(`p1-007-${randomUUID()}`);
  const processor = createPilotTicketProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
  });
  const result = await createChannelMessageInbox({ pool }).accept({
    message,
    traceId: `trace-${message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: '2026-09-05T02:00:00.000Z',
  }, processor);
  assert.equal(result.ok, true);
  intakeIds.add(result.result.intake.id);
  ticketIds.add(result.result.ticket.id);
  return result.result.ticket;
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

integrationTest('state, Ticket Event, Outbox, and target deliveries commit together while delivery failures retry independently', async () => {
  const ticket = await seedTicket();
  const outbox = createNotificationOutbox({
    targetsForEvent: () => [
      { channel: 'WECOM_DIRECT', targetKey: 'reporter-test' },
      { channel: 'PILOT_TEAM', targetKey: 'team-test' },
    ],
  });
  const actions = createTicketActionService({
    pool,
    afterAction: (context) => outbox.enqueueTicketEvent(context),
  });

  const accepted = await actions.perform({
    ticketId: ticket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: randomUUID() },
    expectedVersion: ticket.version,
    note: '信息科已受理',
    externalVisible: true,
    traceId: 'trace-p1-007-accept',
  });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.side_effects.delivery_ids.length, 2);
  const atomicFacts = await pool.query(
    `SELECT ticket.status,
            count(DISTINCT event.event_id)::integer AS event_count,
            count(DISTINCT outbox.id)::integer AS outbox_count,
            count(DISTINCT delivery.id)::integer AS delivery_count
       FROM pilot_ticket.ticket AS ticket
       JOIN pilot_ticket.ticket_event AS event ON event.ticket_id = ticket.id
       JOIN notification.outbox AS outbox ON outbox.ticket_event_id = event.event_id
       JOIN notification.delivery AS delivery ON delivery.outbox_id = outbox.id
      WHERE ticket.id = $1::uuid
      GROUP BY ticket.status`,
    [ticket.id],
  );
  assert.deepEqual(atomicFacts.rows, [{
    status: 'ACCEPTED',
    event_count: 1,
    outbox_count: 1,
    delivery_count: 2,
  }]);

  let clock = Date.now() + 1_000;
  const sentTargets = [];
  const worker = createNotificationDeliveryWorker({
    pool,
    now: () => new Date(clock),
    retryBaseMs: 500,
    sender: async ({ targetKey }) => {
      sentTargets.push(targetKey);
      if (targetKey === 'reporter-test' && sentTargets.filter((item) => item === targetKey).length === 1) {
        const error = new Error('synthetic timeout');
        error.code = 'WECOM_SEND_TIMEOUT';
        throw error;
      }
      return { ok: true, providerMessageId: `ack-${targetKey}` };
    },
  });

  const firstRun = await worker.runOnce({ limit: 2 });
  assert.deepEqual(
    firstRun.results.map((result) => result.status).sort(),
    ['PENDING', 'SENT'],
  );
  const afterFailure = await pool.query(
    `SELECT status, attempt_count, last_error_code
       FROM notification.delivery
      WHERE id = ANY($1::uuid[])
      ORDER BY status`,
    [accepted.side_effects.delivery_ids],
  );
  assert.deepEqual(afterFailure.rows, [
    { status: 'PENDING', attempt_count: 1, last_error_code: 'WECOM_SEND_TIMEOUT' },
    { status: 'SENT', attempt_count: 1, last_error_code: null },
  ]);

  clock += 1_000;
  const retried = await worker.runOnce({ limit: 2 });
  assert.deepEqual(retried.results.map((result) => result.status), ['SENT']);
  assert.deepEqual(sentTargets.sort(), ['reporter-test', 'reporter-test', 'team-test']);

  const ticketFact = await pool.query(
    'SELECT status, version FROM pilot_ticket.ticket WHERE id = $1::uuid',
    [ticket.id],
  );
  assert.deepEqual(ticketFact.rows, [{ status: 'ACCEPTED', version: 2 }]);
});

integrationTest('a leased Delivery is not sent twice by concurrent Workers and terminal failures become dead letters', async () => {
  const ticket = await seedTicket();
  const outbox = createNotificationOutbox({
    targetsForEvent: () => [{ channel: 'WECOM_DIRECT', targetKey: 'single-target' }],
  });
  const actions = createTicketActionService({
    pool,
    afterAction: (context) => outbox.enqueueTicketEvent(context),
  });
  const accepted = await actions.perform({
    ticketId: ticket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: randomUUID() },
    expectedVersion: ticket.version,
    traceId: 'trace-p1-007-lease',
  });
  let releaseSend;
  let senderReached;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const senderReachedGate = new Promise((resolve) => { senderReached = resolve; });
  let sendCount = 0;
  const worker = createNotificationDeliveryWorker({
    pool,
    now: () => new Date(Date.now() + 1_000),
    sender: async () => {
      sendCount += 1;
      senderReached();
      await sendGate;
      return { ok: true, providerMessageId: 'single-provider-ack' };
    },
  });
  const firstWorker = worker.runOnce({ limit: 1 });
  await senderReachedGate;
  const secondWorker = await worker.runOnce({ limit: 1 });
  releaseSend();
  const firstResult = await firstWorker;

  assert.equal(sendCount, 1);
  assert.deepEqual(secondWorker, { processed: 0, results: [] });
  assert.deepEqual(firstResult.results.map((result) => result.status), ['SENT']);
  assert.equal(accepted.side_effects.delivery_ids.length, 1);

  const deadTicket = await seedTicket();
  const deadAccepted = await actions.perform({
    ticketId: deadTicket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: randomUUID() },
    expectedVersion: deadTicket.version,
    traceId: 'trace-p1-007-dead-letter',
  });
  const deadWorker = createNotificationDeliveryWorker({
    pool,
    now: () => new Date(Date.now() + 1_000),
    maxAttempts: 1,
    sender: async () => {
      const error = new Error('synthetic permanent rejection');
      error.code = 'WECOM_SEND_REJECTED';
      throw error;
    },
  });
  const deadResult = await deadWorker.runOnce({ limit: 1 });
  assert.deepEqual(deadResult.results.map((result) => result.status), ['DEAD_LETTER']);
  const audit = await pool.query(
    `SELECT attempt.outcome, attempt.error_code
       FROM notification.delivery_attempt AS attempt
      WHERE attempt.delivery_id = $1::uuid`,
    [deadAccepted.side_effects.delivery_ids[0]],
  );
  assert.deepEqual(audit.rows, [{ outcome: 'DEAD_LETTER', error_code: 'WECOM_SEND_REJECTED' }]);
});

integrationTest('an Outbox failure rolls back the Ticket state and its Ticket Event', async () => {
  const ticket = await seedTicket();
  const outbox = createNotificationOutbox({
    targetsForEvent: () => [{ channel: 'WECOM_DIRECT', targetKey: 'rollback-target' }],
  });
  const actions = createTicketActionService({
    pool,
    afterAction: async (context) => {
      await outbox.enqueueTicketEvent(context);
      throw new Error('synthetic outbox transaction failure');
    },
  });

  await assert.rejects(
    () => actions.perform({
      ticketId: ticket.id,
      action: 'accept',
      actor: { type: 'PILOT_USER', id: randomUUID() },
      expectedVersion: ticket.version,
      traceId: 'trace-p1-007-rollback',
    }),
    /synthetic outbox transaction failure/u,
  );
  const facts = await pool.query(
    `SELECT ticket.status,
            ticket.version,
            (SELECT count(*)::integer FROM pilot_ticket.ticket_event WHERE ticket_id = ticket.id) AS event_count,
            (SELECT count(*)::integer FROM notification.outbox WHERE ticket_id = ticket.id) AS outbox_count
       FROM pilot_ticket.ticket AS ticket
      WHERE ticket.id = $1::uuid`,
    [ticket.id],
  );
  assert.deepEqual(facts.rows, [{
    status: 'QUEUED',
    version: 1,
    event_count: 0,
    outbox_count: 0,
  }]);
});

integrationTest('the default notification matrix keeps internal notes off reporter delivery and the Worker rate-limits each target', async () => {
  const matrixTicket = await seedTicket();
  const defaultOutbox = createNotificationOutbox();
  const matrixActions = createTicketActionService({
    pool,
    afterAction: (context) => defaultOutbox.enqueueTicketEvent(context),
  });
  const note = await matrixActions.perform({
    ticketId: matrixTicket.id,
    action: 'add-note',
    actor: { type: 'PILOT_USER', id: randomUUID() },
    expectedVersion: matrixTicket.version,
    note: '仅处理组可见',
    traceId: 'trace-p1-007-matrix-note',
  });
  assert.equal(note.ok, true);
  const matrixDeliveries = await pool.query(
    `SELECT channel, target_key
       FROM notification.delivery
      WHERE id = ANY($1::uuid[])
      ORDER BY channel`,
    [note.side_effects.delivery_ids],
  );
  assert.deepEqual(matrixDeliveries.rows, [{
    channel: 'PILOT_TEAM',
    target_key: 'TEAM:PILOT_IT',
  }]);

  const firstTicket = await seedTicket();
  const secondTicket = await seedTicket();
  const targetKey = `rate-limited-${randomUUID()}`;
  const rateOutbox = createNotificationOutbox({
    targetsForEvent: () => [{ channel: 'WECOM_DIRECT', targetKey }],
  });
  const rateActions = createTicketActionService({
    pool,
    afterAction: (context) => rateOutbox.enqueueTicketEvent(context),
  });
  const first = await rateActions.perform({
    ticketId: firstTicket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: randomUUID() },
    expectedVersion: firstTicket.version,
    traceId: 'trace-p1-007-rate-first',
  });
  const second = await rateActions.perform({
    ticketId: secondTicket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: randomUUID() },
    expectedVersion: secondTicket.version,
    traceId: 'trace-p1-007-rate-second',
  });
  let clock = Date.now() + 1_000;
  const sent = [];
  const worker = createNotificationDeliveryWorker({
    pool,
    now: () => new Date(clock),
    maxDeliveriesPerTargetWindow: 1,
    rateLimitWindowMs: 1_000,
    sender: async ({ idempotencyKey }) => {
      sent.push(idempotencyKey);
      return { ok: true, providerMessageId: `ack-${sent.length}` };
    },
  });
  const limited = await worker.deliver({ deliveryId: first.side_effects.delivery_ids[0] });
  assert.equal(limited.status, 'SENT');
  assert.equal(sent.length, 1);
  const rateWindowFacts = await pool.query(
    `SELECT count(*)::integer AS sent_count
       FROM notification.delivery
      WHERE channel = 'WECOM_DIRECT'
        AND target_key = $1
        AND status = 'SENT'
        AND sent_at > $2::timestamptz`,
    [targetKey, new Date(clock - 1_000)],
  );
  assert.deepEqual(rateWindowFacts.rows, [{ sent_count: 1 }]);
  const blocked = await worker.deliver({ deliveryId: second.side_effects.delivery_ids[0] });
  assert.equal(blocked, null);
  const pending = await pool.query(
    `SELECT status
       FROM notification.delivery
      WHERE id = ANY($1::uuid[])
      ORDER BY status`,
    [[first.side_effects.delivery_ids[0], second.side_effects.delivery_ids[0]]],
  );
  assert.deepEqual(pending.rows, [{ status: 'PENDING' }, { status: 'SENT' }]);

  clock += 1_001;
  const afterWindow = await worker.deliver({ deliveryId: second.side_effects.delivery_ids[0] });
  assert.equal(afterWindow.status, 'SENT');
  assert.equal(sent.length, 2);
  assert.equal(first.side_effects.delivery_ids.length, 1);

  const concurrentFirstTicket = await seedTicket();
  const concurrentSecondTicket = await seedTicket();
  const concurrentTargetKey = `rate-concurrent-${randomUUID()}`;
  const concurrentOutbox = createNotificationOutbox({
    targetsForEvent: () => [{ channel: 'WECOM_DIRECT', targetKey: concurrentTargetKey }],
  });
  const concurrentActions = createTicketActionService({
    pool,
    afterAction: (context) => concurrentOutbox.enqueueTicketEvent(context),
  });
  const concurrentFirst = await concurrentActions.perform({
    ticketId: concurrentFirstTicket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: randomUUID() },
    expectedVersion: concurrentFirstTicket.version,
    traceId: 'trace-p1-007-rate-concurrent-first',
  });
  const concurrentSecond = await concurrentActions.perform({
    ticketId: concurrentSecondTicket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: randomUUID() },
    expectedVersion: concurrentSecondTicket.version,
    traceId: 'trace-p1-007-rate-concurrent-second',
  });
  let releaseFirstSend;
  let firstSenderReached;
  const firstSendGate = new Promise((resolve) => { releaseFirstSend = resolve; });
  const firstSenderReachedGate = new Promise((resolve) => { firstSenderReached = resolve; });
  let secondSenderCalls = 0;
  const firstConcurrentWorker = createNotificationDeliveryWorker({
    pool,
    now: () => new Date(clock),
    maxDeliveriesPerTargetWindow: 1,
    rateLimitWindowMs: 1_000,
    sender: async () => {
      firstSenderReached();
      await firstSendGate;
      return { ok: true, providerMessageId: 'rate-concurrent-first' };
    },
  });
  const secondConcurrentWorker = createNotificationDeliveryWorker({
    pool,
    now: () => new Date(clock),
    maxDeliveriesPerTargetWindow: 1,
    rateLimitWindowMs: 1_000,
    sender: async () => {
      secondSenderCalls += 1;
      return { ok: true, providerMessageId: 'rate-concurrent-second' };
    },
  });
  const firstConcurrentDelivery = firstConcurrentWorker.deliver({
    deliveryId: concurrentFirst.side_effects.delivery_ids[0],
  });
  await firstSenderReachedGate;
  const blockedConcurrentDelivery = await secondConcurrentWorker.deliver({
    deliveryId: concurrentSecond.side_effects.delivery_ids[0],
  });
  assert.equal(blockedConcurrentDelivery, null);
  assert.equal(secondSenderCalls, 0);
  releaseFirstSend();
  const firstConcurrentResult = await firstConcurrentDelivery;
  assert.equal(firstConcurrentResult.status, 'SENT');
});
