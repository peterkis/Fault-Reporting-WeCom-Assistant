import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { adaptWeComSdkFrame } from '../src/p1-002-wecom-sdk-adapter.mjs';
import {
  applyChannelMessageInboxMigration,
  createChannelMessageInbox,
} from '../src/p1-003-channel-message-inbox.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const execFileAsync = promisify(execFile);
const restartWorkerPath = fileURLToPath(new URL('fixtures/p1-003-inbox-worker.mjs', import.meta.url));
const integrationTest = databaseUrl ? test : test.skip;
const testMessageIds = new Set();
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000 })
  : null;

function normalizedTextMessage(msgId, { reqId = `req-${msgId}`, text = 'HIS login failed' } = {}) {
  const adapted = adaptWeComSdkFrame({
    cmd: 'aibot_msg_callback',
    headers: { req_id: reqId },
    body: {
      msgid: msgId,
      aibotid: 'bot-p1-003-test',
      chattype: 'single',
      from: { userid: 'user-p1-003-test' },
      msgtype: 'text',
      text: { content: text },
    },
  }, { receivedAt: new Date().toISOString() });

  assert.equal(adapted.ok, true);
  testMessageIds.add(msgId);
  return adapted.message;
}

function inboxRequest(message, overrides = {}) {
  return {
    message,
    traceId: `trace-${message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    ...overrides,
  };
}

async function runRestartWorker(mode, msgId) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [restartWorkerPath, mode, msgId], {
    env: process.env,
    windowsHide: true,
  });
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

before(async () => {
  if (pool) {
    await applyChannelMessageInboxMigration({ pool });
  }
});

after(async () => {
  if (!pool) {
    return;
  }
  if (testMessageIds.size > 0) {
    await pool.query(
      'DELETE FROM channel.message_inbox WHERE provider = $1 AND msg_id = ANY($2::text[])',
      ['WECOM_AIBOT', [...testMessageIds]],
    );
  }
  await pool.end();
});

integrationTest('persists one Channel Message and returns the original result on replay', async () => {
  const msgId = `p1-003-replay-${randomUUID()}`;
  const firstMessage = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  let processCount = 0;

  const first = await inbox.accept(inboxRequest(firstMessage), async ({ channelMessageId, message, transaction }) => {
    processCount += 1;
    assert.equal(typeof channelMessageId, 'string');
    assert.equal(message, firstMessage);
    const transactionProbe = await transaction.query('SELECT txid_current()::text AS transaction_id');
    assert.equal(typeof transactionProbe.rows[0].transaction_id, 'string');
    return { receipt_id: `receipt-${msgId}` };
  });

  const replayMessage = normalizedTextMessage(msgId, { reqId: `req-replay-${msgId}` });
  const replay = await inbox.accept(inboxRequest(replayMessage), async () => {
    processCount += 1;
    return { receipt_id: 'must-not-run' };
  });

  assert.deepEqual(first, {
    ok: true,
    duplicate: false,
    channelMessageId: first.channelMessageId,
    result: { receipt_id: `receipt-${msgId}` },
  });
  assert.deepEqual(replay, {
    ok: true,
    duplicate: true,
    channelMessageId: first.channelMessageId,
    result: first.result,
  });
  assert.equal(processCount, 1);

  const persisted = await pool.query(
    `SELECT provider, msg_id, req_id, raw_text, clean_text, processing_status,
            privacy_class, trace_id, response_snapshot
       FROM channel.message_inbox
      WHERE provider = $1 AND msg_id = $2`,
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(persisted.rowCount, 1);
  assert.deepEqual(persisted.rows[0], {
    provider: 'WECOM_AIBOT',
    msg_id: msgId,
    req_id: firstMessage.req_id,
    raw_text: 'HIS login failed',
    clean_text: 'his login failed',
    processing_status: 'COMPLETED',
    privacy_class: 'INTERNAL',
    trace_id: `trace-${msgId}`,
    response_snapshot: first.result,
  });
});

integrationTest('concurrent duplicates execute first processing exactly once', async () => {
  const msgId = `p1-003-concurrent-${randomUUID()}`;
  const inbox = createChannelMessageInbox({ pool });
  let processCount = 0;

  const responses = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
    const message = normalizedTextMessage(msgId, { reqId: `req-${index}-${msgId}` });
    return inbox.accept(inboxRequest(message), async ({ message: winningMessage }) => {
      processCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        receipt_id: `receipt-${msgId}`,
        winning_req_id: winningMessage.req_id,
      };
    });
  }));

  assert.equal(processCount, 1);
  assert.equal(responses.filter((response) => response.duplicate === false).length, 1);
  assert.equal(responses.filter((response) => response.duplicate === true).length, 11);
  assert.equal(new Set(responses.map((response) => response.channelMessageId)).size, 1);
  assert.equal(new Set(responses.map((response) => JSON.stringify(response.result))).size, 1);

  const persisted = await pool.query(
    'SELECT count(*)::integer AS count FROM channel.message_inbox WHERE provider = $1 AND msg_id = $2',
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(persisted.rows[0].count, 1);
});

integrationTest('first-processing failure rolls back the Inbox row and permits a clean retry', async () => {
  const msgId = `p1-003-rollback-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  let processCount = 0;

  const failed = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
    processCount += 1;
    await transaction.query('SELECT 1');
    throw new Error('synthetic downstream failure');
  });

  assert.deepEqual(failed, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
    },
  });
  const afterRollback = await pool.query(
    'SELECT count(*)::integer AS count FROM channel.message_inbox WHERE provider = $1 AND msg_id = $2',
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(afterRollback.rows[0].count, 0);

  const retried = await inbox.accept(inboxRequest(message), async () => {
    processCount += 1;
    return { receipt_id: `receipt-after-rollback-${msgId}` };
  });

  assert.equal(retried.ok, true);
  assert.equal(retried.duplicate, false);
  assert.equal(processCount, 2);
});

integrationTest('first-processing callback cannot commit the Inbox transaction early', async () => {
  const msgId = `p1-003-transaction-guard-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });

  const response = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
    await transaction.query('COMMIT');
    return { receipt_id: 'must-not-commit' };
  });

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
      reason: 'TRANSACTION_CONTROL_NOT_ALLOWED',
    },
  });
  const persisted = await pool.query(
    'SELECT count(*)::integer AS count FROM channel.message_inbox WHERE provider = $1 AND msg_id = $2',
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(persisted.rows[0].count, 0);
});

integrationTest('a duplicate after a real process restart receives the committed result', async () => {
  const msgId = `p1-003-restart-${randomUUID()}`;
  testMessageIds.add(msgId);

  const first = await runRestartWorker('first', msgId);
  const afterRestart = await runRestartWorker('replay', msgId);

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(afterRestart.ok, true);
  assert.equal(afterRestart.duplicate, true);
  assert.equal(afterRestart.channelMessageId, first.channelMessageId);
  assert.deepEqual(afterRestart.result, first.result);
  assert.deepEqual(first.result, { receipt_id: `receipt-${msgId}` });
});

test('temporary database unavailability returns a stable retryable error without processing', async () => {
  const unavailablePool = new Pool({
    host: '127.0.0.1',
    port: 1,
    database: 'unavailable',
    max: 1,
    connectionTimeoutMillis: 100,
  });
  const inbox = createChannelMessageInbox({ pool: unavailablePool });
  const message = normalizedTextMessage(`p1-003-unavailable-${randomUUID()}`);
  let processCount = 0;

  try {
    const response = await inbox.accept(inboxRequest(message), async () => {
      processCount += 1;
      return { receipt_id: 'must-not-run' };
    });

    assert.deepEqual(response, {
      ok: false,
      error: {
        code: 'CHANNEL_INBOX_UNAVAILABLE',
        retryable: true,
      },
    });
    assert.equal(processCount, 0);
    assert.equal(JSON.stringify(response).includes('127.0.0.1'), false);
  } finally {
    await unavailablePool.end();
  }
});

test('invalid privacy, retention, plaintext payload and non-contract message fields fail before database access', async () => {
  let connectCount = 0;
  const noConnectPool = {
    async connect() {
      connectCount += 1;
      throw new Error('database access must not occur');
    },
  };
  const inbox = createChannelMessageInbox({ pool: noConnectPool });
  const message = normalizedTextMessage(`p1-003-invalid-${randomUUID()}`);
  const cases = [
    [
      { ...inboxRequest({ ...message, response_url: 'https://must-not-persist.example.test' }) },
      'MESSAGE_FIELDS_INVALID',
    ],
    [
      { ...inboxRequest(message), rawPayload: { body: 'plaintext must not be accepted' } },
      'REQUEST_FIELDS_INVALID',
    ],
    [
      inboxRequest(message, { privacyClass: 'UNCLASSIFIED' }),
      'PRIVACY_CLASS_INVALID',
    ],
    [
      inboxRequest(message, { retentionUntil: message.received_at }),
      'RETENTION_UNTIL_NOT_AFTER_RECEIVED_AT',
    ],
    [
      inboxRequest(message, { rawPayloadEncrypted: { ciphertext: 'not bytes' } }),
      'ENCRYPTED_RAW_PAYLOAD_BYTES_REQUIRED',
    ],
    [
      inboxRequest({ ...message, received_at: '2026-08-28' }),
      'MESSAGE_RECEIVED_AT_INVALID',
    ],
  ];

  for (const [request, reason] of cases) {
    const response = await inbox.accept(request, async () => ({ receipt_id: 'must-not-run' }));
    assert.deepEqual(response, {
      ok: false,
      error: {
        code: 'CHANNEL_INBOX_INVALID_INPUT',
        retryable: false,
        reason,
      },
    });
  }
  assert.equal(connectCount, 0);
});

integrationTest('privacy, retention and caller-encrypted raw payload are persisted without entering the result', async () => {
  const msgId = `p1-003-privacy-${randomUUID()}`;
  const message = normalizedTextMessage(msgId, { text: 'Synthetic patient-sensitive example' });
  const retentionUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000).toISOString();
  const encryptedPayload = randomBytes(48);
  const inbox = createChannelMessageInbox({ pool });

  const response = await inbox.accept(inboxRequest(message, {
    privacyClass: 'PATIENT_SENSITIVE',
    retentionUntil,
    rawPayloadEncrypted: encryptedPayload,
  }), async () => ({ receipt_id: `receipt-${msgId}` }));

  assert.equal(response.ok, true);
  assert.equal(JSON.stringify(response).includes(encryptedPayload.toString('base64')), false);
  const persisted = await pool.query(
    `SELECT normalized_message, raw_payload_encrypted, privacy_class, retention_until
       FROM channel.message_inbox
      WHERE provider = $1 AND msg_id = $2`,
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(persisted.rowCount, 1);
  assert.deepEqual(persisted.rows[0].normalized_message, message);
  assert.deepEqual(persisted.rows[0].raw_payload_encrypted, encryptedPayload);
  assert.equal(persisted.rows[0].privacy_class, 'PATIENT_SENSITIVE');
  assert.equal(persisted.rows[0].retention_until.toISOString(), retentionUntil);
});

test('migration is limited to the P1-003 Channel Inbox and freezes the database constraints', () => {
  const sql = readFileSync(
    new URL('../database/migrations/001_p1_003_channel_message_inbox.sql', import.meta.url),
    'utf8',
  );
  const createdTables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([^\s(]+)/giu)]
    .map((match) => match[1].toLowerCase());

  assert.deepEqual(createdTables, ['channel.message_inbox']);
  assert.match(sql, /UNIQUE\s*\(provider,\s*msg_id\)/iu);
  assert.match(sql, /idempotency_key\s*=\s*provider\s*\|\|\s*':'\s*\|\|\s*msg_id/iu);
  assert.match(sql, /raw_payload_encrypted\s+BYTEA/iu);
  assert.match(sql, /retention_until\s+TIMESTAMPTZ\s+NOT NULL/iu);
  assert.doesNotMatch(sql, /CREATE TABLE[^;]*(service_intake|pilot_ticket|notification|hospital)/iu);
  assert.doesNotMatch(sql, /\bVARCHAR\b/iu);
});
