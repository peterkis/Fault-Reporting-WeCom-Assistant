import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {testRoots} from './helpers/migration-roots.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {checkSS010} from '../src/yxx-self-service-readiness.mjs';
import {verifyCurrentYxxExecution,verifyCurrentYxxReviews,verifyCurrentYxxCleanup} from '../src/yxx-current-evidence.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';

function syntheticExecution(root:string){
  const digest=(bytes:Buffer):string=>createHash('sha256').update(bytes).digest('hex');
  const save=(file:string,value:string|object)=>{
    const bytes=Buffer.from(typeof value==='string'?value:JSON.stringify(value));
    mkdirSync(path.dirname(path.join(root,file)),{recursive:true});writeFileSync(path.join(root,file),bytes);
    return {path:file,sha256:digest(bytes),bytes:bytes.length};
  };
  const declared='tests/synthetic.test.mjs',directory='evidence/yxx-current-fixture/current';
  const historical='tests/yxx-ss-008-validation-scope.test.mjs';
  const code='// Synthetic parser fixture, not evidence of a real acceptance run.\n';
  const input=save(declared,code),output=save('.build/runtime/'+declared,code);
  const inputs=[{path:declared,sha256:input.sha256}];
  const manifest={schema_version:1,status:'STAGED_NOT_ACTIVATED',node_major:24,compiler:'5.9.3',
    source:{head:'a'.repeat(40),tree:'b'.repeat(40),dirty:false,inputs,input_hash:digest(Buffer.from(JSON.stringify(inputs)))},
    outputs:[{source:declared,path:declared,kind:'LEGACY',sha256:output.sha256}]};
  const build=save('evidence/yxx-current-fixture/build-manifest.json',manifest);save('.build/runtime/build-manifest.json',manifest);
  save('plans/yxx-current-readiness-acceptance.json',{schema_version:1,contract:'ADR-0027',live_authorized:false,current_files:[declared],historical_registered_files:[historical]});
  save('plans/typescript-migration/test-routing.json',{entries:[{path:declared,mode:'STAGED_RUNTIME'},{path:historical,mode:'SOURCE_HOST'}]});
  const tap=save(directory+'/one.tap','TAP version 13\nok 1 - synthetic consistency case\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n');
  const stderr=save(directory+'/one.stderr','');
  const trace=save(directory+'/one.cases.jsonl',JSON.stringify({...g2EvidenceTime(),time_basis:'REPORTER_OBSERVED_AT',event:'test:pass',name:'synthetic consistency case',file:declared,line:1,nesting:0,skip:false,todo:false})+'\n');
  const counts={tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0};
  const notRun:string[]=[];
  const document={status:'SELECTED_TESTS_PASS',representation:'EXPLICIT_ROUTED_HOSTS',production_ready:false,manifest_sha256:build.sha256,
    selected_files:[declared],not_run:notRun,counts,files:[{path:declared,status:'PASS',exit_code:0,signal:null,counts,
      mode:'STAGED_RUNTIME',execution_cwd:'.build/runtime',executed_path:'.build/runtime/'+declared,
      runtime_path:declared,source_sha256:input.sha256,executed_sha256:output.sha256,
      case_line_basis:'EXECUTED_FILE',case_count:1,loaded_project_files:['.build/runtime/'+declared],
      case_trace_path:'one.cases.jsonl',case_trace_sha256:trace.sha256,case_trace_bytes:trace.bytes,
      tap_path:'one.tap',tap_sha256:tap.sha256,tap_bytes:tap.bytes,stderr_path:'one.stderr',stderr_sha256:stderr.sha256,stderr_bytes:stderr.bytes}]};
  const report={run_id:'fixture',tested_head:manifest.source.head,tested_tree:manifest.source.tree,build,current_runs:[save(directory+'/summary.json',document)]};
  return {report,document,save,tap:path.join(root,tap.path),commit:()=>{report.current_runs[0]=save(directory+'/summary.json',document);}};
}

test('review evidence requires distinct axes reviewers and exact candidate binding',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-review-proof-'));
  try{
    const fixture=syntheticExecution(root),identity={tested_head:'a'.repeat(40),tested_tree:'b'.repeat(40),candidate_fingerprint:'c'.repeat(64)};
    const review=(axis:string,reviewer:string)=>({schema_version:1,...g2EvidenceTime(),...identity,axis,reviewer,independent:true,
      verdict:'PASS',unresolved_findings:0,historical_limitations_reviewed:true,findings:[]});
    const spec=review('SPEC','synthetic-spec'),standards=review('STANDARDS','synthetic-standards');
    const verify=(second:object)=>verifyCurrentYxxReviews(root,{run_id:'fixture',...identity,reviews:[
      fixture.save('evidence/yxx-current-fixture/review-spec.json',spec),fixture.save('evidence/yxx-current-fixture/review-standards.json',second)]});
    verify(standards);
    for(const changed of [{...standards,reviewer:spec.reviewer},{...standards,reviewer:spec.reviewer+' '},
      {...standards,reviewer:spec.reviewer.toUpperCase()},{...standards,axis:'SPEC'},
      {...standards,tested_head:'d'.repeat(40)},{...standards,independent:false},{...standards,verdict:'NOT_RUN'},
      {...standards,historical_limitations_reviewed:false},{...standards,findings:[{resolved:false}]}]){
      assert.throws(()=>verify(changed),{code:'CURRENT_REVIEW_INVALID'});
    }
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-review-proof-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('cleanup proof requires measured zero residuals and matching successful environment cleanup',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-cleanup-proof-'));
  try{
    const fixture=syntheticExecution(root),file=fixture.document.files[0];assert.ok(file);
    const identity={tested_head:fixture.report.tested_head,tested_tree:fixture.report.tested_tree,candidate_fingerprint:'c'.repeat(64)};
    const resources=['owned_database','owned_database_backends','owned_child','app_pool','worker_process','browser_process','browser_profile','browser_command_timers'].map(resource=>({resource,remaining:0}));
    const originalTap=readFileSync(fixture.tap,'utf8');
    const capture=()=>{
      const receipt={...g2EvidenceTime(),kind:'cleanup',scope:'OWNED_RUN_RESOURCES_ONLY',preexisting_resources_touched:false,resources};
      const ref=fixture.save('evidence/yxx-current-fixture/current/one.tap',originalTap+'# SS009_RECEIPT '+JSON.stringify(receipt)+'\n');
      file.tap_sha256=ref.sha256;file.tap_bytes=ref.bytes;fixture.commit();
      const summary=fixture.report.current_runs[0];assert.ok(summary);return summary.sha256;
    };
    const environment={schema_version:1,...g2EvidenceTime(),...identity,kind:'OWNED_TEST_ENVIRONMENT',status:'CLEANUP_CONFIRMED',
      execution_summary_sha256:capture(),owned_residuals:0,preexisting_resources_touched:false,test_exit_code:0,
      postgres_stop_exit_code:0,postgres_stopped:true,postgres_data_removed:true};
    const verify=(env:object,observations=[{tap_path:'evidence/yxx-current-fixture/current/one.tap',receipt_index:0}])=>{
      const cleanup=fixture.save('evidence/yxx-current-fixture/cleanup.json',{schema_version:1,...g2EvidenceTime(),...identity,
        kind:'CURRENT_OWNED_RESOURCE_CLEANUP',observations,environments:[fixture.save('evidence/yxx-current-fixture/environment.json',env)]});
      verifyCurrentYxxCleanup(root,{...fixture.report,...identity,cleanup});
    };
    verifyCurrentYxxExecution(root,fixture.report);verify(environment);
    for(const changed of [{...environment,postgres_stopped:false},{...environment,postgres_data_removed:false},
      {...environment,execution_summary_sha256:'0'.repeat(64)},{...environment,tested_head:'d'.repeat(40)},
      {...environment,test_exit_code:1},{...environment,preexisting_resources_touched:true}]){
      assert.throws(()=>verify(changed),{code:'CURRENT_CLEANUP_INVALID'});
    }
    assert.throws(()=>verify(environment,[]),{code:'CURRENT_CLEANUP_INVALID'});
    const resource=resources[0];assert.ok(resource);resource.remaining=1;environment.execution_summary_sha256=capture();
    assert.throws(()=>verify(environment),{code:'CURRENT_CLEANUP_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-cleanup-proof-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('execution proof binds executed bytes to the archived build and matching source input',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-execution-unit-'));
  try{
    const fixture=syntheticExecution(root);verifyCurrentYxxExecution(root,fixture.report);
    const file=fixture.document.files[0];assert.ok(file);file.executed_sha256='0'.repeat(64);fixture.commit();
    assert.throws(()=>verifyCurrentYxxExecution(root,fixture.report),{code:'CURRENT_EXECUTION_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-execution-unit-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('execution proof rejects a missing case even when the replacement trace hash matches',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-execution-unit-'));
  try{
    const fixture=syntheticExecution(root);verifyCurrentYxxExecution(root,fixture.report);
    const trace=fixture.save('evidence/yxx-current-fixture/current/one.cases.jsonl',''),file=fixture.document.files[0];assert.ok(file);
    file.case_trace_bytes=trace.bytes;file.case_trace_sha256=trace.sha256;file.case_count=0;fixture.commit();
    assert.throws(()=>verifyCurrentYxxExecution(root,fixture.report),{code:'CURRENT_EXECUTION_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-execution-unit-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('execution proof rejects consistent hashes with failing counts omitted work or misbound cases',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-execution-unit-'));
  type Fixture=ReturnType<typeof syntheticExecution>;
  const row=(fixture:Fixture)=>{const value=fixture.document.files[0];assert.ok(value);return value;};
  const changes:Array<[string,(fixture:Fixture)=>void]>=[
    ['aggregate counts',f=>{f.document.counts={...f.document.counts,tests:2,pass:2};f.commit();}],
    ['file counts',f=>{row(f).counts.tests=2;row(f).counts.pass=2;f.commit();}],
    ['not run',f=>{f.document.not_run.push(row(f).path);f.commit();}],
    ['duplicate shard',f=>{const ref=f.report.current_runs[0];assert.ok(ref);f.report.current_runs.push(ref);}],
    ['wrong execution root',f=>{row(f).execution_cwd='.';f.commit();}],
    ['source fallback',f=>{row(f).loaded_project_files.push('src/uncompiled.mjs');f.commit();}],
    ['path traversal',f=>{row(f).tap_path='../one.tap';f.commit();}],
    ['stderr bytes',f=>{f.save('evidence/yxx-current-fixture/current/one.stderr','changed');}],
    ['rehashed failing TAP',f=>{
      const ref=f.save('evidence/yxx-current-fixture/current/one.tap',readFileSync(f.tap,'utf8').replace('ok 1','not ok 1'));
      row(f).tap_sha256=ref.sha256;row(f).tap_bytes=ref.bytes;f.commit();
    }],
    ['rehashed wrong case',f=>{
      const ref=f.save('evidence/yxx-current-fixture/current/one.cases.jsonl',JSON.stringify({...g2EvidenceTime(),time_basis:'REPORTER_OBSERVED_AT',
        event:'test:pass',name:'unexecuted case',file:row(f).path,line:1,nesting:0,skip:false,todo:false})+'\n');
      row(f).case_trace_sha256=ref.sha256;row(f).case_trace_bytes=ref.bytes;f.commit();
    }],
  ];
  try{
    for(const [name,mutate] of changes){
      const fixture=syntheticExecution(root);verifyCurrentYxxExecution(root,fixture.report);mutate(fixture);
      assert.throws(()=>verifyCurrentYxxExecution(root,fixture.report),{code:'CURRENT_EXECUTION_INVALID'},name);
    }
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-execution-unit-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('execution proof checks original TAP bytes instead of trusting PASS counts',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-execution-unit-'));
  try{
    const fixture=syntheticExecution(root);
    verifyCurrentYxxExecution(root,fixture.report);
    // This is a synthetic parser fixture; it can never satisfy actual readiness.
    assert.throws(()=>checkSS010({root,requireReady:true}));
    writeFileSync(fixture.tap,readFileSync(fixture.tap,'utf8').replace('ok 1','not ok 1'));
    assert.throws(()=>verifyCurrentYxxExecution(root,fixture.report),{code:'CURRENT_EXECUTION_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-execution-unit-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('strict current readiness rejects a PASS summary without the complete current execution set',()=>{
  const source=testRoots().sourceRoot,root=mkdtempSync(path.join(tmpdir(),'yxx-execution-evidence-'));
  const git=(args:string[]):string=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
  let attached=false;
  try{
    execFileSync('git',['worktree','add','--detach',root,'HEAD'],{cwd:source,windowsHide:true,stdio:'pipe'});attached=true;
    const digest=(bytes:Buffer):string=>createHash('sha256').update(bytes).digest('hex');
    const canonical=(file:string):string=>digest(Buffer.from(readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n')));
    const save=(file:string,value:unknown):{path:string;sha256:string;bytes:number}=>{
      const bytes=Buffer.from(JSON.stringify(value));mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
      writeFileSync(path.join(root,file),bytes);return {path:file,sha256:digest(bytes),bytes:bytes.length};
    };
    const run=save('evidence/yxx-current-fixture/current/summary.json',{
      status:'SELECTED_TESTS_PASS',selected_files:['tests/migration-canary.test.mts'],files:[],not_run:[],
      counts:{tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0},production_ready:false,
    });
    const header={
      schema_version:1,contract:'ADR-0027',run_id:'fixture',tested_head:git(['rev-parse','HEAD']),tested_tree:git(['rev-parse','HEAD^{tree}']),
      candidate_fingerprint:g2CandidateInventory(root).fingerprint,scope_sha256:canonical('plans/yxx-current-readiness-scope.json'),
      acceptance_sha256:canonical('plans/yxx-current-readiness-acceptance.json'),
    };
    const report=save('evidence/yxx-current-fixture/report.json',{...header,current_runs:[run]});
    save('plans/yxx-current-readiness.json',{schema_version:1,report});
    assert.throws(()=>checkSS010({root,requireReady:true}),{code:'CURRENT_EXECUTION_INVALID'});
    const noReviews=save('evidence/yxx-current-fixture/report.json',{...header,reviews:[]});
    save('plans/yxx-current-readiness.json',{schema_version:1,report:noReviews});
    assert.throws(()=>checkSS010({root,requireReady:true}),{code:'CURRENT_REVIEW_INVALID'});
    const cleanup=save('evidence/yxx-current-fixture/cleanup.json',{status:'PASS'});
    const unmeasured=save('evidence/yxx-current-fixture/report.json',{...header,cleanup});
    save('plans/yxx-current-readiness.json',{schema_version:1,report:unmeasured});
    assert.throws(()=>checkSS010({root,requireReady:true}),{code:'CURRENT_CLEANUP_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-execution-evidence-'));
    if(attached)execFileSync('git',['worktree','remove','--force',root],{cwd:source,windowsHide:true,stdio:'pipe'});
    else rmSync(root,{recursive:true,force:true});
  }
});
