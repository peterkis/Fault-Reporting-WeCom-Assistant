// T33 public-progress control: current pause blocks requeue without changing legacy GROUP policy.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {t33WholeHttp,t33Record,t33Text} from './helpers/t33-whole-fixture.mjs';

type ProgressBinding={
  delivery_id:string;publication_id:string;subscription_id:string;
  template_code:string;audience_type:string;target_type:string;sender_system_code:string;
  source_chat_type:string;leg_type:string;same_reporter_binding:boolean;retained:boolean;
};
function attempt(value:unknown):number{
  assert.ok(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647);
  return value;
}

test('T33 paused public-progress subscription rejects requeue and cancels its sibling while legacy GROUP remains admitted',{timeout:120000},async t=>{
  await t33WholeHttp(async({pool,incidentId,get,post,deliver,senderCalls,getLifecycleRows})=>{
    const parent='/api/incidents/'+incidentId;
    const incident=async()=>{
      const response=await get(parent);
      assert.equal(response.status,200,JSON.stringify(response.body));
      return response.body;
    };
    const publications=async()=>{
      const response=await get(parent+'/public-progress?limit=30');
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.ok(Array.isArray(response.body.items));
      assert.equal(response.body.next_cursor,null);
      return response.body.items.map(t33Record);
    };
    const progressRows=async(publicationId:string)=>{
      const response=await get(parent+'/public-progress/'+publicationId+'/deliveries?limit=100');
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.ok(Array.isArray(response.body.items));
      assert.equal(response.body.next_cursor,null);
      return response.body.items.map(t33Record);
    };
    const selectedRow=async(publicationId:string,deliveryId:string)=>{
      const matches=(await progressRows(publicationId)).filter(value=>value.id===deliveryId);
      assert.equal(matches.length,1);
      const row=matches[0];assert.ok(row);
      return row;
    };
    const originalLifecycle=await getLifecycleRows();
    const legacyGroup=originalLifecycle.find(row=>row.audience_type==='GROUP'&&row.template_code==='INCIDENT_CONFIRMED_GROUP');
    assert.ok(legacyGroup);
    const groupId=t33Text(legacyGroup.delivery_id);
    assert.equal(legacyGroup.status,'PENDING');
    assert.equal(legacyGroup.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(attempt(legacyGroup.attempt_count),0);
    assert.equal((await publications()).length,0);
    assert.equal(senderCalls(),0);

    // T31 starts with an independent empty draft. Its HTTP contract requires
    // explicit preview confirmation; there is no invented preview HTTP endpoint.
    const emptyVersion=t33Text((await incident()).row_version);
    const draft='';
    assert.equal((await post(parent+'/publish-update',{
      client_command_id:randomUUID(),expected_row_version:emptyVersion,
      reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:draft,preview_confirmed:true,
    })).status,400);
    const summary='Synthetic public progress: the service connection is being checked.';
    assert.equal((await post(parent+'/publish-update',{
      client_command_id:randomUUID(),expected_row_version:emptyVersion,
      reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary,preview_confirmed:false,
    })).status,400);
    assert.equal((await publications()).length,0);
    assert.deepEqual(await getLifecycleRows(),originalLifecycle);
    assert.equal(senderCalls(),0);

    const publish=async(summary:string)=>{
      const body={
        client_command_id:randomUUID(),expected_row_version:t33Text((await incident()).row_version),
        reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary,preview_confirmed:true,
      };
      const result=await post(parent+'/publish-update',body);
      assert.equal(result.status,200,JSON.stringify(result.body));
      const publicationId=t33Text(result.body.result_event_id);
      const page=await publications();
      const published=page.find(value=>value.id===publicationId);assert.ok(published);
      assert.equal(published.summary,summary);
      const rows=await progressRows(publicationId);
      assert.equal(rows.length,2,'the real four-reporter fixture has two retained valid DIRECT subscriptions');
      for(const row of rows){
        assert.equal(row.route,'BOT_DIRECT');assert.equal(row.audience,'REPORTER_DIRECT');
        assert.equal(row.status,'PENDING');assert.equal(row.side_effect_state,'NOT_ATTEMPTED');
        assert.equal(attempt(row.attempt_count),0);
      }
      return {publicationId,rows};
    };
    const first=await publish(summary);
    const second=await publish('Synthetic public progress: the next update is still being checked.');
    assert.equal((await publications()).length,2);
    assert.deepEqual(await getLifecycleRows(),originalLifecycle,'public progress creates no new GROUP lifecycle route');
    const bindings=(await pool.query<ProgressBinding>(
      "SELECT d.id::text AS delivery_id,b.incident_event_id::text AS publication_id,b.reporter_subscription_id::text AS subscription_id,b.template_code,b.audience_type,d.target_type,m.sender_system_code,i.source_chat_type,l.leg_type,(s.direct_channel_leg_id=b.direct_channel_leg_id AND s.reporter_identity_hash=b.audience_binding_hash AND l.reporter_identity_hash=s.reporter_identity_hash AND j.reporter_identity_hash=s.reporter_identity_hash) AS same_reporter_binding,(j.retention_until_epoch_ms>platform.physical_epoch_ms() AND i.retention_until_epoch_ms>platform.physical_epoch_ms()) AS retained FROM communication.incident_notification_binding b JOIN communication.message m ON m.id=b.communication_message_id JOIN communication.outbox o ON o.message_id=m.id JOIN communication.delivery d ON d.outbox_id=o.id JOIN incident.reporter_subscription s ON s.id=b.reporter_subscription_id AND s.incident_id=b.incident_id JOIN intake.channel_leg l ON l.id=b.direct_channel_leg_id JOIN intake.contact_journey j ON j.id=l.journey_id JOIN intake.service_intake i ON i.id=l.source_intake_id WHERE b.incident_id=$1::uuid AND b.incident_event_id=ANY($2::uuid[]) ORDER BY b.incident_event_id,b.reporter_subscription_id,d.id",
      [incidentId,[first.publicationId,second.publicationId]],
    )).rows;
    assert.equal(bindings.length,4);
    for(const binding of bindings){
      assert.equal(binding.template_code,'INCIDENT_PUBLIC_PROGRESS_DIRECT');
      assert.equal(binding.audience_type,'REPORTER_DIRECT');assert.equal(binding.target_type,'PERSON');
      assert.equal(binding.sender_system_code,'INCIDENT_PUBLIC_PROGRESS');
      assert.equal(binding.source_chat_type,'single');
      assert.ok(['DIRECT_GUIDED','DIRECT_ORGANIC'].includes(binding.leg_type));
      assert.equal(binding.same_reporter_binding,true);assert.equal(binding.retained,true);
    }
    const selected=bindings.find(value=>value.publication_id===first.publicationId);assert.ok(selected);
    const sibling=bindings.find(value=>value.publication_id===second.publicationId&&value.subscription_id===selected.subscription_id);assert.ok(sibling);
    assert.notEqual(selected.delivery_id,sibling.delivery_id);
    const siblingBefore=await selectedRow(second.publicationId,sibling.delivery_id);
    const otherFirst=first.rows.filter(row=>row.id!==selected.delivery_id);
    const otherSecond=second.rows.filter(row=>row.id!==sibling.delivery_id);

    await deliver(selected.delivery_id);
    const unknown=await selectedRow(first.publicationId,selected.delivery_id);
    assert.equal(unknown.status,'RECONCILIATION_REQUIRED');assert.equal(unknown.side_effect_state,'UNKNOWN');
    assert.equal(attempt(unknown.attempt_count),1);assert.equal(senderCalls(),1);
    assert.deepEqual(await selectedRow(second.publicationId,sibling.delivery_id),siblingBefore);

    const subscriptions=await get(parent+'/subscriptions?limit=100');
    assert.equal(subscriptions.status,200,JSON.stringify(subscriptions.body));
    assert.ok(Array.isArray(subscriptions.body.items));assert.equal(subscriptions.body.next_cursor,null);
    const currentSubscriptions=subscriptions.body.items.map(t33Record);
    assert.equal(currentSubscriptions.length,4);
    assert.ok(currentSubscriptions.some(row=>row.id===selected.subscription_id));
    // Pause every real subscription so the later legacy GROUP observation also
    // covers its original reporters; all writes use the official pause command.
    for(const subscription of currentSubscriptions){
      assert.equal(subscription.status,'ACTIVE');
      const paused=await post(parent+'/subscriptions/'+t33Text(subscription.id)+'/pause',{
        client_command_id:randomUUID(),expected_row_version:t33Text((await incident()).row_version),
        expected_subscription_version:t33Text(subscription.row_version),reason_code:'SUBSCRIPTION_REQUEST',
      });
      assert.equal(paused.status,200,JSON.stringify(paused.body));
    }
    const pausedPage=await get(parent+'/subscriptions?limit=100');
    assert.equal(pausedPage.status,200);assert.ok(Array.isArray(pausedPage.body.items));
    const pausedRows=pausedPage.body.items.map(t33Record);
    assert.equal(pausedRows.length,4);assert.ok(pausedRows.every(row=>row.status==='PAUSED'));
    const controlPath=parent+'/notifications/'+selected.delivery_id;
    const capability=await get(controlPath+'/control');
    assert.equal(capability.status,200,JSON.stringify(capability.body));
    assert.equal(capability.body.purpose,'INCIDENT_PUBLIC_PROGRESS');
    assert.equal(capability.body.disabled,false);assert.equal(capability.body.reconcile,true);
    const commandId=randomUUID();
    const requeue=await post(controlPath+'/reconcile',{
      client_command_id:commandId,expected_row_version:t33Text((await incident()).row_version),
      expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',
      expected_delivery_attempt_count:attempt(unknown.attempt_count),
      reason_code:'OPERATOR_CONFIRMED_NOT_SENT',resolution:'CONFIRMED_NOT_SENT_REQUEUE',
    });
    const afterRejected=await selectedRow(first.publicationId,selected.delivery_id);
    t.diagnostic(JSON.stringify({
      observation:'T33_PUBLIC_PROGRESS_PAUSED_REQUEUE',
      paused_subscriptions:pausedRows.length,requeue_http_status:requeue.status,
      current_status:afterRejected.status,current_side_effect_state:afterRejected.side_effect_state,
      current_attempt_count:attempt(afterRejected.attempt_count),sender_calls:senderCalls(),
    }));
    assert.equal(requeue.status,403,JSON.stringify(requeue.body));
    assert.deepEqual(afterRejected,unknown);assert.equal(senderCalls(),1);
    assert.deepEqual(await selectedRow(second.publicationId,sibling.delivery_id),siblingBefore);
    const receipt=await get(parent+'/notification-commands/'+commandId);
    assert.equal(receipt.status,200,JSON.stringify(receipt.body));assert.equal(receipt.body.state,'FAILED');

    await deliver(sibling.delivery_id);
    const cancelled=await selectedRow(second.publicationId,sibling.delivery_id);
    assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(senderCalls(),1,'the same subscription sibling must be cancelled before Sender');
    assert.deepEqual(await selectedRow(first.publicationId,selected.delivery_id),unknown);
    assert.deepEqual((await progressRows(first.publicationId)).filter(row=>row.id!==selected.delivery_id),otherFirst);
    assert.deepEqual((await progressRows(second.publicationId)).filter(row=>row.id!==sibling.delivery_id),otherSecond);

    const groupCapability=await get(parent+'/notifications/'+groupId+'/control');
    assert.equal(groupCapability.status,200,JSON.stringify(groupCapability.body));
    assert.equal(groupCapability.body.purpose,'INCIDENT_LIFECYCLE');assert.equal(groupCapability.body.retry,true);
    const groupRetry=await post(parent+'/notifications/'+groupId+'/retry',{
      client_command_id:randomUUID(),expected_row_version:t33Text((await incident()).row_version),
      expected_status:'PENDING',expected_side_effect_state:'NOT_ATTEMPTED',
      expected_delivery_attempt_count:0,reason_code:'OPERATOR_RETRY',
    });
    assert.equal(groupRetry.status,200,JSON.stringify(groupRetry.body));
    assert.equal(groupRetry.body.status,'PENDING');assert.equal(attempt(groupRetry.body.attempt_count),0);
    assert.equal(senderCalls(),1);
    await deliver(groupId);
    const lifecycleAfter=await getLifecycleRows();
    const oldPurpose=lifecycleAfter.find(row=>row.delivery_id===groupId);assert.ok(oldPurpose);
    assert.equal(oldPurpose.status,'RECONCILIATION_REQUIRED');assert.equal(oldPurpose.side_effect_state,'UNKNOWN');
    assert.equal(attempt(oldPurpose.attempt_count),1);
    assert.equal(senderCalls(),2,'legacy GROUP follows its original admission despite paused subscriptions');
    assert.deepEqual(lifecycleAfter.filter(row=>row.delivery_id!==groupId),originalLifecycle.filter(row=>row.delivery_id!==groupId));
    assert.deepEqual(await selectedRow(first.publicationId,selected.delivery_id),unknown);
    assert.deepEqual(await selectedRow(second.publicationId,sibling.delivery_id),cancelled);
  },{externalSend:true,publicProgress:true});
});
