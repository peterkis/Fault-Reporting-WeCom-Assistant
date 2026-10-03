import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { testRoots } from './helpers/migration-roots.mjs';
import { CURRENT_YXX_SCOPE, readCurrentYxxScope } from '../src/yxx-current-readiness-scope.mjs';
import { checkSS010 } from '../src/yxx-self-service-readiness.mjs';
import { withScopeCheckout } from './helpers/yxx-current-scope-checkout.mjs';
import { CURRENT_YXX_POINTER, readCurrentYxxReport, verifyCurrentYxxReportBinding } from '../src/yxx-current-evidence.mjs';
import { g2CandidateInventory } from '../src/p2-g2-candidate.mjs';

test('current readiness public API resolves its source root when called from compiled runtime', () => {
  assert.equal(checkSS010().status, 'STRUCTURE_VALID_NOT_READY');
});

test('current strict readiness distinguishes a malformed current pointer from absent evidence', () => {
  withScopeCheckout(root => {
    rmSync(path.join(root, CURRENT_YXX_POINTER), { force: true });
    assert.throws(() => checkSS010({ root, requireReady: true }), { code: 'CURRENT_EVIDENCE_REQUIRED' });
    writeFileSync(path.join(root, CURRENT_YXX_POINTER), '{}\n');
    assert.throws(() => checkSS010({ root, requireReady: true }), { code: 'CURRENT_EVIDENCE_INVALID' });
  });
});

test('current report reading preserves raw bytes and rejects corrupted missing and escaped references', () => {
  const root=mkdtempSync(path.join(tmpdir(),'yxx-current-report-'));
  try{
    mkdirSync(path.join(root,'plans'));mkdirSync(path.join(root,'evidence/yxx-current-fixture'),{recursive:true});
    const relative='evidence/yxx-current-fixture/report.json',file=path.join(root,relative);
    const bytes=Buffer.from('{"synthetic_reader_fixture":true}\r\n');writeFileSync(file,bytes);
    const ref={path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    const pointer=(report:unknown):void=>writeFileSync(path.join(root,CURRENT_YXX_POINTER),JSON.stringify({schema_version:1,report}));
    pointer(ref);assert.deepEqual(readCurrentYxxReport(root).report,{synthetic_reader_fixture:true});
    for(const report of [{...ref,bytes:ref.bytes+1},{...ref,sha256:'0'.repeat(64)},
      {...ref,path:'evidence/yxx-ss-010-report.json'},{...ref,path:'evidence/yxx-current-fixture/../report.json'},
      {...ref,path:'evidence/yxx-current-missing/report.json'}]){
      pointer(report);assert.throws(()=>readCurrentYxxReport(root),{code:'CURRENT_EVIDENCE_INVALID'});
    }
    pointer(ref);writeFileSync(file,bytes.toString('utf8').replaceAll('\r\n','\n'));
    assert.throws(()=>readCurrentYxxReport(root),{code:'CURRENT_EVIDENCE_INVALID'});
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('yxx-current-report-'));
    rmSync(root,{recursive:true,force:true});
  }
});

test('current raw evidence survives Git checkout without newline conversion', () => {
  withScopeCheckout(root=>{
    copyFileSync(path.join(testRoots().sourceRoot,'.gitattributes'),path.join(root,'.gitattributes'));
    const relative='evidence/yxx-current-fixture/report.json',bytes=Buffer.from('{"synthetic_reader_fixture":true}\r\n');
    mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});writeFileSync(path.join(root,relative),bytes);
    writeFileSync(path.join(root,CURRENT_YXX_POINTER),JSON.stringify({schema_version:1,report:{path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}));
    execFileSync('git',['-c','core.autocrlf=true','add','--',relative],{cwd:root,windowsHide:true,stdio:'pipe'});
    execFileSync('git',['-c','core.autocrlf=false','checkout-index','--force','--',relative],{cwd:root,windowsHide:true,stdio:'pipe'});
    assert.deepEqual(readCurrentYxxReport(root).report,{synthetic_reader_fixture:true});
  });
});

test('current strict readiness rejects a report bound to another candidate', () => {
  withScopeCheckout(root => {
    const git=(args:string[]):string=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
    const digest=(text:string):string=>createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');
    const report={schema_version:1,contract:'ADR-0027',run_id:'fixture',tested_head:git(['rev-parse','HEAD']),
      tested_tree:git(['rev-parse','HEAD^{tree}']),candidate_fingerprint:g2CandidateInventory(root).fingerprint,
      scope_sha256:digest(readFileSync(path.join(root,CURRENT_YXX_SCOPE),'utf8')),
      acceptance_sha256:digest(readFileSync(path.join(root,'plans/yxx-current-readiness-acceptance.json'),'utf8'))};
    const relative='evidence/yxx-current-fixture/report.json';mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});
    const publish=(value:unknown):void=>{
      const bytes=Buffer.from(JSON.stringify(value));writeFileSync(path.join(root,relative),bytes);
      writeFileSync(path.join(root,CURRENT_YXX_POINTER),JSON.stringify({schema_version:1,report:{path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}));
    };
    publish({...report,candidate_fingerprint:'0'.repeat(64)});
    assert.throws(()=>checkSS010({root,requireReady:true}),{code:'CURRENT_CANDIDATE_MISMATCH'});
    publish(report);
    assert.throws(()=>checkSS010({root,requireReady:true}),{code:'CURRENT_EVIDENCE_INCOMPLETE'});
    const orphan=git(['-c','user.name=Synthetic Fixture','-c','user.email=fixture@example.invalid',
      '-c','commit.gpgsign=false','commit-tree',report.tested_tree,'-m','synthetic non-ancestor negative control']);
    for(const changed of [{...report,tested_tree:'0'.repeat(40)},{...report,scope_sha256:'0'.repeat(64)},
      {...report,acceptance_sha256:'0'.repeat(64)},{...report,tested_head:orphan},
      {...report,tested_head:'562a96ffdd7148d729ab0eed9d215abe894f12c2',tested_tree:'fc20b1021291aca44b45ba3be461423a61bcee48'}]){
      publish(changed);
      assert.throws(()=>verifyCurrentYxxReportBinding(root,readCurrentYxxReport(root).report),{code:'CURRENT_CANDIDATE_MISMATCH'});
    }
  });
});







test('current scope rejects enabling AI in the checked default configuration', () => {
  withScopeCheckout(root => {
    assert.equal(readCurrentYxxScope(root).live_authorized, false);
    const file = path.join(root, '.env.example'), original = readFileSync(file, 'utf8');
    assert.ok(original.includes('AI_AUTO_REPLY_ENABLED=false'));
    writeFileSync(file, original.replace('AI_AUTO_REPLY_ENABLED=false', 'AI_AUTO_REPLY_ENABLED=true'));
    assert.throws(() => readCurrentYxxScope(root), { code: 'CURRENT_SCOPE_INVALID' });
  });
});

test('current scope keeps SQL content and inventory pinned even when a local manifest is edited', () => {
  withScopeCheckout(root => {
    assert.equal(readCurrentYxxScope(root).migration_files.length, 22);
    const file = path.join(root, 'database/migrations/035_p2_016_workbench_wecom_auth.sql');
    const original = readFileSync(file), changed = Buffer.concat([original, Buffer.from('\n-- unapproved SQL change\n')]);
    const hash = (bytes: Buffer): string => createHash('sha256').update(bytes.toString('utf8').replaceAll('\r\n', '\n')).digest('hex');
    const scopeFile = path.join(root, CURRENT_YXX_SCOPE), scope = readFileSync(scopeFile, 'utf8');
    const rewritten = scope.replace(hash(original), hash(changed));
    assert.notEqual(rewritten, scope);
    writeFileSync(file, changed); writeFileSync(scopeFile, rewritten);
    assert.throws(() => readCurrentYxxScope(root), { code: 'CURRENT_SCOPE_INVALID' });
    writeFileSync(file, original); writeFileSync(scopeFile, scope);
    writeFileSync(path.join(root, 'database/migrations/037_unapproved.sql'), 'SELECT 1;\n');
    assert.throws(() => readCurrentYxxScope(root), { code: 'CURRENT_SCOPE_INVALID' });
  });
});

test('current scope rejects protected stage changes and SQL file mode changes', () => {
  withScopeCheckout(root => {
    const file = path.join(root, 'plans/current_phase.json'), original = readFileSync(file);
    writeFileSync(file, Buffer.concat([original, Buffer.from('\nUNAPPROVED_PHASE_CHANGE\n')]));
    assert.throws(() => readCurrentYxxScope(root), { code: 'CURRENT_SCOPE_INVALID' });
    writeFileSync(file, original);
    execFileSync('git', ['update-index', '--chmod=+x', 'database/migrations/035_p2_016_workbench_wecom_auth.sql'], {
      cwd: root, windowsHide: true, stdio: 'pipe',
    });
    assert.throws(() => readCurrentYxxScope(root), { code: 'CURRENT_SCOPE_INVALID' });
  });
});
