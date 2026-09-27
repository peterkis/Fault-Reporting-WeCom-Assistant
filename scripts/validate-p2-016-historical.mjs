import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const P2_016_HISTORICAL_REF = '8c332710dad9b6cf3f6796f3344c04d1c710ddf3';

const root = fileURLToPath(new URL('../', import.meta.url));
const hashText = value => createHash('sha256').update(value ?? '').digest('hex');
const git = (args, cwd) => execFileSync('git', ['-c', 'safe.directory=' + cwd.replaceAll('\\', '/'), ...args], {
  cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 8_000_000,
});

function run(command, args, cwd, { timeout = 120_000, logDir, logName } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8_000_000 });
  if (logDir && logName) {
    writeFileSync(path.join(logDir, `${logName}.stdout.log`), result.stdout ?? '', 'utf8');
    writeFileSync(path.join(logDir, `${logName}.stderr.log`), result.stderr ?? '', 'utf8');
  }
  return Object.freeze({
    command: [command, ...args].join(' '),
    exit_code: result.status,
    signal: result.signal,
    error_code: result.error?.code ?? null,
    stdout_sha256: hashText(result.stdout),
    stderr_sha256: hashText(result.stderr),
    stdout_bytes: Buffer.byteLength(result.stdout ?? '', 'utf8'),
    stderr_bytes: Buffer.byteLength(result.stderr ?? '', 'utf8'),
  });
}

export function validateHistoricalP2016({ sourceRoot = root, ref = P2_016_HISTORICAL_REF } = {}) {
  const source = realpathSync(sourceRoot);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'fault-reporting-p2-016-historical-'));
  const logRoot = mkdtempSync(path.join(os.tmpdir(), 'fault-reporting-p2-016-historical-logs-'));
  let checkout = null;
  let cleanupPassed = false;
  try {
    git(['clone', '--no-local', '--no-single-branch', '--config', 'core.autocrlf=true', source, tempRoot], source);
    checkout = realpathSync(tempRoot);
    git(['checkout', '--detach', ref], checkout);
    if (git(['rev-parse', '--is-shallow-repository'], checkout).trim() !== 'false') {
      throw new Error('P2_016_HISTORICAL_SHALLOW_CHECKOUT');
    }
    if (git(['config', '--get', 'core.autocrlf'], checkout).trim() !== 'true') {
      throw new Error('P2_016_HISTORICAL_LINE_ENDING_POLICY_MISMATCH');
    }
    const commit = git(['rev-parse', `${ref}^{commit}`], checkout).trim();
    if (commit !== ref) throw new Error('P2_016_HISTORICAL_REF_IDENTITY_MISMATCH');
    if (git(['status', '--porcelain'], checkout).trim()) throw new Error('P2_016_HISTORICAL_CHECKOUT_DIRTY');
    const npmCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
    const npmArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']
      : ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'];
    const dependencyInstall = run(npmCommand, npmArgs, checkout,
      { timeout: 300_000, logDir: logRoot, logName: 'dependency-install' });
    if (dependencyInstall.exit_code !== 0) {
      return Object.freeze({
        task: 'P2-016-HISTORICAL', historical_only: true, frozen_ref: ref, checkout_commit: commit,
        checkout_line_ending_policy: 'core.autocrlf=true', current_worktree_touched: false,
        dependency_install: { ...dependencyInstall, status: 'BLOCKED' },
        validator: { status: 'NOT_RUN' }, historical_unit_tests: { status: 'NOT_RUN' }, status: 'BLOCKED',
      });
    }
    const validator = run(process.execPath, ['scripts/validate-p2-016-ticket-lifecycle-workbench.mjs'], checkout,
      { logDir: logRoot, logName: 'validator' });
    const tests = run(process.execPath, ['--test', '--test-concurrency=1',
      'tests/p2-016-contracts.test.mjs', 'tests/p2-016-schema-contract.test.mjs'], checkout,
    { logDir: logRoot, logName: 'historical-unit-tests' });
    const validatorPassed = validator.exit_code === 0;
    const testsPassed = tests.exit_code === 0;
    return Object.freeze({
      task: 'P2-016-HISTORICAL', historical_only: true, frozen_ref: ref, checkout_commit: commit,
      checkout_line_ending_policy: 'core.autocrlf=true', current_worktree_touched: false,
      dependency_install: { ...dependencyInstall, status: 'PASS' },
      validator: { ...validator, status: validatorPassed ? 'PASS' : 'FAIL' },
      historical_unit_tests: { ...tests, status: testsPassed ? 'PASS' : 'FAIL' },
      status: validatorPassed && testsPassed ? 'PASS' : 'FAIL',
    });
  } finally {
    try {
      const tempDirectory = realpathSync(os.tmpdir());
      const cleanupTargets = [
        [tempRoot, 'fault-reporting-p2-016-historical-'],
        [logRoot, 'fault-reporting-p2-016-historical-logs-'],
      ];
      for (const [target, prefix] of cleanupTargets) {
        const resolved = realpathSync(target);
        if (path.dirname(resolved) !== tempDirectory || !path.basename(resolved).startsWith(prefix)) {
          throw new Error('P2_016_HISTORICAL_CLEANUP_BOUNDARY');
        }
        rmSync(resolved, { recursive: true, force: true });
      }
      cleanupPassed = true;
    } catch (error) {
      if (error.code === 'ENOENT') cleanupPassed = true;
      else throw error;
    }
    if (!cleanupPassed) throw new Error('P2_016_HISTORICAL_CLEANUP_FAILED');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = validateHistoricalP2016();
    console.log(JSON.stringify(result));
    if (result.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ task: 'P2-016-HISTORICAL', historical_only: true, status: 'BLOCKED',
      current_worktree_touched: false, error_code: error.code ?? 'P2_016_HISTORICAL_VALIDATION_FAILED' }));
    process.exitCode = 1;
  }
}
