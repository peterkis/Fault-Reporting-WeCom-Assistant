import { pathToFileURL } from 'node:url';
import { types as utilTypes } from 'node:util';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import {
  REALTIME_DEFAULT_CLEANUP_LIMIT,
  REALTIME_ERROR_CODES,
  REALTIME_MAX_CLEANUP_LIMIT,
  REALTIME_STREAM_NAME,
  checkRealtimeRetention,
  cleanupRealtimeRetention,
} from '../src/p2-003-realtime-event-log.mjs';

const PUBLIC_ERROR_CODES = new Set(Object.values(REALTIME_ERROR_CODES));

export class P2_003RetentionCliError extends Error {
  constructor(code) {
    const stableCode = typeof code === 'string' && PUBLIC_ERROR_CODES.has(code)
      ? code
      : REALTIME_ERROR_CODES.retentionFailed;
    super(stableCode);
    this.name = 'P2_003RetentionCliError';
    this.code = stableCode;
  }
}

function fail(code) {
  throw new P2_003RetentionCliError(code);
}

function safeErrorCode(error) {
  try {
    if (
      error === null
      || typeof error !== 'object'
      || utilTypes.isProxy(error)
    ) {
      return undefined;
    }
    let current = error;
    for (let depth = 0; current !== null && depth < 8; depth += 1) {
      if (utilTypes.isProxy(current)) {
        return undefined;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, 'code');
      if (descriptor !== undefined) {
        return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function stableP2_003RetentionErrorCode(
  error,
  fallback = REALTIME_ERROR_CODES.retentionFailed,
) {
  const code = safeErrorCode(error);
  return typeof code === 'string' && PUBLIC_ERROR_CODES.has(code) ? code : fallback;
}

export function parseP2_003RetentionArgs(argv) {
  if (
    !Array.isArray(argv)
    || utilTypes.isProxy(argv)
    || Object.getPrototypeOf(argv) !== Array.prototype
    || argv.some((value) => typeof value !== 'string')
  ) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--check')) {
    return Object.freeze({ mode: 'check' });
  }
  if (argv.length === 1 && argv[0] === '--apply') {
    return Object.freeze({ mode: 'apply' });
  }
  fail(REALTIME_ERROR_CODES.retentionFailed);
}

function cleanupLimitFromEnvironment(env) {
  const value = env.P2_003_RETENTION_CLEANUP_BATCH_SIZE;
  if (value === undefined || value === '') {
    return REALTIME_DEFAULT_CLEANUP_LIMIT;
  }
  if (
    typeof value !== 'string'
    || !/^[1-9][0-9]{0,2}$/u.test(value)
  ) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > REALTIME_MAX_CLEANUP_LIMIT) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  return limit;
}

export function validateP2_003RetentionEnvironment(options, env = process.env) {
  if (
    options === null
    || typeof options !== 'object'
    || utilTypes.isProxy(options)
    || !['check', 'apply'].includes(options.mode)
  ) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  if (
    options.mode === 'apply'
    && env.P2_003_RETENTION_CLEANUP_APPROVED !== 'true'
  ) {
    fail(REALTIME_ERROR_CODES.retentionNotAuthorized);
  }
  const databaseUrl = env.PILOT_DATABASE_URL;
  if (
    typeof databaseUrl !== 'string'
    || databaseUrl.length < 1
    || databaseUrl.length > 4_096
    || /[\u0000-\u001f\u007f]/u.test(databaseUrl)
  ) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  return Object.freeze({
    databaseUrl,
    limit: cleanupLimitFromEnvironment(env),
  });
}

const DEFAULT_RUNTIME = Object.freeze({
  checkRealtimeRetention,
  cleanupRealtimeRetention,
});

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  return value;
}

function safeFloor(value) {
  if (
    typeof value !== 'string'
    || !/^(0|[1-9][0-9]{0,18})$/u.test(value)
    || value.length > 19
    || (value.length === 19 && value > '9223372036854775807')
  ) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  return value;
}

function publicResult(mode, result, limit) {
  if (result === null || typeof result !== 'object' || utilTypes.isProxy(result)) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  const expectedMode = mode === 'apply' ? 'APPLY' : 'CHECK';
  if (result.mode !== expectedMode || result.batch_limit !== limit) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  const checkedCount = safeCount(result.checked_count);
  const expiredPrefixCount = safeCount(result.expired_prefix_count);
  const deletedCount = safeCount(result.deleted_count);
  if (
    expiredPrefixCount > checkedCount
    || deletedCount > expiredPrefixCount
    || (mode === 'check' && deletedCount !== 0)
    || result.write_performed !== (deletedCount > 0)
  ) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  return Object.freeze({
    ok: true,
    task: 'P2-003',
    operation: 'retention_cleanup',
    mode,
    stream_name: REALTIME_STREAM_NAME,
    checked_count: checkedCount,
    expired_prefix_count: expiredPrefixCount,
    deleted_count: deletedCount,
    previous_floor_event_id: safeFloor(result.previous_floor_event_id),
    new_floor_event_id: safeFloor(result.new_floor_event_id),
    candidate_floor_event_id: safeFloor(result.candidate_floor_event_id),
    batch_limit: limit,
    write_performed: result.write_performed,
    apply_requires_explicit_approval: true,
    feature_flags_enabled: false,
  });
}

export async function runP2_003RetentionCommand({
  options,
  env = process.env,
  PoolClass = null,
  runtime = DEFAULT_RUNTIME,
  now,
} = {}) {
  const config = validateP2_003RetentionEnvironment(options, env);
  if (
    runtime === null
    || typeof runtime !== 'object'
    || utilTypes.isProxy(runtime)
    || typeof runtime.checkRealtimeRetention !== 'function'
    || typeof runtime.cleanupRealtimeRetention !== 'function'
  ) {
    fail(REALTIME_ERROR_CODES.retentionFailed);
  }
  let pool;
  try {
    const poolConfig = {
      connectionString: config.databaseUrl,
      max: 1,
      connectionTimeoutMillis: 2_000,
    };
    pool = PoolClass === null ? createPostgresPool(poolConfig) : new PoolClass(poolConfig);
    const common = {
      pool,
      streamName: REALTIME_STREAM_NAME,
      limit: config.limit,
      ...(now === undefined ? {} : { now }),
    };
    const result = options.mode === 'apply'
      ? await runtime.cleanupRealtimeRetention({ ...common, authorized: true })
      : await runtime.checkRealtimeRetention(common);
    return publicResult(options.mode, result, config.limit);
  } catch (error) {
    throw new P2_003RetentionCliError(stableP2_003RetentionErrorCode(error));
  } finally {
    if (pool !== undefined && pool !== null) {
      try {
        const end = pool.end;
        if (typeof end === 'function') {
          await Promise.resolve(end.call(pool)).catch(() => {});
        }
      } catch {
        // Pool cleanup errors are deliberately excluded from public output.
      }
    }
  }
}

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  try {
    const options = parseP2_003RetentionArgs(argv);
    writeResult(await runP2_003RetentionCommand({ options, env }));
  } catch (error) {
    writeResult({
      ok: false,
      task: 'P2-003',
      operation: 'retention_cleanup',
      error: {
        code: stableP2_003RetentionErrorCode(error),
        retryable: false,
      },
    });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
