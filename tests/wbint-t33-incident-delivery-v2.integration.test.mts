// T33 v2 public Cookie HTTP: explicit attempt fencing and immutable v1/v2 ACKs.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {IncidentDeliveryReconcileCommandV2} from '../contracts/workbench_incident_delivery_control_v2_contracts.js';
import {t33WholeHttp,t33Record,t33Text} from './helpers/t33-whole-fixture.mjs';

function attempt(value:unknown):number{
  assert.ok(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647);
  return value;
}

test('T33 v2 confirms the current UNKNOWN attempt and preserves original v1 and v2 ACKs',{timeout:120000},async t=>{
  await t33WholeHttp(async({incidentId,senderCalls,get,post,deliver,getLifecycleRows})=>{
    const parent='/api/incidents/'+incidentId;
    const initial=await getLifecycleRows();
    assert.ok(initial.length>=2);
    const selected=initial.find(row=>row.audience_type==='GROUP');
    assert.ok(selected);
    const deliveryId=t33Text(selected.delivery_id);
    const sibling=initial.find(row=>row.delivery_id!==deliveryId);
    assert.ok(sibling);
    const path=parent+'/notifications/'+deliveryId;
    assert.equal(selected.status,'PENDING');
    assert.equal(selected.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(attempt(selected.attempt_count),0);
    assert.equal(senderCalls(),0);
    const row=async():Promise<Record<string,unknown>>=>{
      const rows=await getLifecycleRows();
      const selected=rows.find(candidate=>candidate.delivery_id===deliveryId);
      assert.ok(selected);
      assert.deepEqual(rows.find(candidate=>candidate.delivery_id===sibling.delivery_id),sibling);
      return selected;
    };
    const parentVersion=async():Promise<string>=>{
      const response=await get(parent);
      assert.equal(response.status,200,JSON.stringify(response.body));
      return t33Text(response.body.row_version);
    };

    await deliver(deliveryId);
    const firstUnknown=await row();
    assert.equal(firstUnknown.status,'RECONCILIATION_REQUIRED');
    assert.equal(firstUnknown.side_effect_state,'UNKNOWN');
    assert.equal(attempt(firstUnknown.attempt_count),1);
    assert.equal(senderCalls(),1);
    const firstVersion=await parentVersion();
    // This is the unchanged v1 body: no explicit delivery attempt property.
    const v1={
      client_command_id:randomUUID(),expected_row_version:firstVersion,
      expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',
      reason_code:'OPERATOR_CONFIRMED_NOT_SENT',resolution:'CONFIRMED_NOT_SENT_REQUEUE',
    };
    const requeued=await post(path+'/reconcile',v1);
    assert.equal(requeued.status,200,JSON.stringify(requeued.body));
    const v1Ack={
      ok:true,incident_id:incidentId,delivery_id:deliveryId,client_command_id:v1.client_command_id,
      status:'PENDING',side_effect_state:'NOT_ATTEMPTED',attempt_count:2,replayed:false,
    };
    assert.deepEqual(requeued.body,v1Ack);
    const pending=await row();
    assert.equal(pending.status,'PENDING');
    assert.equal(pending.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(attempt(pending.attempt_count),2);
    assert.equal(senderCalls(),1,'the not-sent decision itself does not send');

    await deliver(deliveryId);
    const thirdUnknown=await row();
    assert.equal(thirdUnknown.status,'RECONCILIATION_REQUIRED');
    assert.equal(thirdUnknown.side_effect_state,'UNKNOWN');
    assert.equal(attempt(thirdUnknown.attempt_count),3);
    assert.equal(senderCalls(),2);
    const thirdVersion=await parentVersion();
    const control=await get(path+'/control');
    assert.equal(control.status,200,JSON.stringify(control.body));
    assert.deepEqual(Object.keys(control.body).sort(),[
      'incident_id','delivery_id','purpose','retry','reconcile','receipt_read','disabled','attempt_count',
    ].sort());
    assert.equal(control.body.incident_id,incidentId);
    assert.equal(control.body.delivery_id,deliveryId);
    assert.equal(control.body.purpose,'INCIDENT_LIFECYCLE');
    assert.equal(control.body.disabled,false);
    assert.equal(control.body.reconcile,true);
    assert.equal(attempt(control.body.attempt_count),3);
    const v1AtUnknown=await get(parent+'/notification-commands/'+v1.client_command_id);
    assert.equal(v1AtUnknown.status,200,JSON.stringify(v1AtUnknown.body));
    assert.deepEqual(v1AtUnknown.body,{
      state:'COMMITTED',incident_id:incidentId,client_command_id:v1.client_command_id,result:v1Ack,
    });

    // Reject the older explicit attempt while status/side are still the same
    // UNKNOWN pair, using the current Incident version to isolate attempt fencing.
    const staleV2={
      client_command_id:randomUUID(),expected_row_version:thirdVersion,
      expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',
      expected_delivery_attempt_count:1,reason_code:'OPERATOR_CONFIRMED_SENT',resolution:'CONFIRMED_SENT',
    } satisfies IncidentDeliveryReconcileCommandV2;
    const stale=await post(path+'/reconcile',staleV2);
    t.diagnostic(JSON.stringify({
      observation:'T33_V2_OLD_EXPLICIT_ATTEMPT_AT_UNKNOWN3',
      first_parent_row_version:firstVersion,current_parent_row_version:thirdVersion,
      first_unknown_attempt_count:attempt(firstUnknown.attempt_count),
      current_unknown_attempt_count:attempt(thirdUnknown.attempt_count),
      expected_delivery_attempt_count:staleV2.expected_delivery_attempt_count,
      stale_http_status:stale.status,sender_calls:senderCalls(),
    }));
    assert.equal(stale.status,409,JSON.stringify(stale.body));
    assert.deepEqual(await row(),thirdUnknown);
    assert.equal(senderCalls(),2);

    const v2={
      client_command_id:randomUUID(),expected_row_version:await parentVersion(),
      expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',
      expected_delivery_attempt_count:attempt(control.body.attempt_count),
      reason_code:'OPERATOR_CONFIRMED_SENT',resolution:'CONFIRMED_SENT',
    } satisfies IncidentDeliveryReconcileCommandV2;
    assert.notEqual(v2.client_command_id,v1.client_command_id);
    assert.notEqual(v2.client_command_id,staleV2.client_command_id);
    const confirmed=await post(path+'/reconcile',v2);
    assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
    const v2Ack={
      ok:true,incident_id:incidentId,delivery_id:deliveryId,client_command_id:v2.client_command_id,
      status:'SENT',side_effect_state:'ACKNOWLEDGED',attempt_count:4,replayed:false,
    };
    assert.deepEqual(confirmed.body,v2Ack);
    const sent=await row();
    assert.equal(sent.status,'SENT');
    assert.equal(sent.side_effect_state,'ACKNOWLEDGED');
    assert.equal(attempt(sent.attempt_count),4);
    assert.equal(senderCalls(),2,'confirming SENT must not invoke the Sender');

    const replay=await post(path+'/reconcile',v2);
    assert.equal(replay.status,200,JSON.stringify(replay.body));
    assert.deepEqual(replay.body,{...v2Ack,replayed:true});
    assert.deepEqual(await row(),sent);
    assert.equal(senderCalls(),2);
    const altered=await post(path+'/reconcile',{...v2,expected_delivery_attempt_count:1});
    assert.equal(altered.status,409,JSON.stringify(altered.body));
    assert.deepEqual(await row(),sent);
    assert.equal(senderCalls(),2);

    const oldReceipt=await get(parent+'/notification-commands/'+v1.client_command_id);
    assert.equal(oldReceipt.status,200,JSON.stringify(oldReceipt.body));
    assert.deepEqual(oldReceipt.body,{
      state:'COMMITTED',incident_id:incidentId,client_command_id:v1.client_command_id,result:v1Ack,
    });
    assert.equal(t33Record(oldReceipt.body.result).replayed,false);
    const newReceipt=await get(parent+'/notification-commands/'+v2.client_command_id);
    assert.equal(newReceipt.status,200,JSON.stringify(newReceipt.body));
    assert.deepEqual(newReceipt.body,{
      state:'COMMITTED',incident_id:incidentId,client_command_id:v2.client_command_id,result:v2Ack,
    });
    assert.equal(t33Record(newReceipt.body.result).replayed,false);
    const oldAttemptAfterSent=await post(path+'/reconcile',{
      ...v2,client_command_id:randomUUID(),expected_delivery_attempt_count:1,
    });
    assert.equal(oldAttemptAfterSent.status,409,JSON.stringify(oldAttemptAfterSent.body));
    assert.deepEqual(await row(),sent);
    assert.equal(senderCalls(),2);
  },{externalSend:true});
});
