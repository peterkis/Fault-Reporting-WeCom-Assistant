import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import {
  decryptBackupStream,
  encryptBackupStream,
} from '../src/p1-011-encrypted-backup.mjs';

test('P1-011 keeps a logical backup encrypted at rest while restoring the exact stream', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-011-encrypted-backup-'));
  const artifactPath = join(directory, 'pilot-core.backup');
  const key = randomBytes(32);
  const plain = Buffer.from('patient-sensitive-content-must-not-appear-in-the-backup-artifact');
  const restored = [];
  try {
    const encrypted = await encryptBackupStream({
      input: Readable.from(plain),
      artifactPath,
      encryptionKey: key,
      iv: Buffer.alloc(12, 7),
    });
    await decryptBackupStream({
      artifactPath,
      encryptionKey: key,
      output: new Writable({
        write(chunk, _encoding, callback) {
          restored.push(Buffer.from(chunk));
          callback();
        },
      }),
    });

    const encryptedBytes = await readFile(artifactPath);
    assert.equal(encryptedBytes.includes(plain), false);
    assert.equal(encrypted.encrypted_size_bytes, encryptedBytes.length);
    assert.deepEqual(Buffer.concat(restored), plain);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P1-011 authenticates an encrypted artifact before exposing any plaintext to the restore consumer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-011-encrypted-backup-tamper-'));
  const artifactPath = join(directory, 'pilot-core.backup');
  const key = randomBytes(32);
  const restored = [];
  try {
    await encryptBackupStream({
      input: Readable.from(Buffer.from('this-must-not-reach-the-restore-consumer')),
      artifactPath,
      encryptionKey: key,
      iv: Buffer.alloc(12, 8),
    });
    const tampered = await readFile(artifactPath);
    tampered[tampered.length - 1] ^= 1;
    await writeFile(artifactPath, tampered);

    await assert.rejects(() => decryptBackupStream({
      artifactPath,
      encryptionKey: key,
      output: new Writable({
        write(chunk, _encoding, callback) {
          restored.push(Buffer.from(chunk));
          callback();
        },
      }),
    }));
    assert.equal(Buffer.concat(restored).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
