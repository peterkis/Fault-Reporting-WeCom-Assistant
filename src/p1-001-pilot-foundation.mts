import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type PilotEnvironment = 'development' | 'test' | 'pilot';
export type PilotEnvironmentInput = Readonly<Record<string, unknown>>;
export interface PilotConfig {
  readonly architectureBaseline: 'V1.2'; readonly phase: 'P1'; readonly environment: PilotEnvironment;
  readonly ownerId: string; readonly testGroupId: string;
  readonly listen: Readonly<{ host: string; port: number; publicEdgeApproved: boolean; securityBoundaryApproved: boolean }>;
  readonly pilotDatabaseUrl: string;
  readonly wecom: Readonly<{ botId: string; botSecret: string; wsUrl: string; sdkVersion: typeof SDK_VERSION }>;
  readonly featureFlags: Readonly<{ aiTriageEnabled: false; ocrEnabled: false; hospitalTicketsEnabled: false }>;
}
export type PilotPreflightSummary = ReturnType<typeof buildSafePreflightSummary>;
export interface PilotPreflightFailure { test_id: typeof TEST_ID; event: 'pilot_configuration_failed'; error_code: 'P1_CONFIG_INVALID' }
export type PilotPreflightResult = { ok: true; config: PilotConfig; summary: PilotPreflightSummary } | { ok: false; errorCode: 'P1_CONFIG_INVALID' };
export interface PilotPreflightOptions { env?: PilotEnvironmentInput; writeEvent?: (event: PilotPreflightSummary | PilotPreflightFailure) => unknown }
export interface PilotListenOptions { host?: string; port?: number }

export const TEST_ID = 'P1-001';
export const SDK_VERSION = '1.0.6';
export const DEFAULT_LISTEN_HOST = '127.0.0.1';
export const DEFAULT_LISTEN_PORT = 3100;

const REQUIRED_CONFIG_KEYS = Object.freeze([
  'ARCHITECTURE_BASELINE',
  'APP_PHASE',
  'PILOT_ENV',
  'PILOT_LISTEN_HOST',
  'PILOT_LISTEN_PORT',
  'PILOT_PUBLIC_EDGE_APPROVED',
  'PILOT_SECURITY_BOUNDARY_APPROVED',
  'PILOT_OWNER_ID',
  'PILOT_TEST_GROUP_ID',
  'PILOT_DATABASE_URL',
  'WECOM_BOT_ID',
  'WECOM_BOT_SECRET',
  'WECOM_WS_URL',
  'AI_TRIAGE_ENABLED',
  'OCR_ENABLED',
  'HOSPITAL_TICKETS_ENABLED',
]);

const FORBIDDEN_CONFIG_PREFIXES = Object.freeze([
  'HOSPITAL_',
  'TICKET_ADAPTER_',
  'INTERNAL_OUTBOX_',
  'INTERNAL_HUB_',
]);

const ALLOWED_HOSPITAL_CONTROL_KEYS = new Set(['HOSPITAL_TICKETS_ENABLED']);
const ALLOWED_AI_CONTROL_KEYS = new Set(['AI_TRIAGE_ENABLED', 'OCR_ENABLED']);

export class PilotConfigError extends Error {
  declare code: string;
  constructor(code: string) {
    super(`P1_CONFIG_INVALID:${code}`);
    this.code = code;
  }
}

function fail(code: string): never {
  throw new PilotConfigError(code);
}

function valueOf(env: PilotEnvironmentInput, key: string): string {
  return String(env[key] ?? '').trim();
}

function requireFalse(env: PilotEnvironmentInput, key: string): void {
  if (valueOf(env, key).toLowerCase() !== 'false') {
    fail(`${key}_MUST_BE_FALSE`);
  }
}

function requireBoolean(env: PilotEnvironmentInput, key: string): boolean {
  const value = valueOf(env, key).toLowerCase();
  if (!['true', 'false'].includes(value)) {
    fail(`${key}_MUST_BE_BOOLEAN`);
  }
  return value === 'true';
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    fail('PILOT_LISTEN_PORT');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    fail('PILOT_LISTEN_PORT');
  }
  return port;
}

function parseRequiredUrl(value: string, key: string, allowedProtocols: readonly string[]): string {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(key);
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    fail(`${key}_PROTOCOL`);
  }
  return parsed.toString();
}

export function assertPilotOnlyDependencies(env: PilotEnvironmentInput): void {
  const forbiddenKeys = Object.keys(env)
    .filter((key) => valueOf(env, key))
    .filter((key) => {
      if (ALLOWED_HOSPITAL_CONTROL_KEYS.has(key) || ALLOWED_AI_CONTROL_KEYS.has(key)) {
        return false;
      }
      if (key.startsWith('AI_') || key.startsWith('OCR_')) {
        return true;
      }
      return FORBIDDEN_CONFIG_PREFIXES.some((prefix) => key.startsWith(prefix));
    })
    .sort();

  if (forbiddenKeys.length > 0) {
    fail(`FORBIDDEN_DEPENDENCY_${forbiddenKeys.join('_')}`);
  }
}

export function validatePilotConfig(env: PilotEnvironmentInput): PilotConfig {
  const missing = REQUIRED_CONFIG_KEYS.filter((key) => !valueOf(env, key));
  if (missing.length > 0) {
    fail(`MISSING_${missing.join('_')}`);
  }

  assertPilotOnlyDependencies(env);

  if (valueOf(env, 'ARCHITECTURE_BASELINE') !== 'V1.2') {
    fail('ARCHITECTURE_BASELINE');
  }
  if (valueOf(env, 'APP_PHASE') !== 'P1') {
    fail('APP_PHASE');
  }

  const environment = valueOf(env, 'PILOT_ENV');
  if (!['development', 'test', 'pilot'].includes(environment)) {
    fail('PILOT_ENV');
  }

  const host = valueOf(env, 'PILOT_LISTEN_HOST');
  const publicEdgeApproved = requireBoolean(env, 'PILOT_PUBLIC_EDGE_APPROVED');
  const securityBoundaryApproved = requireBoolean(env, 'PILOT_SECURITY_BOUNDARY_APPROVED');
  if (!['127.0.0.1', '::1', '0.0.0.0', '::'].includes(host)) {
    fail('PILOT_LISTEN_HOST');
  }
  if (['0.0.0.0', '::'].includes(host) && !publicEdgeApproved) {
    fail('PILOT_PUBLIC_EDGE_APPROVAL_REQUIRED');
  }
  if (environment === 'pilot' && !securityBoundaryApproved) {
    fail('PILOT_SECURITY_BOUNDARY_APPROVAL_REQUIRED');
  }

  requireFalse(env, 'AI_TRIAGE_ENABLED');
  requireFalse(env, 'OCR_ENABLED');
  requireFalse(env, 'HOSPITAL_TICKETS_ENABLED');

  return Object.freeze({
    architectureBaseline: 'V1.2',
    phase: 'P1',
    environment: environment as PilotEnvironment,
    ownerId: valueOf(env, 'PILOT_OWNER_ID'),
    testGroupId: valueOf(env, 'PILOT_TEST_GROUP_ID'),
    listen: Object.freeze({
      host,
      port: parsePort(valueOf(env, 'PILOT_LISTEN_PORT')),
      publicEdgeApproved,
      securityBoundaryApproved,
    }),
    pilotDatabaseUrl: parseRequiredUrl(valueOf(env, 'PILOT_DATABASE_URL'), 'PILOT_DATABASE_URL', ['postgres:', 'postgresql:']),
    wecom: Object.freeze({
      botId: valueOf(env, 'WECOM_BOT_ID'),
      botSecret: valueOf(env, 'WECOM_BOT_SECRET'),
      wsUrl: parseRequiredUrl(valueOf(env, 'WECOM_WS_URL'), 'WECOM_WS_URL', ['wss:']),
      sdkVersion: SDK_VERSION,
    }),
    featureFlags: Object.freeze({
      aiTriageEnabled: false,
      ocrEnabled: false,
      hospitalTicketsEnabled: false,
    }),
  });
}

export function buildSafePreflightSummary(config: PilotConfig) {
  return Object.freeze({
    test_id: TEST_ID,
    event: 'pilot_configuration_valid',
    architecture_baseline: config.architectureBaseline,
    phase: config.phase,
    pilot_environment: config.environment,
    listen_host: config.listen.host,
    listen_port: config.listen.port,
    public_edge_approved: config.listen.publicEdgeApproved,
    pilot_security_boundary_approved: config.listen.securityBoundaryApproved,
    wecom_sdk_version: config.wecom.sdkVersion,
    declared_dependencies: ['Pilot PostgreSQL', 'WeCom Gateway'],
    forbidden_dependencies: ['Hospital Tickets', 'hospital SSO', 'hospital Hub', 'in-hospital Outbox', 'Ticket Adapter', 'AI/OCR'],
  });
}

export function runPilotPreflight({ env = process.env, writeEvent = () => {} }: PilotPreflightOptions = {}): PilotPreflightResult {
  try {
    const config = validatePilotConfig(env);
    const summary = buildSafePreflightSummary(config);
    writeEvent(summary);
    return { ok: true, config, summary };
  } catch (error) {
    writeEvent({ test_id: TEST_ID, event: 'pilot_configuration_failed', error_code: 'P1_CONFIG_INVALID' });
    return { ok: false, errorCode: 'P1_CONFIG_INVALID' };
  }
}

export function parseCliArgs(argv: readonly string[]): { mode: 'check' | 'serve' } {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--check')) {
    return { mode: 'check' };
  }
  if (argv.length === 1 && argv[0] === '--serve') {
    return { mode: 'serve' };
  }
  fail('UNSUPPORTED_ARGUMENTS');
}

export function createPilotFoundationServer(): Server {
  return createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');

    if (request.method === 'GET' && pathname === '/healthz') {
      response.writeHead(200);
      response.end(JSON.stringify({ status: 'ok', service: 'pilot-foundation', phase: 'P1' }));
      return;
    }

    response.writeHead(404);
    response.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
}

export function listenPilotFoundation(server: Server, { host = DEFAULT_LISTEN_HOST, port = DEFAULT_LISTEN_PORT }: PilotListenOptions = {}): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen({ host, port }, () => {
      server.off('error', onError);
      resolve(server.address() as AddressInfo);
    });
  });
}

export function closePilotFoundation(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'pilot_configuration_failed', error_code: 'P1_CONFIG_INVALID' }));
    process.exitCode = 1;
    return;
  }

  const preflight = runPilotPreflight({ writeEvent: (event) => console.log(JSON.stringify(event)) });
  if (!preflight.ok) {
    process.exitCode = 1;
    return;
  }
  if (options.mode === 'check') {
    return;
  }

  const server = createPilotFoundationServer();
  const address = await listenPilotFoundation(server, preflight.config.listen);
  console.log(JSON.stringify({ test_id: TEST_ID, event: 'pilot_foundation_listening', host: address.address, port: address.port }));

  let stopping = false;
  const stop = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (stopping) {
      return;
    }
    stopping = true;
    await closePilotFoundation(server);
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'pilot_foundation_stopped', signal }));
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
