import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withT11Fixture,t11Http,t11NewTicket} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import {t20Object} from './helpers/t20-feedback-fixture.mjs';

test('original HANDLER STAFF_REOPEN ACK remains read-only with new write/raw capabilities off and still denies lost Ticket READ',async()=>{
 await withT11Fixture(async context=>{
  await context.runtime.stop();const options={pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,workbenchDraftRecoveryEnabled:false};
  const writer=createP2016Runtime({...options,ticketReopenRoundsEnabled:true});if('disabled' in writer)throw Error('T20_ACK_WRITER_DISABLED');
  let reader:ReturnType<typeof createP2016Runtime>|undefined;
  try{
   const started=await writer.start();assert.ok(started.cookies);const current={...context,runtime:writer,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)};
   const handler=await t11Http(current,2),ticketId=await t11NewTicket(current),active=await handler.start(ticketId);assert.equal((await handler.post(ticketId,'complete',handler.command(active))).status,200);
   const completed=await handler.detail(ticketId),id=randomUUID(),path='/api/tickets/'+ticketId+'/reopen/commands/'+id;
   const posted=await handler.post(ticketId,'reopen',{client_command_id:id,expected_version:completed.version,reason_code:'STAFF_REOPEN',note:'本人确认需要重新承接'});assert.equal(posted.status,200);const result=t20Object(await posted.json());await writer.stop();assert.equal(writer.server.listening,false);
   reader=createP2016Runtime({...options,ticketReopenRoundsEnabled:false});if('disabled' in reader)throw Error('T20_ACK_READER_DISABLED');
   const readStarted=await reader.start();assert.ok(readStarted.cookies);const readContext={...context,runtime:reader,cookies:readStarted.cookies.map(cookie=>cookie.name+'='+cookie.value)};
   const currentHandler=await t11Http(readContext,2),administrator=await t11Http(readContext,0),bootstrap=t20Object(await (await currentHandler.get('/api/lifecycle/bootstrap')).json());assert.equal(bootstrap.ticket_reopen_rounds_enabled,false);assert.equal(bootstrap.draft_recovery_enabled,false);
   const receipt=await currentHandler.get(path);assert.equal(receipt.status,200);assert.deepEqual(await receipt.json(),{client_command_id:id,ticket_id:ticketId,state:'COMMITTED',result:{...result,replayed:true}});
   const before=await administrator.detail(ticketId);assert.equal(before.version,completed.version+1);assert.equal(before.assignee_id,null);
   assert.equal((await currentHandler.get(path+'?purpose=internal-notes')).status,400);
   const principal=context.principals[1];assert.ok(principal);await context.pool.query('DELETE FROM pilot_ticket.pilot_team_member WHERE principal_id=$1::uuid AND team_id=$2',[principal.id,before.resolver_team_id]);
   const denied=await currentHandler.get(path);assert.equal(denied.status,404);assert.deepEqual(await denied.json(),{error:{code:'P2_016_NOT_FOUND',retryable:false}});
   const after=await administrator.detail(ticketId);assert.equal(after.version,before.version);assert.equal(after.assignee_id,null);assert.equal(after.handling_cycle?.id,before.handling_cycle?.id);assert.equal(after.resolver_team_id,before.resolver_team_id);
  }finally{if(reader&&!('disabled' in reader)){await reader.stop();assert.equal(reader.server.listening,false);}await writer.stop();assert.equal(writer.server.listening,false);}
 });
});
