import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildGroupMentionReply,
  createGroupMentionCapture,
  parseGroupMentionArgs,
  runGroupMentionProbe,
} from '../src/g0-006-group-reply-mention.mjs';

class FakeClient extends EventEmitter {
  constructor(reply) {
    super();
    this.replyImpl = reply;
    this.replies = [];
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
}

function baseOptions() {
  return {
    timeoutMs: 30_000,
    triggerToken: 'G0-006-REPLY-AT',
    replyMode: 'text',
  };
}

function groupFrame(overrides = {}) {
  return {
    headers: { req_id: 'sensitive-callback-req-id' },
    body: {
      chattype: 'group',
      chatid: 'sensitive-group-chatid',
      from: { userid: 'sensitive-userid' },
      text: { content: 'G0-006-REPLY-AT' },
    },
    ...overrides,
  };
}

test('group mention arguments restrict timeout, trigger token and evidence output', () => {
  const parsed = parseGroupMentionArgs(['--timeout-ms=30000', '--trigger-token=G0_006_TEST', '--reply-mode=stream']);
  assert.equal(parsed.timeoutMs, 30_000);
  assert.equal(parsed.triggerToken, 'G0_006_TEST');
  assert.equal(parsed.replyMode, 'stream');
  assert.throws(() => parseGroupMentionArgs(['--timeout-ms=1']), /G0_GROUP_REPLY_INVALID_TIMEOUT/);
  assert.throws(() => parseGroupMentionArgs(['--trigger-token=含敏感文本']), /G0_GROUP_REPLY_INVALID_TRIGGER_TOKEN/);
  assert.throws(() => parseGroupMentionArgs(['--reply-mode=markdown']), /G0_GROUP_REPLY_INVALID_REPLY_MODE/);
  assert.throws(() => parseGroupMentionArgs(['--output=tmp/result.jsonl']), /G0_GROUP_REPLY_INVALID_OUTPUT/);
});

test('group mention reply uses passive text syntax with the current callback sender', () => {
  const body = buildGroupMentionReply('user-123');
  assert.deepEqual(body, {
    msgtype: 'text',
    text: { content: '<@user-123> G0-006 群内被动回复能力复测' },
  });
  assert.throws(() => buildGroupMentionReply('bad<userid>'), /G0_GROUP_REPLY_INVALID_USERID/);
});

test('stream reply uses the same passive mention syntax in a finished SDK-supported stream body', () => {
  const body = buildGroupMentionReply('user-123', { replyMode: 'stream', streamId: 'stream-1' });
  assert.deepEqual(body, {
    msgtype: 'stream',
    stream: {
      id: 'stream-1',
      finish: true,
      content: '<@user-123> G0-006 群内被动回复能力复测',
    },
  });
  assert.throws(
    () => buildGroupMentionReply('user-123', { replyMode: 'stream' }),
    /G0_GROUP_REPLY_INVALID_STREAM_ID/,
  );
});

test('acknowledged group reply reuses the triggering frame and records only hashes and field shape', async () => {
  const frame = groupFrame();
  const client = new FakeClient(async () => ({
    cmd: 'aibot_respond_msg',
    headers: { req_id: 'sensitive-ack-req-id' },
    body: {},
    errcode: 0,
  }));
  const captures = [];
  const probe = runGroupMentionProbe({
    client,
    options: baseOptions(),
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('authenticated');
  client.emit('message.text', frame);
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'GROUP_REPLY_MENTION_ACKNOWLEDGED' });
  assert.equal(client.replies.length, 1);
  assert.equal(client.replies[0].frame, frame);
  assert.equal(client.replies[0].body.text.content.startsWith('<@sensitive-userid>'), true);
  assert.equal(captures[0].outbound.command, 'aibot_respond_msg');
  assert.equal(captures[0].outbound.callback_req_id_reused, true);
  assert.equal(captures[0].result.receipt.provider_errcode, 0);
  const serialized = JSON.stringify(captures);
  assert.equal(serialized.includes('sensitive-userid'), false);
  assert.equal(serialized.includes('sensitive-group-chatid'), false);
  assert.equal(serialized.includes('sensitive-callback-req-id'), false);
  assert.equal(serialized.includes(client.replies[0].body.text.content), false);
});

test('probe ignores non-group and wrong-token messages before handling the matching group callback', async () => {
  const client = new FakeClient(async () => ({ headers: { req_id: 'ack' }, errcode: 0 }));
  const captures = [];
  const probe = runGroupMentionProbe({
    client,
    options: baseOptions(),
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('message.text', {
    headers: { req_id: 'single' },
    body: { chattype: 'single', from: { userid: 'user' }, text: { content: 'G0-006-REPLY-AT' } },
  });
  client.emit('message.text', {
    headers: { req_id: 'group-wrong-token' },
    body: { chattype: 'group', chatid: 'chat', from: { userid: 'user' }, text: { content: 'not-the-token' } },
  });
  client.emit('message.text', groupFrame());
  const result = await probe.completion;

  assert.equal(result.ok, true);
  assert.equal(client.replies.length, 1);
  assert.equal(captures.length, 1);
});

test('provider rejection is a completed negative capability result and excludes SDK error text', async () => {
  const client = new FakeClient(async () => {
    throw { errcode: 40008, errmsg: 'sensitive-provider-error-text' };
  });
  const captures = [];
  const probe = runGroupMentionProbe({
    client,
    options: baseOptions(),
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('message.text', groupFrame());
  const result = await probe.completion;

  assert.deepEqual(result, {
    ok: true,
    exit_code: 0,
    reason: 'GROUP_REPLY_MENTION_PROVIDER_REJECTED',
    error_code: 'WECOM_GROUP_REPLY_REJECTED',
  });
  assert.equal(captures[0].result.status, 'rejected');
  assert.equal(captures[0].result.provider_errcode, 40008);
  assert.equal(JSON.stringify(captures).includes('sensitive-provider-error-text'), false);
});

test('capture builder never serializes raw callback or reply values', () => {
  const frame = groupFrame();
  const replyBody = buildGroupMentionReply(frame.body.from.userid);
  const capture = createGroupMentionCapture({
    frame,
    replyBody,
    startedAtMs: Date.now(),
    result: 'acknowledged',
    receipt: { headers: { req_id: 'sensitive-ack-id' }, errcode: 0 },
  });
  const serialized = JSON.stringify(capture);
  for (const sensitiveValue of [
    frame.headers.req_id,
    frame.body.chatid,
    frame.body.from.userid,
    replyBody.text.content,
    'sensitive-ack-id',
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});
