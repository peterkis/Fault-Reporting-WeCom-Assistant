// OFFLINE SOURCE PREPARATION ONLY. A new public slice; the original member and STAFF tracers stay byte-identical.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';

for(const action of ['take-and-start','accept-for-later'] as const){
 test('an authorized HANDLER explicitly '+action+' on the legitimate unassigned reopened round',async()=>{
  await withT11Fixture(async context=>{
   await context.runtime.stop();
   const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:context.origin,
    listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],
    externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true});
   if('disabled' in runtime)throw Error('T20_NEXT_ACCEPT_RUNTIME_DISABLED');
   try{
    const started=await runtime.start();assert.ok(started.cookies);
    const current={...context,runtime,cookies:started.cookies.map(c=>c.name+'='+c.value)};
    const http=await t11Http(current,2),bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {roles:string[];principal_id:string};
    assert.deepEqual(bootstrap.roles,['HANDLER']);assert.equal(bootstrap.principal_id,context.principals[1]?.id);
    const ticketId=await t11NewTicket(current),active=await http.start(ticketId);
    assert.equal((await http.post(ticketId,'complete',http.command(active))).status,200);
    const completed=await http.detail(ticketId),previous=completed.handling_cycle;assert.ok(previous?.staff_completion_event_id);
    const reopen={client_command_id:randomUUID(),expected_version:completed.version,reason_code:'STAFF_REOPEN',note:'工作人员核实需再承接'};
    assert.equal((await http.post(ticketId,'reopen',reopen)).status,200);
    const fresh=await http.detail(ticketId);assert.equal(fresh.assignee_id,null);assert.equal(fresh.status,'REOPENED');assert.ok(fresh.handling_cycle);
    const command={client_command_id:randomUUID(),expected_version:fresh.version,reason_code:'T20_NEXT_ACCEPT',resolver_team_id:fresh.resolver_team_id};
    const response=await http.post(ticketId,action,command);
    assert.equal(response.status,200,await response.text()); // First actual public RED: a new round must be explicitly accepted.
    const accepted=await http.detail(ticketId);assert.ok(accepted.handling_cycle?.first_responsibility_event_id);
    assert.equal(accepted.ticket_no,completed.ticket_no);assert.equal(accepted.resolver_team_id,completed.resolver_team_id);
    assert.equal(accepted.assignee_id,context.principals[1]?.id);assert.equal(accepted.status,action==='take-and-start'?'IN_PROGRESS':'ACCEPTED');
    assert.equal(accepted.version,fresh.version+(action==='take-and-start'?2:1));
    assert.equal(accepted.handling_cycle.id,fresh.handling_cycle.id);assert.equal(accepted.handling_cycle.cycle_no,previous.cycle_no+1);
    assert.equal(accepted.handling_cycle.staff_completion_event_id,null);
    const replay=await http.post(ticketId,action,command);assert.equal(replay.status,200,await replay.text());
    assert.deepEqual(await http.detail(ticketId),accepted,'same UUID cannot append a second first-responsibility basis');
    const basis=await context.pool.query<{principal:string;team:string;event:string;kind:string}>(`SELECT c.first_responsibility_principal_id::text AS principal,c.first_responsibility_team_id AS team,c.first_responsibility_event_id::text AS event,e.event_type AS kind FROM pilot_ticket.ticket_handling_cycle c JOIN pilot_ticket.ticket_event e ON e.event_id=c.first_responsibility_event_id WHERE c.id=$1::uuid`,[accepted.handling_cycle.id]);
    assert.deepEqual(basis.rows[0],{principal:context.principals[1]?.id,team:completed.resolver_team_id,event:accepted.handling_cycle.first_responsibility_event_id,kind:'ticket.accepted'});
    const running=action==='take-and-start'?accepted:await http.start(ticketId);
    assert.equal((await http.post(ticketId,'complete',http.command(running))).status,200);
    const closedAgain=await http.detail(ticketId);assert.equal(closedAgain.status,'CLOSED');assert.equal(closedAgain.handling_cycle?.id,fresh.handling_cycle.id);
    assert.ok(closedAgain.handling_cycle?.staff_completion_event_id);assert.notEqual(closedAgain.handling_cycle?.staff_completion_event_id,previous.staff_completion_event_id);
    const history=await context.pool.query<{completion:string;handler:string;team:string}>(`SELECT staff_completion_event_id::text AS completion,first_responsibility_principal_id::text AS handler,first_responsibility_team_id AS team FROM pilot_ticket.ticket_handling_cycle WHERE id=$1::uuid`,[previous.id]);
    assert.deepEqual(history.rows[0],{completion:previous.staff_completion_event_id,handler:context.principals[1]?.id,team:completed.resolver_team_id});
   }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  });
 });
}
