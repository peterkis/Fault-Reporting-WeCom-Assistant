import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,renameSync,symlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {verifyYxxEvidenceHistory} from '../src/yxx-self-service-evidence-history.mjs';

const TARGET='evidence/yxx-ss-009-r5-review-fix-report.md';
const CHANGED='SS009_PUBLISHED_EVIDENCE_CHANGED';
function fixture(fn){
  const root=mkdtempSync(path.join(tmpdir(),'ss009-history-unit-'));
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  const write=(name,data)=>{const file=path.join(root,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,data);};
  const commit=message=>{git('add','--all');git('-c','core.hooksPath='+path.join(root,'no-hooks'),'commit','-m',message);return git('rev-parse','HEAD');};
  try{
    git('init','--initial-branch=main');git('config','user.name','Synthetic history fixture');git('config','user.email','history-fixture@example.invalid');
    git('config','commit.gpgsign','false');git('config','core.autocrlf','false');
    write('evidence/baseline.txt','base\n');const base=commit('pre SS009 base');
    write(TARGET,'published r5\n');write('evidence/nested/r6 note 中文.txt','published r6\n');
    write('evidence/sample.png',Buffer.from([0x89,0x50,0,13,10,0x47]));const anchor=commit('published r6');
    const verify=()=>verifyYxxEvidenceHistory(root,{anchor});
    return fn({root,git,write,commit,base,anchor,verify});
  }finally{
    assert.ok(path.dirname(root)===tmpdir()&&path.basename(root).startsWith('ss009-history-unit-'));
    rmSync(root,{recursive:true,force:true});
  }
}
const rejects=(verify,file=TARGET)=>assert.throws(verify,error=>error.code===CHANGED&&error.files.includes(file));

test('SS-009 history accepts an unchanged published snapshot and new uncommitted evidence',()=>fixture(({verify,write})=>{
  assert.equal(verify().protected_files,4);write('evidence/yxx-ss-009-r7-report.json','{"status":"PENDING"}\n');assert.equal(verify().protected_files,4);
}));
test('SS-009 history reproduces the base-relative A bypass and rejects the rewritten published file',()=>fixture(({base,git,write,verify})=>{
  write(TARGET,'rewritten historical result\n');
  assert.equal(git('diff','--name-only','--diff-filter=MDR',base,'--','evidence'),'');
  rejects(verify);
}));
test('SS-009 history rejects a committed rewrite in a clean checkout',()=>fixture(({write,commit,verify,git})=>{
  write(TARGET,'rewritten\n');commit('rewrite published evidence');assert.equal(git('status','--porcelain'),'');rejects(verify);
}));
test('SS-009 history rejects a committed rewrite even after a restoring commit',()=>fixture(({write,commit,verify,anchor,git})=>{
  write(TARGET,'rewritten\n');commit('rewrite');write(TARGET,'published r5\n');commit('restore');
  assert.equal(git('diff','--name-only',anchor,'HEAD','--','evidence'),'');rejects(verify);
}));
test('SS-009 history rejects staged rewrites hidden by a restored worktree',()=>fixture(({write,git,verify})=>{
  write(TARGET,'staged rewrite\n');git('add',TARGET);write(TARGET,'published r5\n');rejects(verify);
}));
test('SS-009 history rejects worktree rewrites hidden by assume-unchanged',()=>fixture(({git,write,verify})=>{
  git('update-index','--assume-unchanged',TARGET);write(TARGET,'hidden rewrite\n');assert.equal(git('diff','--name-only'),'');rejects(verify);
}));
test('SS-009 history rejects worktree rewrites hidden by skip-worktree',()=>fixture(({git,write,verify})=>{
  git('update-index','--skip-worktree',TARGET);write(TARGET,'hidden rewrite\n');assert.equal(git('diff','--name-only'),'');rejects(verify);
}));
test('SS-009 history rejects deletion of previously published evidence',()=>fixture(({root,verify})=>{
  rmSync(path.join(root,TARGET));rejects(verify);
}));
test('SS-009 history rejects committed renames even when Git rename detection is disabled',()=>fixture(({git,commit,verify})=>{
  git('config','diff.renames','false');git('mv',TARGET,'evidence/renamed.md');commit('rename');rejects(verify);
}));
test('SS-009 history protects new evidence after its first commit without advancing the anchor',()=>fixture(({write,commit,verify})=>{
  const file='evidence/yxx-ss-009-r7-report.json';write(file,'{"status":"PENDING"}\n');commit('add r7');
  assert.equal(verify().protected_files,5);write(file,'{"status":"PASS"}\n');rejects(verify,file);
}));
test('SS-009 history rejects later committed changes to newly added evidence',()=>fixture(({write,commit,verify})=>{
  const file='evidence/yxx-ss-009-r7-report.json';write(file,'{"status":"PENDING"}\n');commit('add r7');
  write(file,'{"status":"PASS"}\n');commit('rewrite r7');rejects(verify,file);
}));
test('SS-009 history accepts documented text CRLF checkout but never normalizes binary evidence',()=>fixture(({write,verify})=>{
  write(TARGET,'published r5\r\n');assert.equal(verify().status,'SS009_EVIDENCE_HISTORY_VALID');
  write('evidence/sample.png',Buffer.from([0x89,0x50,0,10,0x47]));rejects(verify,'evidence/sample.png');
}));
test('SS-009 history rejects indexed file type changes',()=>fixture(({root,git,verify})=>{
  const file=path.join(root,'link-target');writeFileSync(file,'elsewhere');
  const oid=git('hash-object','-w',file);git('update-index','--cacheinfo','120000,'+oid+','+TARGET);rejects(verify);
}));
test('SS-009 history rejects symlinked evidence directories even with identical bytes',()=>fixture(({root,verify})=>{
  renameSync(path.join(root,'evidence/nested'),path.join(root,'owned-copy'));
  symlinkSync(path.join(root,'owned-copy'),path.join(root,'evidence/nested'),'junction');rejects(verify,'evidence/nested/r6 note 中文.txt');
}));
test('SS-009 history accepts a genuine merge preview without treating additions as rewrites',()=>fixture(({base,anchor,git,write,commit,verify})=>{
  git('checkout','-b','preview',base);write('other.txt','base branch change\n');commit('base advances');
  git('-c','commit.gpgsign=false','merge','--no-ff',anchor,'-m','preview');assert.equal(verify().protected_files,4);
}));
test('SS-009 history refuses unavailable or unrelated anchors instead of trusting HEAD',()=>fixture(({root,base,anchor,git})=>{
  assert.throws(()=>verifyYxxEvidenceHistory(root,{anchor:'0'.repeat(40)}),{code:'SS009_EVIDENCE_HISTORY_UNAVAILABLE'});
  git('checkout','--detach',base);assert.throws(()=>verifyYxxEvidenceHistory(root,{anchor}),{code:'SS009_EVIDENCE_HISTORY_UNAVAILABLE'});
}));

test('SS-009 history preserves BOM bytes rather than silently decoding them away',()=>fixture(({write,verify})=>{
  write(TARGET,Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('published r5\n')]));rejects(verify);
}));
test('SS-009 history rejects binary normalization even behind a text extension',()=>fixture(({write,commit,verify})=>{
  const file='evidence/binary.txt';write(file,Buffer.from([0,13,10]));commit('add binary-labelled text');
  assert.equal(verify().protected_files,5);write(file,Buffer.from([0,13,13,10]));rejects(verify,file);
}));
