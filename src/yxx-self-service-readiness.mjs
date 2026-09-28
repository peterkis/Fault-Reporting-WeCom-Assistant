import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {g2CandidateInventory,G2_ROOT,isG2CandidatePath} from './p2-g2-candidate.mjs';
import {validateYxxSelfService,verifyYxxRun,verifyYxxCaseTrace,verifyYxxRegressionSummary,evidenceHash} from './yxx-self-service-verification.mjs';
import {SS010_BASE,limitedTemplate,validateLimitedManifest} from './yxx-limited-write-contract.mjs';
import {assertG2EvidenceTime} from './p2-g2-evidence-time.mjs';

export const SS010_REPORT='evidence/yxx-ss-010-report.json';
export const SS010_TEMPLATE='config_examples/yxx-limited-write-authorization.example.json';
export const SS010_ACCEPTANCE=Object.freeze([
  {id:'YXX-AC-091',tests:['SS010 AC091 artifact references reject path traversal missing and corrupted execution data']},
  {id:'YXX-AC-092',tests:['SS010 AC092 offline defaults and unapproved template never start runtime capabilities','SS010 AC092 limited App Worker HTTP lifecycle rejects cross-member access and preserves restart budgets',
    'SS010 AC092 owner approval cannot be reused for changed window actors database or quotas','SS010 AC092 concurrent global and supplement limits count committed commands and never charge replays',
    'SS010 AC092 preflight rejects occupied port drift and resumed foreign scope without processing pending']},
  {id:'YXX-AC-093',tests:['SS010 AC093 real browser limited roles complete supplement review and safe member feedback','SS010 AC093 commit-time revocation rolls back facts and new runs cannot reset persisted scope']},
  {id:'YXX-AC-094',tests:['SS010 AC094 unknown duplicate and run arguments fail without implicit authorization']},
]);
const lf=value=>value.replaceAll('\r\n','\n');
export function readSS010Artifact(root,ref){
  assert.match(ref?.path??'',/^evidence\/yxx-ss-010-[a-zA-Z0-9_.-]+$/u);
  assert.equal(lstatSync(path.join(root,'evidence')).isSymbolicLink(),false);
  const target=path.join(root,ref.path),stat=lstatSync(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=64*1024*1024);
  const content=lf(readFileSync(target,'utf8'));assert.equal(evidenceHash(content),ref.sha256);return content;
}
export function checkSS010({root=G2_ROOT,requireReady=false}={}){
  validateLimitedManifest(JSON.parse(readFileSync(path.join(root,SS010_TEMPLATE),'utf8')),{template:true});
  // Retain the original structure/history guards; r7's current-source strict gate is deliberately not reinterpreted.
  validateYxxSelfService({root});
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_NO_REPLACE_OBJECTS:'1'};
  const git=args=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true}).trim();
  assert.equal(git(['merge-base',SS010_BASE,'HEAD']),SS010_BASE);
  const inventory=g2CandidateInventory(root);
  if(!requireReady)return {ok:true,status:'SS010_STRUCTURE_VALID_NOT_READY',candidate_fingerprint:inventory.fingerprint,
    database_connections:0,provider_calls:0,listener_started:false,live_authorized:false};
  const report=JSON.parse(readFileSync(path.join(root,SS010_REPORT),'utf8'));assertG2EvidenceTime(report);
  assert.equal(report.work_item,'YXX-SS-010');assert.equal(report.status,'IMPLEMENTATION_AND_AUTOMATION_COMPLETE');
  assert.equal(report.local_verification,'PASS');assert.equal(report.readiness,'READY_FOR_LIMITED_WRITE_LIVE');
  assert.equal(report.live_authorized,false);assert.equal(report.live_result,'NOT_RUN');assert.equal(report.parent_gate_advanced,false);
  assert.equal(report.remote_ci,'NOT_RUN');assert.equal(report.remote_review,'NOT_RUN');
  assert.equal(report.base_commit,SS010_BASE);assert.equal(report.candidate_fingerprint,inventory.fingerprint);
  assert.match(report.tested_head,/^[a-f0-9]{40}$/u);
  assert.equal(git(['rev-parse',report.tested_head+'^{tree}']),report.tested_tree);
  assert.equal(git(['merge-base',report.tested_head,'HEAD']),report.tested_head);
  assert.equal(git(['merge-base',SS010_BASE,report.tested_head]),SS010_BASE);
  const objects=new Map(git(['ls-tree','-r',report.tested_head]).split('\n').map(line=>{const [meta,name]=line.split('\t');return [name,meta.split(' ')[2]];}));
  const testedFiles=[...objects.keys()].filter(file=>
    isG2CandidatePath(file));
  assert.deepEqual(testedFiles.sort(),inventory.files.map(file=>file.path).sort());
  for(const file of inventory.files){
    const raw=readFileSync(path.join(root,file.path)),content=file.encoding==='BINARY'?raw:Buffer.from(lf(raw.toString('utf8')));
    assert.equal(createHash('sha1').update('blob '+content.length+'\0').update(content).digest('hex'),objects.get(file.path));
  }
  const run=JSON.parse(readSS010Artifact(root,report.run)),tap=readSS010Artifact(root,report.tap);
  const baseline=JSON.parse(readFileSync(path.join(root,'evidence/yxx-ss-009-r7-full-run.json'),'utf8'));
  const passed=verifyYxxRun({run,tap,inventory,baselineFiles:baseline.files});
  verifyYxxRegressionSummary(report.full_regression,run);
  const trace=readSS010Artifact(root,report.case_trace);assert.equal(evidenceHash(trace),run.case_trace_sha256);
  verifyYxxCaseTrace({cases:trace.trim().split('\n').map(JSON.parse),run,tap});
  const historical=JSON.parse(readSS010Artifact(root,report.historical_check));
  assert.equal(historical.checkout_head,SS010_BASE);assert.equal(historical.result.ok,true);assert.equal(historical.result.status,'SS009_LOCAL_VERIFICATION_COMPLETE');
  assert.equal(historical.result.candidate_fingerprint,JSON.parse(readFileSync(path.join(root,'evidence/yxx-ss-009-r7-report.json'),'utf8')).candidate_fingerprint);
  const review=JSON.parse(readSS010Artifact(root,report.independent_review));
  assert.equal(review.candidate_fingerprint,inventory.fingerprint);assert.equal(review.reviews.length,2);
  for(const axis of ['SPEC','STANDARDS']){const item=review.reviews.find(item=>item.axis===axis);assert.equal(item?.verdict,'PASS');assert.equal(item.unresolved_findings,0);assert.ok(item.reviewer);}
  assert.deepEqual(report.acceptance,SS010_ACCEPTANCE.map(item=>({...item,status:'PASS'})));
  for(const item of report.acceptance){assert.equal(item.status,'PASS');assert.ok(item.tests.length);for(const name of item.tests)assert.ok(passed.has(name));}
  const browser=[...tap.matchAll(/^# SS010_BROWSER (.+)$/gmu)].map(match=>JSON.parse(match[1]));assert.equal(browser.length,1);
  assert.equal(browser[0].candidate_fingerprint,inventory.fingerprint);assert.equal(browser[0].real_browser,true);assert.equal(browser[0].real_postgres,true);assert.equal(browser[0].external_network_calls,0);
  assert.deepEqual(report.browser.map(image=>image.width),[390,1440]);
  for(const image of report.browser){
    assert.equal(image.path,'evidence/yxx-ss-010-ui-'+image.width+'.png');
    assert.equal(lstatSync(path.join(root,image.path)).isSymbolicLink(),false);
    assert.equal(evidenceHash(readFileSync(path.join(root,image.path))),image.sha256);
    assert.ok(browser[0].screenshots.some(source=>source.sha256===image.sha256&&source.width===image.width&&source.height===image.height));
  }
  assert.deepEqual(report.pending_live,['YXX-AC-095','YXX-AC-096','YXX-AC-097','YXX-AC-098','YXX-AC-099','YXX-AC-100','YXX-AC-101','YXX-AC-102']);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root,SS010_TEMPLATE),'utf8')),limitedTemplate());
  return {ok:true,status:'READY_FOR_LIMITED_WRITE_LIVE',tested_head:report.tested_head,candidate_fingerprint:inventory.fingerprint,
    database_connections:0,provider_calls:0,listener_started:false,live_authorized:false,live_result:'NOT_RUN',parent_gate_advanced:false};
}
