import { types as utilTypes } from 'node:util';
import type { PostgresTransaction } from './platform/postgres-pool.mjs';
import { assertEpochMsString } from './platform/time-contract.mjs';

/**
 * Card 42C-2 retention cleanup skeleton (ADR-0060, Accepted).
 * Retain all business data without deletion or anonymization.
 *   1. Unregistered and disabled by default (`enabled = false`, in-process only; no timer,
 *      no scheduler registration, and no persistent compatibility flag).
 *   2. Strictly dry-run only: resolves targets only against the immutable 11-table catalog,
 *      runs `runRetentionCleanupDryRun` inside a PostgreSQL `READ ONLY` transaction when given a
 *      pool with `connect()`, scans expired candidates in keyset batches (<= 1,000 rows) with
 *      table-qualified native columns, and refuses any `apply` or executable policy invocation.
 * The error code and default report policy ID retain their historical UNDECIDED names for callers.
 */

export const RETENTION_DEFAULT_BATCH_SIZE = 1_000;
export const RETENTION_MAX_BATCH_SIZE = 1_000;
export const RETENTION_DEFAULT_MAX_BATCHES_PER_TABLE = 10;
export const RETENTION_MAX_BATCHES_PER_TABLE = 1_000;

export const RETENTION_CLEANUP_ERROR_CODES = Object.freeze({
  disabled: 'RETENTION_CLEANUP_DISABLED',
  policyUndecided: 'RETENTION_CLEANUP_POLICY_UNDECIDED',
  invalidInput: 'RETENTION_CLEANUP_INPUT_INVALID',
  storageFailed: 'RETENTION_CLEANUP_STORAGE_FAILED',
});

export type RetentionCleanupErrorCode =
  (typeof RETENTION_CLEANUP_ERROR_CODES)[keyof typeof RETENTION_CLEANUP_ERROR_CODES];

export class RetentionCleanupError extends Error {
  declare readonly code: RetentionCleanupErrorCode;

  constructor(code: RetentionCleanupErrorCode) {
    super(code);
    this.name = 'RetentionCleanupError';
    this.code = code;
  }
}

export type RetentionCursorMode = 'uuid_id' | 'bigint_id' | 'uuid_intake_id' | 'session_sequence';

export interface RetentionTargetSpec {
  readonly table: string;
  readonly schema: string;
  readonly name: string;
  readonly indexName: string;
  readonly cursorMode: RetentionCursorMode;
}

export interface RetentionPolicyPlugin {
  readonly policyId: string;
  readonly mode: 'DRY_RUN_ONLY';
  readonly applyBatch?: undefined;
}

export const UNDECIDED_RETENTION_POLICY: RetentionPolicyPlugin = Object.freeze({
  policyId: 'ADR_0060_UNDECIDED',
  mode: 'DRY_RUN_ONLY',
});

/** All 11 tables carrying retention_until_epoch_ms, ordered from leaf/ephemeral toward core. */
const RAW_RETENTION_CLEANUP_TARGETS: readonly RetentionTargetSpec[] = [
  {
    table: 'intake.web_report_urge',
    schema: 'intake',
    name: 'web_report_urge',
    indexName: 'web_report_urge_retention_epoch_idx',
    cursorMode: 'uuid_id',
  },
  {
    table: 'intake.web_report_evaluation',
    schema: 'intake',
    name: 'web_report_evaluation',
    indexName: 'web_report_evaluation_retention_epoch_idx',
    cursorMode: 'uuid_id',
  },
  {
    table: 'intake.web_request_binding',
    schema: 'intake',
    name: 'web_request_binding',
    indexName: 'web_request_binding_retention_epoch_idx',
    cursorMode: 'uuid_intake_id',
  },
  {
    table: 'intake.web_submission',
    schema: 'intake',
    name: 'web_submission',
    indexName: 'web_submission_retention_epoch_idx',
    cursorMode: 'uuid_id',
  },
  {
    table: 'intake.contact_journey',
    schema: 'intake',
    name: 'contact_journey',
    indexName: 'contact_journey_retention_epoch_idx',
    cursorMode: 'uuid_id',
  },
  {
    table: 'intake.service_intake',
    schema: 'intake',
    name: 'service_intake',
    indexName: 'service_intake_retention_epoch_idx',
    cursorMode: 'uuid_id',
  },
  {
    table: 'channel.message_inbox',
    schema: 'channel',
    name: 'message_inbox',
    indexName: 'channel_message_inbox_retention_epoch_idx',
    cursorMode: 'bigint_id',
  },
  {
    table: 'conversation.item',
    schema: 'conversation',
    name: 'item',
    indexName: 'conversation_item_retention_epoch_idx',
    cursorMode: 'session_sequence',
  },
  {
    table: 'communication.message',
    schema: 'communication',
    name: 'message',
    indexName: 'communication_message_retention_epoch_idx',
    cursorMode: 'uuid_id',
  },
  {
    table: 'incident.incident',
    schema: 'incident',
    name: 'incident',
    indexName: 'incident_retention_epoch_idx',
    cursorMode: 'uuid_id',
  },
  {
    table: 'operations.backup_checkpoint',
    schema: 'operations',
    name: 'backup_checkpoint',
    indexName: 'operations_backup_retention_epoch_id_idx',
    cursorMode: 'uuid_id',
  },
];

export const RETENTION_CLEANUP_TARGETS: readonly RetentionTargetSpec[] = Object.freeze(
  RAW_RETENTION_CLEANUP_TARGETS.map((entry) => Object.freeze(entry)),
);

const CANONICAL_RETENTION_TARGET_BY_TABLE: ReadonlyMap<string, RetentionTargetSpec> = new Map(
  RETENTION_CLEANUP_TARGETS.map((entry) => [entry.table, entry]),
);

export interface RetentionKeySample {
  readonly retention_until_epoch_ms: string;
  readonly cursor_key: string;
}

export interface RetentionTableScanSummary {
  readonly table: string;
  readonly index_name: string;
  readonly batches_scanned: number;
  readonly candidate_count: number;
  readonly exhausted: boolean;
  readonly sample_first_key: RetentionKeySample | null;
  readonly sample_last_key: RetentionKeySample | null;
  readonly write_performed: false;
}

export interface RetentionDryRunReport {
  readonly mode: 'DRY_RUN';
  readonly policy_id: string;
  readonly now_epoch_ms: string;
  readonly batch_size: number;
  readonly max_batches_per_table: number;
  readonly total_candidates: number;
  readonly write_performed: false;
  readonly tables: readonly RetentionTableScanSummary[];
}

export interface RetentionWorkerCycleResult {
  readonly enabled: boolean;
  readonly skipped: boolean;
  readonly mode: 'DRY_RUN';
  readonly policy_id: string;
  readonly total_candidates: number;
  readonly write_performed: false;
  readonly tables: readonly RetentionTableScanSummary[];
}

type Queryable = Pick<PostgresTransaction, 'query'>;
type ConnectableClient = Queryable & {
  release(err?: Error | boolean): void;
};
type PoolOrQueryable = Queryable & {
  readonly connect?: () => Promise<ConnectableClient>;
};

interface RawCandidateRow {
  readonly retention_until_epoch_ms: string;
  readonly cursor_a: string;
  readonly cursor_b?: string | null;
}

function fail(code: RetentionCleanupErrorCode): never {
  throw new RetentionCleanupError(code);
}

function assertBoundedPositiveInt(value: unknown, fallback: number, max: number): number {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 1 || candidate > max) {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  return candidate;
}

/**
 * Resolves any caller-supplied target descriptor or table key exclusively against the frozen
 * 11-table catalog. SQL is always built from the canonical catalog entry, never raw caller strings.
 */
export function resolveCanonicalRetentionTarget(input: RetentionTargetSpec | string): RetentionTargetSpec {
  if (typeof input === 'string') {
    const canonical = CANONICAL_RETENTION_TARGET_BY_TABLE.get(input);
    if (!canonical) fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
    return canonical;
  }
  if (!input || typeof input !== 'object' || utilTypes.isProxy(input)) {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const canonical = CANONICAL_RETENTION_TARGET_BY_TABLE.get(input.table);
  if (!canonical) {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  if (
    input.schema !== canonical.schema
    || input.name !== canonical.name
    || input.indexName !== canonical.indexName
    || input.cursorMode !== canonical.cursorMode
  ) {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  return canonical;
}

function resolveTargetList(inputs?: readonly (RetentionTargetSpec | string)[]): readonly RetentionTargetSpec[] {
  if (inputs === undefined) return RETENTION_CLEANUP_TARGETS;
  if (!Array.isArray(inputs) || utilTypes.isProxy(inputs) || inputs.length === 0) {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const resolved: RetentionTargetSpec[] = [];
  const seen = new Set<string>();
  for (const item of inputs) {
    const canonical = resolveCanonicalRetentionTarget(item);
    if (seen.has(canonical.table)) {
      fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
    }
    seen.add(canonical.table);
    resolved.push(canonical);
  }
  return resolved;
}

interface CursorValue {
  readonly retention_until_epoch_ms: string;
  readonly a: string;
  readonly b: string | null;
}

/**
 * Builds the keyset dry-run scan SQL from a canonical target.
 * Table is aliased as `r` and all WHERE / seek-tuple / ORDER BY references are qualified (`r.*`)
 * so PostgreSQL resolves native bigint / cursor columns instead of the `::text` output alias.
 */
export function buildRetentionScanSql(
  targetInput: RetentionTargetSpec | string,
  hasCursor: boolean,
): string {
  const target = resolveCanonicalRetentionTarget(targetInput);
  const qualified = `${target.schema}.${target.name}`;
  if (target.cursorMode === 'uuid_id') {
    return `SELECT r.retention_until_epoch_ms::text AS retention_until_epoch_ms, r.id::text AS cursor_a
  FROM ${qualified} AS r
 WHERE r.retention_until_epoch_ms <= $1::bigint${
   hasCursor ? '\n   AND (r.retention_until_epoch_ms, r.id) > ($2::bigint, $3::uuid)' : ''
 }
 ORDER BY r.retention_until_epoch_ms ASC, r.id ASC
 LIMIT ${hasCursor ? '$4' : '$2'}`;
  }
  if (target.cursorMode === 'bigint_id') {
    return `SELECT r.retention_until_epoch_ms::text AS retention_until_epoch_ms, r.id::text AS cursor_a
  FROM ${qualified} AS r
 WHERE r.retention_until_epoch_ms <= $1::bigint${
   hasCursor ? '\n   AND (r.retention_until_epoch_ms, r.id) > ($2::bigint, $3::bigint)' : ''
 }
 ORDER BY r.retention_until_epoch_ms ASC, r.id ASC
 LIMIT ${hasCursor ? '$4' : '$2'}`;
  }
  if (target.cursorMode === 'uuid_intake_id') {
    return `SELECT r.retention_until_epoch_ms::text AS retention_until_epoch_ms, r.intake_id::text AS cursor_a
  FROM ${qualified} AS r
 WHERE r.retention_until_epoch_ms <= $1::bigint${
   hasCursor ? '\n   AND (r.retention_until_epoch_ms, r.intake_id) > ($2::bigint, $3::uuid)' : ''
 }
 ORDER BY r.retention_until_epoch_ms ASC, r.intake_id ASC
 LIMIT ${hasCursor ? '$4' : '$2'}`;
  }
  return `SELECT r.retention_until_epoch_ms::text AS retention_until_epoch_ms,
       r.session_id::text AS cursor_a,
       r.sequence_no::text AS cursor_b
  FROM ${qualified} AS r
 WHERE r.retention_until_epoch_ms <= $1::bigint${
   hasCursor
     ? '\n   AND (r.retention_until_epoch_ms, r.session_id, r.sequence_no) > ($2::bigint, $3::uuid, $4::bigint)'
     : ''
 }
 ORDER BY r.retention_until_epoch_ms ASC, r.session_id ASC, r.sequence_no ASC
 LIMIT ${hasCursor ? '$5' : '$2'}`;
}

function buildScanParams(
  target: RetentionTargetSpec,
  nowEpochMs: string,
  batchSize: number,
  cursor: CursorValue | null,
): unknown[] {
  if (!cursor) {
    return [nowEpochMs, batchSize];
  }
  if (target.cursorMode === 'session_sequence') {
    if (cursor.b === null) fail(RETENTION_CLEANUP_ERROR_CODES.storageFailed);
    return [nowEpochMs, cursor.retention_until_epoch_ms, cursor.a, cursor.b, batchSize];
  }
  return [nowEpochMs, cursor.retention_until_epoch_ms, cursor.a, batchSize];
}

function formatKeySample(row: RawCandidateRow, mode: RetentionCursorMode): RetentionKeySample {
  const epoch = assertEpochMsString(row.retention_until_epoch_ms);
  const cursorKey = mode === 'session_sequence'
    ? `${row.cursor_a}:${row.cursor_b ?? ''}`
    : row.cursor_a;
  return Object.freeze({
    retention_until_epoch_ms: epoch,
    cursor_key: cursorKey,
  });
}

export async function scanRetentionTable(options: {
  readonly client: Queryable;
  readonly target: RetentionTargetSpec | string;
  readonly nowEpochMs: string;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}): Promise<RetentionTableScanSummary> {
  if (!options || typeof options !== 'object' || !options.client || typeof options.client.query !== 'function') {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const target = resolveCanonicalRetentionTarget(options.target);
  let nowEpochMs: string;
  try {
    nowEpochMs = assertEpochMsString(options.nowEpochMs);
  } catch {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const batchSize = assertBoundedPositiveInt(
    options.batchSize,
    RETENTION_DEFAULT_BATCH_SIZE,
    RETENTION_MAX_BATCH_SIZE,
  );
  const maxBatches = assertBoundedPositiveInt(
    options.maxBatches,
    RETENTION_DEFAULT_MAX_BATCHES_PER_TABLE,
    RETENTION_MAX_BATCHES_PER_TABLE,
  );

  let batchesScanned = 0;
  let candidateCount = 0;
  let exhausted = false;
  let cursor: CursorValue | null = null;
  let firstSample: RetentionKeySample | null = null;
  let lastSample: RetentionKeySample | null = null;

  while (batchesScanned < maxBatches) {
    const sql = buildRetentionScanSql(target, cursor !== null);
    const params = buildScanParams(target, nowEpochMs, batchSize, cursor);
    let rows: readonly RawCandidateRow[];
    try {
      const result = await options.client.query<RawCandidateRow>(sql, params);
      rows = result.rows;
    } catch {
      fail(RETENTION_CLEANUP_ERROR_CODES.storageFailed);
    }
    batchesScanned += 1;
    if (!Array.isArray(rows) || rows.length > batchSize) {
      fail(RETENTION_CLEANUP_ERROR_CODES.storageFailed);
    }
    candidateCount += rows.length;
    const batchFirst = rows[0];
    const batchLast = rows.at(-1);
    if (batchFirst && firstSample === null) {
      firstSample = formatKeySample(batchFirst, target.cursorMode);
    }
    if (batchLast) {
      lastSample = formatKeySample(batchLast, target.cursorMode);
      cursor = {
        retention_until_epoch_ms: assertEpochMsString(batchLast.retention_until_epoch_ms),
        a: String(batchLast.cursor_a),
        b: batchLast.cursor_b ?? null,
      };
    }
    if (rows.length < batchSize) {
      exhausted = true;
      break;
    }
  }

  return Object.freeze({
    table: target.table,
    index_name: target.indexName,
    batches_scanned: batchesScanned,
    candidate_count: candidateCount,
    exhausted,
    sample_first_key: firstSample,
    sample_last_key: lastSample,
    write_performed: false,
  });
}

async function withReadOnlyScanClient<T>(
  pool: PoolOrQueryable,
  run: (queryable: Queryable) => Promise<T>,
): Promise<T> {
  if (typeof pool.connect !== 'function') {
    return run(pool);
  }
  let client: ConnectableClient | null = null;
  let txOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    txOpen = true;
    const result = await run(client);
    await client.query('COMMIT');
    txOpen = false;
    return result;
  } catch (error) {
    if (client && txOpen) {
      await client.query('ROLLBACK').catch(() => {});
    }
    if (error instanceof RetentionCleanupError) throw error;
    throw new RetentionCleanupError(RETENTION_CLEANUP_ERROR_CODES.storageFailed);
  } finally {
    client?.release();
  }
}

export async function runRetentionCleanupDryRun(options: {
  readonly pool: PoolOrQueryable;
  readonly nowEpochMs?: string;
  readonly batchSize?: number;
  readonly maxBatchesPerTable?: number;
  readonly targets?: readonly (RetentionTargetSpec | string)[];
  readonly mode?: 'check' | 'apply';
  readonly policy?: RetentionPolicyPlugin;
}): Promise<RetentionDryRunReport> {
  if (!options || typeof options !== 'object' || utilTypes.isProxy(options)) {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const mode = options.mode ?? 'check';
  if (mode !== 'check') {
    fail(RETENTION_CLEANUP_ERROR_CODES.policyUndecided);
  }
  const policy = options.policy ?? UNDECIDED_RETENTION_POLICY;
  if (policy.mode !== 'DRY_RUN_ONLY' || policy.applyBatch !== undefined) {
    fail(RETENTION_CLEANUP_ERROR_CODES.policyUndecided);
  }
  if (!options.pool || typeof options.pool.query !== 'function') {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  let nowEpochMs: string;
  try {
    nowEpochMs = assertEpochMsString(options.nowEpochMs ?? String(Date.now()));
  } catch {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const batchSize = assertBoundedPositiveInt(
    options.batchSize,
    RETENTION_DEFAULT_BATCH_SIZE,
    RETENTION_MAX_BATCH_SIZE,
  );
  const maxBatchesPerTable = assertBoundedPositiveInt(
    options.maxBatchesPerTable,
    RETENTION_DEFAULT_MAX_BATCHES_PER_TABLE,
    RETENTION_MAX_BATCHES_PER_TABLE,
  );
  const targets = resolveTargetList(options.targets);

  return withReadOnlyScanClient(options.pool, async (client) => {
    const summaries: RetentionTableScanSummary[] = [];
    let totalCandidates = 0;
    for (const target of targets) {
      const summary = await scanRetentionTable({
        client,
        target,
        nowEpochMs,
        batchSize,
        maxBatches: maxBatchesPerTable,
      });
      summaries.push(summary);
      totalCandidates += summary.candidate_count;
    }

    return Object.freeze({
      mode: 'DRY_RUN',
      policy_id: policy.policyId,
      now_epoch_ms: nowEpochMs,
      batch_size: batchSize,
      max_batches_per_table: maxBatchesPerTable,
      total_candidates: totalCandidates,
      write_performed: false,
      tables: Object.freeze(summaries),
    });
  });
}

/**
 * In-process worker seam reusing the `runOnce` / single-flight / `close` shape from `workbench-actor-avatars.mts`.
 * Unregistered and disabled by default (`enabled = false`); creates no timer, registers no scheduler, has no
 * persistent compatibility flag, and executes only bounded read-only dry-run scans when explicitly invoked.
 */
export function createRetentionCleanupWorker(options: {
  readonly pool: PoolOrQueryable;
  readonly enabled?: boolean;
  readonly batchSize?: number;
  readonly maxBatchesPerTable?: number;
  readonly now?: () => string;
  readonly targets?: readonly (RetentionTargetSpec | string)[];
  readonly policy?: RetentionPolicyPlugin;
}) {
  if (!options || typeof options !== 'object' || utilTypes.isProxy(options)) {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const enabled = options.enabled ?? false;
  if (enabled !== true && enabled !== false) {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  if (!options.pool || typeof options.pool.query !== 'function') {
    fail(RETENTION_CLEANUP_ERROR_CODES.invalidInput);
  }
  const batchSize = assertBoundedPositiveInt(
    options.batchSize,
    RETENTION_DEFAULT_BATCH_SIZE,
    RETENTION_MAX_BATCH_SIZE,
  );
  const maxBatchesPerTable = assertBoundedPositiveInt(
    options.maxBatchesPerTable,
    RETENTION_DEFAULT_MAX_BATCHES_PER_TABLE,
    RETENTION_MAX_BATCHES_PER_TABLE,
  );
  const policy = options.policy ?? UNDECIDED_RETENTION_POLICY;
  if (policy.mode !== 'DRY_RUN_ONLY' || policy.applyBatch !== undefined) {
    fail(RETENTION_CLEANUP_ERROR_CODES.policyUndecided);
  }
  const nowFn = options.now ?? (() => String(Date.now()));
  const targets = resolveTargetList(options.targets);

  let closed = false;
  let inFlight: Promise<RetentionWorkerCycleResult> | null = null;

  function runOnce(): Promise<RetentionWorkerCycleResult> {
    if (!enabled || closed) {
      return Promise.resolve(Object.freeze({
        enabled,
        skipped: true,
        mode: 'DRY_RUN',
        policy_id: policy.policyId,
        total_candidates: 0,
        write_performed: false,
        tables: Object.freeze([]),
      }));
    }
    if (inFlight) {
      return inFlight;
    }
    inFlight = (async (): Promise<RetentionWorkerCycleResult> => {
      const report = await runRetentionCleanupDryRun({
        pool: options.pool,
        nowEpochMs: nowFn(),
        batchSize,
        maxBatchesPerTable,
        targets,
        mode: 'check',
        policy,
      });
      return Object.freeze({
        enabled: true,
        skipped: false,
        mode: 'DRY_RUN',
        policy_id: report.policy_id,
        total_candidates: report.total_candidates,
        write_performed: false,
        tables: report.tables,
      });
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function close(): Promise<void> {
    closed = true;
    await inFlight?.catch(() => {});
  }

  return Object.freeze({
    enabled,
    policy_id: policy.policyId,
    batch_size: batchSize,
    max_batches_per_table: maxBatchesPerTable,
    runOnce,
    close,
  });
}
