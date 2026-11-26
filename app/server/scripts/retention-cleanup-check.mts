import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import {
  RETENTION_CLEANUP_ERROR_CODES,
  RETENTION_DEFAULT_BATCH_SIZE,
  RETENTION_MAX_BATCH_SIZE,
  RetentionCleanupError,
  runRetentionCleanupDryRun,
} from '../src/retention-cleanup-skeleton.mjs';

export interface RetentionCleanupCliOptions {
  readonly mode: 'check' | 'apply';
}

export function parseRetentionCleanupArgs(argv: readonly string[]): RetentionCleanupCliOptions {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--check')) {
    return Object.freeze({ mode: 'check' });
  }
  if (argv.length === 1 && argv[0] === '--apply') {
    return Object.freeze({ mode: 'apply' });
  }
  throw new RetentionCleanupError(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
}

export function retentionBatchSizeFromEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env.RETENTION_CLEANUP_BATCH_SIZE;
  if (raw === undefined || raw === '') {
    return RETENTION_DEFAULT_BATCH_SIZE;
  }
  if (!/^[1-9][0-9]{0,3}$/u.test(raw)) {
    throw new RetentionCleanupError(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > RETENTION_MAX_BATCH_SIZE) {
    throw new RetentionCleanupError(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  return parsed;
}

export async function runRetentionCleanupCli(options: {
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly nowEpochMs?: string;
} = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const parsed = parseRetentionCleanupArgs(argv);
  if (parsed.mode === 'apply') {
    throw new RetentionCleanupError(RETENTION_CLEANUP_ERROR_CODES.policyUndecided);
  }
  const databaseUrl = env.PILOT_DATABASE_URL;
  if (
    typeof databaseUrl !== 'string'
    || databaseUrl.length < 1
    || databaseUrl.length > 4_096
    || /[\u0000-\u001f\u007f]/u.test(databaseUrl)
  ) {
    throw new RetentionCleanupError(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const batchSize = retentionBatchSizeFromEnvironment(env);
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
    application_name: 'retention_cleanup_dry_run',
  });
  try {
    const report = await runRetentionCleanupDryRun({
      pool,
      batchSize,
      mode: 'check',
      ...(options.nowEpochMs !== undefined ? { nowEpochMs: options.nowEpochMs } : {}),
    });
    return Object.freeze({ ok: true, task: '42C-2', ...report });
  } finally {
    await pool.end().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runRetentionCleanupCli();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof RetentionCleanupError
      ? error.code
      : RETENTION_CLEANUP_ERROR_CODES.storageFailed;
    process.stdout.write(`${JSON.stringify({ ok: false, task: '42C-2', error: { code, retryable: false } })}\n`);
    process.exitCode = 1;
  }
}
