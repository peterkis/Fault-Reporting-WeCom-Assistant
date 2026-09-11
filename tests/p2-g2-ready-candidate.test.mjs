import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync,readFileSync,copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requirePreparedG2Candidate, g2CandidateInventory, G2_CANDIDATE_ROOTS, G2_CANDIDATE_FILES,G2_ROOT } from '../src/p2-g2-candidate.mjs';
import {createG2SourceAudit} from '../src/p2-g2-source-audit.mjs';
import { G2_SCENARIO_IDS } from '../src/p2-g2-gate-evaluator.mjs';
import { g2Hash } from '../src/p2-g2-validation-config.mjs';
import { deriveG2TestEvidence } from '../src/p2-g2-test-evidence.mjs';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';

test('prepared-candidate gate rejects missing, changed and incomplete regression evidence', t => {
  const root=mkdtempSync(path.join(tmpdir(),'g2-ready-unit-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const dir of [...G2_CANDIDATE_ROOTS,'evidence'])mkdirSync(path.join(root,dir),{recursive:true});
  for(const file of G2_CANDIDATE_FILES)writeFileSync(path.join(root,file),'{}');
  writeFileSync(path.join(root,'tests/unit.test.mjs'),'// synthetic fixture');
  for(const relative of ['p2-007/hospital-it-evaluation-corpus.v1.jsonl','p2-007/hospital-it-multichannel-evaluation-corpus.v1.jsonl',
    'p2-007/multichannel_decision_cases.v1.2.jsonl','p2-015/rule-first-safe-route-gold.v1.jsonl',
    'p2-g2/multichannel-adjudications.v1.json','p2-g2/gold-adjudications.v1.jsonl','p2-g2/mechanism-adjudications.v1.json']){
    const target=path.join(root,'tests/fixtures',relative);mkdirSync(path.dirname(target),{recursive:true});
    copyFileSync(path.join(G2_ROOT,'tests/fixtures',relative),target);
  }
  const ids=readFileSync(path.join(root,'tests/fixtures/p2-015/rule-first-safe-route-gold.v1.jsonl'),'utf8').trim().split(/\r?\n/u).map(JSON.parse)
    .map(r=>r.source_case_id).filter(id=>!['D12-005','D12-023'].includes(id));
  const candidate=g2CandidateInventory(root),fingerprint=candidate.fingerprint,reportPath=path.join(root,'evidence/p2-g2-automated-readiness-report.json');
  assert.throws(()=>requirePreparedG2Candidate(fingerprint,root),/READY_CANDIDATE_REQUIRED/u);
  const tap=Array.from({length:577},(_,i)=>{const name=i===0?'synthetic coverage fixture':'synthetic '+i;
    return '# Subtest: '+name+'\nok '+(i+1)+' - '+name+(ids[i]?'\n# '+JSON.stringify({source_case_id:ids[i],observation:{
      result_code:'MANUAL_REVIEW_REQUIRED',actual_actions:[{action_type:'ENQUEUE_MANUAL_REVIEW',state:'EXECUTED',result_ref_type:'MANUAL_REVIEW'}]}}):'');
  }).join('\n')+'\n# tests 577\n# pass 577\n# fail 0\n# skipped 0\n# cancelled 0\n# todo 0\n';
  const report={preparation_status:'READY_FOR_LIVE_E2E',candidate_fingerprint:fingerprint,gold_reference_count:202,
    scenario_matrix_complete:true,independent_review_passed:true,full_regression:{tests:577,pass:577,fail:0,
      skipped:0,cancelled:0,todo:0,baseline_test_files_covered:true,tap_path:'evidence/p2-g2-unit-regression.tap',tap_sha256:g2Hash(tap)}};
  writeFileSync(path.join(root,report.full_regression.tap_path),tap);
  const source=(name,data)=>{const text=typeof data==='string'?data:JSON.stringify(data),ref={path:'evidence/p2-g2-'+name,sha256:g2Hash(text)};
    writeFileSync(path.join(root,ref.path),text);return ref;};
  const run={candidate_fingerprint:fingerprint,suite:'full',mode:'SYNTHETIC_AUTOMATION',exit_code:0,error:null,signal:null,
    expose_gc:true,args:['--expose-gc','--test'],directory:'tmp/p2-g2-tests-10000000-0000-4000-8000-000000000010',
    started_physical_epoch_ms:'1788800100000',completed_physical_epoch_ms:'1788800101000',
    candidate_unchanged:true,stdout_sha256:g2Hash(tap),counts:{tests:577,pass:577,fail:0,skipped:0,cancelled:0,todo:0},
    files:candidate.files.filter(f=>f.path.endsWith('.test.mjs')).map(({path,sha256})=>({path,sha256}))};
  const matrix={candidate_fingerprint:fingerprint,scenarios:G2_SCENARIO_IDS.map(scenario_id=>({scenario_id,preparation_status:'VERIFIED',
    automated_evidence_type:'SYNTHETIC_PROCESS_BROWSER',test_names:['synthetic coverage fixture']}))};
  const sourceAudit=createG2SourceAudit({tap,run,root}),sourceExecution=source('unit-source-execution.json',sourceAudit);
  const review={candidate_fingerprint:fingerprint,reviews:['STANDARDS','SPEC'].map(axis=>({axis,verdict:'PASS',unresolved_findings:0,
    reviewer:'synthetic-'+axis,source:source('review-'+axis.toLowerCase()+'.json',{candidate_fingerprint:fingerprint,axis,verdict:'PASS',
      unresolved_findings:0,reviewer:'synthetic-'+axis,source_execution_sha256:sourceExecution.sha256,scenario_matrix_sha256:g2Hash(JSON.stringify(matrix)),findings:[]})}))};
  report.source_evidence={regression_run:source('unit-run.json',run),scenario_matrix:source('unit-matrix.json',matrix),
    independent_review:source('unit-review.json',review),source_execution:sourceExecution};
  const save=r=>writeFileSync(reportPath,JSON.stringify(r));
  save(report);assert.deepEqual(requirePreparedG2Candidate(fingerprint,root),report);
  // Deliberately synthetic local fixture exercises the source adapter; these
  // files are removed with this unit-test root and never become live evidence.
  mkdirSync(path.join(root,run.directory),{recursive:true});writeFileSync(path.join(root,run.directory,'run.json'),JSON.stringify(run));
  writeFileSync(path.join(root,run.directory,'result.tap'),tap);
  const manifest=configurationFixture().manifest;manifest.candidate_fingerprint=fingerprint;
  const proof={schema_version:1,kind:'G2_TEST_PROOF',run_id:manifest.run_id,candidate_fingerprint:fingerprint,phase:'STARTUP',
    run:{ref:run.directory+'/run.json',sha256:g2Hash(JSON.stringify(run))}};
  const entries=deriveG2TestEvidence(proof,manifest,{root});assert.equal(entries.length,38);
  assert.equal(entries[0].details.tests,577);assert.ok(entries.every(e=>e.evidence_type!=='LIVE_WECOM_RECEIPT'));
  assert.equal(deriveG2TestEvidence({...proof,phase:'END'},manifest,{root}).length,1);
  assert.throws(()=>deriveG2TestEvidence({...proof,phase:'UNKNOWN'},manifest,{root}));
  for(const mutate of [r=>r.candidate_fingerprint='b'.repeat(64),r=>r.independent_review_passed=false,
    r=>r.scenario_matrix_complete=false,r=>r.gold_reference_count=201,r=>r.full_regression.skipped=1,
    r=>{delete r.full_regression.tests;delete r.full_regression.pass;},
    r=>r.full_regression.pass=576,r=>r.full_regression.baseline_test_files_covered=false,r=>{delete r.source_evidence.source_execution;}]){
    const changed=structuredClone(report);mutate(changed);save(changed);
    assert.throws(()=>requirePreparedG2Candidate(fingerprint,root),/READY_CANDIDATE_REQUIRED/u);
  }
  for(const [name,data,key] of [['unit-run.json',{...run,candidate_fingerprint:'b'.repeat(64)},'regression_run'],
    ['unit-source-execution-changed.json',{...sourceAudit,observed_normal_pass_cases:121},'source_execution'],
    ['unit-run.json',{...run,files:[]},'regression_run'],['unit-matrix.json',{...matrix,scenarios:[]},'scenario_matrix'],
    ['unit-review.json',{...review,reviews:[]},'independent_review'],
    ['unit-matrix.json',{...matrix,scenarios:matrix.scenarios.map(s=>({...s,test_names:['# fail 0']}))},'scenario_matrix']]){
    const changed=structuredClone(report);changed.source_evidence[key]=source(name,data);save(changed);
    assert.throws(()=>requirePreparedG2Candidate(fingerprint,root),/READY_CANDIDATE_REQUIRED|REGRESSION_EVIDENCE_CHANGED/u);
  }
  report.source_evidence.regression_run=source('unit-run.json',run);
  report.source_evidence.scenario_matrix=source('unit-matrix.json',matrix);
  report.source_evidence.independent_review=source('unit-review.json',review);
  const contradicted=structuredClone(report),badReview=structuredClone(review);
  badReview.reviews[0].source=source('contradictory-review.json',{candidate_fingerprint:'b'.repeat(64),axis:'STANDARDS',verdict:'FAIL',unresolved_findings:2,reviewer:'synthetic-STANDARDS',findings:[]});
  contradicted.source_evidence.independent_review=source('contradictory-summary.json',badReview);save(contradicted);
  assert.throws(()=>requirePreparedG2Candidate(fingerprint,root),/READY_CANDIDATE_REQUIRED/u);
  const failed=structuredClone(report),failedTap='not ok 1 - failure\n'+tap;
  failed.full_regression.tap_sha256=g2Hash(failedTap);save(failed);writeFileSync(path.join(root,failed.full_regression.tap_path),failedTap);
  assert.throws(()=>requirePreparedG2Candidate(fingerprint,root),/READY_CANDIDATE_REQUIRED/u);
  save(report);writeFileSync(path.join(root,report.full_regression.tap_path),tap+'changed');
  assert.throws(()=>requirePreparedG2Candidate(fingerprint,root),/REGRESSION_EVIDENCE_CHANGED/u);
});
