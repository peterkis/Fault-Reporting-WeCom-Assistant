import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hash, record, sourceRoot, strings } from './common.mjs';

test('only the two proven frozen T02 expiry failures become historical observations', async t => {
  const source=sourceRoot(), scratch=mkdtempSync(path.join(tmpdir(),'t02-expiry-'));
  const root=path.join(scratch,'reference'), reports=path.join(scratch,'reports'), pgLog=path.join(scratch,'postgres.log');
  try {
    execFileSync('git',['clone','--quiet','--no-hardlinks','--config','core.autocrlf=true',source,root],{windowsHide:true});
    execFileSync('git',['checkout','--quiet','--detach','7eefaa99591bfaa2e787701efd315ff701c51f35'],{cwd:root,windowsHide:true});
    symlinkSync(path.join(source,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
    for(const args of [['--experimental-strip-types','tools/ts-migration/bootstrap.mts'],['.build/tools/build.mjs']]) {
      const built=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true});
      assert.equal(built.status,0,built.stdout+built.stderr);
    }
    mkdirSync(reports);
    const routes=record(JSON.parse(readFileSync(path.join(root,'plans/typescript-migration/test-routing.json'),'utf8')) as unknown);
    const selected=strings(record(routes.selections)['t02-baseline']);
    const names=['orchestrator persists three entries, keeps threads separate and replays Ticket/Communication safely',
      'continuation refs are hashed, reporter/bot bound, expiring, revocable and single-use'];
    const files=selected.slice(0,11).map((file,i)=>{
      const tests=[30,17,3,1,3,4,1,6,2,1,5][i] ?? 0, fail=i===10?2:0;
      const counts={tests,pass:tests-fail,fail,cancelled:0,skipped:0,todo:0};
      const prefix=String(i+1).padStart(3,'0')+'-'+path.basename(file);
      const tap=(i===10?names.map((n,j)=>`not ok ${j+1} - ${n}\n  ---\n  code: '25P02'\n  ...\n`).join(''):'')+
        Object.entries(counts).map(([k,v])=>`# ${k} ${v}\n`).join('');
      writeFileSync(path.join(reports,prefix+'.tap'),tap);writeFileSync(path.join(reports,prefix+'.stderr'),'');
      const result={path:file,runtime_path:file,mode:'REFERENCE_SOURCE_NOT_MIGRATION_PROOF',status:fail?'FAIL':'PASS',
        exit_code:fail?1:0,signal:null,tap_sha256:hash(tap),stderr_sha256:hash(''),counts,
        loaded_project_files:[file],observed_subprocess_entries:[]};
      writeFileSync(path.join(reports,prefix+'.json'),JSON.stringify(result));return result;
    });
    const summary={selection:'t02-baseline',status:'SELECTED_TESTS_FAIL',representation:'REFERENCE_SOURCE',
      manifest_sha256:hash(readFileSync(path.join(root,'.build/runtime/build-manifest.json'))),
      selected_files:selected,files,not_run:selected.slice(11),
      counts:{tests:73,pass:71,fail:2,cancelled:0,skipped:0,todo:0},production_ready:false};
    writeFileSync(path.join(reports,'summary.json'),JSON.stringify(summary));
    const log=[180,195].map(pid=>`2026-10-03 07:26:34.090 UTC [${pid}] ERROR:  new row for relation "message" violates check constraint "communication_message_retention_check"\n`+
      `2026-10-03 07:26:34.090 UTC [${pid}] DETAIL:  Failing row contains (synthetic, RULE_FIRST_ORCHESTRATOR, INTERNAL, 2026-10-03 12:00:00, 2026-10-03 15:26:34, 1791000000000).\n`+
      `2026-10-03 07:26:34.090 UTC [${pid}] STATEMENT:  INSERT INTO communication.message (retention_until)\n`+
      `2026-10-03 07:26:34.090 UTC [${pid}] ERROR:  current transaction is aborted, commands ignored until end of transaction block\n`).join('');
    writeFileSync(pgLog,log);
    const run=()=>spawnSync(process.execPath,[path.join(source,'.build/tools/classify-t02-expiry.mjs'),root,reports,pgLog,'1'],
      {cwd:source,encoding:'utf8',windowsHide:true,timeout:30_000});
    const accepted=run();assert.equal(accepted.status,0,accepted.stdout+accepted.stderr);
    const classified=record(JSON.parse(accepted.stdout) as unknown);
    assert.equal(classified.status,'HISTORICAL_REFERENCE_NOT_CURRENT_ACCEPTANCE');
    assert.equal(classified.original_status,'SELECTED_TESTS_FAIL');
    assert.deepEqual(classified.not_run,selected.slice(11));
    assert.equal(readFileSync(path.join(reports,'summary.json'),'utf8'),JSON.stringify(summary));
    await t.test('25P02 without primary retention proof, other deadlines and extra errors reject',()=>{
      for(const invalid of [log.replaceAll('communication_message_retention_check','other_constraint'),
        log.replaceAll('2026-10-03 12:00:00','2026-10-03 13:00:00'),
        log.replaceAll('07:26:34.090','03:26:34.090'),
        log+'2026-10-03 07:26:34.090 UTC [180] ERROR:  unrelated database failure\n']) {
        writeFileSync(pgLog,invalid);const rejected=run();assert.equal(rejected.status,1);assert.match(rejected.stderr,/T02_EXPIRY_NOT_PROVEN/u);
      }
      writeFileSync(pgLog,log);
    });
    await t.test('changed TAP hash, extra failure and incomplete historical selection reject',()=>{
      const last=files[10];assert.ok(last);
      const prefix='011-'+path.basename(selected[10] ?? '');
      const tapFile=path.join(reports,prefix+'.tap'),original=readFileSync(tapFile,'utf8');
      writeFileSync(tapFile,original+'# changed\n');assert.equal(run().status,1);writeFileSync(tapFile,original);
      writeFileSync(path.join(reports,'summary.json'),JSON.stringify({...summary,not_run:[]}));assert.equal(run().status,1);
      const changed={...last,exit_code:2};
      writeFileSync(path.join(reports,prefix+'.json'),JSON.stringify(changed));
      writeFileSync(path.join(reports,'summary.json'),JSON.stringify({...summary,files:[...files.slice(0,10),changed]}));
      assert.equal(run().status,1);
      writeFileSync(path.join(reports,prefix+'.json'),JSON.stringify(last));
      writeFileSync(path.join(reports,'summary.json'),JSON.stringify(summary));
    });
    await t.test('dirty or wrong historical object rejects',()=>{
      const fixture=path.join(root,'tests/helpers/p2-015-postgres-harness.mjs'),bytes=readFileSync(fixture);
      writeFileSync(fixture,Buffer.concat([bytes,Buffer.from('\n')]));assert.equal(run().status,1);writeFileSync(fixture,bytes);
      execFileSync('git',['checkout','--quiet','--detach','HEAD^'],{cwd:root,windowsHide:true});assert.equal(run().status,1);
    });
  } finally {
    assert.equal(path.dirname(scratch),path.resolve(tmpdir()));assert.ok(path.basename(scratch).startsWith('t02-expiry-'));
    rmSync(scratch,{recursive:true,force:true});
  }
});

test('retired T02 replay cannot suppress independent current CI hard gates',()=>{
  const root=sourceRoot();
  const parsed=spawnSync('python',['-c',
    "import json,yaml; from pathlib import Path; print(json.dumps({n:yaml.load(Path('.github/workflows/'+n+'.yml').read_text(encoding='utf-8'),Loader=yaml.BaseLoader) for n in ['types-migration','ss009-evidence-history','p2-staff-directory']}))"],
    {cwd:root,encoding:'utf8',windowsHide:true,timeout:10_000});
  assert.equal(parsed.status,0,parsed.stderr);
  const workflows=record(JSON.parse(parsed.stdout) as unknown), types=record(workflows['types-migration']);
  const jobs=record(types.jobs), merge=record(jobs['typescript-merge-check']);
  const runs=(job:Record<string,unknown>):string=>{
    assert.ok(Array.isArray(job.steps));
    return job.steps.map(step=>String(record(step).run??'')).join('\n');
  };
  assert.equal(merge.if,"${{ github.event_name == 'pull_request' }}");
  assert.equal(merge['runs-on'],'ubuntu-latest');assert.equal(merge.strategy,undefined);
  const mergeScript=runs(merge);
  assert.equal([...mergeScript.matchAll(/npm run migration:build/gu)].length,1);
  assert.match(mergeScript,/node \.build\/tools\/gate\.mjs types/u);
  assert.match(mergeScript,/ACTIVE_SELECTION_MUST_BE_UNIQUE/u);
  assert.match(mergeScript,/runSelection\(process\.cwd\(\),select\(loadRoutes/u);
  assert.doesNotMatch(mergeScript,/verify-published-history|pr-evidence-delta|--require-ready|--current-full|--batch|migration:typecheck/u);
  for(const value of Object.values(jobs)) {
    const job=record(value);assert.ok(!job['continue-on-error']);
    assert.ok(Array.isArray(job.steps));
    for(const step of job.steps) assert.ok(!record(step)['continue-on-error']);
    assert.doesNotMatch(runs(job),/--reference-source|T02_REMAINING_ORIGINAL|classify-t02-expiry\.mjs|observe-runtime\.mjs|types-t02-reference/u);
  }
  for(const name of ['current-regression','structure-tooling'])assert.equal(record(jobs[name]).if,"${{ github.event_name == 'workflow_dispatch' }}");
  assert.equal(record(jobs['strict-readiness']).if,"${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'certify' }}");
  assert.match(runs(record(jobs['strict-readiness'])),/yxx-self-service-readiness\.mjs --require-ready/u);
  assert.match(runs(record(jobs['strict-readiness'])),/--frozen p2016/u);
  const bash=process.platform==='win32'?path.resolve(execFileSync('git',['--exec-path'],{encoding:'utf8',windowsHide:true}).trim(),'../../../bin/bash.exe'):'bash';
  for(const mode of ['full','certify']) {
    const complete=record(jobs[mode+'-complete']);
    assert.deepEqual(strings(complete.needs),mode==='full'?['structure-tooling','current-regression']:['structure-tooling','current-regression','strict-readiness']);
    assert.equal(complete.if,"${{ always() && github.event_name == 'workflow_dispatch' && inputs.mode == '"+mode+"' }}");
    assert.ok(Array.isArray(complete.steps));const gate=record(complete.steps[0]);
    const passed:NodeJS.ProcessEnv={...process.env,TOOLING:'success',CURRENT:'success',STRICT:'success'};
    assert.equal(spawnSync(bash,['-c',String(gate.run)],{env:passed,windowsHide:true}).status,0);
    for(const name of Object.keys(record(gate.env)))for(const failure of ['failure','cancelled','skipped','']) {
      const result:SpawnSyncReturns<string>=spawnSync(bash,['-c',String(gate.run)],{encoding:'utf8',windowsHide:true,env:{...passed,[name]:failure}});
      assert.notEqual(result.status,0,name+' '+failure);
    }
    assert.match(runs(complete),/verify-current-shards\.mjs.*--shards 4/u);
  }
  const mergeSteps=merge.steps;assert.ok(Array.isArray(mergeSteps));
  const selected=String(record(mergeSteps.find(step=>String(record(step).run??'').includes('runSelection'))).run);
  const failed=selected.replace('node .build/runtime/scripts/migrate-current-baseline.mjs',':')
    .replace(/(?<=<<'NODE'\n)[\s\S]+(?=\nNODE\n)/u,"throw Error('SELECTED_TESTS_FAIL');");
  assert.notEqual(spawnSync(bash,['-c',failed],{cwd:root,encoding:'utf8',windowsHide:true}).status,0);
  const history=record(workflows['ss009-evidence-history']), historyJobs=record(history.jobs), light=record(historyJobs['evidence-history']);
  assert.equal(light.if,"${{ github.event_name == 'pull_request' }}");assert.equal(light['runs-on'],'ubuntu-latest');assert.equal(light.strategy,undefined);
  const historyScript=runs(light);
  for(const name of ['verify-published-history.mjs','pr-evidence-delta.test.mjs','pr-evidence-delta.mjs'])assert.ok(historyScript.includes(name));
  assert.doesNotMatch(historyScript,/npm |pip |PyYAML|migration:|t03-current-ci|ss009-frozen|--require-ready|r6|SS009_VALIDATORS/u);
  const historical=record(historyJobs['historical-certify']);
  assert.equal(historical.if,"${{ github.event_name == 'workflow_dispatch' && inputs.mode == 'certify' }}");
  assert.match(runs(historical),/validate-yxx-self-service\.mjs --require-ready/u);
  assert.match(runs(historical),/ss009-evidence-history-probe\.mjs/u);
  assert.match(runs(historical),/SS009_VALIDATORS/u);
  for(const workflow of [types,history])assert.equal(record(workflow.on).workflow_call,undefined);
  const directory=record(record(record(workflows['p2-staff-directory']).on).pull_request);
  const paths=strings(directory.paths);
  for(const broad of ['src/**/*.mts','scripts/**/*.mts','tools/ts-migration/**','plans/typescript-migration/**'])assert.ok(!paths.includes(broad));
  assert.ok(paths.includes('src/p2-007-*.mts'));assert.ok(paths.includes('src/platform/**'));
});
