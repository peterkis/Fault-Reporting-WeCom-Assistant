import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, hash, record, safeFile, sourceRoot, strings } from './common.mjs';
import { currentShardPlan } from './current-acceptance.mjs';
import { counts, type Counts } from './run-tests.mjs';

// CI collection integrity only. Strict readiness separately verifies the complete
// acceptance packet, execution provenance, reviews, history and cleanup receipts.
export function verifyCurrentShards(root:string,directory:string,count:string,expectedHead:string):{status:string;files:number;counts:Counts;readiness:false} {
  assert.match(expectedHead,/^[a-f0-9]{40}$/u);
  assert.equal(git(root,['rev-parse','HEAD']),expectedHead);
  const tree=git(root,['rev-parse','HEAD^{tree}']),plan=currentShardPlan(root,count);
  const total:Counts={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
  const seen:string[]=[];let commonManifest:string|undefined;
  for(const [index,shard] of plan.shards.entries()){
    const prefix=`shard-${index+1}/`,manifest=readFileSync(safeFile(directory,prefix+'build-manifest.json'));
    const digest=hash(manifest),identity=record(record(JSON.parse(manifest.toString('utf8')) as unknown).source);
    assert.equal(identity.head,expectedHead);assert.equal(identity.tree,tree);assert.equal(identity.dirty,false);
    if(commonManifest===undefined)commonManifest=digest;else assert.equal(digest,commonManifest);
    const run=record(JSON.parse(readFileSync(safeFile(directory,prefix+'tests/summary.json'),'utf8')) as unknown);
    assert.equal(run.selection,`yxx-current-shard-${shard.id}`);assert.equal(run.status,'SELECTED_TESTS_PASS');
    assert.equal(run.representation,'EXPLICIT_ROUTED_HOSTS');assert.equal(run.production_ready,false);
    assert.equal(run.manifest_sha256,digest);assert.deepEqual(run.not_run,[]);
    assert.deepEqual(strings(run.selected_files),shard.files);assert.ok(Array.isArray(run.files));
    const files=run.files.map(record);assert.deepEqual(files.map(file=>file.path),shard.files);
    const subtotal:Counts={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
    for(const file of files){
      assert.equal(file.status,'PASS');assert.equal(file.exit_code,0);assert.equal(file.signal,null);
      let tap:string|undefined;
      for(const kind of ['tap','stderr','case_trace']){
        const name=file[kind+'_path'];assert.equal(typeof name,'string');assert.ok(typeof name==='string');
        assert.match(name,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
        const bytes=readFileSync(safeFile(directory,prefix+'tests/'+name));
        assert.equal(bytes.length,file[kind+'_bytes']);assert.equal(hash(bytes),file[kind+'_sha256']);
        if(kind==='tap')tap=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      }
      assert.ok(tap!==undefined);const actual=counts(tap);
      assert.ok(actual.tests>0);assert.equal(actual.pass,actual.tests);
      for(const key of ['fail','cancelled','skipped','todo'] as const)assert.equal(actual[key],0);
      assert.deepEqual(file.counts,actual);
      for(const key of Object.keys(subtotal) as (keyof Counts)[])subtotal[key]+=actual[key];
    }
    assert.deepEqual(run.counts,subtotal);seen.push(...shard.files);
    for(const key of Object.keys(total) as (keyof Counts)[])total[key]+=subtotal[key];
  }
  assert.deepEqual(seen.sort(),plan.current_files);assert.equal(new Set(seen).size,seen.length);
  return {status:'CURRENT_CI_SHARDS_COMPLETE',files:seen.length,counts:total,readiness:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [directory,shards,count,expected,head,...extra]=process.argv.slice(2);
  assert.ok(directory&&shards==='--shards'&&count&&expected==='--expected-head'&&head&&extra.length===0,'CURRENT_SHARDS_ARGUMENTS');
  console.log(JSON.stringify(verifyCurrentShards(sourceRoot(),path.resolve(directory),count,head)));
}
