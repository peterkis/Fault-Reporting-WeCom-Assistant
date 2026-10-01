import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, sourceRoot } from './common.mjs';

export function assertArch006Baseline(reference: string, current: string, changedRuntimePaths: string[]): void {
  const scope = '- valid pinned local self-service successor scope\n';
  const evidence = '- historical Evidence is immutable; authorized current reports require exact snapshots and current READY proof\n';
  const expectedReference = 'ARCH-006 validation failed with 2 error(s):\n' + scope + evidence;
  assert.equal(reference, expectedReference, 'ARCH006_REFERENCE_REJECTION_DRIFT');
  if (current === reference) return;
  const expectedCurrent = 'ARCH-006 validation failed with 3 error(s):\n'
    + '- no forbidden Runtime Migration web archive or secret path changed\n' + scope + evidence;
  assert.equal(current, expectedCurrent, 'ARCH006_CURRENT_REJECTION_DRIFT');
  // The extra aggregate diagnostic may only describe this batch's reviewed source delta.
  // Unrelated runtime, SQL, web or Evidence changes cannot share the same exception.
  const reviewedDeltas = [
    ['src/p1-001-pilot-foundation.mjs', 'src/p1-001-pilot-foundation.mts',
      'src/p1-007-notification-outbox.mts', 'src/p1-008-first-acknowledgement.mjs',
      'src/p1-008-first-acknowledgement.mts', 'src/p1-011-encrypted-backup.mjs',
      'src/p1-011-encrypted-backup.mts', 'src/p1-012-pilot-e2e.mjs', 'src/p1-012-pilot-e2e.mts'],
    ['src/p1-001-pilot-foundation.mjs', 'src/p1-001-pilot-foundation.mts',
      'src/p1-008-first-acknowledgement.mjs', 'src/p1-008-first-acknowledgement.mts',
      'src/p1-011-encrypted-backup.mjs', 'src/p1-011-encrypted-backup.mts',
      'src/p1-012-pilot-e2e.mjs', 'src/p1-012-pilot-e2e.mts'],
    ['src/p1-005-pilot-ticket-core.mts', 'src/p1-010-ticket-closure.mts',
      'src/p1-011-pilot-operations-baseline.mjs', 'src/p1-011-pilot-operations-baseline.mts'],
    ['src/p1-002-wecom-sdk-adapter.mjs', 'src/p1-002-wecom-sdk-adapter.mts',
      'src/p1-003-channel-message-inbox.mts', 'src/p1-004-service-intake.mjs',
      'src/p1-004-service-intake.mts', 'src/p1-005-pilot-ticket-core.mts',
      'src/p1-009-pilot-access-workbench.mjs', 'src/p1-009-pilot-access-workbench.mts',
      'src/p1-010-ticket-closure.mts'],
    ['src/p1-002-wecom-sdk-adapter.mjs', 'src/p1-002-wecom-sdk-adapter.mts',
      'src/p1-003-channel-message-inbox.mts', 'src/p1-004-service-intake.mjs',
      'src/p1-004-service-intake.mts', 'src/p1-005-pilot-ticket-core.mts',
      'src/p1-006-ticket-state-actions.mts', 'src/p1-009-pilot-access-workbench.mjs',
      'src/p1-009-pilot-access-workbench.mts', 'src/p1-010-ticket-closure.mts'],
  ];
  assert.ok(reviewedDeltas.some(paths => JSON.stringify([...paths].sort()) === JSON.stringify([...changedRuntimePaths].sort())), 'ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reportDir, ...extra] = process.argv.slice(2);
  assert.ok(reportDir && extra.length === 0, 'ARCH006_BASELINE_REPORT_REQUIRED');
  const root = sourceRoot();
  const changed = git(root, ['diff', '--no-renames', '--name-only', 'origin/main', '--',
    'src', 'scripts', 'database/migrations', 'web', 'archive', '.env.pilot', 'evidence']).split(/\r?\n/u).filter(Boolean);
  assertArch006Baseline(readFileSync(path.join(reportDir, 'base-arch006.txt'), 'utf8'),
    readFileSync(path.join(reportDir, 'current-arch006.txt'), 'utf8'), changed);
  console.log('ARCH006_KNOWN_BASELINE_NOT_READY: original validator remains rejected');
}
