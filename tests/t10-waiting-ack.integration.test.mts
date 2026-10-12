import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withT10Fixture} from './helpers/t10-waiting-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';

test('original waiting ACK is a minimal current Ticket READ independent of write and raw recovery capabilities',async()=>{
  await withT10Fixture(async context=>{
    const handler=await t11Http(context,2,{closeConnections:true}),target=context.tickets[0];assert.ok(target);
    const current=await handler.start(target.ticket.id),command={client_command_id:randomUUID(),expected_version:current.version,reason_code:'WAITING_REPORTER',note:'INTERNAL_T10_ACK_CANARY：原等待正文仅在内部。',external_visible:false};
    const posted=await handler.post(target.ticket.id,'request-information',command);assert.equal(posted.status,200);
    const result=await posted.json() as {ticket_version:number;ticket_event_id:string};
    const path='/api/tickets/'+target.ticket.id,ack=path+'/request-information/commands/'+command.client_command_id;
    const counts=async()=>(await context.pool.query('SELECT (SELECT count(*)::integer FROM pilot_ticket.ticket_command_receipt) AS receipts,(SELECT count(*)::integer FROM pilot_ticket.ticket_event) AS events,(SELECT count(*)::integer FROM communication.delivery) AS deliveries')).rows;
    const before=await counts(),response=await handler.get(ack);assert.equal(response.status,200,'the current original actor must reach the dedicated safe ACK');
    const expected={state:'COMMITTED',ticket_id:target.ticket.id,ticket_version:result.ticket_version,ticket_event_id:result.ticket_event_id};assert.deepEqual(await response.json(),expected);
    assert.deepEqual(await (await handler.get(path+'/wait-vendor/commands/'+command.client_command_id)).json(),{state:'UNKNOWN'},'a different action purpose cannot borrow this receipt');
    const other=await t11Http(context,0,{closeConnections:true});assert.deepEqual(await (await other.get(ack)).json(),{state:'UNKNOWN'},'another readable actor cannot inspect the original operation');
    console.log('T10_ACK_STAGE '+JSON.stringify({stage:'ORIGINAL_ACK_AND_PURPOSE_ACTOR_CHECKS',pass:true}));
    await context.runtime.stop();
    const runtime=createP2016Runtime({pool:context.pool,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},publicOrigin:context.origin,listenPort:Number(new URL(context.origin).port),principalIds:[context.principals[0]?.id??'',context.outsider.id,context.principals[1]?.id??''],externalSendEnabled:false,ticketSelfHandlingEnabled:true,ticketWaitingActionsEnabled:false,workbenchInternalNotesEnabled:false,workbenchDraftRecoveryEnabled:false});
    try{
      const started=await runtime.start();assert.ok(started.cookies);
      console.log('T10_ACK_STAGE '+JSON.stringify({stage:'CLOSED_HOST_STARTED',listening:runtime.server.listening,port:Number(new URL(context.origin).port)}));
      const read=await t11Http({...context,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value)},2,{closeConnections:true});
      console.log('T10_ACK_STAGE '+JSON.stringify({stage:'CLOSED_AUTH_BOOTSTRAP_READ',pass:true}));
      const bootstrap=await (await read.get('/api/lifecycle/bootstrap')).json() as {ticket_waiting_actions_enabled:boolean;ticket_waiting_action_draft_recovery_enabled:boolean};assert.equal(bootstrap.ticket_waiting_actions_enabled,false);assert.equal(bootstrap.ticket_waiting_action_draft_recovery_enabled,false);
      const recovered=await read.get(ack);assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),expected);assert.deepEqual(await counts(),before);
      assert.ok(!JSON.stringify(expected).includes('INTERNAL_T10_ACK_CANARY'));
    }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
  });
});
