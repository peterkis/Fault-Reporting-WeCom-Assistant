import { createHash, randomUUID } from 'node:crypto';

export const WEBHOOK_DOCUMENT_URL = 'https://developer.work.weixin.qq.com/document/path/91770';
export const WEBHOOK_MESSAGE_LIMIT_PER_MINUTE = 20;

const OFFICIAL_IMAGE_URL = 'https://res.mail.qq.com/node/ww/wwopenmng/images/independent/doc/test_pic_msg1.png';
const PNG_FIXTURE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACdSURBVHhe7ZCxDcAwEIQ8jcfMzNnA6Wle6SzBSTRUJ9Z+3mNmUdgoAIWNAlDYKACFjQJQ2CgAhY0CUNgoAIWNAlDYKACFjQJQ2CgAhY0CUNgoAIWNAlDY+B3g9vHvRAEoJm4f/04UgMJGAShsFIDCRgEobBSAwkYBKGwUgMJGAShsFIDCRgEobBSAwkYBKGwUgMJGAShsFIDChj7AB66CFBftjB+uAAAAAElFTkSuQmCC';

function hashValue(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function providerErrorCode(body) {
  return Number.isInteger(body?.errcode) ? body.errcode : null;
}

function acceptedReply(httpStatus, providerErrcode) {
  return httpStatus >= 200 && httpStatus < 300 && providerErrcode === 0;
}

async function parseJsonReply(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function parseWebhookUrl(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('G0_WEBHOOK_URL_MISSING');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('G0_WEBHOOK_URL_INVALID');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'qyapi.weixin.qq.com'
    || url.pathname !== '/cgi-bin/webhook/send'
    || !url.searchParams.get('key')
  ) {
    throw new Error('G0_WEBHOOK_URL_INVALID');
  }
  return url;
}

export function redactWebhookEndpoint(value) {
  const url = parseWebhookUrl(value);
  return `${url.origin}${url.pathname}`;
}

export function assertMentionUserId(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value === '@all') {
    throw new Error('G0_WEBHOOK_MENTION_USERID_INVALID');
  }
  return value.trim();
}

export function createImageFixture() {
  const bytes = Buffer.from(PNG_FIXTURE_BASE64, 'base64');
  return {
    bytes,
    base64: bytes.toString('base64'),
    md5: createHash('md5').update(bytes).digest('hex'),
  };
}

export function createFileFixture() {
  return {
    filename: 'g0-webhook-file-test.txt',
    contentType: 'text/plain; charset=utf-8',
    bytes: Buffer.from('G0 Webhook file capability verification.\n', 'utf8'),
  };
}

export function createAmrNbFixture() {
  const header = Buffer.from('#!AMR\n', 'ascii');
  // 50 AMR-NB 4.75 kbps frames (20 ms each): a structural one-second fixture,
  // used only to exercise the documented voice-upload contract.
  const frames = Array.from({ length: 50 }, () => Buffer.concat([Buffer.from([0x04]), Buffer.alloc(12)]));
  return {
    filename: 'g0-webhook-voice-test.amr',
    contentType: 'audio/amr',
    bytes: Buffer.concat([header, ...frames]),
    frameCount: frames.length,
    durationMs: frames.length * 20,
  };
}

export function buildInitialMessagePayloads(mentionedUserId) {
  const userId = assertMentionUserId(mentionedUserId);
  const image = createImageFixture();
  const cardAction = { type: 1, url: WEBHOOK_DOCUMENT_URL };

  return [
    {
      capability: 'text_mentioned_list',
      payload: {
        msgtype: 'text',
        text: {
          content: '【G0 群机器人 Webhook 文本 @验证】请确认原生 @ 提醒。',
          mentioned_list: [userId],
        },
      },
    },
    {
      capability: 'markdown_mention_tag',
      payload: {
        msgtype: 'markdown',
        markdown: {
          content: `# G0 群机器人 Webhook Markdown @验证\n\n<@${userId}>\n\n请确认原生 @ 提醒。`,
        },
      },
    },
    {
      capability: 'markdown_v2',
      payload: {
        msgtype: 'markdown_v2',
        markdown_v2: {
          content: '# G0 群机器人 Webhook markdown_v2 验证\n\n| 能力 | 验证 |\n| :--- | :--- |\n| markdown_v2 | API 推送 |\n\n---\n**UTF-8 内容**',
        },
      },
    },
    {
      capability: 'image',
      payload: {
        msgtype: 'image',
        image: { base64: image.base64, md5: image.md5 },
      },
    },
    {
      capability: 'news',
      payload: {
        msgtype: 'news',
        news: {
          articles: [{
            title: 'G0 群机器人 Webhook 图文验证',
            description: '验证 news 类型的 API 投递。',
            url: WEBHOOK_DOCUMENT_URL,
            picurl: OFFICIAL_IMAGE_URL,
          }],
        },
      },
    },
    {
      capability: 'template_card_text_notice',
      payload: {
        msgtype: 'template_card',
        template_card: {
          card_type: 'text_notice',
          main_title: { title: 'G0 Webhook 文本卡片验证', desc: 'text_notice API 投递' },
          sub_title_text: '请确认模板卡片正常显示。',
          card_action: cardAction,
        },
      },
    },
    {
      capability: 'template_card_news_notice',
      payload: {
        msgtype: 'template_card',
        template_card: {
          card_type: 'news_notice',
          main_title: { title: 'G0 Webhook 图文卡片验证', desc: 'news_notice API 投递' },
          card_image: { url: OFFICIAL_IMAGE_URL, aspect_ratio: 1.5 },
          card_action: cardAction,
        },
      },
    },
  ];
}

export function buildMediaMessagePayload({ type, mediaId }) {
  if (!['file', 'voice'].includes(type) || typeof mediaId !== 'string' || mediaId.length === 0) {
    throw new Error('G0_WEBHOOK_MEDIA_PAYLOAD_INVALID');
  }
  return { msgtype: type, [type]: { media_id: mediaId } };
}

export function buildUploadUrl(webhookUrl, type) {
  if (!['file', 'voice'].includes(type)) throw new Error('G0_WEBHOOK_MEDIA_TYPE_INVALID');
  const source = parseWebhookUrl(webhookUrl);
  const target = new URL('https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media');
  target.searchParams.set('key', source.searchParams.get('key'));
  target.searchParams.set('type', type);
  return target;
}

export function buildMultipartMediaBody({ fixture, boundary = `----g0-webhook-${randomUUID()}` }) {
  if (!fixture || !Buffer.isBuffer(fixture.bytes) || fixture.bytes.length <= 5) {
    throw new Error('G0_WEBHOOK_MEDIA_FIXTURE_INVALID');
  }
  const opening = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fixture.filename}"; filelength=${fixture.bytes.length}\r\nContent-Type: ${fixture.contentType}\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { boundary, body: Buffer.concat([opening, fixture.bytes, closing]) };
}

function resultFromReply({ capability, stage, startedAtMs, httpStatus, body, extra = {} }) {
  const errcode = providerErrorCode(body);
  return {
    capability,
    stage,
    status: acceptedReply(httpStatus, errcode) ? 'accepted' : 'rejected',
    http_status: httpStatus,
    provider_errcode: errcode,
    duration_ms: Math.max(0, Date.now() - startedAtMs),
    ...extra,
  };
}

function transportFailure({ capability, stage, startedAtMs, extra = {} }) {
  return {
    capability,
    stage,
    status: 'transport_failed',
    http_status: null,
    provider_errcode: null,
    duration_ms: Math.max(0, Date.now() - startedAtMs),
    ...extra,
  };
}

export async function sendWebhookMessage({ fetchImpl = fetch, webhookUrl, capability, payload }) {
  const startedAtMs = Date.now();
  try {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return resultFromReply({
      capability,
      stage: 'send',
      startedAtMs,
      httpStatus: response.status,
      body: await parseJsonReply(response),
    });
  } catch {
    return transportFailure({ capability, stage: 'send', startedAtMs });
  }
}

export async function uploadWebhookMedia({ fetchImpl = fetch, webhookUrl, capability, type, fixture }) {
  const startedAtMs = Date.now();
  try {
    const { boundary, body } = buildMultipartMediaBody({ fixture });
    const response = await fetchImpl(buildUploadUrl(webhookUrl, type), {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const responseBody = await parseJsonReply(response);
    const result = resultFromReply({
      capability,
      stage: 'upload',
      startedAtMs,
      httpStatus: response.status,
      body: responseBody,
      extra: {
        media_type: type,
        fixture_bytes: fixture.bytes.length,
        media_id_received: typeof responseBody?.media_id === 'string' && responseBody.media_id.length > 0,
      },
    });
    return {
      result,
      mediaId: result.status === 'accepted' && typeof responseBody?.media_id === 'string' ? responseBody.media_id : null,
    };
  } catch {
    return {
      result: transportFailure({
        capability,
        stage: 'upload',
        startedAtMs,
        extra: { media_type: type, fixture_bytes: fixture?.bytes?.length ?? null, media_id_received: false },
      }),
      mediaId: null,
    };
  }
}

function skippedMediaSend(capability, type) {
  return {
    capability,
    stage: 'send',
    status: 'not_run',
    http_status: null,
    provider_errcode: null,
    duration_ms: 0,
    reason: 'media_upload_not_accepted',
    media_type: type,
  };
}

export async function runWebhookCapabilityProbe({ fetchImpl = fetch, webhookUrl, mentionedUserId }) {
  const endpoint = redactWebhookEndpoint(webhookUrl);
  const mentionUserId = assertMentionUserId(mentionedUserId);
  const results = [];

  for (const message of buildInitialMessagePayloads(mentionUserId)) {
    results.push(await sendWebhookMessage({ fetchImpl, webhookUrl, ...message }));
  }

  for (const media of [
    { capability: 'file', type: 'file', fixture: createFileFixture() },
    { capability: 'voice', type: 'voice', fixture: createAmrNbFixture() },
  ]) {
    const upload = await uploadWebhookMedia({ fetchImpl, webhookUrl, ...media });
    results.push(upload.result);
    results.push(upload.mediaId
      ? await sendWebhookMessage({
        fetchImpl,
        webhookUrl,
        capability: media.capability,
        payload: buildMediaMessagePayload({ type: media.type, mediaId: upload.mediaId }),
      })
      : skippedMediaSend(media.capability, media.type));
  }

  const sentMessageCount = results.filter((result) => result.stage === 'send' && result.status !== 'not_run').length;
  return {
    test_id: 'G0-WEBHOOK-001',
    schema_version: 1,
    observed_at_utc: new Date().toISOString(),
    document_url: WEBHOOK_DOCUMENT_URL,
    endpoint,
    privacy: {
      webhook_key_recorded: false,
      mentioned_userid_hash: hashValue(mentionUserId),
      original_mentioned_userid_recorded: false,
      media_id_recorded: false,
      original_content_recorded: false,
      provider_error_text_recorded: false,
    },
    rate_limit_guard: {
      sent_message_count: sentMessageCount,
      documented_limit_per_minute: WEBHOOK_MESSAGE_LIMIT_PER_MINUTE,
      within_documented_limit: sentMessageCount <= WEBHOOK_MESSAGE_LIMIT_PER_MINUTE,
    },
    results,
  };
}
