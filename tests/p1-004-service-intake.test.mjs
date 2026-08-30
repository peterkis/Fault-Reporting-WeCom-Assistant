import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  mapServiceIntakeMigrationFailure,
} from '../src/p1-004-service-intake.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const testMessageIds = new Set();
const testIntakeIds = new Set();
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000 })
  : null;

function normalizedMessage(msgId, {
  text = 'HIS 登录失败，提示权限错误',
  receivedAt = new Date().toISOString(),
  chatType = 'group',
  chatId = 'group-p1-004-test',
  senderUserId = 'user-p1-004-test',
} = {}) {
  const body = {
    msgid: msgId,
    aibotid: 'bot-p1-004-test',
    chattype: chatType,
    from: { userid: senderUserId },
    msgtype: 'text',
    text: { content: text },
  };
  if (chatType === 'group') {
    body.chatid = chatId;
  }
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body,
  }, { receivedAt });

  assert.equal(adapted.ok, true);
  testMessageIds.add(msgId);
  return adapted.message;
}

function normalizedImageMessage(msgId, {
  receivedAt = new Date().toISOString(),
  chatId = 'group-p1-004-test',
  senderUserId = 'user-p1-004-test',
} = {}) {
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: `req-${msgId}` },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-004-test',
      chattype: 'group',
      chatid: chatId,
      from: { userid: senderUserId },
      msgtype: 'image',
      image: {
        url: 'https://media.example.test/p1-004-image',
        aeskey: 'synthetic-aes-key-must-not-escape',
      },
    },
  }, { receivedAt });

  assert.equal(adapted.ok, true);
  testMessageIds.add(msgId);
  return adapted.message;
}

function inboxRequest(message, overrides = {}) {
  return {
    message,
    traceId: `trace-${message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: new Date(Date.parse(message.received_at) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    ...overrides,
  };
}

async function accept(message, requestOverrides = {}) {
  const inbox = createChannelMessageInbox({ pool });
  const processor = createServiceIntakeProcessor();
  const response = await inbox.accept(inboxRequest(message, requestOverrides), processor);
  if (response.ok && response.result?.intake?.id) {
    testIntakeIds.add(response.result.intake.id);
  }
  return response;
}

function assertEventIntakeIdentity(response) {
  for (const event of response.result.events) {
    assert.equal(event.aggregate_id, response.result.intake.id, event.event_type);
    assert.equal(event.payload.intake_id, response.result.intake.id, event.event_type);
  }
}

before(async () => {
  if (pool) {
    await applyChannelMessageInboxMigration({ pool });
    await applyServiceIntakeMigration({ pool });
  }
});

after(async () => {
  if (!pool) {
    return;
  }
  if (testIntakeIds.size > 0) {
    await pool.query(
      'DELETE FROM intake.service_intake WHERE id = ANY($1::uuid[])',
      [[...testIntakeIds]],
    );
  }
  if (testMessageIds.size > 0) {
    await pool.query(
      'DELETE FROM channel.message_inbox WHERE provider = $1 AND msg_id = ANY($2::text[])',
      ['WECOM_AIBOT', [...testMessageIds]],
    );
  }
  await pool.end();
});

integrationTest('creates one Service Intake, primary message relation and received audit event', async () => {
  const message = normalizedMessage(`p1-004-single-${randomUUID()}`);

  const response = await accept(message);

  assert.equal(response.ok, true);
  assert.equal(response.duplicate, false);
  assert.equal(response.result.aggregation.action, 'CREATED');
  assert.equal(response.result.aggregation.message_count, 1);
  assert.equal(response.result.message.relation_type, 'PRIMARY');
  assert.equal(response.result.message.sequence_no, 1);
  assert.equal(response.result.intake.source_channel, 'WECOM_GROUP');
  assert.equal(response.result.intake.reporter_wecom_userid, message.sender_user_id);
  assert.equal(response.result.intake.request_type, 'INCIDENT');
  assert.equal(response.result.intake.status, 'RECEIVED');
  assert.equal(response.result.intake.version, 1);
  assert.match(response.result.intake.intake_no, /^INT-[0-9]{8}-[0-9]{4,}$/u);
  assert.deepEqual(response.result.events.map((event) => event.event_type), ['intake.received']);
  assertEventIntakeIdentity(response);
  assert.equal(Object.hasOwn(response.result.intake, 'ticket_id'), true);
  assert.equal(response.result.intake.ticket_id, null);
  assert.equal(response.result.intake.incident_id, null);

  const persisted = await pool.query(
    `SELECT i.id::text AS intake_id,
            count(DISTINCT r.channel_message_id)::integer AS relation_count,
            count(DISTINCT e.event_id)::integer AS event_count
       FROM intake.service_intake AS i
       JOIN intake.service_intake_message AS r ON r.intake_id = i.id
       JOIN intake.service_intake_event AS e ON e.intake_id = i.id
      WHERE i.id = $1::uuid
      GROUP BY i.id`,
    [response.result.intake.id],
  );
  assert.deepEqual(persisted.rows, [{
    intake_id: response.result.intake.id,
    relation_count: 1,
    event_count: 1,
  }]);
});

integrationTest('aggregates multiple supplements into one Intake without creating a Ticket', async () => {
  const context = randomUUID();
  const baseTime = Date.parse('2026-08-28T02:00:00.000Z');
  const texts = [
    'HIS 打不开',
    '这是截图',
    '错误是 403',
    '三台电脑都这样',
  ];

  const responses = [];
  for (const [index, text] of texts.entries()) {
    responses.push(await accept(normalizedMessage(`p1-004-supplement-${context}-${index}`, {
      text,
      receivedAt: new Date(baseTime + index * 20_000).toISOString(),
      chatId: `group-${context}`,
      senderUserId: `user-${context}`,
    })));
  }

  assert.equal(responses.every((response) => response.ok), true);
  assert.deepEqual(
    responses.map((response) => response.result.aggregation.action),
    ['CREATED', 'APPENDED', 'APPENDED', 'APPENDED'],
  );
  assert.equal(new Set(responses.map((response) => response.result.intake.id)).size, 1);
  assert.deepEqual(
    responses.map((response) => response.result.aggregation.message_count),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    responses.map((response) => response.result.message.relation_type),
    ['PRIMARY', 'SUPPLEMENT', 'SUPPLEMENT', 'SUPPLEMENT'],
  );
  assert.deepEqual(
    responses.slice(1).map((response) => response.result.events[0].event_type),
    ['intake.message_added', 'intake.message_added', 'intake.message_added'],
  );
  responses.forEach(assertEventIntakeIdentity);
  assert.equal(responses.at(-1).result.intake.ticket_id, null);
  assert.equal(responses.at(-1).result.intake.incident_id, null);

  const persisted = await pool.query(
    `SELECT count(DISTINCT i.id)::integer AS intake_count,
            count(DISTINCT r.channel_message_id)::integer AS message_count,
            count(DISTINCT e.event_id)::integer AS event_count
       FROM intake.service_intake AS i
       JOIN intake.service_intake_message AS r ON r.intake_id = i.id
       JOIN intake.service_intake_event AS e ON e.intake_id = i.id
      WHERE i.id = $1::uuid`,
    [responses[0].result.intake.id],
  );
  assert.deepEqual(persisted.rows, [{
    intake_count: 1,
    message_count: 4,
    event_count: 4,
  }]);
});

integrationTest('explicit new-report intent starts a new Intake inside the 90-second window', async () => {
  const context = randomUUID();
  const baseTime = Date.parse('2026-08-28T03:00:00.000Z');
  const first = await accept(normalizedMessage(`p1-004-new-report-${context}-0`, {
    text: 'HIS 登录失败',
    receivedAt: new Date(baseTime).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }));
  const second = await accept(normalizedMessage(`p1-004-new-report-${context}-1`, {
    text: '新报修：护士站打印机打印不了',
    receivedAt: new Date(baseTime + 30_000).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.result.aggregation.action, 'CREATED');
  assert.equal(second.result.aggregation.action, 'CREATED');
  assert.notEqual(first.result.intake.id, second.result.intake.id);
  assert.equal(second.result.intake.request_type, 'INCIDENT');
  assert.equal(second.result.message.relation_type, 'PRIMARY');
  assert.equal(first.result.intake.ticket_id, null);
  assert.equal(second.result.intake.ticket_id, null);
});

integrationTest('an explicit reference to another ticket closes the current aggregation window', async () => {
  const context = randomUUID();
  const baseTime = Date.parse('2026-08-28T03:30:00.000Z');
  const first = await accept(normalizedMessage(`p1-004-other-ticket-${context}-0`, {
    text: 'HIS 登录失败',
    receivedAt: new Date(baseTime).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }));
  const referenced = await accept(normalizedMessage(`p1-004-other-ticket-${context}-1`, {
    text: '补充工单 IT-20260828-0042 的截图',
    receivedAt: new Date(baseTime + 20_000).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }));

  assert.equal(first.ok, true);
  assert.equal(referenced.ok, true);
  assert.equal(referenced.result.aggregation.action, 'CREATED');
  assert.notEqual(referenced.result.intake.id, first.result.intake.id);
  assert.equal(referenced.result.message.relation_type, 'PRIMARY');
});

integrationTest('pure image creates a waiting Intake and emits a clarification audit event', async () => {
  const context = randomUUID();
  const message = normalizedImageMessage(`p1-004-image-${context}`, {
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  });

  const response = await accept(message);

  assert.equal(response.ok, true);
  assert.equal(response.result.aggregation.action, 'CREATED');
  assert.equal(response.result.intake.request_type, 'UNKNOWN');
  assert.equal(response.result.intake.status, 'WAITING_DESCRIPTION');
  assert.equal(response.result.intake.summary, null);
  assert.equal(response.result.message.relation_type, 'PRIMARY');
  assert.deepEqual(
    response.result.events.map((event) => event.event_type),
    ['intake.received', 'intake.needs_clarification'],
  );
  assert.deepEqual(
    response.result.events.map((event) => event.event_ordinal),
    [1, 2],
  );
  assertEventIntakeIdentity(response);
  assert.equal(JSON.stringify(response).includes('media.example.test'), false);
  assert.equal(JSON.stringify(response).includes('synthetic-aes-key-must-not-escape'), false);
});

integrationTest('a description clarifies the waiting image Intake instead of creating another Intake', async () => {
  const context = randomUUID();
  const baseTime = Date.parse('2026-08-28T04:00:00.000Z');
  const image = await accept(normalizedImageMessage(`p1-004-clarify-${context}-0`, {
    receivedAt: new Date(baseTime).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }));
  const description = await accept(normalizedMessage(`p1-004-clarify-${context}-1`, {
    text: 'HIS 保存失败，提示权限错误',
    receivedAt: new Date(baseTime + 45_000).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }));

  assert.equal(image.ok, true);
  assert.equal(description.ok, true);
  assert.equal(description.result.aggregation.action, 'APPENDED');
  assert.equal(description.result.intake.id, image.result.intake.id);
  assert.equal(description.result.message.relation_type, 'CLARIFICATION');
  assert.equal(description.result.intake.request_type, 'INCIDENT');
  assert.equal(description.result.intake.status, 'RECEIVED');
  assert.equal(description.result.intake.summary, null);
  assert.equal(description.result.intake.version, 2);
  assert.deepEqual(
    description.result.events.map((event) => event.event_type),
    ['intake.clarification_added'],
  );
  assertEventIntakeIdentity(description);
  const stored = await pool.query(
    'SELECT summary FROM intake.service_intake WHERE id = $1::uuid',
    [description.result.intake.id],
  );
  assert.equal(stored.rows[0].summary, 'his 保存失败,提示权限错误');
});

integrationTest('concurrent distinct messages in one context aggregate into exactly one Intake', async () => {
  const context = randomUUID();
  const receivedAt = '2026-08-28T05:00:00.000Z';
  const messages = Array.from({ length: 12 }, (_, index) => normalizedMessage(
    `p1-004-concurrent-${context}-${index}`,
    {
      text: index === 0 ? 'HIS 登录失败' : `补充信息 ${index}`,
      receivedAt,
      chatId: `group-${context}`,
      senderUserId: `user-${context}`,
    },
  ));

  const responses = await Promise.all(messages.map((message) => accept(message)));

  assert.equal(responses.every((response) => response.ok), true);
  assert.equal(responses.filter((response) => response.result.aggregation.action === 'CREATED').length, 1);
  assert.equal(responses.filter((response) => response.result.aggregation.action === 'APPENDED').length, 11);
  assert.equal(new Set(responses.map((response) => response.result.intake.id)).size, 1);
  assert.deepEqual(
    [...responses.map((response) => response.result.intake.version)].sort((left, right) => left - right),
    Array.from({ length: 12 }, (_, index) => index + 1),
  );

  const intakeId = responses[0].result.intake.id;
  const persisted = await pool.query(
    `SELECT i.message_count,
            count(DISTINCT r.channel_message_id)::integer AS relation_count,
            count(DISTINCT e.event_id)::integer AS event_count
       FROM intake.service_intake AS i
       JOIN intake.service_intake_message AS r ON r.intake_id = i.id
       JOIN intake.service_intake_event AS e ON e.intake_id = i.id
      WHERE i.id = $1::uuid
      GROUP BY i.id`,
    [intakeId],
  );
  assert.deepEqual(persisted.rows, [{
    message_count: 12,
    relation_count: 12,
    event_count: 12,
  }]);
});

integrationTest('reversed lock acquisition still aggregates bounded timestamp inversion and preserves valid update time', async () => {
  const context = randomUUID();
  const baseTime = Date.parse('2026-08-28T05:30:00.000Z');
  const earlierMessage = normalizedMessage(`p1-004-reversed-${context}-0`, {
    text: 'HIS 登录失败',
    receivedAt: new Date(baseTime).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  });
  const laterMessage = normalizedMessage(`p1-004-reversed-${context}-1`, {
    text: '补充:错误是 403',
    receivedAt: new Date(baseTime + 30_000).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  });
  const inbox = createChannelMessageInbox({ pool });
  const processor = createServiceIntakeProcessor();
  let releaseEarlier;
  let markEarlierReached;
  const earlierGate = new Promise((resolve) => {
    releaseEarlier = resolve;
  });
  const earlierReached = new Promise((resolve) => {
    markEarlierReached = resolve;
  });

  const earlierPromise = inbox.accept(inboxRequest(earlierMessage), async (input) => {
    markEarlierReached();
    await earlierGate;
    return processor(input);
  });
  await earlierReached;
  const later = await accept(laterMessage);
  releaseEarlier();
  const earlier = await earlierPromise;
  if (earlier.ok && earlier.result?.intake?.id) {
    testIntakeIds.add(earlier.result.intake.id);
  }

  assert.equal(later.ok, true);
  assert.equal(later.result.aggregation.action, 'CREATED');
  assert.equal(earlier.ok, true);
  assert.equal(earlier.result.aggregation.action, 'APPENDED');
  assert.equal(earlier.result.intake.id, later.result.intake.id);
  const stored = await pool.query(
    `SELECT last_message_at, created_at, updated_at, message_count
       FROM intake.service_intake
      WHERE id = $1::uuid`,
    [later.result.intake.id],
  );
  assert.equal(stored.rows[0].last_message_at.toISOString(), laterMessage.received_at);
  assert.equal(stored.rows[0].updated_at >= stored.rows[0].created_at, true);
  assert.equal(stored.rows[0].message_count, 2);
});

integrationTest('reversed lock acquisition never crosses an explicit new-context boundary', async () => {
  const boundaryCases = [
    ['new-report', '新报修：护士站打印机打印不了'],
    ['other-ticket', '补充工单 IT-20260828-0042 的截图'],
  ];

  for (const [index, [label, boundaryText]] of boundaryCases.entries()) {
    const context = randomUUID();
    const baseTime = Date.parse('2026-08-28T05:40:00.000Z') + index * 5 * 60_000;
    const original = await accept(normalizedMessage(
      `p1-004-reversed-boundary-${label}-${context}-seed`,
      {
        text: 'HIS 登录失败',
        receivedAt: new Date(baseTime).toISOString(),
        chatId: `group-${context}`,
        senderUserId: `user-${context}`,
      },
    ));
    const earlierMessage = normalizedMessage(`p1-004-reversed-boundary-${label}-${context}-0`, {
      text: '补充：护士站也无法登录',
      receivedAt: new Date(baseTime + 10_000).toISOString(),
      chatId: `group-${context}`,
      senderUserId: `user-${context}`,
    });
    const boundaryMessage = normalizedMessage(`p1-004-reversed-boundary-${label}-${context}-1`, {
      text: boundaryText,
      receivedAt: new Date(baseTime + 30_000).toISOString(),
      chatId: `group-${context}`,
      senderUserId: `user-${context}`,
    });
    const inbox = createChannelMessageInbox({ pool });
    const processor = createServiceIntakeProcessor();
    let releaseEarlier;
    let markEarlierReached;
    const earlierGate = new Promise((resolve) => {
      releaseEarlier = resolve;
    });
    const earlierReached = new Promise((resolve) => {
      markEarlierReached = resolve;
    });

    const earlierPromise = inbox.accept(inboxRequest(earlierMessage), async (input) => {
      markEarlierReached();
      await earlierGate;
      return processor(input);
    });
    await earlierReached;
    const boundary = await accept(boundaryMessage);
    releaseEarlier();
    const earlier = await earlierPromise;
    if (earlier.ok && earlier.result?.intake?.id) {
      testIntakeIds.add(earlier.result.intake.id);
    }

    assert.equal(boundary.ok, true, label);
    assert.equal(boundary.result.aggregation.action, 'CREATED', label);
    assert.equal(earlier.ok, true, label);
    assert.equal(earlier.result.aggregation.action, 'APPENDED', label);
    assert.equal(earlier.result.intake.id, original.result.intake.id, label);
    assert.notEqual(original.result.intake.id, boundary.result.intake.id, label);

    const afterBoundary = await accept(normalizedMessage(
      `p1-004-reversed-boundary-${label}-${context}-2`,
      {
        text: '补充：错误代码 403',
        receivedAt: new Date(baseTime + 45_000).toISOString(),
        chatId: `group-${context}`,
        senderUserId: `user-${context}`,
      },
    ));
    assert.equal(afterBoundary.ok, true, label);
    assert.equal(afterBoundary.result.aggregation.action, 'APPENDED', label);
    assert.equal(afterBoundary.result.intake.id, boundary.result.intake.id, label);
  }
});

integrationTest('classifies the documented request types without AI and honors incident negation', async () => {
  const cases = [
    ['INCIDENT', 'RECEIVED', 'HIS 登录失败'],
    ['INCIDENT', 'RECEIVED', '新报修：测试终端无法登录，请处理'],
    ['SERVICE_REQUEST', 'RECEIVED', '请开通账号并增加权限'],
    ['QUESTION', 'RECEIVED', '请问移动护理怎么使用?'],
    ['COMPLAINT', 'RECEIVED', '投诉:报修后一直没人处理'],
    ['STATUS_QUERY', 'RECEIVED', '工单处理到哪了?'],
    ['FOLLOW_UP', 'WAITING_DESCRIPTION', '补充:在高新院区'],
    ['CHATTER', 'WAITING_DESCRIPTION', '在吗'],
    ['UNKNOWN', 'WAITING_DESCRIPTION', '麻烦看一下'],
    ['FOLLOW_UP', 'WAITING_DESCRIPTION', '已经好了,不报错了'],
    ['FOLLOW_UP', 'WAITING_DESCRIPTION', '今天没有报错'],
    ['INCIDENT', 'RECEIVED', 'PACS 没有报错，但 HIS 登录失败'],
  ];

  for (const [index, [requestType, status, text]] of cases.entries()) {
    const context = randomUUID();
    const response = await accept(normalizedMessage(`p1-004-classify-${context}-${index}`, {
      text,
      receivedAt: new Date(Date.parse('2026-08-28T06:00:00.000Z') + index * 1_000).toISOString(),
      chatId: `group-${context}`,
      senderUserId: `user-${context}`,
    }));

    assert.equal(response.ok, true);
    assert.equal(response.result.intake.request_type, requestType, text);
    assert.equal(response.result.intake.status, status, text);
    assert.equal(response.result.intake.ticket_id, null, text);
    assert.equal(response.result.intake.incident_id, null, text);
  }
});

integrationTest('standalone thanks is CHATTER without an unnecessary clarification request', async () => {
  const context = randomUUID();
  const response = await accept(normalizedMessage(`p1-004-thanks-${context}`, {
    text: '谢谢',
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }));

  assert.equal(response.ok, true);
  assert.equal(response.result.intake.request_type, 'CHATTER');
  assert.equal(response.result.intake.status, 'IGNORED');
  assert.deepEqual(
    response.result.events.map((event) => event.event_type),
    ['intake.received'],
  );
});

integrationTest('aggregate privacy is strongest, retention is earliest, and Inbox snapshots contain no report summary', async () => {
  const context = randomUUID();
  const baseTime = Date.parse('2026-08-28T06:30:00.000Z');
  const sensitiveText = `patient-example-${context} login failed`;
  const firstRetention = new Date(baseTime + 24 * 60 * 60 * 1_000).toISOString();
  const laterRetention = new Date(baseTime + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const first = await accept(normalizedMessage(`p1-004-privacy-${context}-0`, {
    text: sensitiveText,
    receivedAt: new Date(baseTime).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }), {
    privacyClass: 'PATIENT_SENSITIVE',
    retentionUntil: firstRetention,
  });
  const supplement = await accept(normalizedMessage(`p1-004-privacy-${context}-1`, {
    text: '补充:三台电脑都这样',
    receivedAt: new Date(baseTime + 20_000).toISOString(),
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  }), {
    privacyClass: 'PUBLIC',
    retentionUntil: laterRetention,
  });

  assert.equal(first.ok, true);
  assert.equal(supplement.ok, true);
  assert.equal(first.result.intake.summary, null);
  assert.equal(supplement.result.intake.summary, null);
  assert.equal(Object.hasOwn(first.result.intake, 'privacy_class'), false);
  assert.equal(Object.hasOwn(first.result.intake, 'retention_until'), false);
  assert.equal(Object.hasOwn(supplement.result.intake, 'privacy_class'), false);
  assert.equal(Object.hasOwn(supplement.result.intake, 'retention_until'), false);
  assert.equal(JSON.stringify(first).includes(sensitiveText), false);
  assert.equal(JSON.stringify(supplement).includes(sensitiveText), false);

  const persisted = await pool.query(
    `SELECT i.summary, i.privacy_class, i.retention_until,
            array_agg(m.privacy_class ORDER BY m.received_at) AS message_privacy
       FROM intake.service_intake AS i
       JOIN intake.service_intake_message AS r ON r.intake_id = i.id
       JOIN channel.message_inbox AS m ON m.id = r.channel_message_id
      WHERE i.id = $1::uuid
      GROUP BY i.id`,
    [first.result.intake.id],
  );
  assert.equal(persisted.rows[0].summary, sensitiveText);
  assert.equal(persisted.rows[0].privacy_class, 'PATIENT_SENSITIVE');
  assert.equal(persisted.rows[0].retention_until.toISOString(), firstRetention);
  assert.deepEqual(persisted.rows[0].message_privacy, ['PATIENT_SENSITIVE', 'PUBLIC']);
});

integrationTest('includes exactly 90 seconds and starts a new Intake after the window', async () => {
  const baseTime = Date.parse('2026-08-28T07:00:00.000Z');
  const inclusiveContext = randomUUID();
  const inclusiveFirst = await accept(normalizedMessage(`p1-004-window-${inclusiveContext}-0`, {
    text: 'HIS 打不开',
    receivedAt: new Date(baseTime).toISOString(),
    chatId: `group-${inclusiveContext}`,
    senderUserId: `user-${inclusiveContext}`,
  }));
  const inclusiveSecond = await accept(normalizedMessage(`p1-004-window-${inclusiveContext}-1`, {
    text: '补充:错误是 403',
    receivedAt: new Date(baseTime + 90_000).toISOString(),
    chatId: `group-${inclusiveContext}`,
    senderUserId: `user-${inclusiveContext}`,
  }));

  const expiredContext = randomUUID();
  const expiredFirst = await accept(normalizedMessage(`p1-004-window-${expiredContext}-0`, {
    text: 'HIS 打不开',
    receivedAt: new Date(baseTime).toISOString(),
    chatId: `group-${expiredContext}`,
    senderUserId: `user-${expiredContext}`,
  }));
  const expiredSecond = await accept(normalizedMessage(`p1-004-window-${expiredContext}-1`, {
    text: '补充:错误是 403',
    receivedAt: new Date(baseTime + 90_001).toISOString(),
    chatId: `group-${expiredContext}`,
    senderUserId: `user-${expiredContext}`,
  }));

  assert.equal(inclusiveSecond.result.aggregation.action, 'APPENDED');
  assert.equal(inclusiveSecond.result.intake.id, inclusiveFirst.result.intake.id);
  assert.equal(expiredSecond.result.aggregation.action, 'CREATED');
  assert.notEqual(expiredSecond.result.intake.id, expiredFirst.result.intake.id);
});

integrationTest('different senders and conversations stay separate while direct chat maps to WECOM_DIRECT', async () => {
  const context = randomUUID();
  const receivedAt = '2026-08-28T07:30:00.000Z';
  const first = await accept(normalizedMessage(`p1-004-context-${context}-0`, {
    receivedAt,
    chatId: `group-${context}`,
    senderUserId: `user-${context}-a`,
  }));
  const differentSender = await accept(normalizedMessage(`p1-004-context-${context}-1`, {
    receivedAt,
    chatId: `group-${context}`,
    senderUserId: `user-${context}-b`,
  }));
  const direct = await accept(normalizedMessage(`p1-004-context-${context}-2`, {
    receivedAt,
    chatType: 'single',
    senderUserId: `user-${context}-a`,
  }));

  assert.deepEqual(
    [first, differentSender, direct].map((response) => response.result.aggregation.action),
    ['CREATED', 'CREATED', 'CREATED'],
  );
  assert.equal(new Set([first, differentSender, direct].map((response) => response.result.intake.id)).size, 3);
  assert.equal(first.result.intake.source_channel, 'WECOM_GROUP');
  assert.equal(direct.result.intake.source_channel, 'WECOM_DIRECT');
});

integrationTest('Channel Message replay returns the original Intake result without duplicate relations or events', async () => {
  const context = randomUUID();
  const message = normalizedMessage(`p1-004-replay-${context}`, {
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  });

  const first = await accept(message);
  const replay = await accept(message);

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.channelMessageId, first.channelMessageId);
  assert.deepEqual(replay.result, first.result);

  const persisted = await pool.query(
    `SELECT count(DISTINCT r.channel_message_id)::integer AS relation_count,
            count(DISTINCT e.event_id)::integer AS event_count
       FROM intake.service_intake_message AS r
       JOIN intake.service_intake_event AS e ON e.intake_id = r.intake_id
      WHERE r.intake_id = $1::uuid`,
    [first.result.intake.id],
  );
  assert.deepEqual(persisted.rows, [{ relation_count: 1, event_count: 1 }]);
});

integrationTest('downstream failure rolls back Channel Message, Intake, relations and events before a clean retry', async () => {
  const context = randomUUID();
  const message = normalizedMessage(`p1-004-rollback-${context}`, {
    chatId: `group-${context}`,
    senderUserId: `user-${context}`,
  });
  const inbox = createChannelMessageInbox({ pool });
  const processor = createServiceIntakeProcessor();

  const failed = await inbox.accept(inboxRequest(message), async (input) => {
    await processor(input);
    throw new Error('synthetic post-intake failure');
  });

  assert.deepEqual(failed, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
    },
  });
  const afterRollback = await pool.query(
    `SELECT count(*)::integer AS count
       FROM channel.message_inbox AS m
       LEFT JOIN intake.service_intake_message AS r ON r.channel_message_id = m.id
      WHERE m.provider = $1 AND m.msg_id = $2`,
    ['WECOM_AIBOT', message.msg_id],
  );
  assert.equal(afterRollback.rows[0].count, 0);

  const retried = await accept(message);
  assert.equal(retried.ok, true);
  assert.equal(retried.duplicate, false);
  assert.equal(retried.result.aggregation.action, 'CREATED');
});

integrationTest('migration fails closed on legacy Inbox summaries and upgrades pre-redacted aggregates', async () => {
  const suffix = randomUUID().replaceAll('-', '');
  const channelSchema = `p1004_channel_${suffix}`;
  const intakeSchema = `p1004_intake_${suffix}`;
  const channelMigration = readFileSync(
    new URL('../database/migrations/001_p1_003_channel_message_inbox.sql', import.meta.url),
    'utf8',
  );
  const intakeMigration = readFileSync(
    new URL('../database/migrations/002_p1_004_service_intake.sql', import.meta.url),
    'utf8',
  );
  const isolatedMigration = (sql) => sql
    .replaceAll(
      'CREATE SCHEMA IF NOT EXISTS channel;',
      `CREATE SCHEMA IF NOT EXISTS "${channelSchema}";`,
    )
    .replaceAll(
      'CREATE SCHEMA IF NOT EXISTS intake;',
      `CREATE SCHEMA IF NOT EXISTS "${intakeSchema}";`,
    )
    .replace(/(?<![A-Za-z0-9_])channel\./gu, `"${channelSchema}".`)
    .replace(/(?<![A-Za-z0-9_])intake\./gu, `"${intakeSchema}".`);
  const isolatedChannelMigration = isolatedMigration(channelMigration);
  const isolatedIntakeMigration = isolatedMigration(intakeMigration);
  const baseTime = Date.parse('2026-08-28T09:00:00.000Z');
  const publicRetention = new Date(baseTime + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const sensitiveRetention = new Date(baseTime + 24 * 60 * 60 * 1_000).toISOString();
  const legacySummary = `legacy-patient-summary-${suffix}`;

  try {
    await pool.query(isolatedChannelMigration);
    await pool.query(isolatedIntakeMigration);

    const insertLegacyMessage = async ({
      msgId,
      receivedAt,
      privacyClass,
      retentionUntil,
      cleanText = legacySummary,
    }) => pool.query(
      `INSERT INTO "${channelSchema}".message_inbox (
          schema_version, provider, msg_id, idempotency_key, req_id, bot_id,
          chat_type, chat_id, sender_user_id, msg_type, received_at,
          clean_text, normalized_message, processing_status, response_snapshot,
          privacy_class, trace_id, retention_until, completed_at
       ) VALUES (
          1, 'WECOM_AIBOT', $1, 'WECOM_AIBOT:' || $1, 'legacy-request', 'legacy-bot',
          'group', 'legacy-group', 'legacy-user', 'text', $2::timestamptz,
          $3, $4::jsonb, 'COMPLETED', $5::jsonb,
          $6, 'legacy-trace', $7::timestamptz, clock_timestamp()
       )
       RETURNING id::text`,
      [
        msgId,
        receivedAt,
        cleanText,
        JSON.stringify({ schema_version: 1, msg_id: msgId }),
        JSON.stringify({ intake: { id: 'legacy-intake', summary: legacySummary } }),
        privacyClass,
        retentionUntil,
      ],
    );

    const primary = await insertLegacyMessage({
      msgId: `legacy-primary-${suffix}`,
      receivedAt: new Date(baseTime).toISOString(),
      privacyClass: 'PUBLIC',
      retentionUntil: publicRetention,
      cleanText: '新报修：HIS 登录失败',
    });
    const supplement = await insertLegacyMessage({
      msgId: `legacy-supplement-${suffix}`,
      receivedAt: new Date(baseTime + 20_000).toISOString(),
      privacyClass: 'PATIENT_SENSITIVE',
      retentionUntil: sensitiveRetention,
    });
    const intake = await pool.query(
      `INSERT INTO "${intakeSchema}".service_intake (
          intake_no, source_channel, source_provider, source_bot_id,
          source_chat_type, source_chat_id, reporter_wecom_userid,
          privacy_class, retention_until, request_type, summary, status,
          primary_message_id, last_message_at
       ) VALUES (
          'INT-20260828-0001', 'WECOM_GROUP', 'WECOM_AIBOT', 'legacy-bot',
          'group', 'legacy-group', 'legacy-user', 'PUBLIC', $1::timestamptz,
          'INCIDENT', $2, 'RECEIVED', $3::bigint, $4::timestamptz
       )
       RETURNING id::text`,
      [publicRetention, legacySummary, primary.rows[0].id, new Date(baseTime + 20_000).toISOString()],
    );
    await pool.query(
      `INSERT INTO "${intakeSchema}".service_intake_message (
          intake_id, channel_message_id, relation_type, sequence_no, linked_at, trace_id
       ) VALUES
          ($1::uuid, $2::bigint, 'PRIMARY', 1, $4::timestamptz, 'legacy-trace'),
          ($1::uuid, $3::bigint, 'SUPPLEMENT', 2, $5::timestamptz, 'legacy-trace')`,
      [
        intake.rows[0].id,
        primary.rows[0].id,
        supplement.rows[0].id,
        new Date(baseTime).toISOString(),
        new Date(baseTime + 20_000).toISOString(),
      ],
    );

    const boundaryFixtures = [
      ['0002', '补充工单 IT-20260828-0042 的截图', true],
      ['0003', 'AUDIT-20260828-0042 执行正常', false],
      ['0004', '引用 IT-20260828-0042A 的截图', false],
    ];
    for (const [index, [numberSuffix, cleanText]] of boundaryFixtures.entries()) {
      const receivedAt = new Date(baseTime + (index + 1) * 60_000).toISOString();
      const message = await insertLegacyMessage({
        msgId: `legacy-boundary-${numberSuffix}-${suffix}`,
        receivedAt,
        privacyClass: 'PUBLIC',
        retentionUntil: publicRetention,
        cleanText,
      });
      const boundaryIntake = await pool.query(
        `INSERT INTO "${intakeSchema}".service_intake (
            intake_no, source_channel, source_provider, source_bot_id,
            source_chat_type, source_chat_id, reporter_wecom_userid,
            privacy_class, retention_until, request_type, summary, status,
            primary_message_id, last_message_at
         ) VALUES (
            $1, 'WECOM_GROUP', 'WECOM_AIBOT', 'legacy-bot',
            'group', 'legacy-group', 'legacy-user', 'PUBLIC', $2::timestamptz,
            'FOLLOW_UP', $3, 'WAITING_DESCRIPTION', $4::bigint, $5::timestamptz
         )
         RETURNING id::text`,
        [
          `INT-20260828-${numberSuffix}`,
          publicRetention,
          legacySummary,
          message.rows[0].id,
          receivedAt,
        ],
      );
      await pool.query(
        `INSERT INTO "${intakeSchema}".service_intake_message (
            intake_id, channel_message_id, relation_type, sequence_no, linked_at, trace_id
         ) VALUES ($1::uuid, $2::bigint, 'PRIMARY', 1, $3::timestamptz, 'legacy-trace')`,
        [boundaryIntake.rows[0].id, message.rows[0].id, receivedAt],
      );
    }

    await pool.query(
      `ALTER TABLE "${intakeSchema}".service_intake
         DROP COLUMN explicit_aggregation_boundary,
         DROP COLUMN privacy_class,
         DROP COLUMN retention_until`,
    );
    await assert.rejects(
      () => pool.query(isolatedIntakeMigration),
      (error) => {
        assert.equal(error.code, '23514');
        assert.equal(error.message, 'P1_004_LEGACY_INBOX_SUMMARY_REMEDIATION_REQUIRED');
        return true;
      },
    );

    const unchangedSnapshots = await pool.query(
      `SELECT response_snapshot #>> '{intake,summary}' AS summary
         FROM "${channelSchema}".message_inbox
        ORDER BY id`,
    );
    assert.deepEqual(
      unchangedSnapshots.rows,
      Array.from({ length: 2 + boundaryFixtures.length }, () => ({ summary: legacySummary })),
    );
    await pool.query(
      `UPDATE "${channelSchema}".message_inbox
          SET response_snapshot = jsonb_set(
              response_snapshot,
              '{intake,summary}',
              'null'::jsonb,
              FALSE
          )`,
    );
    await pool.query(isolatedIntakeMigration);

    const upgraded = await pool.query(
      `SELECT explicit_aggregation_boundary, privacy_class, retention_until
         FROM "${intakeSchema}".service_intake
        WHERE id = $1::uuid`,
      [intake.rows[0].id],
    );
    assert.equal(upgraded.rows[0].explicit_aggregation_boundary, true);
    assert.equal(upgraded.rows[0].privacy_class, 'PATIENT_SENSITIVE');
    assert.equal(upgraded.rows[0].retention_until.toISOString(), sensitiveRetention);

    const upgradedBoundaries = await pool.query(
      `SELECT intake_no, explicit_aggregation_boundary
         FROM "${intakeSchema}".service_intake
        WHERE intake_no IN ('INT-20260828-0002', 'INT-20260828-0003', 'INT-20260828-0004')
        ORDER BY intake_no`,
    );
    assert.deepEqual(upgradedBoundaries.rows, boundaryFixtures.map(
      ([numberSuffix, , expected]) => ({
        intake_no: `INT-20260828-${numberSuffix}`,
        explicit_aggregation_boundary: expected,
      }),
    ));

    const snapshots = await pool.query(
      `SELECT response_snapshot #> '{intake,summary}' = 'null'::jsonb AS summary_redacted
         FROM "${channelSchema}".message_inbox
        ORDER BY id`,
    );
    assert.deepEqual(
      snapshots.rows,
      Array.from(
        { length: 2 + boundaryFixtures.length },
        () => ({ summary_redacted: true }),
      ),
    );
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS "${intakeSchema}" CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS "${channelSchema}" CASCADE`);
  }
});

test('migration runner exposes only the exact legacy-remediation failure as non-retryable', () => {
  const legacyError = {
    code: '23514',
    message: 'P1_004_LEGACY_INBOX_SUMMARY_REMEDIATION_REQUIRED',
  };
  assert.deepEqual(mapServiceIntakeMigrationFailure(legacyError), {
    code: 'P1_004_LEGACY_INBOX_SUMMARY_REMEDIATION_REQUIRED',
    retryable: false,
  });
  assert.deepEqual(mapServiceIntakeMigrationFailure({
    code: '23514',
    message: 'UNRELATED_CHECK_VIOLATION',
  }), {
    code: 'P1_004_MIGRATION_FAILED',
    retryable: true,
  });
  assert.deepEqual(mapServiceIntakeMigrationFailure({
    code: '08006',
    message: 'P1_004_LEGACY_INBOX_SUMMARY_REMEDIATION_REQUIRED',
  }), {
    code: 'P1_004_MIGRATION_FAILED',
    retryable: true,
  });
});

test('migration is limited to Service Intake, message relations and Intake audit events', () => {
  const sql = readFileSync(
    new URL('../database/migrations/002_p1_004_service_intake.sql', import.meta.url),
    'utf8',
  );
  const createdTables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([^\s(]+)/giu)]
    .map((match) => match[1].toLowerCase());

  assert.deepEqual(createdTables, [
    'intake.service_intake',
    'intake.service_intake_message',
    'intake.service_intake_event',
  ]);
  assert.match(sql, /primary_message_id\s+BIGINT\s+NOT NULL\s+UNIQUE/iu);
  assert.match(sql, /channel_message_id\s+BIGINT\s+NOT NULL\s+UNIQUE/iu);
  assert.match(sql, /relation_type IN \('PRIMARY', 'SUPPLEMENT', 'CLARIFICATION'\)/u);
  assert.match(sql, /payload JSONB NOT NULL/iu);
  assert.match(sql, /event_ordinal INTEGER NOT NULL/iu);
  assert.match(sql, /explicit_aggregation_boundary BOOLEAN NOT NULL DEFAULT FALSE/iu);
  assert.match(sql, /P1_004_LEGACY_INBOX_SUMMARY_REMEDIATION_REQUIRED/u);
  assert.doesNotMatch(sql, /SET\s+response_snapshot/iu);
  assert.match(sql, /privacy_class TEXT NOT NULL/iu);
  assert.match(sql, /retention_until TIMESTAMPTZ NOT NULL/iu);
  assert.match(sql, /service_intake_event_ordinal_unique/iu);
  assert.doesNotMatch(sql, /CREATE TABLE[^;]*(pilot_ticket|notification|outbox|hospital)/iu);
  assert.doesNotMatch(sql, /\bVARCHAR\b/iu);

  const source = readFileSync(
    new URL('../src/p1-004-service-intake.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /GREATEST\(4,\s*char_length\([^)]*sequence_value/iu);
  const migrationRunner = readFileSync(
    new URL('../scripts/p1-004-migrate.mjs', import.meta.url),
    'utf8',
  );
  assert.match(migrationRunner, /mapServiceIntakeMigrationFailure\(error\)/u);
  const verifier = readFileSync(
    new URL('../scripts/p1-004-verify.mjs', import.meta.url),
    'utf8',
  );
  assert.match(verifier, /pilot_ticket_schema_exists:\s*false/u);
});

test('Service Intake JSON Schema freezes the domain boundary and P1-004 version semantics', () => {
  const schema = JSON.parse(readFileSync(
    new URL('../contracts/service_intake.schema.json', import.meta.url),
    'utf8',
  ));

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, Object.keys(schema.properties));
  assert.deepEqual(schema.properties.request_type.enum, [
    'INCIDENT',
    'SERVICE_REQUEST',
    'QUESTION',
    'COMPLAINT',
    'STATUS_QUERY',
    'FOLLOW_UP',
    'CHATTER',
    'UNKNOWN',
  ]);
  assert.deepEqual(schema.properties.status.enum, [
    'RECEIVED',
    'TICKET_CREATED',
    'WAITING_DESCRIPTION',
    'WAITING_TRIAGE',
    'LINKED_INCIDENT',
    'COMPLETED',
    'IGNORED',
    'FAILED',
  ]);
  assert.equal(schema.properties.version.minimum, 1);
  assert.equal(Object.hasOwn(schema.properties, 'privacy_class'), false);
  assert.equal(Object.hasOwn(schema.properties, 'retention_until'), false);
  const serialized = JSON.stringify(schema);
  assert.equal(serialized.includes('msg_id'), false);
  assert.equal(serialized.includes('raw_text'), false);
  assert.equal(serialized.toLowerCase().includes('hospital_ticket'), false);
});

integrationTest('Service Intake migration is re-entrant', async () => {
  await applyServiceIntakeMigration({ pool });
  await applyServiceIntakeMigration({ pool });

  const relations = await pool.query(
    `SELECT to_regclass('intake.service_intake')::text AS intake,
            to_regclass('intake.service_intake_message')::text AS message_relation,
            to_regclass('intake.service_intake_event')::text AS event_relation`,
  );
  assert.deepEqual(relations.rows, [{
    intake: 'intake.service_intake',
    message_relation: 'intake.service_intake_message',
    event_relation: 'intake.service_intake_event',
  }]);

  const numberBoundary = await pool.query(
    `SELECT sequence_value,
            lpad(
              sequence_value,
              GREATEST(4, char_length(sequence_value)),
              '0'
            ) AS formatted
       FROM unnest(ARRAY['9999', '10000']::text[]) AS sequence_value`,
  );
  assert.deepEqual(numberBoundary.rows, [
    { sequence_value: '9999', formatted: '9999' },
    { sequence_value: '10000', formatted: '10000' },
  ]);
});

test('invalid aggregation windows fail before a processor can access a transaction', () => {
  for (const aggregationWindowMs of [0, -1, 1.5, Number.NaN, '90000']) {
    assert.throws(
      () => createServiceIntakeProcessor({ aggregationWindowMs }),
      /aggregationWindowMs must be a positive integer/u,
    );
  }
});
