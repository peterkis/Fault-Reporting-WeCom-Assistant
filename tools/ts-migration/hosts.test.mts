import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRoutes, select, expandPatterns, testEnvironment, execution, type Entry } from './routing.mjs';
import { sourceRoot, workspaceFiles, record } from './common.mjs';
import { build } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { counts } from './run-tests.mjs';
const original = sourceRoot();
function scratch(): string {
  const root=mkdtempSync(path.join(tmpdir(),'t02-host-test-'));
  execFileSync('git',['clone','--quiet','--no-hardlinks',original,root],{windowsHide:true,stdio:'pipe'});
  for(const relative of workspaceFiles(original)){const target=path.join(root,relative);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(original,relative),target);}
  symlinkSync(path.join(original,'node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  return root;
}
function alter(root:string,relative:string,text:string,fn:()=>void):void{
  const p=path.join(root,relative),old=existsSync(p)?readFileSync(p):null;mkdirSync(path.dirname(p),{recursive:true});writeFileSync(p,text);
  try{fn();}finally{if(old)writeFileSync(p,old);else rmSync(p);}
}
test('T02 routes, actual roots and candidate coverage reject invalid inputs',async t=>{
 const root=scratch();
 try{
  const routes=loadRoutes(root), raw=readFileSync(path.join(root,'plans/typescript-migration/test-routing.json'),'utf8');
  await t.test('all legacy entries and aliases remain represented',()=>{assert.equal(routes.entries.length,208);assert.equal(Object.keys(routes.aliases).length,72);assert.equal(select(routes,'selection','t02-baseline').entries.length,17);});
  await t.test('wildcards expand deterministically and empty matches fail',()=>{
    const selected=select(routes,'alias','test:p2:007');assert.equal(selected.entries.length,7);
    const one=expandPatterns(['tests/p2-007-*.test.mjs'],routes.entries);assert.deepEqual(one,expandPatterns(['tests/p2-007-*.test.mjs'],[...routes.entries].reverse()));
    assert.throws(()=>expandPatterns(['tests/absent-*.test.mjs'],routes.entries),/EMPTY_TEST_PATTERN/u);
  });
  await t.test('removed, duplicate and unregistered tests are rejected',()=>{
    const doc=record(JSON.parse(raw) as unknown);assert.ok(Array.isArray(doc.entries));
    for(const entries of [doc.entries.slice(1),[...doc.entries,doc.entries[0]]])alter(root,'plans/typescript-migration/test-routing.json',JSON.stringify({...doc,entries}),()=>assert.throws(()=>loadRoutes(root),/INVENTORY/u));
    alter(root,'tests/missing-route.test.mts','export {};',()=>assert.throws(()=>loadRoutes(root),/INVENTORY/u));
  });
  await t.test('original command arguments cannot be weakened by editing the route',()=>{
    const doc=record(JSON.parse(raw) as unknown),aliases=record(doc.legacy_commands),spec=record(aliases['test:p2:003:integration']);
    alter(root,'plans/typescript-migration/test-routing.json',JSON.stringify({...doc,legacy_commands:{...aliases,'test:p2:003:integration':{...spec,node_flags:[]}}}),()=>assert.throws(()=>loadRoutes(root),/ALIAS_SELECTION_DRIFT/u));
    const {[ 'test:p2:003:integration' ]: ignored,...rest}=aliases;void ignored;
    alter(root,'plans/typescript-migration/test-routing.json',JSON.stringify({...doc,legacy_commands:rest}),()=>assert.throws(()=>loadRoutes(root),/ALIAS_INVENTORY/u));
  });
  const db=routes.entries.filter(e=>e.requires_database);
  await t.test('database tests fail closed before test launch',()=>{
    assert.throws(()=>testEnvironment(root,db,{}),/ISOLATED_DATABASE/u);
    assert.throws(()=>testEnvironment(root,db,{TS_MIGRATION_TEST_DB_ISOLATED:'1',PILOT_DATABASE_URL:'postgres://synthetic@production.invalid/test'}),/NOT_LOOPBACK/u);
    const env=testEnvironment(root,db,{PATH:'synthetic',NODE_OPTIONS:'--require bad',WECOM_BOT_SECRET:'not-inherited',TS_MIGRATION_TEST_DB_ISOLATED:'1',PILOT_DATABASE_URL:'postgres://synthetic@127.0.0.1/migration_ci'});
    assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.WECOM_BOT_SECRET,undefined);assert.ok(env.PILOT_DATABASE_URL);
  });
  build(root);const digest=verifyArtifact(root);
  await t.test('runtime path is an artifact, source path is the real checkout',()=>{
    const staged=select(routes,'selection','canary').entries[0];assert.ok(staged);
    assert.equal(execution(root,staged).file,path.join(root,'.build/runtime/tests/migration-canary.test.mjs'));
    const source=routes.entries.find(e=>e.mode==='SOURCE_HOST');assert.ok(source);
    assert.equal(execution(root,source).cwd,root);
    assert.throws(()=>execution(root,staged,true),/NO_SOURCE_REFERENCE/u);
  });
  await t.test('missing compiled output never falls back to source',()=>{
    const e=select(routes,'selection','canary').entries[0];assert.ok(e);const p=path.join(root,'.build/runtime/tests/migration-canary.test.mjs'),bytes=readFileSync(p);rmSync(p);
    try{assert.throws(()=>execution(root,e));}finally{writeFileSync(p,bytes);}
  });
  await t.test('incomplete, skipped and failed TAP are not transformed into passing counts',()=>{
    assert.throws(()=>counts(''),/INCOMPLETE/u);
    assert.equal(counts('# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n').skipped,1);
  });
  await t.test('SQL resource and routing changes invalidate the existing build',()=>{
    for(const p of ['database/migrations/036_p2_007_third_party_staff_directory.sql','plans/typescript-migration/test-routing.json']){
      assert.ok(existsSync(path.join(root,p)),p);
      alter(root,p,readFileSync(path.join(root,p),'utf8')+'\n',()=>assert.throws(()=>verifyArtifact(root,digest),/INPUT_DRIFT/u));
    }
  });
  await t.test('current source guards still reject substantive violations in MTS',()=>{
    alter(root,'src/migration-business-violation.mts',"import pg from 'pg'; const pool = new Pool(); export {pool};",()=>{
      const result=spawnSync(process.execPath,['scripts/validate-arch-005-time-contract.mjs'],{cwd:root,encoding:'utf8',windowsHide:true});
      assert.equal(result.status,1);assert.match(result.stdout,/ARCH_005_DIRECT_PG_FACTORY_BYPASS:src\/migration-business-violation.mts/u);
    });
  });
  await t.test('candidate binds MTS, declaration and build-control bytes',()=>{
    const probe="import {g2CandidateInventory} from './src/p2-g2-candidate.mjs'; console.log(g2CandidateInventory().fingerprint);";
    const fingerprint=()=>execFileSync(process.execPath,['--input-type=module','-e',probe],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
    const before=fingerprint();
    for(const p of ['src/migration-canary.mts','tests/types/contracts.mts','contracts/time_contracts.d.ts','tsconfig.type-tests.json','tools/ts-migration/resources.json'])alter(root,p,readFileSync(path.join(root,p),'utf8')+'\n// synthetic change',()=>assert.notEqual(fingerprint(),before));
  });
  await t.test('browser discovery rejects missing explicit path and retains platform candidates',()=>{
    const code="import assert from 'node:assert/strict'; import {findSystemBrowser,systemBrowserCandidates} from './tests/helpers/p2-006-browser-harness.mjs'; assert.ok(systemBrowserCandidates.some(p=>p.startsWith('/usr/bin/'))); assert.ok(systemBrowserCandidates.some(p=>p.startsWith('C:'))); assert.throws(()=>findSystemBrowser({executable:'relative invalid'}),/EXPLICIT_BROWSER_INVALID/); assert.throws(()=>findSystemBrowser({candidates:[]}),/SYSTEM_EDGE_OR_CHROME_REQUIRED/); console.log('PASS');";
    assert.match(execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:root,encoding:'utf8',windowsHide:true}),/PASS/u);
  });
 }finally{rmSync(root,{recursive:true,force:true});}
});
