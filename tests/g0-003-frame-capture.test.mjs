import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCaptureArgs, sanitizeTextFrame } from '../src/g0-003-frame-capture.mjs';

test('text frame capture records only the permitted, desensitized shape', () => {
  const sensitiveText = '患者张三住院号123456，HIS 登录失败';
  const frame = {
    cmd: 'aibot_msg_callback',
    headers: { req_id: 'request-id-1', opaque: 'not-recorded-value' },
    body: {
      msgid: 'message-id-1',
      aibotid: 'bot-id-1',
      chatid: 'chat-id-1',
      chattype: 'group',
      from: { userid: 'user-id-1' },
      create_time: 1_234_567_890,
      msgtype: 'text',
      text: { content: sensitiveText },
      response_url: 'https://sensitive.example.test/reply',
      quote: { msgtype: 'text', text: { content: 'quoted sensitive text' } },
    },
  };
  const capture = sanitizeTextFrame(frame, 'group_mentioned_text');
  const serialized = JSON.stringify(capture);

  assert.equal(capture.message.chat_type, 'group');
  assert.equal(capture.message.quote.present, true);
  assert.equal(capture.message.text_length_bytes, Buffer.byteLength(sensitiveText, 'utf8'));
  assert.equal(capture.privacy.original_text_recorded, false);
  assert.equal(serialized.includes(sensitiveText), false);
  assert.equal(serialized.includes('message-id-1'), false);
  assert.equal(serialized.includes('user-id-1'), false);
  assert.equal(serialized.includes('sensitive.example.test'), false);
});

test('capture arguments require a named scenario and an evidence jsonl target', () => {
  const parsed = parseCaptureArgs(['--scenario=direct_text', '--max-messages=2', '--timeout-ms=10000']);
  assert.equal(parsed.scenario, 'direct_text');
  assert.equal(parsed.maxMessages, 2);
  assert.throws(() => parseCaptureArgs(['--scenario=unknown']), /G0_CAPTURE_INVALID_SCENARIO/);
  assert.throws(
    () => parseCaptureArgs(['--scenario=direct_text', '--output=tmp/capture.jsonl']),
    /G0_CAPTURE_INVALID_OUTPUT/,
  );
});
