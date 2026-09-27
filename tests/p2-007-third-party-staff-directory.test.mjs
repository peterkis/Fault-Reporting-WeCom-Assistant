import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBotRawUidResolver,
  createFailClosedUidResolver,
  matchDirectoryProfile,
  normalizeOrganizationTree,
  THIRD_STAFF_DIRECTORY_LIMITS,
} from '../src/p2-007-staff-directory-contracts.mjs';
import { createThirdPartyStaffDirectoryAdapter } from '../src/p2-007-third-party-staff-directory-adapter.mjs';
import { createThirdPartyStaffDirectory } from '../src/p2-007-third-party-staff-directory.mjs';
import { sha256Canonical } from '../src/p2-007-domain-utils.mjs';
import { syntheticDirectoryTree } from './helpers/p2-007-directory-fixture.mjs';

const USER = Object.freeze({
  user_id: 'provider-user-a',
  nickname: '用户 A',
  phone: '13800000000',
  tuishiben_id: 'EMP-A',
  wecom_id: 'provider-wecom-a',
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status });
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

for (const status of [401, 403]) {
  for (const endpoint of ['tree', 'detail']) {
    test(`${endpoint} HTTP ${status} evicts the rejected token without an immediate retry`, async () => {
      let tokenCalls = 0, calls = 0;
      const adapter = createThirdPartyStaffDirectoryAdapter({
        keyProvider: () => 'synthetic-key', uidResolver: createBotRawUidResolver(),
        fetchImpl: async (url, options) => {
          if (url.endsWith('/getToken')) return jsonResponse({ result: 'TRUE', data: { token: `token-${++tokenCalls}` } });
          calls++;
          if (calls === 1) return new Response('<html>unauthorized</html>', { status });
          assert.equal(new URLSearchParams(options.body).get('token'), 'token-2');
          return jsonResponse(endpoint === 'tree' ? treeResponse() : { result: 'TRUE', data: {
            user_id: 'provider-user-a', employee_id: 'EMP-A', nickname: '用户 A',
          } });
        },
      });
      const run = () => endpoint === 'tree' ? adapter.syncOrganizationTree({ root_ref: 'root' })
        : adapter.getPersonProfile({ source_identity: { namespace: 'WECOM_AIBOT', value: 'bot-a' } });
      await assert.rejects(run(), { code: `THIRD_STAFF_DIRECTORY_HTTP_${status}` });
      assert.equal(calls, 1);
      await run();
      assert.equal(tokenCalls, 2);
      assert.equal(calls, 2);
      adapter.close();
    });
  }
}

for (const endpoint of ['token', 'tree', 'detail']) {
  for (const declared of [false, true]) {
    test(`${endpoint} response cap cancels ${declared ? 'Content-Length' : 'chunked'} overflow before full buffering`, async () => {
      let pulls = 0, cancelled = false;
      const stream = new ReadableStream({
        pull(controller) { pulls++; controller.enqueue(new Uint8Array(129)); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 });
      const response = new Response(stream, { headers: declared ? { 'content-length': '1000000' } : {} });
      const adapter = createThirdPartyStaffDirectoryAdapter({ keyProvider: () => 'synthetic-key',
        uidResolver: createBotRawUidResolver(),
        limits: { maximumTokenResponseBytes: 256, maximumResponseBytes: 256, maximumDetailResponseBytes: 256 },
        fetchImpl: async url => endpoint === 'token' || !url.endsWith('/getToken') ? response
          : jsonResponse({ result: 'TRUE', data: { token: 'synthetic-token' } }),
      });
      const pending = endpoint === 'detail'
        ? adapter.getPersonProfile({ source_identity: { namespace: 'WECOM_AIBOT', value: 'bot-a' } })
        : adapter.syncOrganizationTree({ root_ref: 'root' });
      await assert.rejects(pending, { code: 'THIRD_STAFF_DIRECTORY_RESPONSE_TOO_LARGE' });
      assert.equal(pulls, declared ? 0 : 2);
      assert.equal(cancelled, true);
      adapter.close();
    });
  }
}

test('late authentication failure cannot evict a newer cached token', { timeout: 5000 }, async () => {
  let tokens = 0, requests = 0;
  const failures = [Promise.withResolvers(), Promise.withResolvers()];
  const entered = [Promise.withResolvers(), Promise.withResolvers()];
  const adapter = createThirdPartyStaffDirectoryAdapter({ keyProvider: () => 'synthetic-key',
    fetchImpl: async (url, options) => {
      if (url.endsWith('/getToken')) return jsonResponse({ result: 'TRUE', data: { token: `token-${++tokens}` } });
      const index = requests++;
      if (index < 2) { entered[index].resolve(); return failures[index].promise; }
      assert.equal(new URLSearchParams(options.body).get('token'), 'token-2');
      return jsonResponse(treeResponse());
    },
  });
  const first = assert.rejects(adapter.syncOrganizationTree({ root_ref: 'root' }), { code: 'THIRD_STAFF_DIRECTORY_HTTP_401' });
  await entered[0].promise;
  const second = assert.rejects(adapter.syncOrganizationTree({ root_ref: 'root' }), { code: 'THIRD_STAFF_DIRECTORY_HTTP_403' });
  await entered[1].promise;
  failures[0].resolve(new Response(null, { status: 401 }));
  await first;
  await adapter.syncOrganizationTree({ root_ref: 'root' });
  failures[1].resolve(new Response('not-json', { status: 403 }));
  await second;
  await adapter.syncOrganizationTree({ root_ref: 'root' });
  assert.equal(tokens, 2);
  adapter.close();
});

test('normalization accepts depth 16 and bounds deep/cyclic input before recursion', () => {
  const root = { id: 'd0', name: 'root', children: [] };
  let current = root;
  for (let depth = 1; depth <= 16; depth++) {
    const child = { id: `d${depth}`, name: 'department', children: [] };
    current.children.push(child); current = child;
  }
  assert.equal(normalizeOrganizationTree([root]).counts.max_depth, 16);
  current.children.push({ id: 'd17', name: 'too deep', children: [] });
  assert.throws(() => normalizeOrganizationTree([root]), { code: 'THIRD_STAFF_DIRECTORY_DEPTH_EXCEEDED' });
});


for (const [departments, members] of [[1, 2_500], [333, 4_290], [5_000, 20_000]]) {
  test(`directory capacity: ${departments} departments / ${members} full-field members`, () => {
    const input = syntheticDirectoryTree({ departments, members });
    const bytes = Buffer.byteLength(JSON.stringify({ result: 'TRUE', data: input }));
    assert.ok(bytes < THIRD_STAFF_DIRECTORY_LIMITS.maximumResponseBytes);
    const normalized = normalizeOrganizationTree(input);
    assert.equal(normalized.counts.departments, departments);
    assert.equal(normalized.counts.members, members);
    assert.equal(normalized.counts.memberships, members);
    if (departments === 333) assert.equal(normalized.counts.max_depth, 4);
    assert.match(normalized.snapshot_version, /^[a-f0-9]{64}$/u);
    assert.ok(Object.isFrozen(normalized.members.at(-1)));
    assert.ok(Object.isFrozen(normalized.memberships));
  });
}

test('directory capacity includes 40000 memberships without limiting each person to one department', () => {
  const input = syntheticDirectoryTree({ departments: 5_000, members: 20_000,
    additionalMemberships: 20_000, fullFields: false });
  assert.ok(Buffer.byteLength(JSON.stringify({ result: 'TRUE', data: input }))
    < THIRD_STAFF_DIRECTORY_LIMITS.maximumResponseBytes);
  const normalized = normalizeOrganizationTree(input);
  assert.equal(normalized.counts.departments, 5_000);
  assert.equal(normalized.counts.members, 20_000);
  assert.equal(normalized.counts.memberships, 40_000);
  assert.equal(normalized.memberships.filter(row => row.provider_user_id === 'u00000').length, 2);
  assert.equal(normalized.members.at(-1).nickname, null);
});

test('directory hash preserves the existing canonical format and generic JSON guards', () => {
  for (const input of [[], treeResponse().data, syntheticDirectoryTree({ departments: 10, members: 25 })]) {
    const { snapshot_version, counts, ...value } = normalizeOrganizationTree(input);
    assert.equal(snapshot_version, sha256Canonical(value));
  }
  assert.throws(() => sha256Canonical(Array.from({ length: 5_001 }, () => null)),
    { code: 'P2_007_LIMIT_EXCEEDED' });
  assert.throws(() => sha256Canonical(Array.from({ length: 4_000 }, () => ({ a: 1, b: 2, c: 3, d: 4 }))),
    { code: 'P2_007_LIMIT_EXCEEDED' });
});

test('formal-size hash is invariant under order but changes with profile or membership data', () => {
  const input = syntheticDirectoryTree();
  const original = normalizeOrganizationTree(input);
  const reordered = structuredClone(input);
  function reverse(nodes) {
    nodes.reverse();
    for (const node of nodes) { node.users.reverse(); reverse(node.children); }
  }
  reverse(reordered);
  assert.equal(normalizeOrganizationTree(reordered).snapshot_version, original.snapshot_version);
  const changedProfile = structuredClone(input);
  changedProfile[0].users[0].nickname = 'Synthetic changed name';
  assert.notEqual(normalizeOrganizationTree(changedProfile).snapshot_version, original.snapshot_version);
  const changedMembership = structuredClone(input);
  changedMembership[0].children[0].users.push(changedMembership[0].users.pop());
  const changed = normalizeOrganizationTree(changedMembership);
  assert.equal(changed.counts.members, original.counts.members);
  assert.equal(changed.counts.memberships, original.counts.memberships);
  assert.notEqual(changed.snapshot_version, original.snapshot_version);
});

test('directory budgets reject excess departments, members and raw membership occurrences', () => {
  const limits = { ...THIRD_STAFF_DIRECTORY_LIMITS, maximumDepartments: 2,
    maximumMembers: 2, maximumMemberships: 3 };
  const atLimit = syntheticDirectoryTree({ departments: 2, members: 2, additionalMemberships: 1, fullFields: false });
  assert.equal(normalizeOrganizationTree(atLimit, limits).counts.memberships, 3);
  assert.throws(() => normalizeOrganizationTree(syntheticDirectoryTree({ departments: 3, members: 2, fullFields: false }), limits),
    { code: 'THIRD_STAFF_DIRECTORY_DEPARTMENT_LIMIT_EXCEEDED' });
  assert.throws(() => normalizeOrganizationTree(syntheticDirectoryTree({ departments: 2, members: 3, fullFields: false }), limits),
    { code: 'THIRD_STAFF_DIRECTORY_MEMBER_LIMIT_EXCEEDED' });
  assert.throws(() => normalizeOrganizationTree(syntheticDirectoryTree({ departments: 2, members: 2,
    additionalMemberships: 2, fullFields: false }), limits),
  { code: 'THIRD_STAFF_DIRECTORY_MEMBERSHIP_LIMIT_EXCEEDED' });
  const repeated = structuredClone(atLimit);
  repeated[0].users.push({ ...repeated[0].users[0] });
  assert.throws(() => normalizeOrganizationTree(repeated, limits),
    { code: 'THIRD_STAFF_DIRECTORY_MEMBERSHIP_LIMIT_EXCEEDED' });
});

test('non-finite and above-ceiling directory budgets fail closed', () => {
  for (const key of ['maximumDepartments', 'maximumMembers', 'maximumMemberships', 'maximumDepth']) {
    for (const invalid of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => normalizeOrganizationTree([], { ...THIRD_STAFF_DIRECTORY_LIMITS, [key]: invalid }),
        { code: 'THIRD_STAFF_DIRECTORY_LIMITS_INVALID' });
    }
  }
});


for (const [label, options, code] of [
  ['departments', { departments: 5_001, members: 0 }, 'THIRD_STAFF_DIRECTORY_DEPARTMENT_LIMIT_EXCEEDED'],
  ['members', { departments: 1, members: 20_001 }, 'THIRD_STAFF_DIRECTORY_MEMBER_LIMIT_EXCEEDED'],
  ['memberships', { departments: 5_000, members: 20_000, additionalMemberships: 20_001 },
    'THIRD_STAFF_DIRECTORY_MEMBERSHIP_LIMIT_EXCEEDED'],
]) {
  test(`directory capacity rejects the first ${label} above its hard ceiling`, () => {
    const input = syntheticDirectoryTree({ ...options, fullFields: false });
    assert.throws(() => normalizeOrganizationTree(input), { code });
  });
}
