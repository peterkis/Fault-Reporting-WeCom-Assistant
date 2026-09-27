import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBotRawUidResolver,
  createFailClosedUidResolver,
  matchDirectoryProfile,
  normalizeOrganizationTree,
} from '../src/p2-007-staff-directory-contracts.mjs';
import { createThirdPartyStaffDirectoryAdapter } from '../src/p2-007-third-party-staff-directory-adapter.mjs';
import { createThirdPartyStaffDirectory } from '../src/p2-007-third-party-staff-directory.mjs';

const USER = Object.freeze({
  user_id: 'provider-user-a',
  nickname: '用户 A',
  phone: '13800000000',
  tuishiben_id: 'EMP-A',
  wecom_id: 'provider-wecom-a',
});

function jsonResponse(value, status = 200) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => body };
}

function treeResponse() {
  return {
    result: 'TRUE',
    data: [{
      id: 'root', name: '医院', gid: 1, users: [USER], children: [
        { id: 'dept-a', name: '部门 A', gid: 2, users: [], children: [] },
      ],
    }],
  };
}

test('organization tree normalization preserves memberships and records observed gid type', () => {
  const normalized = normalizeOrganizationTree(treeResponse().data);
  assert.equal(normalized.departments.length, 2);
  assert.deepEqual(normalized.memberships, [{
    provider_department_id: 'root', provider_user_id: 'provider-user-a',
  }]);
  assert.equal(normalized.members[0].provider_user_id, 'provider-user-a');
  assert.deepEqual(normalized.protocol_warnings, ['GID_DOCUMENTED_STRING_OBSERVED_NUMBER']);
  assert.match(normalized.snapshot_version, /^[a-f0-9]{64}$/u);
});

test('organization tree normalization rejects duplicate departments and cycles', () => {
  assert.throws(() => normalizeOrganizationTree([
    { id: 'root', name: '医院', children: [{ id: 'root', name: '重复', children: [] }] },
  ]), error => error.code === 'THIRD_STAFF_DIRECTORY_DUPLICATE_DEPARTMENT');

  const cyclic = { id: 'root', name: '医院', children: [] };
  cyclic.children.push(cyclic);
  assert.throws(() => normalizeOrganizationTree([cyclic]), error => error.code === 'THIRD_STAFF_DIRECTORY_CYCLE');
});

test('formal adapter obtains one in-memory token and uses form-urlencoded requests', async () => {
  const calls = [];
  const adapter = createThirdPartyStaffDirectoryAdapter({
    keyProvider: () => 'synthetic-formal-key',
    uidResolver: createBotRawUidResolver(),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: String(options.body), contentType: options.headers['content-type'] });
      if (String(url).endsWith('/token/getToken')) return jsonResponse({ result: 'TRUE', data: { token: 'synthetic-token' } });
      if (String(url).endsWith('/token/getOrganizationTree')) return jsonResponse(treeResponse());
      if (String(url).endsWith('/token/getUserInfo')) return jsonResponse({ result: 'TRUE', data: {
        avatar: 'https://avatar.example.test/a', employee_id: 'EMP-A', nickname: '用户 A',
        phoneno: '13800000000', user_id: 'provider-user-a', sex: '1',
      } });
      throw new Error('unexpected endpoint');
    },
  });

  const tree = await adapter.syncOrganizationTree({ source_scope: 'FORMAL', root_ref: 'root' });
  const detail = await adapter.getPersonProfile({
    source_identity: { namespace: 'WECOM_AIBOT', value: 'bot-user-a' },
  });

  assert.equal(tree.counts.members, 1);
  assert.equal(detail.status, 'RESOLVED');
  assert.equal(detail.profile.sex, '1');
  assert.equal(detail.profile.avatar_url, 'https://avatar.example.test/a');
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(call => call.url.endsWith('/token/getToken')).length, 1);
  assert.ok(calls.every(call => call.contentType === 'application/x-www-form-urlencoded'));
  assert.match(calls[0].body, /key=synthetic-formal-key/u);
  assert.match(calls[2].body, /uid=bot-user-a/u);
  assert.ok(calls.every(call => !call.url.includes('synthetic-token')));
  adapter.close();
});

test('default resolver fails closed without calling the detail endpoint', async () => {
  let detailCalls = 0;
  const adapter = createThirdPartyStaffDirectoryAdapter({
    keyProvider: () => 'synthetic-formal-key',
    uidResolver: createFailClosedUidResolver(),
    fetchImpl: async () => {
      detailCalls += 1;
      return jsonResponse({ result: 'TRUE', data: {} });
    },
  });
  const result = await adapter.getPersonProfile({
    source_identity: { namespace: 'WECOM_AIBOT', value: 'bot-user-a' },
  });
  assert.equal(result.status, 'DEFERRED');
  assert.equal(result.reason_code, 'UID_RESOLVER_DISABLED');
  assert.equal(detailCalls, 0);
});

test('detail and directory records require exact provider identity and employee correlation', () => {
  const profile = { provider_user_id: 'provider-user-a', employee_id: 'EMP-A', display_name: '用户 A', phone: '13800000000' };
  const member = { provider_user_id: 'provider-user-a', employee_id: 'EMP-A', nickname: '用户 A', phone: '13800000000', tuishiben_id: 'EMP-A' };
  assert.deepEqual(matchDirectoryProfile(profile, member), { matched: true, mismatches: [] });
  assert.equal(matchDirectoryProfile({ ...profile, provider_user_id: 'other' }, member).matched, false);
  assert.equal(matchDirectoryProfile({ ...profile, employee_id: 'EMP-B' }, member).matched, false);
});

test('composition is safe to construct while disabled and exposes future injection seams', async () => {
  const directory = createThirdPartyStaffDirectory({
    pool: { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error('not expected'); } },
    enabled: false,
  });
  assert.equal(directory.source, 'THIRD_PARTY_STAFF_DIRECTORY');
  assert.deepEqual(await directory.reporterDirectory.resolve({ source: 'THIRD_PARTY_STAFF_DIRECTORY' }), { status: 'DEFERRED', snapshot: {} });
  assert.deepEqual(await directory.syncJob.runOnce({ force: true }), { status: 'DISABLED', skipped: true });
  directory.close();
});
