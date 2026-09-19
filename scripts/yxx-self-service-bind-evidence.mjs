import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {g2CandidateInventory,G2_ROOT} from '../src/p2-g2-candidate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {createG2SourceAudit} from '../src/p2-g2-source-audit.mjs';
import {SS009_BASE,SS009_EVIDENCE_PREFIX,SS009_VALIDATORS,evidenceHash,verifyYxxRun,verifyYxxReceipts,historicalYxxBindings} from '../src/yxx-self-service-verification.mjs';

export function bindYxxEvidence(directory){
  assert.match(directory,/^tmp\/p2-g2-tests-[a-f0-9-]{36}$/u);
  const read=file=>JSON.parse(readFileSync(file,'utf8')),inventory=g2CandidateInventory();
  const run=read(directory+'/run.json'),tap=readFileSync(directory+'/result.tap','utf8'),casesText=readFileSync(directory+'/cases.jsonl','utf8');
  verifyYxxRun({run,tap,inventory,baselineFiles:read('evidence/yxx-ss-008-pr18-full-regression-run.json').files});
  assert.equal(evidenceHash(casesText),run.case_trace_sha256);
  const cases=casesText.trim().split('\n').map(line=>JSON.parse(line));
  const prefix=SS009_EVIDENCE_PREFIX,stamp=()=>({...g2EvidenceTime(),candidate_fingerprint:inventory.fingerprint});
  const ref=file=>({path:file,encoding:'UTF8_LF',sha256:evidenceHash(readFileSync(file,'utf8').replaceAll('\r\n','\n'))});
  const write=(suffix,data)=>{const file=prefix+suffix+'.json';writeFileSync(file,JSON.stringify(data,null,2)+'\n');return ref(file);};
  for(const [from,to] of [['result.tap','full.tap'],['run.json','full-run.json'],['stderr.txt','full-stderr.txt'],['cases.jsonl','full-cases.jsonl']])copyFileSync(directory+'/'+from,prefix+to);
  const receipts=[...tap.matchAll(/^# SS009_RECEIPT (.+)$/gmu)].map(m=>JSON.parse(m[1]));
  const references={run:ref(prefix+'full-run.json'),tap:ref(prefix+'full.tap'),case_trace:ref(prefix+'full-cases.jsonl')};for(const kind of ['fault','capacity','catalog']){const records=receipts.filter(r=>r.kind===kind);verifyYxxReceipts(kind,records);references[kind]=write(kind,{...stamp(),status:'PASS',records});}
  const browserRecords=receipts.filter(r=>r.kind==='browser');assert.equal(browserRecords.length,1);
  const images=browserRecords[0].screenshots.map(s=>{assert.match(s.file,/^tmp\/ss009-ui\/[a-f0-9-]{36}\.png$/u);assert.equal(evidenceHash(readFileSync(s.file)),s.sha256);const file=prefix+'ui-'+s.width+'.png';copyFileSync(s.file,file);return {...s,path:file};});
  references.browser=write('browser',{...stamp(),status:'PASS',records:browserRecords,images});
  references.source_audit=write('source-audit',createG2SourceAudit({tap,run,root:G2_ROOT}));
  const cleanups=receipts.filter(r=>r.kind==='cleanup');assert.ok(cleanups.length>=10);const residuals=cleanups.reduce((sum,r)=>sum+r.resources.reduce((n,x)=>n+x.remaining,0),0);assert.equal(residuals,0);
  references.cleanup=write('cleanup',{...stamp(),status:'PASS',owned_residuals:residuals,preexisting_resources_touched:cleanups.some(r=>r.preexisting_resources_touched),receipts,retained:['all failed and successful test outputs','original full run directory','synthetic UI screenshots'],formal_natural_gc_2c4g_60min:'NOT_RUN'});
  const results=[];for(const script of SS009_VALIDATORS){const result=spawnSync(process.execPath,['scripts/'+script],{cwd:G2_ROOT,encoding:'utf8',windowsHide:true});
    const file=prefix+script.replace(/\.mjs$/u,'')+'.txt';writeFileSync(file,result.stdout??'');writeFileSync(file.replace(/\.txt$/u,'-stderr.txt'),result.stderr??'');
    results.push({...g2EvidenceTime(),command:'node scripts/'+script,exit_code:result.status,output:ref(file)});assert.equal(result.status,0,script);
  }
  references.validators=write('validators',{...stamp(),status:'PASS',results});
  const reviews=['spec','standards'].map(axis=>{const file=prefix+axis+'-review.json',r=read(file);assert.equal(r.candidate_fingerprint,inventory.fingerprint);assert.equal(r.verdict,'PASS');assert.equal(r.unresolved_findings,0);return {axis:r.axis,reviewer:r.reviewer,verdict:r.verdict,unresolved_findings:r.unresolved_findings,candidate_fingerprint:r.candidate_fingerprint,source:ref(file)};});
  references.review=write('independent-review',{...stamp(),reviews});
  references.historical_coverage=write('historical-coverage',{...stamp(),bindings:historicalYxxBindings({root:G2_ROOT,cases,inventory}),baseline_files:171,previous_candidate_files:183,original_semantics_all_passed:false,semantic_review:{status:'REVIEWED_WITH_PRESERVED_LIMITATIONS',review:references.review}});
  references.inventory=write('source-inventory',{...stamp(),...inventory});
  references.governance=write('governance',{...stamp(),identity:read('evidence/p2-g2-yxx-targeted-live-summary.json').identity,historical_identity_source:ref('evidence/p2-g2-yxx-targeted-live-summary.json'),gitignore_sha256:evidenceHash(readFileSync('.gitignore')),last_completed_gate:read('plans/current_phase.json').last_completed_gate,live_calls:0});
  references.time_audit=write('time-audit',{...stamp(),sources:Object.values(references).filter(r=>r.path.endsWith('.json'))});
  const plan=read('plans/yxx-ss-009-acceptance.json');
  references.matrix=write('acceptance',{...stamp(),scenarios:plan.scenarios.map((s,i)=>({...s,status:i<90?'PASS':'NOT_RUN',...(s.evidence_kind?{evidence:references[s.evidence_kind]??null}:{}),tests:s.tests.map(t=>{assert.ok(cases.some(c=>c.event==='test:pass'&&c.file===t.file&&c.name===t.name));return {...t,sha256:inventory.files.find(f=>f.path===t.file).sha256};})}))});
  const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
  const report={schema_version:1,...stamp(),work_item:'YXX-SS-009',status:'LOCAL_AUTOMATION_VERIFIED_PENDING_STRICT_GATE',base_head:SS009_BASE,tested_head:git(['rev-parse','HEAD']),tested_tree:git(['rev-parse','HEAD^{tree}']),live_authorized:false,remote_review:'NOT_RUN',full_regression:{...run.counts,test_files:run.files.length,candidate_unchanged:run.candidate_unchanged},run:ref(prefix+'full-run.json'),tap:ref(prefix+'full.tap'),case_trace:ref(prefix+'full-cases.jsonl'),...references,limitations:['Formal natural GC / 2C4G / 60 minutes NOT_RUN','SS010 PLANNED; SS011 NOT_AUTHORIZED','Parent G2 historical readiness unchanged; P2-G2-LIVE and AI not started']};
  write('report',report);assert.equal(g2CandidateInventory().fingerprint,inventory.fingerprint);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){assert.equal(process.argv.length,3);const r=bindYxxEvidence(process.argv[2]);console.log(JSON.stringify({status:r.status,candidate_fingerprint:r.candidate_fingerprint,full_regression:r.full_regression}));}
