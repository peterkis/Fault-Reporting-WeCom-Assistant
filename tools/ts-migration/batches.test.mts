import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { testEnvironment } from './routing.mjs';
import { batchSelection } from './batches.mjs';
import { record, sourceRoot, workspaceFiles } from './common.mjs';

const original = sourceRoot();
test('batch selection includes every T03 reverse dependency and the personnel baseline', () => {
  const selected = batchSelection(original, 'T03-01');
  assert.ok(selected.entries.length >= 166);
  for (const name of ['tests/platform-postgres-time.integration.test.mjs', 'tests/yxx-ss-009-evidence.test.mjs', 'tests/p2-007-third-party-staff-directory.integration.test.mjs']) assert.ok(selected.entries.some(e => e.path === name));
  assert.throws(() => batchSelection(original, 'unknown'), /UNKNOWN_BATCH/u);
});

test('batch CLI runs non-canary tests and reports failure without certifying review', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-batch-test-'));
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', original, root], { windowsHide: true, stdio: 'pipe' });
  for (const relative of workspaceFiles(original)) {
    const target = path.join(root, relative); mkdirSync(path.dirname(target), { recursive: true }); copyFileSync(path.join(original, relative), target);
  }
  symlinkSync(path.join(original, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  execFileSync(process.execPath, ['--experimental-strip-types', 'tools/ts-migration/bootstrap.mts'], { cwd: root, windowsHide: true, stdio: 'pipe' });
  const file = 'tests/platform-time-contract.test.mjs';
  const registry = path.join(root, 'plans/typescript-migration/batches.json');
  const doc = record(JSON.parse(readFileSync(registry, 'utf8')) as unknown);
  assert.ok(Array.isArray(doc.batches));
  const batch = record(doc.batches[0]);
  const fixture = { ...batch, direct_tests: [file], impacted_tests: [file], baseline_tests: [file], supplemental_tests: [] };
  const setBatch = (value: unknown): void => writeFileSync(registry, JSON.stringify({ schema_version: 1, batches: [value] }));
  await t.test('empty and unregistered selections fail closed', () => {
    setBatch({ ...fixture, impacted_tests: [] }); assert.throws(() => batchSelection(root, 'T03-01'), /EMPTY_BATCH/u);
    setBatch({ ...fixture, impacted_tests: ['tests/absent.test.mjs'] }); assert.throws(() => batchSelection(root, 'T03-01'), /UNKNOWN_TEST/u);
  });
  setBatch(fixture);
  for (const scenario of ['pass', 'fail', 'skip'] as const) await t.test(scenario, () => {
    writeFileSync(path.join(root, file), `import {test} from 'node:test'; import assert from 'node:assert/strict'; test('real batch probe', {skip:${scenario === 'skip'}},()=>assert.equal(1,${scenario === 'fail' ? 2 : 1}));\n`);
    const report = mkdtempSync(path.join(tmpdir(), 'migration-batch-report-'));
    const run = spawnSync(process.execPath, [path.join(original, '.build/tools/gate.mjs'), '--batch', 'T03-01', '--report-dir', report], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180_000 });
    assert.equal(run.status, scenario === 'pass' ? 0 : 1, run.stderr);
    const summary = record(JSON.parse(readFileSync(path.join(report, 'tests/summary.json'), 'utf8')) as unknown);
    assert.deepEqual(summary.selected_files, [file]); assert.deepEqual(summary.not_run, []);
    const receipt = record(JSON.parse(readFileSync(path.join(report, 'batch.json'), 'utf8')) as unknown);
    assert.equal(receipt.behavior, scenario === 'pass' ? 'PASS' : 'FAIL');
    assert.equal(receipt.review, 'NOT_RUN'); assert.equal(receipt.production_ready, false);
    if (scenario !== 'pass') assert.doesNotMatch(run.stdout, /MIGRATION_AUTOMATED_CHECKS_PASS/u);
  });
  await t.test('source review executes only the emitted implementation after a real rename', () => {
    // Use a retained legacy module independent of the forthcoming platform type tests.
    rmSync(path.join(root, 'src/g0-002-sdk-lifecycle.mjs'));
    writeFileSync(path.join(root, 'src/g0-002-sdk-lifecycle.mts'), "export const migratedProbe: string = 'compiled-platform';\n");
    writeFileSync(path.join(root, file), "import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {migratedProbe} from '../src/g0-002-sdk-lifecycle.mjs';test('source text and compiled execution',()=>{assert.equal(migratedProbe,'compiled-platform');assert.match(readFileSync('src/g0-002-sdk-lifecycle.mts','utf8'),/: string/u);});\n");
    const routeFile = path.join(root, 'plans/typescript-migration/test-routing.json');
    const routes = record(JSON.parse(readFileSync(routeFile, 'utf8')) as unknown);
    assert.ok(Array.isArray(routes.entries));
    routes.entries = routes.entries.map(value => { const e = record(value); return e.path === file ? { ...e, mode: 'SOURCE_HOST' } : e; });
    writeFileSync(routeFile, JSON.stringify(routes));
    const report = mkdtempSync(path.join(tmpdir(), 'migration-rename-report-'));
    const run = spawnSync(process.execPath, [path.join(original, '.build/tools/gate.mjs'), '--batch', 'T03-01', '--report-dir', report], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180_000 });
    assert.equal(run.status, 0, run.stderr);
    const summary = record(JSON.parse(readFileSync(path.join(report, 'tests/summary.json'), 'utf8')) as unknown);
    assert.ok(Array.isArray(summary.files));
    const result = record(summary.files[0]);
    assert.ok(Array.isArray(result.loaded_project_files));
    assert.ok(result.loaded_project_files.includes('.build/runtime/src/g0-002-sdk-lifecycle.mjs'));
    assert.ok(!result.loaded_project_files.includes('src/g0-002-sdk-lifecycle.mjs'));
    rmSync(path.join(root, '.build/runtime/src/g0-002-sdk-lifecycle.mjs'));
    const missing = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(original, '.build/tools/source-hook.mjs')).href, '--test', file], { cwd: root, env: testEnvironment(root, []), encoding: 'utf8', windowsHide: true });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stdout + missing.stderr, /ENOENT/u);
  });
  // Preserve the owned clone and reports for diagnosis; no user checkout is mutated.
});
