import { readFile } from 'node:fs/promises';

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
  'create_time',
  'received_at',
  'content',
  'quote',
];

class InboxInputError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validDateTime(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value);
  if (!match || match[1] === '0000' || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  const calendarDate = new Date(0);
  calendarDate.setUTCHours(0, 0, 0, 0);
  calendarDate.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return calendarDate.getUTCFullYear() === Number(match[1])
    && calendarDate.getUTCMonth() === Number(match[2]) - 1
    && calendarDate.getUTCDate() === Number(match[3]);
}

function hasExactFields(value, required, optional = []) {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((field) => Object.hasOwn(value, field))
    && keys.every((field) => allowed.has(field));
}

function validateContent(content, reason) {
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
        || typeof item.text.clean !== 'string'
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
      if (
        !hasExactFields(item.media, ['type', 'source_index', 'download_ref'])
        || !['image', 'file', 'video'].includes(item.media.type)
        || !Number.isInteger(item.media.source_index)
        || item.media.source_index < 0
        || item.media.source_index > 9
        || !/^wmr_[a-f0-9]{32}$/.test(item.media.download_ref)
      ) {
        throw new InboxInputError(reason);
      }
      continue;
    }
    throw new InboxInputError(reason);
  }
}

function validateMessage(message) {
  if (!isRecord(message)) {
    throw new InboxInputError('MESSAGE_OBJECT_REQUIRED');
  }
  if (!hasExactFields(message, MESSAGE_FIELDS)) {
    throw new InboxInputError('MESSAGE_FIELDS_INVALID');
  }
  if (message.schema_version !== 1) {
    throw new InboxInputError('MESSAGE_SCHEMA_VERSION_INVALID');
  }
  if (message.provider !== 'WECOM_AIBOT' || !boundedString(message.msg_id, 256)) {
    throw new InboxInputError('MESSAGE_IDENTITY_INVALID');
  }
  if (message.idempotency_key !== `${message.provider}:${message.msg_id}`) {
    throw new InboxInputError('IDEMPOTENCY_KEY_INVALID');
  }
  if (!boundedString(message.req_id, 256) || !boundedString(message.bot_id, 256)) {
    throw new InboxInputError('MESSAGE_CHANNEL_IDENTITY_INVALID');
  }
  if (!['single', 'group'].includes(message.chat_type)) {
    throw new InboxInputError('MESSAGE_CHAT_TYPE_INVALID');
  }
  if (
    (message.chat_type === 'single' && message.chat_id !== null)
    || (message.chat_type === 'group' && !boundedString(message.chat_id, 256))
  ) {
    throw new InboxInputError('MESSAGE_CHAT_ID_INVALID');
  }
  if (!boundedString(message.sender_user_id, 256) || !MESSAGE_TYPES.has(message.msg_type)) {
    throw new InboxInputError('MESSAGE_CONTENT_IDENTITY_INVALID');
  }
  if (message.create_time !== null && !validDateTime(message.create_time)) {
    throw new InboxInputError('MESSAGE_CREATE_TIME_INVALID');
  }
  if (!validDateTime(message.received_at)) {
    throw new InboxInputError('MESSAGE_RECEIVED_AT_INVALID');
  }
  validateContent(message.content, 'MESSAGE_CONTENT_INVALID');
  if (message.quote !== null) {
    if (
      !isRecord(message.quote)
      || !hasExactFields(message.quote, ['msg_type', 'content'])
      || !['text', 'image', 'mixed', 'voice', 'file'].includes(message.quote.msg_type)
    ) {
      throw new InboxInputError('MESSAGE_QUOTE_INVALID');
    }
    validateContent(message.quote.content, 'MESSAGE_QUOTE_INVALID');
  }
}

function validateRequest(request) {
  if (!isRecord(request)) {
    throw new InboxInputError('REQUEST_OBJECT_REQUIRED');
  }
  if (!hasExactFields(
    request,
    ['message', 'traceId', 'privacyClass', 'retentionUntil'],
    ['rawPayloadEncrypted'],
  )) {
    throw new InboxInputError('REQUEST_FIELDS_INVALID');
  }
  validateMessage(request.message);
  if (!boundedString(request.traceId, 128)) {
    throw new InboxInputError('TRACE_ID_INVALID');
  }
  if (!PRIVACY_CLASSES.has(request.privacyClass)) {
    throw new InboxInputError('PRIVACY_CLASS_INVALID');
  }
  if (!validDateTime(request.retentionUntil)) {
    throw new InboxInputError('RETENTION_UNTIL_INVALID');
  }
  if (Date.parse(request.retentionUntil) <= Date.parse(request.message.received_at)) {
    throw new InboxInputError('RETENTION_UNTIL_NOT_AFTER_RECEIVED_AT');
  }
  if (
    request.rawPayloadEncrypted !== undefined
    && (
      (!Buffer.isBuffer(request.rawPayloadEncrypted)
        && !(request.rawPayloadEncrypted instanceof Uint8Array))
      || request.rawPayloadEncrypted.byteLength === 0
    )
  ) {
    throw new InboxInputError('ENCRYPTED_RAW_PAYLOAD_BYTES_REQUIRED');
  }
}

function textColumns(message) {
  const textItems = message.content.filter((item) => item?.kind === 'text' && isRecord(item.text));
  if (textItems.length === 0) {
    return { rawText: null, cleanText: null };
  }
  return {
    rawText: textItems.map((item) => item.text.raw).join('\n'),
    cleanText: textItems.map((item) => item.text.clean).join('\n'),
  };
}

function responseSnapshot(result) {
  if (!isRecord(result)) {
    throw new InboxInputError('PROCESSING_RESULT_OBJECT_REQUIRED');
  }
  let serialized;
  try {
    serialized = JSON.stringify(result);
  } catch {
    throw new InboxInputError('PROCESSING_RESULT_NOT_JSON_SERIALIZABLE');
  }
  if (serialized === undefined) {
    throw new InboxInputError('PROCESSING_RESULT_NOT_JSON_SERIALIZABLE');
  }
  return JSON.parse(serialized);
}

function transactionQuery(client, queryConfig, values) {
  const queryText = typeof queryConfig === 'string' ? queryConfig : queryConfig?.text;
  if (typeof queryText !== 'string' || queryText.trim().length === 0) {
    throw new InboxInputError('TRANSACTION_QUERY_INVALID');
  }
  const withoutTrailingTerminator = queryText.trim().replace(/;\s*$/u, '');
  if (withoutTrailingTerminator.includes(';')) {
    throw new InboxInputError('TRANSACTION_MULTIPLE_STATEMENTS_NOT_ALLOWED');
  }
  if (/^(?:\s|\/\*[\s\S]*?\*\/|--[^\r\n]*(?:\r?\n|$))*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE\s+SAVEPOINT|PREPARE\s+TRANSACTION)\b/iu.test(withoutTrailingTerminator)) {
    throw new InboxInputError('TRANSACTION_CONTROL_NOT_ALLOWED');
  }
  return client.query(queryConfig, values);
}

function publicError(code, retryable, reason) {
  return {
    ok: false,
    error: {
      code,
      retryable,
      ...(reason ? { reason } : {}),
    },
  };
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
    return false;
  } catch {
    return true;
  }
}

export async function applyChannelMessageInboxMigration({ pool }) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
  const sql = await readFile(MIGRATION_URL, 'utf8');
  await pool.query(sql);
}

export function createChannelMessageInbox({ pool }) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }

  return Object.freeze({
    async accept(request, processFirst) {
      try {
        validateRequest(request);
      } catch (error) {
        if (error instanceof InboxInputError) {
          return publicError('CHANNEL_INBOX_INVALID_INPUT', false, error.reason);
        }
        throw error;
      }
      if (typeof processFirst !== 'function') {
        return publicError('CHANNEL_INBOX_INVALID_INPUT', false, 'PROCESS_FIRST_REQUIRED');
      }

      let client;
      try {
        client = await pool.connect();
      } catch {
        return publicError('CHANNEL_INBOX_UNAVAILABLE', true);
      }

      let failureKind = 'STORAGE';
      let destroyClient = false;
      try {
        await client.query('BEGIN');
        const { message } = request;
        const { rawText, cleanText } = textColumns(message);
        const inserted = await client.query(
          `INSERT INTO channel.message_inbox (
              schema_version, provider, msg_id, idempotency_key, req_id, bot_id,
              chat_type, chat_id, sender_user_id, msg_type, create_time, received_at,
              raw_text, clean_text, normalized_message, raw_payload_encrypted,
              privacy_class, trace_id, retention_until
           ) VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11::timestamptz, $12::timestamptz,
              $13, $14, $15::jsonb, $16,
              $17, $18, $19::timestamptz
           )
           ON CONFLICT (provider, msg_id) DO NOTHING
           RETURNING id::text AS id`,
          [
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
            request.rawPayloadEncrypted === undefined ? null : Buffer.from(request.rawPayloadEncrypted),
            request.privacyClass,
            request.traceId,
            request.retentionUntil,
          ],
        );

        if (inserted.rowCount === 0) {
          const existing = await client.query(
            `SELECT id::text AS id, processing_status, response_snapshot
               FROM channel.message_inbox
              WHERE provider = $1 AND msg_id = $2`,
            [message.provider, message.msg_id],
          );
          if (existing.rowCount !== 1 || existing.rows[0].processing_status !== 'COMPLETED') {
            throw new Error('INBOX_COMMITTED_RESULT_MISSING');
          }
          await client.query('COMMIT');
          return {
            ok: true,
            duplicate: true,
            channelMessageId: existing.rows[0].id,
            result: existing.rows[0].response_snapshot,
          };
        }

        const channelMessageId = inserted.rows[0].id;
        const transaction = Object.freeze({
          query: transactionQuery.bind(null, client),
        });
        failureKind = 'PROCESSING';
        const result = responseSnapshot(await processFirst({
          channelMessageId,
          message,
          transaction,
        }));

        failureKind = 'STORAGE';
        const completed = await client.query(
          `UPDATE channel.message_inbox
              SET processing_status = 'COMPLETED',
                  response_snapshot = $2::jsonb,
                  completed_at = CURRENT_TIMESTAMP
            WHERE id = $1::bigint AND processing_status = 'PROCESSING'`,
          [channelMessageId, JSON.stringify(result)],
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
        destroyClient = await rollbackQuietly(client);
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
