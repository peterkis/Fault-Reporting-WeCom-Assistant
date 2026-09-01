import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

import { createP2G1PilotOperationalIntake, P2_G1_LIVE_MODES, validateP2G1ProcessApprovals } from '../src/p2-g1-human-only-assembly.mjs';
import { createP2G1Runtime } from '../src/p2-g1-runtime.mjs';
import { runP2G1Check } from './p2-g1-check.mjs';

function mode(argv) {
  const value = argv.find((entry) => entry.startsWith('--mode='));
  return value?.slice('--mode='.length) ?? null;
}

function safeEvent(event, extra = {}) {
  return JSON.stringify({ schema_version: 1, gate: 'P2-G1', event, observed_at: new Date().toISOString(), ...extra });
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--check') {
    validateP2G1ProcessApprovals(process.env, { checkOnly: true });
    const result = await runP2G1Check();
    console.log(JSON.stringify({ mode: 'check', ...result, external_side_effects: false }));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const selected = mode(argv);
  if (!P2_G1_LIVE_MODES.includes(selected) || argv.some((entry) => !entry.startsWith('--mode='))) {
    process.exitCode = 2; return;
  }
  const approvals = validateP2G1ProcessApprovals(process.env, { mode: selected });
  const port = Number(process.env.P2_G1_LISTEN_PORT ?? 3200);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('P2_G1_LISTEN_PORT_INVALID');
  const hashes = String(process.env.P2_G1_ALLOWED_TARGET_HASHES ?? '').split(',').filter(Boolean);
  if (hashes.length < 1 || hashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))) throw new Error('P2_G1_TEST_SCOPE_INVALID');
  const pool = new Pool({ connectionString: process.env.PILOT_DATABASE_URL, max: 4, connectionTimeoutMillis: 2_000 });
  const operationalIntake = createP2G1PilotOperationalIntake({ pool, identityHashKey: process.env.PILOT_LOG_IDENTITY_HASH_KEY });
  const runtime = createP2G1Runtime({
    pool,
    operationalIntake,
    principalId: process.env.P2_G1_TEST_PRINCIPAL_ID,
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
  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
    await appendFile('evidence/p2-g1-live-e2e.jsonl', safeEvent('runtime_stopped', { mode: selected, signal, live_observation_claimed: false }) + '\n');
  }
  process.once('SIGINT', () => { void stop('SIGINT'); });
  process.once('SIGTERM', () => { void stop('SIGTERM'); });
  await runtime.start();
  await appendFile('evidence/p2-g1-live-e2e.jsonl', safeEvent('runtime_started', { mode: selected, sender_enabled: approvals.send_approved, raw_identifiers_recorded: false }) + '\n');
  await new Promise((resolve) => {
    const timer = setInterval(() => { if (stopping) { clearInterval(timer); resolve(); } }, 250);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => { console.error(JSON.stringify({ ok: false, error_code: error?.message?.startsWith('P2_G1_') ? error.message : 'P2_G1_LIVE_RUNTIME_FAILED' })); process.exitCode = 1; });
}
