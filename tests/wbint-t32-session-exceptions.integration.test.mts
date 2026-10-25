import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT32Fixture,t32Record,t32Text} from './helpers/t32-notification-exception-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {createCommunicationSenderPort} from '../app/server/src/p2-004-communication-sender-port.mjs';

test('T32 Session failures and UNKNOWN use independent current VIEW and real controls without raw message content',{timeout:240000},async()=>{
  await withT32Fixture(async f=>{
    const session=(await f.pool.query<{id:string}>('SELECT id::text FROM conversation.session WHERE service_intake_id=$1::uuid',[f.tickets[0]?.intake.intakeId])).rows[0];assert.ok(session);
    const path='/api/conversations/'+session.id;
    assert.equal((await f.get(path,0)).status,200);assert.equal((await f.get(path,2)).status,404);
    const current=(await f.get(path)).body;
    const takeover=await f.post(path+'/takeover',{client_command_id:randomUUID(),expected_row_version:t32Record(current.session).row_version});assert.equal(takeover.status,200,JSON.stringify(takeover.body));
    const deliveryIds:string[]=[];let senderCalls=0;
    for(const unknown of [false,true]){
      const detail=(await f.get(path)).body;
      const response=await f.post(path+'/messages',{client_command_id:randomUUID(),expected_row_version:t32Record(detail.session).row_version,text:'T32_PRIVATE_REPLY_CANARY',message_type:'text'});
      assert.equal(response.status,202,JSON.stringify(response.body));assert.ok(Array.isArray(response.body.delivery_ids));const id=t32Text(response.body.delivery_ids[0]);deliveryIds.push(id);
      const worker=createCommunicationDeliveryWorker({pool:f.pool,enabled:true,sender:createCommunicationSenderPort(()=>{senderCalls++;return {outcome:unknown?'UNKNOWN':'REJECTED_NOT_APPLIED',provider_message_id:null,error_code:'T32_RAW_ERROR_CANARY',retryable:false};})});
      assert.ok(await worker.deliver({deliveryId:id}));
    }
    const response=await f.get('/api/notification-exceptions?domain=SESSION');assert.equal(response.status,200);
    assert.ok(Array.isArray(response.body.items));assert.equal(response.body.items.length,2,'actual Session facts must be queried before bounded pagination');
    const rows=response.body.items.map(t32Record),failed=rows.find(row=>row.status==='DEAD_LETTER'),unknown=rows.find(row=>row.status==='RECONCILIATION_REQUIRED');assert.ok(failed&&unknown);
    assert.equal(failed.parent_id,session.id);assert.equal(failed.source_kind,'SESSION_MESSAGE');assert.deepEqual(failed.allowed_actions,['RETRY']);assert.deepEqual(unknown.allowed_actions,['RECONCILE']);assert.equal(unknown.error_code,'RESULT_UNCONFIRMED');
    assert.equal((await f.get('/api/notification-exceptions/session/'+session.id+'/'+deliveryIds[0],2)).status,404);
    const other=(await f.pool.query<{id:string}>('SELECT id::text FROM conversation.session WHERE id<>$1::uuid ORDER BY id LIMIT 1',[session.id])).rows[0];assert.ok(other);
    assert.equal((await f.get('/api/notification-exceptions/session/'+other.id+'/'+deliveryIds[0])).status,404);
    const denied=await f.get('/api/notification-exceptions?domain=SESSION',2);assert.deepEqual(denied.body,{items:[],has_more:false,next_cursor:null});
    const one=await f.get('/api/notification-exceptions?domain=SESSION&limit=1');assert.equal(one.body.has_more,true);const cursor=t32Text(one.body.next_cursor);
    assert.equal((await f.get('/api/notification-exceptions?domain=SESSION&limit=1&cursor='+encodeURIComponent(cursor),1)).status,400);
    assert.equal((await f.get('/api/notification-exceptions?domain=TICKET&limit=1&cursor='+encodeURIComponent(cursor))).status,400);
    assert.equal((await f.get('/api/notification-exceptions?domain=SESSION&state=UNKNOWN')).body.items instanceof Array,true);
    const unknownOnly=(await f.get('/api/notification-exceptions?domain=SESSION&state=UNKNOWN')).body;assert.ok(Array.isArray(unknownOnly.items));assert.equal(unknownOnly.items.length,1);
    const member=await f.get('/api/notification-exceptions?domain=SESSION',1);assert.ok(Array.isArray(member.body.items));const memberUnknown=member.body.items.map(t32Record).find(row=>row.status==='RECONCILIATION_REQUIRED');assert.ok(memberUnknown);assert.deepEqual(memberUnknown.allowed_actions,[],'Session VIEW does not confer ADMIN reconciliation');
    assert.equal(/T32_PRIVATE_REPLY_CANARY|T32_RAW_ERROR_CANARY|target_id|target_hash|provider_message|binding_hash/u.test(JSON.stringify(response.body)),false);
    assert.equal(senderCalls,2);
  });
});
