import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { testRoots } from './helpers/migration-roots.mjs';
import { CURRENT_YXX_SCOPE, readCurrentYxxScope } from '../src/yxx-current-readiness-scope.mjs';
import { checkSS010 } from '../src/yxx-self-service-readiness.mjs';
import { verifyCurrentYxxEvidenceHistory } from '../src/yxx-current-evidence-history.mjs';
import { CURRENT_YXX_POINTER, readCurrentYxxReport, verifyCurrentYxxReportBinding } from '../src/yxx-current-evidence.mjs';
import { g2CandidateInventory } from '../src/p2-g2-candidate.mjs';

test('current readiness public API resolves its source root when called from compiled runtime', () => {
  assert.equal(checkSS010().status, 'STRUCTURE_VALID_NOT_READY');
  assert.throws(() => checkSS010({ requireReady: true }), { code: 'CURRENT_EVIDENCE_REQUIRED' });
});

test('current strict readiness distinguishes a malformed current pointer from absent evidence', () => {
  withScopeCheckout(root => {
    writeFileSync(path.join(root, 'plans/yxx-current-readiness.json'), '{}\n');
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

test('current readiness rejects a later working-tree rewrite of the adjudicated G0 path', () => {
  withScopeCheckout(root => {
    assert.equal(checkSS010({ root }).status, 'STRUCTURE_VALID_NOT_READY');
    const file = path.join(root, 'evidence/g0-005-active-push-matrix.md');
    writeFileSync(file, readFileSync(file, 'utf8') + '\nUNAPPROVED_LATER_CHANGE\n');
    assert.throws(() => checkSS010({ root }), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

test('current readiness rejects committed evidence rewrite followed by restoration', () => {
  withScopeCheckout(root => {
    const git = (args: string[]): void => { execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' }); };
    const relative = 'evidence/g0-005-active-push-matrix.md', file = path.join(root, relative), original = readFileSync(file);
    const commit = (): void => {
      git(['add', '--', relative]);
      git(['-c', 'user.name=Readiness Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic evidence change']);
    };
    writeFileSync(file, Buffer.concat([original, Buffer.from('\nUNAPPROVED_COMMITTED_CHANGE\n')])); commit();
    writeFileSync(file, original); commit();
    assert.throws(() => checkSS010({ root }), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

test('current evidence history checks a rewritten side branch even when an ours merge hides its contents', () => {
  withScopeCheckout(root => {
    const git = (args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
    const base = git(['rev-parse', 'HEAD']);
    const identity = ['-c', 'user.name=Readiness Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false'];
    const relative = 'evidence/g0-005-active-push-matrix.md';
    writeFileSync(path.join(root, relative), readFileSync(path.join(root, relative), 'utf8') + '\nHIDDEN_SIDE_REWRITE\n');
    git(['add', '--', relative]); git([...identity, 'commit', '-m', 'synthetic side rewrite']);
    const side = git(['rev-parse', 'HEAD']);
    git(['checkout', '--detach', base]);
    git([...identity, 'commit', '--allow-empty', '-m', 'synthetic main side']);
    git([...identity, 'merge', '--no-ff', '-s', 'ours', side, '-m', 'synthetic hidden side merge']);
    assert.throws(() => verifyCurrentYxxEvidenceHistory(root), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

test('current evidence history accepts a new immutable receipt and rejects its deletion or indexed mode change', () => {
  withScopeCheckout(root => {
    const git = (args: string[]): void => { execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' }); };
    const relative = 'evidence/yxx-current-synthetic-receipt.json', file = path.join(root, relative);
    writeFileSync(file, '{"fixture":true}\n'); git(['add', '--', relative]);
    git(['-c', 'user.name=Readiness Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'synthetic new receipt']);
    verifyCurrentYxxEvidenceHistory(root);
    git(['update-index', '--chmod=+x', relative]);
    assert.throws(() => verifyCurrentYxxEvidenceHistory(root), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
    git(['update-index', '--chmod=-x', relative]); rmSync(file);
    assert.throws(() => verifyCurrentYxxEvidenceHistory(root), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

test('current evidence history rejects expanding the precise adjudication record', () => {
  withScopeCheckout(root => {
    const file = path.join(root, '.github/review/yxx-current-evidence-adjudication.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"does_not_authorize_future_changes": true', '"does_not_authorize_future_changes": false'));
    assert.throws(() => verifyCurrentYxxEvidenceHistory(root), { code: 'CURRENT_EVIDENCE_HISTORY_INVALID' });
  });
});

function withScopeCheckout(run: (root: string) => void): void {
  const source = testRoots().sourceRoot;
  const temporary = mkdtempSync(path.join(tmpdir(), 'yxx-current-scope-'));
  const git = (args: string[]): void => { execFileSync('git', args, { cwd: source, windowsHide: true, stdio: 'pipe' }); };
  let attached = false;
  try {
    git(['worktree', 'add', '--detach', temporary, 'HEAD']); attached = true;
    copyFileSync(path.join(source, CURRENT_YXX_SCOPE), path.join(temporary, CURRENT_YXX_SCOPE));
    run(temporary);
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('yxx-current-scope-'));
    if (attached) git(['worktree', 'remove', '--force', temporary]);
    else rmSync(temporary, { recursive: true, force: true });
  }
}

test('current readiness CLI rejects unknown arguments with a safe actionable reason', () => {
  const roots = testRoots();
  const result = spawnSync(process.execPath, [path.join(roots.runtimeRoot, 'scripts/yxx-self-service-readiness.mjs'), '--not-a-readiness-option'], {
    cwd: roots.sourceRoot, encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false, error_code: 'SS010_NOT_READY', stage: 'ARGUMENTS', reason_code: 'ARGUMENT_INVALID', live_authorized: false,
  });
});

test('current readiness CLI validates the accepted successor structure without claiming readiness', () => {
  const roots = testRoots();
  const result = spawnSync(process.execPath, [path.join(roots.runtimeRoot, 'scripts/yxx-self-service-readiness.mjs')], {
    cwd: roots.sourceRoot, encoding: 'utf8', windowsHide: true, timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const value: unknown = JSON.parse(result.stdout);
  assert.ok(value && typeof value === 'object' && 'status' in value && 'live_authorized' in value);
  assert.equal(value.status, 'STRUCTURE_VALID_NOT_READY');
  assert.equal(value.live_authorized, false);
});

test('current readiness CLI requires current evidence instead of inheriting historical readiness', () => {
  const roots = testRoots();
  const result = spawnSync(process.execPath, [path.join(roots.runtimeRoot, 'scripts/yxx-self-service-readiness.mjs'), '--require-ready'], {
    cwd: roots.sourceRoot, encoding: 'utf8', windowsHide: true, timeout: 60_000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false, error_code: 'SS010_NOT_READY', stage: 'EVIDENCE', reason_code: 'CURRENT_EVIDENCE_REQUIRED', live_authorized: false,
  });
});

test('current readiness CLI distinguishes a missing build from evidence or historical rejection', () => {
  const roots = testRoots();
  const temporary = mkdtempSync(path.join(tmpdir(), 'yxx-current-build-'));
  try {
    mkdirSync(path.join(temporary, 'scripts'));
    copyFileSync(path.join(roots.runtimeRoot, 'scripts/yxx-self-service-readiness.mjs'), path.join(temporary, 'scripts/yxx-self-service-readiness.mjs'));
    const result = spawnSync(process.execPath, ['scripts/yxx-self-service-readiness.mjs', '--require-ready'], {
      cwd: temporary, encoding: 'utf8', windowsHide: true, timeout: 15_000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false, error_code: 'SS010_NOT_READY', stage: 'BUILD', reason_code: 'CURRENT_BUILD_INVALID', live_authorized: false,
    });
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('yxx-current-build-'));
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('current readiness CLI rejects builds predating a scope or historical adjudication control change', () => {
  const roots = testRoots();
  for (const relative of ['plans/yxx-current-readiness-scope.json', '.github/review/pr21-evidence-exceptions.json', '.github/review/yxx-current-evidence-adjudication.json', 'plans/yxx-current-readiness-acceptance.json', '.gitattributes', '.github/review/pr-evidence-delta.test.mjs', '.github/review/verify-published-history.test.mjs', '.github/review/pr-evidence-delta.mjs', '.github/review/verify-published-history.mjs']) {
    const file = path.join(roots.sourceRoot, relative), original = readFileSync(file);
    try {
      writeFileSync(file, Buffer.concat([original, Buffer.from('\n')]));
      const result = spawnSync(process.execPath, [path.join(roots.runtimeRoot, 'scripts/yxx-self-service-readiness.mjs')], {
        cwd: roots.sourceRoot, encoding: 'utf8', windowsHide: true, timeout: 60_000,
      });
      assert.equal(result.status, 1, relative + ': ' + result.stdout);
      assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), {
        ok: false, error_code: 'SS010_NOT_READY', stage: 'BUILD', reason_code: 'CURRENT_BUILD_INVALID', live_authorized: false,
      });
    } finally {
      writeFileSync(file, original);
      assert.ok(readFileSync(file).equals(original));
    }
  }
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

test('current readiness structural checking remains offline and never starts business processes', () => {
  const roots = testRoots(), temporary = mkdtempSync(path.join(tmpdir(), 'yxx-current-offline-'));
  try {
    const hook = path.join(temporary, 'guard.mjs');
    writeFileSync(hook, "import net from 'node:net';import cp from 'node:child_process';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';const fail=()=>{throw Error('FORBIDDEN_RUNTIME_IO');};net.Socket.prototype.connect=fail;net.Server.prototype.listen=fail;cp.fork=fail;cp.spawn=fail;cp.exec=fail;cp.execSync=fail;globalThis.fetch=fail;for(const name of ['execFileSync','spawnSync']){const original=cp[name];cp[name]=(file,...args)=>{if(path.basename(String(file)).toLowerCase()!=='git'&&path.basename(String(file)).toLowerCase()!=='git.exe')fail();return original(file,...args);};}syncBuiltinESMExports();");
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, path.join(roots.runtimeRoot, 'scripts/yxx-self-service-readiness.mjs')], {
      cwd: roots.sourceRoot, encoding: 'utf8', windowsHide: true, timeout: 60_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const value: unknown = JSON.parse(result.stdout);
    assert.ok(value && typeof value === 'object' && 'database_connections' in value && 'provider_calls' in value && 'listener_started' in value);
    assert.equal(value.database_connections, 0); assert.equal(value.provider_calls, 0); assert.equal(value.listener_started, false);
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('yxx-current-offline-'));
    rmSync(temporary, { recursive: true, force: true });
  }
});
