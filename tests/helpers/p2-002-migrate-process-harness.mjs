import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHILD_PATH = fileURLToPath(new URL('./p2-002-migrate-child.mjs', import.meta.url));
const ENV_FILE_PATH = fileURLToPath(new URL('../../.env.pilot', import.meta.url));
const REPOSITORY_PATH = fileURLToPath(new URL('../..', import.meta.url));
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

function childEnvironment(values) {
  const environment = Object.create(null);
  for (const key of SAFE_INHERITED_ENVIRONMENT_KEYS) {
    if (typeof process.env[key] === 'string') {
      environment[key] = process.env[key];
    }
  }
  return { ...environment, ...values };
}

export async function runP2002MigrationProcess({ databaseName, mode }) {
  const child = spawn(process.execPath, [
    `--env-file=${ENV_FILE_PATH}`,
    CHILD_PATH,
  ], {
    cwd: REPOSITORY_PATH,
    env: childEnvironment({
      P2_002_TEST_DATABASE_NAME: databaseName,
      P2_002_TEST_MIGRATION_MODE: mode,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
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
  let terminationTimer;
  let timedOut = false;
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (timedOut) {
        reject(new Error('P2_002_MIGRATION_CHILD_TIMEOUT'));
        return;
      }
      resolve({ code, signal });
    });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      terminationTimer = setTimeout(() => {
        reject(new Error('P2_002_MIGRATION_CHILD_TERMINATION_TIMEOUT'));
      }, 5_000);
    }, 20_000);
  }).finally(() => {
    clearTimeout(timer);
    clearTimeout(terminationTimer);
  });

  const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
  let result = null;
  if (lines.length === 1) {
    try {
      result = JSON.parse(lines[0]);
    } catch {
      result = null;
    }
  }
  return Object.freeze({
    exit: Object.freeze(exit),
    stdout,
    stderr,
    result,
  });
}
