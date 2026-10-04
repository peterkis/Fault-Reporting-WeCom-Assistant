import type { ChildProcess } from 'node:child_process';
import type { G1RoleCommand, G1ProviderResponse } from '../scripts/p2-g1-process-role.mjs';
import type { createP2G1TestAuthentication } from './p2-g1-test-authentication.mjs';
type BrowserCookie = ReturnType<ReturnType<typeof createP2G1TestAuthentication>['browserCookie']>;
export interface G1ClusterConfiguration {
  databaseUrl: string; identityHashKey: string; principalIds: readonly string[]; listenPort: number;
  gatewayEnabled: boolean; senderEnabled: boolean; allowedTargetHashes: readonly string[];
  testAuthTtlMs?: number; botId?: string; secret?: string; wsUrl?: string;
  roleEnvironment?: (role: string) => NodeJS.ProcessEnv; baseEnvironment?: Record<string, string>;
  controlledMessageTypes?: readonly string[]; roleScriptUrl?: URL; allowRoleRestart?: boolean; workerHealthEvents?: boolean;
}
type ReadyMessage = { type: 'role-ready'; role: string; cookies?: BrowserCookie[]; worker_ready?: boolean; authenticated?: boolean };
type ClusterMessage = G1ProviderResponse
  | { type: 'provider-send-request'; role: string; request_id: string; request: Extract<G1RoleCommand, { type: 'provider-send-request' }>['request'] }
  | ReadyMessage
  | { type: 'gateway-status'; status?: { authenticated?: boolean; reconnect_total?: number } }
  | { type: 'worker-status'; ready?: boolean; failure_count?: number; last_error_code?: string | null }
  | { type: 'metrics-response' | 'control-response'; role: string; request_id: string; ok?: boolean; error_code?: string; result?: unknown; metrics?: unknown }
  | { type: 'role-failed'; error_code?: string };
interface PendingRequest { role: string; timer: ReturnType<typeof setTimeout>; resolve: (value: unknown) => void; reject: (error: unknown) => void }
interface RoleWaiter { resolve(value: unknown): void; reject(error: unknown): void }
type ExitRecord = { code: number | null; signal: NodeJS.Signals | null };
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { P2_G1_TEST_AUTH_MAX_TTL_MS } from './p2-g1-test-authentication.mjs';

const ROLES = Object.freeze(['APP', 'WORKER', 'GATEWAY']);
const ROLE_METRIC_FIELDS = Object.freeze(['rss_bytes','heap_used_bytes','heap_total_bytes','external_bytes','cpu_percent','event_loop_delay_p95_ms',
  'active_resources','active_timers','active_sockets','active_file_handles','active_handles','uptime_seconds',
  'pool_total','pool_idle','pool_waiting','pool_max']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH = /^[a-f0-9]{64}$/u;

function delay(milliseconds: number) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function validConfiguration(value: Partial<G1ClusterConfiguration>): value is G1ClusterConfiguration {
  return value && typeof value === 'object'
    && typeof value.databaseUrl === 'string' && value.databaseUrl.length > 0
    && typeof value.identityHashKey === 'string' && value.identityHashKey.length >= 16
    && Array.isArray(value.principalIds) && value.principalIds.length >= 2 && value.principalIds.length <= 4
    && new Set(value.principalIds).size === value.principalIds.length && value.principalIds.every((entry) => UUID.test(entry))
    && Number.isInteger(value.listenPort) && (value.listenPort as number) >= 1024 && (value.listenPort as number) <= 65535
    && Number.isInteger(value.testAuthTtlMs ?? 15 * 60_000) && (value.testAuthTtlMs ?? 15 * 60_000) >= 10_000
    && (value.testAuthTtlMs ?? 15 * 60_000) <= P2_G1_TEST_AUTH_MAX_TTL_MS
    && typeof value.gatewayEnabled === 'boolean' && typeof value.senderEnabled === 'boolean'
    && Array.isArray(value.allowedTargetHashes) && value.allowedTargetHashes.every((entry) => HASH.test(entry))
    && (!value.gatewayEnabled || (typeof value.botId === 'string' && value.botId.length > 0
      && typeof value.secret === 'string' && value.secret.length > 0
      && typeof value.wsUrl === 'string' && /^wss:\/\//u.test(value.wsUrl)
      && value.allowedTargetHashes.length > 0));
}

function stableRoleMetrics(role: string, value: Readonly<Record<string, unknown>> | null | undefined) {
  if (!value || value.role !== role) throw new Error('P2_G1_PROCESS_METRICS_INVALID');
  const fields = ROLE_METRIC_FIELDS;
  if (fields.some((field) => !Number.isFinite(value[field]) || (value[field] as number) < 0)) throw new Error('P2_G1_PROCESS_METRICS_INVALID');
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, Number(value[field])])));
}

export function createP2G1ProcessCluster(configuration: Partial<G1ClusterConfiguration> = {}) {
  if (!validConfiguration(configuration) || (configuration.senderEnabled && !configuration.gatewayEnabled)) {
    throw new TypeError('P2_G1_PROCESS_CLUSTER_CONFIGURATION_INVALID');
  }
  const origin = `http://127.0.0.1:${configuration.listenPort}`;
  if (configuration.roleEnvironment !== undefined && typeof configuration.roleEnvironment !== 'function') throw new TypeError('P2_G1_PROCESS_ENVIRONMENT_INVALID');
  if (configuration.baseEnvironment !== undefined && (!configuration.baseEnvironment || Array.isArray(configuration.baseEnvironment)
    || Object.values(configuration.baseEnvironment).some(v => typeof v !== 'string'))) throw new TypeError('P2_G1_PROCESS_ENVIRONMENT_INVALID');
  const controlledTypes = configuration.controlledMessageTypes ?? [];
  if (!Array.isArray(controlledTypes) || controlledTypes.length > 8 || controlledTypes.some(t => !/^g2-[a-z-]{1,48}$/u.test(t))) throw new TypeError('P2_G1_PROCESS_CONTROL_INVALID');
  const roleScript = fileURLToPath(configuration.roleScriptUrl ?? new URL('../scripts/p2-g1-process-role.mjs', import.meta.url));
  const children = new Map<string, ChildProcess>();
  const ready = new Map<string, RoleWaiter>();
  const pending = new Map<string, PendingRequest>();
  const exits = new Map<string, Promise<ExitRecord>>();
  const gatewayStatus = { enabled: configuration.gatewayEnabled, authenticated: false, reconnect_total: 0 };
  let workerReady = false;
  let workerFailureCount = 0;
  let workerLastError: string | null = null;
  let started = false;
  let stopping = false;
  let appCookies: BrowserCookie[] | undefined | null = null;

  function childEnvironment(role: string) {
    const inherited = { ...(configuration.baseEnvironment ?? process.env) };
    for (const name of [
      'WECOM_BOT_ID','WECOM_BOT_SECRET','WECOM_WS_URL','P2_G1_ALLOWED_TARGET_HASHES','P2_G1_TEST_PRINCIPAL_IDS',
      'P2_G1_LIVE_TEST_APPROVED','P2_G1_TEST_SCOPE_CONFIGURED','P2_G1_REAL_WECOM_SEND_APPROVED',
      'PILOT_LOG_IDENTITY_HASH_KEY',
    ]) delete inherited[name];
    // Capability material for an optional P2-016 assembly is distributed explicitly by role, never inherited wholesale.
    for (const name of Object.keys(inherited)) if (name.startsWith('P2_016_')) delete inherited[name];
    const common: NodeJS.ProcessEnv = {
      ...inherited,
      PILOT_DATABASE_URL: configuration.databaseUrl,
      P2_G1_PROCESS_ROLE: role,
      P2_G1_GATEWAY_ENABLED: String(configuration.gatewayEnabled),
      P2_G1_SENDER_ENABLED: String(configuration.senderEnabled),
      P2_G1_REQUIRE_GATEWAY: String(configuration.gatewayEnabled),
    };
    if (role === 'APP') {
      common.PILOT_LOG_IDENTITY_HASH_KEY = configuration.identityHashKey;
      common.P2_G1_TEST_PRINCIPAL_IDS = (configuration.principalIds as readonly string[]).join(',');
      common.P2_G1_LISTEN_PORT = String(configuration.listenPort);
      common.P2_G1_TEST_AUTH_TTL_MS = String(configuration.testAuthTtlMs ?? 15 * 60_000);
    }
    if (role === 'GATEWAY' && configuration.gatewayEnabled) {
      common.PILOT_LOG_IDENTITY_HASH_KEY = configuration.identityHashKey;
      common.WECOM_BOT_ID = configuration.botId;
      common.WECOM_BOT_SECRET = configuration.secret;
      common.WECOM_WS_URL = configuration.wsUrl;
      common.P2_G1_ALLOWED_TARGET_HASHES = (configuration.allowedTargetHashes as readonly string[]).join(',');
    }
    return { ...common, ...(configuration.roleEnvironment?.(role) ?? {}) };
  }

  function sendRole(role: string, message: G1RoleCommand) {
    const child = children.get(role);
    if (!child || child.connected !== true || child.exitCode !== null || child.signalCode !== null) throw new Error(`P2_G1_${role}_PROCESS_UNAVAILABLE`);
    child.send(message);
  }

  function relayPeerStatus() {
    const app = children.get('APP');
    if (!app || app.connected !== true || app.exitCode !== null) return;
    app.send({ type: 'peer-status', gateway_authenticated: gatewayStatus.authenticated, worker_ready: workerReady });
  }

  function resolvePending(role: string, message: Extract<ClusterMessage, { type: "metrics-response" | "control-response" }>) {
    const request = pending.get(message.request_id);
    if (!request || request.role !== role) return false;
    pending.delete(message.request_id);
    clearTimeout(request.timer);
    if (message.ok === false) request.reject(new Error(message.error_code ?? 'P2_G1_PROCESS_REQUEST_FAILED'));
    else request.resolve(message.result ?? message.metrics ?? null);
    return true;
  }

  function onMessage(role: string, message: ClusterMessage) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'role-ready' && message.role === role) {
      if (role === 'APP') appCookies = message.cookies;
      if (role === 'WORKER') workerReady = message.worker_ready !== false;
      if (role === 'GATEWAY') gatewayStatus.authenticated = message.authenticated === true;
      ready.get(role)?.resolve(message);
      relayPeerStatus();
      return;
    }
    if (message.type === 'gateway-status' && role === 'GATEWAY') {
      gatewayStatus.authenticated = message.status?.authenticated === true;
      gatewayStatus.reconnect_total = Number(message.status?.reconnect_total ?? 0);
      relayPeerStatus();
      return;
    }
    if (message.type === 'worker-status' && role === 'WORKER' && configuration.workerHealthEvents === true) {
      workerReady = message.ready === true;
      workerFailureCount = Math.max(workerFailureCount, Number(message.failure_count ?? 0));
      workerLastError = message.last_error_code ?? null;
      relayPeerStatus(); return;
    }
    if (message.type === 'provider-send-request' && role === 'WORKER') {
      if (!gatewayStatus.authenticated) {
        sendRole('WORKER', { type: 'provider-send-response', request_id: message.request_id, ok: false, error_code: 'GATEWAY_UNAVAILABLE_BEFORE_SEND' });
      } else {
        sendRole('GATEWAY', { type: 'provider-send-request', request_id: message.request_id, request: message.request });
      }
      return;
    }
    if (message.type === 'provider-send-response' && role === 'GATEWAY') {
      sendRole('WORKER', message);
      return;
    }
    if (['metrics-response','control-response'].includes(message.type)) {
      resolvePending(role, message as Extract<ClusterMessage, { type: "metrics-response" | "control-response" }>);
      return;
    }
    if (message.type === 'role-failed') {
      ready.get(role)?.reject(new Error(message.error_code ?? `P2_G1_${role}_PROCESS_FAILED`));
    }
  }

  function spawnRole(role: string) {
    const oldSpaceMiB = role === 'APP' ? 512 : role === 'WORKER' ? 384 : 256;
    const child = fork(roleScript, [`--role=${role.toLowerCase()}`], {
      cwd: process.cwd(),
      env: childEnvironment(role),
      execArgv: [`--max-old-space-size=${oldSpaceMiB}`],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    children.set(role, child);
    const exitPromise = new Promise<ExitRecord>((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    exits.set(role, exitPromise);
    child.on('message', (message: ClusterMessage) => onMessage(role, message));
    child.once('exit', () => {
      if (role === 'WORKER') workerReady = false;
      if (role === 'GATEWAY') gatewayStatus.authenticated = false;
      relayPeerStatus();
      if (!stopping) ready.get(role)?.reject(new Error(`P2_G1_${role}_PROCESS_EXITED`));
    });
    return child;
  }

  function waitForRole(role: string, timeoutMs = 65_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`P2_G1_${role}_PROCESS_READY_TIMEOUT`)), timeoutMs);
      ready.set(role, {
        resolve(value: unknown) { clearTimeout(timer); resolve(value); },
        reject(error: unknown) { clearTimeout(timer); reject(error); },
      });
    });
  }

  async function waitForCombinedReady(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(2_000) });
        const body = await response.json() as { ok?: unknown };
        if (response.ok && body.ok === true) return body;
      } catch { /* separate processes are still converging */ }
      await delay(100);
    }
    throw new Error('P2_G1_PROCESS_CLUSTER_READY_TIMEOUT');
  }

  async function start() {
    if (started || stopping) throw new Error('P2_G1_PROCESS_CLUSTER_STATE_INVALID');
    started = true;
    const waits = Object.fromEntries(ROLES.map((currentRole) => [currentRole, waitForRole(currentRole)]));
    for (const currentRole of ['GATEWAY', 'APP', 'WORKER']) spawnRole(currentRole);
    try {
      await Promise.all(ROLES.map((currentRole) => waits[currentRole]));
      relayPeerStatus();
      const readiness = await waitForCombinedReady();
      const distinctProcesses = new Set(ROLES.map((currentRole) => children.get(currentRole)?.pid)).size;
      if (distinctProcesses !== 3 || !Array.isArray(appCookies) || appCookies.length !== (configuration.principalIds as readonly string[]).length) {
        throw new Error('P2_G1_PROCESS_CLUSTER_TOPOLOGY_INVALID');
      }
      return Object.freeze({ origin, cookies: Object.freeze(appCookies), process_count: distinctProcesses, readiness });
    } catch (error) {
      await stop();
      throw error;
    }
  }

  function request(role: string, type: string, extra: Record<string, unknown> = {}, timeoutMs = 10_000) {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('P2_G1_PROCESS_REQUEST_TIMEOUT')); }, timeoutMs);
      pending.set(requestId, { role, resolve, reject, timer });
      try { sendRole(role, { type, request_id: requestId, ...extra } as G1RoleCommand); }
      catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
  }

  async function metrics({allowStoppedWorker=false}={}) {
    if (!started || stopping) throw new Error('P2_G1_PROCESS_CLUSTER_STATE_INVALID');
    if(typeof allowStoppedWorker!=='boolean'||allowStoppedWorker&&configuration.allowRoleRestart!==true)throw new Error('P2_G1_PROCESS_METRICS_INVALID');
    const workerChild=children.get('WORKER');
    const workerStopped=allowStoppedWorker&&(!workerChild||workerChild.exitCode!==null||workerChild.signalCode!==null);
    const [app, worker, gateway, domainResponse] = await Promise.all([
      request('APP', 'metrics-request'),
      workerStopped?null:request('WORKER', 'metrics-request'),
      request('GATEWAY', 'metrics-request'),
      fetch(`${origin}/health/metrics`, { signal: AbortSignal.timeout(5_000) }),
    ]);
    if (!domainResponse.ok) throw new Error('P2_G1_PROCESS_DOMAIN_METRICS_UNAVAILABLE');
    const domain = await domainResponse.json() as Record<string, unknown>;
    const roles: Record<string, Record<string, number | null>> = {
      APP: stableRoleMetrics('APP', app as Record<string, unknown>),
      WORKER: workerStopped?Object.fromEntries(ROLE_METRIC_FIELDS.map(k=>[k,null])):stableRoleMetrics('WORKER', worker as Record<string, unknown>),
      GATEWAY: stableRoleMetrics('GATEWAY', gateway as Record<string, unknown>),
    };
    const result: Record<string, number | null> = { process_count: workerStopped?2:3, gateway_authenticated: gatewayStatus.authenticated ? 1 : 0, gateway_reconnect_total: gatewayStatus.reconnect_total };
    if (configuration.workerHealthEvents === true) Object.assign(result, { rule_worker_ready: workerReady ? 1 : 0, rule_worker_failure_count: workerFailureCount });
    for (const [currentRole, prefix] of [['APP','app'],['WORKER','worker'],['GATEWAY','gateway']]) {
      for (const [field, value] of Object.entries((roles[currentRole as string] as Record<string, number | null>))) result[`${prefix}_${field}`] = value;
    }
    result.total_rss_bytes = ((roles.APP as Record<string, number | null>).rss_bytes as number) + ((roles.WORKER as Record<string, number | null>).rss_bytes as number) + ((roles.GATEWAY as Record<string, number | null>).rss_bytes as number);
    result.total_heap_used_bytes = ((roles.APP as Record<string, number | null>).heap_used_bytes as number) + ((roles.WORKER as Record<string, number | null>).heap_used_bytes as number) + ((roles.GATEWAY as Record<string, number | null>).heap_used_bytes as number);
    result.total_cpu_percent = Number((((roles.APP as Record<string, number | null>).cpu_percent as number) + ((roles.WORKER as Record<string, number | null>).cpu_percent as number) + ((roles.GATEWAY as Record<string, number | null>).cpu_percent as number)).toFixed(3));
    for (const field of [
      'sse_clients','projection_backlog','projection_failures','communication_pending','dead_letter','reconciliation_required',
      'postgres_active_connections','postgres_idle_connections','postgres_other_connections','postgres_max_connections',
      'postgres_connection_utilization_percent',
    ]) {
      const value = Number(domain[field]);
      if (!Number.isFinite(value) || value < 0) throw new Error('P2_G1_PROCESS_DOMAIN_METRICS_INVALID');
      result[field] = value;
    }
    return Object.freeze(result);
  }

  function status() {
    return Object.freeze({
      started,
      stopping,
      process_count: [...children.values()].filter((child) => child.exitCode === null && child.signalCode === null).length,
      gateway_authenticated: gatewayStatus.authenticated,
      worker_ready: workerReady,
      ...(configuration.workerHealthEvents === true ? { worker_failure_count: workerFailureCount, worker_last_error_code: workerLastError } : {}),
      origin,
    });
  }

  async function stopRole(role: string) {
    const child = children.get(role);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try { if (child.connected) child.send({ type: 'stop' }); } catch { /* bounded forced cleanup remains below */ }
    const exited = await Promise.race([(exits.get(role) as Promise<ExitRecord>).then(() => true), delay(10_000).then(() => false)]);
    if (!exited && child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.race([exits.get(role), delay(5_000)]);
  }

  async function stop() {
    if (stopping) return Object.freeze({ stopped: true, process_count: [...children.values()].filter((child) => child.exitCode === null && child.signalCode === null).length });
    stopping = true;
    await stopRole('WORKER');
    await stopRole('APP');
    await stopRole('GATEWAY');
    for (const value of pending.values()) { clearTimeout(value.timer); value.reject(new Error('P2_G1_PROCESS_CLUSTER_STOPPED')); }
    pending.clear();
    return Object.freeze({ stopped: true, process_count: [...children.values()].filter((child) => child.exitCode === null && child.signalCode === null).length });
  }

  async function controlledStopRole(role: string) {
    if (!started || stopping || configuration.allowRoleRestart !== true || !ROLES.includes(role)) throw new Error('P2_G1_PROCESS_CONTROL_INVALID');
    if (role === 'WORKER') workerReady = false;
    if (role === 'GATEWAY') gatewayStatus.authenticated = false;
    relayPeerStatus(); await stopRole(role);
    const child = children.get(role);
    if (child && child.exitCode === null && child.signalCode === null) throw new Error('P2_G1_PROCESS_STOP_INCOMPLETE');
  }
  async function controlledRestartRole(role: string) {
    await controlledStopRole(role);
    const readyPromise = waitForRole(role); spawnRole(role); await readyPromise;
    return waitForCombinedReady();
  }

  return Object.freeze({
    start,
    stop,
    status,
    metrics,
    controlledRequest(role: string, type: string, extra: Record<string, unknown> = {}) {
      if (!ROLES.includes(role) || !controlledTypes.includes(type)) throw new Error('P2_G1_PROCESS_CONTROL_INVALID');
      return request(role, type, extra);
    },
    controlledStopRole,
    controlledRestartRole,
    disconnectRealtimePrincipal: (principalIndex = 0) => request('APP', 'sse-disconnect', { principal_index: principalIndex }),
    disconnectGateway: () => request('GATEWAY', 'gateway-disconnect'),
    reconnectGateway: () => request('GATEWAY', 'gateway-reconnect', {}, 65_000),
  });
}
