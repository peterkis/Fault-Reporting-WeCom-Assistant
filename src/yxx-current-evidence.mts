import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { g2CandidateInventory, isG2CandidatePath } from './p2-g2-candidate.mjs';
import { assertG2EvidenceTime } from './p2-g2-evidence-time.mjs';
import { SS009_VALIDATORS, verifyYxxReceipts, historicalYxxBindings } from './yxx-self-service-verification.mjs';
import { createG2SourceAudit } from './p2-g2-source-audit.mjs';

export const CURRENT_YXX_POINTER='plans/yxx-current-readiness.json';
/** Reuse the pipeline's actual source/output guard, including H's Git identity. */
export function verifyCurrentYxxArtifact(root:string):void {
  try{
    const module:unknown=createRequire(import.meta.url)(path.join(root,'.build/tools/verify-artifact.mjs'));
    const verifier=object(module).verifyArtifact;assert.ok(typeof verifier==='function');
    const digest:unknown=verifier(root);assert.ok(typeof digest==='string');assert.match(digest,/^[a-f0-9]{64}$/u);
  }catch{
    throw Object.assign(new Error('CURRENT_BUILD_INVALID'),{code:'CURRENT_BUILD_INVALID',stage:'BUILD'});
  }
}
type Reference={path:string;sha256:string;bytes:number};
const isObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const object=(value:unknown):Record<string,unknown>=>{
  assert.ok(isObject(value));return value;
};
const hash=(bytes:Buffer):string=>createHash('sha256').update(bytes).digest('hex');
function read(root:string,relative:string):Buffer {
  assert.ok(!path.isAbsolute(relative)&&!relative.includes('\\'));
  let current=root;
  for(const part of relative.split('/')){
    assert.ok(part&&part!=='.'&&part!=='..');current=path.join(current,part);
    assert.equal(lstatSync(current).isSymbolicLink(),false);
  }
  const stat=lstatSync(current);assert.ok(stat.isFile()&&stat.size<=64*1024*1024);
  return readFileSync(current);
}
const json=(bytes:Buffer):Record<string,unknown>=>object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown);
const strings=(value:unknown):string[]=>{
  assert.ok(Array.isArray(value)&&value.every((item:unknown)=>typeof item==='string'));
  const result:string[]=value;assert.equal(new Set(result).size,result.length);return result;
};
const countKeys=['tests','pass','fail','cancelled','skipped','todo'] as const;
function tapCounts(text:string):Record<typeof countKeys[number],number>{
  const result={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
  for(const key of countKeys){
    const value=[...text.matchAll(new RegExp('^# '+key+' (\\d+)\\r?$','gmu'))].at(-1)?.[1];
    assert.ok(value!==undefined);result[key]=Number(value);assert.ok(Number.isSafeInteger(result[key]));
  }
  assert.ok(result.tests>0);assert.equal(result.tests,result.pass);
  for(const key of ['fail','cancelled','skipped','todo'] as const)assert.equal(result[key],0);
  assert.equal(/^\s*not ok \d+/mu.test(text),false);
  return result;
}
function artifact(root:string,runId:string,value:unknown):{path:string;bytes:Buffer} {
  const ref=object(value);assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);
  assert.ok(typeof ref.path==='string'&&typeof ref.sha256==='string'&&typeof ref.bytes==='number');
  assert.ok(ref.path.startsWith('evidence/yxx-current-'+runId+'/'));
  assert.match(ref.sha256,/^[a-f0-9]{64}$/u);assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0);
  const bytes=read(root,ref.path);assert.equal(bytes.length,ref.bytes);assert.equal(hash(bytes),ref.sha256);
  return {path:ref.path,bytes};
}

type LimitedAcceptance=ReadonlyArray<{id:string;tests:ReadonlyArray<string>}>;
/** Derive scenario bindings from executed-file traces without inventing source lines. */
export function deriveCurrentYxxScenarios(root:string,report:Record<string,unknown>,limited:LimitedAcceptance){
  assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
  const build=json(artifact(root,report.run_id,report.build).bytes);assert.ok(Array.isArray(build.outputs));
  const outputs=build.outputs.map(object),inventory=g2CandidateInventory(root);
  const sourceFor=(logical:string):string=>{
    const output=outputs.find(item=>item.path===logical);assert.ok(output&&typeof output.source==='string');return output.source;
  };
  const cases:Array<{file:string;name:string;sha256:string;executed_path:string;executed_line:number;line_basis:'EXECUTED_FILE'}>=[];
  assert.ok(Array.isArray(report.current_runs)&&report.current_runs.length>0);
  for(const reference of report.current_runs){
    const summary=artifact(root,report.run_id,reference),run=json(summary.bytes);assert.ok(Array.isArray(run.files));
    for(const value of run.files){
      const file=object(value);assert.ok(typeof file.case_trace_path==='string');assert.match(file.case_trace_path,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
      assert.ok(['SOURCE_HOST','STAGED_RUNTIME','MIXED_EXPLICIT_ROOTS'].includes(String(file.mode)));
      const trace:Buffer=artifact(root,report.run_id,{path:path.posix.dirname(summary.path)+'/'+file.case_trace_path,
        sha256:file.case_trace_sha256,bytes:file.case_trace_bytes}).bytes;
      const rows:Record<string,unknown>[]=new TextDecoder('utf-8',{fatal:true}).decode(trace).trim().split('\n').map(line=>object(JSON.parse(line) as unknown));
      assert.equal(rows.length,file.case_count);
      for(const row of rows){
        assertG2EvidenceTime(row);assert.equal(row.event,'test:pass');assert.equal(row.skip,false);assert.equal(row.todo,false);
        assert.equal(row.time_basis,'REPORTER_OBSERVED_AT');assert.ok(typeof row.file==='string'&&typeof row.name==='string');
        assert.ok(!path.posix.isAbsolute(row.file)&&!row.file.includes('\\')&&!row.file.split('/').some(part=>!part||part==='..'||part==='.'));
        assert.ok(typeof row.line==='number'&&Number.isSafeInteger(row.line)&&row.line>0);
        const source=file.mode==='SOURCE_HOST'?row.file:sourceFor(row.file),entry=inventory.files.find(item=>item.path===source);assert.ok(entry);
        cases.push({file:source,name:row.name,sha256:entry.sha256,executed_path:file.mode==='SOURCE_HOST'?row.file:'.build/runtime/'+row.file,
          executed_line:row.line,line_basis:'EXECUTED_FILE'});
      }
    }
  }
  const planned=json(read(root,'plans/yxx-ss-009-acceptance.json'));assert.equal(planned.schema_version,1);assert.equal(planned.kind,'PLANNED_MAPPING_NOT_EXECUTION');
  assert.ok(Array.isArray(planned.scenarios)&&planned.scenarios.length===102);
  const plans=planned.scenarios.map(object);plans.forEach((item,index)=>assert.equal(item.id,'YXX-AC-'+String(index+1).padStart(3,'0')));
  const match=(name:string,file?:string)=>{
    const matches=cases.filter(item=>item.name===name&&(file===undefined||item.file===file));assert.equal(matches.length,1,name);
    const found=matches[0];assert.ok(found);return found;
  };
  const scenarios=plans.slice(0,90).map(item=>{
    assert.ok(Array.isArray(item.tests));assert.ok(item.tests.length>0||item.id==='YXX-AC-086'||item.id==='YXX-AC-090');
    const tests=item.tests.map(value=>{const test=object(value);assert.ok(typeof test.file==='string'&&typeof test.name==='string');
      const source=inventory.files.some(entry=>entry.path===test.file)?test.file:sourceFor(test.file);return match(test.name,source);});
    return {id:String(item.id),status:'PASS',tests,...(item.evidence_kind===undefined?{}:{evidence_kind:item.evidence_kind})};
  });
  assert.deepEqual(limited.map(item=>item.id),['YXX-AC-091','YXX-AC-092','YXX-AC-093','YXX-AC-094']);
  for(const item of limited){assert.ok(item.tests.length>0);scenarios.push({id:item.id,status:'PASS',tests:item.tests.map(name=>match(name))});}
  const historical=historicalYxxBindings({root,inventory,cases:cases.map(item=>({...item,event:'test:pass',skip:false,todo:false}))});
  return {scenarios,historical_bindings:historical};
}

export function verifyCurrentYxxScenarios(root:string,report:Record<string,unknown>,limited:LimitedAcceptance):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const proof=json(artifact(root,report.run_id,report.scenarios).bytes);
    assert.equal(proof.schema_version,1);assert.equal(proof.kind,'CURRENT_SCENARIO_MAPPING');assertG2EvidenceTime(proof);
    for(const field of ['tested_head','tested_tree','candidate_fingerprint']){assert.ok(typeof report[field]==='string');assert.equal(proof[field],report[field]);}
    assert.equal(proof.technical_only,true);assert.equal(proof.live_authorized,false);assert.equal(proof.historical_live_facts,'PRESERVED_NOT_REVALIDATED');
    const expected=deriveCurrentYxxScenarios(root,report,limited);
    assert.deepEqual(proof.scenarios,expected.scenarios);assert.deepEqual(proof.historical_bindings,expected.historical_bindings);
  }catch{
    throw Object.assign(new Error('CURRENT_SCENARIOS_INVALID'),{code:'CURRENT_SCENARIOS_INVALID',stage:'SCENARIOS'});
  }
}

/** Derived audit input; originals remain separate, hashed, per-file artifacts. */
export function deriveCurrentYxxSourceAudit(root:string,report:Record<string,unknown>):Record<string,unknown> {
  assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
  assert.ok(typeof report.candidate_fingerprint==='string');assert.ok(Array.isArray(report.current_runs)&&report.current_runs.length>0);
  const files:Array<{path:string;tap:string}>=[],counts={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
  for(const reference of report.current_runs){
    const summary=artifact(root,report.run_id,reference),run=json(summary.bytes);assert.ok(Array.isArray(run.files));
    for(const value of run.files){
      const file=object(value);assert.ok(typeof file.path==='string'&&typeof file.tap_path==='string');
      assert.match(file.tap_path,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
      const bytes=artifact(root,report.run_id,{path:path.posix.dirname(summary.path)+'/'+file.tap_path,sha256:file.tap_sha256,bytes:file.tap_bytes}).bytes;
      const tap=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replaceAll('\r\n','\n'),actual=tapCounts(tap);
      assert.deepEqual(file.counts,actual);for(const key of countKeys)counts[key]+=actual[key];files.push({path:file.path,tap});
    }
  }
  assert.ok(files.length>0);assert.equal(new Set(files.map(file=>file.path)).size,files.length);
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  // The old audit consumes one TAP stream. Append recomputed totals, never reuse
  // one shard's trailing totals as the result of the complete current run.
  const tap=files.map(file=>file.tap).join('\n')+'\n'+countKeys.map(key=>'# '+key+' '+counts[key]+'\n').join('');
  return createG2SourceAudit({root,tap,run:{mode:'SYNTHETIC_AUTOMATION',suite:'full',exit_code:0,error:null,signal:null,
    candidate_unchanged:true,candidate_fingerprint:report.candidate_fingerprint,stdout_sha256:hash(Buffer.from(tap)),counts}});
}

/** Preserve source semantic limitations while requiring current observations. */
export function verifyCurrentYxxSourceAccounting(root:string,report:Record<string,unknown>):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const proof=json(artifact(root,report.run_id,report.source_accounting).bytes);
    assert.equal(proof.schema_version,1);assert.equal(proof.kind,'CURRENT_SOURCE_ACCOUNTING');assertG2EvidenceTime(proof);
    for(const field of ['tested_head','tested_tree','candidate_fingerprint']){assert.ok(typeof report[field]==='string');assert.equal(proof[field],report[field]);}
    assert.equal(proof.derivation,'SORTED_FILE_TAP_WITH_RECOMPUTED_TOTALS_V1');
    const audit=deriveCurrentYxxSourceAudit(root,report);assert.deepEqual(proof.source_audit,audit);
    assert.equal(audit.total_source_cases,202);assert.equal(audit.normal_input_cases,122);assert.equal(audit.mechanism_and_other_cases,80);
    assert.equal(audit.observed_normal_pass_cases,122);assert.equal(audit.accounting_complete,true);assert.deepEqual(audit.execution_missing,[]);
    assert.deepEqual(audit.manual_review_observation_missing,[]);assert.equal(audit.original_semantics_all_passed,false);assert.equal(audit.semantic_review_required,true);
  }catch{
    throw Object.assign(new Error('CURRENT_SOURCE_ACCOUNTING_INVALID'),{code:'CURRENT_SOURCE_ACCOUNTING_INVALID',stage:'SOURCE_ACCOUNTING'});
  }
}

function testedRuntimeFingerprint(root:string,report:Record<string,unknown>):string {
  assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
  // H's manifest identifies H; receipts identify C. Substitute only C's archived
  // manifest, leaving the actual current runtime files in the inventory unchanged.
  const archived=artifact(root,report.run_id,report.build).bytes;
  const manifest=Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(archived).replaceAll('\r\n','\n'));
  const inventory=g2CandidateInventory(path.join(root,'.build/runtime'));
  assert.equal(inventory.files.filter(file=>file.path==='build-manifest.json').length,1);
  return hash(Buffer.from(JSON.stringify(inventory.files.map(file=>file.path==='build-manifest.json'
    ?{...file,sha256:hash(manifest),bytes:manifest.length}:file))));
}

export function verifyCurrentYxxMigrationProof(root:string,report:Record<string,unknown>):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const runId=report.run_id,proof=json(artifact(root,runId,report.migration_scope).bytes);
    assert.equal(proof.schema_version,1);assert.equal(proof.kind,'CURRENT_MIGRATION_SCOPE');assertG2EvidenceTime(proof);
    for(const field of ['tested_head','tested_tree','candidate_fingerprint']){assert.ok(typeof report[field]==='string');assert.equal(proof[field],report[field]);}
    const scopeBytes=read(root,'plans/yxx-current-readiness-scope.json'),scope=json(scopeBytes);
    assert.equal(report.scope_sha256,hash(Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(scopeBytes).replaceAll('\r\n','\n'))));
    assert.ok(Array.isArray(scope.files));
    const sql=scope.files.map(object).filter(item=>typeof item.path==='string'&&item.path.startsWith('database/migrations/')).map(item=>{
      assert.ok(typeof item.path==='string'&&typeof item.sha256_utf8_lf==='string');return {path:item.path,sha256_utf8_lf:item.sha256_utf8_lf};
    });
    assert.equal(sql.length,22);
    assert.ok(Array.isArray(report.current_runs));const candidates:Array<{tapPath:string;receipt:Record<string,unknown>}>=[];
    for(const reference of report.current_runs){
      const summary=artifact(root,runId,reference),run=json(summary.bytes);assert.ok(Array.isArray(run.files));
      for(const value of run.files){
        const file=object(value);if(file.path!=='tests/yxx-current-migrations.integration.test.mts')continue;
        assert.equal(run.status,'SELECTED_TESTS_PASS');assert.equal(file.status,'PASS');assert.equal(file.exit_code,0);assert.equal(file.signal,null);
        assert.equal(file.mode,'MIXED_EXPLICIT_ROOTS');assert.ok(typeof file.tap_path==='string');assert.match(file.tap_path,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
        const tap=artifact(root,runId,{path:path.posix.dirname(summary.path)+'/'+file.tap_path,sha256:file.tap_sha256,bytes:file.tap_bytes});
        const text=new TextDecoder('utf-8',{fatal:true}).decode(tap.bytes);tapCounts(text);
        const matches=[...text.matchAll(/^# CURRENT_SCOPE_CATALOG (.+)\r?$/gmu)];assert.equal(matches.length,1);
        const match=matches[0]?.[1];assert.ok(match);candidates.push({tapPath:tap.path,receipt:object(JSON.parse(match) as unknown)});
      }
    }
    assert.equal(candidates.length,1);const candidate=candidates[0];assert.ok(candidate);
    assert.deepEqual(proof.observation,{tap_path:candidate.tapPath,receipt_index:0});
    const receipt=candidate.receipt;assertG2EvidenceTime(receipt);assert.equal(receipt.status,'PASS');
    assert.equal(receipt.candidate_fingerprint,testedRuntimeFingerprint(root,report));assert.equal(receipt.scope_sha256,report.scope_sha256);
    assert.equal(receipt.database_scope,'OWNED_ISOLATED_DATABASE');assert.equal(receipt.live_authorized,false);
    assert.ok(typeof receipt.postgres_version_num==='number'&&Number.isInteger(receipt.postgres_version_num)&&receipt.postgres_version_num>=180000&&receipt.postgres_version_num<190000);
    assert.deepEqual(receipt.migration_files,sql);assert.deepEqual(receipt.legacy_applied,sql.slice(0,14).map(item=>path.posix.basename(item.path).slice(0,3)));
    assert.deepEqual(receipt.markers,sql.slice(14).map(item=>({migration_id:path.posix.basename(item.path,'.sql'),checksum_sha256:hash(read(root,'.build/runtime/'+item.path))})));
    assert.deepEqual(receipt.initial,{baseline:'APPLIED',yxx:'APPLIED',workbench_auth:'APPLIED',directory:'APPLIED'});
    assert.equal(receipt.replay,'ALL_NOOP_MARKERS_UNCHANGED');assert.equal(receipt.catalog_verified,true);assert.deepEqual(receipt.business_rows,{tickets:0,intakes:0});
  }catch{
    throw Object.assign(new Error('CURRENT_MIGRATION_PROOF_INVALID'),{code:'CURRENT_MIGRATION_PROOF_INVALID',stage:'MIGRATION_PROOF'});
  }
}

/** Bind specialized observations to their executed host and original artifacts. */
export function verifyCurrentYxxSpecializedProof(root:string,report:Record<string,unknown>):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const runId=report.run_id,proof=json(artifact(root,runId,report.specialized).bytes);
    assert.equal(proof.schema_version,1);assert.equal(proof.kind,'CURRENT_SPECIALIZED_PROOF');assertG2EvidenceTime(proof);
    for(const field of ['tested_head','tested_tree','candidate_fingerprint']){assert.ok(typeof report[field]==='string');assert.equal(proof[field],report[field]);}
    const runtimeFingerprint=testedRuntimeFingerprint(root,report);
    assert.ok(Array.isArray(report.current_runs)&&report.current_runs.length>0);
    const observed=new Map<string,{selector:Record<string,unknown>;receipt:Record<string,unknown>;channel:string}>();
    const selectorKey=(value:unknown):string=>{
      const item=object(value);assert.deepEqual(Object.keys(item).sort(),['channel','receipt_index','tap_path']);
      assert.ok(typeof item.tap_path==='string');assert.ok(item.channel==='SS009_RECEIPT'||item.channel==='SS010_BROWSER');
      assert.ok(typeof item.receipt_index==='number'&&Number.isSafeInteger(item.receipt_index)&&item.receipt_index>=0);
      return JSON.stringify([item.tap_path,item.channel,item.receipt_index]);
    };
    for(const reference of report.current_runs){
      const summary=artifact(root,runId,reference),run=json(summary.bytes);assert.ok(Array.isArray(run.files));
      for(const value of run.files){
        const file=object(value);assert.ok(typeof file.tap_path==='string');assert.match(file.tap_path,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
        assert.ok(['SOURCE_HOST','STAGED_RUNTIME','MIXED_EXPLICIT_ROOTS'].includes(String(file.mode)));
        const tap=artifact(root,runId,{path:path.posix.dirname(summary.path)+'/'+file.tap_path,sha256:file.tap_sha256,bytes:file.tap_bytes});
        const text=new TextDecoder('utf-8',{fatal:true}).decode(tap.bytes);
        for(const channel of ['SS009_RECEIPT','SS010_BROWSER']){
          for(const [index,match] of [...text.matchAll(new RegExp('^# '+channel+' (.+)\\r?$','gmu'))].entries()){
            assert.ok(match[1]);const receipt=object(JSON.parse(match[1]) as unknown);assertG2EvidenceTime(receipt);
            assert.equal(receipt.candidate_fingerprint,file.mode==='SOURCE_HOST'?report.candidate_fingerprint:runtimeFingerprint);
            if(channel==='SS009_RECEIPT'){assert.equal(receipt.status,'PASS');assert.ok(['fault','capacity','catalog','browser','cleanup'].includes(String(receipt.kind)));}
            const selector={tap_path:tap.path,channel,receipt_index:index},key=selectorKey(selector);assert.equal(observed.has(key),false);
            observed.set(key,{selector,receipt,channel});
          }
        }
      }
    }
    assert.ok(Array.isArray(proof.observations));assert.deepEqual(proof.observations.map(selectorKey).sort(),[...observed.keys()].sort());
    const all=[...observed.values()],legacy=all.filter(item=>item.channel==='SS009_RECEIPT').map(item=>item.receipt);
    for(const kind of ['fault','capacity','catalog'])verifyYxxReceipts(kind,legacy.filter(item=>item.kind===kind));
    assert.ok(legacy.filter(item=>item.kind==='cleanup').length>=10);
    const browsers=all.filter(item=>item.channel==='SS010_BROWSER'||item.receipt.kind==='browser');
    assert.equal(browsers.filter(item=>item.channel==='SS009_RECEIPT').length,1);assert.equal(browsers.filter(item=>item.channel==='SS010_BROWSER').length,1);
    assert.ok(Array.isArray(proof.images));const images=proof.images.map(object),expectedImages:string[]=[];
    for(const browser of browsers){
      const receipt=browser.receipt;assert.equal(receipt.real_browser,true);assert.equal(receipt.external_network_calls,0);
      if(browser.channel==='SS009_RECEIPT'){assert.equal(receipt.real_pg,true);assert.equal(receipt.tickets,2);assert.equal(receipt.simulated_provider_calls,1);}
      else assert.equal(receipt.real_postgres,true);
      assert.ok(Array.isArray(receipt.screenshots));const screenshots=receipt.screenshots.map(object);
      assert.deepEqual(screenshots.map(item=>[item.width,item.height]),[[390,844],[1440,900]]);
      for(const screenshot of screenshots){
        const key=selectorKey(browser.selector),matches=images.filter(item=>selectorKey(item.observation)===key&&item.width===screenshot.width&&item.height===screenshot.height);
        assert.equal(matches.length,1);const match=matches[0];assert.ok(match);
        const image=artifact(root,runId,match.artifact);assert.equal(hash(image.bytes),screenshot.sha256);
        assert.ok(image.bytes.length>24);assert.equal(image.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
        assert.equal(image.bytes.readUInt32BE(8),13);assert.equal(image.bytes.subarray(12,16).toString('ascii'),'IHDR');
        assert.equal(image.bytes.readUInt32BE(16),screenshot.width);assert.equal(image.bytes.readUInt32BE(20),screenshot.height);
        expectedImages.push(image.path);
      }
    }
    assert.equal(images.length,4);assert.equal(new Set(expectedImages).size,4);
  }catch{
    throw Object.assign(new Error('CURRENT_SPECIALIZED_PROOF_INVALID'),{code:'CURRENT_SPECIALIZED_PROOF_INVALID',stage:'SPECIALIZED_PROOF'});
  }
}

/** Original SS009 results belong only to the fixed historical checkout. */
export function verifyCurrentYxxHistoricalProof(root:string,report:Record<string,unknown>):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const runId=report.run_id,source=artifact(root,runId,report.historical),catalog=json(source.bytes);
    const relative=(value:unknown)=>{
      const ref=object(value);assert.ok(typeof ref.path==='string');assert.match(ref.path,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
      return artifact(root,runId,{...ref,path:path.posix.dirname(source.path)+'/'+ref.path});
    };
    const contract=json(read(root,'plans/yxx-current-readiness-acceptance.json'));
    const head='41edd855e7bc55149facb6a4b2e0076776c22e66',base='375d47b013017edb858206cc5f3475c9aed77dfd';
    assert.equal(contract.historical_head,head);assert.equal(contract.historical_base,base);
    const regressions=['tests/yxx-ss-008-validation-scope.test.mjs','tests/yxx-ss-009-evidence.test.mjs',
      'tests/yxx-ss-009-evidence-history.test.mjs','tests/yxx-ss-009-governance.test.mjs'];
    assert.deepEqual(contract.historical_regression_files,regressions);
    const strictCommand=['node','scripts/validate-yxx-self-service.mjs','--require-ready'];
    assert.deepEqual(contract.historical_strict_command,strictCommand);
    assert.equal(catalog.kind,'HISTORICAL_SS009_CATALOG');const proof=json(relative(catalog.proof).bytes);
    assert.equal(proof.kind,'HISTORICAL_SS009_PROOF');
    for(const record of [catalog,proof]){
      assert.equal(record.schema_version,1);assert.equal(record.head,head);assert.equal(record.base,base);
      assert.equal(record.historical_only,true);assert.equal(record.production_ready,false);
    }
    assert.equal(proof.status,'PASS');assert.equal(proof.checkout_clean,true);
    assert.ok(typeof proof.node_version==='string');assert.match(proof.node_version,/^v24\.\d+\.\d+$/u);
    const metadata=json(relative(proof.github_metadata).bytes);
    assert.equal(metadata.head,head);assert.equal(metadata.base,base);assert.equal(metadata.merged,true);assert.equal(metadata.state,'closed');
    assert.equal(metadata.merge_commit,'c1af81a86951054f4898f043c43381a5842abbf2');
    assert.ok(Array.isArray(proof.records));const records=proof.records.map(object);
    const names=['preflight','strict','regression','r6-probe',...SS009_VALIDATORS.map((file:string)=>'validator-'+file.replace(/\.mjs$/u,''))];
    assert.deepEqual(records.map(item=>item.name).sort(),names.sort());
    const outputs=new Map<string,Buffer>(),commands=new Map<string,string[]>();
    for(const record of records){
      assert.ok(typeof record.name==='string');assert.equal(record.exit_code,0);assert.equal(record.signal,null);assert.equal(record.error_code,null);
      commands.set(record.name,strings(record.command));outputs.set(record.name,relative(record.stdout).bytes);relative(record.stderr);
    }
    const output=(name:string):Buffer=>{const bytes=outputs.get(name);assert.ok(bytes);return bytes;};
    assert.deepEqual(commands.get('preflight'),['node','.github/review/verify-published-history.mjs','--expected-head',head]);
    const preflight=json(output('preflight')),r7=json(read(root,'evidence/yxx-ss-009-r7-report.json'));
    assert.equal(preflight.status,'REVIEW_HISTORY_PREFLIGHT_PASS_NOT_READINESS');assert.equal(preflight.checkout_role,'PUBLISHED_PR_HEAD');
    assert.equal(preflight.expected_head,head);assert.equal(preflight.checkout_head,head);
    assert.equal(preflight.checkout_tree,'54969cbcd2785f62b562ac32aa431e16ee300bd8');
    assert.deepEqual(preflight.checkout_parents,['0d1cfa2935f028ca5c0a97838615dad1ab453563']);
    assert.equal(preflight.report_path,'evidence/yxx-ss-009-r7-report.json');
    assert.equal(preflight.tested_head,r7.tested_head);assert.equal(preflight.tested_tree,r7.tested_tree);assert.equal(preflight.merge_base,r7.tested_head);
    assert.equal(preflight.shallow,false);assert.equal(preflight.history_overlays,false);assert.equal(preflight.worktree_clean,true);
    assert.deepEqual(commands.get('strict'),strictCommand);const strict=json(output('strict'));
    assert.equal(strict.ok,true);assert.equal(strict.status,'SS009_LOCAL_VERIFICATION_COMPLETE');
    assert.equal(strict.candidate_fingerprint,r7.candidate_fingerprint);assert.equal(strict.live_authorized,false);assert.equal(strict.parent_gate_advanced,false);
    const regressionCommand=commands.get('regression');assert.ok(regressionCommand);
    assert.deepEqual(regressionCommand.slice(0,6),['node','--test','--test-concurrency=1','--test-reporter=tap',
      '--test-reporter-destination=stdout','--test-reporter=./scripts/p2-g2-case-reporter.mjs']);
    assert.match(regressionCommand[6]??'',/^--test-reporter-destination=.+[\\/]regression\.cases\.jsonl$/u);
    assert.deepEqual(regressionCommand.slice(7),regressions);
    const tap=new TextDecoder('utf-8',{fatal:true}).decode(output('regression')).replaceAll('\r\n','\n'),counts=tapCounts(tap);
    const trace=new TextDecoder('utf-8',{fatal:true}).decode(relative(catalog.case_trace).bytes).trim().split('\n').map(line=>object(JSON.parse(line) as unknown));
    assert.equal(counts.tests,36);assert.equal(catalog.case_count,36);assert.equal(trace.length,36);
    const seenFiles=new Set<string>();
    const observed=trace.map(item=>{
      assertG2EvidenceTime(item);assert.equal(item.time_basis,'REPORTER_OBSERVED_AT');assert.equal(item.event,'test:pass');
      assert.equal(item.skip,false);assert.equal(item.todo,false);assert.equal(item.nesting,0);
      assert.ok(typeof item.line==='number'&&Number.isSafeInteger(item.line)&&item.line>0);
      assert.ok(typeof item.file==='string'&&regressions.includes(item.file));seenFiles.add(item.file);
      assert.ok(typeof item.name==='string');return item.name;
    });
    assert.deepEqual([...seenFiles].sort(),[...regressions].sort());
    assert.deepEqual(observed.sort(),[...tap.matchAll(/^ok \d+ - (.+)$/gmu)].map(match=>match[1]).sort());
    assert.deepEqual(commands.get('r6-probe'),['node','.github/review/ss009-evidence-history-probe.mjs']);
    const probe=json(output('r6-probe'));assert.equal(probe.status,'PUBLISHED_EVIDENCE_HISTORY_PROBE_PASS');
    assert.equal(probe.historical_fixture,'a1a48f9839315d7683d9973a1d9febfd14aa39a8');
    assert.equal(probe.current_candidate_fingerprint,r7.candidate_fingerprint);assert.equal(probe.protected_files,1090);
    assert.equal(probe.candidate_unchanged,true);assert.equal(probe.owned_worktree_removed,true);
    assert.ok(Array.isArray(probe.experiments));const experiments=probe.experiments.map(object);
    assert.deepEqual(experiments.map(item=>item.case),['unchanged published r6 positive control',
      'uncommitted rewrite of an unreferenced published r5 report','committed rewrite with a clean checkout',
      'rewrite and restore cannot erase the audit violation']);
    for(const [index,experiment] of experiments.entries()){
      const legacy=object(experiment.legacy);assert.equal(legacy.exit_code,0);assert.equal(legacy.status,'SS009_LOCAL_VERIFICATION_COMPLETE');
      if(index===0)assert.equal(experiment.fixed_history,'SS009_EVIDENCE_HISTORY_VALID');
      else{
        const fixed=object(experiment.fixed);assert.equal(fixed.status,'REJECTED');assert.equal(fixed.error_code,'SS009_PUBLISHED_EVIDENCE_CHANGED');
        assert.equal(fixed.missing_or_changed_file,'evidence/yxx-ss-009-r5-review-fix-report.md');
        assert.deepEqual(fixed.modes,['STRUCTURE','STRICT','PRETAMPER']);
      }
    }
    for(const file of SS009_VALIDATORS){
      const name='validator-'+file.replace(/\.mjs$/u,'');assert.deepEqual(commands.get(name),['node','scripts/'+file]);
      const text=new TextDecoder('utf-8',{fatal:true}).decode(output(name));
      if(file==='validate-v1-4-architecture.mjs')assert.match(text,/^V1\.4 architecture validation passed \(407 checks\)\.\s*$/u);
      else if(file==='validate-arch-006-rule-first-service-loop.mjs')assert.match(text,/^ARCH-006 rule-first service loop validation passed \(\d+ checks\)\.\s*$/u);
      else assert.equal(json(output(name)).ok,true);
    }
  }catch{
    throw Object.assign(new Error('CURRENT_HISTORICAL_PROOF_INVALID'),{code:'CURRENT_HISTORICAL_PROOF_INVALID',stage:'HISTORICAL_PROOF'});
  }
}

/** Two distinct review records, both bound to the tested candidate. */
export function verifyCurrentYxxReviews(root:string,report:Record<string,unknown>):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    assert.ok(Array.isArray(report.reviews)&&report.reviews.length===2);
    const axes:string[]=[],reviewers:string[]=[];
    for(const reference of report.reviews){
      const review=json(artifact(root,report.run_id,reference).bytes);
      assert.equal(review.schema_version,1);assertG2EvidenceTime(review);
      assert.ok(review.axis==='SPEC'||review.axis==='STANDARDS');axes.push(review.axis);
      assert.ok(typeof review.reviewer==='string'&&review.reviewer.trim().length>0);
      assert.equal(review.reviewer,review.reviewer.trim());reviewers.push(review.reviewer.toLowerCase());
      assert.equal(review.independent,true);assert.equal(review.verdict,'PASS');assert.equal(review.unresolved_findings,0);
      assert.equal(review.historical_limitations_reviewed,true);
      for(const key of ['tested_head','tested_tree','candidate_fingerprint']){
        assert.ok(typeof report[key]==='string');assert.equal(review[key],report[key]);
      }
      assert.ok(Array.isArray(review.findings));
      for(const finding of review.findings)assert.equal(object(finding).resolved,true);
    }
    assert.deepEqual(axes.sort(),['SPEC','STANDARDS']);assert.equal(new Set(reviewers).size,2);
  }catch{
    throw Object.assign(new Error('CURRENT_REVIEW_INVALID'),{code:'CURRENT_REVIEW_INVALID',stage:'REVIEW'});
  }
}

/** Cleanup observations must come from the executed TAP, plus measured host cleanup. */
export function verifyCurrentYxxCleanup(root:string,report:Record<string,unknown>):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const cleanup=json(artifact(root,report.run_id,report.cleanup).bytes);
    assert.equal(cleanup.schema_version,1);assert.equal(cleanup.kind,'CURRENT_OWNED_RESOURCE_CLEANUP');
    assertG2EvidenceTime(cleanup);
    for(const key of ['tested_head','tested_tree','candidate_fingerprint']){
      assert.ok(typeof report[key]==='string');assert.equal(cleanup[key],report[key]);
    }
    assert.ok(Array.isArray(report.current_runs)&&report.current_runs.length>0);
    const observed=new Map<string,Record<string,unknown>>(),summaryHashes:string[]=[];
    for(const reference of report.current_runs){
      const summary=artifact(root,report.run_id,reference),run=json(summary.bytes);summaryHashes.push(hash(summary.bytes));
      assert.equal(run.status,'SELECTED_TESTS_PASS');assert.ok(Array.isArray(run.files));
      for(const value of run.files){
        const file=object(value);assert.ok(typeof file.tap_path==='string');assert.match(file.tap_path,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
        const tap=artifact(root,report.run_id,{path:path.posix.dirname(summary.path)+'/'+file.tap_path,sha256:file.tap_sha256,bytes:file.tap_bytes});
        const receipts=[...new TextDecoder('utf-8',{fatal:true}).decode(tap.bytes).matchAll(/^# SS009_RECEIPT (.+)\r?$/gmu)];
        for(const [index,match] of receipts.entries()){
          assert.ok(match[1]);const receipt=object(JSON.parse(match[1]) as unknown);
          if(receipt.kind==='cleanup')observed.set(tap.path+':'+index,receipt);
        }
      }
    }
    assert.equal(new Set(summaryHashes).size,summaryHashes.length);assert.ok(observed.size>0);
    assert.ok(Array.isArray(cleanup.observations));
    const selected=cleanup.observations.map(value=>{
      const item=object(value);assert.deepEqual(Object.keys(item).sort(),['receipt_index','tap_path']);
      assert.ok(typeof item.tap_path==='string'&&typeof item.receipt_index==='number'&&Number.isSafeInteger(item.receipt_index)&&item.receipt_index>=0);
      return item.tap_path+':'+item.receipt_index;
    });
    assert.deepEqual(selected.sort(),[...observed.keys()].sort());
    const resources=new Set<string>();
    for(const receipt of observed.values()){
      assertG2EvidenceTime(receipt);assert.equal(receipt.scope,'OWNED_RUN_RESOURCES_ONLY');assert.equal(receipt.preexisting_resources_touched,false);
      assert.ok(Array.isArray(receipt.resources)&&receipt.resources.length>0);
      for(const value of receipt.resources){const item=object(value);assert.ok(typeof item.resource==='string');assert.equal(item.remaining,0);resources.add(item.resource);}
    }
    for(const required of ['owned_database','owned_database_backends','owned_child','app_pool','worker_process','browser_process','browser_profile','browser_command_timers'])assert.ok(resources.has(required));
    assert.ok(Array.isArray(cleanup.environments));const cleaned:string[]=[];
    for(const reference of cleanup.environments){
      const environment=json(artifact(root,report.run_id,reference).bytes);assertG2EvidenceTime(environment);
      assert.equal(environment.schema_version,1);assert.equal(environment.kind,'OWNED_TEST_ENVIRONMENT');assert.equal(environment.status,'CLEANUP_CONFIRMED');
      for(const key of ['tested_head','tested_tree','candidate_fingerprint'])assert.equal(environment[key],report[key]);
      assert.ok(typeof environment.execution_summary_sha256==='string');cleaned.push(environment.execution_summary_sha256);
      assert.equal(environment.owned_residuals,0);assert.equal(environment.preexisting_resources_touched,false);
      assert.equal(environment.test_exit_code,0);assert.equal(environment.postgres_stop_exit_code,0);
      assert.equal(environment.postgres_stopped,true);assert.equal(environment.postgres_data_removed,true);
    }
    assert.deepEqual(cleaned.sort(),summaryHashes.sort());
  }catch{
    throw Object.assign(new Error('CURRENT_CLEANUP_INVALID'),{code:'CURRENT_CLEANUP_INVALID',stage:'CLEANUP'});
  }
}

/** Complete current file coverage; historical files never count toward this set. */
export function verifyCurrentYxxExecution(root:string,report:Record<string,unknown>):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const contract=json(read(root,'plans/yxx-current-readiness-acceptance.json'));
    assert.equal(contract.schema_version,1);assert.equal(contract.contract,'ADR-0027');assert.equal(contract.live_authorized,false);
    const expected=strings(contract.current_files),historical=strings(contract.historical_registered_files);
    assert.deepEqual(historical,['tests/yxx-ss-008-validation-scope.test.mjs']);
    const registry=json(read(root,'plans/typescript-migration/test-routing.json'));
    assert.ok(Array.isArray(registry.entries));
    const entries=registry.entries.map(object);assert.deepEqual([...expected,...historical].sort(),entries.map(entry=>entry.path).sort());
    assert.ok(Array.isArray(report.current_runs)&&report.current_runs.length>0);
    const buildReference=artifact(root,report.run_id,report.build),build=json(buildReference.bytes);
    const currentBuild=json(read(root,'.build/runtime/build-manifest.json')),sourceIdentity=object(build.source);
    assert.equal(build.schema_version,1);assert.equal(build.status,'STAGED_NOT_ACTIVATED');assert.equal(build.node_major,24);
    assert.equal(build.compiler,currentBuild.compiler);assert.equal(sourceIdentity.dirty,false);
    for(const key of ['head','tree'])assert.match(String(sourceIdentity[key]),/^[a-f0-9]{40}$/u);
    assert.equal(sourceIdentity.head,report.tested_head);assert.equal(sourceIdentity.tree,report.tested_tree);
    assert.deepEqual(build.outputs,currentBuild.outputs);assert.deepEqual(sourceIdentity.inputs,object(currentBuild.source).inputs);
    assert.equal(sourceIdentity.input_hash,hash(Buffer.from(JSON.stringify(sourceIdentity.inputs))));
    assert.ok(Array.isArray(sourceIdentity.inputs)&&Array.isArray(build.outputs));
    const inputs=sourceIdentity.inputs.map(object),outputs=build.outputs.map(object);
    assert.equal(new Set(inputs.map(input=>input.path)).size,inputs.length);assert.equal(new Set(outputs.map(output=>output.path)).size,outputs.length);
    const selected:string[]=[],executed:string[]=[];
    for(const reference of report.current_runs){
      const source=artifact(root,report.run_id,reference),run=json(source.bytes);
      assert.equal(run.status,'SELECTED_TESTS_PASS');assert.equal(run.representation,'EXPLICIT_ROUTED_HOSTS');
      assert.equal(run.manifest_sha256,hash(buildReference.bytes));
      assert.equal(run.production_ready,false);assert.deepEqual(run.not_run,[]);
      const declared=strings(run.selected_files);assert.ok(declared.length>0);selected.push(...declared);
      assert.ok(Array.isArray(run.files));const files=run.files.map(object);
      assert.deepEqual(files.map(file=>file.path).sort(),[...declared].sort());
      const total={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
      for(const file of files){
        assert.equal(file.status,'PASS');assert.equal(file.exit_code,0);assert.equal(file.signal,null);
        assert.ok(typeof file.path==='string');executed.push(file.path);
        const originals=new Map<string,Buffer>();
        for(const kind of ['tap','stderr','case_trace']){
          const name=file[kind+'_path'];assert.ok(typeof name==='string');assert.match(name,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
          const original=artifact(root,report.run_id,{path:path.posix.dirname(source.path)+'/'+name,
            sha256:file[kind+'_sha256'],bytes:file[kind+'_bytes']});
          originals.set(kind,original.bytes);
        }
        const tap=originals.get('tap');assert.ok(tap);
        const tapText=new TextDecoder('utf-8',{fatal:true}).decode(tap).replaceAll('\r\n','\n');
        const actual=tapCounts(tapText);assert.deepEqual(file.counts,actual);
        for(const key of countKeys)total[key]+=actual[key];
        const route=entries.find(entry=>entry.path===file.path);assert.ok(route);
        assert.ok(['SOURCE_HOST','STAGED_RUNTIME','MIXED_EXPLICIT_ROOTS'].includes(String(route.mode)));
        assert.equal(file.mode,route.mode);const sourceHost=route.mode==='SOURCE_HOST';
        if(sourceHost)assert.equal(file.path.endsWith('.mts'),false);
        const cwd=sourceHost?'.':'.build/runtime';
        const executedPath=sourceHost?file.path:'.build/runtime/'+file.path.replace(/\.mts$/u,'.mjs');
        assert.equal(file.execution_cwd,cwd);assert.equal(file.executed_path,executedPath);assert.equal(file.case_line_basis,'EXECUTED_FILE');
        const logical=file.path.replace(/\.mts$/u,'.mjs'),input=inputs.find(input=>input.path===file.path),output=outputs.find(output=>output.path===logical);
        assert.ok(input);assert.equal(file.runtime_path,logical);
        assert.equal(file.source_sha256,input.sha256);assert.equal(file.source_sha256,hash(read(root,file.path)));
        if(!sourceHost){
          assert.ok(output);assert.equal(output.source,file.path);assert.equal(output.kind,file.path.endsWith('.mts')?'COMPILED':'LEGACY');
          assert.equal(file.executed_sha256,output.sha256);
        }else assert.equal(file.executed_sha256,input.sha256);
        assert.equal(file.executed_sha256,hash(read(root,executedPath)));
        const loaded=strings(file.loaded_project_files);assert.ok(loaded.includes(executedPath));
        for(const loadedFile of loaded){
          assert.ok(!path.posix.isAbsolute(loadedFile)&&!loadedFile.includes('\\')&&!loadedFile.split('/').includes('..'));
          assert.equal(loadedFile.startsWith('src/'),false);
          if(!sourceHost)assert.equal(/^(?:src|scripts|tests)\//u.test(loadedFile),false);
        }
        const trace=originals.get('case_trace');assert.ok(trace);
        const cases=new TextDecoder('utf-8',{fatal:true}).decode(trace).trim().split('\n').map(line=>object(JSON.parse(line) as unknown));
        const suites=[...tapText.matchAll(/^# suites (\d+)$/gmu)].at(-1)?.[1];assert.ok(suites!==undefined);
        assert.equal(cases.length,actual.tests+Number(suites));assert.equal(file.case_count,cases.length);
        const controls:Record<string,string>={'\b':'b','\f':'f','\t':'t','\n':'n','\r':'r','\v':'v'};
        const escaped=(name:string):string=>name.replace(/[\b\f\t\n\r\v]/gu,c=>'\\'+controls[c]).replaceAll('\\','\\\\').replaceAll('#','\\#');
        const observed=cases.map(item=>{
          assertG2EvidenceTime(item);assert.equal(item.time_basis,'REPORTER_OBSERVED_AT');
          assert.equal(item.event,'test:pass');assert.equal(item.skip,false);assert.equal(item.todo,false);
          assert.ok(typeof item.name==='string'&&typeof item.file==='string');
          assert.ok(typeof item.nesting==='number'&&Number.isSafeInteger(item.nesting)&&item.nesting>=0);
          assert.ok(typeof item.line==='number'&&Number.isSafeInteger(item.line)&&item.line>0);
          assert.ok(!path.posix.isAbsolute(item.file)&&!item.file.includes('\\'));
          const actualFile=path.posix.normalize(path.posix.join(cwd,item.file));assert.ok(loaded.includes(actualFile));
          return JSON.stringify([item.nesting,escaped(item.name)]);
        });
        const successes=[...tapText.matchAll(/^( *)ok \d+ - (.+)$/gmu)].map(match=>{
          const indent=match[1],name=match[2];assert.ok(indent!==undefined&&name!==undefined);assert.equal(indent.length%4,0);
          return JSON.stringify([indent.length/4,name]);
        });
        assert.deepEqual(observed.sort(),successes.sort());
      }
      assert.deepEqual(run.counts,total);
    }
    assert.deepEqual(selected.sort(),[...expected].sort());assert.deepEqual(executed.sort(),[...expected].sort());
  }catch{
    throw Object.assign(new Error('CURRENT_EXECUTION_INVALID'),{code:'CURRENT_EXECUTION_INVALID',stage:'EXECUTION'});
  }
}

/** Reads integrity-bound current evidence; this alone never proves readiness. */
export function readCurrentYxxReport(root:string):{reference:Reference;report:Record<string,unknown>} {
  if(!existsSync(path.join(root,CURRENT_YXX_POINTER)))throw Object.assign(new Error('CURRENT_EVIDENCE_REQUIRED'),{code:'CURRENT_EVIDENCE_REQUIRED',stage:'EVIDENCE'});
  try{
    const pointer=json(read(root,CURRENT_YXX_POINTER));
    assert.deepEqual(Object.keys(pointer).sort(),['report','schema_version']);assert.equal(pointer.schema_version,1);
    const ref=object(pointer.report);
    assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);
    assert.equal(typeof ref.path,'string');assert.equal(typeof ref.sha256,'string');assert.equal(typeof ref.bytes,'number');
    assert.ok(typeof ref.path==='string'&&typeof ref.sha256==='string'&&typeof ref.bytes==='number');
    assert.match(ref.path,/^evidence\/yxx-current-[a-z0-9][a-z0-9-]{0,63}\/report\.json$/u);
    assert.match(ref.sha256,/^[a-f0-9]{64}$/u);assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>0);
    const bytes=read(root,ref.path);assert.equal(bytes.length,ref.bytes);assert.equal(hash(bytes),ref.sha256);
    return {reference:{path:ref.path,sha256:ref.sha256,bytes:ref.bytes},report:json(bytes)};
  }catch{
    throw Object.assign(new Error('CURRENT_EVIDENCE_INVALID'),{code:'CURRENT_EVIDENCE_INVALID',stage:'EVIDENCE'});
  }
}

/** Candidate identity is necessary, but is not execution or review evidence. */
export function verifyCurrentYxxReportBinding(root:string,report:Record<string,unknown>):void {
  try{
    assert.equal(report.schema_version,1);assert.equal(report.contract,'ADR-0027');
    for(const field of ['tested_head','tested_tree']){
      assert.equal(typeof report[field],'string');assert.match(String(report[field]),/^[a-f0-9]{40}$/u);
    }
    assert.ok(typeof report.tested_head==='string'&&typeof report.tested_tree==='string');
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const {reference}=readCurrentYxxReport(root);
    assert.equal(reference.path,'evidence/yxx-current-'+report.run_id+'/report.json');
    const inventory=g2CandidateInventory(root);assert.equal(report.candidate_fingerprint,inventory.fingerprint);
    for(const [field,file] of [['scope_sha256','plans/yxx-current-readiness-scope.json'],
      ['acceptance_sha256','plans/yxx-current-readiness-acceptance.json']]){
      assert.ok(field&&file);
      assert.equal(report[field],hash(Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(read(root,file)).replaceAll('\r\n','\n'))));
    }
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));env.GIT_NO_REPLACE_OBJECTS='1';
    const git=(args:string[]):string=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
    assert.equal(git(['rev-parse',report.tested_head+'^{tree}']).trim(),report.tested_tree);
    git(['merge-base','--is-ancestor',report.tested_head,'HEAD']);
    const entries=new Map(git(['ls-tree','-r','-z',report.tested_head]).split('\0').filter(Boolean).map(line=>{
      const tab=line.indexOf('\t');assert.ok(tab>0);return [line.slice(tab+1),line.slice(0,tab).split(' ')];
    }));
    const indexed=new Map(git(['ls-files','--stage','-z']).split('\0').filter(Boolean).map(line=>{
      const tab=line.indexOf('\t');assert.ok(tab>0);return [line.slice(tab+1),line.slice(0,tab).split(' ')];
    }));
    assert.deepEqual([...entries.keys()].filter(isG2CandidatePath).sort(),inventory.files.map(file=>file.path).sort());
    for(const file of inventory.files){
      const entry=entries.get(file.path),index=indexed.get(file.path);assert.ok(entry&&index);
      assert.equal(entry[1],'blob');assert.equal(index[0],entry[0]);assert.equal(index[1],entry[2]);assert.equal(index[2],'0');
      const raw=read(root,file.path),bytes=file.encoding==='BINARY'?raw:Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(raw).replaceAll('\r\n','\n'));
      assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),entry[2]);
      if(process.platform!=='win32')assert.equal(lstatSync(path.join(root,file.path)).mode&0o111?'100755':'100644',entry[0]);
    }
  }catch{
    throw Object.assign(new Error('CURRENT_CANDIDATE_MISMATCH'),{code:'CURRENT_CANDIDATE_MISMATCH',stage:'CANDIDATE'});
  }
}
