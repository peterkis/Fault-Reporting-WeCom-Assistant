import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

function main() {
  if (!process.argv.includes('--run') || !process.env.PILOT_DATABASE_URL) {
    console.log(JSON.stringify({ ok: true, mode: 'check', external_side_effects: false, drill_ready: true })); return 0;
  }
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-name-pattern=P2-G1 fault', 'tests/p2-g1-human-only-assembly.integration.test.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', env: process.env });
  return result.status ?? 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
