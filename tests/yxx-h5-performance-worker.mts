import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {createYxxH5Runtime} from '../src/yxx-h5-runtime.mjs';

let workerPhase='BOOT';
let appliedMigrations:string[]=[];
function diagnostic(error:unknown){
  const message=error instanceof Error?error.message:'',code=error&&typeof error==='object'&&'code' in error?error.code:null;
  return {phase:workerPhase,code:typeof code==='string'&&/^(?:(?:H5|YXX|ERR)_[A-Z0-9_]+|[A-Z0-9]{5})$/u.test(code)?code:/^H5_[A-Z0-9_]+$/u.test(message)?message:'H5_PERF_WORKER_START_FAILED',error_name:error instanceof Error?error.name:'UnknownError',applied_migrations:appliedMigrations};
}
async function main():Promise<void>{
  workerPhase='IPC';
  assert.ok(process.send&&process.connected,'H5_PERF_WORKER_IPC_REQUIRED');
  workerPhase='REQUIRED_ENV';
  const databaseUrl=process.env.PILOT_DATABASE_URL,privateRoot=process.env.H5_PERF_WORKER_PRIVATE_ROOT,keyText=process.env.H5_PERF_WORKER_MEDIA_KEY,scopeSecret=process.env.H5_PERF_WORKER_SCOPE_SECRET,ffmpegPath=process.env.H5_MEDIA_FFMPEG,ffprobePath=process.env.H5_MEDIA_FFPROBE,proofPath=process.env.H5_WINDOWS_JOB_PROOF_PATH;
  assert.ok(databaseUrl&&privateRoot&&keyText&&scopeSecret&&ffmpegPath&&ffprobePath&&proofPath);
  workerPhase='DATABASE_ADDRESS';const database=new URL(databaseUrl);assert.equal(database.hostname,'127.0.0.1');assert.equal(database.port,'54184');assert.match(database.pathname,/^\/p2_015_h5perf_[a-f0-9_]+$/u);
  workerPhase='PRIVATE_ROOT';
  assert.equal(path.dirname(path.resolve(privateRoot)),path.resolve(tmpdir()));assert.match(path.basename(privateRoot),/^h5-performance-media-[A-Za-z0-9]+$/u);
  workerPhase='JOB_PROOF';const proof:unknown=JSON.parse(await readFile(proofPath,'utf8'));assert.ok(proof&&typeof proof==='object'&&'root_pid' in proof&&proof.root_pid===process.ppid&&'verified_member_before_resume' in proof&&proof.verified_member_before_resume===true);
  workerPhase='MEDIA_KEY';
  const key=Buffer.from(keyText,'base64');assert.equal(key.length,32);
  let externalCalls=0;
  const forbiddenFetch:typeof fetch=async()=>{externalCalls++;throw new Error('H5_PERF_WORKER_EXTERNAL_FORBIDDEN');};
  globalThis.fetch=forbiddenFetch;
  workerPhase='CREATE_POOL';const pool=createPostgresPool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:5000,application_name:'h5_perf_owned_worker'});
  let worker:ReturnType<typeof createYxxH5Runtime>;
  try{workerPhase='CREATE_RUNTIME';worker=createYxxH5Runtime({pool,scopeSecret,role:'WORKER',options:{enabled:true,performanceEnabled:true,privateRoot,key,ffmpegPath,ffprobePath,fetchImpl:forbiddenFetch}});}
  catch(error){await pool.end();key.fill(0);throw error;}
  let stopped=false,chain=Promise.resolve(),rounds=0;
  const send=(value:Record<string,unknown>)=>new Promise<void>((resolve,reject)=>{if(!process.send)return reject(new Error('H5_PERF_WORKER_DISCONNECTED'));process.send(value,error=>error?reject(error):resolve());});
  async function snapshot(){
    const state=worker.media?.ownedResourceState();assert.deepEqual(state,{active:0,plaintext_bytes:0});
    const queue=(await pool.query<{count:number}>('SELECT count(*)::integer AS count FROM intake.web_media_upload')).rows[0];assert.equal(queue?.count,0,'H5_PERF_WORKER_EXPECTED_EMPTY_QUEUE');
    assert.equal(externalCalls,0);return {media:state,pending_media:queue.count,external_calls:externalCalls};
  }
  async function stop(id:string){
    if(stopped)return;stopped=true;
    await worker.close();const state=await snapshot();await pool.end();key.fill(0);
    await send({type:'stopped',id,pid:process.pid,rounds,pool_max:1,pool_ended:true,...state});
    process.disconnect?.();
  }
  process.on('message',(value:unknown)=>{
    chain=chain.then(async()=>{
      assert.ok(value&&typeof value==='object'&&'type' in value&&'id' in value&&typeof value.id==='string');
      if(value.type==='run'){
        assert.equal(stopped,false);const started=performance.now();await worker.runOnce();rounds++;
        await send({type:'round',id:value.id,pid:process.pid,elapsed_ms:performance.now()-started,...await snapshot()});
      }else if(value.type==='stop')await stop(value.id);else throw new Error('H5_PERF_WORKER_INVALID_COMMAND');
    }).catch(async(error:unknown)=>{stopped=true;process.exitCode=1;await worker.close().catch(()=>{});await pool.end().catch(()=>{});key.fill(0);await send({type:'failed',...diagnostic(error),pid:process.pid}).catch(()=>{});process.disconnect?.();});
  });
  process.on('disconnect',()=>{if(!stopped){stopped=true;chain=chain.finally(async()=>{await worker.close();await pool.end();key.fill(0);}).catch(()=>{process.exitCode=1;});}});
  try{
    workerPhase='READ_SCHEMA_MARKERS';const wanted=['064_yixiaoxiu_h5_member_service','065_yixiaoxiu_h5_web_media','043_ticket_reopen_rounds','066_yixiaoxiu_h5_media_previews'];
    appliedMigrations=(await pool.query<{migration_id:string}>('SELECT migration_id FROM platform.schema_migration WHERE migration_id=ANY($1::text[]) ORDER BY migration_id',[wanted])).rows.map(row=>row.migration_id).filter(id=>wanted.includes(id));
    workerPhase='READY_SCHEMA';assert.equal(await worker.ready(),true,'H5_PERF_WORKER_NOT_READY');workerPhase='INITIAL_RUN';await worker.runOnce();workerPhase='EMPTY_SNAPSHOT';
    await send({type:'ready',pid:process.pid,parent_pid:process.ppid,pool_max:1,role:'WORKER',job_membership:'EXTERNAL_JOB_PID_SAMPLES_REQUIRED',...await snapshot()});
  }catch(error){stopped=true;await worker.close().catch(()=>{});await pool.end().catch(()=>{});key.fill(0);throw error;}
}
await main().catch((error:unknown)=>{process.stderr.write(JSON.stringify(diagnostic(error))+'\n');process.exitCode=1;process.disconnect?.();});
