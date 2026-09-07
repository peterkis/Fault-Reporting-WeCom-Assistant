import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createP2012IncidentCommandService } from '../src/p2-012-incident-command-service.mjs';
import { createP2012IncidentQuery } from '../src/p2-012-incident-query.mjs';
import { projectPersistedCandidate } from '../src/p2-012-candidate-source-adapter.mjs';
import { assertP2012ApprovedDatabaseScope,createP2012ApprovedGroupReporterRegistry,createP2012LiveReporterScope } from '../src/p2-012-live-reporter-scope.mjs';
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
      isApprovedGroupReporter:registry.isApprovedGroupReporter,require_test_label:true});
    const make=(chatType,sender=reporter)=>({provider:'WECOM_AIBOT',bot_id:bot,sender_user_id:sender,chat_type:chatType,
      chat_id:chatType==='group'?group:null,content:[{kind:'text',text:{raw:'【P2-012测试】范围登记',clean:'【p2-012测试】范围登记'}}]});
    assert.equal(await scope.accepts(make('group')),true);
    assert.equal(await scope.accepts(make('single')),false);
    const groupIntake=await seedPersistedIntake({pool,text:'【P2-012测试】范围登记',chatType:'group',tag:'dynamic-group'});
    await pool.query(`UPDATE channel.message_inbox SET bot_id=$2,chat_id=$3,sender_user_id=$4,clean_text='【p2-012测试】范围登记' WHERE id=$1::bigint`,[groupIntake.messageId,bot,group,reporter]);
    await pool.query(`UPDATE intake.service_intake SET source_bot_id=$2,source_chat_id=$3,reporter_wecom_userid=$4 WHERE id=$1::uuid`,[groupIntake.intakeId,bot,group,reporter]);
    assert.equal(await scope.accepts(make('single')),true);
    assert.equal(await scope.authorizesDestination({target_type:'PERSON',target_id:reporter}),true);
    const directIntake=await seedPersistedIntake({pool,text:'【P2-012测试】单聊登记',chatType:'single',tag:'dynamic-direct'});
    await pool.query(`UPDATE channel.message_inbox SET bot_id=$2,sender_user_id=$3,clean_text='【p2-012测试】单聊登记' WHERE id=$1::bigint`,[directIntake.messageId,bot,reporter]);
    await pool.query(`UPDATE intake.service_intake SET source_bot_id=$2,reporter_wecom_userid=$3 WHERE id=$1::uuid`,[directIntake.intakeId,bot,reporter]);
    const configuration={botId:bot,inboundScope:{person_hashes:[],group_hashes:[groupHash]}};
    assert.deepEqual(await assertP2012ApprovedDatabaseScope(pool,configuration),{foreign_intakes:0,foreign_deliveries:0,competing_roles:0});
    const outsider=await seedPersistedIntake({pool,text:'【P2-012测试】群外单聊',chatType:'single',tag:'dynamic-outsider'});
    await pool.query(`UPDATE channel.message_inbox SET bot_id=$2,sender_user_id='never-observed-outsider',clean_text='【p2-012测试】群外单聊' WHERE id=$1::bigint`,[outsider.messageId,bot]);
    await pool.query(`UPDATE intake.service_intake SET source_bot_id=$2,reporter_wecom_userid='never-observed-outsider' WHERE id=$1::uuid`,[outsider.intakeId,bot]);
    await assert.rejects(assertP2012ApprovedDatabaseScope(pool,configuration),/P2_012_DEDICATED_APPROVED_DATABASE_REQUIRED/u);
  }});await assertNoP2012Residual({databaseUrl});
});
