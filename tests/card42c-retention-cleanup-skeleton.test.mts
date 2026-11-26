import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RETENTION_CLEANUP_ERROR_CODES,
  RETENTION_CLEANUP_TARGETS,
  RETENTION_MAX_BATCH_SIZE,
  UNDECIDED_RETENTION_POLICY,
  buildRetentionScanSql,
  createRetentionCleanupWorker,
  resolveCanonicalRetentionTarget,
  runRetentionCleanupDryRun,
  scanRetentionTable,
  type RetentionTargetSpec,
} from '../app/server/src/retention-cleanup-skeleton.mjs';
import {
  parseRetentionCleanupArgs,
  retentionBatchSizeFromEnvironment,
  runRetentionCleanupCli,
} from '../app/server/scripts/retention-cleanup-check.mjs';

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

function makeFakePool(
  responder: (sql: string, values: readonly unknown[]) => readonly Record<string, unknown>[],
) {
  const queries: RecordedQuery[] = [];
  const pool = {
    async query<R extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      queries.push({ sql, values: [...values] });
      const rows = responder(sql, values) as R[];
      return {
        command: 'SELECT',
        rowCount: rows.length,
        oid: 0,
        fields: [],
        rows,
      };
    },
  };
  return { pool, queries };
}

test('retention cleaner enforces batch size <= 1000 and rejects invalid inputs', async () => {
  const { pool, queries } = makeFakePool(() => []);
  const target = RETENTION_CLEANUP_TARGETS[0];
  assert.ok(target);
  assert.equal(RETENTION_MAX_BATCH_SIZE, 1000);

  for (const invalidBatch of [0, -1, 1001, 1.5, Number.NaN]) {
    await assert.rejects(
      () => scanRetentionTable({
        client: pool,
        target,
        nowEpochMs: '1700000000000',
        batchSize: invalidBatch,
      }),
      { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
    );
  }
  assert.equal(queries.length, 0);

  await assert.rejects(
    () => runRetentionCleanupDryRun({
      pool,
      nowEpochMs: '1700000000000',
      batchSize: 1001,
    }),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );
  assert.equal(queries.length, 0);
});

test('retention cleaner walks the retention_until_epoch_ms index in keyset order and stops when batch < batchSize', async () => {
  const rowsByCall: Array<Array<{ retention_until_epoch_ms: string; cursor_a: string }>> = [
    [
      { retention_until_epoch_ms: '1000', cursor_a: '00000000-0000-7000-8000-000000000001' },
      { retention_until_epoch_ms: '1000', cursor_a: '00000000-0000-7000-8000-000000000002' },
    ],
    [
      { retention_until_epoch_ms: '1500', cursor_a: '00000000-0000-7000-8000-000000000003' },
    ],
  ];
  let callIndex = 0;
  const { pool, queries } = makeFakePool(() => rowsByCall[callIndex++] ?? []);
  const target = RETENTION_CLEANUP_TARGETS.find((item) => item.table === 'intake.service_intake');
  assert.ok(target);

  const summary = await scanRetentionTable({
    client: pool,
    target,
    nowEpochMs: '2000',
    batchSize: 2,
    maxBatches: 10,
  });

  assert.equal(summary.batches_scanned, 2);
  assert.equal(summary.candidate_count, 3);
  assert.equal(summary.exhausted, true);
  assert.equal(summary.write_performed, false);
  assert.deepEqual(summary.sample_first_key, {
    retention_until_epoch_ms: '1000',
    cursor_key: '00000000-0000-7000-8000-000000000001',
  });
  assert.deepEqual(summary.sample_last_key, {
    retention_until_epoch_ms: '1500',
    cursor_key: '00000000-0000-7000-8000-000000000003',
  });

  assert.equal(queries.length, 2);
  assert.equal(queries[0]?.sql.includes('FROM intake.service_intake AS r'), true);
  assert.equal(queries[0]?.sql.includes('WHERE r.retention_until_epoch_ms <= $1::bigint'), true);
  assert.equal(queries[0]?.sql.includes('ORDER BY r.retention_until_epoch_ms ASC, r.id ASC'), true);
  assert.equal(queries[0]?.sql.includes('AND (r.retention_until_epoch_ms, r.id) >'), false);
  assert.deepEqual(queries[0]?.values, ['2000', 2]);
  assert.equal(queries[1]?.sql.includes('AND (r.retention_until_epoch_ms, r.id) > ($2::bigint, $3::uuid)'), true);
  assert.deepEqual(queries[1]?.values, ['2000', '1000', '00000000-0000-7000-8000-000000000002', 2]);

  for (const query of queries) {
    assert.equal(/DELETE|UPDATE|INSERT|TRUNCATE/iu.test(query.sql), false);
  }
});

test('retention cleaner stops at maxBatches when every batch is full (exhausted = false)', async () => {
  const { pool, queries } = makeFakePool((_sql, values) => {
    const limit = Number(values.at(-1));
    return Array.from({ length: limit }, (_, idx) => ({
      retention_until_epoch_ms: '1000',
      cursor_a: `00000000-0000-7000-8000-${String(idx + 1).padStart(12, '0')}`,
    }));
  });
  const target = RETENTION_CLEANUP_TARGETS[0];
  assert.ok(target);

  const summary = await scanRetentionTable({
    client: pool,
    target,
    nowEpochMs: '5000',
    batchSize: 3,
    maxBatches: 2,
  });

  assert.equal(summary.batches_scanned, 2);
  assert.equal(summary.candidate_count, 6);
  assert.equal(summary.exhausted, false);
  assert.equal(summary.write_performed, false);
  assert.equal(queries.length, 2);
});

test('buildRetentionScanSql handles all 4 cursor modes with qualified r.* references across all 11 retention tables', () => {
  assert.equal(RETENTION_CLEANUP_TARGETS.length, 11);

  for (const target of RETENTION_CLEANUP_TARGETS) {
    const first = buildRetentionScanSql(target, false);
    const next = buildRetentionScanSql(target, true);
    assert.match(first, /^SELECT r\.retention_until_epoch_ms::text AS retention_until_epoch_ms/u);
    assert.match(first, new RegExp(`FROM ${target.schema}\\.${target.name} AS r`, 'u'));
    assert.match(first, /WHERE r\.retention_until_epoch_ms <= \$1::bigint/u);
    assert.match(next, /AND \(r\.retention_until_epoch_ms,/u);
    assert.match(next, /ORDER BY r\.retention_until_epoch_ms ASC, r\./u);
    assert.equal(/DELETE|UPDATE|INSERT|TRUNCATE/iu.test(first + next), false);
  }

  const itemTarget = RETENTION_CLEANUP_TARGETS.find((t) => t.table === 'conversation.item') as RetentionTargetSpec;
  const itemNext = buildRetentionScanSql(itemTarget, true);
  assert.match(itemNext, /\(r\.retention_until_epoch_ms, r\.session_id, r\.sequence_no\) > \(\$2::bigint, \$3::uuid, \$4::bigint\)/u);

  const inboxTarget = RETENTION_CLEANUP_TARGETS.find((t) => t.table === 'channel.message_inbox') as RetentionTargetSpec;
  const inboxNext = buildRetentionScanSql(inboxTarget, true);
  assert.match(inboxNext, /\(r\.retention_until_epoch_ms, r\.id\) > \(\$2::bigint, \$3::bigint\)/u);

  const bindingTarget = RETENTION_CLEANUP_TARGETS.find((t) => t.table === 'intake.web_request_binding') as RetentionTargetSpec;
  const bindingNext = buildRetentionScanSql(bindingTarget, true);
  assert.match(bindingNext, /\(r\.retention_until_epoch_ms, r\.intake_id\) > \(\$2::bigint, \$3::uuid\)/u);
});

test('retention cleaner enforces immutable 11-table catalog and rejects tampered/unknown/proxy targets', async () => {
  const { pool, queries } = makeFakePool(() => []);
  const canonical = RETENTION_CLEANUP_TARGETS.find((item) => item.table === 'intake.service_intake');
  assert.ok(canonical);

  assert.equal(resolveCanonicalRetentionTarget('intake.service_intake'), canonical);
  const byNameSql = buildRetentionScanSql('intake.service_intake', false);
  assert.equal(byNameSql.includes('FROM intake.service_intake AS r'), true);

  assert.throws(
    () => resolveCanonicalRetentionTarget('pilot_ticket.ticket'),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );
  assert.throws(
    () => resolveCanonicalRetentionTarget({ ...canonical, name: 'ticket' }),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );
  assert.throws(
    () => resolveCanonicalRetentionTarget({ ...canonical, indexName: 'evil_idx' }),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );
  assert.throws(
    () => resolveCanonicalRetentionTarget({ ...canonical, cursorMode: 'bigint_id' }),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );
  assert.throws(
    () => resolveCanonicalRetentionTarget(new Proxy(canonical, {})),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );

  await assert.rejects(
    () => scanRetentionTable({
      client: pool,
      target: { ...canonical, table: 'pilot_ticket.ticket', schema: 'pilot_ticket', name: 'ticket' },
      nowEpochMs: '5000',
    }),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );
  await assert.rejects(
    () => runRetentionCleanupDryRun({
      pool,
      nowEpochMs: '5000',
      targets: ['intake.service_intake', 'intake.service_intake'],
    }),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );
  assert.equal(queries.length, 0);
});

test('runRetentionCleanupDryRun executes inside READ ONLY transaction when pool.connect is available', async () => {
  const clientQueries: string[] = [];
  let released = 0;
  let shouldFailSelect = false;

  const pool = {
    async query<R extends Record<string, unknown>>(_sql: string, _values: unknown[] = []) {
      throw new Error('pool.query should not be used when pool.connect is available');
    },
    async connect() {
      return {
        async query<R extends Record<string, unknown>>(sql: string, _values: unknown[] = []) {
          clientQueries.push(sql);
          if (shouldFailSelect && sql.startsWith('SELECT')) {
            throw new Error('READ_FAIL');
          }
          return {
            command: sql.split(' ')[0] ?? 'SELECT',
            rowCount: 0,
            oid: 0,
            fields: [],
            rows: [] as R[],
          };
        },
        release() {
          released += 1;
        },
      };
    },
  };

  const report = await runRetentionCleanupDryRun({
    pool,
    nowEpochMs: '5000',
    targets: ['intake.service_intake'],
  });
  assert.equal(report.tables.length, 1);
  assert.equal(clientQueries[0], 'BEGIN TRANSACTION READ ONLY');
  assert.equal(clientQueries[1]?.startsWith('SELECT r.retention_until_epoch_ms::text'), true);
  assert.equal(clientQueries[2], 'COMMIT');
  assert.equal(released, 1);

  clientQueries.length = 0;
  shouldFailSelect = true;
  await assert.rejects(
    () => runRetentionCleanupDryRun({
      pool,
      nowEpochMs: '5000',
      targets: ['intake.service_intake'],
    }),
    { code: RETENTION_CLEANUP_ERROR_CODES.storageFailed },
  );
  assert.equal(clientQueries[0], 'BEGIN TRANSACTION READ ONLY');
  assert.equal(clientQueries.at(-1), 'ROLLBACK');
  assert.equal(released, 2);
});

test('dry-run never deletes and apply mode fails closed with RETENTION_CLEANUP_POLICY_UNDECIDED', async () => {
  const { pool, queries } = makeFakePool(() => [
    {
      retention_until_epoch_ms: '1234',
      cursor_a: '00000000-0000-7000-8000-000000000001',
      cursor_b: '1',
    },
  ]);

  await assert.rejects(
    () => runRetentionCleanupDryRun({
      pool,
      nowEpochMs: '5000',
      mode: 'apply',
    }),
    { code: RETENTION_CLEANUP_ERROR_CODES.policyUndecided },
  );
  assert.equal(queries.length, 0);

  const report = await runRetentionCleanupDryRun({
    pool,
    nowEpochMs: '5000',
    batchSize: 10,
  });
  assert.equal(report.mode, 'DRY_RUN');
  assert.equal(report.policy_id, UNDECIDED_RETENTION_POLICY.policyId);
  assert.equal(report.write_performed, false);
  assert.equal(report.tables.length, 11);
  assert.equal(report.total_candidates, 11);
  for (const query of queries) {
    assert.equal(/DELETE|UPDATE|INSERT|TRUNCATE/iu.test(query.sql), false);
  }
});

test('retention worker is disabled by default, serializes in-flight runs when enabled, and stops after close', async () => {
  const { pool, queries } = makeFakePool(() => []);

  const disabledWorker = createRetentionCleanupWorker({ pool });
  assert.equal(disabledWorker.enabled, false);
  assert.equal(disabledWorker.batch_size, 1000);
  const disabledResult = await disabledWorker.runOnce();
  assert.deepEqual(disabledResult, {
    enabled: false,
    skipped: true,
    mode: 'DRY_RUN',
    policy_id: 'ADR_0060_UNDECIDED',
    total_candidates: 0,
    write_performed: false,
    tables: [],
  });
  assert.equal(queries.length, 0);

  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let gatedCalls = 0;
  const gatedPool = {
    async query<R extends Record<string, unknown>>(_sql: string, _values: unknown[] = []) {
      gatedCalls += 1;
      await gate;
      return {
        command: 'SELECT',
        rowCount: 0,
        oid: 0,
        fields: [],
        rows: [] as R[],
      };
    },
  };
  const enabledWorker = createRetentionCleanupWorker({
    pool: gatedPool,
    enabled: true,
    batchSize: 50,
    now: () => '9000',
    targets: [RETENTION_CLEANUP_TARGETS[0] as RetentionTargetSpec],
  });
  const firstRun = enabledWorker.runOnce();
  const overlappingRun = enabledWorker.runOnce();
  assert.equal(firstRun, overlappingRun);
  releaseGate();
  const completed = await firstRun;
  assert.equal(gatedCalls, 1);
  assert.equal(completed.skipped, false);
  assert.equal(completed.write_performed, false);

  await enabledWorker.close();
  const afterClose = await enabledWorker.runOnce();
  assert.equal(afterClose.skipped, true);
  assert.equal(gatedCalls, 1);
});

test('retention CLI refuses --apply and enforces batch size limit', async () => {
  assert.deepEqual(parseRetentionCleanupArgs([]), { mode: 'check' });
  assert.deepEqual(parseRetentionCleanupArgs(['--check']), { mode: 'check' });
  assert.deepEqual(parseRetentionCleanupArgs(['--apply']), { mode: 'apply' });
  assert.throws(() => parseRetentionCleanupArgs(['--invalid']), {
    code: RETENTION_CLEANUP_ERROR_CODES.invalidInput,
  });

  assert.equal(retentionBatchSizeFromEnvironment({}), 1000);
  assert.equal(retentionBatchSizeFromEnvironment({ RETENTION_CLEANUP_BATCH_SIZE: '250' }), 250);
  assert.throws(
    () => retentionBatchSizeFromEnvironment({ RETENTION_CLEANUP_BATCH_SIZE: '1001' }),
    { code: RETENTION_CLEANUP_ERROR_CODES.invalidInput },
  );

  await assert.rejects(
    () => runRetentionCleanupCli({ argv: ['--apply'], env: { PILOT_DATABASE_URL: 'postgres://localhost/test' } }),
    { code: RETENTION_CLEANUP_ERROR_CODES.policyUndecided },
  );
});
