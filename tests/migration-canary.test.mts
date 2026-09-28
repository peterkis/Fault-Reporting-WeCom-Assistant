import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canary, moduleIdentity } from '../src/migration-canary.mjs';
import { callFromLegacy, legacyIdentity } from './fixtures/ts-migration/caller.mjs';

test('compiled TypeScript is called by legacy MJS within one runtime module graph', () => {
  assert.equal(canary({ label: 'typed', sequence: 3 }), 'typed:3');
  assert.equal(callFromLegacy(), 'legacy:7');
  assert.equal(legacyIdentity, moduleIdentity);
  assert.match(fileURLToPath(import.meta.url), /[\\/]\.build[\\/]runtime[\\/]tests[\\/]/u);
  assert.equal(path.resolve(process.cwd()), path.resolve(fileURLToPath(new URL('../', import.meta.url))));
});
