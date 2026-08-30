import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  CONVERSATION_ERROR_CODES,
  CONVERSATION_FEATURE_FLAG_DEFAULTS,
  ConversationContractError,
  advanceConversationSessionVersions,
  buildConversationSessionScope,
  buildConversationThreadIdentity,
  createConversationSessionContractRecord,
  decideConversationSessionBoundary,
  evaluateConversationControlModeTransition,
  evaluateConversationSessionStatusTransition,
  mapConversationStorageError,
  normalizeConversationFeatureFlags,
  runConversationCenterGuarded,
} from '../src/p2-001-conversation-contracts.mjs';

const INTAKE_A = '018f4f00-1111-7111-8111-111111111111';
const INTAKE_B = '018f4f00-2222-7222-8222-222222222222';

function groupThread(overrides = {}) {
  return buildConversationThreadIdentity({
    provider: 'WECOM_AIBOT',
    botId: 'bot-contract-a',
    chatType: 'group',
    chatId: 'group-contract-a',
    senderUserId: 'participant-a',
    ...overrides,
  });
}

test('all P2 conversation feature flags default to false', () => {
  assert.equal(
    Object.values(CONVERSATION_FEATURE_FLAG_DEFAULTS).every((value) => value === false),
    true,
  );
  assert.deepEqual(
    normalizeConversationFeatureFlags(),
    CONVERSATION_FEATURE_FLAG_DEFAULTS,
  );
});

test('Thread identity separates single, group, and multiple bots without exposing raw ids in its key', () => {
  const single = buildConversationThreadIdentity({
    provider: 'WECOM_AIBOT',
    botId: 'bot-contract-a',
    chatType: 'single',
    senderUserId: 'same-external-value',
  });
  const group = groupThread({
    chatId: 'same-external-value',
    senderUserId: 'same-external-value',
  });
  const otherBot = groupThread({
    botId: 'bot-contract-b',
    chatId: 'same-external-value',
    senderUserId: 'same-external-value',
  });

  assert.equal(single.external_thread_key, 'same-external-value');
  assert.equal(group.external_thread_key, 'same-external-value');
  assert.notEqual(single.thread_key, group.thread_key);
  assert.notEqual(group.thread_key, otherBot.thread_key);
  assert.match(group.thread_key, /^ctk_v1_[a-f0-9]{64}$/u);
  assert.doesNotMatch(group.thread_key, /same-external-value|bot-contract/u);
});

test('Thread identity rejects malformed channel scope with a stable error', () => {
  assert.throws(
    () => groupThread({ chatId: null }),
    (error) => error instanceof ConversationContractError
      && error.code === CONVERSATION_ERROR_CODES.threadKeyInvalid,
  );
  assert.throws(
    () => buildConversationThreadIdentity({
      provider: 'WECOM_AIBOT',
      botId: 'bot-contract-a',
      chatType: 'single',
      chatId: 'not-allowed',
      senderUserId: 'participant-a',
    }),
    (error) => error.code === CONVERSATION_ERROR_CODES.threadKeyInvalid,
  );
});

test('group Session scope isolates participants and Intakes', () => {
  const thread = groupThread();
  const first = buildConversationSessionScope({
    threadKey: thread.thread_key,
    participantKey: 'participant-a',
    serviceIntakeId: INTAKE_A,
    creationIdempotencyKey: 'WECOM_AIBOT:message-a',
  });
  const replay = buildConversationSessionScope({
    threadKey: thread.thread_key,
    participantKey: 'participant-a',
    serviceIntakeId: INTAKE_A,
    creationIdempotencyKey: 'WECOM_AIBOT:message-a',
  });
  const otherParticipant = buildConversationSessionScope({
    threadKey: thread.thread_key,
    participantKey: 'participant-b',
    serviceIntakeId: INTAKE_A,
    creationIdempotencyKey: 'WECOM_AIBOT:message-b',
  });
  const otherIntake = buildConversationSessionScope({
    threadKey: thread.thread_key,
    participantKey: 'participant-a',
    serviceIntakeId: INTAKE_B,
    creationIdempotencyKey: 'WECOM_AIBOT:message-c',
  });

  assert.equal(first.session_scope_key, replay.session_scope_key);
  assert.notEqual(first.session_scope_key, otherParticipant.session_scope_key);
  assert.notEqual(first.session_scope_key, otherIntake.session_scope_key);
  assert.doesNotMatch(first.session_scope_key, /participant|018f4f00/u);
  assert.throws(
    () => buildConversationSessionScope({
      threadKey: thread.thread_key,
      participantKey: 'participant-a',
      serviceIntakeId: INTAKE_A,
      creationIdempotencyKey: 'too-short',
    }),
    (error) => error.code === CONVERSATION_ERROR_CODES.idempotencyConflict,
  );
});

test('Session boundary rules cover ended, explicit, different Intake, idle equality, and continuation', () => {
  const active = {
    status: 'OPEN',
    service_intake_id: INTAKE_A,
    last_activity_at: '2026-08-30T01:00:00.000Z',
  };
  assert.deepEqual(decideConversationSessionBoundary({
    receivedAt: '2026-08-30T01:00:00.000Z',
    idleTimeoutMs: 60_000,
  }), { action: 'START_NEW_SESSION', reason: 'NO_ACTIVE_SESSION' });
  assert.deepEqual(decideConversationSessionBoundary({
    currentSession: { ...active, status: 'ENDED' },
    receivedAt: '2026-08-30T01:00:01.000Z',
    idleTimeoutMs: 60_000,
  }), { action: 'START_NEW_SESSION', reason: 'PREVIOUS_SESSION_ENDED' });
  assert.deepEqual(decideConversationSessionBoundary({
    currentSession: active,
    receivedAt: '2026-08-30T01:00:01.000Z',
    idleTimeoutMs: 60_000,
    requestedBoundaryReason: 'EXPLICIT_USER_NEW_TOPIC',
  }), { action: 'START_NEW_SESSION', reason: 'EXPLICIT_USER_NEW_TOPIC' });
  assert.deepEqual(decideConversationSessionBoundary({
    currentSession: active,
    receivedAt: '2026-08-30T01:00:01.000Z',
    idleTimeoutMs: 60_000,
    nextServiceIntakeId: INTAKE_B,
  }), { action: 'START_NEW_SESSION', reason: 'DIFFERENT_INTAKE' });
  assert.deepEqual(decideConversationSessionBoundary({
    currentSession: active,
    receivedAt: '2026-08-30T01:01:00.000Z',
    idleTimeoutMs: 60_000,
    nextServiceIntakeId: INTAKE_A,
  }), { action: 'START_NEW_SESSION', reason: 'IDLE_TIMEOUT' });
  assert.deepEqual(decideConversationSessionBoundary({
    currentSession: active,
    receivedAt: '2026-08-30T01:00:59.999Z',
    idleTimeoutMs: 60_000,
    nextServiceIntakeId: INTAKE_A,
  }), { action: 'CONTINUE_SESSION', reason: null });
});

test('only auditable boundary reasons are accepted from callers', () => {
  assert.throws(
    () => decideConversationSessionBoundary({
      currentSession: {
        status: 'OPEN',
        service_intake_id: INTAKE_A,
        last_activity_at: '2026-08-30T01:00:00.000Z',
      },
      receivedAt: '2026-08-30T01:00:01.000Z',
      idleTimeoutMs: 60_000,
      requestedBoundaryReason: 'AI_HIGH_CONFIDENCE_TOPIC_SWITCH',
    }),
    (error) => error.code === CONVERSATION_ERROR_CODES.boundaryReasonInvalid,
  );
  assert.throws(
    () => decideConversationSessionBoundary({
      currentSession: {
        status: 'OPEN',
        service_intake_id: INTAKE_A,
        last_activity_at: '2026-08-30T01:00:00.000Z',
      },
      receivedAt: '2026-08-30T01:00:01.000Z',
      idleTimeoutMs: 60_000,
      requestedBoundaryReason: 'EXPLICIT_END',
    }),
    (error) => error.code === CONVERSATION_ERROR_CODES.boundaryReasonInvalid,
  );
  assert.throws(
    () => decideConversationSessionBoundary({
      receivedAt: null,
      idleTimeoutMs: 60_000,
    }),
    (error) => error.code === CONVERSATION_ERROR_CODES.idleTimeoutInvalid,
  );
  for (const receivedAt of [
    '2026-02-31T01:00:00Z',
    '2026-08-30T24:00:00Z',
  ]) {
    assert.throws(
      () => decideConversationSessionBoundary({ receivedAt, idleTimeoutMs: 60_000 }),
      (error) => error.code === CONVERSATION_ERROR_CODES.idleTimeoutInvalid,
    );
  }
});

test('Session lifecycle is OPEN/WAITING_USER with ENDED terminal', () => {
  assert.deepEqual(
    evaluateConversationSessionStatusTransition({ fromStatus: 'OPEN', toStatus: 'WAITING_USER' }),
    { ok: true, changed: true, status: 'WAITING_USER' },
  );
  assert.deepEqual(
    evaluateConversationSessionStatusTransition({ fromStatus: 'WAITING_USER', toStatus: 'OPEN' }),
    { ok: true, changed: true, status: 'OPEN' },
  );
  assert.deepEqual(
    evaluateConversationSessionStatusTransition({ fromStatus: 'OPEN', toStatus: 'ENDED' }),
    { ok: true, changed: true, status: 'ENDED' },
  );
  assert.equal(
    evaluateConversationSessionStatusTransition({ fromStatus: 'ENDED', toStatus: 'OPEN' }).error.code,
    CONVERSATION_ERROR_CODES.sessionEnded,
  );
});

test('control modes fail closed, default HUMAN, and reserve AUTO for P2-010/P2-G4', () => {
  const disabled = evaluateConversationControlModeTransition({
    fromMode: 'HUMAN',
    toMode: 'COPILOT',
  });
  assert.equal(disabled.error.code, CONVERSATION_ERROR_CODES.centerDisabled);

  const humanOnly = { CONVERSATION_CENTER_ENABLED: true };
  assert.deepEqual(evaluateConversationControlModeTransition({
    fromMode: 'AUTO',
    toMode: 'HUMAN',
    featureFlags: humanOnly,
  }), {
    ok: true,
    changed: true,
    control_mode: 'HUMAN',
    generation_version_increment: 1,
    row_version_increment: 1,
  });
  assert.equal(evaluateConversationControlModeTransition({
    fromMode: 'HUMAN',
    toMode: 'COPILOT',
    featureFlags: humanOnly,
  }).error.code, CONVERSATION_ERROR_CODES.aiDisabled);

  const copilotEnabled = {
    CONVERSATION_CENTER_ENABLED: true,
    AI_CONVERSATION_ENABLED: true,
  };
  assert.equal(evaluateConversationControlModeTransition({
    fromMode: 'HUMAN',
    toMode: 'COPILOT',
    featureFlags: copilotEnabled,
  }).ok, true);
  assert.equal(evaluateConversationControlModeTransition({
    fromMode: 'COPILOT',
    toMode: 'AUTO',
    featureFlags: copilotEnabled,
  }).error.code, CONVERSATION_ERROR_CODES.autoReplyDisabled);
  assert.equal(evaluateConversationControlModeTransition({
    fromMode: 'COPILOT',
    toMode: 'AUTO',
    featureFlags: { ...copilotEnabled, AI_AUTO_REPLY_ENABLED: true },
  }).error.code, CONVERSATION_ERROR_CODES.controlledAutoNotAuthorized);
});

test('generation and row versions advance only for unique invalidating changes', () => {
  assert.deepEqual(advanceConversationSessionVersions({
    generationVersion: 4,
    rowVersion: 7,
    reason: 'USER_MESSAGE_COMMITTED',
  }), { generation_version: 5, row_version: 8 });
  assert.deepEqual(advanceConversationSessionVersions({
    generationVersion: 4,
    rowVersion: 7,
    reason: 'USER_MESSAGE_COMMITTED',
    duplicate: true,
  }), { generation_version: 4, row_version: 7 });
});

test('disabled guard does not invoke storage or external seams and raw failures stay hidden', async () => {
  let invoked = false;
  const disabled = await runConversationCenterGuarded({
    operation: async () => {
      invoked = true;
      return { ok: true };
    },
  });
  assert.equal(invoked, false);
  assert.equal(disabled.error.code, CONVERSATION_ERROR_CODES.centerDisabled);

  const failed = await runConversationCenterGuarded({
    featureFlags: { CONVERSATION_CENTER_ENABLED: true },
    operation: async () => {
      throw new Error('raw database text with private identifiers');
    },
  });
  assert.deepEqual(failed, {
    ok: false,
    error: { code: CONVERSATION_ERROR_CODES.storageFailed, retryable: true },
  });
  assert.doesNotMatch(JSON.stringify(failed), /private identifiers/u);

  let databaseQueried = false;
  const creationDisabled = await createConversationSessionContractRecord({
    pool: {
      query: async () => {
        databaseQueried = true;
      },
    },
    threadId: '018f4f00-3333-7333-8333-333333333333',
    participantKey: 'participant-a',
    creationIdempotencyKey: 'WECOM_AIBOT:message-disabled',
    lastActivityAt: '2026-08-30T01:00:00.000Z',
  });
  assert.equal(databaseQueried, false);
  assert.equal(creationDisabled.error.code, CONVERSATION_ERROR_CODES.centerDisabled);
});

test('database failures map to stable public errors', () => {
  assert.equal(mapConversationStorageError({
    code: '23505',
    constraint: 'conversation_session_creation_idempotency_key_unique',
  }).error.code, CONVERSATION_ERROR_CODES.idempotencyConflict);
  assert.equal(mapConversationStorageError({
    code: '23505',
    constraint: 'conversation_session_one_active_participant_idx',
  }).error.code, CONVERSATION_ERROR_CODES.activeSessionConflict);
  assert.equal(mapConversationStorageError({
    code: '23503',
    constraint: 'conversation_session_service_intake_fk',
  }).error.code, CONVERSATION_ERROR_CODES.intakeScopeConflict);
});

test('P2-001 migration is limited to Thread and Session and reserves later tasks', async () => {
  const sql = await readFile(
    new URL('../database/migrations/010_p2_001_conversation_contracts.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS conversation\.thread/iu);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS conversation\.session/iu);
  assert.match(sql, /DEFAULT 'HUMAN'/u);
  assert.match(sql, /provider,\s*channel_account_id,\s*chat_type,\s*external_thread_key/iu);
  assert.match(sql, /conversation_thread_key_unique UNIQUE \(thread_key\)/u);
  assert.match(sql, /session_scope_key ~ '\^csk_v1_\[a-f0-9\]\{64\}\$'/u);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS conversation\.(?:item|handoff|read_cursor|realtime_event|projection_checkpoint)/iu);
  assert.doesNotMatch(sql, /CREATE SCHEMA IF NOT EXISTS (?:communication|ai|integration)/iu);
  assert.doesNotMatch(sql, /outbox|delivery|SSE|DeepSeek|OCR|incident/iu);
});

test('JSON Schemas, public OpenAPI view, and TypeScript declarations freeze safe vocabulary', async () => {
  const [threadSchema, sessionSchema, itemSchema, declarations, openapi] = await Promise.all([
    readFile(new URL('../contracts/conversation_thread.schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../contracts/conversation_session.schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../contracts/conversation_item.schema.json', import.meta.url), 'utf8'),
    readFile(new URL('../contracts/conversation_contracts.d.ts', import.meta.url), 'utf8'),
    readFile(new URL('../contracts/conversation_center.openapi.yaml', import.meta.url), 'utf8'),
  ]);
  const thread = JSON.parse(threadSchema);
  const session = JSON.parse(sessionSchema);
  const item = JSON.parse(itemSchema);

  assert.equal(thread.properties.chat_type.enum.includes('group'), true);
  assert.deepEqual(thread['x-unique-fields'], ['thread_key']);
  assert.equal(session.properties.control_mode.default, 'HUMAN');
  assert.deepEqual(session.properties.status.enum, ['OPEN', 'WAITING_USER', 'ENDED']);
  assert.deepEqual(session['x-unique-fields'], ['creation_idempotency_key']);
  assert.equal(session.allOf[0].then.properties.close_reason.type, 'string');
  assert.equal(session.allOf[0].else.properties.close_reason.type, 'null');
  assert.equal(item['x-implementation-task'], 'P2-002');
  assert.match(declarations, /export type ConversationControlMode = 'AUTO' \| 'COPILOT' \| 'HUMAN'/u);
  assert.match(declarations, /interface ConversationThread/u);
  assert.match(declarations, /interface ConversationSession/u);
  assert.match(declarations, /interface ConversationItem/u);
  const publicSession = openapi.slice(
    openapi.indexOf('    ConversationSession:'),
    openapi.indexOf('    ConversationItem:'),
  );
  assert.doesNotMatch(
    publicSession,
    /participant_key|session_scope_key|creation_idempotency_key|conversation_session\.schema/u,
  );
});
