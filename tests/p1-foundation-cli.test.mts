import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, copyFileSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const source = process.env.TS_MIGRATION_TEST_SOURCE_ROOT;
assert.ok(source, 'The npm CLI seam requires the explicit source root.');
const npmExecutable = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['npm'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/u)[0];
assert.ok(npmExecutable, 'The npm CLI seam requires the actual npm executable.');
const npmCli = process.platform === 'win32' ? path.join(path.dirname(npmExecutable), 'node_modules/npm/bin/npm-cli.js') : realpathSync(npmExecutable);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ARCHITECTURE_BASELINE: 'V1.2', APP_PHASE: 'P1', PILOT_ENV: 'test',
  PILOT_LISTEN_HOST: '127.0.0.1', PILOT_LISTEN_PORT: '3100',
  PILOT_PUBLIC_EDGE_APPROVED: 'false', PILOT_SECURITY_BOUNDARY_APPROVED: 'false',
  PILOT_OWNER_ID: 'synthetic-owner', PILOT_TEST_GROUP_ID: 'synthetic-group',
  PILOT_DATABASE_URL: 'postgresql://synthetic:synthetic-secret@127.0.0.1:1/synthetic',
  WECOM_BOT_ID: 'synthetic-bot', WECOM_BOT_SECRET: 'synthetic-secret',
  WECOM_WS_URL: 'wss://example.invalid', AI_TRIAGE_ENABLED: 'false', OCR_ENABLED: 'false', HOSPITAL_TICKETS_ENABLED: 'false',
};

test('the original preflight npm command runs the validated artifact and keeps credentials private', () => {
  const run = spawnSync(process.execPath, [npmCli, 'run', 'p1:preflight'], { cwd: source, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /pilot_configuration_valid/u);
  assert.doesNotMatch(run.stdout + run.stderr, /synthetic-secret|synthetic-owner|synthetic-group/u);
});

test('the serve npm command reaches the same artifact and retains unsupported-argument rejection', () => {
  const run = spawnSync(process.execPath, [npmCli, 'run', 'p1:serve', '--', '--unsupported'], { cwd: source, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /pilot_configuration_failed/u);
  assert.doesNotMatch(run.stdout + run.stderr, /MODULE_NOT_FOUND|synthetic-secret/u);
});

test('a checkout without a verified artifact cannot use the preflight command', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'p1-foundation-missing-artifact-'));
  try {
    copyFileSync(path.join(source, 'package.json'), path.join(scratch, 'package.json'));
    // The source is present, but must never be loaded as a fallback.
    mkdirSync(path.join(scratch, 'src'));
    copyFileSync(path.join(source, 'src/p1-001-pilot-foundation.mts'), path.join(scratch, 'src/p1-001-pilot-foundation.mts'));
    const config = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    assert.match(config.scripts['p1:preflight'] ?? '', /verify-artifact/u);
    const run = spawnSync(process.execPath, [npmCli, 'run', 'p1:preflight'], { cwd: scratch, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    assert.notEqual(run.status, 0);
    assert.doesNotMatch(run.stdout, /pilot_configuration_valid/u);
  } finally { rmSync(scratch, { recursive: true }); }
});
