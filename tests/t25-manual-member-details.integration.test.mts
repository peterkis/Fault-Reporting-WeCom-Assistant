import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,randomUUID} from 'node:crypto';
import {withT25ManualFixture} from './helpers/t25-app-notification-fixture.mjs';
import {createT18Directory} from './helpers/t18-verified-fixture.mjs';
import {t11Http} from './helpers/t11-completion-fixture.mjs';
import {t25Object,t25Deliveries} from './helpers/t25-web-origin-fixture.mjs';
import {entryConfig,entryKey,entryOrigin,httpBrowser,loginYxx} from './helpers/p2-g2-yixiaoxiu-fixture.mjs';
import {createYxxDelegatedIdentityMapping} from '../app/server/src/p2-g2-yixiaoxiu-delegated-identity.mjs';
import {createP2016WeComSender} from '../app/server/src/p2-016-wecom-sender.mjs';
import {createCommunicationDeliveryWorker} from '../app/server/src/p2-004-communication-delivery-worker.mjs';
import {assertEpochMsString,formatEpochMsToShanghaiLocal} from '../app/server/src/platform/time-contract.mjs';
import type {TicketAppNotificationOptions,EligibleTicketAppNotificationTarget} from '../contracts/workbench_app_notification_contracts.js';

test('the actual verified MANUAL app card reauthenticates and reveals safe details only to its original member',{timeout:240000},async()=>{
 const memberA='T25_MANUAL_INTERNAL_A',memberB='T25_MANUAL_INTERNAL_B',bindingProof='T25_MANUAL_PRIVATE_BINDING_PROOF';
 const config={...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:[memberA,memberB]};
 const identityMapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'T25_MAPPING_SYNTHETIC_TOKEN',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:memberA,open_userid:'T25_MANUAL_OPEN_A'},{userid:memberB,open_userid:'T25_MANUAL_OPEN_B'}]}))});
 const source=createT18Directory(null,{application:{sourceCorpScope:config.corpId,sourceAppScope:config.agentId},memberId:memberA,scopeSecret:entryKey,mappingHash:identityMapping.configHash,mappingProof:config.proofRef,bindingProof});
 const scopeHash=createHmac('sha256',entryKey).update(JSON.stringify(['member',config.corpId,config.agentId,memberA])).digest('hex');
 const appNotifications:TicketAppNotificationOptions={enabled:true,authority:{...source.directory.application,channelAccountId:'T25_MANUAL_APP_ACCOUNT',mappingConfigHash:identityMapping.configHash,mappingProofRef:config.proofRef,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'},targetResolver:{localOnly:true,async resolveCurrentTarget(input){
  assert.equal(input.source_kind,'VERIFIED_MANUAL_REPORT');assert.equal(input.scope.scopeHash,scopeHash);input.signal.throwIfAborted();const epoch=assertEpochMsString(String(Date.now()));
  const result:EligibleTicketAppNotificationTarget={schema_version:1,state:'ELIGIBLE',source_kind:'VERIFIED_MANUAL_REPORT',scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(epoch),checked_at_epoch_ms:epoch,
   target:{provider:'WECOM_APP',channel_account_id:'T25_MANUAL_APP_ACCOUNT',target_type:'PERSON',target_id:memberA},verification:{mapping_config_hash:identityMapping.configHash,mapping_proof_ref:config.proofRef,binding_proof_ref:bindingProof,proof_kind:'SYNTHETIC',account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};return result;
 }}};
 await withT25ManualFixture(async context=>{
  const actor=context.principals[0];assert.ok(actor);source.setPrincipal(actor.id);const http=await t11Http(context,0,{closeConnections:true}),cookie=context.cookies[0];assert.ok(cookie);
  const bootstrap=t25Object(await (await http.get('/api/lifecycle/bootstrap')).json()),csrf=bootstrap.csrf_token;assert.ok(typeof csrf==='string');
  const candidateRead=await http.get('/api/workbench/reporter-candidates?q='+encodeURIComponent('合成成员'));assert.equal(candidateRead.status,200);const candidates=t25Object(await candidateRead.json()).candidates;assert.ok(Array.isArray(candidates));const candidate=t25Object(candidates[0]);
  const command={schema_version:1,client_command_id:randomUUID(),source:'ON_SITE',description:'T25_MANUAL_PRIVATE_DESCRIPTION：打印机无法打印，请协助处理。',location:{text:'合成门诊',unknown:false},reporter:{verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version}};
  const admitted=await fetch(context.origin+'/api/workbench/reports',{method:'POST',headers:{cookie,connection:'close',origin:context.origin,'content-type':'application/json','idempotency-key':command.client_command_id,'x-csrf-token':csrf},body:JSON.stringify(command)});const report=t25Object(await admitted.json());assert.equal(admitted.status,202,JSON.stringify(report));assert.equal(report.source,'ON_SITE');assert.equal(report.reporter_verification,'VERIFIED');
  const ticketId=t25Object(report.ticket).id;assert.ok(typeof ticketId==='string');const started=await http.start(ticketId);await context.runtime.roundNotifications.runOnce();assert.equal((await t25Deliveries(http,ticketId))[0]?.status,'PENDING');let cardUrl:string|null=null,sends=0;
  const fetchImpl:typeof fetch=async(input,init)=>{assert.ok(typeof init?.body==='string');const path=new URL(input instanceof Request?input.url:String(input)).pathname;
   if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:memberA,open_userid:'T25_MANUAL_OPEN_A'}]}));
   assert.equal(path,'/cgi-bin/message/send');const body=t25Object(JSON.parse(init.body));assert.equal(body.touser,'T25_MANUAL_OPEN_A');assert.equal(body.agentid,1000002);const action=t25Object(t25Object(body.template_card).card_action);assert.ok(typeof action.url==='string');cardUrl=action.url;sends++;return new Response('{"errcode":0,"msgid":"T25_MANUAL_SYNTHETIC_ACK"}');};
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('BOT_SDK_MUST_NOT_RECEIVE_MANUAL');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:entryOrigin,allowedHosts:['entry.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:appNotifications,agentId:1000002,accessTokenProvider:async()=> 'T25_SEND_SYNTHETIC_TOKEN',fetchImpl}});
  await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();assert.equal(sends,1);assert.equal((await t25Deliveries(http,ticketId))[0]?.status,'SENT');assert.ok(cardUrl);const cardPath=new URL(cardUrl).pathname;assert.match(cardPath,/^\/wecom\/yixiaoxiu\/tickets\/[A-Za-z0-9_-]{32}$/u);const publicRef=cardPath.split('/').at(-1);assert.ok(publicRef);
  const anonymous=httpBrowser(context.origin);assert.equal((await anonymous.request('/api/reporter/tickets/'+publicRef)).status,401);const owner=httpBrowser(context.origin);assert.equal(await loginYxx(owner,{path:cardPath,code:'manual-a-first'}),cardPath);assert.equal((await owner.request(cardPath)).status,200);
  console.log('T25_MANUAL_MEMBER_TRACE ACTUAL_CARD_AND_OAUTH_MEMBER_REACHED');
  const detailResponse=await owner.request('/api/reporter/tickets/'+publicRef),detail=t25Object(await detailResponse.json());assert.equal(detailResponse.status,200,JSON.stringify(detail));assert.equal(detail.public_ref,publicRef);assert.equal(detail.external_status,'处理中');
  for(const secret of [memberA,memberB,scopeHash,bindingProof,identityMapping.configHash,actor.id,'T25_MANUAL_PRIVATE_DESCRIPTION'])assert.equal(JSON.stringify(detail).includes(secret),false);
  assert.doesNotMatch(String(detail.guidance),/机器人单聊/u);const etag=detailResponse.headers.get('etag');assert.ok(etag);
  const other=httpBrowser(context.origin);await loginYxx(other,{code:'manual-b-first'});assert.equal((await other.request('/api/reporter/tickets/'+publicRef,{headers:{'if-none-match':etag}})).status,404);
  const completion=await http.post(ticketId,'complete',http.command(started));assert.equal(completion.status,200);await context.runtime.roundNotifications.runOnce();await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();assert.equal(sends,2);
  const timelineResponse=await owner.request('/api/reporter/tickets/'+publicRef+'/timeline');assert.equal(timelineResponse.status,200);const timeline=JSON.stringify(await timelineResponse.json());assert.ok(timeline.includes('打印服务已恢复'));assert.equal(timeline.includes('INTERNAL_T11_CANARY'),false);assert.equal(timeline.includes('T25_MANUAL_PRIVATE_DESCRIPTION'),false);
  assert.equal((await owner.request('/api/reporter/logout',{method:'POST',headers:{origin:entryOrigin,'content-type':'application/json'},body:'{}'})).status,200);assert.equal((await owner.request('/api/reporter/tickets/'+publicRef)).status,401);assert.equal(await loginYxx(owner,{path:cardPath,code:'manual-a-refreshed'}),cardPath);assert.equal((await owner.request('/api/reporter/tickets/'+publicRef)).status,200);
 },source.directory,{reporterOrigin:entryOrigin,reporterMemberEntry:config,identityMapping,appNotifications,wecomWebOAuth:{enabled:true,corpId:config.corpId,agentId:config.agentId,resolveCode:async code=>({userid:code.startsWith('manual-b')?'T25_MANUAL_OPEN_B':'T25_MANUAL_OPEN_A'})}});
});
