import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';

test('native App Worker interruption at the actual SDK leaf keeps the original intent UNKNOWN until explicit HTTP reconciliation',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const first=(await t25Deliveries(source.http,source.ticketId))[0];assert.ok(first&&typeof first.delivery_id==='string');
  const deliveryId=first.delivery_id,child=fork(fileURLToPath(new URL('./helpers/t25-interrupted-app-worker.mjs',import.meta.url)),[],{execPath:process.execPath,env:{...process.env,T25_CASE_DB:context.databaseUrl,T25_CASE_DELIVERY:deliveryId,T25_CASE_MEMBER:source.memberId,T25_CASE_AUTHORITY:JSON.stringify(source.authority)},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  let exited=false;const exit=once(child,'exit').then(()=>{exited=true;});let sends=0;
  const fresh=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:{async send(){sends++;throw Error('UNKNOWN_MUST_NOT_SEND');}}});
  try{
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('T25_CHILD_SEND_BOUNDARY_TIMEOUT')),10000);child.once('message',message=>{clearTimeout(timer);message==='T25_APP_SEND_ENTERED'?resolve():reject(Error('T25_CHILD_BOUNDARY_INVALID'));});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('T25_CHILD_EARLY_EXIT'));});});
   assert.equal((await t25Deliveries(source.http,source.ticketId))[0]?.status,'SENDING');assert.ok(child.pid);child.kill();await exit;
   // Default lease expires under the unmodified native clock; no Delivery/business row is written by the test.
   await delay(31000);assert.deepEqual(await fresh.recoverExpiredSending(),{recovered:1,delivery_ids:[deliveryId]});
   const uncertain=(await t25Deliveries(source.http,source.ticketId))[0];assert.equal(uncertain?.delivery_id,deliveryId);assert.equal(uncertain?.status,'RECONCILIATION_REQUIRED');assert.equal(uncertain?.side_effect_state,'UNKNOWN');assert.equal(await fresh.deliver({deliveryId}),null);assert.equal(sends,0);
   const csrf=t25Object(await (await source.http.get('/api/lifecycle/bootstrap')).json()).csrf_token;assert.ok(typeof csrf==='string');const command={client_command_id:randomUUID(),reason_code:'T25_EXPLICIT_SYNTHETIC_CHECK',resolution:'CONFIRMED_SENT'};
   const reconcile=()=>fetch(context.origin+'/api/tickets/'+source.ticketId+'/deliveries/'+deliveryId+'/reconcile',{method:'POST',headers:{cookie:context.cookies[0]??'',origin:context.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});
   const confirmed=await reconcile();assert.equal(confirmed.status,200);assert.equal(t25Object(await confirmed.json()).delivery_id,deliveryId);const replay=await reconcile();assert.equal(replay.status,200);assert.equal(t25Object(await replay.json()).replayed,true);
   assert.equal(await fresh.deliver({deliveryId}),null);await source.round.runOnce();const after=await t25Deliveries(source.http,source.ticketId);assert.equal(after.length,1);assert.equal(after[0]?.delivery_id,deliveryId);assert.equal(after[0]?.status,'SENT');assert.equal(sends,0);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
   console.log('T25_OWNED_APP_WORKER_INTERRUPTION '+JSON.stringify({owned_pid:child.pid,actual_app_sdk_boundary:true,process_exit_observed:exited,default_lease_ms:30000,original_delivery:deliveryId,explicit_reconciliation:true,real_delivery_effect:'NOT_RUN'}));
  }finally{if(!exited){child.kill();await exit;}if(child.connected)child.disconnect();}
 },{manualRoundConsumption:true,externalSendEnabled:true});
});
