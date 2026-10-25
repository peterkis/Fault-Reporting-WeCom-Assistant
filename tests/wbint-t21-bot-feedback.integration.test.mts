import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http} from './helpers/t11-completion-fixture.mjs';
import {seedPersistedIntake} from './helpers/p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../app/server/src/p1-005-pilot-ticket-core.mjs';
import {createP2016ReporterAccess} from '../app/server/src/p2-016-reporter-access.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {textHashP2016,transactionP2016} from '../app/server/src/p2-016-domain-contracts.mjs';
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import type {SelfServiceProfileOptions} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {createYxxDelegatedIdentityMapping} from '../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {origin,secret,config,oauthOptions,browser,login,post} from './helpers/yxx-ss-009-http-fixture.mjs';
import type {BotReporterFeedbackInput} from '../contracts/bot_reporter_feedback_contracts.js';

function object(value:unknown):Record<string,unknown>{
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}

// One original tracer: real native HTTP + owned PG + unchanged T04/T11 Core.
// Only external identity conversion is synthetic. A normalized Bot source is
// seeded through the existing isolated fixture; no SDK, real callback or send.
test('original Bot reporter explicitly reopens its genuine staff-completed Ticket through its independent publicRef',async()=>{
  await withT11Fixture(async context=>{
    const source=await seedPersistedIntake({pool:context.pool,text:'合成门诊打印机无法打印处方。',chatType:'single',requestType:'INCIDENT',status:'RECEIVED'});
    const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:source.intakeId,occurredAt:source.receivedAt,traceId:'t21-bot-source'});
    assert.ok(created.ticket,'the authentic normalized Bot Intake must create a Ticket');
    const ticketId=created.ticket.id;
    const access=createP2016ReporterAccess({pool:context.pool,enabled:true,hmacSecret:secret});
    const original=await transactionP2016(context.pool,transaction=>access.ensurePublicRefInTransaction({transaction,ticketId,
      reporterBindingHash:textHashP2016(JSON.stringify(['WECOM_AIBOT','bot-test','user-test']))}));
    // The established source-bound ref Port is used; a Grant or fabricated delivery
    // is unnecessary for MEMBER_REQUIRED and is never treated as write authority.
    assert.match(original.public_ref,/^[A-Za-z0-9_-]{32}$/u);
    const staff=await t11Http(context),active=await staff.start(ticketId);
    const completedResponse=await staff.post(ticketId,'complete',staff.command(active));
    assert.equal(completedResponse.status,200,await completedResponse.text());
    const completed=await staff.detail(ticketId);
    assert.equal(completed.status,'CLOSED');assert.ok(completed.handling_cycle?.staff_completion_event_id);
    const completedCycle=completed.handling_cycle;
    assert.ok(completedCycle);
    // Single App at every stage: the staff App is stopped before the member App.
    await context.runtime.stop();assert.equal(context.runtime.server.listening,false);
    const botConfig={...config,reporterUserIds:['user-test','other-user-test']};
    const identityMapping=await createYxxDelegatedIdentityMapping({config:botConfig,
      accessTokenProvider:async()=> 'synthetic-t21-token',
      fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[
        {userid:'user-test',open_userid:'open-a'},{userid:'other-user-test',open_userid:'open-b'}]}))});
    const featureFlags={YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true};
    // A typed, frozen candidate option may be passed before product consumption.
    // Its absence is observed through HTTP, never bypassed with an internal mock.
    const options:SelfServiceProfileOptions & {botReporterFeedbackEnabled:boolean}={profile:'MEMBER_SELF_SERVICE',pool:context.pool,
      publicOrigin:origin,reporterMemberEntry:botConfig,identityMapping,reporterHmacSecret:secret,
      oauth:createWeComWebOAuth(oauthOptions),yxxSelfService:{featureFlags,pollMilliseconds:100},botReporterFeedbackEnabled:true};
    const app=createYxxProfile(options);
    try{
      await app.start();await app.selfService.pump?.stop();const member=browser(app.server);await login(member);
      const path='/api/reporter/tickets/'+original.public_ref;
      const detail=await member.request(path);assert.equal(detail.status,200,detail.text);
      const current=object(detail.json());assert.equal(current.public_ref,original.public_ref);assert.equal(current.ticket_no,completed.ticket_no);
      assert.equal(current.external_status,'已关闭');assert.equal(current.version,completed.version);
      assert.ok(current.feedback_context,'the actual Bot owner detail must advertise completed-round feedback');
      const eligibility=object(current.feedback_context);
      assert.deepEqual(Object.keys(eligibility).sort(),['can_feedback','completed_round_no','completed_round_ref','rejection','schema_version','ticket_version']);
      assert.equal(eligibility.can_feedback,true);assert.equal(eligibility.completed_round_no,completedCycle.cycle_no);
      assert.equal(eligibility.ticket_version,completed.version);assert.equal(typeof eligibility.completed_round_ref,'string');
      assert.match(String(eligibility.completed_round_ref),/^[A-Za-z0-9_-]{32}$/u);
      const bootstrap=await member.request('/api/reporter/feedback/bootstrap');assert.equal(bootstrap.status,200,bootstrap.text);
      const bootstrapValue=object(bootstrap.json());
      assert.deepEqual(Object.keys(bootstrapValue).sort(),['csrf_token','schema_version','write_enabled']);
      assert.equal(bootstrapValue.schema_version,1);assert.equal(bootstrapValue.write_enabled,true);
      assert.match(String(bootstrapValue.csrf_token),/^[a-f0-9]{64}$/u);
      const command:BotReporterFeedbackInput={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',
        completed_round_ref:String(eligibility.completed_round_ref),expected_ticket_version:completed.version};
      const response=await member.request(path+'/feedback',{...post(command,bootstrapValue.csrf_token),
        headers:{...post(command,bootstrapValue.csrf_token).headers,'if-match':'"'+completed.version+'"'}});
      assert.equal(response.status,200,response.text);
      const result=object(response.json());
      assert.deepEqual(Object.keys(result).sort(),['completed_round_ref','ok','public_ref','reopened_round_no','replayed','ticket']);
      assert.equal(result.ok,true);assert.equal(result.replayed,false);assert.equal(result.public_ref,original.public_ref);
      assert.equal(result.completed_round_ref,command.completed_round_ref);assert.equal(result.reopened_round_no,completedCycle.cycle_no+1);
      assert.deepEqual(result.ticket,{ticket_no:completed.ticket_no,status:'REOPENED',version:completed.version+1});
      assert.doesNotMatch(JSON.stringify(result),/INTERNAL_T11_CANARY|user-test|bot-test|request_ref|source_intake_id|completed_by/u);
      const fresh=await member.request(path);assert.equal(fresh.status,200,fresh.text);
      const freshValue=object(fresh.json());assert.equal(freshValue.public_ref,original.public_ref);assert.equal(freshValue.ticket_no,completed.ticket_no);
      assert.equal(freshValue.version,completed.version+1);assert.equal(object(freshValue.feedback_context).can_feedback,false);
      const receipt=await member.request(path+'/feedback/commands/'+command.client_command_id);assert.equal(receipt.status,200,receipt.text);
      assert.deepEqual(receipt.json(),{client_command_id:command.client_command_id,public_ref:original.public_ref,state:'COMMITTED',result:{...result,replayed:true}});
    }finally{await app.stop();assert.equal(app.server.listening,false);}

    // Observe the result through the independent authorized staff HTTP seam.
    // No SQL mutation or private assertion manufactures the expected new round.
    const verification=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
      listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??''],externalSendEnabled:false,
      ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true});
    if('disabled' in verification)throw Error('T21_STAFF_VERIFICATION_DISABLED');
    try{
      const started=await verification.start();assert.ok(started.cookies);
      const resumedStaff=await t11Http({...context,runtime:verification,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)});
      const reopened=await resumedStaff.detail(ticketId);
      assert.equal(reopened.ticket_no,completed.ticket_no);assert.equal(reopened.status,'REOPENED');assert.equal(reopened.version,completed.version+1);
      assert.equal(reopened.assignee_id,null);assert.equal(reopened.resolver_team_id,completed.resolver_team_id);
      assert.ok(reopened.handling_cycle);assert.equal(reopened.handling_cycle.cycle_no,completedCycle.cycle_no+1);
      assert.equal(reopened.handling_cycle.first_responsibility_event_id,null);assert.equal(reopened.handling_cycle.staff_completion_event_id,null);
    }finally{await verification.stop();assert.equal(verification.server.listening,false);}
  });
});
