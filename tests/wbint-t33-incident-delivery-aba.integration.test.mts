// T33 ABA risk: an old UNKNOWN intent cannot settle a later UNKNOWN attempt.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {t33WholeHttp} from './helpers/t33-whole-fixture.mjs';

function record(value:unknown):Record<string,unknown>{
  assert.ok(value!==null&&typeof value==='object'&&!Array.isArray(value));
  return value as Record<string,unknown>;
}
function text(value:unknown):string{
  assert.ok(typeof value==='string');
  return value;
}
function attempt(value:unknown):number{
  assert.ok(typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=2147483647);
  return value;
}

test('T33 rejects an old UNKNOWN intent after the same Incident Delivery becomes UNKNOWN again',{timeout:120000},async t=>{
  await t33WholeHttp(async({incidentId,senderCalls,get,post,deliver})=>{
    const parent='/api/incidents/'+incidentId;
    const rows=async():Promise<Record<string,unknown>[]>=>{
      const response=await get(parent+'/notifications?limit=10');
      assert.equal(response.status,200,JSON.stringify(response.body));
      assert.ok(Array.isArray(response.body.items));
      assert.equal(response.body.next_cursor,null);
      return response.body.items.map(record);
    };
    const initial=await rows();
    assert.ok(initial.length>=2);
    const selected=initial.find(row=>row.audience_type==='GROUP');
    assert.ok(selected);
    const deliveryId=text(selected.delivery_id);
    const sibling=initial.find(row=>row.delivery_id!==deliveryId);
    assert.ok(sibling);
    assert.equal(selected.status,'PENDING');
    assert.equal(selected.side_effect_state,'NOT_ATTEMPTED');
    assert.equal(senderCalls(),0);

    await deliver(deliveryId);
    assert.equal(senderCalls(),1,'the first original Worker call must actually invoke the synthetic Sender');
    const oldRows=await rows();
    const oldUnknown=oldRows.find(row=>row.delivery_id===deliveryId);
    assert.ok(oldUnknown);
    assert.equal(oldUnknown.status,'RECONCILIATION_REQUIRED');
    assert.equal(oldUnknown.side_effect_state,'UNKNOWN');
    const oldAttempt=attempt(oldUnknown.attempt_count);
    assert.ok(oldAttempt>attempt(selected.attempt_count));
    assert.deepEqual(oldRows.find(row=>row.delivery_id===sibling.delivery_id),sibling);
    const oldParent=await get(parent);
    assert.equal(oldParent.status,200);
    const oldVersion=text(oldParent.body.row_version);
    const path=parent+'/notifications/'+deliveryId;
    const capability=await get(path+'/control');
    assert.equal(capability.status,200,JSON.stringify(capability.body));
    assert.equal(capability.body.reconcile,true,'ADMIN must have the independent current reconcile permission');

    // Preserve the first UNKNOWN observation. Do not replace its parent version
    // with the later GET, reset the Delivery, or fabricate an attempt number.
    const oldIntent={
      expected_row_version:oldVersion,
      expected_status:'RECONCILIATION_REQUIRED',
      expected_side_effect_state:'UNKNOWN',
      reason_code:'OPERATOR_CONFIRMED_SENT',
      resolution:'CONFIRMED_SENT',
    };
    const requeueCommandId=randomUUID();
    const requeued=await post(path+'/reconcile',{
      ...oldIntent,client_command_id:requeueCommandId,
      reason_code:'OPERATOR_CONFIRMED_NOT_SENT',resolution:'CONFIRMED_NOT_SENT_REQUEUE',
    });
    assert.equal(requeued.status,200,JSON.stringify(requeued.body));
    assert.equal(requeued.body.status,'PENDING');
    assert.equal(requeued.body.side_effect_state,'NOT_ATTEMPTED');
    const requeuedRows=await rows();
    const pending=requeuedRows.find(row=>row.delivery_id===deliveryId);
    assert.ok(pending);
    assert.equal(pending.status,'PENDING');
    assert.equal(pending.side_effect_state,'NOT_ATTEMPTED');
    const requeuedAttempt=attempt(pending.attempt_count);
    assert.ok(requeuedAttempt>oldAttempt,'the explicit reconciliation must be a new actual attempt');
    assert.equal(senderCalls(),1,'the explicit not-sent decision itself must not send');
    assert.deepEqual(requeuedRows.find(row=>row.delivery_id===sibling.delivery_id),sibling);

    await deliver(deliveryId);
    assert.equal(senderCalls(),2,'the second original Worker call must actually invoke the synthetic Sender');
    const newRows=await rows();
    const newUnknown=newRows.find(row=>row.delivery_id===deliveryId);
    assert.ok(newUnknown);
    assert.equal(newUnknown.status,'RECONCILIATION_REQUIRED');
    assert.equal(newUnknown.side_effect_state,'UNKNOWN');
    const newAttempt=attempt(newUnknown.attempt_count);
    assert.ok(newAttempt>requeuedAttempt,'the second UNKNOWN must come from a later actual attempt');
    assert.deepEqual(newRows.find(row=>row.delivery_id===sibling.delivery_id),sibling);
    const newParent=await get(parent);
    assert.equal(newParent.status,200);
    const newVersion=text(newParent.body.row_version);
    t.diagnostic(JSON.stringify({
      observation:'T33_ABA_BEFORE_STALE_CONFIRMATION',
      old_parent_row_version:oldVersion,new_parent_row_version:newVersion,
      old_unknown_attempt_count:oldAttempt,requeued_attempt_count:requeuedAttempt,
      new_unknown_attempt_count:newAttempt,sender_calls:senderCalls(),
    }));

    // A distinct UUID prevents this safety check from being an old receipt replay.
    // Its public expectation still describes the first UNKNOWN observation.
    const staleCommandId=randomUUID();
    assert.notEqual(staleCommandId,requeueCommandId);
    const stale=await post(path+'/reconcile',{...oldIntent,client_command_id:staleCommandId});
    const afterRows=await rows();
    const after=afterRows.find(row=>row.delivery_id===deliveryId);
    assert.ok(after);
    const diagnostic=JSON.stringify({
      observation:'T33_ABA_STALE_CONFIRMATION_RESULT',
      old_parent_row_version:oldVersion,new_parent_row_version:newVersion,
      old_unknown_attempt_count:oldAttempt,new_unknown_attempt_count:newAttempt,
      stale_http_status:stale.status,
      actual_status:after.status,actual_side_effect_state:after.side_effect_state,
      actual_attempt_count:attempt(after.attempt_count),sender_calls:senderCalls(),
    });
    t.diagnostic(diagnostic);
    assert.equal(stale.status,409,'an old UNKNOWN intent must reject a later UNKNOWN attempt: '+diagnostic);
    assert.equal(after.status,'RECONCILIATION_REQUIRED');
    assert.equal(after.side_effect_state,'UNKNOWN');
    assert.equal(after.attempt_count,newAttempt);
    assert.deepEqual(afterRows.find(row=>row.delivery_id===sibling.delivery_id),sibling);
    assert.equal(senderCalls(),2,'rejecting the old intent must not send');
    const receipt=await get(parent+'/notification-commands/'+staleCommandId);
    assert.equal(receipt.status,200,JSON.stringify(receipt.body));
    assert.equal(receipt.body.state,'FAILED');
  },{externalSend:true});
});
