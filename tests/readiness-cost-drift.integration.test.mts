import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { p2016CatalogInventory } from '../app/server/scripts/p2-016-migrate.mjs';
import { migrateServiceClosure } from '../app/server/scripts/service-closure-migrate.mjs';
import { ticketTerminalAtSchemaReady } from '../app/server/scripts/ticket-terminal-at-migrate.mjs';
import { fkIndexesSchemaReady } from '../app/server/scripts/fk-indexes-migrate.mjs';
import { retentionTimeContractSchemaReady } from '../app/server/scripts/retention-and-time-contract-migrate.mjs';
import { FOLLOW_MIGRATION_ID, readReadyFollowReceipt, followReceiptSchemaReady, followSchemaReady } from '../app/server/scripts/workbench-follow-migrate.mjs';
import { supplementFollowUpCatalog, supplementFollowUpSchemaReady } from '../app/server/scripts/workbench-supplement-follow-up-migrate.mjs';
import { projectWorkbenchCatalog, readWorkbenchCatalog, workbenchReadinessCatalog } from '../app/server/scripts/workbench-readiness-catalog.mjs';
import { readWorkbenchRelationCatalog, normalizeServiceClosureReceiptCatalog, conversationDeliveryReceiptCatalog, conversationDeliveryReceiptSchemaShape } from '../app/server/src/p2-006-delivery-command-schema.mjs';
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

async function useRegistryReader(client: PostgresTransaction) {
  const role = 'ticket_card42a_r20_' + randomUUID().replaceAll('-', '');
  await client.query('CREATE ROLE ' + role + ' NOLOGIN');
  await client.query('GRANT ' + role + ' TO CURRENT_USER');
  await client.query('GRANT USAGE ON SCHEMA platform TO ' + role);
  await client.query('GRANT SELECT ON platform.schema_migration TO ' + role);
  await client.query('SET LOCAL ROLE ' + role);
  assert.equal((await client.query("SELECT has_schema_privilege('pilot_ticket','USAGE') AS allowed")).rows[0]?.allowed, false);
  return role;
}

test('full 077 readiness checks see rolled-back and newly introduced drift on the same connection', { timeout: 240_000 }, t =>
  withP2016IsolatedDatabase({
    databaseUrl: process.env.PILOT_DATABASE_URL,
    purpose: 'readycost', namespace: 'ticket_card42a',
    run: async ({ pool, databaseUrl }: { pool: PostgresPool; databaseUrl: string }) => {
      await applyFullSchemaThrough077(databaseUrl, {beforeClosureMigration: async () => {
        await t.test('pre-071 receipt readiness rejects a registry reader without pilot_ticket USAGE and preserves its transaction', async t => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const reads = t.mock.method(client, 'query');
            try {
              for (const [name, ready] of Object.entries(checks)) {
                reads.mock.resetCalls();
                assert.equal(await ready(client), true, name);
                const count = reads.mock.callCount();
                assert.ok(count > 0 && count <= (ceiling[name] ?? 0), name + ' used ' + count + ' statements');
              }
            } finally { reads.mock.restore(); }
            const role = await useRegistryReader(client);
            assert.equal((await client.query("SELECT 1 FROM platform.schema_migration WHERE migration_id='047_workbench_personal_read'")).rowCount, 1);
            for (const ready of [followReceiptSchemaReady, followSchemaReady, supplementFollowUpSchemaReady]) {
              assert.equal(await ready(client), false, ready.name);
              assert.equal((await client.query('SELECT 1 AS ok')).rows[0]?.ok, 1);
            }
            await client.query('RESET ROLE');
            await client.query('GRANT USAGE ON SCHEMA pilot_ticket TO ' + role);
            await client.query('SET LOCAL ROLE ' + role);
            assert.equal(await followReceiptSchemaReady(client), true);
          } finally {
            try { await client.query('ROLLBACK'); } finally { client.release(); }
          }
        });
        await t.test('pre-071 exported index projection checks the current 076 marker', async () => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query(`INSERT INTO platform.schema_migration(migration_id,checksum_sha256,applied_at,applied_epoch_ms)
              SELECT '076_fk_indexes',repeat('0',64),platform.local_from_epoch_ms(epoch),epoch
                FROM (SELECT platform.physical_epoch_ms() AS epoch) stamp`);
            const ready = await readReadyFollowReceipt(client);
            assert.ok(ready);
            const indexes = projectWorkbenchCatalog(ready.catalog, [receipt], 'receipt').indexes;
            assert.equal(await ready.priorIndexes([receipt], indexes), null);
          } finally {
            try { await client.query('ROLLBACK'); } finally { client.release(); }
          }
        });
        // Commit the real migration on a different connection just after the
        // reader's registry query. The receipt is healthy on either side of it.
        async function cross071<T>(mode: 'apply' | 'rollback', check: (tx: PostgresTransaction) => Promise<T>) {
          let changed = false;
          const result = await check({
            async query<R extends PostgresQueryRow>(sql: string, values?: unknown[]) {
              const read = await pool.query<R>(sql, values);
              if (!changed && sql.includes('platform.schema_migration')
                && values?.some(value => Array.isArray(value) && value.includes('061_workbench_conversation_delivery_commands'))) {
                const transition = await migrateServiceClosure({databaseUrl, mode});
                assert.equal(transition.status, mode === 'apply' ? 'APPLIED' : 'ROLLED_BACK');
                changed = true;
              }
              return read;
            },
          });
          assert.ok(changed, '071 must commit between the registry and catalog reads');
          return result;
        }
        await t.test('live BOT receipt remains ready across a committed 071 installation', async () => {
          assert.equal(await conversationDeliveryReceiptSchemaShape(pool), 'BOT');
          assert.equal(await cross071('apply', conversationDeliveryReceiptSchemaShape), 'BOT');
          assert.equal(await conversationDeliveryReceiptSchemaShape(pool), 'BOT');
        });
        await t.test('062 readiness returns a boolean and preserves the caller transaction across a committed 071 rollback', async () => {
          await migrateServiceClosure({databaseUrl, mode:'apply'});
          assert.equal(await supplementFollowUpSchemaReady(pool), true);
          const caller = await pool.connect();
          try {
            await caller.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            let rolledBack = false;
            const result = await supplementFollowUpSchemaReady({
              async query<R extends PostgresQueryRow>(sql: string, values?: unknown[]) {
                const read = await caller.query<R>(sql, values);
                if (!rolledBack && sql.includes('platform.schema_migration')
                  && values?.some(value => Array.isArray(value) && value.includes('061_workbench_conversation_delivery_commands'))) {
                  const transition = await migrateServiceClosure({databaseUrl, mode:'rollback'});
                  assert.equal(transition.status, 'ROLLED_BACK');
                  rolledBack = true;
                }
                return read;
              },
            });
            assert.ok(rolledBack, '071 must commit between the registry and catalog reads');
            // On main b20ea1cc the spanning call can return false while both committed states are ready.
            assert.equal(typeof result, 'boolean');
            assert.equal((await caller.query('SELECT 1 AS ok')).rows[0]?.ok, 1);
            assert.equal(await supplementFollowUpSchemaReady(caller), true);
          } finally {
            try { await caller.query('ROLLBACK'); } finally { caller.release(); }
          }
        });
      }});
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
      const releaseChecks = {terminal: ticketTerminalAtSchemaReady, fk: fkIndexesSchemaReady, time: retentionTimeContractSchemaReady};
      async function assertReleaseReadiness(label: string, rejected?: keyof typeof releaseChecks) {
        for (const [name, ready] of Object.entries(releaseChecks)) {
          statements = 0;
          assert.equal(await ready(counted), name !== rejected, label + ': ' + name);
          assert.equal(statements, 1, label + ': ' + name + ' must use one statement');
        }
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
        const combinedRelations = [receipt, 'pilot_ticket.workbench_supplement_disposition', 'pilot_ticket.workbench_supplement_reply_binding'];
        const readers = {
          supplementFollowUpCatalog,
          readWorkbenchCatalog: (tx: PostgresTransaction) => readWorkbenchCatalog(tx, combinedRelations, true, true),
        };
        for (const [name, read] of Object.entries(readers)) {
          await t.test(name + ' preserves the default catalog bytes and caller settings in one statement', () => rolledBack(async () => {
            const expected = await read(client);
            assert.ok(expected.columns.some(column => column.default_expression !== null));
            assert.ok(expected.constraints.length > 0 && expected.indexes.length > 0);
            await client.query('SET LOCAL search_path=platform,pilot_ticket,intake,public');
            await client.query('SET LOCAL quote_all_identifiers=on');
            const settingsSql = "SELECT pg_catalog.current_setting('search_path') AS path, pg_catalog.current_setting('quote_all_identifiers') AS quoting";
            const original = (await client.query(settingsSql)).rows;
            statements = 0;
            const actual = await read(counted);
            assert.equal(statements, 1, name);
            assert.deepEqual((await client.query(settingsSql)).rows, original);
            assert.equal(JSON.stringify(actual), JSON.stringify(expected), name + ' catalog bytes');
          }));
        }
        await assertReleaseReadiness('075/076/077 installed');
        const releaseDrift: ReadonlyArray<readonly [keyof typeof releaseChecks, string]> = [
          ['terminal', wrongChecksum + "'075_ticket_terminal_at'"],
          ['terminal', 'ALTER TABLE pilot_ticket.ticket RENAME COLUMN terminal_at TO hidden_terminal_at'],
          ['terminal', 'ALTER TABLE pilot_ticket.ticket DROP CONSTRAINT ticket_terminal_status_check'],
          ['terminal', 'ALTER TABLE pilot_ticket.ticket DISABLE TRIGGER USER'],
          ['terminal', 'DROP INDEX pilot_ticket.ticket_terminal_idx'],
          ['terminal', 'DROP INDEX pilot_ticket.ticket_resolved_terminal_idx'],
          ['terminal', 'DROP INDEX pilot_ticket.ticket_open_updated_idx'],
          ['fk', dropIndex],
          ['time', wrongChecksum + "'077_retention_and_time_contract'"],
          ['time', "ALTER FUNCTION platform.local_now() SET search_path TO pg_catalog, platform"],
        ];
        for (const [gate, ddl] of releaseDrift) {
          await rolledBack(async () => {
            await client.query(ddl);
            await assertReleaseReadiness(ddl, gate);
          });
        }
        await assertReleaseReadiness('075/076/077 restored');
        await t.test('release checks reject missing structural targets and preserve the caller transaction', () => rolledBack(async () => {
          await client.query('ALTER TABLE pilot_ticket.ticket RENAME TO hidden_ticket');
          assert.equal(await ticketTerminalAtSchemaReady(client),false);
          await client.query('ALTER SCHEMA intake RENAME TO hidden_intake');
          assert.equal(await fkIndexesSchemaReady(client),false);
          await client.query('ALTER SCHEMA conversation RENAME TO hidden_conversation');
          assert.equal(await retentionTimeContractSchemaReady(client),false);
          assert.equal((await client.query('SELECT 1 AS ok')).rows[0]?.ok,1);
        }));
        await t.test('075 rejects an inaccessible ticket schema without aborting the caller transaction', () => rolledBack(async () => {
          await useRegistryReader(client);
          assert.equal(await ticketTerminalAtSchemaReady(client),false);
          assert.equal((await client.query('SELECT 1 AS ok')).rows[0]?.ok,1);
        }));
        await t.test('missing 047 rejects before resolving closure or receipt relations', () => rolledBack(async () => {
          assert.equal((await client.query("DELETE FROM platform.schema_migration WHERE migration_id='047_workbench_personal_read'")).rowCount, 1);
          await useRegistryReader(client);
          for (const ready of [followReceiptSchemaReady, followSchemaReady, supplementFollowUpSchemaReady]) {
            assert.equal(await ready(client), false, ready.name);
          }
          assert.equal(await conversationDeliveryReceiptSchemaShape(client), null);
        }));
        await t.test('qualified relation catalog resolves quoted names and retains the requested spelling', async () => {
          const quoted = '"pilot_ticket"."ticket_command_receipt"';
          const expected = await readWorkbenchRelationCatalog(client, [receipt]);
          assert.ok(expected.columns.length > 0);
          const actual = await readWorkbenchRelationCatalog(client, [quoted]);
          for (const category of ['relations','columns','constraints','indexes','triggers'] as const) {
            assert.deepEqual(actual[category], expected[category].map(row => ({...row, relation:quoted})), category);
          }
        });
        await t.test('qualified relation catalog checks schema USAGE even for a missing table', () => rolledBack(async () => {
          const absent = 'pilot_ticket.r20_absent_relation';
          assert.deepEqual((await readWorkbenchRelationCatalog(client, [absent])).relations, []);
          await useRegistryReader(client);
          await expectSqlError(tx => readWorkbenchRelationCatalog(tx, [absent]), '42501');
        }));
        await t.test('missing 062 stops before resolving closure tables', () => rolledBack(async () => {
          assert.equal((await client.query("DELETE FROM platform.schema_migration WHERE migration_id='062_workbench_supplement_follow_up'")).rowCount, 1);
          await useRegistryReader(client);
          assert.equal(await supplementFollowUpSchemaReady(client), false);
        }));
        await t.test('receipt, follow and supplement use plain SQL without SQL/XML', async () => {
          const plain: PostgresTransaction = {
            query<R extends PostgresQueryRow>(sql: string, values?: unknown[]) {
              assert.doesNotMatch(sql, /\b(?:query_to_xml|table_to_xml|xmltable|xpath)\b/i);
              return client.query<R>(sql, values);
            },
          };
          for (const check of Object.values(checks)) assert.equal(await check(plain), true);
          assert.equal(await conversationDeliveryReceiptSchemaShape(plain), 'BOT');
        });
        await t.test('a missing closure FK rejects before the renamed baseline can abort the transaction', () => rolledBack(async () => {
          await client.query('ALTER TABLE pilot_ticket.ticket_command_receipt DROP CONSTRAINT ticket_command_receipt_closure_intake_id_fkey');
          await client.query('ALTER TABLE pilot_ticket.closure_migration_baseline RENAME TO hidden_closure_baseline');
          for (const check of Object.values(checks)) assert.equal(await check(client), false);
          assert.equal((await client.query('SELECT 1 AS ok')).rows[0]?.ok, 1);
        }));
        await t.test('closure decision consumes final table presence after a committed drift swap', async () => {
          const closureTable = 'pilot_ticket.closure_supplement_termination';
          await pool.query('ALTER TABLE ' + receipt + ' ADD COLUMN r20_receipt_drift integer');
          let swapped = false;
          try {
            assert.equal(await followReceiptSchemaReady(client), false, 'before the swap the receipt is invalid');
            const changing: PostgresTransaction = {
              async query<R extends PostgresQueryRow>(sql: string, values?: unknown[]) {
                if (!swapped && sql.includes('pg_attribute') && values?.some(value => Array.isArray(value) && value.includes(receipt))) {
                  await pool.query('ALTER TABLE ' + receipt + ' DROP COLUMN r20_receipt_drift; ALTER TABLE ' + closureTable + ' RENAME TO r20_hidden_termination');
                  swapped = true;
                }
                return client.query<R>(sql, values);
              },
            };
            const ready = await followReceiptSchemaReady(changing);
            assert.equal(swapped, true);
            assert.equal(await followReceiptSchemaReady(client), false, 'after the swap the closure table is missing');
            assert.equal(ready, false, 'the guard saw the table but the decisive snapshot did not');
          } finally {
            await pool.query(swapped ? 'ALTER TABLE pilot_ticket.r20_hidden_termination RENAME TO closure_supplement_termination'
              : 'ALTER TABLE ' + receipt + ' DROP COLUMN r20_receipt_drift');
          }
        });
        await t.test('a committed swap cannot splice receipt and supplement inventories', async () => {
          // Neither committed state is ready. Swap the bad column between tables
          // on a second connection immediately after the receipt baseline read.
          const supplementTable = 'pilot_ticket.workbench_supplement_disposition';
          const column = 'dev34_snapshot_drift';
          await pool.query('ALTER TABLE ' + supplementTable + ' ADD COLUMN ' + column + ' integer');
          let swapped = false;
          try {
            assert.equal(await supplementFollowUpSchemaReady(client), false, 'before the swap');
            const swapping: PostgresTransaction = {
              async query<R extends PostgresQueryRow>(sql: string, values?: unknown[]) {
                const result = await client.query<R>(sql, values);
                if (!swapped && sql.includes('FROM pilot_ticket.closure_migration_baseline')) {
                  await pool.query('ALTER TABLE ' + supplementTable + ' DROP COLUMN ' + column + '; ALTER TABLE ' + receipt + ' ADD COLUMN ' + column + ' integer');
                  swapped = true;
                }
                return result;
              },
            };
            const ready = await supplementFollowUpSchemaReady(swapping);
            assert.equal(swapped, true);
            assert.equal(await supplementFollowUpSchemaReady(client), false, 'after the swap');
            assert.equal(ready, false, 'the two inventories cannot describe different commits');
          } finally {
            await pool.query('ALTER TABLE ' + (swapped ? receipt : supplementTable) + ' DROP COLUMN ' + column);
          }
        });
        await t.test('live 071 and scoped 076 proofs retain their paired reads', async () => {
          const trace: {sql:string; values:unknown[]}[] = [];
          const traced: PostgresTransaction = {
            query<R extends PostgresQueryRow>(sql:string,values:unknown[] = []) {
              trace.push({sql,values});
              return client.query<R>(sql,values);
            },
          };
          assert.equal(await conversationDeliveryReceiptSchemaShape(traced),'BOT');
          assert.ok(trace.some(({sql,values}) => values.includes('071_unified_service_closure') && sql.includes('checksum_sha256')
            && sql.includes('pilot_ticket.closure_record') && sql.includes('pilot_ticket.closure_supplement_termination')));
          assert.ok(trace.some(({sql,values}) => values.includes('076_fk_indexes') && sql.includes('checksum_sha256')
            && sql.includes('pg_index') && sql.includes('indkey') && values.some(value=> typeof value==='string' && value.includes(index))));
        });
        await t.test('follow and supplement collect their receipt and closure objects in one catalog read', async () => {
          for (const check of [followReceiptSchemaReady,followSchemaReady,supplementFollowUpSchemaReady]) {
            let sharedCatalog = false;
            const names = check === supplementFollowUpSchemaReady
              ? [receipt,'pilot_ticket.workbench_supplement_disposition','pilot_ticket.workbench_supplement_reply_binding'] : [receipt];
            assert.equal(await check({
              query<R extends PostgresQueryRow>(sql:string,values?:unknown[]) {
                if (values?.some(value => Array.isArray(value) && names.every(name=>value.includes(name)))
                  && values.includes(true) && ['pg_attribute','pg_constraint','pg_index','pg_trigger','pilot_ticket.closure_record','pilot_ticket.closure_supplement_termination'].every(name=>sql.includes(name))) sharedCatalog=true;
                return client.query<R>(sql,values);
              },
            }),true);
            assert.ok(sharedCatalog,check.name);
          }
        });
        await t.test('the public normalizer honors the caller closure veto', async () => {
          const catalog=await conversationDeliveryReceiptCatalog(client);
          await assert.rejects(normalizeServiceClosureReceiptCatalog(client,catalog,true,{
            closureReady:async()=>false,
            priorIndexes:async rows=>rows,
          }), {message:'SERVICE_CLOSURE_SCHEMA_DRIFT'});
        });
        await t.test('a bad receipt rejects before 044 reads information_schema.columns', () => rolledBack(async () => {
          await client.query('ALTER TABLE pilot_ticket.ticket_command_receipt ADD COLUMN r21_extra integer');
          await client.query('REVOKE SELECT ON information_schema.columns FROM PUBLIC');
          const role='ticket_card42a_r21_'+randomUUID().replaceAll('-', '');
          await client.query('CREATE ROLE '+role+' NOLOGIN');
          await client.query('GRANT '+role+' TO CURRENT_USER');
          await client.query('GRANT USAGE ON SCHEMA pilot_ticket,platform TO '+role);
          await client.query('GRANT SELECT ON platform.schema_migration,pilot_ticket.closure_migration_baseline TO '+role);
          await client.query('SET LOCAL ROLE '+role);
          assert.equal((await client.query("SELECT has_table_privilege('information_schema.columns','SELECT') AS allowed")).rows[0]?.allowed,false);
          assert.equal(await followSchemaReady(client),false);
        }));
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
