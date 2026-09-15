import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import AiBot from '@wecom/aibot-node-sdk';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {createP2G1WeComGateway} from '../src/p2-g1-wecom-gateway.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {validateTargetedCreationConfig,targetedCreationConfigHash,createTargetedTicketCreation} from '../src/p2-g2-yxx-targeted-creation.mjs';

export function readTargetedLaunchConfiguration(env){
  const fail=()=>{throw Error('YXX_CREATION_LAUNCH_CONFIG_INVALID');};
  const envelope=JSON.parse(readFileSync(env.YXX_CREATION_CONFIG,'utf8'));
  const config=validateTargetedCreationConfig(envelope.config);
  if(envelope.config_sha256!==targetedCreationConfigHash(config)||! /^[a-f0-9]{64}$/u.test(envelope.candidate_fingerprint??'')
    ||envelope.authorization!=='PROJECT_OWNER_TARGETED_CREATION_APPROVED'
    ||env.YXX_CREATION_APPROVED!=='true'||config.botId!==env.WECOM_BOT_ID
    ||!env.WECOM_BOT_SECRET||env.WECOM_WS_URL!=='wss://openws.work.weixin.qq.com'
    ||typeof env.P2_G2_REPORTER_HMAC_SECRET!=='string'||Buffer.byteLength(env.P2_G2_REPORTER_HMAC_SECRET)<32)fail();
  let db;try{db=new URL(env.PILOT_DATABASE_URL);}catch{fail();}
  if(!['postgres:','postgresql:'].includes(db.protocol)||!['127.0.0.1','localhost'].includes(db.hostname)
    ||db.pathname!=='/'+envelope.database_name||decodeURIComponent(db.username)!==envelope.database_name
    ||!/^p2_g2_live_[a-f0-9]{16}$/u.test(envelope.database_name??'')||!/^\d+$/u.test(envelope.database_oid??''))fail();
  return {envelope,config};
}

export async function main(argv=process.argv.slice(2),env=process.env,{PoolFactory=createPostgresPool,GatewayFactory=createP2G1WeComGateway}={}){
  if(argv.length!==1||!['--check','--serve'].includes(argv[0]))throw Error('YXX_CREATION_ARGUMENT_INVALID');
  const {envelope,config}=readTargetedLaunchConfiguration(env);
  if(g2CandidateInventory().fingerprint!==envelope.candidate_fingerprint)throw Error('YXX_CREATION_CANDIDATE_CHANGED');
  const emit=(event,details={})=>console.log(JSON.stringify({event,...details,...g2EvidenceTime()}));
  if(argv[0]==='--check'){emit('YXX_CREATION_OFFLINE_CHECK_PASSED',{database_connections:0,provider_calls:0,real_sends:0});return;}
  const start=BigInt(config.startEpochMs),end=BigInt(config.endEpochMs),now=BigInt(Date.now());
  if(now<start||now>=end)throw Error('YXX_CREATION_WINDOW_CLOSED');
  const pool=PoolFactory({connectionString:env.PILOT_DATABASE_URL,max:3,connectionTimeoutMillis:2000,
    statement_timeout:5000,application_name:'yxx_targeted_creation'});
  let lock,gateway,runtime,timer,poll,stopping=false;const pending=new Set(),completed=new Set();
  const stop=async(reason)=>{
    if(stopping)return;stopping=true;runtime?.close();clearTimeout(timer);clearInterval(poll);
    await gateway?.stop();await Promise.allSettled([...pending]);
    lock?.release();await pool.end();emit('YXX_CREATION_STOPPED',{reason,completed_cases:[...completed],real_sends:0});
  };
  try{
    lock=await pool.connect();
    const identity=await lock.query(`SELECT current_database() AS name,d.oid::text AS oid,
      current_user=pg_get_userbyid(d.datdba) AS owner FROM pg_database d WHERE datname=current_database()`);
    if(identity.rows[0]?.name!==envelope.database_name||identity.rows[0]?.oid!==envelope.database_oid||!identity.rows[0]?.owner)
      throw Error('YXX_CREATION_DATABASE_MISMATCH');
    const acquired=await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',['YXX_TARGETED_GATEWAY:'+config.botId]);
    if(!acquired.rows[0].acquired)throw Error('YXX_CREATION_GATEWAY_ALREADY_ACTIVE');
    const prior=await lock.query("SELECT response_snapshot FROM channel.message_inbox WHERE trace_id=$1 AND processing_status='COMPLETED'",[config.runId]);
    for(const row of prior.rows){
      if(row.response_snapshot.config_hash!==envelope.config_sha256)throw Error('YXX_CREATION_CONFIG_CHANGED');
      completed.add(row.response_snapshot.case_id);
    }
    if(completed.size===4){await stop('ALL_CASES_ALREADY_COMPLETE');return;}
    runtime=createTargetedTicketCreation({pool,config,reporterHmacSecret:env.P2_G2_REPORTER_HMAC_SECRET});
    gateway=GatewayFactory({enabled:true,botId:env.WECOM_BOT_ID,secret:env.WECOM_BOT_SECRET,wsUrl:env.WECOM_WS_URL,
      clientFactory:options=>new AiBot.WSClient({...options,maxReconnectAttempts:0,maxAuthFailureAttempts:0}),
      onFrame:frame=>{
        if(stopping)return;
        if(pending.size>=4){void stop('INPUT_CONCURRENCY_LIMIT');return;}
        const task=runtime.accept(frame).then(result=>{
          emit('YXX_CREATION_INBOUND',result);
          if(result.ok)completed.add(result.case_id);
          if(completed.size===4)setImmediate(()=>void stop('ALL_CASES_COMPLETE'));
          else if(!result.ok&&result.code!=='YXX_CREATION_SCOPE_DENIED')setImmediate(()=>void stop('INBOUND_FAILED'));
        }).catch(()=>{emit('YXX_CREATION_INBOUND_FAILED');setImmediate(()=>void stop('INBOUND_FAILED'));});
        pending.add(task);void task.finally(()=>pending.delete(task));return task;
      }});
    lock.on('error',()=>void stop('DATABASE_LOCK_LOST'));
    timer=setTimeout(()=>void stop('WINDOW_EXPIRED'),Number(end-BigInt(Date.now())));
    const authDeadline=Date.now()+15000;let ready=false;
    poll=setInterval(()=>{
      const status=gateway.getStatus();
      if(status.authenticated&&!ready){ready=true;emit('YXX_CREATION_READY',{run_id:config.runId,end_epoch_ms:config.endEpochMs,max_tickets:4,real_sends:0});}
      if(status.last_error_code||(ready&&!status.authenticated)||(!ready&&Date.now()>authDeadline))void stop('GATEWAY_UNAVAILABLE');
    },250);
    process.once('SIGTERM',()=>void stop('SIGTERM'));process.once('SIGINT',()=>void stop('SIGINT'));
    await gateway.start();
    return {stop};
  }catch(error){await stop('START_FAILED');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  await main().catch(()=>{console.error(JSON.stringify({event:'YXX_CREATION_FAILED',...g2EvidenceTime()}));process.exitCode=1;});
