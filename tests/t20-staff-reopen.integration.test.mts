// OFFLINE SOURCE PREPARATION ONLY. Copy to tests/t20-staff-reopen.integration.test.mts
// after the preserved original member tracer is GREEN; no implementation pre-fix.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../app/server/src/p2-016-runtime.mjs';

test('authorized staff uses its own W reopen permission to start a new unassigned round with retained completion and team',async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();
  const options={pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const},publicOrigin:context.origin,
   listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],
   externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true};
  const staff=createP2016Runtime(options);if('disabled' in staff)throw Error('T20_STAFF_RUNTIME_DISABLED');
  try{
   const started=await staff.start();assert.ok(started.cookies);
   const current={...context,runtime:staff,cookies:started.cookies.map(c=>c.name+'='+c.value)};
   const http=await t11Http(current,2),bootstrap=await (await http.get('/api/lifecycle/bootstrap')).json() as {roles:string[];principal_id:string};
   assert.deepEqual(bootstrap.roles,['HANDLER']);assert.equal(bootstrap.principal_id,context.principals[1]?.id);
   // Source admission/Core create and public T04/T11 close establish the legitimate completed cycle.
   const ticketId=await t11NewTicket(current),active=await http.start(ticketId);
   assert.equal((await http.post(ticketId,'complete',http.command(active))).status,200);
   const closed=await http.detail(ticketId);assert.equal(closed.status,'CLOSED');assert.ok(closed.handling_cycle?.staff_completion_event_id);
   const oldRound=closed.handling_cycle;
   const command={client_command_id:randomUUID(),expected_version:closed.version,reason_code:'STAFF_REOPEN',note:'工作人员核实同一故障仍需处置'};
   const response=await http.post(ticketId,'reopen',command);assert.equal(response.status,200,await response.text());
   const fresh=await http.detail(ticketId);
   assert.equal(fresh.assignee_id,null,'the independent W reopen clears current handler rather than carrying completed-round ownership');
   assert.equal(fresh.resolver_team_id,closed.resolver_team_id);assert.equal(fresh.ticket_no,closed.ticket_no);
   assert.equal(fresh.status,'REOPENED');assert.equal(fresh.version,closed.version+1);
   assert.ok(fresh.handling_cycle);assert.equal(fresh.handling_cycle.cycle_no,oldRound.cycle_no+1);
   assert.equal(fresh.handling_cycle.first_responsibility_event_id,null);assert.equal(fresh.handling_cycle.staff_completion_event_id,null);
   const prior=await context.pool.query<{completion:string;handler:string;team:string}>(`SELECT staff_completion_event_id::text AS completion,first_responsibility_principal_id::text AS handler,first_responsibility_team_id AS team FROM pilot_ticket.ticket_handling_cycle WHERE id=$1::uuid`,[oldRound.id]);
   assert.deepEqual(prior.rows[0],{completion:oldRound.staff_completion_event_id,handler:context.principals[1]?.id,team:closed.resolver_team_id});
   const feedbackCount=await context.pool.query<{n:number}>("SELECT count(*)::int AS n FROM intake.web_command_receipt WHERE command_kind='FEEDBACK'");
   assert.equal(feedbackCount.rows[0]?.n,0,'W staff permission does not fabricate Reporter feedback or acquire member write scope');
  }finally{await staff.stop();assert.equal(staff.server.listening,false);}
 });
});
