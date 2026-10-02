import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, sourceRoot } from './common.mjs';

// Independently reviewed PR #37 / T04-05 at 1911d364e48530683032f8856c41678c80f69dc9.
// The fingerprint includes every path, old/new mode, full blob ID and change type.
// It describes a known rejection, never business readiness or a runtime path exemption.
const REVIEWED_BASE = '87de2bc9e8835882cd390b024a04e2865cd367f9';
const REVIEWED_RUNTIME_DELTA = '072b0e29d8e4fdf07f27ccbe2c74757a6e2146dfae988642b76c61f249f3a8df';
const RUNTIME_SCOPE = ['src', 'scripts', 'database/migrations', 'web', 'archive', '.env.pilot', 'evidence'];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reportDir, ...extra] = process.argv.slice(2);
  assert.ok(reportDir && extra.length === 0, 'ARCH006_BASELINE_REPORT_REQUIRED');
  const base = process.env.EXPECTED_BASE;
  assert.equal(base, REVIEWED_BASE, 'ARCH006_REVIEWED_BASE_REQUIRED');
  const root = sourceRoot();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...RUNTIME_SCOPE], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(dirty, '', 'ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT');
  const delta = execFileSync('git', ['diff', '--raw', '--full-index', '--no-abbrev', '--no-renames', '-z', base, 'HEAD', '--', ...RUNTIME_SCOPE], { cwd: root, windowsHide: true });
  assert.equal(hash(delta), REVIEWED_RUNTIME_DELTA, 'ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT');
  const reference = readFileSync(path.join(reportDir, 'base-arch006.txt'), 'utf8');
  const current = readFileSync(path.join(reportDir, 'current-arch006.txt'), 'utf8');
  const scope = '- valid pinned local self-service successor scope\n';
  const evidence = '- historical Evidence is immutable; authorized current reports require exact snapshots and current READY proof\n';
  const expectedReference = 'ARCH-006 validation failed with 2 error(s):\n' + scope + evidence;
  assert.equal(reference, expectedReference, 'ARCH006_REFERENCE_REJECTION_DRIFT');
  const expectedCurrent = 'ARCH-006 validation failed with 3 error(s):\n'
    + '- no forbidden Runtime Migration web archive or secret path changed\n' + scope + evidence;
  assert.ok(current === reference || current === expectedCurrent, 'ARCH006_CURRENT_REJECTION_DRIFT');
  console.log('ARCH006_KNOWN_BASELINE_NOT_READY: original validator remains rejected');
}
