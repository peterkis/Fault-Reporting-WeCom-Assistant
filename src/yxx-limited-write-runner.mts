import type { ChildProcess } from 'node:child_process';
import type { PostgresPoolClient } from './platform/postgres-pool.mjs';
import type { ApprovedLimitedManifest, LimitedConfiguration } from './yxx-limited-write-contract.mjs';
import type { LimitedCounts } from './yxx-limited-write-guard.mjs';
type ExitRecord = {code:number|null;signal:NodeJS.Signals|null};
type ReadyRecord = {role:string;cookies:unknown};
interface StateInput extends Record<string,unknown> {counts?:Partial<Record<keyof LimitedCounts,unknown>>|undefined;status?:unknown;cleanup_passed?:unknown}
import {fork} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,lstatSync,renameSync} from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {createPostgresPool} from './platform/postgres-pool.mjs';
import {yxxCatalogInventory,validateYxxCatalog,YXX_MIGRATION_ID,YXX_CORRECTIVE_MIGRATION_ID} from '../scripts/yxx-self-service-migrate.mjs';
import {minimalG2Environment} from './p2-g2-validation-config.mjs';
import {createLimitedGuard} from './yxx-limited-write-guard.mjs';
import {validateLimitedManifest,databaseIdentity,digest,reject} from './yxx-limited-write-contract.mjs';
import {g2EvidenceTime} from './p2-g2-evidence-time.mjs';
import {G2_ROOT} from './p2-g2-candidate.mjs';

export async function stopLimitedChild(child:ChildProcess,exitPromise:Promise<ExitRecord>,{graceMs=10000,killMs=5000}={}){
  if(child.connected)child.send({type:'stop'});
  let timer:ReturnType<typeof setTimeout>|undefined;const exited=await Promise.race([exitPromise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),graceMs);})]);clearTimeout(timer);
  if(exited)return {forced:false,exited:true};
  child.kill('SIGKILL');
  const killed=await Promise.race([exitPromise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),killMs);})]);clearTimeout(timer);
  return {forced:true,exited:killed};
}
export async function startLimitedRuntime({manifest,configuration,stateDirectory,resume=false,synthetic=false}: {manifest:ApprovedLimitedManifest;configuration:LimitedConfiguration;stateDirectory:string;resume?:boolean;synthetic?:boolean}){
  validateLimitedManifest(manifest);
  const {env,member}=configuration,identity=databaseIdentity(env.PILOT_DATABASE_URL);
  if(identity.name!==manifest.database.name||identity.identity_sha256!==manifest.database.identity_sha256)reject('DATABASE_IDENTITY_MISMATCH');
  if(!path.isAbsolute(stateDirectory))reject('STATE_DIRECTORY_REQUIRED');
  const inside=path.relative(G2_ROOT,stateDirectory);
  if(!inside.startsWith('..')&&!path.isAbsolute(inside)&&!(inside.startsWith('tmp'+path.sep)))reject('PRIVATE_STATE_DIRECTORY_REQUIRED');
  for(let current=stateDirectory;current!==path.dirname(current);current=path.dirname(current))if(existsSync(current)&&lstatSync(current).isSymbolicLink())reject('STATE_SYMLINK');
  for(const name of ['state.json','state.json.next','stop.request','sessions.private.json'])if(existsSync(path.join(stateDirectory,name))&&lstatSync(path.join(stateDirectory,name)).isSymbolicLink())reject('STATE_SYMLINK');
  const stateFile=path.join(stateDirectory,'state.json'),stopFile=path.join(stateDirectory,'stop.request');
  const binding={run_id:manifest.run_id,manifest_sha256:digest(manifest),database_identity_sha256:identity.identity_sha256};
  let state:StateInput|null=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):null;
  if(resume?!state:state!==null)reject('RESUME_STATE_REQUIRED');
  if(state&&Object.entries(binding).some(([key,value])=>(state as StateInput)[key]!==value))reject('RESUME_BINDING_MISMATCH');
  if(state&&(!['PREPARED','STARTING','RUNNING','STOPPED','STOPPED_WITH_FAILURE'].includes(state.status as string)
    ||!state.counts||Object.keys(state.counts).sort().join()!=='intakes,supplements,tickets'
    ||Object.values(state.counts).some(value=>!Number.isSafeInteger(value)||(value as number)<0)
    ||state.status==='STOPPED'&&state.cleanup_passed!==true))reject('RESUME_STATE_INVALID');
  const pool=createPostgresPool({connectionString:env.PILOT_DATABASE_URL,max:1,connectionTimeoutMillis:2000,application_name:'ss010_controller'});
  const children=new Map<string,ChildProcess>(),exits=new Map<string,Promise<ExitRecord>>();let controller:PostgresPoolClient|null|undefined,stopping:Promise<{stopped:boolean;cleanup_passed:boolean;counts:LimitedCounts|undefined;error_code:string|null}>|undefined,monitor:ReturnType<typeof setInterval>|undefined,started=false;
  const guard=createLimitedGuard({manifest,member,secret:env.P2_G2_REPORTER_HMAC_SECRET as string,stopFile});
  const save=(extra:Partial<StateInput>)=>{state={...binding,...state,...extra,...g2EvidenceTime()};const temp=stateFile+'.next';writeFileSync(temp,JSON.stringify(state)+'\n',{mode:0o600});renameSync(temp,stateFile);};
  async function stop(reason='STOP_REQUESTED'){
    if(stopping)return stopping;
    stopping=(async()=>{
      clearInterval(monitor);
      if(started)writeFileSync(stopFile,reason+'\n',{mode:0o600});
      let forced=false;
      await Promise.all([...children].map(async([role,child])=>{
        const result=await stopLimitedChild(child,exits.get(role) as Promise<ExitRecord>);forced ||= result.forced||!result.exited;
      }));
      let counts:LimitedCounts|undefined,error:string|null=null;
      try{if(controller)counts=await guard.inspect(controller);}catch(e){error=(e as {code?:string}).code??'SS010_RECONCILIATION_FAILED';}
      if(started)save({status:error||forced?'STOPPED_WITH_FAILURE':'STOPPED',reason,counts,cleanup_passed:!forced&&!error,error_code:error});
      controller?.release(true);controller=null;await pool.end();
      return {stopped:true,cleanup_passed:!forced&&!error,counts,error_code:error};
    })();return stopping;
  }
  try{
    controller=await pool.connect();controller.on('error',()=>void stop('CONTROLLER_LOST'));
    const current=(await controller.query('SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid')).rows[0];
    if((current as Record<string,unknown>).name!==manifest.database.name||(current as Record<string,unknown>).oid!==manifest.database.oid)reject('DATABASE_IDENTITY_MISMATCH');
    if(!((await controller.query("SELECT pg_try_advisory_lock(hashtextextended('SS010_RUNTIME',0)) AS acquired")).rows[0] as Record<string,unknown>).acquired)reject('COMPETING_RUNTIME');
    validateYxxCatalog(await yxxCatalogInventory(controller));
    for(const id of [YXX_MIGRATION_ID,YXX_CORRECTIVE_MIGRATION_ID]){
      const marker=(await controller.query('SELECT checksum_sha256 FROM platform.schema_migration WHERE migration_id=$1',[id])).rows[0];
      if(marker?.checksum_sha256!==digest(readFileSync(new URL('../database/migrations/'+id+'.sql',import.meta.url),'utf8')))reject('MIGRATION_NOT_READY');
    }
    const counts=await guard.inspect(controller,{empty:!resume});
    if(state?.counts&&Object.entries(counts).some(([key,value])=>value<(((state as StateInput).counts as Record<string,number>)[key as keyof LimitedCounts] as number)))reject('RESUME_COUNTS_DECREASED');
    if(resume&&state?.status==='STOPPED_WITH_FAILURE')reject('RESUME_RECONCILIATION_REQUIRED');
    const principals=await controller.query('SELECT id::text FROM pilot_ticket.pilot_principal WHERE id=ANY($1::uuid[]) AND is_active=true',[manifest.principal_ids]);
    if(principals.rowCount!==2)reject('STAFF_SCOPE');
    const probe=createServer();
    try{await new Promise<void>((resolve,rejectProbe)=>{probe.once('error',rejectProbe);probe.listen(manifest.listen_port,'127.0.0.1',resolve);});}
    catch{reject('PORT_UNAVAILABLE');}finally{if(probe.listening)await new Promise<void>(resolve=>probe.close(resolve as (error?:Error)=>void));}
    mkdirSync(stateDirectory,{recursive:true,mode:0o700});
    if(!resume)writeFileSync(stateFile,JSON.stringify({...binding,status:'PREPARED',counts})+'\n',{mode:0o600,flag:'wx'});
    if(resume&&existsSync(stopFile))unlinkSync(stopFile);
    started=true;save({status:'STARTING',counts});
    const roleScript=new URL('../scripts/yxx-self-service-limited-role.mjs',import.meta.url);
    const ready:ReadyRecord[]=[];
    for(const role of ['APP','WORKER'])ready.push(await new Promise<ReadyRecord>((resolve,rejectReady)=>{
      const roleEnv={...minimalG2Environment(),PILOT_DATABASE_URL:env.PILOT_DATABASE_URL,P2_G1_GATEWAY_ENABLED:'false',P2_G1_SENDER_ENABLED:'false',P2_G1_REQUIRE_GATEWAY:'false',
        SS010_MANIFEST:JSON.stringify(manifest),SS010_MEMBER:JSON.stringify(member),SS010_STOP_FILE:stopFile,SS010_SYNTHETIC:String(synthetic),
        P2_G2_REPORTER_HMAC_SECRET:env.P2_G2_REPORTER_HMAC_SECRET,
        ...(role==='APP'?{APP_SECRET:env.APP_SECRET,PILOT_LOG_IDENTITY_HASH_KEY:env.PILOT_LOG_IDENTITY_HASH_KEY,P2_G1_TEST_PRINCIPAL_IDS:manifest.principal_ids.join(','),
          P2_G1_LISTEN_PORT:String(manifest.listen_port),P2_G1_TEST_AUTH_TTL_MS:String(Math.max(10000,Number(manifest.window.ends_epoch_ms)-Date.now()))}:{})};
      const child=fork(roleScript,['--role='+role.toLowerCase()],{env:roleEnv,execArgv:['--max-old-space-size='+ (role==='APP'?512:384)],windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
      children.set(role,child);exits.set(role,new Promise(resolveExit=>child.once('exit',(code,signal)=>resolveExit({code,signal}))));
      const timer=setTimeout(()=>rejectReady(Error('SS010_ROLE_TIMEOUT')),20000);
      child.once('error',()=>{clearTimeout(timer);rejectReady(Error('SS010_ROLE_FAILED'));void stop('ROLE_FAILED');});
      child.once('exit',()=>{clearTimeout(timer);rejectReady(Error('SS010_ROLE_EXITED'));if(!stopping)void stop('ROLE_EXITED');});
      child.on('message',(message:unknown)=>{
        if((message as Record<string,unknown>).type==='role-ready'){clearTimeout(timer);resolve({...(message as {cookies:unknown}),role});}
        if((message as Record<string,unknown>).type==='worker-status'&&children.get('APP')?.connected)(children.get('APP') as ChildProcess).send({type:'peer-status',gateway_authenticated:true,worker_ready:(message as Record<string,unknown>).ready===true});
        if((message as Record<string,unknown>).type==='role-failed'||(message as Record<string,unknown>).type==='provider-send-request'||(message as Record<string,unknown>).type==='worker-status'&&((message as Record<string,unknown>).failure_count as number)>0){clearTimeout(timer);rejectReady(Error('SS010_ROLE_FAILED'));void stop('ROLE_FAILED');}
      });
    }));
    if(stopping)reject('START_INTERRUPTED');
    guard.active();
    for(const child of children.values())child.send({type:'ss010-activate'});
    const deadline=Date.now()+10000;let healthy=false;
    while(Date.now()<deadline&&!stopping){
      healthy=await new Promise(resolve=>{
        const req=httpRequest({hostname:'127.0.0.1',port:manifest.listen_port,path:'/health/ready',timeout:1000},response=>{
          response.resume();resolve(response.statusCode===200);
        });req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false);});req.end();
      });
      if(healthy)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(!healthy||stopping)reject('RUNTIME_NOT_READY');
    const cookies=(ready.find(item=>item.role==='APP') as ReadyRecord).cookies;
    writeFileSync(path.join(stateDirectory,'sessions.private.json'),JSON.stringify({run_id:manifest.run_id,cookies})+'\n',{mode:0o600});
    save({status:'RUNNING',counts,process_count:2,pool_limits:{app:4,worker:2,controller:1},gateway_started:false,sender_enabled:false});
    monitor=setInterval(()=>{try{guard.active();}catch{void stop('WINDOW_OR_STOP');}},100);monitor.unref();
    return {stop,cookies,port:manifest.listen_port,stateFile,children,status:()=>state};
  }catch(error){await stop('START_FAILED');throw error;}
}
