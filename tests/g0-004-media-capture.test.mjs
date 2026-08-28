import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMediaCapture,
  captureExitCode,
  downloadFileWithTimeout,
  INBOUND_MEDIA_EVENT_TYPES,
  parseMediaCaptureArgs,
  sanitizeMediaFrame,
} from '../src/g0-004-media-capture.mjs';

test('media capture records only desensitized frame, download, and filename metadata', async () => {
  const sensitiveText = '患者张三住院号123456';
  const sensitiveUrl = 'https://download.example.test/media?patient=zhangsan';
  const sensitiveKey = 'sensitive-aes-key';
  const sensitiveFilename = '张三-影像.png';
  const frame = {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'request-id-1' },
    body: {
      msgid: 'message-id-1',
      aibotid: 'bot-id-1',
      chatid: 'chat-id-1',
      chattype: 'group',
      from: { userid: 'user-id-1' },
      msgtype: 'mixed',
      response_url: 'https://sensitive.example.test/reply',
      mixed: {
        msg_item: [
          { msgtype: 'text', text: { content: sensitiveText } },
          { msgtype: 'image', image: { url: sensitiveUrl, aeskey: sensitiveKey } },
        ],
      },
    },
  };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const capture = await buildMediaCapture({
    frame,
    scenario: 'mixed_group',
    downloadFile: async () => ({ buffer: png, filename: sensitiveFilename }),
    aeskeyMode: 'actual',
    downloadTimeoutMs: 1_000,
    maxMediaBytes: 1_024,
  });
  const serialized = JSON.stringify(capture);

  assert.equal(capture.message.chat_type, 'group');
  assert.equal(capture.media.mixed.image_item_count, 1);
  assert.equal(capture.media.download_success_count, 1);
  assert.equal(capture.media.downloads[0].magic.mime_type, 'image/png');
  assert.equal(capture.privacy.media_url_recorded, false);
  assert.equal(capture.privacy.aeskey_recorded, false);
  assert.equal(capture.privacy.original_filename_recorded, false);
  for (const sensitiveValue of [sensitiveText, sensitiveUrl, sensitiveKey, sensitiveFilename, 'message-id-1', 'user-id-1']) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test('media capture arguments restrict scenarios, evidence output, and aes key modes', () => {
  const parsed = parseMediaCaptureArgs(['--scenario=image_direct', '--timeout-ms=10000', '--download-timeout-ms=100', '--max-media-bytes=1024']);
  assert.equal(parsed.expected.eventType, 'image');
  assert.equal(parsed.expected.chatType, 'single');
  assert.equal(parseMediaCaptureArgs(['--scenario=voice_direct']).expected.eventType, 'voice');
  assert.equal(parseMediaCaptureArgs(['--scenario=video_direct']).expected.eventType, 'video');
  assert.equal(parseMediaCaptureArgs(['--scenario=video_direct', '--max-media-bytes=104857600']).maxMediaBytes, 104857600);
  assert.deepEqual(INBOUND_MEDIA_EVENT_TYPES, ['image', 'mixed', 'voice', 'file', 'video']);
  assert.throws(() => parseMediaCaptureArgs(['--scenario=unknown']), /G0_MEDIA_INVALID_SCENARIO/);
  assert.throws(() => parseMediaCaptureArgs(['--scenario=image_direct', '--output=tmp/capture.jsonl']), /G0_MEDIA_INVALID_OUTPUT/);
  assert.throws(() => parseMediaCaptureArgs(['--scenario=image_direct', '--aeskey-mode=plain']), /G0_MEDIA_INVALID_AESKEY_MODE/);
  assert.throws(() => parseMediaCaptureArgs(['--scenario=video_direct', '--max-media-bytes=104857601']), /G0_MEDIA_INVALID_MAX_BYTES/);
});

test('voice capture retains only safe transcript metadata and does not download media', async () => {
  const sensitiveTranscript = '输液泵报警，床旁终端无法登录';
  const frame = {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'request-id-voice' },
    body: {
      msgid: 'message-id-voice',
      aibotid: 'bot-id-voice',
      chattype: 'single',
      from: { userid: 'user-id-voice' },
      msgtype: 'voice',
      voice: { content: sensitiveTranscript },
    },
  };
  const capture = await buildMediaCapture({
    frame,
    scenario: 'voice_direct',
    downloadFile: async () => assert.fail('voice callback must not request a media download'),
    aeskeyMode: 'actual',
    downloadTimeoutMs: 1_000,
    maxMediaBytes: 1_024,
  });
  const serialized = JSON.stringify(capture);

  assert.equal(capture.message.message_type, 'voice');
  assert.deepEqual(capture.message.voice_transcript, {
    content_present: true,
    content_length_bytes: Buffer.byteLength(sensitiveTranscript, 'utf8'),
  });
  assert.equal(capture.media.download_success_count, 0);
  assert.equal(capture.media.download_failure_count, 0);
  assert.equal(capture.privacy.original_voice_transcript_recorded, false);
  assert.equal(captureExitCode(capture, 'actual'), 0);
  for (const sensitiveValue of [sensitiveTranscript, 'message-id-voice', 'user-id-voice']) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test('video capture reuses encrypted download evidence without exposing media references', async () => {
  const sensitiveUrl = 'https://download.example.test/video?patient=zhangsan';
  const sensitiveKey = 'sensitive-video-aes-key';
  const sensitiveFilename = '张三-故障录像.mp4';
  const frame = {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'request-id-video' },
    body: {
      msgid: 'message-id-video',
      aibotid: 'bot-id-video',
      chattype: 'single',
      from: { userid: 'user-id-video' },
      msgtype: 'video',
      video: { url: sensitiveUrl, aeskey: sensitiveKey },
    },
  };
  const mp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const capture = await buildMediaCapture({
    frame,
    scenario: 'video_direct',
    downloadFile: async () => ({ buffer: mp4, filename: sensitiveFilename }),
    aeskeyMode: 'actual',
    downloadTimeoutMs: 1_000,
    maxMediaBytes: 100 * 1024 * 1024,
  });
  const serialized = JSON.stringify(capture);

  assert.equal(capture.message.message_type, 'video');
  assert.deepEqual(capture.media.references, [{ source: 'video', url_present: true, aeskey_present: true }]);
  assert.equal(capture.media.download_success_count, 1);
  assert.equal(capture.media.downloads[0].magic.mime_type, 'video/mp4');
  assert.equal(captureExitCode(capture, 'actual'), 0);
  for (const sensitiveValue of [sensitiveUrl, sensitiveKey, sensitiveFilename, 'message-id-video', 'user-id-video']) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test('download evidence maps decrypt failures and local deadline without leaking error details', async () => {
  const frame = {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'request-id-2' },
    body: {
      msgid: 'message-id-2',
      aibotid: 'bot-id-2',
      chattype: 'single',
      from: { userid: 'user-id-2' },
      msgtype: 'image',
      image: { url: 'https://example.test/secret-url', aeskey: 'secret-key' },
    },
  };
  const decryptFailure = await buildMediaCapture({
    frame,
    scenario: 'image_direct',
    downloadFile: async () => { throw new Error('decryptFile: incorrect aesKey secret-key'); },
    aeskeyMode: 'actual',
    downloadTimeoutMs: 1_000,
    maxMediaBytes: 1_024,
  });
  const serialized = JSON.stringify(decryptFailure);
  assert.equal(decryptFailure.media.downloads[0].error_code, 'WECOM_MEDIA_DECRYPT_FAILED');
  assert.equal(serialized.includes('secret-url'), false);
  assert.equal(serialized.includes('secret-key'), false);

  await assert.rejects(
    () => downloadFileWithTimeout(() => new Promise((resolve) => setTimeout(resolve, 30)), 'https://example.test/slow', 'key', 1),
    /G0_MEDIA_DOWNLOAD_TIMEOUT/,
  );
  const sanitized = sanitizeMediaFrame(frame, 'image_direct');
  assert.equal(sanitized.media.references[0].url_present, true);
  assert.equal(sanitized.media.references[0].aeskey_present, true);
});
