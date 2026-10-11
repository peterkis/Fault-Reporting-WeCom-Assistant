import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
import {migrateP2016} from '../scripts/p2-016-migrate.mjs';
import {migrateWorkbenchPersonalRead,personalReadSchemaReady} from '../scripts/workbench-personal-read-migrate.mjs';
import {migrateP2012} from '../scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../scripts/yxx-self-service-migrate.mjs';
import {migrateWorkbenchManualReports} from '../scripts/workbench-manual-reports-migrate.mjs';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';

test('T35 forward migration refuses before 042, checks with rollback, and refuses applied schema drift',()=>withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t35schema',run:async(f:{databaseUrl:string;pool:PostgresPool})=>{
  const input={databaseUrl:f.databaseUrl,mode:'apply'};await applyThrough030(f);await migrateP2016(input);
  await assert.rejects(migrateWorkbenchPersonalRead({databaseUrl:f.databaseUrl,mode:'apply'}),{code:'P2_016_ACTION_FAILED',status:409});
  assert.equal(await personalReadSchemaReady(f.pool),false);
  await migrateP2012(input);await migrateYxxSelfService(input);await migrateWorkbenchManualReports({databaseUrl:f.databaseUrl,mode:'apply'});
  assert.equal((await migrateWorkbenchPersonalRead({databaseUrl:f.databaseUrl,mode:'check'})).status,'CHECK_ROLLBACK_SUCCEEDED');
  assert.equal(await personalReadSchemaReady(f.pool),false);
  assert.equal((await migrateWorkbenchPersonalRead({databaseUrl:f.databaseUrl,mode:'apply'})).status,'APPLIED');
  assert.equal((await migrateWorkbenchPersonalRead({databaseUrl:f.databaseUrl,mode:'apply'})).status,'NOOP_ALREADY_APPLIED');
  assert.equal(await personalReadSchemaReady(f.pool),true);
  await f.pool.query('ALTER TABLE pilot_ticket.personal_material_read_position DROP CONSTRAINT personal_material_read_position_pkey');
  assert.equal(await personalReadSchemaReady(f.pool),false,'a migration marker cannot authorize a duplicate source-position relation');
  await assert.rejects(migrateWorkbenchPersonalRead({databaseUrl:f.databaseUrl,mode:'apply'}),{code:'P2_016_ACTION_FAILED',status:409});
}}));
