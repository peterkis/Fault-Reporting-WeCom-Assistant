import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { registerP2003ApplicationName } from './p2-003-postgres-harness.mjs';

const CHILD_PATH = fileURLToPath(new URL('./p2-003-server-child.mjs', import.meta.url));
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const activeServers = new Set();
const ownedPorts = new Set();

function childEnvironment(values) {
  const environment = Object.create(null);
  for (const key of SAFE_INHERITED_ENVIRONMENT_KEYS) {
    if (typeof process.env[key] === 'string') {
      environment[key] = process.env[key];
    }
  }
  return { ...environment, ...values };
}

function timeoutFailure(label) {
  const error = new Error(`P2_003_SERVER_CHILD_${label}_TIMEOUT`);
  error.code = `P2_003_SERVER_CHILD_${label}_TIMEOUT`;
  return error;
}

function portAcceptsConnections(port, timeoutMs = 200) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    let timer;
    const finish = (accepted) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(accepted);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

export async function waitForP2003PortClosed(port, {
  timeoutMs = 5_000,
  intervalMs = 25,
} = {}) {
  assert.ok(Number.isInteger(port) && port >= 1 && port <= 65_535);
  const startedAt = Date.now();
  let polls = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    polls += 1;
    if (!await portAcceptsConnections(port)) {
      return polls;
    }
    await delay(intervalMs);
  }
  assert.fail('P2_003_SERVER_PORT_DID_NOT_CLOSE');
}

export function spawnP2003ServerProcess({
  databaseUrl,
  sessionId,
  threadId,
  enabled = true,
  maxClients = 32,
  heartbeatMs = 20_000,
  recoveryPollMs = 5_000,
  replayBatchSize = 50,
  maxWritableBufferBytes = 65_536,
  drainTimeoutMs = 5_000,
  poolMax = 4,
}) {
  assert.equal(typeof databaseUrl, 'string');
  assert.ok(databaseUrl.length > 0, 'P2_003_TEST_DATABASE_REQUIRED');
  assert.match(sessionId, UUID_PATTERN);
  assert.match(threadId, UUID_PATTERN);
  assert.equal(typeof enabled, 'boolean');
  assert.ok(Number.isInteger(maxClients) && maxClients >= 1 && maxClients <= 32);
  assert.ok(Number.isInteger(poolMax) && poolMax >= 1 && poolMax <= 4);
  for (const value of [heartbeatMs, recoveryPollMs, replayBatchSize,
    maxWritableBufferBytes, drainTimeoutMs]) {
    assert.ok(Number.isInteger(value) && value >= 1);
  }

  const token = randomUUID().replaceAll('-', '_').slice(0, 12);
  const applicationName = registerP2003ApplicationName(`p2_003_server_${token}`);
  const child = fork(CHILD_PATH, [], {
    cwd: REPOSITORY_PATH,
    env: childEnvironment({
      PILOT_DATABASE_URL: databaseUrl,
      P2_003_TEST_APPLICATION_NAME: applicationName,
      P2_003_TEST_SESSION_ID: sessionId,
      P2_003_TEST_THREAD_ID: threadId,
      P2_003_TEST_ENABLED: enabled ? 'true' : 'false',
      P2_003_TEST_MAX_CLIENTS: String(maxClients),
      P2_003_TEST_HEARTBEAT_MS: String(heartbeatMs),
      P2_003_TEST_RECOVERY_POLL_MS: String(recoveryPollMs),
      P2_003_TEST_REPLAY_BATCH_SIZE: String(replayBatchSize),
      P2_003_TEST_MAX_WRITABLE_BUFFER_BYTES: String(maxWritableBufferBytes),
      P2_003_TEST_DRAIN_TIMEOUT_MS: String(drainTimeoutMs),
      P2_003_TEST_POOL_MAX: String(poolMax),
    }),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  activeServers.add(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-8_192);
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_192);
  });

  const queuedMessages = [];
  const eventWaiters = new Set();
  const requestWaiters = new Map();
  let nextRequestId = 1;
  let port;
  child.on('message', (message) => {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (typeof message.request_id === 'string' && requestWaiters.has(message.request_id)) {
      const waiter = requestWaiters.get(message.request_id);
      requestWaiters.delete(message.request_id);
      waiter.resolve(message);
      return;
    }
    if (typeof message.event !== 'string') {
      return;
    }
    if (message.event === 'SERVER_READY' && Number.isInteger(message.port)) {
      port = message.port;
      ownedPorts.add(port);
    }
    for (const waiter of eventWaiters) {
      if (message.event === waiter.event || message.event === 'SERVER_ERROR') {
        eventWaiters.delete(waiter);
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
      activeServers.delete(child);
      exitInformation = Object.freeze({ code, signal, killed: child.killed });
      for (const waiter of eventWaiters) {
        waiter.reject(new Error(`P2_003_SERVER_CHILD_EXITED_BEFORE_${waiter.event}`));
      }
      eventWaiters.clear();
      for (const waiter of requestWaiters.values()) {
        waiter.reject(new Error('P2_003_SERVER_CHILD_EXITED_BEFORE_RESPONSE'));
      }
      requestWaiters.clear();
      resolve(exitInformation);
    });
  });

  async function waitForEvent(event, timeoutMs = 10_000) {
    const queuedIndex = queuedMessages.findIndex((message) => (
      message.event === event || message.event === 'SERVER_ERROR'
    ));
    if (queuedIndex >= 0) {
      return queuedMessages.splice(queuedIndex, 1)[0];
    }
    if (spawnError) {
      throw spawnError;
    }
    if (exited) {
      throw new Error(`P2_003_SERVER_CHILD_EXITED_BEFORE_${event}`);
    }
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        const waiter = { event, resolve, reject };
        eventWaiters.add(waiter);
        timer = setTimeout(() => {
          eventWaiters.delete(waiter);
          reject(timeoutFailure('EVENT'));
        }, timeoutMs);
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(command, timeoutMs = 10_000) {
    if (spawnError) {
      throw spawnError;
    }
    if (exited || !child.connected) {
      throw new Error('P2_003_SERVER_CHILD_NOT_CONNECTED');
    }
    const requestId = `request_${nextRequestId}`;
    nextRequestId += 1;
    let timer;
    try {
      const responsePromise = new Promise((resolve, reject) => {
        requestWaiters.set(requestId, { resolve, reject });
        timer = setTimeout(() => {
          requestWaiters.delete(requestId);
          reject(timeoutFailure('REQUEST'));
        }, timeoutMs);
      });
      child.send({ command, request_id: requestId });
      return await responsePromise;
    } finally {
      clearTimeout(timer);
      requestWaiters.delete(requestId);
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
        throw new Error('P2_003_SERVER_CHILD_TERMINATION_FAILED');
      }
    }
    const exit = await waitForExit();
    if (port) {
      await waitForP2003PortClosed(port);
    }
    return exit;
  }

  async function shutdown() {
    if (exited) {
      return exitInformation;
    }
    const response = await request('SHUTDOWN');
    assert.equal(response.event, 'SERVER_STOPPED');
    const exit = await waitForExit();
    if (port) {
      await waitForP2003PortClosed(port);
    }
    return exit;
  }

  async function ensureTerminated() {
    if (!exited) {
      await terminate('SIGKILL');
    } else if (port) {
      await waitForP2003PortClosed(port);
    }
    return exitInformation;
  }

  return Object.freeze({
    applicationName,
    waitUntilReady: async (timeoutMs) => {
      const message = await waitForEvent('SERVER_READY', timeoutMs);
      assert.equal(message.event, 'SERVER_READY');
      assert.ok(Number.isInteger(message.port) && message.port >= 1 && message.port <= 65_535);
      return Object.freeze({ host: '127.0.0.1', port: message.port });
    },
    snapshot: async () => (await request('METRICS')).metrics,
    wakeup: async () => request('WAKEUP'),
    shutdown,
    terminate,
    ensureTerminated,
    waitForExit,
    output: () => Object.freeze({ stdout, stderr }),
    port: () => port,
  });
}

export async function assertNoP2003ServerChildResidual() {
  assert.equal(activeServers.size, 0);
  const ports = [...ownedPorts];
  const portClosePolls = [];
  for (const port of ports) {
    portClosePolls.push(await waitForP2003PortClosed(port));
  }
  return Object.freeze({
    active_server_children: 0,
    owned_port_count: ports.length,
    closed_port_count: ports.length,
    port_close_polls: Object.freeze(portClosePolls),
  });
}
