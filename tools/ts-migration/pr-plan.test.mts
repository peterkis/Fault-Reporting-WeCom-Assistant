import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {diff,parseDiff,parsePolicy,planChanges} from './pr-plan.mjs';
import {loadRoutes} from './routing.mjs';
import {sourceRoot,record} from './common.mjs';

const root=sourceRoot(),routes=loadRoutes(root);
const raw=()=>JSON.parse(readFileSync(path.join(root,'plans/testing-policy.json'),'utf8')) as unknown;
const policy=()=>parsePolicy(raw());
const plan=(...paths:string[])=>planChanges(policy(),routes,paths.map(p=>({status:'M',paths:[p]})));
const paths=(p:ReturnType<typeof plan>)=>p.selection.entries.map(e=>e.path);
test('documentation never prepares application resources or application build',()=>{
  const p=plan('docs/api/new-guide.md','plans/example/执行记录.md','docs/ui/evidence/new.png','.github/review/README.md','app/pc-admin/README.md','app/h5/README.md','docs/agents/baseline-history.md','app/pc-admin/docs/screenshot.png');
  assert.equal(p.lane,'docs');assert.equal(p.build,false);assert.deepEqual(p.selection.entries,[]);
  assert.deepEqual(p.requirements,{database:false,browser:false,pyyaml:false,ffmpeg:false,windows:false});
  assert.ok(p.not_selected.every(e=>e.reason.startsWith('NOT_SELECTED')));
});
test('PC covers current commands, authorization and UNKNOWN without unrelated H5 or Incident',()=>{
  const p=plan('app/pc-admin/src/features/tickets/Ticket.tsx');
  assert.ok(p.build&&p.requirements.database&&p.requirements.browser);
  assert.ok(paths(p).some(s=>s.includes('unknown'))&&paths(p).some(s=>s.includes('authority')));
  assert.ok(paths(p).some(s=>s.includes('realtime-tracer')),'SSE identity and scoped recovery remain covered');
  assert.ok(paths(p).every(s=>!s.includes('h5')&&!s.includes('incident')));assert.equal(p.requirements.ffmpeg,false);
});
test('H5 flow requests its media dependency and never native desktop',()=>{
  const p=plan('app/h5/src/pages/Result.tsx');assert.equal(p.requirements.windows,false);
  assert.ok(p.requirements.ffmpeg&&p.requirements.browser&&p.requirements.database);
  assert.ok(paths(p).includes('tests/yxx-h5-flow.integration.test.mts'));
  assert.ok(!paths(p).some(s=>s.includes('electron')));
});
test('identity and transaction expand to real service/PG and browser checks',()=>{
  for(const file of ['app/server/src/p2-016-auth.mts','app/server/src/commands/transaction.mts']){
    const p=plan(file);assert.ok(p.requirements.database&&p.requirements.browser);
    assert.ok(paths(p).some(s=>s.includes('atomic-rollback'))&&paths(p).some(s=>s.includes('workbench-auth')));
  }
});
test('SQL, shared assembly, lock and compiler changes reach the MVP union',()=>{
  for(const file of ['database/migrations/999-new.sql','shared/runtime.mts','package-lock.json','tsconfig.base.json','app/server/src/p2-016-runtime.mts','app/server/src/p2-g2-service-loop-assembly.mts']){
    const p=plan(file);assert.equal(p.build,true);assert.equal(p.lane,'database');
    assert.ok(paths(p).some(s=>s.includes('h5-flow'))&&paths(p).some(s=>s.includes('notification-policy')));
  }
});
test('notification risks include UNKNOWN, recipient authority and privacy admission',()=>{
  const p=plan('app/server/src/notification-sender.mts');
  for(const word of ['sender-unknown','notification-identity','delivery-admission','exception-authorization'])assert.ok(paths(p).some(s=>s.includes(word)),word);
});
test('a new unrecognized production module gets a nonempty broader MVP fallback',()=>{
  for(const file of ['future-service/main.mts','future-service/assets/icon.svg','web/p2-reporter/assets/status.png']){
    const p=plan(file);assert.ok(p.build&&p.selection.entries.length>20,file);
    assert.match(p.reasons[0]?.reason??'',/Unknown path/u);assert.ok(p.profiles.includes('mvp'));
  }
});
test('multiple modules union entries once and keep original host/flags requirements',()=>{
  const p=plan('app/pc-admin/src/Test.tsx','app/h5/src/Test.tsx','app/server/src/commands/test.mts','app/pc-admin/src/Other.tsx');
  const expected=new Set([...paths(plan('app/pc-admin/src/Test.tsx')),...paths(plan('app/h5/src/Test.tsx')),...paths(plan('app/server/src/commands/test.mts'))]);
  assert.deepEqual(new Set(paths(p)),expected);assert.equal(paths(p).length,expected.size);
  for(const entry of p.selection.entries)assert.deepEqual(entry,routes.entries.find(e=>e.path===entry.path));
});
test('real Git NUL differences preserve rename origins, deletes, additions and Chinese paths',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pr-plan-git-'));
  const git=(args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',windowsHide:true});
  try{
    git(['init','-q']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','fixture']);
    mkdirSync(path.join(dir,'app/pc-admin/src'),{recursive:true});mkdirSync(path.join(dir,'docs'));
    writeFileSync(path.join(dir,'app/pc-admin/src/旧名字.tsx'),'unique production content\n');writeFileSync(path.join(dir,'shared.mts'),'delete me\n');
    git(['add','.']);git(['commit','-qm','base']);const base=git(['rev-parse','HEAD']).trim();
    git(['mv','app/pc-admin/src/旧名字.tsx','docs/中文.md']);git(['rm','shared.mts']);writeFileSync(path.join(dir,'新增.md'),'record\n');git(['add','.']);git(['commit','-qm','head']);
    const result=diff(dir,base);assert.ok(result.changes.some(c=>c.status==='R100'&&c.paths[0]==='app/pc-admin/src/旧名字.tsx'&&c.paths[1]==='docs/中文.md'));
    assert.ok(result.changes.some(c=>c.status==='D'&&c.paths[0]==='shared.mts'));assert.ok(result.changes.some(c=>c.status==='A'&&c.paths[0]==='新增.md'));
    assert.ok(planChanges(policy(),routes,result.changes).build,'rename into docs cannot hide production origin');
    for(const bad of ['', '--all', 'missing-base'])assert.throws(()=>diff(dir,bad));
    assert.throws(()=>diff(dir,base,'missing-head'));
    writeFileSync(path.join(dir,'app/pc-admin/src/dirty.tsx'),'uncommitted production change');
    const execution=spawnSync(process.execPath,[path.join(root,'.build/tools/pr-plan.mjs'),'--base',base,'--run','--report-dir',path.join(dir,'report')],{cwd:dir,encoding:'utf8',windowsHide:true});assert.notEqual(execution.status,0);assert.match(execution.stderr,/PR_EXECUTION_REQUIRES_CLEAN_HEAD/u);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid profiles, missing entries and empty business execution fail before running',()=>{
  const r=record(raw());const rules=r.rules;assert.ok(Array.isArray(rules));record(rules[0]).profiles=['missing'];assert.throws(()=>parsePolicy(r),/UNKNOWN_PROFILE/u);
  const p=policy(),core=p.profiles['core'];assert.ok(core);core.selections=['missing'];assert.throws(()=>planChanges(p,routes,[]));
  const missing=structuredClone(routes);missing.selections['pr-core']=['tests/not-registered.test.mts'];assert.throws(()=>planChanges(policy(),missing,[]),/MISSING_ENTRY/u);
  const empty=policy(),emptyCore=empty.profiles['core'];assert.ok(emptyCore);emptyCore.selections=[];assert.throws(()=>planChanges(empty,routes,[]),/EMPTY_PROFILE/u);
  const fallback=policy();fallback.fallback=['docs'];assert.throws(()=>planChanges(fallback,routes,[]),/FALLBACK_MUST_EXECUTE/u);
  assert.throws(()=>parseDiff('M\0unterminated'));assert.throws(()=>parseDiff('R100\0only-one\0'));
  const cli=spawnSync(process.execPath,[path.join(root,'.build/tools/pr-plan.mjs')],{cwd:root,encoding:'utf8',windowsHide:true});assert.notEqual(cli.status,0);assert.match(cli.stderr,/PR_BASE_REQUIRED/u);
  const mismatch=spawnSync(process.execPath,[path.join(root,'.build/tools/pr-plan.mjs'),'--base','HEAD^','--head','HEAD^'],{cwd:root,encoding:'utf8',windowsHide:true});assert.notEqual(mismatch.status,0);assert.match(mismatch.stderr,/PR_HEAD_CHECKOUT_MISMATCH/u);
});
test('historical-only checks cannot silently enter defaults, but a direct edit selects them explicitly',()=>{
  const p=policy(),h=p.history[0];assert.ok(h);
  assert.ok(!paths(plan('app/pc-admin/src/Feature.tsx')).includes(h.path));
  const direct=plan(h.path);assert.ok(paths(direct).includes(h.path));assert.equal(direct.history[0]?.status,'DIRECT_CHANGE_REQUIRES_CHECK');
  const altered=structuredClone(routes);altered.selections['pr-pc']=[h.path];assert.throws(()=>planChanges(p,altered,[]),/HISTORY_IN_DEFAULT/u);
  const current=plan('app/pc-admin/src/Feature.tsx');for(const replacement of h.replacement)assert.ok(paths(current).includes(replacement));
  const presence=plan('app/server/src/workbench-activity-service.mts');assert.ok(paths(presence).includes('tests/wbint-t39-activity.integration.test.mts'));assert.ok(paths(presence).includes('tests/wbint-t39-activity-lifecycle.browser.test.mts'));
});

function yaml(file:string):Record<string,unknown>{return record(JSON.parse(execFileSync('python',['-c',"import json,yaml,sys; print(json.dumps(yaml.load(open(sys.argv[1],encoding='utf-8'),Loader=yaml.BaseLoader)))",path.join(root,file)],{encoding:'utf8',windowsHide:true})) as unknown);}
test('the actual workflow summary rejects failure, cancellation, skip and missing planned jobs',()=>{
  const workflow=yaml('.github/workflows/types-migration.yml'),jobs=record(workflow.jobs),job=record(jobs['typescript-merge-check']);
  assert.equal(job.if,"${{ always() && github.event_name == 'pull_request' }}");assert.deepEqual(job.needs,['pr-plan','pr-docs','pr-no-database','pr-database','pr-windows']);
  const steps=job.steps;assert.ok(Array.isArray(steps));const script=String(record(steps[0]).run);
  const bash=process.platform==='win32'?path.resolve(execFileSync('git',['--exec-path'],{encoding:'utf8',windowsHide:true}).trim(),'../../../bin/bash.exe'):'bash';
  const directory=mkdtempSync(path.join(tmpdir(),'pr-summary-'));
  try{
    for(const [lane,selected] of [['docs','DOCS'],['no-database','NO_DATABASE'],['database','DATABASE']] as const){
      const env={...process.env,PLAN:'success',LANE:lane,DOCS:'skipped',NO_DATABASE:'skipped',DATABASE:'skipped',WINDOWS_REQUIRED:'false',WINDOWS:'skipped',GITHUB_STEP_SUMMARY:path.join(directory,'summary.md'),[selected]:'success'};
      const result=(extra:Record<string,string>)=>spawnSync(bash,['-c',script],{env:{...env,...extra},windowsHide:true,encoding:'utf8'}).status;
      assert.equal(result({}),0);
      for(const status of ['failure','cancelled','skipped','pending','']){assert.notEqual(result({[selected]:status}),0);assert.notEqual(result({PLAN:status}),0);assert.notEqual(result({WINDOWS_REQUIRED:'true',WINDOWS:status}),0);}
      assert.equal(result({WINDOWS_REQUIRED:'true',WINDOWS:'success'}),0);assert.notEqual(result({LANE:'unknown'}),0);
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('resource preparation and builds stay on mutually exclusive actual workflow paths',()=>{
  const jobs=record(yaml('.github/workflows/types-migration.yml').jobs),action=yaml('.github/actions/pr-check/action.yml');
  assert.equal(record(jobs['pr-docs']).services,undefined);assert.equal(record(jobs['pr-no-database']).services,undefined);
  assert.match(String(record(jobs['pr-no-database']).if),/lane == 'no-database'/u);assert.match(String(record(jobs['pr-database']).if),/lane == 'database'/u);
  const steps=record(action.runs).steps;assert.ok(Array.isArray(steps));const code=steps.map(s=>String(record(s).run??'')).join('\n');
  for(const input of Object.values(record(action.inputs)))assert.equal(typeof record(input).description,'string','GitHub requires descriptions for every composite action input');
  assert.equal([...code.matchAll(/npm run migration:build/gu)].length,1);assert.doesNotMatch(code,/run-tests\.mjs|--require-ready/u);assert.match(code,/pr-plan\.mjs.*--run/u);assert.match(code,/verify-artifact\.mjs/u);
  for(const resource of ['browser','pyyaml','ffmpeg'])assert.ok(steps.some(s=>String(record(s).if??'').includes('inputs.'+resource+" == 'true'")));
  const native=plan('app/pc-admin/desktop/policy.mts');assert.equal(native.requirements.windows,true);
  const unsafe=policy(),desktop=unsafe.profiles['desktop'];assert.ok(desktop);desktop.windows=false;assert.throws(()=>planChanges(unsafe,routes,[{status:'M',paths:['app/pc-admin/desktop/policy.mts']}]),/NATIVE_RESOURCE_REQUIRED/u);
  const nativeSteps=record(jobs['pr-windows']).steps;assert.ok(Array.isArray(nativeSteps));
  const cleanup=nativeSteps.map(record).find(s=>s.name==='Stop and remove only the owned native test cluster');assert.ok(cleanup);assert.equal(cleanup.if,"${{ always() && steps.native-pg.outputs.owned == 'true' }}");
});
