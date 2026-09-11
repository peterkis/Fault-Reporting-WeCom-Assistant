import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { g2Hash, failG2 } from './p2-g2-validation-config.mjs';
import { G2_ROOT, verifyG2ApprovalFile } from './p2-g2-candidate.mjs';
import { createG2EvidenceWriter, G2_METRIC_NAMES } from './p2-g2-evidence.mjs';
import { G2_RESOURCE_SQL } from './p2-g2-resource-sampler.mjs';
import { readG2PacketSource, readG2SourceJson, g2SourceBinding, g2SourceMatches } from './p2-g2-evidence-files.mjs';

export function g2StartupFacts(packet,manifest){
  if(!g2SourceMatches(packet,manifest))failG2('RUN_BINDING_INVALID');
  const s=packet.startup_scope,e=packet.environment,h=packet.host;
  if(!s||!e||!h||!packet.readiness)failG2('STARTUP_SOURCE_INVALID');
  const empty=s.ready===true&&s.principals_ready===true&&['inbox','intakes','tickets','sessions','threads','messages','incidents','candidates','competing_roles'].every(k=>s[k]===0);
  const aiOff=e.model_environment_keys===0&&e.model_network_unreachable===true&&e.expose_gc===false;
  const ready=empty&&aiOff&&packet.process_count===3&&packet.readiness.base_service_ready===true;
  const environment=Number.isInteger(h.host_cpu_count)&&h.host_cpu_count>=1&&h.host_cpu_count<=2
    &&h.host_memory_bytes>0&&h.host_memory_bytes<=4*1024**3&&h.postgres_rss_bytes>0&&h.proxy_rss_bytes>0;
  return {start:{result:ready?'PASS':'INCOMPLETE',details:{executed:true,all_required_roles_ready:ready,
    all_role_processes_distinct:packet.process_count===3,data_layer_real_postgresql:empty,
    ...(aiOff?{model_provider_calls:0}:{}),distinct_reporter_count:new Set(manifest.scope.person_hashes).size,
    distinct_principal_count:new Set(manifest.scope.principal_ids).size,seeded_business_facts:!empty}},
  environment:{result:environment?'PASS':'INCOMPLETE',details:{executed:true,physical_profile_verified:environment,
    whole_stack_inside_limits:environment,postgres_included:h.postgres_rss_bytes>0,proxy_included:h.proxy_rss_bytes>0}}};
}
export function writeG2StartupEvidence({manifest,directory,ready,environment,host}){
  const physical_epoch_ms=String(Date.now()),sourceFile=path.join(directory,'startup-source.json');
  const packet={schema_version:1,kind:'G2_STARTUP_PACKET',...g2SourceBinding(manifest),
    physical_epoch_ms,startup_scope:ready.startup_scope,process_count:ready.process_count,
    readiness:{base_service_ready:ready.readiness.base_service_ready},environment,host};
  const bytes=JSON.stringify(packet,null,2)+'\n';writeFileSync(sourceFile,bytes,{flag:'wx',mode:0o600});
  const source={kind:'PROCESS_IPC',ref:path.relative(G2_ROOT,sourceFile).replaceAll('\\','/'),sha256:g2Hash(bytes)};
  const facts=g2StartupFacts(packet,manifest),writer=createG2EvidenceWriter({file:path.join(directory,'startup-evidence.jsonl'),manifest,nowEpochMs:()=>physical_epoch_ms});
  try{
    writer.append({scenario_id:'G2-START',evidence_type:'POSTGRES_HTTP_INTEGRATION',...facts.start,
      source_refs:[source,...(manifest.mode==='live'?[{kind:'OWNER_FILE',ref:manifest.approval.source_ref,sha256:manifest.approval.source_sha256}]:[])]});
    writer.append({scenario_id:'G2-ENV',evidence_type:manifest.mode==='live'?'RESOURCE_MEASUREMENT':'SYNTHETIC_PROCESS_BROWSER',...facts.environment,source_refs:[source]});
  }finally{writer.close();}
  return facts;
}
export function g2ResourceComplete(d){
  const absentWorker=d.phase!=='STEADY'&&d.expected_fault_id==='G2-F02'&&d.metrics?.process_count===2&&d.metrics.worker_rss_bytes===null;
  return d.executed===true&&d.interrupted===false&&d.sleep_detected===false&&d.natural_gc===true
    &&G2_METRIC_NAMES.every(k=>Object.hasOwn(d.metrics??{},k)&&(d.metrics[k]!==null
      ||absentWorker&&k.startsWith('worker_')||k==='user_visible_latency_p95_ms'&&d.metrics.user_visible_latency_samples===0));
}
export function verifyG2LiveSource(source,record,manifest,{root=G2_ROOT}={}){
  if(source.kind==='OWNER_FILE'&&record.scenario_id==='G2-START'){
    if(source.ref!==manifest.approval.source_ref||source.sha256!==manifest.approval.source_sha256)return false;
    verifyG2ApprovalFile(manifest,root);return true;
  }
  if(source.kind!=='PROCESS_IPC')return false;
  const resource=/\/resource-sources\.jsonl:[1-9][0-9]*$/u.test(source.ref);
  const startup=/\/startup-source\.json$/u.test(source.ref);
  if(!resource&&!startup)return false;
  const packet=resource?readG2PacketSource(source,{root}):readG2SourceJson(source.ref,{root,sha256:source.sha256});
  if(packet.schema_version!==1||!g2SourceMatches(packet,manifest)
    ||packet.physical_epoch_ms!==record.physical_epoch_ms)return false;
  if(resource)return packet.kind==='G2_RESOURCE_PACKET'&&record.run_mode===manifest.mode
    &&record.evidence_type===(manifest.mode==='live'?'RESOURCE_MEASUREMENT':'SYNTHETIC_PROCESS_BROWSER')&&packet.query_sha256===g2Hash(G2_RESOURCE_SQL)
    &&record.scenario_id==='G2-O01'&&isDeepStrictEqual(record.details,packet.details)
    &&record.result===(g2ResourceComplete(packet.details)?'PASS':'INCOMPLETE');
  if(packet.kind!=='G2_STARTUP_PACKET'||!['G2-START','G2-ENV'].includes(record.scenario_id))return false;
  const facts=g2StartupFacts(packet,manifest)[record.scenario_id==='G2-START'?'start':'environment'];
  return isDeepStrictEqual(facts.details,record.details)&&facts.result===record.result;
}
