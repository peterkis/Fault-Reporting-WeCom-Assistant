import test from 'node:test';
import assert from 'node:assert/strict';
import { P2_015_LIMITS } from '../src/p2-015-domain-contracts.mjs';
import { createP2015Worker } from '../src/p2-015-worker.mjs';

test('worker defaults are bounded and disabled flags claim nothing', async () => {
  let queries = 0;
  const pool = { connect: async () => { throw new Error('should not connect'); }, query: async () => { queries += 1; return { rows: [] }; } };
  const orchestrator = { preparePersistedIntake() {}, processInTransaction() {} };
  const worker = createP2015Worker({ pool, orchestrator, pollMilliseconds: 100 });
  const result = await worker.processDueBatch({ feature_flags: {} });
  assert.deepEqual(result, { processed: 0, claimed: 0, disabled: true, model_provider_calls: 0 });
  assert.equal(queries, 0);
  assert.equal(P2_015_LIMITS.defaultBatch, 20); assert.equal(P2_015_LIMITS.maximumBatch, 100);
  assert.equal(P2_015_LIMITS.poolMax, 4); assert.equal(P2_015_LIMITS.workerCount, 1);
  assert.equal(P2_015_LIMITS.messageWindowTurns, 50); assert.equal(P2_015_LIMITS.evaluatedTextCharacters, 20_000);
  assert.equal(worker.start({ feature_flags: {} }), true);
  assert.equal(worker.start({ feature_flags: {} }), false);
  assert.equal((await worker.stop()).timer_active, false);
});

test('worker rejects batches above maximum without querying storage', async () => {
  const pool = { connect: async () => {}, query: async () => { throw new Error('should not query'); } };
  const worker = createP2015Worker({ pool, orchestrator: { preparePersistedIntake() {}, processInTransaction() {} } });
  await assert.rejects(worker.processDueBatch({ batch_size: 101, feature_flags: { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true } }), { code: 'P2_015_LIMIT_EXCEEDED' });
});
