import {spawn,spawnSync,type SpawnSyncOptionsWithStringEncoding,type SpawnSyncReturns} from 'node:child_process';
import {existsSync,lstatSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

interface Closed {kind:'WIN32_OWNED_JOB';status:string;root_pid:number;root_exit_code:number|null;error_code:string|null;forced_cleanup:boolean;cleanup_active_processes:number}
interface Started {kind:'WIN32_OWNED_JOB';root_pid:number;root_created_utc:string;owner_pid:number;profile:string|null;suspended_assigned_before_execution:true;verified_member_before_resume:true}
export type OwnedSpawnResult=SpawnSyncReturns<string>&{ownership_receipt?:string};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
let prepared:{executable:string;sha256:string;source:string;sourceSha256:string}|undefined;
function plain(value:unknown):value is Record<string,unknown>{return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function noLinks(file:string){let current=path.resolve(file);for(;;){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('OWNED_PROCESS_REPARSE_REFUSED');const parent=path.dirname(current);if(parent===current)return;current=parent;}}
function prepare(){
  if(process.platform!=='win32')throw Error('OWNED_PROCESS_WINDOWS_REQUIRED');
  if(prepared){
    noLinks(prepared.executable);noLinks(prepared.source);
    if(digest(readFileSync(prepared.executable))!==prepared.sha256||digest(readFileSync(prepared.source))!==prepared.sourceSha256)throw Error('OWNED_PROCESS_HELPER_CHANGED');
    return prepared.executable;
  }
  const directory=mkdtempSync(path.join(tmpdir(),'owned-process-native-'));noLinks(directory);
  const source=path.join(directory,'OwnedProcessJob.cs'),executable=path.join(directory,'OwnedProcessJob.exe');
  const bytes=readFileSync(new URL('../../tests/fixtures/process-ownership/OwnedProcessJob.cs',import.meta.url));writeFileSync(source,bytes,{flag:'wx'});
  const compiler=path.join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result=spawnSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/reference:System.Web.Extensions.dll','/out:'+executable,source],{cwd:directory,encoding:'utf8',windowsHide:true,timeout:30000});
  writeFileSync(path.join(directory,'compile.log'),(result.stdout??'')+(result.stderr??''));
  if(result.error)throw result.error;if(result.status!==0)throw Error('OWNED_PROCESS_NATIVE_COMPILE_FAILED');
  prepared={executable,sha256:digest(readFileSync(executable)),source,sourceSha256:digest(bytes)};
  writeFileSync(path.join(directory,'identity.json'),JSON.stringify(prepared));return executable;
}
function launchSpec(executable:string,args:readonly string[],options:{cwd?:string|URL|undefined;timeout?:number|undefined;maxBuffer?:number|undefined;windowsVerbatimArguments?:boolean|undefined},profile:string|null){
  if(!path.isAbsolute(executable)||args.some(value=>value.includes('\0')))throw Error('OWNED_PROCESS_INVALID_COMMAND');
  const directory=mkdtempSync(path.join(tmpdir(),'owned-process-'));noLinks(directory);
  const cwd=options.cwd instanceof URL?fileURLToPath(options.cwd):path.resolve(options.cwd??process.cwd());
  const spec=path.join(directory,'launch.json');
  writeFileSync(spec,JSON.stringify({schema_version:1,owner_pid:process.pid,executable,args,cwd,profile,
    timeout_ms:options.timeout??0,max_output_bytes:options.maxBuffer??1024*1024,verbatim:options.windowsVerbatimArguments===true}),{flag:'wx'});
  return {directory,spec,cwd};
}
function closed(directory:string):Closed{
  const value:unknown=JSON.parse(readFileSync(path.join(directory,'closed.json'),'utf8'));
  if(!plain(value)||value.schema_version!==1||value.kind!=='WIN32_OWNED_JOB'||typeof value.root_pid!=='number'||typeof value.status!=='string'||typeof value.forced_cleanup!=='boolean'||value.cleanup_active_processes!==0||value.root_exit_code!==null&&typeof value.root_exit_code!=='number'||value.error_code!==null&&typeof value.error_code!=='string')throw Error('OWNED_PROCESS_CLEANUP_UNPROVEN');
  return {kind:'WIN32_OWNED_JOB',status:value.status,root_pid:value.root_pid,root_exit_code:value.root_exit_code,error_code:value.error_code,forced_cleanup:value.forced_cleanup,cleanup_active_processes:0};
}
function started(directory:string):Started{
  const value:unknown=JSON.parse(readFileSync(path.join(directory,'started.json'),'utf8'));
  if(!plain(value)||value.schema_version!==1||value.kind!=='WIN32_OWNED_JOB'||value.owner_pid!==process.pid||typeof value.root_pid!=='number'||typeof value.root_created_utc!=='string'||value.profile!==null&&typeof value.profile!=='string'||value.suspended_assigned_before_execution!==true||value.verified_member_before_resume!==true||value.kill_on_close!==true||value.breakaway_allowed!==false)throw Error('OWNED_PROCESS_START_UNPROVEN');
  return {kind:'WIN32_OWNED_JOB',root_pid:value.root_pid,root_created_utc:value.root_created_utc,owner_pid:process.pid,profile:value.profile,suspended_assigned_before_execution:true,verified_member_before_resume:true};
}

export function ownedSpawnSync(executable:string,args:readonly string[],options:SpawnSyncOptionsWithStringEncoding):OwnedSpawnResult{
  if(process.platform!=='win32')return spawnSync(executable,[...args],options);
  const began=performance.now(),helper=prepare(),remaining=options.timeout?Math.max(1,options.timeout-Math.ceil(performance.now()-began)):0;
  const launch=launchSpec(executable,args,{...options,timeout:remaining},null);
  const result=spawnSync(helper,[launch.spec],{cwd:launch.cwd,env:options.env,encoding:'utf8',windowsHide:true,timeout:options.timeout?options.timeout+15000:undefined,maxBuffer:1024*1024});
  // The supervisor owns only a kernel Job handle, never a guessed PID tree.
  // A killed supervisor closes that handle and cannot terminate another job.
  const proof=closed(launch.directory),out=readFileSync(path.join(launch.directory,'stdout.log'),'utf8'),err=readFileSync(path.join(launch.directory,'stderr.log'),'utf8');
  const response:OwnedSpawnResult={...result,pid:proof.root_pid,status:proof.root_exit_code,stdout:out,stderr:err,output:[null,out,err],ownership_receipt:launch.directory};
  if(options.stdio==='inherit'){process.stdout.write(out);process.stderr.write(err);}
  if(proof.status==='TIMEOUT')response.error=Object.assign(Error('Owned subprocess exceeded its original deadline'),{code:'ETIMEDOUT'});
  else if(proof.status!=='COMPLETED')response.error=Object.assign(Error('Owned subprocess failed: '+(proof.error_code??proof.status)),{code:proof.error_code??'OWNED_PROCESS_FAILED'});
  return response;
}

export async function launchOwnedProcess(options:{executable:string;args:readonly string[];cwd:string;profile:string}){
  const helper=prepare(),launch=launchSpec(options.executable,options.args,{cwd:options.cwd,maxBuffer:16*1024*1024},options.profile);
  const child=spawn(helper,[launch.spec],{cwd:launch.cwd,windowsHide:true,stdio:'ignore'});
  const end=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve());});
  const waitEnd=async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([end,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('OWNED_PROCESS_CLOSE_TIMEOUT')),10000);})]);}finally{clearTimeout(timer);}};
  const wait=async<T,>(predicate:()=>T|null,timeout:number):Promise<T>=>{
    const deadline=performance.now()+timeout;while(performance.now()<deadline){const value=predicate();if(value!==null)return value;if(child.exitCode!==null||child.signalCode!==null)throw Error('OWNED_PROCESS_EARLY_EXIT');await new Promise(resolve=>setTimeout(resolve,25));}throw Error('OWNED_PROCESS_START_TIMEOUT');
  };
  try{
    const proof=await wait(()=>existsSync(path.join(launch.directory,'started.json'))?started(launch.directory):null,10000);
    let closing:Promise<Closed>|undefined;
    const dispose=async()=>{
      if(child.exitCode===null&&child.signalCode===null)writeFileSync(path.join(launch.directory,'terminate'),'stop\n',{flag:'w'});
      await waitEnd();
      const final=closed(launch.directory);if(final.root_pid!==proof.root_pid)throw Error('OWNED_PROCESS_IDENTITY_CHANGED');return final;
    };
    const close=()=>closing??=dispose();
    return {child,proof,receiptDirectory:launch.directory,close};
  }catch(error){
    writeFileSync(path.join(launch.directory,'terminate'),'stop\n');
    try{await waitEnd();closed(launch.directory);}catch(cleanup){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');throw new AggregateError([error,cleanup],'OWNED_PROCESS_START_AND_CLEANUP_FAILED');}
    throw error;
  }
}
