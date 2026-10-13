import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t31Http,record,text} from './helpers/t31-public-progress-fixture.mjs';
import {createP2012Runtime} from '../src/p2-012-workbench-assembly.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';

test('T31 the production runtime worker cancels queued personal progress after subscription pause before calling Sender',async()=>{
  await t31Http({purpose:'t31pause'},async({pool,f,origin,confirm,get,post})=>{
    const incident=await confirm(),path='/api/incidents/'+incident;
    const published=await post(path+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'合成公开进展：核查连接中。',preview_confirmed:true});assert.equal(published.status,200);
    const queued=await pool.query<{delivery_id:string;subscription_id:string;row_version:string}>(`SELECT d.id::text AS delivery_id,s.id::text AS subscription_id,s.row_version::text FROM communication.incident_notification_binding b JOIN incident.reporter_subscription s ON s.id=b.reporter_subscription_id JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_event_id=$1::uuid ORDER BY d.id`,[published.body.result_event_id]);assert.equal(queued.rows.length,2);const first=queued.rows[0];assert.ok(first);
    const paused=await post(path+'/subscriptions/'+first.subscription_id+'/pause',{client_command_id:randomUUID(),expected_row_version:'2',expected_subscription_version:first.row_version,reason_code:'SUBSCRIPTION_REQUEST'});assert.equal(paused.status,200);
    let calls=0;const deliveryRuntime=createP2012Runtime({pool,principalIds:[text(record(f.admin).id)],publicOrigin:origin,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentPublicProgressEnabled:true,externalSendEnabled:false,senderAdapter:{send:async()=>{calls++;return {outcome:'ACKNOWLEDGED',provider_message_id:'synthetic-t31',error_code:null,retryable:false};}}});let primaryError:unknown;
    try{
      // This runtime's server/timers are not started; the actual composed Worker
      // is driven once through its public Port with an isolated external Sender.
      await deliveryRuntime.communicationWorker.deliver({deliveryId:first.delivery_id});
      assert.equal(calls,0,'paused after commitment must be rejected before the actual Sender attempt');
      const row=(await pool.query<{status:string;side_effect_state:string}>('SELECT status,side_effect_state FROM communication.delivery WHERE id=$1::uuid',[first.delivery_id])).rows[0];assert.deepEqual(row,{status:'CANCELLED',side_effect_state:'NOT_ATTEMPTED'});
      const page=await get(path+'/public-progress?limit=10');assert.equal(page.status,200);assert.ok(Array.isArray(page.body.items));assert.equal(page.body.items.length,1);
    }catch(error){primaryError=error;}
    await closeBrowserTestResources([()=>deliveryRuntime.stop()],primaryError);
  });
});
