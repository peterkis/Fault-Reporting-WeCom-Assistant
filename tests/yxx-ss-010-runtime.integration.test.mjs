import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:net';
import {withSS009Database,closeSS009Resources} from './helpers/yxx-ss-009-resources.mjs';
import {runtimeFixture,scopedBrowser} from './helpers/yxx-ss-010-fixture.mjs';
import {startLimitedRuntime} from '../src/yxx-limited-write-runner.mjs';
import {createLimitedGuard} from '../src/yxx-limited-write-guard.mjs';
import {createYxxSelfServiceStore} from '../src/yxx-self-service-store.mjs';
import {createYxxMemberCommandContext} from '../src/yxx-self-service-command.mjs';
import {secret,flags,config,browser,login,input,post,eventually,mapping,oauthOptions,origin} from './helpers/yxx-ss-009-http-fixture.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createP2016CommandLedger} from '../src/p2-016-ticket-command-ledger.mjs';
import {createYxxSelfServiceOrchestrator} from '../src/yxx-self-service-orchestrator.mjs';

test('SS010 AC092 limited App Worker HTTP lifecycle rejects cross-member access and preserves restart budgets',{timeout:180000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss010',run:async context=>{
    const {pool}=context,fixture=await runtimeFixture(context),directory=path.resolve('tmp','ss010-runtime-'+randomUUID());
    fixture.manifest.public_origin='https://chengdu.mobimedical.cn';
    let runtime;
    try{
      runtime=await startLimitedRuntime({...fixture,stateDirectory:directory,synthetic:true});
      const server={address:()=>({port:runtime.port})};const a=scopedBrowser(server,fixture.manifest.public_origin),b=scopedBrowser(server,fixture.manifest.public_origin);await login(a);await login(b,'b');
      const boot=(await a.request('/api/yixiaoxiu/bootstrap')).json(),body=input('处方提交不了');
      const first=await a.request('/api/yixiaoxiu/requests',post(body,boot.csrf_token));assert.equal(first.status,202,first.text);
      const ref=first.json().receipt.request_ref;
      assert.equal((await a.request('/api/yixiaoxiu/requests',post(body,boot.csrf_token))).status,200);
      assert.equal((await b.request('/api/yixiaoxiu/requests/'+ref)).status,404);
      await eventually(async()=>(await a.request('/api/yixiaoxiu/requests/'+ref)).json().ticket);
      const ticket=(await pool.query('SELECT pilot_ticket_id::text AS id FROM intake.service_intake')).rows[0].id;
      const staff=scopedBrowser(server,'http://127.0.0.1:'+runtime.port,runtime.cookies[0]);const csrf=(await staff.request('/api/lifecycle/bootstrap')).json().csrf_token;
      assert.equal((await staff.request('/health/ready')).status,200);
      assert.equal((await a.request('/api/lifecycle/bootstrap')).status,403);
      for(const action of ['queue','accept','start','resolve','confirm']){
        const detail=(await staff.request('/api/tickets/'+ticket)).json();if(action==='queue'&&detail.status==='QUEUED')continue;
        const result=await staff.request('/api/tickets/'+ticket+'/'+action,post({client_command_id:randomUUID(),expected_version:detail.version,reason_code:'SS010_'+action.toUpperCase()},csrf));
        assert.equal(result.status,200,action+': '+result.text);
      }
      assert.equal((await a.request('/api/yixiaoxiu/requests/'+ref)).json().ticket.status,'CLOSED');
      assert.equal((await staff.request('/api/tickets/'+randomUUID()+'/accept',post({client_command_id:randomUUID(),expected_version:'1',reason_code:'SS010'},csrf))).status,403);
      assert.equal((await staff.request('/api/conversations/'+randomUUID()+'/claim',post({client_command_id:randomUUID()},csrf))).status,403);
      assert.equal((await startLimitedRuntime({...fixture,stateDirectory:path.resolve('tmp','ss010-competing-'+randomUUID()),synthetic:true}).then(()=>null,e=>e.code)),'SS010_COMPETING_RUNTIME');
      assert.equal((await runtime.stop()).cleanup_passed,true);
      assert.equal(JSON.parse(readFileSync(runtime.stateFile)).counts.intakes,1);
      runtime=await startLimitedRuntime({...fixture,stateDirectory:directory,resume:true,synthetic:true});
      const renewed=scopedBrowser({address:()=>({port:runtime.port})},fixture.manifest.public_origin);await login(renewed);
      const csrf2=(await renewed.request('/api/yixiaoxiu/bootstrap')).json().csrf_token;
      const replay=await renewed.request('/api/yixiaoxiu/requests',post(body,csrf2));assert.equal(replay.status,200,replay.text);
      const attempts=await Promise.all(Array.from({length:7},()=>renewed.request('/api/yixiaoxiu/requests',post(input('谢谢'),csrf2))));
      assert.equal(attempts.filter(r=>r.status===202).length,3);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM intake.web_request_binding')).rows[0].n,4);
      assert.equal([...runtime.children.keys()].join(','),'APP,WORKER');
      writeFileSync(path.join(directory,'stop.request'),'test stop');
      await eventually(()=>runtime.status().status==='STOPPED');
      assert.equal(runtime.status().cleanup_passed,true);
      const readonly=createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool,oauth:createWeComWebOAuth(oauthOptions),publicOrigin:origin,
        reporterMemberEntry:config,identityMapping:await mapping(),reporterHmacSecret:secret,
        yxxSelfService:{featureFlags:{...flags,YIXIAOXIU_SELF_SERVICE_ENABLED:false}}});
      try{
        await readonly.start();const reader=browser(readonly.server);await login(reader);
        const readBoot=(await reader.request('/api/yixiaoxiu/bootstrap')).json();assert.equal(readBoot.read_only,true);
        assert.equal((await reader.request('/api/yixiaoxiu/requests/'+ref)).status,200);
        assert.equal((await reader.request('/api/yixiaoxiu/requests',post(input('处方提交不了'),readBoot.csrf_token))).status,403);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM intake.web_request_binding')).rows[0].n,4);
      }finally{await readonly.stop();}
    }finally{await runtime?.stop();}
  }});
});

test('SS010 AC092 preflight rejects occupied port drift and resumed foreign scope without processing pending',{timeout:90000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss010',run:async context=>{
    const fixture=await runtimeFixture(context),directory=path.resolve('tmp','ss010-preflight-'+randomUUID());
    const incident=(await context.pool.query(`WITH deadline AS MATERIALIZED (SELECT platform.physical_epoch_ms()+86400000 AS epoch)
      INSERT INTO incident.incident(incident_no,status,confirmed_scope,service_family,symptom_family,severity,safe_title,safe_public_summary_code,owner_principal_id,retention_until,retention_until_epoch_ms)
      SELECT 'INC-'||upper(replace($1,'-','')),'CONFIRMED_LOCAL','LOCAL','TEST','TEST','LOW','公共信息系统故障','PUBLIC_IT_INCIDENT',$2::uuid,
        platform.local_from_epoch_ms(epoch),epoch FROM deadline RETURNING id::text`,[randomUUID(),fixture.manifest.principal_ids[0]])).rows[0];
    await assert.rejects(startLimitedRuntime({...fixture,stateDirectory:directory,synthetic:true}),{code:'SS010_FORBIDDEN_ARTIFACT'});
    await context.pool.query('DELETE FROM incident.incident WHERE id=$1::uuid',[incident.id]);
    const initial=await startLimitedRuntime({...fixture,stateDirectory:directory,synthetic:true});await initial.stop();
    const guard=createLimitedGuard({manifest:fixture.manifest,member:config,secret});
    const auth={profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,csrf_token:'csrf',canonical_reporter_binding:guard.bindings[0],source_corp_scope:config.corpId,source_app_scope:config.agentId,proof_ref:config.proofRef};
    const command=createYxxMemberCommandContext({store:createYxxSelfServiceStore({pool:context.pool,scopeSecret:secret}),profile:auth.profile,flags,
      authenticate:async()=>auth,recheck:Object.assign(async()=>auth,{localOnly:true}),quota:Object.assign(async()=>true,{localOnly:true})});
    const body=input('处方提交不了');await command.accept({input:body,request:post(body,'csrf')});
    const occupied=createServer();await new Promise(resolve=>occupied.listen(fixture.manifest.listen_port,'127.0.0.1',resolve));
    try{await assert.rejects(startLimitedRuntime({...fixture,stateDirectory:directory,resume:true,synthetic:true}),{code:'SS010_PORT_UNAVAILABLE'});}
    finally{await new Promise(resolve=>occupied.close(resolve));}
    assert.equal((await context.pool.query('SELECT processed_revision::text AS revision FROM intake.web_request_binding')).rows[0].revision,'0');
    assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n,0);
    await assert.rejects(startLimitedRuntime({...fixture,stateDirectory:path.resolve('tmp','ss010-reset-'+randomUUID()),synthetic:true}),{code:'SS010_DATABASE_SCOPE'});
    const changed=structuredClone(fixture.manifest);changed.limits.max_supplements++;
    await assert.rejects(startLimitedRuntime({...fixture,manifest:changed,stateDirectory:directory,resume:true,synthetic:true}),{code:'SS010_RESUME_BINDING_MISMATCH'});
    const stateFile=path.join(directory,'state.json'),original=readFileSync(stateFile,'utf8'),state=JSON.parse(original);
    try{
      delete state.counts;writeFileSync(stateFile,JSON.stringify(state));
      await assert.rejects(startLimitedRuntime({...fixture,stateDirectory:directory,resume:true,synthetic:true}),{code:'SS010_RESUME_STATE_INVALID'});
      writeFileSync(stateFile,JSON.stringify({...JSON.parse(original),status:null}));
      await assert.rejects(startLimitedRuntime({...fixture,stateDirectory:directory,resume:true,synthetic:true}),{code:'SS010_RESUME_STATE_INVALID'});
    }finally{writeFileSync(stateFile,original);}
    await context.pool.query("UPDATE intake.web_request_binding SET source_corp_scope='foreign'");
    await assert.rejects(startLimitedRuntime({...fixture,stateDirectory:directory,resume:true,synthetic:true}),{code:'SS010_DATABASE_SCOPE'});
    await context.pool.query('UPDATE intake.web_request_binding SET source_corp_scope=$1',[config.corpId]);
    await context.pool.query("DELETE FROM platform.schema_migration WHERE migration_id='034_yxx_self_service_direct_chat_check'");
    await assert.rejects(startLimitedRuntime({...fixture,stateDirectory:directory,resume:true,synthetic:true}),{code:'SS010_MIGRATION_NOT_READY'});
  }});
});

test('SS010 AC092 concurrent global and supplement limits count committed commands and never charge replays',{timeout:90000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss010',run:async context=>{
    const fixture=await runtimeFixture(context);fixture.manifest.limits={max_new_intakes:3,max_supplements:2,max_new_tickets:3,per_member_intakes:2,per_member_supplements:2};
    const guard=createLimitedGuard({manifest:fixture.manifest,member:config,secret}),pool=guard.protectPool(context.pool);
    const make=index=>{
      const auth={profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,csrf_token:'csrf',canonical_reporter_binding:guard.bindings[index],source_corp_scope:config.corpId,source_app_scope:config.agentId,proof_ref:config.proofRef};
      return createYxxMemberCommandContext({store:createYxxSelfServiceStore({pool,scopeSecret:secret}),profile:auth.profile,flags,authenticate:async()=>auth,
        recheck:Object.assign(async()=>auth,{localOnly:true}),quota:guard.quota});
    };
    const a=make(0),b=make(1),submit=(command,body)=>command.accept({input:body,request:post(body,'csrf')});
    const body=input('系统不行'),first=await submit(a,body);
    const attempts=await Promise.allSettled(Array.from({length:7},(_,i)=>submit(i%2?a:b,input('系统不行'))));
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,2);
    assert.equal((await submit(a,body)).replayed,true);
    await assert.rejects(submit(a,{...body,description:'changed'}),{code:'YXX_COMMAND_CONFLICT'});
    const supplement={schema_version:1,client_command_id:randomUUID(),expected_input_revision:'1',text:'合成补充'};
    const add=body=>a.accept({kind:'SUPPLEMENT',requestRef:first.receipt.request_ref,input:body,request:post(body,'csrf')});
    assert.equal((await add(supplement)).replayed,false);assert.equal((await add(supplement)).replayed,true);
    await add({...supplement,client_command_id:randomUUID(),expected_input_revision:'2'});
    await assert.rejects(add({...supplement,client_command_id:randomUUID(),expected_input_revision:'3'}),{code:'YXX_MEMBER_QUOTA_EXCEEDED'});
    assert.deepEqual(await guard.inspect(context.pool),{intakes:3,supplements:2,tickets:0});
  }});
});

test('SS010 AC093 commit-time revocation rolls back facts and new runs cannot reset persisted scope',{timeout:90000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss010',run:async context=>{
    const fixture=await runtimeFixture(context);let revoked=false;
    const guard=createLimitedGuard({manifest:fixture.manifest,member:config,secret,isStopped:()=>revoked}),pool=guard.protectPool(context.pool);
    const auth={profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,csrf_token:'csrf',canonical_reporter_binding:guard.bindings[0],source_corp_scope:config.corpId,source_app_scope:config.agentId,proof_ref:config.proofRef};
    const recheck=Object.assign(async()=>{revoked=true;return auth;},{localOnly:true});
    const command=createYxxMemberCommandContext({store:createYxxSelfServiceStore({pool,scopeSecret:secret}),profile:auth.profile,flags,authenticate:async()=>auth,recheck,quota:guard.quota});
    const body=input('处方提交不了');await assert.rejects(command.accept({input:body,request:post(body,'csrf')}),{code:'SS010_WINDOW_CLOSED'});
    assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM intake.web_command_receipt')).rows[0].n,0);
    revoked=false;
    const tx=await pool.connect();try{await tx.query('BEGIN');await tx.query('SELECT 1');revoked=true;await assert.rejects(tx.query('COMMIT'),{code:'SS010_WINDOW_CLOSED'});await tx.query('ROLLBACK');}finally{tx.release();}
    revoked=false;
    const seeded=await createYxxSelfServiceStore({pool:context.pool,scopeSecret:secret}).accept({scope:{scopeHash:guard.bindings[0],sourceCorpScope:config.corpId,sourceAppScope:config.agentId,proofRef:config.proofRef},input:body});
    await createYxxSelfServiceOrchestrator({pool:context.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags}).processOne({requestRef:seeded.receipt.request_ref});
    const ticketId=(await context.pool.query('SELECT pilot_ticket_id::text AS id FROM intake.service_intake')).rows[0].id;assert.ok(ticketId);
    const ledger=createP2016CommandLedger({pool});
    await assert.rejects(ledger.execute({command:{client_command_id:randomUUID(),action:'queue',ticket_id:ticketId},authorize:async()=>({principal:{principal_id:fixture.manifest.principal_ids[0]}}),
      run:async()=>{revoked=true;throw Error('ordinary business error');}}),{code:'SS010_WINDOW_CLOSED'});
    assert.equal((await context.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket_command_receipt')).rows[0].n,0);
    const missing=path.resolve('tmp','ss010-missing-'+randomUUID());await assert.rejects(startLimitedRuntime({...fixture,stateDirectory:missing,resume:true,synthetic:true}),{code:'SS010_RESUME_STATE_REQUIRED'});
    const wrong=structuredClone(fixture.manifest);wrong.database.oid='1';await assert.rejects(startLimitedRuntime({...fixture,manifest:wrong,stateDirectory:missing,synthetic:true}),{code:'SS010_DATABASE_IDENTITY_MISMATCH'});
  }});
});
test('SS010 AC094 lost controller IPC stops roles without starting a Gateway or deleting facts',{timeout:90000},async t=>{
  await withSS009Database({testContext:t,databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'ss010',run:async context=>{
    const fixture=await runtimeFixture(context);let runtime;
    try{
      runtime=await startLimitedRuntime({...fixture,stateDirectory:path.resolve('tmp','ss010-loss-'+randomUUID()),synthetic:true});
      runtime.children.get('APP').disconnect();
      await eventually(()=>runtime.status().status==='STOPPED');
      assert.equal(runtime.status().reason,'ROLE_EXITED');assert.equal(runtime.children.has('GATEWAY'),false);
      assert.ok([...runtime.children.values()].every(child=>child.exitCode!==null||child.signalCode!==null));
      assert.deepEqual(runtime.status().counts,{intakes:0,supplements:0,tickets:0});
    }finally{await runtime?.stop();}
  }});
});
