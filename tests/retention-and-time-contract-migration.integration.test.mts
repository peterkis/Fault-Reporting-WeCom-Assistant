import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withP2016IsolatedDatabase } from './helpers/p2-016-postgres-harness.mjs';
import { applyFullSchemaThrough074 } from './helpers/full-schema-migrations.mjs';
import {
  RETENTION_INDEX_TARGETS,
  RETENTION_TIME_CONTRACT_MIGRATION_ID,
  migrateRetentionTimeContract,
  retentionTimeContractSchemaReady,
} from '../app/server/scripts/retention-and-time-contract-migrate.mjs';
import {
  RETENTION_CLEANUP_TARGETS,
  buildRetentionScanSql,
  runRetentionCleanupDryRun,
} from '../app/server/src/retention-cleanup-skeleton.mjs';

type Pool = import('../app/server/src/platform/postgres-pool.mjs').PostgresPool;

test('077 retention & time contract: inlines local_now safely, paginates PG18 rows across width boundaries, detects drift/occupied names, and rolls back cleanly', { timeout: 240_000 }, t =>
  withP2016IsolatedDatabase({
    databaseUrl: process.env.PILOT_DATABASE_URL,
    purpose: 'ret077',
    run: async ({ pool, databaseUrl }: { pool: Pool; databaseUrl: string }) => {
      await applyFullSchemaThrough074(databaseUrl);

      const preProc = (await pool.query<{ proconfig: string[] | null; provolatile: string }>(
        `SELECT proconfig, provolatile
           FROM pg_proc
          WHERE oid = 'platform.local_now()'::regprocedure`,
      )).rows[0];
      assert.deepEqual(preProc?.proconfig, ['search_path=pg_catalog, platform']);
      assert.equal(preProc?.provolatile, 's');

      const preLegacyIdx = (await pool.query<{ exists: boolean }>(
        "SELECT to_regclass('conversation.conversation_realtime_event_expiry_event_idx') IS NOT NULL AS exists",
      )).rows[0];
      assert.equal(preLegacyIdx?.exists, true);

      assert.deepEqual(await migrateRetentionTimeContract({ databaseUrl, mode: 'check' }), {
        status: 'PENDING',
        migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID,
      });
      assert.equal(await retentionTimeContractSchemaReady(pool), false);

      const readPredecessors = async () => (await pool.query<{
        legacy_oid:string|null; legacy_definition:string|null; function_definition:string; marker_count:number; owned_index:string|null;
      }>(`SELECT to_regclass('conversation.conversation_realtime_event_expiry_event_idx')::oid::text AS legacy_oid,
          pg_get_indexdef(to_regclass('conversation.conversation_realtime_event_expiry_event_idx')) AS legacy_definition,
          pg_get_functiondef('platform.local_now()'::regprocedure) AS function_definition,
          (SELECT count(*)::int FROM platform.schema_migration WHERE migration_id=$1) AS marker_count,
          to_regclass('intake.service_intake_retention_epoch_idx')::text AS owned_index`,[RETENTION_TIME_CONTRACT_MIGRATION_ID])).rows[0];
      const original=await readPredecessors();
      assert.ok(original?.legacy_definition);
      async function expectRefusal(message:RegExp){
        const drifted=await readPredecessors();
        assert.ok(drifted);
        assert.equal(drifted.marker_count,0);
        assert.equal(drifted.owned_index,null);
        await assert.rejects(migrateRetentionTimeContract({databaseUrl,mode:'apply'}),message);
        assert.deepEqual(await readPredecessors(),drifted);
      }
      await pool.query('DROP INDEX conversation.conversation_realtime_event_expiry_event_idx');
      await expectRefusal(/PREDECESSOR_DRIFT:conversation\.conversation_realtime_event_expiry_event_idx/u);
      await pool.query('CREATE INDEX conversation_realtime_event_expiry_event_idx ON conversation.item (session_id)');
      await expectRefusal(/PREDECESSOR_DRIFT:conversation\.conversation_realtime_event_expiry_event_idx/u);
      await pool.query('DROP INDEX conversation.conversation_realtime_event_expiry_event_idx');
      await pool.query('CREATE INDEX conversation_realtime_event_expiry_event_idx ON conversation.realtime_event (event_id, expires_at)');
      await expectRefusal(/PREDECESSOR_DRIFT:conversation\.conversation_realtime_event_expiry_event_idx/u);
      await pool.query('DROP INDEX conversation.conversation_realtime_event_expiry_event_idx');
      await pool.query(original.legacy_definition);
      await pool.query('ALTER FUNCTION platform.local_now() SET search_path = pg_catalog');
      await expectRefusal(/PREDECESSOR_DRIFT:platform\.local_now/u);
      await pool.query(original.function_definition.replace('Asia/Shanghai','UTC'));
      await expectRefusal(/PREDECESSOR_DRIFT:platform\.local_now/u);
      await pool.query(original.function_definition);

      assert.deepEqual(await migrateRetentionTimeContract({ databaseUrl, mode: 'apply' }), {
        status: 'APPLIED',
        migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID,
      });
      assert.deepEqual(await migrateRetentionTimeContract({ databaseUrl, mode: 'apply' }), {
        status: 'NOOP_ALREADY_APPLIED',
        migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID,
      });
      assert.equal(await retentionTimeContractSchemaReady(pool), true);

      // 42C-3: local_now() has proconfig IS NULL, same STABLE/SECURITY INVOKER semantics, works under empty search_path, and inlines in EXPLAIN.
      const postProc = (await pool.query<{ proconfig: string[] | null; provolatile: string; prosecdef: boolean; ddl: string }>(
        `SELECT proconfig, provolatile, prosecdef, pg_get_functiondef(oid) AS ddl
           FROM pg_proc
          WHERE oid = 'platform.local_now()'::regprocedure`,
      )).rows[0];
      assert.ok(postProc);
      assert.equal(postProc.proconfig, null);
      assert.equal(postProc?.provolatile, 's');
      assert.equal(postProc?.prosecdef, false);

      const epochProc = (await pool.query<{ provolatile: string }>(
        `SELECT provolatile FROM pg_proc WHERE oid = 'platform.physical_epoch_ms()'::regprocedure`,
      )).rows[0];
      assert.equal(epochProc?.provolatile, 'v');

      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        await tx.query("SET LOCAL search_path = ''");
        const cmp = (await tx.query<{ a: string; b: string }>(
          `SELECT platform.local_now()::text AS a,
                  pg_catalog.date_trunc('second', pg_catalog.timezone('Asia/Shanghai', pg_catalog.transaction_timestamp()))::timestamp without time zone::text AS b`,
        )).rows[0];
        assert.equal(cmp?.a, cmp?.b);
        const explainRows = (await tx.query<{ 'QUERY PLAN': string }>(
          'EXPLAIN (VERBOSE) SELECT platform.local_now()',
        )).rows;
        const planText = explainRows.map((row) => row['QUERY PLAN']).join('\n');
        assert.equal(planText.includes('local_now'), false, 'Expected PostgreSQL to inline platform.local_now()');
        assert.match(planText, /date_trunc/u);
        t.diagnostic('077 local_now PG18 plan\n'+planText);
        await tx.query('COMMIT');
      } finally {
        tx.release();
      }

      // 42C-4: legacy expires_at index dropped; ARCH-005 expires_epoch_ms index kept.
      const idxState = (await pool.query<{ legacy_exists: boolean; epoch_exists: boolean }>(
        `SELECT
           (to_regclass('conversation.conversation_realtime_event_expiry_event_idx') IS NOT NULL) AS legacy_exists,
           (to_regclass('conversation.conversation_realtime_expiry_epoch_idx') IS NOT NULL) AS epoch_exists`,
      )).rows[0];
      assert.equal(idxState?.legacy_exists, false);
      assert.equal(idxState?.epoch_exists, true);

      // 42C-2: all 9 retention indexes exist and dry-run scans cleanly across all 11 tables.
      const retIdxCount = (await pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM pg_index AS idx
           JOIN pg_class AS cls ON cls.oid = idx.indexrelid
           JOIN pg_namespace AS nsp ON nsp.oid = cls.relnamespace
          WHERE (nsp.nspname || '.' || cls.relname) = ANY($1::text[])
            AND idx.indisvalid
            AND idx.indisready`,
        [RETENTION_INDEX_TARGETS.map((entry) => `${entry.schema}.${entry.name}`)],
      )).rows[0];
      assert.equal(retIdxCount?.count, 9);

      const emptyDryRun = await runRetentionCleanupDryRun({
        pool,
        nowEpochMs: '9999999999999',
        batchSize: 100,
      });
      assert.equal(emptyDryRun.mode, 'DRY_RUN');
      assert.equal(emptyDryRun.write_performed, false);
      assert.equal(emptyDryRun.tables.length, 11);
      assert.equal(emptyDryRun.total_candidates, 0);

      // High 2 PG18 fixture-backed pagination across width boundaries (9000, 9000, 10000, 10000, 100000 + future row).
      t.diagnostic('（合成）42C pagination and ordered retention scans');
      const epochs = ['9000', '9000', '10000', '10000', '100000', '9999999999000'] as const;
      const backupIds = epochs.map((_e, i) => `00000000-0000-7000-8000-00000000000${i + 1}`);
      for (let i = 0; i < epochs.length; i += 1) {
        const epoch = epochs[i] as string;
        await pool.query(
          `INSERT INTO operations.backup_checkpoint (
             id, backup_id, checksum_sha256, size_bytes, encryption_key_id,
             retention_until, retention_until_epoch_ms, created_at
           ) VALUES (
             $1::uuid, $2, $3, 1024, 'key-card42c',
             platform.local_from_epoch_ms($4::bigint), $4::bigint, platform.local_from_epoch_ms(1000)
           )`,
          [backupIds[i], `backup-card42c-0${i + 1}`, '0'.repeat(64), epoch],
        );
      }

      const inboxIds: string[] = [];
      for (let i = 0; i < epochs.length; i += 1) {
        const epoch = epochs[i] as string;
        const inserted = (await pool.query<{ id: string }>(
          `INSERT INTO channel.message_inbox (
             schema_version, provider, msg_id, idempotency_key, req_id, bot_id,
             chat_type, sender_user_id, msg_type, received_at, received_epoch_ms,
             normalized_message, processing_status, privacy_class, trace_id,
             retention_until, retention_until_epoch_ms, created_at
           ) VALUES (
             1, 'card42c', $1, $2, $3, 'bot-1',
             'single', 'user-1', 'text', platform.local_from_epoch_ms(1000), 1000,
             '{}'::jsonb, 'PROCESSING', 'INTERNAL', $4,
             platform.local_from_epoch_ms($5::bigint), $5::bigint, platform.local_from_epoch_ms(1000)
           )
           RETURNING id::text AS id`,
          [`msg-${i + 1}`, `card42c:msg-${i + 1}`, `req-${i + 1}`, `trace-${i + 1}`, epoch],
        )).rows[0];
        assert.ok(inserted);
        inboxIds.push(inserted.id);
      }

      const paginated = await runRetentionCleanupDryRun({
        pool,
        nowEpochMs: '500000',
        batchSize: 2,
        targets: ['operations.backup_checkpoint', 'channel.message_inbox'],
      });
      assert.equal(paginated.write_performed, false);
      assert.equal(paginated.total_candidates, 10);

      const backupSummary = paginated.tables.find((t) => t.table === 'operations.backup_checkpoint');
      assert.ok(backupSummary);
      assert.equal(backupSummary.batches_scanned, 3);
      assert.equal(backupSummary.candidate_count, 5);
      assert.equal(backupSummary.exhausted, true);
      assert.deepEqual(backupSummary.sample_first_key, {
        retention_until_epoch_ms: '9000',
        cursor_key: backupIds[0],
      });
      assert.deepEqual(backupSummary.sample_last_key, {
        retention_until_epoch_ms: '100000',
        cursor_key: backupIds[4],
      });

      const inboxSummary = paginated.tables.find((t) => t.table === 'channel.message_inbox');
      assert.ok(inboxSummary);
      assert.equal(inboxSummary.batches_scanned, 3);
      assert.equal(inboxSummary.candidate_count, 5);
      assert.equal(inboxSummary.exhausted, true);
      assert.deepEqual(inboxSummary.sample_first_key, {
        retention_until_epoch_ms: '9000',
        cursor_key: inboxIds[0],
      });
      assert.deepEqual(inboxSummary.sample_last_key, {
        retention_until_epoch_ms: '100000',
        cursor_key: inboxIds[4],
      });

      const backupTarget = RETENTION_CLEANUP_TARGETS.find((t) => t.table === 'operations.backup_checkpoint');
      assert.ok(backupTarget);
      const explainFirst = (await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${buildRetentionScanSql(backupTarget, false)}`,
        ['500000', 2],
      )).rows.map((r) => r['QUERY PLAN']).join('\n');
      const explainNext = (await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${buildRetentionScanSql(backupTarget, true)}`,
        ['500000', '9000', backupIds[1], 2],
      )).rows.map((r) => r['QUERY PLAN']).join('\n');
      assert.match(explainFirst, /Execution Time/u);
      assert.match(explainNext, /Execution Time/u);

      // Zero mutations from dry-run: all 6 inserted rows remain in each table.
      assert.equal(
        (await pool.query<{ count: number }>('SELECT count(*)::integer AS count FROM operations.backup_checkpoint')).rows[0]?.count,
        6,
      );
      assert.equal(
        (await pool.query<{ count: number }>('SELECT count(*)::integer AS count FROM channel.message_inbox')).rows[0]?.count,
        6,
      );

      // Enough distinct keys for a selective ordered LIMIT without planner overrides.
      await pool.query(`INSERT INTO operations.backup_checkpoint
        (backup_id,checksum_sha256,size_bytes,encryption_key_id,retention_until,retention_until_epoch_ms,created_at)
        SELECT 'backup-card42c-plan-'||n,repeat('0',64),1024,'key-card42c',
               platform.local_from_epoch_ms(n::bigint*1000),n::bigint*1000,platform.local_from_epoch_ms(0)
          FROM generate_series(1,20000) AS g(n)`);
      await pool.query('ANALYZE operations.backup_checkpoint');
      for(const continuation of [false,true]){
        const params=continuation?['12000000','8000000',backupIds[1],32]:['12000000',32];
        const plan=(await pool.query<{'QUERY PLAN':string}>(
          'EXPLAIN (ANALYZE, BUFFERS) '+buildRetentionScanSql(backupTarget,continuation),params,
        )).rows.map(row=>row['QUERY PLAN']).join('\n');
        t.diagnostic('（合成）077 retention '+(continuation?'continuation':'first page')+' PG18 plan\n'+plan);
        assert.match(plan,/Index (?:Only )?Scan using operations_backup_retention_epoch_id_idx/u);
        assert.doesNotMatch(plan,/\bSort\b/u);
      }

      for(const [indexName,table,keys] of [
        ['operations.operations_backup_retention_epoch_id_idx','operations.backup_checkpoint','retention_until_epoch_ms, id DESC'],
        ['channel.channel_message_inbox_retention_epoch_idx','channel.message_inbox','retention_until_epoch_ms, id DESC'],
        ['conversation.conversation_item_retention_epoch_idx','conversation.item','retention_until_epoch_ms, session_id, sequence_no DESC'],
      ]){
        assert.ok(indexName&&table&&keys);
        const definition=(await pool.query<{ddl:string}>('SELECT pg_get_indexdef($1::regclass) AS ddl',[indexName])).rows[0]?.ddl;
        assert.ok(definition);
        await pool.query('DROP INDEX '+indexName);
        await pool.query('CREATE INDEX '+indexName.split('.')[1]+' ON '+table+' ('+keys+')');
        assert.equal(await retentionTimeContractSchemaReady(pool),false,indexName);
        await assert.rejects(migrateRetentionTimeContract({databaseUrl,mode:'rollback'}),/RETENTION_TIME_CONTRACT_SCHEMA_DRIFT/u);
        await pool.query('DROP INDEX '+indexName);
        await pool.query(definition);
        assert.equal(await retentionTimeContractSchemaReady(pool),true);
      }

      // Med 2 / Med 3 drift detection: altered index shape, altered local_now tz/precision, recreated legacy index.
      await pool.query('DROP INDEX operations.operations_backup_retention_epoch_id_idx');
      await pool.query(
        'CREATE INDEX operations_backup_retention_epoch_id_idx ON operations.backup_checkpoint (retention_until_epoch_ms, id) WHERE retention_until_epoch_ms > 0',
      );
      assert.equal(await retentionTimeContractSchemaReady(pool), false);
      await assert.rejects(() => migrateRetentionTimeContract({ databaseUrl, mode: 'check' }), /RETENTION_TIME_CONTRACT_SCHEMA_DRIFT/u);
      await pool.query('DROP INDEX operations.operations_backup_retention_epoch_id_idx');
      await pool.query(
        'CREATE INDEX operations_backup_retention_epoch_id_idx ON operations.backup_checkpoint (retention_until_epoch_ms, id)',
      );
      assert.equal(await retentionTimeContractSchemaReady(pool), true);

      await pool.query(`
        CREATE OR REPLACE FUNCTION platform.local_now()
        RETURNS timestamp without time zone
        LANGUAGE sql
        STABLE
        AS $$ SELECT pg_catalog.date_trunc('second', pg_catalog.timezone('UTC', pg_catalog.transaction_timestamp()))::timestamp without time zone $$;
      `);
      assert.equal(await retentionTimeContractSchemaReady(pool), false);
      await assert.rejects(() => migrateRetentionTimeContract({ databaseUrl, mode: 'apply' }), /RETENTION_TIME_CONTRACT_SCHEMA_DRIFT/u);

      await pool.query(`
        CREATE OR REPLACE FUNCTION platform.local_now()
        RETURNS timestamp without time zone
        LANGUAGE sql
        STABLE
        AS $$ SELECT pg_catalog.date_trunc('day', pg_catalog.timezone('Asia/Shanghai', pg_catalog.transaction_timestamp()))::timestamp without time zone $$;
      `);
      assert.equal(await retentionTimeContractSchemaReady(pool), false);

      // Recreated legacy index also fails readiness.
      await pool.query(postProc.ddl);
      assert.equal(await retentionTimeContractSchemaReady(pool), true);
      await pool.query(
        'CREATE INDEX conversation_realtime_event_expiry_event_idx ON conversation.realtime_event (expires_at, event_id)',
      );
      assert.equal(await retentionTimeContractSchemaReady(pool), false);
      await assert.rejects(() => migrateRetentionTimeContract({ databaseUrl, mode: 'rollback' }), /RETENTION_TIME_CONTRACT_SCHEMA_DRIFT/u);
      await pool.query('DROP INDEX conversation.conversation_realtime_event_expiry_event_idx');
      assert.equal(await retentionTimeContractSchemaReady(pool), true);

      // Rollback restores pre-077 local_now() and legacy index cleanly.
      assert.deepEqual(await migrateRetentionTimeContract({ databaseUrl, mode: 'rollback' }), {
        status: 'ROLLED_BACK',
        migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID,
      });
      assert.equal(await retentionTimeContractSchemaReady(pool), false);
      assert.deepEqual(await migrateRetentionTimeContract({ databaseUrl, mode: 'rollback' }), {
        status: 'NOT_APPLIED',
        migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID,
      });

      const restoredProc = (await pool.query<{ proconfig: string[] | null }>(
        `SELECT proconfig FROM pg_proc WHERE oid = 'platform.local_now()'::regprocedure`,
      )).rows[0];
      assert.deepEqual(restoredProc?.proconfig, ['search_path=pg_catalog, platform']);

      const restoredIdx = (await pool.query<{ legacy_exists: boolean }>(
        "SELECT to_regclass('conversation.conversation_realtime_event_expiry_event_idx') IS NOT NULL AS legacy_exists",
      )).rows[0];
      assert.equal(restoredIdx?.legacy_exists, true);

      // Med 2: pre-existing same-name occupied target index refuses apply and survives untouched.
      await pool.query(
        'CREATE INDEX operations_backup_retention_epoch_id_idx ON operations.backup_checkpoint (retention_until_epoch_ms, id)',
      );
      await assert.rejects(
        () => migrateRetentionTimeContract({ databaseUrl, mode: 'apply' }),
        /RETENTION_TIME_CONTRACT_TARGET_NAME_OCCUPIED/u,
      );
      assert.equal(await retentionTimeContractSchemaReady(pool), false);
      await pool.query('DROP INDEX operations.operations_backup_retention_epoch_id_idx');

      // Re-apply cleanly.
      assert.deepEqual(await migrateRetentionTimeContract({ databaseUrl, mode: 'apply' }), {
        status: 'APPLIED',
        migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID,
      });
      assert.equal(await retentionTimeContractSchemaReady(pool), true);
      assert.deepEqual(await migrateRetentionTimeContract({ databaseUrl, mode: 'apply' }), {
        status: 'NOOP_ALREADY_APPLIED',
        migration_id: RETENTION_TIME_CONTRACT_MIGRATION_ID,
      });
    },
  }),
);

test('077 prerequisite guard rejects missing baseline migrations cleanly', { timeout: 60_000 }, () =>
  withP2016IsolatedDatabase({
    databaseUrl: process.env.PILOT_DATABASE_URL,
    purpose: 'ret077prereq',
    run: async ({ databaseUrl }: { databaseUrl: string }) => {
      await assert.rejects(
        () => migrateRetentionTimeContract({ databaseUrl, mode: 'apply' }),
        { message: 'RETENTION_TIME_CONTRACT_PREREQUISITE_MISSING:platform.schema_migration' },
      );
    },
  }),
);
