import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { record, sourceRoot, strings, hash, git } from './common.mjs';
import { ACCEPTANCE_PATH, currentAcceptance, currentSelection } from './current-acceptance.mjs';
import {closeOwnedPostgres} from './finalize-current-run.mjs';

test('owned PostgreSQL closure requires observed container and anonymous volume removal',()=>{
  const id='a'.repeat(64),volume='b'.repeat(64);
  const exercise=(remaining=false,foreign=false)=>{
    const calls:string[][]=[];
    const result=closeOwnedPostgres(id,args=>{
      calls.push(args);
      const stdout=args[0]==='inspect'&&args[2]?.includes('mounts')?JSON.stringify({id,image:'postgres:18',mounts:[{Type:foreign?'bind':'volume',Destination:'/var/lib/postgresql',RW:true,Name:volume,Source:'/var/lib/docker/volumes/'+volume+'/_data'}]}):
        args[0]==='inspect'?JSON.stringify({Running:false,ExitCode:0}):args[0]==='volume'&&remaining?volume+'\n':'';
      return {status:0,stdout,stderr:''};
    });
    return {result,calls};
  };
  const clean=exercise();assert.equal(clean.result.postgres_data_removed,true);assert.equal(clean.result.owned_residuals,0);
  assert.ok(clean.calls.some(args=>JSON.stringify(args)===JSON.stringify(['rm','--volumes',id])));
  const residual=exercise(true);assert.equal(residual.result.postgres_data_removed,false);assert.equal(residual.result.owned_residuals,1);assert.ok(residual.result.error_code);
  const foreign=exercise(false,true);assert.equal(foreign.result.postgres_data_removed,false);
  assert.equal(foreign.calls.some(args=>['stop','rm'].includes(args[0]??'')),false);
  const invalid=closeOwnedPostgres('unverified',()=>{throw Error('UNEXPECTED_DOCKER_CALL');});
  assert.equal(invalid.postgres_data_removed,false);assert.equal(invalid.commands.length,0);
});

test('current acceptance CLI accounts for all registered files and identifies historical scope separately', () => {
  const root=sourceRoot();
  const result=spawnSync(process.execPath,[path.join(root,'.build/tools/run-tests.mjs'),'--current-plan'],{
    cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000,
  });
  assert.equal(result.status,0,result.stdout+result.stderr);
  const plan=record(JSON.parse(result.stdout) as unknown);
  const current=strings(plan.current_files),historical=strings(plan.historical_registered_files);
  assert.equal(current.length,220);assert.deepEqual(historical,['tests/yxx-ss-008-validation-scope.test.mjs']);
  assert.equal(new Set([...current,...historical]).size,221);
  for(const file of ['tests/web01-workbench.test.mts','tests/web01-workbench.integration.test.mjs','tests/web01-workbench.browser.test.mjs'])assert.ok(current.includes(file));
  assert.ok(current.includes('tests/yxx-current-readiness.test.mts'));
  assert.ok(current.includes('tests/yxx-current-history.test.mts'));
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
    for(const file of ['plans/typescript-migration/test-routing.json','tests/yxx-current-evidence.test.mts','tests/yxx-current-history.test.mts','tests/helpers/yxx-current-scope-checkout.mts','tests/yxx-current-migrations.integration.test.mts','tests/yxx-current-readiness-cli.test.mts'])copyFileSync(path.join(source,file),path.join(root,file));
    assert.equal(currentAcceptance(root).current_files.length,220);
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

test('current shard plan partitions all 220 obligations exactly once and preserves historical separation',()=>{
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
    const selected=strings(shard.files);assert.equal(selected.length,55);
    return selected;
  });
  assert.equal(files.length,220);assert.equal(new Set(files).size,220);
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

test('CI shard collection validates all files and original logs and rejects incomplete or corrupt collections',()=>{
  const root=sourceRoot(),directory=mkdtempSync(path.join(tmpdir(),'current-shard-collection-'));
  try{
    const head=git(root,['rev-parse','HEAD']),tree=git(root,['rev-parse','HEAD^{tree}']);
    const manifest=Buffer.from(JSON.stringify({source:{head,tree,dirty:false},synthetic_collection_fixture:true}));
    const counts={tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0};
    const summaries:{file:string;text:string}[]=[];
    for(let index=1;index<=4;index++){
      const folder=path.join(directory,`shard-${index}`),tests=path.join(folder,'tests');mkdirSync(tests,{recursive:true});
      writeFileSync(path.join(folder,'build-manifest.json'),manifest);
      const selection=currentSelection(root,`${index}/4`);
      const files=selection.entries.map((entry,number)=>{
        const refs:Record<string,unknown>={};
        for(const [kind,bytes] of [['tap',Buffer.from('TAP version 13\n1..1\nok 1 - synthetic collection fixture\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')],['stderr',Buffer.alloc(0)],['case_trace',Buffer.from('{"synthetic_collection_fixture":true}\n')]] as const){
          const name=`${number}.${kind}`;writeFileSync(path.join(tests,name),bytes);
          Object.assign(refs,{[kind+'_path']:name,[kind+'_sha256']:hash(bytes),[kind+'_bytes']:bytes.length});
        }
        return {path:entry.path,status:'PASS',exit_code:0,signal:null,counts,...refs};
      });
      const file=path.join(tests,'summary.json'),text=JSON.stringify({selection:selection.label,status:'SELECTED_TESTS_PASS',
        representation:'EXPLICIT_ROUTED_HOSTS',manifest_sha256:hash(manifest),production_ready:false,
        selected_files:selection.entries.map(entry=>entry.path),files,not_run:[],counts:{...counts,tests:files.length,pass:files.length}});
      writeFileSync(file,text);summaries.push({file,text});
    }
    const run=()=>spawnSync(process.execPath,[path.join(root,'.build/tools/verify-current-shards.mjs'),directory,'--shards','4','--expected-head',head],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000});
    const positive=run();assert.equal(positive.status,0,positive.stdout+positive.stderr);
    const result=record(JSON.parse(positive.stdout) as unknown);assert.equal(result.files,220);assert.equal(result.readiness,false);
    const first=summaries[0];assert.ok(first);const original=record(JSON.parse(first.text) as unknown);
    for(const mutation of [{...original,not_run:['tests/missing.test.mjs']},{...original,selected_files:[]},
      {...original,selection:'yxx-current-shard-2/4'},{...original,counts:{...counts,tests:999}}]){
      writeFileSync(first.file,JSON.stringify(mutation));assert.equal(run().status,1);writeFileSync(first.file,first.text);
    }
    const tap=path.join(directory,'shard-1/tests/0.tap'),bytes=readFileSync(tap);writeFileSync(tap,'corrupted');
    assert.equal(run().status,1);writeFileSync(tap,bytes);
    const build=path.join(directory,'shard-1/build-manifest.json');writeFileSync(build,JSON.stringify({source:{head:'0'.repeat(40),tree,dirty:false}}));
    assert.equal(run().status,1);writeFileSync(build,manifest);
    rmSync(path.join(directory,'shard-4/tests/summary.json'));assert.equal(run().status,1);
  }finally{
    assert.equal(path.dirname(directory),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('current-shard-collection-'));
    rmSync(directory,{recursive:true,force:true});
  }
});
