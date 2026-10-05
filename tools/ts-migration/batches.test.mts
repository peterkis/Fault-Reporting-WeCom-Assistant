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
import { findNpmLauncher, runNpm } from './npm-launcher.mjs';

const original = sourceRoot();
test('the Foundation npm seam accepts real wrappers and JavaScript symlinks', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'npm %SYNTHETIC_VARIABLE% wrapper '));
  try {
    const found = findNpmLauncher({ encoding: 'utf8' });
    const wrapper = path.join(root, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    writeFileSync(wrapper, process.platform === 'win32'
      ? `@echo off\r\n${/\.[cm]?js$/iu.test(found) ? '"' + process.execPath.replaceAll('%', '%%') + '" ' : ''}"${found.replaceAll('%', '%%')}" %*\r\n`
      : `#!/bin/sh\nexec '${found.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, TS_MIGRATION_TEST_SOURCE_ROOT: original };
    env.SYNTHETIC_VARIABLE = 'EXPANSION_MUST_NOT_HAPPEN';
    delete env.NODE_TEST_CONTEXT;
    const inheritedPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.PATH = root + path.delimiter + inheritedPath;
    const run = () => spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^the original preflight npm',
      path.join(original, '.build/runtime/tests/p1-foundation-cli.test.mjs')], {
      cwd: original, env, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    });
    await t.test(process.platform === 'win32' ? 'cmd wrapper' : 'shell wrapper', () => {
      const result = run();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /# pass 1/u);
    });
    await t.test('real npm preserves literal arguments and the script exit code', () => {
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, scripts: { fixture: 'node argv.mjs' } }));
      writeFileSync(path.join(root, 'argv.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));process.exitCode=17;\n');
      const values = ['space value', 'x&y', 'caret^value', 'a!b', '%SYNTHETIC_VARIABLE%'];
      env.SYNTHETIC_VARIABLE = 'EXPANSION_MUST_NOT_HAPPEN';
      const result = runNpm(['--silent', 'run', 'fixture', '--', ...values], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
      assert.equal(result.status, 17, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim()), values);
      for (const values of [['quote"value', 'pipe|value'], ['quote"value', 'less<more>']]) {
        const result = runNpm(['--silent', 'run', 'fixture', '--', ...values], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
        assert.equal(result.status, 17, result.stdout + result.stderr);
        assert.deepEqual(JSON.parse(result.stdout.trim()), values);
      }
    });
    if (process.platform !== 'win32') await t.test('JavaScript symlink launcher', () => {
      const target = path.join(root, 'npm-forwarder.mjs');
      writeFileSync(target, '#!/usr/bin/env node\nimport {spawnSync} from "node:child_process";\n'
        + `const run=spawnSync(${JSON.stringify(found)},process.argv.slice(2),{stdio:'inherit'});\n`
        + 'if(run.error)throw run.error;process.exitCode=run.status??1;\n', { mode: 0o755 });
      rmSync(wrapper); symlinkSync(target, wrapper);
      const result = run();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /# pass 1/u);
    });
    if (process.env.TS_MIGRATION_NPM_WRAPPER_HOST !== '1') await t.test('a wrapped host npm also passes the launcher regressions without an installation layout', () => {
      const host = path.join(root, 'host-wrapper'); mkdirSync(host);
      let hostPath = host + path.delimiter + inheritedPath;
      if (process.platform === 'win32') {
        copyFileSync(process.execPath, path.join(host, 'node.exe'));
        writeFileSync(path.join(host, 'npm.cjs'), '(async()=>{\n'
          + `const {runNpmLauncher}=await import(${JSON.stringify(pathToFileURL(path.join(original, '.build/tools/npm-launcher.mjs')).href)});\n`
          + `const run=runNpmLauncher(${JSON.stringify(found)},process.argv.slice(2),{stdio:'inherit',encoding:'utf8',env:{...process.env,PATH:${JSON.stringify(inheritedPath)}}});\n`
          + 'if(run.error)throw run.error;process.exitCode=run.status??1;\n})().catch(error=>{console.error(error);process.exitCode=1;});\n');
        const git = execFileSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/u)[0];
        assert.ok(git); assert.ok(process.env.SystemRoot);
        hostPath = [host, path.dirname(git), path.join(process.env.SystemRoot, 'System32')].join(path.delimiter);
        assert.notEqual(spawnSync('where.exe', ['npm.cmd'], { env: { ...env, PATH: hostPath }, encoding: 'utf8', windowsHide: true }).status, 0);
      } else writeFileSync(path.join(host, 'npm'), `#!/bin/sh\nexec '${found.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^the Foundation npm seam', path.join(original, '.build/tools/batches.test.mjs')], {
        cwd: original, env: { ...env, PATH: hostPath, PATHEXT: (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD') + ';.CJS', TS_MIGRATION_NPM_WRAPPER_HOST: '1' }, encoding: 'utf8', windowsHide: true, timeout: 60_000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('T04-05 closes the entire P1 stage and retains the personnel and boundary baselines', () => {
  const selected = batchSelection(original, 'T04-05');
  for (const name of ['tests/p1-001-pilot-foundation.test.mjs', 'tests/p1-008-first-acknowledgement.test.mjs', 'tests/p1-011-encrypted-backup.test.mjs', 'tests/p1-012-pilot-e2e-integration.test.mjs', 'tests/p1-012-live-e2e-script.test.mjs', 'tests/p1-009-pilot-access-workbench.test.mjs', 'tests/p1-foundation-cli.test.mts', 'tests/p1-migration-compatibility.test.mts', 'tests/p2-007-third-party-staff-directory.integration.test.mjs']) assert.ok(selected.entries.some(e => e.path === name));
});
test('T04-04 selection covers SDK, Intake, access, subprocesses and the retained baseline', () => {
  const selected = batchSelection(original, 'T04-04');
  assert.equal(selected.entries.length, 131);
  for (const name of ['tests/p1-002-wecom-sdk-adapter.test.mjs', 'tests/p1-004-service-intake.test.mjs', 'tests/p1-009-pilot-access-workbench.test.mjs', 'tests/p1-003-channel-message-inbox.test.mjs', 'tests/p2-g2-process-assembly.integration.test.mjs', 'tests/yxx-ss-010-runtime.integration.test.mjs', 'tests/p2-007-third-party-staff-directory.integration.test.mjs']) assert.ok(selected.entries.some(e => e.path === name));
});
test('batch selection includes every T03 reverse dependency and the personnel baseline', () => {
  const selected = batchSelection(original, 'T03-01');
  assert.ok(selected.entries.length >= 166);
  for (const name of ['tests/platform-postgres-time.integration.test.mjs', 'tests/yxx-ss-009-evidence.test.mjs', 'tests/p2-007-third-party-staff-directory.integration.test.mjs']) assert.ok(selected.entries.some(e => e.path === name));
  assert.throws(() => batchSelection(original, 'unknown'), /UNKNOWN_BATCH/u);
});

test('batch CLI runs non-canary tests and reports failure without certifying review', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-batch-test-'));
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', original, root], { windowsHide: true, stdio: 'pipe' });
  // Overlay deletions as well as additions, so uncommitted renames cannot create dual sources.
  { const current = new Set(workspaceFiles(original)); for (const relative of workspaceFiles(root)) if (!current.has(relative)) rmSync(path.join(root, relative)); }
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
    const report = mkdtempSync(path.join(tmpdir(), 'migration batch report '));
    const run = runNpm(['run', 'migration:gate', '--', '--batch', 'T03-01', '--report-dir', report], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180_000 });
    assert.equal(run.status, scenario === 'pass' ? 0 : 1, run.stderr);
    const summary = record(JSON.parse(readFileSync(path.join(report, 'tests/summary.json'), 'utf8')) as unknown);
    assert.deepEqual(summary.selected_files, [file]); assert.deepEqual(summary.not_run, []);
    const receipt = record(JSON.parse(readFileSync(path.join(report, 'batch.json'), 'utf8')) as unknown);
    assert.equal(receipt.behavior, scenario === 'pass' ? 'PASS' : 'FAIL');
    assert.equal(receipt.review, 'NOT_RUN'); assert.equal(receipt.production_ready, false);
    if (scenario !== 'pass') assert.doesNotMatch(run.stdout, /MIGRATION_AUTOMATED_CHECKS_PASS/u);
  });
  await t.test('npm wrapper rejects unknown batches and preserves the no-argument gate', () => {
    const rejected = runNpm(['run', 'migration:gate', '--', '--batch', 'UNKNOWN'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180_000 });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /MIGRATION_UNKNOWN_BATCH/u);
    const normal = runNpm(['run', 'migration:gate'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180_000 });
    assert.equal(normal.status, 0, normal.stdout + normal.stderr);
    assert.match(normal.stdout, /MIGRATION_GATE_PASS/u);
  });
  await t.test('source review executes only the emitted implementation after a real rename', () => {
    // Use a retained legacy module independent of the forthcoming platform type tests.
    rmSync(path.join(root, 'src/g0-003-frame-capture.mjs'));
    writeFileSync(path.join(root, 'src/g0-003-frame-capture.mts'), "export const migratedProbe: string = 'compiled-platform';\n");
    writeFileSync(path.join(root, file), "import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {migratedProbe} from '../src/g0-003-frame-capture.mjs';test('source text and compiled execution',()=>{assert.equal(migratedProbe,'compiled-platform');assert.match(readFileSync('src/g0-003-frame-capture.mts','utf8'),/: string/u);});\n");
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
    assert.ok(result.loaded_project_files.includes('.build/runtime/src/g0-003-frame-capture.mjs'));
    assert.ok(!result.loaded_project_files.includes('src/g0-003-frame-capture.mjs'));
    rmSync(path.join(root, '.build/runtime/src/g0-003-frame-capture.mjs'));
    const missing = spawnSync(process.execPath, ['--import', pathToFileURL(path.join(original, '.build/tools/source-hook.mjs')).href, '--test', file], { cwd: root, env: testEnvironment(root, []), encoding: 'utf8', windowsHide: true });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stdout + missing.stderr, /ENOENT/u);
  });
  // Preserve the owned clone and reports for diagnosis; no user checkout is mutated.
});

test('T04-03 selection includes operations, reverse dependencies, baseline and compatibility tests', () => {
  const selected = batchSelection(original, 'T04-03');
  assert.equal(selected.entries.length, 96);
  for (const name of ['tests/p1-011-typescript-compatibility.test.mjs', 'tests/p1-011-encrypted-backup.test.mjs', 'tests/p2-007-third-party-staff-directory.integration.test.mjs', 'tests/yxx-ss-010-runtime.integration.test.mjs']) assert.ok(selected.entries.some(e => e.path === name));
});
