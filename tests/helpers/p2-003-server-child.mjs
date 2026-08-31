import { createServer } from 'node:http';
import { Pool } from 'pg';

import { createRealtimeEventStore } from '../../src/p2-003-realtime-event-log.mjs';
import {
  createRealtimeSseHandler,
  createRealtimeWakeupHub,
} from '../../src/p2-003-realtime-sse.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const APPLICATION_NAME_PATTERN = /^p2_003_[a-z0-9_]{1,54}$/u;

function requiredEnvironment(name, pattern) {
  const value = process.env[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error('P2_003_SERVER_CHILD_INPUT_INVALID');
  }
  return value;
}

function boundedEnvironmentInteger(name, minimum, maximum) {
  const value = requiredEnvironment(name, /^[1-9][0-9]{0,8}$/u);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('P2_003_SERVER_CHILD_INPUT_INVALID');
  }
  return parsed;
}

function sendSafe(message) {
  return new Promise((resolve) => {
    if (typeof process.send !== 'function' || !process.connected) {
      resolve(false);
      return;
    }
    process.send(message, (error) => resolve(error === null));
  });
}

function closeHttpServer(server, sockets) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    server.close(() => finish());
    timer = setTimeout(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.closeAllConnections?.();
      finish();
    }, 2_000);
    timer.unref?.();
  });
}

let pool;
let handler;
let server;
let shuttingDown = false;
const sockets = new Set();

async function shutdown(requestId = null) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await handler?.close().catch(() => {});
  if (server?.listening) {
    await closeHttpServer(server, sockets);
  }
  for (const socket of sockets) {
    socket.destroy();
  }
  sockets.clear();
  if (pool) {
    await pool.end().catch(() => {});
  }
  await sendSafe({
    event: 'SERVER_STOPPED',
    request_id: requestId,
  });
  if (process.connected) {
    process.disconnect();
  }
}

try {
  const databaseUrl = requiredEnvironment('PILOT_DATABASE_URL', /^.+$/u);
  const applicationName = requiredEnvironment(
    'P2_003_TEST_APPLICATION_NAME',
    APPLICATION_NAME_PATTERN,
  );
  const sessionId = requiredEnvironment('P2_003_TEST_SESSION_ID', UUID_PATTERN).toLowerCase();
  const threadId = requiredEnvironment('P2_003_TEST_THREAD_ID', UUID_PATTERN).toLowerCase();
  const enabledValue = requiredEnvironment('P2_003_TEST_ENABLED', /^(?:true|false)$/u);
  const maxClients = boundedEnvironmentInteger('P2_003_TEST_MAX_CLIENTS', 1, 32);
  const heartbeatMs = boundedEnvironmentInteger('P2_003_TEST_HEARTBEAT_MS', 1, 300_000);
  const recoveryPollMs = boundedEnvironmentInteger(
    'P2_003_TEST_RECOVERY_POLL_MS',
    1,
    300_000,
  );
  const replayBatchSize = boundedEnvironmentInteger(
    'P2_003_TEST_REPLAY_BATCH_SIZE',
    1,
    200,
  );
  const maxWritableBufferBytes = boundedEnvironmentInteger(
    'P2_003_TEST_MAX_WRITABLE_BUFFER_BYTES',
    1,
    1_048_576,
  );
  const drainTimeoutMs = boundedEnvironmentInteger(
    'P2_003_TEST_DRAIN_TIMEOUT_MS',
    1,
    300_000,
  );
  const poolMax = boundedEnvironmentInteger('P2_003_TEST_POOL_MAX', 1, 4);

  pool = new Pool({
    connectionString: databaseUrl,
    max: poolMax,
    connectionTimeoutMillis: 2_000,
    application_name: applicationName,
  });
  await pool.query('SELECT 1');
  const eventStore = createRealtimeEventStore({
    pool,
    enabled: true,
    defaultRetentionMs: 7 * 24 * 60 * 60 * 1_000,
  });
  const hub = createRealtimeWakeupHub({ maxClients });
  handler = createRealtimeSseHandler({
    pool,
    eventStore,
    enabled: enabledValue === 'true',
    maxClients,
    heartbeatMs,
    recoveryPollMs,
    replayBatchSize,
    maxWritableBufferBytes,
    drainTimeoutMs,
    wakeupHub: hub,
    authenticate: async (request) => {
      const authorization = request.headers.authorization;
      if (authorization === 'Bearer p2-003-workbench') {
        return Object.freeze({ role: 'WORKBENCH' });
      }
      if (authorization === 'Bearer p2-003-admin') {
        return Object.freeze({ role: 'ADMIN' });
      }
      return null;
    },
    authorize: async (principal) => Object.freeze({
      allowed_session_ids: Object.freeze([sessionId]),
      allowed_thread_ids: Object.freeze([threadId]),
      allow_system_events: true,
      allow_restricted_admin: principal.role === 'ADMIN',
    }),
  });
  server = createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, async () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      await sendSafe({ event: 'SERVER_ERROR', code: 'P2_003_SERVER_CHILD_LISTEN_FAILED' });
      process.exitCode = 1;
      await shutdown();
      return;
    }
    await sendSafe({ event: 'SERVER_READY', port: address.port });
  });
  server.once('error', async () => {
    await sendSafe({ event: 'SERVER_ERROR', code: 'P2_003_SERVER_CHILD_LISTEN_FAILED' });
    process.exitCode = 1;
    await shutdown();
  });

  process.on('message', (message) => {
    if (!message || typeof message !== 'object' || typeof message.command !== 'string') {
      return;
    }
    const requestId = typeof message.request_id === 'string' ? message.request_id : null;
    if (message.command === 'METRICS') {
      const metrics = handler.getMetrics();
      void sendSafe({
        event: 'SERVER_METRICS',
        request_id: requestId,
        metrics: Object.freeze({
          ...metrics,
          hub_active_clients: handler.hubSnapshot()?.active_clients ?? null,
          socket_count: sockets.size,
          pool_total_count: pool.totalCount,
          pool_idle_count: pool.idleCount,
          pool_waiting_count: pool.waitingCount,
          heap_used_bytes: process.memoryUsage().heapUsed,
        }),
      });
      return;
    }
    if (message.command === 'WAKEUP') {
      const result = handler.wakeup();
      void sendSafe({ event: 'SERVER_WOKEN', request_id: requestId, result });
      return;
    }
    if (message.command === 'SHUTDOWN') {
      void shutdown(requestId);
    }
  });
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
} catch {
  await sendSafe({ event: 'SERVER_ERROR', code: 'P2_003_SERVER_CHILD_FAILED' });
  process.exitCode = 1;
  await shutdown();
}
