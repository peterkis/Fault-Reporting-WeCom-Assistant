import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { createG2SendGuard } from '../src/p2-g2-send-guard.mjs';
import { initializeG2SendBudget, openG2SendBudget } from '../src/p2-g2-send-budget.mjs';
import { createCommunicationDeliveryWorker } from '../src/p2-004-communication-delivery-worker.mjs';
import { g2CandidateInventory } from '../src/p2-g2-candidate.mjs';
import { g2DatabaseIdentity, g2Hash } from '../src/p2-g2-validation-config.mjs';

test('Gate guard checks actual PostgreSQL Delivery binding and preserves existing Direct Leg and numeric ACK sender', async t => {
  await withG2Runtime(async f => {
    const { manifest, env } = configurationFixture();
    const currentDatabase = (await f.pool.query('SELECT current_database() AS name')).rows[0].name;
    const db = new URL(process.env.PILOT_DATABASE_URL); db.pathname = '/' + currentDatabase;
    env.PILOT_DATABASE_URL = db.href;
    manifest.scope.database_identity_hash = g2DatabaseIdentity(db.href).fingerprint;
    manifest.scope.person_hashes = f.reporters.map(g2Hash); manifest.scope.direct_organic_person_hash = g2Hash(f.reporters[2]);
    manifest.scope.principal_ids[0] = f.admin.id;
    manifest.approval.valid_from_epoch_ms = String(Date.now() - 1000);
    manifest.approval.expires_epoch_ms = String(Date.now() + 3600000);
    manifest.candidate_fingerprint = g2CandidateInventory().fingerprint;
    const directory = mkdtempSync(path.join(tmpdir(), 'g2-guard-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const budgetFile = path.join(directory, 'budget.jsonl');
    initializeG2SendBudget({ file: budgetFile, manifest });
    const guard = createG2SendGuard({ pool: f.pool, sender: f.sender, manifest, env, budgetFile });
    const checked = [];
    // This callback runs several real candidate inventories before checking ACK replay.
    // Keep a bounded fixture deadline inside the default lease; core integration owns timeout tests.
    const delivery = createCommunicationDeliveryWorker({ pool: f.pool, enabled: true, sendTimeoutMs: 20_000, sender: { send: async request => {
      if (request.target_type === 'GROUP') {
        const r = await guard.send(request); assert.equal(r.error_code, 'P2_G2_SEND_GROUP_LABEL_REQUIRED');
        checked.push('UNLABELLED_GROUP'); return r;
      }
      const before = f.providerCalls.length;
      for (const forged of [{ ...request, target_id: 'foreign-reporter' },
        { ...request, message: { ...request.message, content: { text: 'internal-note-canary' } } },
        { ...request, idempotency_key: 'forged-idempotency-key' }]) {
        assert.equal((await guard.send(forged)).error_code, 'P2_G2_SEND_BINDING_INVALID');
      }
      assert.equal(f.providerCalls.length, before);
      const result = await guard.send(request); assert.equal(result.outcome, 'ACKNOWLEDGED');
      assert.equal(f.providerCalls.length, before + 1);
      assert.equal((await guard.send(request)).outcome, 'ACKNOWLEDGED');
      assert.equal(f.providerCalls.length, before + 1, 'journal ACK prevents a duplicate SDK call');
      checked.push('ACK_REPLAY'); return result;
    } } });
    await f.inbound('【p2-012测试】处方提交不了', { chatType: 'single' }); await f.pump();
    await f.inbound('【p2-012测试】@测试助手', { reporter: f.reporters[1] }); await f.pump();
    await delivery.runOnce();
    assert.ok(checked.includes('ACK_REPLAY')); assert.ok(checked.includes('UNLABELLED_GROUP'));
    assert.equal(openG2SendBudget({ file: budgetFile, manifest }).counts().total, 1);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE status='SENT'")).rows[0].n, 1);
    assert.equal((await f.pool.query("SELECT count(*)::integer AS n FROM communication.delivery WHERE status='DEAD_LETTER' AND last_error_code='P2_G2_SEND_GROUP_LABEL_REQUIRED'")).rows[0].n, 1);
  },{ticketNotificationAdditionalEvents:['ticket.created']});
});
