import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPilotE2EHandler,
  evaluatePilotGoNoGo,
} from '../src/p1-012-pilot-e2e.mjs';

const TEST_GROUP_ID = 'p1-012-test-group';
const TEST_ACCOUNT_USER_ID = 'p1-012-tester';
const TRIGGER_TOKEN = 'p1-012-trigger';

function textFrame({
  chatId = TEST_GROUP_ID,
  content = `${TRIGGER_TOKEN} HIS 登录失败`,
  msgId = 'p1-012-text-message',
  sender = TEST_ACCOUNT_USER_ID,
} = {}) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'p1-012-bot',
      chattype: 'group',
      chatid: chatId,
      from: { userid: sender },
      msgtype: 'text',
      text: { content },
    },
  };
}

function imageFrame({
  chatId = TEST_GROUP_ID,
  msgId = 'p1-012-image-message',
  sender = TEST_ACCOUNT_USER_ID,
} = {}) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'p1-012-bot',
      chattype: 'group',
      chatid: chatId,
      from: { userid: sender },
      msgtype: 'image',
      image: {
        url: 'https://example.test/p1-012-image',
        aeskey: 'p1-012-test-aes-key',
      },
    },
  };
}

test('P1-012 handles a scoped group text frame through Intake then a safe reply and Delivery', async () => {
  const acceptedRequests = [];
  const replies = [];
  const deliveredIds = [];
  const handler = createPilotE2EHandler({
    testGroupId: TEST_GROUP_ID,
    testAccountUserIds: [TEST_ACCOUNT_USER_ID],
    triggerToken: TRIGGER_TOKEN,
    accept: async (request) => {
      acceptedRequests.push(request);
      return {
        ok: true,
        result: {
          intake: { status: 'TICKET_CREATED' },
          ticket: { ticket_no: 'PILOT-20260829-0001' },
          lifecycle: { delivery_ids: ['delivery-p1-012'] },
        },
      };
    },
    reply: async (frame, body) => {
      replies.push({ frame, body });
      return { errcode: 0 };
    },
    deliver: async ({ deliveryId }) => {
      deliveredIds.push(deliveryId);
      return { status: 'SENT' };
    },
  });

  const result = await handler.handleFrame(textFrame());

  assert.deepEqual(result, {
    outcome: 'processed',
    scenario: 'GROUP_TEXT',
    core: {
      accepted: true,
      ticket_created: true,
      intake_status: 'TICKET_CREATED',
      within_target: true,
    },
    passive_reply: { attempted: true, acknowledged: true, within_target: true },
    delivery: { attempted: true, status: 'SENT' },
  });
  assert.equal(acceptedRequests.length, 1);
  assert.equal(acceptedRequests[0].privacyClass, 'PATIENT_SENSITIVE');
  assert.match(acceptedRequests[0].traceId, /^p1-012:[a-f0-9]{24}$/u);
  assert.equal(acceptedRequests[0].message.msg_id, 'p1-012-text-message');
  assert.deepEqual(deliveredIds, ['delivery-p1-012']);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].body.msgtype, 'text');
  assert.match(replies[0].body.text.content, /PILOT-20260829-0001/u);
  const serialized = JSON.stringify(result);
  for (const value of [TEST_GROUP_ID, TRIGGER_TOKEN, 'HIS 登录失败', 'p1-012-tester', 'PILOT-20260829-0001']) {
    assert.equal(serialized.includes(value), false);
  }
});

test('P1-012 records an image-degraded Intake without fabricating a Ticket', async () => {
  const replies = [];
  const handler = createPilotE2EHandler({
    testGroupId: TEST_GROUP_ID,
    testAccountUserIds: [TEST_ACCOUNT_USER_ID],
    triggerToken: TRIGGER_TOKEN,
    scenario: 'GROUP_IMAGE_DEGRADED',
    accept: async () => ({
      ok: true,
      result: {
        intake: { status: 'WAITING_DESCRIPTION' },
        ticket: null,
        lifecycle: { delivery_ids: [] },
      },
    }),
    reply: async (_frame, body) => {
      replies.push(body);
      return { errcode: 0 };
    },
  });

  const result = await handler.handleFrame(imageFrame());

  assert.deepEqual(result, {
    outcome: 'processed',
    scenario: 'GROUP_IMAGE_DEGRADED',
    core: {
      accepted: true,
      ticket_created: false,
      intake_status: 'WAITING_DESCRIPTION',
      within_target: true,
    },
    passive_reply: { attempted: true, acknowledged: true, within_target: true },
    delivery: { attempted: false, status: 'NOT_APPLICABLE' },
  });
  assert.equal(replies.length, 1);
  assert.match(replies[0].text.content, /补充/u);
  assert.equal(JSON.stringify(result).includes('p1-012-image-message'), false);
});

test('P1-012 ignores an unscoped group frame without calling any operational seam', async () => {
  let accepts = 0;
  let replies = 0;
  const handler = createPilotE2EHandler({
    testGroupId: TEST_GROUP_ID,
    testAccountUserIds: [TEST_ACCOUNT_USER_ID],
    triggerToken: TRIGGER_TOKEN,
    accept: async () => { accepts += 1; return { ok: true, result: {} }; },
    reply: async () => { replies += 1; return { errcode: 0 }; },
  });

  assert.deepEqual(await handler.handleFrame(textFrame({ chatId: 'other-test-group' })), {
    outcome: 'ignored',
    reason: 'TEST_GROUP_MISMATCH',
  });
  assert.deepEqual(await handler.handleFrame(textFrame({ content: 'ordinary group text', msgId: 'p1-012-no-token' })), {
    outcome: 'ignored',
    reason: 'TRIGGER_TOKEN_MISMATCH',
  });
  assert.deepEqual(await handler.handleFrame(textFrame({ sender: 'p1-012-non-test-member', msgId: 'p1-012-non-test-member' })), {
    outcome: 'ignored',
    reason: 'TEST_ACCOUNT_MISMATCH',
  });
  assert.equal(accepts, 0);
  assert.equal(replies, 0);
});

test('P1-012 keeps a transient core failure safe and retryable without leaking the failure text', async () => {
  const handler = createPilotE2EHandler({
    testGroupId: TEST_GROUP_ID,
    testAccountUserIds: [TEST_ACCOUNT_USER_ID],
    triggerToken: TRIGGER_TOKEN,
    accept: async () => ({
      ok: false,
      error: {
        code: 'CHANNEL_INBOX_UNAVAILABLE',
        retryable: true,
        reason: 'postgres password=must-not-appear',
      },
    }),
    reply: async () => ({ errcode: 0 }),
  });

  const result = await handler.handleFrame(textFrame());

  assert.deepEqual(result, {
    outcome: 'processed',
    scenario: 'GROUP_TEXT',
    core: {
      accepted: false,
      error_code: 'CHANNEL_INBOX_UNAVAILABLE',
      retryable: true,
      within_target: true,
    },
    passive_reply: { attempted: true, acknowledged: true, within_target: true },
    delivery: { attempted: false, status: 'NOT_APPLICABLE' },
  });
  assert.equal(JSON.stringify(result).includes('password=must-not-appear'), false);
});

test('P1-012 keeps a thrown database fault out of the client reply and safe evidence', async () => {
  const handler = createPilotE2EHandler({
    testGroupId: TEST_GROUP_ID,
    testAccountUserIds: [TEST_ACCOUNT_USER_ID],
    triggerToken: TRIGGER_TOKEN,
    accept: async () => {
      const error = new Error('postgres connection failed password=must-not-appear');
      error.code = 'ECONNREFUSED';
      throw error;
    },
    reply: async () => ({ errcode: 0 }),
  });

  const result = await handler.handleFrame(textFrame({ msgId: 'p1-012-database-failure' }));

  assert.deepEqual(result, {
    outcome: 'processed',
    scenario: 'GROUP_TEXT',
    core: {
      accepted: false,
      error_code: 'P1_012_CORE_OPERATION_FAILED',
      retryable: true,
      within_target: true,
    },
    passive_reply: { attempted: true, acknowledged: true, within_target: true },
    delivery: { attempted: false, status: 'NOT_APPLICABLE' },
  });
  assert.equal(JSON.stringify(result).includes('password=must-not-appear'), false);
});

test('P1-012 requires an explicit successful provider receipt for a passive reply', async () => {
  const handler = createPilotE2EHandler({
    testGroupId: TEST_GROUP_ID,
    testAccountUserIds: [TEST_ACCOUNT_USER_ID],
    triggerToken: TRIGGER_TOKEN,
    accept: async () => ({
      ok: true,
      result: {
        intake: { status: 'TICKET_CREATED' },
        ticket: { ticket_no: 'PILOT-20260829-0002' },
        lifecycle: { delivery_ids: [] },
      },
    }),
    reply: async () => undefined,
  });

  const result = await handler.handleFrame(textFrame({ msgId: 'p1-012-reply-receipt-missing' }));

  assert.deepEqual(result.passive_reply, {
    attempted: true,
    acknowledged: false,
    error_code: 'WECOM_REPLY_ACK_MISSING',
    within_target: true,
  });
});

test('P1-012 Go/No-Go requires real client observation but never a public IP for outbound WSS', () => {
  const ready = {
    wss_authenticated: true,
    test_group_configured: true,
    pilot_runtime_ready: true,
    text_round_trip: true,
    image_degraded: true,
    burst_100: true,
    reconnect: true,
    database_failure: true,
    outbox_failure: true,
    ai_disabled: true,
    no_lost_tickets: true,
    no_duplicate_tickets: true,
    all_within_target: true,
    statuses_and_events_consistent: true,
    notifications_traceable: true,
    client_observation: false,
    pilot_owner_approved: false,
  };

  assert.deepEqual(evaluatePilotGoNoGo(ready), {
    decision: 'NO_GO',
    blockers: ['CLIENT_OBSERVATION_PENDING', 'PILOT_OWNER_APPROVAL_PENDING'],
  });
  assert.deepEqual(evaluatePilotGoNoGo({ ...ready, client_observation: true }), {
    decision: 'NO_GO',
    blockers: ['PILOT_OWNER_APPROVAL_PENDING'],
  });
  assert.deepEqual(evaluatePilotGoNoGo({ ...ready, client_observation: true, pilot_owner_approved: true }), {
    decision: 'GO',
    blockers: [],
  });
});
