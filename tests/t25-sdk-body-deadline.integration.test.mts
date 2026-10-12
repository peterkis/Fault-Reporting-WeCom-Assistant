import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import type {CommunicationSenderRequest} from '../contracts/communication_contracts.js';

test('a send response body that ignores abort is cancelled and the actual Sender drains at the existing deadline without resending',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const pending=await t25Deliveries(source.http,source.ticketId);assert.equal(pending.length,1);
  let releaseBody:(()=>void)|undefined,sdkSignal:AbortSignal|undefined,settled=false,sends=0,cancelled=0,drain:Promise<unknown>|undefined;
  const fetchImpl:typeof fetch=async(input,init)=>{
   assert.ok(init?.signal instanceof AbortSignal);const path=new URL(input instanceof Request?input.url:String(input)).pathname;
   if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_BODY_QUALIFIED_OPEN_A'}]}));
   assert.equal(path,'/cgi-bin/message/send');sends++;sdkSignal=init.signal;
   return new Response(new ReadableStream<Uint8Array>({start(controller){releaseBody=()=>{if(!cancelled)controller.close();};},cancel(){cancelled++;}}));
  };
  const actual=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,
   origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:1000002,accessTokenProvider:async()=> 'T25_BODY_SYNTHETIC_TOKEN',fetchImpl}});
  const sender={send(request:CommunicationSenderRequest){const operation=actual.send(request).finally(()=>{settled=true;});drain=operation;return operation;}};
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender});
  try{
   await worker.runOnce();await delay(750);assert.ok(sdkSignal);assert.equal(sdkSignal.aborted,true);console.log('T25_BODY_DEADLINE '+JSON.stringify({aborted:sdkSignal.aborted,settled,sends,cancelled}));
   assert.equal(settled,true);assert.equal(cancelled,1);assert.equal(sends,1);const observed=await t25Deliveries(source.http,source.ticketId);assert.equal(observed[0]?.delivery_id,pending[0]?.delivery_id);assert.equal(observed[0]?.status,'RECONCILIATION_REQUIRED');assert.equal(observed[0]?.side_effect_state,'UNKNOWN');assert.equal(observed[0]?.attempt_count,1);
   await worker.runOnce();await source.round.runOnce();assert.equal(sends,1);assert.deepEqual(await t25Deliveries(source.http,source.ticketId),observed);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
  }finally{releaseBody?.();await drain;}
 },{manualRoundConsumption:true});
});
