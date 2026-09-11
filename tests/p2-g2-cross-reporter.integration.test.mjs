import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { createIncidentCorrelationWorker } from '../src/p2-015-incident-correlation.mjs';

test('X031 three real independent reports generate one review candidate from persisted facts', async () => {
  const example = readFileSync('tests/fixtures/p2-007/hospital-it-multichannel-evaluation-corpus.v1.jsonl', 'utf8').trim().split(/\r?\n/u).map(JSON.parse).find(r => r.case_id === 'P2-007-X031');
  await withG2Runtime(async f => {
    const speakers = [...new Set(example.turns.map(t => t.speaker))];
    for (const turn of example.turns) {
      await f.inbound(turn.text, { chatType: 'single', reporter: f.reporters[speakers.indexOf(turn.speaker)] });
      await f.pump();
    }
    await f.runtime.incidentExtension.runOnce();
    const rows = (await f.pool.query('SELECT distinct_reporters,distinct_departments,distinct_locations,evidence_fact_ids FROM incident.candidate_review')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].distinct_reporters, 3);
    assert.equal(rows[0].distinct_departments, 0);
    assert.equal(rows[0].distinct_locations, 0);
    assert.ok(rows[0].evidence_fact_ids.length >= 3);
    await Promise.all(Array.from({ length: 12 }, () => f.runtime.incidentExtension.runOnce()));
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.candidate_review')).rows[0].n, 1);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM pilot_ticket.ticket')).rows[0].n, 3);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.incident')).rows[0].n, 0);
    assert.equal(f.providerCalls.length, 0);
  });
});

test('D12-047/048 trusted reporter identity deduplicates group/direct and incoming replay below three reporters', async () => {
  await withG2Runtime(async f => {
    const first = await f.inbound('测试诊室断网。', { chatType: 'group' }); await f.pump();
    await f.runtime.assembly.handleFrame(first.frame); await f.pump();
    await f.inbound('测试诊室也断网。', { chatType: 'single' }); await f.pump();
    await f.inbound('测试护士站断网。', { chatType: 'single', reporter: f.reporters[1] }); await f.pump();
    await f.runtime.incidentExtension.runOnce();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.candidate_review')).rows[0].n, 0);
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM channel.message_inbox')).rows[0].n, 3);
    assert.equal(f.providerCalls.length, 0);
  });
});

test('physical window excludes old/future facts and flag-off has no writes; restart replays snapshot', async () => {
  await withG2Runtime(async f => {
    for (const reporter of f.reporters) { await f.inbound('测试诊室断网。', { chatType: 'single', reporter }); await f.pump(); }
    const bounds = (await f.pool.query('SELECT min(received_epoch_ms)::text AS first,max(received_epoch_ms)::text AS last FROM channel.message_inbox')).rows[0];
    const worker = createIncidentCorrelationWorker({ pool: f.pool, enabled: true });
    assert.equal((await worker.runOnce({ nowEpochMs: String(BigInt(bounds.first) - 1n) })).correlated, 0);
    assert.equal((await worker.runOnce({ nowEpochMs: String(BigInt(bounds.last) + 120001n) })).correlated, 0);
    assert.equal((await createIncidentCorrelationWorker({ pool: f.pool }).runOnce()).correlated, 0);
    const inclusive = String(BigInt(bounds.first) + 120000n);
    assert.equal((await worker.runOnce({ nowEpochMs: inclusive })).correlated, 1);
    assert.equal((await createIncidentCorrelationWorker({ pool: f.pool, enabled: true }).runOnce({ nowEpochMs: inclusive })).correlated, 0);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM intake.deterministic_decision WHERE engine_version='p2-012-candidate-source/1'")).rows[0].n, 1);
    assert.equal(f.providerCalls.length, 0);
  });
});

test('D12-049 different services and incompatible symptoms never borrow each other reporters', async () => {
  for (const texts of [
    ['测试诊室断网。', '测试护士站断网。', '门诊系统进不去。'],
    ['门诊系统进不去。', '门诊系统崩了。', '门诊系统打印不出来。'],
  ]) await withG2Runtime(async f => {
    for (let i = 0; i < texts.length; i++) { await f.inbound(texts[i], { chatType: 'single', reporter: f.reporters[i] }); await f.pump(); }
    await f.runtime.incidentExtension.runOnce();
    assert.equal((await f.pool.query('SELECT count(*)::integer AS n FROM incident.candidate_review')).rows[0].n, 0);
    assert.equal(f.providerCalls.length, 0);
  });
});

test('latest future Decision invalidates the Intake rather than falling back to an old in-window fault', async () => {
  await withG2Runtime(async f => {
    for (const reporter of f.reporters) { await f.inbound('测试诊室断网。', { chatType: 'single', reporter }); await f.pump(); }
    const now = (await f.pool.query('SELECT max(received_epoch_ms)::text AS epoch FROM channel.message_inbox')).rows[0].epoch;
    for (const reporter of f.reporters) { await f.inbound('测试诊室还是断网。', { chatType: 'single', reporter }); await f.pump(); }
    const worker = createIncidentCorrelationWorker({ pool: f.pool, enabled: true });
    assert.equal((await worker.runOnce({ nowEpochMs: now })).correlated, 0);
    assert.equal((await worker.runOnce()).correlated, 1);
  });
});
