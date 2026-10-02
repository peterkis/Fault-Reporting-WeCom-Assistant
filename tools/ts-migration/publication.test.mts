import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,rmdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,record} from './common.mjs';

function fixture(run:(value:{root:string;packet:string;files:Array<{path:string;bytes:number;sha256:string}>;invoke:(packetOverride?:string,expectedPointer?:string)=>ReturnType<typeof spawnSync>})=>void):void {
  const owned=mkdtempSync(path.join(tmpdir(),'yxx-publication-')),root=path.join(owned,'repo'),packet=path.join(owned,'packet');
  try{
    for(const dir of [root,path.join(root,'plans'),path.join(root,'evidence'),packet])mkdirSync(dir);
    execFileSync('git',['init','--quiet','--initial-branch=main',root],{windowsHide:true,stdio:'pipe'});
    const files:Array<{path:string;bytes:number;sha256:string}>=[];
    const save=(relative:string,bytes:Buffer)=>{writeFileSync(path.join(packet,relative),bytes);const ref={path:relative,bytes:bytes.length,sha256:hash(bytes)};files.push(ref);return ref;};
    const raw=save('raw.json',Buffer.from('{"synthetic_parser_fixture":true}\r\n'));
    save('raw.bin',Buffer.from([0,13,10,255]));
    mkdirSync(path.join(packet,'current'));save('current/empty.stderr',Buffer.alloc(0));
    const reference={...raw,path:'evidence/yxx-current-fixture/'+raw.path};
    save('report.json',Buffer.from(JSON.stringify({schema_version:1,contract:'ADR-0027',run_id:'fixture',status:'CURRENT_AUTOMATION_COMPLETE',
      synthetic_parser_fixture:true,live_authorized:false,parent_gate_advanced:false,build:reference,current_runs:[reference],reviews:[reference,reference],
      cleanup:reference,historical:reference,specialized:reference,source_accounting:reference,scenarios:reference,migration_scope:reference})+'\r\n'));
    writeFileSync(path.join(packet,'packet.json'),JSON.stringify({schema_version:1,kind:'CURRENT_EVIDENCE_PACKET',run_id:'fixture',files}));
    const entry=fileURLToPath(new URL('./publish-current-evidence.mjs',import.meta.url));
    const invoke=(packetOverride=packet,expectedPointer?:string)=>spawnSync(process.execPath,[entry,'--packet',packetOverride,
      ...(expectedPointer?['--expected-pointer-sha256',expectedPointer]:[])],{cwd:root,encoding:'utf8',windowsHide:true,timeout:30_000});
    run({root,packet,files,invoke});
  }finally{
    assert.equal(path.dirname(owned),path.resolve(tmpdir()));assert.ok(path.basename(owned).startsWith('yxx-publication-'));
    rmSync(owned,{recursive:true,force:true});
  }
}

test('publication CLI preserves original bytes and never overwrites an existing report or pointer',()=>fixture(({root,packet,files,invoke})=>{
  const first=invoke();assert.equal(first.status,0,String(first.stdout)+String(first.stderr));
  const result=record(JSON.parse(String(first.stdout)) as unknown);assert.equal(result.status,'EVIDENCE_STAGED_NOT_READINESS');assert.equal(result.production_ready,false);
  assert.equal(existsSync(path.join(root,'plans/.yxx-current-publication.lock')),false);
  for(const file of files)assert.ok(readFileSync(path.join(root,'evidence/yxx-current-fixture',file.path)).equals(readFileSync(path.join(packet,file.path))));
  const pointerFile=path.join(root,'plans/yxx-current-readiness.json'),pointer=readFileSync(pointerFile);
  const report=files.find(file=>file.path==='report.json');assert.ok(report);
  assert.deepEqual(JSON.parse(pointer.toString('utf8')) as unknown,{schema_version:1,report:{...report,path:'evidence/yxx-current-fixture/report.json'}});
  const second=invoke();assert.equal(second.status,1);assert.equal(record(JSON.parse(String(second.stdout)) as unknown).error_code,'CURRENT_EVIDENCE_PUBLICATION_EXISTS');
  assert.ok(readFileSync(pointerFile).equals(pointer));
  for(const file of files)assert.ok(readFileSync(path.join(root,'evidence/yxx-current-fixture',file.path)).equals(readFileSync(path.join(packet,file.path))));
}));

test('publication CLI rejects corrupt incomplete escaped and conflicting packets before creating output',()=>{
  const changes:Array<(packet:string,files:Array<{path:string;bytes:number;sha256:string}>)=>void>=[
    packet=>writeFileSync(path.join(packet,'raw.json'),'corrupt'),
    packet=>writeFileSync(path.join(packet,'unlisted.txt'),'unlisted'),
    (_,files)=>{const file=files[0];assert.ok(file);file.path='../raw.json';},
    (_,files)=>{const file=files[0];assert.ok(file);file.path='CON';},
    (_,files)=>{const file=files[0];assert.ok(file);files.push({...file,path:file.path.toUpperCase()});},
    (_,files)=>{const file=files[0];assert.ok(file);file.bytes+=1;},
  ];
  for(const change of changes)fixture(({root,packet,files,invoke})=>{
    change(packet,files);writeFileSync(path.join(packet,'packet.json'),JSON.stringify({schema_version:1,kind:'CURRENT_EVIDENCE_PACKET',run_id:'fixture',files}));
    const result=invoke();assert.equal(result.status,1);
    assert.equal(record(JSON.parse(String(result.stdout)) as unknown).error_code,'CURRENT_EVIDENCE_PACKET_INVALID');
    assert.equal(existsSync(path.join(root,'evidence/yxx-current-fixture')),false);assert.equal(existsSync(path.join(root,'plans/yxx-current-readiness.json')),false);
  });
});

test('publication CLI checks rehashed report references and live authority before writing',()=>{
  for(const mutate of [(report:Record<string,unknown>)=>{report.live_authorized=true;},
    (report:Record<string,unknown>)=>{record(report.build).path='evidence/yxx-current-other/raw.json';},
    (report:Record<string,unknown>)=>{record(report.build).sha256='0'.repeat(64);}])fixture(({root,packet,files,invoke})=>{
      const report=record(JSON.parse(readFileSync(path.join(packet,'report.json'),'utf8')) as unknown);mutate(report);
      const data=Buffer.from(JSON.stringify(report)),entry=files.find(file=>file.path==='report.json');assert.ok(entry);
      writeFileSync(path.join(packet,'report.json'),data);entry.bytes=data.length;entry.sha256=hash(data);
      writeFileSync(path.join(packet,'packet.json'),JSON.stringify({schema_version:1,kind:'CURRENT_EVIDENCE_PACKET',run_id:'fixture',files}));
      const result=invoke();assert.equal(result.status,1);assert.equal(record(JSON.parse(String(result.stdout)) as unknown).error_code,'CURRENT_EVIDENCE_PACKET_INVALID');
      assert.equal(existsSync(path.join(root,'evidence/yxx-current-fixture')),false);
    });
});

test('publication CLI refuses an existing namespace even without a pointer',()=>fixture(({root,invoke})=>{
  const target=path.join(root,'evidence/yxx-current-fixture');mkdirSync(target);writeFileSync(path.join(target,'original.txt'),'keep');
  const result=invoke();assert.equal(result.status,1);assert.equal(record(JSON.parse(String(result.stdout)) as unknown).error_code,'CURRENT_EVIDENCE_PUBLICATION_EXISTS');
  assert.equal(readFileSync(path.join(target,'original.txt'),'utf8'),'keep');assert.equal(existsSync(path.join(root,'plans/yxx-current-readiness.json')),false);
}));

test('publication CLI refuses directory links in input and output paths',()=>{
  for(const linked of ['packet','plans'])fixture(({root,packet,invoke})=>{
    const external=path.join(path.dirname(root),'linked-data');mkdirSync(external);writeFileSync(path.join(external,'original.txt'),'keep');
    const link=linked==='packet'?path.join(packet,'linked'):path.join(root,'plans');
    if(linked==='plans')rmdirSync(link);
    symlinkSync(external,link,process.platform==='win32'?'junction':'dir');
    const result=invoke();assert.equal(result.status,1);assert.equal(record(JSON.parse(String(result.stdout)) as unknown).error_code,'CURRENT_EVIDENCE_PACKET_INVALID');
    assert.equal(readFileSync(path.join(external,'original.txt'),'utf8'),'keep');assert.equal(existsSync(path.join(root,'evidence/yxx-current-fixture')),false);
  });
});

test('publication CLI checks canonical packet location against the repository',()=>fixture(({root,packet,invoke})=>{
  const inside=path.join(root,'inside-packet'),alias=path.join(path.dirname(root),'repository-alias');
  cpSync(packet,inside,{recursive:true});symlinkSync(root,alias,process.platform==='win32'?'junction':'dir');
  const result=invoke(path.join(alias,'inside-packet'));assert.equal(result.status,1);
  assert.equal(record(JSON.parse(String(result.stdout)) as unknown).error_code,'CURRENT_EVIDENCE_PACKET_INVALID');
  assert.equal(existsSync(path.join(root,'evidence/yxx-current-fixture')),false);
}));

test('publication CLI changes the pointer only with its exact prior hash and preserves the earlier report',()=>fixture(({root,packet,files,invoke})=>{
  assert.equal(invoke().status,0);
  const pointerFile=path.join(root,'plans/yxx-current-readiness.json'),previous=readFileSync(pointerFile),original=readFileSync(path.join(root,'evidence/yxx-current-fixture/report.json'));
  const report=record(JSON.parse(readFileSync(path.join(packet,'report.json'),'utf8').replaceAll('yxx-current-fixture/','yxx-current-fixture-next/')) as unknown);
  report.run_id='fixture-next';const data=Buffer.from(JSON.stringify(report)),entry=files.find(file=>file.path==='report.json');assert.ok(entry);
  writeFileSync(path.join(packet,'report.json'),data);entry.sha256=hash(data);entry.bytes=data.length;
  writeFileSync(path.join(packet,'packet.json'),JSON.stringify({schema_version:1,kind:'CURRENT_EVIDENCE_PACKET',run_id:'fixture-next',files}));
  const stale=invoke(packet,'0'.repeat(64));assert.equal(stale.status,1);
  assert.equal(record(JSON.parse(String(stale.stdout)) as unknown).error_code,'CURRENT_EVIDENCE_POINTER_CONFLICT');
  assert.ok(readFileSync(pointerFile).equals(previous));assert.equal(existsSync(path.join(root,'evidence/yxx-current-fixture-next')),false);
  const updated=invoke(packet,hash(previous));assert.equal(updated.status,0,String(updated.stdout)+String(updated.stderr));
  const pointer=record(JSON.parse(readFileSync(pointerFile,'utf8')) as unknown);assert.equal(record(pointer.report).path,'evidence/yxx-current-fixture-next/report.json');
  assert.ok(readFileSync(path.join(root,'evidence/yxx-current-fixture/report.json')).equals(original));
  assert.equal(existsSync(path.join(root,'plans/.yxx-current-publication.lock')),false);
}));

test('publication CLI preserves another publisher lock and does not start writing',()=>fixture(({root,invoke})=>{
  const lock=path.join(root,'plans/.yxx-current-publication.lock');writeFileSync(lock,'existing-owner');
  const result=invoke();assert.equal(result.status,1);assert.equal(record(JSON.parse(String(result.stdout)) as unknown).error_code,'CURRENT_EVIDENCE_PUBLICATION_BUSY');
  assert.equal(readFileSync(lock,'utf8'),'existing-owner');assert.equal(existsSync(path.join(root,'evidence/yxx-current-fixture')),false);
}));
