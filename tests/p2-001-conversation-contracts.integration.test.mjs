import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { applyChannelMessageInboxMigration } from '../src/p1-003-channel-message-inbox.mjs';
import { applyServiceIntakeMigration } from '../src/p1-004-service-intake.mjs';
import { applyPilotTicketCoreMigration } from '../src/p1-005-pilot-ticket-core.mjs';
import {
  CONVERSATION_ERROR_CODES,
  applyConversationContractsMigration,
  buildConversationSessionScope,
  buildConversationThreadIdentity,
  createConversationSessionContractRecord,
  mapConversationStorageError,
} from '../src/p2-001-conversation-contracts.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const conversationEnabled = { CONVERSATION_CENTER_ENABLED: true };

function isolatedDatabaseName() {
  const name = `p2_001_contract_${randomUUID().replaceAll('-', '_')}`;
  assert.match(name, /^p2_001_contract_[a-f0-9_]+$/u);
  assert.ok(name.length <= 63);
  return name;
}

function databaseUrlFor(name) {
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function insertThread(pool, identity) {
  const inserted = await pool.query(
    `INSERT INTO conversation.thread (
       provider, channel_account_id, chat_type, external_thread_key, thread_key, last_activity_at
     ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     RETURNING id::text, status, thread_key`,
    [
      identity.provider,
      identity.channel_account_id,
      identity.chat_type,
      identity.external_thread_key,
      identity.thread_key,
      '2026-08-30T01:00:00.000Z',
    ],
  );
  return inserted.rows[0];
}

async function insertSession(pool, {
  threadId,
  participantKey,
  serviceIntakeId = null,
  creationIdempotencyKey,
}) {
  const threadKey = (await pool.query(
    'SELECT thread_key FROM conversation.thread WHERE id = $1::uuid',
    [threadId],
  )).rows[0].thread_key;
  const scope = buildConversationSessionScope({
    threadKey,
    participantKey,
    serviceIntakeId,
    creationIdempotencyKey,
  });
  const inserted = await pool.query(
    `INSERT INTO conversation.session (
       thread_id, participant_key, service_intake_id,
       session_scope_key, creation_idempotency_key, last_activity_at
     ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::timestamptz)
     RETURNING id::text, status, control_mode, generation_version, row_version`,
    [
      threadId,
      participantKey,
      serviceIntakeId,
      scope.session_scope_key,
      creationIdempotencyKey,
      '2026-08-30T01:00:00.000Z',
    ],
  );
  return inserted.rows[0];
}

integrationTest('P2-001 PostgreSQL contract is idempotent, isolated, and fail closed', async () => {
  const adminPool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  const databaseName = isolatedDatabaseName();
  const quotedDatabaseName = `"${databaseName}"`;
  let isolatedPool;

  try {
    await adminPool.query(`CREATE DATABASE ${quotedDatabaseName} TEMPLATE template0`);
    isolatedPool = new Pool({
      connectionString: databaseUrlFor(databaseName),
      max: 1,
      connectionTimeoutMillis: 2_000,
    });

    await applyChannelMessageInboxMigration({ pool: isolatedPool });
    await applyServiceIntakeMigration({ pool: isolatedPool });
    await applyPilotTicketCoreMigration({ pool: isolatedPool });
    await applyConversationContractsMigration({ pool: isolatedPool });
    await applyConversationContractsMigration({ pool: isolatedPool });

    const firstIdentity = buildConversationThreadIdentity({
      provider: 'WECOM_AIBOT',
      botId: 'bot-contract-a',
      chatType: 'group',
      chatId: 'group-contract-a',
      senderUserId: 'participant-a',
    });
    const firstThread = await insertThread(isolatedPool, firstIdentity);
    assert.equal(firstThread.status, 'OPEN');

    await assert.rejects(
      insertThread(isolatedPool, { ...firstIdentity, thread_key: `ctk_v1_${'f'.repeat(64)}` }),
      (error) => error.code === '23505'
        && error.constraint === 'conversation_thread_natural_key_unique',
    );
    await assert.rejects(
      insertThread(isolatedPool, {
        ...firstIdentity,
        external_thread_key: 'different-natural-key',
        thread_key: firstIdentity.thread_key,
      }),
      (error) => error.code === '23505'
        && error.constraint === 'conversation_thread_key_unique',
    );

    const firstCreation = await createConversationSessionContractRecord({
      pool: isolatedPool,
      threadId: firstThread.id,
      participantKey: 'participant-a',
      creationIdempotencyKey: 'WECOM_AIBOT:message-a',
      lastActivityAt: '2026-08-30T01:00:00.000Z',
      featureFlags: conversationEnabled,
    });
    assert.equal(firstCreation.ok, true);
    assert.equal(firstCreation.replayed, false);
    const firstSession = firstCreation.session;
    assert.deepEqual({
      id: firstSession.id,
      status: firstSession.status,
      control_mode: firstSession.control_mode,
      generation_version: firstSession.generation_version,
      row_version: firstSession.row_version,
    }, {
      id: firstSession.id,
      status: 'OPEN',
      control_mode: 'HUMAN',
      generation_version: 1,
      row_version: 1,
    });

    const firstReplay = await createConversationSessionContractRecord({
      pool: isolatedPool,
      threadId: firstThread.id,
      participantKey: 'participant-a',
      creationIdempotencyKey: 'WECOM_AIBOT:message-a',
      lastActivityAt: '2026-08-30T01:00:01.000Z',
      featureFlags: conversationEnabled,
    });
    assert.equal(firstReplay.ok, true);
    assert.equal(firstReplay.replayed, true);
    assert.equal(firstReplay.session.id, firstSession.id);

    await assert.rejects(
      insertSession(isolatedPool, {
        threadId: firstThread.id,
        participantKey: 'participant-a',
        creationIdempotencyKey: 'WECOM_AIBOT:message-b',
      }),
      (error) => {
        const mapped = mapConversationStorageError(error);
        return mapped.error.code === CONVERSATION_ERROR_CODES.activeSessionConflict;
      },
    );

    const otherParticipant = await insertSession(isolatedPool, {
      threadId: firstThread.id,
      participantKey: 'participant-b',
      creationIdempotencyKey: 'WECOM_AIBOT:message-c',
    });
    assert.equal(otherParticipant.control_mode, 'HUMAN');

    const secondIdentity = buildConversationThreadIdentity({
      provider: 'WECOM_AIBOT',
      botId: 'bot-contract-b',
      chatType: 'group',
      chatId: 'group-contract-a',
      senderUserId: 'participant-a',
    });
    const secondThread = await insertThread(isolatedPool, secondIdentity);
    const otherBotSession = await insertSession(isolatedPool, {
      threadId: secondThread.id,
      participantKey: 'participant-a',
      creationIdempotencyKey: 'WECOM_AIBOT:message-d',
    });
    assert.equal(otherBotSession.status, 'OPEN');

    await isolatedPool.query(
      `UPDATE conversation.session
          SET status = 'ENDED', ended_at = $2::timestamptz, close_reason = 'EXPLICIT_USER_NEW_TOPIC',
              generation_version = generation_version + 1,
              row_version = row_version + 1,
              updated_at = $2::timestamptz
        WHERE id = $1::uuid`,
      [firstSession.id, '2026-08-30T01:01:00.000Z'],
    );
    const laterSession = await insertSession(isolatedPool, {
      threadId: firstThread.id,
      participantKey: 'participant-a',
      creationIdempotencyKey: 'WECOM_AIBOT:message-e',
    });
    assert.notEqual(laterSession.id, firstSession.id);

    await isolatedPool.query(
      `UPDATE conversation.session
          SET status = 'ENDED', ended_at = $2::timestamptz, close_reason = 'EXPLICIT_USER_NEW_TOPIC',
              generation_version = generation_version + 1,
              row_version = row_version + 1,
              updated_at = $2::timestamptz
        WHERE id = $1::uuid`,
      [laterSession.id, '2026-08-30T01:02:00.000Z'],
    );
    const endedReplay = await createConversationSessionContractRecord({
      pool: isolatedPool,
      threadId: firstThread.id,
      participantKey: 'participant-a',
      creationIdempotencyKey: 'WECOM_AIBOT:message-a',
      lastActivityAt: '2026-08-30T01:03:00.000Z',
      featureFlags: conversationEnabled,
    });
    assert.equal(endedReplay.ok, true);
    assert.equal(endedReplay.replayed, true);
    assert.equal(endedReplay.session.id, firstSession.id);
    assert.equal(endedReplay.session.status, 'ENDED');

    const conflictingReplay = await createConversationSessionContractRecord({
      pool: isolatedPool,
      threadId: firstThread.id,
      participantKey: 'participant-c',
      creationIdempotencyKey: 'WECOM_AIBOT:message-a',
      lastActivityAt: '2026-08-30T01:03:00.000Z',
      featureFlags: conversationEnabled,
    });
    assert.equal(
      conflictingReplay.error.code,
      CONVERSATION_ERROR_CODES.idempotencyConflict,
    );
    const nonexistentThreadConflict = await createConversationSessionContractRecord({
      pool: isolatedPool,
      threadId: randomUUID(),
      participantKey: 'participant-a',
      creationIdempotencyKey: 'WECOM_AIBOT:message-a',
      lastActivityAt: '2026-08-30T01:03:00.000Z',
      featureFlags: conversationEnabled,
    });
    assert.equal(
      nonexistentThreadConflict.error.code,
      CONVERSATION_ERROR_CODES.idempotencyConflict,
    );

    await assert.rejects(
      insertSession(isolatedPool, {
        threadId: firstThread.id,
        participantKey: 'participant-c',
        serviceIntakeId: randomUUID(),
        creationIdempotencyKey: 'WECOM_AIBOT:message-f',
      }),
      (error) => mapConversationStorageError(error).error.code
        === CONVERSATION_ERROR_CODES.intakeScopeConflict,
    );

    await assert.rejects(
      isolatedPool.query(
        `INSERT INTO conversation.session (
           thread_id, participant_key, session_scope_key,
           creation_idempotency_key, last_activity_at
         ) VALUES ($1::uuid, $2, $3, $4, $5::timestamptz)`,
        [
          firstThread.id,
          'participant-c',
          'not-a-contract-scope',
          'WECOM_AIBOT:message-g',
          '2026-08-30T01:00:00.000Z',
        ],
      ),
      (error) => error.code === '23514'
        && error.constraint === 'conversation_session_scope_key_check',
    );

    const isolatedFacts = await isolatedPool.query(
      `SELECT
         (SELECT count(*)::integer FROM conversation.thread) AS thread_count,
         (SELECT count(*)::integer FROM conversation.session) AS session_count,
         (SELECT count(*)::integer FROM conversation.session WHERE control_mode <> 'HUMAN') AS non_human_count`,
    );
    assert.deepEqual(isolatedFacts.rows[0], {
      thread_count: 2,
      session_count: 4,
      non_human_count: 0,
    });

    await isolatedPool.query(
      'ALTER TABLE conversation.session DROP CONSTRAINT conversation_session_status_check',
    );
    await assert.rejects(
      applyConversationContractsMigration({ pool: isolatedPool }),
      (error) => error.code === '23514'
        && error.message === CONVERSATION_ERROR_CODES.schemaDrift,
    );
  } finally {
    if (isolatedPool) {
      await isolatedPool.end();
      await adminPool.query(`DROP DATABASE ${quotedDatabaseName}`);
    }
    await adminPool.end();
  }
});
