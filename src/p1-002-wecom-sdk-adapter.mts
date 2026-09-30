import { createHash } from 'node:crypto';
import {
  assertEpochMsString,
  formatEpochMsToShanghaiLocal,
} from './platform/time-contract.mjs';

import type { InboxMessage, MessageContent, TextContent, MediaContent } from './p1-003-channel-message-inbox.mjs';
import type { PhysicalEpochMs, LocalDateTime } from '../contracts/time_contracts.js';

export interface AdapterClockOptions { receivedAt?: Date | string | number | null; receivedEpochMs?: string }
export type WeComAdapterResult = { ok: true; message: InboxMessage } | { ok: false; error: { code: 'WECOM_INVALID_FRAME' | 'WECOM_UNSUPPORTED_MESSAGE_TYPE'; retryable: false; reason: string } };
type AdapterFailure = Extract<WeComAdapterResult, { ok: false }>;
type MediaType = 'image' | 'file' | 'video';
interface MediaReference { url: string; aeskey: string }
type MixedItem = { msgtype: 'text'; text: { content: string } } | { msgtype: 'image'; image: MediaReference };
type RawContent = { msgtype: 'text'; text: { content: string } } | { msgtype: 'mixed'; mixed: { msg_item: MixedItem[] } } | { msgtype: 'voice'; voice: { content: string } } | { msgtype: 'image'; image: MediaReference } | { msgtype: 'file'; file: MediaReference } | { msgtype: 'video'; video: MediaReference };
type RawQuote = Exclude<RawContent, { msgtype: 'video' }>;
type ValidBody = RawContent & { msgid: string; aibotid: string; chattype: 'single' | 'group'; chatid?: string; from: { userid: string }; create_time?: number; quote?: RawQuote };
interface ValidFrame { headers: { req_id: string }; body: ValidBody }

const NORMALIZED_MESSAGE_SCHEMA_VERSION = 1;
const WECOM_PROVIDER = 'WECOM_AIBOT';
const WECOM_ADAPTER_ERROR_CODES = Object.freeze({
  invalidFrame: 'WECOM_INVALID_FRAME',
  unsupportedMessageType: 'WECOM_UNSUPPORTED_MESSAGE_TYPE',
});

const SUPPORTED_MESSAGE_TYPES = Object.freeze(['text', 'image', 'mixed', 'voice', 'file', 'video']);
const DOWNLOADABLE_MEDIA_TYPES = Object.freeze(['image', 'file', 'video']);

function adapterError(code: AdapterFailure['error']['code'], reason: string): AdapterFailure {
  return {
    ok: false,
    error: {
      code,
      retryable: false,
      reason,
    },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStorageSafeString(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && !value.includes('\u0000');
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isNonEmptyString(value) && isStorageSafeString(value) && value.length <= maxLength;
}

function isIdentifier(value: unknown, maxLength = 256): value is string {
  return isBoundedString(value, maxLength)
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function invalidFrame(reason: string): AdapterFailure {
  return adapterError(WECOM_ADAPTER_ERROR_CODES.invalidFrame, reason);
}

function validMediaReference(value: unknown): value is MediaReference {
  return isRecord(value)
    && isBoundedString(value.url, 2048)
    && isBoundedString(value.aeskey, 512);
}

function validProviderCreateTime(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return false;
  }
  return Number.isFinite(new Date((value as number) * 1000).getTime());
}

function validateMixedContent(mixed: unknown): AdapterFailure | null {
  if (!isRecord(mixed) || !Array.isArray(mixed.msg_item) || mixed.msg_item.length < 1 || mixed.msg_item.length > 10) {
    return invalidFrame('MIXED_CONTENT_REQUIRED');
  }

  for (const item of mixed.msg_item) {
    if (!isRecord(item) || !(['text', 'image'] as readonly unknown[]).includes(item.msgtype)) {
      return invalidFrame('MIXED_ITEM_INVALID');
    }
    if (item.msgtype === 'text' && (!isRecord(item.text) || !validNormalizedText(item.text.content))) {
      return invalidFrame('MIXED_ITEM_INVALID');
    }
    if (item.msgtype === 'image' && !validMediaReference(item.image)) {
      return invalidFrame('MIXED_ITEM_INVALID');
    }
  }

  return null;
}

function validateQuote(quote: unknown): AdapterFailure | null {
  if (quote === undefined) {
    return null;
  }
  if (!isRecord(quote) || !(['text', 'image', 'mixed', 'voice', 'file'] as readonly unknown[]).includes(quote.msgtype)) {
    return invalidFrame('QUOTE_INVALID');
  }
  if (quote.msgtype === 'text' && (!isRecord(quote.text) || !validNormalizedText(quote.text.content))) {
    return invalidFrame('QUOTE_INVALID');
  }
  if ((['image', 'file'] as readonly unknown[]).includes(quote.msgtype) && !validMediaReference(quote[quote.msgtype as string])) {
    return invalidFrame('QUOTE_INVALID');
  }
  if (quote.msgtype === 'voice' && (!isRecord(quote.voice) || !validNormalizedText(quote.voice.content))) {
    return invalidFrame('QUOTE_INVALID');
  }
  if (quote.msgtype === 'mixed' && validateMixedContent(quote.mixed)) {
    return invalidFrame('QUOTE_INVALID');
  }
  return null;
}

function validateFrame(frame: unknown): AdapterFailure | null {
  if (!isRecord(frame)) {
    return invalidFrame('FRAME_OBJECT_REQUIRED');
  }
  if (frame.cmd !== 'aibot_msg_callback') {
    return invalidFrame('FRAME_COMMAND_INVALID');
  }
  if (!isRecord(frame.headers) || !isIdentifier(frame.headers.req_id)) {
    return invalidFrame('REQUEST_ID_REQUIRED');
  }
  if (!isRecord(frame.body)) {
    return invalidFrame('MESSAGE_BODY_REQUIRED');
  }

  const body = frame.body;
  if (!isIdentifier(body.msgid)) {
    return invalidFrame('MESSAGE_ID_REQUIRED');
  }
  if (!isIdentifier(body.aibotid)) {
    return invalidFrame('BOT_ID_REQUIRED');
  }
  if (!(SUPPORTED_MESSAGE_TYPES as readonly unknown[]).includes(body.msgtype)) {
    return adapterError(WECOM_ADAPTER_ERROR_CODES.unsupportedMessageType, 'MESSAGE_TYPE_UNSUPPORTED');
  }
  if (!(['single', 'group'] as readonly unknown[]).includes(body.chattype)) {
    return invalidFrame('CHAT_TYPE_INVALID');
  }
  if (body.chattype === 'group' && !isIdentifier(body.chatid)) {
    return invalidFrame('CHAT_ID_REQUIRED');
  }
  if (!isRecord(body.from) || !isIdentifier(body.from.userid)) {
    return invalidFrame('SENDER_USER_ID_REQUIRED');
  }
  if (!validProviderCreateTime(body.create_time)) {
    return invalidFrame('CREATE_TIME_INVALID');
  }
  if (body.msgtype === 'text' && (!isRecord(body.text) || !validNormalizedText(body.text.content))) {
    return invalidFrame('TEXT_CONTENT_REQUIRED');
  }
  if ((DOWNLOADABLE_MEDIA_TYPES as readonly unknown[]).includes(body.msgtype) && !validMediaReference(body[body.msgtype as string])) {
    return invalidFrame('MEDIA_REFERENCE_INVALID');
  }
  if (body.msgtype === 'voice' && (!isRecord(body.voice) || !validNormalizedText(body.voice.content))) {
    return invalidFrame('VOICE_TRANSCRIPT_REQUIRED');
  }
  if (body.msgtype === 'mixed') {
    const mixedError = validateMixedContent(body.mixed);
    if (mixedError) {
      return mixedError;
    }
  }
  return validateQuote(body.quote);
}

function cleanText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function validNormalizedText(value: unknown): value is string {
  return isBoundedString(value, 20_000) && cleanText(value).length <= 20_000;
}

function normalizeReceivedClock({ receivedAt, receivedEpochMs }: AdapterClockOptions): { epoch_ms: PhysicalEpochMs; local_datetime: LocalDateTime } | null {
  try {
    let epochMs: PhysicalEpochMs;
    if (receivedEpochMs !== undefined) {
      epochMs = assertEpochMsString(receivedEpochMs);
    } else {
      const date = receivedAt instanceof Date ? receivedAt : new Date(receivedAt ?? Date.now());
      if (!Number.isFinite(date.getTime()) || date.getTime() < 0) return null;
      epochMs = String(Math.trunc(date.getTime())) as PhysicalEpochMs;
    }
    return Object.freeze({
      epoch_ms: epochMs,
      local_datetime: formatEpochMsToShanghaiLocal(epochMs),
    });
  } catch {
    return null;
  }
}

function normalizeCreateTime(value: number | undefined): { epoch_ms: PhysicalEpochMs | null; local_datetime: LocalDateTime | null } {
  if (value === undefined) {
    return Object.freeze({ epoch_ms: null, local_datetime: null });
  }
  const epochMs = String(value * 1000) as PhysicalEpochMs;
  return Object.freeze({
    epoch_ms: epochMs,
    local_datetime: formatEpochMsToShanghaiLocal(epochMs),
  });
}

function buildMediaDownloadRef(msgId: string, scope: string, mediaType: MediaType, sourceIndex: number): string {
  const digest = createHash('sha256')
    .update([WECOM_PROVIDER, msgId, scope, mediaType, String(sourceIndex)].join('\0'))
    .digest('hex')
    .slice(0, 32);
  return `wmr_${digest}`;
}

function normalizeTextItem(rawText: string, source?: 'VOICE_TRANSCRIPT'): TextContent {
  const item: TextContent = {
    kind: 'text',
    text: {
      raw: rawText,
      clean: cleanText(rawText),
    },
  };
  if (source) {
    item.source = source;
  }
  return item;
}

function normalizeMediaItem(msgId: string, mediaType: MediaType, sourceIndex: number, scope = 'body'): MediaContent {
  return {
    kind: 'media',
    media: {
      type: mediaType,
      source_index: sourceIndex,
      download_ref: buildMediaDownloadRef(msgId, scope, mediaType, sourceIndex),
    },
  };
}

function normalizeContent(body: ValidBody): MessageContent[] {
  if (body.msgtype === 'text') {
    return [normalizeTextItem(body.text.content)];
  }

  if (body.msgtype === 'mixed') {
    return body.mixed.msg_item.map((item, sourceIndex) => (
      item.msgtype === 'text'
        ? normalizeTextItem(item.text.content)
        : normalizeMediaItem(body.msgid, 'image', sourceIndex)
    ));
  }

  if (body.msgtype === 'voice') {
    return [normalizeTextItem(body.voice.content, 'VOICE_TRANSCRIPT')];
  }

  return [normalizeMediaItem(body.msgid, body.msgtype, 0)];
}

function normalizeQuote(quote: RawQuote | undefined, msgId: string): InboxMessage['quote'] {
  if (!isRecord(quote)) {
    return null;
  }
  if (quote.msgtype === 'text') {
    return {
      msg_type: 'text',
      content: [normalizeTextItem(quote.text.content)],
    };
  }
  if (quote.msgtype === 'image') {
    return {
      msg_type: 'image',
      content: [normalizeMediaItem(msgId, 'image', 0, 'quote')],
    };
  }
  if (quote.msgtype === 'voice') {
    return {
      msg_type: 'voice',
      content: [normalizeTextItem(quote.voice.content, 'VOICE_TRANSCRIPT')],
    };
  }
  if (quote.msgtype === 'file') {
    return {
      msg_type: 'file',
      content: [normalizeMediaItem(msgId, 'file', 0, 'quote')],
    };
  }
  return {
    msg_type: 'mixed',
    content: quote.mixed.msg_item.map((item, sourceIndex) => (
      item.msgtype === 'text'
        ? normalizeTextItem(item.text.content)
        : normalizeMediaItem(msgId, 'image', sourceIndex, 'quote')
    )),
  };
}

export function adaptWeComSdkFrame(frame: unknown, { receivedAt, receivedEpochMs }: AdapterClockOptions = {}): WeComAdapterResult {
  const validationError = validateFrame(frame);
  if (validationError) {
    return validationError;
  }
  const receivedClock = normalizeReceivedClock({ receivedAt, receivedEpochMs } as AdapterClockOptions);
  if (receivedClock === null) {
    return invalidFrame('RECEIVED_AT_INVALID');
  }
  const body = (frame as ValidFrame).body;
  const providerClock = normalizeCreateTime(body.create_time);

  return {
    ok: true,
    message: {
      schema_version: NORMALIZED_MESSAGE_SCHEMA_VERSION,
      provider: WECOM_PROVIDER,
      idempotency_key: `${WECOM_PROVIDER}:${body.msgid}`,
      msg_id: body.msgid,
      req_id: (frame as ValidFrame).headers.req_id,
      bot_id: body.aibotid,
      chat_type: body.chattype,
      chat_id: body.chattype === 'group' ? body.chatid as string : null,
      sender_user_id: body.from.userid,
      msg_type: body.msgtype,
      provider_create_epoch_ms: providerClock.epoch_ms,
      create_time: providerClock.local_datetime,
      received_epoch_ms: receivedClock.epoch_ms,
      received_at: receivedClock.local_datetime,
      content: normalizeContent(body),
      quote: normalizeQuote(body.quote, body.msgid),
    },
  };
}
