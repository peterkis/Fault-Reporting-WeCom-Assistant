import {readFileSync} from 'node:fs';
import path from 'node:path';
import {g2Hash,failG2} from './p2-g2-validation-config.mjs';

const keys=['tests','pass','fail','skipped','cancelled','todo'];
const originalFiles={
  'hospital-it-evaluation-corpus.v1':'tests/fixtures/p2-007/hospital-it-evaluation-corpus.v1.jsonl',
  'hospital-it-multichannel-evaluation-corpus.v1':'tests/fixtures/p2-007/hospital-it-multichannel-evaluation-corpus.v1.jsonl',
  'multichannel_decision_cases.v1.2':'tests/fixtures/p2-007/multichannel_decision_cases.v1.2.jsonl',
};
const exceptions={
  'D12-005':{status:'ORIGINAL_SEMANTICS_NOT_VERIFIED',reason:'SDK_CONTEXT_HAS_NO_RELIABLE_NON_MENTION_INDICATOR'},
  'D12-023':{status:'FUTURE_P3_NOT_IMPLEMENTED',reason:'NO_HOSPITAL_MASTER_IDENTITY_BINDING_IN_P2'},
};
const differences={
  'D12-016':'URL_GRANT_ALTERNATIVE_VERIFIED_CARD_EVENT_ASSOCIATION_NOT_IMPLEMENTED',
  'D12-053':'PROACTIVE_OUTBOX_ALTERNATIVE_VERIFIED_CALLBACK_RECEIPT_NOT_IMPLEMENTED',
  'D12-019':'DIRECTORY_SNAPSHOT_ONLY_SYSTEM_PERSON_ID_NOT_IMPLEMENTED',
  'D12-043':'FROZEN_120_SECONDS_DEPARTMENT_INSTEAD_OF_SOURCE_LOCAL_300_SECONDS',
  'D12-044':'FROZEN_120_SECONDS_CAMPUS_INSTEAD_OF_SOURCE_CROSS_DEPARTMENT',
  'D12-045':'CAMPUS_WITH_ZERO_TRUSTED_LOCATIONS_NOT_SOURCE_HOSPITAL_WIDE',
  'D12-055':'PRIVATE_GUIDANCE_REQUIRES_ACTUAL_DIRECT_LEG',
  'D12-056':'CREATED_CARD_OPTIONAL_DEFAULT_OFF',
  'D12-061':'CARD_IMPLEMENTED_LOCAL_VALIDATION_NOT_HISTORICAL_PENDING_OR_LIVE_PASS',
  'D12-062':'RESUMED_NOTIFICATION_OPTIONAL_DEFAULT_OFF',
  'D12-063':'ACTUAL_CONFIRMATION_VERSION_ONE_NOT_SEEDED_VERSION_TWO',
  'P2-007-X031':'FROZEN_DISTINCT_REPORTER_COUNTS_WITH_UNKNOWN_DEPARTMENT_AND_LOCATION',
  'P2-007-C034':'ROLE_QUALIFIED_PURE_FACT_CONFLICT_NOT_NORMAL_REPORTER_INGRESS',
  'P2-007-C090':'BUILD_TIME_PRIVACY_NOT_RUNTIME_ROUTING',
};
function declaredIds(text){
  const ids=new Set();
  for(const m of text.matchAll(/\b(?:P2-007-)?([CX]\d{3})\b/gu))ids.add('P2-007-'+m[1]);
  for(const m of text.matchAll(/\bD12-(\d{3}(?:\/\d{3})*)\b/gu))for(const part of m[1].split('/'))ids.add('D12-'+part);
  return ids;
}
function diagnostics(block){
  const output=[];for(const raw of block.split(/\r?\n/u)){const line=raw.trimStart();if(line.startsWith('# {')){
    try{output.push(JSON.parse(line.slice(2)));}catch{/* Ordinary TAP diagnostics need not be JSON. */}
  }}return output;
}
function sourceDeclarations(value,ids=new Set()){
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
    if(['source_case_id','source_case_ids','source_ids','case_id'].includes(key)){
      for(const text of Array.isArray(item)?item:[item])if(typeof text==='string')for(const id of declaredIds(text))ids.add(id);
    }else if(item&&typeof item==='object')sourceDeclarations(item,ids);
  }return ids;
}
function observations(value,result=[]){
  if(value&&typeof value==='object'){
    if(typeof value.result_code==='string'&&Array.isArray(value.actual_actions))result.push(value);
    else for(const item of Object.values(value))if(item&&typeof item==='object')observations(item,result);
  }return result;
}

// Records executed assertions and observations for independent semantic review.
// A name/diagnostic match is not, by itself, proof of every original expectation.
export function createG2SourceAudit({tap,run,root}){
  if(typeof tap!=='string'||tap.length>64*1024*1024||run?.mode!=='SYNTHETIC_AUTOMATION'
    ||run.exit_code!==0||run.error!==null||run.signal!==null||run.candidate_unchanged!==true
    ||run.stdout_sha256!==g2Hash(tap)||!['g2','full'].includes(run.suite))failG2('SOURCE_EXECUTION_NOT_VERIFIED');
  const counts={};for(const line of tap.split(/\r?\n/u)){
    if(/^\s*not ok \d+/u.test(line))failG2('SOURCE_EXECUTION_NOT_VERIFIED');
    const m=/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/u.exec(line);if(m)counts[m[1]]=Number(m[2]);
  }
  if(keys.some(k=>!Number.isSafeInteger(counts[k])||counts[k]!==run.counts?.[k])||counts.tests<1
    ||counts.tests!==counts.pass||keys.slice(2).some(k=>counts[k]!==0))failG2('SOURCE_EXECUTION_NOT_VERIFIED');
  const hashes={};const read=(file,jsonl=false)=>{
    const raw=readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');hashes[file]=g2Hash(raw);
    return jsonl?raw.trim().split(/\r?\n/u).map(JSON.parse):JSON.parse(raw);
  };
  const refs=read('tests/fixtures/p2-015/rule-first-safe-route-gold.v1.jsonl',true);
  const source=Object.fromEntries(Object.entries(originalFiles).map(([key,file])=>[key,read(file,true)]));
  const x=read('tests/fixtures/p2-g2/multichannel-adjudications.v1.json').records;
  const c=read('tests/fixtures/p2-g2/gold-adjudications.v1.jsonl',true);
  read('tests/fixtures/p2-g2/mechanism-adjudications.v1.json');
  if(refs.length!==202||new Set(refs.map(r=>r.source_case_id)).size!==202)failG2('SOURCE_CORPUS_INVALID');
  const evidence=new Map();
  for(const block of tap.split(/(?=^[ \t]*# Subtest: )/mu)){
    const name=/^[ \t]*# Subtest: (.+)$/mu.exec(block)?.[1];
    const pass=/^[ \t]*ok (\d+) - (.+)$/mu.exec(block);
    if(!name||!pass||pass[2]!==name)continue;
    const values=diagnostics(block),ids=declaredIds(name);
    for(const value of values)for(const id of sourceDeclarations(value))ids.add(id);
    const observed=values.flatMap(v=>observations(v));
    const proof={test_name:name,test_number:Number(pass[1]),tap_block_sha256:g2Hash(block),
      diagnostic_sha256:g2Hash(JSON.stringify(values)),observed_results:[...new Set(observed.map(o=>o.result_code))],
      actual_manual_review_action:observed.some(o=>o.actual_actions.some(a=>
        ['ENQUEUE_MANUAL_REVIEW','ROUTE_SERVICE_REQUEST','ROUTE_BUSINESS_CONSULTATION','QUERY_AUTHORIZED_STATUS'].includes(a.action_type)
        &&['EXECUTED','REPLAYED'].includes(a.state)&&a.result_ref_type==='MANUAL_REVIEW'))};
    for(const id of ids){if(!evidence.has(id))evidence.set(id,[]);evidence.get(id).push(proof);}
  }
  const cases=refs.map(ref=>{
    const id=ref.source_case_id,original=source[ref.source_fixture]?.find(r=>r.case_id===id);
    if(!original)failG2('SOURCE_CORPUS_INVALID');
    const normal=id.startsWith('P2-007-C')?!['P2-007-C034','P2-007-C090'].includes(id):x.find(r=>r.case_id===id)?.counts_toward_normal_ingress_recognition===true;
    const proofs=evidence.get(id)??[],adjudication=c.find(r=>r.source_case_id===id)??x.find(r=>r.case_id===id);
    return {source_case_id:id,source_fixture:ref.source_fixture,source_file_sha256:hashes[originalFiles[ref.source_fixture]],
      source_case_sha256:g2Hash(JSON.stringify(original)),normal_input_denominator:normal,
      status:exceptions[id]?.status??(proofs.length?'PASS_TEST_OBSERVED_PENDING_SEMANTIC_REVIEW':'EXECUTION_MISSING'),
      adjudication:differences[id]??exceptions[id]?.reason??adjudication?.finding??adjudication?.conflict_kind??'CURRENT_CONTRACT_REQUIRES_SOURCE_REVIEW',
      original_expected_result_code:ref.expected_result_code,proofs};
  });
  const normal=cases.filter(c=>c.normal_input_denominator),missing=cases.filter(c=>c.status==='EXECUTION_MISSING');
  if(normal.length!==122)failG2('SOURCE_DENOMINATOR_CHANGED');
  const expectedManual=new Set([...c.filter(c=>c.manual_review_expected).map(c=>c.source_case_id),
    ...x.filter(r=>['REQUIRED','REQUIRED_ASSOCIATION_REVIEW'].includes(r.review_requirement)).map(r=>r.case_id)]);
  const missingManual=cases.filter(c=>expectedManual.has(c.source_case_id)&&!c.proofs.some(p=>p.actual_manual_review_action)).map(c=>c.source_case_id);
  return {schema_version:1,candidate_fingerprint:run.candidate_fingerprint,run_suite:run.suite,
    tap_sha256:run.stdout_sha256,source_and_adjudication_hashes:hashes,total_source_cases:202,
    normal_input_cases:122,mechanism_and_other_cases:80,observed_normal_pass_cases:normal.filter(c=>c.proofs.length).length,
    observed_normal_test_coverage_percent:100*normal.filter(c=>c.proofs.length).length/122,
    accounting_complete:missing.length===0,execution_missing:missing.map(c=>c.source_case_id),
    expected_manual_review_cases:expectedManual.size,manual_review_observation_missing:missingManual,
    original_semantics_all_passed:false,semantic_review_required:true,cases};
}
