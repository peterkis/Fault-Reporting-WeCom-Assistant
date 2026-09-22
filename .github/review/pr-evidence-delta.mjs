import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// PR event base/head define this change, not a replacement SS009 trust anchor.
export function verifyPrEvidenceDelta({root=process.cwd(),base,head}={}) {
  for(const ref of [base,head])assert.match(ref??'',/^[a-f0-9]{40}$/u);
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1'},maxBuffer:16*1024*1024}).trim();
  assert.equal(git(['rev-parse','HEAD']),head);
  assert.equal(git(['rev-parse','--is-shallow-repository']),'false');
  git(['merge-base','--is-ancestor',base,head]);
  const changed=git(['log','--format=','--name-only','-z','--no-renames','--diff-filter=a','--full-history','--diff-merges=separate',`${base}..${head}`,'--','evidence/']).split('\0').filter(Boolean);
  assert.deepEqual(changed,[],'PR rewrites or removes committed evidence (including rewrite then restore)');
  return {status:'PR_EVIDENCE_DELTA_PASS_NOT_READINESS',base,head};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.log(JSON.stringify(verifyPrEvidenceDelta({base:process.env.EXPECTED_BASE,head:process.env.EXPECTED_HEAD})));
}
