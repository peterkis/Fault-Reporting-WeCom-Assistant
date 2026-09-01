import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function runSynthetic() {
  const files = ['tests/p2-g1-human-only-assembly.test.mjs'];
  if (process.env.PILOT_DATABASE_URL) files.push('tests/p2-g1-human-only-assembly.integration.test.mjs');
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env: process.env });
  return result.status ?? 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = runSynthetic();
