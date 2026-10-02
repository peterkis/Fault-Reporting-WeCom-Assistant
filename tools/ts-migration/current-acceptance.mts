import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hash, record, safeFile, strings } from './common.mjs';
import { loadRoutes, type Selection } from './routing.mjs';

export const ACCEPTANCE_PATH='plans/yxx-current-readiness-acceptance.json';
export function currentAcceptance(root:string): {
  status:string; contract_sha256:string; current_files:string[]; historical_registered_files:string[];
  historical_head:string; historical_base:string; historical_strict_command:string[]; historical_regression_files:string[];
  live_authorized:false;
} {
  const text=readFileSync(safeFile(root,ACCEPTANCE_PATH),'utf8'),doc=record(JSON.parse(text) as unknown);
  assert.deepEqual(Object.keys(doc).sort(),['schema_version','contract','current_files','historical_registered_files',
    'historical_head','historical_base','historical_strict_command','historical_regression_files','live_authorized'].sort());
  assert.equal(doc.schema_version,1);assert.equal(doc.contract,'ADR-0027');assert.equal(doc.live_authorized,false);
  assert.equal(doc.historical_head,'41edd855e7bc55149facb6a4b2e0076776c22e66');
  assert.equal(doc.historical_base,'375d47b013017edb858206cc5f3475c9aed77dfd');
  const current=strings(doc.current_files),historical=strings(doc.historical_registered_files);
  assert.deepEqual(historical,['tests/yxx-ss-008-validation-scope.test.mjs']);
  assert.deepEqual([...current,...historical].sort(),loadRoutes(root).entries.map(entry=>entry.path).sort());
  assert.deepEqual(current,[...new Set(current)].sort());
  const historicalStrict=strings(doc.historical_strict_command),regressions=strings(doc.historical_regression_files);
  assert.deepEqual(historicalStrict,['node','scripts/validate-yxx-self-service.mjs','--require-ready']);
  assert.deepEqual(regressions,[...historical,'tests/yxx-ss-009-evidence.test.mjs',
    'tests/yxx-ss-009-evidence-history.test.mjs','tests/yxx-ss-009-governance.test.mjs']);
  return {status:'EXECUTION_PLAN_NOT_READINESS',contract_sha256:hash(text.replaceAll('\r\n','\n')),
    current_files:current,historical_registered_files:historical,historical_head:doc.historical_head,
    historical_base:doc.historical_base,historical_strict_command:historicalStrict,historical_regression_files:regressions,live_authorized:false};
}
export function currentSelection(root:string,shardId?:string):Selection {
  const plan=currentAcceptance(root),routes=loadRoutes(root);
  let files=plan.current_files;
  if(shardId!==undefined){
    if(!/^[1-9][0-9]*\/[1-9][0-9]*$/u.test(shardId))throw new Error('MIGRATION_CURRENT_SHARD_INVALID');
    const shard=currentShardPlan(root,shardId.split('/')[1]??'').shards.find(item=>item.id===shardId);
    if(!shard)throw new Error('MIGRATION_CURRENT_SHARD_INVALID');
    files=shard.files;
  }
  return {label:shardId===undefined?'yxx-current-full':`yxx-current-shard-${shardId}`,flags:[],entries:files.map(file=>{
    const entry=routes.entries.find(entry=>entry.path===file);assert.ok(entry);return entry;
  })};
}

export function currentShardPlan(root:string,countText:string):ReturnType<typeof currentAcceptance>&{shards:{id:string;files:string[]}[]} {
  if(!/^(?:[1-9]|1[0-6])$/u.test(countText))throw new Error('MIGRATION_CURRENT_SHARD_INVALID');
  const count=Number(countText),plan=currentAcceptance(root);
  if(count>plan.current_files.length)throw new Error('MIGRATION_CURRENT_SHARD_INVALID');
  const shards=Array.from({length:count},(_,index)=>({id:`${index+1}/${count}`,
    files:plan.current_files.filter((_,position)=>position%count===index)}));
  return {...plan,shards};
}
