// SOURCE ONLY / NOT_RUN. Register after the production H5/PC first slice terminates.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {t20Object} from './helpers/t20-feedback-fixture.mjs';

test('independent HANDLER reads its original STAFF_REOPEN purpose without a resend or raw recovery prerequisite',async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();
  const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,
   listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,
   ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketReopenRoundsEnabled:true,workbenchDraftRecoveryEnabled:false});
  if('disabled' in runtime)throw Error('T20_ACK_RUNTIME_DISABLED');
  try{
   const started=await runtime.start();assert.ok(started.cookies);const current={...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)};
   const handler=await t11Http(current,2),administrator=await t11Http(current,0),bootstrap=await (await handler.get('/api/lifecycle/bootstrap')).json() as {roles:string[]};assert.deepEqual(bootstrap.roles,['HANDLER']);
   const ticketId=await t11NewTicket(current),active=await handler.start(ticketId);assert.equal((await handler.post(ticketId,'complete',handler.command(active))).status,200);
   const completed=await handler.detail(ticketId),id=randomUUID(),path='/api/tickets/'+ticketId+'/reopen/commands/'+id;
   const unknown=await handler.get(path);assert.equal(unknown.status,200,await unknown.clone().text()); // First real public assertion, not an inferred implementation.
   assert.deepEqual(await unknown.json(),{client_command_id:id,ticket_id:ticketId,state:'UNKNOWN'});
   const command={client_command_id:id,expected_version:completed.version,reason_code:'STAFF_REOPEN',note:'本人核实同一故障需要下一轮处理'};
   const committed=await handler.post(ticketId,'reopen',command);assert.equal(committed.status,200);const result=t20Object(await committed.json());
   const receipt=await handler.get(path);assert.equal(receipt.status,200);assert.deepEqual(await receipt.json(),{client_command_id:id,ticket_id:ticketId,state:'COMMITTED',result:{...result,replayed:true}});
   const other=await administrator.get(path);assert.equal(other.status,200);assert.deepEqual(await other.json(),{client_command_id:id,ticket_id:ticketId,state:'UNKNOWN'});
   assert.equal((await handler.get(path+'?purpose=add-note')).status,400);
   const fresh=await handler.detail(ticketId);assert.equal(fresh.version,completed.version+1);assert.equal(fresh.assignee_id,null);assert.equal(fresh.handling_cycle?.cycle_no,(completed.handling_cycle?.cycle_no??0)+1);
   const basis=await context.pool.query<{n:number}>("SELECT count(*)::int AS n FROM pilot_ticket.ticket_cycle_reopen WHERE ticket_id=$1::uuid",[ticketId]);assert.equal(basis.rows[0]?.n,1);
   await context.pool.query('UPDATE pilot_ticket.pilot_principal SET is_active=false WHERE id=$1::uuid',[context.principals[1]?.id]);assert.equal((await handler.get(path)).status,403,'receipt still requires current read authority');
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 });
});
