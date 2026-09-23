import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import adjudicated from './pr21-evidence-exceptions.json' with {type:'json'};
const records=text=>text.split('\0').filter(Boolean);

// PR event base/head define this change, not a replacement SS009 trust anchor.
export function verifyPrEvidenceDelta({root=process.cwd(),base,head}={}) {
  for(const ref of [base,head])assert.match(ref??'',/^[a-f0-9]{40}$/u);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  env.GIT_NO_REPLACE_OBJECTS='1';
  const gitOptions={cwd:root,encoding:'utf8',windowsHide:true,env,maxBuffer:16*1024*1024};
  const git=args=>execFileSync('git',args,gitOptions);
  const isAncestor=(ancestor,descendant)=>{
    const result=spawnSync('git',['merge-base','--is-ancestor',ancestor,descendant],gitOptions);
    if(result.error)throw result.error;
    if(result.status===0)return true;
    if(result.status===1)return false;
    throw new Error(`git merge-base failed with status ${result.status}`);
  };
  assert.equal(git(['rev-parse','HEAD']).trim(),head);
  assert.equal(git(['rev-parse','--is-shallow-repository']).trim(),'false');
  git(['merge-base','--is-ancestor',base,head]);
  const changed=[],accepted=[];
  // Check every parent edge, retaining rewrite-restore and merge-side changes.
  // No path or date exemption: only the owner-adjudicated, exact transitions.
  for(const line of git(['rev-list','--parents',`${base}..${head}`]).trim().split('\n').filter(Boolean)){
    const [commit,...parents]=line.split(' ');
    const baseParents=parents.length>1?parents.filter(parent=>isAncestor(parent,base)):[];
    const baseParent=baseParents.length===1?baseParents[0]:undefined;
    const prParent=baseParent?parents.find(parent=>parent!==baseParent):undefined;
    const prTouched=new Set();
    if(prParent){
      const common=git(['merge-base',base,prParent]).trim();
      for(const path of records(git(['log','--format=','--name-only','-z','--no-renames','--full-history','--diff-merges=separate',`${common}..${prParent}`,'--','evidence/']))){
        prTouched.add(path);
      }
    }
    for(const parent of parents){
      // A synchronization merge imports the current base into an older PR
      // branch. Its non-base parent sees base evidence as a false rewrite;
      // inspect only PR-touched paths on that edge. A path imported solely
      // from base is ignored, but an add/add collision remains visible.
      const prEdge=prParent===parent;
      const filter=prEdge?'ACDMRT':'a';
      const raw=git(['diff-tree','-r','--raw','-z','--no-abbrev','--no-renames','--no-ext-diff',`--diff-filter=${filter}`,parent,commit,'--','evidence/']).split('\0').filter(Boolean);
      assert.equal(raw.length%2,0);
      for(let i=0;i<raw.length;i+=2){
        const [oldMode,newMode,before,after,status]=raw[i].slice(1).split(' ');
        const change={commit,parent,path:raw[i+1],before,after,oldMode,newMode,status};
        if(prEdge&&!prTouched.has(change.path))continue;
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
