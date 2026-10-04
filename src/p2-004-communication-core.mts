
import type { CommunicationSenderKind, CommunicationPurpose, CommunicationMessageType, CommunicationVisibility, CommunicationCommandResult as CommandResult } from '../contracts/communication_contracts.js';
import type { ConversationChatType, ConversationSessionStatus, ConversationControlMode } from '../contracts/conversation_contracts.js';
import type { PostgresPool, PostgresTransaction } from './platform/postgres-pool.mjs';
export type CommunicationJson = null | boolean | number | string | readonly CommunicationJson[] | { readonly [key: string]: CommunicationJson };
export interface CommunicationCommand {
  client_command_id: string; privacy_class: 'PUBLIC' | 'INTERNAL' | 'SENSITIVE_INTERNAL' | 'PERSONAL' | 'PATIENT_SENSITIVE' | 'SECRET'; retention_until: string;
  session_id?: string | null; expected_row_version?: number; sender_kind?: CommunicationSenderKind; purpose?: CommunicationPurpose; message_type?: CommunicationMessageType;
  visibility?: CommunicationVisibility; text?: string; content?: unknown; reply_to_item_id?: string | null; attachment_ids?: readonly string[]; destination_policy?: string; sender_system_code?: string; retention_until_epoch_ms?: string;
}
export interface NormalizedCommunicationCommand {
  session_id: string | null; expected_row_version: number | null; sender_kind: CommunicationSenderKind; sender_system_code: string | null; purpose: CommunicationPurpose;
  message_type: CommunicationMessageType; visibility: CommunicationVisibility; idempotency_scope: CommunicationSenderKind; client_command_id: string;
  content: Readonly<Record<string, CommunicationJson>>; reply_to_item_id: string | null; attachment_ids: readonly CommunicationJson[]; destination_policy: string; privacy_class: CommunicationCommand['privacy_class']; retention_until: string; retention_until_epoch_ms: string;
}
export interface CommunicationActor { principal_id?: string; admin_override?: boolean; generation_version_at_start?: number }
export interface CommunicationDestination { provider: string; channel_account_id: string; target_type: 'PERSON' | 'GROUP'; target_id: string; target_hash?: string }
export type CommunicationSuccess = Readonly<Omit<CommandResult, 'delivery_ids'> & { delivery_ids: readonly string[] }>;
type PublicFailure = ReturnType<typeof publicError>;
export type CommunicationResult = CommunicationSuccess | PublicFailure | null;
interface MessageRow { id: string; created_at: unknown; command_hash?: string }
interface IdRow { id: string }
interface SessionThreadRow { session_id: string; session_status: ConversationSessionStatus; row_version: string | number; thread_id: string; provider: string; channel_account_id: string; chat_type: ConversationChatType; external_thread_key: string; thread_status: string }
interface SessionContext { ok?: never; session: { id: string; status: ConversationSessionStatus; row_version: number; thread_id: string; control_mode?: ConversationControlMode }; thread: { provider: string; channel_account_id: string; chat_type: ConversationChatType; external_thread_key: string; status: string } }
export interface CommunicationAuthorizationContext extends SessionContext { transaction: PostgresTransaction; command: NormalizedCommunicationCommand; actor: CommunicationActor | null }
export interface CommunicationServiceOptions {
  pool?: PostgresPool; enabled?: boolean; authorizeCommand?: (context: CommunicationAuthorizationContext) => boolean | Promise<boolean>;
  destinationResolver?: (context: SessionContext & { command: NormalizedCommunicationCommand }) => readonly CommunicationDestination[] | Promise<readonly CommunicationDestination[]>;
  nowEpochMs?: (() => unknown) | null; now?: () => Date;
}
type StorageError = { code?: unknown; message?: unknown; constraint?: unknown } | null | undefined;
type LegacyRow = { id: string; outbox_id: string; status: string; channel: string; attempt_count: string | number; last_error_code: string | null; sent_at: unknown };
type LegacyWorker = Pick<ReturnType<typeof createNotificationDeliveryWorker>, 'deliver'>;
type LegacySender = NonNullable<Parameters<typeof createNotificationDeliveryWorker>[0]>['sender'];

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';

import { createNotificationDeliveryWorker } from './p1-007-notification-outbox.mjs';
import {
  assertEpochMsString,
  assertLocalDateTime,
  shanghaiLocalToEpochMs,
} from './platform/time-contract.mjs';

const MIGRATION_URL = new URL('../database/migrations/020_p2_004_unified_communication.sql', import.meta.url);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SYSTEM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENDER_KINDS = Object.freeze(['AGENT', 'AI', 'SYSTEM']);
const PURPOSES = Object.freeze(['HUMAN_REPLY', 'AI_REPLY', 'SYSTEM_NOTIFICATION', 'INTERNAL_NOTE']);
const MESSAGE_TYPES = Object.freeze(['text', 'markdown', 'image', 'file', 'mixed', 'template_card']);
const VISIBILITIES = Object.freeze(['EXTERNAL', 'INTERNAL', 'RESTRICTED']);
const PRIVACY_CLASSES = Object.freeze(['PUBLIC', 'INTERNAL', 'SENSITIVE_INTERNAL', 'PERSONAL', 'PATIENT_SENSITIVE', 'SECRET']);
const MEDIA_TYPES = new Set(['image', 'file', 'mixed', 'template_card']);
const COMMAND_KEYS = new Set([
  'session_id', 'expected_row_version', 'client_command_id', 'sender_kind', 'purpose',
  'message_type', 'visibility', 'text', 'content', 'reply_to_item_id', 'attachment_ids',
  'sender_display_name', 'privacy_class', 'retention_until', 'retention_until_epoch_ms', 'destination_policy',
  'sender_system_code',
]);
const NORMALIZED_COMMANDS = new WeakSet();

export const COMMUNICATION_SENDER_KINDS = SENDER_KINDS;
export const COMMUNICATION_PURPOSES = PURPOSES;
export const COMMUNICATION_MESSAGE_TYPES = MESSAGE_TYPES;
export const COMMUNICATION_VISIBILITIES = VISIBILITIES;
export const COMMUNICATION_DELIVERY_STATUSES = Object.freeze([
  'PENDING', 'LEASED', 'SENDING', 'SENT', 'RECONCILIATION_REQUIRED', 'DEAD_LETTER', 'CANCELLED',
]);
export const COMMUNICATION_ATTEMPT_OUTCOMES = Object.freeze([
  'STARTED', 'SENT', 'RETRY_SCHEDULED', 'RECONCILIATION_REQUIRED', 'DEAD_LETTER', 'CANCELLED',
]);
export const COMMUNICATION_SIDE_EFFECT_STATES = Object.freeze(['NOT_ATTEMPTED', 'ACKNOWLEDGED', 'UNKNOWN']);
export const COMMUNICATION_ERROR_CODES = Object.freeze({
  disabled: 'COMMUNICATION_DISABLED',
  commandInvalid: 'COMMUNICATION_COMMAND_INVALID',
  commandConflict: 'COMMUNICATION_COMMAND_CONFLICT',
  sessionNotFound: 'COMMUNICATION_SESSION_NOT_FOUND',
  sessionEnded: 'COMMUNICATION_SESSION_ENDED',
  sessionVersionConflict: 'COMMUNICATION_SESSION_VERSION_CONFLICT',
  senderUnauthorized: 'COMMUNICATION_SENDER_UNAUTHORIZED',
  destinationInvalid: 'COMMUNICATION_DESTINATION_INVALID',
  mediaNotAuthorized: 'COMMUNICATION_MEDIA_NOT_AUTHORIZED',
  internalOutboxForbidden: 'COMMUNICATION_INTERNAL_OUTBOX_FORBIDDEN',
  deliveryNotFound: 'COMMUNICATION_DELIVERY_NOT_FOUND',
  leaseConflict: 'COMMUNICATION_DELIVERY_LEASE_CONFLICT',
  reconciliationRequired: 'COMMUNICATION_DELIVERY_RECONCILIATION_REQUIRED',
  sendRejected: 'COMMUNICATION_SEND_REJECTED',
  sendTimeout: 'COMMUNICATION_SEND_TIMEOUT',
  storageFailed: 'COMMUNICATION_DELIVERY_STORAGE_FAILED',
  reconciliationUnauthorized: 'COMMUNICATION_RECONCILIATION_NOT_AUTHORIZED',
  schemaDrift: 'P2_004_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
});

export class CommunicationError extends Error {
  declare code: string;
  constructor(code: string) {
    super(code);
    this.name = 'CommunicationError';
    this.code = code;
  }
}

function fail(code: string = COMMUNICATION_ERROR_CODES.commandInvalid): never {
  throw new CommunicationError(code);
}

function publicError(code: string, retryable = false) {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, retryable }),
  });
}

function ownDataRecord(value: unknown, { maximumKeys = 32 } = {}): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  let prototype;
  let keys;
  let symbols;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    symbols = Object.getOwnPropertySymbols(value);
  } catch {
    fail();
  }
  if (prototype !== Object.prototype && prototype !== null) fail();
  if (symbols.length > 0 || keys.length > maximumKeys) fail();
  for (const key of keys) {
    if (typeof key !== 'string' || key.length < 1 || key.length > 64 || POLLUTION_KEYS.has(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) fail();
  }
  if (Object.hasOwn(value, 'toJSON')) fail();
  return keys as string[];
}

export function snapshotCommunicationJson(value: unknown, limits: { maximumDepth?: number; maximumNodes?: number; maximumArrayLength?: number; maximumStringLength?: number } = {}): CommunicationJson {
  const maximumDepth = limits.maximumDepth ?? 8;
  const maximumNodes = limits.maximumNodes ?? 256;
  const maximumArrayLength = limits.maximumArrayLength ?? 32;
  const maximumStringLength = limits.maximumStringLength ?? 20_480;
  let nodes = 0;
  const seen = new Set();

  function visit(current: unknown, depth: number): CommunicationJson {
    nodes += 1;
    if (nodes > maximumNodes || depth > maximumDepth) fail();
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'string') {
      if (current.length > maximumStringLength) fail();
      return current;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) fail();
      return current;
    }
    if (typeof current !== 'object') fail();
    if (seen.has(current)) fail();
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype || current.length > maximumArrayLength) fail();
        const ownKeys = Reflect.ownKeys(current);
        if (ownKeys.some((key) => typeof key === 'symbol' || (!/^\d+$/u.test(key) && key !== 'length'))) fail();
        return (current as unknown[]).map((entry) => visit(entry, depth + 1));
      }
      const result: Record<string, CommunicationJson> = Object.create(null);
      for (const key of ownDataRecord(current)) {
        result[key] = visit((Object.getOwnPropertyDescriptor(current, key) as PropertyDescriptor).value as unknown, depth + 1);
      }
      return result;
    } finally {
      seen.delete(current);
    }
  }

  return visit(value, 0);
}

function requiredString(value: unknown, maximum = 256, pattern: RegExp | null = null): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || (pattern && !pattern.test(value))) fail();
  return value;
}

function nullableUuid(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, 36, UUID_PATTERN).toLowerCase();
}

function requiredUuid(value: unknown): string {
  const normalized = nullableUuid(value);
  if (normalized === null) fail();
  return normalized;
}

function instant(value: unknown) {
  try { return assertLocalDateTime(value); }
  catch { fail(); }
}

function canonicalJson(value: CommunicationJson): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, CommunicationJson>)[key] as CommunicationJson)}`).join(',')}}`;
  }
  return JSON.stringify(value) as string;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function iso(value: unknown) {
  try { return assertLocalDateTime(value); }
  catch { fail(COMMUNICATION_ERROR_CODES.storageFailed); }
}

function normalizeContent(input: Record<string, unknown>, messageType: string): Readonly<Record<string, CommunicationJson>> {
  if (input.content !== undefined && input.text !== undefined) fail();
  let content;
  if (input.content !== undefined) {
    content = snapshotCommunicationJson(input.content);
  } else {
    const text = requiredString(input.text, 20_480);
    content = Object.assign(Object.create(null), { text });
  }
  if (content === null || Array.isArray(content) || typeof content !== 'object') fail();
  if ((messageType === 'text' || messageType === 'markdown') && requiredString((content as Record<string, CommunicationJson>).text, 20_480).length < 1) fail();
  return content as Readonly<Record<string, CommunicationJson>>;
}

function validateTopLevel(input: unknown): asserts input is Record<string, unknown> {
  for (const key of ownDataRecord(input, { maximumKeys: 24 })) {
    if (!COMMAND_KEYS.has(key)) fail();
  }
  for (const forbidden of ['target_id', 'targetId', 'channel_account_id', 'provider', 'lease_token', 'delivery_status', 'sender_principal_id']) {
    if (Object.hasOwn(input as object, forbidden)) fail();
  }
}

export function normalizeCommunicationCommand(input: unknown): NormalizedCommunicationCommand {
  validateTopLevel(input);
  const senderKind = input.sender_kind as CommunicationSenderKind ?? 'AGENT';
  if (!SENDER_KINDS.includes(senderKind as CommunicationSenderKind)) fail();
  const inferredPurpose = senderKind === 'AGENT' ? 'HUMAN_REPLY' : senderKind === 'AI' ? 'AI_REPLY' : 'SYSTEM_NOTIFICATION';
  const purpose = input.purpose as CommunicationPurpose ?? inferredPurpose;
  if (!PURPOSES.includes(purpose as CommunicationPurpose)) fail();
  const messageType = requiredString(input.message_type ?? 'text', 32);
  if (!MESSAGE_TYPES.includes(messageType as CommunicationMessageType)) fail();
  const visibility = input.visibility as CommunicationVisibility ?? (purpose === 'INTERNAL_NOTE' ? 'INTERNAL' : 'EXTERNAL');
  if (!VISIBILITIES.includes(visibility as CommunicationVisibility)) fail();
  if (purpose === 'INTERNAL_NOTE' ? !['INTERNAL', 'RESTRICTED'].includes(visibility as string) : visibility === 'INTERNAL') fail();
  if ((senderKind === 'AGENT' && !['HUMAN_REPLY', 'INTERNAL_NOTE'].includes(purpose as string))
    || (senderKind === 'AI' && purpose !== 'AI_REPLY')
    || (senderKind === 'SYSTEM' && !['SYSTEM_NOTIFICATION', 'INTERNAL_NOTE'].includes(purpose as string))) fail();
  const sessionId = nullableUuid(input.session_id);
  if (senderKind !== 'SYSTEM' && sessionId === null) fail();
  if (!Number.isSafeInteger(input.expected_row_version) || (input.expected_row_version as number) < 1) {
    if (!(senderKind === 'SYSTEM' && sessionId === null && input.expected_row_version === undefined)) fail();
  }
  const privacyClass = requiredString(input.privacy_class, 32);
  if (!PRIVACY_CLASSES.includes(privacyClass as CommunicationCommand['privacy_class'])) fail();
  const retentionUntil = instant(input.retention_until);
  let retentionUntilEpochMs;
  try {
    retentionUntilEpochMs = input.retention_until_epoch_ms === undefined
      ? shanghaiLocalToEpochMs(retentionUntil)
      : assertEpochMsString(input.retention_until_epoch_ms);
  } catch { fail(); }
  const attachmentIds = input.attachment_ids === undefined
    ? []
    : snapshotCommunicationJson(input.attachment_ids, { maximumArrayLength: 10, maximumNodes: 12 });
  if (!Array.isArray(attachmentIds) || attachmentIds.some((id) => !UUID_PATTERN.test(id as string))) fail();
  const content = normalizeContent(input, messageType);
  const senderSystemCode = senderKind === 'AGENT'
    ? null
    : requiredString(input.sender_system_code ?? (senderKind === 'AI' ? 'AI_ORCHESTRATOR' : 'SYSTEM'), 64, SYSTEM_CODE_PATTERN);
  const normalized = Object.freeze({
    session_id: sessionId,
    expected_row_version: input.expected_row_version as number | null | undefined ?? null,
    sender_kind: senderKind,
    sender_system_code: senderSystemCode,
    purpose,
    message_type: messageType as CommunicationMessageType,
    visibility,
    idempotency_scope: senderKind,
    client_command_id: requiredUuid(input.client_command_id),
    content: Object.freeze(content),
    reply_to_item_id: nullableUuid(input.reply_to_item_id),
    attachment_ids: Object.freeze([...attachmentIds]),
    destination_policy: requiredString(input.destination_policy ?? (purpose === 'SYSTEM_NOTIFICATION' ? 'TRUSTED_DESTINATIONS' : 'SESSION_THREAD'), 64),
    privacy_class: privacyClass as CommunicationCommand['privacy_class'],
    retention_until: retentionUntil,
    retention_until_epoch_ms: retentionUntilEpochMs,
  });
  NORMALIZED_COMMANDS.add(normalized);
  return normalized as NormalizedCommunicationCommand;
}

export function computeCommunicationContentHash(content: unknown) {
  const snapshot = snapshotCommunicationJson(content);
  return sha256(canonicalJson(snapshot));
}

export function computeCommunicationCommandHash(command: CommunicationCommand | NormalizedCommunicationCommand) {
  const normalized = NORMALIZED_COMMANDS.has(command) ? command as NormalizedCommunicationCommand : normalizeCommunicationCommand(command);
  // retention_until is server policy metadata that Workbench recomputes on
  // each request; it must not turn the same client command into a conflict.
  return sha256(canonicalJson({
    session_id: normalized.session_id,
    expected_row_version: normalized.expected_row_version,
    sender_kind: normalized.sender_kind,
    purpose: normalized.purpose,
    message_type: normalized.message_type,
    visibility: normalized.visibility,
    content: normalized.content,
    reply_to_item_id: normalized.reply_to_item_id,
    attachment_ids: normalized.attachment_ids,
    destination_policy: normalized.destination_policy,
    privacy_class: normalized.privacy_class,
  }));
}

export function resolveCommunicationDestination({ thread }: { thread: SessionContext['thread'] }) {
  if (!thread || thread.provider !== 'WECOM_AIBOT' || !['single', 'group'].includes(thread.chat_type)) {
    fail(COMMUNICATION_ERROR_CODES.destinationInvalid);
  }
  return Object.freeze([Object.freeze({
    provider: thread.provider,
    channel_account_id: requiredString(thread.channel_account_id, 256),
    target_type: thread.chat_type === 'single' ? 'PERSON' : 'GROUP',
    target_id: requiredString(thread.external_thread_key, 512),
  })]);
}

function normalizeDestinations(destinations: readonly CommunicationDestination[]) {
  if (!Array.isArray(destinations) || destinations.length < 1 || destinations.length > 20) fail(COMMUNICATION_ERROR_CODES.destinationInvalid);
  const seen = new Set();
  return destinations.map((destination) => {
    const keys = ownDataRecord(destination, { maximumKeys: 5 });
    if (keys.some((key) => !['provider', 'channel_account_id', 'target_type', 'target_id', 'target_hash'].includes(key))) fail(COMMUNICATION_ERROR_CODES.destinationInvalid);
    const provider = requiredString(destination.provider, 64);
    const channelAccountId = requiredString(destination.channel_account_id, 256);
    const targetType = requiredString(destination.target_type, 16) as CommunicationDestination['target_type'];
    const targetId = requiredString(destination.target_id, 512);
    if (provider !== 'WECOM_AIBOT' || !['PERSON', 'GROUP'].includes(targetType)) fail(COMMUNICATION_ERROR_CODES.destinationInvalid);
    const targetHash = sha256(targetId);
    if (destination.target_hash !== undefined && destination.target_hash !== targetHash) fail(COMMUNICATION_ERROR_CODES.destinationInvalid);
    const identity = `${provider}\u0000${channelAccountId}\u0000${targetType}\u0000${targetHash}`;
    if (seen.has(identity)) fail(COMMUNICATION_ERROR_CODES.destinationInvalid);
    seen.add(identity);
    return Object.freeze({ provider, channel_account_id: channelAccountId, target_type: targetType, target_id: targetId, target_hash: targetHash });
  });
}

function commandResultFromRows(message: MessageRow, outbox: IdRow | null, deliveries: readonly IdRow[], replayed: boolean): CommunicationSuccess {
  return Object.freeze({
    message_id: message.id,
    outbox_id: outbox?.id ?? null,
    delivery_ids: Object.freeze(deliveries.map((delivery) => delivery.id)),
    command_status: replayed ? 'REPLAYED' : 'COMMITTED',
    replayed,
    created_at: iso(message.created_at),
  });
}

async function readExistingCommand(transaction: PostgresTransaction, command: NormalizedCommunicationCommand): Promise<CommunicationResult> {
  const messageResult = await transaction.query<MessageRow>(
    `SELECT id::text, command_hash, created_at
       FROM communication.message
      WHERE idempotency_scope = $1 AND client_command_id = $2::uuid`,
    [command.idempotency_scope, command.client_command_id],
  );
  if (messageResult.rowCount === 0) return null;
  if (messageResult.rowCount !== 1) fail(COMMUNICATION_ERROR_CODES.storageFailed);
  if ((messageResult.rows[0] as MessageRow).command_hash !== computeCommunicationCommandHash(command)) {
    return publicError(COMMUNICATION_ERROR_CODES.commandConflict);
  }
  const outboxResult = await transaction.query<IdRow>(
    'SELECT id::text FROM communication.outbox WHERE message_id = $1::uuid',
    [(messageResult.rows[0] as MessageRow).id],
  );
  const deliveries = outboxResult.rowCount === 0 ? { rows: [] } : await transaction.query<IdRow>(
    'SELECT id::text FROM communication.delivery WHERE outbox_id = $1::uuid ORDER BY id',
    [(outboxResult.rows[0] as IdRow).id],
  );
  return commandResultFromRows((messageResult.rows[0] as MessageRow), (outboxResult.rows[0] as IdRow) ?? null, deliveries.rows, true);
}

export async function appendCommunication({ transaction, command, actor, resolvedDestinations = [] }: { transaction: PostgresTransaction; command: CommunicationCommand | NormalizedCommunicationCommand; actor: CommunicationActor | null; resolvedDestinations?: readonly CommunicationDestination[] }): Promise<CommunicationResult> {
  if (!transaction || typeof transaction.query !== 'function') fail(COMMUNICATION_ERROR_CODES.storageFailed);
  const normalized = NORMALIZED_COMMANDS.has(command) ? command as NormalizedCommunicationCommand : normalizeCommunicationCommand(command);
  const existing = await readExistingCommand(transaction, normalized);
  if (existing !== null) return existing;
  const isInternal = normalized.purpose === 'INTERNAL_NOTE';
  const destinations = isInternal ? [] : normalizeDestinations(resolvedDestinations);
  if (isInternal && resolvedDestinations.length > 0) return publicError(COMMUNICATION_ERROR_CODES.internalOutboxForbidden);
  const senderPrincipalId = normalized.sender_kind === 'AGENT' ? requiredUuid(actor?.principal_id) : null;
  const commandHash = computeCommunicationCommandHash(normalized);
  const contentHash = computeCommunicationContentHash(normalized.content);
  const inserted = await transaction.query<MessageRow>(
    `INSERT INTO communication.message (
       session_id, sender_kind, sender_principal_id, sender_system_code, purpose,
       message_type, visibility, idempotency_scope, client_command_id, command_hash,
       content, content_hash, reply_to_conversation_item_id, privacy_class, retention_until,
       retention_until_epoch_ms
     ) VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9::uuid,$10,$11::jsonb,$12,$13::uuid,$14,$15::timestamp without time zone,$16::bigint)
     ON CONFLICT (idempotency_scope, client_command_id) DO NOTHING
     RETURNING id::text, created_at`,
    [normalized.session_id, normalized.sender_kind, senderPrincipalId, normalized.sender_system_code,
      normalized.purpose, normalized.message_type, normalized.visibility, normalized.idempotency_scope,
      normalized.client_command_id, commandHash, JSON.stringify(normalized.content), contentHash,
      normalized.reply_to_item_id, normalized.privacy_class, normalized.retention_until,
      normalized.retention_until_epoch_ms],
  );
  if (inserted.rowCount === 0) return readExistingCommand(transaction, normalized);
  const message = inserted.rows[0] as MessageRow;
  if (isInternal) return commandResultFromRows(message, null, [], false);

  const outboxKey = `comm_v1_${sha256(`${normalized.idempotency_scope}\u0000${normalized.client_command_id}`)}`;
  const outboxResult = await transaction.query<IdRow>(
    `INSERT INTO communication.outbox (message_id, idempotency_key, route_policy)
     VALUES ($1::uuid,$2,$3) RETURNING id::text`,
    [message.id, outboxKey, normalized.destination_policy],
  );
  const deliveries = [];
  for (const destination of destinations) {
    const deliveryKey = `comm_delivery_v1_${sha256(`${outboxKey}\u0000${destination.provider}\u0000${destination.channel_account_id}\u0000${destination.target_type}\u0000${destination.target_hash}`)}`;
    const delivery = await transaction.query<IdRow>(
      `INSERT INTO communication.delivery (
         outbox_id, provider, channel_account_id, target_type, target_id, target_hash, idempotency_key
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
      [(outboxResult.rows[0] as IdRow).id, destination.provider, destination.channel_account_id,
        destination.target_type, destination.target_id, destination.target_hash, deliveryKey],
    );
    deliveries.push(delivery.rows[0] as IdRow);
  }
  return commandResultFromRows(message, (outboxResult.rows[0] as IdRow), deliveries, false);
}

async function withTransaction<T>(pool: PostgresPool | undefined, operation: (transaction: PostgresTransaction) => Promise<T>): Promise<T> {
  if (!pool || typeof pool.connect !== 'function') fail(COMMUNICATION_ERROR_CODES.storageFailed);
  const client = await pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { destroy = true; }
    throw error;
  } finally {
    client.release(destroy);
  }
}

async function loadSessionAndThread(transaction: PostgresTransaction, command: NormalizedCommunicationCommand): Promise<SessionContext | PublicFailure> {
  const result = await transaction.query<SessionThreadRow>(
    `SELECT session.id::text AS session_id, session.status AS session_status,
            session.row_version, session.thread_id::text,
            thread.provider, thread.channel_account_id, thread.chat_type,
            thread.external_thread_key, thread.status AS thread_status
       FROM conversation.session AS session
       JOIN conversation.thread AS thread ON thread.id = session.thread_id
      WHERE session.id = $1::uuid
      FOR UPDATE OF session, thread`,
    [command.session_id],
  );
  if (result.rowCount !== 1) return publicError(COMMUNICATION_ERROR_CODES.sessionNotFound);
  const row = result.rows[0] as SessionThreadRow;
  if (row.session_status === 'ENDED') return publicError(COMMUNICATION_ERROR_CODES.sessionEnded);
  if (Number(row.row_version) !== command.expected_row_version) return publicError(COMMUNICATION_ERROR_CODES.sessionVersionConflict);
  return Object.freeze({
    session: Object.freeze({ id: row.session_id, status: row.session_status, row_version: Number(row.row_version), thread_id: row.thread_id }),
    thread: Object.freeze({ provider: row.provider, channel_account_id: row.channel_account_id, chat_type: row.chat_type, external_thread_key: row.external_thread_key, status: row.thread_status }),
  });
}

function mapStorageError(error: unknown) {
  if (error instanceof CommunicationError) return publicError(error.code);
  if ((error as StorageError)?.message === COMMUNICATION_ERROR_CODES.schemaDrift) return publicError(COMMUNICATION_ERROR_CODES.schemaDrift);
  if ((error as StorageError)?.code === '23505' && (error as StorageError)?.constraint === 'communication_message_command_unique') return publicError(COMMUNICATION_ERROR_CODES.commandConflict);
  return publicError(COMMUNICATION_ERROR_CODES.storageFailed, true);
}

export function createCommunicationService({
  pool,
  enabled = false,
  authorizeCommand = async () => false,
  destinationResolver = resolveCommunicationDestination,
  nowEpochMs = null,
  now = () => new Date(),
}: CommunicationServiceOptions = {}) {
  if (typeof enabled !== 'boolean' || typeof authorizeCommand !== 'function' || typeof destinationResolver !== 'function'
    || (nowEpochMs !== null && typeof nowEpochMs !== 'function') || typeof now !== 'function') throw new TypeError('Communication service configuration is invalid.');

  async function guarded<T>(operation: () => Promise<T>): Promise<T | PublicFailure> {
    if (!enabled) return publicError(COMMUNICATION_ERROR_CODES.disabled);
    try { return await operation(); } catch (error) { return mapStorageError(error); }
  }

  function withOverrides(command: CommunicationCommand, overrides: Partial<CommunicationCommand>) {
    validateTopLevel(command);
    return Object.assign({}, command, overrides);
  }

  function validateRetentionBoundary(normalized: NormalizedCommunicationCommand) {
    let current;
    try {
      if (nowEpochMs !== null) current = BigInt(assertEpochMsString(nowEpochMs()));
      else {
        const value = now();
        if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < 0) fail();
        current = BigInt(value.getTime());
      }
    }
    catch { fail(); }
    if (BigInt(normalized.retention_until_epoch_ms) <= current) fail();
  }

  async function commitExternalMessage({ command, actor }: { command: CommunicationCommand; actor: CommunicationActor }) {
    return guarded(async () => {
      const normalized = normalizeCommunicationCommand(command);
      validateRetentionBoundary(normalized);
      if (!['HUMAN_REPLY', 'AI_REPLY'].includes(normalized.purpose) || normalized.visibility !== 'EXTERNAL') fail();
      if (MEDIA_TYPES.has(normalized.message_type) || normalized.attachment_ids.length > 0) return publicError(COMMUNICATION_ERROR_CODES.mediaNotAuthorized);
      return withTransaction(pool, async (transaction) => {
        const context = await loadSessionAndThread(transaction, normalized);
        if (context.ok === false) return context;
        if (await authorizeCommand({ transaction, command: normalized, actor, ...context }) !== true) return publicError(COMMUNICATION_ERROR_CODES.senderUnauthorized);
        const resolved = await destinationResolver({ command: normalized, ...context });
        return appendCommunication({ transaction, command: normalized, actor, resolvedDestinations: resolved });
      });
    });
  }

  async function commitInternalNote({ command, actor }: { command: CommunicationCommand; actor: CommunicationActor }) {
    return guarded(async () => {
      validateTopLevel(command);
      const senderKind: CommunicationSenderKind = Object.getOwnPropertyDescriptor(command, 'sender_kind')?.value ?? 'AGENT';
      const normalized = normalizeCommunicationCommand(withOverrides(command, { sender_kind: senderKind, purpose: 'INTERNAL_NOTE', message_type: 'text', visibility: 'INTERNAL' }));
      validateRetentionBoundary(normalized);
      return withTransaction(pool, async (transaction) => {
        const context = await loadSessionAndThread(transaction, normalized);
        if (context.ok === false) return context;
        if (await authorizeCommand({ transaction, command: normalized, actor, ...context }) !== true) return publicError(COMMUNICATION_ERROR_CODES.senderUnauthorized);
        return appendCommunication({ transaction, command: normalized, actor, resolvedDestinations: [] });
      });
    });
  }

  async function commitSystemNotification({ command, trustedDestinations }: { command: CommunicationCommand; trustedDestinations: readonly CommunicationDestination[] }) {
    return guarded(async () => {
      validateTopLevel(command);
      const visibility: CommunicationVisibility = Object.getOwnPropertyDescriptor(command, 'visibility')?.value ?? 'EXTERNAL';
      const normalized = normalizeCommunicationCommand(withOverrides(command, { sender_kind: 'SYSTEM', purpose: 'SYSTEM_NOTIFICATION', visibility }));
      validateRetentionBoundary(normalized);
      if (MEDIA_TYPES.has(normalized.message_type)) return publicError(COMMUNICATION_ERROR_CODES.mediaNotAuthorized);
      const destinations = normalizeDestinations(trustedDestinations);
      return withTransaction(pool, async (transaction) => appendCommunication({ transaction, command: normalized, actor: null, resolvedDestinations: destinations }));
    });
  }

  return Object.freeze({ commitExternalMessage, commitInternalNote, commitSystemNotification });
}

function safeLegacyDelivery(row: LegacyRow) {
  return Object.freeze({
    source_kind: 'P1_NOTIFICATION',
    delivery_id: row.id,
    outbox_id: row.outbox_id,
    status: row.status,
    channel: row.channel,
    attempt_count: Number(row.attempt_count),
    last_error_code: row.last_error_code,
    sent_at: row.sent_at === null ? null : iso(row.sent_at),
  });
}

export function createP1NotificationCompatibilityAdapter({ pool, legacyWorker, sender }: { pool?: PostgresPool; legacyWorker?: LegacyWorker; sender?: LegacySender } = {}) {
  const delegatedWorker = legacyWorker ?? (sender ? createNotificationDeliveryWorker({ pool, sender } as NonNullable<Parameters<typeof createNotificationDeliveryWorker>[0]>) : null);
  if (!pool || typeof pool.query !== 'function' || !delegatedWorker || typeof delegatedWorker.deliver !== 'function') throw new TypeError('P1 compatibility requires a pool and existing notification delivery worker.');
  return Object.freeze({
    async getLegacyDeliveryView({ deliveryId }: { deliveryId: string }) {
      const id = requiredUuid(deliveryId);
      const result = await (pool as PostgresPool).query<LegacyRow>(
        `SELECT id::text, outbox_id::text, status, channel, attempt_count, last_error_code, sent_at
           FROM notification.delivery WHERE id = $1::uuid`, [id],
      );
      return result.rowCount === 1 ? safeLegacyDelivery(result.rows[0] as LegacyRow) : null;
    },
    async listLegacyDeliveryViews({ afterCreatedAt = '1970-01-01 08:00:00', limit = 50 }: { afterCreatedAt?: string; limit?: number } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail();
      const result = await (pool as PostgresPool).query<LegacyRow>(
        `SELECT id::text, outbox_id::text, status, channel, attempt_count, last_error_code, sent_at
           FROM notification.delivery WHERE created_at > $1::timestamp without time zone
          ORDER BY created_at, id LIMIT $2::integer`, [instant(afterCreatedAt), limit],
      );
      return Object.freeze(result.rows.map(safeLegacyDelivery));
    },
    async deliverLegacy({ deliveryId }: { deliveryId: string }) {
      return (delegatedWorker as LegacyWorker).deliver({ deliveryId: requiredUuid(deliveryId) });
    },
  });
}

export async function applyCommunicationMigration({ pool }: { pool: PostgresTransaction }) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL pool is required.');
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  try { await pool.query(sql); } catch (error) {
    if ((error as StorageError)?.message === COMMUNICATION_ERROR_CODES.schemaDrift) throw error;
    throw error;
  }
}

export function isCommunicationHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}
