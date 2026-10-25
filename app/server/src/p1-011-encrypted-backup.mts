import { createCipheriv, createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface EncryptBackupOptions { input: NodeJS.ReadableStream; artifactPath: string; encryptionKey: Buffer; iv: Buffer }
export interface DecryptBackupOptions { artifactPath: string; encryptionKey: Buffer; output: NodeJS.WritableStream }
export interface EncryptedBackupMetadata { readonly encrypted_size_bytes: number }

const MAGIC = Buffer.from('P1B1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + IV_LENGTH;

function validKey(value: Buffer | undefined): Buffer {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new TypeError('encryptionKey must be a 32-byte Buffer.');
  }
  return value;
}

function validPath(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new TypeError(`${name} must be an absolute path.`);
  }
  return value;
}

function readable(value: NodeJS.ReadableStream | undefined): NodeJS.ReadableStream {
  if (!value || typeof value.pipe !== 'function') {
    throw new TypeError('input must be a readable stream.');
  }
  return value;
}

function writable(value: NodeJS.WritableStream | undefined): NodeJS.WritableStream {
  if (!value || typeof value.write !== 'function') {
    throw new TypeError('output must be a writable stream.');
  }
  return value;
}

function discardPlaintext(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

/**
 * Streams a PostgreSQL logical dump through AES-256-GCM. The destination only
 * contains a fixed magic prefix, IV, ciphertext, and authentication tag; no
 * plaintext dump is ever written to disk by this boundary.
 */
export function encryptBackupStream(options: EncryptBackupOptions): Promise<EncryptedBackupMetadata>;
export async function encryptBackupStream({ input, artifactPath, encryptionKey, iv }: Partial<EncryptBackupOptions> = {}): Promise<EncryptedBackupMetadata> {
  const source = readable(input);
  const targetPath = validPath(artifactPath, 'artifactPath');
  const key = validKey(encryptionKey);
  if (!Buffer.isBuffer(iv) || iv.length !== IV_LENGTH) {
    throw new TypeError('iv must be a 12-byte Buffer.');
  }
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  await writeFile(targetPath, Buffer.concat([MAGIC, iv]), { mode: 0o600 });
  await pipeline(source, cipher, createWriteStream(targetPath, { flags: 'a', mode: 0o600 }));
  await appendFile(targetPath, cipher.getAuthTag(), { mode: 0o600 });
  const metadata = await stat(targetPath);
  return Object.freeze({ encrypted_size_bytes: metadata.size });
}

/**
 * Decrypts a P1 backup straight into a consumer such as pg_restore stdin.
 * A first discard-only pass authenticates the GCM tag, so a malformed artifact
 * cannot expose provisional plaintext to the consumer.
 */
export function decryptBackupStream(options: DecryptBackupOptions): Promise<void>;
export async function decryptBackupStream({ artifactPath, encryptionKey, output }: Partial<DecryptBackupOptions> = {}): Promise<void> {
  const sourcePath = validPath(artifactPath, 'artifactPath');
  const key = validKey(encryptionKey);
  const destination = writable(output);
  const metadata = await stat(sourcePath);
  if (metadata.size <= HEADER_LENGTH + TAG_LENGTH) {
    throw new Error('P1_011_BACKUP_ARTIFACT_INVALID');
  }
  const handle = await open(sourcePath, 'r');
  try {
    const header = Buffer.alloc(HEADER_LENGTH);
    const tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(header, 0, HEADER_LENGTH, 0);
    await handle.read(tag, 0, TAG_LENGTH, metadata.size - TAG_LENGTH);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('P1_011_BACKUP_ARTIFACT_INVALID');
    }
    const verify = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
    verify.setAuthTag(tag);
    await pipeline(
      createReadStream(sourcePath, { start: HEADER_LENGTH, end: metadata.size - TAG_LENGTH - 1 }),
      verify,
      discardPlaintext(),
    );
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(sourcePath, { start: HEADER_LENGTH, end: metadata.size - TAG_LENGTH - 1 }),
      decipher,
      destination,
    );
  } finally {
    await handle.close();
  }
}
