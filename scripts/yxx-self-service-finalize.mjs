import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {g2CandidateInventory,G2_ROOT} from '../src/p2-g2-candidate.mjs';
import {verifyYxxRun,verifyYxxCaseTrace,evidenceHash} from '../src/yxx-self-service-verification.mjs';
import {checkSS010,SS010_REPORT,SS010_ACCEPTANCE} from '../src/yxx-self-service-readiness.mjs';
import {SS010_BASE,reject} from '../src/yxx-limited-write-contract.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';

export function finalizeSS010({runDirectory,reviewFile,historicalFile,testedHead}){
  assert.match(testedHead,/^[a-f0-9]{40}$/u);if(existsSync(SS010_REPORT))reject('REPORT_ALREADY_EXISTS');
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_NO_REPLACE_OBJECTS:'1'};
  const git=args=>execFileSync('git',args,{cwd:G2_ROOT,env,encoding:'utf8',windowsHide:true}).trim();
  assert.equal(git(['rev-parse','HEAD']),testedHead);
  const inventory=g2CandidateInventory(),run=JSON.parse(readFileSync(path.join(runDirectory,'run.json'),'utf8'));
  const tap=readFileSync(path.join(runDirectory,'result.tap'),'utf8').replaceAll('\r\n','\n');
  const trace=readFileSync(path.join(runDirectory,'cases.jsonl'),'utf8').replaceAll('\r\n','\n');
  const baseline=JSON.parse(readFileSync('evidence/yxx-ss-009-r7-full-run.json','utf8'));
  const names=verifyYxxRun({run,tap,inventory,baselineFiles:baseline.files});
  assert.equal(evidenceHash(trace),run.case_trace_sha256);verifyYxxCaseTrace({cases:trace.trim().split('\n').map(JSON.parse),run,tap});
  for(const item of SS010_ACCEPTANCE)for(const name of item.tests)assert.ok(names.has(name));
  const review=JSON.parse(readFileSync(reviewFile,'utf8')),historical=JSON.parse(readFileSync(historicalFile,'utf8'));
  assert.equal(review.candidate_fingerprint,inventory.fingerprint);
  for(const axis of ['SPEC','STANDARDS']){const r=review.reviews.find(r=>r.axis===axis);assert.equal(r?.verdict,'PASS');assert.equal(r.unresolved_findings,0);assert.ok(r.reviewer);}
  assert.equal(historical.checkout_head,SS010_BASE);assert.equal(historical.result.status,'SS009_LOCAL_VERIFICATION_COMPLETE');
  const browser=[...tap.matchAll(/^# SS010_BROWSER (.+)$/gmu)].map(match=>JSON.parse(match[1]));assert.equal(browser.length,1);
  assert.equal(browser[0].candidate_fingerprint,inventory.fingerprint);assert.equal(browser[0].real_browser,true);assert.equal(browser[0].external_network_calls,0);
  const prepared=new Map();
  const artifact=(suffix,data)=>{
    const file='evidence/yxx-ss-010-'+suffix,bytes=Buffer.isBuffer(data)?data:Buffer.from(typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
    if(existsSync(file))assert.ok(readFileSync(file).equals(bytes),'immutable artifact conflict: '+file);else prepared.set(file,bytes);
    return {path:file,sha256:evidenceHash(bytes)};
  };
  const report={schema_version:1,...g2EvidenceTime(),work_item:'YXX-SS-010',status:'IMPLEMENTATION_AND_AUTOMATION_COMPLETE',local_verification:'PASS',readiness:'READY_FOR_LIMITED_WRITE_LIVE',
    base_commit:SS010_BASE,tested_head:testedHead,tested_tree:git(['rev-parse',testedHead+'^{tree}']),candidate_fingerprint:inventory.fingerprint,
    historical_baseline:{tests:1056,test_files:171,ref:'evidence/p2-g2-yxx-entry-creation-v2-parent-report.json'},
    previous_candidate:{tests:1205,test_files:192,ref:'evidence/yxx-ss-009-r7-report.json'},
    full_regression:{...run.counts,test_files:run.files.length,candidate_unchanged:run.candidate_unchanged},
    run:artifact('full-run.json',run),tap:artifact('full.tap',tap),case_trace:artifact('full-cases.jsonl',trace),
    independent_review:artifact('independent-review.json',review),historical_check:artifact('historical-check.json',historical),
    browser:browser[0].screenshots.map(image=>{const bytes=readFileSync(image.file);assert.equal(evidenceHash(bytes),image.sha256);return {...artifact('ui-'+image.width+'.png',bytes),width:image.width,height:image.height};}),
    acceptance:SS010_ACCEPTANCE.map(item=>({...item,status:'PASS'})),pending_live:Array.from({length:8},(_,i)=>'YXX-AC-'+(95+i).toString().padStart(3,'0')),
    live_authorized:false,live_result:'NOT_RUN',parent_gate_advanced:false,remote_ci:'NOT_RUN',remote_review:'NOT_RUN',
    limitations:['Dedicated initially business-empty test database only; resume retains the same run facts.','Real OAuth, deployment and SS011 writes NOT_RUN.',
      'Formal natural GC, physical 2C4G and 60-minute observation NOT_RUN.','SS011 NOT_AUTHORIZED; P2-G2-LIVE and P2-008 stopped.']};
  for(const [file,bytes] of prepared)writeFileSync(file,bytes,{flag:'wx'});
  writeFileSync(SS010_REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  try{return checkSS010({requireReady:true});}catch(error){report.status='VERIFICATION_FAILED';report.local_verification='FAIL';report.readiness='NOT_READY';writeFileSync(SS010_REPORT,JSON.stringify(report,null,2)+'\n');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const args={};for(const arg of process.argv.slice(2)){const m=/^--(run-directory|review-file|historical-file|tested-head)=(.+)$/u.exec(arg);if(!m||args[m[1]])reject('ARGUMENT_INVALID');args[m[1]]=m[2];}
    if(Object.keys(args).length!==4)reject('ARGUMENT_INVALID');console.log(JSON.stringify(finalizeSS010({runDirectory:args['run-directory'],reviewFile:args['review-file'],historicalFile:args['historical-file'],testedHead:args['tested-head']})));
  }catch(error){console.error(error.code??error.message);process.exitCode=1;}
}
