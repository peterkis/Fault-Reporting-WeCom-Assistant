import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before } from 'node:test';
import test from 'node:test';
import { Pool } from 'pg';
import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration, createServiceIntakeProcessor } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration, createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { applyTicketStateActionMigration } from '../src/p1-006-ticket-state-actions.mjs';
import { applyNotificationOutboxMigration, createNotificationDeliveryWorker, createNotificationOutbox } from '../src/p1-007-notification-outbox.mjs';
import { applyPilotAccessMigration } from '../src/p1-009-pilot-access-workbench.mjs';
import { applyTicketClosureMigration, createTicketClosureService } from '../src/p1-010-ticket-closure.mjs';
import { applyPilotOperationsMigration, createPilotOperationalIntake } from '../src/p1-011-pilot-operations-baseline.mjs';
import { createPilotE2EHandler } from '../src/p1-012-pilot-e2e.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000 })
  : null;

function textFrame({ testGroupId, triggerToken, msgId, sender }) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'p1-012-e2e-bot',
      chattype: 'group',
      chatid: testGroupId,
      from: { userid: sender },
      msgtype: 'text',
      text: { content: `${triggerToken} HIS 登录失败，请报修` },
    },
  };
}

function imageFrame({ testGroupId, msgId, sender }) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'p1-012-e2e-bot',
      chattype: 'group',
      chatid: testGroupId,
      from: { userid: sender },
      msgtype: 'image',
      image: {
        url: 'https://example.test/p1-012-image',
        aeskey: 'p1-012-e2e-aes-key',
      },
    },
  };
}

async function cleanup({ messageIds, intakeIds, ticketIds }) {
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
}

before(async () => {
  if (!pool) return;
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
  await applyTicketStateActionMigration({ pool });
  await applyNotificationOutboxMigration({ pool });
  await applyPilotAccessMigration({ pool });
  await applyTicketClosureMigration({ pool });
  await applyPilotOperationsMigration({ pool });
});

after(async () => {
  if (pool) await pool.end();
});

integrationTest('P1-012 exercises the real Pilot core under duplicate, image, burst, Outbox failure, and AI-off conditions', async () => {
  const testGroupId = `p1-012-group-${randomUUID()}`;
  const triggerToken = `p1-012-${randomUUID()}`;
  const testAccountUserIds = Array.from(
    { length: 103 },
    (_, index) => `p1-012-test-account-${index}-${randomUUID()}`,
  );
  const duplicateSender = testAccountUserIds[0];
  const imageSender = testAccountUserIds[1];
  const burstSenders = testAccountUserIds.slice(2, 102);
  const failureSender = testAccountUserIds[102];
  const messageIds = new Set();
  const intakeIds = new Set();
  const ticketIds = new Set();
  const deliveryIds = [];
  const safeLogs = [];
  const replies = [];
  let senderMode = 'success';
  let clock = Date.now() + 1_000;

  const outbox = createNotificationOutbox();
  const closure = createTicketClosureService({
    pool,
    outbox,
    resolveReporterActor: async () => null,
  });
  const deliveryWorker = createNotificationDeliveryWorker({
    pool,
    now: () => new Date(clock),
    retryBaseMs: 1,
    sender: async () => {
      if (senderMode === 'failure') {
        const error = new Error('P1-012 sender failure');
        error.code = 'WECOM_SEND_FAILED';
        throw error;
      }
      return { ok: true, providerMessageId: null };
    },
  });
  const operationalIntake = createPilotOperationalIntake({
    pool,
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
    closure,
    coreChecks: {
      postgres: async () => ({ ok: true }),
      intake: async () => ({ ok: true }),
      outbox: async () => ({ ok: true }),
    },
    identityHashKey: 'p1-012-integration-log-hash-key',
    writeLogRecord: async (record) => { safeLogs.push(record); },
  });
  const accept = async (request) => {
    const accepted = await operationalIntake.accept(request);
    if (accepted.ok) {
      messageIds.add(request.message.msg_id);
      intakeIds.add(accepted.result.intake.id);
      if (accepted.result.ticket) ticketIds.add(accepted.result.ticket.id);
      for (const deliveryId of accepted.result.lifecycle?.delivery_ids ?? []) {
        deliveryIds.push(deliveryId);
      }
    }
    return accepted;
  };
  const handler = createPilotE2EHandler({
    testGroupId,
    testAccountUserIds,
    triggerToken,
    accept,
    reply: async (_frame, body) => {
      replies.push(body);
      return { errcode: 0 };
    },
    deliver: deliveryWorker.deliver,
  });
  const imageHandler = createPilotE2EHandler({
    testGroupId,
    testAccountUserIds,
    triggerToken,
    scenario: 'GROUP_IMAGE_DEGRADED',
    accept,
    reply: async (_frame, body) => {
      replies.push(body);
      return { errcode: 0 };
    },
    deliver: deliveryWorker.deliver,
  });

  try {
    const duplicateMessageId = `p1-012-duplicate-${randomUUID()}`;
    const duplicateFrame = textFrame({
      testGroupId,
      triggerToken,
      msgId: duplicateMessageId,
      sender: duplicateSender,
    });
    const [first, replay] = await Promise.all([
      handler.handleFrame(duplicateFrame),
      handler.handleFrame(duplicateFrame),
    ]);
    assert.equal(first.core.accepted, true);
    assert.equal(replay.core.accepted, true);
    assert.equal(ticketIds.size, 1);

    const imageResult = await imageHandler.handleFrame(imageFrame({
      testGroupId,
      msgId: `p1-012-image-${randomUUID()}`,
      sender: imageSender,
    }));
    assert.deepEqual(imageResult.core, {
      accepted: true,
      ticket_created: false,
      intake_status: 'WAITING_DESCRIPTION',
      within_target: true,
    });

    const burstStartedAt = Date.now();
    const burst = await Promise.all([...Array(100)].map((_, index) => handler.handleFrame(textFrame({
      testGroupId,
      triggerToken,
      msgId: `p1-012-burst-${index}-${randomUUID()}`,
      sender: burstSenders[index],
    }))));
    const burstElapsedMs = Date.now() - burstStartedAt;
    assert.equal(burst.every((result) => result.core.accepted && result.core.ticket_created), true);
    assert.equal(burst.every((result) => result.core.within_target && result.passive_reply.within_target), true);
    assert.equal(burst.every((result) => result.delivery.status === 'SENT'), true);
    assert.ok(burstElapsedMs <= 10_000, `100-message burst took ${burstElapsedMs}ms`);
    assert.equal(ticketIds.size, 101);

    clock = Date.now() + 60_000;
    senderMode = 'failure';
    const failedDelivery = await handler.handleFrame(textFrame({
      testGroupId,
      triggerToken,
      msgId: `p1-012-outbox-failure-${randomUUID()}`,
      sender: failureSender,
    }));
    assert.equal(failedDelivery.core.accepted, true);
    assert.deepEqual(failedDelivery.delivery, { attempted: true, status: 'PENDING' });
    const failedDeliveryId = deliveryIds.at(-2);
    assert.match(failedDeliveryId, /^[0-9a-f-]{36}$/u);
    const retryAttempt = await pool.query(
      `SELECT outcome, error_code
         FROM notification.delivery_attempt
        WHERE delivery_id = $1::uuid
        ORDER BY attempt_no DESC
        LIMIT 1`,
      [failedDeliveryId],
    );
    assert.deepEqual(retryAttempt.rows, [{ outcome: 'RETRY_SCHEDULED', error_code: 'WECOM_SEND_FAILED' }]);
    clock += 2;
    senderMode = 'success';
    assert.equal((await deliveryWorker.deliver({ deliveryId: failedDeliveryId })).status, 'SENT');

    assert.equal(ticketIds.size, 102);
    const persisted = await pool.query(
      'SELECT count(*)::integer AS count FROM pilot_ticket.ticket WHERE id = ANY($1::uuid[])',
      [[...ticketIds]],
    );
    assert.equal(persisted.rows[0].count, 102);
    const serialized = JSON.stringify({ safeLogs, replies });
    assert.equal(serialized.includes(triggerToken), false);
    assert.equal(serialized.includes(testGroupId), false);
  } finally {
    await cleanup({ messageIds, intakeIds, ticketIds });
  }
});
