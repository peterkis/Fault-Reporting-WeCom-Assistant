import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { verifyG2ApprovalFile, g2ApprovalScopeHash, G2_CANDIDATE_ROOTS, G2_CANDIDATE_FILES, g2CandidateInventory } from '../src/p2-g2-candidate.mjs';
import { g2Hash } from '../src/p2-g2-validation-config.mjs';
import { createG2ProviderGate } from '../src/p2-g2-send-guard.mjs';

test('a file mentioning only run and candidate cannot approve an unbound scope', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'g2-approval-negative-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'evidence'));
  const { manifest } = configurationFixture('live');
  const text = 'SYNTHETIC_NEGATIVE_FIXTURE\nPROJECT_OWNER P2-G2 ' + manifest.run_id + ' ' + manifest.candidate_fingerprint;
  Object.assign(manifest.approval, { approved: true, authority: 'PROJECT_OWNER', source_ref: 'evidence/p2-g2-live-start-approval.md', source_sha256: g2Hash(text) });
  writeFileSync(path.join(root, manifest.approval.source_ref), text);
  assert.throws(() => verifyG2ApprovalFile(manifest, root), /OWNER_APPROVAL_BINDING_MISMATCH/u);
});

test('SDK boundary rechecks a revoked approval after asynchronous destination/grant work', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'g2-sdk-unit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of [...G2_CANDIDATE_ROOTS, 'evidence']) mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of G2_CANDIDATE_FILES) writeFileSync(path.join(root, file), '{}');
  const { manifest, env } = configurationFixture('live');
  manifest.candidate_fingerprint = g2CandidateInventory(root).fingerprint;
  manifest.approval.valid_from_epoch_ms = String(Date.now() - 1000);
  manifest.approval.expires_epoch_ms = String(Date.now() + 60000);
  Object.assign(manifest.approval, { approved: true, authority: 'PROJECT_OWNER', source_ref: 'evidence/p2-g2-live-start-approval.md', source_sha256: 'a'.repeat(64) });
  const text = ['SYNTHETIC_UNIT_FIXTURE_ONLY', 'PROJECT_OWNER P2-G2', manifest.run_id, manifest.candidate_fingerprint,
    'manifest_scope_sha256: ' + g2ApprovalScopeHash(manifest)].join('\n');
  manifest.approval.source_sha256 = g2Hash(text); writeFileSync(path.join(root, manifest.approval.source_ref), text);
  for (const key of ['P2_G2_LIVE_TEST_APPROVED','P2_G2_TEST_SCOPE_CONFIGURED','P2_G2_REAL_WECOM_SEND_APPROVED',
    'P2_G2_INCIDENT_PUBLIC_NOTICE_APPROVED','P2_G2_INCIDENT_PRIVATE_NOTICE_APPROVED']) env[key] = 'true';
  let calls = 0;
  const gate = createG2ProviderGate({ root, manifest, env,
    gateway: { getAuthenticatedClient: () => ({ sendMessage: () => { calls++; return { errcode: 0 }; } }) } });
  const client = gate.getAuthenticatedClient();
  assert.deepEqual(client.sendMessage('synthetic-target', { text: 'synthetic-text' }), { errcode: 0 });
  env.P2_G2_REAL_WECOM_SEND_APPROVED = 'false';
  assert.throws(() => client.sendMessage('synthetic-target', { text: 'synthetic-text' }), /LIVE_APPROVAL_REQUIRED/u);
  assert.equal(calls, 1);
});

test('scope digest binds targets, texts, budget, faults, origin, database, flags and expiry', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'g2-approval-unit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'evidence'));
  const { manifest } = configurationFixture('live');
  Object.assign(manifest.approval, { approved: true, authority: 'PROJECT_OWNER', source_ref: 'evidence/p2-g2-live-start-approval.md', source_sha256: 'a'.repeat(64) });
  const text = ['SYNTHETIC_UNIT_FIXTURE_ONLY', 'PROJECT_OWNER P2-G2', manifest.run_id, manifest.candidate_fingerprint,
    'manifest_scope_sha256: ' + g2ApprovalScopeHash(manifest)].join('\n');
  manifest.approval.source_sha256 = g2Hash(text);
  writeFileSync(path.join(root, manifest.approval.source_ref), text);
  assert.doesNotThrow(() => verifyG2ApprovalFile(manifest, root));
  const mutations = [m => m.scope.group_hashes.push('b'.repeat(64)), m => m.scope.approved_replies.push('unapproved reply'),
    m => { m.scope.send_budget.group++; m.scope.send_budget.total++; }, m => m.scope.allowed_faults.pop(), m => m.reporter_origin = 'https://changed.invalid',
    m => m.scope.database_identity_hash = 'c'.repeat(64), m => m.approval.expires_epoch_ms = String(BigInt(m.approval.expires_epoch_ms) + 1n)];
  for (const mutate of mutations) {
    const changed = structuredClone(manifest); mutate(changed);
    assert.throws(() => verifyG2ApprovalFile(changed, root), /OWNER_APPROVAL_BINDING_MISMATCH/u);
  }
});
