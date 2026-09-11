import { existsSync, mkdirSync, writeFileSync, readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { createG2ProcessCluster } from '../src/p2-g2-service-loop-assembly.mjs';
import { createG2ResourceSampler, readG2HostMetrics } from '../src/p2-g2-resource-sampler.mjs';
import { writeG2StartupEvidence } from '../src/p2-g2-live-evidence.mjs';
import { createG2ControlRecorder } from '../src/p2-g2-control-evidence.mjs';
import { G2_SCENARIO_IDS } from '../src/p2-g2-gate-evaluator.mjs';
import { g2SourceBinding } from '../src/p2-g2-evidence-files.mjs';
import { G2_ROOT, verifyG2Candidate, verifyG2ApprovalFile, requirePreparedG2Candidate } from '../src/p2-g2-candidate.mjs';
import { readG2Configuration, G2_LIMITS, failG2 } from '../src/p2-g2-validation-config.mjs';
import { initializeG2SendBudget, openG2SendBudget } from '../src/p2-g2-send-budget.mjs';
import { parseG2Arguments, readG2ManifestFile, loadG2PrivateEnvironment, checkG2 } from './p2-g2-check.mjs';

export async function main(argv=process.argv.slice(2)){
  if(argv.includes('--help')||!argv.length){console.log('Usage: node scripts/p2-g2-live-e2e.mjs --mode=initialize-budget|live --manifest=path.json --budget-file=absolute-path [--env-file=.env.pilot] [--duration-ms=3840000] [--proxy-pid-file=path] [--client-latency-file=path] [--interactive=true|false]\nRequires READY candidate, dedicated empty database, current owner file and five P2_G2 approval switches. No migrations. Run on the actual 2C4G host. Interactive commands: status, stop, capture:G2-I03 (or another listed scenario ID), fault:G2-F02:WORKER:stop, fault:G2-F02:WORKER:restart, fault:G2-F01:GATEWAY:disconnect, fault:G2-F01:GATEWAY:reconnect. Otherwise create stop.request in the private run directory. No command grants approval or closes the Gate.');if(!argv.length)process.exitCode=2;return;}
  const a=parseG2Arguments(argv,['mode','manifest','budget-file','env-file','duration-ms','proxy-pid-file','client-latency-file','interactive']);
  if(!['initialize-budget','live'].includes(a.mode)||!a.manifest||!path.isAbsolute(a['budget-file']??''))failG2('ARGUMENT_INVALID');
  const manifest=readG2ManifestFile(a.manifest),env=loadG2PrivateEnvironment(a['env-file']);
  if(manifest.mode!=='live')failG2('LIVE_MANIFEST_REQUIRED');
  const c=readG2Configuration({manifest,env,candidateFingerprint:manifest.candidate_fingerprint});
  verifyG2Candidate(manifest.candidate_fingerprint);verifyG2ApprovalFile(manifest);requirePreparedG2Candidate(manifest.candidate_fingerprint);
  const preflight=await checkG2({mode:'live-check',manifest,env});if(!preflight.ok)failG2('LIVE_PREFLIGHT_FAILED');
  const directory=path.dirname(a['budget-file']),relative=path.relative(path.join(G2_ROOT,'tmp'),path.resolve(directory));
  if(!/^p2-g2-[a-z0-9-]+$/u.test(relative)||path.isAbsolute(relative)
    ||lstatSync(path.join(G2_ROOT,'tmp')).isSymbolicLink()||existsSync(directory)&&lstatSync(directory).isSymbolicLink())failG2('PRIVATE_RUN_DIRECTORY_REQUIRED');
  if(a.mode==='initialize-budget'){
    mkdirSync(directory,{recursive:true,mode:0o700});initializeG2SendBudget({file:a['budget-file'],manifest});
    console.log(JSON.stringify({ok:true,gate:'P2-G2',run_id:manifest.run_id,status:'SEND_BUDGET_INITIALIZED',database_writes:false,provider_calls:0}));return;
  }
  if(typeof global.gc==='function'||process.execArgv.some(s=>s.includes('expose-gc')))failG2('NATURAL_GC_REQUIRED');
  const duration=Number(a['duration-ms']??3840000);
  if(!Number.isInteger(duration)||duration<10000||duration>3840000)failG2('DURATION_INVALID');
  if(BigInt(manifest.approval.expires_epoch_ms)-BigInt(Date.now())<BigInt(duration+30000))failG2('APPROVAL_WINDOW_TOO_SHORT');
  if(a.interactive!==undefined&&!['true','false'].includes(a.interactive))failG2('ARGUMENT_INVALID');
  openG2SendBudget({file:a['budget-file'],manifest});
  if(!['localhost','127.0.0.1','[::1]'].includes(new URL(c.databaseUrl).hostname))failG2('WHOLE_STACK_LOCAL_DATABASE_REQUIRED');
  const pool=createPostgresPool({connectionString:c.databaseUrl,max:1,connectionTimeoutMillis:3000});
  let host;
  try{const pid=(await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;host=readG2HostMetrics({backendPid:pid,proxyPidFile:a['proxy-pid-file']});}
  finally{await pool.end();}
  if(host.host_cpu_count<1||host.host_cpu_count>2||host.host_memory_bytes>4*1024**3
    ||!(host.postgres_rss_bytes>0)||!(host.proxy_rss_bytes>0))failG2('PHYSICAL_ENVIRONMENT_NOT_READY');
  const stateFile=path.join(directory,'state.json'),sessionFile=path.join(directory,'sessions.private.json');
  if(existsSync(stateFile)||existsSync(sessionFile))failG2('RUN_DIRECTORY_ALREADY_USED');
  const cluster=createG2ProcessCluster({manifest,env,budgetFile:a['budget-file']});
  let sampler,controls,rl,requestedStop=false,wake,phase='STEADY',faultId=null,commands=Promise.resolve();
  const stop=()=>{requestedStop=true;wake?.();void cluster.stop().catch(()=>{});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const save=(status,extra={})=>writeFileSync(stateFile,JSON.stringify({schema_version:1,gate:'P2-G2',...g2SourceBinding(manifest),status,phase,...extra},null,2)+'\n',{mode:0o600});
  try{
    const ready=await cluster.start();
    writeFileSync(sessionFile,JSON.stringify({run_id:manifest.run_id,candidate_fingerprint:manifest.candidate_fingerprint,
      origin:ready.origin,cookies:ready.cookies},null,2)+'\n',{flag:'wx',mode:0o600});
    const environment=await cluster.syntheticEnvironment();
    if(environment.model_environment_keys!==0||!environment.model_network_unreachable||environment.expose_gc)failG2('AI_OFF_BOUNDARY_NOT_READY');
    const startup=writeG2StartupEvidence({manifest,directory,ready,environment,host});
    if(startup.start.result!=='PASS'||startup.environment.result!=='PASS')failG2('STARTUP_EVIDENCE_NOT_READY');
    controls=createG2ControlRecorder({file:path.join(directory,'control-sources.jsonl'),manifest});
    save('LIVE_ROLES_READY',{process_count:ready.process_count,environment_profile_verified:true,model_network_unreachable:true});
    console.log(JSON.stringify({ok:true,run_id:manifest.run_id,status:'LIVE_ROLES_READY',process_count:ready.process_count,
      candidate_fingerprint:manifest.candidate_fingerprint,gate_status:'IN_PROGRESS'}));
    if(a.interactive==='true'){
      rl=createInterface({input:process.stdin,output:process.stdout});
      rl.on('line',line=>{commands=commands.then(async()=>{
        if(line==='stop'){stop();return;}if(line==='status'){console.log(JSON.stringify({phase,process_count:cluster.status().process_count}));return;}
        if(requestedStop)failG2('STOPPING');
        const capture=/^capture:(G2-[A-Z][0-9]{2})$/u.exec(line);
        if(capture&&G2_SCENARIO_IDS.includes(capture[1])){
          const snapshot=await cluster.captureReconciliation(),name='reconciliation-source-'+capture[1].toLowerCase()+'-'+snapshot.physical_epoch_ms+'.json';
          writeFileSync(path.join(directory,name),JSON.stringify(snapshot,null,2)+'\n',{flag:'wx',mode:0o600});
          console.log(JSON.stringify({ok:true,scenario_id:capture[1],source_file:name,database_writes:false,provider_calls:0}));return;
        }
        const m=/^fault:(G2-F0[12]):(WORKER|GATEWAY):(stop|restart|disconnect|reconnect)$/u.exec(line);
        if(!m)failG2('ARGUMENT_INVALID');phase='FAULT';faultId=m[1];
        const started_physical_epoch_ms=String(Date.now());
        if(m[2]==='WORKER'&&m[3]==='stop')await cluster.stopRoleForFault('WORKER',m[1]);
        else if(m[2]==='WORKER'&&m[3]==='restart'){phase='RECOVERY';await cluster.restartRoleForFault('WORKER',m[1]);}
        else if(m[2]==='GATEWAY'&&m[3]==='disconnect')await cluster.disconnectGatewayForFault(m[1]);
        else if(m[2]==='GATEWAY'&&m[3]==='reconnect'){phase='RECOVERY';await cluster.reconnectGatewayForFault(m[1]);}
        else failG2('ARGUMENT_INVALID');
        if(phase==='RECOVERY'){
          const deadline=Date.now()+10000;
          while(Date.now()<deadline&&(!cluster.status().worker_ready||!cluster.status().gateway_authenticated))await new Promise(r=>setTimeout(r,100));
          if(!cluster.status().worker_ready||!cluster.status().gateway_authenticated)failG2('RECOVERY_NOT_READY');
          phase='STEADY';faultId=null;
        }
        controls.append({scenario_id:m[1],role:m[2],action:m[3],started_physical_epoch_ms,state:cluster.status()});
      }).catch(()=>{console.log(JSON.stringify({ok:false,error_code:'P2_G2_CONTROL_COMMAND_REJECTED'}));});});
    }
    sampler=createG2ResourceSampler({cluster,manifest,directory,proxyPidFile:a['proxy-pid-file'],clientLatencyFile:a['client-latency-file']});
    const start=performance.now();let samples=0,incompleteSamples=0;
    while(!requestedStop){
      if(existsSync(path.join(directory,'stop.request'))){stop();break;}
      readG2Configuration({manifest,env,candidateFingerprint:manifest.candidate_fingerprint});
      verifyG2ApprovalFile(manifest);verifyG2Candidate(manifest.candidate_fingerprint);
      const sampling=commands.then(()=>sampler.sample({phase,faultId}));commands=sampling.then(()=>{});
      const sample=await sampling;samples++;if(!sample.complete)incompleteSamples++;
      const elapsed=performance.now()-start;save('OBSERVING',{samples,incomplete_samples:incompleteSamples,elapsed_ms:elapsed});
      if(elapsed>=duration)break;
      await new Promise(resolve=>{const timer=setTimeout(()=>{wake=null;resolve();},Math.min(G2_LIMITS.sample_interval_ms,duration-elapsed));
        wake=()=>{clearTimeout(timer);wake=null;resolve();};});
    }
    await commands;save('STOPPING',{samples,incomplete_samples:incompleteSamples,stopped_early:requestedStop});
  }finally{
    requestedStop=true;rl?.close();sampler?.close();controls?.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);
    const stopped=await cluster.stop();
    writeFileSync(path.join(directory,'stop-source.json'),JSON.stringify({schema_version:1,kind:'G2_STOP_PACKET',...g2SourceBinding(manifest),physical_epoch_ms:String(Date.now()),stopped:stopped.stopped,
      process_count:stopped.process_count},null,2)+'\n',{flag:'wx',mode:0o600});
    let previous={};try{previous=JSON.parse(readFileSync(stateFile,'utf8'));}catch{}
    save('STOPPED_AWAITING_RECONCILIATION',{samples:previous.samples??0,incomplete_samples:previous.incomplete_samples??0,
      process_count:stopped.process_count,gate_status:'IN_PROGRESS',owner_approval:false});
    console.log(JSON.stringify({ok:stopped.process_count===0,run_id:manifest.run_id,status:'STOPPED_AWAITING_RECONCILIATION',
      process_count:stopped.process_count,gate_passed:false}));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(e=>{
  console.log(JSON.stringify({ok:false,error_code:/^P2_G2_[A-Z_]+$/u.test(e?.code??'')?e.code:'P2_G2_LIVE_FAILED',gate_passed:false}));process.exitCode=1;});
