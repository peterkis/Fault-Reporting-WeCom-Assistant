import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import {
  TIMELINE_PROJECTOR_NAME,
  TIMELINE_PROJECTOR_VERSION,
  createP1TimelineSourceAdapter,
  createTimelineProjector,
} from '../src/p2-002-timeline-projector.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DEFAULT_BATCH_SIZE = 20;

const PUBLIC_ERROR_CODES = new Set([
  'CONVERSATION_TIMELINE_DISABLED',
  'CONVERSATION_TIMELINE_SOURCE_INVALID',
  'CONVERSATION_TIMELINE_SESSION_NOT_FOUND',
  'CONVERSATION_TIMELINE_SOURCE_CONFLICT',
  'CONVERSATION_TIMELINE_SEQUENCE_CONFLICT',
  'CONVERSATION_TIMELINE_REBUILD_REQUIRED',
  'CONVERSATION_TIMELINE_REBUILD_NOT_AUTHORIZED',
  'CONVERSATION_TIMELINE_REBUILD_FAILED',
  'CONVERSATION_TIMELINE_CHECKPOINT_CONFLICT',
  'CONVERSATION_TIMELINE_STORAGE_FAILED',
  'P2_002_SCHEMA_DRIFT_REMEDIATION_REQUIRED',
]);

export class P2_002RebuildCliError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new P2_002RebuildCliError(code);
}

function requiredUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    fail('CONVERSATION_TIMELINE_SOURCE_INVALID');
  }
  return value.toLowerCase();
}

/**
 * Accepts only a fixed mode and one internal Session UUID. Database URLs,
 * filesystem paths, source records, and SQL are deliberately not CLI inputs.
 */
export function parseP2_002RebuildArgs(argv) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
    fail('CONVERSATION_TIMELINE_SOURCE_INVALID');
  }

  let mode = 'check';
  let explicitMode = null;
  let sessionId = null;

  for (const argument of argv) {
    if (argument === '--check' || argument === '--apply') {
      const nextMode = argument.slice(2);
      if (explicitMode !== null) {
        fail('CONVERSATION_TIMELINE_SOURCE_INVALID');
      }
      explicitMode = nextMode;
      mode = nextMode;
      continue;
    }

    if (argument.startsWith('--session-id=')) {
      if (sessionId !== null) {
        fail('CONVERSATION_TIMELINE_SOURCE_INVALID');
      }
      sessionId = requiredUuid(argument.slice('--session-id='.length));
      continue;
    }

    fail('CONVERSATION_TIMELINE_SOURCE_INVALID');
  }

  if (sessionId === null) {
    fail('CONVERSATION_TIMELINE_SOURCE_INVALID');
  }

  return Object.freeze({ mode, sessionId });
}

export function validateP2_002RebuildEnvironment(options, env = process.env) {
  if (!options || !['check', 'apply'].includes(options.mode)) {
    fail('CONVERSATION_TIMELINE_SOURCE_INVALID');
  }
  if (
    options.mode === 'apply'
    && env.P2_002_REBUILD_APPROVED !== 'true'
  ) {
    fail('CONVERSATION_TIMELINE_REBUILD_NOT_AUTHORIZED');
  }

  const databaseUrl = env.PILOT_DATABASE_URL;
  if (
    typeof databaseUrl !== 'string'
    || databaseUrl.length === 0
    || databaseUrl.length > 4_096
    || /[\u0000-\u001f\u007f]/u.test(databaseUrl)
  ) {
    fail('CONVERSATION_TIMELINE_STORAGE_FAILED');
  }

  return Object.freeze({ databaseUrl });
}

export function stableP2_002RebuildErrorCode(
  error,
  fallback = 'CONVERSATION_TIMELINE_REBUILD_FAILED',
) {
  return typeof error?.code === 'string' && PUBLIC_ERROR_CODES.has(error.code)
    ? error.code
    : fallback;
}

function sourceRecordsFromAdapterResult(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value !== null && typeof value === 'object' && Array.isArray(value.records)) {
    return value.records;
  }
  fail('CONVERSATION_TIMELINE_STORAGE_FAILED');
}

function safeNonNegativeInteger(value, code = 'CONVERSATION_TIMELINE_REBUILD_FAILED') {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(code);
  }
  return value;
}

function safeHash(value, code = 'CONVERSATION_TIMELINE_REBUILD_FAILED') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(code);
  }
  return value;
}

const DEFAULT_RUNTIME = Object.freeze({
  projectorName: TIMELINE_PROJECTOR_NAME,
  projectorVersion: TIMELINE_PROJECTOR_VERSION,
  createP1TimelineSourceAdapter,
  createTimelineProjector,
});

/**
 * Runs one read-only readiness check or one explicitly approved Session rebuild.
 * Returned fields are a fixed safe allowlist; source records and raw errors are
 * never returned to the caller.
 */
export async function runP2_002RebuildCommand({
  options,
  env = process.env,
  PoolClass = null,
  runtime = DEFAULT_RUNTIME,
  signal,
}) {
  const normalizedOptions = Object.freeze({
    mode: options?.mode,
    sessionId: requiredUuid(options?.sessionId),
  });
  const config = validateP2_002RebuildEnvironment(normalizedOptions, env);
  if (
    typeof runtime?.createP1TimelineSourceAdapter !== 'function'
    || typeof runtime?.createTimelineProjector !== 'function'
    || typeof runtime?.projectorName !== 'string'
    || typeof runtime?.projectorVersion !== 'string'
  ) {
    fail('CONVERSATION_TIMELINE_REBUILD_FAILED');
  }

  let pool = null;

  try {
    const poolConfig = {
      connectionString: config.databaseUrl,
      max: 1,
      connectionTimeoutMillis: 2_000,
    };
    pool = PoolClass === null ? createPostgresPool(poolConfig) : new PoolClass(poolConfig);
    const sourceAdapter = runtime.createP1TimelineSourceAdapter({
      pool,
      projectorName: runtime.projectorName,
      projectorVersion: runtime.projectorVersion,
    });
    if (!sourceAdapter || typeof sourceAdapter.readSessionRecords !== 'function') {
      fail('CONVERSATION_TIMELINE_REBUILD_FAILED');
    }
    const adapterResult = await sourceAdapter.readSessionRecords({
      sessionId: normalizedOptions.sessionId,
      signal,
    });
    const records = sourceRecordsFromAdapterResult(adapterResult);
    const projector = runtime.createTimelineProjector({
      pool,
      enabled: true,
      batchSize: DEFAULT_BATCH_SIZE,
    });
    if (
      !projector
      || typeof projector.listTimelineItems !== 'function'
      || typeof projector.checkRebuildSession !== 'function'
      || typeof projector.rebuildSession !== 'function'
    ) {
      fail('CONVERSATION_TIMELINE_REBUILD_FAILED');
    }

    // This validates the Session query path and all projection read relations
    // without changing Items, Bindings, Checkpoints, or any source fact.
    await projector.listTimelineItems({
      sessionId: normalizedOptions.sessionId,
      limit: 1,
      audience: 'WORKBENCH',
      signal,
    });
    const checked = projector.checkRebuildSession({
      sessionId: normalizedOptions.sessionId,
      projectorName: runtime.projectorName,
      projectorVersion: runtime.projectorVersion,
      sourceRecords: records,
      signal,
    });
    const checkedSourceCount = safeNonNegativeInteger(checked?.record_count);
    if (checkedSourceCount !== records.length) {
      fail('CONVERSATION_TIMELINE_REBUILD_FAILED');
    }
    const inputHash = safeHash(checked?.canonical_hash);

    if (normalizedOptions.mode === 'check') {
      return Object.freeze({
        ok: true,
        task: 'P2-002',
        mode: 'check',
        ready: true,
        source_count: checkedSourceCount,
        source_stream_count: safeNonNegativeInteger(checked?.source_stream_count),
        canonical_input_hash: inputHash,
        write_performed: false,
        apply_requires_explicit_approval: true,
      });
    }

    const rebuilt = await projector.rebuildSession({
      sessionId: normalizedOptions.sessionId,
      projectorName: runtime.projectorName,
      projectorVersion: runtime.projectorVersion,
      sourceRecords: records,
      authorized: true,
      signal,
    });
    const receivedCount = safeNonNegativeInteger(rebuilt?.received_count);
    const insertedCount = safeNonNegativeInteger(rebuilt?.inserted_count);
    const canonicalTimelineHash = safeHash(rebuilt?.canonical_hash);
    if (receivedCount !== checkedSourceCount || canonicalTimelineHash !== inputHash) {
      fail('CONVERSATION_TIMELINE_REBUILD_FAILED');
    }
    return Object.freeze({
      ok: true,
      task: 'P2-002',
      mode: 'apply',
      received_count: receivedCount,
      inserted_count: insertedCount,
      replayed_count: safeNonNegativeInteger(rebuilt?.replayed_count),
      conflict_count: safeNonNegativeInteger(rebuilt?.conflict_count),
      session_count: safeNonNegativeInteger(rebuilt?.session_count),
      canonical_input_hash: inputHash,
      canonical_timeline_hash: canonicalTimelineHash,
      batch_hash: safeHash(rebuilt?.batch_hash),
      checkpoint_updated: rebuilt?.checkpoint_updated === true,
      write_performed: true,
    });
  } catch (error) {
    if (error instanceof P2_002RebuildCliError) {
      throw error;
    }
    const code = stableP2_002RebuildErrorCode(error);
    throw new P2_002RebuildCliError(code);
  } finally {
    if (pool && typeof pool.end === 'function') {
      await Promise.resolve(pool.end()).catch(() => {});
    }
  }
}

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const options = parseP2_002RebuildArgs(argv);
    const result = await runP2_002RebuildCommand({
      options,
      env,
      signal: controller.signal,
    });
    writeResult(result);
  } catch (error) {
    writeResult({
      ok: false,
      task: 'P2-002',
      error: {
        code: stableP2_002RebuildErrorCode(error),
        retryable: false,
      },
    });
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
