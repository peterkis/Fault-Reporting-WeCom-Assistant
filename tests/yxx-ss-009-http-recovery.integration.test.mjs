import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {withSS009Database,closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import {migrateCurrentBaselineWithYxx} from '../scripts/migrate-current-baseline.mjs';
import {g2CandidateInventory} from '../src/p2-g2-candidate.mjs';
import {g2EvidenceTime} from '../src/p2-g2-evidence-time.mjs';
import {origin,secret,flags,config,oauthOptions,mapping,browser,login,input,post,eventually} from './helpers/yxx-ss-009-http-fixture.mjs';

test('SS-009 lost actual HTTP response recovers the same authorized command without a second intake',{timeout:120000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009ack',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});const runtime=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool,publicOrigin:origin,oauth:createWeComWebOAuth(oauthOptions),reporterMemberEntry:config,identityMapping:await mapping(),reporterHmacSecret:secret,yxxSelfService:{featureFlags:flags,pollMilliseconds:100}});
    observeResource('http_listener',()=>runtime.server.listening?1:0);
    try{
      await runtime.start();const a=browser(runtime.server),b=browser(runtime.server);await login(a);await login(b,'b');const csrf=(await a.request('/api/yixiaoxiu/bootstrap')).json().csrf_token,body=input('处方提交不了');
      await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:runtime.server.address().port,path:'/api/yixiaoxiu/requests',method:'POST',headers:{...post(body,csrf).headers,host:'127.0.0.1',cookie:[...a.cookies].map(([k,v])=>k+'='+v).join('; ')}},res=>{assert.equal(res.statusCode,202);res.destroy();req.destroy();resolve();});req.on('error',reject);req.end(JSON.stringify(body));});
      const lookup=await a.request('/api/yixiaoxiu/commands/'+body.client_command_id);assert.equal(lookup.status,200,lookup.text);
      const replay=await a.request('/api/yixiaoxiu/requests',post(body,csrf));assert.equal(replay.status,200,replay.text);assert.equal(replay.json().replayed,true);
      assert.equal((await b.request('/api/yixiaoxiu/commands/'+body.client_command_id)).status,404);
      await eventually(async()=> (await pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n===1);
      for(const table of ['intake.web_request_binding','intake.web_submission','intake.web_command_receipt','pilot_ticket.ticket'])assert.equal((await pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,1);
      const processor=runtime.selfService.orchestrator;await assert.rejects(processor.processPending({batchSize:21}));const batch=await processor.processPending({batchSize:20});assert.ok(batch.claimed<=20);
    }finally{await runtime.stop();}
  }});
  t.diagnostic('SS009_RECEIPT '+JSON.stringify({...g2EvidenceTime(),kind:'fault',status:'PASS',candidate_fingerprint:g2CandidateInventory().fingerprint,http_response_lost:true,same_command_recovered:true,cross_member_denied:true,batch_max:20}));
});

test('SS-009 locked HTTP supplements recheck logout write shutdown and request revocation',{timeout:120000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss009locks',run:async({pool,databaseUrl,observeResource})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl});const switches={...flags};
    const runtime=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool,publicOrigin:origin,oauth:createWeComWebOAuth({...oauthOptions,resolveCode:async code=>({userid:code.startsWith('b-')?'open-b':'open-a'})}),reporterMemberEntry:config,identityMapping:await mapping(),reporterHmacSecret:secret,yxxSelfService:{featureFlags:switches,pollMilliseconds:100}});
    observeResource('http_listener',()=>runtime.server.listening?1:0);
    try{
      await runtime.start();await runtime.selfService.pump.stop();const a=browser(runtime.server);
      for(const mode of ['logout','identity-switch','write-off','revocation']){
        switches.YIXIAOXIU_SELF_SERVICE_ENABLED=true;await login(a,'a-'+randomUUID());const csrf=(await a.request('/api/yixiaoxiu/bootstrap')).json().csrf_token;
        const accepted=await a.request('/api/yixiaoxiu/requests',post(input('系统不行'),csrf));assert.equal(accepted.status,202,accepted.text);const ref=accepted.json().receipt.request_ref;
        const lock=await pool.connect();let pending;
        try{
          await lock.query('BEGIN');await lock.query('SELECT i.id FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE b.request_ref=$1 FOR UPDATE OF b,i',[ref]);
          pending=a.request('/api/yixiaoxiu/requests/'+ref+'/supplements',post({schema_version:1,client_command_id:randomUUID(),expected_input_revision:'1',text:'处方提交不了'},csrf));
          await eventually(async()=> (await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n>0);
          if(mode==='logout')assert.equal((await a.request('/wecom/yixiaoxiu/logout',{method:'POST',body:{},headers:{origin,'content-type':'application/json'}})).status,200);
          else if(mode==='identity-switch')await login(a,'b-'+randomUUID());
          else if(mode==='write-off')switches.YIXIAOXIU_SELF_SERVICE_ENABLED=false;
          else await lock.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1',[ref]);
          await lock.query('COMMIT');const result=await pending;assert.equal(result.status,{logout:503,'identity-switch':503,'write-off':403,revocation:404}[mode],mode+':'+result.text);assert.equal(result.headers.location,undefined);if(mode==='identity-switch')assert.equal((await a.request('/api/yixiaoxiu/requests/'+ref)).status,404);
          assert.equal((await pool.query('SELECT input_revision FROM intake.web_request_binding WHERE request_ref=$1',[ref])).rows[0].input_revision,'1');
        }finally{await lock.query('ROLLBACK');lock.release();await pending;}
      }
    }finally{await runtime.stop();}
  }});
});
