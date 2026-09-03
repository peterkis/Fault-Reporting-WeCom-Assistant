import { createHash } from 'node:crypto';
import {
  assertEpochMsString,
  formatEpochMsToShanghaiLocal,
} from './platform/time-contract.mjs';

const NORMALIZED_MESSAGE_SCHEMA_VERSION = 1;
const WECOM_PROVIDER = 'WECOM_AIBOT';
const WECOM_ADAPTER_ERROR_CODES = Object.freeze({
  invalidFrame: 'WECOM_INVALID_FRAME',
  unsupportedMessageType: 'WECOM_UNSUPPORTED_MESSAGE_TYPE',
});

const SUPPORTED_MESSAGE_TYPES = Object.freeze(['text', 'image', 'mixed', 'voice', 'file', 'video']);
const DOWNLOADABLE_MEDIA_TYPES = Object.freeze(['image', 'file', 'video']);

function adapterError(code, reason) {
  return {
    ok: false,
    error: {
      code,
      retryable: false,
      reason,
    },
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStorageSafeString(value) {
  return typeof value === 'string' && value.isWellFormed() && !value.includes('\u0000');
}

function isBoundedString(value, maxLength) {
  return isNonEmptyString(value) && isStorageSafeString(value) && value.length <= maxLength;
}

function isIdentifier(value, maxLength = 256) {
  return isBoundedString(value, maxLength)
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function invalidFrame(reason) {
  return adapterError(WECOM_ADAPTER_ERROR_CODES.invalidFrame, reason);
}

function validMediaReference(value) {
  return isRecord(value)
    && isBoundedString(value.url, 2048)
    && isBoundedString(value.aeskey, 512);
}

function validProviderCreateTime(value) {
  if (value === undefined) {
    return true;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    return false;
  }
  return Number.isFinite(new Date(value * 1000).getTime());
}

function validateMixedContent(mixed) {
  if (!isRecord(mixed) || !Array.isArray(mixed.msg_item) || mixed.msg_item.length < 1 || mixed.msg_item.length > 10) {
    return invalidFrame('MIXED_CONTENT_REQUIRED');
  }

  for (const item of mixed.msg_item) {
    if (!isRecord(item) || !['text', 'image'].includes(item.msgtype)) {
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

function validateQuote(quote) {
  if (quote === undefined) {
    return null;
  }
  if (!isRecord(quote) || !['text', 'image', 'mixed', 'voice', 'file'].includes(quote.msgtype)) {
    return invalidFrame('QUOTE_INVALID');
  }
  if (quote.msgtype === 'text' && (!isRecord(quote.text) || !validNormalizedText(quote.text.content))) {
    return invalidFrame('QUOTE_INVALID');
  }
  if (['image', 'file'].includes(quote.msgtype) && !validMediaReference(quote[quote.msgtype])) {
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

function validateFrame(frame) {
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
  if (!SUPPORTED_MESSAGE_TYPES.includes(body.msgtype)) {
    return adapterError(WECOM_ADAPTER_ERROR_CODES.unsupportedMessageType, 'MESSAGE_TYPE_UNSUPPORTED');
  }
  if (!['single', 'group'].includes(body.chattype)) {
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
  if (DOWNLOADABLE_MEDIA_TYPES.includes(body.msgtype) && !validMediaReference(body[body.msgtype])) {
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

function cleanText(value) {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function validNormalizedText(value) {
  return isBoundedString(value, 20_000) && cleanText(value).length <= 20_000;
}

function normalizeReceivedClock({ receivedAt, receivedEpochMs }) {
  try {
    let epochMs;
    if (receivedEpochMs !== undefined) {
      epochMs = assertEpochMsString(receivedEpochMs);
    } else {
      const date = receivedAt instanceof Date ? receivedAt : new Date(receivedAt ?? Date.now());
      if (!Number.isFinite(date.getTime()) || date.getTime() < 0) return null;
      epochMs = String(Math.trunc(date.getTime()));
    }
    return Object.freeze({
      epoch_ms: epochMs,
      local_datetime: formatEpochMsToShanghaiLocal(epochMs),
    });
  } catch {
    return null;
  }
}

function normalizeCreateTime(value) {
  if (value === undefined) {
    return Object.freeze({ epoch_ms: null, local_datetime: null });
  }
  const epochMs = String(value * 1000);
  return Object.freeze({
    epoch_ms: epochMs,
    local_datetime: formatEpochMsToShanghaiLocal(epochMs),
  });
}

function buildMediaDownloadRef(msgId, scope, mediaType, sourceIndex) {
  const digest = createHash('sha256')
    .update([WECOM_PROVIDER, msgId, scope, mediaType, String(sourceIndex)].join('\0'))
    .digest('hex')
    .slice(0, 32);
  return `wmr_${digest}`;
}

function normalizeTextItem(rawText, source) {
  const item = {
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

function normalizeMediaItem(msgId, mediaType, sourceIndex, scope = 'body') {
  return {
    kind: 'media',
    media: {
      type: mediaType,
      source_index: sourceIndex,
      download_ref: buildMediaDownloadRef(msgId, scope, mediaType, sourceIndex),
    },
  };
}

function normalizeContent(body) {
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

function normalizeQuote(quote, msgId) {
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

export function adaptWeComSdkFrame(frame, { receivedAt, receivedEpochMs } = {}) {
  const validationError = validateFrame(frame);
  if (validationError) {
    return validationError;
  }
  const receivedClock = normalizeReceivedClock({ receivedAt, receivedEpochMs });
  if (receivedClock === null) {
    return invalidFrame('RECEIVED_AT_INVALID');
  }
  const body = frame.body;
  const providerClock = normalizeCreateTime(body.create_time);

  return {
    ok: true,
    message: {
      schema_version: NORMALIZED_MESSAGE_SCHEMA_VERSION,
      provider: WECOM_PROVIDER,
      idempotency_key: `${WECOM_PROVIDER}:${body.msgid}`,
      msg_id: body.msgid,
      req_id: frame.headers.req_id,
      bot_id: body.aibotid,
      chat_type: body.chattype,
      chat_id: body.chattype === 'group' ? body.chatid : null,
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
