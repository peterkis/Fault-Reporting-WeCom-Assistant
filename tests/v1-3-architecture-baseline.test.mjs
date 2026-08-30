import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

test('V1.3 compatibility command delegates to active V1.4 validation', () => {
  const result = spawnSync(process.execPath, ['scripts/validate-v1-3-architecture.mjs'], {
    cwd: process.cwd(), encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /V1\.4 architecture validation passed/);
});
