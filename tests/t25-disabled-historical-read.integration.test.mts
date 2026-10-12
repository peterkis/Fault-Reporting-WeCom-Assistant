import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,randomUUID} from 'node:crypto';
import {withT25ManualFixture} from './helpers/t25-app-notification-fixture.mjs';
import {createT18Directory} from './helpers/t18-verified-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {t25Object,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig,entryKey,entryOrigin,httpBrowser,loginYxx} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createP2016WeComSender} from '../src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../src/p2-004-communication-delivery-worker.mjs';
import {createWeComWebOAuth} from '../src/p2-g2-wecom-web-oauth.mjs';
import {createYxxProfile} from '../src/p2-g2-yixiaoxiu-profile.mjs';
import {createTicketRoundNotifications} from '../src/workbench-ticket-round-notifications.mjs';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from '../src/platform/time-contract.mjs';
import type {TicketAppNotificationOptions,EligibleTicketAppNotificationTarget} from '../contracts/workbench_app_notification_contracts.js';

test('notification shutdown stops new App intents while independently authenticated members retain their safe original MANUAL history',{timeout:240000},async()=>{
 const memberA='T25_DISABLED_INTERNAL_A',memberB='T25_DISABLED_INTERNAL_B',bindingProof='T25_DISABLED_PRIVATE_PROOF';
 const source=createT18Directory(null,{application:{sourceCorpScope:entryConfig.corpId,sourceAppScope:entryConfig.agentId},memberId:memberA,scopeSecret:entryKey,mappingProof:entryConfig.proofRef,bindingProof});
 const canonical=createHmac('sha256',entryKey).update(JSON.stringify(['member',entryConfig.corpId,entryConfig.agentId,memberA])).digest('hex');let qualifications=0,sends=0,cardPath:string|null=null;
 const appNotifications:TicketAppNotificationOptions={enabled:true,authority:{...source.directory.application,channelAccountId:'T25_DISABLED_APP_ACCOUNT',mappingConfigHash:'c'.repeat(64),mappingProofRef:entryConfig.proofRef,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'},targetResolver:{localOnly:true,async resolveCurrentTarget(input){
  qualifications++;assert.equal(input.source_kind,'VERIFIED_MANUAL_REPORT');assert.equal(input.scope.scopeHash,canonical);input.signal.throwIfAborted();const epoch=assertEpochMsString(String(Date.now()));
  const result:EligibleTicketAppNotificationTarget={schema_version:1,state:'ELIGIBLE',source_kind:input.source_kind,scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(epoch),checked_at_epoch_ms:epoch,
   target:{provider:'WECOM_APP',channel_account_id:'T25_DISABLED_APP_ACCOUNT',target_type:'PERSON',target_id:memberA},verification:{mapping_config_hash:'c'.repeat(64),mapping_proof_ref:entryConfig.proofRef,binding_proof_ref:bindingProof,proof_kind:'SYNTHETIC',account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};return result;
 }}};
 const resolveCode=async(code:string)=>({userid:code.startsWith('disabled-b')?memberB:memberA});
 await withT25ManualFixture(async context=>{
  const actor=context.principals[0];assert.ok(actor);source.setPrincipal(actor.id);const http=await t11Http(context,0,{closeConnections:true}),cookie=context.cookies[0];assert.ok(cookie);
  const csrf=t25Object(await (await http.get('/api/lifecycle/bootstrap')).json()).csrf_token;assert.ok(typeof csrf==='string');
  const candidates=t25Object(await (await http.get('/api/workbench/reporter-candidates?q='+encodeURIComponent('合成成员'))).json()).candidates;assert.ok(Array.isArray(candidates));const candidate=t25Object(candidates[0]);
  const command={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'打印机无法打印处方，设备发生故障，请协助处理。',location:{text:'合成门诊',unknown:false},reporter:{verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version}};
  const admission=await fetch(context.origin+'/api/workbench/reports',{method:'POST',headers:{cookie,connection:'close',origin:context.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});const report=t25Object(await admission.json());assert.equal(admission.status,202,JSON.stringify(report));const id=t25Object(report.ticket).id;assert.ok(typeof id==='string');
  const started=await http.start(id);await context.runtime.roundNotifications.runOnce();const before=await t25Deliveries(http,id);assert.equal(before.length,1);
  // Actual Sender/Worker obtains the original opaque card coordinate; only SDK HTTP is simulated.
  const fetchImpl:typeof fetch=async(input,init)=>{
   assert.ok(typeof init?.body==='string');const path=new URL(input instanceof Request?input.url:String(input)).pathname;
   if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:memberA,open_userid:'T25_DISABLED_OPEN_A'}]}));
   assert.equal(path,'/cgi-bin/message/send');sends++;const card=t25Object(t25Object(JSON.parse(init.body)).template_card),url=t25Object(card.card_action).url;assert.ok(typeof url==='string');cardPath=new URL(url).pathname;return new Response('{"errcode":0,"msgid":"T25_DISABLED_SYNTHETIC_ACK"}');
  };
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('NO_BOT_SDK');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:entryOrigin,allowedHosts:['entry.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:appNotifications,agentId:Number(entryConfig.agentId),accessTokenProvider:async()=> 'T25_DISABLED_SYNTHETIC_TOKEN',fetchImpl}});
  await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();assert.equal(sends,1);assert.ok(cardPath);const publicRef=cardPath.split('/').at(-1);assert.ok(publicRef);
  const owner=httpBrowser(context.origin);assert.equal(await loginYxx(owner,{path:cardPath,code:'disabled-a-external-off'}),cardPath);const externalOff=await owner.request('/api/reporter/tickets/'+publicRef);assert.equal(externalOff.status,200);console.log('T25_DISABLED_READ_TRACE EXTERNAL_SEND_FALSE_OWN_HISTORY_200');
  assert.equal((await http.post(id,'complete',http.command(started))).status,200);const closed=await http.detail(id),frozen=await t25Deliveries(http,id),disabled={...appNotifications,enabled:false};
  const qualificationBaseline=qualifications;await createTicketRoundNotifications({pool:context.pool,enabled:true,botId:entryConfig.botId,reporterAccess:context.runtime.reporterAccess,appNotifications:disabled}).runOnce();assert.equal(qualifications,qualificationBaseline);assert.deepEqual(await t25Deliveries(http,id),frozen);
  await context.runtime.stop();
  const app=createYxxProfile({profile:'MEMBER_TICKET_READONLY',pool:context.pool,publicOrigin:entryOrigin,reporterHmacSecret:entryKey,reporterMemberEntry:entryConfig,appNotifications:disabled,
   oauth:createWeComWebOAuth({enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,publicOrigin:entryOrigin,resolveCode})});
  try{
   const listening=await app.start(),current=httpBrowser('http://127.0.0.1:'+listening.port);assert.equal(await loginYxx(current,{path:cardPath,code:'disabled-a-app-off'}),cardPath);
   const detail=await current.request('/api/reporter/tickets/'+publicRef),body=t25Object(await detail.json());console.log('T25_DISABLED_READ_TRACE '+JSON.stringify({app_enabled:false,status:detail.status,body,sends,qualifications}));assert.equal(detail.status,200,'notification enablement must not grant or revoke independent own-history READ');assert.equal(body.external_status,'已关闭');
   for(const privateValue of [memberA,memberB,canonical,bindingProof,'T25_DISABLED_APP_ACCOUNT'])assert.equal(JSON.stringify(body).includes(privateValue),false);
   const other=httpBrowser('http://127.0.0.1:'+listening.port);await loginYxx(other,{path:cardPath,code:'disabled-b-app-off'});assert.equal((await other.request('/api/reporter/tickets/'+publicRef)).status,404);
   assert.equal((await current.request('/api/reporter/tickets/'+publicRef+'/timeline')).status,200);assert.equal(qualifications,qualificationBaseline);assert.equal(sends,1);assert.equal(closed.status,'CLOSED');
  }finally{await app.stop();assert.equal(app.server.listening,false);}
 },source.directory,{reporterOrigin:entryOrigin,appNotifications,wecomWebOAuth:{enabled:true,corpId:entryConfig.corpId,agentId:entryConfig.agentId,resolveCode}});
});
