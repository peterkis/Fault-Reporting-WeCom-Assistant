import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildMarkdownReply,
  buildStreamStages,
  buildWelcomeReply,
  classifyReplyError,
  createReplyFixture,
  parseReplyArgs,
  runReplyProbe,
} from '../src/g0-006a-reply-capability.mjs';

class FakeClient extends EventEmitter {
  constructor({ reply, replyStream, replyWelcome, uploadMedia, replyMedia, downloadFile } = {}) {
    super();
    this.replyImpl = reply ?? (async () => ({ cmd: 'aibot_respond_msg', headers: {}, body: {}, errcode: 0 }));
    this.replyStreamImpl = replyStream ?? (async () => ({ cmd: 'aibot_respond_msg', headers: {}, body: {}, errcode: 0 }));
    this.replyWelcomeImpl = replyWelcome ?? (async () => ({ cmd: 'aibot_respond_welcome_msg', headers: {}, body: {}, errcode: 0 }));
    this.uploadMediaImpl = uploadMedia ?? (async (_bytes, options) => ({ type: options.type, media_id: `sensitive-media-${options.type}`, created_at: '0' }));
    this.replyMediaImpl = replyMedia ?? (async () => ({ cmd: 'aibot_respond_msg', headers: {}, body: {}, errcode: 0 }));
    this.downloadFileImpl = downloadFile ?? (async () => ({ buffer: Buffer.from([0, 0, 0, 0, 102, 116, 121, 112, 105, 115, 111, 109]), filename: 'sensitive.mp4' }));
    this.replies = [];
    this.streamReplies = [];
    this.welcomeReplies = [];
    this.uploads = [];
    this.mediaReplies = [];
    this.downloads = [];
    this.connected = false;
    this.disconnected = false;
  }

  connect() {
    this.connected = true;
  }

  disconnect() {
    this.disconnected = true;
  }

  async reply(frame, body) {
    this.replies.push({ frame, body });
    return this.replyImpl(frame, body);
  }

  async replyStream(frame, streamId, content, finish, msgItem, feedback) {
    this.streamReplies.push({ frame, streamId, content, finish, msgItem, feedback });
    return this.replyStreamImpl(frame, streamId, content, finish, msgItem, feedback);
  }

  async replyWelcome(frame, body) {
    this.welcomeReplies.push({ frame, body });
    return this.replyWelcomeImpl(frame, body);
  }

  async uploadMedia(bytes, options) {
    this.uploads.push({ bytes, options });
    return this.uploadMediaImpl(bytes, options);
  }

  async replyMedia(frame, mediaType, mediaId, videoOptions) {
    this.mediaReplies.push({ frame, mediaType, mediaId, videoOptions });
    return this.replyMediaImpl(frame, mediaType, mediaId, videoOptions);
  }

  async downloadFile(url, aesKey) {
    this.downloads.push({ url, aesKey });
    return this.downloadFileImpl(url, aesKey);
  }
}

function optionsFor(scenario) {
  return parseReplyArgs([
    `--scenario=${scenario}`,
    '--timeout-ms=30000',
    '--stream-refresh-delay-ms=100',
    '--download-timeout-ms=1000',
  ]);
}

function directTextFrame(content) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'sensitive-callback-req-id' },
    body: {
      msgid: 'sensitive-message-id',
      chattype: 'single',
      from: { userid: 'sensitive-userid' },
      msgtype: 'text',
      text: { content },
    },
  };
}

function directVideoFrame() {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'sensitive-video-req-id' },
    body: {
      msgid: 'sensitive-video-message-id',
      chattype: 'single',
      from: { userid: 'sensitive-video-userid' },
      msgtype: 'video',
      video: {
        url: 'https://download.example.test/video?patient=sensitive',
        aeskey: 'sensitive-video-aes-key',
      },
    },
  };
}

function enterChatFrame() {
  return {
    cmd: 'aibot_event_callback',
    headers: { req_id: 'sensitive-enter-chat-req-id' },
    body: {
      msgid: 'sensitive-enter-chat-message-id',
      from: { userid: 'sensitive-enter-chat-userid' },
      msgtype: 'event',
      event: { eventtype: 'enter_chat' },
    },
  };
}

function feedbackFrame(feedbackId) {
  return {
    cmd: 'aibot_event_callback',
    headers: { req_id: 'sensitive-feedback-req-id' },
    body: {
      msgid: 'sensitive-feedback-message-id',
      chattype: 'single',
      from: { userid: 'sensitive-feedback-userid' },
      msgtype: 'event',
      event: {
        eventtype: 'feedback_event',
        feedback_event: {
          id: feedbackId,
          type: 2,
          content: 'sensitive user feedback content',
          inaccurate_reason_list: [2, 4],
        },
      },
    },
  };
}

async function flush() {
  await new Promise((resolveFlush) => setImmediate(resolveFlush));
  await new Promise((resolveFlush) => setImmediate(resolveFlush));
}

function runProbe({ client, options, captures, ids = ['first', 'second'] }) {
  let index = 0;
  return runReplyProbe({
    client,
    options,
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    wait: async () => {},
    now: () => 1_000,
    createId: () => ids[index++] ?? `id-${index}`,
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
}

test('reply arguments only accept registered scenarios and evidence output paths', () => {
  const parsed = parseReplyArgs(['--scenario=markdown', '--timeout-ms=30000', '--stream-refresh-delay-ms=500', '--download-timeout-ms=1000']);
  assert.equal(parsed.scenario, 'markdown');
  assert.equal(parsed.expected.reply_kind, 'markdown');
  assert.throws(() => parseReplyArgs(['--scenario=text']), /G0_REPLY_INVALID_SCENARIO/);
  assert.throws(() => parseReplyArgs(['--scenario=markdown', '--timeout-ms=1']), /G0_REPLY_INVALID_TIMEOUT/);
  assert.throws(() => parseReplyArgs(['--scenario=markdown', '--output=tmp/result.jsonl']), /G0_REPLY_INVALID_OUTPUT/);
});

test('welcome, Markdown, stream, and media builders use the documented reply forms', () => {
  assert.deepEqual(buildWelcomeReply('welcome_text'), {
    msgtype: 'text',
    text: { content: '您好，这是 G0-006A 欢迎语回复验证。' },
  });
  assert.equal(buildWelcomeReply('welcome_template_card').template_card.card_type, 'text_notice');
  assert.equal(buildMarkdownReply().msgtype, 'markdown');
  const stages = buildStreamStages('feedback-id');
  assert.deepEqual(stages.map((stage) => [stage.stage, stage.finish, Boolean(stage.feedback)]), [
    ['initial', false, true],
    ['refresh', false, false],
    ['final', true, false],
  ]);
  for (const scenario of ['file', 'image', 'voice']) {
    const fixture = createReplyFixture(scenario);
    assert.ok(Buffer.isBuffer(fixture.bytes));
    assert.ok(fixture.bytes.length > 0);
  }
  assert.equal(createReplyFixture('voice').bytes.subarray(0, 6).toString('ascii'), '#!AMR\n');
  assert.throws(() => createReplyFixture('video_echo'), /G0_REPLY_INVALID_MEDIA_SCENARIO/);
});

test('welcome replies accept an enter_chat event even when its chattype is omitted', async () => {
  for (const scenario of ['welcome_text', 'welcome_template_card']) {
    const client = new FakeClient();
    const captures = [];
    const probe = runProbe({ client, options: optionsFor(scenario), captures });
    client.emit('authenticated');
    const frame = enterChatFrame();
    client.emit('event.enter_chat', frame);
    const result = await probe.completion;

    assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'WELCOME_REPLY_ACKNOWLEDGED' });
    assert.equal(client.welcomeReplies.length, 1);
    assert.equal(client.welcomeReplies[0].frame, frame);
    assert.equal(captures[0].outbound.command, 'aibot_respond_welcome_msg');
    assert.equal(captures[0].outbound.within_five_seconds, true);
    assert.equal(JSON.stringify(captures).includes('sensitive-enter-chat-userid'), false);
  }
});

test('stream refresh reuses one callback and stream id, then omits the body for matching feedback', async () => {
  const client = new FakeClient();
  const captures = [];
  const probe = runProbe({ client, options: optionsFor('stream_refresh_feedback'), captures });
  client.emit('authenticated');
  const frame = directTextFrame('G0-006A-STREAM');
  client.emit('message.text', frame);
  await flush();

  assert.equal(client.streamReplies.length, 3);
  assert.equal(new Set(client.streamReplies.map((item) => item.frame)).size, 1);
  assert.equal(new Set(client.streamReplies.map((item) => item.streamId)).size, 1);
  assert.deepEqual(client.streamReplies.map((item) => item.finish), [false, false, true]);
  const feedbackId = client.streamReplies[0].feedback.id;
  assert.equal(client.streamReplies[1].feedback, undefined);
  client.emit('event.feedback_event', feedbackFrame(feedbackId));
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'STREAM_AND_FEEDBACK_ACKNOWLEDGED' });
  assert.equal(client.replies.length, 1);
  assert.equal(client.replies[0].body, undefined);
  assert.deepEqual(captures.map((capture) => capture.kind), ['stream_reply', 'stream_reply', 'stream_reply', 'feedback_event']);
  assert.equal(captures[3].feedback.feedback_id_matches_expected, true);
  assert.equal(captures[3].outbound.empty_body, true);
  assert.equal(captures[3].outbound.body_omitted, true);
  const serialized = JSON.stringify(captures);
  for (const sensitiveValue of [
    'sensitive-callback-req-id',
    'sensitive-userid',
    'sensitive-feedback-req-id',
    'sensitive user feedback content',
    feedbackId,
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test('Markdown reply is callback-bound and never serializes trigger text or identifiers', async () => {
  const client = new FakeClient();
  const captures = [];
  const probe = runProbe({ client, options: optionsFor('markdown'), captures });
  client.emit('message.text', directTextFrame('G0-006A-MARKDOWN'));
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'MARKDOWN_REPLY_ACKNOWLEDGED' });
  assert.equal(client.replies.length, 1);
  assert.equal(client.replies[0].body.msgtype, 'markdown');
  assert.equal(captures[0].outbound.callback_req_id_reused, true);
  assert.equal(JSON.stringify(captures).includes('G0-006A-MARKDOWN'), false);
  assert.equal(JSON.stringify(captures).includes('sensitive-userid'), false);
});

test('file, image, and voice upload then reply through the callback-bound media interface', async () => {
  for (const scenario of ['file', 'image', 'voice']) {
    const client = new FakeClient();
    const captures = [];
    const probe = runProbe({ client, options: optionsFor(scenario), captures });
    const token = `G0-006A-${scenario.toUpperCase()}`;
    const frame = directTextFrame(token);
    client.emit('message.text', frame);
    const result = await probe.completion;

    assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'MEDIA_REPLY_ACKNOWLEDGED' });
    assert.equal(client.uploads.length, 1);
    assert.equal(client.uploads[0].options.type, scenario);
    assert.equal(client.mediaReplies.length, 1);
    assert.equal(client.mediaReplies[0].frame, frame);
    assert.equal(client.mediaReplies[0].mediaType, scenario);
    assert.deepEqual(captures.map((capture) => capture.kind), ['media_upload', 'media_reply']);
    assert.equal(JSON.stringify(captures).includes(`sensitive-media-${scenario}`), false);
  }
});

test('video echo downloads only in memory, reuploads with a safe filename, and replies with title and description', async () => {
  const originalVideo = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
  const client = new FakeClient({
    downloadFile: async () => ({ buffer: originalVideo, filename: '患者敏感视频.mp4' }),
  });
  const captures = [];
  const probe = runProbe({ client, options: optionsFor('video_echo'), captures });
  const frame = directVideoFrame();
  client.emit('message.video', frame);
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'MEDIA_REPLY_ACKNOWLEDGED' });
  assert.equal(client.downloads.length, 1);
  assert.equal(client.uploads[0].options.filename, 'g0-006a-reply-video.mp4');
  assert.equal(client.mediaReplies[0].mediaType, 'video');
  assert.deepEqual(client.mediaReplies[0].videoOptions, {
    title: 'G0-006A 视频回复验证',
    description: '无敏感测试视频回显',
  });
  assert.deepEqual(captures.map((capture) => capture.kind), ['video_download', 'media_upload', 'media_reply']);
  const serialized = JSON.stringify(captures);
  for (const sensitiveValue of [
    'sensitive-video-req-id',
    'sensitive-video-userid',
    'https://download.example.test/video?patient=sensitive',
    'sensitive-video-aes-key',
    '患者敏感视频.mp4',
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test('provider rejection has a stable classification without recording provider error text', async () => {
  const client = new FakeClient({
    reply: async () => {
      throw { errcode: 40008, errmsg: 'sensitive provider reply error' };
    },
  });
  const captures = [];
  const probe = runProbe({ client, options: optionsFor('markdown'), captures });
  client.emit('message.text', directTextFrame('G0-006A-MARKDOWN'));
  const result = await probe.completion;

  assert.deepEqual(result, {
    ok: false,
    exit_code: 2,
    reason: 'MARKDOWN_REPLY_REJECTED',
    error_code: 'WECOM_REPLY_REJECTED',
  });
  assert.equal(captures[0].result.provider_errcode, 40008);
  assert.equal(JSON.stringify(captures).includes('sensitive provider reply error'), false);
  assert.equal(classifyReplyError({ code: 'G0_REPLY_VIDEO_TOO_LARGE' }), 'WECOM_REPLY_MEDIA_SIZE_EXCEEDED');
});

test('feedback empty-reply rejection is a completed negative capability result', async () => {
  const client = new FakeClient({
    reply: async (_frame, body) => {
      if (body === undefined) throw { errcode: 846605, errmsg: 'sensitive-empty-body-rejected' };
      return { headers: {}, body: {}, errcode: 0 };
    },
  });
  const captures = [];
  const probe = runProbe({ client, options: optionsFor('stream_refresh_feedback'), captures });
  client.emit('message.text', directTextFrame('G0-006A-STREAM'));
  await flush();
  client.emit('event.feedback_event', feedbackFrame(client.streamReplies[0].feedback.id));
  const result = await probe.completion;

  assert.deepEqual(result, {
    ok: true,
    exit_code: 0,
    reason: 'FEEDBACK_EMPTY_REPLY_REJECTED',
    error_code: 'WECOM_REPLY_REJECTED',
  });
  assert.equal(captures.at(-1).result.provider_errcode, 846605);
  assert.equal(JSON.stringify(captures).includes('sensitive-empty-body-rejected'), false);
});
