import assert from 'node:assert/strict';
import {withP2016IsolatedDatabase} from './p2-016-postgres-harness.mjs';
import {createPostgresPool} from '../../src/platform/postgres-pool.mjs';
import {g2EvidenceTime} from '../../src/p2-g2-evidence-time.mjs';
import {g2CandidateInventory} from '../../src/p2-g2-candidate.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
export const closeSS009Resources=closeBrowserTestResources;

export async function withSS009Database({testContext,databaseUrl,run,...options}){
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname));
  const observers=[];let name,ownedPool;
  const result=await withP2016IsolatedDatabase({databaseUrl,...options,run:async context=>{
    name=context.databaseName;ownedPool=context.pool;
    return run({...context,observeResource:(resource,observe)=>observers.push({resource,observe})});
  }});
  assert.match(name,/^p2_015_[a-z0-9]+_[a-f0-9_]+$/u);
  const control=createPostgresPool({connectionString:databaseUrl,max:1,application_name:'ss009_cleanup_observer'});let databaseCount,backendCount;
  try{databaseCount=(await control.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[name])).rows[0].n;
    backendCount=(await control.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=$1',[name])).rows[0].n;
  }finally{await control.end();}
  const resources=[{resource:'owned_database',remaining:databaseCount},{resource:'owned_database_backends',remaining:backendCount},{resource:'fixture_pool',remaining:ownedPool.totalCount},{resource:'cleanup_observer_pool',remaining:control.totalCount},...observers.map(({resource,observe})=>({resource,remaining:observe()}))];
  for(const r of resources)assert.equal(r.remaining,0,r.resource);
  testContext.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),kind:'cleanup',status:'PASS',candidate_fingerprint:g2CandidateInventory(process.cwd()).fingerprint,resources,scope:'OWNED_RUN_RESOURCES_ONLY',preexisting_resources_touched:false}));
  return result;
}
