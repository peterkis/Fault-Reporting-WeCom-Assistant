import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { adaptWeComSdkFrame } from '../src/p1-002-wecom-sdk-adapter.mjs';
import { formatEpochMsToShanghaiLocal, shanghaiLocalToEpochMs } from '../src/platform/time-contract.mjs';
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
  ? createPostgresPool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 2_000 })
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
  }, { receivedEpochMs: String(Date.now()) });

  assert.equal(adapted.ok, true);
  testMessageIds.add(msgId);
  return adapted.message;
}

function inboxRequest(message, overrides = {}) {
  const retentionUntilEpochMs = String(BigInt(message.received_epoch_ms) + 7n * 24n * 60n * 60n * 1000n);
  const request = {
    message,
    traceId: `trace-${message.msg_id}`,
    privacyClass: 'INTERNAL',
    retentionUntil: formatEpochMsToShanghaiLocal(retentionUntilEpochMs),
    retentionUntilEpochMs,
    ...overrides,
  };
  if (Object.hasOwn(overrides, 'retentionUntil') && !Object.hasOwn(overrides, 'retentionUntilEpochMs')) {
    try { request.retentionUntilEpochMs = shanghaiLocalToEpochMs(request.retentionUntil); }
    catch { /* Invalid values are intentionally passed to the production validator. */ }
  }
  return request;
}

async function runRestartWorker(mode, msgId) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [restartWorkerPath, mode, msgId], {
    env: process.env,
    windowsHide: true,
  });
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

function isolatedDatabaseUrl(databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function isolatedDatabaseName() {
  const databaseName = `p1_003_migration_${randomUUID().replaceAll('-', '_')}`;
  assert.match(databaseName, /^p1_003_migration_[a-f0-9_]+$/u);
  assert.ok(databaseName.length <= 63);
  return databaseName;
}

async function withIsolatedDatabase(callback) {
  const databaseName = isolatedDatabaseName();
  const quotedDatabaseName = `"${databaseName}"`;
  await pool.query(`CREATE DATABASE ${quotedDatabaseName} TEMPLATE template0`);
  const isolatedPool = createPostgresPool({
    connectionString: isolatedDatabaseUrl(databaseName),
    max: 1,
    connectionTimeoutMillis: 2_000,
  });

  try {
    return await callback(isolatedPool);
  } finally {
    await isolatedPool.end();
    await pool.query(`DROP DATABASE ${quotedDatabaseName}`);
  }
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
    assert.notEqual(message, firstMessage);
    assert.deepEqual(message, firstMessage);
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

integrationTest('snapshots validated input before connection acquisition', async () => {
  const msgId = `p1-003-snapshot-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const request = inboxRequest(message);
  const inbox = createChannelMessageInbox({ pool });
  let processedMessage;

  const pending = inbox.accept(request, async ({ message: firstMessage }) => {
    processedMessage = firstMessage;
    return { receipt_id: `receipt-${msgId}` };
  });
  request.message.response_url = 'https://must-not-persist.example.test';

  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(Object.hasOwn(processedMessage, 'response_url'), false);
  const persisted = await pool.query(
    `SELECT normalized_message ? 'response_url' AS leaked
       FROM channel.message_inbox
      WHERE provider = $1 AND msg_id = $2`,
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(persisted.rows[0].leaked, false);
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

integrationTest('non-plain processing result roots fail as processing errors', async () => {
  const cases = [
    ['date', new Date('2026-08-29 08:00:00')],
    ['array-to-json', { toJSON: () => ['not', 'an', 'object'] }],
    ['null-to-json', { toJSON: () => null }],
  ];
  const inbox = createChannelMessageInbox({ pool });

  for (const [label, result] of cases) {
    const msgId = `p1-003-result-${label}-${randomUUID()}`;
    const response = await inbox.accept(
      inboxRequest(normalizedTextMessage(msgId)),
      async () => result,
    );
    assert.deepEqual(response, {
      ok: false,
      error: {
        code: 'CHANNEL_INBOX_PROCESSING_FAILED',
        retryable: true,
        reason: 'PROCESSING_RESULT_NOT_PLAIN_JSON',
      },
    });
    const persisted = await pool.query(
      'SELECT count(*)::integer AS count FROM channel.message_inbox WHERE provider = $1 AND msg_id = $2',
      ['WECOM_AIBOT', msgId],
    );
    assert.equal(persisted.rows[0].count, 0);
  }
});

integrationTest('processing result snapshot rejects nested non-JSON runtime objects', async () => {
  const msgId = `p1-003-result-bytes-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  const encryptedBytes = randomBytes(24);

  const response = await inbox.accept(inboxRequest(message), async () => ({
    receipt_id: `receipt-${msgId}`,
    raw_payload_encrypted: encryptedBytes,
  }));

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
      reason: 'PROCESSING_RESULT_NOT_PLAIN_JSON',
    },
  });
  assert.equal(JSON.stringify(response).includes(encryptedBytes.toString('base64')), false);
  const persisted = await pool.query(
    'SELECT count(*)::integer AS count FROM channel.message_inbox WHERE provider = $1 AND msg_id = $2',
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(persisted.rows[0].count, 0);
});

integrationTest('processing result validation never executes toJSON hooks', async () => {
  const msgId = `p1-003-result-to-json-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  let toJsonCalls = 0;

  const response = await inbox.accept(inboxRequest(message), async () => ({
    receipt_id: `receipt-${msgId}`,
    nested: {
      toJSON() {
        toJsonCalls += 1;
        return { transformed: true };
      },
    },
  }));

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
      reason: 'PROCESSING_RESULT_NOT_PLAIN_JSON',
    },
  });
  assert.equal(toJsonCalls, 0);
});

integrationTest('processing result validation rejects Proxy toJSON substitution without executing it', async () => {
  const msgId = `p1-003-result-proxy-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  let toJsonCalls = 0;
  const proxiedResult = new Proxy(
    { receipt_id: `receipt-${msgId}` },
    {
      get(target, property, receiver) {
        if (property === 'toJSON') {
          return () => {
            toJsonCalls += 1;
            return { raw_payload_encrypted: Buffer.from('must-not-persist') };
          };
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );

  const response = await inbox.accept(inboxRequest(message), async () => proxiedResult);

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
      reason: 'PROCESSING_RESULT_NOT_PLAIN_JSON',
    },
  });
  assert.equal(toJsonCalls, 0);
});

integrationTest('inherited toJSON pollution cannot transform an otherwise plain result', async () => {
  const msgId = `p1-003-result-inherited-to-json-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  const expectedResult = { receipt_id: `receipt-${msgId}` };
  let inheritedToJsonCalls = 0;
  let response;

  try {
    response = await inbox.accept(inboxRequest(message), async () => {
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value() {
          inheritedToJsonCalls += 1;
          return { transformed: true };
        },
      });
      return expectedResult;
    });
  } finally {
    delete Object.prototype.toJSON;
  }

  assert.equal(response.ok, true);
  assert.deepEqual(response.result, expectedResult);
  assert.equal(inheritedToJsonCalls, 0);
});

integrationTest('processing result snapshot accepts nested plain JSON arrays', async () => {
  const msgId = `p1-003-result-array-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  const expectedResult = {
    receipt_id: `receipt-${msgId}`,
    events: [{ event_type: 'synthetic.accepted', ordinal: 1 }],
  };

  const response = await inbox.accept(
    inboxRequest(message),
    async () => expectedResult,
  );

  assert.equal(response.ok, true);
  assert.deepEqual(response.result, expectedResult);
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

integrationTest('first-processing callback cannot change Inbox transaction characteristics', async () => {
  const msgId = `p1-003-transaction-characteristics-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });

  const response = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
    await transaction.query('SET TRANSACTION READ ONLY');
    return { receipt_id: 'must-not-persist' };
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

integrationTest('comment-obfuscated transaction control remains blocked', async () => {
  const msgId = `p1-003-transaction-comment-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });

  const response = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
    await transaction.query(
      'SET/*p1-003-review*/SESSION/**/CHARACTERISTICS/*nested /* comment */ gap */AS/**/TRANSACTION READ ONLY',
    );
    return { receipt_id: 'must-not-persist' };
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

integrationTest('SET LOCAL cannot change the Inbox-owned transaction', async () => {
  const msgId = `p1-003-transaction-local-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });

  const response = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
    await transaction.query('SET LOCAL TRANSACTION READ ONLY');
    return { receipt_id: 'must-not-persist' };
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

integrationTest('session defaults cannot poison a pooled connection after Inbox commit', async () => {
  const msgId = `p1-003-transaction-session-default-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const sessionPool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  const inbox = createChannelMessageInbox({ pool: sessionPool });
  let response;

  try {
    response = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
      await transaction.query('-- p1-003 CR-only line comment\rSET SESSION default_transaction_read_only = on');
      return { receipt_id: 'must-not-persist' };
    });
  } finally {
    await sessionPool.query('SET SESSION default_transaction_read_only = off');
    await sessionPool.end();
  }

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

integrationTest('function-based session configuration is rejected before pooled connection reuse', async () => {
  const firstMsgId = `p1-003-session-function-first-${randomUUID()}`;
  const secondMsgId = `p1-003-session-function-second-${randomUUID()}`;
  const sessionPool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  const inbox = createChannelMessageInbox({ pool: sessionPool });
  let first;
  let second;

  try {
    first = await inbox.accept(
      inboxRequest(normalizedTextMessage(firstMsgId)),
      async ({ transaction }) => {
        await transaction.query(
          "SELECT pg_catalog.set_config('default_transaction_read_only', 'on', false)",
        );
        return { receipt_id: `receipt-${firstMsgId}` };
      },
    );
    second = await inbox.accept(
      inboxRequest(normalizedTextMessage(secondMsgId)),
      async () => ({ receipt_id: `receipt-${secondMsgId}` }),
    );
  } finally {
    await sessionPool.query('SET SESSION default_transaction_read_only = off');
    await sessionPool.end();
  }

  assert.deepEqual(first, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
      reason: 'TRANSACTION_CONTROL_NOT_ALLOWED',
    },
  });
  assert.equal(second.ok, true);
});

integrationTest('ordinary Inbox use preserves caller-owned pool session baselines', async () => {
  const msgId = `p1-003-session-baseline-${randomUUID()}`;
  const baselinePool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  const baselineClient = await baselinePool.connect();
  await baselineClient.query('SET SESSION statement_timeout = 12345');
  baselineClient.release();

  try {
    const inbox = createChannelMessageInbox({ pool: baselinePool });
    const response = await inbox.accept(
      inboxRequest(normalizedTextMessage(msgId)),
      async () => ({ receipt_id: `receipt-${msgId}` }),
    );
    assert.equal(response.ok, true);

    const baseline = await baselinePool.query(
      "SELECT setting FROM pg_settings WHERE name = 'statement_timeout'",
    );
    assert.equal(baseline.rows[0].setting, '12345');
  } finally {
    await baselinePool.query('RESET ALL');
    await baselinePool.end();
  }
});

integrationTest('callback-style transaction queries are rejected before PostgreSQL execution', async () => {
  const msgId = `p1-003-transaction-callback-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  let callbackCalls = 0;

  const response = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
    await transaction.query('SELECT 1 / 0', () => {
      callbackCalls += 1;
    });
    return { receipt_id: 'must-not-persist' };
  });

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
      reason: 'TRANSACTION_QUERY_INVALID',
    },
  });
  assert.equal(callbackCalls, 0);
  const persisted = await pool.query(
    'SELECT count(*)::integer AS count FROM channel.message_inbox WHERE provider = $1 AND msg_id = $2',
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(persisted.rows[0].count, 0);
});

integrationTest('unawaited transaction query failure remains a processing failure', async () => {
  const msgId = `p1-003-transaction-unawaited-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  let launchedQuery;

  const response = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
    launchedQuery = transaction.query('SELECT 1 / 0');
    void launchedQuery.catch(() => {});
    return { receipt_id: 'must-not-persist' };
  });

  assert.deepEqual(response, {
    ok: false,
    error: {
      code: 'CHANNEL_INBOX_PROCESSING_FAILED',
      retryable: true,
    },
  });
  await assert.rejects(launchedQuery);
  const persisted = await pool.query(
    'SELECT count(*)::integer AS count FROM channel.message_inbox WHERE provider = $1 AND msg_id = $2',
    ['WECOM_AIBOT', msgId],
  );
  assert.equal(persisted.rows[0].count, 0);
});

integrationTest('transaction view is revoked when first processing settles', async () => {
  const msgId = `p1-003-transaction-lifetime-${randomUUID()}`;
  const message = normalizedTextMessage(msgId);
  const inbox = createChannelMessageInbox({ pool });
  let capturedTransaction;

  const response = await inbox.accept(inboxRequest(message), async ({ transaction }) => {
    capturedTransaction = transaction;
    return { receipt_id: `receipt-${msgId}` };
  });
  assert.equal(response.ok, true);

  await assert.rejects(
    capturedTransaction.query('SELECT 1'),
    (error) => error?.reason === 'TRANSACTION_VIEW_CLOSED',
  );
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
  const unavailablePool = createPostgresPool({
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
      inboxRequest(message, { retentionUntil: message.received_at, retentionUntilEpochMs: message.received_epoch_ms }),
      'RETENTION_UNTIL_NOT_AFTER_RECEIVED_AT',
    ],
    [
      inboxRequest(message, { retentionUntil: '2098-02-30 16:00:00' }),
      'RETENTION_UNTIL_INVALID',
    ],
    [
      inboxRequest(message, { rawPayloadEncrypted: { ciphertext: 'not bytes' } }),
      'ENCRYPTED_RAW_PAYLOAD_BYTES_REQUIRED',
    ],
    [
      inboxRequest({ ...message, received_at: '2026-08-28' }),
      'MESSAGE_RECEIVED_AT_INVALID',
    ],
    [
      inboxRequest({
        ...message,
        content: [{
          kind: 'text',
          text: { raw: 'before\u0000after', clean: 'before\u0000after' },
        }],
      }),
      'MESSAGE_CONTENT_INVALID',
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
  const retentionUntil = formatEpochMsToShanghaiLocal(String(Date.now() + 90 * 24 * 60 * 60 * 1_000));
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
  assert.equal(persisted.rows[0].retention_until, retentionUntil);
});

integrationTest('migration fails closed when an existing Inbox lacks required constraints', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await isolatedPool.query(`
      CREATE SCHEMA channel;
      CREATE TABLE channel.message_inbox (
        id BIGINT GENERATED ALWAYS AS IDENTITY,
        schema_version SMALLINT NOT NULL,
        provider TEXT NOT NULL,
        msg_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        req_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        chat_id TEXT,
        sender_user_id TEXT NOT NULL,
        msg_type TEXT NOT NULL,
        create_time TIMESTAMPTZ,
        received_at TIMESTAMPTZ NOT NULL,
        raw_text TEXT,
        clean_text TEXT,
        normalized_message JSONB NOT NULL,
        raw_payload_encrypted BYTEA,
        processing_status TEXT NOT NULL DEFAULT 'PROCESSING',
        response_snapshot JSONB,
        privacy_class TEXT NOT NULL,
        trace_id TEXT NOT NULL,
        retention_until TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ
      )
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration reports the stable drift error before indexing a table with missing columns', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await isolatedPool.query(`
      CREATE SCHEMA channel;
      CREATE TABLE channel.message_inbox (id BIGINT)
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration rejects a weakened check constraint that keeps the expected name', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await isolatedPool.query(`
      ALTER TABLE channel.message_inbox
        DROP CONSTRAINT message_inbox_retention_check;
      ALTER TABLE channel.message_inbox
        ADD CONSTRAINT message_inbox_retention_check CHECK (TRUE)
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration rejects a deferrable idempotency constraint unusable by ON CONFLICT', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await isolatedPool.query(`
      ALTER TABLE channel.message_inbox
        DROP CONSTRAINT message_inbox_provider_msg_unique;
      ALTER TABLE channel.message_inbox
        ADD CONSTRAINT message_inbox_provider_msg_unique
        UNIQUE (provider, msg_id) DEFERRABLE INITIALLY IMMEDIATE
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration rejects a deferrable primary key unusable by later foreign keys', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await isolatedPool.query(`
      ALTER TABLE channel.message_inbox
        DROP CONSTRAINT message_inbox_pkey;
      ALTER TABLE channel.message_inbox
        ADD CONSTRAINT message_inbox_pkey
        PRIMARY KEY (id) DEFERRABLE INITIALLY IMMEDIATE
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration rejects a same-name hash index that cannot serve retention range scans', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await isolatedPool.query(`
      DROP INDEX channel.message_inbox_retention_idx;
      CREATE INDEX message_inbox_retention_idx
        ON channel.message_inbox USING hash (retention_until)
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration rejects an extra check constraint outside the frozen set', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await isolatedPool.query(`
      ALTER TABLE channel.message_inbox
        ADD CONSTRAINT message_inbox_extra_reject_all_check
        CHECK (provider <> 'WECOM_AIBOT')
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration rejects an extra unique constraint that changes write semantics', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await isolatedPool.query(`
      ALTER TABLE channel.message_inbox
        ADD CONSTRAINT message_inbox_extra_req_id_unique UNIQUE (req_id)
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration rejects a generated column that breaks explicit Inbox writes', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await isolatedPool.query(`
      ALTER TABLE channel.message_inbox DROP COLUMN raw_text;
      ALTER TABLE channel.message_inbox
        ADD COLUMN raw_text TEXT GENERATED ALWAYS AS (clean_text) STORED
    `);

    await assert.rejects(
      applyChannelMessageInboxMigration({ pool: isolatedPool }),
      (error) => error?.code === '23514'
        && error?.message === 'P1_003_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
    );
  });
});

integrationTest('migration is reentrant when the existing Inbox matches the frozen catalog', async () => {
  await withIsolatedDatabase(async (isolatedPool) => {
    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await applyChannelMessageInboxMigration({ pool: isolatedPool });

    const catalog = await isolatedPool.query(`
      SELECT count(*) FILTER (WHERE contype = 'u')::integer AS unique_constraints,
             count(*) FILTER (WHERE contype = 'c')::integer AS check_constraints
        FROM pg_constraint
       WHERE conrelid = 'channel.message_inbox'::regclass
    `);
    assert.deepEqual(catalog.rows[0], {
      unique_constraints: 1,
      check_constraints: 16,
    });
  });
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
