import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {withT24Fixture} from './t24-round-notification-fixture.mjs';
import type {T11Fixture} from './t11-completion-fixture.mjs';
import {t11Http} from './t11-completion-fixture.mjs';
import {seedPersistedIntake} from './p2-015-postgres-harness.mjs';
import {createPilotTicketCore} from '../../src/p1-005-pilot-ticket-core.mjs';
import {createP2016Runtime} from '../../src/p2-016-runtime.mjs';
import {listenConversationWorkbenchServer} from '../../src/p2-006-workbench-http.mjs';
import {entryConfig,entryKey} from './p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016WeComSender} from '../../src/p2-016-wecom-sender.mjs';
export function t26Object(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
export async function withT26Fixture(run:(context:T11Fixture)=>Promise<void>){
 await withT24Fixture(async original=>{
  await original.runtime.stop();
  const runtime=createP2016Runtime({pool:original.pool,publicOrigin:original.origin,listenPort:Number(new URL(original.origin).port),principalIds:[original.principals[0]?.id??'',original.outsider.id,original.principals[1]?.id??''],
   flags:{TICKET_LIFECYCLE_WORKBENCH_ENABLED:true,REPORTER_TIMELINE_ENABLED:true,WECOM_TEMPLATE_CARD_ENABLED:true},externalSendEnabled:true,
   ticketSelfHandlingEnabled:true,ticketStaffCompletionEnabled:true,ticketRoundNotificationsEnabled:true,reporterOrigin:'https://reporter.example.test',reporterHmacSecret:entryKey,
   reporterPolicy:'MEMBER_REQUIRED',reporterMemberEntry:entryConfig,wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode:async()=>{throw Error('NO_REAL_OAUTH');}}});
  try{await listenConversationWorkbenchServer(runtime.server,{port:Number(new URL(original.origin).port)});const cookies=runtime.authenticate.browserCookies?.();assert.ok(cookies);await run({...original,runtime,cookies:cookies.map(c=>c.name+'='+c.value),browserCookies:cookies});}
  finally{await runtime.stop();assert.equal(runtime.server.listening,false);}
 },{manualRoundConsumption:true});
}
export async function t26Group(context:T11Fixture,tag:string){
 const intake=await seedPersistedIntake({pool:context.pool,text:'T26_PRIVATE_'+tag,chatType:'group',requestType:'INCIDENT',status:'RECEIVED',tag});
 const created=await createPilotTicketCore({pool:context.pool}).createForIntake({intakeId:intake.intakeId,occurredAt:intake.receivedAt,traceId:tag});assert.ok(created.ticket);
 const http=await t11Http(context),id=created.ticket.id,started=await http.start(id);await context.runtime.roundNotifications.runOnce();return {id,http,started,intake};
}
export async function t26Deliveries(http:Awaited<ReturnType<typeof t11Http>>,id:string){const response=await http.get('/api/tickets/'+id+'/deliveries');assert.equal(response.status,200);const data=t26Object(await response.json());assert.ok(Array.isArray(data.items));return data.items.map(t26Object);}
export async function t26Control(context:T11Fixture,index=0){
 const cookie=context.cookies[index];assert.ok(cookie);const response=await fetch(context.origin+'/api/lifecycle/bootstrap',{headers:{cookie}}),boot=t26Object(await response.json());assert.equal(typeof boot.csrf_token,'string');
 return (ticketId:string,deliveryId:string,action:'retry'|'reconcile',body:{client_command_id:string;reason_code:string;resolution?:string})=>fetch(context.origin+'/api/tickets/'+ticketId+'/deliveries/'+deliveryId+'/'+action,{method:'POST',headers:{cookie,origin:context.origin,'content-type':'application/json','idempotency-key':body.client_command_id,'x-csrf-token':String(boot.csrf_token)},body:JSON.stringify(body)});
}
export function t26Sender(context:T11Fixture,tag:string,{allowPerson=true,allowGroup=true,onPerson=async(_target:string,_body:unknown)=>({errcode:0}),fetchImpl=async()=>new Response('{"errcode":0}') as Response}:{allowPerson?:boolean;allowGroup?:boolean;onPerson?:(target:string,body:unknown)=>Promise<unknown>;fetchImpl?:typeof fetch}={}){
 return createP2016WeComSender({gateway:{getAuthenticatedClient:()=>({sendMessage:onPerson})},enabled:true,cardEnabled:true,allowedTargetHashes:allowPerson?[createHash('sha256').update('user-test').digest('hex')]:[],reporterAccess:context.runtime.reporterAccess,origin:'https://reporter.example.test',allowedHosts:['reporter.example.test'],linkMode:'MEMBER_REQUIRED',
  groupRoundNotifications:{pool:context.pool,routes:allowGroup?[{botId:'bot-test',groupId:'group-'+tag,url:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=t26-synthetic'}]:[],resolveMentionUserId:async()=> 't26-verified-webhook-user',fetchImpl}});
}
