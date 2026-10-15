import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {t31Http,record,text} from './helpers/t31-public-progress-fixture.mjs';
import {createP2012Runtime} from '../src/p2-012-workbench-assembly.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import type {CommunicationSenderResult} from '../src/p2-004-communication-sender-port.mjs';
function assertPublicRequest(request:{target_type:string;json:string;text:unknown},secret:string,summary:string){assert.equal(request.target_type,'PERSON');assert.ok(!request.json.includes(secret));assert.equal(request.text,'【P2-012测试】【IT故障进展】'+summary);}

test('T31 independent UNKNOWN and terminal failure preserve the publication, internal isolation and original UUID without blind retry',async()=>{
  await t31Http({purpose:'t31results'},async({pool,f,origin,confirm,get,post})=>{
    const incident=await confirm(),path='/api/incidents/'+incident,secret='合成内部标记T31-PRIVATE-RESULT';
    assert.equal((await post(path+'/internal-notes',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_INTERNAL_DISPOSITION',audience:'INTERNAL',text:secret})).status,200);
    const body={client_command_id:randomUUID(),expected_row_version:'2',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'合成独立安全公开摘要。',preview_confirmed:true},published=await post(path+'/publish-update',body);assert.equal(published.status,200);const publication=text(published.body.result_event_id),routes=(await get(path+'/public-progress/'+publication+'/deliveries')).body;assert.ok(Array.isArray(routes.items));const ids=routes.items.map(row=>text(record(row).id));assert.equal(ids.length,2);
    let calls=0;const sentRequests:{target_type:string;json:string;text:unknown}[]=[];const senderRuntime=createP2012Runtime({pool,principalIds:[text(record(f.admin).id)],publicOrigin:origin,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentPublicProgressEnabled:true,externalSendEnabled:false,senderAdapter:{send:async request=>{calls++;sentRequests.push({target_type:request.target_type,json:JSON.stringify(request),text:request.message.content.text});return {outcome:calls===1?'UNKNOWN':'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:calls===1?'SYNTHETIC_UNKNOWN':'SYNTHETIC_REJECTED',retryable:false};}}});let error:unknown;
    try{
      for(const id of ids)await senderRuntime.communicationWorker.deliver({deliveryId:id});assert.equal(calls,2);assert.equal(await senderRuntime.communicationWorker.deliver({deliveryId:ids[0]??''}),null);assert.equal(calls,2);
      assert.equal(sentRequests.length,2);for(const request of sentRequests)assertPublicRequest(request,secret,body.summary);
      const firstRequest=sentRequests[0];assert.ok(firstRequest);assert.throws(()=>assertPublicRequest({...firstRequest,target_type:'GROUP'},secret,body.summary),assert.AssertionError);
      const result=(await get(path+'/public-progress/'+publication+'/deliveries')).body;assert.ok(Array.isArray(result.items));assert.deepEqual(result.items.map(row=>record(row).status).sort(),['DEAD_LETTER','RECONCILIATION_REQUIRED']);assert.ok(!JSON.stringify(result).includes(secret));assert.equal((await get(path+'/commands/'+body.client_command_id)).body.state,'COMMITTED');assert.equal((await post(path+'/publish-update',body)).body.replayed,true);assert.equal(calls,2);
      const count=(await pool.query<{count:string}>("SELECT count(*)::text AS count FROM incident.incident_event WHERE incident_id=$1::uuid AND event_type='incident.public_progress_published'",[incident])).rows[0];assert.equal(count?.count,'1');
    }catch(e){error=e;}await closeBrowserTestResources([()=>senderRuntime.stop()],error);
  });
});
test('T31 pause after attempt admission preserves actual in-flight ACK instead of rewriting it as not sent',async()=>{
  await t31Http({purpose:'t31flight'},async({pool,f,origin,confirm,post})=>{
    const incident=await confirm(),path='/api/incidents/'+incident,published=await post(path+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'合成在途边界摘要。',preview_confirmed:true});assert.equal(published.status,200);
    const row=(await pool.query<{delivery_id:string;subscription_id:string;row_version:string}>(`SELECT d.id::text AS delivery_id,s.id::text AS subscription_id,s.row_version::text FROM communication.incident_notification_binding b JOIN incident.reporter_subscription s ON s.id=b.reporter_subscription_id JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_event_id=$1::uuid ORDER BY d.id LIMIT 1`,[published.body.result_event_id])).rows[0];assert.ok(row);
    let entered!:()=>void,release!:(result:CommunicationSenderResult)=>void;const admitted=new Promise<void>(resolve=>{entered=resolve;}),ack=new Promise<CommunicationSenderResult>(resolve=>{release=resolve;});let calls=0;
    const senderRuntime=createP2012Runtime({pool,principalIds:[text(record(f.admin).id)],publicOrigin:origin,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentPublicProgressEnabled:true,externalSendEnabled:false,senderAdapter:{send:async()=>{calls++;entered();return ack;}}});let error:unknown;
    const delivery=senderRuntime.communicationWorker.deliver({deliveryId:row.delivery_id});
    try{
      await Promise.race([admitted,delivery.then(()=>{throw new Error('T31_SENDER_NOT_REACHED');})]);assert.equal((await pool.query<{status:string}>('SELECT status FROM communication.delivery WHERE id=$1::uuid',[row.delivery_id])).rows[0]?.status,'SENDING');
      assert.equal((await post(path+'/subscriptions/'+row.subscription_id+'/pause',{client_command_id:randomUUID(),expected_row_version:'2',expected_subscription_version:row.row_version,reason_code:'SUBSCRIPTION_REQUEST'})).status,200);
      release({outcome:'ACKNOWLEDGED',provider_message_id:'synthetic-in-flight',error_code:null,retryable:false});await delivery;assert.equal((await pool.query<{status:string;side_effect_state:string}>('SELECT status,side_effect_state FROM communication.delivery WHERE id=$1::uuid',[row.delivery_id])).rows[0]?.status,'SENT');assert.equal(calls,1);
    }catch(e){error=e;}finally{release({outcome:'UNKNOWN',provider_message_id:null,error_code:'SYNTHETIC_CLEANUP',retryable:false});}
    await closeBrowserTestResources([async()=>{await delivery;},()=>senderRuntime.stop()],error);
  });
});
test('T31 changed direct binding and disabled purpose cancel queued intent before the existing Sender',async()=>{
  await t31Http({purpose:'t31binding'},async({pool,f,origin,confirm,post})=>{
    const incident=await confirm(),published=await post('/api/incidents/'+incident+'/publish-update',{client_command_id:randomUUID(),expected_row_version:'1',reason_code:'WORKBENCH_PUBLIC_PROGRESS',summary:'合成当前绑定复核。',preview_confirmed:true});assert.equal(published.status,200);
    const rows=(await pool.query<{delivery_id:string;subscription_id:string;leg_id:string}>(`SELECT d.id::text AS delivery_id,b.reporter_subscription_id::text AS subscription_id,b.direct_channel_leg_id::text AS leg_id FROM communication.incident_notification_binding b JOIN communication.outbox o ON o.message_id=b.communication_message_id JOIN communication.delivery d ON d.outbox_id=o.id WHERE b.incident_event_id=$1::uuid ORDER BY d.id`,[published.body.result_event_id])).rows;assert.equal(rows.length,2);const first=rows[0],second=rows[1];assert.ok(first&&second);
    await pool.query('UPDATE incident.reporter_subscription SET direct_channel_leg_id=$2::uuid WHERE id=$1::uuid',[first.subscription_id,second.leg_id]);let calls=0;
    for(const [enabled,id] of [[true,first.delivery_id],[false,second.delivery_id]] as const){const senderRuntime=createP2012Runtime({pool,principalIds:[text(record(f.admin).id)],publicOrigin:origin,flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true},incidentFlags:{INCIDENT_CORRELATION_ENABLED:true},incidentBackgroundMaintenance:false,incidentCandidateWorkspaceEnabled:true,incidentPublicProgressEnabled:enabled,externalSendEnabled:false,senderAdapter:{send:async()=>{calls++;return {outcome:'ACKNOWLEDGED',provider_message_id:'must-not-send',error_code:null,retryable:false};}}});let error:unknown;try{await senderRuntime.communicationWorker.deliver({deliveryId:id});assert.equal((await pool.query<{status:string}>('SELECT status FROM communication.delivery WHERE id=$1::uuid',[id])).rows[0]?.status,'CANCELLED');}catch(e){error=e;}await closeBrowserTestResources([()=>senderRuntime.stop()],error);}
    assert.equal(calls,0);
  });
});
