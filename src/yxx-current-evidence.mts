import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { g2CandidateInventory, isG2CandidatePath } from './p2-g2-candidate.mjs';
import { assertG2EvidenceTime } from './p2-g2-evidence-time.mjs';

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
const strings=(value:unknown):string[]=>{
  assert.ok(Array.isArray(value)&&value.every((item:unknown)=>typeof item==='string'));
  const result:string[]=value;assert.equal(new Set(result).size,result.length);return result;
};
const countKeys=['tests','pass','fail','cancelled','skipped','todo'] as const;
function tapCounts(text:string):Record<typeof countKeys[number],number>{
  const result={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
  for(const key of countKeys){
    const value=[...text.matchAll(new RegExp('^# '+key+' (\\d+)\\r?$','gmu'))].at(-1)?.[1];
    assert.ok(value!==undefined);result[key]=Number(value);assert.ok(Number.isSafeInteger(result[key]));
  }
  assert.ok(result.tests>0);assert.equal(result.tests,result.pass);
  for(const key of ['fail','cancelled','skipped','todo'] as const)assert.equal(result[key],0);
  assert.equal(/^\s*not ok \d+/mu.test(text),false);
  return result;
}
function artifact(root:string,runId:string,value:unknown):{path:string;bytes:Buffer} {
  const ref=object(value);assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);
  assert.ok(typeof ref.path==='string'&&typeof ref.sha256==='string'&&typeof ref.bytes==='number');
  assert.ok(ref.path.startsWith('evidence/yxx-current-'+runId+'/'));
  assert.match(ref.sha256,/^[a-f0-9]{64}$/u);assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>=0);
  const bytes=read(root,ref.path);assert.equal(bytes.length,ref.bytes);assert.equal(hash(bytes),ref.sha256);
  return {path:ref.path,bytes};
}

/** Complete current file coverage; historical files never count toward this set. */
export function verifyCurrentYxxExecution(root:string,report:Record<string,unknown>):void {
  try{
    assert.ok(typeof report.run_id==='string');assert.match(report.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const contract=json(read(root,'plans/yxx-current-readiness-acceptance.json'));
    assert.equal(contract.schema_version,1);assert.equal(contract.contract,'ADR-0027');assert.equal(contract.live_authorized,false);
    const expected=strings(contract.current_files),historical=strings(contract.historical_registered_files);
    assert.deepEqual(historical,['tests/yxx-ss-008-validation-scope.test.mjs']);
    const registry=json(read(root,'plans/typescript-migration/test-routing.json'));
    assert.ok(Array.isArray(registry.entries));
    const entries=registry.entries.map(object);assert.deepEqual([...expected,...historical].sort(),entries.map(entry=>entry.path).sort());
    assert.ok(Array.isArray(report.current_runs)&&report.current_runs.length>0);
    const buildReference=artifact(root,report.run_id,report.build),build=json(buildReference.bytes);
    const currentBuild=json(read(root,'.build/runtime/build-manifest.json')),sourceIdentity=object(build.source);
    assert.equal(build.schema_version,1);assert.equal(build.status,'STAGED_NOT_ACTIVATED');assert.equal(build.node_major,24);
    assert.equal(build.compiler,currentBuild.compiler);assert.equal(sourceIdentity.dirty,false);
    for(const key of ['head','tree'])assert.match(String(sourceIdentity[key]),/^[a-f0-9]{40}$/u);
    assert.equal(sourceIdentity.head,report.tested_head);assert.equal(sourceIdentity.tree,report.tested_tree);
    assert.deepEqual(build.outputs,currentBuild.outputs);assert.deepEqual(sourceIdentity.inputs,object(currentBuild.source).inputs);
    assert.equal(sourceIdentity.input_hash,hash(Buffer.from(JSON.stringify(sourceIdentity.inputs))));
    assert.ok(Array.isArray(sourceIdentity.inputs)&&Array.isArray(build.outputs));
    const inputs=sourceIdentity.inputs.map(object),outputs=build.outputs.map(object);
    assert.equal(new Set(inputs.map(input=>input.path)).size,inputs.length);assert.equal(new Set(outputs.map(output=>output.path)).size,outputs.length);
    const selected:string[]=[],executed:string[]=[];
    for(const reference of report.current_runs){
      const source=artifact(root,report.run_id,reference),run=json(source.bytes);
      assert.equal(run.status,'SELECTED_TESTS_PASS');assert.equal(run.representation,'EXPLICIT_ROUTED_HOSTS');
      assert.equal(run.manifest_sha256,hash(buildReference.bytes));
      assert.equal(run.production_ready,false);assert.deepEqual(run.not_run,[]);
      const declared=strings(run.selected_files);assert.ok(declared.length>0);selected.push(...declared);
      assert.ok(Array.isArray(run.files));const files=run.files.map(object);
      assert.deepEqual(files.map(file=>file.path).sort(),[...declared].sort());
      const total={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
      for(const file of files){
        assert.equal(file.status,'PASS');assert.equal(file.exit_code,0);assert.equal(file.signal,null);
        assert.ok(typeof file.path==='string');executed.push(file.path);
        const originals=new Map<string,Buffer>();
        for(const kind of ['tap','stderr','case_trace']){
          const name=file[kind+'_path'];assert.ok(typeof name==='string');assert.match(name,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,240}$/u);
          const original=artifact(root,report.run_id,{path:path.posix.dirname(source.path)+'/'+name,
            sha256:file[kind+'_sha256'],bytes:file[kind+'_bytes']});
          originals.set(kind,original.bytes);
        }
        const tap=originals.get('tap');assert.ok(tap);
        const tapText=new TextDecoder('utf-8',{fatal:true}).decode(tap).replaceAll('\r\n','\n');
        const actual=tapCounts(tapText);assert.deepEqual(file.counts,actual);
        for(const key of countKeys)total[key]+=actual[key];
        const route=entries.find(entry=>entry.path===file.path);assert.ok(route);
        assert.ok(['SOURCE_HOST','STAGED_RUNTIME','MIXED_EXPLICIT_ROOTS'].includes(String(route.mode)));
        assert.equal(file.mode,route.mode);const sourceHost=route.mode==='SOURCE_HOST';
        if(sourceHost)assert.equal(file.path.endsWith('.mts'),false);
        const cwd=sourceHost?'.':'.build/runtime';
        const executedPath=sourceHost?file.path:'.build/runtime/'+file.path.replace(/\.mts$/u,'.mjs');
        assert.equal(file.execution_cwd,cwd);assert.equal(file.executed_path,executedPath);assert.equal(file.case_line_basis,'EXECUTED_FILE');
        const logical=file.path.replace(/\.mts$/u,'.mjs'),input=inputs.find(input=>input.path===file.path),output=outputs.find(output=>output.path===logical);
        assert.ok(input);assert.equal(file.runtime_path,logical);
        assert.equal(file.source_sha256,input.sha256);assert.equal(file.source_sha256,hash(read(root,file.path)));
        if(!sourceHost){
          assert.ok(output);assert.equal(output.source,file.path);assert.equal(output.kind,file.path.endsWith('.mts')?'COMPILED':'LEGACY');
          assert.equal(file.executed_sha256,output.sha256);
        }else assert.equal(file.executed_sha256,input.sha256);
        assert.equal(file.executed_sha256,hash(read(root,executedPath)));
        const loaded=strings(file.loaded_project_files);assert.ok(loaded.includes(executedPath));
        for(const loadedFile of loaded){
          assert.ok(!path.posix.isAbsolute(loadedFile)&&!loadedFile.includes('\\')&&!loadedFile.split('/').includes('..'));
          assert.equal(loadedFile.startsWith('src/'),false);
          if(!sourceHost)assert.equal(/^(?:src|scripts|tests)\//u.test(loadedFile),false);
        }
        const trace=originals.get('case_trace');assert.ok(trace);
        const cases=new TextDecoder('utf-8',{fatal:true}).decode(trace).trim().split('\n').map(line=>object(JSON.parse(line) as unknown));
        const suites=[...tapText.matchAll(/^# suites (\d+)$/gmu)].at(-1)?.[1];assert.ok(suites!==undefined);
        assert.equal(cases.length,actual.tests+Number(suites));assert.equal(file.case_count,cases.length);
        const controls:Record<string,string>={'\b':'b','\f':'f','\t':'t','\n':'n','\r':'r','\v':'v'};
        const escaped=(name:string):string=>name.replace(/[\b\f\t\n\r\v]/gu,c=>'\\'+controls[c]).replaceAll('\\','\\\\').replaceAll('#','\\#');
        const observed=cases.map(item=>{
          assertG2EvidenceTime(item);assert.equal(item.time_basis,'REPORTER_OBSERVED_AT');
          assert.equal(item.event,'test:pass');assert.equal(item.skip,false);assert.equal(item.todo,false);
          assert.ok(typeof item.name==='string'&&typeof item.file==='string');
          assert.ok(typeof item.nesting==='number'&&Number.isSafeInteger(item.nesting)&&item.nesting>=0);
          assert.ok(typeof item.line==='number'&&Number.isSafeInteger(item.line)&&item.line>0);
          assert.ok(!path.posix.isAbsolute(item.file)&&!item.file.includes('\\'));
          const actualFile=path.posix.normalize(path.posix.join(cwd,item.file));assert.ok(loaded.includes(actualFile));
          return JSON.stringify([item.nesting,escaped(item.name)]);
        });
        const successes=[...tapText.matchAll(/^( *)ok \d+ - (.+)$/gmu)].map(match=>{
          const indent=match[1],name=match[2];assert.ok(indent!==undefined&&name!==undefined);assert.equal(indent.length%4,0);
          return JSON.stringify([indent.length/4,name]);
        });
        assert.deepEqual(observed.sort(),successes.sort());
      }
      assert.deepEqual(run.counts,total);
    }
    assert.deepEqual(selected.sort(),[...expected].sort());assert.deepEqual(executed.sort(),[...expected].sort());
  }catch{
    throw Object.assign(new Error('CURRENT_EXECUTION_INVALID'),{code:'CURRENT_EXECUTION_INVALID',stage:'EXECUTION'});
  }
}

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
