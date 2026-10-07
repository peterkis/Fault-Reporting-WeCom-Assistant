import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {withP2016IsolatedDatabase,applyThrough030} from './p2-016-postgres-harness.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {migrateP2016} from '../../scripts/p2-016-migrate.mjs';
import {createPilotAccessService} from '../../src/p1-009-pilot-access-workbench.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {appendTicketEvent} from '../../src/p1-006-ticket-state-actions.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {createRuleFirstOrchestrator} from '../../src/p2-015-rule-first-orchestrator.mjs';
import {createSafeActionExecutor,createExistingTicketCommandPort} from '../../src/p2-015-safe-action-executor.mjs';
import {createManualReviewStore} from '../../src/p2-015-manual-review.mjs';
import {createDecisionStore} from '../../src/p2-015-decision-store.mjs';
import {createServiceIntakeDecisionPort} from '../../src/p2-015-service-intake-decision-port.mjs';
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
export async function withWeb01Fixture(run){
  return withP2016IsolatedDatabase({databaseUrl:process.env.PILOT_DATABASE_URL,purpose:'web01',run:async context=>{
    const {pool,databaseUrl}=context;await applyThrough030(context);await migrateP2016({databaseUrl});
    const access=createPilotAccessService({pool});
    const principals=[];for(const [index,name] of ['林舟','陈悦','周宁','沈然'].entries())principals.push(await access.upsertPrincipal({wecomUserId:'web01-synthetic-'+index,displayName:name,roles:index?['HANDLER']:['ADMIN'],resolverTeamIds:['PILOT_IT']}));
    const outsider=await access.upsertPrincipal({wecomUserId:'web01-synthetic-outsider',displayName:'未授权对象测试',roles:['HANDLER'],resolverTeamIds:[]});
    const core=createPilotTicketCore({pool}),tickets=[];
    for(const [index,[title,location,status]] of scenarios.entries()){
      const intake=await seedPersistedIntake({pool,text:title+'。全新合成开发材料，请协助排查。',requestType:'INCIDENT',status:'RECEIVED'});
      let ticket=(await core.createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:'web01-synthetic'})).ticket;
      const row=(await pool.query(`UPDATE pilot_ticket.ticket SET title=$2,status=$3,reported_location_text=$4,version=2,
        assignee_id=$5::uuid,created_at=platform.local_now()-interval '30 days',updated_at=platform.local_now()-($6::text||' minutes')::interval
        WHERE id=$1::uuid RETURNING *`,[ticket.id,title,status,location,['NEW','QUEUED'].includes(status)?null:principals[index%4].id,index])).rows[0];
      ticket={...ticket,...row};
      const event=await appendTicketEvent({transaction:pool,ticket,eventType:eventTypes[status],actor:{type:'PILOT_USER',id:principals[index%4].id},oldStatus:'NEW',internalNote:'仅供内部的合成处理记录',externalNote:status==='CLOSED'?'本次处置已完成。':null,traceId:'web01-synthetic'});
      await pool.query(`UPDATE pilot_ticket.ticket_event SET created_at=platform.local_now()-($2::text||' hours')::interval WHERE event_id=$1::uuid`,[event.event_id,status==='RESOLVED'?240:index>=9?(index-9)*4:0]);
      tickets.push({ticket,intake,event});
    }
    const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'web01-only-synthetic-identity-key',decisionStore:createDecisionStore(),
      safeActionExecutor:createSafeActionExecutor({intakeDecisionPort:createServiceIntakeDecisionPort(),ticketCommandPort:createExistingTicketCommandPort({ticketCore:core}),manualReviewStore:createManualReviewStore(),decisionStore:createDecisionStore()}),
      ruleEngine:{catalog_version:'WEB01_FIXTURE',rule_set_version:'WEB01_FIXTURE',evaluate(){throw new Error('fixture creates persisted pending review');}}});
    const standalone=await seedPersistedIntake({pool,text:'尚待判断的合成材料，请协助确认。'});
    for(const intakeId of [standalone.intakeId,tickets[0].intake.intakeId])await orchestrator.processPersistedIntake({service_intake_id:intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
    // Explicit real relation: the pending review and Ticket are the same intake, not two cards.
    await pool.query(`UPDATE intake.manual_review_item SET linked_ticket_id=$2::uuid WHERE service_intake_id=$1::uuid`,[tickets[0].intake.intakeId,tickets[0].ticket.id]);
    await pool.query(`UPDATE intake.contact_journey SET linked_ticket_id=$2::uuid WHERE origin_intake_id=$1::uuid`,[tickets[0].intake.intakeId,tickets[0].ticket.id]);
    const waiting=await seedPersistedIntake({pool,text:'位置尚不清楚，等待补充的全新合成报修。',status:'WAITING_DESCRIPTION'});
    await pool.query("UPDATE intake.service_intake SET intake_no=regexp_replace(intake_no,'^INT-[0-9]{8}','INT-'||to_char(platform.local_now(),'YYYYMMDD'))");
    const listenPort=await unusedPort(),origin='http://127.0.0.1:'+listenPort;
    const runtime=createP2016Runtime({pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:origin,listenPort,principalIds:[principals[0].id,outsider.id],externalSendEnabled:false});
    const started=await runtime.start(),cookies=started.cookies.map(c=>c.name+'='+c.value);
    try{return await run({...context,tickets,waiting,principals,outsider,runtime,origin,cookies,browserCookies:started.cookies});}
    finally{await runtime.stop();if(runtime.server.listening)throw new Error('WEB01_SERVER_NOT_CLOSED');}
  }});
}
