import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from './build.mjs';
import { verifyArtifact } from './verify-artifact.mjs';
import { cleanGenerated, controlledBuildRoot, program, sourceRoot, workspaceFiles } from './common.mjs';

const original = sourceRoot();
function scratch(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'types-migration-test-'));
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', original, root], { stdio: 'pipe', windowsHide: true });
  for (const relative of workspaceFiles(original)) {
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
    assert.ok(first.unchecked_legacy.includes('src/p2-007-staff-directory-store.mjs'));
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
    for (const relative of ['src/migration-canary.mjs', 'src/p2-007-staff-directory-store.mjs', 'web/p2-workbench/index.html']) {
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
    await t.test('same logical MJS and MTS are rejected and stale success is removed', () => {
      alter(root, 'src/migration-canary.mjs', 'export const duplicate = true;', () => {
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
