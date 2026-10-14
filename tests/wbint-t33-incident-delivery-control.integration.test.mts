// Frozen T33 first: public Cookie HTTP + original Incident binding + real synthetic UNKNOWN.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t33IncidentHttp,t33Record,t33Text} from './helpers/t33-incident-delivery-control-fixture.mjs';

test('T33 ADMIN explicitly confirms an Incident UNKNOWN once without sending or changing another route', {timeout:120000},async()=>{
  await t33IncidentHttp(async({incidentId,senderCalls,get,post,deliver})=>{
    const parent='/api/incidents/'+incidentId;
    const incident=await get(parent);assert.equal(incident.status,200);const version=t33Text(incident.body.row_version);
    const before=await get(parent+'/notifications?limit=10');assert.equal(before.status,200);assert.ok(Array.isArray(before.body.items));
    const rows=before.body.items.map(t33Record);assert.ok(rows.length>=2);assert.equal(before.body.next_cursor,null);
    const selected=rows.find(row=>row.audience_type==='GROUP');assert.ok(selected);const deliveryId=t33Text(selected.delivery_id);
    const sibling=rows.find(row=>row.delivery_id!==deliveryId);assert.ok(sibling);
    assert.equal(selected.status,'PENDING');assert.equal(selected.side_effect_state,'NOT_ATTEMPTED');assert.equal(senderCalls(),0);
    await deliver(deliveryId);assert.equal(senderCalls(),1);
    const unknown=await get(parent+'/notifications?limit=10');assert.equal(unknown.status,200);assert.ok(Array.isArray(unknown.body.items));
    const unknownRow=unknown.body.items.map(t33Record).find(row=>row.delivery_id===deliveryId);assert.ok(unknownRow);
    assert.equal(unknownRow.status,'RECONCILIATION_REQUIRED');assert.equal(unknownRow.side_effect_state,'UNKNOWN');assert.equal(unknownRow.attempt_count,1);
    const command={client_command_id:randomUUID(),expected_row_version:version,expected_status:'RECONCILIATION_REQUIRED',expected_side_effect_state:'UNKNOWN',reason_code:'OPERATOR_CONFIRMED_SENT',resolution:'CONFIRMED_SENT'};
    const applied=await post(parent+'/notifications/'+deliveryId+'/reconcile',command);
    // Future missing handler404 versus this frozen200 is business RED; earlier setup is NOT_REACHED.
    assert.equal(applied.status,200,JSON.stringify(applied.body));
    assert.deepEqual(applied.body,{ok:true,incident_id:incidentId,delivery_id:deliveryId,client_command_id:command.client_command_id,status:'SENT',side_effect_state:'ACKNOWLEDGED',attempt_count:2,replayed:false});
    assert.equal(senderCalls(),1);
    const after=await get(parent+'/notifications?limit=10');assert.equal(after.status,200);assert.ok(Array.isArray(after.body.items));
    const afterRows=after.body.items.map(t33Record);const sent=afterRows.find(row=>row.delivery_id===deliveryId);assert.ok(sent);assert.equal(sent.status,'SENT');assert.equal(sent.side_effect_state,'ACKNOWLEDGED');assert.equal(sent.attempt_count,2);
    assert.deepEqual(afterRows.find(row=>row.delivery_id===sibling.delivery_id),sibling);
    const replay=await post(parent+'/notifications/'+deliveryId+'/reconcile',command);assert.equal(replay.status,200);assert.deepEqual(replay.body,{...applied.body,replayed:true});
    const receipt=await get(parent+'/notification-commands/'+command.client_command_id);assert.equal(receipt.status,200);assert.equal(receipt.body.state,'COMMITTED');assert.deepEqual(receipt.body.result,applied.body);
    assert.equal((await post(parent+'/notifications/'+deliveryId+'/reconcile',{...command,resolution:'CANCEL'})).status,409);
    const wrongParent=await post('/api/incidents/'+randomUUID()+'/notifications/'+deliveryId+'/reconcile',{...command,client_command_id:randomUUID()});assert.equal(wrongParent.status,404);
    assert.equal((await get(parent)).body.row_version,version);assert.equal(senderCalls(),1);
    assert.ok(!/target_id|provider_message_id|reporter_identity_hash|已读/.test(JSON.stringify(applied.body)));
  });
});
