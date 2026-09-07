import { migrateCurrentBaseline } from '../scripts/migrate-current-baseline.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateP2012,validateP2012Catalog,P2012_RELATIONS } from '../scripts/p2-012-migrate.mjs';
import { withP2012Database,applyThrough031,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
test('P2-012 migration 032 applies atomically, detects catalog drift and preserves seven-table scope',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'p2012migrate',max:1,run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});
    assert.equal((await migrateP2012({databaseUrl,mode:'status'})).status,'READY_FOR_032');
    assert.equal((await migrateP2012({databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');
    assert.equal((await pool.query("SELECT to_regclass('incident.incident') AS relation")).rows[0].relation,null);
    const result=await migrateP2012({databaseUrl});assert.equal(result.status,'APPLIED');
    assert.deepEqual(result.inventory.relations.map(r=>r.relation).sort(),[...P2012_RELATIONS].sort());
    assert.equal(result.inventory.triggers.length,0);assert.equal(result.inventory.routines.length,0);
    assert.equal(result.inventory.columns.filter(c=>/with time zone|timestamptz|timetz/u.test(c.type)).length,0);
    assert.equal((await migrateP2012({databaseUrl})).status,'NOOP_ALREADY_APPLIED');
    for(const sql of [
      'ALTER TABLE incident.incident ADD COLUMN unexpected TEXT',
      'ALTER TABLE incident.incident ALTER COLUMN safe_title DROP NOT NULL',
      'ALTER TABLE incident.incident ALTER COLUMN row_version SET DEFAULT 9',
      'DROP INDEX incident.p2012_incident_queue_idx',
      'ALTER TABLE incident.candidate_review DROP CONSTRAINT p2012_candidate_identity',
      'CREATE TABLE incident.unapproved_table(id INTEGER)',
    ]){
      await pool.query('BEGIN');try{await pool.query(sql);await assert.rejects(validateP2012Catalog(pool),{code:'P2_012_SCHEMA_DRIFT'});}finally{await pool.query('ROLLBACK');}
    }
    assert.equal((await migrateP2012({databaseUrl})).status,'NOOP_ALREADY_APPLIED');
  }});
  await assertNoP2012Residual({databaseUrl});
});

test('P2-012 fresh current baseline reaches 032 and repeated status/check/apply preserve the catalog',async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  await withP2012Database({databaseUrl,purpose:'p2012fresh',max:1,run:async({pool,databaseUrl})=>{
    const first=await migrateCurrentBaseline({databaseUrl});assert.equal(first.p2_012.status,'APPLIED');
    for(const mode of ['status','check','apply']){const r=await migrateCurrentBaseline({databaseUrl,mode});assert.equal(r.p2_012.status,'NOOP_ALREADY_APPLIED');}
    await validateP2012Catalog(pool);
  }});await assertNoP2012Residual({databaseUrl});
});
