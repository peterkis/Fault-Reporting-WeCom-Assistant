import test from 'node:test';
import assert from 'node:assert/strict';
import { createThirdPartyReporterDirectory } from '../src/p2-007-third-party-reporter-directory.mjs';
import { THIRD_STAFF_SOURCE } from '../src/p2-007-staff-directory-contracts.mjs';

const hash = 'a'.repeat(64);
const member = Object.freeze({
  provider_user_id: 'provider-user-a', employee_id: 'EMP-A', nickname: '用户 A', phone: '13800000000',
  sex: null, avatar_url: null, account_status: 'ACTIVE', snapshot_version: 'snapshot-v1',
  fetched_at: '2026-09-27 10:00:00', memberships: [{ department_ref: 'dept-a', name: '部门 A', role: 'MEMBER' }],
});

function profile(overrides = {}) {
  return { provider_user_id: 'provider-user-a', employee_id: 'EMP-A', display_name: '用户 A', phone: '13800000000', sex: '1', avatar_url: 'https://avatar.example.test/a', ...overrides };
}

function input() {
  return { source: THIRD_STAFF_SOURCE, source_namespace: 'WECOM_AIBOT', reporter_identity_hash: hash, reporter_external_id: 'bot-user-a' };
}

test('current directory hit returns a report snapshot without external detail call or avatar persistence', async () => {
  let providerCalls = 0;
  const port = createThirdPartyReporterDirectory({
    enabled: true,
    store: {
      findByReporterHash: async () => ({ ...member, sex: '1', avatar_url: 'https://avatar.example.test/a' }),
      findMemberByProviderUserId: async () => member,
      saveResolvedProfile: async () => member,
    },
    provider: { getPersonProfile: async () => { providerCalls += 1; return { status: 'RESOLVED', profile: profile() }; } },
  });
  const result = await port.resolve(input());
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.snapshot.sex, '1');
  assert.equal(Object.hasOwn(result.snapshot, 'avatar'), false);
  assert.equal(providerCalls, 0);
});

test('cache miss resolves detail once, validates the current member, and saves a binding', async () => {
  let saved = null;
  let providerCalls = 0;
  const port = createThirdPartyReporterDirectory({
    enabled: true,
    store: {
      findByReporterHash: async () => null,
      findMemberByProviderUserId: async () => member,
      saveResolvedProfile: async value => { saved = value; return { ...member, sex: value.profile.sex, avatar_url: value.profile.avatar_url }; },
    },
    provider: { getPersonProfile: async value => { providerCalls += 1; assert.equal(value.source_identity.value, 'bot-user-a'); return { status: 'RESOLVED', profile: profile() }; } },
  });
  const result = await port.resolve(input());
  assert.equal(result.status, 'RESOLVED');
  assert.equal(providerCalls, 1);
  assert.equal(saved.reporter_identity_hash, hash);
  assert.equal(saved.profile.sex, '1');
  assert.equal(result.snapshot.memberships[0].department_ref, 'dept-a');
  assert.equal(Object.hasOwn(result.snapshot, 'avatar'), false);
});

test('detail identity mismatch defers and never creates a binding', async () => {
  let saves = 0;
  const port = createThirdPartyReporterDirectory({
    enabled: true,
    store: {
      findByReporterHash: async () => null,
      findMemberByProviderUserId: async () => member,
      saveResolvedProfile: async () => { saves += 1; },
    },
    provider: { getPersonProfile: async () => ({ status: 'RESOLVED', profile: profile({ employee_id: 'EMP-OTHER' }) }) },
  });
  const result = await port.resolve(input());
  assert.deepEqual(result, { status: 'DEFERRED', snapshot: {} });
  assert.equal(saves, 0);
});

test('disabled provider remains deferred without touching the store', async () => {
  let reads = 0;
  const port = createThirdPartyReporterDirectory({
    enabled: false,
    store: { findByReporterHash: async () => { reads += 1; return member; } },
    provider: { getPersonProfile: async () => ({ status: 'RESOLVED', profile: profile() }) },
  });
  assert.deepEqual(await port.resolve(input()), { status: 'DEFERRED', snapshot: {} });
  assert.equal(reads, 0);
});

for (const [epoch, expected] of [
  ['2026-09-27T00:00:00.000Z', '2026-09-27 08:00:00'],
  ['2026-09-27T23:59:59.123Z', '2026-09-28 07:59:59'],
]) {
  test(`default report clock uses Shanghai local time at ${epoch}`, async t => {
    t.mock.method(Date, 'now', () => Date.parse(epoch));
    const port = createThirdPartyReporterDirectory({ enabled: true,
      store: { findByReporterHash: async () => member, findMemberByProviderUserId() {}, saveResolvedProfile() {} },
      provider: { getPersonProfile() { throw new Error('unexpected provider access'); } },
    });
    const result = await port.resolve(input());
    assert.equal(result.snapshot.fetched_at, expected);
    assert.equal(result.snapshot.valid_at, member.fetched_at);
    assert.equal(Object.hasOwn(result.snapshot, 'avatar_url'), false);
  });
}
