import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,appendFileSync,renameSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyPrEvidenceDelta} from './pr-evidence-delta.mjs';

test('PR evidence additions pass; rewrites and rewrite-restore history fail',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'pr-evidence-test-'));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  const commit=()=>{git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);return git(['rev-parse','HEAD']);};
  try{
    git(['init']);mkdirSync(path.join(root,'evidence'));writeFileSync(path.join(root,'evidence/original.md'),'original\n');const base=commit();
    writeFileSync(path.join(root,'evidence/new.md'),'new\n');let head=commit();
    assert.equal(verifyPrEvidenceDelta({root,base,head}).status,'PR_EVIDENCE_DELTA_PASS_NOT_READINESS');
    assert.throws(()=>verifyPrEvidenceDelta({root,base,head:base}));
    writeFileSync(path.join(root,'evidence/new.md'),'changed\n');head=commit();assert.throws(()=>verifyPrEvidenceDelta({root,base,head}));
    writeFileSync(path.join(root,'evidence/new.md'),'new\n');head=commit();assert.throws(()=>verifyPrEvidenceDelta({root,base,head}));
    git(['checkout','-b','side',base]);
    writeFileSync(path.join(root,'evidence/original.md'),'side rewrite\n');commit();
    git(['checkout','-b','merge-target',base]);
    writeFileSync(path.join(root,'evidence/other.md'),'other\n');commit();
    git(['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','merge','--no-ff','-s','ours','side','-m','retain original tree']);
    head=git(['rev-parse','HEAD']);
    assert.throws(()=>verifyPrEvidenceDelta({root,base,head}),/rewrites or removes committed evidence/);
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.match(path.basename(root),/^pr-evidence-test-/u);
    rmSync(root,{recursive:true,force:true});
  }
});

test('PR21 accepts only the five adjudicated transitions, never later changes to their paths',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'pr-evidence-test-'));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  const base='627d5f72959b4b2a085d734c311712363f87a3f8';
  const published='7fedc500054b547437a8acc9a8e8647e1d4f07e4';
  const file='evidence/g0-005-active-push-matrix.md';
  const commit=()=>{git(['add','evidence']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);return git(['rev-parse','HEAD']);};
  try{
    git(['clone','--shared','--no-checkout',process.cwd(),'.']);
    git(['checkout','--detach',published]);
    const result=verifyPrEvidenceDelta({root,base,head:published});
    assert.equal(result.status,'PR_EVIDENCE_DELTA_PASS_NOT_READINESS');
    assert.equal(result.adjudicated_changes.length,5);
    for(const [name,change] of [
      ['append',()=>appendFileSync(path.join(root,file),'\nnew observation\n')],
      ['rewrite',()=>writeFileSync(path.join(root,file),'rewritten\n')],
      ['delete',()=>rmSync(path.join(root,file))],
      ['rename',()=>renameSync(path.join(root,file),path.join(root,'evidence/renamed.md'))],
      ['mode',()=>git(['update-index','--chmod=+x',file])],
    ]){
      git(['checkout','-b',name,published]);change();
      const head=commit();
      assert.throws(()=>verifyPrEvidenceDelta({root,base,head}),/rewrites or removes committed evidence/);
      git(['restore','--source='+published,'--staged','--worktree','evidence']);
      const restored=commit();
      assert.throws(()=>verifyPrEvidenceDelta({root,base,head:restored}),/rewrites or removes committed evidence/);
    }
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.match(path.basename(root),/^pr-evidence-test-/u);
    rmSync(root,{recursive:true,force:true});
  }
});
