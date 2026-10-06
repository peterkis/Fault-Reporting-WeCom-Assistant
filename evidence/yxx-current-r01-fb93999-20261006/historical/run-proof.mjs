import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url)),root='C:/Users/zqpet/.codex/artifacts/yxx-current-readiness-20261002/historical-ss009-proof-01/checkout';
const api=JSON.parse(readFileSync(path.join(out,'github-pr19.json'),'utf8'));
assert.equal(api.head,'41edd855e7bc55149facb6a4b2e0076776c22e66');
assert.equal(api.base,'375d47b013017edb858206cc5f3475c9aed77dfd');assert.equal(api.merged,true);
const allowed=/^(?:path|systemroot|windir|comspec|pathext|temp|tmp|userprofile|appdata|localappdata|homedrive|homepath|home|programfiles(?:\(x86\))?|psmodulepath|pythonpath)$/i;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key)));
env.GIT_NO_REPLACE_OBJECTS='1';env.NO_COLOR='1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ref=file=>{const bytes=readFileSync(path.join(out,file));return {path:file,bytes:bytes.length,sha256:hash(bytes)};};
const records=[];
function run(name,args){
  const r=spawnSync(process.execPath,args,{cwd:root,env,windowsHide:true,timeout:300000,maxBuffer:32*1024*1024});
  writeFileSync(path.join(out,name+'.stdout'),r.stdout??Buffer.alloc(0));writeFileSync(path.join(out,name+'.stderr'),r.stderr??Buffer.alloc(0));
  const record={name,command:['node',...args],exit_code:r.status,signal:r.signal,error_code:r.error?.code??null,stdout:ref(name+'.stdout'),stderr:ref(name+'.stderr')};
  records.push(record);writeFileSync(path.join(out,name+'.json'),JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify({name,exit_code:r.status,error_code:record.error_code}));
  assert.ifError(r.error);assert.equal(r.status,0,name);
}
let passed=false;
try{
  run('preflight',['.github/review/verify-published-history.mjs','--expected-head',api.head]);
  run('strict',['scripts/validate-yxx-self-service.mjs','--require-ready']);
  run('regression',['--test','--test-concurrency=1','--test-reporter=tap','--test-reporter-destination=stdout',
    '--test-reporter=./scripts/p2-g2-case-reporter.mjs','--test-reporter-destination='+path.join(out,'regression.cases.jsonl'),
    'tests/yxx-ss-008-validation-scope.test.mjs','tests/yxx-ss-009-evidence.test.mjs','tests/yxx-ss-009-evidence-history.test.mjs','tests/yxx-ss-009-governance.test.mjs']);
  run('r6-probe',['.github/review/ss009-evidence-history-probe.mjs']);
  const list=spawnSync(process.execPath,['--input-type=module','-e',"import {SS009_VALIDATORS} from './src/yxx-self-service-verification.mjs';console.log(JSON.stringify(SS009_VALIDATORS));"],{cwd:root,env,encoding:'utf8',windowsHide:true});
  assert.equal(list.status,0);const validators=JSON.parse(list.stdout);assert.ok(Array.isArray(validators));
  for(const name of validators)run('validator-'+name.replace(/\.mjs$/u,''),['scripts/'+name]);
  passed=true;
}finally{
  const state=spawnSync('git',['status','--porcelain'],{cwd:root,env,encoding:'utf8',windowsHide:true});
  const clean=state.status===0&&state.stdout.trim()==='';
  writeFileSync(path.join(out,'proof.json'),JSON.stringify({schema_version:1,kind:'HISTORICAL_SS009_PROOF',head:api.head,base:api.base,
    github_metadata:ref('github-pr19.json'),status:passed&&clean?'PASS':'FAIL',checkout_clean:clean,node_version:process.version,
    historical_only:true,production_ready:false,records},null,2)+'\n');
  assert.ok(clean,'historical checkout changed');
}
