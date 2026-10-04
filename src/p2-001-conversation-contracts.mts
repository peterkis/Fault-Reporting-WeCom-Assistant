
import type { ConversationChatType, ConversationSessionStatus, ConversationControlMode, ConversationSession } from '../contracts/conversation_contracts.js';
import type { LocalDateTime } from '../contracts/time_contracts.js';
import type { PostgresTransaction } from './platform/postgres-pool.mjs';
type SessionRow = Omit<ConversationSession, 'generation_version' | 'row_version' | 'started_at' | 'last_activity_at' | 'ended_at' | 'created_at' | 'updated_at'> & {
  generation_version: string | number; row_version: string | number; started_at: unknown; last_activity_at: unknown; ended_at: unknown; created_at: unknown; updated_at: unknown;
};
type FeatureFlags = Record<keyof typeof CONVERSATION_FEATURE_FLAG_DEFAULTS, boolean>;
type StorageError = { code?: unknown; message?: unknown; constraint?: unknown } | null | undefined;
type BoundarySession = Pick<ConversationSession, 'status' | 'service_intake_id' | 'last_activity_at'> & { last_activity_epoch_ms: unknown };

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import { assertEpochMsString, assertLocalDateTime } from './platform/time-contract.mjs';
import { postgresTimestampToLocalDateTime } from './platform/postgres-types.mjs';

const MIGRATION_URL = new URL(
  '../database/migrations/010_p2_001_conversation_contracts.sql',
  import.meta.url,
);

export const CONVERSATION_CHAT_TYPES = Object.freeze(['single', 'group']);
export const CONVERSATION_SESSION_STATUSES = Object.freeze(['OPEN', 'WAITING_USER', 'ENDED']);
export const CONVERSATION_CONTROL_MODES = Object.freeze(['AUTO', 'COPILOT', 'HUMAN']);

export const CONVERSATION_FEATURE_FLAG_DEFAULTS = Object.freeze({
  CONVERSATION_CENTER_ENABLED: false,
  CONVERSATION_REALTIME_SSE_ENABLED: false,
  HUMAN_WORKBENCH_V2_ENABLED: false,
  AI_TRIAGE_ENABLED: false,
  AI_CONVERSATION_ENABLED: false,
  AI_AUTO_REPLY_ENABLED: false,
  OCR_ENABLED: false,
  INCIDENT_CORRELATION_ENABLED: false,
});

export const CONVERSATION_BOUNDARY_REASONS = Object.freeze([
  'NO_ACTIVE_SESSION',
  'PREVIOUS_SESSION_ENDED',
  'IDLE_TIMEOUT',
  'EXPLICIT_USER_NEW_TOPIC',
  'MANUAL_NEW_INTAKE',
  'DIFFERENT_INTAKE',
  'DIFFERENT_TICKET',
]);

const CALLER_BOUNDARY_REASONS = new Set([
  'EXPLICIT_USER_NEW_TOPIC',
  'MANUAL_NEW_INTAKE',
  'DIFFERENT_TICKET',
]);

const GENERATION_INVALIDATION_REASONS = new Set([
  'USER_MESSAGE_COMMITTED',
  'CONTROL_MODE_CHANGED',
  'SESSION_ENDED',
]);

const STATUS_TRANSITIONS: Readonly<Record<ConversationSessionStatus, ReadonlySet<ConversationSessionStatus>>> = Object.freeze({
  OPEN: new Set<ConversationSessionStatus>(['WAITING_USER', 'ENDED']),
  WAITING_USER: new Set<ConversationSessionStatus>(['OPEN', 'ENDED']),
  ENDED: new Set<ConversationSessionStatus>(),
});

const ERROR_CODES = Object.freeze({
  centerDisabled: 'CONVERSATION_CENTER_DISABLED',
  threadKeyInvalid: 'CONVERSATION_THREAD_KEY_INVALID',
  participantKeyInvalid: 'CONVERSATION_PARTICIPANT_KEY_INVALID',
  idleTimeoutInvalid: 'CONVERSATION_IDLE_TIMEOUT_INVALID',
  sessionEnded: 'CONVERSATION_SESSION_ENDED',
  activeSessionConflict: 'CONVERSATION_ACTIVE_SESSION_CONFLICT',
  intakeScopeConflict: 'CONVERSATION_INTAKE_SCOPE_CONFLICT',
  boundaryReasonInvalid: 'CONVERSATION_BOUNDARY_REASON_INVALID',
  controlModeInvalid: 'CONVERSATION_CONTROL_MODE_INVALID',
  controlModeForbidden: 'CONVERSATION_CONTROL_MODE_TRANSITION_FORBIDDEN',
  aiDisabled: 'CONVERSATION_AI_DISABLED',
  autoReplyDisabled: 'CONVERSATION_AUTO_REPLY_DISABLED',
  controlledAutoNotAuthorized: 'CONVERSATION_CONTROLLED_AUTO_NOT_AUTHORIZED',
  expectedRowVersionConflict: 'CONVERSATION_EXPECTED_ROW_VERSION_CONFLICT',
  idempotencyConflict: 'CONVERSATION_IDEMPOTENCY_CONFLICT',
  storageFailed: 'CONVERSATION_STORAGE_FAILED',
  schemaDrift: 'P2_001_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
});

export const CONVERSATION_ERROR_CODES = ERROR_CODES;

export class ConversationContractError extends Error {
  declare code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ConversationContractError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeBoundedString(value: unknown, maximum: number, code: string): string {
  if (
    typeof value !== 'string'
    || !value.isWellFormed()
    || value.length < 1
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(code);
  }
  return value;
}

function nullableUuid(value: unknown, code: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    fail(code);
  }
  return value.toLowerCase();
}

function requiredUuid(value: unknown, code: string): string {
  const normalized = nullableUuid(value, code);
  if (normalized === null) {
    fail(code);
  }
  return normalized;
}

function validDateTime(value: unknown, code: string): LocalDateTime {
  try { return assertLocalDateTime(value); }
  catch { fail(code); }
}

function positiveSafeInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(code);
  }
  return value;
}

function opaqueDigest(prefix: string, tuple: readonly unknown[]) {
  const digest = createHash('sha256')
    .update(JSON.stringify([prefix, ...tuple]))
    .digest('hex');
  return `${prefix}_${digest}`;
}

function publicError(code: string, retryable = false) {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, retryable }),
  });
}

function isoTimestamp(value: unknown) {
  return postgresTimestampToLocalDateTime(value);
}

function conversationSessionFromRow(row: SessionRow) {
  return Object.freeze({
    id: row.id,
    thread_id: row.thread_id,
    participant_key: row.participant_key,
    service_intake_id: row.service_intake_id,
    session_scope_key: row.session_scope_key,
    creation_idempotency_key: row.creation_idempotency_key,
    status: row.status,
    control_mode: row.control_mode,
    generation_version: Number(row.generation_version),
    row_version: Number(row.row_version),
    started_at: isoTimestamp(row.started_at),
    last_activity_at: isoTimestamp(row.last_activity_at),
    ended_at: row.ended_at === null ? null : isoTimestamp(row.ended_at),
    close_reason: row.close_reason,
    created_at: isoTimestamp(row.created_at),
    updated_at: isoTimestamp(row.updated_at),
  });
}

export function normalizeConversationFeatureFlags(flags: unknown = {}) {
  if (!isRecord(flags)) {
    fail(ERROR_CODES.controlModeForbidden);
  }
  const normalized: Partial<FeatureFlags> = {};
  for (const [name, defaultValue] of Object.entries(CONVERSATION_FEATURE_FLAG_DEFAULTS)) {
    const value = Object.hasOwn(flags, name) ? flags[name] : defaultValue;
    if (typeof value !== 'boolean') {
      fail(ERROR_CODES.controlModeForbidden);
    }
    normalized[name as keyof FeatureFlags] = value;
  }
  return Object.freeze(normalized as FeatureFlags);
}

export function buildConversationThreadIdentity({
  provider,
  botId,
  chatType,
  chatId = null,
  senderUserId,
}: { provider: string; botId: string; chatType: ConversationChatType; chatId?: string | null; senderUserId: string }) {
  const normalizedProvider = safeBoundedString(provider, 64, ERROR_CODES.threadKeyInvalid);
  const channelAccountId = safeBoundedString(botId, 256, ERROR_CODES.threadKeyInvalid);
  const participantKey = safeBoundedString(
    senderUserId,
    256,
    ERROR_CODES.participantKeyInvalid,
  );
  if (!CONVERSATION_CHAT_TYPES.includes(chatType)) {
    fail(ERROR_CODES.threadKeyInvalid);
  }

  let externalThreadKey;
  if (chatType === 'single') {
    if (chatId !== null && chatId !== undefined) {
      fail(ERROR_CODES.threadKeyInvalid);
    }
    externalThreadKey = participantKey;
  } else {
    externalThreadKey = safeBoundedString(chatId, 256, ERROR_CODES.threadKeyInvalid);
  }

  return Object.freeze({
    provider: normalizedProvider,
    channel_account_id: channelAccountId,
    chat_type: chatType,
    external_thread_key: externalThreadKey,
    participant_key: participantKey,
    thread_key: opaqueDigest('ctk_v1', [
      normalizedProvider,
      channelAccountId,
      chatType,
      externalThreadKey,
    ]),
  });
}

export function buildConversationSessionScope({
  threadKey,
  participantKey,
  serviceIntakeId = null,
  creationIdempotencyKey,
}: { threadKey: string; participantKey: string; serviceIntakeId?: string | null; creationIdempotencyKey: string }) {
  const normalizedThreadKey = safeBoundedString(
    threadKey,
    80,
    ERROR_CODES.threadKeyInvalid,
  );
  if (!/^ctk_v1_[a-f0-9]{64}$/u.test(normalizedThreadKey)) {
    fail(ERROR_CODES.threadKeyInvalid);
  }
  const normalizedParticipantKey = safeBoundedString(
    participantKey,
    256,
    ERROR_CODES.participantKeyInvalid,
  );
  const normalizedIntakeId = nullableUuid(serviceIntakeId, ERROR_CODES.intakeScopeConflict);
  const normalizedIdempotencyKey = safeBoundedString(
    creationIdempotencyKey,
    256,
    ERROR_CODES.idempotencyConflict,
  );
  if (normalizedIdempotencyKey.length < 16) {
    fail(ERROR_CODES.idempotencyConflict);
  }

  return Object.freeze({
    participant_key: normalizedParticipantKey,
    service_intake_id: normalizedIntakeId,
    creation_idempotency_key: normalizedIdempotencyKey,
    session_scope_key: opaqueDigest('csk_v1', [
      normalizedThreadKey,
      normalizedParticipantKey,
      normalizedIntakeId ?? 'UNBOUND',
    ]),
  });
}

export function decideConversationSessionBoundary({
  currentSession = null,
  receivedAt,
  receivedEpochMs,
  idleTimeoutMs,
  requestedBoundaryReason = null,
  nextServiceIntakeId = null,
}: { currentSession?: BoundarySession | null; receivedAt: string; receivedEpochMs: string; idleTimeoutMs: number; requestedBoundaryReason?: string | null; nextServiceIntakeId?: string | null }) {
  validDateTime(receivedAt, ERROR_CODES.idleTimeoutInvalid);
  positiveSafeInteger(idleTimeoutMs, ERROR_CODES.idleTimeoutInvalid);
  const normalizedNextIntakeId = nullableUuid(
    nextServiceIntakeId,
    ERROR_CODES.intakeScopeConflict,
  );

  if (requestedBoundaryReason !== null && !CALLER_BOUNDARY_REASONS.has(requestedBoundaryReason)) {
    fail(ERROR_CODES.boundaryReasonInvalid);
  }
  if (currentSession === null) {
    return Object.freeze({ action: 'START_NEW_SESSION', reason: 'NO_ACTIVE_SESSION' });
  }
  if (!isRecord(currentSession) || !CONVERSATION_SESSION_STATUSES.includes(currentSession.status)) {
    fail(ERROR_CODES.sessionEnded);
  }
  if (currentSession.status === 'ENDED') {
    return Object.freeze({ action: 'START_NEW_SESSION', reason: 'PREVIOUS_SESSION_ENDED' });
  }
  if (requestedBoundaryReason !== null) {
    return Object.freeze({ action: 'START_NEW_SESSION', reason: requestedBoundaryReason });
  }

  const currentIntakeId = nullableUuid(
    currentSession.service_intake_id,
    ERROR_CODES.intakeScopeConflict,
  );
  if (
    currentIntakeId !== null
    && normalizedNextIntakeId !== null
    && currentIntakeId !== normalizedNextIntakeId
  ) {
    return Object.freeze({ action: 'START_NEW_SESSION', reason: 'DIFFERENT_INTAKE' });
  }

  validDateTime(
    currentSession.last_activity_at,
    ERROR_CODES.idleTimeoutInvalid,
  );
  let receivedEpoch;
  try { receivedEpoch = BigInt(assertEpochMsString(receivedEpochMs)); }
  catch { fail(ERROR_CODES.idleTimeoutInvalid); }
  let lastActivityEpoch;
  try { lastActivityEpoch = BigInt(assertEpochMsString(currentSession.last_activity_epoch_ms)); }
  catch { fail(ERROR_CODES.idleTimeoutInvalid); }
  if (receivedEpoch >= lastActivityEpoch + BigInt(idleTimeoutMs)) {
    return Object.freeze({ action: 'START_NEW_SESSION', reason: 'IDLE_TIMEOUT' });
  }
  return Object.freeze({ action: 'CONTINUE_SESSION', reason: null });
}

export function evaluateConversationSessionStatusTransition({ fromStatus, toStatus }: { fromStatus: ConversationSessionStatus; toStatus: ConversationSessionStatus }) {
  if (
    !CONVERSATION_SESSION_STATUSES.includes(fromStatus)
    || !CONVERSATION_SESSION_STATUSES.includes(toStatus)
  ) {
    return publicError(ERROR_CODES.sessionEnded);
  }
  if (fromStatus === toStatus) {
    return Object.freeze({ ok: true as const, changed: false, status: fromStatus });
  }
  if (!STATUS_TRANSITIONS[fromStatus].has(toStatus)) {
    return publicError(ERROR_CODES.sessionEnded);
  }
  return Object.freeze({ ok: true as const, changed: true, status: toStatus });
}

export function evaluateConversationControlModeTransition({
  fromMode,
  toMode,
  featureFlags = {},
}: { fromMode: ConversationControlMode; toMode: ConversationControlMode; featureFlags?: unknown }) {
  if (!CONVERSATION_CONTROL_MODES.includes(fromMode) || !CONVERSATION_CONTROL_MODES.includes(toMode)) {
    return publicError(ERROR_CODES.controlModeInvalid);
  }

  let flags;
  try {
    flags = normalizeConversationFeatureFlags(featureFlags);
  } catch {
    return publicError(ERROR_CODES.controlModeForbidden);
  }
  if (!flags.CONVERSATION_CENTER_ENABLED) {
    return publicError(ERROR_CODES.centerDisabled);
  }
  if (fromMode === toMode) {
    return Object.freeze({
      ok: true as const,
      changed: false,
      control_mode: fromMode,
      generation_version_increment: 0,
      row_version_increment: 0,
    });
  }
  if (toMode === 'HUMAN') {
    return Object.freeze({
      ok: true as const,
      changed: true,
      control_mode: 'HUMAN',
      generation_version_increment: 1,
      row_version_increment: 1,
    });
  }
  if (!flags.AI_CONVERSATION_ENABLED) {
    return publicError(ERROR_CODES.aiDisabled);
  }
  if (toMode === 'COPILOT') {
    return Object.freeze({
      ok: true as const,
      changed: true,
      control_mode: 'COPILOT',
      generation_version_increment: 1,
      row_version_increment: 1,
    });
  }
  if (!flags.AI_AUTO_REPLY_ENABLED) {
    return publicError(ERROR_CODES.autoReplyDisabled);
  }

  // P2-001 freezes AUTO as a contract value only. P2-010 and P2-G4 must
  // establish the separate Controlled Auto authorization before it can be entered.
  return publicError(ERROR_CODES.controlledAutoNotAuthorized);
}

export function advanceConversationSessionVersions({
  generationVersion,
  rowVersion,
  reason,
  duplicate = false,
}: { generationVersion: number; rowVersion: number; reason: string; duplicate?: boolean }) {
  const generation = positiveSafeInteger(
    generationVersion,
    ERROR_CODES.expectedRowVersionConflict,
  );
  const row = positiveSafeInteger(rowVersion, ERROR_CODES.expectedRowVersionConflict);
  if (!GENERATION_INVALIDATION_REASONS.has(reason)) {
    fail(ERROR_CODES.controlModeForbidden);
  }
  if (typeof duplicate !== 'boolean') {
    fail(ERROR_CODES.idempotencyConflict);
  }
  if (duplicate) {
    return Object.freeze({ generation_version: generation, row_version: row });
  }
  if (generation === Number.MAX_SAFE_INTEGER || row === Number.MAX_SAFE_INTEGER) {
    fail(ERROR_CODES.expectedRowVersionConflict);
  }
  return Object.freeze({
    generation_version: generation + 1,
    row_version: row + 1,
  });
}

export function mapConversationStorageError(error: unknown) {
  if (
    (error as StorageError)?.code === '23514'
    && (error as StorageError)?.message === ERROR_CODES.schemaDrift
  ) {
    return publicError(ERROR_CODES.schemaDrift);
  }
  if (
    (error as StorageError)?.code === '23505'
    && (error as StorageError)?.constraint === 'conversation_session_creation_idempotency_key_unique'
  ) {
    return publicError(ERROR_CODES.idempotencyConflict);
  }
  if (
    (error as StorageError)?.code === '23505'
    && (error as StorageError)?.constraint === 'conversation_session_one_active_participant_idx'
  ) {
    return publicError(ERROR_CODES.activeSessionConflict, true);
  }
  if (
    (error as StorageError)?.code === '23503'
    && (error as StorageError)?.constraint === 'conversation_session_service_intake_fk'
  ) {
    return publicError(ERROR_CODES.intakeScopeConflict);
  }
  if (
    (error as StorageError)?.code === '23503'
    && (error as StorageError)?.constraint === 'conversation_session_thread_fk'
  ) {
    return publicError(ERROR_CODES.threadKeyInvalid);
  }
  return publicError(ERROR_CODES.storageFailed, true);
}

export async function runConversationCenterGuarded<T>({ featureFlags = {}, operation }: { featureFlags?: unknown; operation?: () => T | Promise<T> }) {
  let flags;
  try {
    flags = normalizeConversationFeatureFlags(featureFlags);
  } catch {
    return publicError(ERROR_CODES.controlModeForbidden);
  }
  if (!flags.CONVERSATION_CENTER_ENABLED) {
    return publicError(ERROR_CODES.centerDisabled);
  }
  if (typeof operation !== 'function') {
    return publicError(ERROR_CODES.controlModeForbidden);
  }
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ConversationContractError) {
      return publicError(error.code);
    }
    return mapConversationStorageError(error);
  }
}

export async function createConversationSessionContractRecord({
  pool,
  threadId,
  participantKey,
  serviceIntakeId = null,
  creationIdempotencyKey,
  lastActivityAt,
  featureFlags = {},
}: { pool?: PostgresTransaction; threadId: string; participantKey: string; serviceIntakeId?: string | null; creationIdempotencyKey: string; lastActivityAt: string; featureFlags?: unknown }) {
  return runConversationCenterGuarded({
    featureFlags,
    operation: async () => {
      if (!pool || typeof pool.query !== 'function') {
        fail(ERROR_CODES.storageFailed);
      }

      const normalizedThreadId = requiredUuid(threadId, ERROR_CODES.threadKeyInvalid);
      const normalizedParticipantKey = safeBoundedString(
        participantKey,
        256,
        ERROR_CODES.participantKeyInvalid,
      );
      const normalizedServiceIntakeId = nullableUuid(
        serviceIntakeId,
        ERROR_CODES.intakeScopeConflict,
      );
      const normalizedCreationKey = safeBoundedString(
        creationIdempotencyKey,
        256,
        ERROR_CODES.idempotencyConflict,
      );
      if (normalizedCreationKey.length < 16) {
        fail(ERROR_CODES.idempotencyConflict);
      }
      const normalizedActivityAt = validDateTime(
        lastActivityAt,
        ERROR_CODES.idleTimeoutInvalid,
      );
      const columns = `
        id::text, thread_id::text, participant_key, service_intake_id::text,
        session_scope_key, creation_idempotency_key, status, control_mode,
        generation_version, row_version, started_at, last_activity_at,
        ended_at, close_reason, created_at, updated_at`;

      const priorReplay = await pool.query<SessionRow>(
        `SELECT ${columns}
           FROM conversation.session
          WHERE creation_idempotency_key = $1`,
        [normalizedCreationKey],
      );
      if (priorReplay.rowCount === 1) {
        const existing = priorReplay.rows[0] as SessionRow;
        if (
          existing.thread_id !== normalizedThreadId
          || existing.participant_key !== normalizedParticipantKey
          || existing.service_intake_id !== normalizedServiceIntakeId
        ) {
          return publicError(ERROR_CODES.idempotencyConflict);
        }
        return Object.freeze({
          ok: true as const,
          replayed: true,
          session: conversationSessionFromRow(existing),
        });
      }
      if (priorReplay.rowCount !== 0) {
        return publicError(ERROR_CODES.storageFailed, true);
      }

      const threadResult = await pool.query<{ thread_key: string }>(
        'SELECT thread_key FROM conversation.thread WHERE id = $1::uuid',
        [normalizedThreadId],
      );
      if (threadResult.rowCount !== 1) {
        return publicError(ERROR_CODES.threadKeyInvalid);
      }

      const scope = buildConversationSessionScope({
        threadKey: (threadResult.rows[0] as { thread_key: string }).thread_key,
        participantKey: normalizedParticipantKey,
        serviceIntakeId: normalizedServiceIntakeId,
        creationIdempotencyKey: normalizedCreationKey,
      });
      const values = [
        normalizedThreadId,
        normalizedParticipantKey,
        normalizedServiceIntakeId,
        scope.session_scope_key,
        normalizedCreationKey,
        normalizedActivityAt,
      ];
      const inserted = await pool.query<SessionRow>(
        `INSERT INTO conversation.session (
           thread_id, participant_key, service_intake_id,
           session_scope_key, creation_idempotency_key, last_activity_at
         ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::timestamp without time zone)
         ON CONFLICT ON CONSTRAINT conversation_session_creation_idempotency_key_unique
         DO NOTHING
         RETURNING ${columns}`,
        values,
      );
      if (inserted.rowCount === 1) {
        return Object.freeze({
          ok: true as const,
          replayed: false,
          session: conversationSessionFromRow(inserted.rows[0] as SessionRow),
        });
      }

      const replay = await pool.query<SessionRow>(
        `SELECT ${columns}
           FROM conversation.session
          WHERE creation_idempotency_key = $1`,
        [normalizedCreationKey],
      );
      if (replay.rowCount !== 1) {
        return publicError(ERROR_CODES.storageFailed, true);
      }
      const existing = replay.rows[0] as SessionRow;
      if (
        existing.thread_id !== normalizedThreadId
        || existing.participant_key !== normalizedParticipantKey
        || existing.service_intake_id !== normalizedServiceIntakeId
        || existing.session_scope_key !== scope.session_scope_key
      ) {
        return publicError(ERROR_CODES.idempotencyConflict);
      }
      return Object.freeze({
        ok: true as const,
        replayed: true,
        session: conversationSessionFromRow(existing),
      });
    },
  });
}

export async function applyConversationContractsMigration({ pool }: { pool: PostgresTransaction }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}
