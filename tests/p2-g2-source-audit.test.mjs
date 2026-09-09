import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createG2SourceAudit} from '../src/p2-g2-source-audit.mjs';
import {g2Hash} from '../src/p2-g2-validation-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));

test('source audit uses the same canonical corpus hashes in Windows CRLF and Linux LF candidate checkouts',()=>{
  const f=fixture(['P2-007-C001']),baseline=createG2SourceAudit(f),temporary=mkdtempSync(path.join(root,'tmp','p2-g2-audit-newlines-'));
  try{
    for(const file of Object.keys(baseline.source_and_adjudication_hashes)){
      mkdirSync(path.dirname(path.join(temporary,file)),{recursive:true});
      writeFileSync(path.join(temporary,file),readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n'));
    }
    const lf=createG2SourceAudit({...f,root:temporary});
    for(const file of Object.keys(baseline.source_and_adjudication_hashes)){
      const target=path.join(temporary,file);writeFileSync(target,readFileSync(target,'utf8').replaceAll('\n','\r\n'));
    }
    assert.deepEqual(createG2SourceAudit({...f,root:temporary}),lf);
  }finally{
    const relative=path.relative(path.join(root,'tmp'),path.resolve(temporary));
    assert.ok(relative.startsWith('p2-g2-audit-newlines-')&&!relative.includes(path.sep));
    rmSync(temporary,{recursive:true,force:true});
  }
});
function fixture(ids){
  const counts={tests:ids.length,pass:ids.length,fail:0,skipped:0,cancelled:0,todo:0};
  const tap='TAP version 13\n'+ids.map((id,i)=>`# Subtest: synthetic fixture ${id}\nok ${i+1} - synthetic fixture ${id}\n`).join('')
    +Object.entries(counts).map(([k,v])=>'# '+k+' '+v+'\n').join('');
  return {root,tap,run:{mode:'SYNTHETIC_AUTOMATION',suite:'g2',candidate_fingerprint:'a'.repeat(64),
    exit_code:0,error:null,signal:null,candidate_unchanged:true,stdout_sha256:g2Hash(tap),counts}};
}
test('source audit retains all 202 cases, fixed 122 denominator and explicit unsupported original surfaces',()=>{
  const ids=readFileSync(new URL('../tests/fixtures/p2-015/rule-first-safe-route-gold.v1.jsonl',import.meta.url),'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse).map(r=>r.source_case_id).filter(id=>!['D12-005','D12-023'].includes(id));
  const a=createG2SourceAudit(fixture(ids));assert.equal(a.total_source_cases,202);assert.equal(a.normal_input_cases,122);
  assert.equal(a.observed_normal_pass_cases,122);assert.equal(a.accounting_complete,true);
  assert.equal(a.original_semantics_all_passed,false);assert.equal(a.semantic_review_required,true);
  assert.ok(a.manual_review_observation_missing.length>0,'mere case names must not fabricate a Review action');
  assert.equal(a.cases.find(c=>c.source_case_id==='D12-005').status,'ORIGINAL_SEMANTICS_NOT_VERIFIED');
});
test('source audit never promotes enum presence, failed runs, changed TAP or absent cases',()=>{
  const f=fixture(['P2-007-C001']);assert.ok(createG2SourceAudit(f).execution_missing.includes('P2-007-C002'));
  assert.throws(()=>createG2SourceAudit({...f,run:{...f.run,exit_code:1}}));
  assert.throws(()=>createG2SourceAudit({...f,tap:f.tap+'# changed\n'}));
  assert.throws(()=>createG2SourceAudit({...f,run:{...f.run,candidate_unchanged:false}}));
});
test('source audit reads actual nested TAP child assertions and indented action diagnostics',()=>{
  const f=fixture(['unused','unused-two']);
  f.tap='# Subtest: container\n    # Subtest: child P2-007-C065\n    ok 1 - child P2-007-C065\n    # '+JSON.stringify({
    source_case_id:'P2-007-C065',observation:{result_code:'BUSINESS_CONSULTATION',actual_actions:[{
      action_type:'ROUTE_BUSINESS_CONSULTATION',state:'EXECUTED',result_ref_type:'MANUAL_REVIEW'}]}})
    +'\nok 1 - container\n# tests 2\n# pass 2\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
  f.run.stdout_sha256=g2Hash(f.tap);
  const audit=createG2SourceAudit(f);assert.equal(audit.observed_normal_pass_cases,1);
  assert.equal(audit.cases.find(c=>c.source_case_id==='P2-007-C065').proofs[0].actual_manual_review_action,true);
});
