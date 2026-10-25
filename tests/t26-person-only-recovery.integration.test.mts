import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT26Fixture,t26Group,t26Deliveries,t26Control,t26Sender,t26Object} from './helpers/t26-group-notification-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
test('a successful group delivery survives a private-route failure and exact HTTP retry replay without group resend',{timeout:240000},async()=>{
 await withT26Fixture(async context=>{
  const tag='t26-person-recovery',{id,http,started}=await t26Group(context,tag),before=await t26Deliveries(http,id),group=before.find(row=>row.destination_type==='GROUP'),person=before.find(row=>row.destination_type==='PERSON');assert.ok(group&&person);
  let groupCalls=0,personCalls=0;const fetchImpl:typeof fetch=async()=>{groupCalls++;return new Response('{"errcode":0}');},onPerson=async(target:string)=>{assert.equal(target,'user-test');personCalls++;return {errcode:0};};
  const failed=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:t26Sender(context,tag,{allowPerson:false,fetchImpl,onPerson})});
  await failed.deliver({deliveryId:String(group.delivery_id)});await failed.deliver({deliveryId:String(person.delivery_id)});
  const partial=await t26Deliveries(http,id),sentGroup=partial.find(row=>row.delivery_id===group.delivery_id);assert.equal(sentGroup?.status,'SENT');assert.equal(partial.find(row=>row.delivery_id===person.delivery_id)?.status,'DEAD_LETTER');assert.equal(groupCalls,1);assert.equal(personCalls,0);
  const control=await t26Control(context),command={client_command_id:randomUUID(),reason_code:'T26_PERSON_RECOVERY'};
  const retry=await control(id,String(person.delivery_id),'retry',command);assert.equal(retry.status,200);assert.equal(t26Object(await retry.json()).status,'PENDING');
  const replay=await control(id,String(person.delivery_id),'retry',command);assert.equal(replay.status,200);assert.equal(t26Object(await replay.json()).replayed,true);
  const recovered=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:t26Sender(context,tag,{fetchImpl,onPerson})});
  assert.equal(await recovered.deliver({deliveryId:String(group.delivery_id)}),null);await recovered.deliver({deliveryId:String(person.delivery_id)});await context.runtime.roundNotifications.runOnce();
  // One rejected send + the explicit retry audit + the acknowledged send are
  // three Delivery Attempts; the UUID replay does not add a fourth Attempt.
  const after=await t26Deliveries(http,id);assert.deepEqual(after.find(row=>row.delivery_id===group.delivery_id),sentGroup);assert.equal(after.find(row=>row.delivery_id===person.delivery_id)?.status,'SENT');assert.equal(after.find(row=>row.delivery_id===person.delivery_id)?.attempt_count,3);assert.equal(groupCalls,1);assert.equal(personCalls,1);assert.deepEqual(await http.detail(id),started);
 });
});
