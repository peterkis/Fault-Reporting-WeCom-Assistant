import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import type {WeComAccessTokenProvider} from '../src/p2-g2-wecom-oauth-provider.mjs';

test('a transport for another application is rejected before any credential or SDK call',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const pending=await t25Deliveries(source.http,source.ticketId);assert.equal(pending.length,1);assert.equal(source.authority.sourceAppScope,'1000002');
  let tokenCalls=0,sdkCalls=0,sender:ReturnType<typeof createP2016WeComSender>|undefined;
  const accessTokenProvider:WeComAccessTokenProvider=async()=>{tokenCalls++;return 'T25_WRONG_APPLICATION_SYNTHETIC_TOKEN';};
  const fetchImpl:typeof fetch=async input=>{sdkCalls++;const path=new URL(input instanceof Request?input.url:String(input)).pathname;
   return new Response(JSON.stringify(path==='/cgi-bin/batch/userid_to_openuserid'?{errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_WRONG_APP_QUALIFIED_USER'}]}:{errcode:0,msgid:'T25_WRONG_APP_ACK'}));};
  try{sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('BOT_SDK_MUST_NOT_RECEIVE_APP');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,
   origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:1000003,accessTokenProvider,fetchImpl}});}
  catch(error){assert.ok(error instanceof TypeError);assert.equal(error.message,'APP_NOTIFICATION_CONFIGURATION_INVALID');console.log('T25_WRONG_APP_TRACE CONFIGURATION_REJECTED');}
  if(sender){const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender});await worker.runOnce();console.log('T25_WRONG_APP_TRACE ACTUAL_WORKER_REACHED');}
  assert.equal(tokenCalls,0);assert.equal(sdkCalls,0);assert.deepEqual(await t25Deliveries(source.http,source.ticketId),pending);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
 },{manualRoundConsumption:true});
});
