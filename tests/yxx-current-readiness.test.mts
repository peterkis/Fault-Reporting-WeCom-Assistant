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

test('current readiness public API resolves its source root when called from compiled runtime', () => {
  assert.equal(checkSS010().status, 'STRUCTURE_VALID_NOT_READY');
  assert.throws(() => checkSS010({ requireReady: true }), { code: 'CURRENT_EVIDENCE_REQUIRED' });
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
  for (const relative of ['plans/yxx-current-readiness-scope.json', '.github/review/pr21-evidence-exceptions.json', '.github/review/yxx-current-evidence-adjudication.json', 'plans/yxx-current-readiness-acceptance.json']) {
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
