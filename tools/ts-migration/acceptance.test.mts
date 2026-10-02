import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { record, sourceRoot, strings } from './common.mjs';
import { ACCEPTANCE_PATH, currentAcceptance } from './current-acceptance.mjs';

test('current acceptance CLI accounts for all registered files and identifies historical scope separately', () => {
  const root=sourceRoot();
  const result=spawnSync(process.execPath,[path.join(root,'.build/tools/run-tests.mjs'),'--current-plan'],{
    cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000,
  });
  assert.equal(result.status,0,result.stdout+result.stderr);
  const plan=record(JSON.parse(result.stdout) as unknown);
  const current=strings(plan.current_files),historical=strings(plan.historical_registered_files);
  assert.equal(current.length,214);assert.deepEqual(historical,['tests/yxx-ss-008-validation-scope.test.mjs']);
  assert.equal(new Set([...current,...historical]).size,215);
  assert.ok(current.includes('tests/yxx-current-readiness.test.mts'));
  assert.ok(current.includes('tests/yxx-current-evidence.test.mts'));
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
    for(const file of ['plans/typescript-migration/test-routing.json','tests/yxx-current-evidence.test.mts'])copyFileSync(path.join(source,file),path.join(root,file));
    assert.equal(currentAcceptance(root).current_files.length,214);
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
