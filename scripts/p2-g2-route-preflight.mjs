import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Bounded LOCAL diagnostic only. This is not the Gate live runner or a readiness evaluator.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
  console.log('Usage: node scripts/p2-g2-route-preflight.mjs --run-local\nRuns only the four route prerequisite cases against a new local isolated database; reads only PILOT_DATABASE_URL from .env.pilot. Expected RED while the domain gap exists. No WeCom, cloud deployment or Gate approval.');
} else if (args.length !== 1 || args[0] !== '--run-local') {
  console.error('P2_G2_ROUTE_PREFLIGHT_ARGS_INVALID'); process.exitCode = 2;
} else {
  try {
    const databaseUrl = parseEnv(readFileSync(path.join(root, '.env.pilot'), 'utf8')).PILOT_DATABASE_URL;
    const target = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(target.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('P2_G2_LOCAL_DATABASE_ONLY');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA)$/iu.test(key)));
    env.PILOT_DATABASE_URL = databaseUrl;
    const nodeArgs = ['--expose-gc', '--test', '--test-concurrency=1', '--test-reporter=tap',
      'tests/p2-g2-service-route-readiness.integration.test.mjs'];
    const run = spawnSync(process.execPath, nodeArgs, { cwd: root, env, encoding: 'utf8', windowsHide: true,
      timeout: 150000, maxBuffer: 8 * 1024 * 1024 });
    const directory = path.join(root, 'tmp', 'p2-g2-route-' + randomUUID());
    mkdirSync(directory);
    const secrets = [databaseUrl, target.password, decodeURIComponent(target.password)].filter(Boolean);
    const safe = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), value ?? '');
    const stdout = safe(run.stdout), stderr = safe(run.stderr);
    writeFileSync(path.join(directory, 'result.tap'), stdout);
    writeFileSync(path.join(directory, 'stderr.txt'), stderr);
    const result = { task: 'P2-G2', scope: 'LOCAL_ROUTE_PREREQUISITES_ONLY', node: process.version, args: nodeArgs,
      exit_code: run.status, signal: run.signal, runner_error: run.error?.code ?? null,
      environment: 'OS_ALLOWLIST_PLUS_LOCAL_DATABASE_URL_ONLY', credential_redaction: true,
      stdout_sha256: createHash('sha256').update(stdout).digest('hex'),
      stderr_sha256: createHash('sha256').update(stderr).digest('hex'),
      evidence_directory: path.relative(root, directory).replaceAll('\\', '/') };
    writeFileSync(path.join(directory, 'run.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
    process.exitCode = run.status ?? 2;
  } catch {
    console.error('P2_G2_LOCAL_ROUTE_PREFLIGHT_FAILED'); process.exitCode = 2;
  }
}
