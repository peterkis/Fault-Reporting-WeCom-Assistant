import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withT26Fixture,t26Group,t26Deliveries} from './helpers/t26-group-notification-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {createWorkbenchGroupNotificationSender} from '../src/workbench-group-notification-sender.mjs';

test('expiry committed during asynchronous send authorization refuses the original group push before fetch',{timeout:240000},async()=>{
 await withT26Fixture(async context=>{
  const tag='t26-last-retention',{id,http,started,intake}=await t26Group(context,tag),before=await t26Deliveries(http,id),group=before.find(row=>row.destination_type==='GROUP'),person=before.find(row=>row.destination_type==='PERSON');assert.ok(group&&person);
  let fetchCalls=0,qualificationCalls=0,expired=false;
  const sender=createWorkbenchGroupNotificationSender({pool:context.pool,enabled:true,routes:[{botId:'bot-test',groupId:'group-'+tag,url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=t26-synthetic'}],resolveMentionUserId:async()=>{qualificationCalls++;return 't26-verified-webhook-user';},beforeSend:async()=>{
   // Fault only the real synthetic source retention, after its first source read.
   // No Message, Delivery, Attempt, cycle or Ticket is written by the test.
   // Keep the original Inbox constraint retention > received_at intact.
   await delay(3100);
   const result=await context.pool.query(`WITH stamp AS (SELECT platform.physical_epoch_ms()-1000 AS cutoff)
    UPDATE channel.message_inbox SET retention_until=platform.local_from_epoch_ms(cutoff),retention_until_epoch_ms=cutoff FROM stamp WHERE id=$1::bigint`,[String(intake.messageId)]);assert.equal(result.rowCount,1);expired=true;
  },fetchImpl:async()=>{fetchCalls++;return new Response('{"errcode":0}');}});
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender});await worker.deliver({deliveryId:String(group.delivery_id)});
  assert.equal(expired,true);assert.ok(qualificationCalls>=1);assert.equal(fetchCalls,0,'expired source must be rechecked after authorization awaits and before the external side effect');
  const after=await t26Deliveries(http,id);assert.equal(after.find(row=>row.delivery_id===group.delivery_id)?.status,'DEAD_LETTER');assert.deepEqual(after.find(row=>row.delivery_id===person.delivery_id),person);assert.deepEqual(await http.detail(id),started);
 });
});
