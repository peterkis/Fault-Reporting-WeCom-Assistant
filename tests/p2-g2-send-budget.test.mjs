import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { initializeG2SendBudget, openG2SendBudget } from '../src/p2-g2-send-budget.mjs';

function setup(t, limits = { group: 2, person: 2, total: 3 }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'g2-budget-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'budget.jsonl'), { manifest } = configurationFixture();
  manifest.scope.send_budget = limits;
  initializeG2SendBudget({ file, manifest });
  return { file, manifest, open: () => openG2SendBudget({ file, manifest }) };
}
const entry = (target_type = 'GROUP', delivery_id = randomUUID()) => ({ delivery_id, target_type,
  target_hash: 'b'.repeat(64), message_hash: 'c'.repeat(64), idempotency_hash: 'd'.repeat(64) });

test('send reservations survive restart and count rejected attempts against all limits', t => {
  const f = setup(t), a = entry(), b = entry('PERSON'), c = entry('PERSON');
  const first = f.open().reserve(a);
  assert.equal(first.kind, 'RESERVED');
  f.open().complete(first.ordinal, 'REJECTED_NOT_APPLIED');
  f.open().reserve(a);
  assert.throws(() => f.open().reserve(entry()), /SEND_BUDGET_EXHAUSTED/u);
  f.open().reserve(b);
  assert.throws(() => f.open().reserve(c), /SEND_BUDGET_EXHAUSTED/u);
  assert.deepEqual(f.open().counts(), { group: 2, person: 1, total: 3 });
});

test('ACK, UNKNOWN and crash between reservation and result never authorize resend', t => {
  const f = setup(t), rows = [entry(), entry('PERSON'), entry('PERSON')];
  rows.forEach((row, i) => { const r = f.open().reserve(row); if (i < 2) f.open().complete(r.ordinal, ['ACKNOWLEDGED', 'UNKNOWN'][i]); });
  assert.equal(f.open().reserve(rows[0]).outcome, 'ACKNOWLEDGED');
  assert.equal(f.open().reserve(rows[1]).outcome, 'UNKNOWN');
  assert.equal(f.open().reserve(rows[2]).outcome, 'UNKNOWN');
  assert.deepEqual(f.open().counts(), { group: 1, person: 2, total: 3 });
});

test('changed delivery binding, manifest and corrupt journal fail closed', t => {
  const f = setup(t), row = entry(); f.open().reserve(row);
  assert.throws(() => f.open().reserve({ ...row, target_hash: 'e'.repeat(64) }), /SEND_BINDING_CHANGED/u);
  const changed = structuredClone(f.manifest); changed.scope.send_budget.total = 4;
  assert.throws(() => openG2SendBudget({ file: f.file, manifest: changed }).counts(), /SEND_BUDGET_BINDING/u);
  appendFileSync(f.file, '{partial');
  assert.throws(() => f.open().counts(), /SEND_BUDGET_CORRUPT/u);
});

test('existing journal cannot be reinitialized and stale lock prevents a second sender', t => {
  const f = setup(t);
  assert.throws(() => initializeG2SendBudget(f), /SEND_BUDGET_EXISTS/u);
  writeFileSync(f.file + '.lock', 'crash');
  assert.throws(() => f.open().reserve(entry()), /SEND_BUDGET_LOCKED/u);
});

test('mutating caller manifest after opening cannot increase the frozen budget', t => {
  const f = setup(t, { group: 1, person: 1, total: 1 }), budget = f.open();
  budget.reserve(entry());
  f.manifest.scope.send_budget.group = 2; f.manifest.scope.send_budget.total = 2;
  assert.throws(() => budget.reserve(entry()), /SEND_BUDGET_EXHAUSTED/u);
});

test('only hashed scope and internal identifiers enter budget journal; duplicate finalization rejected', t => {
  const f = setup(t), reserve = f.open().reserve(entry());
  f.open().complete(reserve.ordinal, 'ACKNOWLEDGED');
  assert.throws(() => f.open().complete(reserve.ordinal, 'REJECTED_NOT_APPLIED'), /SEND_RESULT_CONFLICT/u);
  f.open().complete(reserve.ordinal, 'ACKNOWLEDGED');
  const text = readFileSync(f.file, 'utf8');
  for (const forbidden of ['synthetic-g2-bot', 'reporter-a', '处方', '合成测试']) assert.equal(text.includes(forbidden), false);
  assert.equal(text.trimEnd().split('\n').length, 3);
});
