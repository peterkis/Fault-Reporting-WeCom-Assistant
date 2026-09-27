import test from 'node:test';
import assert from 'node:assert/strict';
import { createP2015Worker } from '../src/p2-015-worker.mjs';

test('directory maintenance runs in the existing worker even when rule orchestration is disabled', async () => {
  let calls = 0;
  const worker = createP2015Worker({
    pool: { connect: async () => { throw new Error('not expected'); } },
    orchestrator: { preparePersistedIntake() {}, processInTransaction() {} },
    directorySyncJob: { runIfDue: async () => { calls += 1; return { status: 'NOT_DUE' }; } },
  });
  const result = await worker.processDueBatch({ feature_flags: {} });
  assert.equal(calls, 1);
  assert.deepEqual(result.directory_sync, { status: 'NOT_DUE' });
});
