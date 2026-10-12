import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {withP2016IsolatedDatabase,applyThrough030} from './p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {migrateP2016} from '../../scripts/p2-016-migrate.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {appendTicketEvent} from '../../src/p1-006-ticket-state-actions.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {createRuleFirstOrchestrator} from '../../src/p2-015-rule-first-orchestrator.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort} from '../../src/p2-015-safe-action-executor.mjs';
import {createManualReviewStore} from '../../src/p2-015-manual-review.mjs';
import {createDecisionStore} from '../../src/p2-015-decision-store.mjs';
import {migrateWorkbenchSourceGroups} from '../../scripts/workbench-source-groups-migrate.mjs';
import {migrateP2012} from '../../scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../../scripts/yxx-self-service-migrate.mjs';
import {createYxxSelfServiceStore} from '../../src/yxx-self-service-store.mjs';
import {migrateTicketSelfHandling} from '../../scripts/ticket-self-handling-migrate.mjs';
import {migrateWorkbenchManualReports} from '../../scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchVerifiedManualReports} from '../../scripts/workbench-verified-manual-reports-migrate.mjs';
import {createServiceIntakeDecisionPort} from '../../src/p2-015-service-intake-decision-port.mjs';
import {migrateWorkbenchAuth} from '../../scripts/p2-016-workbench-auth-migrate.mjs';
import {createWeComWorkbenchAuthentication} from '../../src/p2-016-workbench-wecom-auth.mjs';
import {createYxxBrowserFixture} from './p2-g2-yixiaoxiu-browser.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
// Fresh synthetic scenarios match the prototype's visual content. Never part of a production bundle.
const scenarios=[
 ['门诊二楼打印机无法打印处方','门诊二楼 · 203 诊室','QUEUED'],
 ['护士站登录护理系统提示连接超时','住院部 · 六楼护士站','NEW'],
 ['自助机读卡失败，患者无法签到','门诊大厅 · 03 号自助机','REOPENED'],
 ['检验报告查询页面显示空白','检验科 · 报告窗口','ACCEPTED'],
 ['手术排班屏幕无法同步最新安排','手术室 · 示教区','NEW'],
 ['住院部西区无线网络频繁断开','住院部 · 西区五楼','IN_PROGRESS'],
 ['PACS 调阅影像时加载缓慢','影像科 · 阅片室','WAITING_VENDOR'],
 ['收费窗口票据打印位置偏移','门诊一楼 · 收费 02 窗口','WAITING_REQUESTER'],
 ['心电图工作站无法上传检查结果','医技楼 · 心电图室','IN_PROGRESS'],
 ['门诊诊室键盘更换','门诊三楼 · 301 诊室','CLOSED'],
 ['病区移动查房车无法充电','住院部 · 七楼','CLOSED'],
 ['恢复药房标签打印服务','药房 · 配药区','CLOSED'],
 ['影像诊断室显示器亮度异常','影像科 · 诊断室','RESOLVED'],
];
const eventTypes={NEW:'ticket.created',QUEUED:'ticket.queued',REOPENED:'ticket.reopened',ACCEPTED:'ticket.accepted',IN_PROGRESS:'ticket.started',WAITING_VENDOR:'ticket.waiting_vendor',WAITING_REQUESTER:'ticket.waiting_requester',CLOSED:'ticket.closed',RESOLVED:'ticket.resolved'};
async function unusedPort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function settleManualFixtureProjection(runtime){
  const result=await runtime.coordinator.runOnce();
  const channel=result.streams.find(stream=>stream.source_stream==='CHANNEL_MESSAGE_INBOX');
  assert.ok(channel);assert.equal(channel.failures.length,0);
  assert.equal((await runtime.coordinator.backlog()).channel_messages,0);
  console.log('WBINT_T17_FIXTURE_BASELINE '+JSON.stringify({source_stream:channel.source_stream,scanned:channel.scanned,inserted:channel.inserted,replayed:channel.replayed,channel_failures:channel.failures.length,other_stream_failures:result.failures-channel.failures.length}));
}
// Actual Web source through the existing Store Port: there is no Bot inbox/thread to project into a Session.
export async function seedWeb01NoConversationIntake({pool,text,location='合成位置'}){
  const scope={scopeHash:createHash('sha256').update('web01-only-'+randomUUID()).digest('hex'),sourceCorpScope:'web01-synthetic-corp',sourceAppScope:'web01-synthetic-app',proofRef:'web01-synthetic-proof'};
  const {receipt}=await createYxxSelfServiceStore({pool}).accept({scope,input:{schema_version:1,client_command_id:randomUUID(),description:text,location:{text:location,unknown:false},service_code:null,impact_scope:'SELF',reported_department_text:null,extension:null}});
  const row=(await pool.query('SELECT i.id::text,i.retention_until FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.request_ref=$1',[receipt.request_ref])).rows[0];
  return {intakeId:row.id,receivedAt:receipt.accepted_at,retentionUntil:row.retention_until,requestRef:receipt.request_ref};
}
export async function withWeb01Fixture(run,{workbenchRealtimeEnabled=false,workbenchManualReportsEnabled=false,workbenchReporterCandidatesEnabled=false,manualReporterDirectory=/** @type {import('../../contracts/workbench_reporter_candidates_contracts.js').ManualReporterDirectoryOptions | null} */(null),manualProjection=false,chronologicalTicketEvents=false,ticketTakeoverEnabled=false,ticketAssignmentEnabled=false,ticketConversationSelfHandlingEnabled=false,workbenchManualReviewEnabled=false,malformedReviewSuccess=false,malformedReviewDenial=false,installTicketSelfHandlingSchema=true,ticketSelfHandlingWebSource=true,ticketSelfHandlingEnabled=false,dropSelfHandlingResponses=false,malformedSelfHandlingSuccess=false,malformedSelfHandlingDenial=false,sourceGroupDirectoryEnabled=false,workbenchInternalNotesEnabled=false,workbenchDraftRecoveryEnabled=false,realWorkbenchAuthentication=false,dropInternalNoteResponses=false,malformedInternalNoteSuccess=false,malformedInternalNoteDenial=false}={}){
  assert.ok(!manualProjection||!realWorkbenchAuthentication,'manual projection uses only the synthetic API fixture');
  return withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'web01',run:async context=>{
    const {pool,databaseUrl}=context;await applyThrough030(context);await migrateP2016({databaseUrl});
    if(ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketTakeoverEnabled){await migrateP2012({databaseUrl});await migrateYxxSelfService({databaseUrl});if(installTicketSelfHandlingSchema)await migrateTicketSelfHandling({databaseUrl,mode:'apply'});}
    if(workbenchManualReportsEnabled){await migrateP2012({databaseUrl});await migrateYxxSelfService({databaseUrl});await migrateWorkbenchManualReports({databaseUrl,mode:'apply'});}
    if(workbenchManualReportsEnabled&&workbenchReporterCandidatesEnabled)await migrateWorkbenchVerifiedManualReports({databaseUrl,mode:'apply'});
    if(sourceGroupDirectoryEnabled)await migrateWorkbenchSourceGroups({databaseUrl,mode:'apply'});
    const access=createPilotAccessService({pool});
    const principals=[];for(const [index,name] of ['林舟','陈悦','周宁','沈然'].entries())principals.push(await access.upsertPrincipal({wecomUserId:'web01-synthetic-'+index,displayName:name,roles:index?['HANDLER']:['ADMIN'],resolverTeamIds:['PILOT_IT']}));
    const outsider=await access.upsertPrincipal({wecomUserId:'web01-synthetic-outsider',displayName:'未授权对象测试',roles:['HANDLER'],resolverTeamIds:[]});
    const core=createPilotTicketCore({pool}),tickets=[];
    for(const [index,[title,location,status]] of scenarios.entries()){
      const text=title+'。全新合成开发材料，请协助排查。';
      const intake=(ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketTakeoverEnabled)&&ticketSelfHandlingWebSource?await seedWeb01NoConversationIntake({pool,text,location}):await seedPersistedIntake({pool,text,requestType:'INCIDENT',status:'RECEIVED'});
      let ticket=(await core.createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'web01-synthetic'})).ticket;
      const row=(await pool.query(`UPDATE pilot_ticket.ticket SET title=$2,status=$3,reported_location_text=$4,version=2,
        assignee_id=$5::uuid,created_at=platform.local_now()-interval '30 days',updated_at=platform.local_now()-($6::text||' minutes')::interval
        WHERE id=$1::uuid RETURNING *`,[ticket.id,title,status,location,['NEW','QUEUED'].includes(status)?null:principals[index%4].id,index])).rows[0];
      ticket={...ticket,...row};
      const event=await appendTicketEvent({transaction:pool,ticket,eventType:eventTypes[status],actor:{type:'PILOT_USER',id:principals[index%4].id},oldStatus:'NEW',internalNote:'仅供内部的合成处理记录',externalNote:status==='CLOSED'?'本次处置已完成。':null,traceId:'web01-synthetic'});
      if(!chronologicalTicketEvents)await pool.query(`UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now()-($2::text||' hours')::interval WHERE event_id=$1::uuid`,[event.event_id,status==='RESOLVED'?240:index>=9?(index-9)*4:0]);
      tickets.push({ticket,intake,event});
    }
    const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'web01-only-synthetic-identity-key',decisionStore:createDecisionStore(),
      safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:core}),manualReviewStore:createManualReviewStore(),decisionStore:createDecisionStore()}),
      ruleEngine:{catalog_version:'WEB01_FIXTURE',rule_set_version:'WEB01_FIXTURE',evaluate(){throw new Error('fixture creates persisted pending review');}}});
    const standalone=await seedPersistedIntake({pool,text:'尚待判断的合成材料，请协助确认。'});
    const processReviewIntake=intakeId=>orchestrator.processPersistedIntake({service_intake_id:intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
    for(const intakeId of [standalone.intakeId,...((ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketTakeoverEnabled)&&ticketSelfHandlingWebSource?[]:[tickets[0].intake.intakeId])])await orchestrator.processPersistedIntake({service_intake_id:intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
    // Explicit real relation: the pending review and Ticket are the same intake, not two cards.
    await pool.query(`UPDATE intake.manual_review_item SET linked_ticket_id=$2::uuid WHERE service_intake_id=$1::uuid`,[tickets[0].intake.intakeId,tickets[0].ticket.id]);
    await pool.query(`UPDATE intake.contact_journey SET linked_ticket_id=$2::uuid WHERE origin_intake_id=$1::uuid`,[tickets[0].intake.intakeId,tickets[0].ticket.id]);
    const waiting=await seedPersistedIntake({pool,text:'位置尚不清楚，等待补充的全新合成报修。',status:'WAITING_DESCRIPTION'});
    await pool.query("UPDATE intake.service_intake SET intake_no=regexp_replace(intake_no,'^INT-[0-9]{8}','INT-'||to_char(platform.local_now(),'YYYYMMDD'))");
    if(realWorkbenchAuthentication){
      await migrateWorkbenchAuth({databaseUrl});let runtime,auth,tls;
      const identityHashKey='web01-test-only-identity-hash-key',corpId='ww-web01-synthetic',agentId='1000001';
      const openId=user=>'open-'+user;
      try{
        tls=await createYxxBrowserFixture({pool,createApp:({origin})=>{
          auth=createWeComWorkbenchAuthentication({pool,publicOrigin:origin,corpId,agentId,identityHashKey,accessTokenProvider:async()=> 'web01-test-only-token',fetchImpl:async(url,init)=>{
            assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.pathname,'/cgi-bin/batch/userid_to_openuserid');assert.equal(init.method,'POST');
            const users=JSON.parse(init.body).userid_list;assert.equal(users.length,5);
            return new Response(JSON.stringify({errcode:0,open_userid_list:users.map(userid=>({userid,open_userid:openId(userid)}))}),{headers:{'content-type':'application/json'}});
          }});
          runtime=createP2016Runtime({pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:0,workbenchAuthentication:auth,externalSendEnabled:false,ticketTakeoverEnabled,ticketAssignmentEnabled,workbenchRealtimeEnabled,workbenchManualReportsEnabled,workbenchReporterCandidatesEnabled,manualReporterDirectory,workbenchManualReviewEnabled,ticketSelfHandlingEnabled,ticketConversationSelfHandlingEnabled,sourceGroupDirectoryEnabled,workbenchInternalNotesEnabled,workbenchDraftRecoveryEnabled});return runtime.server;
        },startApp:async app=>{assert.equal(app,runtime.server);await auth.initialize();const started=await runtime.start();return 'http://127.0.0.1:'+started.address.port;},stopApp:async()=>{await runtime?.stop();}});
        const sessionToken=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url'),issued=Date.now(),expires=issued+8*3600000;
        const hash=value=>createHash('sha256').update(value).digest('hex'),identityHash=createHmac('sha256',identityHashKey).update(JSON.stringify(['workbench-identity-v1',corpId,agentId,openId('web01-synthetic-0')])).digest('hex');
        const sessionId=(await pool.query(`INSERT INTO pilot_ticket.workbench_auth_session(session_token_hash,csrf_token_hash,principal_id,identity_hash,created_at,created_epoch_ms,last_seen_at,last_seen_epoch_ms,expires_epoch_ms,expires_at)
          VALUES($1,$2,$3::uuid,$4,platform.local_from_epoch_ms($5),$5,platform.local_from_epoch_ms($5),$5,$6,platform.local_from_epoch_ms($6)) RETURNING session_id::text`,[hash(sessionToken),hash(csrfToken),principals[0].id,identityHash,issued,expires])).rows[0].session_id;
        const browserCookies=[{name:'__Host-wecom_workbench_session',value:sessionToken,url:tls.origin+'/',path:'/',secure:true,httpOnly:true,sameSite:'Lax'},{name:'__Host-wecom_workbench_csrf',value:csrfToken,url:tls.origin+'/',path:'/',secure:true,httpOnly:false,sameSite:'Lax'}];
        if(workbenchManualReportsEnabled)await settleManualFixtureProjection(runtime);
        return await run({...context,tickets,waiting,principals,outsider,runtime,processReviewIntake,origin:tls.origin,certificateSpki:tls.certificateSpki,browserCookies,cookies:[browserCookies.map(c=>c.name+'='+c.value).join('; ')],sessionId,backendOrigin:'http://127.0.0.1:'+runtime.server.address().port});
      }finally{await closeBrowserTestResources([async()=>{await tls?.close();if(tls)assert.deepEqual(tls.ownedResourceState(),{listeners:0,sockets:0,tlsDirectories:0});},async()=>{await runtime?.stop();await auth?.close();if(runtime)assert.equal(runtime.server.listening,false);}]);}
    }
    const listenPort=await unusedPort(),origin='http://127.0.0.1:'+listenPort;
    const runtime=createP2016Runtime({pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort,principalIds:[principals[0].id,outsider.id,principals[1].id],externalSendEnabled:false,ticketTakeoverEnabled,ticketAssignmentEnabled,workbenchRealtimeEnabled,workbenchManualReportsEnabled,workbenchReporterCandidatesEnabled,manualReporterDirectory,workbenchManualReviewEnabled,ticketSelfHandlingEnabled,ticketConversationSelfHandlingEnabled,sourceGroupDirectoryEnabled,workbenchInternalNotesEnabled,workbenchDraftRecoveryEnabled});
    try{
    // Manual finite batches own projection in this explicit profile; ordinary UI fixtures still start the scheduled worker.
    if(manualProjection){assert.equal(runtime.orchestrationWorker,null);assert.equal(runtime.incidentExtension,null);}
    const started=manualProjection?{address:await listenConversationWorkbenchServer(runtime.server,{port:listenPort}),cookies:runtime.authenticate.browserCookies?.()}:await runtime.start();
    assert.ok(Array.isArray(started.cookies)&&started.cookies.length===3);const cookies=started.cookies.map(c=>c.name+'='+c.value);
    if(workbenchManualReportsEnabled&&!manualProjection)await settleManualFixtureProjection(runtime);
    // Keep the test-owned fault active until explicit reconciliation: Chromium can transparently repeat a transport request.
    let dropNoteResponses=dropInternalNoteResponses;
    let malformedNoteSuccess=malformedInternalNoteSuccess;
    const restoreInternalNoteResponses=()=>{dropNoteResponses=false;malformedNoteSuccess=false;};
    if(dropInternalNoteResponses||malformedInternalNoteSuccess)runtime.server.on('request',(request,response)=>{
      if(!request.url?.endsWith('/internal-notes'))return;
      const end=response.end.bind(response);
      response.end=(...args)=>{if(response.statusCode===200&&dropNoteResponses){request.socket.destroy();return response;}if(response.statusCode===200&&malformedNoteSuccess)return end('{"ok":true}');return end(...args);};
    });
    if(malformedInternalNoteDenial)runtime.server.on('request',(request,response)=>{
      if(!request.url?.endsWith('/internal-notes'))return;
      const end=response.end.bind(response);
      response.end=(...args)=>[401,403,404].includes(response.statusCode)?end('{'):end(...args);
    });
    let dropHandlingResponses=dropSelfHandlingResponses,malformedHandlingSuccess=malformedSelfHandlingSuccess;
    const restoreSelfHandlingResponses=()=>{dropHandlingResponses=false;malformedHandlingSuccess=false;};
    if(dropSelfHandlingResponses||malformedSelfHandlingSuccess||malformedSelfHandlingDenial)runtime.server.on('request',(request,response)=>{
      if(!/\/(take-and-start|accept-for-later)$/u.test(request.url??''))return;
      const end=response.end.bind(response);
      response.end=(...args)=>{if(response.statusCode===200&&dropHandlingResponses){request.socket.destroy();return response;}if(response.statusCode===200&&malformedHandlingSuccess)return end('{"ok":true}');if([401,403,404].includes(response.statusCode)&&malformedSelfHandlingDenial)return end('{');return end(...args);};
    });
    let malformedReviewResponse=malformedReviewSuccess;
    const restoreReviewResponses=()=>{malformedReviewResponse=false;};
    if(malformedReviewSuccess||malformedReviewDenial)runtime.server.on('request',(request,response)=>{
      if(!/^\/api\/manual-reviews\/[0-9a-f-]{36}(?:\/resolve)?$/iu.test(request.url??''))return;
      const end=response.end.bind(response);
      response.end=(...args)=>response.statusCode===200&&malformedReviewResponse&&request.url?.endsWith('/resolve')?end('{"ok":true}'):
        malformedReviewDenial&&[401,403,404].includes(response.statusCode)?end('{'):end(...args);
    });
    return await run({...context,tickets,waiting,principals,outsider,runtime,processReviewIntake,origin,cookies,browserCookies:started.cookies,restoreInternalNoteResponses,restoreSelfHandlingResponses,restoreReviewResponses});}
    finally{await runtime.stop();if(runtime.server.listening)throw new Error('WEB01_SERVER_NOT_CLOSED');if(manualProjection){
      const connections=await new Promise((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),metrics=await runtime.observability.metrics();
      assert.equal(connections,0);assert.equal(metrics.sse_clients,0);
      console.log('WEB01_MANUAL_PROJECTION_CLEANUP '+JSON.stringify({http_listening:runtime.server.listening,http_connections:connections,sse_clients:metrics.sse_clients}));
    }}
  }});
}
