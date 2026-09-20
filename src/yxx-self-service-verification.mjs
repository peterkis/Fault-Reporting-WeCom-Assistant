import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {g2CandidateInventory,G2_ROOT,G2_CANDIDATE_ROOTS,G2_CANDIDATE_FILES,G2_EXCLUDED_LOCAL_FILES} from './p2-g2-candidate.mjs';
import {assertG2EvidenceTime} from './p2-g2-evidence-time.mjs';
import {readYxxLocalValidationScope} from './yxx-self-service-validation-scope.mjs';
import {createG2SourceAudit} from './p2-g2-source-audit.mjs';
import {verifyYxxEvidenceHistory} from './yxx-self-service-evidence-history.mjs';

export const SS009_BASE='375d47b013017edb858206cc5f3475c9aed77dfd';
export const SS009_EVIDENCE_PREFIX='evidence/yxx-ss-009-r7-';
export const SS009_VALIDATORS=['validate-v1-4-architecture.mjs','validate-arch-005-time-contract.mjs','validate-arch-006-rule-first-service-loop.mjs','validate-p2-015-rule-first-intake.mjs','validate-p2-016-ticket-lifecycle-workbench.mjs','validate-p2-012-human-confirmed-incident.mjs','validate-p2-g2-service-loop.mjs','p2-g2-yixiaoxiu-check.mjs'];
export const evidenceHash=value=>createHash('sha256').update(value).digest('hex');
const countKeys=['tests','pass','fail','cancelled','skipped','todo'];
const normalize=value=>value.replaceAll('\r\n','\n');
const testPath=file=>/^tests\/(?:p2-007\/)?[^/]+\.test\.mjs$/u.test(file);

export function verifyYxxCompletionState(report,{preTamper=false}={}){
  if(!preTamper&&(report?.status!=='IMPLEMENTATION_AND_AUTOMATION_COMPLETE'||report?.local_verification!=='PASS')){
    throw Object.assign(new Error('SS009_COMPLETION_STATE_REQUIRED'),{code:'SS009_COMPLETION_STATE_REQUIRED'});
  }
}

export function verifyYxxRegressionSummary(summary,run){
  assert.deepEqual(summary,{...run.counts,test_files:run.files.length,candidate_unchanged:run.candidate_unchanged});
}

export function verifyYxxCaseTrace({cases,run,tap}){
  assert.equal(cases.length,run.counts.tests);
  const files=new Set(run.files.map(f=>f.path)),observedFiles=new Set();
  const execution=Array.isArray(run.file_execution)?run.file_execution:null;
  if(!execution)throw Object.assign(new Error('SS009_TEST_FILE_EXECUTION_PROVENANCE_REQUIRED'),{code:'SS009_TEST_FILE_EXECUTION_PROVENANCE_REQUIRED'});
  const executionByFile=new Map();
  for(const row of execution){
    assert.equal(typeof row?.path,'string');assert.ok(files.has(row.path));assert.ok(!executionByFile.has(row.path));
    for(const key of ['total','pass','fail','skipped','todo'])assert.ok(Number.isSafeInteger(row[key])&&row[key]>=0);
    assert.match(row.identity_sha256,/^[a-f0-9]{64}$/u);
    assert.equal(row.total,row.pass+row.fail+row.skipped+row.todo);executionByFile.set(row.path,row);
  }
  const missingExecution=[...files].filter(file=>!executionByFile.has(file));
  if(missingExecution.length)throw Object.assign(new Error('SS009_TEST_FILE_EXECUTION_REQUIRED'),{
    code:'SS009_TEST_FILE_EXECUTION_REQUIRED',missing_files:missingExecution.sort(),
  });
  const unexpectedExecution=[...executionByFile.keys()].filter(file=>!files.has(file));
  if(unexpectedExecution.length)throw Object.assign(new Error('SS009_TEST_FILE_PROVENANCE_MISMATCH'),{
    code:'SS009_TEST_FILE_PROVENANCE_MISMATCH',unexpected_files:unexpectedExecution.sort(),
  });
  // Node 24 TAP escapes controls before backslashes and hashes. Compare in
  // that representation rather than ambiguously unescaping test names.
  const controls={'\b':'b','\f':'f','\t':'t','\n':'n','\r':'r','\v':'v'};
  const escape=name=>name.replace(/[\b\f\t\n\r\v]/gu,c=>'\\'+controls[c]).replaceAll('\\','\\\\').replaceAll('#','\\#');
  const observedCounts=new Map(),observedIdentities=new Map();
  const observed=cases.map(c=>{
    assertG2EvidenceTime(c);assert.equal(c.time_basis,'REPORTER_OBSERVED_AT');
    assert.equal(c.event,'test:pass');assert.equal(c.skip,false);assert.equal(c.todo,false);
    assert.ok(files.has(c.file));assert.equal(typeof c.name,'string');assert.ok(Number.isSafeInteger(c.nesting)&&c.nesting>=0);
    observedFiles.add(c.file);
    assert.ok(c.line===null||Number.isSafeInteger(c.line));
    observedCounts.set(c.file,(observedCounts.get(c.file)??0)+1);
    const identities=observedIdentities.get(c.file)??[];identities.push(JSON.stringify([c.nesting,c.name,c.line??null]));observedIdentities.set(c.file,identities);
    return JSON.stringify([c.nesting,escape(c.name)]);
  });
  // The collected inventory is not proof of execution: require the reverse
  // inclusion as well, including files absent from the acceptance mappings.
  const missingFiles=[...files].filter(file=>!observedFiles.has(file)).sort();
  if(missingFiles.length)throw Object.assign(new Error('SS009_TEST_FILE_EXECUTION_REQUIRED'),{
    code:'SS009_TEST_FILE_EXECUTION_REQUIRED',missing_files:missingFiles,
  });
  const provenanceMismatches=[...files].flatMap(file=>{
    const row=executionByFile.get(file),observedPass=observedCounts.get(file)??0;
    const identity_sha256=row?evidenceHash(JSON.stringify((observedIdentities.get(file)??[]).sort())):null;
    if(!row||row.pass!==observedPass||row.pass<1||row.fail!==0||row.skipped!==0||row.todo!==0||row.identity_sha256!==identity_sha256)return [{file,recorded:row?.pass??null,observed:observedPass,recorded_identity:row?.identity_sha256??null,observed_identity:identity_sha256}];
    return [];
  });
  if(provenanceMismatches.length)throw Object.assign(new Error('SS009_TEST_FILE_PROVENANCE_MISMATCH'),{
    code:'SS009_TEST_FILE_PROVENANCE_MISMATCH',mismatches:provenanceMismatches,
  });
  const successes=[...normalize(tap).matchAll(/^( *)ok \d+ - (.+)$/gmu)].map(m=>{
    assert.equal(m[1].length%4,0);return JSON.stringify([m[1].length/4,m[2]]);
  });
  assert.deepEqual(observed.sort(),successes.sort());
}

export function verifyYxxReceipts(kind,records){
  assert.ok(Array.isArray(records)&&records.length>0);
  for(const r of records){assertG2EvidenceTime(r);assert.equal(r.kind,kind);assert.equal(r.status,'PASS');}
  if(kind==='fault'){
    const killed=records.find(r=>r.real_kills===5);assert.ok(killed);assert.equal(killed.cases.length,5);
    assert.deepEqual(killed.cases.map(c=>c.action+':'+c.barrier),['accept:before-commit','accept:after-commit','process:before-process','process:before-commit','process:after-commit']);
    for(const c of killed.cases){assert.equal(c.recovered,true);assert.equal(c.ticket_count,1);assert.equal(c.receipt_count,1);}
    assert.ok(records.some(r=>r.owned_backend_terminated&&r.recovery_verified&&r.shared_database_service_stopped===false));
    assert.ok(records.some(r=>r.http_response_lost&&r.same_command_recovered&&r.cross_member_denied&&r.batch_max===20));
    assert.ok(records.some(r=>r.savepoint_partial_write===true&&r.partial_write_observed===true&&r.partial_write_rolled_back===true&&r.fallback_decisions===1&&r.fallback_reviews===1&&r.acceptance_retained===true));
  }
  if(kind==='capacity'){
    const profiles=records.flatMap(r=>r.profiles);assert.equal(profiles.length,2);
    for(const name of ['MEMBER_SELF_SERVICE','FULL_SERVICE_LOOP']){
      const p=profiles.find(p=>p.profile===name);assert.ok(p);
      for(const [key,n] of Object.entries({submissions:500,supplements:2000,reviews:100,readers:32,duplicate_requests:12,roots:501,sources:2501,receipts:2501,tickets:301,external_network_calls:0,gateway_processes:0,controller_pool_max:1,app_pool_max:4}))assert.equal(p[key],n,key);
      assert.equal(p.formal_2c4g_60min,false);assert.ok(p.samples.length>0);assert.ok(p.elapsed_ms>0);
      assert.ok(Object.values(p.artifacts).every(n=>n===0));assert.ok(Object.keys(p.artifacts).length>=6);
      for(const sample of p.samples){assert.ok(sample.pool_total<=(sample.role==='APP'?4:2));}
      if(name==='FULL_SERVICE_LOOP')assert.ok(p.samples.some(s=>s.role==='WORKER'));
    }
  }
  if(kind==='catalog'){
    const r=records.find(r=>r.check_rollback===true);assert.ok(r);assert.deepEqual(r.drift_classes,['COLUMN','CHECK','FK','UNIQUE','INDEX']);assert.equal(r.forbidden_timezone_columns,0);
    const populated=records.find(r=>r.populated_bot_upgrade===true);assert.ok(populated);assert.equal(populated.baseline,'032');assert.deepEqual(populated.migrations,['033','034']);
    assert.equal(populated.existing_rows_unchanged,true);assert.equal(populated.existing_command_replays,true);assert.ok(populated.linked_roots>=2);
    for(const table of ['channel.message_inbox','intake.service_intake','intake.service_intake_message','intake.service_intake_event','intake.contact_journey','intake.channel_leg','intake.deterministic_decision','intake.safe_action_suggestion','intake.manual_review_item','pilot_ticket.ticket','communication.message','communication.outbox','communication.delivery'])assert.ok(Number.isSafeInteger(populated.graph_rows?.[table])&&populated.graph_rows[table]>0,table);
  }
  return records;
}

export function historicalYxxBindings({root,cases,inventory}){
  return [['member',48,'evidence/p2-g2-yxx-entry-creation-v2-scenario-matrix.json'],['g2',37,'evidence/p2-g2-yxx-entry-creation-v2-g2-scenario-matrix.json']].map(([kind,count,file])=>{
    const historical=JSON.parse(readFileSync(path.join(root,file),'utf8'));assert.equal(historical.scenarios.length,count);
    return {kind,count,source:file,source_sha256:evidenceHash(normalize(readFileSync(path.join(root,file),'utf8'))),scenarios:historical.scenarios.map(s=>({id:s.scenario_id,live_result:'NOT_RUN',tests:s.test_names.map(name=>{
      const matches=cases.filter(c=>c.name===name&&c.event==='test:pass'&&!c.skip&&!c.todo);assert.equal(matches.length,1,name);
      const test=matches[0],source=inventory.files.find(f=>f.path===test.file);assert.ok(source);return {file:test.file,name,sha256:source.sha256};
    })}))};
  });
}

export function verifyYxxRun({run,tap,inventory,baselineFiles}){
  assertG2EvidenceTime(run);
  assert.equal(run.suite,'full');assert.equal(run.exit_code,0);assert.equal(run.signal,null);assert.equal(run.error,null);
  assert.equal(run.expose_gc,true);assert.match(run.node_version,/^24\./u);
  assert.equal(run.candidate_unchanged,true);assert.equal(run.candidate_fingerprint,inventory.fingerprint);
  assert.equal(evidenceHash(tap),run.stdout_sha256);
  assert.ok(!/^\s*not ok\b/mu.test(tap));
  for(const [line] of tap.matchAll(/^ *ok .+$/gmu))assert.ok(!/(?:^|[^\\])(?:\\\\)*#\s*(?:SKIP|TODO)\b/iu.test(line));
  const counts={};for(const line of tap.split(/\r?\n/u)){const m=/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/u.exec(line);if(m){assert.ok(!(m[1] in counts));counts[m[1]]=Number(m[2]);}}
  assert.deepEqual(counts,run.counts);assert.ok(counts.tests>=1155);assert.equal(counts.pass,counts.tests);
  for(const key of countKeys.slice(2))assert.equal(counts[key],0);
  const names=[...tap.matchAll(/^\s*ok \d+ - (.+)$/gmu)].map(m=>m[1].replace(/\r$/u,''));assert.equal(names.length,counts.tests);
  const files=inventory.files.filter(f=>testPath(f.path));assert.ok(files.length>=183);
  assert.equal(run.files.length,files.length);assert.equal(new Set(run.files.map(f=>f.path)).size,files.length);
  for(const file of files)assert.ok(run.files.some(f=>f.path===file.path&&f.sha256===file.sha256));
  for(const file of baselineFiles)assert.ok(files.some(f=>f.path===(file.path??file)));
  return new Set(names);
}

export function readYxxEvidence(root,ref){
  assert.ok(ref&&typeof ref.path==='string');
  assert.match(ref.path,/^evidence\/[a-zA-Z0-9_.-]+$/u);
  const directory=path.join(root,'evidence');assert.ok(!lstatSync(directory).isSymbolicLink());
  const file=path.join(root,ref.path),stat=lstatSync(file);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=64*1024*1024);
  const raw=readFileSync(file),text=normalize(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  assert.equal(ref.encoding,'UTF8_LF');assert.equal(evidenceHash(text),ref.sha256);
  return text;
}

export function validateYxxSelfService({root=G2_ROOT,requireReady=false,preTamper=false}={}){
  const git=args=>execFileSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8'}).trim();
  assert.equal(git(['merge-base',SS009_BASE,'HEAD']),SS009_BASE);
  if(!readYxxLocalValidationScope(root))throw Object.assign(new Error('SS009_LOCAL_VALIDATION_SCOPE_REQUIRED'),{code:'SS009_LOCAL_VALIDATION_SCOPE_REQUIRED'});
  assert.equal(git(['diff','--name-only','--diff-filter=MDR',SS009_BASE,'--','evidence']),'');
  verifyYxxEvidenceHistory(root);
  const read=file=>JSON.parse(readFileSync(path.join(root,file),'utf8'));
  const start=read('evidence/yxx-ss-009-start.json');assertG2EvidenceTime(start);assert.equal(start.base_head,SS009_BASE);
  assert.equal(evidenceHash(readFileSync(path.join(root,'.gitignore'))),start.gitignore_sha256);
  assert.equal(git(['rev-parse',':.gitignore']),start.gitignore_index);
  const inventory=g2CandidateInventory(root),matrix=read('plans/yxx-ss-009-acceptance.json');
  assert.equal(matrix.scenarios.length,102);
  matrix.scenarios.forEach((s,i)=>{assert.equal(s.id,'YXX-AC-'+String(i+1).padStart(3,'0'));assert.ok(Array.isArray(s.tests));if(i<90)assert.ok(s.tests.length>0||i===85&&s.evidence_kind==='review'||i===89&&s.evidence_kind==='cleanup');else assert.equal(s.status,'NOT_RUN');
    for(const t of s.tests){assert.ok(testPath(t.file));const source=readFileSync(path.join(root,t.file),'utf8');assert.ok(source.includes(t.name));}});
  if(!requireReady)return {ok:true,status:'STRUCTURE_VALID_NOT_READY',candidate_fingerprint:inventory.fingerprint};
  const report=read(SS009_EVIDENCE_PREFIX+'report.json');assertG2EvidenceTime(report);
  verifyYxxCompletionState(report,{preTamper});
  assert.equal(report.candidate_fingerprint,inventory.fingerprint);assert.equal(report.live_authorized,false);
  assert.equal(git(['rev-parse',report.tested_head+'^{tree}']),report.tested_tree);
  assert.equal(git(['merge-base',report.tested_head,'HEAD']),report.tested_head);
  assert.equal(normalize(execFileSync('git',['show',report.tested_head+':plans/yxx-ss-009-acceptance.json'],{cwd:root,encoding:'utf8'})),normalize(readFileSync(path.join(root,'plans/yxx-ss-009-acceptance.json'),'utf8')));
  const entries=git(['ls-tree','-r',report.tested_head]).split('\n').map(line=>line.split('\t'));
  const objects=new Map(entries.map(([meta,name])=>[name,meta.split(' ')[2]]));
  const tracked=[...objects.keys()].filter(f=>(G2_CANDIDATE_FILES.includes(f)||G2_CANDIDATE_ROOTS.some(p=>f.startsWith(p+'/')))&&!G2_EXCLUDED_LOCAL_FILES.includes(f));
  assert.deepEqual(tracked.sort(),inventory.files.map(f=>f.path).sort());
  for(const f of inventory.files){const raw=readFileSync(path.join(root,f.path)),bytes=f.encoding==='BINARY'?raw:Buffer.from(normalize(raw.toString('utf8')));const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');assert.equal(objects.get(f.path),blob);}
  const json=ref=>{const value=JSON.parse(readYxxEvidence(root,ref));assertG2EvidenceTime(value);assert.equal(value.candidate_fingerprint,inventory.fingerprint);return value;};
  const publishedInventory=json(report.inventory);for(const [key,value] of Object.entries(inventory))assert.deepEqual(publishedInventory[key],value);
  const run=json(report.run),tap=readYxxEvidence(root,report.tap);
  // Runner hashes its LF-normalized published TAP; original raw logs remain separate artifacts.
  const baseline=JSON.parse(execFileSync('git',['show',SS009_BASE+':evidence/yxx-ss-008-pr18-full-regression-run.json'],{cwd:root,encoding:'utf8'}));
  const passed=verifyYxxRun({run,tap,inventory,baselineFiles:baseline.files});
  verifyYxxRegressionSummary(report.full_regression,run);
  const casesText=readYxxEvidence(root,report.case_trace);assert.equal(evidenceHash(casesText),run.case_trace_sha256);
  const cases=casesText.trim().split('\n').map(line=>JSON.parse(line));
  verifyYxxCaseTrace({cases,run,tap});
  const executed=json(report.matrix);assert.equal(executed.scenarios.length,102);
  for(let i=0;i<102;i++){
    const actual=executed.scenarios[i],planned=matrix.scenarios[i];assert.equal(actual.id,planned.id);
    assert.deepEqual(actual.tests.map(({file,name})=>({file,name})),planned.tests);
    assert.equal(actual.status,i<90?'PASS':'NOT_RUN');
    if(planned.evidence_kind){assert.equal(actual.evidence_kind,planned.evidence_kind);if(!preTamper||planned.evidence_kind!=='strict_negative')assert.deepEqual(actual.evidence,report[planned.evidence_kind]);}
    for(const t of actual.tests){assert.ok(passed.has(t.name));assert.equal(cases.filter(c=>c.name===t.name&&c.file===t.file).length,1);assert.equal(inventory.files.find(f=>f.path===t.file)?.sha256,t.sha256);assert.equal([...tap.matchAll(/^\s*ok \d+ - (.+)$/gmu)].filter(m=>m[1].replace(/\r$/u,'')===t.name).length,1);}
  }
  const reviews=json(report.review);assert.equal(reviews.reviews.length,2);
  assert.equal(new Set(reviews.reviews.map(r=>r.reviewer)).size,2);
  for(const axis of ['SPEC','STANDARDS']){const r=reviews.reviews.find(r=>r.axis===axis);assert.ok(r?.reviewer);assert.equal(r.verdict,'PASS');assert.equal(r.unresolved_findings,0);assert.equal(r.candidate_fingerprint,inventory.fingerprint);
    const original=json(r.source);for(const key of ['axis','reviewer','verdict','unresolved_findings'])assert.equal(original[key],r[key]);assert.ok(Array.isArray(original.findings)&&original.findings.every(f=>f.resolved===true));assert.equal(original.historical_limitations_reviewed,true);}
  const receipts=[...tap.matchAll(/^# SS009_RECEIPT (.+)$/gmu)].map(m=>JSON.parse(m[1]));
  for(const kind of ['fault','capacity','catalog']){
    const value=json(report[kind]);assert.equal(value.status,'PASS',kind);
    const observed=receipts.filter(r=>r.kind===kind);assert.deepEqual(value.records,observed);verifyYxxReceipts(kind,observed);
  }
  const source=json(report.source_audit);assert.deepEqual(source,createG2SourceAudit({tap,run,root}));assert.equal(source.accounting_complete,true);
  assert.equal(source.observed_normal_pass_cases,122);assert.equal(source.manual_review_observation_missing.length,0);
  const historical=json(report.historical_coverage);assert.deepEqual(historical.bindings,historicalYxxBindings({root,cases,inventory}));
  assert.equal(historical.original_semantics_all_passed,false);assert.equal(historical.semantic_review.status,'REVIEWED_WITH_PRESERVED_LIMITATIONS');assert.deepEqual(historical.semantic_review.review,report.review);
  const validators=json(report.validators);assert.deepEqual(validators.results.map(v=>v.command).sort(),SS009_VALIDATORS.map(f=>'node scripts/'+f).sort());for(const v of validators.results){assertG2EvidenceTime(v);assert.equal(v.exit_code,0);assert.equal(evidenceHash(readYxxEvidence(root,v.output)),v.output.sha256);const text=readYxxEvidence(root,v.output);if(v.command==='node scripts/validate-v1-4-architecture.mjs')assert.match(text,/^V1\.4 architecture validation passed \(\d+ checks\)\.\s*$/u);else if(v.command==='node scripts/validate-arch-006-rule-first-service-loop.mjs')assert.match(text,/^ARCH-006 rule-first service loop validation passed \(\d+ checks\)\.\s*$/u);else assert.equal(JSON.parse(text).ok,true);}
  const cleanup=json(report.cleanup);assert.equal(cleanup.owned_residuals,0);assert.equal(cleanup.preexisting_resources_touched,false);
  assert.deepEqual(cleanup.receipts,receipts);assert.ok(receipts.some(r=>r.kind==='browser'&&r.real_pg&&r.real_browser));
  const measuredCleanup=receipts.filter(r=>r.kind==='cleanup');assert.ok(measuredCleanup.length>=10);
  for(const r of measuredCleanup){assert.ok(r.resources.length>=4);assert.equal(r.scope,'OWNED_RUN_RESOURCES_ONLY');assert.equal(r.preexisting_resources_touched,false);assert.ok(r.resources.every(x=>x.remaining===0));}
  for(const required of ['owned_database','owned_database_backends','owned_child','app_pool','worker_process','browser_process','browser_profile','browser_command_timers'])assert.ok(measuredCleanup.some(r=>r.resources.some(x=>x.resource===required)));
  for(const r of receipts){assert.equal(r.candidate_fingerprint,inventory.fingerprint);assertG2EvidenceTime(r);}
  const browser=json(report.browser);assert.deepEqual(browser.records,receipts.filter(r=>r.kind==='browser'));assert.deepEqual(browser.images.map(i=>i.width),[390,1440]);
  for(const image of browser.images){assert.ok([390,1440].some(width=>image.path===SS009_EVIDENCE_PREFIX+'ui-'+width+'.png'));const file=path.join(root,image.path);assert.ok(lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink());assert.equal(evidenceHash(readFileSync(file)),image.sha256);assert.ok(browser.records[0].screenshots.some(s=>s.width===image.width&&s.sha256===image.sha256));}
  const governance=json(report.governance);assert.equal(governance.identity.raw_same_namespace,false);assert.equal(governance.identity.official_A_B_conversion,'VERIFIED');assert.deepEqual(governance.identity,read('evidence/p2-g2-yxx-targeted-live-summary.json').identity);
  assert.equal(governance.gitignore_sha256,start.gitignore_sha256);assert.equal(governance.last_completed_gate,'P2-G1');
  const time=json(report.time_audit);assert.ok(time.sources.length>=8);for(const ref of time.sources)assertG2EvidenceTime(json(ref));
  if(!preTamper){const negative=json(report.strict_negative);assert.equal(negative.actual_strict_entry,true);assert.equal(negative.positive_control,true);assert.equal(negative.owned_worktree_removed,true);assert.equal(negative.rejected.length,29);assert.equal(new Set(negative.rejected).size,29);}
  return {ok:true,status:preTamper?'SS009_CORE_EVIDENCE_VALID_NOT_COMPLETE':'SS009_LOCAL_VERIFICATION_COMPLETE',candidate_fingerprint:inventory.fingerprint,live_authorized:false,parent_gate_advanced:false};
}
