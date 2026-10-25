import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016WeComSender} from '../app/server/src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from '../app/server/src/platform/time-contract.mjs';
import type {IneligibleTicketAppNotificationTarget,TicketAppNotificationOptions} from '../contracts/workbench_app_notification_contracts.js';

test('actual App failures and UNKNOWN require explicit authorized HTTP recovery of the same Delivery and command intent without repeating a successful node',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context),http=source.http,id=source.ticketId;await source.round.runOnce();const first=(await t25Deliveries(http,id))[0];assert.ok(first&&typeof first.delivery_id==='string');
  let eligible=false,tokens=0,conversions=0,sends=0;const taskIds:string[]=[];
  const notifications:TicketAppNotificationOptions={...source.appNotifications,targetResolver:{localOnly:true,async resolveCurrentTarget(input){
   if(eligible)return source.appNotifications.targetResolver.resolveCurrentTarget(input);
   const epoch=assertEpochMsString(String(Date.now()));const result:IneligibleTicketAppNotificationTarget={schema_version:1,state:'NOT_ELIGIBLE',reason:'REVOKED',source_kind:input.source_kind,scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(epoch),checked_at_epoch_ms:epoch};return result;
  }}};
  const fetchImpl:typeof fetch=async(input,init)=>{
   assert.ok(typeof init?.body==='string');const path=new URL(input instanceof Request?input.url:String(input)).pathname,body=t25Object(JSON.parse(init.body));
   if(path==='/cgi-bin/batch/userid_to_openuserid'){conversions++;assert.deepEqual(body,{userid_list:[source.memberId]});return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_HTTP_RECOVERY_OPEN_A'}]}));}
   assert.equal(path,'/cgi-bin/message/send');assert.equal(body.touser,'T25_HTTP_RECOVERY_OPEN_A');const card=t25Object(body.template_card);assert.ok(typeof card.task_id==='string');taskIds.push(card.task_id);sends++;
   return new Response(sends===1?'{"errcode":0,"msgid":"T25_HTTP_RECOVERY_FIRST_ACK"}':'{"errcode":0,"msgid":"T25_PARTIAL_ACK","invaliduser":"T25_HTTP_RECOVERY_OPEN_A"}');
  };
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications,agentId:Number(entryConfig.agentId),accessTokenProvider:async()=>{tokens++;return 'T25_HTTP_RECOVERY_SYNTHETIC_TOKEN';},fetchImpl}});
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender});await worker.deliver({deliveryId:first.delivery_id});const failed=(await t25Deliveries(http,id))[0];assert.equal(failed?.status,'DEAD_LETTER');assert.equal(failed?.side_effect_state,'NOT_ATTEMPTED');assert.equal(tokens,0);assert.equal(sends,0);
  const csrf=t25Object(await (await http.get('/api/lifecycle/bootstrap')).json()).csrf_token;assert.ok(typeof csrf==='string');
  const post=async(deliveryId:string,action:string,command:{client_command_id:string;reason_code:string;resolution?:string},cookie=context.cookies[0],csrfToken=csrf)=>{
   assert.ok(cookie);return fetch(context.origin+'/api/tickets/'+id+'/deliveries/'+deliveryId+'/'+action,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrfToken},body:JSON.stringify(command)});
  };
  const retry={client_command_id:randomUUID(),reason_code:'T25_CURRENT_REQUALIFIED'};const queued=await post(first.delivery_id,'retry',retry);assert.equal(queued.status,200);assert.equal(t25Object(await queued.json()).status,'PENDING');eligible=true;
  await worker.deliver({deliveryId:first.delivery_id});const successful=(await t25Deliveries(http,id))[0];assert.equal(successful?.status,'SENT');assert.equal(successful?.delivery_id,first.delivery_id);assert.equal(sends,1);assert.equal(taskIds[0],'delivery_'+first.delivery_id.replaceAll('-',''));
  const retryReplay=await post(first.delivery_id,'retry',retry);assert.equal(retryReplay.status,200);assert.equal(t25Object(await retryReplay.json()).replayed,true);assert.deepEqual((await t25Deliveries(http,id))[0],successful);assert.equal((await post(first.delivery_id,'retry',{...retry,reason_code:'T25_CHANGED_INTENT'})).status,409);
  assert.equal((await http.post(id,'complete',http.command(await http.detail(id)))).status,200);await source.round.runOnce();const closed=await http.detail(id),pending=(await t25Deliveries(http,id)).find(row=>row.node==='STAFF_COMPLETED');assert.ok(pending&&typeof pending.delivery_id==='string');await worker.deliver({deliveryId:pending.delivery_id});const unknown=await t25Deliveries(http,id),completion=unknown.find(row=>row.delivery_id===pending.delivery_id);assert.equal(completion?.status,'RECONCILIATION_REQUIRED');assert.equal(completion?.side_effect_state,'UNKNOWN');assert.equal(sends,2);assert.equal(conversions,2);
  await worker.runOnce();await source.round.runOnce();assert.equal(sends,2);assert.deepEqual(await t25Deliveries(http,id),unknown);assert.equal((await post(pending.delivery_id,'retry',{client_command_id:randomUUID(),reason_code:'T25_BLIND_RETRY'})).status,409);
  const other=await t11Http(context,2),otherCsrf=t25Object(await (await other.get('/api/lifecycle/bootstrap')).json()).csrf_token;assert.ok(typeof otherCsrf==='string');const reconcile={client_command_id:randomUUID(),reason_code:'T25_SYNTHETIC_OPERATOR_CONFIRMED',resolution:'CONFIRMED_SENT'};
  assert.equal((await post(pending.delivery_id,'reconcile',reconcile,context.cookies[2],otherCsrf)).status,403);assert.deepEqual(await t25Deliveries(http,id),unknown);
  const confirmed=await post(pending.delivery_id,'reconcile',reconcile);assert.equal(confirmed.status,200);const ack=t25Object(await confirmed.json());assert.equal(ack.delivery_id,pending.delivery_id);assert.equal(ack.status,'SENT');const replay=await post(pending.delivery_id,'reconcile',reconcile);assert.equal(replay.status,200);assert.equal(t25Object(await replay.json()).replayed,true);assert.equal((await post(pending.delivery_id,'reconcile',{...reconcile,resolution:'CANCEL'})).status,409);
  // This explicit synthetic operator decision is not a real SDK side-effect or delivery guarantee.
  const after=await t25Deliveries(http,id);assert.deepEqual(after.find(row=>row.delivery_id===first.delivery_id),successful);assert.equal(after.find(row=>row.delivery_id===pending.delivery_id)?.status,'SENT');assert.equal(after.find(row=>row.delivery_id===pending.delivery_id)?.attempt_count,2);await worker.runOnce();await source.round.runOnce();assert.deepEqual(await t25Deliveries(http,id),after);assert.equal(sends,2);assert.deepEqual(await http.detail(id),closed);
  for(const privateValue of [source.memberId,source.scope.scopeHash,'T25_HTTP_RECOVERY_OPEN_A','T25_HTTP_RECOVERY_FIRST_ACK','T25_PARTIAL_ACK'])assert.equal(JSON.stringify(after).includes(privateValue),false);
  console.log('T25_HTTP_RECOVERY_TRACE '+JSON.stringify({app_deliveries:after.length,sends,conversions,original_first:first.delivery_id,original_completion:pending.delivery_id,retry_uuid:retry.client_command_id,reconcile_uuid:reconcile.client_command_id,taskIds}));
 },{manualRoundConsumption:true,externalSendEnabled:true});
});
