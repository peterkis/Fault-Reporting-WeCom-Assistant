import test from 'node:test';
import assert from 'node:assert/strict';
import { createThirdPartyStaffDirectorySyncJob } from '../src/p2-007-staff-directory-sync.mjs';

const snapshot = Object.freeze({
  snapshot_version: 'a'.repeat(64),
  departments: [], members: [], memberships: [], protocol_warnings: [],
  counts: { departments: 0, members: 0, memberships: 0, max_depth: 0 },
});

test('disabled sync job is inert', async () => {
  let calls = 0;
  const job = createThirdPartyStaffDirectorySyncJob({ enabled: false, provider: { syncOrganizationTree: async () => { calls += 1; } } });
  assert.deepEqual(await job.runOnce({ force: true }), { status: 'DISABLED', skipped: true });
  assert.equal(calls, 0);
});

test('sync job publishes once and does not immediately retry a failed run', async () => {
  let now = 1_000_000;
  let providerCalls = 0;
  let publishes = 0;
  let failures = 0;
  const job = createThirdPartyStaffDirectorySyncJob({
    enabled: true, rootRef: 'root', intervalMs: 86_400_000, nowEpochMs: () => now,
    provider: { syncOrganizationTree: async () => { providerCalls += 1; return snapshot; } },
    store: {
      publishSnapshot: async () => { publishes += 1; return { run_id: 'run', snapshot_version: snapshot.snapshot_version, counts: snapshot.counts }; },
      recordSyncFailure: async () => { failures += 1; },
    },
  });
  assert.equal((await job.runOnce()).status, 'SUCCEEDED');
  assert.equal((await job.runOnce()).status, 'NOT_DUE');
  assert.equal(providerCalls, 1);
  assert.equal(publishes, 1);
  assert.equal(failures, 0);
  now += 86_400_000;
  assert.equal((await job.runOnce()).status, 'SUCCEEDED');
  assert.equal(providerCalls, 2);
});

test('failed sync records a bounded error and waits for the next interval', async () => {
  let now = 1_000_000;
  let failures = 0;
  const job = createThirdPartyStaffDirectorySyncJob({
    enabled: true, rootRef: 'root', intervalMs: 86_400_000, nowEpochMs: () => now,
    provider: { syncOrganizationTree: async () => { const error = new Error('not persisted'); error.code = 'THIRD_STAFF_DIRECTORY_TREE_REJECTED'; throw error; } },
    store: {
      publishSnapshot: async () => { throw new Error('must not publish'); },
      recordSyncFailure: async input => { failures += 1; assert.equal(input.error_code, 'THIRD_STAFF_DIRECTORY_TREE_REJECTED'); },
    },
  });
  assert.deepEqual(await job.runOnce(), { status: 'FAILED', error_code: 'THIRD_STAFF_DIRECTORY_TREE_REJECTED' });
  assert.deepEqual(await job.runOnce(), { status: 'NOT_DUE', next_due_epoch_ms: String(now + 86_400_000) });
  assert.equal(failures, 1);
});
