import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateP2016, validateP2016Catalog, p2016CatalogHash } from '../scripts/p2-016-migrate.mjs';
import { withP2016IsolatedDatabase, applyThrough030, assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';

const databaseUrl = process.env.PILOT_DATABASE_URL;
const objects = async (pool) => (await pool.query(`SELECT
  (SELECT count(*)::integer FROM pg_proc) AS functions,
  (SELECT count(*)::integer FROM pg_extension) AS extensions,
  (SELECT count(*)::integer FROM pg_trigger WHERE NOT tgisinternal) AS triggers`)).rows[0];

test('P2-016 migration is atomic, check-only, exact, reentrant and drift-failing', async (t) => {
  assert.ok(databaseUrl, 'PILOT_DATABASE_URL is required; database tests must not be skipped');
  await withP2016IsolatedDatabase({ databaseUrl, purpose: 'p2016schema', run: async ({ pool, databaseUrl: isolated }) => {
    await applyThrough030({ pool, databaseUrl: isolated });
    const before = await objects(pool);
    assert.equal((await migrateP2016({ databaseUrl: isolated, mode: 'status' })).status, 'READY_FOR_031');
    assert.equal((await migrateP2016({ databaseUrl: isolated, mode: 'check' })).status, 'CHECK_ROLLBACK_SUCCEEDED');
    assert.equal((await pool.query("SELECT to_regclass('pilot_ticket.ticket_command_receipt') AS relation")).rows[0].relation, null);
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM platform.schema_migration WHERE migration_id LIKE '031_%'")).rows[0].n, 0);
    const applied = await migrateP2016({ databaseUrl: isolated });
    assert.equal(applied.status, 'APPLIED');
    assert.deepEqual(await objects(pool), before);
    assert.equal(applied.inventory.relations.length, 6);
    assert.equal(applied.inventory.columns.length, 84);
    assert.equal(applied.inventory.constraints.filter((c) => c.type === 'f').length, 24);
    assert.equal(applied.inventory.indexes.length, 38);
    assert.equal(applied.inventory.columns.some((c) => /with time zone/u.test(c.type)), false);
    const repeated = await migrateP2016({ databaseUrl: isolated });
    assert.equal(repeated.status, 'NOOP_ALREADY_APPLIED');
    assert.equal(p2016CatalogHash(repeated.inventory), p2016CatalogHash(applied.inventory));
    assert.equal((await migrateP2016({ databaseUrl: isolated, mode: 'check' })).status, 'NOOP_ALREADY_APPLIED');
    const mutations = [
      ['table', 'DROP TABLE pilot_ticket.reporter_access_event'],
      ['column', 'ALTER TABLE pilot_ticket.ticket_command_receipt DROP COLUMN retryable'],
      ['type', 'ALTER TABLE pilot_ticket.reporter_public_ref ALTER COLUMN public_ref TYPE varchar(32)'],
      ['default', "ALTER TABLE pilot_ticket.reporter_public_ref ALTER COLUMN status SET DEFAULT 'REVOKED'"],
      ['constraint', 'ALTER TABLE pilot_ticket.reporter_access_grant DROP CONSTRAINT p2016_grant_expiry'],
      ['index', 'DROP INDEX pilot_ticket.p2016_grant_expiry_idx'],
      ['foreign_key', 'ALTER TABLE pilot_ticket.reporter_access_grant DROP CONSTRAINT p2016_grant_binding'],
    ];
    for (const [name, mutation] of mutations) await t.test('rejects ' + name + ' drift', async () => {
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        await tx.query(mutation);
        await assert.rejects(validateP2016Catalog(tx), { code: 'P2_016_SCHEMA_DRIFT' });
      } finally { await tx.query('ROLLBACK'); tx.release(); }
      await validateP2016Catalog(pool);
    });
  } });
  await assertNoP2016Residual({ databaseUrl });
});
