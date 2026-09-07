import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { createP2012DynamicWeComSender, createP2012LiveReporterScope } from '../src/p2-012-live-reporter-scope.mjs';
import { P2012_LIVE_FUSES, P2012_REPORTER_SCOPE_MODE, readP2012LiveConfiguration } from '../src/p2-012-live-configuration.mjs';

const tagged = '【p2-012测试】范围登记';
const message = ({ sender, chatType, chatId = null }) => ({
  provider: 'WECOM_AIBOT', bot_id: 'approved-test-bot', sender_user_id: sender,
  chat_type: chatType, chat_id: chatId,
  content: [{ kind: 'text', text: { raw: tagged, clean: tagged } }],
});

test('dynamic live configuration requires an approved group but no preconfigured Reporter userid hash', () => {
  const groupHash = textHashP2016('dedicated-p2-012-test-group');
  const env = {
    ...Object.fromEntries(P2012_LIVE_FUSES.map((key) => [key, 'true'])),
    P2_012_REPORTER_SCOPE_MODE: P2012_REPORTER_SCOPE_MODE,
    P2_012_TEST_USER_TARGET_HASHES: '', P2_012_TEST_GROUP_TARGET_HASHES: groupHash,
    P2_012_TEST_PRINCIPAL_IDS: ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'].join(','),
    P2_012_REPORTER_ORIGIN: 'https://reporter.invalid', P2_012_REPORTER_ALLOWED_HOSTS: 'reporter.invalid',
    P2_012_REPORTER_HMAC_SECRET: 'synthetic-reporter-secret-at-least-32-bytes', P2_012_LISTEN_PORT: '43112',
    PILOT_DATABASE_URL: 'postgres://synthetic.invalid/test', PILOT_LOG_IDENTITY_HASH_KEY: 'synthetic-private-key-not-for-logging',
    WECOM_BOT_ID: 'approved-test-bot', WECOM_BOT_SECRET: 'synthetic-private-secret', WECOM_WS_URL: 'wss://synthetic.invalid',
  };
  const configured = readP2012LiveConfiguration(env);
  assert.equal(configured.reporterScopeMode, P2012_REPORTER_SCOPE_MODE);
  assert.deepEqual(configured.inboundScope.person_hashes, []);
  assert.deepEqual(configured.allowedTargetHashes, [groupHash]);
});

test('dynamic Sender rechecks the persisted approved-group Reporter before each PERSON provider call', async () => {
  const discovered = 'normal-unconfigured-reporter';
  const groupHash = textHashP2016('dedicated-p2-012-test-group');
  const providerTargets = [];
  const pool = { query: async (_sql, values) => ({ rowCount: values[1] === discovered ? 1 : 0, rows: [] }) };
  const gateway = { getAuthenticatedClient: () => ({ sendMessage: async (target) => { providerTargets.push(target); return { errcode: 0, headers: { req_id: 'safe-provider-request' } }; } }) };
  const sender = createP2012DynamicWeComSender({ pool, gateway, enabled: true, cardEnabled: false,
    allowedTargetHashes: [groupHash], approvedGroupHashes: [groupHash], botId: 'approved-test-bot' });
  const request = (target) => ({ provider: 'WECOM_AIBOT', channel_account_id: 'approved-test-bot', target_type: 'PERSON', target_id: target,
    delivery_id: '10000000-0000-4000-8000-000000000001', idempotency_key: 'p2-012-dynamic-sender-test',
    message: { message_type: 'text', content: { text: '【P2-012测试】固定通知' } }, signal: new AbortController().signal });
  assert.equal((await sender.send(request(discovered))).outcome, 'ACKNOWLEDGED');
  assert.equal((await sender.send(request('never-observed-outsider'))).error_code, 'P2_012_SEND_SCOPE_FORBIDDEN');
  assert.deepEqual(providerTargets, [discovered]);
});

test('approved test group discovers an unconfigured Reporter before their direct flow and outbound notice', async () => {
  const configured = 'configured-reporter';
  const discovered = 'normal-unconfigured-reporter';
  const outsider = 'never-observed-outsider';
  const approvedGroup = 'dedicated-p2-012-test-group';
  const observed = new Set();
  const scope = createP2012LiveReporterScope({
    bot_id: 'approved-test-bot',
    person_hashes: [textHashP2016(configured)],
    group_hashes: [textHashP2016(approvedGroup)],
    isApprovedGroupReporter: async ({ sender_user_id }) => observed.has(sender_user_id),
    require_test_label: true,
  });

  assert.equal(await scope.accepts(message({ sender: discovered, chatType: 'group', chatId: approvedGroup })), true);
  assert.equal(await scope.accepts(message({ sender: discovered, chatType: 'single' })), false);
  observed.add(discovered);
  assert.equal(await scope.accepts(message({ sender: discovered, chatType: 'single' })), true);
  assert.equal(await scope.authorizesDestination({ target_type: 'PERSON', target_id: discovered }), true);
  assert.equal(await scope.authorizesDestination({ target_type: 'GROUP', target_id: approvedGroup }), true);
  assert.equal(await scope.accepts(message({ sender: outsider, chatType: 'single' })), false);
  assert.equal(await scope.authorizesDestination({ target_type: 'PERSON', target_id: outsider }), false);
});
