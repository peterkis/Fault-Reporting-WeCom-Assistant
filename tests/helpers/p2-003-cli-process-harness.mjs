import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_PATH = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATION_SCRIPT_PATH = fileURLToPath(
  new URL('../../scripts/p2-003-migrate.mjs', import.meta.url),
);
const RETENTION_SCRIPT_PATH = fileURLToPath(
  new URL('../../scripts/p2-003-retention.mjs', import.meta.url),
);
const SAFE_INHERITED_ENVIRONMENT_KEYS = Object.freeze([
  'SystemRoot',
  'SYSTEMROOT',
  'WINDIR',
  'ComSpec',
  'COMSPEC',
  'PATH',
  'Path',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
]);
const activeChildren = new Set();

function childEnvironment(values) {
  const environment = Object.create(null);
  for (const key of SAFE_INHERITED_ENVIRONMENT_KEYS) {
    if (typeof process.env[key] === 'string') {
      environment[key] = process.env[key];
    }
  }
  return { ...environment, ...values };
}

function parseSingleJsonLine(stdout) {
  const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) {
    return null;
  }
  try {
    return JSON.parse(lines[0]);
  } catch {
    return null;
  }
}

async function runProcess({ scriptPath, args, databaseUrl, environment = {}, timeoutMs = 30_000 }) {
  assert.equal(typeof databaseUrl, 'string');
  assert.ok(databaseUrl.length > 0, 'P2_003_TEST_DATABASE_REQUIRED');
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs >= 1_000 && timeoutMs <= 60_000);

  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: REPOSITORY_PATH,
    env: childEnvironment({ PILOT_DATABASE_URL: databaseUrl, ...environment }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  activeChildren.add(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-16_384);
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });

  let timer;
  let timedOut = false;
  let spawnFailure;
  const exit = await new Promise((resolve, reject) => {
    child.once('error', (error) => {
      spawnFailure = error;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      activeChildren.delete(child);
      if (spawnFailure) {
        return;
      }
      resolve(Object.freeze({ code, signal, killed: child.killed }));
    });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
  }).finally(() => {
    clearTimeout(timer);
    activeChildren.delete(child);
  });
  if (timedOut) {
    const error = new Error('P2_003_CLI_CHILD_TIMEOUT');
    error.code = 'P2_003_CLI_CHILD_TIMEOUT';
    throw error;
  }
  return Object.freeze({
    exit,
    stdout,
    stderr,
    result: parseSingleJsonLine(stdout),
  });
}

export function runP2003MigrationProcess({ databaseUrl, mode, timeoutMs }) {
  assert.ok(['migrate', 'check'].includes(mode));
  return runProcess({
    scriptPath: MIGRATION_SCRIPT_PATH,
    args: [mode === 'check' ? '--check' : '--migrate'],
    databaseUrl,
    timeoutMs,
  });
}

export function runP2003RetentionProcess({ databaseUrl, mode, approved = false, timeoutMs }) {
  assert.ok(['check', 'apply'].includes(mode));
  assert.equal(typeof approved, 'boolean');
  return runProcess({
    scriptPath: RETENTION_SCRIPT_PATH,
    args: [mode === 'apply' ? '--apply' : '--check'],
    databaseUrl,
    environment: approved ? { P2_003_RETENTION_CLEANUP_APPROVED: 'true' } : {},
    timeoutMs,
  });
}

export function assertNoP2003CliChildResidual() {
  assert.equal(activeChildren.size, 0);
  return Object.freeze({ active_cli_children: 0 });
}
