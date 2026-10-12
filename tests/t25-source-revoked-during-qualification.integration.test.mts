import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import type {TicketAppNotificationOptions} from '../contracts/workbench_app_notification_contracts.js';

test('revoking the retained H5 source during the final local qualification never sends its original App intent',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const before=await t25Deliveries(source.http,source.ticketId);assert.equal(before.length,1);
  let qualified=0,revoked=false,revocation:Promise<unknown>|undefined,conversions=0,sends=0;
  const notifications:TicketAppNotificationOptions={...source.appNotifications,targetResolver:{localOnly:true,async resolveCurrentTarget(input){
   qualified++;
   if(qualified===3){
    // External source withdrawal only: the original member/mapping remains ELIGIBLE.
    // It may wait for the production authorization lock; drain it before fixture cleanup.
    revocation=context.pool.query('UPDATE intake.web_request_binding SET revoked_at=platform.local_now() WHERE request_ref=$1',[source.requestRef]);
    await revocation;revoked=true;
   }
   return source.appNotifications.targetResolver.resolveCurrentTarget(input);
  }}};
  const fetchImpl:typeof fetch=async(input,init)=>{
   assert.ok(typeof init?.body==='string');const path=new URL(input instanceof Request?input.url:String(input)).pathname,body=t25Object(JSON.parse(init.body));
   if(path==='/cgi-bin/batch/userid_to_openuserid'){conversions++;assert.deepEqual(body,{userid_list:[source.memberId]});return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_REVOKED_SOURCE_OPEN_A'}]}));}
   assert.equal(path,'/cgi-bin/message/send');sends++;return new Response('{"errcode":0,"msgid":"T25_REVOKED_SOURCE_SYNTHETIC_ACK"}');
  };
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',
   appRoundNotifications:{pool:context.pool,notifications,agentId:Number(entryConfig.agentId),accessTokenProvider:async()=> 'T25_REVOKED_SOURCE_SYNTHETIC_TOKEN',fetchImpl}});
  try{
   await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();if(revocation)await revocation;
   const after=await t25Deliveries(source.http,source.ticketId);console.log('T25_SOURCE_REVOKED_TRACE '+JSON.stringify({qualified,revoked,conversions,sends,before,after}));
   assert.equal(revoked,true);assert.equal(conversions,1);assert.equal(sends,0,'the retained source and current qualification must stay jointly authorized across the final local await');
   assert.equal(after[0]?.delivery_id,before[0]?.delivery_id);assert.equal(after[0]?.status,'DEAD_LETTER');assert.equal(after[0]?.side_effect_state,'NOT_ATTEMPTED');
   await assert.rejects(source.store.getRequest({scope:source.scope,requestRef:source.requestRef}),error=>error instanceof Error&&'code' in error&&error.code==='YXX_NOT_FOUND');
   const {web_report:originalReport,...core}=source.started;assert.ok(originalReport);const current=await source.http.detail(source.ticketId);assert.equal(current.web_report,undefined);assert.deepEqual(current,core);
  }finally{if(revocation)await revocation;}
 },{manualRoundConsumption:true});
});
