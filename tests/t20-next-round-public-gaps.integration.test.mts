import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {withT20FeedbackFixture,t20Object} from './helpers/t20-feedback-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';

for(const feature of ['explicit-first-accept','previous-handler-hint'] as const){
 test('a genuine independent staff new round preserves '+feature,async()=>{
  await withT11Fixture(async context=>{
   await context.runtime.stop();const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
    listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,
    ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true});
   if('disabled' in runtime)throw Error('T20_GAPS_RUNTIME_DISABLED');
   try{
    const started=await runtime.start();assert.ok(started.cookies);const current={...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)};
    const handler=await t11Http(current,2),administrator=await t11Http(current,0),bootstrap=t20Object(await (await handler.get('/api/lifecycle/bootstrap')).json());assert.deepEqual(bootstrap.roles,['HANDLER']);
    const ticketId=await t11NewTicket(current),active=await handler.start(ticketId);assert.equal((await handler.post(ticketId,'complete',handler.command(active))).status,200);
    const completed=await handler.detail(ticketId);assert.equal((await handler.post(ticketId,'reopen',{client_command_id:randomUUID(),expected_version:completed.version,reason_code:'STAFF_REOPEN',note:'工作人员核实需重新承接'})).status,200);
    const before=await handler.detail(ticketId);assert.equal(before.assignee_id,null);assert.ok(before.handling_cycle);assert.equal(before.handling_cycle.first_responsibility_event_id,null);
    if(feature==='explicit-first-accept'){
     const response=await administrator.post(ticketId,'start',{client_command_id:randomUUID(),expected_version:before.version,reason_code:'T20_IMPLICIT_START'});
     assert.equal(response.status,409,'legacy direct start cannot skip the genuine new round first acceptance');
     const after=await handler.detail(ticketId);assert.equal(after.version,before.version);assert.equal(after.status,'REOPENED');assert.equal(after.assignee_id,null);assert.equal(after.handling_cycle?.first_responsibility_event_id,null);
    }else{
     const response=await handler.get('/api/tickets/'+ticketId);assert.equal(response.status,200);
     assert.deepEqual(t20Object(await response.json()).reopen_follow_up,{origin:'STAFF',is_previous_handler:true,awaiting_acceptance:true},'only the still-authorized prior handler receives its internal follow-up fact');
     await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[context.principals[1]?.id]);const inactive=await handler.get('/api/tickets/'+ticketId);assert.equal(inactive.status,401);assert.deepEqual(await inactive.json(),{error:{code:'WORKBENCH_UNAUTHENTICATED',retryable:false}});
     const team=t20Object(await (await administrator.get('/api/tickets/'+ticketId)).json());assert.deepEqual(team.reopen_follow_up,{origin:'STAFF',is_previous_handler:false,awaiting_acceptance:true});assert.equal(team.assignee_id,null);assert.equal(team.resolver_team_id,completed.resolver_team_id);assert.equal(team.version,before.version);
    }
   }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  });
 });
}

test('real own-Reporter feedback produces a current-authorized prior-handler internal hint without exposing it to M',async()=>{
 await withT20FeedbackFixture(async f=>{
  const response=await f.send();assert.equal(response.status,200);const member=t20Object((await f.member.request(f.path)).json());assert.equal(Object.hasOwn(member,'reopen_follow_up'),false);
  await f.app.stop();const runtime=createP2016Runtime({pool:f.context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:f.context.origin,listenPort:Number(new URL(f.context.origin).port),principalIds:[f.context.principals[0]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true});
  if('disabled' in runtime)throw Error('T20_WEB_HINT_RUNTIME_DISABLED');
  try{const started=await runtime.start();assert.ok(started.cookies);const http=await t11Http({...f.context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)});
   const detail=await http.get('/api/tickets/'+f.ticketId);assert.equal(detail.status,200);assert.deepEqual(t20Object(await detail.json()).reopen_follow_up,{origin:'WEB_REPORTER',is_previous_handler:true,awaiting_acceptance:true});
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 });
});
