import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {IncomingMessage} from 'node:http';
import {Socket} from 'node:net';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {sourceFile} from './helpers/migration-roots.mjs';
import {createYxxSelfServiceStore} from '../app/server/src/yxx-self-service-store.mjs';
import {createYxxSelfServiceOrchestrator} from '../app/server/src/yxx-self-service-orchestrator.mjs';
import {createYxxSelfServiceQuery} from '../app/server/src/yxx-self-service-query.mjs';
import {createYxxSelfServiceAuthorization} from '../app/server/src/yxx-self-service-authorization.mjs';
import type {YxxMemberScope} from '../app/server/src/yxx-self-service-authorization.mjs';
import {createYxxH5Lifecycle} from '../app/server/src/yxx-h5-v2-lifecycle.mjs';
import {projectYxxH5Urge} from '../app/server/src/yxx-h5-realtime.mjs';
import {createWorkbenchReminders} from '../app/server/src/workbench-reminders.mjs';
import type {H5UrgeFact} from '../app/server/src/yxx-h5-v2-lifecycle.mjs';
import {createYxxH5Profile} from '../app/server/src/yxx-h5-v2-profile.mjs';
import {createYxxSelfServiceFeedback} from '../app/server/src/yxx-self-service-feedback.mjs';
import {transactionP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import {createThirdPartyStaffDirectoryStore} from '../app/server/src/p2-007-staff-directory-store.mjs';
import {migrateWorkbenchAuth} from '../app/server/scripts/p2-016-workbench-auth-migrate.mjs';
import {migrateThirdPartyStaffDirectory} from '../app/server/scripts/p2-007-migrate.mjs';
import {createYxxH5ProfileEnricher} from '../app/server/src/yxx-h5-v2-profile-enricher.mjs';
import type {H5ProfileMemberIdentity} from '../app/server/src/yxx-h5-v2-profile-enricher.mjs';
import {createThirdPartyReporterDirectory} from '../app/server/src/p2-007-third-party-reporter-directory.mjs';
import {createThirdPartyStaffDirectoryAdapter} from '../app/server/src/p2-007-third-party-staff-directory-adapter.mjs';
import {applicationRecipientProof} from '../app/server/src/yxx-application-member-auth.mjs';
import {migrateWorkbenchFollowUpSchedules} from '../app/server/scripts/workbench-follow-up-schedules-migrate.mjs';
import {migrateWorkbenchFollowUpDueSignals} from '../app/server/scripts/workbench-follow-up-due-migrate.mjs';
import {createWorkbenchWebReport} from '../app/server/src/workbench-web-report.mjs';
import {createWeb01WorkbenchQuery} from '../app/server/src/web01-workbench-query.mjs';
import {migrateTicketReporterProfiles} from '../app/server/scripts/ticket-reporter-profiles-migrate.mjs';
import {createTicketReporterProfileWorker,readTicketReporterProfiles} from '../app/server/src/ticket-reporter-profiles.mjs';
import {createWorkbenchReporterDirectory} from '../app/server/src/workbench-reporter-directory.mjs';

const secret='h5-v2-isolated-synthetic-secret-at-least-32-bytes';
const flags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
function scope():YxxMemberScope{return {scopeHash:createHash('sha256').update(randomUUID()).digest('hex') as YxxMemberScope['scopeHash'],sourceCorpScope:'h5-synthetic-corp',sourceAppScope:'h5-synthetic-app',proofRef:'tests/yxx-h5-v2'};}
const request=(description:string|null=null)=>({schema_version:2,client_command_id:randomUUID(),intent:'FAULT',description,location:{text:null,unknown:true},media_refs:[randomUUID()]});
const auth=(s:YxxMemberScope)=>({profile:'MEMBER_SELF_SERVICE',flags,write_flag:true,csrf_token:'h5-synthetic-csrf',canonical_reporter_binding:s.scopeHash,source_corp_scope:s.sourceCorpScope,source_app_scope:s.sourceAppScope,proof_ref:s.proofRef});

test('H5 signed reporter material survives source expiry and closed Ticket aging without changing the original snapshot',{timeout:240000},async()=>{
 await withT24Fixture(async f=>{
  await f.pool.query(await readFile(sourceFile('database/migrations/064_yixiaoxiu_h5_member_service.sql'),'utf8'));
  await migrateTicketReporterProfiles({databaseUrl:f.databaseUrl,expectedDatabase:new URL(f.databaseUrl).pathname.slice(1),mode:'apply'});
  const s=scope(),memberId='persistent-h5-member',store=createYxxSelfServiceStore({pool:f.pool,scopeSecret:secret,h5Enabled:true});
  const accepted=await store.accept({scope:s,input:{...request('永久保存合成H5报修'),media_refs:[]},notificationRecipient:{namespace:'APP_OPEN_USERID',member_id:memberId,proof_ref:applicationRecipientProof(secret,s,memberId),verified_epoch_ms:String(Date.now())}});
  await createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags,ruleEngine:{evaluate(){throw Error('NO_RULES_FOR_EXPLICIT_H5');}}}).processOne({requestRef:accepted.receipt.request_ref});
  const ticket=(await f.pool.query<{id:string;intake_id:string}>('SELECT t.id::text,t.source_intake_id::text AS intake_id FROM pilot_ticket.ticket t JOIN intake.web_request_binding b ON b.intake_id=t.source_intake_id WHERE b.request_ref=$1',[accepted.receipt.request_ref])).rows[0];assert.ok(ticket);
  const original=(await f.pool.query('SELECT profile_snapshot,profile_snapshot_hash FROM intake.contact_journey WHERE origin_intake_id=$1',[ticket.intake_id])).rows[0];
  const future=Date.UTC(2046,0,1);
  await f.pool.query(`CREATE OR REPLACE FUNCTION platform.physical_epoch_ms() RETURNS bigint LANGUAGE sql VOLATILE AS 'SELECT ${future}::bigint'`);
  await f.pool.query(`CREATE OR REPLACE FUNCTION platform.local_now() RETURNS timestamp without time zone LANGUAGE sql STABLE AS 'SELECT platform.local_from_epoch_ms(${future}::bigint)'`);
  const applicationScope={corpId:s.sourceCorpScope,agentId:s.sourceAppScope,scopeSecret:secret};let calls=0;
  const directory=createWorkbenchReporterDirectory({botId:'different-bot',identityHmacKey:'isolated-h5-profile-identity-key',applicationScope,accessTokenProvider:async()=> 'synthetic-token',fetchImpl:async(input)=>{
   const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');calls++;
   if(url.pathname==='/cgi-bin/user/get'){assert.equal(url.searchParams.get('userid'),memberId);return Response.json({errcode:0,userid:memberId,status:1,enable:1,name:'永久H5合成报修人',department:[7]});}
   assert.equal(url.pathname,'/cgi-bin/department/get');return Response.json({errcode:0,department:{id:7,name:'永久H5合成科室'}});
  }});
  assert.equal((await directory.resolve({source_provider:'YIXIAOXIU_WEB',source_namespace:'APP_OPEN_USERID',reporter_external_id:memberId,reporter_identity_hash:s.scopeHash,source_corp_scope:s.sourceCorpScope,source_app_scope:s.sourceAppScope,recipient_proof:'wrong-proof'})).status,'NOT_FOUND');assert.equal(calls,0);
  const profiles=createTicketReporterProfileWorker({pool:f.pool,enabled:true,botId:'different-bot',identityHmacKey:'isolated-h5-profile-identity-key',directoryPort:directory,applicationScope});
  await profiles.runOnce();assert.equal(calls,2);
  const retained=(await readTicketReporterProfiles(f.pool,[ticket.id])).get(ticket.id);assert.equal(retained?.name,'永久H5合成报修人');assert.equal(retained?.department,'永久H5合成科室');assert.equal(retained?.source,'LATER_LOOKUP');
  assert.deepEqual((await f.pool.query('SELECT profile_snapshot,profile_snapshot_hash FROM intake.contact_journey WHERE origin_intake_id=$1',[ticket.intake_id])).rows[0],original);
  await f.pool.query("UPDATE pilot_ticket.ticket SET status='CLOSED' WHERE id=$1",[ticket.id]);
  await f.pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE intake_id=$1',[ticket.intake_id]);
  await profiles.runOnce();assert.equal(calls,2);
  const query=createWeb01WorkbenchQuery({pool:f.pool,query:f.runtime.query,reporterProfilesEnabled:true}),authContext={principal_id:f.principals[0]?.id??'',auth_method:'COOKIE' as const,expires_epoch_ms:String(future+600000)};
  const detail=await query.detail({authContext,kind:'ticket',id:ticket.id,cursor:null,limit:10});
  assert.equal(detail.item.reporter_name,'永久H5合成报修人');assert.equal(detail.item.reporter_department,'永久H5合成科室');assert.equal(detail.item.source,'PORTAL');assert.equal(detail.description,null,'expired source body is not restored with the necessary contact fields');
  const reports=createWorkbenchWebReport({pool:f.pool,query,ticketQuery:f.runtime.query,enabled:true,localTestProfile:true});
  try{assert.deepEqual(await reports.readReporterProfile(authContext,'ticket',ticket.id),{name:'永久H5合成报修人',department:'永久H5合成科室',source:'RETAINED_PROFILE'});}finally{await reports.close();}
 },{mvpNotificationsEnabled:true,manualRoundConsumption:true});
});

test('H5 workbench reporter display uses signed source identity and rechecks READ after profile lookup',{timeout:240000},async()=>{
 await withT24Fixture(async f=>{
  await f.pool.query(await readFile(sourceFile('database/migrations/064_yixiaoxiu_h5_member_service.sql'),'utf8'));
  const s=scope(),memberId='synthetic-reporter',store=createYxxSelfServiceStore({pool:f.pool,scopeSecret:secret,h5Enabled:true});
  const accepted=await store.accept({scope:s,input:{...request('合成资料展示'),media_refs:[]},notificationRecipient:{namespace:'APP_OPEN_USERID',member_id:memberId,proof_ref:applicationRecipientProof(secret,s,memberId),verified_epoch_ms:String(Date.now())}});
  const binding=(await f.pool.query<{id:string}>('SELECT intake_id::text AS id FROM intake.web_request_binding WHERE request_ref=$1',[accepted.receipt.request_ref])).rows[0];assert.ok(binding);
  const query=createWeb01WorkbenchQuery({pool:f.pool,query:f.runtime.query});
  const staff={principal_id:f.principals[0]?.id??'',auth_method:'COOKIE' as const,expires_epoch_ms:String(Date.now()+600000)};
  let calls=0,revoke=false;
  const reporterProfile={secret,corpId:s.sourceCorpScope,agentId:s.sourceAppScope,read:async(id:string)=>{
   calls++;assert.equal(id,memberId);if(revoke)await f.pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE intake_id=$1::uuid',[binding.id]);
   return {openUserId:id,displayName:'合成李护士',departmentName:'合成内科',checkedEpochMs:String(Date.now())};
  }};
  const reports=createWorkbenchWebReport({pool:f.pool,query,ticketQuery:f.runtime.query,enabled:true,localTestProfile:true,reporterProfile});
  try{
   const before=(await f.pool.query('SELECT profile_snapshot,profile_snapshot_hash FROM intake.contact_journey WHERE origin_intake_id=$1::uuid',[binding.id])).rows;
   assert.deepEqual(await reports.readReporterProfile(staff,'intake',binding.id),{name:'合成李护士',department:'合成内科',source:'CURRENT_PROFILE'});
   assert.equal(calls,1);assert.deepEqual((await f.pool.query('SELECT profile_snapshot,profile_snapshot_hash FROM intake.contact_journey WHERE origin_intake_id=$1::uuid',[binding.id])).rows,before);
   reporterProfile.secret='different-synthetic-configuration-secret';
   assert.deepEqual(await reports.readReporterProfile(staff,'intake',binding.id),{name:null,department:null,source:'UNAVAILABLE'});assert.equal(calls,1);
   reporterProfile.secret=secret;
   revoke=true;await assert.rejects(reports.readReporterProfile(staff,'intake',binding.id),{status:404});
  }finally{await reports.close();}
 },{mvpNotificationsEnabled:true,manualRoundConsumption:true});
});

test('H5 V2 real PostgreSQL intake, original UUID, lifecycle rounds, public progress and department privacy',{timeout:240000},async()=>{
  assert.ok(process.env.PILOT_DATABASE_URL,'PILOT_DATABASE_URL is required; H5 integration is not a synthetic mock result');
  await withT24Fixture(async f=>{
    await f.pool.query(await readFile(sourceFile('database/migrations/064_yixiaoxiu_h5_member_service.sql'),'utf8'));
    await migrateWorkbenchFollowUpSchedules({databaseUrl:f.databaseUrl,mode:'apply'});await migrateWorkbenchFollowUpDueSignals({databaseUrl:f.databaseUrl,mode:'apply'});
    await migrateWorkbenchAuth({...{databaseUrl:f.databaseUrl},mode:'apply'});await migrateThirdPartyStaffDirectory({...{databaseUrl:f.databaseUrl},mode:'apply'});
    const a=scope(),b=scope(),c=scope();let claimCount=0,claimFail=false;const urgeFacts:H5UrgeFact[]=[];
    const store=createYxxSelfServiceStore({pool:f.pool,scopeSecret:secret,h5Enabled:true,onBindMedia:async input=>{
      claimCount++;assert.equal(input.scope.scopeHash,a.scopeHash);assert.equal(input.refs.length,1);assert.match(input.submissionId,/^[a-f0-9-]{36}$/u);
      const binding=await input.transaction.query('SELECT 1 FROM intake.web_request_binding WHERE request_ref=$1 AND intake_id=$2::uuid',[input.requestRef,input.intakeId]);assert.equal(binding.rowCount,1);
      if(claimFail)throw Object.assign(new Error('YXX_MEDIA_CLAIM_FAILED'),{code:'YXX_MEDIA_CLAIM_FAILED'});
    }});
    const baseSessions=(await f.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM conversation.session')).rows[0]?.n;
    const media=request(),accepted=await store.accept({scope:a,input:media});const ref=accepted.receipt.request_ref;
    const replay=await store.accept({scope:a,input:media});assert.equal(replay.replayed,true);assert.equal(replay.receipt.request_ref,ref);assert.equal(claimCount,1);
    await assert.rejects(store.accept({scope:a,input:{...media,intent:'CONTACT_REQUEST'}}),{code:'YXX_COMMAND_CONFLICT'});
    const raw=(await f.pool.query<{schema_version:number;safe_content:{description:null;media_refs:string[]}}>(`SELECT r.schema_version,s.safe_content FROM intake.web_command_receipt r JOIN intake.web_submission s ON s.command_receipt_id=r.id WHERE r.client_command_id=$1::uuid`,[media.client_command_id])).rows[0];
    assert.equal(raw?.schema_version,2);assert.equal(raw?.safe_content.description,null);assert.deepEqual(raw?.safe_content.media_refs,media.media_refs);
    claimFail=true;const failed=request();await assert.rejects(store.accept({scope:a,input:failed}),{code:'YXX_MEDIA_CLAIM_FAILED'});
    assert.equal((await f.pool.query('SELECT 1 FROM intake.web_command_receipt WHERE client_command_id=$1::uuid',[failed.client_command_id])).rowCount,0);claimFail=false;
    const contact=await store.accept({scope:b,input:{...request(),intent:'CONTACT_REQUEST',media_refs:[]}});
    const third=await store.accept({scope:c,input:{...request('合成跨科室隐私原文'),media_refs:[]}});
    const orchestrator=createYxxSelfServiceOrchestrator({pool:f.pool,profile:'MEMBER_SELF_SERVICE',featureFlags:flags,ruleEngine:{evaluate(){throw Error('H5_DECLARED_INTENT_MUST_NOT_CALL_RULES');}}});
    for(const receipt of [accepted.receipt,contact.receipt,third.receipt]){
      const result=await orchestrator.processOne({requestRef:receipt.request_ref});assert.equal(result.processed,true,JSON.stringify(result));const repeated=await orchestrator.processOne({requestRef:receipt.request_ref});assert.ok('replayed' in repeated);assert.equal(repeated.replayed,true);
    }
    const ticket=(await f.pool.query<{id:string;version:number;status:string}>(`SELECT t.id::text,t.version,t.status FROM pilot_ticket.ticket t JOIN intake.web_request_binding b ON b.intake_id=t.source_intake_id WHERE b.request_ref=$1`,[ref])).rows[0];assert.ok(ticket);
    assert.equal((await f.pool.query('SELECT 1 FROM pilot_ticket.ticket t JOIN intake.web_request_binding b ON b.intake_id=t.source_intake_id WHERE b.request_ref=$1',[ref])).rowCount,1);
    assert.equal((await f.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM conversation.session')).rows[0]?.n,baseSessions);
    const lifecycle=createYxxH5Lifecycle({pool:f.pool,scopeSecret:secret,enabled:true,onUrge:async fact=>{await projectYxxH5Urge(fact);urgeFacts.push(fact);}});
    const reminders=createWorkbenchReminders({pool:f.pool,query:f.runtime.query,enabled:true,webReportsEnabled:true});
    const reminderAuth={principal_id:f.principals[0]?.id,expires_epoch_ms:String(Date.now()+600000)};
    const baseline=await reminders.page({authContext:reminderAuth,parameters:new URLSearchParams()});
    const currentReminders=()=>reminders.page({authContext:reminderAuth,parameters:new URLSearchParams({after_event_id:baseline.as_of_event_id,baseline_token:baseline.baseline_token})});
    const hasCurrentUrge=async()=>(await currentReminders()).items.some(item=>item.reason==='RELATED_REPORT_URGE'&&item.canonical_item.kind==='ticket'&&item.canonical_item.id===ticket.id);
    const urge={schema_version:1,client_command_id:randomUUID(),expected_ticket_version:ticket.version};
    const urged=await lifecycle.urge({scope:a,requestRef:ref,input:urge});assert.equal(urged.purpose,'URGE');assert.equal(urgeFacts.length,1);
    assert.equal((await lifecycle.urge({scope:a,requestRef:ref,input:urge})).replayed,true);assert.equal(urgeFacts.length,1);
    const urgeEvent=(await f.pool.query<{source_type:string;source_id:string;event_type:string;aggregate_id:string;aggregate_version:string}>(`SELECT source_type,source_id,event_type,aggregate_id::text,aggregate_version::text FROM conversation.realtime_event WHERE publisher_name='YXX_H5_URGE' AND source_type='WEB_REPORT_URGE' AND source_id=$1 AND event_variant='URGED'`,[urgeFacts[0]?.urgeId])).rows[0];
    assert.deepEqual(urgeEvent,{source_type:'WEB_REPORT_URGE',source_id:urgeFacts[0]?.urgeId,event_type:'ticket.updated',aggregate_id:ticket.id,aggregate_version:String(ticket.version)});
    assert.equal((await f.pool.query("SELECT 1 FROM pilot_ticket.ticket_event WHERE event_type='ticket.report_urged' AND ticket_id=$1::uuid",[ticket.id])).rowCount,0);
    assert.deepEqual((await f.pool.query('SELECT version,status FROM pilot_ticket.ticket WHERE id=$1::uuid',[ticket.id])).rows[0],{version:ticket.version,status:ticket.status});
    await assert.rejects(lifecycle.urge({scope:a,requestRef:ref,input:{...urge,client_command_id:randomUUID()}}),{code:'YXX_URGE_RATE_LIMITED'});
    await assert.rejects(lifecycle.urge({scope:b,requestRef:ref,input:urge}),{code:'YXX_NOT_FOUND'});
    const receipt=await transactionP2016(f.pool,tx=>lifecycle.receipt(tx,a,ref,urge.client_command_id,'URGE'));assert.equal(receipt.state,'COMMITTED');
    assert.equal((await transactionP2016(f.pool,tx=>lifecycle.receipt(tx,a,ref,urge.client_command_id,'EVALUATION'))).state,'UNKNOWN');
    assert.equal((await lifecycle.activeForAuthorizedTickets([ticket.id])).get(ticket.id)?.active,true);
    const http=await t11Http(f),started=await http.start(ticket.id),actor=f.principals[0]?.id;assert.ok(actor);
    const afterFirstStart=(await lifecycle.activeForAuthorizedTickets([ticket.id])).get(ticket.id);assert.equal(afterFirstStart?.active,true);assert.equal(afterFirstStart?.count,1);
    assert.equal(await hasCurrentUrge(),true);
    await assert.rejects(lifecycle.urge({scope:a,requestRef:ref,input:{...urge,client_command_id:randomUUID(),expected_ticket_version:started.version}}),{code:'YXX_URGE_RATE_LIMITED'});
    const onAuthorize=async(tx:import('../app/server/src/platform/postgres-pool.mjs').PostgresTransaction)=>{const current=await f.runtime.query.authorizedTicket({authContext:{principal_id:actor},ticketId:ticket.id,transaction:tx});return current.ticket.assignee_id===actor;};
    const p={client_command_id:randomUUID(),expected_version:started.version,summary:'合成公开进度：正在修复打印服务。',estimated_at:null};
    const published=await lifecycle.publishPublicProgress({ticketId:ticket.id,actorPrincipalId:actor,input:p,onAuthorize});
    assert.equal(published.ticket_version,started.version+1);assert.equal((await lifecycle.publishPublicProgress({ticketId:ticket.id,actorPrincipalId:actor,input:p,onAuthorize})).replayed,true);
    await assert.rejects(lifecycle.publishPublicProgress({ticketId:ticket.id,actorPrincipalId:actor,input:{...p,summary:'different'},onAuthorize}),{code:'YXX_COMMAND_CONFLICT'});
    await assert.rejects(lifecycle.publishPublicProgress({ticketId:ticket.id,actorPrincipalId:f.outsider.id,input:{...p,client_command_id:randomUUID()},onAuthorize:async()=>true}),{code:'YXX_FORBIDDEN'});
    const current=await http.detail(ticket.id);assert.equal((await http.post(ticket.id,'complete',http.command(current))).status,200);
    assert.equal(await hasCurrentUrge(),false);
    const member={scope:a,write_flag:true,flags},detail=await transactionP2016(f.pool,tx=>lifecycle.context(tx,member,ref));
    assert.equal(detail.urge.active,false);assert.equal(detail.evaluation.can_evaluate,true);assert.equal(detail.public_progress?.summary,p.summary);assert.ok(detail.evaluation.completed_round_ref);assert.ok(detail.evaluation.ticket_version);
    const evaluation={schema_version:1,client_command_id:randomUUID(),expected_ticket_version:detail.evaluation.ticket_version,completed_round_ref:detail.evaluation.completed_round_ref,rating:5,comment:'合成评价'};
    assert.equal((await lifecycle.evaluate({scope:a,requestRef:ref,input:evaluation})).purpose,'EVALUATION');assert.equal((await lifecycle.evaluate({scope:a,requestRef:ref,input:evaluation})).replayed,true);
    await assert.rejects(lifecycle.evaluate({scope:a,requestRef:ref,input:{...evaluation,client_command_id:randomUUID()}}),{code:'YXX_EVALUATION_ALREADY_SUBMITTED'});
    const afterEvaluation=await http.detail(ticket.id);assert.equal(afterEvaluation.status,'CLOSED');assert.equal(afterEvaluation.version,detail.evaluation.ticket_version);
    const progressReceipt=await lifecycle.publicProgressReceipt({ticketId:ticket.id,actorPrincipalId:actor,clientCommandId:p.client_command_id,onAuthorize:async tx=>{await f.runtime.query.authorizedTicket({authContext:{principal_id:actor},ticketId:ticket.id,transaction:tx});return true;}});assert.equal(progressReceipt.state,'COMMITTED');
    const feedback=createYxxSelfServiceFeedback({pool:f.pool,scopeSecret:secret});
    await feedback.accept({scope:a,requestRef:ref,input:{schema_version:1,client_command_id:randomUUID(),expected_ticket_version:evaluation.expected_ticket_version,completed_round_ref:evaluation.completed_round_ref,feedback:'STILL_UNRESOLVED'}});
    assert.equal((await http.detail(ticket.id)).status,'REOPENED');const reopenedContext=await transactionP2016(f.pool,tx=>lifecycle.context(tx,member,ref));assert.equal(reopenedContext.evaluation.can_evaluate,false);assert.equal(reopenedContext.urge.active,false);assert.equal(reopenedContext.urge.count,0);
    assert.equal(await hasCurrentUrge(),false);
    const directory=createThirdPartyStaffDirectoryStore({pool:f.pool}),version='d'.repeat(64);
    const members=[['provider-a','EMP-A','合成同事甲'],['provider-b','EMP-B','合成同事乙'],['provider-c','EMP-C','合成同事丙']].map(([id,employee,name])=>({provider_user_id:id as string,employee_id:employee as string,nickname:name as string,phone:null,provider_wecom_id:null}));
    await directory.publishSnapshot({source_scope:'FORMAL',root_ref:'synthetic-root',snapshot:{snapshot_version:version,departments:[{provider_department_id:'dept-a',parent_provider_department_id:null,name:'合成科室甲',provider_gid:null,provider_gid_type:null,depth:0},{provider_department_id:'dept-b',parent_provider_department_id:null,name:'合成科室乙',provider_gid:null,provider_gid_type:null,depth:0}],members,memberships:members.map((m,index)=>({provider_user_id:m.provider_user_id,provider_department_id:index===2?'dept-b':'dept-a'})),protocol_warnings:[],counts:{departments:2,members:3,memberships:3,max_depth:0}}});
    for(const [index,s] of [a,b,c].entries()){
      const m=members[index];assert.ok(m);const existing=await directory.findMemberByProviderUserId({source_scope:'FORMAL',provider_user_id:m.provider_user_id});assert.ok(existing);
      await directory.saveResolvedProfile({source_scope:'FORMAL',reporter_identity_hash:s.scopeHash,source_namespace:'WECOM_APP_OPENID',resolution_method:'SYNTHETIC_VERIFIED_UID',member:existing,profile:{provider_user_id:m.provider_user_id,employee_id:m.employee_id,display_name:m.nickname,phone:null,sex:null,avatar_url:null}});
    }
    await f.pool.query("UPDATE directory.member_current SET account_status='ACTIVE'");
    const profile=createYxxH5Profile({pool:f.pool,scopeSecret:secret,enabled:true});
    assert.equal((await profile.resolve(a)).profile.department,'合成科室甲');assert.equal((await profile.resolve(scope())).can_view_department,false);
    const shared=await profile.department(a,{limit:1});assert.equal(shared.total,2);assert.ok(shared.next_cursor);assert.equal(shared.items.length,1);
    const second=await profile.department(a,{limit:1,cursor:shared.next_cursor});assert.equal(second.items.length,1);assert.notEqual(second.items[0]?.ticket_no,shared.items[0]?.ticket_no);
    const sharedText=JSON.stringify(shared);assert.equal(sharedText.includes('request_ref'),false);assert.equal(sharedText.includes('media_ref'),false);assert.equal(sharedText.includes('合成跨科室隐私原文'),false);assert.equal(sharedText.includes('合成同事'),false);
    await assert.rejects(profile.department(c,{cursor:shared.next_cursor}),{code:'YXX_CURSOR_INVALID'});
    const req=new IncomingMessage(new Socket());let readable=true;
    const authorization=createYxxSelfServiceAuthorization({profile:'MEMBER_SELF_SERVICE',flags,authenticate:async()=>auth(a),recheck:Object.assign(async()=>readable?auth(a):null,{localOnly:true as const})});
    const query=createYxxSelfServiceQuery({pool:f.pool,authorization,store,scopeSecret:secret,h5Lifecycle:lifecycle,h5Profile:profile});
    const own=await query.list({request:req,v2:true,search:'not present anywhere'});assert.equal(own.items.length,0);
    const v1=await query.getWebRequest({request:req,requestRef:ref});assert.equal(Object.hasOwn(v1,'h5'),false);
    const v2=await query.getWebRequest({request:req,requestRef:ref,v2:true});assert.equal(Object.hasOwn(v2,'h5'),true);
    readable=false;await assert.rejects(query.getWebRequest({request:req,requestRef:ref,v2:true}),{code:'YXX_MEMBER_AUTH_REQUIRED'});readable=true;req.destroy();
    const contactTicket=(await f.pool.query<{id:string;version:number}>(`SELECT t.id::text,t.version FROM pilot_ticket.ticket t JOIN intake.web_request_binding b ON b.intake_id=t.source_intake_id WHERE b.request_ref=$1`,[contact.receipt.request_ref])).rows[0];assert.ok(contactTicket);
    const rejectedUrge={schema_version:1,client_command_id:randomUUID(),expected_ticket_version:contactTicket.version};
    await assert.rejects(lifecycle.urge({scope:b,requestRef:contact.receipt.request_ref,input:rejectedUrge,onBeforeCommit:async()=>false}),{code:'YXX_AUTH_RECHECK_FAILED'});
    assert.equal((await f.pool.query('SELECT 1 FROM intake.web_report_urge WHERE client_command_id=$1::uuid',[rejectedUrge.client_command_id])).rowCount,0);
    assert.equal((await f.pool.query('SELECT 1 FROM intake.web_command_receipt WHERE client_command_id=$1::uuid',[rejectedUrge.client_command_id])).rowCount,0);
    assert.equal((await lifecycle.urge({scope:b,requestRef:contact.receipt.request_ref,input:rejectedUrge})).replayed,false);
    const reopened=await http.detail(ticket.id);await lifecycle.urge({scope:a,requestRef:ref,input:{...urge,client_command_id:randomUUID(),expected_ticket_version:reopened.version}});
    assert.equal((await lifecycle.activeForAuthorizedTickets([ticket.id])).get(ticket.id)?.active,true);
    await http.start(ticket.id);assert.equal(await hasCurrentUrge(),true);
    await f.pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1',[ref]);
    assert.equal((await lifecycle.activeForAuthorizedTickets([ticket.id])).get(ticket.id)?.active,false);
    assert.equal(await hasCurrentUrge(),false);
    assert.equal((await profile.department(a)).total,1);
    await assert.rejects(transactionP2016(f.pool,tx=>lifecycle.receipt(tx,a,ref,urge.client_command_id,'URGE')),{code:'YXX_NOT_FOUND'});
    await f.pool.query(`WITH stamp AS(SELECT platform.physical_epoch_ms()-1 AS epoch) UPDATE intake.web_request_binding SET retention_until=platform.local_from_epoch_ms(epoch),retention_until_epoch_ms=epoch FROM stamp WHERE request_ref=$1`,[contact.receipt.request_ref]);
    assert.equal((await profile.department(a)).total,0);
    const d=scope(),e=scope();let providerCalls=0,qualification=true,revokeDuringProvider=false;
    const createBound=async(s:YxxMemberScope,memberId:string)=>store.accept({scope:s,input:{...request(),intent:'CONTACT_REQUEST',description:'合成后台资料补齐',media_refs:[]},notificationRecipient:{namespace:'APP_OPEN_USERID',member_id:memberId,proof_ref:applicationRecipientProof(secret,s,memberId),verified_epoch_ms:String(Date.now())}});
    const boundD=await createBound(d,'open-profile-d');
    const adapter=createThirdPartyStaffDirectoryAdapter({keyProvider:()=> 'synthetic-directory-key',uidResolver:{async resolveQueryUid(input){
      assert.equal(input.source_namespace,'APP_OPEN_USERID');
      return input.source_identity_ref==='open-profile-d'||input.source_identity_ref==='open-profile-e'?{status:'RESOLVED',uid:'synthetic-provider-query-b',method:'SYNTHETIC_EXPLICIT_APP_MAPPING'}:{status:'DEFERRED',reason_code:'UNMAPPED'};
    }},fetchImpl:async(target,options)=>{
      providerCalls++;assert.equal((await f.pool.query<{n:number}>("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'")).rows[0]?.n,0,'Provider must run outside the claim/write transaction');
      if(String(target).endsWith('/getToken'))return new Response(JSON.stringify({result:'TRUE',data:{token:'synthetic-directory-token'}}));
      assert.equal(new URLSearchParams(String(options?.body)).get('uid'),'synthetic-provider-query-b');
      if(revokeDuringProvider)qualification=false;
      return new Response(JSON.stringify({result:'TRUE',data:{user_id:'provider-b',employee_id:'EMP-B',nickname:'合成同事乙',phoneno:null,sex:null,avatar:null}}));
    }});
    const directoryPort=createThirdPartyReporterDirectory({enabled:true,store:directory,provider:adapter});
    const noQualification=createYxxH5ProfileEnricher({pool:f.pool,scopeSecret:secret,directoryPort,enabled:true});
    assert.deepEqual(await noQualification.runOnce(),{claimed:0,resolved:0,deferred:0});assert.equal(providerCalls,0);
    const enricher=createYxxH5ProfileEnricher({pool:f.pool,scopeSecret:secret,directoryPort,enabled:true,verifyCurrentMember:Object.assign(async(identity:H5ProfileMemberIdentity)=>{assert.equal(identity.namespace,'APP_OPEN_USERID');assert.equal(identity.corpId,d.sourceCorpScope);assert.equal(identity.appId,d.sourceAppScope);return qualification;},{localOnly:true as const})});
    try{
      assert.deepEqual(await enricher.runOnce(),{claimed:1,resolved:1,deferred:0});assert.equal((await profile.resolve(d)).profile.name,'合成同事乙');
      const saved=(await f.pool.query<{profile_resolution_status:string;profile_snapshot:{contact:{name:string}}}>(`SELECT j.profile_resolution_status,j.profile_snapshot FROM intake.contact_journey j JOIN intake.web_request_binding b ON b.intake_id=j.origin_intake_id WHERE b.request_ref=$1`,[boundD.receipt.request_ref])).rows[0];assert.equal(saved?.profile_resolution_status,'RESOLVED');assert.equal(saved?.profile_snapshot.contact.name,'合成同事乙');
      const sourceIntake=(await f.pool.query<{id:string}>('SELECT intake_id::text AS id FROM intake.web_request_binding WHERE request_ref=$1',[boundD.receipt.request_ref])).rows[0];assert.ok(sourceIntake);
      const card=await createWeb01WorkbenchQuery({pool:f.pool,query:f.runtime.query}).authorizedItem(reminderAuth,'intake',sourceIntake.id);
      assert.equal(card.reporter_name,'合成同事乙');assert.ok(card.reporter_department,'resolved report departments must reach the canonical card');assert.equal(card.source_label,'H5报修');
      const callsAfterFirst=providerCalls;assert.deepEqual(await enricher.runOnce(),{claimed:0,resolved:0,deferred:0});assert.equal(providerCalls,callsAfterFirst);
      const boundE=await createBound(e,'open-profile-e');revokeDuringProvider=true;
      assert.deepEqual(await enricher.runOnce(),{claimed:1,resolved:0,deferred:1});
      assert.equal((await f.pool.query<{profile_resolution_status:string}>(`SELECT j.profile_resolution_status FROM intake.contact_journey j JOIN intake.web_request_binding b ON b.intake_id=j.origin_intake_id WHERE b.request_ref=$1`,[boundE.receipt.request_ref])).rows[0]?.profile_resolution_status,'NOT_REQUIRED');
    }finally{adapter.close();}
    for(const description of ['MATCH-A 合成打印故障','OTHER 合成网络故障','MATCH-B 合成打印故障'])await store.accept({scope:a,input:{...request(description),media_refs:[]}});
    const queryReq=new IncomingMessage(new Socket());
    try{
      const first=await query.list({request:queryReq,v2:true,limit:1,search:'MATCH',status:'OPEN'});assert.equal(first.items.length,1);assert.ok(first.next_cursor);assert.match(first.items[0]?.safe_summary??'',/MATCH/u);
      const next=await query.list({request:queryReq,v2:true,limit:1,search:'MATCH',status:'OPEN',cursor:first.next_cursor});assert.equal(next.items.length,1);assert.notEqual(first.items[0]?.ref,next.items[0]?.ref);assert.equal(next.next_cursor,null);
      await assert.rejects(query.list({request:queryReq,v2:true,limit:1,search:'OTHER',status:'OPEN',cursor:first.next_cursor}),{code:'YXX_CURSOR_INVALID'});
    }finally{queryReq.destroy();}
  },{ticketReopenRoundsEnabled:true,mvpNotificationsEnabled:true,manualRoundConsumption:true});
});
