import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  buildTemplateCard,
  buildUpdatedCard,
  parseCardArgs,
  runCardProbe,
} from '../src/g0-006-template-card.mjs';

class FakeClient extends EventEmitter {
  constructor({ replyTemplateCard, updateTemplateCard }) {
    super();
    this.replyTemplateCardImpl = replyTemplateCard;
    this.updateTemplateCardImpl = updateTemplateCard;
    this.replyCalls = [];
    this.updateCalls = [];
    this.disconnected = false;
  }

  connect() {}

  disconnect() {
    this.disconnected = true;
  }

  async replyTemplateCard(frame, card) {
    this.replyCalls.push({ frame, card });
    return this.replyTemplateCardImpl(frame, card);
  }

  async updateTemplateCard(frame, card) {
    this.updateCalls.push({ frame, card });
    return this.updateTemplateCardImpl(frame, card);
  }
}

function createClock() {
  let value = 1_000;
  return {
    now: () => value,
    wait: async (milliseconds) => { value += milliseconds; },
  };
}

async function flush() {
  await new Promise((resolveFlush) => setImmediate(resolveFlush));
  await Promise.resolve();
}

function baseOptions(mode, updateDelayMs = 0) {
  return {
    mode,
    chatType: 'single',
    timeoutMs: 30_000,
    updateDelayMs,
    outputPath: 'not-used-by-test',
  };
}

test('card arguments enforce local evidence, trigger chat type, and the five-second late boundary', () => {
  assert.equal(parseCardArgs([]).mode, 'fast');
  assert.equal(parseCardArgs(['--mode=late']).updateDelayMs, 6_000);
  assert.equal(parseCardArgs(['--mode=duplicate', '--chat-type=group']).chatType, 'group');
  assert.throws(() => parseCardArgs(['--mode=late', '--update-delay-ms=5000']), /LATE_DELAY_MUST_EXCEED_FIVE_SECONDS/);
  assert.throws(() => parseCardArgs(['--mode=fast', '--update-delay-ms=1']), /NON_LATE_DELAY_MUST_BE_ZERO/);
  assert.throws(() => parseCardArgs(['--output=tmp/card.jsonl']), /INVALID_OUTPUT/);
});

test('card shape has a unique caller-owned task id and both required actions', () => {
  const card = buildTemplateCard({ taskId: 'g0-006-test_task-1', mode: 'fast' });
  assert.equal(card.card_type, 'button_interaction');
  assert.equal(card.task_id, 'g0-006-test_task-1');
  assert.deepEqual(card.button_list.map((button) => button.key), ['confirm', 'still_unrecovered']);
  assert.deepEqual(buildUpdatedCard({ taskId: card.task_id, action: 'confirm', duplicate: false, preserveButtons: false }).card_action, { type: 1, url: 'https://work.weixin.qq.com' });
  assert.deepEqual(buildUpdatedCard({ taskId: card.task_id, action: 'confirm', duplicate: false, preserveButtons: true }).card_action, { type: 1, url: 'https://work.weixin.qq.com' });
});

test('fast button event updates the matching task id within five seconds without persisting raw input', async () => {
  const clock = createClock();
  const client = new FakeClient({
    replyTemplateCard: async () => ({ headers: { req_id: 'reply-1' }, body: {}, errcode: 0 }),
    updateTemplateCard: async () => ({ headers: { req_id: 'update-1' }, body: {}, errcode: 0 }),
  });
  const captures = [];
  const probe = runCardProbe({
    client,
    options: baseOptions('fast'),
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    wait: clock.wait,
    now: clock.now,
    createTaskId: () => 'g0-006-test_task-1',
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('authenticated');
  client.emit('message.text', { body: { chattype: 'single', from: { userid: 'sensitive-user' }, text: { content: 'sensitive-trigger' } } });
  await flush();
  client.emit('event.template_card_event', {
    headers: { req_id: 'event-1' },
    body: {
      chattype: 'single',
      from: { userid: 'sensitive-user' },
      event: {
        eventtype: 'template_card_event',
        template_card_event: { task_id: 'g0-006-test_task-1', event_key: 'confirm' },
      },
    },
  });
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'FAST_UPDATE_ACKNOWLEDGED' });
  assert.equal(client.replyCalls[0].card.task_id, 'g0-006-test_task-1');
  assert.equal(client.updateCalls[0].card.task_id, 'g0-006-test_task-1');
  assert.deepEqual(captures.map((capture) => capture.kind), ['card_dispatch', 'card_event', 'card_update']);
  assert.equal(captures[2].update.within_five_seconds, true);
  assert.equal(JSON.stringify(captures).includes('sensitive-user'), false);
  assert.equal(JSON.stringify(captures).includes('sensitive-trigger'), false);
});

test('duplicate mode records the second same-user same-action callback and preserves buttons until then', async () => {
  const clock = createClock();
  const client = new FakeClient({
    replyTemplateCard: async () => ({ headers: {}, body: {}, errcode: 0 }),
    updateTemplateCard: async () => ({ headers: {}, body: {}, errcode: 0 }),
  });
  const captures = [];
  const probe = runCardProbe({
    client,
    options: baseOptions('duplicate'),
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    wait: clock.wait,
    now: clock.now,
    createTaskId: () => 'g0-006-test_task-2',
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('authenticated');
  client.emit('message.text', { body: { chattype: 'single', from: { userid: 'sensitive-user' } } });
  await flush();
  const event = { headers: {}, body: { chattype: 'single', from: { userid: 'sensitive-user' }, event: { task_id: 'g0-006-test_task-2', event_key: 'confirm' } } };
  client.emit('event.template_card_event', event);
  await flush();
  assert.equal(client.updateCalls[0].card.card_type, 'button_interaction');
  client.emit('event.template_card_event', event);
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'DUPLICATE_CLICK_UPDATED' });
  const events = captures.filter((capture) => capture.kind === 'card_event');
  assert.deepEqual(events.map((capture) => [capture.event.action_click_index, capture.event.duplicate]), [[1, false], [2, true]]);
  assert.equal(client.updateCalls.length, 2);
});

test('late mode calls update after the limit and records a platform rejection as an explicit expired-behavior result', async () => {
  const clock = createClock();
  const client = new FakeClient({
    replyTemplateCard: async () => ({ headers: {}, body: {}, errcode: 0 }),
    updateTemplateCard: async () => { throw { errcode: 40008, errmsg: 'sensitive-expired-message' }; },
  });
  const captures = [];
  const probe = runCardProbe({
    client,
    options: baseOptions('late', 6_000),
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    wait: clock.wait,
    now: clock.now,
    createTaskId: () => 'g0-006-test_task-3',
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('authenticated');
  client.emit('message.text', { body: { chattype: 'single', from: { userid: 'sensitive-user' } } });
  await flush();
  client.emit('event.template_card_event', { headers: {}, body: { chattype: 'single', from: { userid: 'sensitive-user' }, event: { task_id: 'g0-006-test_task-3', event_key: 'still_unrecovered' } } });
  const result = await probe.completion;

  assert.deepEqual(result, { ok: true, exit_code: 0, reason: 'LATE_UPDATE_REJECTED', error_code: 'WECOM_CARD_REJECTED' });
  const update = captures.at(-1);
  assert.equal(update.kind, 'card_update');
  assert.equal(update.update.invoked_after_event_ms, 6_000);
  assert.equal(update.update.within_five_seconds, false);
  assert.equal(update.result.provider_errcode, 40008);
  assert.equal(JSON.stringify(captures).includes('sensitive-expired-message'), false);
});

test('a task-id mismatch is safely recorded with field names and hashes but never updates a foreign card', async () => {
  const clock = createClock();
  const client = new FakeClient({
    replyTemplateCard: async () => ({ headers: {}, body: {}, errcode: 0 }),
    updateTemplateCard: async () => ({ headers: {}, body: {}, errcode: 0 }),
  });
  const captures = [];
  const probe = runCardProbe({
    client,
    options: baseOptions('fast'),
    writeCapture: async (capture) => captures.push(capture),
    writeEvent: () => {},
    wait: clock.wait,
    now: clock.now,
    createTaskId: () => 'g0-006-current-task',
    setTimeoutFn: () => null,
    clearTimeoutFn: () => {},
  });
  client.emit('authenticated');
  client.emit('message.text', { body: { chattype: 'single', from: { userid: 'sensitive-user' } } });
  await flush();
  client.emit('event.template_card_event', {
    headers: { req_id: 'sensitive-event-id' },
    body: {
      chattype: 'single',
      from: { userid: 'sensitive-user' },
      event: { eventtype: 'template_card_event', task_id: 'g0-006-foreign-task', event_key: 'confirm' },
    },
  });
  await flush();
  const ignored = captures.at(-1);

  assert.equal(ignored.kind, 'card_event_ignored');
  assert.equal(ignored.callback_shape.event_field_path, 'event');
  assert.deepEqual(ignored.callback_shape.event_payload_field_names, ['event_key', 'eventtype', 'task_id']);
  assert.equal(ignored.callback_shape.event_task_id_present, true);
  assert.equal(ignored.callback_shape.task_id_matches_expected, false);
  assert.equal(client.updateCalls.length, 0);
  assert.equal(JSON.stringify(ignored).includes('g0-006-foreign-task'), false);
  assert.equal(JSON.stringify(ignored).includes('sensitive-event-id'), false);
  probe.stop();
  await probe.completion;
});
