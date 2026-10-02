import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {testRoots} from './helpers/migration-roots.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {checkSS010} from '../src/yxx-self-service-readiness.mjs';
import {verifyCurrentYxxExecution,verifyCurrentYxxReviews,verifyCurrentYxxCleanup,verifyCurrentYxxHistoricalProof,verifyCurrentYxxSpecializedProof,deriveCurrentYxxSourceAudit,verifyCurrentYxxSourceAccounting} from '../src/yxx-current-evidence.mjs';
import {SS009_VALIDATORS} from '../src/yxx-self-service-verification.mjs';
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

test('source accounting preserves semantic limits and rejects missing execution or manual review even with fresh hashes',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-source-accounting-'));
  try{
    // Replay historical bytes as a parser fixture, never as current execution proof.
    const source=testRoots().sourceRoot,fixture=syntheticExecution(root),file=fixture.document.files[0];assert.ok(file);
    cpSync(path.join(source,'tests/fixtures'),path.join(root,'tests/fixtures'),{recursive:true});
    const original=readFileSync(path.join(source,'evidence/yxx-ss-009-r7-full.tap'),'utf8').replaceAll('\r\n','\n');
    const counts={tests:1205,pass:1205,fail:0,cancelled:0,skipped:0,todo:0};
    fixture.document.counts={...counts};file.counts={...counts};
    const report={...fixture.report,candidate_fingerprint:'c'.repeat(64)};
    const capture=(tap:string)=>{
      const ref=fixture.save('evidence/yxx-current-fixture/current/one.tap',tap);file.tap_sha256=ref.sha256;file.tap_bytes=ref.bytes;fixture.commit();
    };
    capture(original);
    const proof={schema_version:1,...g2EvidenceTime(),tested_head:report.tested_head,tested_tree:report.tested_tree,
      candidate_fingerprint:report.candidate_fingerprint,kind:'CURRENT_SOURCE_ACCOUNTING',derivation:'SORTED_FILE_TAP_WITH_RECOMPUTED_TOTALS_V1',
      source_audit:deriveCurrentYxxSourceAudit(root,report)};
    const verify=()=>verifyCurrentYxxSourceAccounting(root,{...report,source_accounting:fixture.save('evidence/yxx-current-fixture/source-accounting.json',proof)});
    verify();assert.equal(proof.source_audit.total_source_cases,202);assert.equal(proof.source_audit.observed_normal_pass_cases,122);
    assert.equal(proof.source_audit.original_semantics_all_passed,false);assert.throws(()=>checkSS010({root,requireReady:true}));
    proof.source_audit.original_semantics_all_passed=true;assert.throws(verify,{code:'CURRENT_SOURCE_ACCOUNTING_INVALID'});
    proof.source_audit=deriveCurrentYxxSourceAudit(root,report);verify();
    capture(original.replaceAll('C001','UNOBSERVED'));
    proof.source_audit=deriveCurrentYxxSourceAudit(root,report);
    assert.notEqual(proof.source_audit.observed_normal_pass_cases,122);assert.throws(verify,{code:'CURRENT_SOURCE_ACCOUNTING_INVALID'});
    capture(original.replaceAll('MANUAL_REVIEW','NO_MANUAL_ACTION'));
    proof.source_audit=deriveCurrentYxxSourceAudit(root,report);
    assert.notDeepEqual(proof.source_audit.manual_review_observation_missing,[]);assert.throws(verify,{code:'CURRENT_SOURCE_ACCOUNTING_INVALID'});
    capture(original);proof.source_audit=deriveCurrentYxxSourceAudit(root,report);verify();
    // Raw corruption remains rejected before any parsed coverage can be trusted.
    writeFileSync(fixture.tap,original+'changed');assert.throws(verify,{code:'CURRENT_SOURCE_ACCOUNTING_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-source-accounting-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('specialized proof binds raw observations and screenshots to the archived runtime candidate',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-specialized-proof-'));
  try{
    // Historical records/images are parser fixtures only, never current run evidence.
    const source=testRoots().sourceRoot,fixture=syntheticExecution(root),runtime=path.join(root,'.build/runtime');
    for(const dir of ['src','scripts','web','contracts','config_examples','database/migrations'])mkdirSync(path.join(runtime,dir),{recursive:true});
    for(const file of ['package.json','package-lock.json','.env.example'])fixture.save('.build/runtime/'+file,'{}');
    const fingerprint=g2CandidateInventory(runtime).fingerprint;
    const identity={tested_head:fixture.report.tested_head,tested_tree:fixture.report.tested_tree,candidate_fingerprint:'c'.repeat(64)};
    const historical=(kind:string)=>JSON.parse(readFileSync(path.join(source,'evidence/yxx-ss-009-r7-'+kind+'.json'),'utf8')) as {records:Record<string,unknown>[];receipts:Record<string,unknown>[]};
    let receipts:Record<string,unknown>[]=['fault','capacity','catalog','browser'].flatMap(kind=>historical(kind).records)
      .concat(historical('cleanup').receipts.filter(item=>item.kind==='cleanup')).map(item=>({...item,candidate_fingerprint:fingerprint}));
    const browser=receipts.find(item=>item.kind==='browser');assert.ok(browser);
    const limited={...browser,kind:undefined,real_postgres:true};
    const file=fixture.document.files[0];assert.ok(file);
    const observations:Array<{tap_path:string;channel:string;receipt_index:number}>=[];
    const images:Array<{observation:{tap_path:string;channel:string;receipt_index:number};width:number;height:number;artifact:{path:string;sha256:string;bytes:number}}>=[];
    const proof={schema_version:1,...g2EvidenceTime(),...identity,kind:'CURRENT_SPECIALIZED_PROOF',observations,images};
    const originalTap=readFileSync(fixture.tap,'utf8'),tapPath='evidence/yxx-current-fixture/current/one.tap';
    const capture=()=>{
      const ref=fixture.save(tapPath,originalTap+receipts.map(item=>'# SS009_RECEIPT '+JSON.stringify(item)+'\n').join('')+'# SS010_BROWSER '+JSON.stringify(limited)+'\n');
      file.tap_sha256=ref.sha256;file.tap_bytes=ref.bytes;fixture.commit();
      observations.splice(0,observations.length,...receipts.map((_,index)=>({tap_path:tapPath,channel:'SS009_RECEIPT',receipt_index:index})),
        {tap_path:tapPath,channel:'SS010_BROWSER',receipt_index:0});
    };
    capture();
    for(const channel of ['SS009_RECEIPT','SS010_BROWSER'])for(const [width,height] of [[390,844],[1440,900]]){
      assert.ok(width&&height);const bytes=readFileSync(path.join(source,'evidence/yxx-ss-009-r7-ui-'+width+'.png'));
      const target='evidence/yxx-current-fixture/'+channel+'-'+width+'.png';writeFileSync(path.join(root,target),bytes);
      images.push({observation:{tap_path:tapPath,channel,receipt_index:channel==='SS009_RECEIPT'?receipts.indexOf(browser):0},width,height,
        artifact:{path:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
    }
    const verify=()=>verifyCurrentYxxSpecializedProof(root,{...fixture.report,...identity,specialized:fixture.save('evidence/yxx-current-fixture/specialized.json',proof)});
    verify();assert.throws(()=>checkSS010({root,requireReady:true}));
    // Publishing evidence changes H's manifest identity, not C's already tested runtime.
    const currentManifest=JSON.parse(readFileSync(path.join(runtime,'build-manifest.json'),'utf8')) as {source:{head:string;tree:string}};
    currentManifest.source.head='d'.repeat(40);currentManifest.source.tree='e'.repeat(40);fixture.save('.build/runtime/build-manifest.json',currentManifest);
    assert.notEqual(g2CandidateInventory(runtime).fingerprint,fingerprint);verify();
    const originalCode=readFileSync(path.join(runtime,'tests/synthetic.test.mjs'),'utf8');fixture.save('.build/runtime/tests/synthetic.test.mjs',originalCode+'// drift\n');
    assert.throws(verify,{code:'CURRENT_SPECIALIZED_PROOF_INVALID'});fixture.save('.build/runtime/tests/synthetic.test.mjs',originalCode);verify();
    browser.candidate_fingerprint=identity.candidate_fingerprint;capture();assert.throws(verify,{code:'CURRENT_SPECIALIZED_PROOF_INVALID'});
    browser.candidate_fingerprint=fingerprint;capture();verify();
    const first=observations.shift();assert.ok(first);assert.throws(verify,{code:'CURRENT_SPECIALIZED_PROOF_INVALID'});observations.unshift(first);
    const saved=receipts;receipts=receipts.filter(item=>item.kind!=='capacity');capture();assert.throws(verify,{code:'CURRENT_SPECIALIZED_PROOF_INVALID'});
    receipts=saved;capture();verify();
    limited.real_postgres=false;capture();assert.throws(verify,{code:'CURRENT_SPECIALIZED_PROOF_INVALID'});limited.real_postgres=true;capture();verify();
    const image=images[0];assert.ok(image);writeFileSync(path.join(root,image.artifact.path),'corrupt');assert.throws(verify,{code:'CURRENT_SPECIALIZED_PROOF_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-specialized-proof-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('historical proof verifies originals and rejects rehashed wrong identity omitted checks and false successes',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'yxx-history-proof-'));
  try{
    // Synthetic consistency fixture only; no checkout or actual acceptance is claimed.
    const fixture=syntheticExecution(root),source=testRoots().sourceRoot;
    for(const file of ['plans/yxx-current-readiness-acceptance.json','evidence/yxx-ss-009-r7-report.json'])fixture.save(file,readFileSync(path.join(source,file),'utf8'));
    const contract=JSON.parse(readFileSync(path.join(root,'plans/yxx-current-readiness-acceptance.json'),'utf8')) as {historical_head:string;historical_base:string;historical_regression_files:string[]};
    const r7=JSON.parse(readFileSync(path.join(root,'evidence/yxx-ss-009-r7-report.json'),'utf8')) as {candidate_fingerprint:string;tested_head:string;tested_tree:string};
    const save=(name:string,value:object|string)=>{const ref=fixture.save('evidence/yxx-current-fixture/historical/'+name,value);return {...ref,path:name};};
    const identity={schema_version:1,head:contract.historical_head,base:contract.historical_base,historical_only:true,production_ready:false};
    const preflight={status:'REVIEW_HISTORY_PREFLIGHT_PASS_NOT_READINESS',checkout_role:'PUBLISHED_PR_HEAD',expected_head:identity.head,checkout_head:identity.head,
      checkout_tree:'54969cbcd2785f62b562ac32aa431e16ee300bd8',checkout_parents:['0d1cfa2935f028ca5c0a97838615dad1ab453563'],
      report_path:'evidence/yxx-ss-009-r7-report.json',tested_head:r7.tested_head,tested_tree:r7.tested_tree,merge_base:r7.tested_head,
      shallow:false,history_overlays:false,worktree_clean:true};
    const strict={ok:true,status:'SS009_LOCAL_VERIFICATION_COMPLETE',candidate_fingerprint:r7.candidate_fingerprint,live_authorized:false,parent_gate_advanced:false};
    const caseNames=['unchanged published r6 positive control','uncommitted rewrite of an unreferenced published r5 report',
      'committed rewrite with a clean checkout','rewrite and restore cannot erase the audit violation'];
    const probe={status:'PUBLISHED_EVIDENCE_HISTORY_PROBE_PASS',historical_fixture:'a1a48f9839315d7683d9973a1d9febfd14aa39a8',
      current_candidate_fingerprint:r7.candidate_fingerprint,protected_files:1090,candidate_unchanged:true,owned_worktree_removed:true,
      experiments:caseNames.map((name,index)=>({case:name,legacy:{exit_code:0,status:'SS009_LOCAL_VERIFICATION_COMPLETE'},
        ...(index===0?{fixed_history:'SS009_EVIDENCE_HISTORY_VALID'}:{fixed:{status:'REJECTED',error_code:'SS009_PUBLISHED_EVIDENCE_CHANGED',
          missing_or_changed_file:'evidence/yxx-ss-009-r5-review-fix-report.md',modes:['STRUCTURE','STRICT','PRETAMPER']}})}))};
    const cases=Array.from({length:36},(_,index)=>({...g2EvidenceTime(),time_basis:'REPORTER_OBSERVED_AT',event:'test:pass',name:'synthetic case '+index,
      file:contract.historical_regression_files[index%4],line:1,nesting:0,skip:false,todo:false}));
    const tap='TAP version 13\n'+cases.map((item,index)=>'ok '+(index+1)+' - '+item.name+'\n').join('')+
      '1..36\n# tests 36\n# suites 0\n# pass 36\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
    const record=(name:string,command:string[],output:object|string)=>({name,command,exit_code:0,signal:null,error_code:null,
      stdout:save(name+'.stdout',output),stderr:save(name+'.stderr','')});
    const records=[record('preflight',['node','.github/review/verify-published-history.mjs','--expected-head',identity.head],preflight),
      record('strict',['node','scripts/validate-yxx-self-service.mjs','--require-ready'],strict),
      record('regression',['node','--test','--test-concurrency=1','--test-reporter=tap','--test-reporter-destination=stdout',
        '--test-reporter=./scripts/p2-g2-case-reporter.mjs','--test-reporter-destination=/synthetic/regression.cases.jsonl',...contract.historical_regression_files],tap),
      record('r6-probe',['node','.github/review/ss009-evidence-history-probe.mjs'],probe),
      ...SS009_VALIDATORS.map((file:string)=>record('validator-'+file.replace(/\.mjs$/u,''),['node','scripts/'+file],
        file==='validate-v1-4-architecture.mjs'?'V1.4 architecture validation passed (407 checks).':
          file==='validate-arch-006-rule-first-service-loop.mjs'?'ARCH-006 rule-first service loop validation passed (1 checks).':{ok:true}))];
    const proof={...identity,kind:'HISTORICAL_SS009_PROOF',status:'PASS',checkout_clean:true,node_version:'v24.18.0',records,
      github_metadata:save('github-pr19.json',{head:identity.head,base:identity.base,merged:true,state:'closed',merge_commit:'c1af81a86951054f4898f043c43381a5842abbf2'})};
    const catalog={...identity,kind:'HISTORICAL_SS009_CATALOG',proof:save('proof.json',proof),case_count:36,
      case_trace:save('regression.cases.jsonl',cases.map(item=>JSON.stringify(item)).join('\n')+'\n')};
    const verify=()=>{catalog.proof=save('proof.json',proof);const ref=save('catalog.json',catalog);
      verifyCurrentYxxHistoricalProof(root,{run_id:'fixture',historical:{...ref,path:'evidence/yxx-current-fixture/historical/'+ref.path}});};
    verify();
    proof.head='f'.repeat(40);assert.throws(verify,{code:'CURRENT_HISTORICAL_PROOF_INVALID'});proof.head=identity.head;
    const last=records.pop();assert.ok(last);assert.throws(verify,{code:'CURRENT_HISTORICAL_PROOF_INVALID'});records.push(last);
    const strictRecord=records.find(item=>item.name==='strict');assert.ok(strictRecord);
    strictRecord.stdout=save('strict.stdout',{...strict,status:'NOT_READY'});assert.throws(verify,{code:'CURRENT_HISTORICAL_PROOF_INVALID'});
    strictRecord.stdout=save('strict.stdout',strict);
    const probeRecord=records.find(item=>item.name==='r6-probe');assert.ok(probeRecord);
    probeRecord.stdout=save('r6-probe.stdout',{...probe,experiments:probe.experiments.slice(0,3)});assert.throws(verify,{code:'CURRENT_HISTORICAL_PROOF_INVALID'});
    probeRecord.stdout=save('r6-probe.stdout',probe);
    catalog.case_trace=save('regression.cases.jsonl',cases.slice(1).map(item=>JSON.stringify(item)).join('\n')+'\n');
    assert.throws(verify,{code:'CURRENT_HISTORICAL_PROOF_INVALID'});
    catalog.case_trace=save('regression.cases.jsonl',cases.map(item=>JSON.stringify(item)).join('\n')+'\n');verify();
    save('strict.stdout',{...strict,live_authorized:true});assert.throws(verify,{code:'CURRENT_HISTORICAL_PROOF_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-history-proof-'));
    rmSync(root,{recursive:true,force:true});
  }
});

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
    const historical=save('evidence/yxx-current-fixture/historical/catalog.json',{status:'PASS'});
    const unsupportedHistory=save('evidence/yxx-current-fixture/report.json',{...header,historical});
    save('plans/yxx-current-readiness.json',{schema_version:1,report:unsupportedHistory});
    assert.throws(()=>checkSS010({root,requireReady:true}),{code:'CURRENT_HISTORICAL_PROOF_INVALID'});
    const specialized=save('evidence/yxx-current-fixture/specialized.json',{status:'PASS'});
    const unsupportedSpecialized=save('evidence/yxx-current-fixture/report.json',{...header,specialized});
    save('plans/yxx-current-readiness.json',{schema_version:1,report:unsupportedSpecialized});
    assert.throws(()=>checkSS010({root,requireReady:true}),{code:'CURRENT_SPECIALIZED_PROOF_INVALID'});
    const sourceAccounting=save('evidence/yxx-current-fixture/source-accounting.json',{status:'PASS'});
    const unsupportedAccounting=save('evidence/yxx-current-fixture/report.json',{...header,source_accounting:sourceAccounting});
    save('plans/yxx-current-readiness.json',{schema_version:1,report:unsupportedAccounting});
    assert.throws(()=>checkSS010({root,requireReady:true}),{code:'CURRENT_SOURCE_ACCOUNTING_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-execution-evidence-'));
    if(attached)execFileSync('git',['worktree','remove','--force',root],{cwd:source,windowsHide:true,stdio:'pipe'});
    else rmSync(root,{recursive:true,force:true});
  }
});
