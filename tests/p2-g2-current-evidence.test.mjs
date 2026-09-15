import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {readG2CurrentEvidence} from '../src/p2-g2-current-evidence.mjs';

test('current readiness selects append-only reports and rejects invalid pointers without historical fallback',()=>{
 const root=mkdtempSync('tmp/yxx-report-selection-');mkdirSync(root+'/plans');mkdirSync(root+'/evidence');
 const phase=root+'/plans/current_phase.json',parent='evidence/p2-g2-yxx-entry-mapping-v1-parent-report.json',member='evidence/p2-g2-yxx-entry-mapping-v1-report.json';
 const old=root+'/evidence/p2-g2-automated-readiness-report.json';writeFileSync(old,'{"historical":true}');
 writeFileSync(root+'/'+parent,'{"current":"parent"}');writeFileSync(root+'/'+member,'{"current":"member"}');
 try{
  assert.deepEqual(readG2CurrentEvidence(root,'parent'),{historical:true});
  writeFileSync(phase,JSON.stringify({p2_g2_current_readiness:{parent,member}}));assert.deepEqual(readG2CurrentEvidence(root,'parent'),{current:'parent'});assert.deepEqual(readG2CurrentEvidence(root,'member'),{current:'member'});
  for(const pointers of [null,{parent:null,member},{parent:'../outside.json',member},{parent:member,member},{parent:'evidence/p2-g2-yxx-entry-missing-parent-report.json',member},{parent,member,extra:true}]){
   writeFileSync(phase,JSON.stringify({p2_g2_current_readiness:pointers}));assert.throws(()=>readG2CurrentEvidence(root,'parent'));
  }
 }finally{for(const p of [phase,old,root+'/'+parent,root+'/'+member])unlinkSync(p);rmdirSync(root+'/plans');rmdirSync(root+'/evidence');rmdirSync(root);}
});
