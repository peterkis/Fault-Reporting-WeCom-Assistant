import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { cleanGenerated, controlledBuildRoot, program, sourceRoot, workspaceFiles } from './common.mjs';

const original = sourceRoot();

function scratch(reference = false): string {
  const root = mkdtempSync(path.join(tmpdir(), 'types-migration-test-'));
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', original, root], { stdio: 'pipe', windowsHide: true });
  if (reference) execFileSync('git', ['checkout', '--quiet', '--detach', '7eefaa99591bfaa2e787701efd315ff701c51f35'], { cwd: root, windowsHide: true });
  // Overlay deletions as well as additions, so uncommitted renames cannot create dual sources.
  if (!reference) { const current = new Set(workspaceFiles(original)); for (const relative of workspaceFiles(root)) if (!current.has(relative)) rmSync(path.join(root, relative)); }
  for (const relative of reference ? [] : workspaceFiles(original)) {
    const target = path.join(root, relative); mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(original, relative), target);
  }
  symlinkSync(path.join(original, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  return root;
}
function alter(root: string, relative: string, content: string, fn: () => void): void {
  const file = path.join(root, relative), previous = existsSync(file) ? readFileSync(file) : null;
  mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content);
  try { fn(); } finally { if (previous) writeFileSync(file, previous); else rmSync(file); }
}

test('T01 build and negative checks run on an owned full clone, never on user source', async t => {
  const root = scratch();
  try {
    const first = build(root), digest = verifyArtifact(root);
    assert.ok(first.typed_implementations.includes('src/migration-canary.mts'));
    assert.ok(first.unchecked_legacy.includes('src/p2-015-incident-correlation.mjs'));
    await t.test('two clean builds produce identical manifests', () => {
      build(root); assert.equal(verifyArtifact(root), digest);
    });
    await t.test('every legacy file preserves exact source bytes', () => {
      for (const f of first.outputs.filter(x => x.kind !== 'COMPILED')) assert.deepEqual(readFileSync(path.join(root, '.build/runtime', f.path)), readFileSync(path.join(root, f.source)));
    });
    for (const relative of ['src/migration-canary.mts', 'tsconfig.base.json', 'package-lock.json']) {
      await t.test('input drift is rejected: ' + relative, () => {
        alter(root, relative, readFileSync(path.join(root, relative), 'utf8') + '\n', () => assert.throws(() => verifyArtifact(root), /MIGRATION_INPUT_DRIFT/u));
      });
    }
    for (const relative of ['src/migration-canary.mjs', 'src/p2-015-decision-store.mjs', 'web/p2-workbench/index.html']) {
      await t.test('artifact tampering is rejected: ' + relative, () => {
        alter(root, '.build/runtime/' + relative, '// changed', () => assert.throws(() => verifyArtifact(root), /MIGRATION_OUTPUT_TAMPERED/u));
      });
    }
    await t.test('manifest tampering is rejected by an outer digest', () => {
      alter(root, '.build/runtime/build-manifest.json', '{}', () => assert.throws(() => verifyArtifact(root), /MIGRATION_MANIFEST_TAMPERED/u));
    });
    await t.test('unexpected files, including env files, cannot hide in the artifact', () => {
      alter(root, '.build/runtime/.env', 'SYNTHETIC_ONLY=1', () => assert.throws(() => verifyArtifact(root), /MIGRATION_UNDECLARED_OUTPUT/u));
    });
    await t.test('omitting a root target is rejected even when transitively imported', () => {
      const relative = 'tsconfig.migration.json';
      const config: unknown = JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
      assert.ok(config && typeof config === 'object');
      alter(root, relative, JSON.stringify({ ...config, include: ['tests/migration-canary.test.mts'] }), () => assert.throws(() => program(root, relative), /MIGRATION_UNCHECKED_TARGET/u));
    });
    await t.test('new untyped production is rejected even if a current inventory edit calls it legacy', () => {
      for (const relative of ['src/new-service.mjs', 'scripts/new-service.mjs', 'src/new-service.js', 'src/new-service.cjs']) {
        alter(root, relative, 'export const untyped = true;', () => {
          assert.throws(() => program(root, 'tsconfig.migration.json'), /MIGRATION_NEW_UNTYPED_PRODUCTION/u);
          alter(root, 'plans/typescript-migration/scope.json', '{}', () => assert.throws(() => build(root), /MIGRATION_NEW_UNTYPED_PRODUCTION/u));
          assert.equal(existsSync(path.join(root, '.build/artifact-proof.json')), false);
        });
      }
    });
    await t.test('a committed MTS migration cannot be silently restored as grandfathered MJS', () => {
      const retiredRoot = scratch(true);
      try {
        const js = path.join(retiredRoot, 'src/g0-002-sdk-lifecycle.mjs');
        const typed = path.join(retiredRoot, 'src/g0-002-sdk-lifecycle.mts');
        const originalBytes = readFileSync(js);
        rmSync(js); writeFileSync(typed, originalBytes);
        execFileSync('git', ['add', 'src/g0-002-sdk-lifecycle.mjs', 'src/g0-002-sdk-lifecycle.mts'], { cwd: retiredRoot });
        execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic fixture: record typed migration'], { cwd: retiredRoot });
        rmSync(typed); writeFileSync(js, originalBytes);
        assert.throws(() => program(retiredRoot, 'tsconfig.migration.json'), /MIGRATION_RETIRED_LEGACY/u);
        assert.throws(() => build(retiredRoot), /MIGRATION_RETIRED_LEGACY/u);
      } finally { rmSync(retiredRoot, { recursive: true, force: true }); }
    });
    await t.test('parentheses, satisfies and angle assertions cannot disguise double casts', () => {
      for (const expression of ['value as unknown as string', '(value as unknown) as string', '(((value as unknown))) as string',
        '(value as unknown satisfies unknown) as string', '<string>(<unknown>value)']) {
        alter(root, 'src/assertion-negative.mts', 'const value = 1; export const result = ' + expression + ';', () => {
          assert.throws(() => program(root, 'tsconfig.migration.json'), /MIGRATION_TYPE_ESCAPE/u);
        });
      }
    });
    await t.test('new JavaScript tools are not grandfathered by a directory', () => {
      for (const relative of ['tools/helper.mjs', '.github/review/helper.mjs', 'tools/ts-migration/helper.js']) {
        alter(root, relative, 'export const unchecked = 1;', () => {
          assert.throws(() => program(root, 'tsconfig.tools.json'), /MIGRATION_NEW_UNTYPED_TOOL/u);
          assert.throws(() => build(root), /MIGRATION_NEW_UNTYPED_TOOL/u);
        });
      }
    });
    await t.test('local declarations cannot hide any or a suppressed error', () => {
      for (const [relative, content] of [
        ['src/declaration-negative.d.mts', 'export const unchecked: any;'],
        ['src/declaration-negative.d.mts', '// @ts-ignore\nexport const invalid: MissingType;'],
        ['src/declaration-negative.d.ts', 'export const unchecked: any;'],
        ['contracts/declaration-negative.d.cts', 'export const unchecked: any;'],
        ['contracts/declaration-negative.d.cts', '// @ts-ignore\nexport const invalid: MissingType;'],
      ]) {
        if (!relative || !content) throw new Error('invalid negative fixture');
        alter(root, relative, content, () => {
          const specifier = relative.endsWith('.d.cts') ? '../contracts/declaration-negative.cjs' : relative.endsWith('.d.mts') ? './declaration-negative.mjs' : './declaration-negative.js';
          alter(root, 'src/declaration-negative-consumer.mts', `import { ${content.includes('unchecked') ? 'unchecked' : 'invalid'} } from '${specifier}';`, () => {
            assert.throws(() => program(root, 'tsconfig.migration.json'), /MIGRATION_TYPE_(?:ESCAPE|SUPPRESSION)/u);
          });
        });
      }
    });
    await t.test('expect-error requires substantive explanation rather than padding', () => {
      for (const reason of ['        ', '\t\t\t\t\t\t\t\t', '********']) {
        alter(root, 'tests/types/padding-negative.mts', `// @ts-expect-error -- ${reason}\nconst rejected: number = 'wrong';`, () => {
          assert.throws(() => program(root, 'tsconfig.type-tests.json'), /MIGRATION_TYPE_SUPPRESSION/u);
        });
      }
    });
    await t.test('same logical MJS and MTS are rejected and stale success is removed', () => {
      alter(root, 'src/g0-002-sdk-lifecycle.mts', 'export const duplicate = true;', () => {
        assert.throws(() => build(root), /MIGRATION_OUTPUT_COLLISION/u);
        assert.equal(existsSync(path.join(root, '.build/artifact-proof.json')), false);
        assert.equal(existsSync(path.join(root, '.build/runtime/build-manifest.json')), false);
      });
    });
    await t.test('missing required resources fail without source fallback', () => {
      const resource = path.join(root, 'web/p2-workbench/index.html'), content = readFileSync(resource);
      rmSync(resource);
      try { assert.throws(() => build(root)); assert.equal(existsSync(path.join(root, '.build/artifact-proof.json')), false); }
      finally { writeFileSync(resource, content); }
    });
    await t.test('compile failure leaves no previously successful artifact', () => {
      build(root);
      alter(root, 'src/migration-canary.mts', "export const wrong: number = 'bad';", () => {
        assert.throws(() => build(root)); assert.equal(existsSync(path.join(root, '.build/runtime/build-manifest.json')), false);
      });
    });
    await t.test('disabled strictness and unsafe emit directories are rejected', () => {
      for (const override of [{ strict: false }, { strictNullChecks: false }, { noCheck: true }, { outDir: './src' }]) {
        const relative = 'tsconfig.migration.json';
        alter(root, relative, JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { rootDir: '.', outDir: './.build/emit', allowJs: true, ...override }, include: ['src/**/*.mts', 'tests/migration-canary.test.mts'] }), () => assert.throws(() => program(root, relative), /MIGRATION_/u));
      }
    });
    await t.test('tooling never recursively removes an unowned build directory', () => {
      const marker = path.join(root, '.build/.migration-owner'), content = readFileSync(marker);
      writeFileSync(marker, 'not this project');
      try { assert.throws(() => cleanGenerated(root, 'runtime'), /MIGRATION_UNOWNED_BUILD_ROOT/u); }
      finally { writeFileSync(marker, content); }
    });
    await t.test('a symlink build root is rejected without deleting its destination', () => {
      const other = mkdtempSync(path.join(tmpdir(), 'types-owned-link-'));
      const linkRoot = mkdtempSync(path.join(tmpdir(), 'types-link-root-'));
      try {
        writeFileSync(path.join(other, 'keep'), 'keep');
        symlinkSync(other, path.join(linkRoot, '.build'), process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => controlledBuildRoot(linkRoot), /MIGRATION_UNSAFE_BUILD_ROOT/u);
        assert.equal(readFileSync(path.join(other, 'keep'), 'utf8'), 'keep');
      } finally { rmSync(linkRoot, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
    });
    await t.test('the real tsc CLI rejects a wrong call and accepts its corrected form', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'types-negative-cli-'));
      try {
        const file = path.join(dir, 'negative.mts');
        for (const bad of [true, false]) {
          writeFileSync(file, `import { canary } from '${path.join(root, 'src/migration-canary.mjs').replaceAll('\\', '/')}';\ncanary({ label: 'cli', sequence: ${bad ? "'wrong'" : '1'} });`);
          const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--types', 'node', '--typeRoots', path.join(root, 'node_modules/@types'), file], { cwd: root, encoding: 'utf8', windowsHide: true });
          assert.equal(result.error, undefined);
          if (bad) { assert.notEqual(result.status, 0); assert.match(result.stdout, /TS2322/u); }
          else assert.equal(result.status, 0, result.stdout);
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ARCH-006 CLI rejects content changes within an already reviewed path', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'arch006-content-regression-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', original, root], { windowsHide: true, stdio: 'pipe' });
    execFileSync('git', ['checkout', '--quiet', '--detach', '1911d364e48530683032f8856c41678c80f69dc9'], { cwd: root, windowsHide: true });
    const base = '87de2bc9e8835882cd390b024a04e2865cd367f9';
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', base], { cwd: root, windowsHide: true });
    const report = mkdtempSync(path.join(tmpdir(), 'arch006-logs-'));
    const scope = '- valid pinned local self-service successor scope\n';
    const evidence = '- historical Evidence is immutable; authorized current reports require exact snapshots and current READY proof\n';
    writeFileSync(path.join(report, 'base-arch006.txt'), 'ARCH-006 validation failed with 2 error(s):\n' + scope + evidence);
    writeFileSync(path.join(report, 'current-arch006.txt'), 'ARCH-006 validation failed with 3 error(s):\n- no forbidden Runtime Migration web archive or secret path changed\n' + scope + evidence);
    const run = (expectedBase: string | undefined = base) => spawnSync(process.execPath, [path.join(original, '.build/tools/arch006-baseline.mjs'), report], {
      cwd: root, env: { ...process.env, EXPECTED_BASE: expectedBase }, encoding: 'utf8', windowsHide: true,
    });
    const accepted = run();
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    assert.match(accepted.stdout, /ARCH006_KNOWN_BASELINE_NOT_READY/u);
    assert.notEqual(run('1911d364e48530683032f8856c41678c80f69dc9').status, 0, 'a different PR base requires its own review');
    assert.notEqual(run('').status, 0, 'the PR-event base is mandatory');
    const currentLog = path.join(report, 'current-arch006.txt');
    const originalLog = readFileSync(currentLog, 'utf8');
    writeFileSync(currentLog, originalLog + '- unexpected failure\n');
    assert.match(run().stderr, /ARCH006_CURRENT_REJECTION_DRIFT/u);
    writeFileSync(currentLog, 'ARCH-006 rule-first service loop validation passed (1 checks).\n');
    assert.notEqual(run().status, 0, 'a readiness PASS cannot be classified as known non-readiness');
    writeFileSync(currentLog, originalLog);
    writeFileSync(path.join(root, 'README.md'), readFileSync(path.join(root, 'README.md'), 'utf8') + '\nSynthetic documentation successor.\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic documentation successor'], { cwd: root, windowsHide: true });
    assert.equal(run().status, 0, 'documentation-only successors retain the reviewed runtime content');
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root, windowsHide: true });
    assert.equal(run().status, 0, 'a moving origin/main must not change the PR-event comparison');
    writeFileSync(path.join(report, 'current-arch006.txt'), readFileSync(path.join(report, 'base-arch006.txt')));
    assert.equal(run().status, 0, 'the original two-error rejection can also be retained');
    const file = path.join(root, 'src/p1-001-pilot-foundation.mts');
    writeFileSync(file, readFileSync(file, 'utf8') + "\nthrow new Error('SYNTHETIC_RUNTIME_REGRESSION');\n");
    assert.notEqual(run().status, 0, 'uncommitted runtime content cannot borrow the clean HEAD fingerprint');
    execFileSync('git', ['add', 'src/p1-001-pilot-foundation.mts'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic same-path runtime regression'], { cwd: root, windowsHide: true });
    const rejected = run();
    assert.notEqual(rejected.status, 0, 'a same-path production mutation must not share the reviewed exception');
    assert.match(rejected.stdout + rejected.stderr, /ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT/u);
    execFileSync('git', ['checkout', '--quiet', '--detach', '1911d364e48530683032f8856c41678c80f69dc9'], { cwd: root, windowsHide: true });
    assert.equal(run().status, 0);
    if (process.platform !== 'win32') chmodSync(file, 0o755);
    execFileSync('git', ['update-index', '--chmod=+x', 'src/p1-001-pilot-foundation.mts'], { cwd: root, windowsHide: true });
    execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic runtime mode regression'], { cwd: root, windowsHide: true });
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(), '', 'the mode regression must be a clean committed object');
    assert.match(run().stderr, /ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT/u);
    execFileSync('git', ['checkout', '--quiet', '--detach', '1911d364e48530683032f8856c41678c80f69dc9'], { cwd: root, windowsHide: true });
    for (const relative of ['database/migrations/999_synthetic.sql', 'evidence/synthetic-rewrite.json']) {
      writeFileSync(path.join(root, relative), 'synthetic only\n');
      execFileSync('git', ['add', relative], { cwd: root, windowsHide: true });
      execFileSync('git', ['-c', 'user.name=Migration test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Synthetic out-of-scope regression'], { cwd: root, windowsHide: true });
      assert.match(run().stderr, /ARCH006_REVIEWED_RUNTIME_DELTA_DRIFT/u);
      execFileSync('git', ['checkout', '--quiet', '--detach', '1911d364e48530683032f8856c41678c80f69dc9'], { cwd: root, windowsHide: true });
    }
    rmSync(report, { recursive: true, force: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
