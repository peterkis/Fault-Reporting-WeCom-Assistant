import { mkdir, appendFile, lstat, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';
import { Pool } from 'pg';
import { validatePilotConfig } from '../src/p1-001-pilot-foundation.mjs';
import { createServiceIntakeProcessor } from '../src/p1-004-service-intake.mjs';
import { createPilotTicketCore } from '../src/p1-005-pilot-ticket-core.mjs';
import { createNotificationDeliveryWorker, createNotificationOutbox } from '../src/p1-007-notification-outbox.mjs';
import { createTicketClosureService } from '../src/p1-010-ticket-closure.mjs';
import { createPilotOperationalIntake } from '../src/p1-011-pilot-operations-baseline.mjs';
import { createPilotE2EHandler } from '../src/p1-012-pilot-e2e.mjs';

const TEST_ID = 'P1-012';
const DEFAULT_TIMEOUT_MS = 120_000;
const MINIMUM_STALE_CLAIM_AGE_MS = 60_000;
const MAXIMUM_STALE_CLAIM_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_EVIDENCE_PATH = 'evidence/p1-012-live-e2e.jsonl';
const CLAIM_METADATA_SCHEMA = 'P1_012_CLAIM_V1';
const CLAIM_KINDS = Object.freeze({
  CLIENT_OBSERVATION: 'CLIENT_OBSERVATION',
  REPLY_PROBE_EVIDENCE_CHAIN: 'REPLY_PROBE_EVIDENCE_CHAIN',
  REPLY_PROBE_EVIDENCE_RECOVERY: 'REPLY_PROBE_EVIDENCE_RECOVERY',
});
const PROBE_OPERATION_CLAIMED = Symbol('p1-012-probe-operation-claimed');
const PROBE_EVIDENCE_CHAIN_CLAIM = Symbol('p1-012-probe-evidence-chain-claim');
const SCENARIOS = Object.freeze({
  'group-text': 'GROUP_TEXT',
  'group-image-degraded': 'GROUP_IMAGE_DEGRADED',
  'group-reply-probe': 'GROUP_REPLY_PROBE',
  reconnect: 'RECONNECT',
});

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function nonEmpty(value, code, maximum = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw failure(code);
  }
  return value;
}

function positiveInteger(value, code, minimum, maximum) {
  if (!/^\d+$/u.test(String(value ?? ''))) {
    throw failure(code);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw failure(code);
  }
  return parsed;
}

function safeOperationalTriggerToken(value) {
  const token = nonEmpty(value, 'P1_012_LIVE_ARGS', 128);
  if (!/^[A-Za-z0-9_.:-]{6,128}$/u.test(token)) {
    throw failure('P1_012_LIVE_ARGS');
  }
  return token;
}

function safeReplyProbeToken(value) {
  const token = nonEmpty(value, 'P1_012_LIVE_ARGS', 3);
  if (!/^[A-Za-z0-9_.:-]{2,3}$/u.test(token)) {
    throw failure('P1_012_LIVE_ARGS');
  }
  return token;
}

function safeClientDisplayObservation(value) {
  if (value !== 'VISIBLE') {
    throw failure('P1_012_LIVE_ARGS');
  }
  return value;
}

export function parseP1_012LiveArgs(argv) {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--check')) {
    return Object.freeze({ mode: 'check' });
  }
  const recoverReplyProbeClaim = argv.includes('--recover-stale-reply-probe-claim');
  if (recoverReplyProbeClaim) {
    const staleClaimAgeArgument = argv.find((argument) => argument.startsWith('--stale-claim-min-age-ms='));
    if (!argv.includes('--apply') || argv.length !== 3 || !staleClaimAgeArgument) {
      throw failure('P1_012_LIVE_ARGS');
    }
    return Object.freeze({
      mode: 'recover_reply_probe_evidence_claim',
      scenario: 'GROUP_REPLY_PROBE',
      staleClaimMinAgeMs: positiveInteger(
        staleClaimAgeArgument.slice('--stale-claim-min-age-ms='.length),
        'P1_012_LIVE_ARGS',
        MINIMUM_STALE_CLAIM_AGE_MS,
        MAXIMUM_STALE_CLAIM_AGE_MS,
      ),
    });
  }
  const captureGroupId = argv.includes('--capture-test-group-id');
  if (captureGroupId) {
    const triggerArgument = argv.find((argument) => argument.startsWith('--trigger-token='));
    const timeoutArgument = argv.find((argument) => argument.startsWith('--timeout-ms='));
    const expectedCount = timeoutArgument ? 4 : 3;
    if (argv.includes('--live') || !argv.includes('--apply') || argv.length !== expectedCount || !triggerArgument) {
      throw failure('P1_012_LIVE_ARGS');
    }
    return Object.freeze({
      mode: 'capture_group_id',
      triggerToken: safeOperationalTriggerToken(triggerArgument.slice('--trigger-token='.length)),
      timeoutMs: timeoutArgument
        ? positiveInteger(timeoutArgument.slice('--timeout-ms='.length), 'P1_012_LIVE_ARGS', 10_000, 900_000)
      : DEFAULT_TIMEOUT_MS,
    });
  }
  const clientObservationArgument = argv.find((argument) => argument.startsWith('--record-client-observation='));
  if (clientObservationArgument) {
    const scenarioArgument = argv.find((argument) => argument.startsWith('--scenario='));
    if (argv.length !== 2 || !scenarioArgument || scenarioArgument !== '--scenario=group-reply-probe') {
      throw failure('P1_012_LIVE_ARGS');
    }
    return Object.freeze({
      mode: 'client_observation',
      scenario: 'GROUP_REPLY_PROBE',
      observation: safeClientDisplayObservation(clientObservationArgument.slice('--record-client-observation='.length)),
    });
  }
  const live = argv.includes('--live');
  const scenarioArgument = argv.find((argument) => argument.startsWith('--scenario='));
  const triggerArgument = argv.find((argument) => argument.startsWith('--trigger-token='));
  const timeoutArgument = argv.find((argument) => argument.startsWith('--timeout-ms='));
  const expectedCount = timeoutArgument ? 4 : 3;
  if (!live || argv.length !== expectedCount || !scenarioArgument || !triggerArgument) {
    throw failure('P1_012_LIVE_ARGS');
  }
  const scenario = SCENARIOS[scenarioArgument.slice('--scenario='.length)];
  if (!scenario) {
    throw failure('P1_012_LIVE_ARGS');
  }
  const timeoutMs = timeoutArgument
    ? positiveInteger(timeoutArgument.slice('--timeout-ms='.length), 'P1_012_LIVE_ARGS', 10_000, 900_000)
    : DEFAULT_TIMEOUT_MS;
  return Object.freeze({
    mode: 'live',
    scenario,
    triggerToken: (scenario === 'GROUP_REPLY_PROBE' ? safeReplyProbeToken : safeOperationalTriggerToken)(
      triggerArgument.slice('--trigger-token='.length),
    ),
    timeoutMs,
  });
}

function publicSummaryFor(pilot) {
  return Object.freeze({
    phase: 'P1',
    environment: pilot.environment,
    public_listener_required: false,
    ai_triage_enabled: false,
    ocr_enabled: false,
    hospital_tickets_enabled: false,
  });
}

/**
 * Validates only the outbound-WSS Pilot prerequisites. A public inbound HTTP
 * listener is deliberately not a P1-012 requirement.
 */
export function validateP1_012LiveConfig(env = process.env) {
  let pilot;
  try {
    pilot = validatePilotConfig(env);
  } catch {
    throw failure('P1_012_PILOT_CONFIG_INVALID');
  }
  const logIdentityHashKey = nonEmpty(env.PILOT_LOG_IDENTITY_HASH_KEY, 'P1_012_LOG_HASH_KEY_MISSING', 4_096);
  const testAccountUserId = nonEmpty(env.PILOT_TEST_ACCOUNT_USER_ID, 'P1_012_TEST_ACCOUNT_REQUIRED', 128);
  return Object.freeze({
    pilot,
    logIdentityHashKey,
    testAccountUserId,
    public_summary: publicSummaryFor(pilot),
  });
}

/**
 * A wrong or absent group id must not prevent an operator from safely
 * capturing the callback-provided value into the local Pilot configuration.
 */
export function validateP1_012GroupIdCaptureConfig(env = process.env) {
  let pilot;
  try {
    pilot = validatePilotConfig({ ...env, PILOT_TEST_GROUP_ID: 'p1-012-capture-pending' });
  } catch {
    throw failure('P1_012_PILOT_CONFIG_INVALID');
  }
  const logIdentityHashKey = nonEmpty(env.PILOT_LOG_IDENTITY_HASH_KEY, 'P1_012_LOG_HASH_KEY_MISSING', 4_096);
  const testAccountUserId = nonEmpty(env.PILOT_TEST_ACCOUNT_USER_ID, 'P1_012_TEST_ACCOUNT_REQUIRED', 128);
  return Object.freeze({
    pilot,
    logIdentityHashKey,
    testAccountUserId,
    public_summary: publicSummaryFor(pilot),
  });
}

function evidencePath() {
  const root = resolve(process.cwd(), 'evidence');
  const output = resolve(process.cwd(), DEFAULT_EVIDENCE_PATH);
  const relation = relative(root, output);
  if (relation === '' || relation.startsWith('..') || !output.endsWith('.jsonl')) {
    throw failure('P1_012_EVIDENCE_PATH_INVALID');
  }
  return output;
}

async function appendEvidence(output, record) {
  await mkdir(dirname(output), { recursive: true });
  await appendFile(output, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
}

async function readEvidenceRecords(output) {
  let serialized;
  try {
    serialized = await readFile(output, { encoding: 'utf8' });
  } catch {
    throw failure('P1_012_CLIENT_OBSERVATION_SOURCE_MISSING');
  }
  try {
    return serialized
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line))
      .map((record) => {
        if (!isRecord(record)) throw failure('P1_012_CLIENT_OBSERVATION_SOURCE_INVALID');
        return record;
      });
  } catch (error) {
    if (error?.code === 'P1_012_CLIENT_OBSERVATION_SOURCE_INVALID') throw error;
    throw failure('P1_012_CLIENT_OBSERVATION_SOURCE_INVALID');
  }
}

function isSuccessfulMentionReplyProbeRecord(record) {
  return record?.test_id === TEST_ID
    && record.event === 'p1_012_live_message_result'
    && record.scenario === 'GROUP_REPLY_PROBE'
    && record.probe?.exact_token === true
    && record.probe?.addressing === 'WECOM_MENTION_PREFIX'
    && typeof record.probe?.run_id === 'string'
    && /^[a-f0-9]{32}$/u.test(record.probe.run_id)
    && record.probe?.database_write === false
    && record.passive_reply?.operation === 'aibot_respond_msg_stream'
    && record.passive_reply?.acknowledged === true
    && record.passive_reply?.outcome === 'ACKED';
}

function latestSuccessfulMentionReplyProbeRecord(records) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (isSuccessfulMentionReplyProbeRecord(records[index])) return records[index];
  }
  return null;
}

function sourceResultHash(record, logIdentityHashKey) {
  return createHmac('sha256', logIdentityHashKey)
    .update(JSON.stringify(record))
    .digest('hex')
    .slice(0, 32);
}

function opaqueReplyProbeRunId(createId, logIdentityHashKey) {
  if (typeof createId !== 'function') {
    throw failure('P1_012_REPLY_PROBE_RUN_ID_INVALID');
  }
  const entropy = nonEmpty(createId(), 'P1_012_REPLY_PROBE_RUN_ID_INVALID', 128);
  return createHmac('sha256', logIdentityHashKey)
    .update(entropy)
    .digest('hex')
    .slice(0, 32);
}

function clientObservationClaimPath(sourceHash, claimDirectory) {
  if (!/^[a-f0-9]{32}$/u.test(sourceHash)) {
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_INVALID');
  }
  const root = resolve(nonEmpty(claimDirectory, 'P1_012_CLIENT_OBSERVATION_CLAIM_INVALID', 4_096));
  const output = resolve(root, `${sourceHash}.claim`);
  const relation = relative(root, output);
  if (relation === '' || relation.startsWith('..') || relation.includes(':')) {
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_INVALID');
  }
  return Object.freeze({ root, output });
}

function claimSiblingPath(claim, fileName, code) {
  const safeFileName = nonEmpty(fileName, code, 512);
  if (!/^[.A-Za-z0-9_-]{1,512}$/u.test(safeFileName)) {
    throw failure(code);
  }
  const output = resolve(claim.root, safeFileName);
  const relation = relative(claim.root, output);
  if (relation === '' || relation.startsWith('..') || relation.includes(':')) {
    throw failure(code);
  }
  return Object.freeze({ root: claim.root, output });
}

function replyProbeEvidenceRecoveryGuardPath(claim) {
  return claimSiblingPath(
    claim,
    `.${basename(claim.output)}.recovery`,
    'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED',
  );
}

function replyProbeEvidenceRecoveryGuardPrefix(claim) {
  return `.${basename(claim.output)}.recovery`;
}

function replyProbeEvidenceRecoveryTakeoverPath(claim, processId, createdAtMs, ownerId) {
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED');
  }
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED');
  }
  const safeOwnerId = nonEmpty(ownerId, 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED', 128);
  if (!/^[A-Za-z0-9-]{1,128}$/u.test(safeOwnerId)) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED');
  }
  return claimSiblingPath(
    claim,
    `${replyProbeEvidenceRecoveryGuardPrefix(claim)}-takeover-${processId}-${createdAtMs}-${safeOwnerId}`,
    'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED',
  );
}

function defaultClientObservationClaimDirectory() {
  return resolve(tmpdir(), 'fault-reporting-wecom-assistant', 'p1-012-client-observation-claims');
}

function claimMetadata(claimKind, {
  createOwnerId = randomUUID,
  now = Date.now,
  hostnameForClaim = hostname,
  processId = process.pid,
} = {}) {
  if (!Object.values(CLAIM_KINDS).includes(claimKind)) {
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_INVALID');
  }
  const ownerId = nonEmpty(createOwnerId(), 'P1_012_CLIENT_OBSERVATION_CLAIM_INVALID', 128);
  if (!/^[A-Za-z0-9-]{1,128}$/u.test(ownerId)) {
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_INVALID');
  }
  const ownerHostname = nonEmpty(hostnameForClaim(), 'P1_012_CLIENT_OBSERVATION_CLAIM_INVALID', 253);
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_INVALID');
  }
  const createdAtMs = now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_INVALID');
  }
  return Object.freeze({
    schema: CLAIM_METADATA_SCHEMA,
    claim_kind: claimKind,
    owner_id: ownerId,
    owner_pid: processId,
    owner_hostname: ownerHostname,
    created_at_ms: createdAtMs,
  });
}

async function claimClientObservation(sourceHash, claimDirectory, claimKind = CLAIM_KINDS.CLIENT_OBSERVATION) {
  const claim = clientObservationClaimPath(sourceHash, claimDirectory);
  try {
    await mkdir(claim.root, { recursive: true });
  } catch {
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_FAILED');
  }
  try {
    const handle = await open(claim.output, 'wx');
    try {
      const metadata = claimMetadata(claimKind);
      await handle.writeFile(JSON.stringify(metadata), { encoding: 'utf8' });
      return Object.freeze({ ...claim, handle, metadata });
    } catch (error) {
      try { await handle.close(); } catch {}
      try { await unlink(claim.output); } catch {}
      throw error;
    }
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    if (error?.code === 'P1_012_CLIENT_OBSERVATION_CLAIM_INVALID') throw error;
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_FAILED');
  }
}

async function releaseClientObservationClaim(claim) {
  if (!claim) return;
  try { await claim.handle.close(); } catch {}
  try { await unlink(claim.output); } catch {}
}

async function replyProbeEvidenceChainStateMarkers(claim) {
  const recoveryPrefix = replyProbeEvidenceRecoveryGuardPrefix(claim);
  const quarantinePrefix = `.${basename(claim.output)}.quarantine-`;
  try {
    return (await readdir(claim.root)).filter((fileName) => (
      fileName.startsWith(recoveryPrefix) || fileName.startsWith(quarantinePrefix)
    ));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_FAILED');
  }
}

async function recoveryGuardMarkers(claim) {
  const prefix = replyProbeEvidenceRecoveryGuardPrefix(claim);
  return (await replyProbeEvidenceChainStateMarkers(claim)).filter((fileName) => fileName.startsWith(prefix));
}

async function recoveryGuardPresent(claim) {
  return (await replyProbeEvidenceChainStateMarkers(claim)).length > 0;
}

function recoveryGuardMarkerInfo(claim, fileName) {
  const prefix = replyProbeEvidenceRecoveryGuardPrefix(claim);
  if (fileName === prefix) {
    return Object.freeze({ type: 'static', ...replyProbeEvidenceRecoveryGuardPath(claim) });
  }
  const match = new RegExp(
    `^${escapeRegExp(prefix)}-takeover-(\\d{1,10})-(\\d{1,16})-([A-Za-z0-9-]{1,128})$`,
    'u',
  ).exec(fileName);
  if (!match) return null;
  const takeoverPid = Number(match[1]);
  const takeoverCreatedAtMs = Number(match[2]);
  if (!Number.isSafeInteger(takeoverPid) || takeoverPid < 1 || !Number.isSafeInteger(takeoverCreatedAtMs) || takeoverCreatedAtMs < 0) {
    return null;
  }
  return Object.freeze({
    type: 'takeover',
    ...claimSiblingPath(claim, fileName, 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_FAILED'),
    takeover_pid: takeoverPid,
    takeover_created_at_ms: takeoverCreatedAtMs,
    takeover_owner_id: match[3],
  });
}

async function claimReplyProbeEvidenceRecoveryGuard(claim) {
  const guard = replyProbeEvidenceRecoveryGuardPath(claim);
  try {
    await mkdir(guard.root, { recursive: true });
  } catch {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_FAILED');
  }
  if (await recoveryGuardPresent(claim)) return null;
  let handle;
  try {
    handle = await open(guard.output, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') return null;
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_FAILED');
  }
  try {
    const metadata = claimMetadata(CLAIM_KINDS.REPLY_PROBE_EVIDENCE_RECOVERY);
    await handle.writeFile(JSON.stringify(metadata), { encoding: 'utf8' });
    await handle.close();
    handle = null;
    const markers = await replyProbeEvidenceChainStateMarkers(claim);
    if (markers.length !== 1 || markers[0] !== basename(guard.output)) {
      await releaseReplyProbeEvidenceRecoveryGuard({ ...guard, metadata });
      return null;
    }
    return Object.freeze({ ...guard, metadata, wasTakenOver: false });
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await unlink(guard.output); } catch {}
    if (error?.code === 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_RELEASE_FAILED') throw error;
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_FAILED');
  }
}

async function releaseReplyProbeEvidenceRecoveryGuard(guard) {
  if (!guard) return;
  try {
    await unlink(guard.output);
  } catch {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_RELEASE_FAILED');
  }
}

function replyProbeEvidenceChainClaimKey(outputPath, logIdentityHashKey) {
  const absoluteOutputPath = resolve(nonEmpty(outputPath, 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_INVALID', 4_096));
  return createHmac('sha256', logIdentityHashKey)
    .update(`GROUP_REPLY_PROBE:${absoluteOutputPath}`)
    .digest('hex')
    .slice(0, 32);
}

async function claimReplyProbeEvidenceChain(outputPath, logIdentityHashKey, claimDirectory) {
  const claimKey = replyProbeEvidenceChainClaimKey(outputPath, logIdentityHashKey);
  const claim = clientObservationClaimPath(claimKey, claimDirectory);
  try {
    if (await recoveryGuardPresent(claim)) return null;
    const evidenceChainClaim = await claimClientObservation(
      claimKey,
      claimDirectory,
      CLAIM_KINDS.REPLY_PROBE_EVIDENCE_CHAIN,
    );
    if (evidenceChainClaim === null) return null;
    if (await recoveryGuardPresent(claim)) {
      await releaseClientObservationClaim(evidenceChainClaim);
      return null;
    }
    return evidenceChainClaim;
  } catch (error) {
    if (error?.code === 'P1_012_CLIENT_OBSERVATION_CLAIM_FAILED') {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_FAILED');
    }
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_FAILED');
  }
}

function replyProbeClaimRecoveryApproved(env) {
  return String(env.P1_012_REPLY_PROBE_CLAIM_RECOVERY_APPROVED ?? '').toLowerCase() === 'true';
}

function localProcessIsAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function recoveryClaimMetadata(serialized, expectedClaimKind = CLAIM_KINDS.REPLY_PROBE_EVIDENCE_CHAIN) {
  let metadata;
  try {
    metadata = JSON.parse(serialized);
  } catch {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID');
  }
  if (
    !isRecord(metadata)
    || metadata.schema !== CLAIM_METADATA_SCHEMA
    || metadata.claim_kind !== expectedClaimKind
    || typeof metadata.owner_id !== 'string'
    || metadata.owner_id.length === 0
    || metadata.owner_id.length > 128
    || !/^[A-Za-z0-9-]{1,128}$/u.test(metadata.owner_id)
    || !Number.isSafeInteger(metadata.owner_pid)
    || metadata.owner_pid < 1
    || typeof metadata.owner_hostname !== 'string'
    || metadata.owner_hostname.length === 0
    || metadata.owner_hostname.length > 253
    || !Number.isSafeInteger(metadata.created_at_ms)
    || metadata.created_at_ms < 0
  ) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID');
  }
  return Object.freeze(metadata);
}

function recoveryQuarantinePath(claim, recoveryId) {
  const safeRecoveryId = nonEmpty(recoveryId, 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED', 128);
  if (!/^[A-Za-z0-9-]{1,128}$/u.test(safeRecoveryId)) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED');
  }
  return claimSiblingPath(
    claim,
    `.${basename(claim.output)}.quarantine-${safeRecoveryId}`,
    'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED',
  );
}

function recoveryGuardAgeMs({ metadata, stats, marker, now }) {
  if (!Number.isFinite(stats.mtimeMs) || stats.mtimeMs < 0) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
  }
  const currentTime = now();
  if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED');
  }
  const markerCreatedAtMs = marker.type === 'takeover'
    ? marker.takeover_created_at_ms
    : metadata.created_at_ms;
  const newestMarkerTime = Math.max(metadata.created_at_ms, markerCreatedAtMs, Math.ceil(stats.mtimeMs));
  const ageMs = currentTime - newestMarkerTime;
  if (!Number.isSafeInteger(ageMs)) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
  }
  return ageMs;
}

/**
 * Takes over a dead recovery guard without ever removing the last marker:
 * `rename(source, fresh-target)` leaves either the old or the new guard in
 * place, and only one contender can move the same source. A fresh target is
 * cryptographically named and checked absent before the move.
 */
async function takeOverStaleReplyProbeEvidenceRecoveryGuard({
  claim,
  options,
  readGuard = readFile,
  lstatGuard = lstat,
  renameGuard = rename,
  now = Date.now,
  hostnameForClaim = hostname,
  isProcessAlive = localProcessIsAlive,
  processId = process.pid,
  createOwnerId = randomUUID,
} = {}) {
  const markers = await recoveryGuardMarkers(claim);
  if (markers.length === 0) {
    if ((await replyProbeEvidenceChainStateMarkers(claim)).length > 0) {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
    }
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS');
  }
  if (markers.length !== 1) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
  }
  const marker = recoveryGuardMarkerInfo(claim, markers[0]);
  if (marker === null) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
  }
  let guardStats;
  try {
    guardStats = await lstatGuard(marker.output);
    if (guardStats.isSymbolicLink()) {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
    }
  } catch (error) {
    if (error?.code === 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID') throw error;
    if (error?.code === 'ENOENT') {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS');
    }
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
  }
  let metadata;
  try {
    metadata = recoveryClaimMetadata(
      await readGuard(marker.output, { encoding: 'utf8' }),
      CLAIM_KINDS.REPLY_PROBE_EVIDENCE_RECOVERY,
    );
  } catch (error) {
    if (error?.code !== 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID') throw error;
    try {
      if (recoveryGuardAgeMs({
        metadata: { created_at_ms: 0 },
        stats: guardStats,
        marker: { type: 'static' },
        now,
      }) < options.staleClaimMinAgeMs) {
        throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS');
      }
    } catch (ageError) {
      if (ageError?.code === 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS') throw ageError;
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
    }
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
  }
  const localHostname = nonEmpty(hostnameForClaim(), 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED', 253);
  if (metadata.owner_hostname !== localHostname) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_OWNER_HOST_MISMATCH');
  }
  const activeOwnerPid = marker.type === 'takeover' ? marker.takeover_pid : metadata.owner_pid;
  let ownerActive;
  try {
    ownerActive = await isProcessAlive(activeOwnerPid);
  } catch {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_OWNER_STATE_UNKNOWN');
  }
  if (ownerActive !== false) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS');
  }
  if (recoveryGuardAgeMs({ metadata, stats: guardStats, marker, now }) < options.staleClaimMinAgeMs) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS');
  }
  let revalidatedMetadata;
  try {
    revalidatedMetadata = recoveryClaimMetadata(
      await readGuard(marker.output, { encoding: 'utf8' }),
      CLAIM_KINDS.REPLY_PROBE_EVIDENCE_RECOVERY,
    );
  } catch (error) {
    if (error?.code === 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID') throw error;
    if (error?.code === 'ENOENT') {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS');
    }
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_STATE_INVALID');
  }
  if (revalidatedMetadata.owner_id !== metadata.owner_id) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_SOURCE_CHANGED');
  }
  const expectedQuarantine = recoveryQuarantinePath(claim, metadata.owner_id);
  const permittedStateMarkers = new Set([basename(marker.output), basename(expectedQuarantine.output)]);
  const stateMarkers = await replyProbeEvidenceChainStateMarkers(claim);
  if (stateMarkers.some((fileName) => !permittedStateMarkers.has(fileName))) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
  }
  if (!Number.isSafeInteger(processId) || processId < 1) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_FAILED');
  }
  const takeoverCreatedAtMs = now();
  if (!Number.isSafeInteger(takeoverCreatedAtMs) || takeoverCreatedAtMs < 0) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_FAILED');
  }
  const takeover = replyProbeEvidenceRecoveryTakeoverPath(
    claim,
    processId,
    takeoverCreatedAtMs,
    createOwnerId(),
  );
  try {
    await lstatGuard(takeover.output);
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_FAILED');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await renameGuard(marker.output, takeover.output);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_IN_PROGRESS');
    }
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_GUARD_FAILED');
  }
  let movedMetadata;
  try {
    movedMetadata = recoveryClaimMetadata(
      await readGuard(takeover.output, { encoding: 'utf8' }),
      CLAIM_KINDS.REPLY_PROBE_EVIDENCE_RECOVERY,
    );
  } catch {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
  }
  if (movedMetadata.owner_id !== metadata.owner_id) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
  }
  const postMoveMarkers = await replyProbeEvidenceChainStateMarkers(claim);
  const permittedPostMoveMarkers = new Set([basename(takeover.output), basename(expectedQuarantine.output)]);
  if (
    postMoveMarkers.length < 1
    || !postMoveMarkers.includes(basename(takeover.output))
    || postMoveMarkers.some((fileName) => !permittedPostMoveMarkers.has(fileName))
  ) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
  }
  return Object.freeze({ ...takeover, metadata: movedMetadata, wasTakenOver: true });
}

/**
 * A claim is never reclaimed by normal live/observation execution. This
 * explicit maintenance path only removes metadata-bearing claims that are old
 * enough and owned by a known-dead process on this same host.
 */
export async function runP1_012ReplyProbeEvidenceChainRecovery({
  env = process.env,
  options,
  outputPath = evidencePath(),
  claimDirectory = defaultClientObservationClaimDirectory(),
  appendEvidenceRecord = appendEvidence,
  readClaim = readFile,
  lstatClaim = lstat,
  renameClaim = rename,
  unlinkClaim = unlink,
  now = Date.now,
  hostnameForClaim = hostname,
  isProcessAlive = localProcessIsAlive,
  readGuard = readFile,
  lstatGuard = lstat,
  renameGuard = rename,
  recoveryProcessId = process.pid,
  createRecoveryGuardOwnerId = randomUUID,
} = {}) {
  if (
    !options
    || options.mode !== 'recover_reply_probe_evidence_claim'
    || options.scenario !== 'GROUP_REPLY_PROBE'
    || !Number.isSafeInteger(options.staleClaimMinAgeMs)
    || options.staleClaimMinAgeMs < MINIMUM_STALE_CLAIM_AGE_MS
    || options.staleClaimMinAgeMs > MAXIMUM_STALE_CLAIM_AGE_MS
  ) {
    throw failure('P1_012_LIVE_ARGS');
  }
  if (!liveApproved(env) || !replyProbeClaimRecoveryApproved(env)) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_APPROVAL_REQUIRED');
  }
  const config = validateP1_012LiveConfig(env);
  const claimKey = replyProbeEvidenceChainClaimKey(outputPath, config.logIdentityHashKey);
  const claim = clientObservationClaimPath(claimKey, claimDirectory);
  let recoveryGuard = await claimReplyProbeEvidenceRecoveryGuard(claim);
  if (recoveryGuard === null) {
    recoveryGuard = await takeOverStaleReplyProbeEvidenceRecoveryGuard({
      claim,
      options,
      readGuard,
      lstatGuard,
      renameGuard,
      now,
      hostnameForClaim,
      isProcessAlive,
      processId: recoveryProcessId,
      createOwnerId: createRecoveryGuardOwnerId,
    });
  }
  let retainRecoveryGuard = false;
  try {
    let claimStats;
    let serialized;
    const quarantine = recoveryQuarantinePath(claim, recoveryGuard.metadata.owner_id);
    const permittedStateMarkers = new Set([basename(recoveryGuard.output), basename(quarantine.output)]);
    const stateMarkers = await replyProbeEvidenceChainStateMarkers(claim);
    if (stateMarkers.some((fileName) => !permittedStateMarkers.has(fileName))) {
      retainRecoveryGuard = true;
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
    }
    const quarantineAlreadyPresent = stateMarkers.includes(basename(quarantine.output));
    let sourceIsQuarantined = false;
    try {
      claimStats = await lstatClaim(claim.output);
      if (claimStats.isSymbolicLink()) {
        throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID');
      }
      if (quarantineAlreadyPresent) {
        retainRecoveryGuard = true;
        throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
      }
      serialized = await readClaim(claim.output, { encoding: 'utf8' });
    } catch (error) {
      if (error?.code === 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID') throw error;
      if (error?.code === 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED') throw error;
      if (error?.code === 'ENOENT') {
        if (!quarantineAlreadyPresent) {
          retainRecoveryGuard = true;
          throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
        }
        try {
          claimStats = await lstatClaim(quarantine.output);
          if (claimStats.isSymbolicLink()) {
            throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID');
          }
          serialized = await readClaim(quarantine.output, { encoding: 'utf8' });
          sourceIsQuarantined = true;
        } catch (quarantineError) {
          retainRecoveryGuard = true;
          if (quarantineError?.code === 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID') throw quarantineError;
          if (quarantineError?.code === 'ENOENT') {
            throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
          }
          throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_INSPECTION_FAILED');
        }
      } else {
        throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_INSPECTION_FAILED');
      }
    }
    const metadata = recoveryClaimMetadata(serialized);
    const localHostname = nonEmpty(hostnameForClaim(), 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED', 253);
    if (metadata.owner_hostname !== localHostname) {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_OWNER_HOST_MISMATCH');
    }
    let ownerActive;
    try {
      ownerActive = await isProcessAlive(metadata.owner_pid);
    } catch {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_OWNER_STATE_UNKNOWN');
    }
    if (ownerActive !== false) {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_OWNER_ACTIVE');
    }
    if (!Number.isFinite(claimStats.mtimeMs) || claimStats.mtimeMs < 0) {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID');
    }
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED');
    }
    const newestClaimTime = Math.max(metadata.created_at_ms, Math.ceil(claimStats.mtimeMs));
    const staleAgeMs = currentTime - newestClaimTime;
    if (!Number.isSafeInteger(staleAgeMs) || staleAgeMs < options.staleClaimMinAgeMs) {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_NOT_STALE');
    }
    let revalidatedMetadata;
    try {
      revalidatedMetadata = recoveryClaimMetadata(await readClaim(
        sourceIsQuarantined ? quarantine.output : claim.output,
        { encoding: 'utf8' },
      ));
    } catch (error) {
      if (error?.code === 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_METADATA_INVALID') throw error;
      if (error?.code === 'ENOENT') {
        throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RACED');
      }
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_INSPECTION_FAILED');
    }
    if (revalidatedMetadata.owner_id !== metadata.owner_id) {
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_SOURCE_CHANGED');
    }
    if (!sourceIsQuarantined) {
      try {
        await renameClaim(claim.output, quarantine.output);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RACED');
        }
        throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_FAILED');
      }
    }
    const quarantinedRecord = Object.freeze({
      test_id: TEST_ID,
      event: 'p1_012_reply_probe_evidence_claim_quarantined',
      ...config.public_summary,
      scenario: 'GROUP_REPLY_PROBE',
      recovery: Object.freeze({
        action: 'STALE_CLAIM_QUARANTINED',
        claim_key_hash: claimKey,
        stale_age_ms: staleAgeMs,
        owner_state: 'LOCAL_PROCESS_NOT_RUNNING',
        ...(sourceIsQuarantined ? { resumed: true } : {}),
      }),
    });
    try {
      await appendEvidenceRecord(outputPath, quarantinedRecord);
    } catch {
      if (sourceIsQuarantined) {
        retainRecoveryGuard = true;
      } else {
        try {
          await renameClaim(quarantine.output, claim.output);
        } catch {
          retainRecoveryGuard = true;
          throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
        }
      }
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_AUDIT_FAILED');
    }
    try {
      await unlinkClaim(quarantine.output);
    } catch {
      retainRecoveryGuard = true;
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_QUARANTINE_CLEANUP_FAILED');
    }
    const recoveredRecord = Object.freeze({
      test_id: TEST_ID,
      event: 'p1_012_reply_probe_evidence_claim_recovered',
      ...config.public_summary,
      scenario: 'GROUP_REPLY_PROBE',
      recovery: Object.freeze({
        action: 'STALE_CLAIM_REMOVED',
        claim_key_hash: claimKey,
        stale_age_ms: staleAgeMs,
        owner_state: 'LOCAL_PROCESS_NOT_RUNNING',
        ...(sourceIsQuarantined ? { resumed: true } : {}),
      }),
    });
    try {
      await appendEvidenceRecord(outputPath, recoveredRecord);
    } catch {
      retainRecoveryGuard = true;
      throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_RECOVERY_RECONCILIATION_REQUIRED');
    }
    console.log(JSON.stringify(recoveredRecord));
    return Object.freeze({ ok: true, scenario: 'GROUP_REPLY_PROBE', stale_claim_recovered: true });
  } finally {
    if (!retainRecoveryGuard) {
      await releaseReplyProbeEvidenceRecoveryGuard(recoveryGuard);
    }
  }
}

async function appendReplyProbeEvidenceRecord({
  outputPath,
  record,
  appendEvidenceRecord,
  evidenceChainClaim,
  releaseEvidenceChain,
}) {
  if (evidenceChainClaim === null || evidenceChainClaim === undefined) {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_MISSING');
  }
  if (typeof releaseEvidenceChain !== 'function') {
    throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_MISSING');
  }
  try {
    await appendEvidenceRecord(outputPath, record);
  } finally {
    await releaseEvidenceChain(evidenceChainClaim);
  }
}

function clientObservationAlreadyRecorded(records, sourceHash) {
  return records.some((record) => (
    record?.test_id === TEST_ID
    && record.event === 'p1_012_client_display_observed'
    && record.scenario === 'GROUP_REPLY_PROBE'
    && record.source_result_hash === sourceHash
  ));
}

function safeWssErrorCode(error) {
  if (Number.isInteger(error?.errcode)) return 'WECOM_REPLY_REJECTED';
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(error.code)) {
    return error.code;
  }
  return 'WECOM_WSS_FAILED';
}

function safeClientLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function callbackContainsTrigger(frame, triggerToken) {
  const body = frame?.body;
  if (!isRecord(body)) return false;
  if (body.msgtype === 'text') {
    return typeof body.text?.content === 'string' && body.text.content.includes(triggerToken);
  }
  if (body.msgtype === 'mixed') {
    return Array.isArray(body.mixed?.msg_item) && body.mixed.msg_item.some((item) => (
      item?.msgtype === 'text'
      && typeof item.text?.content === 'string'
      && item.text.content.includes(triggerToken)
    ));
  }
  return false;
}

function capturedGroupId(frame, { testAccountUserId, triggerToken }) {
  const body = frame?.body;
  if (frame?.cmd !== 'aibot_msg_callback' || !isRecord(body) || body.chattype !== 'group') return null;
  if (body.from?.userid !== testAccountUserId || !callbackContainsTrigger(frame, triggerToken)) return null;
  if (typeof body.chatid !== 'string' || !/^[^\s#=]{1,128}$/u.test(body.chatid)) return null;
  return body.chatid;
}

function groupIdHash(groupId, logIdentityHashKey) {
  return createHmac('sha256', logIdentityHashKey).update(groupId).digest('hex').slice(0, 32);
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw failure('P1_012_GROUP_ID_CAPTURE_CANCELLED');
  }
}

async function updatePilotTestGroupId(envFilePath, groupId, { signal } = {}) {
  throwIfAborted(signal);
  const current = await readFile(envFilePath, { encoding: 'utf8', signal });
  throwIfAborted(signal);
  const linePattern = /^PILOT_TEST_GROUP_ID=.*$/mu;
  if (!linePattern.test(current)) {
    throw failure('P1_012_GROUP_ID_CONFIG_LINE_MISSING');
  }
  const next = current.replace(linePattern, `PILOT_TEST_GROUP_ID=${groupId}`);
  if (next === current) return false;
  await writeFile(envFilePath, next, { encoding: 'utf8', signal });
  throwIfAborted(signal);
  return true;
}

function createWssClient(Client, config) {
  return new Client({
    botId: config.pilot.wecom.botId,
    secret: config.pilot.wecom.botSecret,
    wsUrl: config.pilot.wecom.wsUrl,
    reconnectInterval: 1_000,
    maxReconnectAttempts: -1,
    logger: safeClientLogger(),
  });
}

export function createWeComDeliverySender(client) {
  return async ({ channel, targetKey }) => {
    if (channel !== 'WECOM_DIRECT') {
      return { ok: false, code: 'P1_012_DELIVERY_CHANNEL_UNMAPPED' };
    }
    try {
      const receipt = await client.sendMessage(targetKey, {
        msgtype: 'text',
        text: { content: 'P1-012 验收通知已提交，请以当前会话中的工单回执为准。' },
      });
      if (receipt?.errcode !== 0) {
        if (!Number.isInteger(receipt?.errcode)) {
          return { ok: false, code: 'WECOM_DELIVERY_ACK_MISSING' };
        }
        return { ok: false, code: 'WECOM_DELIVERY_REJECTED' };
      }
      return { ok: true, providerMessageId: null };
    } catch {
      return { ok: false, code: 'WECOM_DELIVERY_FAILED' };
    }
  };
}

/**
 * The current long-connection reply contract uses a completed stream for a
 * message callback. Plain text is only documented for welcome replies.
 */
export function createWeComGroupPassiveReplySender(client, { createId = randomUUID } = {}) {
  if (!client || typeof client.replyStream !== 'function') {
    throw new TypeError('client.replyStream is required.');
  }
  if (typeof createId !== 'function') {
    throw new TypeError('createId must be a function.');
  }
  return async (frame, body) => {
    const content = body?.msgtype === 'text' ? body.text?.content : null;
    if (typeof content !== 'string' || content.length === 0 || Buffer.byteLength(content, 'utf8') > 20_480) {
      throw failure('P1_012_PASSIVE_REPLY_BODY_INVALID');
    }
    const streamId = `p1-012-${nonEmpty(createId(), 'P1_012_PASSIVE_REPLY_STREAM_ID_INVALID', 120)}`;
    return client.replyStream(frame, streamId, content, true);
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The WeCom long-connection receive contract keeps a leading group @mention
 * in text.content. Treat that addressing prefix as transport syntax only;
 * the payload after it must still equal the short token byte-for-byte.
 */
function replyProbeTokenMatch(content, triggerToken) {
  if (typeof content !== 'string') return 'MISMATCHED';
  if (content === triggerToken) return 'EXACT';
  const mentionedToken = new RegExp(`^@[^\\s@]+ ${escapeRegExp(triggerToken)}$`, 'u');
  return mentionedToken.test(content)
    ? 'WECOM_MENTION_PREFIX_EXACT'
    : (content.includes(triggerToken) ? 'CONTAINS_ONLY' : 'MISMATCHED');
}

function exactScopedReplyProbeFrame(frame, {
  testGroupId,
  testAccountUserId,
  testBotId,
  triggerToken,
}) {
  const body = frame?.body;
  const tokenMatch = replyProbeTokenMatch(body?.text?.content, triggerToken);
  return frame?.cmd === 'aibot_msg_callback'
    && isRecord(body)
    && body.chattype === 'group'
    && body.chatid === testGroupId
    && body.from?.userid === testAccountUserId
    && body.aibotid === testBotId
    && body.msgtype === 'text'
    && ['EXACT', 'WECOM_MENTION_PREFIX_EXACT'].includes(tokenMatch);
}

/**
 * A short probe is deliberately exact-only, but a failed exact match must be
 * diagnosable without putting callback content or identities into evidence.
 * Only callbacks that contain the short operator token produce this bounded
 * diagnostic; it does not send a reply or touch the Pilot store.
 */
function replyProbeMismatchDiagnostic(frame, {
  testGroupId,
  testAccountUserId,
  testBotId,
  triggerToken,
}) {
  const body = frame?.body;
  if (frame?.cmd !== 'aibot_msg_callback' || !isRecord(body) || body.msgtype !== 'text') {
    return null;
  }
  const content = body.text?.content;
  const tokenMatch = replyProbeTokenMatch(content, triggerToken);
  if (tokenMatch === 'MISMATCHED') {
    return null;
  }
  return Object.freeze({
    scenario: 'GROUP_REPLY_PROBE',
    callback_received: true,
    group_scope: body.chattype === 'group' && body.chatid === testGroupId ? 'MATCHED' : 'MISMATCHED',
    sender_scope: body.from?.userid === testAccountUserId ? 'MATCHED' : 'MISMATCHED',
    bot_scope: body.aibotid === testBotId ? 'MATCHED' : 'MISMATCHED',
    payload_token_match: tokenMatch,
    database_write: false,
    reply_attempted: false,
  });
}

function passiveReplyEvidence(receipt) {
  const providerErrcode = Number.isInteger(receipt?.errcode) ? receipt.errcode : null;
  const acknowledged = providerErrcode === 0;
  return Object.freeze({
    operation: 'aibot_respond_msg_stream',
    attempted: true,
    acknowledged,
    provider_errcode: providerErrcode,
    outcome: acknowledged ? 'ACKED' : (providerErrcode === null ? 'UNKNOWN' : 'REJECTED'),
    ...(acknowledged ? {} : { error_code: providerErrcode === null ? 'WECOM_REPLY_ACK_MISSING' : 'WECOM_REPLY_REJECTED' }),
  });
}

function passiveReplyFailureEvidence(error) {
  const providerErrcode = Number.isInteger(error?.errcode) && error.errcode !== 0 ? error.errcode : null;
  return Object.freeze({
    operation: 'aibot_respond_msg_stream',
    attempted: true,
    acknowledged: false,
    provider_errcode: providerErrcode,
    outcome: providerErrcode === null ? 'UNKNOWN' : 'REJECTED',
    error_code: providerErrcode === null ? 'WECOM_REPLY_FAILED' : 'WECOM_REPLY_REJECTED',
  });
}

function createGroupReplyProbeHandler({
  testGroupId,
  testAccountUserId,
  testBotId,
  triggerToken,
  reply,
  reserveOperation,
  operationActive,
  claimEvidenceChain,
  onEvidenceChainClaimed,
  releaseEvidenceChain,
}) {
  if (typeof reserveOperation !== 'function') {
    throw new TypeError('reserveOperation must be a function.');
  }
  if (
    typeof operationActive !== 'function'
    || typeof claimEvidenceChain !== 'function'
    || typeof onEvidenceChainClaimed !== 'function'
    || typeof releaseEvidenceChain !== 'function'
  ) {
    throw new TypeError('reply-probe evidence chain claim functions are required.');
  }
  let firstMatchClaimed = false;
  return Object.freeze({
    async handleFrame(frame) {
      if (!exactScopedReplyProbeFrame(frame, { testGroupId, testAccountUserId, testBotId, triggerToken })) {
        return Object.freeze({
          outcome: 'ignored',
          scenario: 'GROUP_REPLY_PROBE',
          probe_diagnostic: replyProbeMismatchDiagnostic(frame, {
            testGroupId,
            testAccountUserId,
            testBotId,
            triggerToken,
          }),
        });
      }
      if (firstMatchClaimed) {
        return Object.freeze({ outcome: 'ignored', scenario: 'GROUP_REPLY_PROBE' });
      }
      if (!reserveOperation()) {
        return Object.freeze({ outcome: 'ignored', scenario: 'GROUP_REPLY_PROBE' });
      }
      firstMatchClaimed = true;
      const evidenceChainClaim = await claimEvidenceChain();
      if (evidenceChainClaim === null) {
        const result = {
          outcome: 'failed',
          scenario: 'GROUP_REPLY_PROBE',
          error_code: 'P1_012_REPLY_PROBE_EVIDENCE_CLAIM_IN_PROGRESS',
        };
        Object.defineProperty(result, PROBE_OPERATION_CLAIMED, { value: true });
        return Object.freeze(result);
      }
      onEvidenceChainClaimed(evidenceChainClaim);
      if (!operationActive()) {
        await releaseEvidenceChain(evidenceChainClaim);
        return Object.freeze({ outcome: 'ignored', scenario: 'GROUP_REPLY_PROBE' });
      }
      try {
        let passiveReply;
        try {
          passiveReply = passiveReplyEvidence(await reply(frame, {
            msgtype: 'text',
            text: { content: 'P1-012 回执探针已收到。' },
          }));
        } catch (error) {
          passiveReply = passiveReplyFailureEvidence(error);
        }
        const result = {
          outcome: 'processed',
          scenario: 'GROUP_REPLY_PROBE',
          probe: Object.freeze({
            exact_token: true,
            addressing: replyProbeTokenMatch(frame.body.text.content, triggerToken) === 'WECOM_MENTION_PREFIX_EXACT'
              ? 'WECOM_MENTION_PREFIX'
              : 'BARE',
            database_write: false,
          }),
          passive_reply: passiveReply,
        };
        Object.defineProperty(result, PROBE_OPERATION_CLAIMED, { value: true });
        Object.defineProperty(result, PROBE_EVIDENCE_CHAIN_CLAIM, { value: evidenceChainClaim });
        return Object.freeze(result);
      } catch (error) {
        await releaseEvidenceChain(evidenceChainClaim);
        throw error;
      }
    },
  });
}

function acceptedLiveResult(result) {
  if (result.scenario === 'GROUP_REPLY_PROBE') {
    return result.outcome === 'processed'
      && result.probe?.exact_token === true
      && result.probe?.database_write === false
      && result.passive_reply?.acknowledged === true;
  }
  return result.outcome === 'processed'
    && result.core?.accepted === true
    && result.passive_reply?.acknowledged === true;
}

function createOperationReservation() {
  let active = false;
  let deferredFailureCode = null;
  let controller = null;
  return Object.freeze({
    reserve() {
      if (active) return false;
      active = true;
      deferredFailureCode = null;
      controller = new AbortController();
      return true;
    },
    deferFailure(errorCode) {
      if (!active) return false;
      if (deferredFailureCode === null) deferredFailureCode = errorCode;
      return true;
    },
    release() {
      if (!active) return null;
      active = false;
      const errorCode = deferredFailureCode;
      deferredFailureCode = null;
      controller = null;
      return errorCode;
    },
    forceAbort() {
      const wasActive = active;
      const errorCode = deferredFailureCode;
      active = false;
      deferredFailureCode = null;
      controller?.abort();
      controller = null;
      return Object.freeze({ active: wasActive, deferred_failure_code: errorCode });
    },
    isReserved() {
      return active;
    },
    signal() {
      return controller?.signal ?? null;
    },
  });
}

function relationCheck(pool, relations) {
  return async () => {
    const result = await pool.query(
      `SELECT bool_and(to_regclass(required_relation) IS NOT NULL) AS ready
         FROM unnest($1::text[]) AS required(required_relation)`,
      [relations],
    );
    return { ok: result.rows[0]?.ready === true };
  };
}

function createLiveComposition({ pool, client, config, options, writeEvent }) {
  const outbox = createNotificationOutbox();
  const closure = createTicketClosureService({
    pool,
    outbox,
    resolveReporterActor: async () => null,
  });
  const deliveryWorker = createNotificationDeliveryWorker({
    pool,
    sender: createWeComDeliverySender(client),
  });
  const operationalIntake = createPilotOperationalIntake({
    pool,
    serviceIntakeProcessor: createServiceIntakeProcessor(),
    ticketCore: createPilotTicketCore({ pool }),
    closure,
    coreChecks: {
      postgres: async () => {
        await pool.query('SELECT 1');
        return { ok: true };
      },
      intake: relationCheck(pool, ['channel.message_inbox', 'intake.service_intake', 'pilot_ticket.ticket']),
      outbox: relationCheck(pool, ['notification.outbox', 'notification.delivery']),
    },
    identityHashKey: config.logIdentityHashKey,
    writeLogRecord: async (record) => writeEvent('security_log_recorded', { record }),
  });
  return createPilotE2EHandler({
    testGroupId: config.pilot.testGroupId,
    testAccountUserIds: [config.testAccountUserId],
    triggerToken: options.triggerToken,
    scenario: options.scenario,
    accept: operationalIntake.accept,
    reply: createWeComGroupPassiveReplySender(client),
    deliver: deliveryWorker.deliver,
  });
}

function liveApproved(env) {
  return String(env.P1_012_LIVE_TEST_APPROVED ?? '').toLowerCase() === 'true';
}

function groupIdCaptureApproved(env) {
  return String(env.P1_012_GROUP_ID_CAPTURE_APPROVED ?? '').toLowerCase() === 'true';
}

/**
 * Records the configured test account's explicit client-side observation only
 * after a completed, mention-prefixed, non-writing reply probe is already in
 * the append-only evidence log. The source record itself remains redacted;
 * this record carries only an HMAC correlation value.
 */
export async function runP1_012ClientObservation({
  env = process.env,
  options,
  outputPath = evidencePath(),
  appendEvidenceRecord = appendEvidence,
  readRecords = readEvidenceRecords,
  claimDirectory = defaultClientObservationClaimDirectory(),
} = {}) {
  if (!options || options.mode !== 'client_observation' || options.scenario !== 'GROUP_REPLY_PROBE') {
    throw failure('P1_012_LIVE_ARGS');
  }
  const observation = safeClientDisplayObservation(options.observation);
  if (!liveApproved(env)) {
    throw failure('P1_012_LIVE_APPROVAL_REQUIRED');
  }
  const config = validateP1_012LiveConfig(env);
  const records = await readRecords(outputPath);
  const source = latestSuccessfulMentionReplyProbeRecord(records);
  if (source === null) {
    throw failure('P1_012_CLIENT_OBSERVATION_SOURCE_MISSING');
  }
  const sourceHash = sourceResultHash(source, config.logIdentityHashKey);
  if (clientObservationAlreadyRecorded(records, sourceHash)) {
    throw failure('P1_012_CLIENT_OBSERVATION_ALREADY_RECORDED');
  }
  const record = Object.freeze({
    test_id: TEST_ID,
    event: 'p1_012_client_display_observed',
    ...config.public_summary,
    scenario: 'GROUP_REPLY_PROBE',
    source_result_hash: sourceHash,
    source_addressing: 'WECOM_MENTION_PREFIX',
    provider_reply_acknowledged: true,
    database_write: false,
    observer: 'configured_test_account',
    observation,
  });
  const chainClaim = await claimReplyProbeEvidenceChain(outputPath, config.logIdentityHashKey, claimDirectory);
  if (chainClaim === null) {
    throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_IN_PROGRESS');
  }
  try {
    const currentRecords = await readRecords(outputPath);
    const currentSource = latestSuccessfulMentionReplyProbeRecord(currentRecords);
    if (currentSource === null) {
      throw failure('P1_012_CLIENT_OBSERVATION_SOURCE_MISSING');
    }
    if (sourceResultHash(currentSource, config.logIdentityHashKey) !== sourceHash) {
      throw failure('P1_012_CLIENT_OBSERVATION_SOURCE_STALE');
    }
    if (clientObservationAlreadyRecorded(currentRecords, sourceHash)) {
      throw failure('P1_012_CLIENT_OBSERVATION_ALREADY_RECORDED');
    }
    const claim = await claimClientObservation(sourceHash, claimDirectory);
    if (claim === null) {
      throw failure('P1_012_CLIENT_OBSERVATION_CLAIM_IN_PROGRESS');
    }
    try {
      const appendRecords = await readRecords(outputPath);
      const appendSource = latestSuccessfulMentionReplyProbeRecord(appendRecords);
      if (appendSource === null) {
        throw failure('P1_012_CLIENT_OBSERVATION_SOURCE_MISSING');
      }
      if (sourceResultHash(appendSource, config.logIdentityHashKey) !== sourceHash) {
        throw failure('P1_012_CLIENT_OBSERVATION_SOURCE_STALE');
      }
      if (clientObservationAlreadyRecorded(appendRecords, sourceHash)) {
        throw failure('P1_012_CLIENT_OBSERVATION_ALREADY_RECORDED');
      }
      try {
        await appendEvidenceRecord(outputPath, record);
      } catch {
        throw failure('P1_012_CLIENT_OBSERVATION_EVIDENCE_WRITE_FAILED');
      }
    } finally {
      await releaseClientObservationClaim(claim);
    }
  } finally {
    await releaseClientObservationClaim(chainClaim);
  }
  console.log(JSON.stringify(record));
  return Object.freeze({ ok: true, scenario: 'GROUP_REPLY_PROBE', observation });
}

export async function runP1_012LiveE2E({
  env = process.env,
  options,
  Client = AiBot.WSClient,
  PoolClass = Pool,
  outputPath = evidencePath(),
  createHandler = createLiveComposition,
  appendEvidenceRecord = appendEvidence,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
  createRunId = randomUUID,
  claimDirectory = defaultClientObservationClaimDirectory(),
} = {}) {
  if (!options || options.mode !== 'live') {
    throw failure('P1_012_LIVE_ARGS');
  }
  if (!liveApproved(env)) {
    throw failure('P1_012_LIVE_APPROVAL_REQUIRED');
  }
  const config = validateP1_012LiveConfig(env);
  const replyProbeRunId = options.scenario === 'GROUP_REPLY_PROBE'
    ? opaqueReplyProbeRunId(createRunId, config.logIdentityHashKey)
    : null;
  const usesOperationalStore = options.scenario === 'GROUP_TEXT' || options.scenario === 'GROUP_IMAGE_DEGRADED';
  const pool = usesOperationalStore
    ? new PoolClass({
      connectionString: config.pilot.pilotDatabaseUrl,
      max: 4,
      connectionTimeoutMillis: 5_000,
    })
    : null;
  let client;
  let timer;
  let stopping = false;
  let terminalResult = null;
  let terminalCompletion = null;
  let reconnectExpected = options.scenario === 'RECONNECT';
  let authenticatedCount = 0;
  let evidenceWrites = Promise.resolve();
  const drainEvidenceWrites = async () => {
    let observed;
    do {
      observed = evidenceWrites;
      await observed;
  } while (observed !== evidenceWrites);
  };
  const completion = new Promise((resolveCompletion) => {
    const operationReservation = createOperationReservation();
    let activeReplyProbeEvidenceChainClaim = null;
    const rememberReplyProbeEvidenceChainClaim = (claim) => {
      if (activeReplyProbeEvidenceChainClaim !== null) {
        throw failure('P1_012_REPLY_PROBE_EVIDENCE_CLAIM_STATE_INVALID');
      }
      activeReplyProbeEvidenceChainClaim = claim;
    };
    const releaseReplyProbeEvidenceChainClaim = async (claim) => {
      await releaseClientObservationClaim(claim);
      if (activeReplyProbeEvidenceChainClaim === claim) {
        activeReplyProbeEvidenceChainClaim = null;
      }
    };
    const closeTerminal = async () => {
      try { await drainEvidenceWrites(); } catch {}
      try { client?.disconnect(); } catch {}
      try { await pool?.end(); } catch {}
      resolveCompletion(terminalResult);
    };
    const claimTerminal = (result) => {
      if (terminalResult !== null) return false;
      terminalResult = Object.freeze(result);
      stopping = true;
      cancelTimeout(timer);
      return true;
    };
    const finish = async (result) => {
      if (!claimTerminal(result)) return terminalCompletion;
      terminalCompletion = closeTerminal();
      return terminalCompletion;
    };
    const writeEvent = async (event, extra = {}, { replyProbeEvidenceChainClaim = null } = {}) => {
      const record = Object.freeze({ test_id: TEST_ID, event, ...extra });
      const write = evidenceWrites.then(async () => {
        if (event === 'p1_012_live_message_result' && record.scenario === 'GROUP_REPLY_PROBE') {
          await appendReplyProbeEvidenceRecord({
            outputPath,
            record,
            appendEvidenceRecord,
            evidenceChainClaim: replyProbeEvidenceChainClaim,
            releaseEvidenceChain: releaseReplyProbeEvidenceChainClaim,
          });
        } else {
          await appendEvidenceRecord(outputPath, record);
        }
        console.log(JSON.stringify(record));
        return record;
      });
      evidenceWrites = write.catch(() => {});
      return write;
    };
    const fail = async (errorCode, { force = false } = {}) => {
      if (terminalResult !== null) return terminalCompletion;
      const forcedOperation = force ? operationReservation.forceAbort() : null;
      if (!force && operationReservation.deferFailure(errorCode)) return null;
      const terminalErrorCode = forcedOperation?.deferred_failure_code ?? errorCode;
      if (!claimTerminal({ ok: false, error_code: terminalErrorCode })) {
        if (force) await releaseReplyProbeEvidenceChainClaim(activeReplyProbeEvidenceChainClaim);
        return terminalCompletion;
      }
      if (force) {
        await releaseReplyProbeEvidenceChainClaim(activeReplyProbeEvidenceChainClaim);
      }
      try {
        await writeEvent('p1_012_live_e2e_failed', {
          ...config.public_summary,
          scenario: options.scenario,
          error_code: terminalErrorCode,
          ...(forcedOperation?.active === true ? { side_effect_state: 'IN_FLIGHT_UNKNOWN' } : {}),
        });
      } catch {}
      terminalCompletion = closeTerminal();
      return terminalCompletion;
    };
    client = createWssClient(Client, config);
    const handler = options.scenario === 'RECONNECT'
      ? null
      : options.scenario === 'GROUP_REPLY_PROBE'
        ? createGroupReplyProbeHandler({
          testGroupId: config.pilot.testGroupId,
          testAccountUserId: config.testAccountUserId,
          testBotId: config.pilot.wecom.botId,
          triggerToken: options.triggerToken,
          reply: createWeComGroupPassiveReplySender(client),
          reserveOperation: () => terminalResult === null && operationReservation.reserve(),
          operationActive: () => terminalResult === null && operationReservation.isReserved(),
          claimEvidenceChain: () => claimReplyProbeEvidenceChain(
            outputPath,
            config.logIdentityHashKey,
            claimDirectory,
          ),
          onEvidenceChainClaimed: rememberReplyProbeEvidenceChainClaim,
          releaseEvidenceChain: releaseReplyProbeEvidenceChainClaim,
        })
        : createHandler({ pool, client, config, options, writeEvent });

    client.on('authenticated', () => {
      if (stopping) return;
      void (async () => {
        authenticatedCount += 1;
        await writeEvent(authenticatedCount === 1 ? 'p1_012_live_e2e_ready' : 'p1_012_wss_reauthenticated', {
          ...config.public_summary,
          scenario: options.scenario,
        });
        if (options.scenario !== 'RECONNECT') return;
        if (authenticatedCount === 1) {
          try { client.disconnect(); } catch { await fail('WECOM_DISCONNECT_FAILED'); }
          return;
        }
        await finish({ ok: true, scenario: 'RECONNECT' });
      })().catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('message', (frame) => {
      if (handler === null || stopping) return;
      void (async () => {
        let operationClaimed = false;
        let replyProbeEvidenceChainClaim = null;
        try {
          const result = await handler.handleFrame(frame);
          operationClaimed = result[PROBE_OPERATION_CLAIMED] === true;
          replyProbeEvidenceChainClaim = result[PROBE_EVIDENCE_CHAIN_CLAIM] ?? null;
          if (result.outcome === 'ignored') {
            if (!result.probe_diagnostic || terminalResult !== null) return;
            try {
              await writeEvent('p1_012_reply_probe_callback_observed', result.probe_diagnostic);
            } catch {
              await fail('P1_012_EVIDENCE_WRITE_FAILED');
            }
            return;
          }
          if (result.outcome === 'failed') {
            const deferredFailure = operationClaimed ? operationReservation.release() : null;
            operationClaimed = false;
            await fail(deferredFailure ?? result.error_code ?? 'P1_012_LIVE_HANDLER_FAILED');
            return;
          }
          if (terminalResult !== null) {
            await releaseReplyProbeEvidenceChainClaim(replyProbeEvidenceChainClaim);
            replyProbeEvidenceChainClaim = null;
            return;
          }
          try {
            const evidenceResult = result.scenario === 'GROUP_REPLY_PROBE'
              ? {
                ...result,
                probe: Object.freeze({ ...result.probe, run_id: replyProbeRunId }),
                }
              : result;
            await writeEvent('p1_012_live_message_result', evidenceResult, {
              replyProbeEvidenceChainClaim,
            });
            replyProbeEvidenceChainClaim = null;
          } catch (error) {
            replyProbeEvidenceChainClaim = null;
            const deferredFailure = operationClaimed ? operationReservation.release() : null;
            operationClaimed = false;
            await fail(deferredFailure ?? error?.code ?? 'P1_012_EVIDENCE_WRITE_FAILED');
            return;
          }
          const deferredFailure = operationClaimed ? operationReservation.release() : null;
          operationClaimed = false;
          if (deferredFailure !== null) {
            await fail(deferredFailure);
            return;
          }
          if (terminalResult !== null) return;
          await finish({
            ok: acceptedLiveResult(result),
            scenario: result.scenario,
          });
        } catch (error) {
          await releaseReplyProbeEvidenceChainClaim(replyProbeEvidenceChainClaim);
          replyProbeEvidenceChainClaim = null;
          const deferredFailure = operationClaimed || operationReservation.isReserved()
            ? operationReservation.release()
            : null;
          await fail(deferredFailure ?? error?.code ?? 'P1_012_LIVE_HANDLER_FAILED');
        }
      })();
    });
    client.on('disconnected', () => {
      if (stopping) return;
      void (async () => {
        await writeEvent('p1_012_wss_disconnected', {
          ...config.public_summary,
          scenario: options.scenario,
        });
        if (reconnectExpected && authenticatedCount === 1) {
          reconnectExpected = false;
          setTimeout(() => {
            if (stopping) return;
            try { client.connect(); } catch { void fail('WECOM_RECONNECT_FAILED'); }
          }, 250);
        }
      })().catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('reconnecting', () => {
      if (stopping) return;
      void writeEvent('p1_012_wss_reconnecting', {
        ...config.public_summary,
        scenario: options.scenario,
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('error', (error) => {
      if (stopping) return;
      void writeEvent('p1_012_wss_error', {
        ...config.public_summary,
        scenario: options.scenario,
        error_code: safeWssErrorCode(error),
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    timer = scheduleTimeout(() => { void fail('P1_012_LIVE_TIMEOUT', { force: true }); }, options.timeoutMs);
    void writeEvent('p1_012_wss_connect_requested', {
      ...config.public_summary,
      scenario: options.scenario,
      timeout_ms: options.timeoutMs,
    }).then(() => {
      if (stopping) return;
      try { client.connect(); } catch { void fail('WECOM_CONNECT_THROWN'); }
    }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
  });
  return completion;
}

/**
 * Captures a callback's group id only after an operator has supplied the
 * configured test account and a one-time token. The raw id is written only to
 * the local .env.pilot line; all evidence keeps a keyed hash instead.
 */
export async function runP1_012GroupIdCapture({
  env = process.env,
  options,
  Client = AiBot.WSClient,
  envFilePath = resolve(process.cwd(), '.env.pilot'),
  outputPath = evidencePath(),
  appendEvidenceRecord = appendEvidence,
  updateGroupId = updatePilotTestGroupId,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
} = {}) {
  if (!options || options.mode !== 'capture_group_id') {
    throw failure('P1_012_LIVE_ARGS');
  }
  if (!groupIdCaptureApproved(env)) {
    throw failure('P1_012_GROUP_ID_CAPTURE_APPROVAL_REQUIRED');
  }
  const config = validateP1_012GroupIdCaptureConfig(env);
  let client;
  let timer;
  let stopping = false;
  let terminalResult = null;
  let terminalCompletion = null;
  let authenticatedCount = 0;
  let evidenceWrites = Promise.resolve();
  const drainEvidenceWrites = async () => {
    let observed;
    do {
      observed = evidenceWrites;
      await observed;
    } while (observed !== evidenceWrites);
  };
  const completion = new Promise((resolveCompletion) => {
    const operationReservation = createOperationReservation();
    let successfulCaptureAudit = null;
    let pendingCaptureAudit = null;
    const closeTerminal = async () => {
      try { await drainEvidenceWrites(); } catch {}
      try { client?.disconnect(); } catch {}
      resolveCompletion(terminalResult);
    };
    const claimTerminal = (result) => {
      if (terminalResult !== null) return false;
      terminalResult = Object.freeze(result);
      stopping = true;
      cancelTimeout(timer);
      return true;
    };
    const finish = async (result) => {
      if (!claimTerminal(result)) return terminalCompletion;
      terminalCompletion = closeTerminal();
      return terminalCompletion;
    };
    const writeEvent = async (event, extra = {}) => {
      const record = Object.freeze({ test_id: TEST_ID, event, ...extra });
      const write = evidenceWrites.then(async () => {
        await appendEvidenceRecord(outputPath, record);
        console.log(JSON.stringify(record));
        return record;
      });
      evidenceWrites = write.catch(() => {});
      return write;
    };
    const fail = async (errorCode, { force = false } = {}) => {
      if (terminalResult !== null) return terminalCompletion;
      const forcedOperation = force ? operationReservation.forceAbort() : null;
      if (!force && operationReservation.deferFailure(errorCode)) return null;
      const terminalErrorCode = forcedOperation?.deferred_failure_code ?? errorCode;
      const captureFailureAudit = successfulCaptureAudit ?? (forcedOperation?.active === true
        ? pendingCaptureAudit ?? { side_effect_state: 'IN_FLIGHT_UNKNOWN' }
        : null);
      if (!claimTerminal({ ok: false, error_code: terminalErrorCode })) return terminalCompletion;
      try {
        await writeEvent('p1_012_group_id_capture_failed', {
          ...config.public_summary,
          error_code: terminalErrorCode,
          ...(captureFailureAudit ?? {}),
        });
      } catch {}
      terminalCompletion = closeTerminal();
      return terminalCompletion;
    };
    client = createWssClient(Client, config);
    client.on('authenticated', () => {
      if (stopping) return;
      void writeEvent(authenticatedCount++ === 0 ? 'p1_012_group_id_capture_ready' : 'p1_012_wss_reauthenticated', {
        ...config.public_summary,
        mode: 'capture_group_id',
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('message', (frame) => {
      if (stopping) return;
      void (async () => {
        const groupId = capturedGroupId(frame, {
          testAccountUserId: config.testAccountUserId,
          triggerToken: options.triggerToken,
        });
        if (groupId === null || !operationReservation.reserve()) return;
        pendingCaptureAudit = Object.freeze({
          side_effect_state: 'IN_FLIGHT_UNKNOWN',
          group_id_hash: groupIdHash(groupId, config.logIdentityHashKey),
          reconciliation_required: true,
        });
        try {
          const configurationUpdated = await updateGroupId(envFilePath, groupId, {
            signal: operationReservation.signal(),
          });
          if (terminalResult !== null) return;
          successfulCaptureAudit = Object.freeze({
            side_effect_state: configurationUpdated ? 'APPLIED' : 'UNCHANGED',
            configuration_updated: configurationUpdated,
            group_id_hash: pendingCaptureAudit.group_id_hash,
          });
          try {
            await writeEvent('p1_012_group_id_capture_applied', {
              ...config.public_summary,
              ...successfulCaptureAudit,
            });
          } catch {
            const deferredFailure = operationReservation.release();
            await fail(deferredFailure ?? 'P1_012_EVIDENCE_WRITE_FAILED');
            return;
          }
          const deferredFailure = operationReservation.release();
          if (deferredFailure !== null) {
            await fail(deferredFailure);
            return;
          }
          if (terminalResult !== null) return;
          await finish({ ok: true, configuration_updated: configurationUpdated });
        } catch (error) {
          const deferredFailure = operationReservation.release();
          await fail(deferredFailure ?? error?.code ?? 'P1_012_GROUP_ID_CAPTURE_FAILED');
        }
      })();
    });
    client.on('disconnected', () => {
      if (stopping) return;
      void writeEvent('p1_012_wss_disconnected', {
        ...config.public_summary,
        mode: 'capture_group_id',
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('reconnecting', () => {
      if (stopping) return;
      void writeEvent('p1_012_wss_reconnecting', {
        ...config.public_summary,
        mode: 'capture_group_id',
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    client.on('error', (error) => {
      if (stopping) return;
      void writeEvent('p1_012_wss_error', {
        ...config.public_summary,
        mode: 'capture_group_id',
        error_code: safeWssErrorCode(error),
      }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
    });
    timer = scheduleTimeout(() => { void fail('P1_012_GROUP_ID_CAPTURE_TIMEOUT', { force: true }); }, options.timeoutMs);
    void writeEvent('p1_012_group_id_capture_connect_requested', {
      ...config.public_summary,
      timeout_ms: options.timeoutMs,
    }).then(() => {
      if (stopping) return;
      try { client.connect(); } catch { void fail('WECOM_CONNECT_THROWN'); }
    }).catch(() => { void fail('P1_012_EVIDENCE_WRITE_FAILED'); });
  });
  return completion;
}

async function main() {
  let options;
  try {
    options = parseP1_012LiveArgs(process.argv.slice(2));
    const config = options.mode === 'capture_group_id'
      ? validateP1_012GroupIdCaptureConfig(process.env)
      : validateP1_012LiveConfig(process.env);
    if (options.mode === 'check') {
      console.log(JSON.stringify({
        test_id: TEST_ID,
        event: 'p1_012_live_e2e_ready',
        mode: 'check',
        ...config.public_summary,
      }));
      return;
    }
  } catch (error) {
    console.log(JSON.stringify({ test_id: TEST_ID, event: 'p1_012_live_e2e_configuration_failed', error_code: error?.code ?? 'P1_012_CONFIG_INVALID' }));
    process.exitCode = 2;
    return;
  }
  try {
    const result = options.mode === 'capture_group_id'
      ? await runP1_012GroupIdCapture({ options })
      : options.mode === 'client_observation'
        ? await runP1_012ClientObservation({ options })
        : options.mode === 'recover_reply_probe_evidence_claim'
          ? await runP1_012ReplyProbeEvidenceChainRecovery({ options })
        : await runP1_012LiveE2E({ options });
    if (!result.ok) {
      console.log(JSON.stringify({
        test_id: TEST_ID,
        event: options.mode === 'capture_group_id'
          ? 'p1_012_group_id_capture_failed'
          : options.mode === 'client_observation'
            ? 'p1_012_client_display_observation_failed'
            : options.mode === 'recover_reply_probe_evidence_claim'
              ? 'p1_012_reply_probe_evidence_claim_recovery_failed'
            : 'p1_012_live_e2e_failed',
        error_code: result.error_code ?? 'P1_012_LIVE_FAILED',
      }));
      process.exitCode = 2;
    }
  } catch (error) {
    console.log(JSON.stringify({
      test_id: TEST_ID,
      event: options?.mode === 'capture_group_id'
        ? 'p1_012_group_id_capture_failed'
        : options?.mode === 'client_observation'
          ? 'p1_012_client_display_observation_failed'
          : options?.mode === 'recover_reply_probe_evidence_claim'
            ? 'p1_012_reply_probe_evidence_claim_recovery_failed'
          : 'p1_012_live_e2e_failed',
      error_code: error?.code ?? 'P1_012_LIVE_FAILED',
    }));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
