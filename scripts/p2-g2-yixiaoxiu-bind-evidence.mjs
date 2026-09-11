import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {g2CandidateInventory,G2_ROOT} from '../src/p2-g2-candidate.mjs';
import {createG2SourceAudit} from '../src/p2-g2-source-audit.mjs';
import {g2Hash} from '../src/p2-g2-validation-config.mjs';
if(process.argv[2]==='--help'){console.log('Usage: node scripts/p2-g2-yixiaoxiu-bind-evidence.mjs tmp/p2-g2-tests-ID');process.exit(0);}
const directory=process.argv[2];if(process.argv.length!==3||!/^tmp\/p2-g2-tests-[a-f0-9-]+$/u.test(directory??''))throw Error('YXX_ENTRY_BIND_ARGUMENT_INVALID');
const read=file=>fs.readFileSync(path.join(G2_ROOT,file),'utf8');const json=file=>JSON.parse(read(file));
const run=json(directory+'/run.json'),tap=read(directory+'/result.tap'),inventory=g2CandidateInventory();
assert.equal(run.suite,'full');assert.equal(run.mode,'SYNTHETIC_AUTOMATION');assert.equal(run.candidate_fingerprint,inventory.fingerprint);assert.equal(run.candidate_unchanged,true);
assert.equal(run.exit_code,0);assert.equal(run.error,null);assert.equal(run.signal,null);assert.equal(run.counts.tests,run.counts.pass);
for(const key of ['fail','skipped','cancelled','todo'])assert.equal(run.counts[key],0);
assert.equal(g2Hash(tap),run.stdout_sha256);
const audit=createG2SourceAudit({tap,run,root:G2_ROOT});assert.equal(audit.accounting_complete,true);assert.equal(audit.observed_normal_pass_cases,122);assert.equal(audit.manual_review_observation_missing.length,0);
const passed=new Set([...tap.matchAll(/^\s*ok \d+ - (.+)$/gmu)].map(match=>match[1]));
const matrix=json('evidence/p2-g2-pr7-scenario-matrix.json');
Object.assign(matrix,{candidate_fingerprint:inventory.fingerprint,regression_run:directory+'/run.json',regression_tap_sha256:run.stdout_sha256});
for(const scenario of matrix.scenarios){
  for(const name of scenario.test_names)assert.ok(passed.has(name),'SCENARIO_NOT_PASSED:'+name);
  for(const ref of scenario.tests){assert.ok(passed.has(ref.test_name));ref.file_sha256=inventory.files.find(file=>file.path===ref.file).sha256;}
}
const invariants=json('evidence/p2-g2-pr7-pr6-invariants.json');
Object.assign(invariants,{candidate_fingerprint:inventory.fingerprint,current_run_status:'PASS',regression_tap_sha256:run.stdout_sha256,regression_run:directory+'/run.json'});
for(const item of invariants.items)for(const ref of item.tests){assert.ok(passed.has(ref.test_name),'INVARIANT_NOT_PASSED:'+ref.test_name);ref.file_sha256=inventory.files.find(file=>file.path===ref.file).sha256;}
function write(file,value){const data=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';const target=path.join(G2_ROOT,file);
  if(fs.existsSync(target))assert.equal(fs.readFileSync(target,'utf8'),data,'OUTPUT_ALREADY_EXISTS:'+file);else fs.writeFileSync(target,data,{flag:'wx'});
  return {path:file,sha256:g2Hash(data)};
}
const sources={regression_tap:write('evidence/p2-g2-yxx-entry-v2-regression.tap',tap),regression_run:write('evidence/p2-g2-yxx-entry-v2-regression-run.json',read(directory+'/run.json')),
  source_execution:write('evidence/p2-g2-yxx-entry-v2-source-execution.json',audit),scenario_matrix:write('evidence/p2-g2-yxx-entry-v2-g2-scenario-matrix.json',matrix),
  pr6_invariants:write('evidence/p2-g2-yxx-entry-v2-pr6-invariants.json',invariants),candidate_inventory:write('evidence/p2-g2-yxx-entry-v2-candidate-inventory.json',inventory)};

// Revalidate every measured historical metric against its current passing diagnostic block.
// Expected/adjudicated labels remain frozen; differences stop publication rather than copying old measurements.
const oldAudit=json('evidence/p2-g2-pr7-source-execution.json'),metrics=json('evidence/p2-g2-pr7-classification-metrics.json');
assert.deepEqual(audit.source_and_adjudication_hashes,oldAudit.source_and_adjudication_hashes);
const blockMap=text=>new Map(text.split(/(?=^[ \t]*# Subtest: )/mu).map(block=>[g2Hash(block),block]));
const oldBlocks=blockMap(read('evidence/p2-g2-pr7-regression.tap')),newBlocks=blockMap(tap);
const values=block=>block.split(/\r?\n/u).map(line=>line.trimStart()).filter(line=>line.startsWith('# {')).map(line=>JSON.parse(line.slice(2)));
function measures(value,at='',out=[]){
  if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
    const next=at+'/'+key;
    if(/^(?:result_code|result_codes|tickets|reviews|ticket_count|review_count|ticket_delta|review_delta|manual_review_count)$/u.test(key))out.push({path:next,value:item});
    else if(item&&typeof item==='object')measures(item,next,out);
  }
  return out;
}
let proofsChecked=0;
for(const item of metrics.cases){
  const previous=oldAudit.cases.find(row=>row.source_case_id===item.source_case_id),current=audit.cases.find(row=>row.source_case_id===item.source_case_id);
  assert.equal(current.source_case_sha256,item.source_case_sha256);
  const refresh=oldHash=>{
    const proof=previous.proofs.find(row=>row.tap_block_sha256===oldHash);assert.ok(proof);
    const matches=current.proofs.filter(row=>row.test_name===proof.test_name);assert.equal(matches.length,1);
    const old=measures(values(oldBlocks.get(oldHash))),fresh=measures(values(newBlocks.get(matches[0].tap_block_sha256)));
    assert.ok(old.length>0,'NO_MEASURED_DIAGNOSTIC:'+item.source_case_id);assert.deepEqual(fresh,old,'MEASUREMENTS_CHANGED:'+item.source_case_id);
    proofsChecked++;return matches[0].tap_block_sha256;
  };
  item.logged_result_sequences=item.logged_result_sequences.map(sequence=>({...sequence,proof:refresh(sequence.proof)}));
  item.count_proof_blocks=item.count_proof_blocks.map(refresh);
}
Object.assign(metrics,{candidate_fingerprint:inventory.fingerprint,tap_sha256:run.stdout_sha256,source_execution_audit_sha256:sources.source_execution.sha256,
  refresh_method:'Every measured result/count proof revalidated against the matching current passing diagnostic; unchanged source labels, formulas and denominators.',measurement_proofs_revalidated:proofsChecked});
sources.classification_metrics=write('evidence/p2-g2-yxx-entry-v2-classification-metrics.json',metrics);
const baselineRecursiveFiles=execFileSync('git',['ls-tree','-r','--name-only','8c332710dad9b6cf3f6796f3344c04d1c710ddf3','--','tests'],{cwd:G2_ROOT,encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/u).filter(file=>file.endsWith('.test.mjs'));
const baselineFiles=baselineRecursiveFiles.filter(file=>/^tests\/[^/]+\.test\.mjs$/u.test(file));
assert.ok(baselineRecursiveFiles.every(file=>run.files.some(row=>row.path===file)));

const memberSpec=json('tests/fixtures/p2-g2-yixiaoxiu-scenarios.json');
const memberMatrix={schema_version:1,work_item:'P2-G2-YXX-TICKET-ENTRY',candidate_fingerprint:inventory.fingerprint,
  regression_run:sources.regression_run,regression_tap_sha256:run.stdout_sha256,scenarios:memberSpec.scenarios.map(s=>{
    const names=[...new Set([...passed].filter(n=>new RegExp('\\b'+s.scenario_id+'\\b','u').test(n)).concat(s.existing_test_names??[]))];
    assert.ok(names.length&&names.every(n=>passed.has(n)),'MEMBER_SCENARIO_NOT_PASSED:'+s.scenario_id);
    const files=run.files.filter(f=>{const text=read(f.path);return text.includes(s.scenario_id)||(s.existing_test_names??[]).some(n=>text.includes(n));});
    assert.ok(files.length,'MEMBER_SOURCE_MAPPING_MISSING:'+s.scenario_id);
    return {scenario_id:s.scenario_id,requirement:s.requirement,required_assertion:s.required_assertion,automation:'VERIFIED',live_result:'NOT_RUN',test_names:names,test_files:files};
  })};
assert.equal(memberMatrix.scenarios.length,48);
sources.member_scenario_matrix=write('evidence/p2-g2-yxx-entry-v2-scenario-matrix.json',memberMatrix);
const routes=[];
for(const line of read('contracts/openapi.yaml').split(/\r?\n/u)){
  const match=/^  (\/(?:api\/reporter|reporter|wecom\/yixiaoxiu)[^:]*): (\{.+\})$/u.exec(line);if(!match)continue;
  const item=JSON.parse(match[2]);for(const method of ['get','post'])if(item[method])routes.push({method:method.toUpperCase(),path:match[1],operation_id:item[method].operationId,
    responses:Object.keys(item[method].responses),description:item[method].description??null});
}
assert.equal(routes.length,17);
sources.route_audit=write('evidence/p2-g2-yxx-entry-v2-route-audit.json',{schema_version:1,candidate_fingerprint:inventory.fingerprint,
  access_policy:'MEMBER_REQUIRED',legacy_cookie_bypass:false,legacy_exchange_bypass:false,identity_namespace_live_verified:false,
  proof_scenarios:['YXX-30','YXX-31','YXX-32','YXX-33','YXX-34','YXX-45'],routes});
const measurement=/^# YXX_RESOURCE (.+)$/mu.exec(tap);assert.ok(measurement,'RESOURCE_DIAGNOSTIC_MISSING');
sources.resource_measurement=write('evidence/p2-g2-yxx-entry-v2-resource.json',{schema_version:1,candidate_fingerprint:inventory.fingerprint,
  regression_tap_sha256:run.stdout_sha256,diagnostic_sha256:g2Hash(measurement[0]),measurement:JSON.parse(measurement[1])});
const pr7=json('evidence/p2-g2-pr7-regression-run.json');assert.equal(pr7.files.length,158);assert.ok(pr7.files.every(f=>run.files.some(v=>v.path===f.path)));

const binding={candidate_fingerprint:inventory.fingerprint,candidate_file_count:inventory.files.length,counts:run.counts,test_file_count:run.files.length,sources,
  baseline_test_file_count:baselineFiles.length,baseline_test_file_count_scope:'ROOT_LEVEL_ONLY',baseline_recursive_test_file_count:baselineRecursiveFiles.length,
  pr7_baseline_test_files_covered:true,pr7_baseline_test_file_count:158,baseline_test_files_covered:true,source_worktree_parent_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:G2_ROOT,encoding:'utf8'}).trim()};
fs.writeFileSync(path.join(G2_ROOT,'tmp/p2-g2-yxx-entry-ready-binding.json'),JSON.stringify(binding,null,2)+'\n');
console.log(JSON.stringify(binding));
