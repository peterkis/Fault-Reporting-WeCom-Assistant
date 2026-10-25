import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {isG2CandidatePath} from '../../app/server/src/p2-g2-candidate.mjs';
import {tmpdir} from 'node:os';
import {testRoots} from './migration-roots.mjs';
import {CURRENT_YXX_SCOPE} from '../../app/server/src/yxx-current-readiness-scope.mjs';
export function withScopeCheckout(run: (root: string) => void): void {
  const source = testRoots().sourceRoot;
  const temporary = mkdtempSync(path.join(tmpdir(), 'yxx-current-scope-'));
  const git = (args: string[]): void => { execFileSync('git', args, { cwd: source, windowsHide: true, stdio: 'pipe' }); };
  let attached = false;
  try {
    git(['worktree', 'add', '--detach', temporary, 'HEAD']); attached = true;
    copyCurrentApplicationSources(source,temporary);
    copyFileSync(path.join(source, CURRENT_YXX_SCOPE), path.join(temporary, CURRENT_YXX_SCOPE));
    run(temporary);
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    assert.ok(path.basename(temporary).startsWith('yxx-current-scope-'));
    if (attached) git(['worktree', 'remove', '--force', temporary]);
    else rmSync(temporary, { recursive: true, force: true });
  }
}

// Report-binding positives need a real candidate commit in this owned fixture.
// The user's working tree, index, branch and existing tested heads are untouched.
export function freezeCurrentCandidateFixture(checkout:string):string {
  assert.equal(path.dirname(checkout),path.resolve(tmpdir()));
  assert.match(path.basename(checkout),/^yxx-(?:current-scope|execution-evidence)-/u);
  const git=(args:string[]):string=>execFileSync('git',args,{cwd:checkout,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
  assert.equal(git(['rev-parse','--abbrev-ref','HEAD']),'HEAD');
  git(['add','--all','--','.']);
  const tree=git(['write-tree']);
  const commit=git(['-c','user.name=Synthetic Readiness Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false',
    'commit-tree',tree,'-p','HEAD','-m','synthetic current candidate fixture']);
  git(['update-ref','HEAD',commit]);return commit;
}

// Current fixtures mirror candidate inputs, including deletions from earlier
// application moves. Fixed historical wrappers do not use this helper.
export function copyCurrentApplicationSources(source:string,checkout:string):void {
  assert.equal(path.dirname(checkout),path.resolve(tmpdir()));
  assert.match(path.basename(checkout),/^yxx-(?:current-scope|execution-evidence)-/u);
  const listed=(root:string):string[]=>execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
  const files=new Set(listed(source).filter(file=>isG2CandidatePath(file)&&existsSync(path.join(source,file))));
  for(const file of listed(checkout)){
    if(!isG2CandidatePath(file)||files.has(file))continue;
    const target=path.resolve(checkout,file);
    assert.ok(target.startsWith(path.resolve(checkout)+path.sep));
    if(existsSync(target)){assert.equal(lstatSync(target).isSymbolicLink(),false);rmSync(target);}
  }
  for(const file of files){
    assert.equal(/(?:^|\/)(?:\.env(?!\.example$)[^/]*|node_modules|secrets)(?:\/|$)/u.test(file),false);
    let current=source;for(const part of file.split('/')){current=path.join(current,part);assert.equal(lstatSync(current).isSymbolicLink(),false);}
    const target=path.join(checkout,file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(source,file),target);
  }
  for(const old of ['src','scripts'])rmSync(path.join(checkout,old),{recursive:true,force:true});
}
