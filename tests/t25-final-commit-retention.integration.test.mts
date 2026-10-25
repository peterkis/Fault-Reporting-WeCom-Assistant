import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {withT24Fixture} from './helpers/t24-round-notification-fixture.mjs';
import {t25WebOrigin,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {createP2016WeComSender} from '../app/server/src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import type {PostgresPool} from '../app/server/src/platform/postgres-pool.mjs';

/** Pass every operation through the real PG driver; delay only a successful Sender COMMIT return. */
function holdCommittedReturn(pool:PostgresPool,afterCommit:()=>Promise<void>):PostgresPool{
 return new Proxy(pool,{get(target,key):unknown{
  if(key==='connect')return async()=>new Proxy(await target.connect(),{get(client,property):unknown{
   if(property==='query')return(first:unknown,second:unknown,third:unknown):unknown=>{
    const result:unknown=Reflect.apply(client.query,client,[first,second,third]);
    if(first!=='COMMIT')return result;assert.ok(result instanceof Promise);return result.then(async value=>{await afterCommit();return value;});
   };
   const value:unknown=Reflect.get(client,property,client);return typeof value==='function'?value.bind(client):value;
  }});
  const value:unknown=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
}

test('naturally expired original source retention after the final real COMMIT wait refuses App sending without changing the original intent',{timeout:240000},async()=>{
 await withT24Fixture(async context=>{
  const source=await t25WebOrigin(context);await source.round.runOnce();const before=await t25Deliveries(source.http,source.ticketId);assert.equal(before.length,1);
  const {web_report:_report,...coreBefore}=source.started;const expiry=(await context.pool.query<{epoch:string}>('SELECT (platform.physical_epoch_ms()+2000)::text AS epoch')).rows[0]?.epoch;assert.ok(expiry);
  await context.pool.query('UPDATE intake.web_request_binding SET retention_until=platform.local_from_epoch_ms($2::bigint),retention_until_epoch_ms=$2::bigint WHERE request_ref=$1',[source.requestRef,expiry]);
  let commits=0,qualified=0,conversions=0,sends=0,expiredAfterCommit=false;
  const senderPool=holdCommittedReturn(context.pool,async()=>{commits++;await delay(2100);const now=(await context.pool.query<{epoch:string}>('SELECT platform.physical_epoch_ms()::text AS epoch')).rows[0]?.epoch;assert.ok(now);expiredAfterCommit=BigInt(now)>=BigInt(expiry);assert.equal(expiredAfterCommit,true);});
  const notifications={...source.appNotifications,targetResolver:{localOnly:true as const,async resolveCurrentTarget(input:Parameters<typeof source.appNotifications.targetResolver.resolveCurrentTarget>[0]){qualified++;return source.appNotifications.targetResolver.resolveCurrentTarget(input);}}};
  const fetchImpl:typeof fetch=async(input,init)=>{assert.ok(init?.signal instanceof AbortSignal);init.signal.throwIfAborted();const path=new URL(input instanceof Request?input.url:String(input)).pathname;
   if(path==='/cgi-bin/batch/userid_to_openuserid'){conversions++;return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:source.memberId,open_userid:'T25_COMMIT_RETENTION_OPEN_A'}]}));}
   assert.equal(path,'/cgi-bin/message/send');sends++;assert.equal(expiredAfterCommit,true);return new Response('{"errcode":0,"msgid":"T25_EXPIRED_COMMIT_ACK"}');};
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',
   appRoundNotifications:{pool:senderPool,notifications,agentId:1000002,accessTokenProvider:async()=> 'T25_COMMIT_RETENTION_SYNTHETIC_TOKEN',fetchImpl}});
  await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();const after=await t25Deliveries(source.http,source.ticketId);console.log('T25_COMMIT_RETENTION_TRACE '+JSON.stringify({commits,qualified,conversions,sends,expiredAfterCommit,before,after}));
  assert.equal(commits,1);assert.equal(qualified,3);assert.equal(conversions,1);assert.equal(expiredAfterCommit,true);assert.equal(sends,0);assert.equal(after[0]?.delivery_id,before[0]?.delivery_id);assert.equal(after[0]?.status,'DEAD_LETTER');assert.equal(after[0]?.side_effect_state,'NOT_ATTEMPTED');
  await source.round.runOnce();assert.deepEqual(await t25Deliveries(source.http,source.ticketId),after);const detail=await source.http.detail(source.ticketId);assert.equal(detail.web_report,undefined);const {web_report:_afterReport,...coreAfter}=detail;assert.deepEqual(coreAfter,coreBefore);
 },{manualRoundConsumption:true});
});
