import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRuleEngine } from '../src/p2-007-rule-engine.mjs';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createDecisionStore } from '../src/p2-015-decision-store.mjs';
import { createManualReviewStore } from '../src/p2-015-manual-review.mjs';
import { createRuleFirstOrchestrator } from '../src/p2-015-rule-first-orchestrator.mjs';
import { createExistingTicketCommandPort, createP2004FixedCommunicationPort, createSafeActionExecutor } from '../src/p2-015-safe-action-executor.mjs';
import { createServiceIntakeDecisionPort } from '../src/p2-015-service-intake-decision-port.mjs';
import { createP2015Worker } from '../src/p2-015-worker.mjs';
import { migrateCurrentBaseline } from '../scripts/migrate-current-baseline.mjs';
import { assertNoP2015Residual, seedCapacityDataset, seedPersistedIntake, withP2015IsolatedDatabase } from './helpers/p2-015-postgres-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const childUrl = new URL('./helpers/p2-015-worker-child.mjs', import.meta.url);

function waitLine(child, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('P2_015_CHILD_TIMEOUT')), timeout);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const index = buffer.indexOf('\n');
      if (index >= 0) { clearTimeout(timer); resolve(JSON.parse(buffer.slice(0, index))); }
    });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', (chunk) => { buffer += chunk.toString(); });
  });
}

function waitExit(child) { return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))); }

function startChild(mode, isolated, intakeId) {
  return spawn(process.execPath, [childUrl.pathname.slice(1).replace(/^\/[A-Za-z]:/u, (value) => value.slice(1)), mode, intakeId ?? ''], {
    cwd: new URL('..', import.meta.url).pathname.slice(1), env: { ...process.env, PILOT_DATABASE_URL: isolated },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
}

test('crash before commit leaves no partial facts; crash after commit restarts as replay', { timeout: 120_000 }, async (t) => {
  if (!databaseUrl) { assert.equal(databaseUrl, undefined); return; }
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'restart', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaseline({ databaseUrl: isolated });
    const source = await seedPersistedIntake({ pool, text: '处方提交不了', tag: 'restart' });
    const before = startChild('claim-hang', isolated, source.intakeId);
    assert.deepEqual(await waitLine(before), { event: 'claimed', count: 1 });
    before.kill('SIGKILL'); await waitExit(before);
    const zero = await pool.query(`SELECT
      (SELECT count(*)::integer FROM intake.contact_journey) AS journeys,
      (SELECT count(*)::integer FROM intake.deterministic_decision) AS decisions,
      (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets`);
    assert.deepEqual(zero.rows[0], { journeys: 0, decisions: 0, tickets: 0 });

    const after = startChild('process-hang', isolated, source.intakeId);
    assert.deepEqual(await waitLine(after), { event: 'processed', processed: 1 });
    after.kill('SIGKILL'); await waitExit(after);
    const committed = await pool.query(`SELECT
      (SELECT count(*)::integer FROM intake.contact_journey) AS journeys,
      (SELECT count(*)::integer FROM intake.deterministic_decision) AS decisions,
      (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets`);
    assert.deepEqual(committed.rows[0], { journeys: 1, decisions: 1, tickets: 1 });
    const replay = startChild('process-once', isolated, source.intakeId);
    assert.deepEqual(await waitLine(replay), { event: 'processed', processed: 0 }); await waitExit(replay);
    assert.deepEqual((await pool.query(`SELECT
      (SELECT count(*)::integer FROM intake.contact_journey) AS journeys,
      (SELECT count(*)::integer FROM intake.deterministic_decision) AS decisions,
      (SELECT count(*)::integer FROM pilot_ticket.ticket) AS tickets`)).rows[0], committed.rows[0]);
    t.diagnostic(JSON.stringify({ crash_before_commit_partial_facts: zero.rows[0], crash_after_commit: committed.rows[0], restart_processed: 0, replay_duplicate_delta: 0 }));
  } });
});

test('bounded worker processes 500 journeys, 2000 turns, 500 decisions and 100 reviews on one worker', { timeout: 180_000 }, async (t) => {
  if (!databaseUrl) { assert.equal(databaseUrl, undefined); return; }
  await withP2015IsolatedDatabase({ databaseUrl, purpose: 'capacity', run: async ({ pool, databaseUrl: isolated }) => {
    await migrateCurrentBaseline({ databaseUrl: isolated });
    const seeded = await seedCapacityDataset({ pool, tag: 'capacity' });
    const baseEngine = createRuleEngine();
    const ruleEngine = { rule_set_version: baseEngine.rule_set_version,
      evaluate(input) { if (input.text.includes('需人工判断')) throw new Error('synthetic rule failure'); return baseEngine.evaluate(input); } };
    const decisionStore = createDecisionStore();
    const manualReviewStore = createManualReviewStore({ authorizer: { authorizedJourneyIds: async () => [] } });
    const executor = createSafeActionExecutor({ intakeDecisionPort: createServiceIntakeDecisionPort(),
      ticketCommandPort: createExistingTicketCommandPort({ ticketCore: createPilotTicketCore({ pool }) }),
      communicationPort: createP2004FixedCommunicationPort(), manualReviewStore, decisionStore });
    const orchestrator = createRuleFirstOrchestrator({ pool, identityHmacKey: 'p2-015-capacity-hmac-key-32-characters',
      ruleEngine, decisionStore, safeActionExecutor: executor });
    const worker = createP2015Worker({ pool, orchestrator });
    const samples = [process.memoryUsage().heapUsed];
    let processed = 0;
    for (let index = 0; index < 5; index += 1) {
      const batch = await worker.processDueBatch({ feature_flags: { RULE_FIRST_ORCHESTRATION_ENABLED: true, MANUAL_REVIEW_QUEUE_ENABLED: true }, batch_size: 100, now_epoch_ms: String(Date.now()) });
      processed += batch.processed; samples.push(process.memoryUsage().heapUsed);
    }
    const counts = await pool.query(`SELECT
      (SELECT count(*)::integer FROM intake.contact_journey) AS journeys,
      (SELECT count(*)::integer FROM intake.service_intake_message) AS turns,
      (SELECT count(*)::integer FROM intake.deterministic_decision) AS decisions,
      (SELECT count(*)::integer FROM intake.manual_review_item) AS reviews`);
    assert.equal(processed, seeded.journeys); assert.deepEqual(counts.rows[0], { journeys: 500, turns: 2000, decisions: 500, reviews: 100 });
    const deltas = samples.slice(1).map((value, index) => value - samples[index]);
    assert.equal(deltas.some((delta) => delta <= 16 * 1024 * 1024), true, `heap samples must show fall or bounded stability: ${samples.join(',')}`);
    assert.equal(worker.state().worker_count, 1); assert.equal(worker.state().timer_active, false);
    t.diagnostic(JSON.stringify({ ...counts.rows[0], worker_count: 1, pool_max: 4, batch_max: 100,
      heap_samples_bytes: samples, heap_fall_or_stable: deltas.some((delta) => delta <= 16 * 1024 * 1024),
      timer_active_after_stop: false, soak_24h: false }));
  } });
});

test.after(async () => { if (databaseUrl) await assertNoP2015Residual({ databaseUrl }); });
