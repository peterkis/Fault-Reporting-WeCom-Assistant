// Historical r5 fixture experiment, NOT a new candidate readiness certificate.
// Pin the legacy and fixed full validators to their actual commits so moving
// the active evidence prefix to r6 cannot invalidate this historical experiment.
// Independently exercise the CURRENT shared helper on both inputs as well.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {verifyYxxCaseTrace,evidenceHash} from '../../src/yxx-self-service-verification.mjs';
import {G2_ROOT,g2CandidateInventory} from '../../src/p2-g2-candidate.mjs';
import {createG2SourceAudit} from '../../src/p2-g2-source-audit.mjs';

const BASELINE='7535ea9db15ac0e0565ac83ae7bfa0fc28a63184';
const FIX='9bee25cab09ae10cd1e0d02c52db0364791818d9';
const PREFIX='evidence/yxx-ss-009-r5-';
const TARGET='tests/p1-012-pilot-e2e-integration.test.mjs';
const lf=text=>text.replaceAll('\r\n','\n');
const before=g2CandidateInventory().fingerprint;
const owned=path.join(G2_ROOT,'tmp','ss009-file-coverage-fixture-'+randomUUID());
const checker=path.join(G2_ROOT,'tmp','ss009-file-coverage-checker-'+randomUUID());
const git=args=>execFileSync('git',args,{cwd:G2_ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const read=file=>JSON.parse(readFileSync(path.join(owned,file),'utf8'));
const text=file=>lf(readFileSync(path.join(owned,file),'utf8'));
const write=(file,data)=>writeFileSync(path.join(owned,file),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
const reportPath=PREFIX+'report.json';
const experiments=[],created=[];
const assertOwned=root=>assert.match(path.relative(path.join(G2_ROOT,'tmp'),root),/^ss009-file-coverage-(fixture|checker)-[a-f0-9-]{36}$/u);

function legacy(){
  const result=spawnSync(process.execPath,['scripts/validate-yxx-self-service.mjs','--require-ready'],{
    cwd:owned,encoding:'utf8',windowsHide:true,timeout:60_000,
  });
  assert.ifError(result.error);assert.equal(result.signal,null);
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const output=JSON.parse(result.stdout);
  assert.equal(output.status,'SS009_LOCAL_VERIFICATION_COMPLETE');
  return {exit_code:result.status,output};
}

// Rehash the entire reachable r5 reference graph bottom-up. This deliberately
// prevents stale dependent hashes from masquerading as a successful rejection.
function rehashReport(report){
  const finished=new Map(),active=new Set();
  function visit(value){
    if(!value||typeof value!=='object')return;
    if(typeof value.path==='string'&&value.path.startsWith(PREFIX)&&typeof value.sha256==='string'){
      value.sha256=hashFile(value.path);
    }
    for(const child of Object.values(value))visit(child);
  }
  function hashFile(file){
    assert.match(file,/^evidence\/yxx-ss-009-r5-[a-zA-Z0-9_.-]+$/u);
    if(finished.has(file))return finished.get(file);
    assert.ok(!active.has(file),'cyclic fixture reference: '+file);active.add(file);
    let bytes;
    if(file.endsWith('.json')){
      const value=read(file);visit(value);write(file,value);bytes=Buffer.from(text(file));
    }else bytes=file.endsWith('.png')?readFileSync(path.join(owned,file)):Buffer.from(text(file));
    const hash=evidenceHash(bytes);active.delete(file);finished.set(file,hash);return hash;
  }
  visit(report);write(reportPath,report);
  return finished.size;
}

try{
  for(const [root,commit] of [[owned,BASELINE],[checker,FIX]]){
    assertOwned(root);git(['worktree','add','--detach',root,commit]);created.push(root);
  }
  const {validateYxxSelfService:fixedValidator}=await import(pathToFileURL(path.join(checker,'src/yxx-self-service-verification.mjs')).href);
  copyFileSync(path.join(G2_ROOT,'.gitignore'),path.join(owned,'.gitignore'));
  const original=read(reportPath),run=read(original.run.path),cases=text(original.case_trace.path).trim().split('\n').map(JSON.parse);
  const fileExecution=run.files.map(file=>{const pass=cases.filter(c=>c.file===file.path&&c.event==='test:pass'&&!c.skip&&!c.todo).length;return {path:file.path,total:pass,pass,fail:0,skipped:0,todo:0};});
  const currentRun={...run,file_execution:fileExecution};
  const originalTap=text(original.tap.path),targets=cases.filter(c=>c.file===TARGET);
  assert.equal(targets.length,1);assert.equal(targets[0].nesting,0);
  assert.equal(new Set(cases.map(c=>c.file)).size,run.files.length);
  const matrix=read(original.matrix.path),historical=read(original.historical_coverage.path);
  const mappings=[...matrix.scenarios.flatMap(s=>s.tests),...historical.bindings.flatMap(b=>b.scenarios.flatMap(s=>s.tests))];
  assert.ok(!mappings.some(t=>t.file===TARGET||t.name===targets[0].name));
  const positive=legacy();
  assert.equal(fixedValidator({root:owned,requireReady:true}).status,'SS009_LOCAL_VERIFICATION_COMPLETE');
  assert.doesNotThrow(()=>verifyYxxCaseTrace({cases,run:currentRun,tap:originalTap}));
  experiments.push({case:'original historical r5 positive control',legacy:positive,
    fixed:'ACCEPTED_HISTORICAL_FIXTURE',current_helper:'ACCEPTED',observed_files:run.files.length,observed_cases:cases.length});

  const target=targets[0],blocks=originalTap.split(/(?=^# Subtest: )/mu);
  const removed=blocks.filter(block=>block.startsWith('# Subtest: '+target.name+'\n'));
  assert.equal(removed.length,1);assert.ok(!removed[0].includes('SS009_RECEIPT'));
  assert.equal((removed[0].match(/^ok \d+ - /gmu)??[]).length,1);
  let tap=blocks.filter(block=>block!==removed[0]).join('');
  tap=tap.replace(/^# (tests|pass) (\d+)$/gmu,(_,key,n)=>'# '+key+' '+(Number(n)-1));
  // Keep the genuine TAP top-level plan and numbering coherent as well.
  const topLevel=(tap.match(/^ok \d+ - /gmu)??[]).length;let number=0;
  tap=tap.replace(/^ok \d+ - /gmu,()=>'ok '+(++number)+' - ');
  tap=tap.replace(/^1\.\.\d+$/gmu,'1..'+topLevel);
  const missing=cases.filter(c=>c.file!==TARGET),updated=structuredClone(currentRun),report=structuredClone(original);
  updated.counts.tests--;updated.counts.pass--;
  assert.ok(updated.counts.tests>=1155);
  const trace=missing.map(row=>JSON.stringify(row)).join('\n')+'\n';
  updated.stdout_sha256=evidenceHash(tap);updated.case_trace_sha256=evidenceHash(trace);
  write(report.tap.path,tap);write(report.case_trace.path,trace);write(report.run.path,updated);
  write(report.source_audit.path,createG2SourceAudit({tap,run:updated,root:owned}));
  report.full_regression={...updated.counts,test_files:updated.files.length,candidate_unchanged:updated.candidate_unchanged};
  const rehashed=rehashReport(report);
  assert.deepEqual(updated.files,run.files);
  const omittedLegacy=legacy();
  const expected={code:'SS009_TEST_FILE_EXECUTION_REQUIRED',missing_files:[TARGET]};
  assert.throws(()=>fixedValidator({root:owned,requireReady:true}),expected);
  assert.throws(()=>verifyYxxCaseTrace({cases:missing,run:updated,tap}),expected);
  experiments.push({case:'entire unmapped test file omitted with consistent counts and all dependent hashes',
    legacy:omittedLegacy,fixed:'REJECTED',current_helper:'REJECTED',error_code:expected.code,
    missing_files:[TARGET],rehashed_artifacts:rehashed,listed_files:updated.files.length,
    observed_files:new Set(missing.map(c=>c.file)).size,observed_cases:missing.length});

  assert.equal(g2CandidateInventory().fingerprint,before);
}finally{
  const errors=[];
  for(const root of created.toReversed()){
    try{assertOwned(root);git(['worktree','remove','--force',root]);}catch(error){errors.push(error);}
  }
  if(errors.length)throw new AggregateError(errors,'OWNED_PROBE_WORKTREE_CLEANUP_FAILED');
}
assert.equal(g2CandidateInventory().fingerprint,before);
console.log(JSON.stringify({status:'FILE_COVERAGE_REGRESSION_PROBE_PASS',
  historical_fixture_commit:BASELINE,historical_fixed_validator_commit:FIX,
  candidate_fingerprint:before,experiments,candidate_unchanged:true,owned_worktrees_removed:true,
  current_candidate_full_regression:'NOT_RUN_BY_THIS_PROBE',
  current_candidate_strict_readiness:'NOT_CLAIMED_BY_THIS_PROBE'},null,2));
