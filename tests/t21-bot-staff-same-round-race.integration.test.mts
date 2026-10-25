// SOURCE_ONLY / NOT_REGISTERED / NOT_COMPILED / NOT_RUN.
// Intended repository location: tests/t21-bot-staff-same-round-race.integration.test.mts.
// Single existing createP2016Runtime cohost and original owned PG. Public W/M
// commands, details, event history and dedicated receipts are the assertions.
// No direct SQL, historical App pin, second App, SDK or sending arrangement.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {withT21DraftFixture,t21Config,t21Mapping,t21OAuthOptions,t21FeedbackCommand,t21Send,t21Object} from './helpers/t21-bot-feedback-current-scope-fixture.mjs';
import {browser,login,origin,secret} from './helpers/yxx-ss-009-http-fixture.mjs';

test('T21 STAFF W reopen and current Bot member M feedback compete on one completed round in one cohost; purposes remain isolated',
  {timeout:240_000,concurrency:false},async()=>{
  await withT21DraftFixture(async f=>{
    await f.closeMember();assert.equal(f.context.runtime.server.listening,false);
    const full=createP2016Runtime({pool:f.context.pool,
      flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true},
      publicOrigin:f.context.origin,reporterOrigin:origin,listenPort:Number(new URL(f.context.origin).port),
      principalIds:[f.context.principals[0]?.id??''],externalSendEnabled:false,gatewayEnabled:false,senderEnabled:false,
      ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,
      reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:t21Config,identityMapping:await t21Mapping(),
      reporterHmacSecret:secret,wecomWebOAuth:t21OAuthOptions(),botReporterFeedbackEnabled:true,
      yxxSelfService:{reporterFeedbackEnabled:false,
        featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}}});
    if('disabled' in full)throw Error('T21_STAFF_BOT_RACE_COHOST_DISABLED');
    try{
      const started=await full.start();assert.ok(started.cookies);
      // W HTTP uses the real new staff cookies and its context.origin Host/
      // Origin. M browser uses the same server, HTTPS reporter Host/Origin and
      // an independent current same-App OAuth login. There is one listener.
      const staff=await t11Http({...f.context,runtime:full,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)});
      const member=browser(full.server);await login(member,'a');
      const completed=await staff.detail(f.ticketId);
      assert.equal(completed.status,'CLOSED');assert.equal(completed.version,f.completed.version);
      assert.deepEqual(completed.handling_cycle,f.completed.handling_cycle);assert.ok(completed.handling_cycle);
      const bot=await t21FeedbackCommand(member,f.path),staffCommand={client_command_id:randomUUID(),
        expected_version:completed.version,reason_code:'STAFF_REOPEN',note:'工作人员核实同一故障仍需处置，与原报修人明确反馈竞争'};
      assert.notEqual(staffCommand.client_command_id,bot.command.client_command_id);
      const events=async()=>{
        const response=await staff.get('/api/tickets/'+f.ticketId+'/events?limit=200');
        assert.equal(response.status,200);const page=t21Object(await response.json());
        assert.equal(page.next_cursor,null,'the full target history must fit this bounded public page');
        assert.ok(Array.isArray(page.items));return page.items.map(t21Object);
      };
      const originalEvents=await events();
      assert.ok(originalEvents.some(event=>event.event_id===completed.handling_cycle?.staff_completion_event_id));

      const [botResponse,staffResponse]=await Promise.all([
        t21Send(member,f.path,bot.command,bot.csrf),staff.post(f.ticketId,'reopen',staffCommand),
      ]);
      const staffText=await staffResponse.text();
      assert.deepEqual([botResponse.status,staffResponse.status].sort(),[200,409],botResponse.text+'\n'+staffText);
      const botWon=botResponse.status===200,winner=botWon?t21Object(botResponse.json()):t21Object(JSON.parse(staffText));
      assert.equal(winner.ok,true);assert.equal(winner.replayed,false);
      if(botWon){
        assert.equal(winner.public_ref,f.publicRef);
        assert.equal(winner.reopened_round_no,completed.handling_cycle.cycle_no+1);
        assert.deepEqual(t21Object(winner.ticket),{ticket_no:completed.ticket_no,status:'REOPENED',version:completed.version+1});
      }else{
        assert.equal(winner.ticket_id,f.ticketId);assert.equal(winner.ticket_version,completed.version+1);
        assert.equal(t21Object(winner.handling_cycle).cycle_no,completed.handling_cycle.cycle_no+1);
      }

      const fresh=await staff.detail(f.ticketId);assert.ok(fresh.handling_cycle);
      assert.equal(fresh.id,f.ticketId);assert.equal(fresh.ticket_no,completed.ticket_no);
      assert.equal(fresh.intake_id,completed.intake_id);assert.equal(fresh.resolver_team_id,completed.resolver_team_id);
      assert.equal(fresh.status,'REOPENED');assert.equal(fresh.version,completed.version+1);assert.equal(fresh.assignee_id,null);
      assert.notEqual(fresh.handling_cycle.id,completed.handling_cycle.id);
      assert.equal(fresh.handling_cycle.cycle_no,completed.handling_cycle.cycle_no+1);
      assert.equal(fresh.handling_cycle.first_responsibility_event_id,null);
      assert.equal(fresh.handling_cycle.staff_completion_event_id,null);
      assert.equal(fresh.reopen_follow_up?.origin,botWon?'BOT_REPORTER':'STAFF');
      assert.equal(fresh.reopen_follow_up?.awaiting_acceptance,true);

      const currentEvents=await events(),priorIds=new Set(originalEvents.map(event=>String(event.event_id)));
      for(const prior of originalEvents){
        assert.equal(typeof prior.event_id,'string');
        assert.deepEqual(currentEvents.find(event=>event.event_id===prior.event_id),prior,'original public completion/handling history remains unchanged');
      }
      const added=currentEvents.filter(event=>!priorIds.has(String(event.event_id)));
      assert.equal(added.length,1,'exactly one new shared reopen event is visible');
      assert.equal(added[0]?.event_type,'ticket.reopened');assert.equal(added[0]?.old_status,'CLOSED');
      assert.equal(added[0]?.new_status,'REOPENED');assert.equal(added[0]?.aggregate_version,completed.version+1);

      // UUIDs locate only their dedicated actor/scope/purpose. Current READ must
      // not borrow the other command's successful or failed result.
      const botOther=await member.request(f.path+'/feedback/commands/'+staffCommand.client_command_id);
      assert.equal(botOther.status,200,botOther.text);
      assert.deepEqual(botOther.json(),{client_command_id:staffCommand.client_command_id,public_ref:f.publicRef,state:'UNKNOWN'});
      const staffOther=await staff.get('/api/tickets/'+f.ticketId+'/reopen/commands/'+bot.command.client_command_id);
      assert.equal(staffOther.status,200);
      assert.deepEqual(await staffOther.json(),{client_command_id:bot.command.client_command_id,ticket_id:f.ticketId,state:'UNKNOWN'});
      if(botWon){
        const own=await member.request(f.path+'/feedback/commands/'+bot.command.client_command_id);assert.equal(own.status,200,own.text);
        assert.deepEqual(own.json(),{client_command_id:bot.command.client_command_id,public_ref:f.publicRef,state:'COMMITTED',result:{...winner,replayed:true}});
      }else{
        const own=await staff.get('/api/tickets/'+f.ticketId+'/reopen/commands/'+staffCommand.client_command_id);assert.equal(own.status,200);
        assert.deepEqual(await own.json(),{client_command_id:staffCommand.client_command_id,ticket_id:f.ticketId,state:'COMMITTED',result:{...winner,replayed:true}});
        const botOwn=await member.request(f.path+'/feedback/commands/'+bot.command.client_command_id);assert.equal(botOwn.status,200,botOwn.text);
        assert.deepEqual(botOwn.json(),{client_command_id:bot.command.client_command_id,public_ref:f.publicRef,state:'UNKNOWN'});
      }
      const settled=await staff.detail(f.ticketId);assert.equal(settled.version,fresh.version);
      assert.deepEqual(settled.handling_cycle,fresh.handling_cycle);assert.equal(settled.assignee_id,null);
    }finally{await full.stop();assert.equal(full.server.listening,false);}
  });
});
