import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries,t25Object} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
import type {IneligibleTicketAppNotificationTarget,TicketAppNotificationOptions} from '../contracts/workbench_app_notification_contracts.js';

test('current member qualification revoked during a real source DB wait prevents the original App send',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const before=await t25Deliveries(source.http,source.ticketId);assert.equal(before.length,1);
  const holder=await context.pool.connect();let held=false,pending:Promise<unknown>|undefined,qualified=0,revoked=false,conversions=0,sends=0;
  const notifications:TicketAppNotificationOptions={...source.appNotifications,targetResolver:{localOnly:true,async resolveCurrentTarget(input){
   qualified++;
   if(qualified===2){
    await holder.query('BEGIN');held=true;
    // Only hold the actual retained original binding. No business/source field is changed.
    await holder.query('SELECT intake_id FROM intake.web_request_binding WHERE request_ref=$1 FOR UPDATE',[source.requestRef]);
   }
   if(revoked){const epoch=assertEpochMsString(String(Date.now()));const result:IneligibleTicketAppNotificationTarget={schema_version:1,state:'NOT_ELIGIBLE',reason:'REVOKED',source_kind:input.source_kind,scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(epoch),checked_at_epoch_ms:epoch};return result;}
   return source.appNotifications.targetResolver.resolveCurrentTarget(input);
  }}};
  const fetchImpl:typeof fetch=async(input,init)=>{
   assert.ok(typeof init?.body==='string');const path=new URL(input instanceof Request?input.url:String(input)).pathname,body=t25Object(JSON.parse(init.body));
   if(path==='/cgi-bin/batch/userid_to_openuserid'){conversions++;assert.deepEqual(body,{userid_list:[source.memberId]});return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_WAIT_OPEN_A'}]}));}
   assert.equal(path,'/cgi-bin/message/send');sends++;return new Response('{"errcode":0,"msgid":"T25_WAIT_SYNTHETIC_ACK"}');
  };
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',
   appRoundNotifications:{pool:context.pool,notifications,agentId:Number(entryConfig.agentId),accessTokenProvider:async()=> 'T25_WAIT_SYNTHETIC_TOKEN',fetchImpl}});
  try{
   const pid=(await holder.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]?.pid;assert.ok(pid);
   pending=createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();
   let observed=false;const deadline=performance.now()+2000;
   do{
    const waiting=await context.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid)) AND strpos(query,'FROM intake.service_intake i JOIN intake.web_request_binding b')>0",[pid]);
    if(waiting.rowCount===1){observed=true;break;}await delay(10);
   }while(performance.now()<deadline);
   assert.equal(observed,true,'the real Worker must reach the original-source DB wait after current qualification');
   revoked=true;await holder.query('ROLLBACK');held=false;await pending;
   const after=await t25Deliveries(source.http,source.ticketId);console.log('T25_LAST_AWAIT_TRACE '+JSON.stringify({observed,revoked,qualified,conversions,sends,before,after}));
   assert.equal(conversions,1);assert.equal(sends,0,'current revoked local qualification must be checked after all retained-source/binding awaits');
   assert.equal(after[0]?.delivery_id,before[0]?.delivery_id);assert.equal(after[0]?.status,'DEAD_LETTER');assert.equal(after[0]?.side_effect_state,'NOT_ATTEMPTED');assert.deepEqual(await source.http.detail(source.ticketId),source.started);
  }finally{
   try{if(held){await holder.query('ROLLBACK');held=false;}if(pending)await pending.catch(()=>undefined);}
   finally{holder.release();}
  }
 },{manualRoundConsumption:true});
});
