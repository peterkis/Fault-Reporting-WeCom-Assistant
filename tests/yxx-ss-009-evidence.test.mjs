import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyYxxRun,evidenceHash,readYxxEvidence,verifyYxxReceipts,verifyYxxCompletionState,validateYxxSelfService } from '../src/yxx-self-service-verification.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync,copyFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {G2_ROOT} from '../src/p2-g2-candidate.mjs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import caseReporter from '../scripts/p2-g2-case-reporter.mjs';
import {assertG2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';

test('SS-009 requires local validation scope before accepting protected parent phase state',()=>{
  const root=path.join(G2_ROOT,'tmp','ss009-scope-'+randomUUID());
  const git=args=>execFileSync('git',args,{cwd:G2_ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  git(['worktree','add','--detach',root,'HEAD']);
  try{
    copyFileSync(path.join(G2_ROOT,'.gitignore'),path.join(root,'.gitignore'));
    assert.equal(validateYxxSelfService({root}).status,'STRUCTURE_VALID_NOT_READY');
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
  const run={...g2EvidenceTime(),suite:'full',node_version:'24.0.0',expose_gc:true,exit_code:0,signal:null,error:null,candidate_unchanged:true,candidate_fingerprint:inventory.fingerprint,files:structuredClone(files),stdout_sha256:evidenceHash(tap),counts};
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
