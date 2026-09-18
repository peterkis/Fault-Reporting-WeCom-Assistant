import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyYxxRun,evidenceHash,readYxxEvidence,verifyYxxReceipts } from '../src/yxx-self-service-verification.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';

test('SS-009 evidence rejects a forged PASS summary without the matching successful TAP', () => {
  const run={suite:'full',exit_code:0,candidate_unchanged:true,counts:{tests:1155,pass:1155,fail:0,cancelled:0,skipped:0,todo:0}};
  assert.throws(()=>verifyYxxRun({run,tap:'not ok 1 - rejected\n',inventory:{fingerprint:'x',files:[]},baselineFiles:[]}));
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
  assert.equal(verifyYxxReceipts('catalog',[record]).length,1);
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
