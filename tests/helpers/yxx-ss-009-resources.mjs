import {assertLoopbackDatabaseUrl,loopbackFixtureUrl} from '../../app/server/src/platform/loopback-database.mjs';
import assert from 'node:assert/strict';
import {withP2016IsolatedDatabase} from './p2-016-postgres-harness.mjs';
import {createPostgresPool} from '../../app/server/src/platform/postgres-pool.mjs';
import {g2EvidenceTime} from '../../app/server/src/p2-g2-evidence-time.mjs';
import {g2CandidateInventory} from '../../app/server/src/p2-g2-candidate.mjs';
import {currentRuntimeFingerprint} from '../../app/server/src/yxx-current-evidence.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
import {migrateCurrentBaselineWithYxx} from '../../app/server/scripts/migrate-current-baseline.mjs';
import {migrateServiceClosure} from '../../app/server/scripts/service-closure-migrate.mjs';
import {migrateCompletionDismissal} from '../../app/server/scripts/completion-dismissal-migrate.mjs';
import {migrateNotificationVocabulary} from '../../app/server/scripts/notification-vocabulary-migrate.mjs';
import {migrateSystemClosureRestore} from '../../app/server/scripts/system-closure-restore-migrate.mjs';
import {migrateTicketTerminalAt} from '../../app/server/scripts/ticket-terminal-at-migrate.mjs';
import {applyFullSchemaThrough077,applyCard42cMigrations} from './full-schema-migrations.mjs';
export const closeSS009Resources=closeBrowserTestResources;

// Current runtime queries require these successors even when the tested flow is
// an older SS-009 scenario. Catalog-only tests keep their explicit historical chain.
export async function migrateSS009RuntimeSuccessors({databaseUrl}){
  for(const migrate of [migrateServiceClosure,migrateCompletionDismissal,migrateNotificationVocabulary,migrateSystemClosureRestore,migrateTicketTerminalAt]){
    await migrate({databaseUrl,mode:'apply'});
  }
}

export async function migrateSS009RuntimeDatabase({databaseUrl}){
  await applyFullSchemaThrough077(databaseUrl);
}
export {applyCard42cMigrations};

export async function withSS009Database({testContext,databaseUrl,run,candidateRoot,candidateRepresentation='SOURCE',...options}){
  assert.ok(['SOURCE','STAGED_RUNTIME'].includes(candidateRepresentation));
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname.toLowerCase()));
  const fixtureUrl=loopbackFixtureUrl(databaseUrl);
  const observers=[];let name,ownedPool;
  const result=await withP2016IsolatedDatabase({...options,databaseUrl:fixtureUrl,run:async context=>{
    name=context.databaseName;ownedPool=context.pool;
    return run({...context,observeResource:(resource,observe)=>observers.push({resource,observe})});
  }});
  assert.match(name,/^p2_015_[a-z0-9]+_[a-f0-9_]+$/u);
  const control=createPostgresPool({...assertLoopbackDatabaseUrl(fixtureUrl),max:1,application_name:'ss009_cleanup_observer'});let databaseCount,backendCount;
  try{databaseCount=(await control.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[name])).rows[0].n;
    backendCount=(await control.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n;
  }finally{await control.end();}
  const resources=[{resource:'owned_database',remaining:databaseCount},{resource:'owned_database_backends',remaining:backendCount},{resource:'fixture_pool',remaining:ownedPool.totalCount},{resource:'cleanup_observer_pool',remaining:control.totalCount},...observers.map(({resource,observe})=>({resource,remaining:observe()}))];
  for(const r of resources)assert.equal(r.remaining,0,r.resource);
  const fingerprint=candidateRepresentation==='STAGED_RUNTIME'?currentRuntimeFingerprint(candidateRoot):g2CandidateInventory(candidateRoot).fingerprint;
  testContext.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),kind:'cleanup',status:'PASS',candidate_fingerprint:fingerprint,resources,scope:'OWNED_RUN_RESOURCES_ONLY',preexisting_resources_touched:false}));
  return result;
}
