import { readFileSync, openSync, appendFileSync, closeSync, fsyncSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { G2_ROOT } from './p2-g2-candidate.mjs';
import { G2_LIMITS, g2Hash, failG2 } from './p2-g2-validation-config.mjs';
import { G2_METRIC_NAMES, createG2EvidenceWriter } from './p2-g2-evidence.mjs';
import { g2SourceBinding } from './p2-g2-evidence-files.mjs';

export const G2_RESOURCE_SQL=`SELECT pg_backend_pid() AS backend_pid,
  (SELECT count(*)::integer FROM pg_locks WHERE NOT granted) AS postgres_locks_waiting,
  (SELECT count(*)::integer FROM pg_stat_activity WHERE datname=current_database() AND xact_start IS NOT NULL AND pid<>pg_backend_pid()) AS postgres_transactions,
  (SELECT count(*)::integer FROM intake.safe_action_suggestion WHERE state='PROPOSED') AS safe_actions_pending,
  (SELECT count(*)::integer FROM intake.manual_review_item WHERE status='PENDING') AS manual_review_pending,
  (SELECT COALESCE(GREATEST(0,EXTRACT(EPOCH FROM(platform.local_now()-min(created_at)))*1000),0)::double precision FROM intake.manual_review_item WHERE status='PENDING') AS manual_review_oldest_age_ms,
  (SELECT count(*)::integer FROM incident.candidate_review WHERE status='CANDIDATE' AND expires_epoch_ms<=platform.physical_epoch_ms()) AS candidate_due,
  (SELECT count(*)::integer FROM incident.candidate_review WHERE status='EXPIRED') AS candidate_expired,
  (SELECT count(*)::integer FROM communication.delivery WHERE last_error_code LIKE 'P2_G2_SEND_%') AS scope_unexpected_deliveries`;

function proc(pid){
  if(!Number.isInteger(pid)||pid<=0)return null;
  try{const text=readFileSync('/proc/'+pid+'/status','utf8');return {name:/^Name:\s+(.+)$/mu.exec(text)?.[1],
    ppid:Number(/^PPid:\s+(\d+)$/mu.exec(text)?.[1]),rss:Number(/^VmRSS:\s+(\d+) kB$/mu.exec(text)?.[1])*1024};}catch{return null;}
}
function treeRss(master,allowedNames){
  const root=proc(master);if(!root||!allowedNames.includes(root.name)||!Number.isFinite(root.rss))return null;
  try{const children=readFileSync('/proc/'+master+'/task/'+master+'/children','utf8').trim().split(/\s+/u).filter(Boolean).map(Number);
    if(children.length>1000)return null;let total=root.rss;
    for(const pid of children){const item=proc(pid);if(!item||item.ppid!==master||!allowedNames.includes(item.name)||!Number.isFinite(item.rss))return null;total+=item.rss;}return total;
  }catch{return null;}
}
export function readG2HostMetrics({backendPid,proxyPidFile}){
  const result={host_cpu_count:os.cpus().length,host_memory_bytes:os.totalmem(),host_memory_available_bytes:null,
    host_swap_used_bytes:null,postgres_rss_bytes:null,proxy_rss_bytes:null,oom_counter:null};
  if(process.platform!=='linux')return result;
  try{const mem=readFileSync('/proc/meminfo','utf8'),kb=name=>Number(new RegExp('^'+name+':\\s+(\\d+) kB$','m').exec(mem)?.[1])*1024;
    result.host_memory_available_bytes=kb('MemAvailable');result.host_swap_used_bytes=kb('SwapTotal')-kb('SwapFree');
    result.oom_counter=Number(/^oom_kill (\d+)$/mu.exec(readFileSync('/proc/vmstat','utf8'))?.[1]);
    const backend=proc(backendPid);if(backend?.name==='postgres')result.postgres_rss_bytes=treeRss(backend.ppid,['postgres']);
    if(proxyPidFile){const text=readFileSync(proxyPidFile,'utf8').trim();if(/^\d+$/u.test(text))result.proxy_rss_bytes=treeRss(Number(text),['nginx','caddy']);}
  }catch{/* Missing sensors remain unavailable, never a manufactured zero. */}
  return result;
}

export function createG2ResourceSampler({cluster,manifest,directory,proxyPidFile=null,clientLatencyFile=null}){
  const sourceFile=path.join(directory,'resource-sources.jsonl'),evidenceFile=path.join(directory,'resource-evidence.jsonl');
  const relative=path.relative(G2_ROOT,sourceFile).replaceAll('\\','/');
  if(relative.startsWith('..')||path.isAbsolute(relative))failG2('RESOURCE_OUTPUT_OUTSIDE_WORKSPACE');
  let sampleStamp=String(Date.now());
  const fd=openSync(sourceFile,'ax',0o600),writer=createG2EvidenceWriter({file:evidenceFile,manifest,nowEpochMs:()=>sampleStamp});
  const observer=randomUUID(),start=performance.now();let sequence=0,lastMono=null,lastWall=null,firstOom=null,closed=false,naturalGcVerified=false;
  return Object.freeze({async sample({phase='STEADY',faultId=null}={}){
    if(closed)failG2('RESOURCE_SAMPLER_CLOSED');
    if(!['STEADY','FAULT','RECOVERY'].includes(phase)||phase!=='STEADY'&&!manifest.scope.allowed_faults.includes(faultId))failG2('FAULT_NOT_APPROVED');
    const wall=Date.now(),mono=performance.now()-start,gap=lastMono===null?0:mono-lastMono;
    sampleStamp=String(wall);
    const sleep=lastWall!==null&&(Math.abs((wall-lastWall)-gap)>1000||gap>=G2_LIMITS.maximum_sample_gap_ms);
    const metrics=Object.fromEntries(G2_METRIC_NAMES.map(k=>[k,null]));let interrupted=false;
    metrics.user_visible_latency_samples=0;
    try{
      const roles=await cluster.resourceRoleMetrics({phase,faultId}),domain=await cluster.resourceDatabaseMetrics(),scope=await cluster.scopeCounts();
      const host=readG2HostMetrics({backendPid:domain.backend_pid,proxyPidFile});delete domain.backend_pid;
      if(firstOom===null&&Number.isFinite(host.oom_counter))firstOom=host.oom_counter;
      const oom=Number.isFinite(host.oom_counter)&&firstOom!==null?Math.max(0,host.oom_counter-firstOom):null;delete host.oom_counter;
      for(const [k,v] of Object.entries({...roles,...domain,...host,...scope,oom_events_delta:oom}))
        if(Object.hasOwn(metrics,k)&&Number.isFinite(v)&&v>=0)metrics[k]=v;
      if(clientLatencyFile){const latency=JSON.parse(readFileSync(clientLatencyFile,'utf8'));
        if(latency.run_id!==manifest.run_id||latency.candidate_fingerprint!==manifest.candidate_fingerprint
          ||latency.measurement_kind!=='CLIENT_RENDER_OBSERVED'||!Array.isArray(latency.samples_ms)
          ||latency.samples_ms.length>10000||latency.samples_ms.some(v=>!Number.isFinite(v)||v<0))failG2('CLIENT_LATENCY_INVALID');
        const values=[...latency.samples_ms].sort((a,b)=>a-b);metrics.user_visible_latency_samples=values.length;
        metrics.user_visible_latency_p95_ms=values.length?values[Math.ceil(values.length*0.95)-1]:null;}
    }catch{interrupted=true;}
    const absentWorker=phase!=='STEADY'&&faultId==='G2-F02'&&metrics.process_count===2&&metrics.worker_rss_bytes===null;
    const environment=absentWorker?{expose_gc:!naturalGcVerified}:await cluster.syntheticEnvironment().catch(()=>({expose_gc:true}));
    if(!absentWorker)naturalGcVerified=environment.expose_gc===false;
    const details={executed:true,phase,observer_instance_id:observer,sample_monotonic_ms:mono,sample_gap_ms:gap,
      natural_gc:environment.expose_gc===false,sleep_detected:sleep,interrupted,metrics,
      ...(faultId?{expected_fault_id:faultId}:{})};
    const packet={schema_version:1,kind:'G2_RESOURCE_PACKET',...g2SourceBinding(manifest),
      sequence:++sequence,physical_epoch_ms:String(wall),query_sha256:g2Hash(G2_RESOURCE_SQL),details};
    const line=JSON.stringify(packet);appendFileSync(fd,line+'\n');fsyncSync(fd);
    const complete=!interrupted&&!sleep&&environment.expose_gc===false&&Object.entries(metrics).every(([k,v])=>v!==null
      ||absentWorker&&k.startsWith('worker_')||k==='user_visible_latency_p95_ms'&&metrics.user_visible_latency_samples===0);
    const record=writer.append({scenario_id:'G2-O01',evidence_type:manifest.mode==='live'?'RESOURCE_MEASUREMENT':'SYNTHETIC_PROCESS_BROWSER',
      result:complete?'PASS':'INCOMPLETE',details,source_refs:[{kind:'PROCESS_IPC',ref:relative+':'+sequence,sha256:g2Hash(line)}]});
    lastMono=mono;lastWall=wall;return {record,complete,unavailable_metrics:Object.keys(metrics).filter(k=>metrics[k]===null)};
  },close(){if(!closed){closed=true;writer.close();closeSync(fd);}}});
}
