import { isDeepStrictEqual } from 'node:util';
import { G2_ROOT, g2CandidateInventory, requirePreparedG2Candidate } from './p2-g2-candidate.mjs';
import { createG2SourceAudit } from './p2-g2-source-audit.mjs';
import { G2_SCENARIO_IDS } from './p2-g2-gate-evaluator.mjs';
import { readG2SourceFile, readG2SourceJson } from './p2-g2-evidence-files.mjs';
import { failG2 } from './p2-g2-validation-config.mjs';

export function deriveG2TestEvidence(proof,manifest,{root=G2_ROOT}={}){
  if(proof?.schema_version!==1||proof.kind!=='G2_TEST_PROOF'||proof.run_id!==manifest.run_id
    ||proof.candidate_fingerprint!==manifest.candidate_fingerprint||!['STARTUP','END'].includes(proof.phase))failG2('TEST_PROOF_INVALID');
  const ready=requirePreparedG2Candidate(manifest.candidate_fingerprint,root);
  const run=readG2SourceJson(proof.run.ref,{root,sha256:proof.run.sha256});
  if(!/^tmp\/p2-g2-tests-[a-f0-9-]+$/u.test(run.directory??'')||proof.run.ref!==run.directory+'/run.json'
    ||run.candidate_fingerprint!==manifest.candidate_fingerprint||run.suite!=='full'
    ||!/^\d{13}$/u.test(run.completed_physical_epoch_ms??'')||!/^\d{13}$/u.test(run.started_physical_epoch_ms??'')
    ||BigInt(run.completed_physical_epoch_ms)<BigInt(run.started_physical_epoch_ms)||run.expose_gc!==true
    ||!Array.isArray(run.args)||!run.args.includes('--expose-gc'))failG2('TEST_PROOF_INVALID');
  const inventory=g2CandidateInventory(root),files=inventory.files.filter(f=>/^tests\/(?:p2-007\/)?[^/]+\.test\.mjs$/u.test(f.path));
  if(!Array.isArray(run.files)||run.files.length!==files.length||new Set(run.files.map(f=>f.path)).size!==files.length
    ||files.some(f=>!run.files.some(actual=>actual.path===f.path&&actual.sha256===f.sha256)))failG2('TEST_FILES_NOT_VERIFIED');
  const tap=readG2SourceFile(run.directory+'/result.tap',{root,sha256:run.stdout_sha256}).toString('utf8');
  const audit=createG2SourceAudit({tap,run,root});
  if(!audit.accounting_complete||audit.observed_normal_pass_cases!==122||audit.manual_review_observation_missing.length)failG2('SOURCE_EXECUTION_NOT_VERIFIED');
  const matrix=readG2SourceJson(ready.source_evidence.scenario_matrix.path,{root,sha256:ready.source_evidence.scenario_matrix.sha256});
  const passed=new Set([...tap.matchAll(/^\s*ok \d+ - (.+)$/gmu)].map(m=>m[1]));
  if(matrix.scenarios.some(s=>s.test_names.some(name=>!passed.has(name))))failG2('SCENARIO_TEST_NOT_VERIFIED');
  const stamp=run.completed_physical_epoch_ms;
  const entries=[{scenario_id:'G2-AUTOMATION',evidence_type:'UNIT_CONTRACT',physical_epoch_ms:stamp,result:'PASS',
    details:{executed:true,phase:proof.phase,...run.counts,expose_gc:run.expose_gc===true,baseline_test_files_covered:true,
      deterministic_safe_route_coverage:audit.observed_normal_test_coverage_percent,manual_review_reachable:100,
      explicit_incident_report_missed:0,clinical_high_risk_missed:0,real_fault_auto_ignored:0,unsupported_root_cause_confirmed:0,determinism_mismatch:0}}];
  if(proof.phase==='STARTUP')for(const id of G2_SCENARIO_IDS){
    const input=/^G2-E0[1-8]$/u.test(id);
    const type=matrix.scenarios.find(s=>s.scenario_id===id)?.automated_evidence_type;
    if(!['UNIT_CONTRACT','POSTGRES_HTTP_INTEGRATION','SYNTHETIC_PROCESS_BROWSER'].includes(type))failG2('SCENARIO_EVIDENCE_TYPE_REQUIRED');
    entries.push({scenario_id:id,evidence_type:type,physical_epoch_ms:stamp,result:'PASS',details:{executed:true,
      ...(input?{input_persisted_before_route:true,seeded_business_facts:false}:{}),
      ...(id==='G2-E07'?{manual_review_handled:true}:{}),...(id==='G2-I01'?{incident_confirmed:true,seeded_business_facts:false}:{})}});
  }
  return entries;
}
export function verifyG2TestSource(source,record,manifest,{root=G2_ROOT}={}){
  if(source.kind!=='TEST_OUTPUT'||! /\/test-proof-[a-z0-9-]+\.json$/u.test(source.ref)||record.run_mode!=='synthetic')return false;
  const proof=readG2SourceJson(source.ref,{root,sha256:source.sha256}),expected=deriveG2TestEvidence(proof,manifest,{root}).find(e=>e.scenario_id===record.scenario_id);
  return Boolean(expected&&record.producer==='AUTOMATED'&&record.evidence_type===expected.evidence_type&&record.physical_epoch_ms===expected.physical_epoch_ms
    &&record.result===expected.result&&isDeepStrictEqual(record.details,expected.details));
}
