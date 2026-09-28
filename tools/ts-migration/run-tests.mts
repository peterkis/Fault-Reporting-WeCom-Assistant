import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNode, sourceRoot } from './common.mjs';
import { verifyArtifact } from './verify-artifact.mjs';

export function runTests(root: string): void {
  verifyArtifact(root);
  runNode(path.join(root, '.build/runtime'), ['--test', '--test-reporter=tap', '--test-concurrency=1', 'tests/migration-canary.test.mjs']);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('T01_RUNNER_SUPPORTS_CANARY_ONLY_T02_REQUIRED');
  runTests(sourceRoot());
}
