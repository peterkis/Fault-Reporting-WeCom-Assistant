import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, record, safeFile, strings } from './common.mjs';
import { counts } from './run-tests.mjs';

const HEAD='7eefaa99591bfaa2e787701efd315ff701c51f35';
const TREE='76c3db47ee14feb24be4cd52d1077f039da4f888';
const FIXTURE='tests/helpers/p2-015-postgres-harness.mjs';
const FAILING='tests/p2-015-rule-first-orchestration.integration.test.mjs';
const SCENARIOS=['orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely',
  'continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use'];
const DEADLINE=1791000000000;
function pinned(root:string):void {
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
  const git=(args:string[])=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,env,encoding:'utf8',windowsHide:true}).trim();
  assert.equal(git(['rev-parse','HEAD']),HEAD);assert.equal(git(['rev-parse','HEAD^{tree}']),TREE);
  assert.equal(git(['rev-parse','--is-shallow-repository']),'false');assert.equal(git(['status','--porcelain']),'');
  assert.equal(git(['for-each-ref','--format=%(refname)','refs/replace']),'');
  assert.ok(!existsSync(path.resolve(root,git(['rev-parse','--git-path','info/grafts']))));
  assert.equal(git(['ls-tree','HEAD',FIXTURE]),'100644 blob f57161d3bf145451ee4e850d9af150ae6f290a57\t'+FIXTURE);
  const verified=spawnSync(process.execPath,['.build/tools/verify-artifact.mjs'],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:30_000});
  assert.equal(verified.status,0,'T02_ARTIFACT_INVALID');
}
function read(root:string,file:string):string {return new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(safeFile(root,file)));}
export function classifyT02Expiry(root:string,reports:string,pgLog:string,exitCode:string):Record<string,unknown> {
  pinned(root);assert.equal(exitCode,'1');
  const routes=record(JSON.parse(read(root,'plans/typescript-migration/test-routing.json')) as unknown);
  const selected=strings(record(routes.selections)['t02-baseline']);
  assert.equal(selected.length,17);assert.equal(selected[10],FAILING);
  const summaryBytes=readFileSync(safeFile(reports,'summary.json'));
  const summary=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(summaryBytes)) as unknown);
  assert.equal(summary.selection,'t02-baseline');assert.equal(summary.status,'SELECTED_TESTS_FAIL');
  assert.equal(summary.representation,'REFERENCE_SOURCE');assert.equal(summary.production_ready,false);
  assert.equal(summary.manifest_sha256,hash(readFileSync(safeFile(root,'.build/runtime/build-manifest.json'))));
  assert.deepEqual(summary.selected_files,selected);assert.deepEqual(summary.not_run,selected.slice(11));
  assert.deepEqual(summary.counts,{tests:73,pass:71,fail:2,cancelled:0,skipped:0,todo:0});
  assert.ok(Array.isArray(summary.files));assert.equal(summary.files.length,11);
  for(const [i,value] of summary.files.entries()) {
    const item=record(value),file=selected[i];assert.ok(file);
    const prefix=String(i+1).padStart(3,'0')+'-'+path.basename(file);
    assert.deepEqual(JSON.parse(read(reports,prefix+'.json')) as unknown,item);
    const tap=read(reports,prefix+'.tap'),stderr=read(reports,prefix+'.stderr');
    assert.equal(hash(tap),item.tap_sha256);assert.equal(hash(stderr),item.stderr_sha256);assert.equal(stderr,'');
    const tests=[30,17,3,1,3,4,1,6,2,1,5][i] ?? 0,fail=i===10?2:0;
    const expected={tests,pass:tests-fail,fail,cancelled:0,skipped:0,todo:0};
    assert.deepEqual(counts(tap),expected);assert.deepEqual(item.counts,expected);
    assert.equal(item.path,file);assert.equal(item.runtime_path,file);assert.equal(item.mode,'REFERENCE_SOURCE_NOT_MIGRATION_PROOF');
    assert.equal(item.signal,null);assert.equal(item.exit_code,fail?1:0);assert.equal(item.status,fail?'FAIL':'PASS');
    assert.ok(strings(item.loaded_project_files).includes(file));
    if(fail) {
      const failures=[...tap.matchAll(/^not ok \d+ - (.+)\r?\n([\s\S]*?)^  \.\.\.\r?$/gmu)];
      assert.deepEqual(failures.map(match=>match[1]),SCENARIOS);
      for(const failure of failures)assert.match(failure[2] ?? '',/^  code: '25P02'\r?$/mu);
    } else assert.ok(!/^not ok /mu.test(tap));
  }
  // The PostgreSQL primary error and its same-backend detail/statement are required.
  // A transaction-aborted message alone cannot authorize classification.
  const pgBytes=readFileSync(pgLog);assert.ok(pgBytes.length>0 && pgBytes.length<=16*1024*1024);
  const log=new TextDecoder('utf-8',{fatal:true}).decode(pgBytes);
  const failures=[...log.matchAll(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+) UTC \[(\d+)\] ERROR:  new row for relation "message" violates check constraint "communication_message_retention_check"\r?$/gmu)];
  assert.equal(failures.length,2);assert.equal(new Set(failures.map(match=>match[2])).size,2);
  for(const failure of failures) {
    assert.ok(Date.parse((failure[1] ?? '').replace(' ','T')+'Z')>DEADLINE);
    const pid=failure[2];assert.ok(pid);
    const backend=log.split(/\r?\n/u).filter(line=>line.includes(`[${pid}] `));
    const errors=backend.filter(line=>line.includes(' ERROR: '));
    assert.equal(errors.length,2);
    assert.ok(errors[0]?.endsWith('ERROR:  new row for relation "message" violates check constraint "communication_message_retention_check"'));
    assert.ok(errors[1]?.endsWith('ERROR:  current transaction is aborted, commands ignored until end of transaction block'));
    const detail=backend.find(line=>line.includes(' DETAIL:  Failing row contains '));assert.ok(detail);
    const tail=/, INTERNAL, 2026-10-03 12:00:00, (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}), 1791000000000\)\.$/u.exec(detail);
    assert.ok(tail);assert.ok(Date.parse((tail[1] ?? '').replace(' ','T')+'+08:00')>DEADLINE);
    assert.ok(detail.includes('RULE_FIRST_ORCHESTRATOR'));
    assert.ok(backend.some(line=>line.includes(' STATEMENT:  INSERT INTO communication.message (')));
  }
  return {status:'HISTORICAL_REFERENCE_NOT_CURRENT_ACCEPTANCE',authorized_contract:'ADR-0027/T02-expiry-20261003',
    historical_head:HEAD,historical_tree:TREE,original_exit_code:1,original_status:summary.status,
    original_counts:summary.counts,not_run:summary.not_run,scenarios:SCENARIOS,
    original_summary_sha256:hash(summaryBytes),postgres_log_sha256:hash(pgBytes),current_acceptance:false};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);assert.equal(args.length,4);assert.ok(args.every(arg=>arg.length>0));
    console.log(JSON.stringify(classifyT02Expiry(args[0] ?? '',args[1] ?? '',args[2] ?? '',args[3] ?? '')));
  } catch {console.error('T02_EXPIRY_NOT_PROVEN');process.exitCode=1;}
}
