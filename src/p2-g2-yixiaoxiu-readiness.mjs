import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {assertG2EvidenceTime} from './p2-g2-evidence-time.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const reject=()=>{throw Object.assign(new Error('YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'),{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});};
export function allowYxxReadinessReportRefresh({changes,authorized,readBaseline,readSnapshot,ready=false,verifyReady}){
  if(changes.length&&(authorized!==true||changes.some(v=>v.status!=='M'||!/^evidence\/p2-g2-automated-readiness-report\.(json|md)$/u.test(v.path))))return false;
  try{if(!changes.every(v=>{
    const baseline=readBaseline(v.path),snapshot=readSnapshot('evidence/p2-g2-yxx-entry-pr7-readiness-snapshot.'+v.path.split('.').at(-1));
    return Buffer.isBuffer(baseline)&&Buffer.isBuffer(snapshot)&&baseline.equals(snapshot);
  }))return false;if(ready)verifyReady();return true;}catch{return false;}
}
export function requirePreparedYxxCandidate({fingerprint,root,fullRegression,passedNames,verifiedRun,verifiedRunReference}){
  if(!fullRegression||!(passedNames instanceof Set)||!verifiedRun||!verifiedRunReference)reject();
  const evidence=ref=>{
    if(!ref||!/^evidence\/p2-g2-yxx-entry-[a-z0-9-]+\.(json|tap)$/u.test(ref.path??''))reject();
    let raw;try{const file=path.join(root,ref.path),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)reject();raw=readFileSync(file);}catch{reject();}
    if(sha(raw)!==ref.sha256)reject();try{const value=JSON.parse(raw);assertG2EvidenceTime(value);return value;}catch{reject();}
  };
  let r;try{r=JSON.parse(readFileSync(path.join(root,'evidence/p2-g2-yxx-entry-report.json'),'utf8'));}catch{reject();}
  try{assertG2EvidenceTime(r);}catch{reject();}
  if(r.work_item!=='P2-G2-YXX-TICKET-ENTRY'||r.candidate_fingerprint!==fingerprint||r.implementation!=='IMPLEMENTED'||r.automation!=='VERIFIED'
    ||r.entry_live_authorized!==false||r.entry_live_result!=='NOT_RUN'||r.p2_g2_live_result!=='NOT_RUN'
    ||r.identity_namespace_live_verified!==false||r.entry_status!=='IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING'
    ||r.persistent_flags_all_off!==true||r.no_ddl!==true||r.real_provider_calls!==0||r.real_business_data_access!==false
    ||r.reporter_policy!=='MEMBER_REQUIRED'||r.full_regression?.tests!==fullRegression?.tests||fullRegression.tests<=976)reject();
  const matrix=evidence(r.sources?.scenario_matrix),routes=evidence(r.sources?.route_audit),run=evidence(r.sources?.regression_run),review=evidence(r.sources?.independent_review);
  if(r.sources.regression_run.path!==verifiedRunReference.path||r.sources.regression_run.sha256!==verifiedRunReference.sha256
    ||JSON.stringify(run)!==JSON.stringify(verifiedRun))reject();
  if([matrix,routes,run,review].some(v=>v.candidate_fingerprint!==fingerprint))reject();
  if(!Array.isArray(matrix.scenarios)||matrix.scenarios.length!==48||new Set(matrix.scenarios.map(s=>s.scenario_id)).size!==48
    ||matrix.scenarios.some(s=>!/^YXX-(?:0[1-9]|[1-3][0-9]|4[0-8])$/u.test(s.scenario_id)||s.automation!=='VERIFIED'||s.live_result!=='NOT_RUN'
      ||!Array.isArray(s.test_names)||s.test_names.length===0||s.test_names.some(name=>!passedNames.has(name))))reject();
  let definitions,contents;
  try{
    definitions=JSON.parse(readFileSync(path.join(root,'tests/fixtures/p2-g2-yixiaoxiu-scenarios.json'),'utf8')).scenarios;
    contents=new Map(verifiedRun.files.map(file=>[file.path,readFileSync(path.join(root,file.path),'utf8')]));
  }catch{reject();}
  if(!Array.isArray(definitions)||definitions.length!==48)reject();
  for(const expected of definitions){
    const actual=matrix.scenarios.find(s=>s.scenario_id===expected.scenario_id);
    const names=[...new Set([...passedNames].filter(n=>new RegExp('\\b'+expected.scenario_id+'\\b','u').test(n)).concat(expected.existing_test_names??[]))];
    const files=verifiedRun.files.filter(file=>contents.get(file.path).includes(expected.scenario_id)||(expected.existing_test_names??[]).some(n=>contents.get(file.path).includes(n)));
    if(!actual||!names.length||!files.length||actual.requirement!==expected.requirement||actual.required_assertion!==expected.required_assertion
      ||JSON.stringify(actual.test_names)!==JSON.stringify(names)||JSON.stringify(actual.test_files)!==JSON.stringify(files))reject();
  }
  if(routes.access_policy!=='MEMBER_REQUIRED'||routes.legacy_cookie_bypass!==false||routes.legacy_exchange_bypass!==false
    ||!Array.isArray(routes.routes)||routes.routes.length<16||routes.identity_namespace_live_verified!==false)reject();
  if(run.suite!=='full'||run.exit_code!==0||run.candidate_unchanged!==true||run.counts?.tests!==fullRegression.tests||run.counts.pass!==run.counts.tests
    ||['fail','skipped','cancelled','todo'].some(k=>run.counts[k]!==0))reject();
  const baseline=JSON.parse(readFileSync(path.join(root,'evidence/p2-g2-pr7-regression-run.json'),'utf8'));
  if(baseline.files?.length!==158||!baseline.files.every(file=>run.files?.some(actual=>actual.path===file.path)))reject();
  if(!Array.isArray(review.reviews)||review.reviews.length!==2||!['SPEC','STANDARDS'].every(axis=>review.reviews.some(v=>v.axis===axis&&v.verdict==='PASS'&&v.unresolved_findings===0)))reject();
  return r;
}
