import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createG2EvidenceWriter, readG2Evidence, validateG2EvidenceRecord } from '../src/p2-g2-evidence.mjs';
import { shanghaiLocalToEpochMs } from '../src/platform/time-contract.mjs';

const sha = x => createHash('sha256').update(x).digest('hex');
const stamp = shanghaiLocalToEpochMs('2026-09-08 10:00:00');
const manifest = { run_id: '10000000-0000-4000-8000-000000000001', mode: 'synthetic', candidate_fingerprint: 'a'.repeat(64) };
const input = { scenario_id: 'G2-E01', evidence_type: 'POSTGRES_HTTP_INTEGRATION', result: 'PASS',
  source_refs: [{ kind: 'DB_QUERY', ref: 'intake/counts', sha256: 'b'.repeat(64) }], details: { executed: true, input_persisted_before_route: true } };
function fixture() {
  const body = { schema_version: 1, gate: 'P2-G2', run_id: manifest.run_id, run_mode: 'live', candidate_fingerprint: manifest.candidate_fingerprint,
    scenario_id: 'G2-OWNER', evidence_type: 'PROJECT_OWNER_APPROVAL', producer: 'MANUAL_ATTESTATION', occurred_at: '2026-09-08 10:00:00',
    physical_epoch_ms: stamp, sequence: 1, result: 'PASS', source_refs: [{ kind: 'OWNER_FILE', ref: 'evidence/p2-g2-owner.md', sha256: 'b'.repeat(64) }],
    details: { executed: true, owner_approved: true }, previous_hash: '0'.repeat(64) };
  return { ...body, record_hash: sha(JSON.stringify(body)) };
}
function reseal(r) { const { record_hash, ...body } = r; return { ...body, record_hash: sha(JSON.stringify(body)) }; }

test('P2-G2 evidence appends one ordered hash chain and refuses overwrite or corrupted data', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'p2-g2-evidence-')), file = path.join(dir, 'events.jsonl');
  const writer = createG2EvidenceWriter({ file, manifest, nowEpochMs: () => stamp });
  try {
    writer.append(input); writer.append({ ...input, scenario_id: 'G2-E02' }); writer.close();
    const records = readG2Evidence(file); assert.equal(records.length, 2);
    assert.equal(records[1].previous_hash, records[0].record_hash); assert.equal(records[1].sequence, 2);
    assert.throws(() => createG2EvidenceWriter({ file, manifest }), { code: 'P2_G2_EVIDENCE_ALREADY_EXISTS' });
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, original.replace('"input_persisted_before_route":true', '"input_persisted_before_route":false'));
    assert.throws(() => readG2Evidence(file), { code: 'P2_G2_EVIDENCE_HASH_INVALID' });
  } finally { writer.close(); unlinkSync(file); rmdirSync(dir); }
});

test('P2-G2 automated evidence cannot turn ACK into a client observation or owner approval', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'p2-g2-evidence-')), file = path.join(dir, 'events.jsonl');
  const writer = createG2EvidenceWriter({ file, manifest, nowEpochMs: () => stamp });
  try {
    for (const evidence_type of ['CLIENT_OBSERVATION', 'PROJECT_OWNER_APPROVAL'])
      assert.throws(() => writer.append({ ...input, evidence_type }), { code: 'P2_G2_MANUAL_EVIDENCE_REQUIRED' });
    assert.throws(() => writer.append({ ...input, evidence_type: 'LIVE_WECOM_RECEIPT' }), { code: 'P2_G2_SYNTHETIC_IS_NOT_LIVE_EVIDENCE' });
    assert.throws(() => writer.append({ ...input, details: { executed: false } }), { code: 'P2_G2_NOOP_IS_NOT_PASS' });
    assert.throws(() => writer.append({ ...input, details: { executed: true, token: 'never-store' } }), { code: 'P2_G2_EVIDENCE_INVALID' });
  } finally { writer.close(); unlinkSync(file); rmdirSync(dir); }
});

test('P2-G2 manual attestation requires its matching source kind and integer test counts', () => {
  assert.equal(validateG2EvidenceRecord(fixture()).details.owner_approved, true);
  const wrongSource = fixture(); wrongSource.source_refs[0].kind = 'MODULE';
  assert.throws(() => validateG2EvidenceRecord(reseal(wrongSource)), { code: 'P2_G2_MANUAL_EVIDENCE_SOURCE_REQUIRED' });
  const fractional = fixture(); fractional.details.tests = 1.5;
  assert.throws(() => validateG2EvidenceRecord(reseal(fractional)), { code: 'P2_G2_EVIDENCE_INVALID' });
});
