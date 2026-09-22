import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
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
  }finally{
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.match(path.basename(root),/^pr-evidence-test-/u);
    rmSync(root,{recursive:true,force:true});
  }
});
