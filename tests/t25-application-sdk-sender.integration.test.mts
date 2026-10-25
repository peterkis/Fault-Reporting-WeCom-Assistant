import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016WeComSender} from '../app/server/src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import type {WeComAccessTokenProvider} from '../app/server/src/p2-g2-wecom-oauth-provider.mjs';

test('real Communication Worker routes an original H5 application intent through the actual sender and external SDK HTTP leaf',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const pending=await t25Deliveries(source.http,source.ticketId);assert.equal(pending.length,1);assert.equal(pending[0]?.status,'PENDING');
  const calls:{path:string;body:Record<string,unknown>}[]=[],appUser='T25_SYNTHETIC_QUALIFIED_APP_OPEN_USER_A';
  const accessTokenProvider:WeComAccessTokenProvider=async options=>{options?.signal?.throwIfAborted();return 'T25_SYNTHETIC_SDK_TOKEN_NOT_A_CREDENTIAL';};
  const fetchImpl:typeof fetch=async(input,init)=>{
   assert.ok(init?.signal instanceof AbortSignal);init.signal.throwIfAborted();assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.ok(typeof init.body==='string');
   const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,'https://qyapi.weixin.qq.com');assert.equal(url.searchParams.get('access_token'),'T25_SYNTHETIC_SDK_TOKEN_NOT_A_CREDENTIAL');
   const body=t25Object(JSON.parse(init.body));calls.push({path:url.pathname,body});
   if(url.pathname==='/cgi-bin/batch/userid_to_openuserid'){assert.deepEqual(body,{userid_list:[source.memberId]});return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:appUser}],invalid_userid_list:[]}));}
   assert.equal(url.pathname,'/cgi-bin/message/send');assert.equal(body.touser,appUser);assert.equal(body.agentid,1000002);assert.equal(body.msgtype,'template_card');
   const card=t25Object(body.template_card),action=t25Object(card.card_action);assert.equal(action.url,'https://reporter.example.test/wecom/yixiaoxiu/reports/'+source.requestRef);
   for(const denied of [source.memberId,source.scope.scopeHash,source.authority.channelAccountId,source.authority.mappingProofRef,'T25_PRIVATE_REPORT','T25_SYNTHETIC_SDK_TOKEN_NOT_A_CREDENTIAL'])assert.equal(JSON.stringify(body).includes(denied),false);
   return new Response(JSON.stringify({errcode:0,msgid:'T25_SYNTHETIC_PRIVATE_PROVIDER_MESSAGE_ID',invaliduser:'',invalidparty:'',invalidtag:''}));
  };
  const options:Parameters<typeof createP2016WeComSender>[0]&{appRoundNotifications:{pool:typeof context.pool;notifications:typeof source.appNotifications;agentId:number;accessTokenProvider:WeComAccessTokenProvider;fetchImpl:typeof fetch}}={
   gateway:{getAuthenticatedClient:()=>{throw Error('BOT_SDK_MUST_NOT_RECEIVE_APP');}},enabled:true,cardEnabled:true,allowedTargetHashes:[],reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',
   appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:Number(entryConfig.agentId),accessTokenProvider,fetchImpl}};
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender:createP2016WeComSender(options)});await worker.runOnce();
  const delivered=await t25Deliveries(source.http,source.ticketId);assert.equal(delivered.length,1);assert.ok(typeof pending[0]?.delivery_id==='string');assert.equal(delivered[0]?.delivery_id,pending[0]?.delivery_id);assert.equal(delivered[0]?.status,'SENT');assert.equal(delivered[0]?.attempt_count,1);assert.equal(delivered[0]?.side_effect_state,'ACKNOWLEDGED');
  assert.deepEqual(calls.map(call=>call.path),['/cgi-bin/batch/userid_to_openuserid','/cgi-bin/message/send']);await worker.runOnce();await source.round.runOnce();assert.deepEqual(await t25Deliveries(source.http,source.ticketId),delivered);assert.equal(calls.length,2);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
  assert.equal(JSON.stringify(delivered).includes(appUser),false);assert.equal(JSON.stringify(delivered).includes('T25_SYNTHETIC_PRIVATE_PROVIDER_MESSAGE_ID'),false);
 },{manualRoundConsumption:true});
});

test('an application send reply without a verifiable message id stays UNKNOWN and never automatically sends again',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const pending=await t25Deliveries(source.http,source.ticketId);assert.equal(pending.length,1);let sends=0;
  const accessTokenProvider:WeComAccessTokenProvider=async()=> 'T25_SYNTHETIC_SDK_TOKEN_NOT_A_CREDENTIAL';
  const fetchImpl:typeof fetch=async(input,init)=>{
   assert.ok(init?.signal instanceof AbortSignal);init.signal.throwIfAborted();assert.ok(typeof init.body==='string');
   const path=new URL(input instanceof Request?input.url:String(input)).pathname,body=t25Object(JSON.parse(init.body));
   if(path==='/cgi-bin/batch/userid_to_openuserid'){assert.deepEqual(body,{userid_list:[source.memberId]});return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_QUALIFIED_APP_OPEN_USER_A'}]}));}
   assert.equal(path,'/cgi-bin/message/send');assert.equal(body.touser,'T25_QUALIFIED_APP_OPEN_USER_A');sends++;return new Response('{"errcode":0}');
  };
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('BOT_SDK_MUST_NOT_RECEIVE_APP');}},enabled:true,cardEnabled:true,allowedTargetHashes:[],reporterAccess:context.runtime.reporterAccess,
   origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:Number(entryConfig.agentId),accessTokenProvider,fetchImpl}});
  const worker=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender});await worker.runOnce();const observed=await t25Deliveries(source.http,source.ticketId);
  assert.equal(sends,1);assert.equal(observed[0]?.delivery_id,pending[0]?.delivery_id);assert.equal(observed[0]?.status,'RECONCILIATION_REQUIRED');assert.equal(observed[0]?.side_effect_state,'UNKNOWN');assert.equal(observed[0]?.attempt_count,1);
  await worker.runOnce();await source.round.runOnce();assert.equal(sends,1);assert.deepEqual(await t25Deliveries(source.http,source.ticketId),observed);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
 },{manualRoundConsumption:true});
});
