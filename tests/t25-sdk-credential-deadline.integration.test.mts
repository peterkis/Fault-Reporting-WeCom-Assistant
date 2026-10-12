import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import type {WeComAccessTokenProvider} from '../src/p2-g2-wecom-oauth-provider.mjs';
import type {CommunicationSenderRequest} from '../contracts/communication_contracts.js';

test('the real App sender settles at its deadline when the external credential leaf ignores cancellation',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const pending=await t25Deliveries(source.http,source.ticketId);assert.equal(pending.length,1);
  let releaseCredential:((value:string)=>void)|undefined,credentialSignal:AbortSignal|undefined,settled=false,sdkCalls=0,drain:Promise<unknown>|undefined;
  const accessTokenProvider:WeComAccessTokenProvider=options=>{assert.ok(options?.signal);credentialSignal=options.signal;return new Promise<string>(resolve=>{releaseCredential=resolve;});};
  const actual=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,
   origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:1000002,accessTokenProvider,fetchImpl:async()=>{sdkCalls++;throw Error('DEADLINE_MUST_PRECEDE_SDK');}}});
  // Pass through the actual Sender; observe its termination after the existing Worker deadline.
  const sender={send(request:CommunicationSenderRequest){const operation=actual.send(request).finally(()=>{settled=true;});drain=operation;return operation;}};
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender});
  try{
   await worker.runOnce();await delay(750);assert.ok(credentialSignal);assert.equal(credentialSignal.aborted,true);console.log('T25_CREDENTIAL_DEADLINE '+JSON.stringify({aborted:credentialSignal.aborted,settled,sdk_calls:sdkCalls}));
   assert.equal(settled,true);assert.equal(sdkCalls,0);const observed=await t25Deliveries(source.http,source.ticketId);assert.equal(observed[0]?.delivery_id,pending[0]?.delivery_id);assert.equal(observed[0]?.status,'RECONCILIATION_REQUIRED');assert.equal(observed[0]?.side_effect_state,'UNKNOWN');assert.equal(observed[0]?.attempt_count,1);
   await worker.runOnce();await source.round.runOnce();assert.equal(sdkCalls,0);assert.deepEqual(await t25Deliveries(source.http,source.ticketId),observed);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
  }finally{releaseCredential?.('T25_DEADLINE_SYNTHETIC_LATE_TOKEN');await drain;}
 },{manualRoundConsumption:true});
});
