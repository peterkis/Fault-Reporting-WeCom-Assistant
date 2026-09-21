// Historical r6 experiment, not a new full-regression or readiness certificate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {G2_ROOT,g2CandidateInventory} from '../../src/p2-g2-candidate.mjs';
import {validateYxxSelfService} from '../../src/yxx-self-service-verification.mjs';
import {verifyYxxEvidenceHistory,SS009_PUBLISHED_EVIDENCE_ANCHOR} from '../../src/yxx-self-service-evidence-history.mjs';

const BASELINE='a1a48f9839315d7683d9973a1d9febfd14aa39a8';
const TARGET='evidence/yxx-ss-009-r5-review-fix-report.md';
assert.equal(SS009_PUBLISHED_EVIDENCE_ANCHOR,BASELINE);
const before=g2CandidateInventory().fingerprint;
const currentHistory=verifyYxxEvidenceHistory(G2_ROOT);
assert.equal(validateYxxSelfService().status,'STRUCTURE_VALID_NOT_READY');
const owned=path.join(G2_ROOT,'tmp','ss009-evidence-history-'+randomUUID());
const git=(args,cwd=G2_ROOT)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const experiments=[];let created=false;
function legacy(){
  const result=spawnSync(process.execPath,['scripts/validate-yxx-self-service.mjs','--require-ready'],{cwd:owned,encoding:'utf8',windowsHide:true,timeout:120000});
  assert.ifError(result.error);assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  const output=JSON.parse(result.stdout.trim());assert.equal(output.status,'SS009_LOCAL_VERIFICATION_COMPLETE');
  return {exit_code:result.status,status:output.status,candidate_fingerprint:output.candidate_fingerprint};
}
function fixedRejects(){
  const modes=[{}, {requireReady:true}, {requireReady:true,preTamper:true}];
  for(const mode of modes)assert.throws(()=>validateYxxSelfService({root:owned,...mode}),error=>
    error.code==='SS009_PUBLISHED_EVIDENCE_CHANGED'&&error.files.includes(TARGET));
  assert.throws(()=>verifyYxxEvidenceHistory(owned),error=>error.code==='SS009_PUBLISHED_EVIDENCE_CHANGED'&&error.files.includes(TARGET));
  return {status:'REJECTED',error_code:'SS009_PUBLISHED_EVIDENCE_CHANGED',missing_or_changed_file:TARGET,modes:['STRUCTURE','STRICT','PRETAMPER']};
}
function commit(message){
  git(['add','--',TARGET],owned);
  git(['-c','user.name=SS009 isolated history probe','-c','user.email=history-probe@example.invalid','-c','commit.gpgsign=false',
    '-c','core.hooksPath='+path.join(owned,'nonexistent-hooks'),'commit','-m',message],owned);
}
try{
  git(['worktree','add','--detach',owned,BASELINE]);created=true;
  copyFileSync(path.join(G2_ROOT,'.gitignore'),path.join(owned,'.gitignore'));
  const original=readFileSync(path.join(owned,TARGET));
  experiments.push({case:'unchanged published r6 positive control',legacy:legacy(),fixed_history:verifyYxxEvidenceHistory(owned).status});
  writeFileSync(path.join(owned,TARGET),Buffer.concat([original,Buffer.from('\nSynthetic mutation: not a published factual record.\n')]));
  assert.equal(git(['diff','--name-only','--diff-filter=MDR','375d47b013017edb858206cc5f3475c9aed77dfd','--','evidence'],owned),'');
  experiments.push({case:'uncommitted rewrite of an unreferenced published r5 report',legacy:legacy(),fixed:fixedRejects()});
  commit('synthetic fixture: commit historical rewrite');
  assert.equal(git(['status','--porcelain'],owned),'');
  experiments.push({case:'committed rewrite with a clean checkout',legacy:legacy(),fixed:fixedRejects()});
  writeFileSync(path.join(owned,TARGET),original);commit('synthetic fixture: restore historical bytes');
  assert.equal(git(['diff','--name-only',BASELINE,'HEAD','--','evidence'],owned),'');
  experiments.push({case:'rewrite and restore cannot erase the audit violation',legacy:legacy(),fixed:fixedRejects()});
}finally{
  assert.match(path.relative(path.join(G2_ROOT,'tmp'),owned),/^ss009-evidence-history-[a-f0-9-]{36}$/u);
  if(created)git(['worktree','remove','--force',owned]);
}
assert.equal(g2CandidateInventory().fingerprint,before);
assert.equal(verifyYxxEvidenceHistory(G2_ROOT).head,currentHistory.head);
console.log(JSON.stringify({status:'PUBLISHED_EVIDENCE_HISTORY_PROBE_PASS',historical_fixture:BASELINE,
  current_candidate_fingerprint:before,protected_files:currentHistory.protected_files,experiments,
  candidate_unchanged:true,owned_worktree_removed:true,current_candidate_full_regression:'NOT_RUN_BY_THIS_PROBE',
  current_candidate_strict_readiness:'NOT_CLAIMED_BY_THIS_PROBE'},null,2));
