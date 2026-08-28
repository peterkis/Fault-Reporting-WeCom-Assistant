import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  buildChunkPlan,
  isMp4Buffer,
  parseVideoChunkArgs,
  prepareVideoFixture,
  runVideoChunkProbe,
  uploadVideoInDocumentedLayers,
} from '../src/g0-open-003-video-chunk-revalidation.mjs';

const CHUNK_BYTES = 512 * 1024;

function mp4Buffer(length = 128) {
  const buffer = Buffer.alloc(length);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  return buffer;
}

function videoFrame() {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'sensitive-callback-request-id' },
    body: {
      msgid: 'sensitive-message-id',
      chattype: 'single',
      from: { userid: 'sensitive-user-id' },
      msgtype: 'video',
      video: {
        url: 'https://download.example.test/sensitive.mp4',
        aeskey: 'sensitive-video-key',
      },
    },
  };
}

class FakeClient extends EventEmitter {
  constructor({ input = mp4Buffer(CHUNK_BYTES + 64), protocolReply, mediaReply } = {}) {
    super();
    this.input = input;
    this.protocolCalls = [];
    this.replyCalls = [];
    this.connected = false;
    this.disconnected = false;
    this.finished = false;
    this.protocolReply = protocolReply ?? (async (_reqId, _body, command) => {
      if (command === 'aibot_upload_media_init') return { body: { upload_id: 'sensitive-upload-id' } };
      if (command === 'aibot_upload_media_finish') {
        this.finished = true;
        return { body: { media_id: 'sensitive-media-id', type: 'video' } };
      }
      return { body: {}, errcode: 0 };
    });
    this.mediaReply = mediaReply ?? (async () => ({ errcode: 0, headers: {}, body: {} }));
    this.wsManager = {
      sendReply: async (reqId, body, command) => {
        this.protocolCalls.push({ reqId, body, command });
        return this.protocolReply(reqId, body, command);
      },
    };
  }

  connect() {
    this.connected = true;
  }

  disconnect() {
    this.disconnected = true;
  }

  async downloadFile(url, aesKey) {
    assert.equal(url, 'https://download.example.test/sensitive.mp4');
    assert.equal(aesKey, 'sensitive-video-key');
    return { buffer: this.input, filename: 'sensitive-original.mp4' };
  }

  async replyMedia(frame, mediaType, mediaId, videoOptions) {
    this.replyCalls.push({ frame, mediaType, mediaId, videoOptions, finished: this.finished });
    return this.mediaReply(frame, mediaType, mediaId, videoOptions);
  }
}

function options(overrides = {}) {
  return parseVideoChunkArgs([
    '--timeout-ms=30000',
    '--download-timeout-ms=1000',
    ...Object.entries(overrides).map(([name, value]) => `--${name}=${value}`),
  ]);
}

test('the documented 512 KiB plan covers 3,920,958 bytes in eight ordered chunks', () => {
  const plan = buildChunkPlan(3_920_958);
  assert.equal(plan.length, 8);
  assert.equal(plan[0].byte_size, CHUNK_BYTES);
  assert.equal(plan.at(-1).byte_size, 250_942);
  assert.deepEqual(plan.map((entry) => entry.chunk_index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(plan.reduce((total, entry) => total + entry.byte_size, 0), 3_920_958);
  assert.ok(plan.every((entry) => entry.byte_size <= CHUNK_BYTES));
});

test('test-only padding creates an exact target-sized MP4 without retaining an original filename', () => {
  const input = mp4Buffer(256);
  const fixture = prepareVideoFixture(input, 1_024);
  assert.equal(fixture.bytes.length, 1_024);
  assert.equal(fixture.originalByteSize, 256);
  assert.equal(fixture.syntheticPaddingBytes, 768);
  assert.equal(fixture.bytes.readUInt32BE(256), 768);
  assert.equal(fixture.bytes.subarray(260, 264).toString('ascii'), 'free');
  assert.equal(isMp4Buffer(fixture.bytes), true);
  assert.throws(() => prepareVideoFixture(input, 260), /G0_OPEN_003_TARGET_PADDING_INVALID/);
  assert.throws(() => prepareVideoFixture(input, 128), /G0_OPEN_003_TARGET_TOO_SMALL/);
});

test('layered upload sends init, every serial chunk, and finish with fresh request IDs', async () => {
  const fixture = prepareVideoFixture(mp4Buffer(3_920_958));
  const calls = [];
  const captures = [];
  const sendReply = async (requestId, body, command) => {
    calls.push({ requestId, body, command });
    if (command === 'aibot_upload_media_init') return { body: { upload_id: 'sensitive-upload-id' } };
    if (command === 'aibot_upload_media_finish') return { body: { media_id: 'sensitive-media-id', type: 'video' } };
    return { errcode: 0, body: {} };
  };
  let sequence = 0;
  const result = await uploadVideoInDocumentedLayers({
    frame: videoFrame(),
    fixture,
    sendReply,
    writeCapture: async (capture) => captures.push(capture),
    createRequestId: (command) => `${command}-${++sequence}`,
  });

  assert.deepEqual(result, { ok: true, mediaId: 'sensitive-media-id' });
  assert.equal(calls[0].command, 'aibot_upload_media_init');
  assert.equal(calls.at(-1).command, 'aibot_upload_media_finish');
  const chunks = calls.filter((call) => call.command === 'aibot_upload_media_chunk');
  assert.equal(chunks.length, 8);
  assert.deepEqual(chunks.map((call) => call.body.chunk_index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(chunks.every((call) => Buffer.from(call.body.base64_data, 'base64').length <= CHUNK_BYTES));
  assert.equal(new Set(calls.map((call) => call.requestId)).size, calls.length);
  assert.deepEqual(captures.map((capture) => capture.kind), [
    'upload_init',
    'upload_chunk',
    'upload_chunk',
    'upload_chunk',
    'upload_chunk',
    'upload_chunk',
    'upload_chunk',
    'upload_chunk',
    'upload_chunk',
    'upload_finish',
  ]);
  const serialized = JSON.stringify(captures);
  for (const sensitiveValue of [
    'sensitive-callback-request-id',
    'sensitive-user-id',
    'sensitive-upload-id',
    'sensitive-media-id',
    'https://download.example.test/sensitive.mp4',
    'sensitive-video-key',
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test('a rejected chunk prevents finish and returns an explicit stage result', async () => {
  const fixture = prepareVideoFixture(mp4Buffer(CHUNK_BYTES + 64));
  const calls = [];
  const captures = [];
  const result = await uploadVideoInDocumentedLayers({
    frame: videoFrame(),
    fixture,
    sendReply: async (requestId, body, command) => {
      calls.push({ requestId, body, command });
      if (command === 'aibot_upload_media_init') return { body: { upload_id: 'sensitive-upload-id' } };
      if (command === 'aibot_upload_media_chunk' && body.chunk_index === 1) throw new Error('reply ack timeout');
      return { body: {} };
    },
    writeCapture: async (capture) => captures.push(capture),
    createRequestId: (command) => `${command}-${calls.length}`,
  });

  assert.deepEqual(result, { ok: false, stage: 'chunk', chunkIndex: 1, errorCode: 'WECOM_UPLOAD_ACK_TIMEOUT' });
  assert.equal(calls.some((call) => call.command === 'aibot_upload_media_finish'), false);
  assert.equal(captures.at(-1).kind, 'upload_chunk');
  assert.equal(captures.at(-1).result.status, 'rejected');
});

test('the probe downloads in memory, completes the layer sequence, then issues one callback-bound reply', async () => {
  const client = new FakeClient();
  const captures = [];
  const probe = runVideoChunkProbe({
    client,
    options: options(),
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
    createRequestId: (command) => `${command}-${Math.random()}`,
  });
  client.emit('authenticated');
  client.emit('message.video', videoFrame());
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'VIDEO_CHUNK_REPLY_ACKNOWLEDGED' });
  assert.equal(client.connected, true);
  assert.equal(client.disconnected, true);
  assert.equal(client.replyCalls.length, 1);
  assert.equal(client.replyCalls[0].mediaType, 'video');
  assert.equal(client.replyCalls[0].finished, true);
  assert.equal(captures[0].kind, 'video_prepared');
  assert.equal(captures.at(-1).kind, 'media_reply');
  assert.equal(captures.at(-1).outbound.client_playback_observation, 'pending_manual_confirmation');
  const serialized = JSON.stringify(captures);
  for (const sensitiveValue of [
    'sensitive-callback-request-id',
    'sensitive-user-id',
    'sensitive-upload-id',
    'sensitive-media-id',
    'https://download.example.test/sensitive.mp4',
    'sensitive-video-key',
    'sensitive-original.mp4',
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test('arguments remain restricted to the G0 evidence directory and 10 MiB provider limit', () => {
  assert.equal(parseVideoChunkArgs([]).scenario, 'video_chunk_echo');
  assert.equal(parseVideoChunkArgs(['--target-bytes=4194304']).targetBytes, 4_194_304);
  assert.throws(() => parseVideoChunkArgs(['--scenario=other']), /G0_OPEN_003_INVALID_SCENARIO/);
  assert.throws(() => parseVideoChunkArgs(['--target-bytes=10485761']), /G0_OPEN_003_INVALID_TARGET_BYTES/);
  assert.throws(() => parseVideoChunkArgs(['--output=tmp/result.jsonl']), /G0_OPEN_003_INVALID_OUTPUT/);
});
