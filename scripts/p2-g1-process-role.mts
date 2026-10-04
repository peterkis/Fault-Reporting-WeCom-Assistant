import type { PostgresPool } from '../src/platform/postgres-pool.mjs';
import type { G1RuntimeOptions, G1AuthenticationPort } from '../src/p2-g1-runtime.mjs';
import type { CommunicationSenderRequest } from '../contracts/communication_contracts.js';
import type { CommunicationSenderResult } from '../src/p2-004-communication-sender-port.mjs';
export type G1ProviderResponse = { type: 'provider-send-response'; request_id: string } & ({ ok: true; result: CommunicationSenderResult } | { ok: false; error_code: string });
export type G1RoleCommand =
  | { type: 'peer-status'; gateway_authenticated: boolean; worker_ready: boolean }
  | { type: 'metrics-request'; request_id: string }
  | { type: 'sse-disconnect'; request_id: string; principal_index: number }
  | { type: 'provider-send-request'; request_id: string; request: Omit<CommunicationSenderRequest, 'signal'> }
  | G1ProviderResponse
  | { type: 'gateway-disconnect' | 'gateway-reconnect'; request_id: string }
  | { type: 'stop' };
interface AppOptions { runtimeFactory?: typeof createP2G1Runtime; authenticationFactory?: ((input: { pool: PostgresPool; publicOrigin: string }) => G1AuthenticationPort | Promise<G1AuthenticationPort>) | null; publicOrigin?: string | null; externalSendEnabled?: boolean }
interface GatewayOptions { intakeFactory?: typeof createP2G1PilotOperationalIntake; gatewayFactory?: typeof createP2G1WeComGateway; senderFactory?: (input: NonNullable<Parameters<typeof createP2G1WeComCommunicationSender>[0]> & { pool: PostgresPool }) => ReturnType<typeof createP2G1WeComCommunicationSender> }
interface WorkerOptions { extensionFactory?: ((input: { pool: PostgresPool }) => { runOnce(): unknown | Promise<unknown> }) | null; reportCycleHealth?: boolean; beforeReady?: ((input: { pool: PostgresPool }) => unknown | Promise<unknown>) | null }
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';

import { createCommunicationDeliveryWorker } from '../src/p2-004-communication-delivery-worker.mjs';
import { createP2G1HumanOnlyAssembly, createP2G1PilotOperationalIntake } from '../src/p2-g1-human-only-assembly.mjs';
import { createP2G1ProcessMetrics, P2_G1_PROCESS_ROLES } from '../src/p2-g1-process-metrics.mjs';
import { createP2G1Runtime } from '../src/p2-g1-runtime.mjs';
import { createP2G1WeComGateway } from '../src/p2-g1-wecom-gateway.mjs';
import { createP2G1WeComCommunicationSender } from '../src/p2-g1-wecom-sender.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function role(argv: string[]) {
  const value = argv.find((entry) => entry.startsWith('--role='))?.slice('--role='.length)?.toUpperCase();
  if (!P2_G1_PROCESS_ROLES.includes(value as string) || argv.length !== 1) throw new Error('P2_G1_PROCESS_ROLE_INVALID');
  return value;
}

function required(name: string, pattern = /^.+$/u) {
  const value = process.env[name];
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error('P2_G1_PROCESS_CONFIGURATION_INVALID');
  return value;
}

function truth(name: string) { return process.env[name] === 'true'; }

function send(value: object) {
  if (typeof process.send !== 'function') throw new Error('P2_G1_PROCESS_IPC_REQUIRED');
  process.send(value);
}

function stableFailure(currentRole: unknown) {
  return `P2_G1_${currentRole}_PROCESS_FAILED`;
}

function safePoolMetrics(pool: PostgresPool) {
  return Object.freeze({
    pool_total: Number(pool.totalCount ?? 0),
    pool_idle: Number(pool.idleCount ?? 0),
    pool_waiting: Number(pool.waitingCount ?? 0),
    pool_max: Number(pool.options?.max ?? 0),
  });
}

async function waitForGateway(gateway: Pick<ReturnType<typeof createP2G1WeComGateway>, "getStatus">, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gateway.getStatus().authenticated === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function configuredPrincipals() {
  const values = required('P2_G1_TEST_PRINCIPAL_IDS').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (values.length < 2 || values.length > 4 || new Set(values).size !== values.length || values.some((value) => !UUID.test(value))) {
    throw new Error('P2_G1_PROCESS_CONFIGURATION_INVALID');
  }
  return values;
}

export async function runApp({runtimeFactory=createP2G1Runtime,authenticationFactory=null,publicOrigin=null,externalSendEnabled=true}: AppOptions = {}) {
  const pool = createPostgresPool({
    connectionString: required('PILOT_DATABASE_URL'),
    max: 4,
    connectionTimeoutMillis: 2_000,
    application_name: 'p2_g1_app',
  });
  const metrics = createP2G1ProcessMetrics({ role: 'APP' });
  const peer = { gatewayAuthenticated: !truth('P2_G1_REQUIRE_GATEWAY'), workerReady: false };
  const resolvedOrigin=publicOrigin??`http://127.0.0.1:${Number(required('P2_G1_LISTEN_PORT', /^[0-9]{4,5}$/u))}`;
  let authentication: G1AuthenticationPort | null = null;
  let runtime: ReturnType<typeof createP2G1Runtime>;
  try {
    authentication=authenticationFactory?await authenticationFactory({pool,publicOrigin:resolvedOrigin}):null;
    runtime = runtimeFactory({
      pool,
      operationalIntake: createP2G1PilotOperationalIntake({ pool, identityHashKey: required('PILOT_LOG_IDENTITY_HASH_KEY', /^.{16,}$/u) }),
      principalIds: configuredPrincipals(),
      publicOrigin: resolvedOrigin,
      listenPort: Number(process.env.P2_G1_LISTEN_PORT),
      allowedTargetHashes: [],
      gatewayEnabled: false,
      senderEnabled: false,
      gatewayStatusProvider: { getStatus: () => ({ enabled: truth('P2_G1_REQUIRE_GATEWAY'), authenticated: peer.gatewayAuthenticated }) },
      communicationStatusProvider: { isReady: () => peer.workerReady },
      requireGateway: truth('P2_G1_REQUIRE_GATEWAY'),
      testAuthTtlMs: process.env.P2_G1_TEST_AUTH_TTL_MS === undefined ? 15 * 60_000
        : Number(required('P2_G1_TEST_AUTH_TTL_MS', /^[0-9]{5,7}$/u)),
      authentication,
      externalSendEnabled,
      closePoolOnStop: true,
    });
  } catch (error) {
    await authentication?.close?.();
    await pool.end();
    metrics.close();
    throw error;
  }
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
    metrics.close();
    send({ type: 'role-stopped', role: 'APP' });
  }
  process.on('message', (message: G1RoleCommand) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'peer-status') {
      peer.gatewayAuthenticated = message.gateway_authenticated === true;
      peer.workerReady = message.worker_ready === true;
    }
    if (message.type === 'metrics-request') {
      send({ type: 'metrics-response', role: 'APP', request_id: message.request_id, metrics: { ...metrics.sample(), ...safePoolMetrics(pool) } });
    }
    if (message.type === 'sse-disconnect') {
      try {
        const result = runtime.disconnectRealtimePrincipal(message.principal_index);
        send({ type: 'control-response', role: 'APP', request_id: message.request_id, ok: true, result });
      } catch { send({ type: 'control-response', role: 'APP', request_id: message.request_id, ok: false, error_code: 'P2_G1_SSE_DISCONNECT_FAILED' }); }
    }
    if (message.type === 'stop') void stop().then(() => process.exit(0));
  });
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
  const started = await runtime.start();
  send({ type: 'role-ready', role: 'APP', address: started.address, cookies: started.cookies, pool_max: 4 });
}

export async function runGateway({intakeFactory=createP2G1PilotOperationalIntake,senderFactory=createP2G1WeComCommunicationSender,gatewayFactory=createP2G1WeComGateway}: GatewayOptions = {}) {
  const enabled = truth('P2_G1_GATEWAY_ENABLED');
  const senderEnabled = truth('P2_G1_SENDER_ENABLED');
  const pool = createPostgresPool({
    connectionString: required('PILOT_DATABASE_URL'),
    max: 1,
    connectionTimeoutMillis: 2_000,
    application_name: 'p2_g1_gateway',
  });
  const metrics = createP2G1ProcessMetrics({ role: 'GATEWAY' });
  let gateway: ReturnType<typeof createP2G1WeComGateway>;
  if (enabled) {
    const assembly = createP2G1HumanOnlyAssembly({
      operationalIntake: intakeFactory({ pool, identityHashKey: required('PILOT_LOG_IDENTITY_HASH_KEY', /^.{16,}$/u) }),
      coordinator: null,
      projectAfterCommit: false,
    });
    gateway = gatewayFactory({
      enabled: true,
      botId: required('WECOM_BOT_ID'),
      secret: required('WECOM_BOT_SECRET'),
      wsUrl: required('WECOM_WS_URL', /^wss:\/\//u),
      onFrame: async (frame) => assembly.handleFrame(frame),
    });
  } else {
    gateway = gatewayFactory({ enabled: false });
  }
  const allowedTargetHashes = enabled
    ? required('P2_G1_ALLOWED_TARGET_HASHES', /^[a-f0-9]{64}(?:,[a-f0-9]{64})*$/u).split(',')
    : [];
  const sender = senderFactory({ pool, gateway, allowedTargetHashes, enabled: senderEnabled });
  let stopping = false;
  let lastStatus = '';
  function publishStatus() {
    const status = gateway.getStatus();
    const safe = JSON.stringify({ enabled: status.enabled === true, started: status.started === true, authenticated: status.authenticated === true, reconnect_total: Number(status.reconnect_total ?? 0) });
    if (safe !== lastStatus) {
      lastStatus = safe;
      send({ type: 'gateway-status', role: 'GATEWAY', status: JSON.parse(safe) });
    }
  }
  const statusTimer = setInterval(publishStatus, 250);
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(statusTimer);
    await gateway.stop();
    await pool.end();
    metrics.close();
    send({ type: 'role-stopped', role: 'GATEWAY' });
  }
  process.on('message', (message: G1RoleCommand) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'metrics-request') {
      send({ type: 'metrics-response', role: 'GATEWAY', request_id: message.request_id, metrics: { ...metrics.sample(), ...safePoolMetrics(pool) } });
    }
    if (message.type === 'provider-send-request') {
      const request = { ...message.request, signal: new AbortController().signal };
      void sender.send(request).then((result) => {
        send({ type: 'provider-send-response', role: 'GATEWAY', request_id: message.request_id, ok: true, result });
      }).catch((error) => {
        send({ type: 'provider-send-response', role: 'GATEWAY', request_id: message.request_id, ok: false, error_code: error?.code === 'GATEWAY_UNAVAILABLE_BEFORE_SEND' ? error.code : 'P2_G1_GATEWAY_SEND_FAILED' });
      });
    }
    if (message.type === 'gateway-disconnect') {
      void gateway.stop().then(() => {
        publishStatus();
        send({ type: 'control-response', role: 'GATEWAY', request_id: message.request_id, ok: true, result: { authenticated: false } });
      }).catch(() => send({ type: 'control-response', role: 'GATEWAY', request_id: message.request_id, ok: false, error_code: 'P2_G1_GATEWAY_DISCONNECT_FAILED' }));
    }
    if (message.type === 'gateway-reconnect') {
      void gateway.start().then(async () => {
        const authenticated = enabled ? await waitForGateway(gateway) : false;
        publishStatus();
        send({ type: 'control-response', role: 'GATEWAY', request_id: message.request_id, ok: !enabled || authenticated, result: { authenticated } });
      }).catch(() => send({ type: 'control-response', role: 'GATEWAY', request_id: message.request_id, ok: false, error_code: 'P2_G1_GATEWAY_RECONNECT_FAILED' }));
    }
    if (message.type === 'stop') void stop().then(() => process.exit(0));
  });
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
  await gateway.start();
  const authenticated = enabled ? await waitForGateway(gateway) : false;
  publishStatus();
  if (enabled && !authenticated) throw new Error('P2_G1_GATEWAY_AUTH_TIMEOUT');
  send({ type: 'role-ready', role: 'GATEWAY', authenticated, pool_max: 1 });
}

export async function runWorker({extensionFactory=null,reportCycleHealth=false,beforeReady=null}: WorkerOptions = {}) {
  const enabled = truth('P2_G1_SENDER_ENABLED');
  const pool = createPostgresPool({
    connectionString: required('PILOT_DATABASE_URL'),
    max: 2,
    connectionTimeoutMillis: 2_000,
    application_name: 'p2_g1_worker',
  });
  try { await beforeReady?.({pool}); }
  catch(error) { await pool.end(); throw error; }
  const metrics = createP2G1ProcessMetrics({ role: 'WORKER' });
  const pending = new Map<string, { resolve: (result: CommunicationSenderResult) => void; reject: (error: unknown) => void }>();
  const sender = Object.freeze({
    send(request: CommunicationSenderRequest): Promise<CommunicationSenderResult> {
      const requestId = randomUUID();
      const serializable = {
        provider: request.provider,
        channel_account_id: request.channel_account_id,
        target_type: request.target_type,
        target_id: request.target_id,
        delivery_id: request.delivery_id,
        idempotency_key: request.idempotency_key,
        message: request.message,
      };
      return new Promise<CommunicationSenderResult>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        send({ type: 'provider-send-request', role: 'WORKER', request_id: requestId, request: serializable });
      });
    },
  });
  const worker = createCommunicationDeliveryWorker({ pool, sender, enabled, batchSize: 20 });
  const extension = extensionFactory?.({pool});
  let stopping = false;
  let running = false;
  let task = Promise.resolve();
  let failureCount = 0;
  let lastErrorCode: string | null = null;
  const publishHealth: (ready: boolean) => void = ready => { if (reportCycleHealth) send({ type: 'worker-status', role: 'WORKER', ready, failure_count: failureCount, last_error_code: lastErrorCode }); };
  const timer = setInterval(() => {
    if (stopping || running || (!enabled && !extension)) return;
    running = true;
    task = (async () => { await extension?.runOnce(); if(enabled) await worker.runOnce(); publishHealth(true); })()
      .catch(error => { failureCount++; lastErrorCode = /^(?:[0-9A-Z]{5}|P[12]_[A-Z0-9_]{1,80})$/u.test(error?.code ?? '') ? error.code : 'WORKER_CYCLE_FAILED';
        publishHealth(false); }).finally(() => { running = false; });
  }, 250);
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await task;
    for (const value of pending.values()) value.reject(Object.assign(new Error('GATEWAY_UNAVAILABLE_BEFORE_SEND'), { code: 'GATEWAY_UNAVAILABLE_BEFORE_SEND' }));
    pending.clear();
    await pool.end();
    metrics.close();
    send({ type: 'role-stopped', role: 'WORKER' });
  }
  process.on('message', (message: G1RoleCommand) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'provider-send-response') {
      const request = pending.get(message.request_id);
      if (!request) return;
      pending.delete(message.request_id);
      if (message.ok === true) request.resolve(message.result);
      else request.reject(Object.assign(new Error(message.error_code), { code: message.error_code }));
    }
    if (message.type === 'metrics-request') {
      send({ type: 'metrics-response', role: 'WORKER', request_id: message.request_id, metrics: { ...metrics.sample(), ...safePoolMetrics(pool) } });
    }
    if (message.type === 'stop') void stop().then(() => process.exit(0));
  });
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
  send({ type: 'role-ready', role: 'WORKER', enabled, pool_max: 2, ...(reportCycleHealth ? { worker_ready: false } : {}) });
}

export async function main(argv = process.argv.slice(2)) {
  const selected = role(argv);
  if (selected === 'APP') return runApp();
  if (selected === 'WORKER') return runWorker();
  return runGateway();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => {
    try { send({ type: 'role-failed', role: process.argv[2]?.slice('--role='.length)?.toUpperCase() ?? 'UNKNOWN', error_code: stableFailure(process.argv[2]?.slice('--role='.length)?.toUpperCase() ?? 'UNKNOWN') }); }
    catch { /* no safe IPC channel remains */ }
    process.exitCode = 1;
  });
}
