import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { PilotConfigError } from '../src/p1-001-pilot-foundation.mjs';
import { createFirstAcknowledgementService } from '../src/p1-008-first-acknowledgement.mjs';
import { createPilotE2EHandler, evaluatePilotGoNoGo } from '../src/p1-012-pilot-e2e.mjs';
import { encryptBackupStream, decryptBackupStream } from '../src/p1-011-encrypted-backup.mjs';

test('untyped callers retain omitted-option errors and the configuration Error shape', async () => {
  assert.throws(() => Reflect.apply(createFirstAcknowledgementService, undefined, []), /A Channel Message Inbox is required\./u);
  assert.throws(() => Reflect.apply(createPilotE2EHandler, undefined, []), /testGroupId is required\./u);
  await assert.rejects(Reflect.apply(encryptBackupStream, undefined, []), /input must be a readable stream\./u);
  await assert.rejects(Reflect.apply(decryptBackupStream, undefined, []), /artifactPath must be an absolute path\./u);
  const error = new PilotConfigError('SYNTHETIC');
  assert.deepEqual(Object.keys(error), ['code']);
  assert.equal(error.message, 'P1_CONFIG_INVALID:SYNTHETIC');
});

test('Go/No-Go rejects malformed evidence and truthy values cannot satisfy a Gate', () => {
  for (const value of [null, [], 'ready', 1]) assert.throws(() => evaluatePilotGoNoGo(value), /evidence must be an object/u);
  const missing = evaluatePilotGoNoGo({ wss_authenticated: 'true', pilot_owner_approved: 1 });
  assert.equal(missing.decision, 'NO_GO');
  assert.equal(missing.blockers.length, 17);
  assert.equal(missing.blockers[0], 'WSS_AUTHENTICATION_PENDING');
  assert.equal(missing.blockers.at(-1), 'PILOT_OWNER_APPROVAL_PENDING');
});

test('backup consumers receive no plaintext for wrong keys, malformed headers or truncation', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'p1-migration-backup-'));
  const artifactPath = join(scratch, 'encrypted.backup');
  const key = Buffer.alloc(32, 7);
  try {
    await encryptBackupStream({ input: Readable.from(Buffer.from('synthetic-sensitive-payload')), artifactPath, encryptionKey: key, iv: Buffer.alloc(12, 8) });
    const original = await readFile(artifactPath);
    const invalidHeader = Buffer.from(original); invalidHeader[0] = 0;
    for (const [artifact, encryptionKey] of [[original, Buffer.alloc(32, 9)], [invalidHeader, key], [original.subarray(0, 24), key]] as const) {
      await writeFile(artifactPath, artifact);
      const received: Buffer[] = [];
      await assert.rejects(decryptBackupStream({ artifactPath, encryptionKey, output: new Writable({ write(chunk: Buffer, _encoding, done) { received.push(Buffer.from(chunk)); done(); } }) }));
      assert.equal(Buffer.concat(received).length, 0);
    }
  } finally { await rm(scratch, { recursive: true }); }
});

test('backup input validation retains key, IV, absolute-path and consumer checks', async () => {
  const input = Readable.from(Buffer.from('synthetic'));
  const key = Buffer.alloc(32);
  const artifactPath = join(tmpdir(), 'unused-p1-migration.backup');
  const encrypt = (options: unknown): Promise<unknown> => Reflect.apply(encryptBackupStream, undefined, [options]);
  await assert.rejects(encrypt({ input, artifactPath: 'relative.backup', encryptionKey: key, iv: Buffer.alloc(12) }), /artifactPath must be an absolute path/u);
  await assert.rejects(encrypt({ input, artifactPath, encryptionKey: Buffer.alloc(31), iv: Buffer.alloc(12) }), /32-byte Buffer/u);
  await assert.rejects(encrypt({ input, artifactPath, encryptionKey: key, iv: Buffer.alloc(11) }), /12-byte Buffer/u);
  await assert.rejects(Reflect.apply(decryptBackupStream, undefined, [{ artifactPath, encryptionKey: key, output: {} }]), /output must be a writable stream/u);
});
