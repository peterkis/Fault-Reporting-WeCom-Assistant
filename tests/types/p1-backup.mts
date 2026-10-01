import { Readable, Writable } from 'node:stream';
import { encryptBackupStream, decryptBackupStream } from '../../src/p1-011-encrypted-backup.mjs';

const key = Buffer.alloc(32);
const input = Readable.from(Buffer.from('synthetic'));
const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
const encrypted = await encryptBackupStream({ input, artifactPath: '/synthetic/backup', encryptionKey: key, iv: Buffer.alloc(12) });
const bytes: number = encrypted.encrypted_size_bytes;
await decryptBackupStream({ artifactPath: '/synthetic/backup', encryptionKey: key, output });
void bytes;
// @ts-expect-error -- Encryption requires a byte Buffer, not a textual key.
encryptBackupStream({ input, artifactPath: '/synthetic/backup', encryptionKey: 'key', iv: Buffer.alloc(12) });
// @ts-expect-error -- A string is not a readable stream.
encryptBackupStream({ input: 'plaintext', artifactPath: '/synthetic/backup', encryptionKey: key, iv: Buffer.alloc(12) });
// @ts-expect-error -- Restore consumers must be writable streams.
decryptBackupStream({ artifactPath: '/synthetic/backup', encryptionKey: key, output: 1 });
