import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const localRoot = fileURLToPath(new URL('../..', import.meta.url));
export function testRoots() {
  const source = process.env.TS_MIGRATION_TEST_SOURCE_ROOT;
  const runtime = process.env.TS_MIGRATION_TEST_RUNTIME_ROOT;
  if (!source && !runtime) return Object.freeze({ sourceRoot: localRoot, runtimeRoot: localRoot });
  if (!source || !runtime || !path.isAbsolute(source) || !path.isAbsolute(runtime)) throw new Error('MIGRATION_TEST_ROOT_PAIR_REQUIRED');
  const sourceRoot = realpathSync.native(source), runtimeRoot = realpathSync.native(runtime);
  if (![sourceRoot, runtimeRoot].some(p => path.relative(p, realpathSync.native(localRoot)) === '')
    || path.relative(path.join(sourceRoot, '.build/runtime'), runtimeRoot) !== '') throw new Error('MIGRATION_TEST_ROOT_MISMATCH');
  const gitRoot = realpathSync.native(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: sourceRoot, encoding: 'utf8', windowsHide: true }).trim());
  if (path.relative(gitRoot, sourceRoot) !== '') throw new Error('MIGRATION_TEST_SOURCE_NOT_GIT_ROOT');
  return Object.freeze({ sourceRoot, runtimeRoot });
}
export function sourceFile(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('MIGRATION_TEST_INVALID_SOURCE_PATH');
  const { sourceRoot } = testRoots();
  const original = path.join(sourceRoot, relative);
  const typed = original.endsWith('.mjs') ? original.slice(0, -4) + '.mts' : null;
  if (typed && existsSync(original) && existsSync(typed)) throw new Error('MIGRATION_TEST_DUAL_SOURCE');
  const target = typed && existsSync(typed) ? typed : original;
  let current = sourceRoot;
  for (const component of path.relative(sourceRoot, target).split(path.sep)) {
    current = path.join(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error('MIGRATION_TEST_SOURCE_SYMLINK');
  }
  return target;
}
