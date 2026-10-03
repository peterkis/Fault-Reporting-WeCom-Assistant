import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {testRoots} from './migration-roots.mjs';
import {CURRENT_YXX_SCOPE} from '../../src/yxx-current-readiness-scope.mjs';
export function withScopeCheckout(run: (root: string) => void): void {
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
