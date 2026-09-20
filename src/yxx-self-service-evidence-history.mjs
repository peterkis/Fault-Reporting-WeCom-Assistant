import assert from 'node:assert/strict';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Last independently observed published r6 head. Never derive this trust anchor
// from HEAD or a mutable report. Subsequent committed evidence is append-only.
export const SS009_PUBLISHED_EVIDENCE_ANCHOR='a1a48f9839315d7683d9973a1d9febfd14aa39a8';
const textEvidence=/\.(?:json|jsonl|ndjson|md|tap|txt|log|csv|tsv|ya?ml|xml|html|sql|mjs|js|ps1|sh)$/iu;
const blobHash=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const fail=(code,details={})=>{throw Object.assign(new Error(code),{code,...details});};
const records=text=>text.split('\0').filter(Boolean);

// anchor is injectable only for synthetic Git fixtures. The production caller
// passes no override. This function is read-only and never trusts diff's index
// stat cache, assume-unchanged/skip-worktree bits, rename detection or textconv.
export function verifyYxxEvidenceHistory(root,{anchor=SS009_PUBLISHED_EVIDENCE_ANCHOR}={}){
  assert.match(anchor,/^[a-f0-9]{40}$/u);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  env.GIT_NO_REPLACE_OBJECTS='1';
  const git=args=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  let head;
  try{
    assert.equal(git(['rev-parse','--is-shallow-repository']).trim(),'false');
    assert.equal(git(['for-each-ref','--format=%(refname)','refs/replace/']).trim(),'');
    const graft=path.resolve(root,git(['rev-parse','--git-path','info/grafts']).trim());
    assert.ok(!existsSync(graft)||readFileSync(graft,'utf8').trim()==='');
    assert.equal(git(['rev-parse',anchor+'^{commit}']).trim(),anchor);
    git(['merge-base','--is-ancestor',anchor,'HEAD']);
    head=git(['rev-parse','HEAD']).trim();
  }catch{fail('SS009_EVIDENCE_HISTORY_UNAVAILABLE',{anchor});}

  // Walk changes, not just endpoint differences: a rewrite followed by a revert
  // must not erase the audit violation. Separate merge diffs cover both parents.
  // --no-renames makes a rename a protected deletion plus a permitted addition.
  const rewritten=[...new Set(records(git(['log','--format=','--name-only','-z','--no-renames',
    '--diff-filter=a','--full-history','--diff-merges=separate',anchor+'..'+head,'--','evidence/'])))].sort();
  if(rewritten.length)fail('SS009_PUBLISHED_EVIDENCE_CHANGED',{layer:'HISTORY',anchor,files:rewritten});

  const parse=entry=>{const tab=entry.indexOf('\t');assert.ok(tab>0);return [entry.slice(tab+1),entry.slice(0,tab).split(' ')];};
  const committed=new Map(records(git(['ls-tree','-r','-z','--full-tree',head,'--','evidence/'])).map(entry=>{
    const [name,[mode,type,oid]]=parse(entry);return [name,{mode,type,oid}];
  }));
  if(!committed.size)fail('SS009_EVIDENCE_HISTORY_UNAVAILABLE',{anchor});
  const index=new Map();
  for(const entry of records(git(['ls-files','--stage','-z','--','evidence/']))){
    const [name,[mode,oid,stage]]=parse(entry);
    if(stage!=='0')fail('SS009_PUBLISHED_EVIDENCE_CHANGED',{layer:'INDEX',files:[name]});
    index.set(name,{mode,oid});
  }
  const issues=[],directories=new Set();
  for(const [name,entry] of committed){
    const staged=index.get(name);
    if(!staged||staged.mode!==entry.mode||staged.oid!==entry.oid){issues.push({file:name,layer:'INDEX'});continue;}
    try{
      assert.ok(entry.type==='blob'&&['100644','100755'].includes(entry.mode));
      assert.ok(name.startsWith('evidence/')&&!path.isAbsolute(name)&&!name.split('/').includes('..'));
      const parts=name.split('/');let directory=root;
      for(const part of parts.slice(0,-1)){
        directory=path.join(directory,part);
        if(!directories.has(directory)){
          const stat=lstatSync(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());directories.add(directory);
        }
      }
      const file=path.join(root,name),stat=lstatSync(file);
      assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=64*1024*1024);
      if(process.platform!=='win32')assert.equal(stat.mode&0o111? '100755':'100644',entry.mode);
      const raw=readFileSync(file);
      if(blobHash(raw)!==entry.oid){
        // Preserve the repository's UTF8_LF evidence convention on Windows.
        // Unknown and binary formats are byte-exact; never normalize images.
        assert.ok(textEvidence.test(name));
        const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
        assert.equal(blobHash(Buffer.from(text.replaceAll('\r\n','\n'))),entry.oid);
      }
    }catch{issues.push({file:name,layer:'WORKTREE'});}
  }
  if(issues.length)fail('SS009_PUBLISHED_EVIDENCE_CHANGED',{anchor,files:[...new Set(issues.map(x=>x.file))].sort(),issues});
  return {status:'SS009_EVIDENCE_HISTORY_VALID',anchor,head,protected_files:committed.size};
}
