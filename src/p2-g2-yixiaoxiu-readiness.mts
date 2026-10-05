import type {G2EvidenceTime} from './p2-g2-evidence-time.mjs';
import type { BinaryLike } from 'node:crypto';
import type { CandidateFingerprint } from './p2-g2-validation-config.mjs';
interface EvidenceReference {path?:unknown;sha256?:unknown}
interface MemberReportInput extends Record<string,unknown> {mapping_repair?:Record<string,unknown>;full_regression?:Record<string,unknown>;
 sources?:Partial<Record<'scenario_matrix'|'route_audit'|'regression_run'|'independent_review',EvidenceReference>>}
interface EvidenceInput extends Record<string,unknown> {scenarios?:Record<string,unknown>[];counts?:Record<string,unknown>;files?:{path:unknown}[];routes?:unknown[];reviews?:Record<string,unknown>[]}
interface Definition {scenario_id:string;existing_test_names?:string[];requirement:unknown;required_assertion:unknown}
export interface PreparedYxxCandidate {work_item:'P2-G2-YXX-TICKET-ENTRY';candidate_fingerprint:CandidateFingerprint;
 implementation:'IMPLEMENTED';automation:'VERIFIED';entry_live_authorized:false;entry_live_result:'NOT_RUN';p2_g2_live_result:'NOT_RUN';identity_namespace_live_verified:false;reporter_policy:'MEMBER_REQUIRED'}
export interface PreparedYxxInput {fingerprint:CandidateFingerprint;root:string;fullRegression:unknown;passedNames:Set<string>;verifiedRun:unknown;verifiedRunReference:unknown}
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {assertG2EvidenceTime} from './p2-g2-evidence-time.mjs';
import {readG2CurrentEvidence} from './p2-g2-current-evidence.mjs';

const sha=(value:BinaryLike)=>createHash('sha256').update(value).digest('hex');
const reject:()=>never=()=>{throw Object.assign(new Error('YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'),{code:'YXX_ENTRY_CURRENT_EVIDENCE_REQUIRED'});};
export function allowYxxReadinessReportRefresh({changes,authorized,readBaseline,readSnapshot,ready=false,verifyReady}: {changes:{status:string;path:string}[];authorized:boolean;readBaseline:(path:string)=>unknown;readSnapshot:(path:string)=>unknown;ready?:boolean;verifyReady:()=>unknown}){
  if(changes.length&&(authorized!==true||changes.some(v=>v.status!=='M'||!/^evidence\/p2-g2-automated-readiness-report\.(json|md)$/u.test(v.path))))return false;
  try{if(!changes.every(v=>{
    const baseline=readBaseline(v.path),snapshot=readSnapshot('evidence/p2-g2-yxx-entry-pr7-readiness-snapshot.'+v.path.split('.').at(-1));
    return Buffer.isBuffer(baseline)&&Buffer.isBuffer(snapshot)&&baseline.equals(snapshot);
  }))return false;if(ready)verifyReady();return true;}catch{return false;}
}
export function requirePreparedYxxCandidate({fingerprint,root,fullRegression,passedNames,verifiedRun,verifiedRunReference}: PreparedYxxInput): PreparedYxxCandidate{
  if(!fullRegression||!(passedNames instanceof Set)||!verifiedRun||!verifiedRunReference)reject();
  const evidence=(ref:EvidenceReference|undefined): EvidenceInput=>{
    if(!ref||!/^evidence\/p2-g2-yxx-entry-[a-z0-9-]+\.(json|tap)$/u.test((ref.path??'') as string))reject();
    let raw;try{const file=path.join(root,ref.path as string),stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)reject();raw=readFileSync(file);}catch{reject();}
    if(sha(raw)!==ref.sha256)reject();try{const value:unknown=(JSON.parse as (bytes:string|Buffer)=>unknown)(raw);assertG2EvidenceTime(value);return value as EvidenceInput & G2EvidenceTime;}catch{reject();}
  };
  let r:MemberReportInput;try{r=readG2CurrentEvidence(root,'member') as MemberReportInput;}catch{reject();}
  try{assertG2EvidenceTime(r);}catch{reject();}
  const entryStatusValid=r.entry_status==='IDENTITY_NAMESPACE_LIVE_VERIFICATION_PENDING'
    ||r.entry_status==='DELEGATED_MAPPING_LIVE_VALIDATION_PENDING'&&r.mapping_repair?.status==='VERIFIED'
    &&r.mapping_repair.mode==='VERIFIED_DELEGATED_MAPPING'&&r.mapping_repair.readonly_profile_only===true
    &&r.mapping_repair.current_live_result==='NOT_RUN'&&[
      'delegated member conversion binds exact original Bot identities without normalizing encrypted IDs',
      'delegated OAuth HTTP reads own original Bot tickets, denies other members and preserves Grant and business facts',
      'readonly check stays offline and conversion failure prevents startup; full service loop cannot inherit mapped mode',
    ].every(name=>passedNames.has(name as string));
  if(r.work_item!=='P2-G2-YXX-TICKET-ENTRY'||r.candidate_fingerprint!==fingerprint||r.implementation!=='IMPLEMENTED'||r.automation!=='VERIFIED'
    ||r.entry_live_authorized!==false||r.entry_live_result!=='NOT_RUN'||r.p2_g2_live_result!=='NOT_RUN'
    ||r.identity_namespace_live_verified!==false||!entryStatusValid
    ||r.persistent_flags_all_off!==true||r.no_ddl!==true||r.real_provider_calls!==0||r.real_business_data_access!==false
    ||r.reporter_policy!=='MEMBER_REQUIRED'||r.full_regression?.tests!==(fullRegression as {tests:number})?.tests||(fullRegression as {tests:number}).tests<=976)reject();
  const matrix=evidence(r.sources?.scenario_matrix),routes=evidence(r.sources?.route_audit),run=evidence(r.sources?.regression_run),review=evidence(r.sources?.independent_review);
  if(((r.sources as NonNullable<MemberReportInput['sources']>).regression_run as EvidenceReference).path!==(verifiedRunReference as {path:unknown;sha256:unknown}).path||((r.sources as NonNullable<MemberReportInput['sources']>).regression_run as EvidenceReference).sha256!==(verifiedRunReference as {path:unknown;sha256:unknown}).sha256
    ||JSON.stringify(run)!==JSON.stringify(verifiedRun))reject();
  if([matrix,routes,run,review].some(v=>v.candidate_fingerprint!==fingerprint))reject();
  if(!Array.isArray(matrix.scenarios)||matrix.scenarios.length!==48||new Set(matrix.scenarios.map(s=>s.scenario_id)).size!==48
    ||matrix.scenarios.some(s=>!/^YXX-(?:0[1-9]|[1-3][0-9]|4[0-8])$/u.test(s.scenario_id as string)||s.automation!=='VERIFIED'||s.live_result!=='NOT_RUN'
      ||!Array.isArray(s.test_names)||s.test_names.length===0||s.test_names.some(name=>!passedNames.has(name as string))))reject();
  let definitions:Definition[],contents:Map<string,string>;
  try{
    definitions=JSON.parse(readFileSync(path.join(root,'tests/fixtures/p2-g2-yixiaoxiu-scenarios.json'),'utf8')).scenarios;
    contents=new Map((verifiedRun as {files:{path:string}[]}).files.map(file=>[file.path,readFileSync(path.join(root,file.path),'utf8')]));
  }catch{reject();}
  if(!Array.isArray(definitions)||definitions.length!==48)reject();
  for(const expected of definitions){
    const actual=matrix.scenarios.find(s=>s.scenario_id===expected.scenario_id);
    const names=[...new Set([...passedNames].filter(n=>new RegExp('\\b'+expected.scenario_id+'\\b','u').test(n)).concat(expected.existing_test_names??[]))];
    const files=(verifiedRun as {files:{path:string}[]}).files.filter(file=>(contents.get(file.path) as string).includes(expected.scenario_id)||(expected.existing_test_names??[]).some(n=>(contents.get(file.path) as string).includes(n)));
    if(!actual||!names.length||!files.length||actual.requirement!==expected.requirement||actual.required_assertion!==expected.required_assertion
      ||JSON.stringify(actual.test_names)!==JSON.stringify(names)||JSON.stringify(actual.test_files)!==JSON.stringify(files))reject();
  }
  if(routes.access_policy!=='MEMBER_REQUIRED'||routes.legacy_cookie_bypass!==false||routes.legacy_exchange_bypass!==false
    ||!Array.isArray(routes.routes)||routes.routes.length<16||routes.identity_namespace_live_verified!==false)reject();
  if(run.suite!=='full'||run.exit_code!==0||run.candidate_unchanged!==true||run.counts?.tests!==(fullRegression as {tests:number}).tests||(run.counts as Record<string,unknown>).pass!==(run.counts as Record<string,unknown>).tests
    ||['fail','skipped','cancelled','todo'].some(k=>(run.counts as Record<string,unknown>)[k]!==0))reject();
  const baseline: {files?:{path:unknown}[]}=JSON.parse(readFileSync(path.join(root,'evidence/p2-g2-pr7-regression-run.json'),'utf8'));
  if(baseline.files?.length!==158||!baseline.files.every(file=>run.files?.some(actual=>actual.path===file.path)))reject();
  if(!Array.isArray(review.reviews)||review.reviews.length!==2||!['SPEC','STANDARDS'].every(axis=>(review.reviews as Record<string,unknown>[]).some(v=>v.axis===axis&&v.verdict==='PASS'&&v.unresolved_findings===0)))reject();
  return r as MemberReportInput & PreparedYxxCandidate & G2EvidenceTime;
}
