import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CHILD_PATH = fileURLToPath(new URL('./p2-002-worker-child.mjs', import.meta.url));
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
  'PILOT_DATABASE_URL',
]);

function childEnvironment(values) {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('P2_002_ISOLATED_LOCAL_DATABASE_REQUIRED');
  const environment = Object.create(null);
  for (const key of SAFE_INHERITED_ENVIRONMENT_KEYS) {
    if (typeof process.env[key] === 'string') {
      environment[key] = process.env[key];
    }
  }
  return { ...environment, ...values };
}

function timeoutFailure(label) {
  const error = new Error(`P2_002_CHILD_${label}_TIMEOUT`);
  error.code = `P2_002_CHILD_${label}_TIMEOUT`;
  return error;
}

export function spawnP2002WorkerProcess({
  databaseName,
  sessionId,
  sourceStream,
  sourceId,
  mode,
}) {
  const workerToken = `p2_002_child_${randomUUID().replaceAll('-', '_')}`;
  const child = fork(CHILD_PATH, [], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    execArgv: [],
    env: childEnvironment({
      P2_002_CHILD_MODE: mode,
      P2_002_TEST_DATABASE_NAME: databaseName,
      P2_002_TEST_SESSION_ID: sessionId,
      P2_002_TEST_SOURCE_STREAM: sourceStream,
      P2_002_TEST_SOURCE_ID: sourceId,
      P2_002_TEST_WORKER_TOKEN: workerToken,
    }),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-4_096);
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4_096);
  });

  const queuedMessages = [];
  const messageWaiters = new Set();
  child.on('message', (message) => {
    if (!message || typeof message !== 'object' || typeof message.event !== 'string') {
      return;
    }
    for (const waiter of messageWaiters) {
      if (message.event === waiter.event || message.event === 'PROJECTION_ERROR') {
        messageWaiters.delete(waiter);
        waiter.resolve(message);
        return;
      }
    }
    queuedMessages.push(message);
  });

  let exited = false;
  let exitInformation;
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      exited = true;
      exitInformation = Object.freeze({ code, signal, killed: child.killed });
      for (const waiter of messageWaiters) {
        waiter.reject(new Error(`P2_002_CHILD_EXITED_BEFORE_${waiter.event}`));
      }
      messageWaiters.clear();
      resolve(exitInformation);
    });
  });

  async function waitForEvent(event, timeoutMs = 10_000) {
    const queuedIndex = queuedMessages.findIndex((message) => (
      message.event === event || message.event === 'PROJECTION_ERROR'
    ));
    if (queuedIndex >= 0) {
      return queuedMessages.splice(queuedIndex, 1)[0];
    }
    if (spawnError) {
      throw spawnError;
    }
    if (exited) {
      throw new Error(`P2_002_CHILD_EXITED_BEFORE_${event}`);
    }
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        const waiter = { event, resolve, reject };
        messageWaiters.add(waiter);
        timer = setTimeout(() => {
          messageWaiters.delete(waiter);
          reject(timeoutFailure('EVENT'));
        }, timeoutMs);
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function waitForExit(timeoutMs = 10_000) {
    let timer;
    try {
      return await Promise.race([
        exitPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(timeoutFailure('EXIT')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function terminate(signal = 'SIGKILL') {
    if (!exited) {
      const accepted = child.kill(signal);
      if (!accepted && !exited) {
        throw new Error('P2_002_CHILD_TERMINATION_FAILED');
      }
    }
    return waitForExit();
  }

  async function ensureTerminated() {
    if (!exited) {
      await terminate('SIGKILL');
    }
    return exitInformation;
  }

  return Object.freeze({
    workerToken,
    waitForEvent,
    waitForExit,
    terminate,
    ensureTerminated,
    output: () => Object.freeze({ stdout, stderr }),
  });
}
