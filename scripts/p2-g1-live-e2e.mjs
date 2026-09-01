import { randomInt } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

import { createP2G1PilotOperationalIntake, P2_G1_LIVE_MODES, validateP2G1ProcessApprovals } from '../src/p2-g1-human-only-assembly.mjs';
import { launchP2G1TestBrowserSessions } from '../src/p2-g1-browser-sessions.mjs';
import { createP2G1Runtime } from '../src/p2-g1-runtime.mjs';
import { runP2G1Check } from './p2-g1-check.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RUN_ID = /^P2G1-[0-9]{14}-[0-9]{6}$/u;

function mode(argv) {
  const value = argv.find((entry) => entry.startsWith('--mode='));
  return value?.slice('--mode='.length) ?? null;
}

export function createP2G1RunId(now = new Date(), random = () => randomInt(100_000, 1_000_000)) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('P2_G1_RUN_ID_INVALID');
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0')).join('');
  const suffix = random();
  if (!Number.isInteger(suffix) || suffix < 100_000 || suffix > 999_999) throw new TypeError('P2_G1_RUN_ID_INVALID');
  return `P2G1-${stamp}-${suffix}`;
}

export function configuredP2G1PrincipalIds(env = process.env, { minimum = 2 } = {}) {
  const raw = env.P2_G1_TEST_PRINCIPAL_IDS ?? env.P2_G1_TEST_PRINCIPAL_ID ?? '';
  const values = String(raw).split(',').map((value) => value.trim()).filter(Boolean).map((value) => value.toLowerCase());
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 4 || values.length < minimum || values.length > 4
    || new Set(values).size !== values.length || values.some((value) => !UUID.test(value))) {
    throw new Error('P2_G1_TEST_PRINCIPALS_INVALID');
  }
  return Object.freeze(values);
}

function safeEvent(runId, event, extra = {}) {
  return JSON.stringify({ schema_version: 1, gate: 'P2-G1', run_id: runId, event, observed_at: new Date().toISOString(), ...extra });
}

async function waitForReady(origin, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastChecks = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(2_000) });
      const body = await response.json();
      lastChecks = body?.checks ?? null;
      if (response.ok && body?.ok === true) return Object.freeze({ ok: true, checks: lastChecks });
    } catch { /* readiness remains pending without exposing transport details */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return Object.freeze({ ok: false, checks: lastChecks });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--check') {
    validateP2G1ProcessApprovals(process.env, { checkOnly: true });
    const result = await runP2G1Check();
    console.log(JSON.stringify({
      mode: 'check',
      ...result,
      supported_modes: P2_G1_LIVE_MODES,
      required_live_configuration: Object.freeze([
        'P2_G1_TEST_PRINCIPAL_IDS','P2_G1_ALLOWED_TARGET_HASHES','P2_G1_LISTEN_PORT',
        'PILOT_DATABASE_URL','PILOT_LOG_IDENTITY_HASH_KEY','WECOM_BOT_ID','WECOM_BOT_SECRET','WECOM_WS_URL',
      ]),
      external_side_effects: false,
    }));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const selected = mode(argv);
  if (!P2_G1_LIVE_MODES.includes(selected) || argv.some((entry) => !entry.startsWith('--mode='))) {
    process.exitCode = 2; return;
  }
  const approvals = validateP2G1ProcessApprovals(process.env, { mode: selected });
  const principals = configuredP2G1PrincipalIds(process.env);
  const runId = process.env.P2_G1_RUN_ID ? String(process.env.P2_G1_RUN_ID) : createP2G1RunId();
  if (!RUN_ID.test(runId)) throw new Error('P2_G1_RUN_ID_INVALID');
  const port = Number(process.env.P2_G1_LISTEN_PORT ?? 3200);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('P2_G1_LISTEN_PORT_INVALID');
  const hashes = String(process.env.P2_G1_ALLOWED_TARGET_HASHES ?? '').split(',').filter(Boolean);
  if (hashes.length < 1 || hashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))) throw new Error('P2_G1_TEST_SCOPE_INVALID');
  const pool = new Pool({ connectionString: process.env.PILOT_DATABASE_URL, max: 4, connectionTimeoutMillis: 2_000 });
  const operationalIntake = createP2G1PilotOperationalIntake({ pool, identityHashKey: process.env.PILOT_LOG_IDENTITY_HASH_KEY });
  const runtime = createP2G1Runtime({
    pool,
    operationalIntake,
    principalIds: principals,
    publicOrigin: `http://127.0.0.1:${port}`,
    listenPort: port,
    botId: process.env.WECOM_BOT_ID,
    secret: process.env.WECOM_BOT_SECRET,
    wsUrl: process.env.WECOM_WS_URL,
    allowedTargetHashes: hashes,
    gatewayEnabled: approvals.live_approved,
    senderEnabled: approvals.send_approved,
    closePoolOnStop: true,
  });
  let stopping = false;
  let browserSessions = null;
  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    await browserSessions?.close?.();
    await runtime.stop();
    await appendFile('evidence/p2-g1-live-e2e.jsonl', safeEvent(runId, 'runtime_stopped', { mode: selected, signal, live_observation_claimed: false }) + '\n');
  }
  process.once('SIGINT', () => { void stop('SIGINT'); });
  process.once('SIGTERM', () => { void stop('SIGTERM'); });
  let started = false;
  try {
    const runtimeStart = await runtime.start();
    started = true;
    const origin = `http://127.0.0.1:${port}`;
    await appendFile('evidence/p2-g1-live-e2e.jsonl', safeEvent(runId, 'runtime_started', { mode: selected, sender_enabled: approvals.send_approved, principal_count: principals.length, raw_identifiers_recorded: false }) + '\n');
    const ready = await waitForReady(origin);
    if (!ready.ok) {
      await appendFile('evidence/p2-g1-live-e2e.jsonl', safeEvent(runId, 'runtime_ready_failed', { mode: selected, checks: ready.checks, raw_identifiers_recorded: false }) + '\n');
      throw new Error('P2_G1_READY_TIMEOUT');
    }
    browserSessions = await launchP2G1TestBrowserSessions({ origin, cookies: runtimeStart.cookies });
    await appendFile('evidence/p2-g1-live-e2e.jsonl', safeEvent(runId, 'runtime_ready', { mode: selected, checks: ready.checks, sender_enabled: approvals.send_approved, raw_identifiers_recorded: false }) + '\n');
    console.log(JSON.stringify({ event: 'p2_g1_live_ready', run_id: runId, mode: selected, loopback_origin: origin, principal_count: principals.length, browser_sessions: browserSessions.count, sender_enabled: approvals.send_approved, raw_identifiers_recorded: false }));
  } catch (error) {
    await browserSessions?.close?.();
    if (started) await runtime.stop();
    throw error;
  }
  await new Promise((resolve) => {
    const timer = setInterval(() => { if (stopping) { clearInterval(timer); resolve(); } }, 250);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => { console.error(JSON.stringify({ ok: false, error_code: error?.message?.startsWith('P2_G1_') ? error.message : 'P2_G1_LIVE_RUNTIME_FAILED' })); process.exitCode = 1; });
}
