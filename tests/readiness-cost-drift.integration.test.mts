import assert from 'node:assert/strict';
import { test } from 'node:test';
import { p2016CatalogInventory } from '../app/server/scripts/p2-016-migrate.mjs';
import { FOLLOW_MIGRATION_ID, followReceiptSchemaReady, followSchemaReady } from '../app/server/scripts/workbench-follow-migrate.mjs';
import { supplementFollowUpSchemaReady } from '../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import { workbenchReadinessCatalog } from '../app/server/scripts/workbench-readiness-catalog.mjs';
import { conversationDeliveryReceiptCatalog, conversationDeliveryReceiptSchemaShape } from '../app/server/src/p2-006-delivery-command-schema.mjs';
import type { PostgresPool, PostgresQueryRow, PostgresTransaction } from '../app/server/src/platform/postgres-pool.mjs';
import { applyFullSchemaThrough077 } from './helpers/full-schema-migrations.mjs';
import { withP2016IsolatedDatabase } from './helpers/p2-016-postgres-harness.mjs';

const ceiling: Record<string, number> = {supplementFollowUpSchemaReady: 5, followReceiptSchemaReady: 4, followSchemaReady: 5};
const checks = { supplementFollowUpSchemaReady, followReceiptSchemaReady, followSchemaReady };
type Check = keyof typeof checks;
const all = Object.keys(checks);
const supplement: Check[] = ['supplementFollowUpSchemaReady'];
const follow: Check[] = ['followSchemaReady'];
const receipt = 'pilot_ticket.ticket_command_receipt';
const index = 'ticket_command_receipt_source_intake_fk_idx';
const dropIndex = 'DROP INDEX pilot_ticket.' + index;
const wrongChecksum = "UPDATE platform.schema_migration SET checksum_sha256=repeat('0',64) WHERE migration_id=";

test('full 077 readiness checks see rolled-back and newly introduced drift on the same connection', { timeout: 240_000 }, t =>
  withP2016IsolatedDatabase({
    databaseUrl: process.env.PILOT_DATABASE_URL,
    purpose: 'readycost',
    run: async ({ pool, databaseUrl }: { pool: PostgresPool; databaseUrl: string }) => {
      await applyFullSchemaThrough077(databaseUrl);
      const client = await pool.connect();
      let statements = 0;
      const counted: PostgresTransaction = {
        query<R extends PostgresQueryRow>(sql: string, values?: unknown[]) {
          statements++;
          return client.query<R>(sql, values);
        },
      };
      async function assertReadiness(label: string, rejected: readonly string[], onlySupplement = false) {
        const counts: Record<string, number> = {};
        for (const [name, ready] of Object.entries(checks)) {
          if (onlySupplement && name !== 'supplementFollowUpSchemaReady') continue;
          statements = 0;
          assert.equal(await ready(counted), !rejected.includes(name), label + ': ' + name);
          counts[name] = statements;
          assert.ok(statements > 0 && statements <= (ceiling[name] ?? 0), name + ' used ' + statements + ' statements');
        }
        t.diagnostic(label + ' statements/call ' + JSON.stringify(counts));
      }
      async function rolledBack(run: () => Promise<void>) {
        await client.query('BEGIN');
        try { await run(); } finally { await client.query('ROLLBACK'); }
      }
      async function expectSqlError(check: (tx: PostgresTransaction) => Promise<unknown>, code: string) {
        await client.query('SAVEPOINT expected_error');
        try {
          await assert.rejects(check(client), {code}, check.name);
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT expected_error');
          await client.query('RELEASE SAVEPOINT expected_error');
        }
      }
      async function duplicateMarker(id: string) {
        // Migration 022 declares this key. Exercise a registry without it in this transaction.
        await client.query('ALTER TABLE platform.schema_migration DROP CONSTRAINT IF EXISTS schema_migration_pkey');
        const result = await client.query(`
          INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
          SELECT migration_id,repeat('0',64),applied_at,applied_epoch_ms
            FROM platform.schema_migration WHERE migration_id=$1`, [id]);
        assert.equal(result.rowCount, 1);
      }
      try {
        await rolledBack(async () => {
          // Compare JSON bytes, including field order, to the original six-relation inventory.
          const legacy = await p2016CatalogInventory(client);
          const projected = Object.fromEntries(Object.entries(legacy).map(([category, rows]) =>
            [category, rows.filter((row: Record<string, unknown>) => row.relation === receipt)]));
          assert.equal(JSON.stringify(await conversationDeliveryReceiptCatalog(client)), JSON.stringify(projected));
          await assertReadiness('full 077', []);
        });
        const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
          ['062 checksum', wrongChecksum + "'062_workbench_supplement_follow_up'", supplement],
          ['071 checksum', wrongChecksum + "'071_unified_service_closure'", all],
          ['076 checksum', wrongChecksum + "'076_fk_indexes'", all],
          ['061 fallback checksum', wrongChecksum + "'061_workbench_conversation_delivery_commands'", all],
          ['missing receipt FK index', dropIndex, all],
          ['receipt FK index columns', dropIndex + '; CREATE INDEX '+index+' ON '+receipt+' (closure_intake_id)', all],
          ['unique receipt FK index', dropIndex + '; CREATE UNIQUE INDEX '+index+' ON '+receipt+' (source_intake_id)', all],
          ['partial receipt FK index', dropIndex + '; CREATE INDEX '+index+' ON '+receipt+' (source_intake_id) WHERE source_intake_id IS NOT NULL', all],
          ['hash receipt FK index', dropIndex + '; CREATE INDEX '+index+' ON '+receipt+' USING hash (source_intake_id)', all],
          ['receipt FK index with INCLUDE', dropIndex + '; CREATE INDEX '+index+' ON '+receipt+' (source_intake_id) INCLUDE (closure_intake_id)', all],
          ['expression receipt FK index', dropIndex + '; CREATE INDEX '+index+' ON '+receipt+' ((coalesce(source_intake_id, closure_intake_id)))', all],
          ['supplement FK index on the wrong table', 'DROP INDEX pilot_ticket.workbench_supp_disp_source_intake_fk_idx; CREATE INDEX workbench_supp_disp_source_intake_fk_idx ON pilot_ticket.workbench_supplement_reply_binding (source_intake_id)', supplement],
          ['follow FK index with INCLUDE', 'DROP INDEX pilot_ticket.workbench_item_follow_source_intake_fk_idx; CREATE INDEX workbench_item_follow_source_intake_fk_idx ON pilot_ticket.workbench_item_follow (source_intake_id) INCLUDE (principal_id)', follow],
          ['044 UUID domain retains its visible base type', 'CREATE DOMAIN pilot_ticket.readiness_uuid AS uuid; ALTER TABLE pilot_ticket.workbench_item_follow ALTER COLUMN source_intake_id TYPE pilot_ticket.readiness_uuid', []],
          ['extra supplement index', 'CREATE INDEX extra_idx ON pilot_ticket.workbench_supplement_disposition (revision)', supplement],
          ['extra receipt column', 'ALTER TABLE '+receipt+' ADD COLUMN extra_column integer', all],
          ['receipt resource guard', 'ALTER TABLE '+receipt+' DROP CONSTRAINT p2016_command_resource, ADD CONSTRAINT p2016_command_resource CHECK(true)', all],
          ['closure predecessor', "UPDATE pilot_ticket.closure_migration_baseline SET command_resource_check='CHECK(true)' WHERE singleton", all],
          ['extra supplement trigger', 'CREATE TRIGGER extra_trigger BEFORE UPDATE ON pilot_ticket.workbench_supplement_reply_binding FOR EACH ROW EXECUTE FUNCTION pg_catalog.suppress_redundant_updates_trigger()', supplement],
          ['missing active follow index', 'DROP INDEX pilot_ticket.workbench_item_follow_active_idx', follow],
          ['unregistered 076 indexes', "DELETE FROM platform.schema_migration WHERE migration_id='076_fk_indexes'", all],
          ['pre-076 marker and scoped indexes absent', `
            DELETE FROM platform.schema_migration WHERE migration_id='076_fk_indexes';
            DROP INDEX pilot_ticket.ticket_command_receipt_source_intake_fk_idx,
                       pilot_ticket.ticket_command_receipt_closure_intake_fk_idx,
                       pilot_ticket.workbench_supp_disp_actor_fk_idx,
                       pilot_ticket.workbench_supp_disp_source_intake_fk_idx,
                       pilot_ticket.workbench_supp_reply_source_intake_fk_idx,
                       pilot_ticket.workbench_item_follow_source_intake_fk_idx`, []],
          ['missing 047 marker', "DELETE FROM platform.schema_migration WHERE migration_id='047_workbench_personal_read'", all],
        ];
        for (const [label, sql, rejected] of cases) {
          await rolledBack(async () => {
            await client.query(sql);
            await assertReadiness(label, rejected);
          });
        }
        await rolledBack(async () => {
          await client.query('ALTER TABLE platform.schema_migration RENAME TO hidden_schema_migration');
          await assertReadiness('missing registry', supplement, true);
          assert.equal(await conversationDeliveryReceiptSchemaShape(client), null);
          await expectSqlError(followReceiptSchemaReady, '42P01');
          await expectSqlError(followSchemaReady, '42P01');
        });
        const hideBaseline = 'ALTER TABLE pilot_ticket.closure_migration_baseline RENAME TO hidden_closure_baseline';
        await rolledBack(async () => {
          await client.query(hideBaseline);
          for (const check of [...Object.values(checks), conversationDeliveryReceiptSchemaShape]) {
            await expectSqlError(check, '42P01');
          }
        });
        await rolledBack(async () => {
          await client.query(hideBaseline);
          await client.query('ALTER TABLE pilot_ticket.closure_record RENAME TO hidden_closure_record');
          await assertReadiness('missing baseline and closure record', all);
          await assert.rejects(conversationDeliveryReceiptSchemaShape(client), {message: 'SERVICE_CLOSURE_SCHEMA_DRIFT'});
        });
        await rolledBack(async () => {
          await duplicateMarker('076_fk_indexes');
          for (const check of [...Object.values(checks), conversationDeliveryReceiptSchemaShape]) {
            await expectSqlError(check, '21000');
          }
        });
        await rolledBack(async () => {
          // Stricter than main: the unordered 071 point query could pick either checksum.
          await duplicateMarker('071_unified_service_closure');
          await assertReadiness('duplicate conflicting 071', all);
          await assert.rejects(conversationDeliveryReceiptSchemaShape(client), {message: 'SERVICE_CLOSURE_SCHEMA_DRIFT'});
        });
        await rolledBack(async () => {
          await duplicateMarker('047_workbench_personal_read');
          await assertReadiness('duplicate conflicting 047', all);
          assert.equal(await conversationDeliveryReceiptSchemaShape(client), null);
        });
        await rolledBack(async () => {
          // Unbounded bpchar preserves the returned spelling and compares without trailing spaces.
          await client.query(`
            ALTER TABLE platform.schema_migration RENAME TO original_registry;
            CREATE TABLE platform.schema_migration AS
              SELECT (CASE WHEN migration_id IN ('062_workbench_supplement_follow_up', '071_unified_service_closure')
                           THEN migration_id || ' ' ELSE migration_id END)::pg_catalog.bpchar AS migration_id,
                     checksum_sha256
                FROM platform.original_registry`);
          await assertReadiness('blank-padded 062 and 071 point lookups', []);
          await client.query('SAVEPOINT before_extra_marker');
          for (const id of ['047_workbench_personal_read', '061_workbench_conversation_delivery_commands']) {
            await client.query(`
              INSERT INTO platform.schema_migration (migration_id, checksum_sha256)
              SELECT migration_id || ' ', checksum_sha256 FROM platform.original_registry WHERE migration_id=$1`, [id]);
            for (const check of Object.values(checks)) {
              await assert.rejects(check(client), {code: 'ENOENT', path: new RegExp(id + ' \\.sql$')}, check.name);
            }
            await client.query('ROLLBACK TO SAVEPOINT before_extra_marker');
          }
        });
        await rolledBack(async () => {
          // Both identifier splits spell the same three-component text. Neither spells the production target.
          await client.query('CREATE SCHEMA pilot');
          await client.query('CREATE SCHEMA "pilot.ticket"');
          await client.query('CREATE TABLE pilot."ticket.ticket_command_receipt" (first_split integer)');
          await client.query('CREATE TABLE "pilot.ticket".ticket_command_receipt (second_split integer)');
          const dotted = ['pilot.ticket.ticket_command_receipt'];
          const original = (await client.query<{ name: string }>(`
            SELECT a.attname AS name FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
            JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND NOT a.attisdropped
            AND n.nspname||'.'||c.relname=ANY($1::text[]) ORDER BY name`, [dotted])).rows;
          assert.deepEqual(original.map(row => row.name), ['first_split', 'second_split']);
          const catalog = await workbenchReadinessCatalog(client, dotted, 'receipt');
          assert.deepEqual(catalog.columns.map(row => row.name).sort(), original.map(row => row.name));
          await assertReadiness('unrelated dotted identifiers', []);
        });
        // The held reader uses autocommit. A second connection atomically swaps
        // which index is missing immediately before the final 044 statement.
        await pool.query('ALTER INDEX pilot_ticket.workbench_item_follow_active_idx RENAME TO hidden_follow_active');
        let swapped = false;
        const concurrentChange: PostgresTransaction = {
          async query<R extends PostgresQueryRow>(sql: string, values?: unknown[]) {
            if (values?.includes(FOLLOW_MIGRATION_ID)) {
              await pool.query(`
                ALTER INDEX pilot_ticket.hidden_follow_active RENAME TO workbench_item_follow_active_idx;
                ALTER INDEX pilot_ticket.workbench_item_follow_source_intake_fk_idx RENAME TO hidden_follow_fk`);
              swapped = true;
            }
            return client.query<R>(sql, values);
          },
        };
        assert.equal(await followSchemaReady(concurrentChange), false, '044 must read the current FK structure');
        assert.equal(swapped, true);
        await pool.query('ALTER INDEX pilot_ticket.hidden_follow_fk RENAME TO workbench_item_follow_source_intake_fk_idx');
        await assertReadiness('restored 077', []);
      } finally {
        client.release();
      }
    },
  }),
);
