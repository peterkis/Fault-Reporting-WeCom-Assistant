import test from 'node:test';
import assert from 'node:assert/strict';
import { createThirdPartyReporterDirectory, buildThirdPartyReportSnapshot } from '../src/p2-007-third-party-reporter-directory.mjs';
import { THIRD_STAFF_SOURCE } from '../src/p2-007-staff-directory-contracts.mjs';

import { createReporterDirectoryPort } from '../src/p2-015-contact-journey.mjs';
import { createRuleFirstOrchestrator } from '../src/p2-015-rule-first-orchestrator.mjs';
import { projectContactJourney } from '../src/p2-015-projections.mjs';
import { sha256Canonical } from '../src/p2-007-domain-utils.mjs';
import { snapshotP2015Json } from '../src/p2-015-domain-contracts.mjs';

import { snapshotReporterProfile, snapshotReporterProfileEnvelope } from '../src/p2-015-reporter-profile.mjs';

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


function manyMemberships(count = 5_000) {
  return Array.from({ length: count }, (_, i) => ({ department_ref: `dept-${i}`, name: `部门 ${i}`, role: 'MEMBER' }));
}
function largeSnapshot() {
  // Build the envelope without the production hash to test each later boundary independently.
  return { ...buildThirdPartyReportSnapshot(member, null, '2026-09-27 12:00:00'), memberships: manyMemberships() };
}
function largePort({ hit = true, count = 5_000 } = {}) {
  const current = { ...member, memberships: manyMemberships(count) };
  let calls = 0;
  const port = createThirdPartyReporterDirectory({ enabled: true, now: () => '2026-09-27 12:00:00',
    store: { findByReporterHash: async () => hit ? current : null,
      findMemberByProviderUserId: async () => current, saveResolvedProfile: async () => current },
    provider: { getPersonProfile: async () => { calls++; return { status: 'RESOLVED', profile: profile() }; } },
  });
  return { port, calls: () => calls, current };
}

test('one member in 5000 departments has a complete bounded report hash', () => {
  const value = buildThirdPartyReportSnapshot({ ...member, memberships: manyMemberships() }, null, '2026-09-27 12:00:00');
  assert.equal(value.memberships.length, 5_000);
  assert.equal(value.memberships.at(-1).department_ref, 'dept-4999');
  assert.match(value.version, /^third-party-member-[a-f0-9]{64}$/u);
});

test('directory port copies and freezes the complete 5000-membership result', async () => {
  const supplied = largeSnapshot();
  const port = createReporterDirectoryPort({ resolveProfile: async () => ({ status: 'RESOLVED', snapshot: supplied }) });
  const result = await port.resolve(input());
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.snapshot.memberships.length, 5_000);
  assert.equal(Object.isFrozen(result.snapshot.memberships.at(-1)), true);
  supplied.memberships[0].name = 'changed after resolution';
  assert.notEqual(result.snapshot.memberships[0].name, supplied.memberships[0].name);
});

for (const hit of [true, false]) {
  test(`report intake resolves all 5000 memberships on ${hit ? 'cache hit' : 'detail lookup'}`, async () => {
    const { port, calls } = largePort({ hit });
    const result = await port.resolve(input());
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.snapshot.memberships.length, 5_000);
    assert.equal(calls(), hit ? 0 : 1);
    for (const field of ['avatar', 'avatar_url', 'provider_user_id', 'employee_id', 'provider_wecom_id']) {
      assert.equal(Object.hasOwn(result.snapshot, field), false);
    }
  });
}

test('orchestrator preparation retains a complete resolved profile without a generic envelope overflow', async () => {
  const supplied = { status: 'RESOLVED', snapshot: largeSnapshot() };
  const row = { id: 'intake-test', primary_message_id: '1', source_provider: 'WECOM_AIBOT',
    source_bot_id: 'bot-test', reporter_wecom_userid: 'user-test' };
  const orchestrator = createRuleFirstOrchestrator({ pool: { connect() {}, query: async () => ({ rowCount: 1, rows: [row] }) },
    identityHmacKey: 'synthetic-key-with-at-least-32-characters', directoryPort: { resolve: async () => supplied },
    ruleEngine: {}, safeActionExecutor: {} });
  const prepared = await orchestrator.preparePersistedIntake(row.id);
  assert.equal(prepared.profile.status, 'RESOLVED');
  assert.equal(prepared.profile.snapshot.memberships.length, 5_000);
  assert.equal(Object.isFrozen(prepared.profile.snapshot.memberships[0]), true);
  assert.notEqual(prepared.profile.snapshot, supplied.snapshot);
});

test('public and authorized restricted journey projections tolerate the stored maximum profile', () => {
  const row = { id: 'journey', origin_intake_id: 'intake', linked_ticket_id: null,
    entry_mode: 'DIRECT_ORGANIC', origin_channel: 'WECOM_DIRECT', current_channel: 'WECOM_DIRECT',
    profile_resolution_status: 'RESOLVED', profile_snapshot: largeSnapshot(), status: 'OPEN', row_version: '1',
    reported_at: '2026-09-27 12:00:00', last_activity_at: '2026-09-27 12:00:00', ended_at: null };
  const publicView = projectContactJourney(row);
  assert.equal(Object.hasOwn(publicView, 'profile_snapshot'), false);
  assert.equal(JSON.stringify(publicView).includes('dept-4999'), false);
  const restricted = projectContactJourney(row, { restricted: true });
  assert.equal(restricted.profile_snapshot.memberships.length, 5_000);
  assert.equal(Object.isFrozen(restricted.profile_snapshot.memberships.at(-1)), true);
});

test('report hashing preserves old canonical bytes and shared JSON guards', () => {
  const { version, ...value } = buildThirdPartyReportSnapshot(member, null, '2026-09-27 12:00:00');
  assert.equal(version, `third-party-member-${sha256Canonical(value)}`);
  const supplied = largeSnapshot();
  assert.throws(() => sha256Canonical(supplied), { code: 'P2_007_LIMIT_EXCEEDED' });
  assert.throws(() => snapshotP2015Json(supplied), { code: 'P2_015_LIMIT_EXCEEDED' });
});

test('5001 memberships are rejected rather than silently truncated or resolved', async () => {
  const { port, current } = largePort({ count: 5_001 });
  assert.throws(() => buildThirdPartyReportSnapshot(current, null, '2026-09-27 12:00:00'));
  assert.deepEqual(await port.resolve(input()), { status: 'DEFERRED', snapshot: {} });
});


test('profile-specific allowance does not enlarge other envelope fields or legacy provider limits', () => {
  assert.throws(() => snapshotReporterProfileEnvelope({ profile_snapshot: largeSnapshot(), unrelated: Array(5_001).fill(0) }),
    { code: 'P2_015_LIMIT_EXCEEDED' });
  assert.throws(() => snapshotReporterProfile({ ...largeSnapshot(), source: 'WECOM_DIRECTORY' }),
    { code: 'P2_015_LIMIT_EXCEEDED' });
  assert.throws(() => snapshotReporterProfile({ ...largeSnapshot(), avatar_url: 'https://avatar.example.test/private' }),
    { code: 'P2_015_INPUT_INVALID' });
  const legacy = { source: 'WECOM_DIRECTORY', version: 'old-v1', departments: ['a'] };
  assert.deepEqual(snapshotReporterProfile(legacy), legacy);
});

test('profile envelope guards reject accessors, proxies, symbols and polluted keys without executing them', () => {
  let calls = 0;
  const getter = () => { calls++; return largeSnapshot(); };
  const invalid = [
    Object.defineProperty({}, 'profile_snapshot', { get: getter, enumerable: true }),
    Object.defineProperty({ profile_snapshot: {} }, 'metadata', { get: getter, enumerable: true }),
    { profile_snapshot: Object.defineProperty({}, 'source', { get: getter, enumerable: true }) },
    { profile_snapshot: new Proxy({}, { getPrototypeOf: getter, ownKeys: getter, get: getter }) },
    { profile_snapshot: {}, [Symbol('hidden')]: 'not-json' },
    JSON.parse('{"profile_snapshot":{},"__proto__":{"polluted":true}}'),
  ];
  for (const value of invalid) assert.throws(() => snapshotReporterProfileEnvelope(value), { code: 'P2_015_INPUT_INVALID' });
  assert.equal(calls, 0);
});

test('maximum membership fields remain supported, and overlong or structured fields are rejected', async () => {
  const memberships = manyMemberships().map(m => ({ ...m, name: '部'.repeat(256) }));
  const supplied = buildThirdPartyReportSnapshot({ ...member, memberships }, null, '2026-09-27 12:00:00');
  const port = createReporterDirectoryPort({ resolveProfile: async () => ({ status: 'RESOLVED', snapshot: supplied }) });
  assert.equal((await port.resolve(input())).snapshot.memberships.at(-1).name.length, 256);
  for (const name of ['x'.repeat(257), { nested: 'not-a-name' }]) {
    assert.throws(() => snapshotReporterProfile({ ...supplied, memberships: [{ ...memberships[0], name }] }));
  }
});
