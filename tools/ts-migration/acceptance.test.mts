import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { record, sourceRoot, strings } from './common.mjs';
import { ACCEPTANCE_PATH, currentAcceptance, currentSelection } from './current-acceptance.mjs';

test('current acceptance CLI accounts for all registered files and identifies historical scope separately', () => {
  const root=sourceRoot();
  const result=spawnSync(process.execPath,[path.join(root,'.build/tools/run-tests.mjs'),'--current-plan'],{
    cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000,
  });
  assert.equal(result.status,0,result.stdout+result.stderr);
  const plan=record(JSON.parse(result.stdout) as unknown);
  const current=strings(plan.current_files),historical=strings(plan.historical_registered_files);
  assert.equal(current.length,215);assert.deepEqual(historical,['tests/yxx-ss-008-validation-scope.test.mjs']);
  assert.equal(new Set([...current,...historical]).size,216);
  assert.ok(current.includes('tests/yxx-current-readiness.test.mts'));
  assert.ok(current.includes('tests/yxx-current-evidence.test.mts'));
  assert.ok(current.includes('tests/yxx-current-migrations.integration.test.mts'));
  assert.ok(current.includes('tests/yxx-ss-009-evidence-history.test.mjs'));
  assert.equal(plan.historical_head,'41edd855e7bc55149facb6a4b2e0076776c22e66');
  assert.deepEqual(plan.historical_strict_command,['node','scripts/validate-yxx-self-service.mjs','--require-ready']);
  assert.equal(plan.status,'EXECUTION_PLAN_NOT_READINESS');
});

test('current full runner requires an isolated database before starting execution', () => {
  const root=sourceRoot();
  const result=spawnSync(process.execPath,[path.join(root,'.build/tools/run-tests.mjs'),'--current-full'],{
    cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000,
    env:{...process.env,PILOT_DATABASE_URL:'',TS_MIGRATION_TEST_DB_ISOLATED:'0'},
  });
  assert.equal(result.status,1);assert.match(result.stderr,/MIGRATION_ISOLATED_DATABASE_REQUIRED/u);
});

test('acceptance planning rejects omitted files duplicate obligations and changed historical identity',()=>{
  const source=sourceRoot(),root=mkdtempSync(path.join(tmpdir(),'current-acceptance-'));
  const git=(args:string[]):void=>{execFileSync('git',args,{cwd:source,windowsHide:true,stdio:'pipe'});};
  let attached=false;
  try{
    git(['worktree','add','--detach',root,'HEAD']);attached=true;
    copyFileSync(path.join(source,ACCEPTANCE_PATH),path.join(root,ACCEPTANCE_PATH));
    for(const file of ['plans/typescript-migration/test-routing.json','tests/yxx-current-evidence.test.mts','tests/yxx-current-migrations.integration.test.mts'])copyFileSync(path.join(source,file),path.join(root,file));
    assert.equal(currentAcceptance(root).current_files.length,215);
    const doc=record(JSON.parse(readFileSync(path.join(root,ACCEPTANCE_PATH),'utf8')) as unknown),current=strings(doc.current_files);
    for(const changed of [{...doc,current_files:current.slice(1)},{...doc,current_files:[...current,current[0]]},
      {...doc,historical_head:'0'.repeat(40)},{...doc,historical_registered_files:[]}]){
      writeFileSync(path.join(root,ACCEPTANCE_PATH),JSON.stringify(changed));
      assert.throws(()=>currentAcceptance(root));
    }
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('current-acceptance-'));
    if(attached)git(['worktree','remove','--force',root]);else rmSync(root,{recursive:true,force:true});
  }
});

test('current shard plan partitions all 215 obligations exactly once and preserves historical separation',()=>{
  const root=sourceRoot();
  const run=(args:string[])=>spawnSync(process.execPath,[path.join(root,'.build/tools/run-tests.mjs'),...args],{
    cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000,
  });
  const result=run(['--current-plan','--shards','4']);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const plan=record(JSON.parse(result.stdout) as unknown);
  assert.ok(Array.isArray(plan.shards));assert.equal(plan.shards.length,4);
  const files=plan.shards.flatMap((value:unknown,index:number)=>{
    const shard=record(value);assert.equal(shard.id,`${index+1}/4`);
    const selection=currentSelection(root,`${index+1}/4`);
    assert.equal(selection.label,`yxx-current-shard-${index+1}/4`);
    assert.deepEqual(selection.entries.map(entry=>entry.path),shard.files);
    const selected=strings(shard.files);assert.ok(selected.length>=53&&selected.length<=54);
    return selected;
  });
  assert.equal(files.length,215);assert.equal(new Set(files).size,215);
  assert.deepEqual([...files].sort(),currentAcceptance(root).current_files);
  assert.ok(!files.includes('tests/yxx-ss-008-validation-scope.test.mjs'));
  assert.equal(run(['--current-plan','--shards','4']).stdout,result.stdout);
  for(const count of ['0','-1','17','1.5','04','NaN']){
    const invalid=run(['--current-plan','--shards',count]);
    assert.equal(invalid.status,1);assert.match(invalid.stderr,/MIGRATION_CURRENT_SHARD_INVALID/u);
  }
});

test('current shard execution validates its identity and isolation before building',()=>{
  const root=sourceRoot();
  const run=(args:string[])=>spawnSync(process.execPath,[path.join(root,'.build/tools/run-tests.mjs'),...args],{
    cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000,
    env:{...process.env,PILOT_DATABASE_URL:'',TS_MIGRATION_TEST_DB_ISOLATED:'0'},
  });
  for(const id of ['1/4','2/4','3/4','4/4']){
    const result=run(['--current-full','--shard',id]);
    assert.equal(result.status,1);assert.match(result.stderr,/MIGRATION_ISOLATED_DATABASE_REQUIRED/u);
  }
  for(const id of ['0/4','5/4','01/4','1/0','1/17','1.5/4','1']){
    const result=run(['--current-full','--shard',id]);
    assert.equal(result.status,1);assert.match(result.stderr,/MIGRATION_CURRENT_SHARD_INVALID/u);
  }
  for(const args of [['--shard','1/4'],['--current-full','--shard','1/4','--shard','2/4'],
    ['--current-full','--shard','1/4','--selection','canary']]){
    const result=run(args);assert.equal(result.status,1);assert.match(result.stderr,/MIGRATION_CURRENT_ARGUMENTS/u);
  }
});
