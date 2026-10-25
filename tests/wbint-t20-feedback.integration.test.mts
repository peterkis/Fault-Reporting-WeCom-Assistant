import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import {createWeComWebOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {origin,secret,flags,config,oauthOptions,mapping,browser,login,input,post} from './helpers/yxx-ss-009-http-fixture.mjs';

function object(value:unknown):Record<string,unknown>{
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}

// Original public RED: product routes/eligibility are deliberately not pre-fixed.
// Native member authentication and its external mapping are synthetic adapters;
// all source admission, binding, Core, T04 and T11 operations use the real runtime/PG.
test('original Web reporter explicitly reopens its genuinely completed same Ticket into one unassigned new round',async()=>{
  await withT11Fixture(async context=>{
    await context.runtime.stop();
    const memberOptions={profile:'MEMBER_SELF_SERVICE' as const,pool:context.pool,publicOrigin:origin,
      reporterMemberEntry:config,identityMapping:await mapping(),reporterHmacSecret:secret,
      yxxSelfService:{featureFlags:flags,pollMilliseconds:100,reporterFeedbackEnabled:true}};
    const admission=createYxxProfile({...memberOptions,oauth:createWeComWebOAuth(oauthOptions)});
    let requestRef:string,ticketId:string;
    try{
      await admission.start();await admission.selfService.pump?.stop();
      const member=browser(admission.server);await login(member);
      const bootstrap=object((await member.request('/api/yixiaoxiu/bootstrap')).json());
      assert.equal(bootstrap.can_submit,true);
      const accepted=await member.request('/api/yixiaoxiu/requests',post(input('处方提交不了'),bootstrap.csrf_token));
      assert.equal(accepted.status,202,accepted.text);
      const receipt=object(object(accepted.json()).receipt);assert.equal(typeof receipt.request_ref,'string');
      requestRef=receipt.request_ref as string;assert.match(requestRef,/^[A-Za-z0-9_-]{32}$/u);
      assert.ok(admission.selfService.orchestrator);
      await admission.selfService.orchestrator.processPending({batchSize:20});
      const admitted=await member.request('/api/yixiaoxiu/requests/'+requestRef);assert.equal(admitted.status,200,admitted.text);
      assert.ok(object(admitted.json()).ticket,'real public Web admission must create the prerequisite Ticket');
      // Translate the authentic source to an internal staff locator, never fabricate a closed Ticket.
      const located=await context.pool.query<{id:string}>(`SELECT t.id::text FROM intake.web_request_binding b
        JOIN intake.service_intake i ON i.id=b.intake_id JOIN pilot_ticket.ticket t ON t.id=i.pilot_ticket_id
        WHERE b.request_ref=$1`,[requestRef]);
      assert.equal(located.rowCount,1);assert.ok(located.rows[0]);ticketId=located.rows[0].id;
    }finally{await admission.stop();assert.equal(admission.server.listening,false);}

    // Only one App/listener is active: member admission -> staff completion -> member feedback.
    const staff=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},
      publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),
      principalIds:[context.principals[0]?.id??''],externalSendEnabled:false,
      ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true});
    if('disabled' in staff)throw Error('T20_STAFF_RUNTIME_DISABLED');
    let completedVersion:number,completedRound:number,ticketNumber:string;
    try{
      const started=await staff.start();assert.ok(started.cookies);
      const http=await t11Http({...context,runtime:staff,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)});
      const active=await http.start(ticketId),completion=http.command(active);
      const response=await http.post(ticketId,'complete',completion);assert.equal(response.status,200);
      const closed=await http.detail(ticketId);assert.equal(closed.status,'CLOSED');assert.ok(closed.handling_cycle);
      completedVersion=closed.version;completedRound=closed.handling_cycle.cycle_no;ticketNumber=closed.ticket_no;
    }finally{await staff.stop();assert.equal(staff.server.listening,false);}

    const feedbackApp=createYxxProfile({...memberOptions,identityMapping:await mapping(),oauth:createWeComWebOAuth(oauthOptions)});
    try{
      await feedbackApp.start();await feedbackApp.selfService.pump?.stop();
      const member=browser(feedbackApp.server);await login(member);
      const bootstrap=object((await member.request('/api/yixiaoxiu/bootstrap')).json());
      const path='/api/yixiaoxiu/requests/'+requestRef;
      const detail=await member.request(path);assert.equal(detail.status,200,detail.text);
      const safeDetail=object(detail.json());
      assert.ok(safeDetail.feedback_context,'real owner GET must advertise lawful completed-round feedback context');
      const eligibility=object(safeDetail.feedback_context);
      assert.equal(eligibility.can_feedback,true,'original member gets lawful completed-round feedback eligibility');
      assert.equal(eligibility.completed_round_no,completedRound);assert.equal(eligibility.ticket_version,completedVersion);
      assert.equal(typeof eligibility.completed_round_ref,'string');assert.match(eligibility.completed_round_ref as string,/^[A-Za-z0-9_-]{32}$/u);
      const command={schema_version:1,client_command_id:randomUUID(),feedback:'STILL_UNRESOLVED',
        completed_round_ref:eligibility.completed_round_ref,expected_ticket_version:completedVersion};
      const response=await member.request(path+'/feedback',{...post(command,bootstrap.csrf_token),
        headers:{...post(command,bootstrap.csrf_token).headers,'if-match':'"'+completedVersion+'"'}});
      assert.equal(response.status,200,response.text);
      const committed=object(response.json()),ticket=object(committed.ticket);
      assert.equal(committed.replayed,false);assert.equal(committed.request_ref,requestRef);
      assert.equal(committed.reopened_round_no,completedRound+1);
      assert.equal(ticket.ticket_no,ticketNumber);assert.equal(ticket.status,'REOPENED');assert.equal(ticket.version,completedVersion+1);
      assert.equal(JSON.stringify(committed).includes('INTERNAL_T11_CANARY'),false);
      const fresh=await member.request(path);assert.equal(fresh.status,200,fresh.text);
      assert.equal(object(object(fresh.json()).ticket).ticket_no,ticketNumber);
      assert.equal(object(object(fresh.json()).ticket).status,'REOPENED');
      assert.equal(object(object(fresh.json()).feedback_context).can_feedback,false);
      const receipt=await member.request(path+'/feedback/commands/'+command.client_command_id);assert.equal(receipt.status,200,receipt.text);
      assert.equal(object(receipt.json()).state,'COMMITTED');
      const facts=await context.pool.query<{assignee_id:string|null;resolver_team_id:string;cycle_no:number;first_responsibility_event_id:string|null;staff_completion_event_id:string|null}>(`SELECT t.assignee_id::text,t.resolver_team_id,c.cycle_no,c.first_responsibility_event_id::text,c.staff_completion_event_id::text
        FROM pilot_ticket.ticket t JOIN pilot_ticket.ticket_handling_cycle c ON c.id=t.current_handling_cycle_id AND c.ticket_id=t.id WHERE t.id=$1::uuid`,[ticketId]);
      assert.equal(facts.rowCount,1);assert.deepEqual(facts.rows[0],{assignee_id:null,resolver_team_id:'PILOT_IT',cycle_no:completedRound+1,first_responsibility_event_id:null,staff_completion_event_id:null});
    }finally{await feedbackApp.stop();assert.equal(feedbackApp.server.listening,false);}
  });
});
