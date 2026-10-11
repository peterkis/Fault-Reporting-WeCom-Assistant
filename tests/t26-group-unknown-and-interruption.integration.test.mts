import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {withT26Fixture,t26Group,t26Deliveries,t26Control,t26Sender,t26Object} from './helpers/t26-group-notification-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';

test('unknown group effects and an interrupted native Worker require explicit administrator reconciliation without resending private success',{timeout:240000},async()=>{
 await withT26Fixture(async context=>{
  const tag='t26-unknown',{id,http,started}=await t26Group(context,tag),before=await t26Deliveries(http,id),group=before.find(row=>row.destination_type==='GROUP'),person=before.find(row=>row.destination_type==='PERSON');assert.ok(group&&person);
  let groupCalls=0,personCalls=0;const onPerson=async()=>{personCalls++;return {errcode:0};};
  const uncertain=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:t26Sender(context,tag,{onPerson,fetchImpl:async()=>{groupCalls++;return new Response('{"errcode":45009}');}})});
  await uncertain.deliver({deliveryId:String(group.delivery_id)});await uncertain.deliver({deliveryId:String(person.delivery_id)});
  const partial=await t26Deliveries(http,id),sentPerson=partial.find(row=>row.delivery_id===person.delivery_id);assert.equal(sentPerson?.status,'SENT');assert.equal(partial.find(row=>row.delivery_id===group.delivery_id)?.status,'RECONCILIATION_REQUIRED');assert.equal(await uncertain.deliver({deliveryId:String(group.delivery_id)}),null);assert.equal(groupCalls,1);
  const admin=await t26Control(context),handler=await t26Control(context,2),outsider=await t26Control(context,1),reconcile={client_command_id:randomUUID(),reason_code:'T26_MANUAL_CHECK',resolution:'CONFIRMED_NOT_SENT_REQUEUE'};
  assert.equal((await admin(id,String(group.delivery_id),'retry',{client_command_id:randomUUID(),reason_code:'T26_NO_BLIND_RETRY'})).status,409);
  assert.equal((await handler(id,String(group.delivery_id),'reconcile',reconcile)).status,403);
  assert.ok([403,404].includes((await outsider(id,String(group.delivery_id),'reconcile',reconcile)).status));
  assert.equal((await admin(id,String(person.delivery_id),'reconcile',{...reconcile,client_command_id:randomUUID()})).status,409);
  assert.equal((await admin(id,String(group.delivery_id),'reconcile',reconcile)).status,200);
  assert.equal(t26Object(await (await admin(id,String(group.delivery_id),'reconcile',reconcile)).json()).replayed,true);
  const recovered=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:t26Sender(context,tag,{onPerson,fetchImpl:async()=>{groupCalls++;return new Response('{"errcode":0}');}})});
  await recovered.deliver({deliveryId:String(group.delivery_id)});assert.equal(await recovered.deliver({deliveryId:String(person.delivery_id)}),null);
  assert.deepEqual((await t26Deliveries(http,id)).find(row=>row.delivery_id===person.delivery_id),sentPerson);assert.equal(groupCalls,2);assert.equal(personCalls,1);assert.deepEqual(await http.detail(id),started);

  const crashTag='t26-process-interruption',crash=await t26Group(context,crashTag),initial=await t26Deliveries(crash.http,crash.id),crashGroup=initial.find(row=>row.destination_type==='GROUP'),crashPerson=initial.find(row=>row.destination_type==='PERSON');assert.ok(crashGroup&&crashPerson);
  const survivor=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:t26Sender(context,crashTag,{onPerson})});await survivor.deliver({deliveryId:String(crashPerson.delivery_id)});
  const stable=(await t26Deliveries(crash.http,crash.id)).find(row=>row.delivery_id===crashPerson.delivery_id);assert.equal(stable?.status,'SENT');
  const child=fork(fileURLToPath(new URL('./helpers/t26-interrupted-group-worker.mjs',import.meta.url)),[],{execPath:process.execPath,env:{...process.env,T26_CASE_DB:context.databaseUrl,T26_CASE_DELIVERY:String(crashGroup.delivery_id),T26_CASE_GROUP:'group-'+crashTag},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  let exited=false;const exit=once(child,'exit').then(()=>{exited=true;});
  try{
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('T26_CHILD_SEND_BOUNDARY_TIMEOUT')),10000);child.once('message',message=>{clearTimeout(timer);message==='T26_FETCH_ENTERED'?resolve():reject(Error('T26_CHILD_BOUNDARY_INVALID'));});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('T26_CHILD_EARLY_EXIT'));});});
   assert.equal((await t26Deliveries(crash.http,crash.id)).find(row=>row.delivery_id===crashGroup.delivery_id)?.status,'SENDING');assert.ok(child.pid);child.kill();await exit;assert.equal(exited,true);
   // The actual default 30s lease expires naturally. No clock or Delivery SQL is altered.
   await delay(31000);assert.deepEqual(await survivor.recoverExpiredSending(),{recovered:1,delivery_ids:[String(crashGroup.delivery_id)]});
   assert.equal((await t26Deliveries(crash.http,crash.id)).find(row=>row.delivery_id===crashGroup.delivery_id)?.status,'RECONCILIATION_REQUIRED');assert.equal(await survivor.deliver({deliveryId:String(crashGroup.delivery_id)}),null);
   const confirmed={client_command_id:randomUUID(),reason_code:'T26_EXPLICIT_SYNTHETIC_CHECK',resolution:'CONFIRMED_SENT'};
   assert.equal((await admin(crash.id,String(crashGroup.delivery_id),'reconcile',confirmed)).status,200);assert.equal(t26Object(await (await admin(crash.id,String(crashGroup.delivery_id),'reconcile',confirmed)).json()).replayed,true);
   assert.equal(await survivor.deliver({deliveryId:String(crashGroup.delivery_id)}),null);assert.deepEqual((await t26Deliveries(crash.http,crash.id)).find(row=>row.delivery_id===crashPerson.delivery_id),stable);assert.equal(personCalls,2);assert.deepEqual(await crash.http.detail(crash.id),crash.started);
   console.log('T26_OWNED_WORKER_INTERRUPTION '+JSON.stringify({owned_pid:child.pid,actual_send_boundary:true,process_exit_observed:exited,default_lease_ms:30000,explicit_reconciliation:true,real_delivery_effect:'NOT_RUN'}));
  }finally{if(!exited){child.kill();await exit;}if(child.connected)child.disconnect();}
 });
});
