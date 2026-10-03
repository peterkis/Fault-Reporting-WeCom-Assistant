import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {Pool} from 'pg';
import {testRoots} from './helpers/migration-roots.mjs';
import {withSS009Database} from './helpers/yxx-ss-009-resources.mjs';
import {readCurrentYxxScope} from '../src/yxx-current-readiness-scope.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';
import {migrateWorkbenchAuth} from '../scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateThirdPartyStaffDirectory,validateThirdPartyStaffDirectoryCatalog} from '../scripts/p2-007-migrate.mjs';
import {yxxCatalogInventory,validateYxxCatalog} from '../scripts/yxx-self-service-migrate.mjs';

test('current authorized 22 migrations coexist and replay through existing entry points in one owned database',async t=>{
  const {sourceRoot,runtimeRoot}=testRoots(),scope=readCurrentYxxScope(sourceRoot);
  const digest=(bytes:Buffer|string):string=>createHash('sha256').update(bytes).digest('hex');
  const files=scope.migration_files.map(file=>({path:file,sha256_utf8_lf:digest(readFileSync(path.join(runtimeRoot,file),'utf8').replaceAll('\r\n','\n'))}));
  assert.equal(files.length,22);
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'yxxcurrent',max:1,
    run:async({pool,databaseUrl}:{pool:Pool;databaseUrl:string})=>{
      const version=Number((await pool.query<{version:string}>("SELECT current_setting('server_version_num') AS version")).rows[0]?.version);
      assert.ok(version>=180000&&version<190000);
      const options={databaseUrl,mode:'apply'};
      const baseline=await migrateCurrentBaselineWithYxx(options);assert.ok(baseline.yxx);
      assert.equal(baseline.status,'APPLIED');assert.equal(baseline.yxx.status,'APPLIED');
      const legacy=scope.migration_files.slice(0,14).map(file=>path.posix.basename(file).slice(0,3));
      assert.deepEqual(baseline.legacy_applied,legacy);
      const auth=await migrateWorkbenchAuth(options),directory=await migrateThirdPartyStaffDirectory(options);assert.ok(auth&&directory);
      assert.equal(auth.status,'APPLIED');assert.equal(directory.status,'APPLIED');
      const readMarkers=async()=> (await pool.query<{migration_id:string;checksum_sha256:string}>(
        'SELECT migration_id,checksum_sha256 FROM platform.schema_migration ORDER BY migration_id')).rows;
      const markers=await readMarkers();
      assert.deepEqual(markers.map(row=>row.migration_id),scope.migration_files.slice(14).map(file=>path.posix.basename(file,'.sql')));
      for(const marker of markers)assert.equal(marker.checksum_sha256,digest(readFileSync(path.join(runtimeRoot,'database/migrations/'+marker.migration_id+'.sql'))));
      validateYxxCatalog(await yxxCatalogInventory(pool));await validateThirdPartyStaffDirectoryCatalog(pool);
      const repeated=await migrateCurrentBaselineWithYxx(options);assert.ok(repeated.yxx);
      assert.equal(repeated.status,'NOOP_ALREADY_APPLIED');assert.equal(repeated.yxx.status,'NOOP_ALREADY_APPLIED');
      assert.deepEqual(repeated.legacy_applied,[]);
      const repeatedAuth=await migrateWorkbenchAuth(options),repeatedDirectory=await migrateThirdPartyStaffDirectory(options);assert.ok(repeatedAuth&&repeatedDirectory);
      assert.equal(repeatedAuth.status,'NOOP_ALREADY_APPLIED');assert.equal(repeatedDirectory.status,'NOOP_ALREADY_APPLIED');
      assert.deepEqual(await readMarkers(),markers);
      const empty=await pool.query<{tickets:number;intakes:number}>('SELECT (SELECT count(*)::int FROM pilot_ticket.ticket) AS tickets,(SELECT count(*)::int FROM intake.service_intake) AS intakes');
      assert.deepEqual(empty.rows,[{tickets:0,intakes:0}]);
      t.diagnostic('CURRENT_SCOPE_CATALOG '+JSON.stringify({...g2EvidenceTime(),status:'PASS',
        candidate_fingerprint:g2CandidateInventory(runtimeRoot).fingerprint,scope_sha256:scope.scope_sha256,
        database_scope:'OWNED_ISOLATED_DATABASE',postgres_version_num:version,migration_files:files,legacy_applied:legacy,markers,
        initial:{baseline:baseline.status,yxx:baseline.yxx.status,workbench_auth:auth.status,directory:directory.status},
        replay:'ALL_NOOP_MARKERS_UNCHANGED',catalog_verified:true,business_rows:empty.rows[0],live_authorized:false}));
    }});
});
