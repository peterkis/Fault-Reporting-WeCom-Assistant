import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {constants,copyFileSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {hash,record,safeFile,sourceRoot} from './common.mjs';
import {present} from './bootstrap.mjs';

const failure=(code:string):Error=>Object.assign(new Error(code),{code});
function relative(value:unknown):string {
  assert.ok(typeof value==='string'&&value.length>0&&value.length<=1024);
  for(const part of value.split('/')){
    assert.match(part,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,239}$/u);
    assert.equal(part.endsWith('.'),false);
    assert.equal(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),false);
  }
  return value;
}
function directory(target:string):void {const stat=lstatSync(target);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());}
function bytes(root:string,file:string,limit=64*1024*1024):Buffer {
  const target=safeFile(root,relative(file));assert.ok(lstatSync(target).size<=limit);return readFileSync(target);
}
function inventory(root:string,base=''):string[] {
  directory(path.join(root,base));
  return readdirSync(path.join(root,base)).flatMap(name=>{
    const file=relative(base?base+'/'+name:name),stat=lstatSync(path.join(root,file));assert.equal(stat.isSymbolicLink(),false);
    if(stat.isDirectory())return inventory(root,file);assert.ok(stat.isFile());return [file];
  });
}

/** Stage bytes only. Readiness requires the separate strict consumer after rebuild. */
export function publishCurrentEvidence(root:string,packetRoot:string,expectedPointerSha256?:string){
  let writing=false,lockOwned=false;let lock:string|undefined,lockData:Buffer|undefined,pointerTemporary:string|undefined;
  try{
    root=path.resolve(root);packetRoot=path.resolve(packetRoot);
    directory(root);directory(packetRoot);root=realpathSync.native(root);packetRoot=realpathSync.native(packetRoot);
    directory(path.join(root,'plans'));directory(path.join(root,'evidence'));
    const outside=path.relative(root,packetRoot);assert.ok(path.isAbsolute(outside)||outside==='..'||outside.startsWith('..'+path.sep));
    lock=path.join(root,'plans/.yxx-current-publication.lock');lockData=Buffer.from(JSON.stringify({pid:process.pid,token:randomUUID()}));
    try{writeFileSync(lock,lockData,{flag:'wx'});lockOwned=true;}
    catch(error){if(error instanceof Error&&'code' in error&&error.code==='EEXIST')throw failure('CURRENT_EVIDENCE_PUBLICATION_BUSY');throw error;}
    const packet=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(packetRoot,'packet.json',4*1024*1024))) as unknown);
    assert.equal(packet.schema_version,1);assert.equal(packet.kind,'CURRENT_EVIDENCE_PACKET');
    assert.ok(typeof packet.run_id==='string');assert.match(packet.run_id,/^[a-z0-9][a-z0-9-]{0,63}$/u);
    const prefix='evidence/yxx-current-'+packet.run_id,output=path.join(root,prefix),pointer=path.join(root,'plans/yxx-current-readiness.json');
    if(present(output))throw failure('CURRENT_EVIDENCE_PUBLICATION_EXISTS');
    let previousPointer:Buffer|undefined;
    if(present(pointer)){
      if(expectedPointerSha256===undefined)throw failure('CURRENT_EVIDENCE_PUBLICATION_EXISTS');
      assert.match(expectedPointerSha256,/^[a-f0-9]{64}$/u);previousPointer=bytes(root,'plans/yxx-current-readiness.json',64*1024);
      if(hash(previousPointer)!==expectedPointerSha256)throw failure('CURRENT_EVIDENCE_POINTER_CONFLICT');
    }else if(expectedPointerSha256!==undefined)throw failure('CURRENT_EVIDENCE_POINTER_CONFLICT');
    assert.ok(Array.isArray(packet.files)&&packet.files.length>0&&packet.files.length<=4096);
    const files=packet.files.map(value=>{
      const item=record(value);assert.deepEqual(Object.keys(item).sort(),['bytes','path','sha256']);
      const file=relative(item.path);assert.notEqual(file,'packet.json');
      assert.ok(typeof item.bytes==='number'&&Number.isSafeInteger(item.bytes)&&item.bytes>=0&&item.bytes<=64*1024*1024);
      assert.ok(typeof item.sha256==='string');assert.match(item.sha256,/^[a-f0-9]{64}$/u);
      return {path:file,bytes:item.bytes,sha256:item.sha256};
    });
    assert.equal(new Set(files.map(item=>item.path.toLowerCase())).size,files.length);
    assert.ok(files.reduce((total,item)=>total+item.bytes,0)<=256*1024*1024);
    assert.deepEqual(inventory(packetRoot).filter(file=>file!=='packet.json').sort(),files.map(item=>item.path).sort());
    for(const item of files){const data=bytes(packetRoot,item.path);assert.equal(data.length,item.bytes);assert.equal(hash(data),item.sha256);}
    const reportFile=files.find(item=>item.path==='report.json');assert.ok(reportFile);
    const catalogFile=files.find(item=>item.path==='artifact-catalog.json');assert.ok(catalogFile);
    const attestationFile=files.find(item=>item.path==='artifact-catalog-attestation.json');assert.ok(attestationFile);
    const report=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes(packetRoot,'report.json'))) as unknown);
    assert.equal(report.schema_version,1);assert.equal(report.contract,'ADR-0027');assert.equal(report.run_id,packet.run_id);
    assert.equal(report.status,'CURRENT_AUTOMATION_COMPLETE');assert.equal(report.live_authorized,false);assert.equal(report.parent_gate_advanced,false);
    const reference=(value:unknown)=>{
      const ref=record(value);assert.deepEqual(Object.keys(ref).sort(),['bytes','path','sha256']);
      assert.ok(typeof ref.path==='string'&&ref.path.startsWith(prefix+'/'));
      const file=relative(ref.path.slice(prefix.length+1)),entry=files.find(item=>item.path===file);assert.ok(entry);
      assert.equal(ref.bytes,entry.bytes);assert.equal(ref.sha256,entry.sha256);
    };
    for(const field of ['build','cleanup','historical','specialized','source_accounting','scenarios','migration_scope'])reference(report[field]);
    assert.ok(Array.isArray(report.current_runs)&&report.current_runs.length>0);report.current_runs.forEach(reference);
    assert.ok(Array.isArray(report.reviews)&&report.reviews.length===2);report.reviews.forEach(reference);
    writing=true;mkdirSync(output); // exclusive namespace; never reuse a previous attempt
    for(const item of files){
      let parent=output;
      for(const part of item.path.split('/').slice(0,-1)){parent=path.join(parent,part);if(!present(parent))mkdirSync(parent);directory(parent);}
      copyFileSync(safeFile(packetRoot,item.path),path.join(output,item.path),constants.COPYFILE_EXCL);
      const copied=bytes(output,item.path);assert.equal(copied.length,item.bytes);assert.equal(hash(copied),item.sha256);
    }
    const reportReference={...reportFile,path:prefix+'/report.json'};
    // New pointers are exclusive. Replacements require the exact previous bytes,
    // are serialized with other publishers, and use an atomic same-directory rename.
    const pointerBytes=JSON.stringify({schema_version:2,report:reportReference,
      artifact_catalog:{...catalogFile,path:prefix+'/'+catalogFile.path},
      artifact_catalog_attestation:{...attestationFile,path:prefix+'/'+attestationFile.path}},null,2)+'\n';
    if(previousPointer){
      if(!bytes(root,'plans/yxx-current-readiness.json',64*1024).equals(previousPointer))throw failure('CURRENT_EVIDENCE_POINTER_CONFLICT');
      pointerTemporary=path.join(root,'plans/.yxx-current-pointer-'+randomUUID()+'.tmp');
      writeFileSync(pointerTemporary,pointerBytes,{flag:'wx'});renameSync(pointerTemporary,pointer);pointerTemporary=undefined;
    }else writeFileSync(pointer,pointerBytes,{flag:'wx'});
    return {ok:true,status:'EVIDENCE_STAGED_NOT_READINESS',run_id:packet.run_id,files_staged:files.length,
      report_path:reportReference.path,report_sha256:reportReference.sha256,production_ready:false,live_authorized:false};
  }catch(error){
    if(error instanceof Error&&'code' in error&&['CURRENT_EVIDENCE_PUBLICATION_EXISTS','CURRENT_EVIDENCE_POINTER_CONFLICT','CURRENT_EVIDENCE_PUBLICATION_BUSY'].includes(String(error.code)))throw error;
    throw failure(writing?'CURRENT_EVIDENCE_PUBLICATION_FAILED':'CURRENT_EVIDENCE_PACKET_INVALID');
  }finally{
    if(pointerTemporary&&present(pointerTemporary)){directory(path.dirname(pointerTemporary));assert.equal(lstatSync(pointerTemporary).isSymbolicLink(),false);unlinkSync(pointerTemporary);}
    if(lockOwned&&lock&&lockData){directory(path.dirname(lock));assert.equal(lstatSync(lock).isSymbolicLink(),false);assert.ok(readFileSync(lock).equals(lockData));unlinkSync(lock);}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==='--help')console.log('Usage: node .build/tools/publish-current-evidence.mjs --packet <absolute-directory> [--expected-pointer-sha256 <sha256>]\nStages a new immutable evidence namespace. Pointer replacement requires its prior hash. Rebuild and run strict readiness separately.');
    else{
      const packet=args[1],expected=args[3];
      if(![2,4].includes(args.length)||args[0]!=='--packet'||!packet||!path.isAbsolute(packet)
        ||args.length===4&&(args[2]!=='--expected-pointer-sha256'||!expected||!/^[a-f0-9]{64}$/u.test(expected)))throw failure('CURRENT_EVIDENCE_PUBLICATION_ARGUMENTS');
      console.log(JSON.stringify(publishCurrentEvidence(sourceRoot(),packet,expected)));
    }
  }catch(error){
    const code=error instanceof Error&&'code' in error&&typeof error.code==='string'&&/^CURRENT_EVIDENCE_[A-Z_]+$/u.test(error.code)?error.code:'CURRENT_EVIDENCE_PUBLICATION_FAILED';
    console.log(JSON.stringify({ok:false,error_code:code,production_ready:false,live_authorized:false}));process.exitCode=1;
  }
}
