import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { testRoots } from './helpers/migration-roots.mjs';
import { checkSS010 } from '../src/yxx-self-service-readiness.mjs';
import { g2CandidateInventory } from '../src/p2-g2-candidate.mjs';

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

test('current readiness CLI reports the current evidence decision before and after publication', () => {
  const roots = testRoots();
  let expected: ReturnType<typeof checkSS010> | undefined;
  let refusal: string | undefined;
  try { expected = checkSS010({ root: roots.sourceRoot, requireReady: true }); }
  catch (error) {
    assert.ok(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string');
    refusal = error.code;
  }
  const result = spawnSync(process.execPath, [path.join(roots.runtimeRoot, 'scripts/yxx-self-service-readiness.mjs'), '--require-ready'], {
    cwd: roots.sourceRoot, encoding: 'utf8', windowsHide: true, timeout: 60_000,
  });
  assert.equal(result.stderr, '');
  if (expected) {
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), expected);
    assert.equal(expected.status, 'READY_FOR_LIMITED_WRITE_LIVE');
    assert.equal(expected.live_authorized, false);
    assert.equal(expected.parent_gate_advanced, false);
  } else {
    assert.equal(result.status, 1);
    const actual: unknown = JSON.parse(result.stdout);
    assert.ok(actual && typeof actual === 'object' && 'reason_code' in actual && 'live_authorized' in actual && 'error_code' in actual);
    assert.equal(actual.reason_code, refusal);
    assert.equal(actual.error_code, 'SS010_NOT_READY');
    assert.equal(actual.live_authorized, false);
  }
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
  for (const relative of ['plans/yxx-current-readiness-scope.json', '.github/review/pr21-evidence-exceptions.json', '.github/review/yxx-current-evidence-adjudication.json', 'plans/yxx-current-readiness-acceptance.json', 'plans/yxx-ss-009-acceptance.json', '.gitattributes', '.github/review/pr-evidence-delta.test.mjs', '.github/review/verify-published-history.test.mjs', '.github/review/pr-evidence-delta.mjs', '.github/review/verify-published-history.mjs']) {
    const file = path.join(roots.sourceRoot, relative), original = readFileSync(file);
    const fingerprint = g2CandidateInventory(roots.sourceRoot).fingerprint;
    try {
      writeFileSync(file, Buffer.concat([original, Buffer.from('\n')]));
      assert.notEqual(g2CandidateInventory(roots.sourceRoot).fingerprint, fingerprint, relative);
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
