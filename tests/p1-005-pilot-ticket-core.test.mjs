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

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const messageIds = new Set();
const intakeIds = new Set();
const ticketIds = new Set();
const pool = databaseUrl
  ? createPostgresPool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 2_000 })
  : null;

function normalizedIncidentMessage(msgId, receivedAt = new Date().toISOString()) {
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-005-test',
      chattype: 'group',
      chatid: `group-${msgId}`,
      from: { userid: `reporter-${msgId}` },
      msgtype: 'text',
      text: { content: 'HIS 登录失败，提示权限错误' },
    },
  }, { receivedAt });
  assert.equal(adapted.ok, true);
  messageIds.add(msgId);
  return adapted.message;
}

function inboxRequest(message) {
  const retentionUntilEpochMs = String(BigInt(message.received_epoch_ms) + 86_400_000n);
  return {
    message,
    traceId: `trace-${message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: formatEpochMsToShanghaiLocal(retentionUntilEpochMs),
    retentionUntilEpochMs,
  };
}

async function acceptWithTicket(message) {
  const ticketCore = createPilotTicketCore({ pool });
  const processor = createPilotTicketProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore,
  });
  const response = await createChannelMessageInbox({ pool }).accept(inboxRequest(message), processor);
  if (response.ok && response.result?.intake?.id) {
    intakeIds.add(response.result.intake.id);
  }
  if (response.ok && response.result?.ticket?.id) {
    ticketIds.add(response.result.ticket.id);
  }
  return response;
}

before(async () => {
  if (!pool) {
    return;
  }
  await applyChannelMessageInboxMigration({ pool });
  await applyServiceIntakeMigration({ pool });
  await applyPilotTicketCoreMigration({ pool });
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

integrationTest('an explicit report creates one idempotent Pilot Ticket without AI or Hospital Tickets', async () => {
  const message = normalizedIncidentMessage(`p1-005-create-${randomUUID()}`);

  const first = await acceptWithTicket(message);
  const replay = await acceptWithTicket(message);

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.result.intake.ticket_id, first.result.ticket.id);
  assert.equal(first.result.ticket.status, 'QUEUED');
  assert.equal(first.result.ticket.external_status, '等待受理');
  assert.match(first.result.ticket.ticket_no, /^IT-[0-9]{8}-[0-9]{4,}$/u);
  assert.equal(first.result.ticket.resolver_team_id, 'PILOT_IT');
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.result, first.result);

  const persisted = await pool.query(
    `SELECT ticket.id::text AS ticket_id,
            ticket.source_intake_id::text AS source_intake_id,
            intake.pilot_ticket_id::text AS pilot_ticket_id,
            intake.status AS intake_status,
            count(event.event_id)::integer AS intake_event_count
       FROM pilot_ticket.ticket AS ticket
       JOIN intake.service_intake AS intake ON intake.id = ticket.source_intake_id
       JOIN intake.service_intake_event AS event ON event.intake_id = intake.id
      WHERE ticket.id = $1::uuid
      GROUP BY ticket.id, intake.id`,
    [first.result.ticket.id],
  );
  assert.deepEqual(persisted.rows, [{
    ticket_id: first.result.ticket.id,
    source_intake_id: first.result.intake.id,
    pilot_ticket_id: first.result.ticket.id,
    intake_status: 'TICKET_CREATED',
    intake_event_count: 2,
  }]);
});

integrationTest('a downstream failure rolls back the Intake-to-Ticket relationship before retry', async () => {
  const message = normalizedIncidentMessage(`p1-005-rollback-${randomUUID()}`);
  const ticketCore = createPilotTicketCore({ pool });
  const processor = createPilotTicketProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore,
  });
  const inbox = createChannelMessageInbox({ pool });

  const failed = await inbox.accept(inboxRequest(message), async (input) => {
    await processor(input);
    throw new Error('synthetic failure after ticket creation');
  });

  assert.deepEqual(failed, {
    ok: false,
    error: { code: 'CHANNEL_INBOX_PROCESSING_FAILED', retryable: true },
  });
  const rolledBack = await pool.query(
    `SELECT count(*)::integer AS count
       FROM pilot_ticket.ticket
      WHERE source_intake_id IN (
        SELECT id FROM intake.service_intake WHERE reporter_wecom_userid = $1
      )`,
    [message.sender_user_id],
  );
  assert.deepEqual(rolledBack.rows, [{ count: 0 }]);

  const retried = await acceptWithTicket(message);
  assert.equal(retried.ok, true);
  assert.equal(retried.duplicate, false);
  assert.ok(retried.result.ticket.id);
});

integrationTest('a Ticket number collision fails explicitly and leaves the second Intake unlinked', async () => {
  const first = await acceptWithTicket(normalizedIncidentMessage(`p1-005-number-first-${randomUUID()}`));
  const secondMessage = normalizedIncidentMessage(`p1-005-number-second-${randomUUID()}`);
  const second = await createChannelMessageInbox({ pool }).accept(
    inboxRequest(secondMessage),
    createServiceIntakeProcessor(),
  );
  assert.equal(second.ok, true);
  intakeIds.add(second.result.intake.id);
  const sequence = await pool.query(
    'SELECT last_value::bigint AS value FROM pilot_ticket.ticket_number_seq',
  );
  const sequenceValue = BigInt(sequence.rows[0].value);
  await pool.query(
    `SELECT setval(
        'pilot_ticket.ticket_number_seq',
        $1::bigint,
        FALSE
     )`,
    [sequenceValue],
  );
  try {
    const core = createPilotTicketCore({ pool });
    await assert.rejects(
      () => core.createForIntake({
        intakeId: second.result.intake.id,
        occurredAt: secondMessage.received_at,
        traceId: 'trace-p1-005-number-collision',
      }),
      (error) => {
        assert.equal(error.code, 'PILOT_TICKET_NUMBER_CONFLICT');
        return true;
      },
    );
  } finally {
    await pool.query(
      `SELECT setval(
          'pilot_ticket.ticket_number_seq',
          $1::bigint,
          TRUE
       )`,
      [sequenceValue],
    );
  }
  const restoredSequence = await pool.query(
    'SELECT last_value::bigint AS value, is_called FROM pilot_ticket.ticket_number_seq',
  );
  assert.equal(BigInt(restoredSequence.rows[0].value), sequenceValue);
  assert.equal(restoredSequence.rows[0].is_called, true);
  const unlinked = await pool.query(
    `SELECT pilot_ticket_id, status
       FROM intake.service_intake
      WHERE id = $1::uuid`,
    [second.result.intake.id],
  );
  assert.deepEqual(unlinked.rows, [{ pilot_ticket_id: null, status: 'RECEIVED' }]);
  assert.ok(first.result.ticket.id);
});

integrationTest('the database rejects a Ticket when its source Intake does not point back to it', async () => {
  const message = normalizedIncidentMessage(`p1-005-pair-${randomUUID()}`);
  const accepted = await createChannelMessageInbox({ pool }).accept(
    inboxRequest(message),
    createServiceIntakeProcessor(),
  );
  assert.equal(accepted.ok, true);
  intakeIds.add(accepted.result.intake.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sequence = await client.query(
      "SELECT nextval('pilot_ticket.ticket_number_seq')::text AS value",
    );
    await client.query(
      `INSERT INTO pilot_ticket.ticket (
          ticket_no, source_intake_id, title, request_type, status, priority, resolver_team_id
       ) VALUES ($1, $2::uuid, '不完整关联测试', 'INCIDENT', 'QUEUED', 'NORMAL', 'PILOT_IT')`,
      [`IT-20990101-${sequence.rows[0].value.padStart(4, '0')}`, accepted.result.intake.id],
    );
    await assert.rejects(
      () => client.query('COMMIT'),
      (error) => {
        assert.equal(error.code, '23514');
        assert.match(error.message, /P1_005_TICKET_INTAKE_PAIR_MISMATCH/u);
        return true;
      },
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const unchanged = await pool.query(
    'SELECT pilot_ticket_id, status FROM intake.service_intake WHERE id = $1::uuid',
    [accepted.result.intake.id],
  );
  assert.deepEqual(unchanged.rows, [{ pilot_ticket_id: null, status: 'RECEIVED' }]);
});
