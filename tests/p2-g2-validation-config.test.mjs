import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configurationFixture, required, forbidden } from './helpers/p2-g2-configuration-fixture.mjs';
import { readG2Configuration, minimalG2Environment, G2_REQUIRED_FLAGS, G2_LIVE_FUSES } from '../src/p2-g2-validation-config.mjs';


test('P2-G2 synthetic configuration consumes all actual required flags and no live approval', () => {
  assert.deepEqual([...G2_REQUIRED_FLAGS].sort(), [...required].sort());
  const c = readG2Configuration(configurationFixture());
  assert.equal(c.manifest.mode, 'synthetic'); assert.equal(c.liveApproved, false);
  assert.equal(c.databaseUrl.includes('127.0.0.1'), true);
  assert.equal(Object.isFrozen(c.manifest.scope), true);
});

test('P2-G2 missing required flags and every AI/P3 activation fail before assembly', () => {
  for (const key of required) {
    const f = configurationFixture(); delete f.manifest.feature_flags[key];
    assert.throws(() => readG2Configuration(f), { code: 'P2_G2_REQUIRED_FLAG_MISSING' });
  }
  for (const key of forbidden) {
    const f = configurationFixture(); f.manifest.feature_flags[key] = true;
    assert.throws(() => readG2Configuration(f), { code: 'P2_G2_FORBIDDEN_FLAG' });
  }
});

test('P2-G2 live requires its own five fuses, owner start manifest, bounded time and exact candidate', () => {
  const f = configurationFixture('live');
  for (const key of ['P2_012_LIVE_TEST_APPROVED', 'P2_012_REAL_WECOM_SEND_APPROVED']) f.env[key] = 'true';
  assert.throws(() => readG2Configuration(f), { code: 'P2_G2_LIVE_APPROVAL_REQUIRED' });
  for (const key of G2_LIVE_FUSES) f.env[key] = 'true';
  assert.throws(() => readG2Configuration(f), { code: 'P2_G2_OWNER_START_APPROVAL_REQUIRED' });
  Object.assign(f.manifest.approval, { approved: true, authority: 'PROJECT_OWNER',
    source_ref: 'evidence/p2-g2-live-start-approval.md', source_sha256: 'b'.repeat(64) });
  assert.equal(readG2Configuration(f).liveApproved, true);
  assert.throws(() => readG2Configuration({ ...f, candidateFingerprint: 'c'.repeat(64) }), { code: 'P2_G2_CANDIDATE_CHANGED' });
  assert.throws(() => readG2Configuration({ ...f, nowEpochMs: f.manifest.approval.expires_epoch_ms }), { code: 'P2_G2_APPROVAL_EXPIRED' });
  assert.throws(() => readG2Configuration({ ...f, nowEpochMs: '1788799999999' }), { code: 'P2_G2_APPROVAL_NOT_STARTED' });
});

test('P2-G2 rejects unsafe origins, ambiguous scope, excessive budget and non-owned synthetic database', () => {
  for (const mutate of [
    f => { f.manifest.reporter_origin = 'https://reporter.invalid/?token=bad'; },
    f => { f.manifest.scope.group_hashes = []; },
    f => { f.manifest.scope.person_hashes = f.manifest.scope.person_hashes.slice(1); },
    f => { f.manifest.scope.principal_ids = f.manifest.scope.principal_ids.slice(1); },
    f => { f.manifest.scope.direct_organic_person_hash = 'f'.repeat(64); },
    f => { f.manifest.scope.send_budget.total = 100000; },
    f => { f.manifest.scope.principal_ids.reverse(); f.manifest.scope.principal_ids[1] = f.manifest.scope.principal_ids[0]; },
    f => { f.env.PILOT_DATABASE_URL = 'postgres://synthetic:synthetic@public.invalid/main'; },
    f => { f.manifest.scope.test_prefix = ''; },
  ]) { const f = configurationFixture(); mutate(f); assert.throws(() => readG2Configuration(f)); }
});

test('P2-G2 environment allowlist strips model secrets, old approvals and accidental Node hooks', () => {
  const env = minimalG2Environment({ PATH: 'safe-path', OPENAI_API_KEY: 'never-inherit', DEEPSEEK_API_KEY: 'never-inherit',
    P2_012_REAL_WECOM_SEND_APPROVED: 'true', NODE_OPTIONS: '--require unsafe', P2_G2_LIVE_TEST_APPROVED: 'true',
    PILOT_DATABASE_URL: 'private-config-is-injected-explicitly' });
  assert.deepEqual(env, { PATH: 'safe-path' });
});

test('P2-G2 App and Worker validate live configuration without Gateway-only credentials', () => {
  for (const role of ['APP', 'WORKER']) {
    const f = configurationFixture('live');
    for (const key of G2_LIVE_FUSES) f.env[key] = 'true';
    Object.assign(f.manifest.approval, { approved: true, authority: 'PROJECT_OWNER',
      source_ref: 'evidence/p2-g2-live-start-approval.md', source_sha256: 'b'.repeat(64) });
    delete f.env.WECOM_BOT_SECRET; delete f.env.WECOM_WS_URL;
    assert.equal(readG2Configuration({ ...f, role }).liveApproved, true);
    assert.throws(() => readG2Configuration({ ...f, role: 'GATEWAY' }), { code: 'P2_G2_PRIVATE_CONFIGURATION_INVALID' });
  }
});
