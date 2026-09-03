import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { shanghaiLocalToEpochMs } from '../src/platform/time-contract.mjs';
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

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const messageIds = new Set();
const intakeIds = new Set();
const ticketIds = new Set();
const pool = databaseUrl
  ? createPostgresPool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 2_000 })
  : null;

function messageFor(msgId) {
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-006-test',
      chattype: 'group',
      chatid: `group-${msgId}`,
      from: { userid: `reporter-${msgId}` },
      msgtype: 'text',
      text: { content: 'HIS 登录失败，提示权限错误' },
    },
  }, { receivedAt: '2026-08-29 09:00:00' });
  assert.equal(adapted.ok, true);
  messageIds.add(msgId);
  return adapted.message;
}

async function seedTicket() {
  const message = messageFor(`p1-006-${randomUUID()}`);
  const ticketCore = createPilotTicketCore({ pool });
  const processor = createPilotTicketProcessor({
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore,
  });
  const result = await createChannelMessageInbox({ pool }).accept({
    message,
    traceId: `trace-${message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: '2026-09-05 09:00:00',
    retentionUntilEpochMs: shanghaiLocalToEpochMs('2026-09-05 09:00:00'),
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

integrationTest('explicit Ticket Actions enforce legal transitions, versions, and an ordered audit timeline', async () => {
  const ticket = await seedTicket();
  const actions = createTicketActionService({ pool });
  const handlerId = randomUUID();

  const invalid = await actions.perform({
    ticketId: ticket.id,
    action: 'confirm',
    actor: { type: 'PILOT_USER', id: handlerId },
    expectedVersion: ticket.version,
    traceId: 'trace-p1-006-invalid',
  });
  assert.deepEqual(invalid, {
    ok: false,
    error: { code: 'INVALID_STATE_TRANSITION', retryable: false },
  });

  const accepted = await actions.perform({
    ticketId: ticket.id,
    action: 'accept',
    actor: { type: 'PILOT_USER', id: handlerId },
    expectedVersion: ticket.version,
    note: '已受理，开始排查',
    externalVisible: true,
    traceId: 'trace-p1-006-accept',
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.ticket.status, 'ACCEPTED');
  assert.equal(accepted.ticket.version, 2);
  assert.equal(accepted.event.event_type, 'ticket.accepted');
  assert.equal(accepted.event.external_note, '已受理，开始排查');

  const stale = await actions.perform({
    ticketId: ticket.id,
    action: 'start',
    actor: { type: 'PILOT_USER', id: handlerId },
    expectedVersion: ticket.version,
    traceId: 'trace-p1-006-stale',
  });
  assert.deepEqual(stale, {
    ok: false,
    error: { code: 'TICKET_VERSION_CONFLICT', retryable: false },
  });

  const started = await actions.perform({
    ticketId: ticket.id,
    action: 'start',
    actor: { type: 'PILOT_USER', id: handlerId },
    expectedVersion: accepted.ticket.version,
    traceId: 'trace-p1-006-start',
  });
  const requested = await actions.perform({
    ticketId: ticket.id,
    action: 'request-information',
    actor: { type: 'PILOT_USER', id: handlerId },
    expectedVersion: started.ticket.version,
    note: '请补充终端编号',
    externalVisible: true,
    traceId: 'trace-p1-006-request',
  });
  const resumed = await actions.perform({
    ticketId: ticket.id,
    action: 'resume',
    actor: { type: 'PILOT_USER', id: handlerId },
    expectedVersion: requested.ticket.version,
    traceId: 'trace-p1-006-resume',
  });
  const resolved = await actions.perform({
    ticketId: ticket.id,
    action: 'resolve',
    actor: { type: 'PILOT_USER', id: handlerId },
    expectedVersion: resumed.ticket.version,
    note: '已重新同步账号权限',
    externalVisible: true,
    reasonCode: 'PERMISSION_RESYNC',
    traceId: 'trace-p1-006-resolve',
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.ticket.status, 'RESOLVED');
  assert.equal(resolved.ticket.external_status, '已处理，待确认');
  assert.equal(resolved.event.event_type, 'ticket.resolved');

  const events = await pool.query(
    `SELECT event_type, old_status, new_status, event_ordinal
       FROM pilot_ticket.ticket_event
      WHERE ticket_id = $1::uuid
      ORDER BY event_ordinal`,
    [ticket.id],
  );
  assert.deepEqual(events.rows, [
    { event_type: 'ticket.accepted', old_status: 'QUEUED', new_status: 'ACCEPTED', event_ordinal: 1 },
    { event_type: 'ticket.started', old_status: 'ACCEPTED', new_status: 'IN_PROGRESS', event_ordinal: 2 },
    { event_type: 'ticket.waiting_requester', old_status: 'IN_PROGRESS', new_status: 'WAITING_REQUESTER', event_ordinal: 3 },
    { event_type: 'ticket.resumed', old_status: 'WAITING_REQUESTER', new_status: 'IN_PROGRESS', event_ordinal: 4 },
    { event_type: 'ticket.resolved', old_status: 'IN_PROGRESS', new_status: 'RESOLVED', event_ordinal: 5 },
  ]);
});

integrationTest('concurrent handlers cannot both accept the same queued Ticket', async () => {
  const ticket = await seedTicket();
  const actions = createTicketActionService({ pool });
  const results = await Promise.all([
    actions.perform({
      ticketId: ticket.id,
      action: 'accept',
      actor: { type: 'PILOT_USER', id: randomUUID() },
      expectedVersion: ticket.version,
      traceId: 'trace-p1-006-concurrent-a',
    }),
    actions.perform({
      ticketId: ticket.id,
      action: 'accept',
      actor: { type: 'PILOT_USER', id: randomUUID() },
      expectedVersion: ticket.version,
      traceId: 'trace-p1-006-concurrent-b',
    }),
  ]);

  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(
    results.filter((result) => !result.ok).map((result) => result.error.code),
    ['TICKET_VERSION_CONFLICT'],
  );
});

integrationTest('Phase 1 rejects an Incident-link action until the Phase 2 Incident fact exists', async () => {
  const ticket = await seedTicket();
  const actions = createTicketActionService({ pool });
  const actor = { type: 'PILOT_USER', id: randomUUID() };

  const linked = await actions.perform({
    ticketId: ticket.id,
    action: 'link-incident',
    actor,
    expectedVersion: ticket.version,
    traceId: 'trace-p1-006-link-incident',
  });
  assert.deepEqual(linked, {
    ok: false,
    error: { code: 'INVALID_STATE_TRANSITION', retryable: false },
  });
  const ticketFact = await pool.query(
    'SELECT status, version FROM pilot_ticket.ticket WHERE id = $1::uuid',
    [ticket.id],
  );
  assert.deepEqual(ticketFact.rows, [{ status: 'QUEUED', version: 1 }]);
});
