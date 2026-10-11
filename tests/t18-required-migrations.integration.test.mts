import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PostgresPool} from '../src/platform/postgres-pool.mjs';
import {migrateWorkbenchVerifiedManualReports} from '../scripts/workbench-verified-manual-reports-migrate.mjs';
import {withWeb01Fixture} from './helpers/web01-workbench-fixture.mjs';
import {withP2016IsolatedDatabase,applyThrough030} from './helpers/p2-016-postgres-harness.mjs';
interface Database {pool:PostgresPool;databaseUrl:string}
interface Fixture extends Database {origin:string;cookies:string[]}
const root='045_workbench_verified_manual_reports',forward='051_workbench_verified_manual_report_candidate_ref_check';
const chain=[root,forward];
const ledger=async(pool:PostgresPool)=>(await pool.query<{migration_id:string;checksum_sha256:string;applied_at:string;applied_epoch_ms:string}>(
  'SELECT migration_id,checksum_sha256,applied_at::text,applied_epoch_ms::text FROM platform.schema_migration ORDER BY migration_id')).rows;
const verificationColumn=async(pool:PostgresPool)=>(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='intake' AND table_name='service_intake' AND column_name='manual_reporter_verification'")).rows;
const refused={code:'P2_016_ACTION_FAILED',status:409};

test('the public T18 migration entry checks without writes, applies 045 then 051 once, validates both checksums and preserves the disabled candidate flag',async()=>{
  const checksums=new Map(await Promise.all(chain.map(async id=>[id,createHash('sha256').update(await readFile(new URL('../database/migrations/'+id+'.sql',import.meta.url))).digest('hex')] as const)));
  await withWeb01Fixture(async({pool,databaseUrl,origin,cookies}:Fixture)=>{
    const before=await ledger(pool);assert.ok(before.some(row=>row.migration_id==='042_workbench_manual_reports'));
    assert.equal(before.some(row=>chain.includes(row.migration_id)),false);assert.deepEqual(await verificationColumn(pool),[]);
    for(const options of [{databaseUrl},{databaseUrl,mode:'check' as const}]){
      assert.deepEqual(await migrateWorkbenchVerifiedManualReports(options),{status:'PENDING',migration_id:root});
      assert.deepEqual(await ledger(pool),before);assert.deepEqual(await verificationColumn(pool),[]);
    }
    const cookie=cookies[0];assert.ok(cookie);
    const bootstrap=async()=>{const response=await fetch(origin+'/api/lifecycle/bootstrap',{headers:{cookie}});assert.equal(response.status,200);const value:unknown=await response.json();assert.ok(value&&typeof value==='object'&&'reporter_candidates_enabled' in value);assert.equal(value.reporter_candidates_enabled,false);};
    await bootstrap();
    assert.deepEqual(await migrateWorkbenchVerifiedManualReports({databaseUrl,mode:'apply'}),{status:'APPLIED',migration_id:root});
    const applied=await ledger(pool),markers=applied.filter(row=>chain.includes(row.migration_id));
    // Original first RED: the existing public migrator currently installs only 045.
    assert.deepEqual(markers.map(row=>row.migration_id),chain,'T18_PUBLIC_MIGRATOR_MUST_INSTALL_045_AND_051');
    for(const row of markers)assert.equal(row.checksum_sha256,checksums.get(row.migration_id));
    assert.deepEqual(applied.filter(row=>!chain.includes(row.migration_id)),before);assert.equal((await verificationColumn(pool)).length,1);
    for(const mode of ['apply','check'] as const){
      assert.deepEqual(await migrateWorkbenchVerifiedManualReports({databaseUrl,mode}),{status:'NOOP_ALREADY_APPLIED',migration_id:root});
      assert.deepEqual(await ledger(pool),applied);
    }
    await bootstrap();
    // Fault injection changes only this disposable database's migration ledger, never business facts or SQL files.
    for(const id of chain){
      await pool.query('UPDATE platform.schema_migration SET checksum_sha256=$2 WHERE migration_id=$1',[id,'0'.repeat(64)]);
      const corrupted=await ledger(pool);
      try{for(const mode of ['check','apply'] as const){await assert.rejects(migrateWorkbenchVerifiedManualReports({databaseUrl,mode}),refused);assert.deepEqual(await ledger(pool),corrupted);}}
      finally{await pool.query('UPDATE platform.schema_migration SET checksum_sha256=$2 WHERE migration_id=$1',[id,checksums.get(id)]);}
      assert.deepEqual(await ledger(pool),applied);
    }
  },{workbenchManualReportsEnabled:true,workbenchReporterCandidatesEnabled:false});
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'t18no042',run:async(context:Database)=>{
    await applyThrough030(context);const before=await ledger(context.pool);
    assert.equal(before.some(row=>row.migration_id==='042_workbench_manual_reports'||chain.includes(row.migration_id)),false);
    for(const mode of ['check','apply'] as const){await assert.rejects(migrateWorkbenchVerifiedManualReports({databaseUrl:context.databaseUrl,mode}),refused);assert.deepEqual(await ledger(context.pool),before);assert.deepEqual(await verificationColumn(context.pool),[]);}
  }});
});
