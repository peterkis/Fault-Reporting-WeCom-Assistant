import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { migrateRetentionTimeContract, RETENTION_TIME_CONTRACT_MIGRATION_ID } from '../app/server/scripts/retention-and-time-contract-migrate.mjs';
import { withP2016IsolatedDatabase } from './helpers/p2-016-postgres-harness.mjs';
import { applyFullSchemaThrough074 } from './helpers/full-schema-migrations.mjs';
import { migrateCurrentBaselineWithYxx } from '../app/server/scripts/migrate-current-baseline.mjs';
import { followSchemaReady } from '../app/server/scripts/workbench-follow-migrate.mjs';
import { supplementFollowUpSchemaReady } from '../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import {
  FK_INDEXES_MIGRATION_ID,
  FK_INDEX_TARGETS,
  fkIndexesSchemaReady,
  migrateFkIndexes,
  predecessorIndexRows,
} from '../app/server/scripts/fk-indexes-migrate.mjs';
import {
  FK_AUDIT_SQL,
  runForeignKeyIndexAudit,
  type ForeignKeyRow,
} from '../app/server/scripts/fk-index-audit.mjs';

type Pool = import('../app/server/src/platform/postgres-pool.mjs').PostgresPool;

test('076 fk indexes: check/apply/noop/rollback/reapply works without 075, catches drift/occupied names, and eliminates all 补 FKs', { timeout: 240_000 }, t =>
  withP2016IsolatedDatabase({
    databaseUrl: process.env.PILOT_DATABASE_URL,
    purpose: 'fkidx076',
    run: async ({ pool, databaseUrl }: { pool: Pool; databaseUrl: string }) => {
      await applyFullSchemaThrough074(databaseUrl);

      const beforeAudit = await runForeignKeyIndexAudit({ pool });
      t.diagnostic('076 pre-apply PG18 audit '+JSON.stringify(beforeAudit.summary));
      assert.equal(beforeAudit.summary.total, beforeAudit.summary.supported + beforeAudit.summary.missing);
      assert.equal(beforeAudit.summary.missing, beforeAudit.summary.add_count + beforeAudit.summary.skip_count);
      assert.equal(beforeAudit.summary.distinct_indexes_proposed, FK_INDEX_TARGETS.length);
      assert.ok(beforeAudit.summary.add_count >= FK_INDEX_TARGETS.length);

      const addItems = beforeAudit.items.filter((item) => item.decision === '补');
      assert.equal(addItems.every((item) => item.proposed_index_name !== null), true);
      const proposedFullNames = new Set(
        addItems.map((item) => `${item.schema_table.split('.')[0] ?? ''}.${item.proposed_index_name}`),
      );
      for (const target of FK_INDEX_TARGETS) {
        assert.ok(
          proposedFullNames.has(`${target.schema}.${target.name}`),
          `Expected beforeAudit 补 items to propose ${target.schema}.${target.name}`,
        );
      }

      for(const [relation,column] of [
        ['communication.incident_notification_binding','communication_message_id'],
        ['communication.incident_notification_binding','incident_event_id'],
        ['communication.incident_notification_binding','incident_id'],
        ['incident.reporter_subscription','incident_id'],
      ]){
        const fk=beforeAudit.items.find(item=>item.schema_table===relation&&item.columns.join(',')===column);
        assert.equal(fk?.hot_join,true);
        assert.equal(fk.decision,'已有');
      }
      const incidentActorBefore = beforeAudit.items.find(
        (item) => item.schema_table === 'incident.incident_event' && item.columns.join(',') === 'actor_principal_id',
      );
      const incidentTicketBefore = beforeAudit.items.find(
        (item) => item.schema_table === 'incident.incident_report' && item.columns.join(',') === 'ticket_id',
      );
      assert.equal(incidentActorBefore?.decision, '补');
      assert.equal(incidentTicketBefore?.decision, '补');

      assert.deepEqual(await migrateFkIndexes({ databaseUrl, mode: 'check' }), {
        status: 'PENDING',
        migration_id: FK_INDEXES_MIGRATION_ID,
      });
      assert.equal(await fkIndexesSchemaReady(pool), false);

      assert.deepEqual(await migrateFkIndexes({ databaseUrl, mode: 'apply' }), {
        status: 'APPLIED',
        migration_id: FK_INDEXES_MIGRATION_ID,
      });
      assert.deepEqual(await migrateFkIndexes({ databaseUrl, mode: 'apply' }), {
        status: 'NOOP_ALREADY_APPLIED',
        migration_id: FK_INDEXES_MIGRATION_ID,
      });
      assert.equal(await fkIndexesSchemaReady(pool), true);

      // 044 and 062 still verify the exact original catalogs plus the registered 076 indexes.
      assert.equal(await followSchemaReady(pool), true);
      assert.equal(await supplementFollowUpSchemaReady(pool), true);
      const tx = await pool.connect();
      try {
        for (const [ddl, ready] of [
          ['DROP INDEX pilot_ticket.workbench_item_follow_source_intake_fk_idx; CREATE INDEX workbench_item_follow_source_intake_fk_idx ON pilot_ticket.workbench_item_follow (row_version)', followSchemaReady],
          ['DROP INDEX pilot_ticket.ticket_command_receipt_closure_intake_fk_idx', followSchemaReady],
          ['CREATE INDEX unexpected_follow_idx ON pilot_ticket.workbench_item_follow (row_version)', followSchemaReady],
          ['DROP INDEX pilot_ticket.workbench_supp_disp_actor_fk_idx', supplementFollowUpSchemaReady],
        ] as const) {
          await tx.query('BEGIN');
          await tx.query(ddl);
          assert.equal(await ready(tx), false, ddl);
          await tx.query('ROLLBACK');
        }
        // Capture a same-name wrong definition, then restore the correct index before checking its marker.
        // READ COMMITTED can produce this pair of observations across two catalog statements.
        for(const [table,name,column] of [
          ['ticket_command_receipt','ticket_command_receipt_source_intake_fk_idx','source_intake_id'],
          ['workbench_supplement_disposition','workbench_supp_disp_actor_fk_idx','actor_principal_id'],
        ] as const){
          await tx.query('BEGIN');
          await tx.query('DROP INDEX pilot_ticket.'+name);
          await tx.query('CREATE INDEX '+name+' ON pilot_ticket.'+table+' ('+column+' DESC)');
          const relation='pilot_ticket.'+table;
          const capture=async()=>(await tx.query(`SELECT $1::text AS relation,c.relname AS name,i.indisvalid AS valid,
            i.indisready AS ready,pg_get_indexdef(c.oid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
            WHERE i.indrelid=$1::regclass`,[relation])).rows;
          const changed=await capture();
          await tx.query('DROP INDEX pilot_ticket.'+name);
          await tx.query('CREATE INDEX '+name+' ON pilot_ticket.'+table+' ('+column+')');
          assert.equal(await predecessorIndexRows(tx,[relation],changed),null);
          assert.ok(await predecessorIndexRows(tx,[relation],await capture()));
          await tx.query('ROLLBACK');
        }
      } finally {
        await tx.query('ROLLBACK');
        tx.release();
      }

      const afterAudit = await runForeignKeyIndexAudit({ pool });
      t.diagnostic('076 post-apply PG18 audit '+JSON.stringify(afterAudit.summary));
      assert.equal(afterAudit.summary.total, beforeAudit.summary.total);
      assert.equal(afterAudit.summary.add_count, 0);
      assert.equal(afterAudit.summary.skip_count, beforeAudit.summary.skip_count);
      assert.equal(afterAudit.summary.missing, beforeAudit.summary.skip_count);
      assert.equal(afterAudit.summary.supported, beforeAudit.summary.supported + beforeAudit.summary.add_count);
      assert.equal(afterAudit.summary.distinct_076_indexes_created, FK_INDEX_TARGETS.length);

      await pool.query('CREATE INDEX aaa_reply_item_idx ON communication.message (reply_to_conversation_item_id)');
      const redundant = await runForeignKeyIndexAudit({ pool });
      assert.equal(redundant.items.find(item =>
        item.schema_table === 'communication.message' && item.columns.join(',') === 'reply_to_conversation_item_id'
      )?.supporting_index_name, 'aaa_reply_item_idx');
      assert.deepEqual(redundant.summary, afterAudit.summary);
      await pool.query('DROP INDEX communication.aaa_reply_item_idx');

      const created = await pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count
           FROM pg_index AS idx
           JOIN pg_class AS cls ON cls.oid = idx.indexrelid
           JOIN pg_namespace AS nsp ON nsp.oid = cls.relnamespace
          WHERE (nsp.nspname || '.' || cls.relname) = ANY($1::text[])
            AND idx.indisvalid
            AND idx.indisready`,
        [FK_INDEX_TARGETS.map((entry) => `${entry.schema}.${entry.name}`)],
      );
      assert.equal(created.rows[0]?.count, FK_INDEX_TARGETS.length);

      // Med 2: post-apply wrong-shape drift is caught by fkIndexesSchemaReady + check/apply.
      await pool.query('DROP INDEX incident.incident_event_actor_principal_fk_idx');
      await pool.query(
        'CREATE INDEX incident_event_actor_principal_fk_idx ON incident.incident_event (actor_principal_id) WHERE actor_principal_id IS NOT NULL',
      );
      assert.equal(await fkIndexesSchemaReady(pool), false);
      await assert.rejects(() => migrateFkIndexes({ databaseUrl, mode: 'check' }), /FK_INDEXES_SCHEMA_DRIFT/u);
      await assert.rejects(() => migrateFkIndexes({ databaseUrl, mode: 'apply' }), /FK_INDEXES_SCHEMA_DRIFT/u);
      await assert.rejects(() => migrateFkIndexes({ databaseUrl, mode: 'rollback' }), /FK_INDEXES_SCHEMA_DRIFT/u);
      await pool.query('DROP INDEX incident.incident_event_actor_principal_fk_idx');
      await pool.query('CREATE INDEX incident_event_actor_principal_fk_idx ON incident.incident_event (actor_principal_id)');
      assert.equal(await fkIndexesSchemaReady(pool), true);
      assert.deepEqual(await migrateFkIndexes({ databaseUrl, mode: 'rollback' }), {
        status: 'ROLLED_BACK',
        migration_id: FK_INDEXES_MIGRATION_ID,
      });
      assert.equal(await fkIndexesSchemaReady(pool), false);
      assert.deepEqual(await migrateFkIndexes({ databaseUrl, mode: 'rollback' }), {
        status: 'NOT_APPLIED',
        migration_id: FK_INDEXES_MIGRATION_ID,
      });

      const rolledBackAudit = await runForeignKeyIndexAudit({ pool });
      assert.equal(rolledBackAudit.summary.add_count, beforeAudit.summary.add_count);

      // Med 2: pre-existing same-name wrong-shape index refuses apply and survives untouched.
      await pool.query(
        'CREATE INDEX incident_event_actor_principal_fk_idx ON incident.incident_event (event_type)',
      );
      await assert.rejects(
        () => migrateFkIndexes({ databaseUrl, mode: 'apply' }),
        /FK_INDEXES_TARGET_NAME_OCCUPIED/u,
      );
      assert.equal(await fkIndexesSchemaReady(pool), false);
      assert.equal(
        (await pool.query<{ exists: boolean }>(
          "SELECT to_regclass('incident.incident_event_actor_principal_fk_idx') IS NOT NULL AS exists",
        )).rows[0]?.exists,
        true,
      );
      await pool.query('DROP INDEX incident.incident_event_actor_principal_fk_idx');

      // Med 2: pre-existing same-name right-shape index also refuses apply; rollback stays NOT_APPLIED and preserves it.
      await pool.query(
        'CREATE INDEX incident_event_actor_principal_fk_idx ON incident.incident_event (actor_principal_id)',
      );
      await assert.rejects(
        () => migrateFkIndexes({ databaseUrl, mode: 'apply' }),
        /FK_INDEXES_TARGET_NAME_OCCUPIED/u,
      );
      assert.deepEqual(await migrateFkIndexes({ databaseUrl, mode: 'rollback' }), {
        status: 'NOT_APPLIED',
        migration_id: FK_INDEXES_MIGRATION_ID,
      });
      assert.equal(
        (await pool.query<{ exists: boolean }>(
          "SELECT to_regclass('incident.incident_event_actor_principal_fk_idx') IS NOT NULL AS exists",
        )).rows[0]?.exists,
        true,
      );
      await pool.query('DROP INDEX incident.incident_event_actor_principal_fk_idx');

      assert.deepEqual(await migrateFkIndexes({ databaseUrl, mode: 'apply' }), {
        status: 'APPLIED',
        migration_id: FK_INDEXES_MIGRATION_ID,
      });
      assert.equal(await fkIndexesSchemaReady(pool), true);
    },
  }),
);

test('076 prerequisite guard & pg_index catalog shape rules handle all 7 index shapes accurately', { timeout: 120_000 }, () =>
  withP2016IsolatedDatabase({
    databaseUrl: process.env.PILOT_DATABASE_URL,
    purpose: 'fk076shape',
    run: async ({ pool, databaseUrl }: { pool: Pool; databaseUrl: string }) => {
      await assert.rejects(
        () => migrateFkIndexes({ databaseUrl, mode: 'apply' }),
        { message: 'FK_INDEXES_PREREQUISITE_MISSING:platform.schema_migration' },
      );
      await migrateCurrentBaselineWithYxx({ databaseUrl });
      await assert.rejects(
        () => migrateFkIndexes({ databaseUrl, mode: 'apply' }),
        /FK_INDEXES_PREREQUISITE_MISSING/u,
      );

      await pool.query('CREATE SCHEMA IF NOT EXISTS card42c_shape_probe');
      try {
        await pool.query(`
          CREATE TABLE card42c_shape_probe.parent (id BIGINT PRIMARY KEY);
          CREATE TABLE card42c_shape_probe.child (
            id BIGINT PRIMARY KEY,
            extra BIGINT NOT NULL,
            fk_exact BIGINT REFERENCES card42c_shape_probe.parent(id),
            fk_prefix BIGINT REFERENCES card42c_shape_probe.parent(id),
            fk_pos2 BIGINT REFERENCES card42c_shape_probe.parent(id),
            fk_include BIGINT REFERENCES card42c_shape_probe.parent(id),
            fk_hash BIGINT REFERENCES card42c_shape_probe.parent(id),
            fk_partial BIGINT REFERENCES card42c_shape_probe.parent(id),
            fk_expr BIGINT REFERENCES card42c_shape_probe.parent(id)
          );
          CREATE INDEX shape_exact_idx ON card42c_shape_probe.child (fk_exact);
          CREATE INDEX shape_prefix_idx ON card42c_shape_probe.child (fk_prefix, extra);
          CREATE INDEX shape_pos2_idx ON card42c_shape_probe.child (extra, fk_pos2);
          CREATE INDEX shape_include_idx ON card42c_shape_probe.child (extra) INCLUDE (fk_include);
          CREATE INDEX shape_hash_idx ON card42c_shape_probe.child USING hash (fk_hash);
          CREATE INDEX shape_partial_idx ON card42c_shape_probe.child (fk_partial) WHERE fk_partial IS NOT NULL;
          CREATE INDEX shape_expr_idx ON card42c_shape_probe.child ((fk_expr::text));
        `);

        const probeRows = (await pool.query<ForeignKeyRow>(FK_AUDIT_SQL)).rows
          .filter((row) => row.schema_table === 'card42c_shape_probe.child');
        const byCol = new Map(probeRows.map((row) => [row.columns.join(','), row]));

        assert.equal(byCol.get('fk_exact')?.supporting_index_name, 'shape_exact_idx');
        assert.equal(byCol.get('fk_prefix')?.supporting_index_name, 'shape_prefix_idx');
        assert.equal(byCol.get('fk_pos2')?.supporting_index_name, null);
        assert.equal(byCol.get('fk_include')?.supporting_index_name, null);
        assert.equal(byCol.get('fk_hash')?.supporting_index_name, null);
        assert.equal(byCol.get('fk_partial')?.supporting_index_name, null);
        assert.equal(byCol.get('fk_partial')?.partial_only_index_name, 'shape_partial_idx');
        assert.equal(byCol.get('fk_expr')?.supporting_index_name, null);
      } finally {
        await pool.query('DROP SCHEMA IF EXISTS card42c_shape_probe CASCADE');
      }
    },
  }),
);

test('076 and 077 first apply roll back when another session creates a target after preflight', {timeout:120_000}, () =>
  withP2016IsolatedDatabase({
    databaseUrl: process.env.PILOT_DATABASE_URL, purpose: 'lateindex',
    run: async ({pool, databaseUrl}: {pool: Pool; databaseUrl: string}) => {
      await applyFullSchemaThrough074(databaseUrl);
      for (const [id, migrate, migrator, blockTable, firstIndex, lateTable, lateName, columns] of [
        [FK_INDEXES_MIGRATION_ID, migrateFkIndexes, 'fk_indexes_migrator', 'conversation.assignment',
          'communication.communication_message_reply_item_fk_idx', 'incident.incident_event', 'incident_event_actor_principal_fk_idx', 'actor_principal_id'],
        [RETENTION_TIME_CONTRACT_MIGRATION_ID, migrateRetentionTimeContract, 'retention_time_contract_migrator', 'communication.message',
          'intake.service_intake_retention_epoch_idx', 'intake.contact_journey', 'contact_journey_retention_epoch_idx', 'retention_until_epoch_ms, id'],
      ] as const) {
        const blocker = await pool.connect();
        const lateIndex = lateTable.split('.')[0] + '.' + lateName;
        const oid = async (name: string) => (await pool.query<{oid: number | null}>(
          'SELECT to_regclass($1)::oid AS oid', [name],
        )).rows[0]?.oid;
        let applying: Promise<unknown> | undefined;
        let foreignOid: number;
        try {
          await blocker.query('BEGIN');
          await blocker.query('LOCK TABLE ' + blockTable + ' IN ROW EXCLUSIVE MODE');
          applying = migrate({databaseUrl, mode:'apply'}).then(result => result, (error: unknown) => error);
          // The second table's CREATE INDEX requests ShareLock only after preflight and the first CREATE.
          const deadline = Date.now() + 10_000;
          while (!(await pool.query(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING (pid)
            WHERE l.relation=$1::regclass AND l.mode='ShareLock' AND NOT l.granted
              AND a.datname=current_database() AND a.application_name=$2`, [blockTable, migrator])).rowCount) {
            assert.ok(Date.now() < deadline, id + ': migrator never reached the second CREATE');
            await delay(10);
          }
          await blocker.query('CREATE INDEX ' + lateName + ' ON ' + lateTable + ' (' + columns + ')');
          const row = (await blocker.query<{oid: number}>('SELECT $1::regclass::oid AS oid', [lateIndex])).rows[0];
          assert.ok(row);
          foreignOid = row.oid;
          await blocker.query('COMMIT');
        } finally {
          await blocker.query('ROLLBACK');
          blocker.release();
          await applying;
        }
        const error = await applying;
        assert.ok(error instanceof Error && 'code' in error);
        assert.equal(error.code, '42P07', id + ': duplicate relation');
        assert.ok(error.message.includes(lateName), error.message);
        assert.equal(await oid(firstIndex), null, id + ': earlier CREATE rolled back');
        assert.equal((await pool.query('SELECT 1 FROM platform.schema_migration WHERE migration_id=$1', [id])).rowCount, 0);
        assert.equal((await migrate({databaseUrl, mode:'rollback'})).status, 'NOT_APPLIED');
        assert.equal(await oid(lateIndex), foreignOid, id + ': independent index retained its OID');
      }
    },
  }),
);
