import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';

const faults:ReadonlyArray<readonly[string,()=>Response]>=[
 ['malformed JSON',()=>new Response('{')],
 ['a nonzero provider code',()=>new Response('{"errcode":40013,"msgid":"T25_RAW_PRIVATE_REPLY"}')],
 ['a partial recipient result',()=>new Response('{"errcode":0,"msgid":"T25_RAW_PRIVATE_REPLY","invaliduser":"T25_RAW_PRIVATE_REPLY"}')],
 ['an unsuccessful HTTP response',()=>new Response('{"errcode":0,"msgid":"T25_RAW_PRIVATE_REPLY"}',{status:500})],
 ['an oversized body',()=>new Response('T25_RAW_PRIVATE_REPLY'.repeat(410))],
 ['an SDK throw after the send attempt',()=>{throw Error('T25_RAW_PRIVATE_REPLY');}],
];
for(const [name,reply] of faults)test('the actual App send retains UNKNOWN for '+name+' and does not automatically retry',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const pending=await t25Deliveries(source.http,source.ticketId);assert.equal(pending.length,1);let sends=0;
  const fetchImpl:typeof fetch=async(input,init)=>{assert.ok(init?.signal instanceof AbortSignal);init.signal.throwIfAborted();const path=new URL(input instanceof Request?input.url:String(input)).pathname;
   if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_REPLY_QUALIFIED_OPEN_A'}]}));
   assert.equal(path,'/cgi-bin/message/send');sends++;return reply();};
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,
   origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:1000002,accessTokenProvider:async()=> 'T25_REPLY_SYNTHETIC_TOKEN',fetchImpl}});
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender});await worker.runOnce();const observed=await t25Deliveries(source.http,source.ticketId);
  assert.equal(sends,1);assert.equal(observed[0]?.delivery_id,pending[0]?.delivery_id);assert.equal(observed[0]?.status,'RECONCILIATION_REQUIRED');assert.equal(observed[0]?.side_effect_state,'UNKNOWN');assert.equal(observed[0]?.attempt_count,1);assert.equal(JSON.stringify(observed).includes('T25_RAW_PRIVATE_REPLY'),false);
  await worker.runOnce();await source.round.runOnce();assert.equal(sends,1);assert.deepEqual(await t25Deliveries(source.http,source.ticketId),observed);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
 },{manualRoundConsumption:true});
});
