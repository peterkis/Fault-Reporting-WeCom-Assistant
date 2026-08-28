import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildOutboundMessage,
  buildOutboundMessages,
  parsePushArgs,
  runPushProbe,
} from '../src/g0-005-active-push.mjs';

class FakeClient extends EventEmitter {
  constructor(sendMessage) {
    super();
    this.sendMessageImpl = sendMessage;
    this.sent = [];
    this.connected = false;
    this.disconnected = false;
  }

  connect() {
    this.connected = true;
  }

  disconnect() {
    this.disconnected = true;
  }

  async sendMessage(target, body) {
    this.sent.push({ target, body });
    return this.sendMessageImpl(target, body);
  }
}

function immediateWait() {
  return Promise.resolve();
}

test('push arguments restrict scenario, timing, repeat and evidence output', () => {
  const valid = parsePushArgs(['--scenario=userid_from_message', '--delay-ms=1000', '--repeat-count=2']);
  assert.equal(valid.repeatCount, 2);
  assert.throws(() => parsePushArgs(['--scenario=not-real']), /G0_PUSH_INVALID_SCENARIO/);
  assert.throws(() => parsePushArgs(['--scenario=invalid_chatid', '--repeat-count=2']), /G0_PUSH_INVALID_ERROR_SCENARIO_OPTIONS/);
  assert.throws(() => parsePushArgs(['--scenario=userid_from_message', '--output=tmp/result.jsonl']), /G0_PUSH_INVALID_OUTPUT/);
});

test('direct push uses userid in memory but records only desensitized delivery evidence', async () => {
  const sensitiveUserId = 'zhangsan-sensitive-userid';
  const client = new FakeClient(async () => ({ cmd: 'aibot_send_msg', headers: { req_id: 'ack-1' }, body: { ok: true }, errcode: 0 }));
  const captures = [];
  const probe = runPushProbe({
    client,
    options: {
      scenario: 'userid_from_message', timeoutMs: 30_000, delayMs: 1, repeatCount: 2, repeatIntervalMs: 1, mentionMode: 'none',
    },
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    wait: immediateWait,
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('authenticated');
  client.emit('message.text', { body: { chattype: 'single', from: { userid: sensitiveUserId } } });
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'PUSH_SERIES_ACKNOWLEDGED' });
  assert.equal(client.sent.length, 2);
  assert.equal(client.sent[0].target, sensitiveUserId);
  assert.equal(captures.length, 2);
  assert.equal(captures[0].target.identifier_hash.length, 16);
  assert.equal(captures[0].outbound.content_hash.length, 16);
  assert.equal(JSON.stringify(captures).includes(sensitiveUserId), false);
  assert.equal(JSON.stringify(captures).includes(client.sent[0].body.markdown.content), false);
});

test('group mention mode is opt-in and invalid chatid rejection keeps SDK error text out of evidence', async () => {
  const markdownTag = buildOutboundMessage({ scenario: 'chatid_from_message', sequence: 1, mentionMode: 'markdown_tag', senderUserId: 'user-1' });
  const textMentionedList = buildOutboundMessage({ scenario: 'chatid_from_message', sequence: 1, mentionMode: 'text_mentioned_list', senderUserId: 'user-1' });
  assert.match(markdownTag.content, /<@user-1>/);
  assert.deepEqual(textMentionedList, { msgtype: 'text', content: 'G0-005 群聊主动推送验证，第 1 条。', mentionedList: ['user-1'] });

  const client = new FakeClient(async () => {
    throw { errcode: 40003, errmsg: 'target-sensitive-error-text' };
  });
  const captures = [];
  const probe = runPushProbe({
    client,
    options: {
      scenario: 'invalid_chatid', timeoutMs: 30_000, delayMs: 1, repeatCount: 1, repeatIntervalMs: 1, mentionMode: 'none',
    },
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    wait: immediateWait,
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('authenticated');
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'EXPECTED_INVALID_TARGET_REJECTION' });
  assert.equal(captures[0].result.error_code, 'WECOM_PUSH_REJECTED');
  assert.equal(captures[0].result.provider_errcode, 40003);
  assert.equal(JSON.stringify(captures).includes('target-sensitive-error-text'), false);
  assert.equal(JSON.stringify(captures).includes(client.sent[0].target), false);
});

test('group markdown-then-text mention probe sends two ordered bodies and treats only the text probe rejection as a valid result', async () => {
  const bodies = buildOutboundMessages({
    scenario: 'chatid_from_message',
    sequence: 1,
    mentionMode: 'markdown_then_text_tag',
    senderUserId: 'user-1',
  });
  assert.deepEqual(bodies.map((body) => [body.msgtype, body.deliveryStep, body.mentionAttempted]), [
    ['markdown', 'markdown_without_mention', false],
    ['text', 'plain_text_mention_tag', true],
  ]);
  assert.equal(bodies[1].content, '<@user-1>');

  const sensitiveChatId = 'sensitive-group-chatid';
  const client = new FakeClient(async (_target, body) => {
    if (body.msgtype === 'text') throw { errcode: 40008, errmsg: 'sensitive-text-message-not-supported' };
    return { cmd: 'aibot_send_msg', headers: { req_id: 'ack-1' }, body: { ok: true }, errcode: 0 };
  });
  const captures = [];
  const probe = runPushProbe({
    client,
    options: {
      scenario: 'chatid_from_message', timeoutMs: 30_000, delayMs: 1, repeatCount: 1, repeatIntervalMs: 1, mentionMode: 'markdown_then_text_tag',
    },
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    wait: immediateWait,
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('authenticated');
  client.emit('message.text', { body: { chattype: 'group', chatid: sensitiveChatId, from: { userid: 'user-1' } } });
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'PUSH_SERIES_COMPLETED_WITH_MENTION_PROBE_REJECTION' });
  assert.deepEqual(client.sent.map(({ body }) => body), [
    { msgtype: 'markdown', markdown: { content: '# G0-005 主动推送验证\n\n群聊主动 Markdown 推送，第 1 条。' } },
    { msgtype: 'text', text: { content: '<@user-1>' } },
  ]);
  assert.deepEqual(captures.map((capture) => [capture.outbound.delivery_step, capture.result.status]), [
    ['markdown_without_mention', 'acknowledged'],
    ['plain_text_mention_tag', 'rejected'],
  ]);
  assert.equal(JSON.stringify(captures).includes(sensitiveChatId), false);
  assert.equal(JSON.stringify(captures).includes('sensitive-text-message-not-supported'), false);
});
