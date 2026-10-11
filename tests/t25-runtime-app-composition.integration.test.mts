import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {entryConfig,entryKey} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016Runtime} from '../src/p2-016-runtime.mjs';
import type {WeComAccessTokenProvider} from '../src/p2-g2-wecom-oauth-provider.mjs';

test('the existing runtime schedules one app round consumer and Communication Worker behind its send authorization',{timeout:240000},async()=>{
 await withT24Fixture(async original=>{
  const source=await t25WebOrigin(original),retiringHttp=await t11Http(original,0,{closeConnections:true});assert.deepEqual(await t25Deliveries(retiringHttp,source.ticketId),[]);await original.runtime.stop();let sends=0,conversions=0;
  const accessTokenProvider:WeComAccessTokenProvider=async options=>{options?.signal?.throwIfAborted();return 'T25_RUNTIME_SYNTHETIC_TOKEN_NOT_A_CREDENTIAL';};
  const fetchImpl:typeof fetch=async(input,init)=>{
   assert.ok(init?.signal instanceof AbortSignal);init.signal.throwIfAborted();assert.ok(typeof init.body==='string');const body=t25Object(JSON.parse(init.body)),path=new URL(input instanceof Request?input.url:String(input)).pathname;
   if(path==='/cgi-bin/batch/userid_to_openuserid'){conversions++;assert.deepEqual(body,{userid_list:[source.memberId]});return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_RUNTIME_QUALIFIED_APP_USER_A'}]}));}
   assert.equal(path,'/cgi-bin/message/send');assert.equal(body.touser,'T25_RUNTIME_QUALIFIED_APP_USER_A');assert.equal(body.agentid,1000002);sends++;return new Response('{"errcode":0,"msgid":"T25_RUNTIME_SYNTHETIC_ACK"}');
  };
  // Only the external SDK HTTP leaf is fake. Runtime, scheduler, Core, consumer,
  // Sender factory, Worker and current principal cookies are their actual implementations.
  const options={pool:original.pool,publicOrigin:original.origin,listenPort:Number(new URL(original.origin).port),principalIds:[original.principals[0]?.id??'',original.outsider.id,original.principals[1]?.id??''],
   flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true as const,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},externalSendEnabled:true,senderEnabled:true,gatewayEnabled:false,
   liveApproval:{live:true,scope:true,send:true},ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketRoundNotificationsEnabled:true,
   reporterOrigin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],reporterHmacSecret:entryKey,reporterPolicy:'MEMBER_REQUIRED' as const,reporterMemberEntry:entryConfig,
   wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>{throw Error('NO_REAL_OAUTH');}},
   appNotifications:source.appNotifications,appNotificationTransport:{agentId:Number(entryConfig.agentId),accessTokenProvider,fetchImpl}};
  assert.throws(()=>createP2016Runtime({...options,liveApproval:null}),/P2_016_LIVE_APPROVAL_REQUIRED/u);assert.equal(sends,0);
  console.log('T25_RUNTIME_TRACE SOURCE_AND_EXISTING_SEND_APPROVAL_GUARD_REACHED');
  const runtime=createP2016Runtime(options);
  try{
   const started=await runtime.start();assert.ok(started.cookies);console.log('T25_RUNTIME_TRACE ACTUAL_RUNTIME_STARTED');
   const context={...original,runtime,cookies:started.cookies.map(cookie=>cookie.name+'='+cookie.value),browserCookies:started.cookies},http=await t11Http(context,0,{closeConnections:true});
   let observed:Record<string,unknown>[]=[];for(let n=0;n<100;n++){observed=await t25Deliveries(http,source.ticketId);if(observed.length===1&&observed[0]?.status==='SENT')break;await delay(50);}
   assert.deepEqual(observed.map(row=>({route:row.route_kind,type:row.destination_type,status:row.status,node:row.node})),[{route:'YIXIAOXIU_APP',type:'PERSON',status:'SENT',node:'FIRST_RESPONSIBILITY'}]);
   assert.equal(sends,1);assert.equal(conversions,1);await delay(1200);assert.equal(sends,1);assert.deepEqual(await t25Deliveries(http,source.ticketId),observed);assert.deepEqual(await http.detail(source.ticketId),source.started);
  }finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 },{manualRoundConsumption:true});
});
