import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createYxxProfile } from '../src/p2-g2-yixiaoxiu-profile.mjs';
import { createWeComWebOAuth } from '../src/p2-g2-wecom-web-oauth.mjs';
import { createYxxDelegatedIdentityMapping } from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import { createPilotAccessService } from '../src/p1-009-pilot-access-workbench.mjs';
import { migrateCurrentBaseline, migrateCurrentBaselineWithYxx } from '../scripts/migrate-current-baseline.mjs';
import { withP2016IsolatedDatabase, assertNoP2016Residual } from './helpers/p2-016-postgres-harness.mjs';
import { createPilotWorkbenchAuthorizationAdapter } from '../src/p2-006-workbench-authorization.mjs';
import { listAuthorizedRealtimeEvents, normalizeRealtimeAuthorization } from '../src/p2-003-realtime-event-log.mjs';
import { withG2Runtime } from './helpers/p2-g2-runtime-harness.mjs';
import { launchSystemBrowser } from './helpers/p2-006-browser-harness.mjs';
import { configurationFixture } from './helpers/p2-g2-configuration-fixture.mjs';
import { g2CandidateInventory } from '../src/p2-g2-candidate.mjs';
import { g2DatabaseIdentity, minimalG2Environment } from '../src/p2-g2-validation-config.mjs';
import { yxxSelfServiceRoleEnvironment } from '../src/p2-g2-yixiaoxiu-g2-config.mjs';
import { yxxIdentityConfigHash } from '../src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createServiceCatalog,loadServiceCatalog} from '../src/p2-007-service-catalog.mjs';
import {createRuleEngine} from '../src/p2-007-rule-engine.mjs';

const origin='https://127.0.0.1';
const secret='ss008-synthetic-secret-at-least-32-bytes';
const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
const config={enabled:true,corpId:'synthetic-corp',agentId:'1000002',botId:'bot-test',identityMode:'VERIFIED_DELEGATED_MAPPING',
  memberIdsConfirmed:true,proofRef:'tests/ss008-synthetic-mapping',proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST',reporterUserIds:['member-a','member-b']};
const oauthOptions={enabled:true,publicOrigin:origin,corpId:config.corpId,agentId:config.agentId,resolveCode:async code=>({userid:code==='a'?'open-a':'open-b'})};
async function mapping(){return createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'synthetic',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:'member-a',open_userid:'open-a'},{userid:'member-b',open_userid:'open-b'}]}))});}
function browser(server,initialCookie=''){
  const cookies=new Map(initialCookie?[[initialCookie.name,initialCookie.value]]:[]);
  return {cookies,async request(path,{method='GET',body,headers={}}={}){
    const result=await new Promise((resolve,reject)=>{
      const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{host:'127.0.0.1',cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...headers}},res=>{
        const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
      });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
    });
    for(const c of result.headers['set-cookie']??[]){const [k,v]=c.split(';')[0].split('=');cookies.set(k,v);}
    return {...result,json:()=>JSON.parse(result.text)};
  }};
}
async function login(client,code='a'){
  const begin=await client.request('/wecom/yixiaoxiu/login');assert.equal(begin.status,302);
  const state=new URL(begin.headers.location).searchParams.get('state');
  assert.equal((await client.request('/wecom/yixiaoxiu/callback?state='+state+'&code='+code)).status,303);
}
const input=description=>({schema_version:1,client_command_id:randomUUID(),description,location:{text:null,unknown:true},service_code:null,impact_scope:'SINGLE_WORKSTATION',reported_department_text:null,extension:null});
const post=(body,csrf)=>({method:'POST',body,headers:{origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':body.client_command_id,
  ...((body.expected_version??body.expected_row_version)!==undefined?{'if-match':'"'+(body.expected_version??body.expected_row_version)+'"'}:{})}});
async function eventually(run){for(let i=0;i<100;i++){const value=await run();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('SS008_WAIT_FAILED');}

test('SS-008 FULL readiness requires both Web migrations only when the extension is mounted', {timeout:180000},async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  assert.ok(databaseUrl,'isolated PostgreSQL configuration required');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname));
  await withP2016IsolatedDatabase({databaseUrl,purpose:'ss008ready',run:async({pool,databaseUrl:isolated})=>{
    await migrateCurrentBaseline({databaseUrl:isolated});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'ss008-ready-admin',displayName:'Synthetic readiness',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const identityMapping=await mapping();
    const create=yxxSelfService=>createYxxProfile({profile:'FULL_SERVICE_LOOP',pool,publicOrigin:origin,
      reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:config,identityMapping,reporterHmacSecret:secret,
      principalId:principal.id,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true},
      wecomWebOAuth:oauthOptions,yxxSelfService});
    let runtime=create(null);
    try{
      await runtime.start();
      const legacy=await browser(runtime.server).request('/health/ready');assert.equal(legacy.status,200,legacy.text);
      await runtime.stop();runtime=create({featureFlags:flags});await runtime.start();
      const missing=await browser(runtime.server).request('/health/ready');assert.equal(missing.status,503,missing.text);
      assert.equal(missing.json().base_service_ready,false);assert.equal(missing.json().checks.yxx_self_service_schema,false);
      await runtime.stop();
      await migrateCurrentBaselineWithYxx({databaseUrl:isolated});
      runtime=create({featureFlags:flags});await runtime.start();
      const client=browser(runtime.server);
      const ready=await client.request('/health/ready');assert.equal(ready.status,200,ready.text);
      assert.equal(ready.json().checks.yxx_self_service_schema,true);
      for(const id of ['033_yxx_self_service_intake','034_yxx_self_service_direct_chat_check']){
        await pool.query('UPDATE platform.schema_migration SET migration_id=$2 WHERE migration_id=$1',[id,id+'_ss008_missing']);
        try{
          const response=await client.request('/health/ready');assert.equal(response.status,503,response.text);
          assert.equal(response.json().base_service_ready,false);assert.equal(response.json().checks.yxx_self_service_schema,false);
        }finally{await pool.query('UPDATE platform.schema_migration SET migration_id=$1 WHERE migration_id=$2',[id,id+'_ss008_missing']);}
        assert.equal((await client.request('/health/ready')).status,200);
      }
    }finally{await runtime.stop();}
  }});
  await assertNoP2016Residual({databaseUrl});
});

test('SS-008 FULL profile uses its paired custom catalog and leaves text intake available without a pair', {timeout:180000},async()=>{
  await withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'fullcatalog',run:async({pool,databaseUrl:isolated})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl:isolated});
    const raw=structuredClone(loadServiceCatalog().raw);raw.catalog_version='CUSTOM-FULL-V1';
    const selected=raw.domains.flatMap(domain=>domain.services).find(service=>service.service_code==='CLINICAL.OUTPATIENT_WORKSTATION');
    selected.name_zh='定制门诊工作站';
    const catalog=createServiceCatalog(raw),engine=createRuleEngine({catalog});
    const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'ss008-catalog-admin',displayName:'Synthetic Catalog',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
    const base={pool,publicOrigin:origin,reporterMemberEntry:config,identityMapping:await mapping(),reporterHmacSecret:secret,
      profile:'FULL_SERVICE_LOOP',reporterPolicy:'MEMBER_REQUIRED',principalId:principal.id,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true},wecomWebOAuth:oauthOptions,
      yxxSelfService:{featureFlags:flags},ruleEngine:engine};
    const opaque={evaluate:engine.evaluate};
    for(const scenario of [
      {ruleEngine:engine,serviceCatalog:catalog,available:true},
      {ruleEngine:engine,available:true},
      {ruleEngine:opaque,serviceCatalog:catalog,available:true},
      {ruleEngine:opaque,available:false},
      {ruleEngine:engine,serviceCatalog:loadServiceCatalog(),available:false},
    ]){
      const runtime=createYxxProfile({...base,...scenario});
      try{
        await runtime.start();const member=browser(runtime.server);await login(member);
        const response=await member.request('/api/yixiaoxiu/service-catalog');
        if(scenario.available){
          assert.equal(response.status,200);assert.equal(response.json().catalog_version,'CUSTOM-FULL-V1');
          assert.equal(response.json().services.find(service=>service.service_code==='CLINICAL.OUTPATIENT_WORKSTATION').name_zh,'定制门诊工作站');
        }else{
          assert.equal(response.status,503);
          const bootstrap=(await member.request('/api/yixiaoxiu/bootstrap')).json();
          assert.equal((await member.request('/api/yixiaoxiu/requests',post(input('无目录仍可文字报修'),bootstrap.csrf_token))).status,202);
        }
      }finally{await runtime.stop();}
    }
  }});
  await assertNoP2016Residual({databaseUrl:process.env.PILOT_DATABASE_URL});
});

test('SS-008 actual profiles: delegated Web HTTP -> original Review and Ticket workbench -> member; write shutdown retains reads', {timeout:180000},async()=>{
  const databaseUrl=process.env.PILOT_DATABASE_URL;
  assert.ok(databaseUrl,'isolated PostgreSQL configuration required');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(databaseUrl).hostname));
  await withP2016IsolatedDatabase({databaseUrl,purpose:'g2ss008',run:async({pool,databaseUrl:isolated})=>{
    await migrateCurrentBaselineWithYxx({databaseUrl:isolated});
    const identityMapping=await mapping();
    const options={pool,publicOrigin:origin,reporterMemberEntry:config,identityMapping,reporterHmacSecret:secret};
    const self=createYxxProfile({...options,profile:'MEMBER_SELF_SERVICE',oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:flags,pollMilliseconds:100}});
    let full,read;
    try{
      await self.start();const a=browser(self.server),b=browser(self.server);await login(a);await login(b,'b');
      assert.equal((await a.request('/wecom/yixiaoxiu/')).status,200);
      const bootstrap=(await a.request('/api/yixiaoxiu/bootstrap')).json();
      const catalogResponse=await a.request('/api/yixiaoxiu/service-catalog');
      assert.equal(catalogResponse.status,200);
      assert.ok(catalogResponse.json().services.some(service=>service.service_code==='CLINICAL.OUTPATIENT_WORKSTATION'&&service.name_zh==='门诊医生工作站'));
      assert.equal(JSON.stringify(catalogResponse.json()).includes('default_owner_team'),false);
      const body=input('急诊患者等着做检查，但检查申请完全提交不了');
      const accepted=await a.request('/api/yixiaoxiu/requests',post(body,bootstrap.csrf_token));assert.equal(accepted.status,202,accepted.text);
      const ref=accepted.json().receipt.request_ref;
      assert.equal((await a.request('/api/yixiaoxiu/requests',post(body,bootstrap.csrf_token))).status,200);
      const review=await eventually(async()=> (await pool.query(`SELECT r.id::text,r.row_version::text FROM intake.manual_review_item r JOIN intake.web_request_binding b ON b.intake_id=r.service_intake_id WHERE b.request_ref=$1`,[ref])).rows[0]);
      assert.equal((await b.request('/api/yixiaoxiu/requests/'+ref)).status,404);
      assert.equal((await a.request('/api/tickets')).status,404);
      const principal=await createPilotAccessService({pool}).upsertPrincipal({wecomUserId:'ss008-admin',displayName:'Synthetic SS008',roles:['ADMIN'],resolverTeamIds:['PILOT_IT']});
      full=createYxxProfile({...options,profile:'FULL_SERVICE_LOOP',reporterPolicy:'MEMBER_REQUIRED',principalId:principal.id??principal.principal_id,
        flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true},wecomWebOAuth:oauthOptions,yxxSelfService:{featureFlags:flags}});
      const started=await full.start();assert.equal(full.selfService.pump,null);assert.equal(full.orchestrationWorker,null);
      const staff=browser(full.server,started.cookie),member=browser(full.server);await login(member);
      assert.equal((await member.request('/api/tickets')).status,401);
      const staffBootstrap=await staff.request('/api/lifecycle/bootstrap');assert.equal(staffBootstrap.status,200,staffBootstrap.text);
      const csrf=staffBootstrap.json().csrf_token;
      const reviewDetail=await staff.request('/api/manual-reviews/'+review.id);assert.equal(reviewDetail.status,200,reviewDetail.text);
      assert.equal(reviewDetail.json().web_report.source_kind,'WEB_REQUEST');
      const resolution={client_command_id:randomUUID(),expected_row_version:review.row_version,resolution_code:'CONFIRM_TICKET_ELIGIBLE',resolution_reason_code:'SYNTHETIC_REVIEW'};
      const resolved=await staff.request('/api/manual-reviews/'+review.id+'/resolve',post(resolution,csrf));assert.equal(resolved.status,200,resolved.text);
      const ticket=(await pool.query(`SELECT i.pilot_ticket_id::text AS id FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE b.request_ref=$1`,[ref])).rows[0];assert.ok(ticket.id);
      for(const action of ['queue','accept','start','resolve','confirm']){
        const detail=await staff.request('/api/tickets/'+ticket.id);assert.equal(detail.status,200,detail.text);
        if(action==='queue'&&detail.json().status==='QUEUED')continue;
        const command={client_command_id:randomUUID(),expected_version:detail.json().version,reason_code:'SS008_'+action.toUpperCase()};
        const result=await staff.request('/api/tickets/'+ticket.id+'/'+action,post(command,csrf));assert.equal(result.status,200,result.text);
      }
      const detail=(await a.request('/api/yixiaoxiu/requests/'+ref)).json();assert.equal(detail.ticket.status,'CLOSED');
      assert.equal((await member.request('/api/yixiaoxiu/requests/'+ref)).json().ticket.status,'CLOSED');
      assert.equal((await staff.request('/api/tickets/'+ticket.id+'/responsibility')).json().conversations.length,0);
      const access=createPilotAccessService({pool});
      const handler=await access.upsertPrincipal({wecomUserId:'ss008-handler',displayName:'Synthetic Handler',roles:['HANDLER'],resolverTeamIds:['PILOT_IT']});
      const auth=createPilotWorkbenchAuthorizationAdapter({pool});
      const scope=await auth.resolveRealtimeAuthorization({principal_id:handler.id,roles:['HANDLER'],team_ids:['PILOT_IT'],is_active:true},{limit:256});
      assert.ok(scope.allowed_system_ticket_ids.includes(ticket.id));assert.equal(scope.allow_system_events,false);
      const replay=await listAuthorizedRealtimeEvents({pool,authorization:scope,afterEventId:'0',limit:100});
      assert.ok(replay.events.length>0);assert.ok(replay.events.every(e=>e.aggregate_type==='TICKET'&&e.aggregate_id===ticket.id));
      const unauthorized=await listAuthorizedRealtimeEvents({pool,authorization:{allowed_system_ticket_ids:[randomUUID()]},afterEventId:'0'});
      assert.equal(unauthorized.events.length,0);
      // FULL HTTP only accepts. The existing Worker explicitly owns processing.
      const boot=(await member.request('/api/yixiaoxiu/bootstrap')).json();const next=input('谢谢');
      const nextRef=(await member.request('/api/yixiaoxiu/requests',post(next,boot.csrf_token))).json().receipt.request_ref;
      await self.stop();
      const fixture=configurationFixture();
      fixture.manifest.scope.database_identity_hash=g2DatabaseIdentity(isolated).fingerprint;
      fixture.manifest.scope.reporter_access_policy='MEMBER_REQUIRED';fixture.manifest.scope.member_entry_config_sha256=yxxIdentityConfigHash(config);
      fixture.manifest.candidate_fingerprint=g2CandidateInventory().fingerprint;
      const flagEnv=Object.fromEntries(Object.entries(flags).map(([key,value])=>[key,String(value)]));
      assert.deepEqual(yxxSelfServiceRoleEnvironment('APP',flagEnv),yxxSelfServiceRoleEnvironment('WORKER',flagEnv));
      assert.deepEqual(yxxSelfServiceRoleEnvironment('GATEWAY',flagEnv),{});
      const worker=fork('scripts/p2-g2-process-role.mjs',['--role=worker'],{windowsHide:true,execArgv:['--expose-gc'],
        env:{...minimalG2Environment(),...fixture.env,PILOT_DATABASE_URL:isolated,P2_G2_MANIFEST:JSON.stringify(fixture.manifest),P2_G1_SENDER_ENABLED:'false',...yxxSelfServiceRoleEnvironment('WORKER',flagEnv)},stdio:['ignore','ignore','ignore','ipc']});
      const messages=[];worker.on('message',value=>messages.push(value));
      try{
        const ready=await eventually(()=>messages.find(m=>m.type==='role-ready'));assert.equal(ready.pool_max,2);
        assert.equal(full.selfService.pump,null);
        await eventually(async()=> (await member.request('/api/yixiaoxiu/requests/'+nextRef)).json().display_status==='NOT_SERVICE');
        assert.equal(messages.some(m=>m.type==='provider-send-request'),false);
      }finally{
        if(worker.connected)worker.send({type:'stop'});
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{worker.kill();reject(Error('SS008_WORKER_STOP_TIMEOUT'));},10000);worker.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('SS008_WORKER_EXIT_FAILED'));});});
      }
      assert.equal((await member.request('/api/yixiaoxiu/requests/'+nextRef)).json().display_status,'NOT_SERVICE');
      for(const table of ['communication.message','communication.outbox','communication.delivery','pilot_ticket.reporter_access_grant','channel.message_inbox','conversation.session'])assert.equal((await pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n,0,table);
      await full.stop();
      read=createYxxProfile({...options,profile:'MEMBER_SELF_SERVICE',oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:{...flags,YIXIAOXIU_SELF_SERVICE_ENABLED:false}}});
      await read.start();const reader=browser(read.server);await login(reader);
      const readonly=(await reader.request('/api/yixiaoxiu/bootstrap')).json();assert.equal(readonly.read_only,true);
      for(const path of ['/api/yixiaoxiu/my-reports','/api/yixiaoxiu/requests/'+ref,'/api/yixiaoxiu/requests/'+ref+'/timeline','/api/yixiaoxiu/commands/'+body.client_command_id])assert.equal((await reader.request(path)).status,200,path);
      assert.equal((await reader.request('/api/yixiaoxiu/requests',post(input('关闭后拒绝'),readonly.csrf_token))).status,403);
    }finally{await read?.stop();await full?.stop();await self.stop();}
  }});
  await assertNoP2016Residual({databaseUrl});
});

test('SS-008 OAUTH_ONLY never touches a supplied DB; READONLY rejects Web writes with erroneous flags',async()=>{
  let touches=0;
  const pool={connect(){touches++;throw Error('unexpected DB');},query(){touches++;throw Error('unexpected DB');}};
  for(const profile of ['OAUTH_ONLY','MEMBER_TICKET_READONLY']){
    const runtime=createYxxProfile({profile,pool,publicOrigin:origin,oauth:createWeComWebOAuth(oauthOptions),
      reporterMemberEntry:config,identityMapping:await mapping(),reporterHmacSecret:secret,yxxSelfService:{featureFlags:flags}});
    try{
      await runtime.start();const client=browser(runtime.server);await login(client);
      assert.equal((await client.request('/api/yixiaoxiu/requests',post(input('禁止写入'),'synthetic'))).status,403);
      assert.equal(touches,0);
    }finally{await runtime.stop();}
  }
});

test('SS-008 delegated proof and realtime ticket scope remain closed and bounded',async()=>{
  assert.throws(()=>createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:{connect(){},query(){}},publicOrigin:origin,
    oauth:createWeComWebOAuth(oauthOptions),reporterMemberEntry:config,reporterHmacSecret:secret}),{code:'YXX_ENTRY_IDENTITY_NAMESPACE_UNVERIFIED'});
  assert.throws(()=>normalizeRealtimeAuthorization({allowed_system_ticket_ids:Array.from({length:257},()=>randomUUID())}));
  let getter=0;assert.throws(()=>normalizeRealtimeAuthorization({get allowed_system_ticket_ids(){getter++;return [];}}));assert.equal(getter,0);
});

test('SS-008 four actual sources coexist on 033/034 with independent lineage and Web APP_ONLY', {timeout:180000},async()=>{
  await withG2Runtime(async f=>{
    await f.inbound('处方提交不了');await f.pump();
    await f.inbound('@故障助手',{reporter:f.reporters[1]});await f.pump();
    await f.inbound('打印机卡纸了',{chatType:'single',reporter:f.reporters[1]});await f.pump();
    await f.inbound('处方提交不了',{chatType:'single',reporter:f.reporters[2]});await f.pump();
    assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n,3);
    const before=(await f.pool.query('SELECT count(*)::int AS n FROM communication.delivery')).rows[0].n;
    const scoped={...config,botId:f.botId,reporterUserIds:f.reporters.slice(0,2)};
    const identityMapping=await createYxxDelegatedIdentityMapping({config:scoped,accessTokenProvider:async()=> 'synthetic',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:scoped.reporterUserIds.map((id,i)=>({userid:id,open_userid:i?'open-b':'open-a'}))}))});
    const self=createYxxProfile({pool:f.pool,publicOrigin:origin,profile:'MEMBER_SELF_SERVICE',reporterMemberEntry:scoped,identityMapping,
      reporterHmacSecret:secret,oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags:flags,pollMilliseconds:100}});
    try{
      await self.start();const member=browser(self.server);await login(member);
      const csrf=(await member.request('/api/yixiaoxiu/bootstrap')).json().csrf_token;
      const accepted=await member.request('/api/yixiaoxiu/requests',post(input('处方提交不了'),csrf));assert.equal(accepted.status,202,accepted.text);
      const ref=accepted.json().receipt.request_ref;
      await eventually(async()=> (await member.request('/api/yixiaoxiu/requests/'+ref)).json().ticket);
      const supplement={schema_version:1,client_command_id:randomUUID(),expected_input_revision:'1',text:'SS008网页追加说明'};
      const supplemented=await member.request('/api/yixiaoxiu/requests/'+ref+'/supplements',post(supplement,csrf));assert.equal(supplemented.status,202,supplemented.text);
      await eventually(async()=> (await member.request('/api/yixiaoxiu/requests/'+ref)).json().processed_revision==='2');
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM pilot_ticket.ticket')).rows[0].n,4);
      assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM communication.delivery')).rows[0].n,before);
      const sources=(await f.pool.query('SELECT DISTINCT entry_mode FROM intake.contact_journey ORDER BY entry_mode')).rows.map(r=>r.entry_mode);
      assert.deepEqual(sources,['APP_WEB_SELF_SERVICE','DIRECT_ORGANIC','GROUP_MENTION_INLINE','GROUP_MENTION_TO_DIRECT_GUIDED']);
      const lineage=(await f.pool.query(`SELECT i.source_provider,i.source_bot_id,i.primary_message_id,l.leg_type,l.conversation_session_id
        FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id JOIN intake.channel_leg l ON l.source_intake_id=i.id WHERE b.request_ref=$1`,[ref])).rows;
      assert.equal(lineage.length,1);assert.deepEqual(lineage[0],{source_provider:'YIXIAOXIU_WEB',source_bot_id:null,primary_message_id:null,leg_type:'WEB_FORM',conversation_session_id:null});
      const items=(await member.request('/api/yixiaoxiu/my-reports')).json().items;
      assert.equal(items.filter(x=>x.kind==='WEB_REQUEST').length,1);assert.equal(items.filter(x=>x.kind==='BOT_TICKET').length,1);
      const webTicket=(await f.pool.query(`SELECT i.pilot_ticket_id::text AS id FROM intake.service_intake i JOIN intake.web_request_binding b ON b.intake_id=i.id WHERE b.request_ref=$1`,[ref])).rows[0].id;
      const staffBrowser=await launchSystemBrowser({url:f.origin+'/workbench/lifecycle#queue=queued&selected='+webTicket,width:1440,height:900,cookies:[f.runtime.authenticate.browserCookie()]});
      try{
        await staffBrowser.waitFor("document.querySelector('#lc-detail').textContent.includes('网页报修')");
        assert.ok(await staffBrowser.evaluate("document.querySelector('#lc-detail').textContent.includes('处方提交不了')"));
        assert.ok(await staffBrowser.evaluate("document.querySelector('#lc-detail').textContent.includes('SS008网页追加说明')"));
        assert.ok(await staffBrowser.evaluate("document.querySelector('#lc-detail').textContent.includes('聊天与人工回复不可用')"));
        assert.equal(await staffBrowser.evaluate("[...document.querySelectorAll('#lc-detail button')].some(b=>b.textContent==='进入会话与人工回复')"),false);
      }finally{await staffBrowser.close();}
      assert.equal(f.providerCalls.length,0);
    }finally{await self.stop();}
  },{webSchema:true});
});
