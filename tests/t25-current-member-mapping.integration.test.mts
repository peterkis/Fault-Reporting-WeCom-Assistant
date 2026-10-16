import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createTicketRoundNotifications} from '../src/workbench-ticket-round-notifications.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
import type {TicketAppNotificationOptions,IneligibleTicketAppNotificationTarget} from '../contracts/workbench_app_notification_contracts.js';

test('missing or unreachable current mapping creates no App intent and a later remap cannot retarget the original Delivery',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);let state:'NO_MAPPING'|'UNREACHABLE'|'ORIGINAL'|'REMAPPED'='NO_MAPPING',tokens=0,sdkCalls=0;
  const notifications:TicketAppNotificationOptions={...source.appNotifications,targetResolver:{localOnly:true,async resolveCurrentTarget(input){
   if(state==='NO_MAPPING'||state==='UNREACHABLE'){
    const epoch=assertEpochMsString(String(Date.now()));const denied:IneligibleTicketAppNotificationTarget={schema_version:1,state:'NOT_ELIGIBLE',reason:state,source_kind:input.source_kind,scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(epoch),checked_at_epoch_ms:epoch};return denied;
   }
   const result=t25Object(await source.appNotifications.targetResolver.resolveCurrentTarget(input));
   return state==='REMAPPED'?{...result,target:{...t25Object(result.target),target_id:'T25_DIFFERENT_CURRENT_MEMBER_B'}}:result;
  }}};
  const round=createTicketRoundNotifications({pool:context.pool,enabled:true,botId:entryConfig.botId,reporterAccess:context.runtime.reporterAccess,appNotifications:notifications});
  await round.runOnce();assert.deepEqual(await t25Deliveries(source.http,source.ticketId),[]);
  state='UNREACHABLE';await round.runOnce();assert.deepEqual(await t25Deliveries(source.http,source.ticketId),[]);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
  state='ORIGINAL';await round.runOnce();const before=await t25Deliveries(source.http,source.ticketId);assert.equal(before.length,1);assert.equal(before[0]?.status,'PENDING');
  state='REMAPPED';await round.runOnce();assert.deepEqual(await t25Deliveries(source.http,source.ticketId),before);
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,linkMode:'MEMBER_REQUIRED',reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],
   appRoundNotifications:{pool:context.pool,notifications,agentId:Number(entryConfig.agentId),accessTokenProvider:async()=>{tokens++;return 'T25_UNUSED_REMAP_TOKEN';},fetchImpl:async()=>{sdkCalls++;throw Error('REMAP_MUST_NOT_CALL_SDK');}}});
  await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();const after=await t25Deliveries(source.http,source.ticketId);
  console.log('T25_CURRENT_MAPPING_TRACE '+JSON.stringify({tokens,sdkCalls,before,after}));
  assert.equal(tokens,0);assert.equal(sdkCalls,0);assert.equal(after.length,1);assert.equal(after[0]?.delivery_id,before[0]?.delivery_id);assert.equal(after[0]?.status,'DEAD_LETTER');assert.equal(after[0]?.side_effect_state,'NOT_ATTEMPTED');assert.deepEqual(await source.http.detail(source.ticketId),source.started);
 },{manualRoundConsumption:true});
});
