import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const CURRENT_YXX_BASE = '562a96ffdd7148d729ab0eed9d215abe894f12c2';
export const CURRENT_YXX_TREE = 'fc20b1021291aca44b45ba3be461423a61bcee48';
export const CURRENT_YXX_SCOPE = 'plans/yxx-current-readiness-scope.json';
export const HISTORICAL_SS009_HEAD = '41edd855e7bc55149facb6a4b2e0076776c22e66';
const states = ['MANIFEST.json', 'plans/current_phase.json', 'plans/master_backlog.json',
  'plans/parallel_workstreams.json', 'tasks/master_backlog.json', 'project_summary.json'];
const defaults = ['.env.example', 'config_examples/yxx-limited-write-authorization.example.json'];
const lf = (value: string): string => value.replaceAll('\r\n', '\n');
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export type CurrentYxxScope = {
  base_head: string; base_tree: string; scope_sha256: string; migration_files: string[];
  historical_ss009_head: string; live_authorized: false; parent_gate_advanced: false;
};

/** Current structural contract only; a valid scope is never runtime acceptance. */
export function readCurrentYxxScope(root: string): CurrentYxxScope {
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    env.GIT_NO_REPLACE_OBJECTS = '1';
    const git = (args: string[]): string => execFileSync('git', args, {
      cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(realpathSync(git(['rev-parse', '--show-toplevel']).trim()), realpathSync(root));
    assert.equal(git(['rev-parse', '--is-shallow-repository']).trim(), 'false');
    assert.equal(git(['for-each-ref', '--format=%(refname)', 'refs/replace/']).trim(), '');
    const graft = path.resolve(root, git(['rev-parse', '--git-path', 'info/grafts']).trim());
    assert.ok(!existsSync(graft) || readFileSync(graft, 'utf8').trim() === '');
    assert.equal(git(['rev-parse', CURRENT_YXX_BASE + '^{tree}']).trim(), CURRENT_YXX_TREE);
    git(['merge-base', '--is-ancestor', CURRENT_YXX_BASE, 'HEAD']);
    git(['merge-base', '--is-ancestor', HISTORICAL_SS009_HEAD, CURRENT_YXX_BASE]);
    const read = (relative: string): string => {
      let current = root;
      for (const part of relative.split('/')) {
        assert.ok(part && part !== '.' && part !== '..' && !part.includes('\\'));
        current = path.join(current, part); assert.equal(lstatSync(current).isSymbolicLink(), false);
      }
      const stat = lstatSync(current); assert.ok(stat.isFile() && stat.size <= 16 * 1024 * 1024);
      return lf(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(current)));
    };
    const scopeText = read(CURRENT_YXX_SCOPE);
    const scope: unknown = JSON.parse(scopeText);
    assert.ok(isRecord(scope));
    assert.deepEqual(Object.keys(scope).sort(), ['schema_version', 'work_item', 'contract', 'base_head', 'base_tree',
      'historical_ss009_head', 'content_encoding', 'files', 'default_files', 'live_authorized', 'parent_gate_advanced', 'sql_changes_authorized'].sort());
    assert.equal(scope.schema_version, 1); assert.equal(scope.work_item, 'YXX_CURRENT_READINESS');
    assert.equal(scope.contract, 'ADR-0027'); assert.equal(scope.content_encoding, 'UTF8_LF');
    assert.equal(scope.base_head, CURRENT_YXX_BASE); assert.equal(scope.base_tree, CURRENT_YXX_TREE);
    assert.equal(scope.historical_ss009_head, HISTORICAL_SS009_HEAD);
    for (const key of ['live_authorized', 'parent_gate_advanced', 'sql_changes_authorized']) assert.equal(scope[key], false);
    const sql = git(['ls-tree', '-r', '--name-only', CURRENT_YXX_BASE, '--', 'database/migrations']).trim().split('\n');
    assert.equal(sql.length, 22);
    assert.equal(lstatSync(path.join(root, 'database')).isSymbolicLink(), false);
    assert.equal(lstatSync(path.join(root, 'database/migrations')).isSymbolicLink(), false);
    assert.deepEqual(readdirSync(path.join(root, 'database/migrations')).sort(), sql.map(p => path.posix.basename(p)).sort());
    const entryFor = (file: string): { path: string; mode: string; blob: string; sha256_utf8_lf: string } => {
      const entry = git(['ls-tree', CURRENT_YXX_BASE, '--', file]).trim().split(/\s+/u);
      const mode = entry[0], blob = entry[2];
      assert.ok(mode === '100644' || mode === '100755'); assert.ok(typeof blob === 'string'); assert.match(blob, /^[a-f0-9]{40}$/u);
      const sha256 = digest(lf(git(['show', CURRENT_YXX_BASE + ':' + file])));
      assert.equal(digest(read(file)), sha256);
      const indexed = git(['ls-files', '--stage', '--', file]).trim().split(/\s+/u);
      assert.equal(indexed[0], mode); assert.equal(indexed[1], blob); assert.equal(indexed[2], '0');
      if (process.platform !== 'win32') assert.equal(lstatSync(path.join(root, file)).mode & 0o111 ? '100755' : '100644', mode);
      return { path: file, mode, blob, sha256_utf8_lf: sha256 };
    };
    assert.deepEqual(scope.files, [...sql, ...states].map(entryFor));
    assert.deepEqual(scope.default_files, defaults.map(entryFor));
    return { base_head: CURRENT_YXX_BASE, base_tree: CURRENT_YXX_TREE, scope_sha256: digest(scopeText),
      migration_files: sql, historical_ss009_head: HISTORICAL_SS009_HEAD, live_authorized: false, parent_gate_advanced: false };
  } catch {
    throw Object.assign(new Error('CURRENT_SCOPE_INVALID'), { code: 'CURRENT_SCOPE_INVALID', stage: 'SCOPE' });
  }
}
