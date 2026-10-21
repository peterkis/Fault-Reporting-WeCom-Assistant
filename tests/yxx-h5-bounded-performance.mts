import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {appendFile,mkdir,open,readFile,writeFile} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {runH5Performance} from './yxx-h5-performance-harness.mjs';

const execute=promisify(execFile);
const evidenceBase=path.resolve('D:/wecom-workbench-evidence/h5-performance-closure-20261021-b88e5ff1');
function owned(value:string):string{
  const absolute=path.resolve(value),relative=path.relative(evidenceBase,absolute);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'H5_BOUNDED_OWNED_PATH_REQUIRED');
  let current=evidenceBase;
  for(const part of relative.split(path.sep)){
    current=path.join(current,part);if(!existsSync(current))break;
    assert.equal(lstatSync(current).isSymbolicLink(),false,'H5_BOUNDED_REPARSE_PATH_REJECTED');
  }
  return absolute;
}
async function portOpen():Promise<boolean>{
  return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:54184});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>{socket.destroy();resolve(false);});socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});});
}
async function startPostgres(executable:string,data:string,serverLog:string,commandLog:string):Promise<Record<string,unknown>>{
  const log=await open(owned(commandLog),'wx'),started=performance.now(),startedAt=new Date().toISOString();let timer:NodeJS.Timeout|undefined;
  try{
    const result=await new Promise<{exit_code:number|null;signal:string|null}>((resolve,reject)=>{
      const child=spawn(executable,['-D',data,'-l',serverLog,'-w','-t','60','start'],{windowsHide:true,stdio:['ignore',log.fd,log.fd]});
      timer=setTimeout(()=>{child.kill();reject(new Error('H5_BOUNDED_PG_START_TIMEOUT'));},70000);
      child.once('error',()=>reject(new Error('H5_BOUNDED_PG_START_SPAWN_FAILED')));child.once('exit',(code,signal)=>resolve({exit_code:code,signal}));
    });
    assert.equal(result.exit_code,0,'H5_BOUNDED_PG_START_EXIT_FAILED');assert.equal(result.signal,null);
    return {...result,started_at:startedAt,finished_at:new Date().toISOString(),elapsed_ms:performance.now()-started,stdio:'OWNED_FILE_FDS_NO_INHERITED_PIPE',command_log:commandLog};
  }finally{if(timer)clearTimeout(timer);await log.close();}
}
async function main():Promise<void>{
  assert.equal(process.platform,'win32','Windows Job budget launcher required');
  const task=process.env.H5_BOUNDED_TASK??'large',runtimeRoot=process.env.H5_PERFORMANCE_RUNTIME_ROOT,output=process.env.H5_PERFORMANCE_OUTPUT_ROOT,bin=process.env.H5_BOUNDED_PG_BIN,sourceRoot=process.env.TS_MIGRATION_TEST_SOURCE_ROOT;
  assert.ok(runtimeRoot&&path.isAbsolute(runtimeRoot)&&output&&bin&&path.isAbsolute(bin)&&sourceRoot&&path.isAbsolute(sourceRoot));
  assert.ok(['large','qa','registered','worker'].includes(task));
  const pgInstance=process.env.H5_BOUNDED_PG_INSTANCE??'pg';assert.match(pgInstance,/^pg(?:-[a-z0-9]+)*$/u);
  const outputRoot=owned(output),pgRoot=owned(path.join(evidenceBase,pgInstance)),data=owned(path.join(pgRoot,'data'));
  const manifestPath=path.join(runtimeRoot,'build-manifest.json'),manifest=existsSync(manifestPath)?createHash('sha256').update(readFileSync(manifestPath)).digest('hex'):null;
  assert.ok(manifest||process.env.H5_PERFORMANCE_COMPONENT_PREFLIGHT==='1','H5_BOUNDED_COMPILED_IDENTITY_REQUIRED');
  if(process.env.H5_EXPECTED_MANIFEST_SHA256)assert.equal(manifest,process.env.H5_EXPECTED_MANIFEST_SHA256,'H5_BOUNDED_MANIFEST_MISMATCH');
  assert.equal(existsSync(outputRoot),false,'H5_BOUNDED_REPORT_ALREADY_EXISTS');
  const proofPath=process.env.H5_WINDOWS_JOB_PROOF_PATH,limitsPath=process.env.H5_WINDOWS_JOB_LIMITS_PATH;
  assert.ok(proofPath&&limitsPath,'H5_BOUNDED_WINDOWS_JOB_HANDSHAKE_REQUIRED');
  const proofBytes=await readFile(owned(proofPath)),limitsBytes=await readFile(owned(limitsPath)),proof:unknown=JSON.parse(proofBytes.toString('utf8')),limits:unknown=JSON.parse(limitsBytes.toString('utf8'));
  assert.ok(proof&&typeof proof==='object'&&'schema_version' in proof&&proof.schema_version===1&&'root_pid' in proof&&proof.root_pid===process.pid&&'verified_member_before_resume' in proof&&proof.verified_member_before_resume===true&&'suspended_assigned_before_execution' in proof&&proof.suspended_assigned_before_execution===true,'H5_BOUNDED_WINDOWS_JOB_MEMBERSHIP_REQUIRED');
  assert.ok(limits&&typeof limits==='object'&&'kind' in limits&&limits.kind==='WIN32_JOB_OBJECT'&&'cpu_count' in limits&&limits.cpu_count===2&&'cpu_rate_flags' in limits&&limits.cpu_rate_flags===5&&'job_memory_bytes' in limits&&limits.job_memory_bytes===4294967296&&'breakaway_allowed' in limits&&limits.breakaway_allowed===false&&'kill_on_close' in limits&&limits.kill_on_close===true&&'affinity_mask' in limits&&typeof limits.affinity_mask==='string','H5_BOUNDED_WINDOWS_JOB_LIMITS_REQUIRED');
  const bits=BigInt('0x'+limits.affinity_mask).toString(2).replaceAll('0','').length;assert.equal(bits,2,'H5_BOUNDED_TWO_CPU_AFFINITY_REQUIRED');
  const launchProof={proof_path:proofPath,proof_sha256:createHash('sha256').update(proofBytes).digest('hex'),limits_path:limitsPath,limits_sha256:createHash('sha256').update(limitsBytes).digest('hex'),proof,limits};
  await writeFile(outputRoot+'-launch-proof.json',JSON.stringify(launchProof,null,2)+'\n',{flag:'wx'});
  assert.equal(await portOpen(),false,'H5_BOUNDED_PG_PORT_ALREADY_IN_USE');
  assert.equal(existsSync(path.join(data,'postmaster.pid')),false,'H5_BOUNDED_EXISTING_PG_PID_REJECTED');
  const ctl=path.join(bin,'pg_ctl.exe'),psql=path.join(bin,'psql.exe');assert.ok(existsSync(ctl)&&existsSync(psql));
  await mkdir(pgRoot,{recursive:true});
  if(!existsSync(path.join(data,'PG_VERSION'))){
    process.stdout.write(JSON.stringify({phase:'owned-postgres-initializing',instance:pgInstance})+'\n');
    assert.equal(existsSync(data),false,'H5_BOUNDED_PARTIAL_CLUSTER_PRESERVED');
    const result=await execute(path.join(bin,'initdb.exe'),['-D',data,'-U','h5perf','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
    await writeFile(path.join(pgRoot,'initdb.log'),result.stdout+result.stderr,{flag:'wx'});
    await appendFile(path.join(data,'postgresql.conf'),"\nlisten_addresses = '127.0.0.1'\nport = 54184\nmax_connections = 12\nshared_buffers = '128MB'\nwork_mem = '4MB'\n");
  }
  assert.match(await readFile(path.join(data,'PG_VERSION'),'utf8'),/^18\s*$/u);
  const closure:Record<string,unknown>={schema_version:1,task,pg_data:data,port:54184,job_scope:'Root Node + load generator + App/Worker + PostgreSQL descendants, enforced by external Windows Job launcher',launch_proof:launchProof,started_at:new Date().toISOString(),cluster_preserved:true};
  let started=false,primary:unknown;
  try{
    process.stdout.write(JSON.stringify({phase:'owned-postgres-starting',instance:pgInstance})+'\n');
    try{closure.postgres_start=await startPostgres(ctl,data,path.join(pgRoot,'postgres.log'),outputRoot+'-pg-start.log');started=true;}
    catch(error){started=existsSync(path.join(data,'postmaster.pid'))||await portOpen();throw error;}
    process.stdout.write(JSON.stringify({phase:'owned-postgres-ready',instance:pgInstance})+'\n');
    const database=new URL('postgresql://h5perf@127.0.0.1:54184/postgres');
    process.env.PILOT_DATABASE_URL=database.href;process.env.TS_MIGRATION_TEST_DB_ISOLATED='1';process.env.TS_MIGRATION_TEST_RUNTIME_ROOT=runtimeRoot;
    if(task==='registered'){
      assert.equal(createHash('sha256').update(readFileSync(path.join(sourceRoot,'.build/runtime/build-manifest.json'))).digest('hex'),manifest,'H5_BOUNDED_REGISTERED_RUNTIME_IDENTITY_MISMATCH');
      const [runner,routing]=await Promise.all([import(pathToFileURL(path.join(sourceRoot,'.build/tools/run-tests.mjs')).href) as Promise<typeof import('../tools/ts-migration/run-tests.mjs')>,import(pathToFileURL(path.join(sourceRoot,'.build/tools/routing.mjs')).href) as Promise<typeof import('../tools/ts-migration/routing.mjs')>]);
      closure.registered=runner.runSelection(sourceRoot,routing.select(routing.loadRoutes(sourceRoot),'selection','yxx-h5-performance'),{reportDir:outputRoot});
    }else{
      process.env.H5_PERFORMANCE_WORKER_SMOKE=task==='worker'?'1':'0';
      await runH5Performance({runtimeRoot,outputRoot,mode:'current',samples:task==='large'?20:1,warmups:task==='large'?3:0,metricsModule:path.join(sourceRoot,'.build/tools/h5-performance-metrics.mjs'),largeData:false,profile:'main390',largeConcurrency:task==='large'});
    }
    closure.status='PASS';
  }catch(error){primary=error;closure.status='FAIL';closure.error_code=error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:'H5_BOUNDED_VALIDATION_FAILED';}
  finally{
    if(started){
      try{
        const before=await execute(psql,['-X','-h','127.0.0.1','-p','54184','-U','h5perf','-d','postgres','-At','-c',"SELECT json_build_object('server_version',current_setting('server_version'),'synthetic_databases',(SELECT coalesce(json_agg(datname),'[]'::json) FROM pg_database WHERE datname LIKE 'p2_015_%'),'other_clients',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()));"],{windowsHide:true,timeout:15000});
        const snapshot:unknown=JSON.parse(before.stdout.trim());closure.postgres_before_stop=snapshot;
        assert.ok(snapshot&&typeof snapshot==='object'&&'synthetic_databases' in snapshot&&Array.isArray(snapshot.synthetic_databases)&&snapshot.synthetic_databases.length===0&&'other_clients' in snapshot&&snapshot.other_clients===0,'H5_BOUNDED_PG_FIXTURE_LEAK');
      }catch{closure.snapshot_error='PG_BEFORE_STOP_SNAPSHOT_FAILED';primary??=new Error('H5_BOUNDED_PG_FIXTURE_LEAK');}
      try{const stopped=await execute(ctl,['-D',data,'-m','fast','-w','-t','60','stop'],{windowsHide:true,timeout:70000});closure.pg_stop_exit=0;await writeFile(outputRoot+'-pg-stop.log',stopped.stdout+stopped.stderr,{flag:'wx'});}catch{closure.pg_stop_exit=1;primary??=new Error('H5_BOUNDED_PG_STOP_FAILED');}
    }
    closure.postmaster_pid_file_exists=existsSync(path.join(data,'postmaster.pid'));closure.port_listening=await portOpen();closure.finished_at=new Date().toISOString();
    closure.compiled_manifest_sha256=existsSync(manifestPath)?createHash('sha256').update(readFileSync(manifestPath)).digest('hex'):null;
    if(closure.compiled_manifest_sha256!==manifest){closure.manifest_changed=true;primary??=new Error('H5_BOUNDED_MANIFEST_CHANGED');}
    await writeFile(outputRoot+'-resource-closure.json',JSON.stringify(closure,null,2)+'\n',{flag:'wx'});
  }
  assert.equal(closure.postmaster_pid_file_exists,false,'H5_BOUNDED_PG_PID_LEAK');assert.equal(closure.port_listening,false,'H5_BOUNDED_PG_LISTENER_LEAK');
  if(primary)throw new Error('H5_BOUNDED_VALIDATION_FAILED');
}
await main();
