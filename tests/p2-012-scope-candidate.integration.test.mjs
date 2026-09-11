import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createP2012IncidentCommandService } from '../src/p2-012-incident-command-service.mjs';
import { createP2012IncidentQuery } from '../src/p2-012-incident-query.mjs';
import { projectPersistedCandidate } from '../src/p2-012-candidate-source-adapter.mjs';
import { assertP2012ApprovedDatabaseScope,createP2012ApprovedGroupReporterRegistry,createP2012LiveReporterScope,createP2012PersonDestinationAuthorizer,createP2012DynamicWeComSender } from '../src/p2-012-live-reporter-scope.mjs';
import { createRuleFirstOrchestrator } from '../src/p2-015-rule-first-orchestrator.mjs';
import { createP2016TicketNotificationProjector } from '../src/p2-016-ticket-notification-projector.mjs';
import { createP2016ReporterAccess } from '../src/p2-016-reporter-access.mjs';
import { appendTicketEvent,createTicketActionService } from '../src/p1-006-ticket-state-actions.mjs';
import { transactionP2016,textHashP2016 } from '../src/p2-016-domain-contracts.mjs';
import { assertP2016Schema } from './helpers/p2-016-schema-assert.mjs';
import { withP2012Database,applyThrough031,apply032Raw,fixtureP2012,assertNoP2012Residual } from './helpers/p2-012-postgres-harness.mjs';
import { seedPersistedIntake } from './helpers/p2-015-postgres-harness.mjs';
const databaseUrl=process.env.PILOT_DATABASE_URL;
const cmd=(action,id,version='1',extra={})=>({action,client_command_id:randomUUID(),reason_code:'OPERATOR_REVIEWED',
  ...(['START_REVIEW','REJECT_CANDIDATE','EXPIRE_CANDIDATE','CONFIRM_INCIDENT'].includes(action)?{candidate_review_id:id}:{incident_id:id}),
  ...(action==='CONFIRM_INCIDENT'?{expected_candidate_version:version}:{expected_row_version:version}),...extra});

test('P2-012 incomplete persisted Candidate summary remains explicit and does not invent clustering evidence',()=>{
  const d={result_code:'INCIDENT_REVIEW_CANDIDATE',reason_code:'DETERMINISTIC_INCIDENT_CANDIDATE',safe_result:{incident_review_candidate:true,known_fields:{selected_service_code:'HIS',symptom_codes:['LOGIN_FAILURE']},fact_provenance:[]}};
  const c=projectPersistedCandidate(d);assert.equal(c.service_family,'HIS');assert.equal(c.scope_candidate,'UNKNOWN');
  for(const key of ['distinct_reporters','distinct_departments','distinct_locations','correlation_window_ms','cluster_key_hash'])assert.equal(c[key],null);
  assert.throws(()=>projectPersistedCandidate({...d,result_code:'TICKET_ELIGIBLE'}),{code:'P2_012_SOURCE_EVIDENCE_INCOMPLETE'});
});

test('P2-012 four scope permissions, authorization before replay, expiry maintenance and closed schemas',async()=>{
  await withP2012Database({databaseUrl,purpose:'p2012scope',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);const f=await fixtureP2012(pool,{reporters:8});
    const query=createP2012IncidentQuery({pool,enabled:true}),service=createP2012IncidentCommandService({pool,enabled:true,maintenanceEnabled:true});
    const run=(p,command)=>service.perform({authContext:{principal_id:p.id},command});
    let i=0;const commands=[];
    for(const scope of ['LOCAL','BUILDING','CAMPUS','HOSPITAL_WIDE']){
      const c=await f.newCandidate(i);await run(f.dispatcher,cmd('START_REVIEW',c.id));
      const command=cmd('CONFIRM_INCIDENT',c.id,'2',{confirmed_scope:scope,owner_principal_id:f.admin.id,selected_report_refs:[f.reports[i++].decisionId]});
      if(['CAMPUS','HOSPITAL_WIDE'].includes(scope))await assert.rejects(run(f.dispatcher,command),{code:'P2_012_FORBIDDEN'});
      const actor=['LOCAL','BUILDING'].includes(scope)?f.dispatcher:f.admin;
      const result=await run(actor,command);assert.equal(result.ok,true,JSON.stringify(result));commands.push({actor,command});
      const detail=await query.detail({authContext:{principal_id:f.admin.id},id:result.result_ref_id});
      assert.equal(detail.status,'CONFIRMED_'+scope);assert.equal(detail.confirmed_scope,scope);await assertP2016Schema('p2_012_incident_detail',detail);
      await assert.rejects(run(f.dispatcher,cmd('CORRECT_SCOPE',detail.id,detail.row_version,{confirmed_scope:'LOCAL'})),{code:'P2_012_FORBIDDEN'});
    }
    const c=await f.newCandidate(4);await run(f.admin,cmd('START_REVIEW',c.id));
    const campus=createP2012IncidentCommandService({pool,enabled:true,allowDispatcherCampus:true});
    assert.equal((await campus.perform({authContext:{principal_id:f.dispatcher.id},command:cmd('CONFIRM_INCIDENT',c.id,'2',{confirmed_scope:'CAMPUS',owner_principal_id:f.admin.id,selected_report_refs:[f.reports[4].decisionId]})})).ok,true);
    const list=await query.list({authContext:{principal_id:f.admin.id}});await assertP2016Schema('p2_012_incident_list',list);
    const candidate=await query.detail({authContext:{principal_id:f.admin.id},id:c.id,kind:'candidate'});await assertP2016Schema('p2_012_candidate_review',candidate);
    const expired=await f.newCandidate(5);
    await pool.query("WITH clock AS(SELECT platform.physical_epoch_ms()-86400000 AS expiry) UPDATE incident.candidate_review SET created_at=platform.local_now()-interval '2 days',expires_at=platform.local_from_epoch_ms(clock.expiry),expires_epoch_ms=clock.expiry FROM clock WHERE id=$1::uuid",[expired.id]);
    await assert.rejects(run(f.admin,cmd('EXPIRE_CANDIDATE',expired.id)),{code:'P2_012_FORBIDDEN'});
    assert.equal((await service.expireCandidate(cmd('EXPIRE_CANDIDATE',expired.id))).ok,true);
    assert.equal((await run(f.admin,cmd('START_REVIEW',expired.id,'2'))).ok,false);
    const reviewed=await f.newCandidate(6);await run(f.admin,cmd('START_REVIEW',reviewed.id));
    assert.equal((await service.expireCandidate(cmd('EXPIRE_CANDIDATE',reviewed.id,'2'))).ok,false);
    const owned=(await pool.query('SELECT r.id,r.row_version,r.incident_id,r.ticket_id FROM incident.incident_report r ORDER BY r.id LIMIT 1')).rows[0];
    const ownVersion=(await query.detail({authContext:{principal_id:f.admin.id},id:owned.incident_id})).row_version;
    const recovery=cmd('MARK_REPORTER_RECOVERED',owned.incident_id,ownVersion,{incident_report_id:owned.id,expected_report_version:owned.row_version});
    await assert.rejects(run(f.handler,recovery),{code:'P2_012_FORBIDDEN'});
    await pool.query('UPDATE pilot_ticket.ticket SET assignee_id=$2::uuid WHERE id=$1::uuid',[owned.ticket_id,f.handler.id]);
    assert.equal((await run(f.handler,recovery)).ok,true);
    assert.equal((await pool.query('SELECT status FROM pilot_ticket.ticket WHERE id=$1::uuid',[owned.ticket_id])).rows[0].status,'QUEUED');
    const before=(await pool.query('SELECT count(*)::int AS n FROM incident.command_receipt')).rows[0].n;
    await pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[f.dispatcher.id]);
    await assert.rejects(run(f.dispatcher,commands[0].command),{code:'P2_012_FORBIDDEN'});
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM incident.command_receipt')).rows[0].n,before);
  }});await assertNoP2012Residual({databaseUrl});
});

test('P2-012 approved-group Reporter discovery persists before direct intake, Sender scope and database guard',async()=>{
  await withP2012Database({databaseUrl,purpose:'p2012live',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const bot='p2-012-live-bot',group='p2-012-dedicated-group',reporter='unconfigured-normal-reporter';
    const groupHash=createHash('sha256').update(group).digest('hex');
    const registry=createP2012ApprovedGroupReporterRegistry({pool,botId:bot,groupHashes:[groupHash]});
    const scope=createP2012LiveReporterScope({bot_id:bot,person_hashes:[],group_hashes:[groupHash],
      isApprovedGroupReporter:registry.isApprovedGroupReporter,hasMatchingDirectLeg:registry.hasMatchingDirectLeg,require_test_label:true});
    const make=(chatType,sender=reporter)=>({provider:'WECOM_AIBOT',bot_id:bot,sender_user_id:sender,chat_type:chatType,
      chat_id:chatType==='group'?group:null,content:[{kind:'text',text:{raw:'【P2-012测试】范围登记',clean:'【p2-012测试】范围登记'}}]});
    assert.equal(await scope.accepts(make('group')),true);
    assert.equal(await scope.accepts(make('single')),false);
    const groupIntake=await seedPersistedIntake({pool,text:'【P2-012测试】范围登记',chatType:'group',tag:'dynamic-group'});
    await pool.query(`UPDATE channel.message_inbox SET bot_id=$2,chat_id=$3,sender_user_id=$4,clean_text='【p2-012测试】范围登记' WHERE id=$1::bigint`,[groupIntake.messageId,bot,group,reporter]);
    await pool.query(`UPDATE intake.service_intake SET source_bot_id=$2,source_chat_id=$3,reporter_wecom_userid=$4 WHERE id=$1::uuid`,[groupIntake.intakeId,bot,group,reporter]);
    assert.equal(await scope.accepts(make('single')),true);
    assert.equal(await scope.authorizesDestination({target_type:'PERSON',target_id:reporter}),false);
    const directIntake=await seedPersistedIntake({pool,text:'【P2-012测试】单聊登记',chatType:'single',tag:'dynamic-direct'});
    await pool.query(`UPDATE channel.message_inbox SET bot_id=$2,sender_user_id=$3,clean_text='【p2-012测试】单聊登记' WHERE id=$1::bigint`,[directIntake.messageId,bot,reporter]);
    await pool.query(`UPDATE intake.service_intake SET source_bot_id=$2,reporter_wecom_userid=$3 WHERE id=$1::uuid`,[directIntake.intakeId,bot,reporter]);
    assert.equal(await scope.authorizesDestination({target_type:'PERSON',target_id:reporter}),false);
    const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'synthetic-incident-identity-hmac-key',safeActionExecutor:{execute:async()=>[]}});
    await orchestrator.processPersistedIntake({service_intake_id:directIntake.intakeId,feature_flags:{RULE_FIRST_ORCHESTRATION_ENABLED:true,MANUAL_REVIEW_QUEUE_ENABLED:true}});
    assert.equal(await scope.authorizesDestination({target_type:'PERSON',target_id:reporter}),true);
    const configuration={botId:bot,inboundScope:{person_hashes:[],group_hashes:[groupHash]}};
    assert.deepEqual(await assertP2012ApprovedDatabaseScope(pool,configuration),{foreign_intakes:0,foreign_deliveries:0,competing_roles:0});
    const outsider=await seedPersistedIntake({pool,text:'【P2-012测试】群外单聊',chatType:'single',tag:'dynamic-outsider'});
    await pool.query(`UPDATE channel.message_inbox SET bot_id=$2,sender_user_id='never-observed-outsider',clean_text='【p2-012测试】群外单聊' WHERE id=$1::bigint`,[outsider.messageId,bot]);
    await pool.query(`UPDATE intake.service_intake SET source_bot_id=$2,reporter_wecom_userid='never-observed-outsider' WHERE id=$1::uuid`,[outsider.intakeId,bot]);
    await assert.rejects(assertP2012ApprovedDatabaseScope(pool,configuration),/P2_012_DEDICATED_APPROVED_DATABASE_REQUIRED/u);
  }});await assertNoP2012Residual({databaseUrl});
});

test('P2-012 real direct-leg eligibility suppresses group-only Ticket artifacts and validates persisted destination scope',async()=>{
  await withP2012Database({databaseUrl,purpose:'p2012direct',run:async({pool,databaseUrl})=>{
    await applyThrough031({pool,databaseUrl});await apply032Raw(pool);
    const f=await fixtureP2012(pool,{reporters:1}),reporter='synthetic-reporter-0',bot='bot-test',group='synthetic-incident-group';
    const groupHash=textHashP2016(group),configuration={botId:bot,inboundScope:{person_hashes:[],group_hashes:[groupHash]}};
    await pool.query(`UPDATE channel.message_inbox SET chat_id=$1,sender_user_id=$2,clean_text='【p2-012测试】HIS登录异常' WHERE chat_type='group'`,[group,reporter]);
    const registry=createP2012ApprovedGroupReporterRegistry({pool,botId:bot,groupHashes:[groupHash]});
    const scope=createP2012LiveReporterScope({bot_id:bot,group_hashes:[groupHash],...registry});
    const allowed=()=>scope.authorizesDestination({target_type:'PERSON',target_id:reporter});
    assert.equal(await allowed(),false,'GROUP_ORIGIN alone is not a direct channel');
    const explicit=createP2012LiveReporterScope({bot_id:bot,person_hashes:[textHashP2016(reporter)],group_hashes:[groupHash],...registry});
    assert.equal(await explicit.authorizesDestination({target_type:'PERSON',target_id:reporter}),false);
    const access=createP2016ReporterAccess({pool,enabled:true,hmacSecret:'synthetic-only-review-hardening-secret-32bytes'});
    const personDestinationAuthorizer=createP2012PersonDestinationAuthorizer({pool,botId:bot,groupHashes:[groupHash]});
    const projector=createP2016TicketNotificationProjector({enabled:true,cardEnabled:true,reporterAccess:access,personDestinationAuthorizer,
      additionalEventTypes:['ticket.started']});
    const ticket=(await pool.query('SELECT * FROM pilot_ticket.ticket WHERE id=$1::uuid',[f.reports[0].ticketId])).rows[0];
    const event=await transactionP2016(pool,tx=>appendTicketEvent({transaction:tx,ticket,eventType:'ticket.created',actor:{type:'SYSTEM',id:null},traceId:'synthetic-hardening'}));
    const project=()=>transactionP2016(pool,tx=>projector.project({transaction:tx,ticket,event}));
    assert.deepEqual(await project(),{created:false,reason:'DIRECT_DESTINATION_NOT_ESTABLISHED',group_receipt_created:true});
    assert.equal((await project()).replayed,true);
    const counts=async()=>(await pool.query(`SELECT
      (SELECT count(DISTINCT m.id)::int FROM communication.message m JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id WHERE d.target_type='PERSON') AS messages,
      (SELECT count(DISTINCT o.id)::int FROM communication.outbox o JOIN communication.delivery d ON d.outbox_id=o.id WHERE d.target_type='PERSON') AS outboxes,
      (SELECT count(*)::int FROM communication.delivery WHERE target_type='PERSON') AS deliveries,
      (SELECT count(*)::int FROM pilot_ticket.reporter_public_ref) AS public_refs,
      (SELECT count(*)::int FROM pilot_ticket.reporter_access_grant) AS grants,
      (SELECT count(*)::int FROM communication.delivery WHERE status='DEAD_LETTER') AS dead_letters`)).rows[0];
    assert.deepEqual(await counts(),{messages:0,outboxes:0,deliveries:0,public_refs:0,grants:0,dead_letters:0});
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM communication.delivery WHERE target_type='GROUP'")).rows[0].n,1);
    const receipt=(await pool.query("SELECT m.content FROM communication.message m JOIN communication.ticket_notification_binding b ON b.message_id=m.id WHERE b.destination_type='GROUP'")).rows[0].content;
    assert.match(receipt.text,/可在群里继续补充，也可选择机器人单聊/u);assert.doesNotMatch(receipt.text,/后续进度将通过机器人单聊通知/u);
    let calls=0;
    const sender=createP2012DynamicWeComSender({pool,botId:bot,enabled:true,approvedGroupHashes:[groupHash],allowedTargetHashes:[groupHash],
      gateway:{getAuthenticatedClient:()=>({sendMessage:async()=>{calls++;return {errcode:0};}})}});
    const request={provider:'WECOM_AIBOT',channel_account_id:bot,target_type:'PERSON',target_id:reporter,
      delivery_id:randomUUID(),idempotency_key:'synthetic-direct-eligibility',message:{message_type:'text',content:{text:'固定合成通知'}},signal:new AbortController().signal};
    const refused=await sender.send(request);assert.equal(refused.error_code,'P2_012_SEND_SCOPE_FORBIDDEN');assert.equal(calls,0);
    assert.equal(JSON.stringify(refused).includes(reporter),false);
    assert.deepEqual(await assertP2012ApprovedDatabaseScope(pool,configuration),{foreign_intakes:0,foreign_deliveries:0,competing_roles:0});
    // Deliberate bad Delivery fixture: the database preflight must not accept a group-only target.
    const accepted=await transactionP2016(pool,tx=>createTicketActionService().performInTransaction({ticketId:ticket.id,action:'accept',expectedVersion:ticket.version,
      actor:{type:'SYSTEM',id:null},traceId:'synthetic-hardening'},tx));
    const suppressed=await transactionP2016(pool,tx=>projector.project({transaction:tx,ticket,event:accepted.event}));
    assert.equal(suppressed.reason,'DIRECT_DESTINATION_NOT_ESTABLISHED');
    assert.deepEqual(await counts(),{messages:0,outboxes:0,deliveries:0,public_refs:0,grants:0,dead_letters:0});
    await transactionP2016(pool,tx=>createP2016TicketNotificationProjector({enabled:true}).project({transaction:tx,ticket,event:accepted.event}));
    await assert.rejects(assertP2012ApprovedDatabaseScope(pool,configuration),/P2_012_DEDICATED_APPROVED_DATABASE_REQUIRED/u);
    const direct=await seedPersistedIntake({pool,text:'【p2-012测试】HIS登录异常',chatType:'single'});
    await pool.query('UPDATE intake.service_intake SET reporter_wecom_userid=$2 WHERE id=$1::uuid',[direct.intakeId,reporter]);
    const orchestrator=createRuleFirstOrchestrator({pool,identityHmacKey:'synthetic-incident-identity-hmac-key',safeActionExecutor:{execute:async()=>[]}});
    const prepared=await orchestrator.preparePersistedIntake(direct.intakeId);
    let leg;
    await transactionP2016(pool,async tx=>{
      const result=await orchestrator.processInTransaction({transaction:tx,intakeId:direct.intakeId,profile:prepared.profile,reporterHash:prepared.reporter_hash,
        flags:{rule_first_orchestration_enabled:true,manual_review_queue_enabled:true},traceId:'synthetic-direct-transaction'});
      leg=result.leg;assert.equal(leg.leg_type,'DIRECT_ORGANIC');
      assert.equal(await registry.hasMatchingDirectLeg({transaction:tx,reporter_user_id:reporter}),true,'same transaction sees its new direct leg');
      assert.equal(await personDestinationAuthorizer({transaction:tx,bot_id:bot,reporter_user_id:reporter}),true);
    });
    assert.equal(await allowed(),true);
    assert.equal((await sender.send(request)).outcome,'ACKNOWLEDGED');assert.equal(calls,1);
    assert.deepEqual(await assertP2012ApprovedDatabaseScope(pool,configuration),{foreign_intakes:0,foreign_deliveries:0,competing_roles:0});
    assert.equal(await registry.hasMatchingDirectLeg({reporter_user_id:reporter,bot_id:'wrong-bot'}),false);
    assert.equal(await registry.hasMatchingDirectLeg({reporter_user_id:'wrong-reporter'}),false);
    assert.equal(await scope.authorizesDestination({target_type:'PERSON',target_id:'outsider'}),false);
    const groupJourney=(await pool.query('SELECT journey_id FROM intake.channel_leg WHERE id=$1::uuid',[f.reports[0].legId])).rows[0].journey_id;
    await pool.query("UPDATE intake.channel_leg SET leg_type='DIRECT_GUIDED',journey_id=$2::uuid,leg_ordinal=2,status='CLOSED',closed_at=platform.local_now() WHERE id=$1::uuid",[leg.id,groupJourney]);
    assert.equal(await allowed(),true,'retained CLOSED DIRECT_GUIDED is eligible');
    // Persisted contradictory binding, wrong source bot/reporter and group-only type each fail closed.
    const probe=async sql=>{
      const tx=await pool.connect();try{await tx.query('BEGIN');await tx.query(sql,[leg.id]);
        assert.equal(await registry.hasMatchingDirectLeg({transaction:tx,reporter_user_id:reporter}),false);
        await assert.rejects(assertP2012ApprovedDatabaseScope(tx,configuration),/P2_012_DEDICATED_APPROVED_DATABASE_REQUIRED/u);
      }finally{await tx.query('ROLLBACK');tx.release();}
    };
    await probe("UPDATE intake.channel_leg SET reporter_identity_hash=repeat('a',64) WHERE id=$1::uuid");
    await probe("UPDATE intake.channel_leg SET leg_type='GROUP_ORIGIN' WHERE id=$1::uuid");
    await probe("UPDATE intake.service_intake SET source_bot_id='wrong-bot' WHERE id=(SELECT source_intake_id FROM intake.channel_leg WHERE id=$1::uuid)");
    await probe("UPDATE intake.service_intake SET reporter_wecom_userid='wrong-reporter' WHERE id=(SELECT source_intake_id FROM intake.channel_leg WHERE id=$1::uuid)");
    assert.equal((await project()).replayed,true,'old group-only event does not backfill a card');
    const started=await transactionP2016(pool,tx=>createTicketActionService().performInTransaction({ticketId:ticket.id,action:'start',expectedVersion:accepted.ticket.version,
      actor:{type:'SYSTEM',id:null},traceId:'synthetic-hardening'},tx));
    assert.equal((await transactionP2016(pool,tx=>projector.project({transaction:tx,ticket,event:started.event}))).created,true);
    assert.equal((await counts()).grants,1);
    assert.equal((await counts()).dead_letters,0);
  }});await assertNoP2012Residual({databaseUrl});
});
