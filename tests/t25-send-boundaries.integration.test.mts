import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import type {CommunicationSenderRequest} from '../contracts/communication_contracts.js';

test('actual App Sender defaults and single-PERSON guards refuse broadcast, bulk syntax and closed profiles before any SDK call',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();let tokens=0,sdkCalls=0,sends=0;
  const options={gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],
   appRoundNotifications:{pool:context.pool,notifications:source.appNotifications,agentId:1000002,accessTokenProvider:async()=>{tokens++;return 'T25_BOUNDARY_SYNTHETIC_TOKEN';},fetchImpl:async(input:Parameters<typeof fetch>[0])=>{sdkCalls++;const path=new URL(input instanceof Request?input.url:String(input)).pathname;
    if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_BOUNDARY_QUALIFIED_OPEN_A'}]}));
    assert.equal(path,'/cgi-bin/message/send');sends++;return new Response('{"errcode":0,"msgid":"T25_BOUNDARY_SYNTHETIC_ACK"}');}}};
  const defaultOff=createP2016WeComSender(options),cardOff=createP2016WeComSender({...options,enabled:true,linkMode:'MEMBER_REQUIRED'}),legacy=createP2016WeComSender({...options,enabled:true,cardEnabled:true}),appOff=createP2016WeComSender({...options,enabled:true,cardEnabled:true,linkMode:'MEMBER_REQUIRED',appRoundNotifications:{...options.appRoundNotifications,notifications:{...source.appNotifications,enabled:false}}});
  assert.throws(()=>createP2016WeComSender({...options,enabled:true,cardEnabled:true,linkMode:'MEMBER_REQUIRED',appRoundNotifications:{...options.appRoundNotifications,notifications:{...source.appNotifications,authority:{...source.authority,validationProfile:'DEPLOYMENT'}}}}),/P2_016_FLAG_INVALID/u);
  const actual=createP2016WeComSender({...options,enabled:true,cardEnabled:true,linkMode:'MEMBER_REQUIRED'});
  const sender={async send(request:CommunicationSenderRequest){
   for(const disabled of [defaultOff,cardOff,legacy,appOff])assert.equal((await disabled.send(request)).outcome,'REJECTED_NOT_APPLIED');
   for(const target of ['@all',source.memberId+'|OTHER_MEMBER',source.memberId+';OTHER_MEMBER','OTHER_MEMBER\n'+source.memberId])assert.equal((await actual.send({...request,target_id:target})).outcome,'REJECTED_NOT_APPLIED');
   assert.equal((await actual.send({...request,target_type:'GROUP'})).outcome,'REJECTED_NOT_APPLIED');assert.equal((await actual.send({...request,channel_account_id:'OTHER_APP_ACCOUNT'})).outcome,'REJECTED_NOT_APPLIED');
   assert.equal(tokens,0);assert.equal(sdkCalls,0);return actual.send(request);
  }};
  await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();assert.equal(tokens,1);assert.equal(sdkCalls,2);assert.equal(sends,1);const delivered=await t25Deliveries(source.http,source.ticketId);assert.equal(delivered[0]?.status,'SENT');assert.equal(delivered[0]?.attempt_count,1);assert.deepEqual(await source.http.detail(source.ticketId),source.started);
 },{manualRoundConsumption:true});
});
