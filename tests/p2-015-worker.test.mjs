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

test('worker reserves one bounded slot for the Web owner when Bot backlog is full', async () => {
  let candidateParams; let webCalls = 0;
  const pool = { connect: async () => { throw new Error('Bot rows should not connect in this fixture'); }, query: async (_sql, params) => { candidateParams = params; return { rows: [] }; } };
  const webOrchestrator = { processPendingFromWorker: async ({ batchSize }) => { webCalls += 1; assert.equal(batchSize, 1); return { processed: 1, results: [{ request_ref: 'a'.repeat(32) }] }; } };
  const worker = createP2015Worker({ pool, webOrchestrator, orchestrator: { preparePersistedIntake() {}, processInTransaction() {} } });
  const result = await worker.processDueBatch({ batch_size: 2, now_epoch_ms: '123', feature_flags: { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true } });
  assert.equal(candidateParams[1], 1); assert.equal(webCalls, 1); assert.equal(result.processed, 1); assert.equal(result.web_result.processed, 1);
  const single = await worker.processDueBatch({ batch_size: 1, now_epoch_ms: '123', feature_flags: { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true } });
  assert.equal(candidateParams[1], 0); assert.equal(single.web_result.processed, 1);
});

test('worker falls back to the full Bot batch when the Web owner has no due work', async () => {
  const intakeId = '11111111-1111-4111-8111-111111111111'; let candidateParams; let webCalls = 0;
  const pool = {
    query: async (_sql, params) => { candidateParams = params; return params[1] === 0 ? { rows: [] } : { rows: [{ id: intakeId }] }; },
    connect: async () => ({
      query: async (sql) => sql === 'BEGIN' || sql === 'COMMIT' ? {} : { rowCount: 1, rows: [{ id: intakeId }] },
      release() {},
    }),
  };
  const webOrchestrator = { processPendingFromWorker: async () => { webCalls += 1; return { processed: 0, results: [] }; } };
  const orchestrator = {
    preparePersistedIntake: async () => ({ profile: 'OAUTH_ONLY', reporter_hash: 'a'.repeat(64), primary_message_id: '1' }),
    processInTransaction: async () => ({ decision: { id: '22222222-2222-4222-8222-222222222222', result_code: 'TICKET_ELIGIBLE', replayed: false } }),
  };
  const worker = createP2015Worker({ pool, webOrchestrator, orchestrator });
  const result = await worker.processDueBatch({ batch_size: 1, now_epoch_ms: '123', feature_flags: { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true } });
  assert.equal(webCalls, 1); assert.equal(candidateParams[1], 1); assert.equal(result.processed, 1); assert.equal(result.web_result.processed, 0);
});

test('worker still advances Bot work while Web remains continuously due', async () => {
  const intakeId = '33333333-3333-4333-8333-333333333333'; let candidateParams; let botProcessed = 0;
  const pool = {
    query: async (_sql, params) => { candidateParams = params; return params[1] === 0 ? { rows: [] } : { rows: [{ id: intakeId }] }; },
    connect: async () => ({
      query: async (sql) => sql === 'BEGIN' || sql === 'COMMIT' ? {} : { rowCount: 1, rows: [{ id: intakeId }] },
      release() {},
    }),
  };
  const webOrchestrator = { processPendingFromWorker: async ({ batchSize }) => { assert.equal(batchSize, 1); return { processed: 1, results: [{ request_ref: 'b'.repeat(32) }] }; } };
  const orchestrator = {
    preparePersistedIntake: async () => ({ profile: 'OAUTH_ONLY', reporter_hash: 'a'.repeat(64), primary_message_id: '1' }),
    processInTransaction: async () => { botProcessed += 1; return { decision: { id: '44444444-4444-4444-8444-444444444444', result_code: 'TICKET_ELIGIBLE', replayed: false } }; },
  };
  const worker = createP2015Worker({ pool, webOrchestrator, orchestrator });
  const result = await worker.processDueBatch({ batch_size: 2, now_epoch_ms: '123', feature_flags: { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true } });
  assert.equal(candidateParams[1], 1); assert.equal(botProcessed, 1); assert.equal(result.processed, 2); assert.equal(result.web_result.processed, 1);
});

test('worker counts a failed Web claim against the bounded Bot capacity', async () => {
  let candidateParams;
  const pool = { query: async (_sql, params) => { candidateParams = params; return { rows: [] }; }, connect: async () => { throw new Error('Bot rows should not connect'); } };
  const webOrchestrator = { processPendingFromWorker: async () => ({ processed: 0, claimed: 1, results: [{ pending: true }] }) };
  const worker = createP2015Worker({ pool, webOrchestrator, orchestrator: { preparePersistedIntake() {}, processInTransaction() {} } });
  const result = await worker.processDueBatch({ batch_size: 1, now_epoch_ms: '123', feature_flags: { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true } });
  assert.equal(candidateParams[1], 0); assert.equal(result.processed, 0); assert.equal(result.claimed, 1);
});
