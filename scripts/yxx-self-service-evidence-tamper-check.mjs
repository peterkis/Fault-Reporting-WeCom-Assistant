import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {G2_ROOT,g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {validateYxxSelfService,evidenceHash,SS009_BASE} from '../src/yxx-self-service-verification.mjs';

export function tamperCheck(){
  const owned=path.join(G2_ROOT,'tmp','ss009-tamper-'+randomUUID()),git=args=>execFileSync('git',args,{cwd:G2_ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  assert.match(path.relative(path.join(G2_ROOT,'tmp'),owned),/^ss009-tamper-[a-f0-9-]{36}$/u);
  git(['worktree','add','--detach',owned,'HEAD']);const rejected=[];
  const reportPath=path.join(owned,'evidence/yxx-ss-009-report.json');let original;
  const copy=()=>{for(const file of readdirSync(path.join(G2_ROOT,'evidence')).filter(f=>f.startsWith('yxx-ss-009-')))copyFileSync(path.join(G2_ROOT,'evidence',file),path.join(owned,'evidence',file));};
  try{
    copy();original=JSON.parse(readFileSync(reportPath,'utf8'));assert.equal(validateYxxSelfService({root:owned,requireReady:true,preTamper:true}).status,'SS009_CORE_EVIDENCE_VALID_NOT_COMPLETE');
    const artifact=(r,key,mutate)=>{const file=path.join(owned,r[key].path),value=JSON.parse(readFileSync(file,'utf8'));mutate(value);const text=JSON.stringify(value,null,2)+'\n';writeFileSync(file,text);r[key].sha256=evidenceHash(text);};
    const changes=[
      ['wrong TAP hash',r=>{r.tap.sha256='0'.repeat(64);}],
      ['missing published inventory',r=>{r.inventory.path='evidence/ss009-missing-inventory.json';}],
      ['changed published inventory',r=>artifact(r,'inventory',v=>{v.files.pop();})],
      ['wrong candidate',r=>{r.candidate_fingerprint='0'.repeat(64);}],
      ['old but real tested commit',r=>{r.tested_head=SS009_BASE;r.tested_tree=git(['rev-parse',SS009_BASE+'^{tree}']).trim();}],
      ['missing old file',r=>artifact(r,'run',v=>{v.files.pop();})],
      ['wrong file hash',r=>artifact(r,'run',v=>{v.files[0].sha256='0'.repeat(64);})],
      ['missing scenario',r=>artifact(r,'matrix',v=>{v.scenarios.pop();})],
      ['wrong test file',r=>artifact(r,'matrix',v=>{v.scenarios[0].tests[0].file='tests/yxx-ss-009-evidence.test.mjs';})],
      ['wrong test name',r=>artifact(r,'matrix',v=>{v.scenarios[0].tests[0].name='unexecuted test';})],
      ['missing independent axis',r=>artifact(r,'review',v=>{v.reviews.pop();})],
      ['unresolved review',r=>artifact(r,'review',v=>{v.reviews[0].unresolved_findings=1;})],
      ['forged capacity summary',r=>artifact(r,'capacity',v=>{v.records=[];})],
      ['forged process summary',r=>artifact(r,'fault',v=>{v.records=[];})],
      ['forged catalog summary',r=>artifact(r,'catalog',v=>{v.records=[];})],
      ['unpaired time',r=>{r.event_epoch_ms=String(BigInt(r.event_epoch_ms)+10000n);}],
      ['false cleanup',r=>artifact(r,'cleanup',v=>{v.owned_residuals=1;})],
      ['path traversal',r=>{r.tap.path='evidence/../package.json';}],
    ];
    for(const [name,mutate] of changes){copy();const r=structuredClone(original);mutate(r);writeFileSync(reportPath,JSON.stringify(r,null,2)+'\n');assert.throws(()=>validateYxxSelfService({root:owned,requireReady:true,preTamper:true}),undefined,name);rejected.push(name);}
  }finally{assert.match(path.relative(path.join(G2_ROOT,'tmp'),owned),/^ss009-tamper-[a-f0-9-]{36}$/u);git(['worktree','remove','--force',owned]);}
  const receipt={...g2EvidenceTime(),candidate_fingerprint:g2CandidateInventory().fingerprint,status:'PASS',actual_strict_entry:true,positive_control:true,rejected,owned_worktree_removed:true};
  writeFileSync(path.join(G2_ROOT,'evidence/yxx-ss-009-strict-negative.json'),JSON.stringify(receipt,null,2)+'\n');
  const ref=file=>({path:file,encoding:'UTF8_LF',sha256:evidenceHash(readFileSync(path.join(G2_ROOT,file),'utf8').replaceAll('\r\n','\n'))});
  const finalPath=path.join(G2_ROOT,'evidence/yxx-ss-009-report.json'),final=JSON.parse(readFileSync(finalPath,'utf8'));final.strict_negative=ref('evidence/yxx-ss-009-strict-negative.json');
  const matrixFile=path.join(G2_ROOT,final.matrix.path),matrix=JSON.parse(readFileSync(matrixFile,'utf8'));matrix.scenarios[86].evidence=final.strict_negative;writeFileSync(matrixFile,JSON.stringify(matrix,null,2)+'\n');final.matrix=ref(final.matrix.path);
  writeFileSync(finalPath,JSON.stringify(final,null,2)+'\n');return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(tamperCheck()));
