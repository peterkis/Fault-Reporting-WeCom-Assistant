import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as weComSdkAdapter from '../src/p1-002-wecom-sdk-adapter.mjs';

const { adaptWeComSdkFrame } = weComSdkAdapter;

const RECEIVED_AT = '2026-08-28T10:00:00.000Z';

function baseFrame(body) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'req-contract-001' },
    body: {
      msgid: 'msg-contract-001',
      aibotid: 'bot-contract-001',
      chattype: 'single',
      from: { userid: 'user-contract-001' },
      ...body,
    },
  };
}

test('text Frame becomes an SDK-independent normalized message', () => {
  const result = adaptWeComSdkFrame(
    baseFrame({
      msgtype: 'text',
      text: { content: '  HIS\u3000Login FAILED\r\n' },
      response_url: 'https://sensitive.example.test/reply',
    }),
    { receivedAt: RECEIVED_AT },
  );

  assert.deepEqual(result, {
    ok: true,
    message: {
      schema_version: 1,
      provider: 'WECOM_AIBOT',
      idempotency_key: 'WECOM_AIBOT:msg-contract-001',
      msg_id: 'msg-contract-001',
      req_id: 'req-contract-001',
      bot_id: 'bot-contract-001',
      chat_type: 'single',
      chat_id: null,
      sender_user_id: 'user-contract-001',
      msg_type: 'text',
      create_time: null,
      received_at: RECEIVED_AT,
      content: [
        {
          kind: 'text',
          text: {
            raw: '  HIS\u3000Login FAILED\r\n',
            clean: 'his login failed',
          },
        },
      ],
      quote: null,
    },
  });
  assert.equal(JSON.stringify(result).includes('sensitive.example.test'), false);
  assert.equal(Object.hasOwn(result.message, 'body'), false);
  assert.equal(Object.hasOwn(result.message, 'response_url'), false);
});

test('image Frame exposes only an opaque media download reference', () => {
  const frame = baseFrame({
    msgid: 'msg-contract-002',
    msgtype: 'image',
    image: {
      url: 'https://sensitive.example.test/encrypted-image',
      aeskey: 'sensitive-aes-key',
    },
    response_url: 'https://sensitive.example.test/reply',
  });
  const result = adaptWeComSdkFrame(frame, { receivedAt: RECEIVED_AT });

  assert.equal(result.ok, true);
  assert.deepEqual(result.message.content, [
    {
      kind: 'media',
      media: {
        type: 'image',
        source_index: 0,
        download_ref: 'wmr_86c2ff9f3f6622214751a83af590075e',
      },
    },
  ]);
  assert.equal(result.message.msg_type, 'image');
  assert.equal(result.message.idempotency_key, 'WECOM_AIBOT:msg-contract-002');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(frame.body.image.url), false);
  assert.equal(serialized.includes(frame.body.image.aeskey), false);
  assert.equal(serialized.includes(frame.body.response_url), false);
});

test('mixed Frame preserves text and image ordering in one normalized message', () => {
  const frame = baseFrame({
    msgid: 'msg-contract-003',
    chattype: 'group',
    chatid: 'chat-contract-001',
    msgtype: 'mixed',
    mixed: {
      msg_item: [
        {
          msgtype: 'image',
          image: {
            url: 'https://sensitive.example.test/mixed-image',
            aeskey: 'sensitive-mixed-aes-key',
          },
        },
        { msgtype: 'text', text: { content: '\uff28\uff29\uff33  \u767b\u5f55\u5931\u8d25' } },
      ],
    },
  });
  const result = adaptWeComSdkFrame(frame, { receivedAt: RECEIVED_AT });

  assert.equal(result.ok, true);
  assert.equal(result.message.chat_type, 'group');
  assert.equal(result.message.chat_id, 'chat-contract-001');
  assert.equal(result.message.msg_type, 'mixed');
  assert.deepEqual(result.message.content, [
    {
      kind: 'media',
      media: {
        type: 'image',
        source_index: 0,
        download_ref: 'wmr_209030b164a307c033f9975bd9054865',
      },
    },
    {
      kind: 'text',
      text: {
        raw: '\uff28\uff29\uff33  \u767b\u5f55\u5931\u8d25',
        clean: 'his \u767b\u5f55\u5931\u8d25',
      },
    },
  ]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(frame.body.mixed.msg_item[0].image.url), false);
  assert.equal(serialized.includes(frame.body.mixed.msg_item[0].image.aeskey), false);
});

test('replayed Frame keeps one durable idempotency key without Adapter-side dropping', () => {
  const firstFrame = baseFrame({ msgtype: 'text', text: { content: 'HIS login failed' } });
  const replayedFrame = {
    ...firstFrame,
    headers: { req_id: 'req-contract-replayed' },
  };

  const first = adaptWeComSdkFrame(firstFrame, { receivedAt: '2026-08-28T10:00:00.000Z' });
  const replayed = adaptWeComSdkFrame(replayedFrame, { receivedAt: '2026-08-28T10:00:05.000Z' });

  assert.equal(first.ok, true);
  assert.equal(replayed.ok, true);
  assert.equal(first.message.idempotency_key, 'WECOM_AIBOT:msg-contract-001');
  assert.equal(replayed.message.idempotency_key, first.message.idempotency_key);
  assert.equal(replayed.message.req_id, 'req-contract-replayed');
  assert.notEqual(replayed.message.received_at, first.message.received_at);
});

test('illegal Frame returns a stable, non-retryable and secret-free error', () => {
  const invalidFrame = baseFrame({
    msgid: '',
    msgtype: 'image',
    image: {
      url: 'https://sensitive.example.test/invalid-image',
      aeskey: 'sensitive-invalid-aes-key',
    },
  });

  const result = adaptWeComSdkFrame(invalidFrame, { receivedAt: RECEIVED_AT });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'WECOM_INVALID_FRAME',
      retryable: false,
      reason: 'MESSAGE_ID_REQUIRED',
    },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(invalidFrame.body.image.url), false);
  assert.equal(serialized.includes(invalidFrame.body.image.aeskey), false);
});

test('invalid Adapter receive time returns a stable error instead of throwing', () => {
  const frame = baseFrame({ msgtype: 'text', text: { content: 'HIS login failed' } });

  for (const receivedAt of ['not-a-date', new Date(Number.NaN), Symbol('invalid-time')]) {
    assert.deepEqual(
      adaptWeComSdkFrame(frame, { receivedAt }),
      {
        ok: false,
        error: {
          code: 'WECOM_INVALID_FRAME',
          retryable: false,
          reason: 'RECEIVED_AT_INVALID',
        },
      },
    );
  }
});

test('text that exceeds the contract only after normalization fails closed', () => {
  const expandingText = '\uFDFA'.repeat(2_000);
  assert.ok(expandingText.length <= 20_000);
  assert.ok(expandingText.normalize('NFKC').length > 20_000);

  assert.deepEqual(
    adaptWeComSdkFrame(
      baseFrame({ msgtype: 'text', text: { content: expandingText } }),
      { receivedAt: RECEIVED_AT },
    ),
    {
      ok: false,
      error: {
        code: 'WECOM_INVALID_FRAME',
        retryable: false,
        reason: 'TEXT_CONTENT_REQUIRED',
      },
    },
  );
});

test('text incompatible with the Phase 1 PostgreSQL boundary fails closed', () => {
  for (const content of ['before\u0000after', 'unpaired-\uD800-surrogate']) {
    assert.deepEqual(
      adaptWeComSdkFrame(
        baseFrame({ msgtype: 'text', text: { content } }),
        { receivedAt: RECEIVED_AT },
      ),
      {
        ok: false,
        error: {
          code: 'WECOM_INVALID_FRAME',
          retryable: false,
          reason: 'TEXT_CONTENT_REQUIRED',
        },
      },
    );
  }
});

test('non-message callback bodies are classified as unsupported before message-only fields', () => {
  const eventFrame = {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'req-contract-event' },
    body: {
      msgid: 'msg-contract-event',
      aibotid: 'bot-contract-001',
      msgtype: 'event',
      event: { eventtype: 'template_card_event' },
    },
  };

  assert.deepEqual(
    adaptWeComSdkFrame(eventFrame, { receivedAt: RECEIVED_AT }),
    {
      ok: false,
      error: {
        code: 'WECOM_UNSUPPORTED_MESSAGE_TYPE',
        retryable: false,
        reason: 'MESSAGE_TYPE_UNSUPPORTED',
      },
    },
  );
});

test('Frame envelope, identity and content validation use stable reasons', () => {
  const validTextFrame = baseFrame({ msgtype: 'text', text: { content: 'HIS login failed' } });
  const cases = [
    ['frame object', null, 'WECOM_INVALID_FRAME', 'FRAME_OBJECT_REQUIRED'],
    ['callback command', { ...validTextFrame, cmd: 'ping' }, 'WECOM_INVALID_FRAME', 'FRAME_COMMAND_INVALID'],
    ['request id', { ...validTextFrame, headers: { req_id: '' } }, 'WECOM_INVALID_FRAME', 'REQUEST_ID_REQUIRED'],
    ['message body', { ...validTextFrame, body: null }, 'WECOM_INVALID_FRAME', 'MESSAGE_BODY_REQUIRED'],
    ['blank message id', baseFrame({ msgid: '   ', msgtype: 'text', text: { content: 'x' } }), 'WECOM_INVALID_FRAME', 'MESSAGE_ID_REQUIRED'],
    ['bot id', baseFrame({ aibotid: '', msgtype: 'text', text: { content: 'x' } }), 'WECOM_INVALID_FRAME', 'BOT_ID_REQUIRED'],
    ['chat type', baseFrame({ chattype: 'channel', msgtype: 'text', text: { content: 'x' } }), 'WECOM_INVALID_FRAME', 'CHAT_TYPE_INVALID'],
    ['group chat id', baseFrame({ chattype: 'group', msgtype: 'text', text: { content: 'x' } }), 'WECOM_INVALID_FRAME', 'CHAT_ID_REQUIRED'],
    ['sender id', baseFrame({ from: {}, msgtype: 'text', text: { content: 'x' } }), 'WECOM_INVALID_FRAME', 'SENDER_USER_ID_REQUIRED'],
    ['text content', baseFrame({ msgtype: 'text', text: {} }), 'WECOM_INVALID_FRAME', 'TEXT_CONTENT_REQUIRED'],
    ['image reference', baseFrame({ msgtype: 'image', image: { url: 'https://example.test/image' } }), 'WECOM_INVALID_FRAME', 'MEDIA_REFERENCE_INVALID'],
    ['mixed content', baseFrame({ msgtype: 'mixed', mixed: { msg_item: [] } }), 'WECOM_INVALID_FRAME', 'MIXED_CONTENT_REQUIRED'],
    ['mixed item', baseFrame({ msgtype: 'mixed', mixed: { msg_item: [{ msgtype: 'file' }] } }), 'WECOM_INVALID_FRAME', 'MIXED_ITEM_INVALID'],
    ['quote', baseFrame({ msgtype: 'text', text: { content: 'x' }, quote: { msgtype: 'event' } }), 'WECOM_INVALID_FRAME', 'QUOTE_INVALID'],
    ['provider time', baseFrame({ create_time: -1, msgtype: 'text', text: { content: 'x' } }), 'WECOM_INVALID_FRAME', 'CREATE_TIME_INVALID'],
    ['provider time range', baseFrame({ create_time: 1e20, msgtype: 'text', text: { content: 'x' } }), 'WECOM_INVALID_FRAME', 'CREATE_TIME_INVALID'],
    ['message type', baseFrame({ msgtype: 'event', event: {} }), 'WECOM_UNSUPPORTED_MESSAGE_TYPE', 'MESSAGE_TYPE_UNSUPPORTED'],
  ];

  for (const [label, frame, code, reason] of cases) {
    assert.deepEqual(
      adaptWeComSdkFrame(frame, { receivedAt: RECEIVED_AT }),
      { ok: false, error: { code, retryable: false, reason } },
      label,
    );
  }
});

test('Normalized Message JSON Schema matches the Adapter interface and excludes SDK secrets', () => {
  const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const schema = JSON.parse(readFileSync(
    new URL('../contracts/normalized_wecom_message.schema.json', import.meta.url),
    'utf8',
  ));

  assert.deepEqual(Object.keys(weComSdkAdapter), ['adaptWeComSdkFrame']);
  assert.equal(packageManifest.dependencies['@wecom/aibot-node-sdk'], '1.0.6');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
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
  ]);
  assert.deepEqual(schema.properties.msg_type.enum, ['text', 'image', 'mixed', 'voice', 'file', 'video']);
  assert.deepEqual(schema.properties.create_time.type, ['string', 'null']);
  assert.equal(schema.properties.received_at.format, 'date-time');
  assert.equal(schema.properties.content.items.oneOf.length, 2);
  assert.deepEqual(schema.$defs.media.properties.type.enum, ['image', 'file', 'video']);
  assert.deepEqual(schema.$defs.text_item.properties.source.enum, ['VOICE_TRANSCRIPT']);
  for (const field of ['raw', 'clean']) {
    const textPattern = new RegExp(schema.$defs.text.properties[field].pattern, 'u');
    assert.equal(textPattern.test('HIS login failed'), true);
    assert.equal(textPattern.test('设备😀失败'), true);
    assert.equal(textPattern.test('before\u0000after'), false);
    assert.equal(textPattern.test('unpaired-high-\uD800'), false);
    assert.equal(textPattern.test('unpaired-low-\uDC00'), false);
  }
  const serialized = JSON.stringify(schema);
  assert.equal(serialized.includes('response_url'), false);
  assert.equal(serialized.includes('aeskey'), false);
  assert.equal(serialized.includes('"url"'), false);
});

test('quoted text from the recorded Gate 0 shape is preserved without raw SDK fields', () => {
  const frame = baseFrame({
    msgtype: 'text',
    text: { content: 'This is the follow-up' },
    quote: {
      msgtype: 'text',
      text: { content: '\uff28\uff29\uff33 original error' },
    },
  });

  const result = adaptWeComSdkFrame(frame, { receivedAt: RECEIVED_AT });

  assert.equal(result.ok, true);
  assert.deepEqual(result.message.quote, {
    msg_type: 'text',
    content: [
      {
        kind: 'text',
        text: {
          raw: '\uff28\uff29\uff33 original error',
          clean: 'his original error',
        },
      },
    ],
  });
  assert.equal(Object.hasOwn(result.message.quote, 'msgtype'), false);
});

test('Gate 0 verified file, voice and video Frames use the same normalized seam', () => {
  const fileFrame = baseFrame({
    msgid: 'msg-contract-004',
    msgtype: 'file',
    file: { url: 'https://sensitive.example.test/file', aeskey: 'sensitive-file-key' },
  });
  const videoFrame = baseFrame({
    msgid: 'msg-contract-005',
    msgtype: 'video',
    video: { url: 'https://sensitive.example.test/video', aeskey: 'sensitive-video-key' },
  });
  const voiceFrame = baseFrame({
    msgid: 'msg-contract-006',
    msgtype: 'voice',
    voice: { content: '\uff28\uff29\uff33  login FAILED' },
  });

  const fileResult = adaptWeComSdkFrame(fileFrame, { receivedAt: RECEIVED_AT });
  const videoResult = adaptWeComSdkFrame(videoFrame, { receivedAt: RECEIVED_AT });
  const voiceResult = adaptWeComSdkFrame(voiceFrame, { receivedAt: RECEIVED_AT });

  assert.deepEqual(fileResult.message.content, [
    {
      kind: 'media',
      media: {
        type: 'file',
        source_index: 0,
        download_ref: 'wmr_f89c6beab659b72210db951eb56cac86',
      },
    },
  ]);
  assert.deepEqual(videoResult.message.content, [
    {
      kind: 'media',
      media: {
        type: 'video',
        source_index: 0,
        download_ref: 'wmr_9eae97a6b839d876b92d4e3c19b4cccf',
      },
    },
  ]);
  assert.deepEqual(voiceResult.message.content, [
    {
      kind: 'text',
      source: 'VOICE_TRANSCRIPT',
      text: {
        raw: '\uff28\uff29\uff33  login FAILED',
        clean: 'his login failed',
      },
    },
  ]);
  const serializedMedia = JSON.stringify([fileResult, videoResult]);
  for (const secret of [fileFrame.body.file.url, fileFrame.body.file.aeskey, videoFrame.body.video.url, videoFrame.body.video.aeskey]) {
    assert.equal(serializedMedia.includes(secret), false);
  }
});

test('quoted media keeps an independent opaque reference', () => {
  const frame = baseFrame({
    msgid: 'msg-contract-007',
    msgtype: 'text',
    text: { content: 'The screenshot above shows the error' },
    quote: {
      msgtype: 'image',
      image: {
        url: 'https://sensitive.example.test/quoted-image',
        aeskey: 'sensitive-quoted-key',
      },
    },
  });

  const result = adaptWeComSdkFrame(frame, { receivedAt: RECEIVED_AT });

  assert.deepEqual(result.message.quote, {
    msg_type: 'image',
    content: [
      {
        kind: 'media',
        media: {
          type: 'image',
          source_index: 0,
          download_ref: 'wmr_763b923c64c70098030785cdd202f349',
        },
      },
    ],
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(frame.body.quote.image.url), false);
  assert.equal(serialized.includes(frame.body.quote.image.aeskey), false);
});
