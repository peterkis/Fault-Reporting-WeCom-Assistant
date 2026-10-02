import { readFile } from 'node:fs/promises';
import { arch005MigrationApplied } from './platform/legacy-migration-guard.mjs';
import { types as utilTypes } from 'node:util';
import type { LocalDateTime, PhysicalEpochMs } from '../contracts/time_contracts.js';
import {
  assertEpochMsString,
  assertLocalDateTime,
  formatEpochMsToShanghaiLocal,
  shanghaiLocalToEpochMs,
} from './platform/time-contract.mjs';
import type {
  PostgresPool,
  PostgresPoolClient,
  PostgresQueryResult,
  PostgresQueryRow,
  PostgresTransaction,
} from './platform/postgres-pool.mjs';

const MIGRATION_URL = new URL('../database/migrations/001_p1_003_channel_message_inbox.sql', import.meta.url);
const PRIVACY_CLASSES = new Set([
  'PUBLIC',
  'INTERNAL',
  'SENSITIVE_INTERNAL',
  'PERSONAL',
  'PATIENT_SENSITIVE',
  'SECRET',
]);
const MESSAGE_TYPES = new Set(['text', 'image', 'mixed', 'voice', 'file', 'video']);
const MESSAGE_FIELDS = [
  'schema_version',
  'provider',
  'idempotency_key',
  'msg_id',
  'req_id',
  'bot_id',
  'chat_type',
  'chat_id',
  'sender_user_id',
  'msg_type',
  'provider_create_epoch_ms',
  'create_time',
  'received_epoch_ms',
  'received_at',
  'content',
  'quote',
] as const;

type PrivacyClass = 'PUBLIC' | 'INTERNAL' | 'SENSITIVE_INTERNAL' | 'PERSONAL' | 'PATIENT_SENSITIVE' | 'SECRET';
type MessageType = 'text' | 'image' | 'mixed' | 'voice' | 'file' | 'video';
type QuoteMessageType = Exclude<MessageType, 'video'>;
type ChatType = 'single' | 'group';

export interface TextContent {
  kind: 'text';
  text: { raw: string; clean: string };
  source?: 'VOICE_TRANSCRIPT';
}

export interface MediaContent {
  kind: 'media';
  media: { type: 'image' | 'file' | 'video'; source_index: number; download_ref: string };
}

export type MessageContent = TextContent | MediaContent;

interface MessageQuote {
  msg_type: QuoteMessageType;
  content: MessageContent[];
}

export interface InboxMessage {
  schema_version: 1;
  provider: 'WECOM_AIBOT';
  idempotency_key: string;
  msg_id: string;
  req_id: string;
  bot_id: string;
  chat_type: ChatType;
  chat_id: string | null;
  sender_user_id: string;
  msg_type: MessageType;
  provider_create_epoch_ms: PhysicalEpochMs | null;
  create_time: LocalDateTime | null;
  received_epoch_ms: PhysicalEpochMs;
  received_at: LocalDateTime;
  content: MessageContent[];
  quote: MessageQuote | null;
}

interface InboxRequest {
  message: InboxMessage;
  traceId: string;
  privacyClass: PrivacyClass;
  retentionUntil: LocalDateTime;
  rawPayloadEncrypted?: Uint8Array;
  retentionUntilEpochMs?: PhysicalEpochMs;
}

type PlainJson = null | boolean | number | string | PlainJson[] | { [key: string]: PlainJson };
type ProcessingResult = Record<string, unknown>;
interface ProcessFirstInput {
  channelMessageId: string;
  message: InboxMessage;
  transaction: PostgresTransaction;
}
type ProcessFirst = (input: ProcessFirstInput) => ProcessingResult | Promise<ProcessingResult>;
interface InboxSuccess {
  ok: true;
  duplicate: boolean;
  channelMessageId: string;
  result: ProcessingResult;
}
interface InboxFailure {
  ok: false;
  error: { code: string; retryable: boolean; reason?: string };
}
type InboxResult = InboxSuccess | InboxFailure;
interface InboxService {
  accept: (request: unknown, processFirst: ProcessFirst) => Promise<InboxResult>;
}
interface InboxMigrationOptions { pool: PostgresPool }
interface TimeContractRow { enabled: boolean }
interface InsertedMessageRow { id: string }
interface ExistingMessageRow {
  id: string;
  processing_status: string;
  response_snapshot: ProcessingResult;
}

class InboxInputError extends Error {
  declare reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function storageSafeString(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\u0000')) return false;
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function boundedString(value: unknown, maxLength: number): value is string {
  return storageSafeString(value) && value.length > 0 && value.length <= maxLength;
}

function validDateTime(value: unknown): value is LocalDateTime {
  try { assertLocalDateTime(value); return true; }
  catch { return false; }
}

function hasExactFields(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((field) => Object.hasOwn(value, field))
    && keys.every((field) => allowed.has(field));
}

function validateContent(content: unknown, reason: string): asserts content is MessageContent[] {
  if (!Array.isArray(content) || content.length < 1 || content.length > 10) {
    throw new InboxInputError(reason);
  }
  for (const item of content) {
    if (!isRecord(item)) {
      throw new InboxInputError(reason);
    }
    if (item.kind === 'text') {
      if (!hasExactFields(item, ['kind', 'text'], ['source']) || !isRecord(item.text)) {
        throw new InboxInputError(reason);
      }
      if (
        !hasExactFields(item.text, ['raw', 'clean'])
        || !boundedString(item.text.raw, 20_000)
        || !storageSafeString(item.text.clean)
        || item.text.clean.length > 20_000
        || (Object.hasOwn(item, 'source') && item.source !== 'VOICE_TRANSCRIPT')
      ) {
        throw new InboxInputError(reason);
      }
      continue;
    }
    if (item.kind === 'media') {
      if (!hasExactFields(item, ['kind', 'media']) || !isRecord(item.media)) {
        throw new InboxInputError(reason);
      }
      const media = item.media as { type: unknown; source_index: unknown; download_ref: unknown };
      if (
        !hasExactFields(media, ['type', 'source_index', 'download_ref'])
        || typeof media.type !== 'string'
        || !['image', 'file', 'video'].includes(media.type)
        || !Number.isInteger(media.source_index)
        || (media.source_index as number) < 0
        || (media.source_index as number) > 9
        || typeof media.download_ref !== 'string'
        || !/^wmr_[a-f0-9]{32}$/.test(media.download_ref)
      ) {
        throw new InboxInputError(reason);
      }
      continue;
    }
    throw new InboxInputError(reason);
  }
}

function validateMessage(message: unknown): asserts message is InboxMessage {
  if (!isRecord(message)) {
    throw new InboxInputError('MESSAGE_OBJECT_REQUIRED');
  }
  if (!hasExactFields(message, MESSAGE_FIELDS)) {
    throw new InboxInputError('MESSAGE_FIELDS_INVALID');
  }
  const candidate = message as Record<string, unknown> & InboxMessage;
  if (candidate.schema_version !== 1) {
    throw new InboxInputError('MESSAGE_SCHEMA_VERSION_INVALID');
  }
  if (candidate.provider !== 'WECOM_AIBOT' || !boundedString(candidate.msg_id, 256)) {
    throw new InboxInputError('MESSAGE_IDENTITY_INVALID');
  }
  if (candidate.idempotency_key !== `${candidate.provider}:${candidate.msg_id}`) {
    throw new InboxInputError('IDEMPOTENCY_KEY_INVALID');
  }
  if (!boundedString(candidate.req_id, 256) || !boundedString(candidate.bot_id, 256)) {
    throw new InboxInputError('MESSAGE_CHANNEL_IDENTITY_INVALID');
  }
  if (!['single', 'group'].includes(candidate.chat_type)) {
    throw new InboxInputError('MESSAGE_CHAT_TYPE_INVALID');
  }
  if (
    (candidate.chat_type === 'single' && candidate.chat_id !== null)
    || (candidate.chat_type === 'group' && !boundedString(candidate.chat_id, 256))
  ) {
    throw new InboxInputError('MESSAGE_CHAT_ID_INVALID');
  }
  if (!boundedString(candidate.sender_user_id, 256) || !MESSAGE_TYPES.has(candidate.msg_type)) {
    throw new InboxInputError('MESSAGE_CONTENT_IDENTITY_INVALID');
  }
  if (candidate.create_time !== null && !validDateTime(candidate.create_time)) {
    throw new InboxInputError('MESSAGE_CREATE_TIME_INVALID');
  }
  if (!validDateTime(candidate.received_at)) {
    throw new InboxInputError('MESSAGE_RECEIVED_AT_INVALID');
  }
  try {
    const receivedEpochMs = assertEpochMsString(candidate.received_epoch_ms);
    if (formatEpochMsToShanghaiLocal(receivedEpochMs) !== candidate.received_at) {
      throw new Error('received mismatch');
    }
    if (candidate.provider_create_epoch_ms === null) {
      if (candidate.create_time !== null) throw new Error('provider mismatch');
    } else {
      const providerEpochMs = assertEpochMsString(candidate.provider_create_epoch_ms);
      if (formatEpochMsToShanghaiLocal(providerEpochMs) !== candidate.create_time) throw new Error('provider mismatch');
    }
  } catch {
    throw new InboxInputError('MESSAGE_EPOCH_TIME_MISMATCH');
  }
  validateContent(candidate.content, 'MESSAGE_CONTENT_INVALID');
  if (candidate.quote !== null) {
    if (
      !hasExactFields(candidate.quote, ['msg_type', 'content'])
      || !['text', 'image', 'mixed', 'voice', 'file'].includes(candidate.quote.msg_type)
    ) {
      throw new InboxInputError('MESSAGE_QUOTE_INVALID');
    }
    validateContent(candidate.quote.content, 'MESSAGE_QUOTE_INVALID');
  }
}

function validateRequest(request: unknown): asserts request is InboxRequest {
  if (!isRecord(request)) {
    throw new InboxInputError('REQUEST_OBJECT_REQUIRED');
  }
  if (!hasExactFields(
    request,
    ['message', 'traceId', 'privacyClass', 'retentionUntil'],
    ['rawPayloadEncrypted', 'retentionUntilEpochMs'],
  )) {
    throw new InboxInputError('REQUEST_FIELDS_INVALID');
  }
  const candidate = request as Record<string, unknown> & InboxRequest;
  validateMessage(candidate.message);
  if (!boundedString(candidate.traceId, 128)) {
    throw new InboxInputError('TRACE_ID_INVALID');
  }
  if (!PRIVACY_CLASSES.has(candidate.privacyClass)) {
    throw new InboxInputError('PRIVACY_CLASS_INVALID');
  }
  if (!validDateTime(candidate.retentionUntil)) {
    throw new InboxInputError('RETENTION_UNTIL_INVALID');
  }
  let retentionEpochMs;
  try {
    retentionEpochMs = candidate.retentionUntilEpochMs === undefined
      ? shanghaiLocalToEpochMs(candidate.retentionUntil)
      : assertEpochMsString(candidate.retentionUntilEpochMs);
  } catch {
    throw new InboxInputError('RETENTION_UNTIL_EPOCH_INVALID');
  }
  if (formatEpochMsToShanghaiLocal(retentionEpochMs) !== candidate.retentionUntil) {
    throw new InboxInputError('RETENTION_UNTIL_EPOCH_MISMATCH');
  }
  if (BigInt(retentionEpochMs) <= BigInt(candidate.message.received_epoch_ms)) {
    throw new InboxInputError('RETENTION_UNTIL_NOT_AFTER_RECEIVED_AT');
  }
  if (
    candidate.rawPayloadEncrypted !== undefined
    && (
      (!Buffer.isBuffer(candidate.rawPayloadEncrypted)
        && !(candidate.rawPayloadEncrypted instanceof Uint8Array))
      || candidate.rawPayloadEncrypted.byteLength === 0
    )
  ) {
    throw new InboxInputError('ENCRYPTED_RAW_PAYLOAD_BYTES_REQUIRED');
  }
}

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return Object.freeze(value) as T;
}

function validatedRequestSnapshot(request: unknown): InboxRequest {
  let snapshot: InboxRequest;
  try {
    snapshot = structuredClone(request) as InboxRequest;
  } catch {
    throw new InboxInputError('REQUEST_SNAPSHOT_INVALID');
  }
  if (snapshot.retentionUntilEpochMs === undefined) {
    snapshot.retentionUntilEpochMs = shanghaiLocalToEpochMs(snapshot.retentionUntil);
  }
  validateRequest(snapshot);
  if (snapshot.rawPayloadEncrypted !== undefined) {
    snapshot.rawPayloadEncrypted = Buffer.from(snapshot.rawPayloadEncrypted);
  }
  snapshot.message = deepFreeze(snapshot.message);
  return Object.freeze(snapshot);
}

function textColumns(message: InboxMessage): { rawText: string | null; cleanText: string | null } {
  const textItems = message.content.filter((item): item is TextContent => item.kind === 'text');
  if (textItems.length === 0) {
    return { rawText: null, cleanText: null };
  }
  return {
    rawText: textItems.map((item) => item.text.raw).join('\n'),
    cleanText: textItems.map((item) => item.text.clean).join('\n'),
  };
}

function snapshotPlainJsonValue(value: unknown, ancestors: Set<object> = new Set()): PlainJson {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (!storageSafeString(value)) {
      throw new InboxInputError('PROCESSING_RESULT_NOT_PLAIN_JSON');
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InboxInputError('PROCESSING_RESULT_NOT_PLAIN_JSON');
    }
    return value;
  }
  if (typeof value !== 'object' || ancestors.has(value) || utilTypes.isProxy(value)) {
    throw new InboxInputError('PROCESSING_RESULT_NOT_PLAIN_JSON');
  }

  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      throw new InboxInputError('PROCESSING_RESULT_NOT_PLAIN_JSON');
    }
    const snapshot: PlainJson[] = [];
    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor?.enumerable
        || !Object.hasOwn(descriptor, 'value')
      ) {
        throw new InboxInputError('PROCESSING_RESULT_NOT_PLAIN_JSON');
      }
      Object.defineProperty(snapshot, String(index), {
        configurable: true,
        enumerable: true,
        value: snapshotPlainJsonValue(descriptor.value, ancestors),
        writable: true,
      });
    }
    for (const key of Reflect.ownKeys(value)) {
      const numericIndex = typeof key === 'string' ? Number(key) : Number.NaN;
      if (
        key !== 'length'
        && (
          !Number.isInteger(numericIndex)
          || numericIndex < 0
          || numericIndex >= value.length
          || String(numericIndex) !== key
        )
      ) {
        throw new InboxInputError('PROCESSING_RESULT_NOT_PLAIN_JSON');
      }
    }
    ancestors.delete(value);
    Object.setPrototypeOf(snapshot, null);
    return snapshot;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InboxInputError('PROCESSING_RESULT_NOT_PLAIN_JSON');
  }

  const snapshot: { [key: string]: PlainJson } = Object.create(null) as { [key: string]: PlainJson };
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string'
      || !storageSafeString(key)
      || !descriptor?.enumerable
      || !Object.hasOwn(descriptor, 'value')
    ) {
      throw new InboxInputError('PROCESSING_RESULT_NOT_PLAIN_JSON');
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: snapshotPlainJsonValue(descriptor.value, ancestors),
      writable: true,
    });
  }
  ancestors.delete(value);
  return snapshot;
}

function responseSnapshot(result: ProcessingResult): { serialized: string; snapshot: ProcessingResult } {
  if (!isRecord(result)) {
    throw new InboxInputError('PROCESSING_RESULT_OBJECT_REQUIRED');
  }
  const safeSnapshot = snapshotPlainJsonValue(result);
  let serialized;
  try {
    serialized = JSON.stringify(safeSnapshot);
  } catch {
    throw new InboxInputError('PROCESSING_RESULT_NOT_JSON_SERIALIZABLE');
  }
  if (serialized === undefined) {
    throw new InboxInputError('PROCESSING_RESULT_NOT_JSON_SERIALIZABLE');
  }
  const snapshot: unknown = JSON.parse(serialized);
  if (!isRecord(snapshot)) {
    throw new InboxInputError('PROCESSING_RESULT_OBJECT_REQUIRED');
  }
  return { serialized, snapshot };
}

function leadingSqlKeywords(sql: string, maximum = 5): string[] {
  const keywords: string[] = [];
  let offset = 0;

  while (keywords.length < maximum) {
    let skippedIgnorable;
    do {
      skippedIgnorable = false;
      while (offset < sql.length && /\s/u.test(sql[offset] ?? '')) {
        offset += 1;
        skippedIgnorable = true;
      }
      if (sql.startsWith('--', offset)) {
        const lineEndMatch = /[\r\n]/u.exec(sql.slice(offset + 2));
        if (!lineEndMatch) {
          offset = sql.length;
        } else {
          offset += 2 + lineEndMatch.index + 1;
          if (sql[offset - 1] === '\r' && sql[offset] === '\n') {
            offset += 1;
          }
        }
        skippedIgnorable = true;
        continue;
      }
      if (sql.startsWith('/*', offset)) {
        let depth = 1;
        offset += 2;
        while (offset < sql.length && depth > 0) {
          if (sql.startsWith('/*', offset)) {
            depth += 1;
            offset += 2;
          } else if (sql.startsWith('*/', offset)) {
            depth -= 1;
            offset += 2;
          } else {
            offset += 1;
          }
        }
        if (depth > 0) {
          return keywords;
        }
        skippedIgnorable = true;
      }
    } while (skippedIgnorable);

    const keyword = /^[A-Za-z_][A-Za-z_0-9$]*/u.exec(sql.slice(offset));
    if (!keyword) {
      break;
    }
    keywords.push(keyword[0].toUpperCase());
    offset += keyword[0].length;
  }
  return keywords;
}

function isTransactionControlQuery(sql: string): boolean {
  const keywords = leadingSqlKeywords(sql);
  const first = keywords[0];
  if (
    [
      'BEGIN',
      'COMMIT',
      'END',
      'ROLLBACK',
      'ABORT',
      'SAVEPOINT',
      'SET',
      'RESET',
      'DISCARD',
    ].includes(first ?? '')
  ) {
    return true;
  }
  if (/\bset_config\b/iu.test(sql)) {
    return true;
  }
  const leadingPhrase = keywords.join(' ');
  return leadingPhrase.startsWith('START TRANSACTION')
    || leadingPhrase.startsWith('RELEASE SAVEPOINT')
    || leadingPhrase.startsWith('PREPARE TRANSACTION');
}

function transactionQuery<R extends PostgresQueryRow = Record<string, unknown>>(
  client: PostgresPoolClient,
  queryText: string,
  values?: unknown[],
): Promise<PostgresQueryResult<R>> {
  if (typeof queryText !== 'string' || queryText.trim().length === 0) {
    throw new InboxInputError('TRANSACTION_QUERY_INVALID');
  }
  if (values !== undefined && !Array.isArray(values)) {
    throw new InboxInputError('TRANSACTION_QUERY_INVALID');
  }
  const withoutTrailingTerminator = queryText.trim().replace(/;\s*$/u, '');
  if (withoutTrailingTerminator.includes(';')) {
    throw new InboxInputError('TRANSACTION_MULTIPLE_STATEMENTS_NOT_ALLOWED');
  }
  if (isTransactionControlQuery(withoutTrailingTerminator)) {
    throw new InboxInputError('TRANSACTION_CONTROL_NOT_ALLOWED');
  }
  return client.query<R>(queryText, values);
}

function revocableTransactionView(client: PostgresPoolClient): {
  transaction: PostgresTransaction;
  revokeAndDrain(): Promise<void>;
} {
  let active = true;
  const queryOutcomes: Promise<{ ok: true } | { ok: false; error: unknown }>[] = [];
  return Object.freeze({
    transaction: Object.freeze({
      async query<R extends PostgresQueryRow = Record<string, unknown>>(
        queryConfig: string,
        values?: unknown[],
      ): Promise<PostgresQueryResult<R>> {
        if (!active) {
          return Promise.reject(new InboxInputError('TRANSACTION_VIEW_CLOSED'));
        }
        const queryPromise = Promise.resolve()
          .then(() => transactionQuery<R>(client, queryConfig, values));
        queryOutcomes.push(queryPromise.then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error }),
        ));
        return queryPromise;
      },
    }),
    async revokeAndDrain() {
      active = false;
      const failed = (await Promise.all(queryOutcomes)).find((outcome) => !outcome.ok);
      if (failed) {
        throw failed.error;
      }
    },
  });
}

function publicError(code: string, retryable: boolean, reason?: string): InboxFailure {
  return {
    ok: false,
    error: {
      code,
      retryable,
      ...(reason ? { reason } : {}),
    },
  };
}

async function rollbackAndShouldDestroyClient(client: PostgresPoolClient): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return false;
  } catch {
    return true;
  }
}

export async function applyChannelMessageInboxMigration({ pool }: InboxMigrationOptions): Promise<{ status: 'LEGACY_MIGRATION_SUPERSEDED' } | undefined> {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  if (await arch005MigrationApplied(pool)) return Object.freeze({ status: 'LEGACY_MIGRATION_SUPERSEDED' });
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export function createChannelMessageInbox({ pool }: InboxMigrationOptions): InboxService {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }

  return Object.freeze({
    async accept(request: unknown, processFirst: ProcessFirst): Promise<InboxResult> {
      let requestSnapshot;
      try {
        requestSnapshot = validatedRequestSnapshot(request);
      } catch (error) {
        if (error instanceof InboxInputError) {
          return publicError('CHANNEL_INBOX_INVALID_INPUT', false, error.reason);
        }
        throw error;
      }
      if (typeof processFirst !== 'function') {
        return publicError('CHANNEL_INBOX_INVALID_INPUT', false, 'PROCESS_FIRST_REQUIRED');
      }

      let client: PostgresPoolClient;
      try {
        client = await pool.connect();
      } catch {
        return publicError('CHANNEL_INBOX_UNAVAILABLE', true);
      }

      let failureKind = 'STORAGE';
      let destroyClient = false;
      try {
        await client.query('BEGIN');
        const { message } = requestSnapshot;
        const { rawText, cleanText } = textColumns(message);
        const timeContract = await client.query<TimeContractRow>(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema='channel' AND table_name='message_inbox'
                AND column_name='received_epoch_ms'
           ) AS enabled`,
        );
        const commonValues = [
            message.schema_version,
            message.provider,
            message.msg_id,
            message.idempotency_key,
            message.req_id,
            message.bot_id,
            message.chat_type,
            message.chat_id,
            message.sender_user_id,
            message.msg_type,
            message.create_time,
            message.received_at,
            rawText,
            cleanText,
            JSON.stringify(message),
            requestSnapshot.rawPayloadEncrypted ?? null,
            requestSnapshot.privacyClass,
            requestSnapshot.traceId,
            requestSnapshot.retentionUntil,
        ];
        const inserted = timeContract.rows[0]?.enabled === true
          ? await client.query<InsertedMessageRow>(
            `INSERT INTO channel.message_inbox (
                schema_version, provider, msg_id, idempotency_key, req_id, bot_id,
                chat_type, chat_id, sender_user_id, msg_type,
                create_time, provider_create_epoch_ms, received_at, received_epoch_ms,
                raw_text, clean_text, normalized_message, raw_payload_encrypted,
                privacy_class, trace_id, retention_until, retention_until_epoch_ms
             ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10,
                $11::timestamp without time zone, $20::bigint,
                $12::timestamp without time zone, $21::bigint,
                $13, $14, $15::jsonb, $16,
                $17, $18, $19::timestamp without time zone, $22::bigint
             )
             ON CONFLICT (provider, msg_id) DO NOTHING
             RETURNING id::text AS id`,
            [...commonValues, message.provider_create_epoch_ms, message.received_epoch_ms,
              requestSnapshot.retentionUntilEpochMs],
          )
          : await client.query<InsertedMessageRow>(
            `INSERT INTO channel.message_inbox (
                schema_version, provider, msg_id, idempotency_key, req_id, bot_id,
                chat_type, chat_id, sender_user_id, msg_type, create_time, received_at,
                raw_text, clean_text, normalized_message, raw_payload_encrypted,
                privacy_class, trace_id, retention_until
             ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11::timestamp without time zone, $12::timestamp without time zone,
                $13, $14, $15::jsonb, $16,
                $17, $18, $19::timestamp without time zone
             )
             ON CONFLICT (provider, msg_id) DO NOTHING
             RETURNING id::text AS id`,
            commonValues,
        );

        if (inserted.rowCount === 0) {
          const existing = await client.query<ExistingMessageRow>(
            `SELECT id::text AS id, processing_status, response_snapshot
               FROM channel.message_inbox
              WHERE provider = $1 AND msg_id = $2`,
            [message.provider, message.msg_id],
          );
          const existingRow = existing.rows[0];
          if (existing.rowCount !== 1 || !existingRow || existingRow.processing_status !== 'COMPLETED') {
            throw new Error('INBOX_COMMITTED_RESULT_MISSING');
          }
          await client.query('COMMIT');
          return {
            ok: true,
            duplicate: true,
            channelMessageId: existingRow.id,
            result: existingRow.response_snapshot,
          };
        }

        const insertedRow = inserted.rows[0];
        if (!insertedRow) {
          throw new Error('INBOX_INSERTED_RESULT_MISSING');
        }
        const channelMessageId = insertedRow.id;
        const transactionView = revocableTransactionView(client);
        failureKind = 'PROCESSING';
        let processingResult: ProcessingResult;
        try {
          processingResult = await processFirst({
            channelMessageId,
            message,
            transaction: transactionView.transaction,
          });
        } finally {
          await transactionView.revokeAndDrain();
        }
        const resultSnapshot = responseSnapshot(processingResult);
        const result = resultSnapshot.snapshot;

        failureKind = 'STORAGE';
        const completed = await client.query(
          `UPDATE channel.message_inbox
              SET processing_status = 'COMPLETED',
                  response_snapshot = $2::jsonb,
                  completed_at = date_trunc('second', transaction_timestamp() AT TIME ZONE 'Asia/Shanghai')
            WHERE id = $1::bigint AND processing_status = 'PROCESSING'`,
          [channelMessageId, resultSnapshot.serialized],
        );
        if (completed.rowCount !== 1) {
          throw new Error('INBOX_COMPLETION_UPDATE_MISSING');
        }
        await client.query('COMMIT');
        return {
          ok: true,
          duplicate: false,
          channelMessageId,
          result,
        };
      } catch (error) {
        destroyClient = await rollbackAndShouldDestroyClient(client);
        if (failureKind === 'PROCESSING') {
          return publicError(
            'CHANNEL_INBOX_PROCESSING_FAILED',
            true,
            error instanceof InboxInputError ? error.reason : undefined,
          );
        }
        return publicError('CHANNEL_INBOX_STORAGE_FAILED', true);
      } finally {
        client.release(destroyClient);
      }
    },
  });
}
