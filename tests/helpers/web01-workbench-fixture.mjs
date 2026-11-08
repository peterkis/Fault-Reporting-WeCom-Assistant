import {migrateWorkbenchFollow} from '../../app/server/scripts/workbench-follow-migrate.mjs';
import {migrateWorkbenchPersonalRead} from '../../app/server/scripts/workbench-personal-read-migrate.mjs';
import {migrateServiceClosure} from '../../app/server/scripts/service-closure-migrate.mjs';
import {insertClosureRecord,normalizeClosureInput,appendIntakeClosureEvent} from '../../app/server/src/service-closure-records.mjs';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {withP2016IsolatedDatabase,applyThrough030} from './p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {migrateP2016} from '../../app/server/scripts/p2-016-migrate.mjs';
import {createPilotAccessService} from '../../app/server/src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../../app/server/src/p1-005-pilot-ticket-core.mjs';
import {appendTicketEvent} from '../../app/server/src/p1-006-ticket-state-actions.mjs';
import {createP2016Runtime} from '../../app/server/src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../app/server/src/p2-006-workbench-http.mjs';
import {createRuleFirstOrchestrator} from '../../app/server/src/p2-015-rule-first-orchestrator.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort} from '../../app/server/src/p2-015-safe-action-executor.mjs';
import {createManualReviewStore} from '../../app/server/src/p2-015-manual-review.mjs';
import {createDecisionStore} from '../../app/server/src/p2-015-decision-store.mjs';
import {migrateWorkbenchSourceGroups} from '../../app/server/scripts/workbench-source-groups-migrate.mjs';
import {migrateP2012} from '../../app/server/scripts/p2-012-migrate.mjs';
import {migrateYxxSelfService} from '../../app/server/scripts/yxx-self-service-migrate.mjs';
import {createYxxSelfServiceStore} from '../../app/server/src/yxx-self-service-store.mjs';
import {migrateTicketSelfHandling} from '../../app/server/scripts/ticket-self-handling-migrate.mjs';
import {migrateWorkbenchManualReports} from '../../app/server/scripts/workbench-manual-reports-migrate.mjs';
import {migrateWorkbenchVerifiedManualReports} from '../../app/server/scripts/workbench-verified-manual-reports-migrate.mjs';
import {createServiceIntakeDecisionPort} from '../../app/server/src/p2-015-service-intake-decision-port.mjs';
import {migrateWorkbenchAuth} from '../../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {createWeComWorkbenchAuthentication} from '../../app/server/src/p2-016-workbench-wecom-auth.mjs';
import {createYxxBrowserFixture} from './p2-g2-yixiaoxiu-browser.mjs';
import {closeBrowserTestResources} from './p2-006-browser-harness.mjs';
// Fresh synthetic scenarios match the prototype's visual content. Never part of a production bundle.
/** R2: opt-in civil timestamps through the fixture's existing synthetic writes. */
export async function seedCard22Board(f){
  for(const {ticket} of f.tickets){
    await f.pool.query("UPDATE pilot_ticket.ticket SET created_at=platform.local_now()-interval '30 minutes' WHERE id=$1::uuid",[ticket.id]);
    await f.pool.query("UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now()-interval '30 minutes' WHERE ticket_id=$1::uuid",[ticket.id]);
  }
  /** @type {[string,number,number,number|null][]} */
  const cases=[['a',0,1560,1560],['b',5,300,300],['c',8,30,30],['d',1,2880,null],['e',9,4320,0]];
  /** @type {Record<string,string>} */
  const ids={};
  for(const [key,index,createdMinutes,stageMinutes] of cases){
    const id=f.tickets[index].ticket.id;ids[key]=id;
    await f.pool.query("UPDATE pilot_ticket.ticket SET title=$2,created_at=platform.local_now()-($3::text||' minutes')::interval WHERE id=$1::uuid",[id,'R2-'+key+' 热度验收（合成）',createdMinutes]);
    if(stageMinutes===null)await f.pool.query('UPDATE pilot_ticket.ticket_event SET old_status=new_status WHERE ticket_id=$1::uuid',[id]);
    else await f.pool.query("UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now()-($2::text||' minutes')::interval WHERE ticket_id=$1::uuid",[id,stageMinutes]);
  }
  return ids;
}
/** Card 27B: closure presentation uses the existing synthetic writes and event helper.
 * @returns {Promise<{manual:string,duplicate:string,unknown:string,historical:string,system:string,today:string,yesterday:string}>}
 */
export async function seedCard27Board(f){
  /** @type {Record<string,string>} */
  const ids={};
  for(const [key,index,status,source,old] of [
    ['manual',0,'CANCELLED','PILOT_USER',false],
    ['duplicate',1,'DUPLICATE_LINKED','SYSTEM',false],
    ['unknown',2,'CANCELLED',null,false],
    ['historical',3,'CANCELLED','PILOT_USER',true],
  ]){
    const original=f.tickets[index],id=original.ticket.id;ids[key]=id;
    const ticket=(await f.pool.query('UPDATE pilot_ticket.ticket SET status=$2,title=$3,version=version+1,updated_at=platform.local_now() WHERE id=$1::uuid RETURNING *',
      [id,status,{manual:'测试误报，人工核对关闭（合成）',duplicate:'打印故障重复报修（合成）',unknown:'其他原因人工关闭（合成）',historical:'昨日人工取消事项（合成）'}[key]])).rows[0];
    {
      const actualSource=source??'PILOT_USER';
      const event=await appendTicketEvent({transaction:f.pool,ticket,eventType:status==='CANCELLED'?'ticket.cancelled':'ticket.duplicate_linked',
        actor:{type:actualSource,id:actualSource==='PILOT_USER'?f.principals[0].id:null},oldStatus:original.ticket.status,
        internalNote:source==='PILOT_USER'?'与报修人核对为测试误报，保留内部关闭说明（合成）':null,externalNote:null,traceId:'card27b-'+key+'-synthetic'});
      await f.pool.query("UPDATE pilot_ticket.ticket_event SET created_at="+(old?"date_trunc('day',platform.local_now())-interval '1 day'+interval '11 hours'":"platform.local_now()")+' WHERE event_id=$1::uuid',[event.event_id]);
      const input=normalizeClosureInput({reason_code:key==='duplicate'?'DUPLICATE':key==='manual'?'FALSE_REPORT_OR_TEST':key==='historical'?'REPORTER_WITHDREW':'OTHER',note:key==='unknown'?'其他关闭原因（合成）':key==='manual'?'与报修人核对为测试误报，保留内部关闭说明（合成）':null});
      const record=await insertClosureRecord({transaction:f.pool,subjectType:'TICKET',subjectId:id,beforeStatus:original.ticket.status,beforeAssignee:original.ticket.assignee_id??null,beforeTeam:original.ticket.resolver_team_id??'PILOT_IT',beforeVersion:original.ticket.version,beforeSnapshot:{},actor:actualSource==='PILOT_USER'?f.principals[0].id:null,source:actualSource==='PILOT_USER'?'MANUAL':'SYSTEM',input,ticketEventId:event.event_id});
      if(old)await f.pool.query("UPDATE pilot_ticket.closure_record SET closed_at=date_trunc('day',platform.local_now())-interval '1 day'+interval '11 hours' WHERE id=$1::uuid",[record.id]);
    }
  }
  for(const original of f.tickets.slice(9,13)){
    await f.pool.query("UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now() WHERE ticket_id=$1::uuid AND event_type IN ('ticket.closed','ticket.resolved')",[original.ticket.id]);
  }
  const ignored=await seedPersistedIntake({pool:f.pool,text:'感谢消息经系统判定不受理（合成）',requestType:'CHATTER',status:'WAITING_DESCRIPTION'});ids.system=ignored.intakeId;
  const ignoredRow=(await f.pool.query("UPDATE intake.service_intake SET status='IGNORED',version=version+1 WHERE id=$1::uuid RETURNING version",[ignored.intakeId])).rows[0];
  const event=await appendIntakeClosureEvent(f.pool,{intakeId:ignored.intakeId,version:ignoredRow.version,type:'intake.closed',oldStatus:'WAITING_DESCRIPTION',newStatus:'IGNORED',actor:null,traceId:'card27c-system-synthetic'});
  await insertClosureRecord({transaction:f.pool,subjectType:'INTAKE',subjectId:ignored.intakeId,beforeStatus:'WAITING_DESCRIPTION',beforeVersion:ignoredRow.version-1,beforeSnapshot:{request_type:'CHATTER',reviews:[],journeys:[]},actor:null,source:'SYSTEM',input:normalizeClosureInput({reason_code:'NOT_IT_SCOPE',secondary_reason_code:'ACKNOWLEDGED'}),intakeEventId:event});
  const dates=(await f.pool.query("SELECT to_char(platform.local_now(),'YYYY-MM-DD') AS today,to_char(platform.local_now()-interval '1 day','YYYY-MM-DD') AS yesterday")).rows[0];
  return {...ids,...dates};
}
/** Card 28 uses the existing isolated SQL/Store writes and fixture response-end seam.
 * Duplicate closure and original reference are persisted through the closure helper.
 */
export async function seedCard28Board(f){
  const closed=await seedCard27Board(f),pending=[],titles=['无线网络频繁掉线，需核对交换机上联与终端接入的完整路径及病区覆盖情况（合成）','护理工作站连接超时（合成）','影像调阅异常（合成）','打印队列等待受理（合成）'];
  const longOwnerName='阿卜杜拉艾合买提（合成）',longOwner=f.tickets[5].ticket.id;
  await f.pool.query('UPDATE pilot_ticket.pilot_principal SET display_name=$2 WHERE id=$1::uuid',[f.principals[2].id,longOwnerName]);
  // Deterministic interleaving: a newer dismissal must follow completed rows in presentation.
  await f.pool.query("UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now()-interval '10 minutes' WHERE ticket_id=$1::uuid AND event_type='ticket.closed'",[f.tickets[9].ticket.id]);
  await f.pool.query("UPDATE pilot_ticket.closure_record SET closed_at=platform.local_now()-interval '5 minutes' WHERE ticket_id=$1::uuid AND restored_at IS NULL",[closed.manual]);

  const core=createPilotTicketCore({pool:f.pool});
  for(const [index,minutes,service] of [[0,360,'NETWORK.ENDPOINT_ACCESS'],[1,90,'CLINICAL.INPATIENT_WORKSTATION'],[2,12,'DIAG.IMAGING_VIEWER'],[3,3,'PRINT.PRINTER_DEVICE']]){
    const intake=await seedWeb01NoConversationIntake({pool:f.pool,text:titles[index],location:'合成位置（合成）',serviceCode:service});
    const created=await core.createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'card28-synthetic'});assert.ok(created.ticket);pending.push(created.ticket.id);
    await f.pool.query("UPDATE pilot_ticket.ticket SET title=$2,created_at=platform.local_now()-($3::text||' minutes')::interval WHERE id=$1::uuid",[created.ticket.id,titles[index],minutes]);
  }
  const completedIntake=await seedPersistedIntake({pool:f.pool,text:'无工单受理事项已完成（合成）',requestType:'CHATTER',status:'COMPLETED'});
  const failedIntake=await seedPersistedIntake({pool:f.pool,text:'受理处理失败待人工核对（合成）',status:'FAILED'});
  for(const [id,status] of [[completedIntake.intakeId,'COMPLETED'],[failedIntake.intakeId,'FAILED']])await f.pool.query("UPDATE intake.service_intake_event SET payload=jsonb_build_object('status',$2::text) WHERE intake_id=$1::uuid AND event_type='intake.received'",[id,status]);
  const duplicateWith=f.tickets[4].ticket.id;
  const original=f.tickets[4].ticket;
  const duplicateOfRef=f.tickets[9].ticket.ticket_no;assert.equal(typeof duplicateOfRef,'string');
  const ticket=(await f.pool.query("UPDATE pilot_ticket.ticket SET status='DUPLICATE_LINKED',title='已关联原单的重复材料（合成）',version=version+1 WHERE id=$1::uuid RETURNING *",[duplicateWith])).rows[0];
  const event=await appendTicketEvent({transaction:f.pool,ticket,eventType:'ticket.duplicate_linked',actor:{type:'SYSTEM',id:null},oldStatus:original.status,internalNote:null,externalNote:null,traceId:'card28-duplicate-synthetic'});
  await insertClosureRecord({transaction:f.pool,subjectType:'TICKET',subjectId:duplicateWith,beforeStatus:original.status,
    beforeAssignee:original.assignee_id??null,beforeTeam:original.resolver_team_id,beforeVersion:original.version,beforeSnapshot:{},actor:null,source:'SYSTEM',
    input:normalizeClosureInput({reason_code:'DUPLICATE',duplicate_of_ref:duplicateOfRef}),ticketEventId:event.event_id});
  const project=(request,response)=>{
    if(request.method!=='GET'||!/^\/api\/workbench\/(?:board|search)\?/u.test(request.url??''))return;
    const end=response.end.bind(response);
    response.end=(...args)=>{
      if(response.statusCode!==200||typeof args[0]!=='string')return end(...args);
      const page=JSON.parse(args[0]);if(!Array.isArray(page.items))return end(...args);
      page.items=page.items.map(item=>{
        if(item.id===pending[0])return {...item,web_report_urge:{active:true,count:2,last_urged_at:item.updated_at}};
        if(item.id===pending[1])return {...item,review_reason:'人工复核材料（合成）'};
        if(item.id===pending[2])return {...item,reporter_name:null,location:null};
        return item;
      });
      return end(JSON.stringify(page));
    };
  };
  f.runtime.server.on('request',project);
  return {...closed,pending,duplicateWith,duplicateOfRef,longOwner,longOwnerName,completedIntake:completedIntake.intakeId,failedIntake:failedIntake.intakeId,restore:()=>f.runtime.server.off('request',project)};
}
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
export async function seedWeb01NoConversationIntake({pool,text,location='合成位置',serviceCode=/** @type {string|null} */(null)}){
  const scope={scopeHash:createHash('sha256').update('web01-only-'+randomUUID()).digest('hex'),sourceCorpScope:'web01-synthetic-corp',sourceAppScope:'web01-synthetic-app',proofRef:'web01-synthetic-proof'};
  const {receipt}=await createYxxSelfServiceStore({pool}).accept({scope,input:{schema_version:1,client_command_id:randomUUID(),description:text,location:{text:location,unknown:false},service_code:serviceCode,impact_scope:'SELF',reported_department_text:null,extension:null}});
  const row=(await pool.query('SELECT i.id::text,i.retention_until FROM intake.web_request_binding b JOIN intake.service_intake i ON i.id=b.intake_id WHERE b.request_ref=$1',[receipt.request_ref])).rows[0];
  return {intakeId:row.id,receivedAt:receipt.accepted_at,retentionUntil:row.retention_until,requestRef:receipt.request_ref};
}
export async function withWeb01Fixture(run,{beforeClosureMigration=/** @type {((context:{pool:import('../../app/server/src/platform/postgres-pool.mjs').PostgresPool,databaseUrl:string})=>Promise<void>)|null} */(null),precisionV212=false,syntheticServiceCodes=false,serviceCatalog=/** @type {import('../../app/server/src/p2-007-service-catalog.mjs').ServiceCatalog | null | undefined} */(undefined),workbenchBoardActionsEnabled=false,failFollowBootstrapAfterCommit=false,workbenchAssignmentHistoryEnabled=false,workbenchFollowEnabled=false,workbenchSearchEnabled=false,workbenchRealtimeEnabled=false,workbenchActivityEnabled=false,presencePeerSessions=false,workbenchManualReportsEnabled=false,workbenchReporterCandidatesEnabled=false,manualReporterDirectory=/** @type {import('../../contracts/workbench_reporter_candidates_contracts.js').ManualReporterDirectoryOptions | null} */(null),manualProjection=false,chronologicalTicketEvents=false,ticketTakeoverEnabled=false,ticketAssignmentEnabled=false,ticketConversationSelfHandlingEnabled=false,workbenchManualReviewEnabled=false,workbenchReviewResolveAndStartEnabled=false,malformedReviewSuccess=false,malformedReviewDenial=false,installTicketSelfHandlingSchema=true,ticketSelfHandlingWebSource=true,ticketSelfHandlingEnabled=false,dropSelfHandlingResponses=false,malformedSelfHandlingSuccess=false,malformedSelfHandlingDenial=false,workbenchMediaEmployeeReadEnabled=false,workbenchAttachmentsEnabled=false,attachmentStore=/** @type {import('../../contracts/workbench_attachment_contracts.js').AttachmentStore | null} */(null),sourceGroupDirectoryEnabled=false,workbenchInternalNotesEnabled=false,workbenchDraftRecoveryEnabled=false,realWorkbenchAuthentication=false,dropInternalNoteResponses=false,malformedInternalNoteSuccess=false,malformedInternalNoteDenial=false}={}){
  assert.ok(!manualProjection||!realWorkbenchAuthentication,'manual projection uses only the synthetic API fixture');
  return withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'web01',run:async context=>{
    const {pool,databaseUrl}=context;await applyThrough030(context);await migrateP2016({databaseUrl});
    const handlingSchema=ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketTakeoverEnabled;
    if(handlingSchema||workbenchManualReportsEnabled||workbenchFollowEnabled){await migrateP2012({databaseUrl});await migrateYxxSelfService({databaseUrl});}
    if(handlingSchema&&installTicketSelfHandlingSchema)await migrateTicketSelfHandling({databaseUrl,mode:'apply'});
    if(workbenchManualReportsEnabled||workbenchFollowEnabled)await migrateWorkbenchManualReports({databaseUrl,mode:'apply'});
    if(workbenchManualReportsEnabled&&workbenchReporterCandidatesEnabled)await migrateWorkbenchVerifiedManualReports({databaseUrl,mode:'apply'});
    if(sourceGroupDirectoryEnabled)await migrateWorkbenchSourceGroups({databaseUrl,mode:'apply'});
    if(workbenchFollowEnabled){await migrateWorkbenchPersonalRead({databaseUrl,mode:'apply'});await migrateWorkbenchFollow({databaseUrl,mode:'apply'});}
    await beforeClosureMigration?.({pool,databaseUrl});
    await migrateServiceClosure({databaseUrl,mode:'apply'});
    const access=createPilotAccessService({pool});
    const principals=[];for(const [index,name] of ['林舟','陈悦','周宁','沈然'].entries())principals.push(await access.upsertPrincipal({wecomUserId:'web01-synthetic-'+index,displayName:name+(precisionV212?'（合成）':''),roles:index?['HANDLER']:['ADMIN'],resolverTeamIds:['PILOT_IT']}));
    const outsider=await access.upsertPrincipal({wecomUserId:'web01-synthetic-outsider',displayName:'未授权对象测试',roles:['HANDLER'],resolverTeamIds:[]});
    const core=createPilotTicketCore({pool}),tickets=[];
    for(const [index,[originalTitle,originalLocation,originalStatus]] of scenarios.entries()){
      // Card 20: opt-in synthetic evidence; ordinary business fixtures retain their original facts.
      const title=originalTitle+(precisionV212?'（合成）':''),location=originalLocation+(precisionV212?'（合成）':'');
      const status=precisionV212&&[1,2].includes(index)?'IN_PROGRESS':originalStatus;
      // Card 32 A3: opt-in registered catalog services for every synthetic ticket, so category tiles never fall back to 「?」.
      const serviceCode=syntheticServiceCodes?['PRINT.PRINTER_DEVICE','NETWORK.ENDPOINT_ACCESS','ACCESS.CHECK_IN','DIAG.LAB_RESULT_VIEW','ENDPOINT.DISPLAY','NETWORK.BUILDING_DISTRIBUTION','DIAG.IMAGING_VIEWER','PRINT.PRINT_RENDERING','DIAG.IMAGING_TRANSFER_SYNC','ENDPOINT.INPUT_DEVICE','ENDPOINT.COMPUTER','PRINT.PRINTER_DEVICE','ENDPOINT.DISPLAY'][index]??null:precisionV212?['PRINT.PRINTER_DEVICE','NETWORK.ENDPOINT_ACCESS','DIAG.IMAGING_VIEWER','CLINICAL.INPATIENT_WORKSTATION',null,'NETWORK.ENDPOINT_ACCESS','DIAG.IMAGING_VIEWER',null,'DIAG.LAB_RESULT_VIEW','ENDPOINT.COMPUTER'][index]??null:null;
      const text=title+'。全新合成开发材料，请协助排查。';
      const intake=((ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketTakeoverEnabled)&&ticketSelfHandlingWebSource||syntheticServiceCodes)?await seedWeb01NoConversationIntake({pool,text,location,serviceCode}):await seedPersistedIntake({pool,text,requestType:'INCIDENT',status:'RECEIVED'});
      let ticket=(await core.createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'web01-synthetic'})).ticket;
      const row=(await pool.query(`UPDATE pilot_ticket.ticket SET title=$2,status=$3,reported_location_text=$4,version=2,
        assignee_id=$5::uuid,created_at=platform.local_now()-interval '30 days',updated_at=platform.local_now()-($6::text||' minutes')::interval
        WHERE id=$1::uuid RETURNING *`,[ticket.id,title,status,location,['NEW','QUEUED'].includes(status)?null:principals[precisionV212?([1,2,3].includes(index)?0:2):index%4].id,index])).rows[0];
      ticket={...ticket,...row};
      const event=await appendTicketEvent({transaction:pool,ticket,eventType:eventTypes[status],actor:{type:'PILOT_USER',id:principals[index%4].id},oldStatus:'NEW',internalNote:'仅供内部的合成处理记录',externalNote:status==='CLOSED'?'本次处置已完成。':null,traceId:'web01-synthetic'});
      if(!(chronologicalTicketEvents||workbenchReviewResolveAndStartEnabled))await pool.query(`UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now()-($2::text||' hours')::interval WHERE event_id=$1::uuid`,[event.event_id,status==='RESOLVED'?240:index>=9?(index-9)*4:0]);
      if(precisionV212){
        const minutes=[1560,3,12,30,30,45,300,90,120,20,40,60,10][index];
        await pool.query("UPDATE pilot_ticket.ticket SET created_at=platform.local_now()-($2::text||' minutes')::interval WHERE id=$1::uuid",[ticket.id,Math.max(minutes+10,180)]);
        if(index===0)await pool.query("UPDATE pilot_ticket.ticket SET created_at=platform.local_now()-interval '26 hours' WHERE id=$1::uuid",[ticket.id]);
        await pool.query("UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now()-($2::text||' minutes')::interval WHERE event_id=$1::uuid",[event.event_id,minutes]);
        if(index===0){
          await appendTicketEvent({transaction:pool,ticket,eventType:'ticket.note_added',actor:{type:'PILOT_USER',id:principals[0].id},oldStatus:status,internalNote:'正在核对打印队列（合成）；状态保持待接单。',externalNote:null,traceId:'v212-synthetic-note'});
          await appendTicketEvent({transaction:pool,ticket,eventType:'ticket.note_added',actor:{type:'PILOT_USER',id:principals[0].id},oldStatus:status,internalNote:null,externalNote:'请保留待打印的文件（合成）。',traceId:'v212-synthetic-external-note'});
        }
      }
      tickets.push({ticket,intake,event});
    }
    const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'web01-only-synthetic-identity-key',decisionStore:createDecisionStore(),
      safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:core}),manualReviewStore:createManualReviewStore(),decisionStore:createDecisionStore()}),
      ruleEngine:{catalog_version:'WEB01_FIXTURE',rule_set_version:'WEB01_FIXTURE',evaluate(){throw new Error('fixture creates persisted pending review');}}});
    const standalone=await seedPersistedIntake({pool,text:'尚待判断的合成材料，请协助确认。'});
    const processReviewIntake=intakeId=>orchestrator.processPersistedIntake({service_intake_id:intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
    for(const intakeId of [standalone.intakeId,...(((ticketSelfHandlingEnabled||ticketConversationSelfHandlingEnabled||ticketAssignmentEnabled||ticketTakeoverEnabled)&&ticketSelfHandlingWebSource||syntheticServiceCodes)?[]:[tickets[0].intake.intakeId])])await orchestrator.processPersistedIntake({service_intake_id:intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
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
          runtime=createP2016Runtime({...{workbenchBoardActionsEnabled,workbenchAssignmentHistoryEnabled,workbenchFollowEnabled,workbenchSearchEnabled},pool,serviceCatalog,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort:0,workbenchAuthentication:auth,externalSendEnabled:false,ticketTakeoverEnabled,ticketAssignmentEnabled,workbenchRealtimeEnabled,workbenchActivityEnabled,workbenchManualReportsEnabled,workbenchReporterCandidatesEnabled,manualReporterDirectory,workbenchManualReviewEnabled,ticketSelfHandlingEnabled,ticketConversationSelfHandlingEnabled,workbenchMediaEmployeeReadEnabled,workbenchAttachmentsEnabled,attachmentStore,sourceGroupDirectoryEnabled,workbenchInternalNotesEnabled,workbenchDraftRecoveryEnabled,...{workbenchReviewResolveAndStartEnabled}});return runtime.server;
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
    const runtime=createP2016Runtime({...{workbenchBoardActionsEnabled,workbenchAssignmentHistoryEnabled,workbenchFollowEnabled,workbenchSearchEnabled},pool,serviceCatalog,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort,principalIds:presencePeerSessions?principals.map(principal=>principal.id):[principals[0].id,outsider.id,principals[1].id],externalSendEnabled:false,ticketTakeoverEnabled,ticketAssignmentEnabled,workbenchRealtimeEnabled,workbenchActivityEnabled,workbenchManualReportsEnabled,workbenchReporterCandidatesEnabled,manualReporterDirectory,workbenchManualReviewEnabled,ticketSelfHandlingEnabled,ticketConversationSelfHandlingEnabled,workbenchMediaEmployeeReadEnabled,workbenchAttachmentsEnabled,attachmentStore,sourceGroupDirectoryEnabled,workbenchInternalNotesEnabled,workbenchDraftRecoveryEnabled,...{workbenchReviewResolveAndStartEnabled}});
    try{
    // Manual finite batches own projection in this explicit profile; ordinary UI fixtures still start the scheduled worker.
    if(manualProjection){assert.equal(runtime.orchestrationWorker,null);assert.equal(runtime.incidentExtension,null);}
    const started=manualProjection?{address:await listenConversationWorkbenchServer(runtime.server,{port:listenPort}),cookies:runtime.authenticate.browserCookies?.()}:await runtime.start();
    assert.ok(Array.isArray(started.cookies)&&started.cookies.length===(presencePeerSessions?4:3));const cookies=started.cookies.map(c=>c.name+'='+c.value);
    if(workbenchManualReportsEnabled&&!manualProjection)await settleManualFixtureProjection(runtime);
    // Keep the test-owned fault active until explicit reconciliation: Chromium can transparently repeat a transport request.
    let failFollowBootstrap=failFollowBootstrapAfterCommit,followCommitResponses=0,failedFollowBootstrapReads=0;
    const restoreFollowBootstrapResponses=()=>{failFollowBootstrap=false;};
    const followBootstrapFaultState=()=>({committed_responses:followCommitResponses,failed_bootstrap_reads:failedFollowBootstrapReads});
    if(failFollowBootstrapAfterCommit)runtime.server.on('request',(request,response)=>{
      if(request.method==='POST'&&/^\/api\/workbench\/items\/(ticket|review|intake)\/[0-9a-f-]{36}\/follow$/iu.test(request.url??'')){
        response.once('finish',()=>{if(response.statusCode===200)followCommitResponses++;});
      }
      if(request.method==='GET'&&request.url==='/api/lifecycle/bootstrap'&&followCommitResponses>0&&failFollowBootstrap){
        failedFollowBootstrapReads++;const head=response.writeHead.bind(response),end=response.end.bind(response);
        response.writeHead=()=>head(503,{'content-type':'application/json','cache-control':'no-store'});
        response.end=()=>end('{"error":{"code":"P2_016_ACTION_FAILED","retryable":true}}');
      }
    });
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
    return await run({...context,tickets,waiting,principals,outsider,runtime,processReviewIntake,origin,cookies,browserCookies:started.cookies,restoreFollowBootstrapResponses,followBootstrapFaultState,restoreInternalNoteResponses,restoreSelfHandlingResponses,restoreReviewResponses});}
    finally{await runtime.stop();if(runtime.server.listening)throw new Error('WEB01_SERVER_NOT_CLOSED');if(manualProjection){
      const connections=await new Promise((resolve,reject)=>runtime.server.getConnections((error,count)=>error?reject(error):resolve(count))),metrics=await runtime.observability.metrics();
      assert.equal(connections,0);assert.equal(metrics.sse_clients,0);
      console.log('WEB01_MANUAL_PROJECTION_CLEANUP '+JSON.stringify({http_listening:runtime.server.listening,http_connections:connections,sse_clients:metrics.sse_clients}));
    }}
  }});
}
