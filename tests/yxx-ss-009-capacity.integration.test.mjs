import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {createPostgresPool} from '../src/platform/postgres-pool.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createPilotAccessService} from '../src/p1-009-pilot-access-workbench.mjs';
import {migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';
import {withSS009Database,closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import {configurationFixture} from './helpers/p2-g2-configuration-fixture.mjs';
import {g2DatabaseIdentity,minimalG2Environment} from '../src/p2-g2-validation-config.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {yxxIdentityConfigHash} from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {origin,secret,flags,config,oauthOptions,mapping,browser,login,input,post} from './helpers/yxx-ss-009-http-fixture.mjs';

async function until(fn){const deadline=Date.now()+60000;while(Date.now()<deadline){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('SS009_RECOVERY_TIMEOUT');}
async function drain(pool){
  // FULL intentionally reserves one Web root per 250ms cycle: 500 roots need
  // at least 125s. Keep a fixed total bound and separately reject stalled work.
  const deadline=Date.now()+180000;let previous=Infinity,lastProgress=Date.now();
  while(Date.now()<deadline){const n=(await pool.query('SELECT count(*)::int AS n FROM intake.web_request_binding WHERE input_revision>processed_revision')).rows[0].n;
    if(n===0)return;if(n<previous){previous=n;lastProgress=Date.now();}assert.ok(Date.now()-lastProgress<10000,'SS009_QUEUE_STALLED');await new Promise(r=>setTimeout(r,100));}
  throw Error('SS009_DRAIN_BOUND_EXCEEDED');
}

async function capacity(profile,t){
  const fingerprint=g2CandidateInventory().fingerprint,receipts=[];
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'g2ss009cap',max:1,run:async({pool:control,databaseUrl,observeResource})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});
    const pool=createPostgresPool({connectionString:databaseUrl,max:4,application_name:'ss009_capacity_app'});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'ss009-admin',displayName:'Synthetic capacity',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const identityMapping=await mapping(),options={pool,publicOrigin:origin,reporterMemberEntry:config,identityMapping,reporterHmacSecret:secret};
    const staffRuntime=createYxxProfile({...options,profile:'FULL_SERVICE_LOOP',reporterPolicy:'MEMBER_REQUIRED',principalId:principal.id,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true},wecomWebOAuth:oauthOptions,yxxSelfService:{featureFlags:flags}});
    const app=profile==='FULL_SERVICE_LOOP'?staffRuntime:createYxxProfile({...options,profile,oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:flags,pollMilliseconds:100}});
    let primaryError=null,samplingError=null,pumpStopped=null,samplingClosed=true;let worker,timer,sampling=Promise.resolve(),sampleBusy=false;const messages=[],latencies=[],samples=[];const start=performance.now(),cpuStart=process.cpuUsage();
    observeResource('app_pool',()=>pool.totalCount);observeResource('member_listener',()=>app.server.listening?1:0);observeResource('staff_listener',()=>staffRuntime.server.listening?1:0);observeResource('worker_process',()=>worker&&worker.exitCode===null&&worker.signalCode===null?1:0);observeResource('sampler_in_flight',()=>sampleBusy?1:0);observeResource('sampler_timer',()=>samplingClosed?0:1);observeResource('self_pump',()=>app.selfService.pump&&!(pumpStopped?.stopped===true&&pumpStopped.running===false)?1:0);
    try{
      const started=await staffRuntime.start();if(app!==staffRuntime)await app.start();
      if(profile==='FULL_SERVICE_LOOP'){
        assert.equal(app.selfService.pump,null);const f=configurationFixture();f.manifest.scope.database_identity_hash=g2DatabaseIdentity(databaseUrl).fingerprint;
        f.manifest.scope.reporter_access_policy='MEMBER_REQUIRED';f.manifest.scope.member_entry_config_sha256=yxxIdentityConfigHash(config);f.manifest.candidate_fingerprint=fingerprint;
        worker=fork('scripts/p2-g2-process-role.mjs',['--role=worker'],{windowsHide:true,execArgv:['--expose-gc'],env:{...minimalG2Environment(),...f.env,PILOT_DATABASE_URL:databaseUrl,P2_G2_MANIFEST:JSON.stringify(f.manifest),P2_G1_SENDER_ENABLED:'false',YIXIAOXIU_SELF_SERVICE_ENABLED:'true',YIXIAOXIU_MY_REPORTS_ENABLED:'true'},stdio:['ignore','ignore','ignore','ipc']});
        worker.on('message',m=>{if(m.type==='metrics-response')samples.push({...g2EvidenceTime(),role:'WORKER',...m.metrics});else messages.push(m);});
        await until(()=>{const failed=messages.find(m=>m.type==='role-failed');if(failed)throw Error(failed.error_code);return messages.find(m=>m.type==='role-ready');});
      }
      samplingClosed=false;timer=setInterval(()=>{if(sampleBusy)return;sampleBusy=true;sampling=(async()=>{
        const pending=(await control.query(`SELECT count(*)::int AS pending,COALESCE(EXTRACT(EPOCH FROM(platform.local_now()-min(created_at))),0)::float8 AS oldest_seconds FROM intake.web_request_binding WHERE input_revision>processed_revision`)).rows[0];
        samples.push({role:'APP',...g2EvidenceTime(),...process.memoryUsage(),pool_total:pool.totalCount,pool_waiting:pool.waitingCount,...pending});worker?.send({type:'metrics-request',request_id:randomUUID()});
      })().catch(error=>{samplingError=error;}).finally(()=>{sampleBusy=false;});},100);
      const member=browser(app.server),staff=browser(staffRuntime.server,started.cookie);await login(member);
      const csrf=(await member.request('/api/yixiaoxiu/bootstrap')).json().csrf_token,staffCsrf=(await staff.request('/api/lifecycle/bootstrap')).json().csrf_token;
      async function send(path,body,client=member,token=csrf){const at=performance.now(),r=await client.request(path,post(body,token));latencies.push(performance.now()-at);assert.ok([200,202].includes(r.status),r.text);return r.json();}
      const refs=[];for(let i=0;i<500;i++){
        const text=i<200?'处方提交不了':i<300?'系统不行':i<350?'急诊患者等着做检查，但检查申请完全提交不了':i<400?'这个问题一直没处理我要投诉':'谢谢';
        refs.push((await send('/api/yixiaoxiu/requests',input(text))).receipt.request_ref);
      }
      await drain(control);
      const initial=(await control.query('SELECT display_status,count(*)::int FROM (SELECT CASE WHEN i.pilot_ticket_id IS NOT NULL THEN \'TICKET\' ELSE i.status END AS display_status FROM intake.service_intake i) x GROUP BY display_status')).rows;
      assert.equal((await control.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n,250,JSON.stringify(initial));
      const reviews=(await control.query("SELECT r.id::text,r.row_version::text FROM intake.manual_review_item r JOIN intake.service_intake i ON i.id=r.service_intake_id WHERE r.status='PENDING' ORDER BY i.pilot_ticket_id NULLS FIRST,r.id")).rows;assert.equal(reviews.length,100,JSON.stringify(initial));
      for(let i=0;i<reviews.length;i++)await send('/api/manual-reviews/'+reviews[i].id+'/resolve',{client_command_id:randomUUID(),expected_row_version:reviews[i].row_version,resolution_code:i<50?'CONFIRM_TICKET_ELIGIBLE':'MARK_OUT_OF_SCOPE',resolution_reason_code:'SS009_SYNTHETIC'},staff,staffCsrf);
      for(let revision=1;revision<=10;revision++)for(const ref of refs.slice(0,200))await send('/api/yixiaoxiu/requests/'+ref+'/supplements',{schema_version:1,client_command_id:randomUUID(),expected_input_revision:String(revision),text:'补充说明：仍然只有这一台受影响'});
      const same=input('处方提交不了');const duplicate=await Promise.all(Array.from({length:12},()=>send('/api/yixiaoxiu/requests',same)));
      assert.equal(new Set(duplicate.map(x=>x.receipt.request_ref)).size,1);assert.equal(duplicate.filter(x=>!x.replayed).length,1);
      assert.equal((await member.request('/api/yixiaoxiu/requests',post({...same,description:'不同正文'},csrf))).status,409);
      const reads=await Promise.all(Array.from({length:32},async(_,i)=>{
        for(const path of ['/api/yixiaoxiu/my-reports','/api/yixiaoxiu/requests/'+refs[i],'/api/yixiaoxiu/requests/'+refs[i]+'/timeline'])assert.equal((await member.request(path)).status,200);
        return true;
      }));assert.equal(reads.length,32);
      await drain(control);
      const counts={};for(const [key,table] of Object.entries({roots:'intake.web_request_binding',sources:'intake.web_submission',receipts:'intake.web_command_receipt',tickets:'pilot_ticket.ticket'}))counts[key]=(await control.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n;
      assert.deepEqual(counts,{roots:501,sources:2501,receipts:2501,tickets:301});
      assert.equal((await control.query("SELECT count(*)::int AS n FROM intake.web_request_binding WHERE input_revision='11' AND processed_revision='11'")).rows[0].n,200);
      const artifacts={};for(const table of ['communication.message','communication.outbox','communication.delivery','pilot_ticket.reporter_access_grant','channel.message_inbox','conversation.session']){artifacts[table]=(await control.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n;assert.equal(artifacts[table],0);}
      assert.equal(messages.some(m=>m.type==='provider-send-request'),false);assert.ok(samples.length>0);assert.ok(samples.filter(s=>s.role==='APP').every(s=>s.pool_total<=4));
      latencies.sort((a,b)=>a-b);receipts.push({profile,...counts,submissions:500,supplements:2000,reviews:100,readers:32,duplicate_requests:12,artifacts,elapsed_ms:performance.now()-start,cpu:process.cpuUsage(cpuStart),latency_p50_ms:latencies[Math.floor(latencies.length*.5)],latency_p95_ms:latencies[Math.floor(latencies.length*.95)],samples,external_network_calls:0,gateway_processes:0,controller_pool_max:1,app_pool_max:4,worker_pool_max:worker?2:0,formal_2c4g_60min:false});
    }catch(error){primaryError=error;t.diagnostic('SS009_CAPACITY_FAILURE '+JSON.stringify({profile,error:error.message,worker_messages:messages.slice(-5),last_samples:samples.slice(-3)}));throw error;}finally{
      await closeSS009Resources([
        async()=>{clearInterval(timer);samplingClosed=true;await sampling;if(samplingError)throw samplingError;},
        async()=>{pumpStopped=await app.selfService.pump?.stop();},
        ()=>app.stop(),()=>app!==staffRuntime?staffRuntime.stop():undefined,
        async()=>{if(worker&&worker.exitCode===null&&worker.signalCode===null){const exited=once(worker,'exit');if(worker.connected)worker.send({type:'stop'});const kill=setTimeout(()=>worker.kill('SIGKILL'),10000);try{const [code]=await exited;if(!primaryError)assert.equal(code,0);}finally{clearTimeout(kill);}}},
        ()=>pool.end()
      ],primaryError);
      assert.equal(pool.totalCount,0);assert.equal(app.server.listening,false);assert.equal(staffRuntime.server.listening,false);

    }
  }});
  t.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),kind:'capacity',status:'PASS',candidate_fingerprint:g2CandidateInventory(process.cwd()).fingerprint,profiles:receipts}));
}
test('SS-009 MEMBER_SELF_SERVICE actual HTTP capacity 500 submissions 2000 supplements 100 reviews and 32 readers',{timeout:360000},t=>capacity('MEMBER_SELF_SERVICE',t));

test('SS-009 FULL_SERVICE_LOOP actual HTTP capacity 500 submissions 2000 supplements 100 reviews and 32 readers',{timeout:360000},t=>capacity('FULL_SERVICE_LOOP',t));
