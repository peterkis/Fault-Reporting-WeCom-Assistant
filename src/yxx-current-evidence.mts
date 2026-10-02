import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { g2CandidateInventory, isG2CandidatePath } from './p2-g2-candidate.mjs';

export const CURRENT_YXX_POINTER='plans/yxx-current-readiness.json';
type Reference={path:string;sha256:string;bytes:number};
const isObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const object=(value:unknown):Record<string,unknown>=>{
  assert.ok(isObject(value));return value;
};
const hash=(bytes:Buffer):string=>createHash('sha256').update(bytes).digest('hex');
function read(root:string,relative:string):Buffer {
  assert.ok(!path.isAbsolute(relative)&&!relative.includes('\\'));
  let current=root;
  for(const part of relative.split('/')){
    assert.ok(part&&part!=='.'&&part!=='..');current=path.join(current,part);
    assert.equal(lstatSync(current).isSymbolicLink(),false);
  }
  const stat=lstatSync(current);assert.ok(stat.isFile()&&stat.size<=64*1024*1024);
  return readFileSync(current);
}
const json=(bytes:Buffer):Record<string,unknown>=>object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown);

/** Reads integrity-bound current evidence; this alone never proves readiness. */
export function readCurrentYxxReport(root:string):{reference:Reference;report:Record<string,unknown>} {
  if(!existsSync(path.join(root,CURRENT_YXX_POINTER)))throw Object.assign(new Error('CURRENT_EVIDENCE_REQUIRED'),{code:'CURRENT_EVIDENCE_REQUIRED',stage:'EVIDENCE'});
  try{
    const pointer=json(read(root,CURRENT_YXX_POINTER));
    assert.deepEqual(Object.keys(pointer).sort(),['report','schema_version']);assert.equal(pointer.schema_version,1);
    const ref=object(pointer.report);
    assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);
    assert.equal(typeof ref.path,'string');assert.equal(typeof ref.sha256,'string');assert.equal(typeof ref.bytes,'number');
    assert.ok(typeof ref.path==='string'&&typeof ref.sha256==='string'&&typeof ref.bytes==='number');
    assert.match(ref.path,/^evidence\/yxx-current-[a-z0-9][a-z0-9-]{0,63}\/report\.json$/u);
    assert.match(ref.sha256,/^[a-f0-9]{64}$/u);assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>0);
    const bytes=read(root,ref.path);assert.equal(bytes.length,ref.bytes);assert.equal(hash(bytes),ref.sha256);
    return {reference:{path:ref.path,sha256:ref.sha256,bytes:ref.bytes},report:json(bytes)};
  }catch{
    throw Object.assign(new Error('CURRENT_EVIDENCE_INVALID'),{code:'CURRENT_EVIDENCE_INVALID',stage:'EVIDENCE'});
  }
}

/** Candidate identity is necessary, but is not execution or review evidence. */
export function verifyCurrentYxxReportBinding(root:string,report:Record<string,unknown>):void {
  try{
    assert.equal(report.schema_version,1);assert.equal(report.contract,'ADR-0027');
    for(const field of ['tested_head','tested_tree']){
      assert.equal(typeof report[field],'string');assert.match(String(report[field]),/^[a-f0-9]{40}$/u);
    }
    assert.ok(typeof report.tested_head==='string'&&typeof report.tested_tree==='string');
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const {reference}=readCurrentYxxReport(root);
    assert.equal(reference.path,'evidence/yxx-current-'+report.run_id+'/report.json');
    const inventory=g2CandidateInventory(root);assert.equal(report.candidate_fingerprint,inventory.fingerprint);
    for(const [field,file] of [['scope_sha256','plans/yxx-current-readiness-scope.json'],
      ['acceptance_sha256','plans/yxx-current-readiness-acceptance.json']]){
      assert.ok(field&&file);
      assert.equal(report[field],hash(Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(read(root,file)).replaceAll('\r\n','\n'))));
    }
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));env.GIT_NO_REPLACE_OBJECTS='1';
    const git=(args:string[]):string=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
    assert.equal(git(['rev-parse',report.tested_head+'^{tree}']).trim(),report.tested_tree);
    git(['merge-base','--is-ancestor',report.tested_head,'HEAD']);
    const entries=new Map(git(['ls-tree','-r','-z',report.tested_head]).split('\0').filter(Boolean).map(line=>{
      const tab=line.indexOf('\t');assert.ok(tab>0);return [line.slice(tab+1),line.slice(0,tab).split(' ')];
    }));
    const indexed=new Map(git(['ls-files','--stage','-z']).split('\0').filter(Boolean).map(line=>{
      const tab=line.indexOf('\t');assert.ok(tab>0);return [line.slice(tab+1),line.slice(0,tab).split(' ')];
    }));
    assert.deepEqual([...entries.keys()].filter(isG2CandidatePath).sort(),inventory.files.map(file=>file.path).sort());
    for(const file of inventory.files){
      const entry=entries.get(file.path),index=indexed.get(file.path);assert.ok(entry&&index);
      assert.equal(entry[1],'blob');assert.equal(index[0],entry[0]);assert.equal(index[1],entry[2]);assert.equal(index[2],'0');
      const raw=read(root,file.path),bytes=file.encoding==='BINARY'?raw:Buffer.from(new TextDecoder('utf-8',{fatal:true}).decode(raw).replaceAll('\r\n','\n'));
      assert.equal(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),entry[2]);
      if(process.platform!=='win32')assert.equal(lstatSync(path.join(root,file.path)).mode&0o111?'100755':'100644',entry[0]);
    }
  }catch{
    throw Object.assign(new Error('CURRENT_CANDIDATE_MISMATCH'),{code:'CURRENT_CANDIDATE_MISMATCH',stage:'CANDIDATE'});
  }
}
