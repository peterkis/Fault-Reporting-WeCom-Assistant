import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../src/platform/postgres-pool.mjs';
import { createP2012LiveCluster } from '../src/p2-012-live-cluster.mjs';
import { readP2012LiveConfiguration } from '../src/p2-012-live-configuration.mjs';
import { launchP2G1TestBrowserSessions } from '../src/p2-g1-browser-sessions.mjs';
import { nowShanghaiLocal } from '../src/platform/time-contract.mjs';
import { p2012CandidateHash } from './validate-p2-012-human-confirmed-incident.mjs';
import { checkP2012Live } from './p2-012-live-check.mjs';
import { assertP2016DatabaseScope as assertP2012DatabaseScope } from './p2-016-live-check.mjs';
import { G2_ROOT } from '../src/p2-g2-candidate.mjs';

export function p2012LiveDuration(argv){
  if(argv.length!==1||!/^--observe-seconds=[0-9]{3,4}$/u.test(argv[0]))throw new Error('P2_012_LIVE_ARGS_INVALID');
  const n=Number(argv[0].slice(18));if(n<900||n>3600)throw new Error('P2_012_LIVE_OBSERVATION_RANGE_INVALID');return n*1000;
}
export async function main(argv=process.argv.slice(2)){
  const duration=p2012LiveDuration(argv),checked=await checkP2012Live();
  if(!checked.ok){console.log(JSON.stringify(checked));process.exitCode=1;return;}
  const config=readP2012LiveConfiguration(process.env),runId=randomUUID();
  const guard=createPostgresPool({connectionString:config.databaseUrl,max:1,connectionTimeoutMillis:3000,application_name:'p2_012_live_controller'});
  let guardClient,cluster,browsers,input,stopping=false,blocked=false,fragmentLost=false,control=Promise.resolve();
  const evidence=path.join(G2_ROOT,'evidence/p2-012-live-e2e.jsonl');
  const record=async(event,fields={})=>{
    const row={task:'P2-012',run_id:runId,occurred_at:nowShanghaiLocal(),event,
      runtime_input_sha256:checked.runtime_input_sha256,...fields};
    const line=JSON.stringify(row);await appendFile(evidence,line+'\n');console.log(line);
  };
  const interrupt=()=>{stopping=true;};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  let start=0;
  try{
    guardClient=await guard.connect();
    if(!(await guardClient.query("SELECT pg_try_advisory_lock(hashtext('P2_012_LIVE_SINGLETON')) AS acquired")).rows[0].acquired)throw new Error('P2_012_LIVE_ALREADY_RUNNING');
    await assertP2012DatabaseScope(guardClient,config);
    cluster=createP2012LiveCluster(config,{gatewayEnabled:true,senderEnabled:true});
    const started=await cluster.start();
    browsers=await launchP2G1TestBrowserSessions({origin:started.origin,cookies:started.cookies,initialPath:'/workbench/lifecycle',requireCleanupSuccess:true});
    start=performance.now();
    await record('STARTED',{process_count:3,total_pool_max_including_controller:8,loopback_origin:started.origin,
      workbench_path:'/workbench/lifecycle',incident_navigation_path:'/workbench/incidents',group_strong_mention:'UNVERIFIED',client_observations:'PENDING',owner_approval:'PENDING'});
    console.log('Commands: gateway-disconnect | gateway-reconnect | fragment-lost | stop. Do not enter identities or tokens.');
    input=createInterface({input:process.stdin,terminal:false});
    input.on('line',line=>{
      if(line==='stop'){stopping=true;return;}
      if(line==='fragment-lost'){fragmentLost=true;blocked=true;stopping=true;return;}
      if(!['gateway-disconnect','gateway-reconnect'].includes(line))return;
      control=control.then(async()=>{if(stopping)return;const value=line==='gateway-disconnect'?await cluster.disconnectGateway():await cluster.reconnectGateway();await record(line.toUpperCase().replaceAll('-','_'),{authenticated:value.authenticated===true});})
        .catch(()=>{blocked=true;stopping=true;});
    });
    let nextSample=0;
    while(!stopping&&performance.now()-start<duration){
      if(performance.now()>=nextSample){
        if(await p2012CandidateHash()!==checked.runtime_input_sha256)throw new Error('P2_012_CANDIDATE_CHANGED');
        await record('RESOURCE_SAMPLE',{elapsed_ms:performance.now()-start,metrics:await cluster.metrics()});nextSample=performance.now()+15000;
      }
      await new Promise(r=>setTimeout(r,250));
    }
    await record(blocked?'BLOCKED':'OBSERVATION_ENDED',{observed_ms:performance.now()-start,minimum_duration_met:performance.now()-start>=900000,
      fragment_lost:fragmentLost,client_observations:'REQUIRES_RECORDED_HUMAN_EVIDENCE',owner_approval:'NOT_RECORDED',task_done:false});
    if(performance.now()-start<900000)process.exitCode=1;
  }finally{
    stopping=true;input?.close();await control;
    let browserClean=true,processes=0;
    try{await browsers?.close();}catch{browserClean=false;}
    try{if(cluster)processes=(await cluster.stop()).process_count;}finally{guardClient?.release();await guard.end();}
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
    if(start)await record('CLEANUP',{process_count:processes,browser_profiles_removed:browserClean,controller_pool_closed:true,
      task_done:false,second_commit_created:false});
    if(blocked||processes!==0||!browserClean)process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(()=>{
  console.log(JSON.stringify({task:'P2-012',ok:false,error_code:'P2_012_LIVE_RUN_FAILED',task_done:false}));process.exitCode=1;
});
