import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t31Http,record,text} from './helpers/t31-public-progress-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';

test('T31 the split-process Worker default cannot send a new purpose without admission, while old lifecycle deliveries retain their default path',async()=>{
  await t31Http({purpose:'t31split',notifications:true},async({pool,confirm,post})=>{
    const incident=await confirm(),path='/api/incidents/'+incident,summary='合成独立Worker边界摘要';
    const published=await post(path+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary,preview_confirmed:true});assert.equal(published.status,200);
    const rows=(await pool.query<{delivery_id:string;subscription_id:string;row_version:string}>(`SELECT d.id::text AS delivery_id,s.id::text AS subscription_id,s.row_version::text FROM communication.incident_notification_binding b JOIN incident.reporter_subscription s ON s.id=b.reporter_subscription_id JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_event_id=$1::uuid ORDER BY d.id`,[published.body.result_event_id])).rows;assert.equal(rows.length,2);const first=rows[0];assert.ok(first);
    assert.equal((await post(path+'/subscriptions/'+first.subscription_id+'/pause',{client_command_id:randomUUID(),expected_row_version:'2',expected_subscription_version:first.row_version,reason_code:'SUBSCRIPTION_REQUEST'})).status,200);
    let publicCalls=0,legacyCalls=0;
    // runWorker in p2-g1-process-role constructs this exact public factory with
    // no attemptAdmission. No role controller, Gateway or external service is
    // started: real persisted HTTP intents are consumed through its runOnce.
    const worker=createCommunicationDeliveryWorker({pool,enabled:true,batchSize:20,sender:{send:async request=>{if(JSON.stringify(request.message).includes(summary))publicCalls++;else legacyCalls++;return {outcome:'ACKNOWLEDGED',provider_message_id:'synthetic-default-worker',error_code:null,retryable:false};}}});
    await worker.runOnce();assert.equal(publicCalls,0,'unmounted new purpose must fail closed before Sender, including still-active queued routes');assert.ok(legacyCalls>0,'the old default lifecycle route must remain usable without the new hook');
    for(const row of rows){const saved=(await pool.query('SELECT status,side_effect_state FROM communication.delivery WHERE id=$1::uuid',[row.delivery_id])).rows[0];assert.deepEqual(record(saved),{status:'CANCELLED',side_effect_state:'NOT_ATTEMPTED'});}
    const fact=(await pool.query<{count:string}>("SELECT count(*)::text AS count FROM incident.incident_event WHERE incident_id=$1::uuid AND event_type='incident.public_progress_published'",[incident])).rows[0];assert.equal(fact?.count,'1');assert.ok(text(published.body.result_event_id));
  });
});
