import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import adjudicated from './pr21-evidence-exceptions.json' with {type:'json'};

// PR event base/head define this change, not a replacement SS009 trust anchor.
export function verifyPrEvidenceDelta({root=process.cwd(),base,head}={}) {
  for(const ref of [base,head])assert.match(ref??'',/^[a-f0-9]{40}$/u);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  env.GIT_NO_REPLACE_OBJECTS='1';
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,env,maxBuffer:16*1024*1024});
  assert.equal(git(['rev-parse','HEAD']).trim(),head);
  assert.equal(git(['rev-parse','--is-shallow-repository']).trim(),'false');
  git(['merge-base','--is-ancestor',base,head]);
  const changed=[],accepted=[];
  // Check every parent edge, retaining rewrite-restore and merge-side changes.
  // No path or date exemption: only the owner-adjudicated, exact transitions.
  for(const line of git(['rev-list','--parents',`${base}..${head}`]).trim().split('\n').filter(Boolean)){
    const [commit,...parents]=line.split(' ');
    for(const parent of parents){
      const raw=git(['diff-tree','-r','--raw','-z','--no-abbrev','--no-renames','--no-ext-diff','--diff-filter=a',parent,commit,'--','evidence/']).split('\0').filter(Boolean);
      assert.equal(raw.length%2,0);
      for(let i=0;i<raw.length;i+=2){
        const [oldMode,newMode,before,after,status]=raw[i].slice(1).split(' ');
        const change={commit,parent,path:raw[i+1],before,after,oldMode,newMode,status};
        const allowed=adjudicated.some(entry=>Object.keys(change).every(key=>entry[key]===change[key]));
        (allowed?accepted:changed).push(change);
      }
    }
  }
  assert.deepEqual(changed,[],'PR rewrites or removes committed evidence (including rewrite then restore)');
  return {status:'PR_EVIDENCE_DELTA_PASS_NOT_READINESS',base,head,adjudicated_changes:accepted};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  console.log(JSON.stringify(verifyPrEvidenceDelta({base:process.env.EXPECTED_BASE,head:process.env.EXPECTED_HEAD})));
}
