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
  appendTicketEvent,
  applyTicketStateActionMigration,
} from '../src/p1-006-ticket-state-actions.mjs';
import {
  applyNotificationOutboxMigration,
  createNotificationDeliveryWorker,
  createNotificationOutbox,
} from '../src/p1-007-notification-outbox.mjs';
import { createFirstAcknowledgementService } from '../src/p1-008-first-acknowledgement.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const messageIds = new Set();
const intakeIds = new Set();
const ticketIds = new Set();
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 2_000 })
  : null;

function normalizedMessage(msgId, text) {
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-008-test',
      chattype: 'group',
      chatid: `group-${msgId}`,
      from: { userid: `reporter-${msgId}` },
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

function makeAcknowledgement({ sender, clock = () => new Date() }) {
  const outbox = createNotificationOutbox({
    targetsForEvent: () => [{ channel: 'WECOM_DIRECT', targetKey: 'reporter-p1-008' }],
  });
  const ticketProcessor = createPilotTicketProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
    onTicketCreated: async ({ transaction, ticket, message }) => {
      const event = await appendTicketEvent({
        transaction,
        ticket,
        eventType: 'ticket.created',
        actor: { type: 'SYSTEM', id: null },
        traceId: `created:${message.idempotency_key}`,
      });
      return outbox.enqueueTicketEvent({ transaction, ticket, event });
    },
  });
  const rawInbox = createChannelMessageInbox({ pool });
  let commitObserved = false;
  const inbox = {
    accept: async (...args) => {
      const result = await rawInbox.accept(...args);
      commitObserved = true;
      return result;
    },
  };
  const deliveryWorker = createNotificationDeliveryWorker({
    pool,
    sender: async (payload) => sender({ ...payload, commitObserved }),
    now: clock,
    retryBaseMs: 20,
  });
  return createFirstAcknowledgementService({
    inbox,
    processor: ticketProcessor,
    deliveryWorker,
    now: clock,
  });
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

integrationTest('first acknowledgement is sent only after commit and a reconnect replay does not create or send twice', async () => {
  const deliveries = [];
  const acknowledgement = makeAcknowledgement({
    sender: async ({ commitObserved, ...payload }) => {
      assert.equal(commitObserved, true);
      deliveries.push(payload.idempotencyKey);
      return { ok: true, providerMessageId: 'provider-first-ack' };
    },
  });
  const message = normalizedMessage(`p1-008-success-${randomUUID()}`, 'HIS 登录失败');

  const first = await acknowledgement.accept(request(message));
  intakeIds.add(first.result.intake.id);
  ticketIds.add(first.result.ticket.id);
  const replay = await acknowledgement.accept(request(message));

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.acknowledgement.state, 'SENT');
  assert.equal(first.reply.template_code, 'TICKET_CREATED');
  assert.equal(first.reply.ticket_no, first.result.ticket.ticket_no);
  assert.equal(first.reply.external_status, '等待受理');
  assert.equal(first.metrics.first_ack_delivery_latency_ms >= 0, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.acknowledgement.state, 'ALREADY_DELIVERED');
  assert.equal(deliveries.length, 1);
});

integrationTest('temporary delivery failure preserves a real Ticket for retry, while a non-report never fabricates a Ticket number', async () => {
  let clockValue = Date.now() + 1_000;
  let attempts = 0;
  const acknowledgement = makeAcknowledgement({
    clock: () => new Date(clockValue),
    sender: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('synthetic reconnect');
        error.code = 'WECOM_DISCONNECTED';
        throw error;
      }
      return { ok: true, providerMessageId: 'provider-retry-ack' };
    },
  });
  const report = normalizedMessage(`p1-008-retry-${randomUUID()}`, 'HIS 登录失败');

  const first = await acknowledgement.accept(request(report));
  intakeIds.add(first.result.intake.id);
  ticketIds.add(first.result.ticket.id);
  assert.equal(first.acknowledgement.state, 'PENDING');
  assert.deepEqual(first.reply, {
    template_code: 'TICKET_CREATED_DELIVERY_PENDING',
    ticket_no: first.result.ticket.ticket_no,
    external_status: '等待受理',
    temporary: true,
  });
  assert.equal(first.result.ticket.status, 'QUEUED');
  assert.equal(JSON.stringify(first.acknowledgement).includes('处理中'), false);

  clockValue += 100;
  const replay = await acknowledgement.accept(request(report));
  assert.equal(replay.duplicate, true);
  assert.equal(replay.acknowledgement.state, 'SENT');
  assert.equal(attempts, 2);

  const question = normalizedMessage(`p1-008-question-${randomUUID()}`, '谢谢');
  const noTicket = await acknowledgement.accept(request(question));
  intakeIds.add(noTicket.result.intake.id);
  assert.equal(noTicket.result.ticket, null);
  assert.equal(noTicket.reply, null);
  assert.equal(noTicket.acknowledgement.state, 'NO_TICKET');
});
