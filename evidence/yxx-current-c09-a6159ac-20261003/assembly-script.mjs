import assert from 'node:assert/strict';
import {constants,copyFileSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

// External assembly of actual records; all semantic claims are checked by C's
// public verifiers. This script never creates reviews or successful run records.
const runRoot=path.dirname(fileURLToPath(import.meta.url)),source=path.join(runRoot,'checkout');
const full=path.join(runRoot,'shard-1'),historical=path.resolve(runRoot,'../historical-ss009-proof-02');
const view=path.join(runRoot,'assembly-view-01'),packet=path.join(runRoot,'packet-01');
const runId='c09-'+JSON.parse(readFileSync(path.join(runRoot,'candidate.json'),'utf8')).tested_head.slice(0,7)+'-20261003',prefix='evidence/yxx-current-'+runId;
const parse=file=>JSON.parse(readFileSync(file,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=parse(path.join(runRoot,'candidate.json')),inventory=parse(path.join(runRoot,'source-inventory.json'));
assert.match(identity.tested_head,/^[a-f0-9]{40}$/u);
assert.equal(identity.published,false);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),identity.tested_head);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:source,encoding:'utf8',windowsHide:true}).trim(),'');
const acceptance=parse(path.join(source,'plans/yxx-current-readiness-acceptance.json'));
const runDirectory=n=>path.join(runRoot,'shard-'+n);
const runs=[1,2,3,4].map(n=>({n,dir:runDirectory(n),summary:parse(path.join(runDirectory(n),'tests/summary.json'))}));
const selected=runs.flatMap(run=>run.summary.selected_files);
assert.equal(new Set(selected).size,selected.length);assert.deepEqual([...selected].sort(),acceptance.current_files);
const summary={files:[],counts:{tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0}};
const buildBytes=readFileSync(path.join(full,'build-manifest.json')),build=JSON.parse(buildBytes.toString('utf8'));
assert.equal(build.source.head,identity.tested_head);assert.equal(build.source.tree,identity.tested_tree);assert.equal(build.source.dirty,false);
for(const run of runs){
 assert.equal(run.summary.status,'SELECTED_TESTS_PASS');assert.deepEqual(run.summary.not_run,[]);
 assert.equal(run.summary.counts.tests,run.summary.counts.pass);
 for(const key of ['fail','cancelled','skipped','todo'])assert.equal(run.summary.counts[key],0);
 const environment=parse(path.join(run.dir,'environment-cleanup.json'));
 assert.equal(environment.status,'CLEANUP_CONFIRMED');assert.equal(environment.test_exit_code,0);assert.equal(environment.launcher_error,null);
 assert.equal(run.summary.manifest_sha256,hash(buildBytes));assert.deepEqual(readFileSync(path.join(run.dir,'build-manifest.json')),buildBytes);
 for(const [key,value] of Object.entries(run.summary.counts))summary.counts[key]+=value;
 for(const file of run.summary.files)summary.files.push({...file,original_run:run.n});
}
const safe=relative=>{assert.ok(relative&&!path.isAbsolute(relative)&&!relative.includes('\\')&&!relative.split('/').some(p=>!p||p==='.'||p==='..'));return relative;};
const copy=(from,to)=>{assert.ok(lstatSync(from).isFile()&&!lstatSync(from).isSymbolicLink());mkdirSync(path.dirname(to),{recursive:true});copyFileSync(from,to,constants.COPYFILE_EXCL);};
mkdirSync(view);mkdirSync(packet);
for(const file of inventory.files)copy(path.join(source,safe(file.path)),path.join(view,file.path));
for(const output of build.outputs)copy(path.join(source,'.build/runtime',safe(output.path)),path.join(view,'.build/runtime',output.path));
copy(path.join(full,'build-manifest.json'),path.join(view,'.build/runtime/build-manifest.json'));
for(const file of ['evidence/p2-g2-yxx-entry-creation-v2-scenario-matrix.json','evidence/p2-g2-yxx-entry-creation-v2-g2-scenario-matrix.json','evidence/yxx-ss-009-r7-report.json'])copy(path.join(source,file),path.join(view,file));
const evidence=await import(pathToFileURL(path.join(source,'.build/runtime/src/yxx-current-evidence.mjs')).href);
const {SS010_ACCEPTANCE}=await import(pathToFileURL(path.join(source,'.build/runtime/src/yxx-self-service-readiness.mjs')).href);
const {g2CandidateInventory}=await import(pathToFileURL(path.join(source,'.build/runtime/src/p2-g2-candidate.mjs')).href);
const {g2EvidenceTime}=await import(pathToFileURL(path.join(source,'.build/runtime/src/p2-g2-evidence-time.mjs')).href);
assert.equal(g2CandidateInventory(view).fingerprint,inventory.fingerprint);
const files=new Map();
function save(relative,bytes){
  safe(relative);assert.equal(files.has(relative),false);if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
  const target=path.join(view,prefix,relative);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});
  const item={path:relative,bytes:bytes.length,sha256:hash(bytes)};files.set(relative,item);
  return {...item,path:prefix+'/'+relative};
}
const saveJson=(relative,value)=>save(relative,JSON.stringify(value,null,2)+'\n');
const header={tested_head:identity.tested_head,tested_tree:identity.tested_tree,candidate_fingerprint:inventory.fingerprint};
const timed=kind=>({schema_version:1,...g2EvidenceTime(),...header,kind});
const report={schema_version:1,contract:'ADR-0027',run_id:runId,...g2EvidenceTime(),...header,
  scope_sha256:hash(Buffer.from(readFileSync(path.join(source,'plans/yxx-current-readiness-scope.json'),'utf8').replaceAll('\r\n','\n'))),
  acceptance_sha256:hash(Buffer.from(readFileSync(path.join(source,'plans/yxx-current-readiness-acceptance.json'),'utf8').replaceAll('\r\n','\n'))),
  status:'CURRENT_AUTOMATION_COMPLETE',live_authorized:false,parent_gate_advanced:false,
  historical_live_facts:'PRESERVED_NOT_REVALIDATED'};
report.build=save('build-manifest.json',buildBytes);
report.current_runs=[];
for(const run of runs){
 const sub='current/shard-'+run.n+'/';
 for(const name of readdirSync(path.join(run.dir,'tests')).sort())save(sub+safe(name),readFileSync(path.join(run.dir,'tests',name)));
 report.current_runs.push({...files.get(sub+'summary.json'),path:prefix+'/'+sub+'summary.json'});
}
for(const name of readdirSync(historical).sort())if(lstatSync(path.join(historical,name)).isFile())save('historical/'+safe(name),readFileSync(path.join(historical,name)));
report.historical={...files.get('historical/catalog.json'),path:prefix+'/historical/catalog.json'};
save('source-inventory.json',readFileSync(path.join(runRoot,'source-inventory.json')));
save('candidate.json',readFileSync(path.join(runRoot,'candidate.json')));
save('full-launcher.ps1',readFileSync(path.join(runRoot,'run-shard-1.ps1')));
save('assembly-script.mjs',readFileSync(fileURLToPath(import.meta.url)));
const observations=[],cleanups=[],images=[];let migration;
for(const file of summary.files){
  const tapPath=prefix+'/current/shard-'+file.original_run+'/'+file.tap_path,text=readFileSync(path.join(runDirectory(file.original_run),'tests',file.tap_path),'utf8');
  for(const channel of ['SS009_RECEIPT','SS010_BROWSER'])for(const [receiptIndex,match] of [...text.matchAll(new RegExp('^# '+channel+' (.+)\\r?$','gmu'))].entries()){
    const receipt=JSON.parse(match[1]),selector={tap_path:tapPath,channel,receipt_index:receiptIndex};observations.push(selector);
    if(channel==='SS009_RECEIPT'&&receipt.kind==='cleanup')cleanups.push({tap_path:tapPath,receipt_index:receiptIndex});
    if(channel==='SS010_BROWSER'||receipt.kind==='browser')for(const screenshot of receipt.screenshots){
      assert.ok(path.isAbsolute(screenshot.file));const parent=path.basename(path.dirname(screenshot.file));
      assert.ok(parent.startsWith(channel==='SS010_BROWSER'?'ss010-ui-':'ss009-ui-'));
      const relative=path.relative(tmpdir(),screenshot.file);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
      const bytes=readFileSync(screenshot.file);assert.equal(hash(bytes),screenshot.sha256);
      images.push({observation:selector,width:screenshot.width,height:screenshot.height,
        artifact:save('images/'+channel.toLowerCase()+'-'+screenshot.width+'x'+screenshot.height+'.png',bytes)});
    }
  }
  const matches=[...text.matchAll(/^# CURRENT_SCOPE_CATALOG (.+)\r?$/gmu)];
  if(matches.length){assert.equal(file.path,'tests/yxx-current-migrations.integration.test.mts');assert.equal(matches.length,1);assert.equal(migration,undefined);migration={tap_path:tapPath,receipt_index:0};}
}
report.specialized=saveJson('specialized.json',{...timed('CURRENT_SPECIALIZED_PROOF'),observations,images});
assert.ok(migration);report.migration_scope=saveJson('migration-scope.json',{...timed('CURRENT_MIGRATION_SCOPE'),observation:migration});
const cleanupRefs=runs.map(run=>save('environment-cleanup-shard-'+run.n+'.json',readFileSync(path.join(run.dir,'environment-cleanup.json'))));
report.cleanup=saveJson('cleanup.json',{...timed('CURRENT_OWNED_RESOURCE_CLEANUP'),observations:cleanups,environments:cleanupRefs});
for(const run of runs)save('full-launcher-shard-'+run.n+'.ps1',readFileSync(path.join(runRoot,'run-shard-'+run.n+'.ps1')));
report.reviews=[];
for(const [axis,name,reviewer] of [['SPEC','spec','c09_spec'],['STANDARDS','standards','c09_standards']]){
  const raw=readFileSync(path.join(runRoot,name+'-review.json'));
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  assert.equal(record.kind,'CURRENT_INDEPENDENT_REVIEW_RECORD');assert.equal(record.schema_version,1);
  for(const key of ['tested_head','tested_tree','candidate_fingerprint'])assert.equal(record[key],header[key]);
  assert.equal(record.axis,axis);assert.equal(record.reviewer,reviewer);assert.equal(record.independent,true);
  assert.equal(record.verdict,'PASS');assert.equal(record.unresolved_findings,0);assert.equal(record.historical_limitations_reviewed,true);
  assert.ok(Array.isArray(record.findings));assert.ok(typeof record.review_text==='string'&&record.review_text.trim());
  const rawReference=save('reviews/'+name+'-raw.json',raw);
  report.reviews.push(saveJson('reviews/'+name+'.json',{schema_version:1,event_time:record.event_time,event_epoch_ms:record.event_epoch_ms,
    ...header,axis,reviewer,independent:record.independent,verdict:record.verdict,unresolved_findings:record.unresolved_findings,
    historical_limitations_reviewed:record.historical_limitations_reviewed,findings:record.findings,raw_review:rawReference,
    limitations:'Independent implementation review of local frozen C. Full execution, final strict readiness and final H/CI are checked separately.'}));
}
report.source_accounting=saveJson('source-accounting.json',{...timed('CURRENT_SOURCE_ACCOUNTING'),derivation:'SORTED_FILE_TAP_WITH_RECOMPUTED_TOTALS_V1',source_audit:evidence.deriveCurrentYxxSourceAudit(view,report)});
report.scenarios=saveJson('scenarios.json',{...timed('CURRENT_SCENARIO_MAPPING'),technical_only:true,live_authorized:false,
  historical_live_facts:'PRESERVED_NOT_REVALIDATED',...evidence.deriveCurrentYxxScenarios(view,report,SS010_ACCEPTANCE)});
const checks=[];
for(const name of ['verifyCurrentYxxExecution','verifyCurrentYxxReviews','verifyCurrentYxxCleanup','verifyCurrentYxxHistoricalProof','verifyCurrentYxxSpecializedProof','verifyCurrentYxxSourceAccounting','verifyCurrentYxxScenarios','verifyCurrentYxxMigrationProof']){
  evidence[name](view,report,SS010_ACCEPTANCE);checks.push({verifier:name,status:'PASS'});
}
report.assembly_checks=saveJson('assembly-checks.json',{...g2EvidenceTime(),checks,readiness:false,
  pending:['Actual-source scope/history/candidate binding','Rebuild and strict readiness before evidence commit','Final evidence-bearing H rebuild/CI/review']});
saveJson('report.json',report);
// Preserve each original once and persist a complete bounded byte catalog.
const originals=[...files.values()].map(item=>({...item,path:prefix+'/'+item.path,encoding:item.path.endsWith('.png')?'binary':'utf-8'})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const reportOriginal=originals.find(item=>item.path===prefix+'/report.json');assert.ok(reportOriginal);
const catalogRef=saveJson('artifact-catalog.json',{...timed('CURRENT_ORIGINAL_ARTIFACT_CATALOG'),report:reportOriginal,files:originals});
const attestationRef=saveJson('artifact-catalog-attestation.json',{...timed('CURRENT_ARTIFACT_CATALOG_ATTESTATION'),report:reportOriginal,catalog:catalogRef,
  original_files:originals.length,original_records_stored_once:true,summary_files_role:'DERIVED_AGGREGATE_OF_PER_FILE_ORIGINALS',
  readiness:false,live_authorized:false,pending:'Actual-root strict verification and final exact-head CI/review'});
const reportReference={...files.get('report.json'),path:prefix+'/report.json'};
const pointer={schema_version:2,report:reportReference,artifact_catalog:catalogRef,artifact_catalog_attestation:attestationRef};
evidence.verifyCurrentYxxCatalog(view,report,pointer);
checks.push({verifier:'verifyCurrentYxxCatalog',status:'PASS'});
writeFileSync(path.join(runRoot,'catalog-check.json'),JSON.stringify({status:'CATALOG_VERIFIED_NOT_READINESS',tested_head:identity.tested_head,
  original_files:originals.length,namespace_files:files.size,pointer},null,2)+'\n',{flag:'wx'});
for(const item of originals){const bytes=readFileSync(path.join(view,item.path));assert.equal(bytes.length,item.bytes);assert.equal(hash(bytes),item.sha256);}
for(const file of files.values())copy(path.join(view,prefix,file.path),path.join(packet,file.path));
writeFileSync(path.join(packet,'packet.json'),JSON.stringify({schema_version:1,kind:'CURRENT_EVIDENCE_PACKET',run_id:runId,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'))},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PACKET_ASSEMBLED_NOT_READINESS',run_id:runId,packet,files:files.size,tests:summary.counts,checks}));
