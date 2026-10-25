import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { testRoots } from './helpers/migration-roots.mjs';

const root = process.cwd();
const text = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file) => JSON.parse(text(file));

test('ARCH-006 logical source migration allows the approved inventory and rejects dual or out-of-scope source', async () => {
  const source = text('app/server/scripts/validate-arch-006-rule-first-service-loop.mjs');
  const gate = source.slice(source.indexOf('function erasedMigrationRuntime('), source.indexOf('const historicalEvidence='));
  const scope = json('plans/typescript-migration/scope.json');
  const repairPath='contracts/communication_lock_order_repair.v1.json',approvedRepairRecord=json(repairPath);
  const {logicalSource,physicalSource,canonicalSourceText}=await import(new URL('../.build/tools/backend-layout.mjs',import.meta.url));
  const logical = 'src/p2-001-conversation-contracts.mjs', typed = logical.replace(/\.mjs$/u, '.mts');
  // Model the first conversion before its completed mapping exists.
  delete scope.current_module_map[logical];
  assert.equal(scope.current_module_map[logical], undefined, 'approval comes from the full inventory, before completion mapping');
  function inspect(changes, files, before = 'export const allowed = false;', after = 'export const allowed: boolean = false;', alreadyTyped = false, extraBaseline = [], linked = false, repairRecord = approvedRepairRecord) {
    const errors = [], inventory = Object.values(scope.migration_batches).flat();
    const context = { root, path, ts, createHash, errors, logicalSource,physicalSource,canonicalSourceText,json: relative => relative===repairPath?repairRecord:scope, read: () => after,
      fs: { existsSync: file => files.has(logicalSource(path.relative(root, file).replaceAll('\\', '/'))), readFileSync: () => after,
        lstatSync:()=>({isFile:()=>true,isSymbolicLink:()=>linked}) },
      execFileSync: (_git, args) => args.includes('ls-tree') ? [...inventory.map(file => alreadyTyped ? file.replace(/\.mjs$/u, '.mts') : file), ...extraBaseline].join('\n')
        : args.includes('diff') ? changes.join('\0') : args.includes('show') ? before : '',
      check: (accepted, reason) => { if (!accepted) errors.push(reason); },
      p2016Authorized: true, p2g2Authorized: true,
    };
    runInNewContext(gate + '\nresult = { changedPaths, languageMigrations: [...languageMigrations], localCommunicationRepairs: [...localCommunicationRepairs] };', context);
    return { errors, result: context.result };
  }
  const migrated = inspect([logical, typed], new Set([typed]));
  assert.deepEqual(migrated.errors, []);
  assert.deepEqual(Array.from(migrated.result.changedPaths), [logical]);
  assert.deepEqual(Array.from(migrated.result.languageMigrations), [logical]);
  const relocated=inspect([physicalSource(logical),physicalSource(typed)],new Set([typed]));
  assert.deepEqual(relocated.errors,[]);
  assert.deepEqual(Array.from(relocated.result.changedPaths),[logical]);
  assert.deepEqual(Array.from(relocated.result.languageMigrations),[logical]);
  const existingTyped = 'src/p2-006-existing-layout-module.mts';
  const existingLogical = existingTyped.replace(/\.mts$/u, '.mjs');
  const existingLayout = inspect([physicalSource(existingTyped)], new Set([existingTyped]),
    'export const allowed: boolean = false;', 'export const allowed: false = false;', true, [existingTyped]);
  assert.deepEqual(existingLayout.errors, [], 'an existing typed module may move without becoming a new legacy exemption');
  assert.deepEqual(Array.from(existingLayout.result.languageMigrations), [existingLogical]);
  const changedLayout = inspect([physicalSource(existingTyped)], new Set([existingTyped]),
    'export const allowed: boolean = false;', 'export const allowed: boolean = true;', true, [existingTyped]);
  assert.match(changedLayout.errors.join('\n'), /no forbidden Runtime/u);
  assert.deepEqual(Array.from(changedLayout.result.languageMigrations), []);
  const postT00='src/yxx-h5-static.mts';
  const ordinaryTyped=inspect([physicalSource(postT00)],new Set([postT00]),'export const allowed: boolean = false;','export const allowed: boolean = true;',true,[postT00]);
  assert.deepEqual(ordinaryTyped.errors,[],'an existing post-T00 strict module is not a new suffix conversion');
  assert.deepEqual(Array.from(ordinaryTyped.result.languageMigrations),[],'an executable update receives no type-only exemption');
  assert.deepEqual(inspect(['src/bot-reporter-static.mts'],new Set(),undefined,undefined,true,['src/bot-reporter-static.mts']).errors,[],'a removed typed module is a retirement');
  const oldPc='web/admin-workbench/src/app/App.tsx',newPc='app/pc-admin/src/app/App.tsx';
  assert.deepEqual(inspect([oldPc,newPc],new Set([newPc]),undefined,undefined,false,[oldPc]).errors,[],'each tracked PC path needs its actual counterpart');
  const oldFeedback='web/admin-workbench/src/bot-feedback.ts',newFeedback='app/h5/src/reporter/feedback.ts',retirement='adr/0043_h5_notification_entry_and_legacy_ui_retirement.md';
  assert.deepEqual(inspect([oldFeedback],new Set([newFeedback,retirement]),undefined,undefined,false,[oldFeedback]).errors,[],'the exact accepted Reporter entry retirement retains its replacement');
  assert.match(inspect([oldFeedback],new Set([retirement]),undefined,undefined,false,[oldFeedback]).errors.join('\n'),/no forbidden Runtime/u);
  assert.match(inspect([oldFeedback],new Set([newFeedback]),undefined,undefined,false,[oldFeedback]).errors.join('\n'),/no forbidden Runtime/u,'the replacement alone cannot authorize retirement without the accepted ADR');
  for(const result of [
    inspect([oldPc],new Set(),undefined,undefined,false,[oldPc]),
    inspect([oldPc,newPc],new Set([oldPc,newPc]),undefined,undefined,false,[oldPc]),
    inspect([oldPc,newPc],new Set([newPc])),
    inspect([oldPc,newPc],new Set([newPc]),undefined,undefined,false,[oldPc],true),
    inspect(['web/unapproved/page.js'],new Set(['web/unapproved/page.js'])),
  ])assert.match(result.errors.join('\n'),/no forbidden Runtime/u);
  assert.match(inspect([logical, typed], new Set([logical, typed])).errors.join('\n'), /MIGRATION_DUAL_SOURCE/u);
  assert.match(inspect(['src/p2-006-unapproved.mts'], new Set(['src/p2-006-unapproved.mts'])).errors.join('\n'), /no forbidden Runtime/u);
  assert.match(inspect(['src/unregistered-legacy.mts'],new Set(['src/unregistered-legacy.mts']),undefined,undefined,false,['src/unregistered-legacy.mjs']).errors.join('\n'),/ARCH006_MIGRATION_OUTSIDE_SCOPE/u);
  const addedStrict=inspect(['src/current-catalog.mts'],new Set(['src/current-catalog.mts']));
  assert.deepEqual(addedStrict.errors,[]);assert.deepEqual(Array.from(addedStrict.result.languageMigrations),[]);
  assert.match(inspect(['src/p2-006-unapproved.mjs'], new Set(['src/p2-006-unapproved.mjs'])).errors.join('\n'), /no forbidden Runtime/u);
  const protectedPath = 'src/p2-006-workbench-query.mjs', protectedTyped = protectedPath.replace(/\.mjs$/u, '.mts');
  const typeOnly = inspect([protectedPath, protectedTyped], new Set([protectedTyped]));
  assert.deepEqual(typeOnly.errors, []);
  assert.deepEqual(Array.from(typeOnly.result.languageMigrations), [protectedPath]);
  const typedSuccessor = inspect([protectedTyped], new Set([protectedTyped]),
    'export const allowed: boolean = false;', 'export const allowed: false = false;', true);
  assert.deepEqual(typedSuccessor.errors, [], 'unchanged runtime from a registered typed predecessor remains a type-only change');
  assert.deepEqual(Array.from(typedSuccessor.result.languageMigrations), [protectedPath]);
  for (const [before, after] of [
    ['export const allowed = false;', 'export const allowed: boolean = true;'],
    ["export const sql = 'SELECT 1';", "export const sql: string = 'DELETE FROM ticket';"],
    ["export function finish(db) { return db.query('COMMIT'); }", "export function finish(db: Db) { return db.query('ROLLBACK'); }"],
    ['export const allowed = false;', 'enum SideEffect { ENABLE = globalThis.enable() } export const allowed: boolean = false;'],
  ]) {
    const changed = inspect([protectedPath, protectedTyped], new Set([protectedTyped]), before, after);
    assert.deepEqual(Array.from(changed.result.languageMigrations), [], 'runtime edits cannot use a suffix migration exemption');
    assert.match(changed.errors.join('\n'), /no forbidden Runtime/u);
    const typedChanged = inspect([protectedTyped], new Set([protectedTyped]), before, after, true);
    assert.deepEqual(Array.from(typedChanged.result.languageMigrations), [], 'typed predecessors cannot exempt executable changes');
    assert.match(typedChanged.errors.join('\n'), /no forbidden Runtime/u);
  }
  const authorized = 'src/p2-006-workbench-authorization.mjs', authorizedTyped = authorized.replace(/\.mjs$/u, '.mts');
  const runtimeRepair = inspect([authorized, authorizedTyped], new Set([authorizedTyped]), 'export const allowed = false;', 'export const allowed: boolean = true;');
  assert.deepEqual(Array.from(runtimeRepair.result.languageMigrations), []);
  assert.deepEqual(runtimeRepair.errors, [], 'non-type changes still use the separately authorized predecessor seam rules');
  const core='src/p2-004-communication-core.mjs',coreTyped=core.replace(/\.mjs$/u,'.mts');
  const predecessor=spawnSync('git',['show','d3b7fda4f2cfb4291f550a9ed0952812dcf9a18f:'+coreTyped],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.equal(predecessor.status,0,predecessor.stderr);
  const currentCore=text(physicalSource(coreTyped)),approvedFiles=new Set([coreTyped,repairPath]);
  const scoped=inspect([physicalSource(coreTyped)],approvedFiles,predecessor.stdout,currentCore,true);
  assert.deepEqual(scoped.errors,[]);
  assert.deepEqual(Array.from(scoped.result.localCommunicationRepairs),[core]);
  assert.deepEqual(Array.from(scoped.result.languageMigrations),[],'the runtime repair must not borrow a type-only exemption');
  for(const rejected of [
    inspect([physicalSource(coreTyped)],new Set([coreTyped]),predecessor.stdout,currentCore,true),
    inspect([physicalSource(coreTyped)],approvedFiles,predecessor.stdout,currentCore,true,[],true),
    inspect([physicalSource(coreTyped)],approvedFiles,predecessor.stdout,currentCore,true,[],false,{...approvedRepairRecord,live_authorized:true}),
    inspect([physicalSource(coreTyped)],approvedFiles,predecessor.stdout,currentCore,true,[],false,{...approvedRepairRecord,replacement_query:approvedRepairRecord.replacement_query+'\nDELETE FROM ticket;',replacement_query_sha256:createHash('sha256').update(approvedRepairRecord.replacement_query+'\nDELETE FROM ticket;').digest('hex')}),
    inspect([physicalSource(coreTyped)],approvedFiles,predecessor.stdout,currentCore,true,[],false,{...approvedRepairRecord,authorization_id:'UNAPPROVED'}),
    inspect([physicalSource(coreTyped)],approvedFiles,predecessor.stdout,currentCore,true,[],false,{...approvedRepairRecord,replacement_query:approvedRepairRecord.replacement_query+'\nDELETE FROM ticket;'}),
    inspect([physicalSource(coreTyped)],approvedFiles,predecessor.stdout,currentCore.replace('FOR UPDATE OF thread','FOR SHARE OF thread'),true),
    inspect([physicalSource(coreTyped)],approvedFiles,predecessor.stdout,currentCore+'\nglobalThis.__unexpected_arch006_runtime=true;\n',true),
    inspect([physicalSource('src/p2-006-workbench-query.mts')],new Set(['src/p2-006-workbench-query.mts',repairPath]),predecessor.stdout,currentCore,true),
  ]){
    assert.deepEqual(Array.from(rejected.result.localCommunicationRepairs),[]);
    assert.match(rejected.errors.join('\n'),/no forbidden Runtime/u);
  }

});

test('ARCH-006 validator passes', () => {
  const result = spawnSync(process.execPath, ['app/server/scripts/validate-arch-006-rule-first-service-loop.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('ARCH-006 current structure rejects missing scope and changed historical evidence', async () => {
  const { sourceRoot, runtimeRoot } = testRoots();
  const {withScopeCheckout}=await import(new URL('../.build/runtime/tests/helpers/yxx-current-scope-checkout.mjs',import.meta.url));
  const {checkSS010}=await import(new URL('../.build/runtime/app/server/src/yxx-self-service-readiness.mjs',import.meta.url));
  const scope='plans/yxx-current-readiness-scope.v2.json',history='evidence/g0-005-active-push-matrix.md';
  const originals=new Map([scope,history].map(file=>[file,fs.readFileSync(path.join(sourceRoot,file))]));
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const receipt=fs.mkdtempSync(path.join(tmpdir(),'arch006-negative-receipt-'));
  try{
    withScopeCheckout(fixture=>{
      assert.notEqual(path.resolve(fixture),path.resolve(sourceRoot));
      assert.equal(path.dirname(fixture),path.resolve(tmpdir()));
      assert.equal(fs.lstatSync(fixture).isSymbolicLink(),false);
      const dependencyLink=path.join(fixture,'node_modules');
      fs.symlinkSync(path.join(sourceRoot,'node_modules'),dependencyLink,process.platform==='win32'?'junction':'dir');
      const tool=path.join(fixture,'.build/tools/backend-layout.mjs');fs.mkdirSync(path.dirname(tool),{recursive:true});
      fs.copyFileSync(path.join(sourceRoot,'.build/tools/backend-layout.mjs'),tool);
      const retirement='adr/0043_h5_notification_entry_and_legacy_ui_retirement.md';
      assert.equal(fs.lstatSync(path.join(sourceRoot,retirement)).isSymbolicLink(),false);
      fs.copyFileSync(path.join(sourceRoot,retirement),path.join(fixture,retirement));
      const owner={fixture,source_root:sourceRoot,pid:process.pid,scope_sha256:digest(originals.get(scope)),history_sha256:digest(originals.get(history)),retirement_adr_sha256:digest(fs.readFileSync(path.join(fixture,retirement)))};
      fs.writeFileSync(path.join(receipt,'owner.json'),JSON.stringify(owner,null,2)+'\n');
      console.log('ARCH006_NEGATIVE_FIXTURE '+JSON.stringify({fixture,receipt,pid:process.pid}));
      try{
        for(const [file,bytes]of originals)assert.ok(fs.readFileSync(path.join(fixture,file)).equals(bytes),file);
        fs.unlinkSync(path.join(fixture,scope));
        assert.throws(()=>checkSS010({root:fixture,requireReady:false}),{code:'CURRENT_SCOPE_INVALID'});
        fs.writeFileSync(path.join(fixture,scope),originals.get(scope));
        fs.appendFileSync(path.join(fixture,history),'\nSynthetic unauthorized change\n');
        assert.throws(()=>checkSS010({root:fixture,requireReady:false}),{code:'CURRENT_EVIDENCE_HISTORY_INVALID'});
        // Both real refusal branches above are independent. The complete CLI
        // checks their wiring once, without repeating every unrelated scan.
        fs.unlinkSync(path.join(fixture,scope));
        const result = spawnSync(process.execPath, [path.join(runtimeRoot, 'app/server/scripts/validate-arch-006-rule-first-service-loop.mjs')], {
          cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 90_000,
        });
        fs.writeFileSync(path.join(receipt,'stdout.log'),result.stdout??'');fs.writeFileSync(path.join(receipt,'stderr.log'),result.stderr??'');
        assert.ifError(result.error);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.deepEqual(result.stderr.split(/\r?\n/u).filter(line=>line.startsWith('- ')).sort(),[
          '- current ADR-0045 structure and protected history are valid',
          '- historical Evidence is immutable; current receipts are append-only',
        ].sort());
        fs.writeFileSync(path.join(receipt,'refusals.json'),JSON.stringify({scope:'CURRENT_SCOPE_INVALID',history:'CURRENT_EVIDENCE_HISTORY_INVALID',cli_exit_code:result.status,cli_denials:2,original_files_written:false})+'\n');
      }finally{
        assert.equal(fs.lstatSync(dependencyLink).isSymbolicLink(),true);
        fs.rmSync(dependencyLink,{force:true});
      }
    });
  }finally{
    for(const [file,original]of originals)assert.ok(fs.readFileSync(path.join(sourceRoot,file)).equals(original),'original bytes remain unchanged: '+file);
    fs.writeFileSync(path.join(receipt,'original-files.json'),JSON.stringify({source_root:sourceRoot,scope_sha256:digest(fs.readFileSync(path.join(sourceRoot,scope))),history_sha256:digest(fs.readFileSync(path.join(sourceRoot,history))),original_bytes_unchanged:true})+'\n');
  }
});

test('machine state preserves ARCH-006 facts and separately authorized P2-015/P2-016 successor lifecycles', () => {
  const current = json('plans/current_phase.json');
  const backlog = json('plans/master_backlog.json');
  assert.equal(['P2-007', 'P2-015', 'P2-016', 'P2-012'].includes(current.last_completed_task), true);
  assert.equal(current.last_completed_gate, 'P2-G1');
  assert.equal(current.last_completed_architecture_task, 'ARCH-006');
  assert.equal(current.arch_005_status, 'DONE');
  assert.equal(current.arch_006_status, 'DONE');
  assert.equal(current.p2_007_status, 'DONE');
  assert.equal(current.p2_g1_status, 'PASSED');
  if (current.p2_015_status === 'AUTHORIZED') {
    assert.equal(current.active_task, 'P2-015'); assert.equal(current.active_lane, 'P2-C');
    assert.equal(current.next_task_candidate, 'P2-015'); assert.equal(current.next_task_authorized, true);
  } else if (['IN_PROGRESS','READY_FOR_LIVE_E2E'].includes(current.p2_g2_status)) {
    assert.equal(current.last_completed_task,'P2-012');assert.equal(current.p2_016_status,'DONE');
    assert.equal(current.active_task,'P2-G2');assert.equal(current.active_lane,'ASSEMBLY');
    assert.equal(current.next_task_candidate,current.p2_g2_status==='IN_PROGRESS'?'P2-G2':'P2-G2-LIVE');
    assert.equal(current.next_task_authorized,current.p2_g2_status==='IN_PROGRESS');
    assert.deepEqual(current.authorized_gates,['P2-G1','P2-G2']);
    assert.equal(current.authorized_tasks.includes('P2-G2'),false);
  } else if (current.p2_012_status==='DONE') {
    assert.equal(current.last_completed_task,'P2-012');assert.equal(current.p2_016_status,'DONE');
    assert.equal(current.active_task,null);assert.equal(current.active_lane,null);
    assert.equal(current.next_task_candidate,'P2-G2');assert.equal(current.next_task_authorized,false);
  } else if (['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION'].includes(current.p2_012_status)) {
    assert.equal(current.last_completed_task,'P2-016');assert.equal(current.p2_016_status,'DONE');
    assert.equal(current.active_task,'P2-012');assert.equal(current.active_lane,'P2-D');
    assert.equal(current.next_task_candidate,current.p2_012_status==='AUTHORIZED'?'P2-012':'P2-012-LIVE');
    assert.equal(current.next_task_authorized,current.p2_012_status==='AUTHORIZED');
  } else if (current.p2_016_status==='DONE') {
    assert.equal(current.last_completed_task,'P2-016');assert.equal(current.p2_015_status,'DONE');
    assert.equal(current.active_task,null);assert.equal(current.active_lane,null);
    assert.equal(current.next_task_candidate,'P2-012');assert.equal(current.next_task_authorized,false);
  } else if (['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION'].includes(current.p2_016_status)) {
    assert.equal(current.p2_015_status,'DONE');assert.equal(current.last_completed_task,'P2-015');
    assert.equal(current.active_task,'P2-016');assert.equal(current.active_lane,'P2-B');
    assert.equal(current.next_task_candidate,'P2-016');assert.equal(current.next_task_authorized,true);
  } else {
    assert.equal(current.p2_015_status, 'DONE'); assert.equal(current.active_task, null); assert.equal(current.active_lane, null);
    assert.equal(current.next_task_candidate, 'P2-016'); assert.equal(current.next_task_authorized, false);
  }
  for (const id of ['P2-016', 'P2-012']) {
    const task = backlog.tasks.find((entry) => entry.id === id);
    if(id==='P2-016'&&['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION','DONE'].includes(current.p2_016_status)){
      assert.equal(task.status,current.p2_016_status);assert.equal(task.authorization_status,'AUTHORIZED');continue;
    }
    if(id==='P2-012'&&['AUTHORIZED','READY_FOR_TARGETED_LIVE_VALIDATION','DONE'].includes(current.p2_012_status)){assert.equal(task.status,current.p2_012_status);assert.equal(task.authorization_status,'AUTHORIZED');continue;}
    assert.equal(task.status, 'TODO');
    assert.equal(task.authorization_status, 'REQUIRES_SEPARATE_AUTHORIZATION');
  }
  assert.equal(backlog.tasks.find((entry) => entry.id === 'P2-008').authorization_status, 'BLOCKED_BY_P2_G2');
});

test('ten safe deterministic results are first-class and Manual Review is valid', () => {
  const contract = text('docs/51_rule_first_intake_manual_review.md');
  for (const result of ['TICKET_ELIGIBLE', 'NEEDS_DESCRIPTION', 'MANUAL_REVIEW_REQUIRED', 'RELATED_FOLLOW_UP', 'STATUS_QUERY', 'SERVICE_REQUEST', 'BUSINESS_CONSULTATION', 'ACKNOWLEDGEMENT', 'OUT_OF_SCOPE', 'INCIDENT_REVIEW_CANDIDATE']) {
    assert.match(contract, new RegExp('`' + result + '`', 'u'));
  }
  assert.match(contract, /不得静默忽略/u);
  assert.match(contract, /每次只问一个高信息量问题/u);
  assert.match(contract, /不自动关闭 Ticket/u);
  assert.match(contract, /不调用外部天气或其他服务/u);
});

test('Ticket lifecycle reuses authoritative actions and reliable notification boundary', () => {
  const contract = text('docs/52_full_ticket_lifecycle_workbench_notifications.md');
  for (const action of ['queue', 'accept', 'start', 'request-information', 'resume', 'wait-vendor', 'resolve', 'confirm', 'reopen', 'cancel', 'auto-close', 'add-note']) assert.match(contract, new RegExp(action, 'u'));
  assert.match(contract, /TicketActionService/u);
  assert.match(contract, /Ticket Event[\s\S]*Notification Policy[\s\S]*Communication Message[\s\S]*Outbox[\s\S]*Delivery[\s\S]*WeCom Sender/u);
  assert.match(contract, /Conversation Assignment[\s\S]*Ticket Assignment/u);
  assert.match(contract, /全部成功或全部失败/u);
  assert.match(contract, /发送失败不回滚 Ticket/u);
});

test('Incident remains human-confirmed and AI-independent', () => {
  const contract = text('docs/53_human_confirmed_incident_before_ai.md');
  assert.match(contract, /P2-007 只产生 `INCIDENT_REVIEW_CANDIDATE`/u);
  assert.match(contract, /自动创建 Incident/u);
  assert.match(contract, /模型调用必须为 0/u);
  assert.match(contract, /错误关联必须可 unlink/u);
  assert.match(contract, /一名用户恢复只更新其个人 Report\/Subscription，不关闭共享 Incident，也不改变 Ticket/u);
});

test('AI-off readiness and feature flags are closed by default', () => {
  const parallel = json('plans/parallel_workstreams.json');
  const gate = text('docs/54_p2_g2_deterministic_full_service_loop_gate.md');
  assert.deepEqual(parallel.feature_flags_enabled, []);
  assert.equal(Object.values(parallel.feature_flag_defaults).every((value) => value === false), true);
  for (const flag of ['RULE_FIRST_ORCHESTRATION_ENABLED', 'MANUAL_REVIEW_QUEUE_ENABLED', 'TICKET_LIFECYCLE_WORKBENCH_ENABLED', 'REPORTER_TIMELINE_ENABLED', 'WECOM_TEMPLATE_CARD_ENABLED', 'INCIDENT_CORRELATION_ENABLED']) {
    assert.equal(parallel.feature_flag_defaults[flag], false);
  }
  assert.match(gate, /base_service_ready=true/u);
  assert.match(gate, /DeepSeek Key 不存在/u);
  assert.match(gate, /模型网络不可达/u);
  assert.match(gate, /model_provider_calls = 0/u);
});
