import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
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
import {createYxxProfile} from '../app/server/src/p2-g2-yixiaoxiu-profile.mjs';
import type {WeComOAuth} from '../app/server/src/p2-g2-wecom-web-oauth.mjs';
import {createYxxBrowserFixture} from './helpers/p2-g2-yixiaoxiu-browser.mjs';
import {closeBrowserTestResources} from './helpers/p2-006-browser-harness.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

test('MANUAL owned reading never authorizes a Bot feedback receipt or Bot reopen command',{timeout:240000},async()=>{
 const member='T25_MANUAL_FEEDBACK_INTERNAL_A',bindingProof='T25_MANUAL_FEEDBACK_BINDING',config={...entryConfig,identityMode:'VERIFIED_DELEGATED_MAPPING',reporterUserIds:[member]};
 const mapping=await createYxxDelegatedIdentityMapping({config,accessTokenProvider:async()=> 'T25_SYNTHETIC_MAPPING_TOKEN',fetchImpl:async()=>new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:member,open_userid:'T25_MANUAL_FEEDBACK_OPEN_A'}]}))});
 const directory=createT18Directory(null,{application:{sourceCorpScope:config.corpId,sourceAppScope:config.agentId},memberId:member,scopeSecret:entryKey,mappingHash:mapping.configHash,mappingProof:config.proofRef,bindingProof});
 const appNotifications:TicketAppNotificationOptions={enabled:true,authority:{...directory.directory.application,channelAccountId:'T25_MANUAL_FEEDBACK_APP',mappingConfigHash:mapping.configHash,mappingProofRef:config.proofRef,proofKind:'SYNTHETIC',validationProfile:'ISOLATED_TEST'},targetResolver:{localOnly:true,async resolveCurrentTarget(input){input.signal.throwIfAborted();const epoch=assertEpochMsString(String(Date.now()));
  const target:EligibleTicketAppNotificationTarget={schema_version:1,state:'ELIGIBLE',source_kind:'VERIFIED_MANUAL_REPORT',scope:input.scope,checked_at:formatEpochMsToShanghaiLocal(epoch),checked_at_epoch_ms:epoch,target:{provider:'WECOM_APP',channel_account_id:'T25_MANUAL_FEEDBACK_APP',target_type:'PERSON',target_id:member},verification:{mapping_config_hash:mapping.configHash,mapping_proof_ref:config.proofRef,binding_proof_ref:bindingProof,proof_kind:'SYNTHETIC',account_status:'ACTIVE',binding_state:'VERIFIED',message_reachability:'REACHABLE'}};return target;
 }}};
 await withT25ManualFixture(async context=>{
  const principal=context.principals[0];assert.ok(principal);directory.setPrincipal(principal.id);const http=await t11Http(context,0,{closeConnections:true}),cookie=context.cookies[0];assert.ok(cookie);
  const staffBootstrap=t25Object(await (await http.get('/api/lifecycle/bootstrap')).json());assert.ok(typeof staffBootstrap.csrf_token==='string');const candidateResponse=await http.get('/api/workbench/reporter-candidates?q='+encodeURIComponent('合成成员'));assert.equal(candidateResponse.status,200);const candidates=t25Object(await candidateResponse.json()).candidates;assert.ok(Array.isArray(candidates));const candidate=t25Object(candidates[0]);
  const body={schema_version:1,client_command_id:randomUUID(),source:'PHONE',description:'打印机无法打印处方，设备发生故障，请协助处理。',location:{text:'合成门诊',unknown:false},reporter:{verification:'VERIFIED_SELECTION',candidate_ref:candidate.candidate_ref,candidate_version:candidate.candidate_version}};
  const admission=await fetch(context.origin+'/api/workbench/reports',{method:'POST',headers:{cookie,connection:'close',origin:context.origin,'content-type':'application/json','x-csrf-token':staffBootstrap.csrf_token,'idempotency-key':body.client_command_id},body:JSON.stringify(body)});const report=t25Object(await admission.json());assert.equal(admission.status,202,JSON.stringify(report));assert.ok(report.ticket,JSON.stringify(report));const ticketId=t25Object(report.ticket).id;assert.ok(typeof ticketId==='string');const active=await http.start(ticketId);assert.equal((await http.post(ticketId,'complete',http.command(active))).status,200);const completed=await http.detail(ticketId);await context.runtime.roundNotifications.runOnce();assert.equal((await t25Deliveries(http,ticketId)).length,2);
  let cardUrl:string|null=null;const fetchImpl:typeof fetch=async(input,init)=>{const path=new URL(input instanceof Request?input.url:String(input)).pathname;if(path==='/cgi-bin/batch/userid_to_openuserid')return new Response(JSON.stringify({errcode:0,open_userid_list:[{userid:member,open_userid:'T25_MANUAL_FEEDBACK_OPEN_A'}]}));assert.equal(path,'/cgi-bin/message/send');assert.ok(typeof init?.body==='string');const action=t25Object(t25Object(t25Object(JSON.parse(init.body)).template_card).card_action);assert.ok(typeof action.url==='string');cardUrl=action.url;return new Response('{"errcode":0,"msgid":"T25_MANUAL_FEEDBACK_ACK"}');};
  const sender=createP2016WeComSender({gateway:{getAuthenticatedClient:()=>{throw Error('BOT_SEND_FORBIDDEN');}},enabled:true,cardEnabled:true,reporterAccess:context.runtime.reporterAccess,origin:entryOrigin,allowedHosts:['entry.test'],linkMode:'MEMBER_REQUIRED',appRoundNotifications:{pool:context.pool,notifications:appNotifications,agentId:1000002,accessTokenProvider:async()=> 'T25_SYNTHETIC_SEND_TOKEN',fetchImpl}});await createCommunicationDeliveryWorker({pool:context.pool,enabled:true,sender}).runOnce();assert.ok(cardUrl);const path=new URL(cardUrl).pathname,ref=path.split('/').at(-1);assert.ok(ref);
  const owner=httpBrowser(context.origin);await loginYxx(owner,{path,code:'manual-feedback-owner'});const detail=await owner.request('/api/reporter/tickets/'+ref);assert.equal(detail.status,200);assert.equal(t25Object(await detail.json()).feedback_context,undefined);
  const bootstrapResponse=await owner.request('/api/reporter/feedback/bootstrap');assert.equal(bootstrapResponse.status,200);const bootstrap=t25Object(await bootstrapResponse.json());assert.equal(bootstrap.write_enabled,true);assert.ok(typeof bootstrap.csrf_token==='string');console.log('T25_MANUAL_BOT_TRACE MANUAL_READ_AND_EXISTING_BOT_PROFILE_REACHED');
  const commandId=randomUUID(),receipt=await owner.request('/api/reporter/tickets/'+ref+'/feedback/commands/'+commandId);const receiptBody:unknown=await receipt.json();assert.equal(receipt.status,404,JSON.stringify(receiptBody));
  const feedback={schema_version:1,client_command_id:commandId,expected_ticket_version:completed.version,completed_round_ref:'A'.repeat(32),feedback:'STILL_UNRESOLVED'};
  const submitted=await owner.request('/api/reporter/tickets/'+ref+'/feedback',{method:'POST',headers:{origin:entryOrigin,'content-type':'application/json','x-csrf-token':bootstrap.csrf_token,'idempotency-key':commandId,'if-match':'"'+completed.version+'"'},body:JSON.stringify(feedback)});assert.equal(submitted.status,404);assert.deepEqual(await http.detail(ticketId),completed);
  const memberApp=(oauth:WeComOAuth,publicOrigin:string)=>createYxxProfile({profile:'MEMBER_SELF_SERVICE',pool:context.pool,oauth,publicOrigin,reporterMemberEntry:config,identityMapping:mapping,reporterHmacSecret:entryKey,appNotifications,botReporterFeedbackEnabled:true,yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true},pollMilliseconds:100}});
  let browserFixture:Awaited<ReturnType<typeof createYxxBrowserFixture>>|undefined,browser:Awaited<ReturnType<NonNullable<typeof browserFixture>['launch']>>|undefined,memberRuntime:ReturnType<typeof memberApp>|undefined,browserError:unknown;
  try{
   browserFixture=await createYxxBrowserFixture({pool:context.pool,createApp:({oauth,origin})=>{memberRuntime=memberApp(oauth,origin);return memberRuntime.server;}});
   assert.ok(browserFixture);
   browserFixture.setMember('T25_MANUAL_FEEDBACK_OPEN_A');browser=await browserFixture.launch({width:390,height:844});assert.ok(browser);
   await browser.evaluate('location.assign('+JSON.stringify(path)+')',{awaitPromise:false});
   await browser.waitFor("document.querySelector('[data-h5-reporter=true]')&&document.querySelector('#ticket')?.hidden===false");
   assert.equal(await browser.evaluate('document.querySelector("#number")?.textContent.includes('+JSON.stringify(completed.ticket_no)+')'),true,'the original manual notification path opens its actual owned Ticket in new H5');
   assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-action=submit-bot-feedback]'))"),false,'MANUAL READ never becomes Bot feedback authority');
   assert.equal(await browser.evaluate("document.querySelector('#reporter-guidance')?.textContent.includes('联系工作人员')"),true);
   assert.equal(await browser.evaluate('document.documentElement.scrollWidth>innerWidth'),false);
   const receiptDirectory=join(tmpdir(),'ss010-ui-'+randomUUID());await mkdir(receiptDirectory);const file=join(receiptDirectory,randomUUID()+'.png'),bytes=Buffer.from(await browser.screenshot(),'base64');await writeFile(file,bytes);console.log('SS010_BROWSER '+JSON.stringify({screenshots:[{file,width:390,height:844,sha256:createHash('sha256').update(bytes).digest('hex')}]}));
   await browser.evaluate("document.querySelector('#logout').click()");await browser.waitFor("document.querySelector('#ticket')?.hidden===true&&document.querySelector('#status')?.textContent.includes('已退出')");
   browserFixture.setMember('T25_MANUAL_FEEDBACK_NOT_OWNER');await browser.evaluate('location.assign('+JSON.stringify(path)+')',{awaitPromise:false});
   await browser.waitFor("document.querySelector('[data-h5-reporter=true]')&&document.querySelector('#ticket')?.hidden===true&&/无权|失效/.test(document.querySelector('#status')?.textContent||'')");
   assert.equal(await browser.evaluate('document.body.textContent.includes('+JSON.stringify(completed.ticket_no)+')'),false,'a different member receives no previous manual Ticket facts');
  }catch(error){browserError=error;}
  finally{await closeBrowserTestResources([async()=>{await browser?.close();},async()=>{await browserFixture?.close();},async()=>{await memberRuntime?.stop();}],browserError);}
 },directory.directory,{reporterOrigin:entryOrigin,reporterMemberEntry:config,identityMapping:mapping,appNotifications,botReporterFeedbackEnabled:true,yxxSelfService:{featureFlags:{YIXIAOXIU_SELF_SERVICE_ENABLED:true,YIXIAOXIU_MY_REPORTS_ENABLED:true}},wecomWebOAuth:{enabled:true,corpId:config.corpId,agentId:config.agentId,resolveCode:async()=>({userid:'T25_MANUAL_FEEDBACK_OPEN_A'})}});
});
