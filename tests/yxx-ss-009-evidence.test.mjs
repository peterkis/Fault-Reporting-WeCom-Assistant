import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyYxxRun,verifyYxxCaseTrace,verifyYxxRegressionSummary,evidenceHash,readYxxEvidence,verifyYxxReceipts,verifyYxxCompletionState,validateYxxSelfService } from '../src/yxx-self-service-verification.mjs';
import {tap as tapReporter} from 'node:test/reporters';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync,copyFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {testRoots} from './helpers/migration-roots.mjs';
const G2_ROOT=testRoots().sourceRoot;
import path from 'node:path';
import {tmpdir} from 'node:os';
import {closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import caseReporter from '../scripts/p2-g2-case-reporter.mjs';
import {assertG2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';

function fileExecution(cases,files){return files.map(path=>{const rows=cases.filter(c=>c.file===path&&c.event==='test:pass'&&!c.skip&&!c.todo),identities=rows.map(c=>JSON.stringify([c.nesting,c.name,c.line??null])).sort();return {path,total:rows.length,pass:rows.length,fail:0,skipped:0,todo:0,identity_sha256:evidenceHash(JSON.stringify(identities))};});}

test('SS-009 requires local validation scope before accepting protected parent phase state',()=>{
  const root=path.join(G2_ROOT,'tmp','ss009-scope-'+randomUUID());
  const git=args=>execFileSync('git',args,{cwd:G2_ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  git(['worktree','add','--detach',root,'HEAD']);
  try{
    copyFileSync(path.join(G2_ROOT,'.gitignore'),path.join(root,'.gitignore'));
    assert.throws(()=>validateYxxSelfService({root}),{code:'YXX_LOCAL_VALIDATION_SCOPE_INVALID'});
    const phasePath=path.join(root,'plans/current_phase.json'),phase=JSON.parse(readFileSync(phasePath));
    phase.last_completed_gate='P2-G2';writeFileSync(phasePath,JSON.stringify(phase,null,2)+'\n');
    const modes=[{}, {requireReady:true}, {requireReady:true,preTamper:true}];
    for(const mode of modes)assert.throws(()=>validateYxxSelfService({root,...mode}),{code:'YXX_LOCAL_VALIDATION_SCOPE_INVALID'});
    unlinkSync(path.join(root,'plans/yxx-self-service-validation-scope.json'));
    for(const mode of modes)assert.throws(()=>validateYxxSelfService({root,...mode}),{code:'SS009_LOCAL_VALIDATION_SCOPE_REQUIRED'});
  }finally{
    assert.match(path.relative(path.join(G2_ROOT,'tmp'),root),/^ss009-scope-[a-f0-9-]{36}$/u);
    git(['worktree','remove','--force',root]);
  }
});

test('SS-009 strict completion requires finalized status and PASS while preTamper remains intermediate',()=>{
  const ready={status:'IMPLEMENTATION_AND_AUTOMATION_COMPLETE',local_verification:'PASS'};
  assert.doesNotThrow(()=>verifyYxxCompletionState(ready));
  for(const report of [undefined,{}, {...ready,status:undefined},{...ready,status:'LOCAL_AUTOMATION_VERIFIED_PENDING_STRICT_GATE'},
    {...ready,status:'FAILED'},{...ready,local_verification:undefined},{...ready,local_verification:'FAILED'}]){
    assert.throws(()=>verifyYxxCompletionState(report),{code:'SS009_COMPLETION_STATE_REQUIRED'});
  }
  assert.doesNotThrow(()=>verifyYxxCompletionState({status:'LOCAL_AUTOMATION_VERIFIED_PENDING_STRICT_GATE'},{preTamper:true}));
  assert.doesNotThrow(()=>verifyYxxCompletionState(ready,{preTamper:false}));
});

test('SS-009 evidence rejects a forged PASS summary without the matching successful TAP', () => {
  const run={suite:'full',exit_code:0,candidate_unchanged:true,counts:{tests:1155,pass:1155,fail:0,cancelled:0,skipped:0,todo:0}};
  assert.throws(()=>verifyYxxRun({run,tap:'not ok 1 - rejected\n',inventory:{fingerprint:'x',files:[]},baselineFiles:[]}));
});

test('SS-009 complete trace matches TAP multiplicity nesting escaped names and collected files',async()=>{
  const names=['same name','same name','same name','literal # SKIP and \\ slash','control\nline\ttab'];
  const cases=names.map((name,i)=>({...g2EvidenceTime(),time_basis:'REPORTER_OBSERVED_AT',event:'test:pass',name,file:'tests/example-'+(i%2)+'.test.mjs',line:i+1,nesting:i===1?1:0,skip:false,todo:false}));
  const files=['tests/example-0.test.mjs','tests/example-1.test.mjs'];
  const run={counts:{tests:5},files:files.map(path=>({path})),file_execution:fileExecution(cases,files)};
  async function* events(){for(const [i,c] of cases.entries())yield {type:'test:pass',data:{name:c.name,nesting:c.nesting,testNumber:i+1,details:{type:'test',duration_ms:1}}};}
  let tap='';for await(const chunk of tapReporter(events()))tap+=chunk;
  assert.doesNotThrow(()=>verifyYxxCaseTrace({cases:cases.toReversed(),run,tap}));
  // Exercise the same Run -> Trace chain used by the strict validator/Binder.
  const full=fixture(),escaped=/^ok 4 - (.+)$/mu.exec(tap)[1];
  full.tap=full.tap.replace('ok 1 - case 0','ok 1 - '+escaped);full.run.stdout_sha256=evidenceHash(full.tap);
  const fullCases=Array.from({length:1155},(_,i)=>({...cases[0],name:i===0?names[3]:'case '+i,file:full.run.files[i%full.run.files.length].path,line:i+1,nesting:0}));
  assert.doesNotThrow(()=>{verifyYxxRun(full);verifyYxxCaseTrace({...full,cases:fullCases});});
  for(const mutate of [rows=>{rows[0]=structuredClone(rows[3]);},rows=>{rows[0].file='tests/not-collected.test.mjs';},rows=>{rows[0].nesting=1;},rows=>{rows.pop();},rows=>{rows[0].name='invented';},rows=>{rows[0].skip=true;},rows=>{delete rows[0].event_time;}]){
    const rows=structuredClone(cases);mutate(rows);assert.throws(()=>verifyYxxCaseTrace({cases:rows,run,tap}));
  }
});

function fileCoverageFixture(){
  const cases=['tests/listed-a.test.mjs','tests/listed-a.test.mjs','tests/listed-b.test.mjs','tests/listed-b.test.mjs'].map((file,i)=>({
    ...g2EvidenceTime(),time_basis:'REPORTER_OBSERVED_AT',event:'test:pass',
    name:'same name',file,line:i+1,nesting:0,skip:false,todo:false,
  }));
  const files=['tests/listed-a.test.mjs','tests/listed-b.test.mjs'];
  return {cases,run:{counts:{tests:4},files:files.map(path=>({path})),file_execution:fileExecution(cases,files)},
    tap:'ok 1 - same name\nok 2 - same name\nok 3 - same name\nok 4 - same name\n'};
}

test('SS-009 trace covers every collected file regardless of shared names or event order',()=>{
  const f=fileCoverageFixture();
  assert.doesNotThrow(()=>verifyYxxCaseTrace(f));
  assert.doesNotThrow(()=>verifyYxxCaseTrace({...f,cases:f.cases.toReversed(),run:{...f.run,files:f.run.files.toReversed()}}));
});

test('SS-009 trace rejects a whole omitted file after adjusting all trace and TAP counts',()=>{
  const f=fileCoverageFixture();
  f.cases=f.cases.filter(c=>c.file!=='tests/listed-b.test.mjs');
  f.run.counts.tests=2;f.tap='ok 1 - same name\nok 2 - same name\n';
  assert.throws(()=>verifyYxxCaseTrace(f),{code:'SS009_TEST_FILE_EXECUTION_REQUIRED',missing_files:['tests/listed-b.test.mjs']});
});

test('SS-009 trace rejects reassigned file provenance even when names nesting and counts match',()=>{
  const f=fileCoverageFixture();f.cases[2].file='tests/listed-a.test.mjs';f.cases[3].file='tests/listed-a.test.mjs';
  assert.throws(()=>verifyYxxCaseTrace(f),{code:'SS009_TEST_FILE_EXECUTION_REQUIRED',missing_files:['tests/listed-b.test.mjs']});
});

test('SS-009 trace rejects set-preserving file relabeling against the independent execution manifest',()=>{
  const f=fileCoverageFixture();[f.cases[0].file,f.cases[2].file]=[f.cases[2].file,f.cases[0].file];
  assert.doesNotThrow(()=>assert.deepEqual(new Set(f.cases.map(c=>c.file)),new Set(f.run.files.map(file=>file.path))));
  assert.throws(()=>verifyYxxCaseTrace(f),{code:'SS009_TEST_FILE_PROVENANCE_MISMATCH'});
});

test('SS-009 trace reports all unobserved files and skipped events cannot establish coverage',()=>{
  const f=fileCoverageFixture();f.run.files.push({path:'tests/listed-d.test.mjs'},{path:'tests/listed-c.test.mjs'});
  assert.throws(()=>verifyYxxCaseTrace(f),{code:'SS009_TEST_FILE_EXECUTION_REQUIRED',missing_files:['tests/listed-c.test.mjs','tests/listed-d.test.mjs']});
  const skipped=fileCoverageFixture();skipped.cases[1].skip=true;
  assert.throws(()=>verifyYxxCaseTrace(skipped));
  const todo=fileCoverageFixture();todo.cases[1].todo=true;
  assert.throws(()=>verifyYxxCaseTrace(todo));
});

test('SS-009 published regression summary equals all raw counts files and unchanged flag',()=>{
  const run={counts:{tests:4,pass:4,fail:0,cancelled:0,skipped:0,todo:0},files:[{},{}],candidate_unchanged:true};
  const summary={tests:4,pass:4,fail:0,cancelled:0,skipped:0,todo:0,test_files:2,candidate_unchanged:true};
  assert.doesNotThrow(()=>verifyYxxRegressionSummary(summary,run));
  for(const key of Object.keys(summary)){
    const changed={...summary,[key]:key==='candidate_unchanged'?false:999};assert.throws(()=>verifyYxxRegressionSummary(changed,run));
    const missing={...summary};delete missing[key];assert.throws(()=>verifyYxxRegressionSummary(missing,run));
  }
  assert.throws(()=>verifyYxxRegressionSummary(undefined,run));
});

test('SS-009 every structured test event has paired reporter observation time',async()=>{
  async function* events(){yield {type:'test:pass',data:{name:'synthetic case',file:path.join(process.cwd(),'tests/yxx-ss-009-evidence.test.mjs'),line:1}};}
  const rows=[];for await(const line of caseReporter(events()))rows.push(JSON.parse(line));
  assert.equal(rows.length,1);assertG2EvidenceTime(rows[0]);assert.equal(rows[0].time_basis,'REPORTER_OBSERVED_AT');
  assert.throws(()=>assertG2EvidenceTime({...rows[0],event_epoch_ms:undefined}));
  assert.throws(()=>assertG2EvidenceTime({...rows[0],event_epoch_ms:String(BigInt(rows[0].event_epoch_ms)+10000n)}));
});

test('SS-009 sampler and cleanup errors never skip later owned resource shutdown',async()=>{
  const closed=[];
  await assert.rejects(closeSS009Resources([
    async()=>{closed.push('sampler');throw Error('synthetic sampling failure');},
    async()=>{closed.push('app');},async()=>{closed.push('worker');},async()=>{closed.push('pool');}
  ],Error('synthetic original failure')),AggregateError);
  assert.deepEqual(closed,['sampler','app','worker','pool']);
});

test('SS-009 dedicated proof summaries cannot replace process capacity or catalog observations',()=>{
  for(const kind of ['fault','capacity','catalog'])assert.throws(()=>verifyYxxReceipts(kind,[{...g2EvidenceTime(),kind,status:'PASS'}]));
  const record={...g2EvidenceTime(),kind:'catalog',status:'PASS',drift_classes:['COLUMN','CHECK','FK','UNIQUE','INDEX'],check_rollback:true,forbidden_timezone_columns:0};
  const populated={...g2EvidenceTime(),kind:'catalog',status:'PASS',populated_bot_upgrade:true,baseline:'032',migrations:['033','034'],linked_roots:4,existing_rows_unchanged:true,existing_command_replays:true,
    graph_rows:Object.fromEntries(['channel.message_inbox','intake.service_intake','intake.service_intake_message','intake.service_intake_event','intake.contact_journey','intake.channel_leg','intake.deterministic_decision','intake.safe_action_suggestion','intake.manual_review_item','pilot_ticket.ticket','communication.message','communication.outbox','communication.delivery'].map(table=>[table,1]))};
  assert.throws(()=>verifyYxxReceipts('catalog',[record]));
  assert.equal(verifyYxxReceipts('catalog',[record,populated]).length,2);
  assert.throws(()=>verifyYxxReceipts('catalog',[record,{...populated,graph_rows:{}}]));
  const common={...g2EvidenceTime(),kind:'fault',status:'PASS'};
  const fault=[{...common,real_kills:5,cases:[['accept','before-commit'],['accept','after-commit'],['process','before-process'],['process','before-commit'],['process','after-commit']].map(([action,barrier])=>({action,barrier,recovered:true,ticket_count:1,receipt_count:1}))},
    {...common,owned_backend_terminated:true,recovery_verified:true,shared_database_service_stopped:false},
    {...common,http_response_lost:true,same_command_recovered:true,cross_member_denied:true,batch_max:20},
    {...common,savepoint_partial_write:true,partial_write_observed:true,partial_write_rolled_back:true,fallback_decisions:1,fallback_reviews:1,acceptance_retained:true}];
  assert.equal(verifyYxxReceipts('fault',fault).length,4);
  assert.throws(()=>verifyYxxReceipts('fault',fault.slice(0,3)));
  assert.throws(()=>verifyYxxReceipts('fault',[...fault.slice(0,3),{...fault[3],partial_write_rolled_back:false}]));
  assert.throws(()=>verifyYxxReceipts('catalog',[{...record,drift_classes:['COLUMN']}]));
  assert.throws(()=>verifyYxxReceipts('catalog',[{...record,forbidden_timezone_columns:1}]));
});

function fixture(){
  const files=Array.from({length:183},(_,i)=>({path:'tests/example-'+i+'.test.mjs',sha256:'a'.repeat(64)}));
  const counts={tests:1155,pass:1155,fail:0,cancelled:0,skipped:0,todo:0};
  const tap=Array.from({length:1155},(_,i)=>`ok ${i+1} - case ${i}`).join('\n')+'\n'+Object.entries(counts).map(([k,v])=>`# ${k} ${v}`).join('\n')+'\n';
  const inventory={fingerprint:'b'.repeat(64),files};
  const syntheticCases=Array.from({length:1155},(_,i)=>({file:files[i%files.length].path,name:i===0?'literal # SKIP and \\ slash':'case '+i,line:i+1,nesting:0,event:'test:pass',skip:false,todo:false}));
  const manifest=fileExecution(syntheticCases,files.map(file=>file.path));
  const run={...g2EvidenceTime(),suite:'full',node_version:'24.0.0',expose_gc:true,exit_code:0,signal:null,error:null,candidate_unchanged:true,candidate_fingerprint:inventory.fingerprint,files:structuredClone(files),file_execution:manifest,stdout_sha256:evidenceHash(tap),counts};
  return {run,tap,inventory,baselineFiles:files};
}
test('SS-009 run evidence binds real TAP counts current inventory historical coverage and paired time',()=>{
  assert.equal(verifyYxxRun(fixture()).size,1155);
  const mutations=[
    f=>{f.tap=f.tap.replace('ok 1 -','not ok 1 -');f.run.stdout_sha256=evidenceHash(f.tap);},
    f=>{f.tap=f.tap.replace('case 0','case 0 # SKIP');f.run.stdout_sha256=evidenceHash(f.tap);},
    f=>{f.run.counts.pass--;},f=>{f.run.files.pop();},f=>{f.run.files[0].sha256='c'.repeat(64);},
    f=>{f.run.candidate_fingerprint='c'.repeat(64);},f=>{f.run.candidate_unchanged=false;},
    f=>{f.run.event_epoch_ms=String(BigInt(f.run.event_epoch_ms)+10000n);},
    f=>{f.baselineFiles=[{path:'tests/missing-history.test.mjs'}];},f=>{f.run.signal='SIGKILL';},
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>verifyYxxRun(f));}
});
test('SS-009 evidence references reject wrong hashes traversal and linked files',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'ss009-proof-'));
  try{
    mkdirSync(path.join(root,'evidence'));writeFileSync(path.join(root,'evidence','proof.json'),'{}\n');
    const ref={path:'evidence/proof.json',encoding:'UTF8_LF',sha256:evidenceHash('{}\n')};assert.equal(readYxxEvidence(root,ref),'{}\n');
    assert.throws(()=>readYxxEvidence(root,{...ref,sha256:'0'.repeat(64)}));
    assert.throws(()=>readYxxEvidence(root,{...ref,path:'evidence/../proof.json'}));
    const linked=path.join(root,'linked');mkdirSync(linked);symlinkSync(path.join(root,'evidence'),path.join(linked,'evidence'),'junction');
    assert.throws(()=>readYxxEvidence(linked,ref));
  }finally{assert.ok(path.dirname(root)===tmpdir()&&path.basename(root).startsWith('ss009-proof-'));rmSync(root,{recursive:true,force:true});}
});
