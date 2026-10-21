import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

interface Pending {resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}
function workerEnvironment(options:{databaseUrl:string;privateRoot:string;key:Uint8Array;scopeSecret:string}):NodeJS.ProcessEnv{
  const environment:NodeJS.ProcessEnv={};
  for(const name of ['SystemRoot','WINDIR','SystemDrive','PATH','PATHEXT','COMSPEC','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMDATA','H5_MEDIA_FFMPEG','H5_MEDIA_FFPROBE','H5_WINDOWS_JOB_PROOF_PATH','H5_WINDOWS_JOB_LIMITS_PATH','H5_WINDOWS_JOB_SAMPLES_PATH']){
    const value=process.env[name];if(value!==undefined)environment[name]=value;
  }
  return {...environment,PILOT_DATABASE_URL:options.databaseUrl,H5_PERF_WORKER_PRIVATE_ROOT:options.privateRoot,H5_PERF_WORKER_MEDIA_KEY:Buffer.from(options.key).toString('base64'),H5_PERF_WORKER_SCOPE_SECRET:options.scopeSecret};
}
export async function startH5PerformanceWorker(options:{runtimeRoot:string;databaseUrl:string;privateRoot:string;key:Uint8Array;scopeSecret:string;outputRoot:string}){
  const pending=new Map<string,Pending>(),observations:Record<string,unknown>[]=[],started=performance.now();let stderr='',stdout='',exitCode:number|null=null,exitSignal:string|null=null,closed=false;
  const child=fork(path.join(options.runtimeRoot,'tests/yxx-h5-performance-worker.mjs'),[],{windowsHide:true,execArgv:[],stdio:['ignore','pipe','pipe','ipc'],env:workerEnvironment(options)});
  child.stdout?.on('data',(bytes:Buffer)=>{if(stdout.length<65536)stdout+=bytes.toString('utf8').slice(0,65536-stdout.length);});
  child.stderr?.on('data',(bytes:Buffer)=>{if(stderr.length<65536)stderr+=bytes.toString('utf8').slice(0,65536-stderr.length);});
  const rejectAll=(error:Error)=>{for(const [id,item]of pending){clearTimeout(item.timer);item.reject(error);pending.delete(id);}};
  const exited=new Promise<void>(resolve=>{child.once('exit',(code,signal)=>{exitCode=code;exitSignal=signal;rejectAll(new Error('H5_PERFORMANCE_WORKER_EXITED'));resolve();});});
  child.once('error',()=>rejectAll(new Error('H5_PERFORMANCE_WORKER_SPAWN_FAILED')));
  child.on('message',(message:unknown)=>{
    if(!message||typeof message!=='object'||Array.isArray(message)||!('type' in message)||typeof message.type!=='string')return rejectAll(new Error('H5_PERFORMANCE_WORKER_MESSAGE_INVALID'));
    if(message.type==='failed'){observations.push({...message,elapsed_since_start_ms:performance.now()-started});return rejectAll(new Error('H5_PERFORMANCE_WORKER_FAILED'));}
    const id=message.type==='ready'?'ready':'id' in message&&typeof message.id==='string'?message.id:'';
    const item=pending.get(id);if(!item)return rejectAll(new Error('H5_PERFORMANCE_WORKER_UNEXPECTED_MESSAGE'));
    const observation={...message,elapsed_since_start_ms:performance.now()-started};observations.push(observation);clearTimeout(item.timer);pending.delete(id);item.resolve(observation);
  });
  function wait(id:string):Promise<Record<string,unknown>>{
    assert.equal(pending.has(id),false);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('H5_PERFORMANCE_WORKER_TIMEOUT'));},60000);pending.set(id,{resolve,reject,timer});});
  }
  function command(type:'run'|'stop',id:string):Promise<Record<string,unknown>>{
    const result=wait(id);child.send({type,id},error=>{if(error){const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);item.reject(new Error('H5_PERFORMANCE_WORKER_SEND_FAILED'));}}});return result;
  }
  let ready:Record<string,unknown>;
  try{ready=await wait('ready');assert.equal(ready.pid,child.pid);assert.equal(ready.parent_pid,process.pid);assert.equal(ready.pool_max,1);assert.equal(ready.role,'WORKER');}
  catch(error){child.kill();let timer:NodeJS.Timeout|undefined;try{await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('H5_PERFORMANCE_WORKER_START_CLEANUP_TIMEOUT')),10000);})]);}finally{if(timer)clearTimeout(timer);await writeFile(path.join(options.outputRoot,'worker-start-failure.json'),JSON.stringify({pid:child.pid,exit_code:exitCode,exit_signal:exitSignal,observations,stderr,stdout},null,2)+'\n',{flag:'wx'});}throw error;}
  const result=()=>({kind:'EXISTING_H5_WORKER_EMPTY_QUEUE',pid:child.pid,parent_pid:process.pid,pool_max:1,app_pool_max:4,application_worker_pool_budget:5,role:'WORKER',new_product_timers:0,exit_code:exitCode,exit_signal:exitSignal,closed,observations,scope:'Real existing H5 runtime ready/runOnce, empty media queue; not all workbench jobs or active transcode pressure'});
  return {
    ready,
    async round(id:string){assert.equal(closed,false);const response=await command('run',id);assert.equal(response.pid,child.pid);assert.equal(response.pending_media,0);assert.equal(response.external_calls,0);},
    state:result,
    async close(){
      if(closed)return;closed=true;let primary:unknown;
      try{const stopped=await command('stop','final-stop');assert.equal(stopped.pool_ended,true);}catch(error){primary=error;child.kill();}
      let timer:NodeJS.Timeout|undefined;
      try{await Promise.race([exited,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{child.kill();reject(new Error('H5_PERFORMANCE_WORKER_STOP_TIMEOUT'));},60000);})]);}finally{if(timer)clearTimeout(timer);}
      await writeFile(path.join(options.outputRoot,'worker-process.json'),JSON.stringify(result(),null,2)+'\n',{flag:'wx'});
      await writeFile(path.join(options.outputRoot,'worker.stdout.log'),stdout,{flag:'wx'});await writeFile(path.join(options.outputRoot,'worker.stderr.log'),stderr,{flag:'wx'});
      assert.equal(exitCode,0,'H5_PERFORMANCE_WORKER_EXIT_FAILED');assert.equal(pending.size,0);if(primary)throw primary;
    },
  };
}
